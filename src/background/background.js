/**
 * Lighthouse - Background Service Worker
 * Handles persistent state migration and proxies API requests.
 */

// The actions and the settings declared in config.js (for keeping stored settings current)
importScripts('../modules/math.js', '../utils/data.js', '../modules/actions.js', '../utils/config.js');

// Stored settings after an install or update. Only what needs fixing is written, so a default stays a
// default (a later version can improve it): invalid or unknown values are removed, so their defaults apply
// again, and new actions join the end of a stored order (removed ones leave it). New actions are on: the default.
chrome.runtime.onInstalled.addListener(() => {
    const Config = self.LighthouseConfig, ids = Config.actions.map(a => a.id);
    chrome.storage.sync.get(null, (stored) => {
        const valid = Config.validOnly(stored), invalid = Object.keys(stored).filter(k => !(k in valid));
        if (invalid.length) chrome.storage.sync.remove(invalid);
        if (!valid.order) return;
        const order = [...valid.order.filter(id => ids.includes(id)), ...ids.filter(id => !valid.order.includes(id))];
        if (JSON.stringify(order) !== JSON.stringify(valid.order)) chrome.storage.sync.set({ order });
    });
    chrome.storage.local.remove('copyStack');   // the collection used to be kept on disk; it now lives in session storage
});

// --- Network Gateway ---
// The only place the extension contacts the internet. Requests go only to the services
// below (plus link previews, which fetch the page you hovered), never send cookies or a
// referrer, and time out. Content scripts cannot ask for arbitrary URLs or options.
// Allowed services are exactly the manifest's host permissions ("*." allows subdomains)
const ALLOWED_SERVICES = (chrome.runtime.getManifest().host_permissions || []).map(p => {
    const host = p.replace(/^https:\/\//, '').replace(/\/.*$/, '');
    return host.startsWith('*.') ? new RegExp('(^|\\.)' + host.slice(2).replace(/\./g, '\\.') + '$') : host;
});
// Collected snippets live in session storage (memory only, cleared when the browser closes)
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
chrome.runtime.onStartup.addListener(() => {});   // wakes the worker at browser start, so the line above runs

// The only service that receives text in a request body (LanguageTool accepts POST only)
const POST_SERVICES = ['api.languagetool.org'];

function isAllowedService(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && ALLOWED_SERVICES.some(h => typeof h === 'string' ? u.hostname === h : h.test(u.hostname));
    } catch (e) {
        return false;
    }
}

// Loopback (localhost) stays reachable from anywhere. A private host is reachable only inside a private
// network: private and link-local addresses, one-word names, reserved local endings.
const bare = (host) => host.toLowerCase().replace(/^\[|\]$/g, '');
const isLoopback = (host) => /^(localhost|127\.|0\.0\.0\.0$|::1$)/.test(bare(host)) || bare(host).endsWith('.localhost');
function isPrivateHost(host) {
    const h = bare(host);
    if (isLoopback(h)) return false;
    return /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /^f(c|d|e[89ab])[0-9a-f]*:/.test(h)
        || (!h.includes('.') && !h.includes(':')) || /\.(local|internal|lan|home\.arpa)$/.test(h);
}

// from: the page that asked (anyHost fetches). A public page can't reach into the private network
// through Lighthouse, not even by a redirect; a local page (intranet, localhost) can.
async function gatewayFetch(url, { anyHost = false, from = null, timeout = 8000, cutAt = null, post = null, image = false } = {}) {
    let u;
    try { u = new URL(url); } catch (e) { throw new Error('Invalid URL'); }
    if (!['https:', 'http:'].includes(u.protocol)) throw new Error('Unsupported protocol');
    if (!anyHost && !isAllowedService(url)) throw new Error('Not an allowed service');
    let fromLocal = true;
    try { const h = new URL(from).hostname; fromLocal = !from || isLoopback(h) || isPrivateHost(h); } catch (e) { /* unknown page: as local */ }
    const blocked = (target) => anyHost && !fromLocal && isPrivateHost(new URL(target).hostname);
    if (blocked(u.href)) throw new Error('Private network address');
    if (post !== null && !POST_SERVICES.includes(u.hostname)) throw new Error('Not an allowed service');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(u.href, post !== null
            ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: post, credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal }
            : { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        if (blocked(res.url || u.href)) throw new Error('Private network address');   // redirected into it
        if (image) {   // small images only (icons): anything else is refused
            const blob = await res.blob();
            if (!blob.type.startsWith('image/') || blob.size > 100 * 1024) throw new Error('Not an icon');
            return blob;
        }
        let text = await res.text();
        if (cutAt) { const i = text.toLowerCase().indexOf(cutAt); if (i > -1) text = text.slice(0, i); }
        return text;
    } finally {
        clearTimeout(timer);
    }
}

// --- Clipboard (read in src/offscreen with the extension's permission: no site prompts) ---
let creating = null;   // one creation at a time (a second would fail)
const ensureOffscreen = async () => (await chrome.offscreen.hasDocument()) || await (creating ||= chrome.offscreen.createDocument(
    { url: 'src/offscreen/offscreen.html', reasons: ['CLIPBOARD'], justification: 'Paste button and its preview' }).finally(() => { creating = null; }));
ensureOffscreen().catch(() => {});

async function readClipboard(sender) {
    if (!sender.tab || !sender.tab.active) throw new Error('Not the active tab');   // only the tab in front
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'read-clipboard' });
    return { text: (res && res.text) || '' };
}

// --- Favicons (_favicon is not web-accessible: pages could read the cache, i.e. your history) ---
// Chrome stores icons per page you visited, so each step is tried until one has an icon:
// that exact page, the site's homepage, the site's icon shown earlier this session, and (link
// previews on) the icon the page itself declares. Sites are remembered in session storage.
const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
});
const cachedFavicon = async (pageUrl) => blobToDataUrl(await (await fetch(chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`))).blob());
let blankFavicon = null;   // what Chrome returns when it has no icon
const storedFavicon = async (pageUrl) => {
    blankFavicon ||= cachedFavicon('https://lighthouse.invalid/');
    const [icon, blank] = await Promise.all([cachedFavicon(pageUrl), blankFavicon]);
    return icon === blank ? null : icon;
};

async function favicon(url, iconUrl, from) {
    const page = new URL(url);
    const { favicons = {} } = await chrome.storage.session.get('favicons');   // site (origin) -> icon, or false: none found
    let icon = await storedFavicon(page.href) || await storedFavicon(page.origin + '/') || favicons[page.origin];
    if (icon === undefined && iconUrl && await previewsAllowed()) {
        icon = await gatewayFetch(iconUrl, { anyHost: true, from, timeout: 5000, image: true }).then(blobToDataUrl, () => false);
    }
    if (icon !== undefined && favicons[page.origin] !== icon) {
        const keep = Object.entries(favicons).slice(-199);   // a bounded memory: the newest 200 sites
        await chrome.storage.session.set({ favicons: { ...Object.fromEntries(keep), [page.origin]: icon } });
    }
    return icon ? { dataUrl: icon } : { success: false, none: icon === false, error: 'No icon' };
}

// --- Requests from the page ---
// Each service returns its reply (or throws); the router sends it as { success: true, ... } or
// { success: false, error }. Only these services exist: a page can't ask for anything else.
const SERVICES = {
    READ_CLIPBOARD: (r, sender) => readClipboard(sender),
    FAVICON: (r, sender) => favicon(r.url, r.iconUrl, sender.tab && sender.tab.url),
    GET_RATE: (r) => rate(r.base, r.target),
    TRANSLATE: async (r) => ({ result: await translateText(r.text, r.targetLang) }),
    DEFINE: (r) => define(r.text, r.wordLang, r.targetLang, r.readerLangs),
    SPELLCHECK: (r) => spellcheck(r.text, r.language),
    WIKI_SUMMARY: (r) => wikiSummary(r.lang, r.title),
    LINK_PREVIEW: (r, sender) => linkPreview(r.url, sender.tab && sender.tab.url),
    AMOUNT_WORDS: (r) => amountWords(r.langs)
};

// The words for prices and measurements in some languages (math.js builds them from what the browser knows):
// built once per set of languages and kept, so pages only read them. The newest few sets are kept.
async function amountWords(langs) {
    const key = [...new Set((Array.isArray(langs) ? langs : []).filter(l => /^[a-z]{2,3}$/.test(l)))].sort().slice(0, 6).join(',');
    const { amountWords: kept = {} } = await chrome.storage.local.get('amountWords');
    if (!kept[key]) {
        const recent = Object.entries(kept).slice(-2);
        await chrome.storage.local.set({ amountWords: { ...Object.fromEntries(recent), [key]: self.LighthouseMath.buildWords(key ? key.split(',') : []) } });
        return { result: (await chrome.storage.local.get('amountWords')).amountWords[key] };
    }
    return { result: kept[key] };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.target === 'offscreen') return;   // meant for the hidden page, not here
    const service = request && SERVICES[request.action];
    if (!service) return;
    Promise.resolve().then(() => service(request, sender)).then(
        (reply) => sendResponse({ success: true, ...reply }),
        (error) => sendResponse({ success: false, error: error.message }));
    return true;   // the reply comes later
});

// Article summary for the Wiki preview
async function wikiSummary(lang, title) {
    if (!/^[a-z]{2,3}(-[a-z]+)?$/i.test(lang || '') || !title) throw new Error('Invalid request');
    return { result: JSON.parse(await gatewayFetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)) };
}

// Link preview (opt-in): fetches the hovered page itself, only its <head>, without cookies.
// Only when the user turned previews on and granted the permission Chrome asked for.
async function previewsAllowed() {
    const { linkPreviews } = await chrome.storage.sync.get({ linkPreviews: self.LighthouseConfig.defaults.linkPreviews });
    return linkPreviews && await chrome.permissions.contains({ origins: ['https://*/*', 'http://*/*'] });
}

async function linkPreview(url, from) {
    if (!await previewsAllowed()) throw new Error('Link previews are off');
    return { result: await gatewayFetch(url, { anyHost: true, from, timeout: 5000, cutAt: '</head>' }) };
}

// --- Currency rates: per 1 USD, kept for a day ---
const RATES_CACHE_KEY = 'lighthouse_rates_cache';
const CACHE_DURATION = 24 * 60 * 60 * 1000;

// A currency missing from the rates (or an unusable value) is a failure, never NaN. asOf: when they were fetched
function rateFrom(rates, base, target, asOf) {
    const perUsd = (code) => code === 'USD' ? 1 : parseFloat(rates && rates[code]);
    const rate = perUsd(target) / perUsd(base);
    return Number.isFinite(rate) && rate > 0 ? { rate, asOf } : { success: false, error: 'Rate unavailable' };
}

async function rate(base, target) {
    const { [RATES_CACHE_KEY]: cached } = await chrome.storage.local.get(RATES_CACHE_KEY);
    const now = Date.now();
    if (cached && cached.timestamp && now - cached.timestamp < CACHE_DURATION) return rateFrom(cached.rates, base, target, cached.timestamp);
    const reply = JSON.parse(await gatewayFetch('https://api.coinbase.com/v2/exchange-rates?currency=USD'));
    const rates = reply && reply.data && reply.data.rates;
    if (rates) await chrome.storage.local.set({ [RATES_CACHE_KEY]: { timestamp: now, rates } });   // never cache a malformed reply
    return rateFrom(rates, base, target, now);
}

async function translateText(text, targetLang = 'en') {
    const url = `https://translate.googleapis.com/translate_a/single?client=at&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
    const data = JSON.parse(await gatewayFetch(url));
    return {
        text: data?.[0]?.map(part => part[0]).join('') || '',
        sourceLang: data?.[2] || null,   // Google returns the detected source lang here
        targetLang
    };
}

// --- Define ---
// English Wiktionary (the only edition with the endpoint) covers every language, in English:
// the entry for the word's language, translated for readers without English, plus a link.
const decodeEntities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function define(text, wordLang, targetLang, readerLangs) {
    const baseOf = self.LighthouseData.baseLanguage;
    const word = String(text || '').trim();
    if (!word || word.length > 100) throw new Error('Invalid request');
    const target = /^[a-z]{2,3}$/.test(baseOf(targetLang)) ? baseOf(targetLang) : 'en';
    const readers = new Set([target, ...(readerLangs || []).map(baseOf)].filter(Boolean));
    const link = `https://${target}.wiktionary.org/wiki/${encodeURIComponent(word)}`;
    const order = [...new Set([baseOf(wordLang), ...readers].filter(Boolean))];

    // Titles are case-sensitive: "House" at the start of a sentence is usually "house"
    for (const title of [...new Set([word, word.toLowerCase()])]) {
        let data;
        try { data = JSON.parse(await gatewayFetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(title)}`)); }
        catch (e) { continue; }
        const key = order.find(k => Array.isArray(data[k]));
        const definition = key && data[key]
            .flatMap(entry => entry.definitions || [])
            .map(d => decodeEntities((d.definition || '').replace(/<[^>]+>/g, '')).trim())
            .find(Boolean);
        if (!definition) continue;
        // language: which language the word was read as (its entry), e.g. 'Gift' as German or English
        if (readers.has('en')) return { result: { definition, translated: false, language: key, link } };
        try {
            const t = await translateText(definition, target);
            if (t.text) return { result: { definition: t.text, translated: true, language: key, link } };
        } catch (e) { /* fall through to the link */ }
        return { result: { definition: null, link } };
    }
    return { result: { definition: null, link } };
}

// --- Spelling and grammar (LanguageTool) ---
// English, German and Portuguese need a regional variant, or LanguageTool won't check spelling
const LT_VARIANTS = { en: ['US', 'GB', 'AU', 'CA', 'NZ', 'ZA'], de: ['DE', 'AT', 'CH'], pt: ['PT', 'BR', 'AO', 'MZ'] };
const LT_KEEP_TYPES = new Set(['misspelling', 'grammar']);
const LT_KEEP_CATEGORIES = new Set(['TYPOS', 'GRAMMAR', 'CONFUSED_WORDS', 'CASING']);   // no style advice

function ltVariant(base) {
    const regions = LT_VARIANTS[base];
    if (!regions) return null;
    const own = (self.navigator && navigator.languages || []).map(l => l.split('-'))
        .find(([b, r]) => b.toLowerCase() === base && r && regions.includes(r.toUpperCase()));
    return `${base}-${own ? own[1].toUpperCase() : regions[0]}`;
}

async function checkText(text, language) {
    const params = new URLSearchParams({ text, language });
    if (language === 'auto') params.set('preferredVariants', Object.keys(LT_VARIANTS).map(ltVariant).join(','));
    const data = JSON.parse(await gatewayFetch('https://api.languagetool.org/v2/check', { post: params.toString() }));
    // { issues, language }: the language it was checked as (LanguageTool's own answer, also when detecting)
    const issues = (data.matches || [])
        .filter(m => m.rule && (LT_KEEP_TYPES.has(m.rule.issueType) || LT_KEEP_CATEGORIES.has(m.rule.category && m.rule.category.id)))
        .map(m => ({
            offset: m.offset, length: m.length,
            message: m.shortMessage || m.message || '',
            replacements: (m.replacements || []).slice(0, 3).map(r => r.value)
        }));
    return { issues, language: (data.language && data.language.code) || null };
}

async function spellcheck(text, language) {
    if (!text || text.length > 600) throw new Error('Invalid request');
    const base = self.LighthouseData.baseLanguage(language);
    const lang = /^[a-z]{2,3}$/.test(base) ? (ltVariant(base) || base) : 'auto';
    try {
        return { result: await checkText(text, lang) };
    } catch (error) {
        if (lang === 'auto') throw error;
        return { result: await checkText(text, 'auto') };   // a language LanguageTool doesn't know: let it detect instead
    }
}

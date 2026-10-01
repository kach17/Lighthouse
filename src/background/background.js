/**
 * Lighthouse - Background Service Worker
 * Handles persistent state migration and proxies API requests.
 */

if( 'importScripts' in self ) {
    try {
      importScripts('../modules/math.js'); // Dependency of actions (rarely used at top level but safer)
      importScripts('../utils/data.js'); // Dependency of actions
      importScripts('../modules/actions.js');
      importScripts('../utils/config.js'); 
    } catch(e) {
      // ignore if loaded via manifest bundle (rare in MV3 SW)
    }
}

// --- Migration Logic ---
chrome.runtime.onInstalled.addListener(async (details) => {
    const Config = self.LighthouseConfig;
    if (!Config) return; 

    const defaults = Config.defaults;
    
    chrome.storage.sync.get(defaults, (items) => {
        let dirty = false;

        // 1. Sync 'order' array: Add new actions
        const storedOrderSet = new Set(items.order);
        // Config.actions is populated from LighthouseActions in config.js
        const allActions = Config.actions || [];
        
        allActions.forEach(act => {
            if (!storedOrderSet.has(act.id)) {
                items.order.push(act.id);
                if (items.enabled[act.id] === undefined) {
                    items.enabled[act.id] = true;
                }
                dirty = true;
            }
        });

        // 2. Clean 'order' array
        const validIds = new Set(allActions.map(a => a.id));
        const filteredOrder = items.order.filter(id => validIds.has(id));
        if (filteredOrder.length !== items.order.length) {
            items.order = filteredOrder;
            dirty = true;
        }

        // 3. Ensure structure integrity
        if (!items.searchEngines || !Array.isArray(items.searchEngines)) {
            items.searchEngines = defaults.searchEngines;
            dirty = true;
        }

        if (dirty) {
            chrome.storage.sync.set(items, () => {
            });
        }
    });

    // The collection used to be kept on disk; it now lives in session storage
    chrome.storage.local.remove('copyStack');
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

async function gatewayFetch(url, { anyHost = false, timeout = 8000, cutAt = null, post = null } = {}) {
    let u;
    try { u = new URL(url); } catch (e) { throw new Error('Invalid URL'); }
    if (!['https:', 'http:'].includes(u.protocol)) throw new Error('Unsupported protocol');
    if (!anyHost && !isAllowedService(url)) throw new Error('Not an allowed service');
    if (post !== null && !POST_SERVICES.includes(u.hostname)) throw new Error('Not an allowed service');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(u.href, post !== null
            ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: post, credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal }
            : { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        let text = await res.text();
        if (cutAt) { const i = text.toLowerCase().indexOf(cutAt); if (i > -1) text = text.slice(0, i); }
        return text;
    } finally {
        clearTimeout(timer);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const actions = {
        'GET_RATE': () => handleGetRate(request.base, request.target, sendResponse),
        'TRANSLATE': () => handleTranslate(request.text, request.targetLang, sendResponse),
        'DEFINE': () => handleDefine(request.text, request.wordLang, request.targetLang, request.readerLangs, sendResponse),
        'SPELLCHECK': () => handleSpellcheck(request.text, request.language, sendResponse),
        'WIKI_SUMMARY': () => handleWikiSummary(request.lang, request.title, sendResponse),
        'LINK_PREVIEW': () => handleLinkPreview(request.url, sendResponse)
    };

    if (actions[request.action]) {
        actions[request.action]();
        return true;
    }
});

/**
 * Fetch through the gateway and reply to the content script
 */
async function _fetch(url, sendResponse, transform = (t) => t) {
    try {
        const text = await gatewayFetch(url);
        sendResponse({ success: true, result: transform(text) });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// Article summary for the Wiki preview
function handleWikiSummary(lang, title, sendResponse) {
    if (!/^[a-z]{2,3}(-[a-z]+)?$/i.test(lang || '') || !title) return sendResponse({ success: false, error: 'Invalid request' });
    _fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, sendResponse, JSON.parse);
}

// Link preview (opt-in): fetches the hovered page itself, only its <head>, without cookies.
// Only when the user turned previews on and granted the permission Chrome asked for.
async function handleLinkPreview(url, sendResponse) {
    try {
        const { linkPreviews } = await new Promise(r => chrome.storage.sync.get({ linkPreviews: false }, r));
        const granted = await chrome.permissions.contains({ origins: ['https://*/*', 'http://*/*'] });
        if (!linkPreviews || !granted) return sendResponse({ success: false, error: 'Link previews are off' });
        const head = await gatewayFetch(url, { anyHost: true, timeout: 5000, cutAt: '</head>' });
        sendResponse({ success: true, result: head });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// --- Currency Rate Handling ---
const RATES_CACHE_KEY = 'lighthouse_rates_cache';
const CACHE_DURATION = 24 * 60 * 60 * 1000; 

const getStorageLocal = (key) => new Promise((resolve) => chrome.storage.local.get(key, resolve));
const setStorageLocal = (obj) => new Promise((resolve) => chrome.storage.local.set(obj, resolve));

async function handleGetRate(base, target, sendResponse) {
    try {
        const data = await getStorageLocal(RATES_CACHE_KEY);
        let cached = data[RATES_CACHE_KEY];
        const now = Date.now();

        if (cached && cached.timestamp && (now - cached.timestamp < CACHE_DURATION)) {
            const rates = cached.rates;
            const derivedRate = ((target === 'USD') ? 1 : parseFloat(rates[target])) / ((base === 'USD') ? 1 : parseFloat(rates[base]));
            sendResponse({ success: true, rate: derivedRate });
            return;
        }

        _fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD', (res) => {
            if (!res.success) return sendResponse(res);
            const rates = res.result.data.rates;
            setStorageLocal({ [RATES_CACHE_KEY]: { timestamp: now, rates } });
            const derivedRate = ((target === 'USD') ? 1 : parseFloat(rates[target])) / ((base === 'USD') ? 1 : parseFloat(rates[base]));
            sendResponse({ success: true, rate: derivedRate });
        }, JSON.parse);
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function translateText(text, targetLang = 'en') {
    const url = `https://translate.googleapis.com/translate_a/single?client=at&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
    const data = JSON.parse(await gatewayFetch(url));
    return {
        text: data?.[0]?.map(part => part[0]).join('') || '',
        sourceLang: data?.[2] || null // Google returns the detected source lang here
    };
}

async function handleTranslate(text, targetLang = 'en', sendResponse) {
    try {
        sendResponse({ success: true, result: await translateText(text, targetLang) });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

// --- Define ---
// English Wiktionary (the only edition with the endpoint) covers every language, in English:
// the entry for the word's language, translated for readers without English, plus a link.
const decodeEntities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function handleDefine(text, wordLang, targetLang, readerLangs, sendResponse) {
    const baseOf = (l) => String(l || '').toLowerCase().split(/[-_]/)[0];
    const word = String(text || '').trim();
    if (!word || word.length > 100) return sendResponse({ success: false, error: 'Invalid request' });
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
        if (readers.has('en')) return sendResponse({ success: true, result: { definition, translated: false, link } });
        try {
            const t = await translateText(definition, target);
            if (t.text) return sendResponse({ success: true, result: { definition: t.text, translated: true, link } });
        } catch (e) { /* fall through to the link */ }
        return sendResponse({ success: true, result: { definition: null, link } });
    }
    sendResponse({ success: true, result: { definition: null, link } });
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
    return (data.matches || [])
        .filter(m => m.rule && (LT_KEEP_TYPES.has(m.rule.issueType) || LT_KEEP_CATEGORIES.has(m.rule.category && m.rule.category.id)))
        .map(m => ({
            offset: m.offset, length: m.length,
            message: m.shortMessage || m.message || '',
            replacements: (m.replacements || []).slice(0, 3).map(r => r.value)
        }));
}

async function handleSpellcheck(text, language, sendResponse) {
    if (!text || text.length > 600) return sendResponse({ success: false, error: 'Invalid request' });
    const base = String(language || '').toLowerCase().split(/[-_]/)[0];
    const lang = /^[a-z]{2,3}$/.test(base) ? (ltVariant(base) || base) : 'auto';
    try {
        sendResponse({ success: true, result: await checkText(text, lang) });
    } catch (error) {
        // A language LanguageTool doesn't know: let it detect instead
        if (lang === 'auto') return sendResponse({ success: false, error: error.message });
        try { sendResponse({ success: true, result: await checkText(text, 'auto') }); }
        catch (e) { sendResponse({ success: false, error: e.message }); }
    }
}
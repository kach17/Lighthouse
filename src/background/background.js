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
});

// --- API Proxy Logic ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const actions = {
        'GET_RATE': () => handleGetRate(request.base, request.target, sendResponse),
        'TRANSLATE': () => handleTranslate(request.text, request.targetLang, sendResponse),
        'DEFINE': () => handleDefine(request.text, request.detectedLang, request.targetLang, sendResponse),
        'SPELLCHECK': () => handleSpellcheck(request.text, sendResponse),
        'FETCH_RAW': () => _fetch(request.url, request.options || {}, sendResponse)
    };

    if (actions[request.action]) {
        actions[request.action]();
        return true;
    }
});

/**
 * Common Fetch Helper
 */
async function _fetch(url, options = {}, sendResponse, transform = (t) => t) {
    try {
        const res = await fetch(url, options);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const text = await res.text();
        sendResponse({ success: true, result: transform(text), status: res.status });
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

        _fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD', {}, (res) => {
            if (!res.success) return sendResponse(res);
            const json = JSON.parse(res.result);
            const rates = json.data.rates;
            setStorageLocal({ [RATES_CACHE_KEY]: { timestamp: now, rates } });
            const derivedRate = ((target === 'USD') ? 1 : parseFloat(rates[target])) / ((base === 'USD') ? 1 : parseFloat(rates[base]));
            sendResponse({ success: true, rate: derivedRate });
        });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function handleTranslate(text, targetLang = 'en', sendResponse) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
    _fetch(url, {}, sendResponse, (raw) => {
        const data = JSON.parse(raw);
        return {
            text: data?.[0]?.map(part => part[0]).join('') || '',
            sourceLang: data?.[2] || null // Google returns the detected source lang here
        };
    });
}

async function handleDefine(text, detectedLang, targetLang, sendResponse) {
    const candidates = [...new Set([detectedLang, targetLang, 'en'].filter(Boolean))]
        .map(l => l.split('-')[0]);

    for (const lang of candidates) {
        try {
            const url = `https://${lang}.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(text)}`;
            const res = await fetch(url);
            if (!res.ok) continue;
            const data = await res.json();
            const def = data[lang]?.[0]?.definitions?.[0]?.definition;
            if (def) {
                return sendResponse({ success: true, result: def.replace(/<[^>]+>/g, '') });
            }
        } catch (e) {
            // try next candidate in the chain
        }
    }
    sendResponse({ success: false, error: 'No definition found' });
}

async function handleSpellcheck(text, sendResponse) {
    const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(text)}&max=3`;
    _fetch(url, {}, sendResponse, JSON.parse);
}
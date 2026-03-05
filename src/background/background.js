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
    switch (request.action) {
        case 'GET_RATE':
            handleGetRate(request.base, request.target, sendResponse);
            return true; 
        case 'TRANSLATE':
            handleTranslate(request.text, request.targetLang, sendResponse);
            return true;
        case 'DEFINE':
            handleDefine(request.text, request.targetLang, sendResponse);
            return true;
        case 'SPELLCHECK':
            handleSpellcheck(request.text, sendResponse);
            return true;
    }
});

// --- Currency Rate Handling ---
const RATES_CACHE_KEY = 'lighthouse_rates_cache';
const CACHE_DURATION = 24 * 60 * 60 * 1000; 

const getStorageLocal = (key) => new Promise((resolve) => chrome.storage.local.get(key, resolve));
const setStorageLocal = (obj) => new Promise((resolve) => chrome.storage.local.set(obj, resolve));

async function handleGetRate(base, target, sendResponse) {
    try {
        const data = await getStorageLocal(RATES_CACHE_KEY);
        let cached = data[RATES_CACHE_KEY];
        let rates;
        
        const now = Date.now();
        const isValid = cached && cached.timestamp && (now - cached.timestamp < CACHE_DURATION);

        if (isValid) {
            rates = cached.rates;
        } else {
            const res = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD');
            if (!res.ok) throw new Error(`Coinbase API Error: ${res.status}`);
            const json = await res.json();
            if (!json.data || !json.data.rates) throw new Error('Invalid API Response');
            rates = json.data.rates;
            await setStorageLocal({
                [RATES_CACHE_KEY]: { timestamp: now, rates: rates }
            });
        }

        const rateToTarget = (target === 'USD') ? 1 : parseFloat(rates[target]);
        const rateToBase = (base === 'USD') ? 1 : parseFloat(rates[base]);

        if (isNaN(rateToTarget) || isNaN(rateToBase) || rateToBase === 0) {
            sendResponse({ success: false, error: 'Currency not supported' });
            return;
        }

        const derivedRate = rateToTarget / rateToBase;
        sendResponse({ success: true, rate: derivedRate });

    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function handleTranslate(text, targetLang = 'en', sendResponse) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        let result = '';
        if (data && data[0]) {
            data[0].forEach(part => { if (part[0]) result += part[0]; });
        }
        sendResponse({ success: true, result: result || 'Translation failed' });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function handleDefine(text, targetLang = 'en', sendResponse) {
    try {
        const lang = targetLang.split('-')[0];
        const url = `https://${lang}.wikipedia.org/w/api.php?action=query&exsectionformat=plain&prop=extracts&origin=*&exchars=300&exlimit=1&explaintext=0&formatversion=2&format=json&titles=${encodeURIComponent(text.replace(/ /g, '_'))}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        const extract = data?.query?.pages?.[0]?.extract;
        if (extract) sendResponse({ success: true, result: extract });
        else {
            // Fallback to English Wikipedia
            if (lang !== 'en') {
                const enUrl = `https://en.wikipedia.org/w/api.php?action=query&exsectionformat=plain&prop=extracts&origin=*&exchars=300&exlimit=1&explaintext=0&formatversion=2&format=json&titles=${encodeURIComponent(text.replace(/ /g, '_'))}`;
                const enRes = await fetch(enUrl);
                const enData = await enRes.json();
                const enExtract = enData?.query?.pages?.[0]?.extract;
                if (enExtract) {
                    sendResponse({ success: true, result: enExtract });
                    return;
                }
            }
            sendResponse({ success: false, error: 'No definition found' });
        }
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}

async function handleSpellcheck(text, sendResponse) {
    try {
        const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(text)}&max=3`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        sendResponse({ success: true, result: data });
    } catch (error) {
        sendResponse({ success: false, error: error.message });
    }
}
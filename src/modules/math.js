(function(global) {
    const MathLib = {
        safeCalculate: (expr) => {
            try { return Function(`'use strict'; return (${expr.replace(/[^\d+\-*/.()\s]/g, '')})`)(); } catch (e) { return null; }
        },
        parseLocaleNumber: (str) => {
            const clean = str.replace(/[^0-9,.-]/g, '');
            return (clean.indexOf(',') > clean.indexOf('.')) ? parseFloat(clean.replace(/\./g, '').replace(',', '.')) : parseFloat(clean.replace(/,/g, ''));
        },
        fetchRate: async (base, target) => {
            if (base === target) return 1;
            return new Promise(r => chrome.runtime.sendMessage({ action: 'GET_RATE', base, target }, res => r(res?.success ? res.rate : null)));
        },
        convertAllText: async (text, targetCurrency, targetUnitSystem, rateFetcher) => {
            const Data = global.LighthouseData;
            if (!Data) return { text, modified: false };
            let newText = text, modified = false;
            const unitRegex = new RegExp(`(^|\\s)([\\d,.]+)\\s*°?(${Object.keys(Data.UNIT_CONVERSIONS || {}).join('|')})(?=\\s|$|[.,])`, 'gi');
            newText = newText.replace(unitRegex, (m, s, v, u) => {
                const c = u.toLowerCase(), conv = Data.UNIT_CONVERSIONS[c];
                if (!conv || (targetUnitSystem === 'metric' && ['c', 'km', 'kg', 'cm', 'm', 'g'].includes(c)) || (targetUnitSystem === 'imperial' && ['f', 'mi', 'lbs', 'in', 'ft', 'oz'].includes(c))) return m;
                modified = true;
                return `${s}${conv.func(parseFloat(v.replace(/,/g, ''))).toFixed(2)} ${conv.target}`;
            });
            const currKeys = Object.keys(Data.CURRENCY_MAP || {}).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            const currRegex = new RegExp(`(^|\\s)([\\d,.]+)\\s*(${currKeys})|(^|\\s)(${currKeys})\\s*([\\d,.]+)`, 'gi');
            for (const m of [...newText.matchAll(currRegex)]) {
                const v = m[2] || m[6], k = (m[3] || m[5]).toUpperCase(), b = Data.CURRENCY_MAP[k];
                if (!b || b === targetCurrency) continue;
                const r = await rateFetcher(b, targetCurrency);
                if (r) { modified = true; newText = newText.replace(m[0], `${m[1] || m[4] || ''}${(parseFloat(v.replace(/,/g, '')) * r).toFixed(2)} ${targetCurrency}`); }
            }
            return { text: newText, modified };
        }
    };
    global.LighthouseMath = MathLib;
})(typeof self !== 'undefined' ? self : window);

(function(global) {
    const MathLib = {
        /**
         * Evaluates plain arithmetic (+ - * / × ÷ % ^ and parentheses) without executing code, so it
         * also works under the extension's security policy. Only a real calculation qualifies: the
         * whole text must be arithmetic, with an operator between numbers (not "2024" or "#2F6FEB").
         */
        safeCalculate: (expr) => {
            const src = String(expr).trim().replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/×/g, '*').replace(/÷/g, '/');
            if (src.length > 50 || !/^[\d\s.+\-*/%^()]+$/.test(src)) return null;
            // A calculation needs an operator between numbers. An unspaced hyphen is a range or an ID
            // (2023-2024, 555-1234), and number/number/number is a date (12/05/2024): not calculations.
            if (!/\d\s*[+*/%^]\s*[\d(.-]|\d\s+-\s*[\d(.]|\)\s*-\s*[\d(.]/.test(src)) return null;
            if (/^\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}$/.test(src.replace(/\s/g, ''))) return null;
            const tokens = src.match(/\d*\.?\d+|[+\-*/%^()]/g);
            let i = 0;
            const peek = () => tokens[i], next = () => tokens[i++];
            const primary = () => {
                const t = next();
                if (t === '(') { const v = sum(); if (next() !== ')') throw 0; return v; }
                if (t === '-') return -primary();
                const n = Number(t); if (!Number.isFinite(n)) throw 0; return n;
            };
            const power = () => { const b = primary(); return peek() === '^' ? (next(), b ** power()) : b; };
            const product = () => {
                let v = power();
                while (['*', '/', '%'].includes(peek())) { const op = next(), r = power(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; }
                return v;
            };
            const sum = () => {
                let v = product();
                while (['+', '-'].includes(peek())) { const op = next(), r = product(); v = op === '+' ? v + r : v - r; }
                return v;
            };
            try { const v = sum(); return i === tokens.length && Number.isFinite(v) ? v : null; } catch (e) { return null; }
        },
        parseLocaleNumber: (str, currency) => {
            const clean = str.replace(/[^0-9,.-]/g, '');
            const lastComma = clean.lastIndexOf(',');
            const lastDot = clean.lastIndexOf('.');

            // Both separators present: whichever appears last is the decimal point,
            // the other is a thousands/grouping separator (handles "1,234.56" and "1.234,56").
            if (lastComma > -1 && lastDot > -1) {
                return lastComma > lastDot
                    ? parseFloat(clean.replace(/\./g, '').replace(',', '.'))
                    : parseFloat(clean.replace(/,/g, ''));
            }

            const sep = lastComma > -1 ? ',' : (lastDot > -1 ? '.' : null);
            if (!sep) return parseFloat(clean);

            // More than one occurrence of the same separator ("1,234,567") is always grouping.
            if (clean.split(sep).length - 1 > 1) {
                return parseFloat(clean.split(sep).join(''));
            }

            // Single separator, ambiguous on its own ("15,000" / "15.000" / "15,5"...).
            // Resolve using the currency's real decimal precision (ISO 4217) via Intl,
            // instead of a hardcoded per-currency table - this covers JPY/KRW (0 decimals),
            // BHD/KWD/OMR (3 decimals), etc. automatically and stays correct if it ever changes.
            let expectedDecimals = 2;
            if (currency) {
                try {
                    expectedDecimals = new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: currency
                    }).resolvedOptions().maximumFractionDigits;
                } catch (e) { /* unknown/crypto code - keep default of 2 */ }
            }

            const digitsAfter = clean.length - clean.lastIndexOf(sep) - 1;
            if (digitsAfter === expectedDecimals) {
                return parseFloat(clean.replace(sep, '.'));
            }

            // Digit count didn't match the currency's precision (e.g. 3 digits after
            // the separator for a 2-decimal currency) - that's the classic grouping
            // pattern, so treat it as thousands rather than a decimal point.
            if (digitsAfter === 3) {
                return parseFloat(clean.split(sep).join(''));
            }

            // Fall back to what this page's own locale uses as a decimal marker.
            try {
                const pageLocale = (typeof document !== 'undefined' && document.documentElement.lang) || 'en-US';
                const localeDecimalSep = new Intl.NumberFormat(pageLocale).formatToParts(1.5)
                    .find(p => p.type === 'decimal')?.value || '.';
                if (sep === localeDecimalSep) return parseFloat(clean.replace(sep, '.'));
            } catch (e) { /* keep default */ }

            return parseFloat(clean.replace(sep, '.'));
        },
        // The one way to get a currency rate: { rate, asOf } (when the rates were fetched), or null.
        // The background keeps rates for a day; asked once per pair per 10 minutes in a page
        // (a whole-page conversion asks for every price).
        rate: (base, target) => base === target ? Promise.resolve({ rate: 1, asOf: null })
            : global.LighthouseUtils.ask('GET_RATE', { base, target }, { maxAge: 10 * 60 * 1000 })
                .then(res => res && res.success ? { rate: res.rate, asOf: res.asOf || null } : null),
        // { value, target, metric } for a value in a unit ("5", "km"), or null for an unknown unit
        convertUnit: (value, unit) => {
            const key = String(unit).toLowerCase();
            const conv = global.LighthouseData.UNIT_CONVERSIONS[key];
            return conv && Number.isFinite(value) ? { value: conv.func(value), target: conv.target, metric: global.LighthouseData.METRIC_UNITS.includes(key) } : null;
        },
        // Whether a unit is already in the user's system, so it needn't be converted
        inSystem: (unit, system) => global.LighthouseData[system === 'metric' ? 'METRIC_UNITS' : 'IMPERIAL_UNITS'].includes(String(unit).toLowerCase()),

        // ---------- Prices and measurements in text ----------
        // The words for them, from what the browser knows (Intl) in the given languages: every currency it lists,
        // with its symbols and names, and each unit's short and long names; plus the codes, symbols and
        // abbreviations in data.js (crypto, "lbs"). { currency: word -> [codes], unit: word -> unit key }, most
        // likely first. Built by the background, once per set of languages (a tenth of a second), and kept.
        buildWords: (langs) => {
            const Data = global.LighthouseData, currency = {}, unit = {};
            // Words match as written; names (longer than a symbol) also in lower case. Codes only in capitals: with every
            // currency known, some are ordinary words ("ALL", "TOP"). A word that is a unit stays one ("5 km", not
            // Bosnian marks "KM"; "3 ft", not forints "Ft")
            const add = (map, word, value, forms = (w) => w.length > 3 ? [w, w.toLowerCase()] : [w]) => {
                word = String(word).replace(/^°/, '').trim();
                if (!word || /\d/.test(word)) return;
                for (const w of forms(word)) {
                    if (map === unit) map[w] = map[w] || value;
                    else if (!unit[w]) (map[w] = map[w] || []).includes(value) || map[w].push(value);
                }
            };
            const caseless = (w) => [w, w.toLowerCase(), w.toUpperCase()];   // data.js's words, as always: "25 eur", "20 C"
            const each = (options, values, fn) => langs.forEach(lang => {
                try { const f = new Intl.NumberFormat(lang, options); values.forEach(v => f.formatToParts(v).forEach(fn)); } catch (e) { /* unknown to this browser */ }
            });
            for (const [key, conv] of Object.entries(Data.UNIT_CONVERSIONS)) {
                add(unit, key, key, caseless);
                for (const display of ['short', 'long', 'narrow']) each({ style: 'unit', unit: conv.unit, unitDisplay: display }, [1, 2, 5], p => p.type === 'unit' && add(unit, p.value, key));
            }
            Object.entries(Data.CURRENCY_MAP).forEach(([word, code]) => add(currency, word, code, caseless));
            for (const display of ['symbol', 'narrowSymbol', 'name']) for (const code of Intl.supportedValuesOf('currency')) {
                each({ style: 'currency', currency: code, currencyDisplay: display }, display === 'name' ? [1, 2, 5] : [1],
                    p => p.type === 'currency' && add(currency, p.value, code, /^[A-Z]{3}$/.test(p.value) ? (w) => [w] : undefined));
            }
            Intl.supportedValuesOf('currency').forEach(code => add(currency, code, code, (w) => [w]));
            return { currency, unit };
        },
        // The page asks for the words of its reader's languages once it is idle; until they arrive, data.js's
        // own codes, symbols and abbreviations are recognised
        loadWords: (langs) => global.LighthouseUtils.ask('AMOUNT_WORDS', { langs }).then(res => {
            if (res && res.success) { words = res.result; matcher = null; MathLib.findAmounts(''); }   // the pattern too, while idle
        }),

        /**
         * Every price and measurement in a text: [{ index, length, value, currency } | { ..., unit }]. Numbers are read
         * in any locale's writing ("1 234,50", "1.234,56", "1'234.50", "1,50,000"). A symbol several currencies share
         * ("$", "¥") is the user's currency when it is one of them (prefer), else the most likely one.
         */
        findAmounts: (text, prefer = null) => {
            if (!matcher) {
                const own = words || MathLib.buildWords([]);   // no languages: data.js's words and the currency codes
                const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const alt = (map) => Object.keys(map).sort((x, y) => y.length - x.length).map(escape).join('|');
                const NUM = String.raw`\d{1,3}(?:,\d{2})+,\d{3}(?:\.\d+)?|\d{1,3}(?:[\s'’.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;
                // A currency before or after the number ("€25", "25 EUR"); a unit only after it ("5 km", "70 °F")
                matcher = { own, re: new RegExp(String.raw`(?<![\p{L}\p{N}])(?:(${alt(own.currency)})\s*(${NUM})|(${NUM})\s*°?\s*(${alt({ ...own.currency, ...own.unit })}))(?![\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}])`, 'gu') };
            }
            const { own, re } = matcher, found = [];
            for (const m of text.matchAll(re)) {
                const word = m[1] || m[4], number = m[2] || m[3], codes = own.currency[word];
                const currency = codes && (prefer && codes.includes(prefer) ? prefer : codes[0]);
                const unit = !currency && own.unit[word];
                if (!currency && !unit) continue;
                const value = MathLib.parseLocaleNumber(number, currency || undefined);
                if (Number.isFinite(value)) found.push({ index: m.index, length: m[0].length, value, ...(currency ? { currency } : { unit }) });
            }
            return found;
        },
        // A text with its prices in the user's currency and its measurements in the user's system ("Convert page")
        // A converted value as the reader writes it, everywhere it is shown: a price by the browser, in the reader's
        // locale (₹480.00, 480,00 €); a measurement as a locale number with its unit (2,624.67 ft)
        format: (value, { currency, unit }) => {
            if (currency) try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value); } catch (e) { /* not an ISO code */ }
            return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency || unit}`;
        },
        // The prices and measurements in a text that convert: each { index, length, shown } (shown: as format writes it)
        convertText: async (text, targetCurrency, targetUnitSystem) => {
            const parts = [];
            for (const a of MathLib.findAmounts(text, targetCurrency)) {
                let shown = null;
                if (a.currency && a.currency !== targetCurrency) {
                    const found = await MathLib.rate(a.currency, targetCurrency);
                    if (found) { shown = MathLib.format(a.value * found.rate, { currency: targetCurrency }); a.rate = { base: a.currency, target: targetCurrency, ...found }; }
                } else if (a.unit && !MathLib.inSystem(a.unit, targetUnitSystem)) {
                    const conv = MathLib.convertUnit(a.value, a.unit);
                    if (conv) shown = MathLib.format(conv.value, { unit: conv.target });
                }
                if (shown) parts.push({ index: a.index, length: a.length, shown, rate: a.rate });
            }
            return parts;
        }
    };
    let words = null, matcher = null;   // the words for prices and measurements, and the pattern built from them
    global.LighthouseMath = MathLib;
})(typeof self !== 'undefined' ? self : window);
(function(global) {
    const rateCache = new Map(); // base>target -> { at, promise }
    let patterns = null;
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
        // The background caches rates for a day; this in-page cache avoids a message per price
        // when converting a whole page.
        rate: (base, target) => {
            if (base === target) return Promise.resolve({ rate: 1, asOf: null });
            const key = `${base}>${target}`;
            const hit = rateCache.get(key);
            if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.promise;
            const promise = global.LighthouseUtils.message('GET_RATE', { base, target })
                .then(res => res && res.success ? { rate: res.rate, asOf: res.asOf || null } : null)
                .then(found => { if (!found) rateCache.delete(key); return found; });
            rateCache.set(key, { at: Date.now(), promise });
            return promise;
        },
        // Just the number, from the same request
        fetchRate: (base, target) => MathLib.rate(base, target).then(found => found && found.rate),
        // Currency and unit keys as regex alternatives, built once (CURRENCY_MAP and UNIT_CONVERSIONS don't change)
        patterns: () => patterns || (patterns = {
            currencyKeys: Object.keys(global.LighthouseData.CURRENCY_MAP).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
            unitKeys: Object.keys(global.LighthouseData.UNIT_CONVERSIONS).join('|')
        }),
        // { value, target, metric } for a value in a unit ("5", "km"), or null for an unknown unit
        convertUnit: (value, unit) => {
            const key = String(unit).toLowerCase();
            const conv = global.LighthouseData.UNIT_CONVERSIONS[key];
            return conv && Number.isFinite(value) ? { value: conv.func(value), target: conv.target, metric: global.LighthouseData.METRIC_UNITS.includes(key) } : null;
        },
        // Whether a unit is already in the user's system, so it needn't be converted
        inSystem: (unit, system) => global.LighthouseData[system === 'metric' ? 'METRIC_UNITS' : 'IMPERIAL_UNITS'].includes(String(unit).toLowerCase()),

        convertAllText: async (text, targetCurrency, targetUnitSystem, rateFetcher) => {
            const Data = global.LighthouseData;
            if (!Data) return { text, modified: false };
            const P = MathLib.patterns();
            let modified = false;
            let newText = text.replace(new RegExp(`(^|\\s)([\\d,.]+)\\s*°?(${P.unitKeys})(?=\\s|$|[.,])`, 'gi'), (m, s, v, u) => {
                const conv = MathLib.inSystem(u, targetUnitSystem) ? null : MathLib.convertUnit(MathLib.parseLocaleNumber(v), u);
                if (!conv) return m;
                modified = true;
                return `${s}${conv.value.toFixed(2)} ${conv.target}`;
            });
            const currRegex = new RegExp(`(^|\\s)([\\d,.]+)\\s*(${P.currencyKeys})|(^|\\s)(${P.currencyKeys})\\s*([\\d,.]+)`, 'gi');
            for (const m of [...newText.matchAll(currRegex)]) {
                const v = m[2] || m[6], k = (m[3] || m[5]).toUpperCase(), b = Data.CURRENCY_MAP[k];
                if (!b || b === targetCurrency) continue;
                const r = await rateFetcher(b, targetCurrency);
                const amount = MathLib.parseLocaleNumber(v, b);
                if (r && Number.isFinite(amount)) { modified = true; newText = newText.replace(m[0], `${m[1] || m[4] || ''}${(amount * r).toFixed(2)} ${targetCurrency}`); }
            }
            return { text: newText, modified };
        }
    };
    global.LighthouseMath = MathLib;
})(typeof self !== 'undefined' ? self : window);
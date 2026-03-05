/**
 * Lighthouse - Math & Conversions
 * Handles safe calculation and currency/unit conversions.
 */
(function(global) {

    const MathLib = {
        
        /**
         * Safe Math Evaluator
         * Uses a restricted character set to prevent code execution.
         */
        safeCalculate: (expr) => {
            if (!expr || typeof expr !== 'string') return null;
            
            // Remove spaces and validate characters
            const clean = expr.replace(/\s+/g, '');
            if (!/^[\d+\-*/.()]+$/.test(clean)) return null;
            
            try {
                // eslint-disable-next-line no-new-func
                const res = new Function(`return (${clean})`)();
                return isFinite(res) ? res : null;
            } catch (e) {
                return null;
            }
        },

        /**
         * Parse Number from Localized String
         * Handles "1,234.56" vs "1.234,56"
         */
        parseLocaleNumber: (stringNumber) => {
            const clean = stringNumber.replace(/[^0-9,.-]/g, '');
            // Simple heuristic: if last separator is comma, it's decimal
            if (clean.indexOf(',') > clean.indexOf('.')) {
                return parseFloat(clean.replace(/\./g, '').replace(',', '.'));
            }
            return parseFloat(clean.replace(/,/g, ''));
        },

        /**
         * Fetch Currency Rate
         * Uses a public API (or mock fallback)
         */
        fetchRate: async (base, target) => {
            if (base === target) return 1;
            try {
                // Using a free API (e.g., Frankfurter)
                const res = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=${target}`);
                if (!res.ok) throw new Error('Network response was not ok');
                const data = await res.json();
                return data.rates[target];
            } catch (e) {
                console.warn('[Lighthouse] Currency fetch failed:', e);
                return null;
            }
        }
    };

    global.LighthouseMath = MathLib;

})(typeof self !== 'undefined' ? self : window);

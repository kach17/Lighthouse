/**
 * Lighthouse - Language
 *
 * Decides, once per selection and entirely on-device, whether the selected text is in a
 * language the user reads. Translate is offered only for text that is foreign to them.
 * Built on what the browser already knows about languages, scripts and words (Intl):
 *
 *   1. Only words count: numbers, prices, units, dates, links and emails are set aside.
 *   2. Letters mostly outside every script the user reads: foreign for certain.
 *   3. Chrome's detector: no language found is not foreign; a reliable result is compared
 *      with every language the user reads; if unsure, the surrounding paragraph decides.
 *   4. Still unsure, or no answer in time: foreign (better an extra button than a missing one).
 *
 * Nothing leaves the device. Results are cached.
 */
(function (global) {
    const TIME_LIMIT = 50;        // ms: the bar never waits longer than this
    const CONTEXT_CHARS = 1000;   // surrounding text used when the selection alone is too short
    const PASSAGE_WORDS = 20;     // longer selections are judged on their own
    const cache = new Map();

    // Languages known by more than one code, so the detector and the browser agree
    const ALIASES = { nb: 'no', nn: 'no', iw: 'he', in: 'id', tl: 'fil', jw: 'jv', mo: 'ro' };
    const base = (code) => { const b = (code || '').toLowerCase().split(/[-_]/)[0]; return ALIASES[b] || b; };

    // Script codes that stand for several Unicode scripts
    const COMBINED = { Jpan: ['Hani', 'Hira', 'Kana'], Kore: ['Hang', 'Hani'], Hans: ['Hani'], Hant: ['Hani'] };
    const words = global.LighthouseUtils.segmenter('word');

    // Every language the user reads: the browser's list plus Lighthouse's language setting
    function userLanguages() {
        const langs = new Set((navigator.languages || [navigator.language]).map(base));
        const setting = global.LighthouseState && global.LighthouseState.get('standards', null);
        if (setting && setting.language) langs.add(base(setting.language));
        langs.delete('');
        return langs;
    }

    // Letters in any script those languages are written in (from Intl, for every language)
    function readableLetters(langs) {
        const scripts = new Set();
        langs.forEach(lang => {
            let script = 'Latn';
            try { script = new Intl.Locale(lang).maximize().script || 'Latn'; } catch (e) { /* unknown code */ }
            (COMBINED[script] || [script]).forEach(s => scripts.add(s));
        });
        return new RegExp(`[${[...scripts].map(s => `\\p{Script=${s}}`).join('')}]`, 'gu');
    }

    /**
     * Only the words of a selection: Intl.Segmenter finds words in every language (with or
     * without spaces); numbers and the short words written next to them (CHF 2,500 · 5 km ·
     * 3 PM · 2024年5月) are set aside, as are links and email addresses.
     */
    function wordsOnly(text) {
        const cleaned = text.replace(/\S+@\S+\.\S+/g, ' ').replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
            .replace(/(\p{L})\.(?=\p{L})/gu, '$1');   // abbreviations (د.إ, U.S.) as one word, whatever the ICU version
        const list = [...words.segment(cleaned)].filter(s => s.isWordLike).map(s => s.segment);
        const numeric = list.map(w => /\p{Nd}/u.test(w));
        return list.filter((w, i) => !numeric[i] && !((numeric[i - 1] || numeric[i + 1]) && [...w].length <= 3)).join(' ');
    }

    // Chrome's built-in detector: { language, reliable }, null when no language is found.
    // Memoized, so every feature asking about the same text shares one answer.
    const detections = new Map();
    function detect(text) {
        if (detections.has(text)) return detections.get(text);
        const pending = detectNow(text);
        detections.set(text, pending);
        if (detections.size > 30) detections.delete(detections.keys().next().value);
        return pending;
    }
    function detectNow(text) {
        return new Promise((resolve) => {
            if (!(global.chrome && chrome.i18n && chrome.i18n.detectLanguage)) return resolve(undefined);
            chrome.i18n.detectLanguage(text, (result) => {
                const top = (result && result.languages || []).filter(l => l.language && l.language !== 'und')
                    .sort((a, b) => b.percentage - a.percentage)[0];
                resolve(top ? { language: base(top.language), reliable: !!result.isReliable } : null);
            });
        });
    }

    // The element around the selection
    function selectionElement() {
        const sel = global.getSelection && global.getSelection();
        const node = sel && sel.anchorNode;
        return node && (node.nodeType === 3 ? node.parentElement : node);
    }

    function surroundingText() {
        const el = selectionElement();
        const block = el && el.closest && el.closest('p, li, td, th, blockquote, article, section, div');
        return block ? (block.innerText || block.textContent || '').slice(0, CONTEXT_CHARS) : '';
    }

    // The language declared for the selection: its nearest lang attribute, else the page's
    function declaredLanguage() {
        const el = selectionElement();
        const marked = el && el.closest && el.closest('[lang]');
        return (marked && marked.getAttribute('lang')) || pageLanguage();
    }

    // { foreign: true | false | null, language, reliable }. Reliable: the detector was sure (of the text or
    // its paragraph), not a guess or the page's declared language. Foreign needs evidence (another script, a confident
    // detection, a declared language the user doesn't read); an unsure guess only counts for the user's.
    async function decide(text, around) {
        const langs = userLanguages();
        const letters = (text.match(/\p{L}/gu) || []).length;
        const readable = (text.match(readableLetters(langs)) || []).length;
        // A short selection is judged by its paragraph: a few words alone mislead the detector, even when
        // it claims to be sure (English as Malay). Its own guess still decides when the paragraph can't,
        // but is never called reliable.
        const short = text.split(/\s+/).length <= PASSAGE_WORDS;
        const context = around.length > text.length ? around : '';
        if (readable < letters / 2) {   // another writing system: foreign for certain, named when the detector is
            const named = await detect(context || text);   // sure, of a language written in the selection's letters
            const fits = named && (text.match(readableLetters(new Set([named.language]))) || []).length >= letters / 2;
            return { foreign: true, language: fits ? named.language : null, reliable: !!(fits && named.reliable && (context || !short)) };
        }

        const found = await detect(text);
        if (found === undefined) return { foreign: null, language: null };         // no detector available
        if (found === null) return { foreign: false, language: null };             // no language: codes, IDs
        const settles = (f) => f && (f.reliable || langs.has(f.language));
        const ctxFound = context ? await detect(context) : null;
        if (ctxFound && ctxFound.reliable) return { foreign: !langs.has(ctxFound.language), language: ctxFound.language, reliable: true };
        if (settles(found)) return { foreign: !langs.has(found.language), language: found.language, reliable: found.reliable && !short };
        if (settles(ctxFound)) return { foreign: !langs.has(ctxFound.language), language: ctxFound.language, reliable: false };
        const declared = base(declaredLanguage());                                  // still unsure: what the page says
        if (declared) return { foreign: !langs.has(declared), language: declared, reliable: false };
        return { foreign: null, language: null };                                   // unknown: offer both
    }

    // Undetected text the user reads: the page's language if read, else the setting, else the browser's
    function readerLanguage() {
        const langs = userLanguages(), page = base(pageLanguage());
        const setting = base(((global.LighthouseState && global.LighthouseState.get('standards', null)) || {}).language);
        return (langs.has(page) && page) || setting || langs.values().next().value || null;
    }

    /** { foreign, language } for a selection, from one check */
    function inspect(ctx) {
        const raw = (ctx && ctx.text || '').trim();
        const none = { foreign: false, language: null };
        if (!raw || ctx.isLink || (global.LighthouseUtils && global.LighthouseUtils.findLink(raw))) return Promise.resolve(none);
        const text = wordsOnly(raw);
        if (!/\p{L}/u.test(text)) return Promise.resolve(none);              // nothing word-like left

        // The paragraph is part of the cache key when it can influence the answer
        const around = text.split(/\s+/).length > PASSAGE_WORDS ? '' : ctx.isForm && ctx.element ? ctx.element.value.slice(0, CONTEXT_CHARS) : surroundingText();   // a field: its own text
        const key = `${text}\u0000${around}`;
        if (!cache.has(key)) {
            cache.set(key, decide(text, wordsOnly(around)).catch(() => ({ foreign: null, language: null })));   // the paragraph's words too: no numbers, codes or links
            if (cache.size > 30) cache.delete(cache.keys().next().value);
        }
        const unknown = { foreign: null, language: null };
        return Promise.race([cache.get(key), new Promise(r => setTimeout(() => r(unknown), TIME_LIMIT))])
            .then(r => (r.foreign !== true && !r.language) ? { foreign: r.foreign, language: readerLanguage(), reliable: false } : { ...r, reliable: !!r.reliable });
    }



    /** The language a text is written in (e.g. for reading it aloud), or null when unknown */
    async function languageOf(text) {
        const found = await detect((text || '').trim());
        return found && found.reliable ? found.language : null;
    }

    /** The language the page declares (<html lang>), or '' */
    function pageLanguage() {
        return (document.documentElement && document.documentElement.lang || '').trim();
    }

    global.LighthouseLanguage = { inspect, languageOf, userLanguages, pageLanguage };
})(window);
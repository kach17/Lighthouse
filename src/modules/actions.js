/**
 * Lighthouse - Action Definitions
 * Classified into: 'selection', 'input', 'smart', 'link'
 */
(function(global) {

    const Utils = global.LighthouseUtils;
    const MathLib = global.LighthouseMath;
    const Data = global.LighthouseData;
    // Voices load in the background the first time they are asked for: asked now, so Read aloud can tell
    if (global.speechSynthesis) global.speechSynthesis.getVoices();
    // The user's settings, as every action reads them (State holds only valid ones)
    const setting = (key) => global.LighthouseState.get(key);
    const userLanguage = () => setting('standards').language;
    const userCurrency = () => setting('standards').currency;
    // The language a selection is read in, as a base code ('de'): its own if known, else the user's
    const baseLanguage = (ctx) => Data.baseLanguage(ctx.language || userLanguage());
    const buildUrl = (template, text) => template.replace('%s', encodeURIComponent(text));


    // --- DATES ---
    // Each token gets a one-character class (digits by length 1-4/9, separators as themselves,
    // M month, A am/pm, Y O E CJK marks, w/W short/other word, X other; a space = apart),
    // so date formats match as regular expressions over that shape.
    function dateLanguages() {
        const Lang = global.LighthouseLanguage;
        const langs = new Set(Lang ? [...Lang.userLanguages(), Data.baseLanguage(Lang.pageLanguage())] : []);
        langs.add('en');
        langs.delete('');
        return [...langs].sort();
    }

    function lookupName(map, word) {
        if (map.has(word)) return map.get(word);
        if (word.length < 3) return null;
        // Longer abbreviations of a full name ("sept", "thur"): only if they point to one month/day
        let hit = null;
        for (const [name, value] of map) {
            if (value.short || !name.startsWith(word)) continue;
            const id = value.m !== undefined ? value.m : value.day;
            if (hit && (hit.m !== undefined ? hit.m : hit.day) !== id) return null;
            hit = value;
        }
        return hit && { ...hit, short: true };
    }

    function tokenizeDate(text, vocab) {
        const Data = global.LighthouseData;
        const MARK = { y: 'Y', m: 'O', d: 'E' };
        const tokens = [];
        let gap = false;
        const push = (t, v, raw) => {
            let c = t === 'S' ? v : t === 'X' ? 'X' : '';
            if (t === 'N') c = v.length <= 4 ? String(v.length) : '9';
            let month = null;
            if (t === 'W') {
                month = lookupName(vocab.months, v);
                c = month ? 'M' : /^[ap]m$/.test(v) ? 'A' : MARK[Data.CJK_DATE_MARKS[raw]] || (v.length <= 3 ? 'w' : 'W');
            }
            tokens.push({ t, v, raw, gap, c, month });
            gap = false;
        };
        const norm = text
            .replace(/(?<!\p{L})([aApP])\.\s?[mM]\.(?!\p{L})/gu, '$1m')   // a.m. → am
            .replace(/(\p{L})['’-](?=\p{L})/gu, '$1 ');                    // aujourd’hui, après-demain → words
        for (const m of norm.matchAll(/(\d+)|(\p{L}+)|([./\-:,])|(\s+)|(.)/gu)) {
            if (m[4]) { gap = true; continue; }
            if (m[1]) { push('N', m[1]); continue; }
            if (m[3]) { push('S', m[3]); continue; }
            if (m[5]) {
                if (/\p{N}/u.test(m[5])) return null;   // ², ½: numbers this parser can't place
                push('X', m[5]);
                continue;
            }
            const word = Data.foldText(m[2]);
            const known = vocab.months.has(word) || vocab.weekdays.has(word) || vocab.relative.has(word);
            if (!known && Data.UNSPACED_SCRIPTS.test(m[2])) {
                for (const seg of Utils.segmenter('word').segment(m[2])) push('W', Data.foldText(seg.segment), seg.segment);
            } else {
                push('W', word, m[2]);
            }
        }
        return tokens;
    }

    const validDate = (y, m, d) => {
        const dt = new Date(y, m, d);
        return y >= 1900 && y <= 2200 && dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
    };

    // Tried in order at each token; never inside a longer dotted number (IPs, versions)
    const NOT_CHAINED = String.raw`(?<![0-9][./:-])`;
    const DATE_PATTERNS = [
        ['cjk', /4 ?Y ?[12] ?O ?[12] ?E|[12] ?O ?[12] ?E/y],                                  // 2026年12月31日 · 12월 25일
        ['numeric', new RegExp(NOT_CHAINED + String.raw`[124]([./-])[12]\1\d(?![./:-][0-9])`, 'y')],   // 31.12.2026 · 2026-12-31
        ['dayDot', new RegExp(NOT_CHAINED + String.raw`[12]\.[12]\.(?![0-9])`, 'y')],                   // 24.12.
        ['short', new RegExp(NOT_CHAINED + String.raw`[12][./][12](?![./:-][0-9])`, 'y')],              // 3/4 (needs other evidence)
        ['time', new RegExp(NOT_CHAINED + String.raw`[12]:2(?::[12])?(?: ?A)?`, 'y')],                  // 17:30 · 9:30 pm
        ['ampm', new RegExp(NOT_CHAINED + String.raw`[12] ?A`, 'y')],                                   // 5pm
        ['dayName', new RegExp(NOT_CHAINED + String.raw`[12]\.?w?(?: ?w(?= ?M))? ?M\.?(?:(?: ?,)?(?: ?w)? ?4)?`, 'y')],   // 5. März · 3rd of May · 15 de marzo de 2027
        ['nameDay', /M\.? ?[12](?![./:-][0-9])w?(?:(?: ?,)? ?4)?/y],                          // Dec 12th, 2026
    ];

    // What a matched pattern means; false = not a match after all, null = not a date at all
    function readDatePattern(kind, ts) {
        const nums = ts.filter(x => x.t === 'N').map(x => x.v);
        const month = ts.find(x => x.c === 'M');
        const year = nums.find(n => n.length === 4);
        switch (kind) {
            case 'cjk':
                return { date: nums.length === 3 ? { y: +nums[0], a: +nums[2], b: +nums[1], order: 'DMY', strong: true } : { a: +nums[1], b: +nums[0], order: 'DMY', strong: true } };
            case 'numeric': {
                const [a, b, c] = nums, sep = ts[1].v;
                if (a.length === 4 && c.length <= 2) return { date: { y: +a, a: +c, b: +b, order: 'DMY', strong: true } };
                if (a.length <= 2 && (c.length === 2 || c.length === 4)) return { date: { y: c.length === 2 ? 2000 + +c : +c, a: +a, b: +b, order: sep === '.' ? 'DMY' : 'ambiguous', strong: true } };
                return null;
            }
            case 'dayDot': return { date: { a: +nums[0], b: +nums[1], order: 'DMY', strong: true } };
            case 'short': return { date: { a: +nums[0], b: +nums[1], order: ts[1].v === '.' ? 'DMY' : 'ambiguous', strong: false } };
            case 'time':
            case 'ampm': {
                const ampm = ts.find(x => x.c === 'A');
                return { time: { h: +nums[0], min: kind === 'time' ? +nums[1] : 0, ampm: ampm ? ampm.v : null, strong: !!ampm || nums[0].length === 2 } };
            }
            case 'dayName': {
                // A connecting word ("de", "of") only before a full month name ("5 mar" alone is fine)
                const connector = ts.slice(1, ts.indexOf(month)).some(x => x.c === 'w' && x.gap);
                if (connector && month.month.short) return false;
                return { date: { y: year && +year, a: +nums[0], b: month.month.m + 1, order: 'DMY', strong: true } };
            }
            case 'nameDay': return { date: { y: year && +year, a: +nums[0], b: month.month.m + 1, order: 'DMY', strong: true } };
        }
    }

    function parseDate(text, ctx) {
        const t = (text || '').trim();
        if (t.length < 2 || t.length > 50) return null;
        const hasDigit = ctx ? ctx.hasDigit : /\d/.test(t);
        const words = ctx ? ctx.wordCount : t.split(/\s+/).length;
        if (words > 7 || (!hasDigit && words > 3)) return null;

        const vocab = global.LighthouseData.getDateVocabulary(dateLanguages());
        const tk = tokenizeDate(t, vocab);
        if (!tk) return null;

        // The shape string, and which token each of its characters belongs to (-1: a gap)
        let shape = '';
        const at = [];
        tk.forEach((x, i) => { if (x.gap && i) { shape += ' '; at.push(-1); } shape += x.c; at.push(i); });

        const used = new Set();
        const take = (a, b) => { for (let k = a; k <= b; k++) used.add(k); };
        const W = (i) => tk[i] && tk[i].t === 'W' && !used.has(i);
        const S = (i, chars) => tk[i] && tk[i].t === 'S' && chars.includes(tk[i].v);
        const tight = (i) => tk[i] && !tk[i].gap;
        const dates = [], times = [];
        for (let p = 0; p < shape.length; p++) {
            if (at[p] < 0 || used.has(at[p])) continue;
            for (const [kind, re] of DATE_PATTERNS) {
                re.lastIndex = p;
                const m = re.exec(shape);
                if (!m) continue;
                const span = at.slice(p, p + m[0].length).filter(i => i >= 0);
                if (span.some(i => used.has(i))) continue;
                const found = readDatePattern(kind, span.map(i => tk[i]));
                if (found === null) return null;
                if (found === false) continue;
                if (found.date) dates.push(found.date);
                if (found.time) times.push(found.time);
                span.forEach(i => used.add(i));
                p += m[0].length - 1;
                break;
            }
        }

        // Words: today / tomorrow / the day after (up to three words), then weekday names
        let relative = null, weekday = null;
        for (let i = 0; i < tk.length && relative === null; i++) {
            for (let len = 3; len >= 1; len--) {
                const run = tk.slice(i, i + len);
                if (run.length < len || !run.every((x, k) => x.t === 'W' && !used.has(i + k))) continue;
                const phrase = run.map(x => x.v).join(' ');
                if (vocab.relative.has(phrase)) { relative = vocab.relative.get(phrase); take(i, i + len - 1); break; }
            }
        }
        for (let i = 0; i < tk.length && !weekday; i++) {
            if (!W(i)) continue;
            const wd = lookupName(vocab.weekdays, tk[i].v);
            if (!wd) continue;
            const raw = tk[i].raw || '';
            const marked = raw[0] !== raw[0].toLowerCase() || (S(i + 1, '.') && tight(i + 1));   // "Sat" or "sat." but not "sat"
            weekday = { ...wd, tiny: tk[i].v.length <= 2, marked };
            take(i, i);
        }

        // Anything numeric left over means this isn't (only) a date: IPs, versions, fractions, π²/6
        if (tk.some((x, i) => x.t === 'N' && !used.has(i))) return null;
        if (dates.length > 1 || times.length > 1) return null;

        let time = times[0] || null;
        if (time) {
            let h = time.h;
            if (time.ampm) {
                if (h < 1 || h > 12) return null;
                if (time.ampm === 'pm' && h < 12) h += 12;
                if (time.ampm === 'am' && h === 12) h = 0;
            }
            if (h > 23 || time.min > 59) return null;
            time = { h, min: time.min, strong: time.strong };
        }

        let date = dates[0] || null;
        const hasTimeSupport = time && time.strong;
        if (weekday && (weekday.tiny || weekday.short) && !weekday.marked) weekday = null;
        if (weekday && weekday.tiny && !date && !time) weekday = null;
        if (date && !date.strong && !(weekday || relative !== null || hasTimeSupport)) date = null;
        if (!date && relative === null && !weekday && !hasTimeSupport) return null;

        // Resolve the day
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const resolve = (d, m, y) => {   // m is 1-based
            let yy = y !== undefined ? y : today.getFullYear();
            if (!validDate(yy, m - 1, d)) return null;
            if (y === undefined && new Date(yy, m - 1, d) < today) yy += 1;
            return validDate(yy, m - 1, d) ? new Date(yy, m - 1, d) : null;
        };

        let day = null, alt = null;
        if (date) {
            let { a, b } = date;           // a = day, b = month unless the order says otherwise
            if (date.order === 'ambiguous') {
                if (a > 12 && b > 12) return null;
                if (a <= 12 && b <= 12) {
                    const dayFirst = (ctx && ctx.tools ? ctx.tools.dateOrder() : 'DMY') === 'DMY';
                    if (a !== b) alt = dayFirst ? resolve(b, a, date.y) : resolve(a, b, date.y);
                    if (!dayFirst) [a, b] = [b, a];
                } else if (b > 12) {
                    [a, b] = [b, a];
                }
            }
            day = resolve(a, b, date.y);
            if (!day) { day = alt; alt = null; }
            if (!day) return null;
            // A weekday next to the date settles which reading was meant ("Fri 10/2")
            if (alt && weekday) {
                if (alt.getDay() === weekday.day && day.getDay() !== weekday.day) day = alt;
                if (day.getDay() === weekday.day) alt = null;
            }
        } else if (relative !== null) {
            day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + relative);
        } else if (weekday) {
            day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (weekday.day - today.getDay() + 7) % 7);
        } else {
            // Only a time: today, or tomorrow if it has already passed
            day = new Date(today);
            if (time.h * 60 + time.min <= now.getHours() * 60 + now.getMinutes()) day.setDate(day.getDate() + 1);
        }

        const withTime = (d) => d && (time ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), time.h, time.min) : d);
        return { target: withTime(day), alt: withTime(alt), hasDate: !!(date || relative !== null || weekday), hasTime: !!time };
    }

    // A parse of the selection, made once per selection (condition, label, preview and info share it)
    const getParsed = (ctx, key, parse) => {
        const cacheKey = `_parsed_${key}`;
        if (ctx[cacheKey] === undefined) ctx[cacheKey] = parse(ctx);
        return ctx[cacheKey];
    };

    // --- STANDARD ACTION DEFINITIONS ---
    let reading = null;   // reading aloud in progress (Read aloud)
    const RATES = [0.75, 1, 1.25, 1.5];
    // The reading bar's buttons: Pause (pressed while paused), Speed (a click: the next one; its menu: all of them), Stop
    const READING_BUTTONS = [
        { id: 'reading-pause', label: 'Pause', icon: 'pause', keepOpen: true, isActive: () => !!reading && reading.paused, execute: () => { reading.toggle(); return { success: true }; } },
        { id: 'reading-speed', label: 'Speed', icon: 'speed', keepOpen: true, info: () => reading && `Reads at ${reading.rate}\u00d7`,
            execute: () => { reading.setRate(RATES[(RATES.indexOf(reading.rate) + 1) % RATES.length]); return { success: true }; },
            preview: () => reading && { live: true, items: RATES.map(r => ({ label: `${r}\u00d7`, textOnly: true, current: r === reading.rate, info: `Reads at ${r}\u00d7`, keepOpen: true, onClick: () => reading.setRate(r) })) } },
        { id: 'reading-stop', label: 'Stop', icon: 'stop', execute: () => { if (reading) reading.stop(); return { success: true, message: 'Stopped reading' }; } }
    ];

    const ACTIONS = [
        // --- SELECTION ACTIONS ---
        {
            id: 'copy',
            label: 'Copy',
            category: 'selection',
            icon: 'copy',
            condition: (ctx) => ctx.hasText,
            execute: (ctx, tools) => { 
                tools.copy(ctx.text); 
                return { success: true, message: 'Copied' };
            }
        },
        {
            id: 'stack',
            label: 'Collect',
            category: 'selection',
            icon: 'stack',
            condition: (ctx) => ctx.hasText,
            execute: async (ctx, tools) => {
                const items = [...await tools.collection.get(), ctx.text];
                await tools.collection.set(items);
                return { success: true, message: `${items.length} collected` };
            },
            // What is collected (read fresh each time), to copy at once or clear
            preview: async (ctx, tools) => {
                const items = await tools.collection.get();
                if (!items.length) return { previewText: 'Nothing collected yet', live: true };
                return { live: true, previewText: `${items.length} collected`, items: [
                    { label: 'Copy all', icon: 'copy', onClick: () => { tools.copy(items.join('\n\n')); tools.toast('Copied'); } },
                    tools.collection.clearItem()
                ] };
            }
        },
        {
            id: 'search',
            label: 'Search',
            category: 'selection',
            icon: 'search',
            condition: (ctx) => ctx.hasText && !ctx.isLink,
            engines() { return setting('searchEngines').filter(e => e.enabled); },
            info() {
                const [engine] = this.engines();
                return engine ? `Search with ${engine.name}` : null;
            },
            execute(ctx) {
                const engines = this.engines();
                if(engines.length === 0) return { success: false, message: 'No search engines are on' };
                ctx.tools.open(buildUrl(engines[0].url, ctx.text));
                return { success: true };
            },
            preview(ctx) {
                const engines = this.engines();
                if (engines.length <= 1) return null; 
                return {
                    items: engines.slice(1).map(eng => ({
                        label: eng.name,
                        info: `Search with ${eng.name}`,
                        icon: eng.icon, 
                        iconUrl: eng.url, 
                        onClick: () => ctx.tools.open(buildUrl(eng.url, ctx.text))
                    }))
                };
            }
        },
        {
            id: 'translate',
            label: 'Translate',
            category: 'selection',
            icon: 'translate',
            MAX: 5000,   // the most Google Translate takes at once (its own site's limit too)
            translation(ctx, tools) { return ctx.text.length > this.MAX ? Promise.resolve(null) : tools.query('TRANSLATE', { text: ctx.text, targetLang: userLanguage() }); },
            // Only for text in a language the user doesn't read (decided on-device by language.js)
            condition: (ctx) => ctx.hasText && !ctx.isLink && ctx.foreign !== false,
            url: (ctx) => buildUrl(`https://translate.google.com/?sl=auto&tl=${userLanguage()}&text=%s&op=translate`, ctx.text),
            // The languages it was read as and translated into (from the preview's own request)
            async info(ctx, tools) {
                const res = await this.translation(ctx, tools);
                const from = res && res.sourceLang && Utils.languageName(res.sourceLang);
                const to = res && Utils.languageName(Data.baseLanguage(res.targetLang));
                return from && to && from !== to ? `${from} → ${to}` : null;
            },
            async preview(ctx, tools) {
                if (ctx.text.length > this.MAX) return { previewText: `Over ${this.MAX.toLocaleString()} characters: click to open Google Translate` };
                const res = await this.translation(ctx, tools);
                if (!res || !res.text) return { previewText: 'Translation unavailable' };
                if (res.sourceLang === Data.baseLanguage(userLanguage())) return { previewText: 'Already in your language' };
                return tools.textPreview(res.text);
            }
        },
        {
            id: 'dictionary',
            label: 'Define',
            category: 'selection',
            icon: 'dictionary',
            entry(ctx, tools) {
                return tools.query('DEFINE', { text: ctx.cleanText, wordLang: ctx.language, targetLang: userLanguage(),
                    readerLangs: [...global.LighthouseLanguage.userLanguages()] });
            },
            // One word in a language the user reads (Translate covers the rest)
            condition: (ctx) => ctx.hasText && ctx.wordCount === 1 && ctx.hasLetter && ctx.foreign !== true,
            url: (ctx) => buildUrl('https://www.google.com/search?q=define+%s', ctx.text),
            // Which language the word was read as ('Gift': German or English), and if the definition was translated
            async info(ctx, tools) {
                const res = await this.entry(ctx, tools);
                const as = res && res.definition && res.language && Utils.languageName(res.language);
                return as ? `${as} word${res.translated ? ' · definition translated' : ''}` : null;
            },
            async preview(ctx, tools) {
                const res = await this.entry(ctx, tools);
                if (!res) return { previewText: 'Definition unavailable' };
                const open = { label: 'Open in Wiktionary', icon: 'dictionary', onClick: () => ctx.tools.open(res.link) };
                if (!res.definition) return { previewText: 'No definition found', items: [open] };
                return tools.textPreview(res.definition, [open]);
            }
        },
        {
            id: 'wikipedia',
            label: 'Wiki',
            category: 'selection',
            icon: 'wikipedia',
            // A capitalised name of up to four words, on the page
            condition: (ctx) => ctx.hasText && !ctx.isLink && !ctx.isInput && ctx.wordCount >= 1 && ctx.wordCount <= 4 && /^\p{Lu}/u.test(ctx.text.trim()),
            article: (ctx) => ({ lang: baseLanguage(ctx), title: ctx.text.trim().replace(/\s+/g, '_') }),
            info: (ctx) => { const name = Utils.languageName(baseLanguage(ctx)); return name ? `${name} Wikipedia` : null; },
            url(ctx) { const { lang, title } = this.article(ctx); return buildUrl(`https://${lang}.wikipedia.org/wiki/%s`, title); },
            async preview(ctx, tools) {
                const data = await tools.query('WIKI_SUMMARY', this.article(ctx));
                if (!data || data.type === 'disambiguation' || data.type === 'not_found') return { previewText: 'Article not found' };
                return { node: Utils.mediaCard({ image: data.thumbnail?.source, title: data.title, desc: data.description, body: Utils.excerpt(data.extract || '', 140) }) };
            }
        },
        {
            id: 'speak',
            label: 'Read aloud',
            category: 'selection',
            icon: 'speak',
            // Shown only when the browser has a voice for the text's language (the voices installed, as
            // speechSynthesis lists them), so text is never read by a voice of another language, or not at all
            condition(ctx) { return ctx.hasText && !!this.voice(ctx); },
            lang: (ctx) => ctx.language || userLanguage(),
            // The voice: the reader's own variant of the language (fr-CA), else the language's most likely one
            // (Mandarin for zh, not Cantonese), else the browser's default for it
            voice(ctx) {
                if (!('speechSynthesis' in window)) return null;
                const lang = Data.baseLanguage(this.lang(ctx)), region = (code) => (code.split(/[-_]/)[1] || '').toUpperCase();
                const voices = window.speechSynthesis.getVoices().filter(v => Data.baseLanguage(v.lang) === lang);
                const own = (navigator.languages || []).find(l => Data.baseLanguage(l) === lang && region(l));
                let likely = null; try { likely = new Intl.Locale(lang).maximize().region; } catch (e) { /* unknown code */ }
                return voices.find(v => own && region(v.lang) === region(own)) || voices.find(v => region(v.lang) === likely)
                    || voices.find(v => v.default) || voices[0] || null;
            },
            info(ctx) { const name = Utils.languageName(this.lang(ctx)); return name ? `Reads in ${name}` : null; },
            // Sentence by sentence: a new speed starts at once, and long text isn't cut off. The text is tinted, the
            // sentence being read more strongly (found by the characters that aren't spaces, which the selection's
            // text and the page's share; where they differ, no sentence is painted). Pausing stops the sentence;
            // resuming reads it again. Its bar (READING_BUTTONS, at the text) shows whenever no other does, until it ends
            execute(ctx) {
                if (reading) reading.stop();   // a new Read aloud reads the new text
                const speech = window.speechSynthesis, voice = this.voice(ctx), field = ctx.snapshot.field, range = !field && ctx.snapshot.range;
                const announce = () => window.dispatchEvent(new CustomEvent('lighthouse:state')), State = global.LighthouseState;
                const paint = (name, r) => r ? CSS.highlights.set(name, Object.assign(new Highlight(r), { priority: name === 'lighthouse-sentence' ? 1 : 0 })) : CSS.highlights.delete(name);
                const pos = [];   // [node, offset] of each character of the range that isn't a space
                if (range) for (let w = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT), n = w.currentNode.nodeType === 3 ? w.currentNode : w.nextNode(); n; n = w.nextNode())
                    if (range.intersectsNode(n)) for (let o = n === range.startContainer ? range.startOffset : 0; o < (n === range.endContainer ? range.endOffset : n.length); o++) if (/\S/.test(n.data[o])) pos.push([n, o]);
                const exact = pos.map(([n, o]) => n.data[o]).join('') === ctx.text.replace(/\s+/g, '');
                const sentences = [...Utils.segmenter('sentence').segment(ctx.text)].map(s => s.segment);
                let i = 0, at = 0, run = 0;
                const say = () => {
                    const my = ++run, s = sentences[i];
                    speech.cancel();
                    if (s === undefined) return reading.stop();
                    const len = s.replace(/\s+/g, '').length, u = Object.assign(new SpeechSynthesisUtterance(s), { voice, lang: voice.lang, rate: reading.rate });
                    u.onstart = () => { if (my === run && exact && len) { const r = document.createRange(); r.setStart(...pos[at]); r.setEnd(pos[at + len - 1][0], pos[at + len - 1][1] + 1); paint('lighthouse-sentence', r); } };
                    u.onend = () => { if (my === run) { at += len; i++; say(); } };
                    setTimeout(() => { if (my === run) speech.speak(u); });   // speaking right after cancel() can be dropped
                };
                reading = { rate: 1, paused: false, ctx: { isLink: true, reading: true, text: ctx.text, element: range ? range.cloneRange() : field, hasText: true, buttons: READING_BUTTONS, facts: () => reading ? [`Reads at ${reading.rate}\u00d7`] : [] },
                    toggle() { this.paused = !this.paused; if (this.paused) { ++run; speech.cancel(); } else say(); announce(); },
                    setRate(r) { this.rate = r; if (!this.paused) say(); },
                    stop() { ++run; speech.cancel(); paint('lighthouse-sentence'); paint('lighthouse-reading'); reading = null; announce(); State.send('reading'); } };
                State.send('reading', { ctx: reading.ctx });
                if (range) paint('lighthouse-reading', range.cloneRange());
                say();
                announce();
                return { success: true };
            }
        },
        {
            id: 'marker',
            label: 'Highlight',
            category: 'selection',
            icon: 'highlighter',
            condition: (ctx) => ctx.hasText && !ctx.isInput && !ctx.isLink,
            execute: (ctx) => {
                if (window.LighthouseMarkers) window.LighthouseMarkers.markTextSelection(ctx.text, setting('highlightColor'));
                return { success: true };   // the highlight itself is the feedback
            },
            info: () => `Highlights in ${setting('highlightColor')}`,   // the color a click uses
            // Hover: the colors; the one picked becomes the default
            preview: (ctx) => ({
                items: Data.HIGHLIGHT_COLORS.map(color => ({
                    label: color[0].toUpperCase() + color.slice(1), color, current: color === (setting('highlightColor')),
                    info: `Highlights in ${color}`,
                    onClick: () => { global.LighthouseState.set('highlightColor', color); window.LighthouseMarkers.markTextSelection(ctx.text, color); }
                }))
            })
        },
        {
            id: 'expand',
            label: 'Expand',
            category: 'selection',
            icon: 'expand',
            condition: (ctx) => ctx.hasText && !ctx.isLink,
            keepOpen: true,
            execute: (ctx, tools) => { 
                tools.expandSelection();
                return { success: true };
            }
        },
        {
            id: 'qr',
            label: 'QR',
            category: 'selection',
            icon: 'qr',
            condition: (ctx) => ctx.text.length > 0 && ctx.text.length <= 1000,
            // Made by the extension (background.js): the text never leaves the browser
            async preview(ctx, tools) {
                const src = await tools.query('QR', { text: ctx.text });
                return src ? { node: Utils.create('img', { className: 'qr-code', attrs: { src, alt: 'QR code' } }) } : { previewText: 'Too long for a QR code' };
            },
            async execute(ctx, tools) {   // the code as an image, to paste anywhere
                const src = await tools.query('QR', { text: ctx.text });
                if (!src) return { success: false, message: 'Too long for a QR code' };
                const png = new Blob([Uint8Array.from(atob(src.split(',')[1]), c => c.charCodeAt(0))], { type: 'image/png' });
                try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); return { success: true, message: 'QR code copied' }; }
                catch (e) { return { success: false, message: 'Couldn\u2019t copy the QR code' }; }
            }
        },

        // --- INPUT ACTIONS ---
        {
            id: 'cut',
            label: 'Cut',
            category: 'input',
            icon: 'cut',
            condition: (ctx) => ctx.isInput && ctx.hasText,
            execute: (ctx, tools) => { 
                ctx.element.focus();   // the copy reads the field's own selection
                tools.copySelection();
                tools.replace('');
                return { success: true };
            }
        },
        {
            id: 'paste',
            label: 'Paste',
            category: 'input',
            icon: 'paste',
            condition: (ctx) => ctx.isInput,
            // The clipboard text itself, as a quoted value
            dynamicLabel: async (ctx, tools) => {
                const text = (await tools.readClipboard()).replace(/\n/g, ' ').trim();
                return text ? { quote: Utils.excerpt(text, 120) } : null;
            },
            execute: async (ctx, tools) => {
                const text = await tools.readClipboard();
                if (!text) return { success: false, message: 'Clipboard empty' };
                tools.replace(text.trim());
                return { success: true };
            },
            // The clipboard, and anything collected with Collect (read fresh each time)
            preview: async (ctx, tools) => {
                const stack = await tools.collection.get();
                if (!stack.length) return null;   // the label already shows the clipboard
                const singleLine = !ctx.tools.surface.multiline;
                const flat = (s) => s.replace(/\s+/g, ' ').trim();
                const insert = (value) => tools.replace(value);
                return {
                    live: true,
                    items: [
                        ...stack.slice(-5).reverse().map(s => ({ label: Utils.excerpt(s, 30), textOnly: true, onClick: () => insert(singleLine ? flat(s) : s) })),
                        { label: `Paste all (${stack.length})`, icon: 'stack', onClick: () => insert(singleLine ? stack.map(flat).join(' ') : stack.join('\n\n')) },
                        tools.collection.clearItem()
                    ]
                };
            }
        },
        {
            id: 'delete',
            label: 'Delete',
            category: 'input',
            icon: 'backspace',
            condition: (ctx) => ctx.isInput && ctx.hasText,
            execute: (ctx, tools) => { tools.replace(''); return { success: true }; }
        },
        {
            id: 'clear',
            label: 'Clear all',
            category: 'input',
            icon: 'clear',
            condition: (ctx) => { const r = ctx.isInput && !ctx.hasText && ctx.tools.surface.read('all'); return !!r && !!(r.before + r.text + r.after); },
            keepOpen: true,   // emptied to be filled again: Paste stays where it was
            execute: (ctx, tools) => { tools.replace('', { span: 'all' }); return { success: true }; }
        },
        {
            id: 'case',
            label: 'Case',
            category: 'input',
            icon: 'case',
            // Case cycles UPPER -> lower -> Title -> UPPER
            nextCase(t) {
                if (t === t.toUpperCase()) return { name: 'lowercase', apply: (s) => s.toLowerCase() };
                if (t === t.toLowerCase()) return { name: 'Title Case', apply: (s) => s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.substring(1).toLowerCase()) };
                return { name: 'UPPERCASE', apply: (s) => s.toUpperCase() };
            },
            // Only text that has case (not numbers, symbols, or scripts without it, like Chinese)
            condition: (ctx) => ctx.hasText && ctx.isInput && ctx.text.toUpperCase() !== ctx.text.toLowerCase(),
            keepOpen: true,
            info(ctx) { return `Next: ${this.nextCase(ctx.text).name}`; },
            execute(ctx, tools) {
                tools.replace(this.nextCase(ctx.text).apply(ctx.text), { select: true });
                return { success: true };
            }
        },
        {
            id: 'spellcheck',
            label: 'Spelling',
            category: 'input',
            icon: 'spellcheck',
            check(win, ctx, tools) { return tools.query('SPELLCHECK', { text: win.text, language: ctx.language }); },
            // The selection plus the sentence around it, never more than this
            SPELL_MAX: 500,
            spellWindow(ctx) {
                const s = ctx.tools.surface;
                if (s.sharesContext) {
                    const r = s.read({ around: 'sentence' });
                    if (!r || !r.text || r.text.length > this.SPELL_MAX) return null;
                    const full = r.before + r.text + r.after;
                    if (full.length > this.SPELL_MAX) return { text: r.text, from: 0, to: r.text.length };   // sentence too long: the selection alone
                    return { text: full, from: r.before.length, to: r.before.length + r.text.length };
                }
                // Elsewhere: the selection only
                const text = ctx.text || '';
                return text && text.length <= this.SPELL_MAX ? { text, from: 0, to: text.length } : null;
            },
            // Any selected text in a text field, checked by LanguageTool with its sentence around it
            condition(ctx) {
                return ctx.canType && ctx.hasText && ctx.hasLetter && ctx.cleanText.length <= this.SPELL_MAX;
            },
            execute: () => ({ success: true, message: 'Hover for suggestions' }),
            // The language it was checked as (LanguageTool's answer, from the preview's own request)
            async info(ctx, tools) {
                const win = this.spellWindow(ctx);
                const res = win && await this.check(win, ctx, tools);
                const as = res && res.language && Utils.languageName(res.language, { region: true });   // British vs American spelling
                return as ? `Checked as ${as}` : null;
            },
            async preview(ctx, tools) {
                const win = this.spellWindow(ctx);
                if (!win) return null;
                const res = await this.check(win, ctx, tools);
                if (!res) return { previewText: 'Spelling check unavailable' };
                const issues = res.issues;
                // Only what lies inside the selection; the sentence is there for context
                const selected = win.text.slice(win.from, win.to);
                const inside = issues
                    .filter(i => i.replacements.length && i.offset >= win.from && i.offset + i.length <= win.to)
                    .map(i => ({ ...i, offset: i.offset - win.from }))
                    .sort((a, b) => a.offset - b.offset)
                    .filter((i, n, all) => n === 0 || i.offset >= all[n - 1].offset + all[n - 1].length);
                const credit = { label: 'Checked by LanguageTool', icon: 'link', onClick: () => ctx.tools.open('https://languagetool.org') };
                if (!inside.length) return { previewText: 'No issues found ✓', items: [credit] };
                const apply = (list) => [...list].sort((a, b) => b.offset - a.offset)
                    .reduce((out, i) => out.slice(0, i.offset) + i.replacements[0] + out.slice(i.offset + i.length), selected);
                const items = inside.slice(0, 5).map(i => ({
                    label: `${selected.substr(i.offset, i.length)} → ${i.replacements[0]}`,
                    textOnly: true,
                    keepOpen: inside.length > 1,   // one fix of several: the text stays selected, and the bar with the rest
                    onClick: () => tools.replace(apply([i]), { select: true })
                }));
                if (inside.length > 1) items.push({ label: `Fix all (${inside.length})`, icon: 'check', onClick: () => tools.replace(apply(inside)) });
                items.push(credit);
                return { items };
            }
        },

        // --- SMART ACTIONS ---
        {
            id: 'math',
            label: 'Calculate',
            category: 'smart',
            icon: 'math',
            // The result, as shown and copied ("40"), or null
            result: (ctx) => getParsed(ctx, 'math', () => { const r = ctx.text.length < 50 ? MathLib.safeCalculate(ctx.text) : null; return r === null ? null : String(Number(r.toFixed(4))); }),
            condition(ctx) { return !ctx.isLink && this.result(ctx) !== null; },
            dynamicLabel(ctx) { return `∑ ${this.result(ctx)}`; },
            execute(ctx, tools) {   // in a field the result replaces the calculation (tools.place, as every result does); else it is copied
                tools.place(this.result(ctx));
                return { success: true, message: `Result: ${this.result(ctx)}` };
            },
            preview(ctx, tools) {
                return { previewText: `= ${this.result(ctx)}`, isValue: true, items: [{ label: 'Copy', icon: 'copy', onClick: () => tools.copy(this.result(ctx)) }] };
            }
        },
        {
            id: 'currency',
            label: 'Convert',
            category: 'smart',
            icon: 'currency',
            // The first price in a short selection ("25 EUR", "€25", "1,500円"): { amount, base }, or null
            parse(text) {
                const found = text.length <= 50 && MathLib.findAmounts(text, userCurrency()).find(a => a.currency);
                return found ? { amount: found.value, base: found.currency } : null;
            },
            parsed(ctx) { return getParsed(ctx, 'currency', () => this.parse(ctx.text)); },
            // The selection in the user's currency: { amount, base, target, rate, asOf }, or null
            async converted(ctx, tools) {
                const parsed = this.parsed(ctx), target = userCurrency();
                const found = parsed && parsed.amount !== null && parsed.base !== target && await tools.rate(parsed.base, target);
                return found ? { ...parsed, target, ...found, value: MathLib.format(parsed.amount * found.rate, { currency: target }) } : null;
            },
            // When the rate is from: today the time, else the day
            rateAge(at) {
                const d = new Date(at), today = new Date().toDateString() === d.toDateString();
                return 'rate from ' + (today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' }));
            },
            condition(ctx) {
                const parsed = this.parsed(ctx);
                return parsed && parsed.base !== userCurrency();
            },
            async dynamicLabel(ctx, tools) {
                const c = await this.converted(ctx, tools);
                return c ? c.value : null;
            },
            // The rate it uses, and when it is from (rates are kept for a day)
            async info(ctx, tools) {
                const c = await this.converted(ctx, tools);
                return c && this.rateLine(c);
            },
            rateLine: (c) => `1 ${c.base} = ${c.rate.toLocaleString(undefined, { maximumSignificantDigits: 5 })} ${c.target}` + (c.asOf ? ` · ${ACTIONS.find(a => a.id === 'currency').rateAge(c.asOf)}` : ''),
            url: (ctx) => buildUrl('https://www.google.com/search?q=%s+convert', ctx.text),
            async preview(ctx, tools) {
                const parsed = this.parsed(ctx), c = await this.converted(ctx, tools);
                const label = c ? c.value : parsed && parsed.amount !== null && parsed.base !== userCurrency() ? 'Unavailable' : '...';
                return tools.buildCopyMenu(label, label, 'Copy', [tools.convertPageItem()]);
            }
        },
        {
            id: 'unit',
            label: 'Unit',
            category: 'smart',
            icon: 'unit',
            // A selection that is one measurement ("5 km", "5 км", "70 °F"): the conversion, or null
            parse(text) {
                const t = text.trim(), [found] = MathLib.findAmounts(t);
                const conv = found && found.unit && found.index === 0 && found.length === t.length && MathLib.convertUnit(found.value, found.unit);
                return conv ? { val: found.value, unitKey: found.unit, isMetric: conv.metric, result: MathLib.format(conv.value, { unit: conv.target }) } : null;
            },
            parsed(ctx) { return getParsed(ctx, 'unit', () => this.parse(ctx.cleanText)); },
            condition(ctx) {
                const parsed = this.parsed(ctx);
                if (!parsed) return false;
                const userPreference = setting('standards').units;
                return userPreference === 'metric' ? !parsed.isMetric : parsed.isMetric;
            },
            url: (ctx) => buildUrl('https://www.google.com/search?q=%s+conversion', ctx.cleanText),
            preview(ctx, tools) {
                const parsed = this.parsed(ctx);
                const result = parsed ? parsed.result : '...';
                return tools.buildCopyMenu(result, result, 'Copy', [tools.convertPageItem()]);
            }
        },
        {
            id: 'reminder',
            label: 'Remind',
            category: 'smart',
            icon: 'calendar',
            pad2(n) { return String(n).padStart(2, '0'); },
            ymd(d) { return `${d.getFullYear()}${this.pad2(d.getMonth() + 1)}${this.pad2(d.getDate())}`; },
            // Google Calendar, empty title: local time plus time zone; all-day by the local date
            calendarUrl(date, hasTime) {
                let dates;
                if (hasTime) {
                    const end = new Date(date.getTime() + 60 * 60 * 1000);
                    const hm = (d) => `${this.pad2(d.getHours())}${this.pad2(d.getMinutes())}00`;
                    dates = `${this.ymd(date)}T${hm(date)}/${this.ymd(end)}T${hm(end)}`;
                } else {
                    dates = `${this.ymd(date)}/${this.ymd(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1))}`;
                }
                let url = `https://calendar.google.com/calendar/render?action=TEMPLATE&dates=${dates}`;
                if (hasTime) {
                    try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (tz) url += `&ctz=${encodeURIComponent(tz)}`; } catch (e) { /* no zone */ }
                }
                return url;
            },
            // "Thu, 31 Dec 2026 · in 96 days" (year only when it isn't this year)
            describeDate(date, hasTime) {
                const lang = userLanguage();
                const now = new Date();
                const opts = { weekday: 'short', month: 'short', day: 'numeric' };
                if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
                if (hasTime) { opts.hour = 'numeric'; opts.minute = '2-digit'; }
                let label;
                try { label = date.toLocaleString(lang, opts); } catch (e) { label = date.toLocaleString(undefined, opts); }
                const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
                try { label += ' · ' + new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(days, 'day'); } catch (e) { /* no relative wording */ }
                return label;
            },
            // The date or time in the selection (the date library above)
            parsed(ctx) { return getParsed(ctx, 'reminder', () => parseDate(ctx.cleanText, ctx)); },
            condition(ctx) { return this.parsed(ctx) !== null; },
            url(ctx) { const parsed = this.parsed(ctx); return parsed && this.calendarUrl(parsed.target, parsed.hasTime); },
            preview(ctx) {
                const parsed = this.parsed(ctx);
                if (!parsed) return null;
                // When 03/04 could be read either way and nothing decided it, both are offered
                return {
                    items: [parsed.target, parsed.alt].filter(Boolean).map(date => ({
                        label: this.describeDate(date, parsed.hasTime),
                        textOnly: true,
                        onClick: () => ctx.tools.open(this.calendarUrl(date, parsed.hasTime))
                    }))
                };
            }
        },
        {
            id: 'json_format',
            label: 'Format JSON',
            category: 'smart',
            icon: 'code',
            // The selection as JSON (an object or array), or null
            json: (ctx) => getParsed(ctx, 'json', () => { const t = ctx.cleanText; if (t.length < 2 || !/^[{[]/.test(t)) return null; try { return JSON.parse(t); } catch (e) { return null; } }),
            condition(ctx) { return this.json(ctx) !== null; },
            execute(ctx, tools) {
                const pretty = JSON.stringify(this.json(ctx), null, 2);
                tools.place(pretty);
                return { success: true, message: 'JSON formatted' };
            },
            preview(ctx) {
                const obj = this.json(ctx);
                return { previewText: `Valid JSON (${Array.isArray(obj) ? obj.length + ' items' : Object.keys(obj).length + ' keys'})` };
            }
        },
        {
            id: 'base64_decode',
            label: 'Decode',
            category: 'smart',
            icon: 'lock',
            // The decoded text, only if it is readable (plain words like "Unix" decode to byte garbage), or null
            decoded: (ctx) => getParsed(ctx, 'base64', () => {
                const t = ctx.cleanText;
                if (t.length < 4 || t.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return null;
                try { const raw = atob(t); return /[\x00-\x08\x0E-\x1F]/.test(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, c => c.charCodeAt(0)))) ? null : raw; } catch (e) { return null; }
            }),
            condition(ctx) { return this.decoded(ctx) !== null; },
            execute(ctx, tools) {
                tools.place(this.decoded(ctx));
                return { success: true, message: 'Base64 decoded' };
            },
            preview(ctx, tools) { return tools.buildCopyMenu(this.decoded(ctx), `"${Utils.shorten(this.decoded(ctx), 20)}"`); }
        },
        {
            id: 'color_convert',
            label: 'Color',
            category: 'smart',
            icon: 'palette',
            // "#ff0000" or "rgb(255, 0, 0)": { original, converted }, or null
            // Explicit color syntax only (never a word like "red"), read by the browser itself: hex becomes rgb(),
            // rgb() and hsl() become hex (with its transparency, if any)
            parse(text) {
                const t = text.trim(), style = new Option().style;
                if (!/^(#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(rgba?|hsla?)\([^)]*\))$/i.test(t)) return null;
                style.color = t;
                const n = style.color.match(/[\d.]+/g);   // as the browser writes it: rgb(r, g, b) or rgba(r, g, b, a)
                if (!n) return null;
                const hex = '#' + [...n.slice(0, 3).map(Number), ...(n[3] !== undefined ? [Math.round(n[3] * 255)] : [])].map(v => v.toString(16).padStart(2, '0')).join('');
                return { original: t, converted: t.startsWith('#') ? style.color : hex };
            },
            parsed(ctx) { return getParsed(ctx, 'color', () => this.parse(ctx.text)); },
            condition(ctx) { return this.parsed(ctx) !== null; },
            execute(ctx, tools) {
                tools.place(this.parsed(ctx).converted);
                return { success: true, message: 'Color converted' };
            },
            preview(ctx, tools) {
                const parsed = this.parsed(ctx);
                if (!parsed) return null;
                const { original, converted } = parsed;
                const swatch = Utils.create('span', { className: 'lh-swatch' });
                swatch.style.setProperty('--swatch', original);
                const node = Utils.create('div', { className: 'lh-row', children: [swatch, Utils.create('span', { className: 'is-value', text: original })] });
                return tools.buildCopyMenu(converted || original, { node }, 'Copy converted');
            }
        }
    ];

    global.LighthouseActions = ACTIONS;

})(typeof self !== 'undefined' ? self : window);
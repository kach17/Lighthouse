/**
 * Lighthouse - Master Action Definitions (REFACTORED)
 * Classified into: 'selection', 'input', 'smart', 'link'
 */
(function(global) {

    const Utils = global.LighthouseUtils;
    const MathLib = global.LighthouseMath;
    const Data = global.LighthouseData;
    const Config = global.LighthouseConfig;

    const getSettings = () => (global.LighthouseState && global.LighthouseState.settings) ? global.LighthouseState.settings : (Config ? Config.defaults : {});
    const getStandards = () => getSettings().standards || {};
    // The user's preferences, as every action reads them
    const userLanguage = () => getStandards().language || 'en';
    const userCurrency = () => getStandards().currency || 'USD';

    // --- Shared Helpers ---




    const buildUrl = (template, text) => template.replace('%s', encodeURIComponent(text));


    // --- DATES ---
    // Each token gets a one-character class (digits by length 1-4/9, separators as themselves,
    // M month, A am/pm, Y O E CJK marks, w/W short/other word, X other; a space = apart),
    // so date formats match as regular expressions over that shape.
    function dateLanguages() {
        const Lang = global.LighthouseLanguage;
        const langs = new Set(Lang ? [...Lang.userLanguages(), Lang.pageLanguage().split('-')[0].toLowerCase()] : []);
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
                const copyStack = await ctx.tools.collection.get();
                copyStack.push(ctx.text);
                await ctx.tools.collection.set(copyStack);
                return { success: true, message: `${copyStack.length} collected` };
            },
            preview: async (ctx, tools) => {
                const copyStack = await ctx.tools.collection.get();
                if (copyStack.length === 0) return { previewText: 'Nothing collected yet', live: true };
                return {
                    type: 'menu',
                    live: true,
                    previewText: `${copyStack.length} collected`,
                    items: [
                        {
                            label: 'Copy all',
                            icon: 'copy',
                            onClick: () => {
                                tools.copy(copyStack.join('\n\n'));
                                tools.toast('Copied Stack!');
                            }
                        },
                        {
                            label: 'Clear',
                            icon: 'clear',
                            onClick: async () => {
                                await ctx.tools.collection.set([]);
                                tools.toast('Stack Cleared');
                            }
                        }
                    ]
                };
            }
        },
        {
            id: 'search',
            label: 'Search',
            category: 'selection',
            icon: 'search',
            condition: (ctx) => ctx.hasText && !ctx.isLink,
            engines() { return (getSettings().searchEngines || []).filter(e => e.enabled); },
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
                    type: 'menu',
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
            execute: (ctx) => {
                const tl = userLanguage();
                ctx.tools.open(buildUrl(`https://translate.google.com/?sl=auto&tl=${tl}&text=%s&op=translate`, ctx.text));
                return { success: true };
            },
            // The languages it was read as and translated into (from the preview's own request)
            async info(ctx, tools) {
                const res = await this.translation(ctx, tools);
                const from = res && res.sourceLang && Utils.languageName(res.sourceLang);
                const to = res && Utils.languageName(String(res.targetLang || '').split('-')[0]);
                return from && to && from !== to ? `${from} → ${to}` : null;
            },
            async preview(ctx, tools) {
                if (ctx.text.length > this.MAX) return { previewText: `Over ${this.MAX.toLocaleString()} characters: click to open Google Translate` };
                const res = await this.translation(ctx, tools);
                if (!res || !res.text) return { previewText: 'Translation unavailable' };
                const targetLang = userLanguage().split('-')[0];
                if (res.sourceLang === targetLang) {
                    return { previewText: 'Already in your language' };
                }
                return tools.textPreview(res.text);
            }
        },
        {
            id: 'dictionary',
            label: 'Define',
            category: 'selection',
            icon: 'dictionary',
            entry(ctx, tools) {
                const Lang = global.LighthouseLanguage;
                return tools.query('DEFINE', { text: ctx.cleanText, wordLang: ctx.language, targetLang: userLanguage(),
                    readerLangs: Lang && Lang.userLanguages ? [...Lang.userLanguages()] : [] });
            },
            // One word in a language the user reads (Translate covers the rest)
            condition: (ctx) => ctx.hasText && ctx.wordCount === 1 && ctx.hasLetter && ctx.foreign !== true,
            execute: (ctx) => {
                ctx.tools.open(buildUrl('https://www.google.com/search?q=define+%s', ctx.text));
                return { success: true };
            },
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
                if (!res.definition) return { type: 'menu', previewText: 'No definition found', items: [open] };
                return tools.textPreview(res.definition, [open]);
            }
        },
        {
            id: 'wikipedia',
            label: 'Wiki',
            category: 'selection',
            icon: 'wikipedia',
            condition: (ctx) => {
                if (!ctx.hasText || ctx.isLink || ctx.isInput) return false;
                if (ctx.wordCount < 1 || ctx.wordCount > 4) return false;
                return /^\p{Lu}/u.test(ctx.text.trim());
            },
            info: async (ctx) => {
                const name = Utils.languageName(String(ctx.language || userLanguage()).split('-')[0]);
                return name ? `${name} Wikipedia` : null;
            },
            execute: async (ctx) => {
                const lang = String(ctx.language || userLanguage()).split('-')[0];
                const title = ctx.text.trim().replace(/\s+/g, '_');
                ctx.tools.open(buildUrl(`https://${lang}.wikipedia.org/wiki/%s`, title));
                return { success: true };
            },
            preview: async (ctx, tools) => {
                const lang = String(ctx.language || userLanguage()).split('-')[0];
                const title = ctx.text.trim().replace(/\s+/g, '_');
                try {
                    const data = await tools.query('WIKI_SUMMARY', { lang, title });
                    if (!data) return { previewText: 'Article not found' };
                    if (data.type === 'disambiguation' || data.type === 'not_found') {
                        return { previewText: 'Article not found' };
                    }
                    let extract = data.extract || '';
                    extract = Utils.excerpt(extract, 140);
                    return { node: Utils.mediaCard({ image: data.thumbnail?.source, title: data.title, desc: data.description, body: extract }) };
                } catch (e) {
                    return { previewText: 'Error fetching Wiki' };
                }
            }
        },
        {
            id: 'speak',
            label: 'Read aloud',
            category: 'selection',
            icon: 'speak',
            condition: (ctx) => ctx.hasText && ('speechSynthesis' in window),
            keepOpen: true,
            isActive: () => window.speechSynthesis.speaking,
            info: async (ctx) => {
                const name = Utils.languageName((ctx.language || userLanguage()));
                return name ? `Reads in ${name}` : null;
            },
            execute: async (ctx) => {
                const announce = () => window.dispatchEvent(new CustomEvent('lighthouse:state'));
                if (window.speechSynthesis.speaking) {
                    window.speechSynthesis.cancel();
                    announce();
                    return { success: true, message: 'Stopped reading' };
                } else {
                    const u = new SpeechSynthesisUtterance(ctx.text);
                    u.lang = (ctx.language || userLanguage());
                    u.onstart = u.onend = u.onerror = announce;   // the button follows the speech itself
                    window.speechSynthesis.speak(u);
                    return { success: true };
                }
            }
        },
        {
            id: 'marker',
            label: 'Highlight',
            category: 'selection',
            icon: 'highlighter',
            condition: (ctx) => ctx.hasText && !ctx.isInput && !ctx.isLink,
            execute: (ctx) => {
                if (window.LighthouseMarkers) window.LighthouseMarkers.markTextSelection(ctx.text, getSettings().highlightColor || 'yellow');
                return { success: true, message: 'Highlighted' };
            },
            info: () => `Highlights in ${getSettings().highlightColor || 'yellow'}`,   // the color a click uses
            // Hover: the colors; the one picked becomes the default
            preview: (ctx) => ({
                type: 'menu',
                items: Data.HIGHLIGHT_COLORS.map(color => ({
                    label: color[0].toUpperCase() + color.slice(1), color, current: color === (getSettings().highlightColor || 'yellow'),
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
            execute: (ctx) => {
                const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(ctx.text)}`;
                ctx.tools.open(url);
                return { success: true };
            },
            preview: (ctx) => {
                const url = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(ctx.text)}`;
                return {
                    node: Utils.create('img', { className: 'qr-code', attrs: { src: url, alt: 'QR code' } })
                };
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
                ctx.element.focus(); 
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
                ctx.element.focus();
                let text = await tools.readClipboard();
                if (!text) return { success: false, message: 'Clipboard empty' };
                tools.replace(text.trim());
                return { success: true };
            },
            // The clipboard, and anything collected with Collect (read fresh each time)
            preview: async (ctx, tools) => {
                const stack = await ctx.tools.collection.get();
                if (!stack.length) return null;   // the label already shows the clipboard
                const singleLine = !ctx.tools.surface.multiline;
                const flat = (s) => s.replace(/\s+/g, ' ').trim();
                const insert = (value) => { if (ctx.element) ctx.element.focus(); tools.replace(value); };
                return {
                    type: 'menu',
                    live: true,
                    items: [
                        ...stack.slice(-5).reverse().map(s => ({ label: Utils.excerpt(s, 30), textOnly: true, onClick: () => insert(singleLine ? flat(s) : s) })),
                        { label: `Paste all (${stack.length})`, icon: 'stack', onClick: () => insert(singleLine ? stack.map(flat).join(' ') : stack.join('\n\n')) },
                        { label: 'Clear collection', icon: 'clear', onClick: async () => { await ctx.tools.collection.set([]); tools.toast('Collection cleared'); } }
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
            execute: (ctx, tools) => {
                ctx.element.focus();
                tools.replace('');
                return { success: true };
            }
        },
        {
            id: 'clear',
            label: 'Clear all',
            category: 'input',
            icon: 'clear',
            condition: (ctx) => { const r = ctx.isInput && !ctx.hasText && ctx.tools.surface.read('all'); return !!r && !!(r.before + r.text + r.after); },
            execute: (ctx, tools) => {
                ctx.element.focus();
                tools.replace('', { span: 'all' });
                return { success: true };
            }
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
            condition: (ctx) => ctx.hasText && ctx.isInput,
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
                if (!inside.length) return { type: 'menu', previewText: 'No issues found ✓', items: [credit] };
                const apply = (list) => [...list].sort((a, b) => b.offset - a.offset)
                    .reduce((out, i) => out.slice(0, i.offset) + i.replacements[0] + out.slice(i.offset + i.length), selected);
                const items = inside.slice(0, 5).map(i => ({
                    label: `${selected.substr(i.offset, i.length)} → ${i.replacements[0]}`,
                    textOnly: true,
                    onClick: () => tools.replace(apply([i]))
                }));
                if (inside.length > 1) items.push({ label: `Fix all (${inside.length})`, icon: 'check', onClick: () => tools.replace(apply(inside)) });
                items.push(credit);
                return { type: 'menu', items };
            }
        },

        // --- SMART ACTIONS ---
        {
            id: 'math',
            label: 'Calculate',
            category: 'smart',
            icon: 'math',
            condition: (ctx) => !ctx.isLink && ctx.text.length < 50 && (MathLib.safeCalculate(ctx.text) !== null),
            dynamicLabel: (ctx) => {
                const res = MathLib.safeCalculate(ctx.text);
                return res !== null ? `∑ ${Number(res.toFixed(4))}` : null;
            },
            execute: (ctx, tools) => {
                const res = MathLib.safeCalculate(ctx.text);
                const resStr = String(Number(res.toFixed(4)));
                tools.copy(resStr);
                return { success: true, message: `Result: ${resStr}` };
            },
            preview: (ctx, tools) => {
                const res = MathLib.safeCalculate(ctx.text);
                const resultText = `= ${Number(res.toFixed(4))}`;
                return {
                    previewText: resultText,
                    isValue: true,
                    items: [{
                        label: 'Copy',
                        icon: 'copy',
                        onClick: () => tools.copy(resultText.replace('= ', ''))
                    }]
                };
            }
        },
        {
            id: 'currency',
            label: 'Convert',
            category: 'smart',
            icon: 'currency',
            // "25 EUR", "€25": { amount, base }, or null
            pattern: null,
            parse(text) {
                const raw = text.trim().toUpperCase();
                if (!/\d/.test(raw) || raw.length > 50) return null;
                if (!this.pattern) {
                    const keys = MathLib.patterns().currencyKeys;
                    this.pattern = new RegExp(`([\\d\\s]+(${keys})|(${keys})[\\d\\s]+)`, 'i');
                }
                if (!this.pattern.test(raw)) return null;
                const baseEntry = Object.entries(Data.CURRENCY_MAP).find(([k]) => raw.includes(k));
                const base = baseEntry ? baseEntry[1] : 'USD';
                const amount = MathLib.parseLocaleNumber(raw, base);
                return { amount, base };
            },
            parsed(ctx) { return getParsed(ctx, 'currency', () => this.parse(ctx.text)); },
            // When the rate is from: today the time, else the day
            rateAge(at) {
                const d = new Date(at), today = new Date().toDateString() === d.toDateString();
                return 'rate from ' + (today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' }));
            },
            condition(ctx) {
                const parsed = this.parsed(ctx);
                return parsed && parsed.base !== userCurrency();
            },
            async dynamicLabel(ctx) {
                const parsed = this.parsed(ctx);
                if (!parsed || parsed.amount === null) return null;
                const target = userCurrency();
                if (parsed.base !== target) {
                    const rate = await MathLib.fetchRate(parsed.base, target);
                    if (rate) {
                        const converted = (parsed.amount * rate).toFixed(2);
                        const sym = Data.CURRENCY_SYMBOLS?.[target] || '';
                        return `${sym}${converted} ${target}`;
                    }
                }
                return null;
            },
            // The rate it uses, and when it is from (rates are kept for a day)
            async info(ctx, tools) {
                const parsed = this.parsed(ctx);
                const target = userCurrency();
                const found = parsed && parsed.base !== target && await tools.rate(parsed.base, target);
                if (!found) return null;
                return `1 ${parsed.base} = ${found.rate.toLocaleString(undefined, { maximumSignificantDigits: 5 })} ${target}` + (found.asOf ? ` · ${this.rateAge(found.asOf)}` : '');
            },
            execute: (ctx) => {
                ctx.tools.open(buildUrl('https://www.google.com/search?q=%s+convert', ctx.text));
                return { success: true };
            },
            async preview(ctx, tools) {
                const parsed = this.parsed(ctx);
                const target = userCurrency();
                let label = '...';
                if (parsed && parsed.amount !== null && parsed.base !== target) {
                    const rate = await tools.fetchRate(parsed.base, target);
                    if (rate) label = `${(parsed.amount * rate).toFixed(2)} ${target}`;
                    else label = 'Unavailable';
                }
                return tools.buildCopyMenu(label, label, 'Copy', [tools.convertPageItem()]);
            }
        },
        {
            id: 'unit',
            label: 'Unit',
            category: 'smart',
            icon: 'unit',
            // "5 km": the conversion, or null
            parse(text) {
                const match = text.trim().match(new RegExp(`^([\\d,.]+)\\s*°?(${MathLib.patterns().unitKeys})$`, 'i'));
                if (!match) return null;
                const val = MathLib.parseLocaleNumber(match[1]);   // "1,5 km" is 1.5 km
                const conv = MathLib.convertUnit(val, match[2]);
                if (!conv) return null;
                return { val, unitKey: match[2].toLowerCase(), isMetric: conv.metric, result: `${conv.value.toFixed(2)} ${conv.target}` };
            },
            parsed(ctx) { return getParsed(ctx, 'unit', () => this.parse(ctx.cleanText)); },
            condition(ctx) {
                const parsed = this.parsed(ctx);
                if (!parsed) return false;
                const userPreference = getStandards().units || 'metric';
                return userPreference === 'metric' ? !parsed.isMetric : parsed.isMetric;
            },
            execute: (ctx) => {
                ctx.tools.open(buildUrl('https://www.google.com/search?q=%s+conversion', ctx.cleanText));
                return { success: true };
            },
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
                const lang = getStandards().language || undefined;
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
            execute(ctx) {
                const parsed = this.parsed(ctx);
                if (!parsed) return { success: false, message: 'Not a valid date or time' };
                ctx.tools.open(this.calendarUrl(parsed.target, parsed.hasTime));
                return { success: true };
            },
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
            condition: (ctx) => {
                const t = ctx.cleanText;
                if (t.length < 2 || (!t.startsWith('{') && !t.startsWith('['))) return false;
                try { JSON.parse(t); return true; } catch(e) { return false; }
            },
            execute: (ctx, tools) => {
                try {
                    const obj = JSON.parse(ctx.cleanText);
                    const pretty = JSON.stringify(obj, null, 2);
                    if (ctx.isInput) tools.replace(pretty);
                    else tools.copy(pretty);
                    return { success: true, message: 'JSON formatted' };
                } catch(e) { return { success: false }; }
            },
            preview: (ctx) => {
                try {
                    const obj = JSON.parse(ctx.cleanText);
                    const keys = Object.keys(obj).length;
                    return { previewText: `Valid JSON (${Array.isArray(obj) ? obj.length + ' items' : keys + ' keys'})` };
                } catch(e) { return null; }
            }
        },
        {
            id: 'base64_decode',
            label: 'Decode',
            category: 'smart',
            icon: 'lock',
            condition: (ctx) => {
                const t = ctx.cleanText;
                if (t.length < 4 || t.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return false;
                // Only if it decodes to readable text: plain words like "Unix" decode to byte garbage
                try { return !/[\x00-\x08\x0E-\x1F]/.test(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(t), c => c.charCodeAt(0)))); } catch(e) { return false; }
            },
            execute: (ctx, tools) => {
                try {
                    const decoded = atob(ctx.cleanText);
                    if (ctx.isInput) tools.replace(decoded);
                    else tools.copy(decoded);
                    return { success: true, message: 'Base64 decoded' };
                } catch(e) { return { success: false }; }
            },
            preview: (ctx, tools) => {
                try {
                    const decoded = atob(ctx.cleanText);
                    const safe = Utils.shorten(decoded, 20);
                    return tools.buildCopyMenu(decoded, `"${safe}"`);
                } catch(e) { return null; }
            }
        },
        {
            id: 'color_convert',
            label: 'Color',
            category: 'smart',
            icon: 'palette',
            // "#ff0000" or "rgb(255, 0, 0)": { original, converted }, or null
            parse(text) {
                let isHex = /^#([0-9A-F]{3}){1,2}$/i.test(text);
                let isRgb = /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/i.test(text);
                if (!isHex && !isRgb) return null;
                let res;
                if (isHex) {
                    let hex = text.substring(1);
                    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
                    const num = parseInt(hex, 16);
                    res = `rgb(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255})`;
                } else {
                    const parts = text.match(/\d+/g);
                    if (parts) {
                        res = '#' + parts.map(p => {
                            const h = parseInt(p).toString(16);
                            return h.length === 1 ? '0' + h : h;
                        }).join('');
                    }
                }
                return { original: text, converted: res };
            },
            parsed(ctx) { return getParsed(ctx, 'color', () => this.parse(ctx.text)); },
            condition(ctx) { return this.parsed(ctx) !== null; },
            execute(ctx, tools) {
                const parsed = this.parsed(ctx);
                if (parsed?.converted) {
                    tools.copy(parsed.converted);
                    return { success: true, message: `Copied: ${parsed.converted}` };
                }
                return { success: false };
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
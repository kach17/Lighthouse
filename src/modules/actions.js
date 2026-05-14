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

    // --- Shared Helpers ---

    const makeTextPreview = (text, tools) => {
        const html = `<div style="max-width: 260px; text-align: left; white-space: normal; line-height: 1.4; padding: 4px;">
            <div style="font-size: 12px; color: var(--so-text-color);">${text}</div>
        </div>`;
        return tools.buildCopyMenu(text, { content: html });
    };

    const getStack = async () => (await chrome.storage.local.get('copyStack')).copyStack || [];
    const setStack = async (stack) => chrome.storage.local.set({ copyStack: stack });
    const buildUrl = (template, text) => template.replace('%s', encodeURIComponent(text));

    // --- UNIFIED PARSER REGISTRY ---
    // All parsers auto-cache results on context via getParsed()
    const PARSERS = {
        currency: (text) => {
            const raw = text.trim().toUpperCase();
            if (!/\d/.test(raw) || raw.length > 50) return null;
            const keys = Object.keys(Data.CURRENCY_MAP || {}).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            if (!new RegExp(`([\\d\\s]+(${keys})|(${keys})[\\d\\s]+)`, 'i').test(raw)) return null;
            const baseEntry = Object.entries(Data.CURRENCY_MAP).find(([k]) => raw.includes(k));
            const base = baseEntry ? baseEntry[1] : 'USD';
            const amount = MathLib.parseLocaleNumber(raw);
            return { amount, base };
        },
        
        unit: (text) => {
            const match = text.toLowerCase().match(new RegExp(`^([\\d,.]+)\\s*°?(${Object.keys(Data.UNIT_CONVERSIONS || {}).join('|')})$`, 'i'));
            if (!match) return null;
            const val = parseFloat(match[1].replace(/,/g, ''));
            const unitKey = match[2];
            const isMetric = ['c', 'km', 'kg', 'cm', 'm', 'g'].includes(unitKey);
            const conv = Data.UNIT_CONVERSIONS[unitKey];
            if (!conv) return null;
            return { val, unitKey, isMetric, result: `${conv.func(val).toFixed(2)} ${conv.target}` };
        },
        
        color: (text) => {
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
        
        reminder: (text) => {
            let now = new Date();
            let target = new Date(now);
            let hasDate = false;
            let hasTime = false;
            let t = text.toLowerCase().trim();

            // Time Parsing
            const timeRegex = /(?:\bat\s+|\b(?=\d{1,2}:)|\b(?=\d{1,2}\s*(?:am|pm)\b))(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
            const timeMatch = t.match(timeRegex);
            if (timeMatch) {
                let hours = parseInt(timeMatch[1]);
                let mins = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
                let ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;
                if (ampm === 'pm' && hours < 12) hours += 12;
                if (ampm === 'am' && hours === 12) hours = 0;
                target.setHours(hours, mins, 0, 0);
                hasTime = true;
                t = t.replace(timeMatch[0], ' ');
            }

            // Relative Days
            if (t.includes('tomorrow')) {
                target.setDate(now.getDate() + 1);
                hasDate = true;
            } else if (t.includes('today')) {
                hasDate = true;
            }

            // Days of the week
            const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
            if (!hasDate) {
                for (let i = 0; i < days.length; i++) {
                    if (t.includes(days[i])) {
                        let d = now.getDay();
                        let diff = i - d;
                        if (diff <= 0) diff += 7;
                        target.setDate(now.getDate() + diff);
                        hasDate = true;
                        break;
                    }
                }
            }

            // Months/Dates
            const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            if (!hasDate) {
                const monthStr = months.join('|');
                const dateRegex = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthStr})[a-z]*|(${monthStr})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?`);
                const dateMatch = t.match(dateRegex);
                if (dateMatch) {
                    let day, monthStrMatch;
                    if (dateMatch[1]) {
                        day = parseInt(dateMatch[1]);
                        monthStrMatch = dateMatch[2];
                    } else {
                        monthStrMatch = dateMatch[3];
                        day = parseInt(dateMatch[4]);
                    }
                    let monthIdx = months.findIndex(m => monthStrMatch.startsWith(m));
                    target.setMonth(monthIdx);
                    target.setDate(day);
                    if (target < now) target.setFullYear(now.getFullYear() + 1);
                    hasDate = true;
                }
            }

            // DD/MM/YYYY format
            if (!hasDate) {
                const ddmmRegex = /(?<!\d)(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?(?!\d)/;
                const ddmmMatch = t.match(ddmmRegex);
                if (ddmmMatch) {
                    let day = parseInt(ddmmMatch[1]);
                    let month = parseInt(ddmmMatch[2]) - 1;
                    let year = ddmmMatch[3] ? parseInt(ddmmMatch[3]) : now.getFullYear();
                    if (year < 100) year += 2000;
                    target.setDate(day);
                    target.setMonth(month);
                    target.setFullYear(year);
                    hasDate = true;
                }
            }

            // Timestamp or ISO date fallback
            if(!hasDate && !hasTime) {
                if (/^\d{10}(\d{3})?$/.test(t)) {
                    let ts = parseInt(t);
                    if (ts < 10000000000) ts *= 1000;
                    target = new Date(ts);
                    hasDate = true;
                    hasTime = true;
                } else if (!isNaN(Date.parse(text)) && /[\/\-]|\s\d{4}|[a-zA-Z]{3}/.test(text)) {
                    target = new Date(text);
                    hasDate = true;
                    hasTime = text.includes(':') || text.includes('T');
                }
            }

            if(!hasDate && !hasTime) return null;
            return { target, hasTime, hasDate };
        }
    };

    // Auto-caching accessor: ctx._parsed_<name> is set once, reused everywhere
    const getParsed = (ctx, parserName) => {
        const cacheKey = `_parsed_${parserName}`;
        if (ctx[cacheKey] === undefined) {
            const inputText = (parserName === 'unit' || parserName === 'reminder') ? ctx.cleanText : ctx.text;
            ctx[cacheKey] = PARSERS[parserName](inputText);
        }
        return ctx[cacheKey];
    };

    // --- HELPER FORMATTERS ---
    const formatGCalDates = (date, hasTime) => {
        const pad = (n) => n < 10 ? '0' + n : n;
        const y = date.getUTCFullYear();
        const m = pad(date.getUTCMonth() + 1);
        const d = pad(date.getUTCDate());
        
        if (!hasTime) {
            const nextDay = new Date(date);
            nextDay.setDate(date.getDate() + 1);
            const ny = nextDay.getUTCFullYear();
            const nm = pad(nextDay.getUTCMonth() + 1);
            const nd = pad(nextDay.getUTCDate());
            return `${y}${m}${d}/${ny}${nm}${nd}`;
        } else {
            const h = pad(date.getUTCHours());
            const min = pad(date.getUTCMinutes());
            const s = pad(date.getUTCSeconds());
            const endDate = new Date(date.getTime() + 60*60*1000);
            const ey = endDate.getUTCFullYear();
            const em = pad(endDate.getUTCMonth() + 1);
            const ed = pad(endDate.getUTCDate());
            const eh = pad(endDate.getUTCHours());
            const emin = pad(endDate.getUTCMinutes());
            const es = pad(endDate.getUTCSeconds());
            return `${y}${m}${d}T${h}${min}${s}Z/${ey}${em}${ed}T${eh}${emin}${es}Z`;
        }
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
                return { success: true, message: 'Copied!' };
            }
        },
        {
            id: 'stack',
            label: 'Stack',
            category: 'selection',
            icon: 'stack',
            condition: (ctx) => ctx.hasText,
            execute: async (ctx, tools) => {
                const copyStack = await getStack();
                copyStack.push(ctx.text);
                await setStack(copyStack);
                return { success: true, message: `Stack: ${copyStack.length} items` };
            },
            preview: async (ctx, tools) => {
                const copyStack = await getStack();
                if (copyStack.length === 0) return { previewText: 'Stack is empty' };
                return {
                    type: 'menu',
                    previewText: `${copyStack.length} items`,
                    items: [
                        {
                            label: 'Copy All',
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
                                await setStack([]);
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
            execute: (ctx) => {
                const engines = getSettings().searchEngines?.filter(e => e.enabled) || [];
                if(engines.length === 0) return { success: false, message: 'No search engine enabled' };
                window.open(buildUrl(engines[0].url, ctx.text), '_blank');
                return { success: true };
            },
            preview: (ctx) => {
                const engines = getSettings().searchEngines?.filter(e => e.enabled) || [];
                if (engines.length <= 1) return null; 
                return {
                    type: 'menu',
                    items: engines.slice(1).map(eng => ({
                        label: eng.name,
                        icon: eng.icon, 
                        iconUrl: eng.url, 
                        onClick: () => window.open(buildUrl(eng.url, ctx.text), '_blank')
                    }))
                };
            }
        },
        {
            id: 'translate',
            label: 'Translate',
            category: 'selection',
            icon: 'translate',
            condition: (ctx) => ctx.hasText && !ctx.isLink && /\p{L}/u.test(ctx.text) && Utils.isForeign(ctx),
            execute: (ctx) => {
                const tl = getStandards().language || 'en';
                window.open(buildUrl(`https://translate.google.com/?sl=auto&tl=${tl}&text=%s&op=translate`, ctx.text), '_blank');
                return { success: true };
            },
            preview: async (ctx, tools) => {
                const res = await tools.translate(ctx.text);
                if (!res) return { previewText: 'Translation unavailable' };
                return makeTextPreview(res, tools);
            }
        },
        {
            id: 'dictionary',
            label: 'Define',
            category: 'selection',
            icon: 'dictionary',
            condition: (ctx) => ctx.hasText && ctx.wordCount === 1 && /\p{L}/u.test(ctx.text) && !Utils.isForeign(ctx),
            execute: (ctx) => {
                window.open(buildUrl('https://www.google.com/search?q=define+%s', ctx.text), '_blank');
                return { success: true };
            },
            preview: async (ctx, tools) => {
                const res = await tools.define(ctx.text);
                if (!res) return { previewText: 'Definition unavailable' };
                return makeTextPreview(res, tools);
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
            execute: (ctx) => {
                const lang = Utils.detectTextLanguage(ctx.text);
                const title = ctx.text.trim().replace(/\s+/g, '_');
                window.open(buildUrl(`https://${lang}.wikipedia.org/wiki/%s`, title), '_blank');
                return { success: true };
            },
            preview: async (ctx) => {
                const lang = Utils.detectTextLanguage(ctx.text);
                const title = encodeURIComponent(ctx.text.trim().replace(/\s+/g, '_'));
                try {
                    const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${title}`);
                    if (!res.ok) return { previewText: 'Article not found' };
                    const data = await res.json();
                    if (data.type === 'disambiguation' || data.type === 'not_found') {
                        return { previewText: 'Article not found' };
                    }
                    
                    let html = `<div style="max-width: 260px; text-align: left; white-space: normal; line-height: 1.4; padding: 4px;">`;
                    if (data.thumbnail?.source) {
                        html += `<img src="${data.thumbnail.source}" style="width: 100%; max-height: 140px; object-fit: cover; border-radius: 6px; margin-bottom: 8px;">`;
                    }
                    html += `<strong style="font-size: 14px; color: var(--so-text-color);">${data.title}</strong>`;
                    if (data.description) {
                        html += `<div style="font-size: 11px; color: var(--so-text-sub); margin-bottom: 6px; font-style: italic;">${data.description}</div>`;
                    }
                    let extract = data.extract || '';
                    if (extract.length > 140) extract = extract.substring(0, 140) + '...';
                    html += `<div style="font-size: 12px; color: var(--so-text-color); margin-top: 4px;">${extract}</div></div>`;
                    
                    return { type: 'html', content: html };
                } catch (e) {
                    return { previewText: 'Error fetching Wiki' };
                }
            }
        },
        {
            id: 'speak',
            label: 'Read',
            category: 'selection',
            icon: 'speak',
            condition: (ctx) => ctx.hasText && ('speechSynthesis' in window),
            keepOpen: true,
            execute: (ctx) => {
                if (window.speechSynthesis.speaking) {
                    window.speechSynthesis.cancel();
                    return { success: true, message: 'Stopped' };
                } else {
                    const u = new SpeechSynthesisUtterance(ctx.text);
                    u.lang = getStandards().language || 'en';
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
                if (window.LighthouseMarkers) {
                    window.LighthouseMarkers.markTextSelection('yellow', 'black', ctx.text);
                }
                return { success: true, message: 'Highlighted' };
            }
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
                window.open(url, '_blank');
                return { success: true };
            },
            preview: (ctx) => {
                const url = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(ctx.text)}`;
                return {
                    type: 'html',
                    content: `<img src="${url}" class="qr-code" alt="QR Code" style="display:block; width:150px; height:150px; background:white; padding:4px; border-radius:4px;">`
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
                document.execCommand('copy');
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
            execute: async (ctx, tools) => {
                ctx.element.focus();
                let text = await tools.readClipboard();
                if (!text) return { success: false, message: 'Clipboard empty' };
                tools.replace(text.trim());
                return { success: true };
            },
            preview: async (ctx, tools) => {
                const text = await tools.readClipboard();
                if (!text) return { previewText: 'Clipboard empty' };
                const preview = text.length > 20 ? text.substring(0, 20) + '...' : text;
                return { previewText: `Paste "${preview}"` };
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
            label: 'Clear All',
            category: 'input',
            icon: 'clear',
            condition: (ctx) => ctx.isInput && !ctx.hasText && (ctx.isForm ? ctx.element.value.length > 0 : true),
            execute: (ctx, tools) => {
                ctx.element.focus();
                if (ctx.isForm) ctx.element.select();
                else document.execCommand('selectAll');
                tools.replace('');
                return { success: true };
            }
        },
        {
            id: 'case',
            label: 'Case',
            category: 'input',
            icon: 'case',
            condition: (ctx) => ctx.hasText && ctx.isInput,
            keepOpen: true,
            execute: (ctx, tools) => {
                const t = ctx.text;
                let next;
                if (t === t.toUpperCase()) next = t.toLowerCase();
                else if (t === t.toLowerCase()) next = t.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.substring(1).toLowerCase());
                else next = t.toUpperCase();
                tools.replace(next, { select: true });
                return { success: true };
            }
        },
        {
            id: 'spellcheck',
            label: 'Spell',
            category: 'input',
            icon: 'spellcheck',
            condition: (ctx) => ctx.isInput && ctx.hasText && ctx.wordCount === 1 && /\p{L}/u.test(ctx.text) && !Utils.isForeign(ctx),
            execute: (ctx) => {
                return { success: true, message: 'Hover for suggestions' };
            },
            preview: async (ctx, tools) => {
                try {
                    const originalText = ctx.text;
                    const word = originalText.trim();
                    const json = await tools.spellcheck(word);
                    
                    if (!json || json.length === 0) return { previewText: 'No suggestions' };
                    if (json[0].word.toLowerCase() === word.toLowerCase()) {
                        return { previewText: 'Correct ✓' };
                    }
                    
                    return {
                        type: 'menu',
                        items: json.map(item => ({
                            label: item.word,
                            textOnly: true,
                            onClick: () => {
                                tools.replace(item.word);
                                tools.toast('Corrected!');
                            }
                        }))
                    };
                } catch(e) {
                    return { previewText: 'Error checking' };
                }
            }
        },

        // --- SMART ACTIONS ---
        {
            id: 'math',
            label: 'Calc',
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
            condition: (ctx) => {
                const parsed = getParsed(ctx, 'currency');
                return parsed && parsed.base !== (getStandards().currency || 'USD');
            },
            dynamicLabel: async (ctx) => {
                const parsed = getParsed(ctx, 'currency');
                if (!parsed || parsed.amount === null) return null;
                const target = getStandards().currency || 'USD';
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
            execute: (ctx) => {
                window.open(buildUrl('https://www.google.com/search?q=%s+convert', ctx.text), '_blank');
                return { success: true };
            },
            preview: async (ctx, tools) => {
                const parsed = getParsed(ctx, 'currency');
                const target = getStandards().currency || 'USD';
                let label = '...';
                if (parsed && parsed.amount !== null && parsed.base !== target) {
                    const rate = await tools.fetchRate(parsed.base, target);
                    if (rate) label = `${(parsed.amount * rate).toFixed(2)} ${target}`;
                    else label = 'Unavailable';
                }
                return tools.buildCopyMenu(label);
            }
        },
        {
            id: 'unit',
            label: 'Unit',
            category: 'smart',
            icon: 'unit',
            condition: (ctx) => {
                const parsed = getParsed(ctx, 'unit');
                if (!parsed) return false;
                const userPreference = getStandards().units || 'metric';
                return userPreference === 'metric' ? !parsed.isMetric : parsed.isMetric;
            },
            execute: (ctx) => {
                window.open(buildUrl('https://www.google.com/search?q=%s+conversion', ctx.cleanText), '_blank');
                return { success: true };
            },
            preview: (ctx, tools) => {
                const parsed = getParsed(ctx, 'unit');
                return tools.buildCopyMenu(parsed ? parsed.result : '...');
            }
        },
        {
            id: 'reminder',
            label: 'Remind',
            category: 'smart',
            icon: 'calendar',
            condition: (ctx) => {
                const t = ctx.cleanText;
                if (!t || t.length < 3 || t.length > 50) return false;
                return getParsed(ctx, 'reminder') !== null;
            },
            execute: (ctx, tools) => {
                const parsed = getParsed(ctx, 'reminder');
                if (!parsed) return { success: false, message: 'Invalid Date/Time' };
                const datesParam = formatGCalDates(parsed.target, parsed.hasTime);
                let textParam = encodeURIComponent(ctx.text.length > 20 ? 'Reminder' : ctx.text);
                window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${textParam}&dates=${datesParam}`, '_blank');
                return { success: true };
            },
            preview: (ctx, tools) => {
                const parsed = getParsed(ctx, 'reminder');
                if (!parsed) return null;
                const displayOpts = parsed.hasTime 
                    ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' }
                    : { weekday: 'short', month: 'short', day: 'numeric' };
                const displayStr = parsed.target.toLocaleDateString(getStandards().language || 'en', displayOpts);
                return {
                    items: [{
                        label: displayStr,
                        textOnly: true,
                        onClick: () => {
                            const datesParam = formatGCalDates(parsed.target, parsed.hasTime);
                            let textParam = encodeURIComponent(ctx.text.length > 20 ? 'Reminder' : ctx.text);
                            window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${textParam}&dates=${datesParam}`, '_blank');
                        }
                    }]
                };
            }
        },
        {
            id: 'json_format',
            label: 'JSON',
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
                    return { success: true, message: 'JSON Formatted' };
                } catch(e) { return { success: false }; }
            },
            preview: (ctx) => {
                try {
                    const obj = JSON.parse(ctx.cleanText);
                    const keys = Object.keys(obj).length;
                    return { type: 'text', content: `Valid JSON (${Array.isArray(obj) ? obj.length + ' items' : keys + ' keys'})` };
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
                try { return atob(t).length > 0; } catch(e) { return false; }
            },
            execute: (ctx, tools) => {
                try {
                    const decoded = atob(ctx.cleanText);
                    if (ctx.isInput) tools.replace(decoded);
                    else tools.copy(decoded);
                    return { success: true, message: 'Base64 Decoded' };
                } catch(e) { return { success: false }; }
            },
            preview: (ctx, tools) => {
                try {
                    const decoded = atob(ctx.cleanText);
                    if (/[\x00-\x08\x0E-\x1F]/.test(decoded)) return { type: 'text', content: 'Binary Data' };
                    const safe = decoded.length > 20 ? decoded.substring(0, 20) + '...' : decoded;
                    return tools.buildCopyMenu(decoded, `"${safe}"`);
                } catch(e) { return null; }
            }
        },
        {
            id: 'color_convert',
            label: 'Color',
            category: 'smart',
            icon: 'palette',
            condition: (ctx) => getParsed(ctx, 'color') !== null,
            execute: (ctx, tools) => {
                const parsed = getParsed(ctx, 'color');
                if (parsed?.converted) {
                    tools.copy(parsed.converted);
                    return { success: true, message: `Copied: ${parsed.converted}` };
                }
                return { success: false };
            },
            preview: (ctx, tools) => {
                const parsed = getParsed(ctx, 'color');
                if (!parsed) return null;
                const { original, converted } = parsed;
                const html = `<div style="display:flex; align-items:center;">
                    <span style="display:inline-block; width:14px; height:14px; border-radius:50%; background:${original}; margin-right:6px; flex-shrink:0; border:1px solid rgba(0,0,0,0.1);"></span>
                    <span>${original}</span>
                </div>`;
                return tools.buildCopyMenu(converted || original, { content: html }, 'Copy Converted');
            }
        }
    ];

    global.LighthouseActions = ACTIONS;

})(typeof self !== 'undefined' ? self : window);
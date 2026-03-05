/**
 * Lighthouse - Master Action Definitions
 * Classified into: 'selection', 'input', 'smart', 'link'
 */
(function(global) {

    const Utils = global.LighthouseUtils;
    const MathLib = global.LighthouseMath;
    const Data = global.LighthouseData;
    const Config = global.LighthouseConfig;

    const getSettings = () => (global.LighthouseState && global.LighthouseState.settings) ? global.LighthouseState.settings : (Config ? Config.defaults : {});

    // --- Shared Helpers ---

    // #7: Centralised standards accessor (language, currency, units)
    const getStandards = () => getSettings().standards || {};

    // #1: Shared preview HTML wrapper for single-text previews (translate, dictionary)
    const makeTextPreview = (text, tools) => {
        const html = `<div style="max-width: 260px; text-align: left; white-space: normal; line-height: 1.4; padding: 4px;">
            <div style="font-size: 12px; color: var(--so-text-color);">${text}</div>
        </div>`;
        return { type: 'menu', content: html, items: [{ label: 'Copy', icon: 'copy', onClick: () => tools.copy(text) }] };
    };

    // #2: Shared date parser for date_convert action
    const parseDate = (cleanText) => {
        if (/^\d{10}(\d{3})?$/.test(cleanText)) {
            let ts = parseInt(cleanText);
            if (ts < 10000000000) ts *= 1000;
            return new Date(ts);
        }
        return new Date(cleanText);
    };

    // #5: Stack storage accessors
    const getStack = async () => (await chrome.storage.local.get('copyStack')).copyStack || [];
    const setStack = async (stack) => chrome.storage.local.set({ copyStack: stack });

    // #6: URL builder (reuses the %s placeholder convention from searchEngines)
    const buildUrl = (template, text) => template.replace('%s', encodeURIComponent(text));

    // --- Standard Action Definition ---
    // All execute() methods now return a unified payload: { success: boolean, message?: string, data?: any }
    
    const ACTIONS = [
        // --- TYPE 1: NORMAL SELECTION ---
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
                
                if (copyStack.length === 0) {
                    return { previewText: 'Stack is empty' };
                }

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
                const s = getSettings();
                const engines = s.searchEngines ? s.searchEngines.filter(e => e.enabled) : [];
                if(engines.length === 0) return { success: false, message: 'No search engine enabled' };
                window.open(buildUrl(engines[0].url, ctx.text), '_blank');
                return { success: true };
            },
            preview: (ctx) => {
                const s = getSettings();
                const engines = s.searchEngines ? s.searchEngines.filter(e => e.enabled) : [];
                if (engines.length <= 1) return null; 
                const items = engines.slice(1).map(eng => ({
                    label: eng.name,
                    icon: eng.icon, 
                    iconUrl: eng.url, 
                    onClick: () => window.open(buildUrl(eng.url, ctx.text), '_blank')
                }));
                return { type: 'menu', items };
            }
        },
        {
            id: 'translate',
            label: 'Translate',
            category: 'selection',
            icon: 'translate',
            // Condition: Must have text, not a link, and has letters.
            // Logic: Only show if foreign (Native language).
            condition: (ctx) => {
                if (!ctx.hasText || ctx.isLink || !/\p{L}/u.test(ctx.text)) return false;
                return Utils.isForeign(ctx);
            },
            execute: (ctx) => {
                window.open(buildUrl(`https://translate.google.com/?sl=auto&tl=%tl&text=%s&op=translate`.replace('%tl', getStandards().language || 'en'), ctx.text), '_blank');
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
            // Condition: Must have text, 1 word, has letters.
            // Logic: Only show if NOT foreign (Native language).
            condition: (ctx) => {
                if (!ctx.hasText || ctx.wordCount !== 1 || !/\p{L}/u.test(ctx.text)) return false;
                return !Utils.isForeign(ctx);
            },
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
                const text = ctx.text.trim();
                // Must start with an uppercase letter (Unicode aware)
                if (!/^\p{Lu}/u.test(text)) return false;
                return true;
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
                    if (data.thumbnail && data.thumbnail.source) {
                        html += `<img src="${data.thumbnail.source}" style="width: 100%; max-height: 140px; object-fit: cover; border-radius: 6px; margin-bottom: 8px;">`;
                    }
                    html += `<strong style="font-size: 14px; color: var(--so-text-color);">${data.title}</strong>`;
                    if (data.description) {
                        html += `<div style="font-size: 11px; color: var(--so-text-sub); margin-bottom: 6px; font-style: italic;">${data.description}</div>`;
                    }
                    let extract = data.extract || '';
                    if (extract.length > 140) extract = extract.substring(0, 140) + '...';
                    html += `<div style="font-size: 12px; color: var(--so-text-color); margin-top: 4px;">${extract}</div>`;
                    html += `</div>`;
                    
                    return {
                        type: 'html',
                        content: html
                    };
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
            icon: 'highlighter', // fallback icon
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

        // --- TYPE 2: INPUT TOOLS ---
        {
            id: 'cut',
            label: 'Cut',
            category: 'input',
            icon: 'cut',
            condition: (ctx) => ctx.isInput && ctx.hasText,
            execute: (ctx) => { 
                ctx.element.focus(); 
                document.execCommand('cut');
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
                
                // Smart Paste Logic
                let text = await tools.readClipboard();
                if (!text) return { success: false, message: 'Clipboard empty' };
                
                // 3. PDF Fixer: Remove broken newlines from hard-wrapped text
                if (text.includes('\n')) {
                    const lines = text.split('\n');
                    // Heuristic: If >50% of lines do NOT end in punctuation, it's likely a hard wrap
                    const wrappedCount = lines.filter(l => l.length > 0 && !/[.!?:;]$/.test(l.trim())).length;
                    if (lines.length > 1 && wrappedCount / lines.length > 0.5) {
                        text = text.replace(/-\n/g, '').replace(/\n/g, ' ');
                    }
                }

                // 1. Contextual Spacing (English Teacher)
                let charBefore = null;
                let charAfter = null;

                if (ctx.isForm) {
                    const val = ctx.element.value || '';
                    const s = ctx.element.selectionStart;
                    const e = ctx.element.selectionEnd;
                    charBefore = s > 0 ? val[s - 1] : null;
                    charAfter = e < val.length ? val[e] : null;
                } else if (ctx.isEditable) {
                    const sel = window.getSelection();
                    if (sel.rangeCount) {
                        const range = sel.getRangeAt(0);
                        
                        // Char Before
                        const preRange = range.cloneRange();
                        preRange.collapse(true);
                        if (preRange.startOffset > 0) {
                             preRange.setStart(preRange.startContainer, preRange.startOffset - 1);
                             charBefore = preRange.toString();
                        }

                        // Char After
                        const postRange = range.cloneRange();
                        postRange.collapse(false);
                        try {
                            if (postRange.endContainer.nodeType === 3 && postRange.endOffset < postRange.endContainer.length) {
                                postRange.setEnd(postRange.endContainer, postRange.endOffset + 1);
                                charAfter = postRange.toString();
                            }
                        } catch(e) {}
                    }
                }

                // Rule A: Add space if missing
                // If char before is a word char or punctuation, and pasted text starts with word char -> add space
                if (charBefore && (/[\w.!?,;:]/.test(charBefore)) && /^\w/.test(text)) {
                    text = ' ' + text;
                }
                // If char after is a word char, and pasted text ends with word char -> add space
                if (charAfter && /\w/.test(charAfter) && /\w$/.test(text)) {
                    text = text + ' ';
                }

                // Rule B: Remove double space (New Rule)
                if (charBefore === ' ' && text.startsWith(' ')) {
                    text = text.trimStart();
                }
                if (charAfter === ' ' && text.endsWith(' ')) {
                    text = text.trimEnd();
                }

                // 5. Formatting Nuke: Insert as plain text
                tools.replace(text);
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
            execute: (ctx) => {
                ctx.element.focus();
                document.execCommand('delete');
                return { success: true };
            }
        },
        {
            id: 'clear',
            label: 'Clear All',
            category: 'input',
            icon: 'clear',
            condition: (ctx) => ctx.isInput && !ctx.hasText && (ctx.isForm ? ctx.element.value.length > 0 : true),
            execute: (ctx) => {
                ctx.element.focus();
                if (ctx.isForm) {
                    ctx.element.select();
                    const success = document.execCommand('delete');
                    if (!success) {
                        ctx.element.value = '';
                        ctx.element.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                } else { document.execCommand('delete'); }
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
                tools.replace(next);
                return { success: true };
            }
        },
        {
            id: 'spellcheck',
            label: 'Spell',
            category: 'input',
            icon: 'spellcheck',
            condition: (ctx) => {
                if (!ctx.isInput || !ctx.hasText) return false;
                // Single word, has letters, native language
                return ctx.wordCount === 1 && /\p{L}/u.test(ctx.text) && !Utils.isForeign(ctx);
            },
            execute: (ctx) => {
                return { success: true, message: 'Hover for suggestions' };
            },
            preview: async (ctx, tools) => {
                try {
                    const originalText = ctx.text;
                    const word = originalText.trim();
                    const json = await tools.spellcheck(word);
                    
                    if (!json || json.length === 0) return { previewText: 'No suggestions' };
                    
                    // Check if correct (ignoring case)
                    if (json[0].word.toLowerCase() === word.toLowerCase()) {
                        return { previewText: 'Correct ✓' };
                    }
                    
                    const leadingSpace = originalText.match(/^\s*/)[0];
                    const trailingSpace = originalText.match(/\s*$/)[0];
                    
                    // Suggestions found
                    return {
                        type: 'menu',
                        items: json.map(item => ({
                            label: item.word,
                            textOnly: true,
                            onClick: () => {
                                tools.replace(leadingSpace + item.word + trailingSpace);
                                tools.toast('Corrected!');
                            }
                        }))
                    };
                } catch(e) {
                    return { previewText: 'Error checking' };
                }
            }
        },

        // --- TYPE 3: SMART (MATH, CURRENCY, UNITS, DEVTOYS) ---
        {
            id: 'math',
            label: 'Calc',
            category: 'smart',
            icon: 'math',
            condition: (ctx) => !ctx.isLink && ctx.text.length < 50 && (MathLib.safeCalculate(ctx.text) !== null),
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
                const raw = ctx.text.trim();
                if (!/\d/.test(raw) || raw.length > 50) return false;
                const keys = Object.keys(Data.CURRENCY_MAP || {}).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
                // Match: Number + Currency OR Currency + Number
                return new RegExp(`([\\d\\s]+(${keys})|(${keys})[\\d\\s]+)`, 'i').test(raw);
            },
            execute: (ctx) => {
                window.open(buildUrl('https://www.google.com/search?q=%s+convert', ctx.text), '_blank');
                return { success: true };
            },
            preview: async (ctx, tools) => {
                const txt = ctx.text.trim().toUpperCase();
                const amount = MathLib.parseLocaleNumber(txt);
                let base = 'USD';
                for (const [key, val] of Object.entries(Data.CURRENCY_MAP)) { if (txt.includes(key)) { base = val; break; } }
                const target = getStandards().currency || 'USD';
                
                let label = '...';
                if (base !== target) {
                    const rate = await MathLib.fetchRate(base, target);
                    if (rate) label = `${(amount * rate).toFixed(2)} ${target}`;
                    else label = 'Unavailable';
                }
                return {
                    type: 'menu', previewText: label,
                    items: [{
                        label: 'Copy',
                        icon: 'copy',
                        onClick: () => tools.copy(label)
                    }]
                };
            }
        },
        {
            id: 'unit',
            label: 'Unit',
            category: 'smart',
            icon: 'unit',
            condition: (ctx) => {
                const units = Object.keys(Data.UNIT_CONVERSIONS || {}).join('|');
                return new RegExp(`^[\\d,.]+\\s*°?(${units})$`, 'i').test(ctx.cleanText);
            },
            execute: (ctx) => {
                window.open(buildUrl('https://www.google.com/search?q=%s+conversion', ctx.cleanText), '_blank');
                return { success: true };
            },
            preview: (ctx, tools) => {
                const match = ctx.cleanText.toLowerCase().match(/^([\d,.]+)\s*°?(.+)$/);
                if (!match) return { type: 'text', content: '...' };
                const val = parseFloat(match[1].replace(/,/g, ''));
                const unitKey = match[2].replace('°', '');
                const conv = Data.UNIT_CONVERSIONS[unitKey];
                
                const result = conv ? `${conv.func(val).toFixed(2)} ${conv.target}` : '...';
                return {
                    type: 'menu', 
                    previewText: result,
                    items: [{
                        label: 'Copy',
                        icon: 'copy',
                        onClick: () => tools.copy(result)
                    }]
                };
            }
        },
        
        // --- DEVTOYS ---
        {
            id: 'date_convert',
            label: 'Date',
            category: 'smart',
            icon: 'calendar',
            condition: (ctx) => {
                const t = ctx.cleanText;
                if (t.length < 8 || t.length > 50) return false;
                // Timestamp (digits) OR Date string (must have separators or month names)
                if (/^\d{10}(\d{3})?$/.test(t)) return true;
                return !isNaN(Date.parse(t)) && /[\/-]|\s\d{4}|[a-zA-Z]{3}/.test(t);
            },
            execute: (ctx, tools) => {
                const date = parseDate(ctx.cleanText);
                const iso = date.toISOString();
                tools.copy(iso);
                return { success: true, message: `Copied: ${iso}` };
            },
            preview: (ctx) => {
                const date = parseDate(ctx.cleanText);
                // Show Relative Time on hover
                const relativeTime = Utils.getRelativeTime(date);
                const isoString = date.toISOString();
                return {
                    previewText: relativeTime,
                    items: [{
                        label: 'Copy ISO',
                        icon: 'copy',
                        onClick: () => navigator.clipboard.writeText(isoString)
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
                if (t.length < 2) return false;
                if (!t.startsWith('{') && !t.startsWith('[')) return false;
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
                if (t.length < 4 || t.length % 4 !== 0) return false;
                if (!/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return false;
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
            preview: (ctx) => {
                try {
                    const decoded = atob(ctx.cleanText);
                    const safe = decoded.length > 20 ? decoded.substring(0, 20) + '...' : decoded;
                    // Only show if decoded string looks readable
                    if (/[\x00-\x08\x0E-\x1F]/.test(decoded)) return { type: 'text', content: 'Binary Data' };
                    return { type: 'text', content: `"${safe}"` };
                } catch(e) { return null; }
            }
        },
        {
            id: 'color_convert',
            label: 'Color',
            category: 'smart',
            icon: 'palette',
            condition: (ctx) => {
                // Match Hex (#FFF, #000000) or RGB (rgb(0,0,0))
                return /^#([0-9A-F]{3}){1,2}$/i.test(ctx.cleanText) || /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/i.test(ctx.cleanText);
            },
            execute: (ctx, tools) => {
                let res;
                if (ctx.cleanText.startsWith('#')) {
                    // Hex to RGB
                    let hex = ctx.cleanText.substring(1);
                    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
                    const num = parseInt(hex, 16);
                    res = `rgb(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255})`;
                } else {
                    // RGB to Hex
                    const parts = ctx.cleanText.match(/\d+/g);
                    if (parts) {
                        res = '#' + parts.map(p => {
                            const h = parseInt(p).toString(16);
                            return h.length === 1 ? '0' + h : h;
                        }).join('');
                    }
                }
                if(res) {
                    tools.copy(res);
                    return { success: true, message: `Copied: ${res}` };
                }
                return { success: false };
            },
            preview: (ctx) => {
                const color = ctx.cleanText;
                // Create chip via DOM to avoid innerHTML injection from user-selected text
                const chip = document.createElement('span');
                chip.className = 'lighthouse-chip round';
                chip.style.background = color;
                chip.style.marginRight = '6px';
                const label = document.createTextNode(color);
                const wrapper = document.createElement('span');
                wrapper.appendChild(chip);
                wrapper.appendChild(label);
                return { type: 'menu', previewNode: wrapper };
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
                // Return 'content' directly for custom HTML rendering in popover
                return {
                    type: 'html',
                    content: `<img src="${url}" class="qr-code" alt="QR Code" style="display:block; width:150px; height:150px; background:white; padding:4px; border-radius:4px;">`
                };
            }
        },

        // --- SPECIAL: LINKS (Handled separately in State, but defined here for ID check) ---
        // REMOVED: Copy Link is now part of the UI Header
    ];

    global.LighthouseActions = ACTIONS;

})(typeof self !== 'undefined' ? self : window);
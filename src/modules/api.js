/**
 * Lighthouse - Internal Action API
 * Factory for Context and Tools.
 */
(function() {
    const $ = window.LighthouseUtils;
    const SelLib = window.LighthouseSelection;
    const MathLib = window.LighthouseMath;

    /**
     * 1. Context Normalization
     * Built once per selection (so parse caches last the render); in-place changes are copied over.
     */
    const prepared = new WeakMap();
    function countWords(text) {
        if (!text) return 0;
        if (window.LighthouseData.UNSPACED_SCRIPTS.test(text)) return [...$.segmenter('word').segment(text)].filter(s => s.isWordLike).length;
        return text.split(/\s+/).length;
    }

    function prepareContext(rawCtx) {
        const cached = prepared.get(rawCtx);
        if (cached && cached.text === rawCtx.text) {
            Object.assign(cached.ctx, rawCtx);
            return cached.ctx;
        }
        const cleanText = rawCtx.text ? rawCtx.text.trim() : '';
        const baseCtx = {
            ...rawCtx, 
            cleanText: cleanText,
            number: MathLib.parseLocaleNumber(cleanText),
            isEmpty: cleanText.length === 0,
            isSafe: true, 
            wordCount: countWords(cleanText),
            canType: !!rawCtx.isInput && (!rawCtx.element || !window.LighthouseInput || !!window.LighthouseInput.fieldKind(rawCtx.element, { forTyping: true })),
            hasDigit: /\d/.test(cleanText),
            hasLetter: /\p{L}/u.test(cleanText)
        };
        // Inject tools for condition checks that might need them (e.g. math safety)
        baseCtx.tools = getTools(baseCtx);
        prepared.set(rawCtx, { text: rawCtx.text, ctx: baseCtx });
        return baseCtx;
    }

    // How the user most likely writes numeric dates: 'DMY', 'MDY' or 'YMD'
    function orderOfLocale(locale) {
        const first = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(new Date(2026, 11, 31)).find(p => p.type === 'day' || p.type === 'month' || p.type === 'year');
        return first && first.type === 'year' ? 'YMD' : first && first.type === 'month' ? 'MDY' : 'DMY';
    }

    function guessDateOrder() {
        try {
            // Plain English says nothing about where the user is: the time zone decides
            const nav = navigator.language || 'en';
            if (!/^en(-us)?$/i.test(nav)) return orderOfLocale(nav);
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            return window.LighthouseData.MDY_TIME_ZONES.test(tz) ? 'MDY' : window.LighthouseData.YMD_TIME_ZONES.test(tz) ? 'YMD' : 'DMY';
        } catch (e) {
            return 'DMY';
        }
    }

    /** Asks the background worker (one shared answer per question); res[valueKey], or the fallback on failure */
    async function asyncQuery(action, payload, valueKey = 'result', fallback = null) {
        const res = await $.ask(action, payload);
        if (res && res.success) return valueKey ? res[valueKey] : res;
        $.logEvent('API', 'ERROR', res ? res.error : 'No response');
        return fallback;
    }

    /**
     * 2. The Toolkit
     */
    // The one clipboard write
    function copy(text) {
        if (navigator.clipboard) navigator.clipboard.writeText(String(text)).catch(e => console.warn('Lighthouse: Clipboard blocked', e));
    }

    function getTools(ctx) {
        let dateOrder = null;
        return {
            // UI
            toast: (msg, type = 'success') => {
                if (window.LighthouseUI && window.LighthouseUI.showToast) {
                    window.LighthouseUI.showToast(msg, type);
                }
            },
            // For actions that convert values (currency, units): convert every value on the page
            convertPageItem: () => ({
                label: 'Convert page',
                icon: 'refresh',
                onClick: () => window.LighthouseContent && window.LighthouseContent.convertAllOnPage()
            }),

            // A text (translation, definition) with Copy, and any further items
            textPreview(text, extraItems = []) { return this.buildCopyMenu(text, { node: $.create('div', { className: 'lh-text', text }) }, 'Copy', extraItems); },
            buildCopyMenu: (copyText, previewText = copyText, label = 'Copy', extraItems = []) => {
                const items = [{
                    label: label,
                    icon: 'copy',
                    onClick: () => {
                        copy(copyText);
                        if (window.LighthouseUI && window.LighthouseUI.showToast) window.LighthouseUI.showToast('Copied', 'success');
                    }
                }];
                
                items.push(...extraItems);

                return {
                    type: 'menu',
                    previewText: typeof previewText === 'string' ? previewText : undefined,
                    isValue: typeof previewText === 'string',
                    node: typeof previewText !== 'string' ? previewText.node : undefined,
                    items
                };
            },
            
            // Text: the surface where the user is (read and rewrite), and typing-style replacement
            surface: SelLib.surface(ctx.element || undefined),
            replace: (newText, options = {}) => {
                if (ctx.isInput && ctx.element) {
                    SelLib.insertText(ctx, String(newText), options);
                }
            },
            
            // Clipboard
            copy,
            copySelection: () => document.execCommand('copy'),   // keeps formatting
            open: (url) => window.open(url, '_blank'),
            // Collect and Paste (session storage)
            collection: {
                get: async () => { try { return (await chrome.storage.session.get('copyStack')).copyStack || []; } catch (e) { return []; } },
                set: (items) => chrome.storage.session.set({ copyStack: items }).catch(() => {})
            },
            // Read by the extension (background + hidden page), never by the page: no site prompts
            readClipboard: async () => {
                const res = await $.message('READ_CLIPBOARD');
                return res && res.success ? res.text : '';
            },
            
            // Interaction
            expandSelection: () => {
                SelLib.handleExpand();
                // Force update handles
                if (window.LighthouseHandles) {
                    window.LighthouseHandles.hideDragHandles(false);
                    setTimeout(() => {
                        window.LighthouseHandles.setDragHandles();
                    }, 10);
                }
            },
            
            // Network (using Centralized Bridge)
            fetchRate: (base, target) => MathLib.fetchRate(base, target),   // the rate alone
            rate: (base, target) => MathLib.rate(base, target),             // { rate, asOf }, same request
            // A background service's result, or null: TRANSLATE, DEFINE, SPELLCHECK, WIKI_SUMMARY, LINK_PREVIEW
            // (each action builds its own request). One shared answer per question.
            query: (service, payload) => asyncQuery(service, payload, 'result', null),

            // Dates: how numeric dates are written here (worked out once, on first use)
            dateOrder: () => dateOrder || (dateOrder = guessDateOrder()),

            // Math
            math: MathLib 
        };
    }

    window.LighthouseAPI = {
        prepareContext,
        getTools
    };
})();
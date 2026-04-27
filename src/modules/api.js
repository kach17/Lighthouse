
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
     */
    function prepareContext(rawCtx) {
        const cleanText = rawCtx.text ? rawCtx.text.trim() : '';
        const baseCtx = {
            ...rawCtx, 
            cleanText: cleanText,
            number: MathLib.parseLocaleNumber(cleanText),
            isEmpty: cleanText.length === 0,
            isSafe: true, 
            wordCount: cleanText.split(/\s+/).length
        };
        // Inject tools for condition checks that might need them (e.g. math safety)
        baseCtx.tools = getTools(baseCtx);
        return baseCtx;
    }

    /**
     * Centralized Background Messaging Bridge
     */
    function asyncQuery(action, payload, valueKey = 'result', fallback = null) {
        return new Promise(resolve => {
            chrome.runtime.sendMessage({ action, ...payload }, (res) => {
                if (chrome.runtime.lastError) {
                    if ($ && $.logEvent) $.logEvent('API', 'ERROR', chrome.runtime.lastError.message);
                    return resolve(fallback);
                }
                if (res && res.success) {
                    resolve(valueKey ? res[valueKey] : res);
                } else {
                    if ($ && $.logEvent) $.logEvent('API', 'ERROR', res ? res.error : 'Unknown Error');
                    resolve(fallback);
                }
            });
        });
    }

    /**
     * 2. The Toolkit
     */
    function getTools(ctx) {
        return {
            // UI
            toast: (msg, type = 'success') => {
                if (window.LighthouseUI && window.LighthouseUI.showToast) {
                    window.LighthouseUI.showToast(msg, type);
                }
            },
            buildCopyMenu: (copyText, previewText = copyText, label = 'Copy') => {
                const items = [{
                    label: label,
                    icon: 'copy',
                    onClick: () => {
                        if (navigator.clipboard) navigator.clipboard.writeText(String(copyText)).catch(()=>{});
                        if (window.LighthouseUI && window.LighthouseUI.showToast) window.LighthouseUI.showToast('Copied!', 'success');
                    }
                }];
                
                // Add Convert All to these contextual submenus if it looks like there's something to convert
                const t = ctx.cleanText || '';
                if (t.length > 2 && (/\d/.test(t) || /[$£€¥₹₽]/.test(t))) {
                    items.push({
                        label: 'Convert Page',
                        icon: 'refresh',
                        onClick: () => document.dispatchEvent(new CustomEvent('LIGHTHOUSE_CONVERT_ALL'))
                    });
                }

                return {
                    type: 'menu',
                    previewText: typeof previewText === 'string' ? previewText : undefined,
                    content: typeof previewText !== 'string' ? previewText.content : undefined,
                    items
                };
            },
            
            // Text
            replace: (newText, options = {}) => {
                if (ctx.isInput && ctx.element) {
                    SelLib.insertText(ctx, String(newText), options);
                }
            },
            delete: () => {
                if (ctx.isInput && ctx.element) {
                    SelLib.smartDelete(ctx);
                }
            },
            
            // Clipboard
            copy: (text) => {
                const target = String(text);
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(target).catch(e => console.warn('Lighthouse: Clipboard blocked', e));
                } else {
                    console.warn('Lighthouse: Clipboard API not available');
                }
            },
            readClipboard: async () => {
                try {
                    if (navigator.clipboard) return await navigator.clipboard.readText();
                    return '';
                } catch(e) { return ''; }
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
            fetchRate: (base, target) => asyncQuery('GET_RATE', { base, target }, 'rate', null),
            translate: (text) => {
                const s = window.LighthouseState?.settings?.standards;
                return asyncQuery('TRANSLATE', { text, targetLang: s ? s.language : 'en' }, 'result', null);
            },
            define: (text) => {
                const s = window.LighthouseState?.settings?.standards;
                return asyncQuery('DEFINE', { text, targetLang: s ? s.language : 'en' }, 'result', null);
            },
            spellcheck: (text) => asyncQuery('SPELLCHECK', { text }, 'result', []),
            fetchRaw: (url, options = {}) => asyncQuery('FETCH_RAW', { url, options }, 'result', null),

            // Math
            math: MathLib 
        };
    }

    window.LighthouseAPI = {
        prepareContext,
        getTools
    };
})();

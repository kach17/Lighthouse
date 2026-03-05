
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
     * 2. The Toolkit
     */
    function getTools(ctx) {
        return {
            // UI: Now redirects to the Toast system
            toast: (msg, type = 'success') => {
                if (window.LighthouseUI && window.LighthouseUI.showToast) {
                    window.LighthouseUI.showToast(msg, type);
                }
            },
            
            // Text
            replace: (newText) => {
                if (ctx.isInput && ctx.element) {
                    SelLib.insertText(ctx, String(newText));
                }
            },
            
            // Clipboard
            copy: (text) => {
                navigator.clipboard.writeText(String(text));
            },
            readClipboard: async () => {
                try {
                    return await navigator.clipboard.readText();
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
            
            // Network
            fetchRate: (base, target) => {
                return new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: 'GET_RATE', base, target }, (res) => {
                        resolve((res && res.success) ? res.rate : null);
                    });
                });
            },
            translate: (text) => {
                const state = window.LighthouseState;
                const s = (state && state.settings) ? state.settings.standards : null;
                const lang = s ? s.language : 'en';
                return new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: 'TRANSLATE', text, targetLang: lang }, (res) => {
                        resolve((res && res.success) ? res.result : null);
                    });
                });
            },
            define: (text) => {
                const state = window.LighthouseState;
                const s = (state && state.settings) ? state.settings.standards : null;
                const lang = s ? s.language : 'en';
                return new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: 'DEFINE', text, targetLang: lang }, (res) => {
                        resolve((res && res.success) ? res.result : null);
                    });
                });
            },
            spellcheck: (text) => {
                return new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: 'SPELLCHECK', text }, (res) => {
                        resolve((res && res.success) ? res.result : []);
                    });
                });
            },

            // Math
            math: MathLib 
        };
    }

    window.LighthouseAPI = {
        prepareContext,
        getTools
    };
})();

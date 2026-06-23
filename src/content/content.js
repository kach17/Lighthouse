
/**
 * Lighthouse - Main Controller
 */
(function () {
    const UI = window.LighthouseUI;
    const SelLib = window.LighthouseSelection;
    const State = window.LighthouseState;
    const $ = window.LighthouseUtils;

    let linkHoverTimer = null;
    let linkDestroyTimer = null;
    let interactionTimer = null;
    let idleTimer = null;

    function forceCleanup() {
        State.mode = 'HIDDEN';
        UI.destroy();
        if (window.LighthouseHandles) window.LighthouseHandles.hideDragHandles();
    }

    function init() {
        State.init();
        if (UI.init) UI.init();

        if (UI.onDestroy) {
            UI.onDestroy(() => {
                clearTimeout(linkHoverTimer);
                clearTimeout(linkDestroyTimer);
                clearTimeout(interactionTimer);
            });
        }
        const globalEventHandler = (e) => {
            if ((e.type === 'keydown' || e.type === 'keyup') && !e.key) return;
            switch (e.type) {
                case 'mouseup':
                    handleInteraction(e);
                    break;
                case 'keyup':
                    if (e.key === 'Shift' || e.key.startsWith('Arrow')) handleInteraction(e);
                    break;
                case 'keydown':
                    if (e.key === 'Escape') {
                        forceCleanup();
                    } else if (e.key === 'Tab' && State.mode === 'SNIPPET_MENU' && State.activeActions && State.activeActions.length > 0) {
                        e.preventDefault();
                        State.activeActions[0].execute();
                        forceCleanup();
                    } else {
                        const WRAP_PAIRS = { "'": "'", '"': '"', '(': ')', '[': ']', '{': '}', '<': '>' };
                        const AUTO_PAIR = { '(': ')', '[': ']', '{': '}' };

                        const activeEl = document.activeElement;
                        const { isForm, isEditable } = window.LighthouseSelection.isEditableElement(activeEl);

                        if (WRAP_PAIRS[e.key]) {
                            if (isForm && activeEl.selectionStart !== activeEl.selectionEnd) {
                                // wrap selected text
                                e.preventDefault();
                                window.LighthouseSelection.insertText({ isForm: true, element: activeEl }, e.key);
                                forceCleanup();
                            } else if (isForm && AUTO_PAIR[e.key]) {
                                // auto-pair on empty selection
                                e.preventDefault();
                                const pos = activeEl.selectionStart;
                                window.LighthouseSelection.insertText({ isForm: true, element: activeEl }, e.key + AUTO_PAIR[e.key]);
                                activeEl.setSelectionRange(pos + 1, pos + 1);
                            } else if (isEditable) {
                                const sel = window.getSelection();
                                if (sel && !sel.isCollapsed && sel.toString().length > 0) {
                                    // wrap selected text
                                    e.preventDefault();
                                    window.LighthouseSelection.insertText({ isEditable: true, element: activeEl }, e.key);
                                    forceCleanup();
                                } else if (AUTO_PAIR[e.key]) {
                                    // auto-pair on empty selection
                                    e.preventDefault();
                                    document.execCommand('insertText', false, e.key + AUTO_PAIR[e.key]);
                                    const s = window.getSelection();
                                    if (s.rangeCount > 0) {
                                        const r = s.getRangeAt(0);
                                        r.setStart(r.startContainer, r.startOffset - 1);
                                        r.collapse(true);
                                        s.removeAllRanges();
                                        s.addRange(r);
                                    }
                                }
                            }
                        } else if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey) {
                            // intercept only when there is a selection — let normal single-char delete pass through
                            if (isForm && activeEl.selectionStart !== activeEl.selectionEnd) {
                                e.preventDefault();
                                window.LighthouseSelection.insertText({ isForm: true, element: activeEl }, '');
                                forceCleanup();
                            } else if (activeEl && activeEl.isContentEditable) {
                                const sel = window.getSelection();
                                if (sel && !sel.isCollapsed) {
                                    e.preventDefault();
                                    window.LighthouseSelection.insertText({ isEditable: true, element: activeEl }, '');
                                    forceCleanup();
                                }
                            }
                        } else if (e.key === 'x' && (e.metaKey || e.ctrlKey)) {
                            if (isForm && activeEl.selectionStart !== activeEl.selectionEnd) {
                                e.preventDefault();
                                document.execCommand('copy');
                                window.LighthouseSelection.insertText({ isForm: true, element: activeEl }, '');
                                forceCleanup();
                            } else if (activeEl && activeEl.isContentEditable) {
                                const sel = window.getSelection();
                                if (sel && !sel.isCollapsed) {
                                    e.preventDefault();
                                    document.execCommand('copy');
                                    window.LighthouseSelection.insertText({ isEditable: true, element: activeEl }, '');
                                    forceCleanup();
                                }
                            }
                        }
                    }
                    break;
                case 'input': {
                    if ((UI.isActionActive && UI.isActionActive()) || UI.contains(e.target)) return;
                    const { isForm: inputIsForm, isEditable: inputIsEditable } = window.LighthouseSelection.isEditableElement(e.target);
                    if (inputIsForm || inputIsEditable) handleTextExpansion(e);
                    if (State.mode !== 'SNIPPET_MENU') {
                        forceCleanup();
                        clearTimeout(idleTimer);
                        idleTimer = setTimeout(() => {
                            State.lastFocusedInput = null;
                        }, 3000);
                    }
                    break;
                }
                case 'mouseover':
                    handleLinkHover(e);
                    break;
                case 'mouseout':
                    if (e.target.closest('a') || UI.contains(e.target)) {
                        clearTimeout(linkHoverTimer);
                        linkDestroyTimer = setTimeout(() => {
                            if (!UI.contains(e.relatedTarget) && State.mode === 'LINK' && !window.getSelection().toString()) {
                                forceCleanup();
                            }
                        }, 200);
                    }
                    break;
                case 'scroll':
                case 'resize':
                    if (State.mode !== 'HIDDEN' && State.validate()) {
                        UI.updatePosition(State.ctx);
                        if (window.LighthouseHandles && State.ctx.hasText) window.LighthouseHandles.setDragHandles();
                    } else {
                        forceCleanup();
                    }
                    break;
                case 'dragstart':
                case 'blur':
                    if (State.mode !== 'HIDDEN') forceCleanup();
                    break;
                case 'selectionchange': {
                    if (UI.isActionActive && UI.isActionActive()) return;
                    if (State.mode === 'SNIPPET_MENU') return;
                    const sel = window.getSelection();
                    if (sel.isCollapsed) {
                        const el = document.activeElement;
                        if (el && window.LighthouseSelection.isEditableElement(el).isForm) return;
                        if (el && el.isContentEditable) return;
                        forceCleanup();
                    }
                    break;
                }
            }
        };

        // Document Events
        $.EventManager.add(document, 'mouseup', globalEventHandler, true);
        $.EventManager.add(document, 'keyup', globalEventHandler);
        $.EventManager.add(document, 'keydown', globalEventHandler);
        $.EventManager.add(document, 'input', globalEventHandler, true);
        $.EventManager.add(document, 'mouseover', globalEventHandler);
        $.EventManager.add(document, 'mouseout', globalEventHandler);
        $.EventManager.add(document, 'dragstart', globalEventHandler);
        $.EventManager.add(document, 'selectionchange', globalEventHandler);

        // Window Events
        $.EventManager.add(window, 'scroll', globalEventHandler, { capture: true, passive: true });
        $.EventManager.add(window, 'resize', globalEventHandler, { passive: true });
        $.EventManager.add(window, 'blur', globalEventHandler);

        // Initialize Markers
        if (window.LighthouseMarkers) {
            window.LighthouseMarkers.init();
        }

        // Custom Event listener (from Actions/UI in same page)
        document.addEventListener('LIGHTHOUSE_CONVERT_ALL', () => {
            convertAllOnPage();
        });
        // Message Listener
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'LIGHTHOUSE_CONVERT_ALL') {
                convertAllOnPage();
            }
        });
    }

    async function convertAllOnPage() {
        const Config = window.LighthouseConfig;
        const std = (State.settings && State.settings.standards) ? State.settings.standards : Config.defaults.standards;
        const targetCurrency = std.currency || 'USD';
        const targetUnitSystem = std.units || 'metric';

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(node.parentNode.nodeName)) return NodeFilter.FILTER_REJECT;
                if (node.parentNode.classList && (node.parentNode.classList.contains('lighthouse-converted') || node.parentNode.classList.contains('lighthouse-converted-price'))) return NodeFilter.FILTER_REJECT;
                if (node.parentNode.isContentEditable) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        }, false);

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            if (node.nodeValue.trim() !== '') {
                textNodes.push(node);
            }
        }

        const safeFetchRate = (base, target) => {
            return new Promise(resolve => {
                chrome.runtime.sendMessage({ action: 'GET_RATE', base, target }, (res) => {
                    resolve((res && res.success) ? res.rate : null);
                });
            });
        };

        for (const textNode of textNodes) {
            let originalText = textNode.nodeValue;
            let newText = originalText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            if (!window.LighthouseMath || !window.LighthouseMath.convertAllText) continue;
            const result = await window.LighthouseMath.convertAllText(newText, targetCurrency, targetUnitSystem, safeFetchRate);

            if (result.modified) {
                const span = document.createElement('span');
                span.classList.add('lighthouse-converted');
                span.innerHTML = result.text;
                textNode.parentNode.replaceChild(span, textNode);
            }
        }
    }

    function handleTextExpansion(e) {
        const el = e.target;
        if (UI.contains(el)) return;

        // Get current value and cursor position — works for both input and contentEditable
        let val, cursor;
        if (el.isContentEditable) {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            const preRange = document.createRange();
            preRange.selectNodeContents(el);
            preRange.setEnd(range.startContainer, range.startOffset);
            cursor = preRange.toString().length;
            val = el.innerText;
        } else {
            val = el.value;
            cursor = el.selectionEnd;
        }

        // Helper: set selection range for both input and contentEditable
        const setRange = (start, end) => {
            if (el.isContentEditable) {
                const sel = window.getSelection();
                const range = document.createRange();
                let charCount = 0;
                let startNode = null, startOffset = 0, endNode = null, endOffset = 0;
                const walk = (node) => {
                    if (node.nodeType === 3) {
                        const len = node.textContent.length;
                        if (!startNode && charCount + len >= start) {
                            startNode = node;
                            startOffset = start - charCount;
                        }
                        if (!endNode && charCount + len >= end) {
                            endNode = node;
                            endOffset = end - charCount;
                        }
                        charCount += len;
                    } else {
                        node.childNodes.forEach(walk);
                    }
                };
                walk(el);
                if (startNode && endNode) {
                    range.setStart(startNode, startOffset);
                    range.setEnd(endNode, endOffset);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            } else {
                el.setSelectionRange(start, end);
            }
        };

        // Find the start of the current line
        const textBeforeCursor = val.substring(0, cursor);
        const lastNewlineIndex = textBeforeCursor.lastIndexOf('\n');
        const lineStartIndex = lastNewlineIndex === -1 ? 0 : lastNewlineIndex + 1;
        const currentLineText = textBeforeCursor.substring(lineStartIndex);

        // Must contain //
        const matchPos = currentLineText.lastIndexOf('//');
        if (matchPos === -1) {
            if (State.mode === 'SNIPPET_MENU') forceCleanup();
            return;
        }

        // Must start at index 0 or immediately follow a space
        if (matchPos > 0 && currentLineText[matchPos - 1] !== ' ') {
            if (State.mode === 'SNIPPET_MENU') forceCleanup();
            return;
        }

        const triggerTextWithSlashes = currentLineText.substring(matchPos);

        const isSpace = e.data === ' ';
        const isEnter = e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph';

        const rawTrigger = triggerTextWithSlashes.substring(2);
        const triggerTextForMatch = (isSpace || isEnter) ? rawTrigger.substring(0, rawTrigger.length - (isSpace ? 1 : 0)).trim() : rawTrigger.trim();

        const shortcuts = (State.settings && State.settings.shortcuts) ? State.settings.shortcuts : [];
        let matches = shortcuts.filter(s => s.trigger.startsWith(triggerTextForMatch));

        // Handle actual expansion if Space/Enter pressed
        if (isSpace || isEnter) {
            const exactMatch = shortcuts.find(s => s.trigger === triggerTextForMatch);
            if (exactMatch) {
                const lengthToReplace = 2 + triggerTextForMatch.length + (isSpace ? 1 : 0);
                const start = cursor - lengthToReplace;
                if (start >= 0) {
                    setRange(start, cursor);

                    const ctx = SelLib.getContext();
                    const tools = window.LighthouseAPI.getTools(ctx);

                    tools.replace(exactMatch.expansion, {
                        smartIndent: true,
                        startLineText: currentLineText.substring(0, matchPos),
                        smartPunctuation: true,
                        appendSpace: isSpace
                    });
                    forceCleanup();
                }
            } else {
                if (State.mode === 'SNIPPET_MENU') forceCleanup();
            }
            return;
        }

        // Render Snippet Menu UI
        if (matches.length > 0) {
            const ctx = SelLib.getContext();

            ctx.text = triggerTextWithSlashes;
            ctx.hasText = true;

            State.ctx = ctx;
            State.mode = 'SNIPPET_MENU';

            State.activeActions = matches.slice(0, 4).map((match, i) => ({
                id: 'snippet-' + i,
                label: match.trigger,
                icon: 'chat',
                textOnly: true,
                keepOpen: false,
                execute: () => {
                    const start = cursor - triggerTextWithSlashes.length;
                    if (start >= 0) {
                        setRange(start, cursor);

                        const exeCtx = SelLib.getContext();
                        const tools = window.LighthouseAPI.getTools(exeCtx);

                        tools.replace(match.expansion, {
                            smartIndent: true,
                            startLineText: currentLineText.substring(0, matchPos),
                            smartPunctuation: true
                        });
                    }
                    return { success: true };
                },
                preview: () => ({
                    previewText: `<div style="text-align: left; opacity: 0.9; font-family: var(--so-font-mono); font-size: 11px; white-space: pre-wrap; line-height: 1.4;">${match.expansion}</div>`
                })
            }));

            UI.render(State);
        } else {
            if (State.mode === 'SNIPPET_MENU') forceCleanup();
        }
    }

    function handleInteraction(e) {
        if ((UI.isActionActive && UI.isActionActive())) return;
        if (State.settings.blacklist?.includes(window.location.hostname) || UI.contains(e.target)) return;
        if (window.LighthouseHandles && window.LighthouseHandles.isDragging) return;

        State.lastEvent = e;

        // Triple click delay
        const delay = e && e.detail === 3 ? 200 : 0;

        clearTimeout(interactionTimer);
        interactionTimer = setTimeout(() => {
            const ctx = SelLib.getContext();

            // Capture Mouse Coordinates for Pointer-Relative Positioning
            if (e && e.type === 'mouseup') {
                ctx.mouseX = e.clientX;
                ctx.mouseY = e.clientY;
            }

            // Standardize Position Capture for Scrolling Inputs
            if (e && e.type === 'mouseup' && ctx.isForm && ctx.element) {
                const rect = ctx.element.getBoundingClientRect();
                ctx.relativePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            } else if (e && e.type === 'keyup' && ctx.isForm && State.ctx && State.ctx.element === ctx.element) {
                // Preserve relative position on keyboard events if in same element
                ctx.relativePos = State.ctx.relativePos;
            }

            if (State.settings.smartSnapping && e && e.type === 'mouseup' && ctx.hasText) {
                try {
                    SelLib.performSnap(true);
                    // Re-fetch context but preserve mouse data
                    const snapCtx = SelLib.getContext();
                    snapCtx.relativePos = ctx.relativePos;
                    Object.assign(ctx, snapCtx);
                } catch (err) {
                    window.LighthouseUtils.Logger.warn('Lighthouse: Snap error', err);
                }
            }

            State.update(ctx);
            if (State.mode === 'HIDDEN') {
                UI.destroy();
                if (window.LighthouseHandles) window.LighthouseHandles.hideDragHandles();
            } else {
                UI.render(State);
                if (window.LighthouseHandles && ctx.hasText) {
                    window.LighthouseHandles.setDragHandles();
                }
            }
        }, delay);
    }

    function handleLinkHover(e) {
        // Clear destroy timer if we entered UI or a Link
        if (UI.contains(e.target) || e.target.closest('a')) {
            clearTimeout(linkDestroyTimer);
        }

        const link = e.target.closest('a');
        if (!link || link.hostname === window.location.hostname || UI.contains(e.target)) return;

        clearTimeout(linkHoverTimer);
        linkHoverTimer = setTimeout(() => {
            if (!window.getSelection().toString()) {
                const linkCtx = SelLib.getLinkContext(link);
                if (linkCtx) {
                    State.update(linkCtx);
                    if (State.mode === 'LINK') UI.render(State);
                }
            }
        }, 400);
    }

    init();
})();

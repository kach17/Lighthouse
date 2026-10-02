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
            switch (e.type) {
                case 'mousedown':
                    // Third click of a triple-click: the browser selects the paragraph right away, so
                    // the bar leaves now (fading where it was) and rises in for the paragraph once the
                    // click completes, instead of lingering beside the word and then jumping
                    if (e.detail === 3 && e.button === 0 && State.mode !== 'HIDDEN' && !UI.contains(e.target)) forceCleanup();
                    break;
                case 'mouseup':
                    handleInteraction(e);
                    break;
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
                    // A handle drag owns the selection (and auto-scrolls the page); the bar stays
                    // hidden and the handles are positioned by the drag itself until it ends.
                    if (window.LighthouseHandles && window.LighthouseHandles.isDragging) break;
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
                    if (Input.hasSelection()) break;
                    // In a field the caret-only bar stays; a bar for a selection has nothing left to act on
                    const el = document.activeElement;
                    if (Input.fieldKind(el)) {
                        if (State.mode !== 'HIDDEN' && State.ctx && State.ctx.hasText) forceCleanup();
                        return;
                    }
                    forceCleanup();
                    break;
                }
            }
        };

        // Document Events

        // All user input goes through the input manager (input.js), which owns the
        // listeners and the shared filters, and attaches nothing on switched-off sites.
        const Input = window.LighthouseInput;

        // While the bar is open: Escape closes it, Tab accepts the first snippet
        Input.on({ type: 'keydown', scope: 'bar', keys: ['Escape'], handler: () => { forceCleanup(); return true; } });
        Input.on({
            type: 'keydown', scope: 'bar', keys: ['Tab'],
            handler: (e) => {
                if (State.mode !== 'SNIPPET_MENU' || !State.activeActions || !State.activeActions.length) return false;
                e.preventDefault();
                State.activeActions[0].execute();
                forceCleanup();
                return true;
            }
        });

        // Keyboard selections (Shift / Arrow keys) show the bar. Only listened to while there is
        // a selection to extend or a field is focused, so no keys are listened to at rest.
        Input.on({
            type: 'keyup', scope: ['selection', 'editable'], afterSelecting: true, inManagedEditors: true,
            keys: ['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
            handler: (e) => { handleInteraction(e); return false; }
        });

        // An edit is about to happen: the bar steps away, also when the page makes the edit itself (then
        // no input event follows, and editors that handle Backspace/Delete on the key don't send beforeinput)
        const stepAway = () => { if (State.mode !== 'SNIPPET_MENU' && !(UI.isActionActive && UI.isActionActive())) forceCleanup(); return false; };
        Input.on({ type: 'beforeinput', scope: 'editable', inManagedEditors: true, handler: stepAway });
        Input.on({ type: 'keydown', scope: 'editable', inManagedEditors: true, keys: ['Backspace', 'Delete'], handler: stepAway });

        // Typing in a field: snippet detection, and the bar steps away
        Input.on({
            type: 'input', scope: 'editable', inManagedEditors: true,
            handler: (e) => {
                if (UI.isActionActive && UI.isActionActive()) return false;
                handleTextExpansion(e);
                if (State.mode !== 'SNIPPET_MENU') {
                    forceCleanup();
                    clearTimeout(idleTimer);
                    idleTimer = setTimeout(() => { State.lastFocusedInput = null; }, 3000);
                }
                return false;
            }
        });

        // Smart editing helpers (tidy spacing, brackets and quotes)
        if (window.LighthouseEditing) window.LighthouseEditing.init({ onEdit: forceCleanup });

        // Window Events
        // Pointer, selection and window events
        ['mousedown', 'mouseup', 'mouseover', 'mouseout', 'dragstart', 'selectionchange', 'scroll', 'resize', 'blur']
            .forEach(type => Input.on({ type, scope: 'page', handler: globalEventHandler }));

        // Initialize Markers
        if (window.LighthouseMarkers) {
            window.LighthouseMarkers.init();
        }

        // Message Listener
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.type === 'LIGHTHOUSE_CONVERT_ALL') {
                convertAllOnPage();
            }
        });
    }

    // Called by the "Convert page" item and the popup. Not a page event: pages can't trigger it.
    window.LighthouseContent = { convertAllOnPage: () => convertAllOnPage() };

    async function convertAllOnPage() {
        const Config = window.LighthouseConfig;
        const std = State.get('standards', null) || Config.defaults.standards;
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

        const safeFetchRate = window.LighthouseMath.fetchRate;

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

        // The current line up to the caret. Where the caret can't be read (email): the value, with a
        // trigger counting only at its end
        const surface = SelLib.surface(el);
        const read = surface.precise ? surface.read({ before: 'line' }) : surface.read('all');
        if (!read) return;
        const currentLineText = surface.precise ? read.before : read.text;

        // Replace what was typed (just before the caret) with the expansion, as typing it would
        const expand = (typed, expansion, options) => {
            if (surface.precise) window.LighthouseAPI.getTools(SelLib.getContext()).replace(expansion, { ...options, span: { before: { text: typed } } });
            else surface.rewrite('all', ({ text }) => ({ text: text.slice(0, text.length - typed.length) + expansion }));   // one edit: undo still works
        };

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

        // The typed space is in the value, except where the browser trims it (email)
        const spaceInValue = isSpace && /\s$/.test(currentLineText);   // rich text types it as a no-break space

        const rawTrigger = triggerTextWithSlashes.substring(2);
        const triggerTextForMatch = (isSpace || isEnter) ? rawTrigger.substring(0, rawTrigger.length - (spaceInValue ? 1 : 0)).trim() : rawTrigger.trim();

        const shortcuts = State.get('shortcuts', []);
        let matches = shortcuts.filter(s => s.trigger.startsWith(triggerTextForMatch));

        // Handle actual expansion if Space/Enter pressed
        if (isSpace || isEnter) {
            const exactMatch = shortcuts.find(s => s.trigger === triggerTextForMatch);
            if (exactMatch) {
                const lengthToReplace = 2 + triggerTextForMatch.length + (spaceInValue ? 1 : 0);
                if (lengthToReplace <= currentLineText.length) {
                    expand(currentLineText.slice(-lengthToReplace), exactMatch.expansion, {
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
                    expand(triggerTextWithSlashes, match.expansion, {
                        smartIndent: true,
                        startLineText: currentLineText.substring(0, matchPos),
                        smartPunctuation: true
                    });
                    return { success: true };
                },
                preview: () => ({
                    node: $.create('div', { className: 'lh-snippet', text: match.expansion })
                })
            }));

            UI.render(State);
        } else {
            if (State.mode === 'SNIPPET_MENU') forceCleanup();
        }
    }

    function handleInteraction(e) {
        if ((UI.isActionActive && UI.isActionActive())) return;
        if (State.isDisabledHere() || UI.contains(e.target)) return;
        if (window.LighthouseHandles && window.LighthouseHandles.isDragging) return;

        State.lastEvent = e;

        // Triple click delay
        const delay = e && e.detail === 3 ? 200 : 0;

        clearTimeout(interactionTimer);
        interactionTimer = setTimeout(async () => {
            const ctx = SelLib.getContext();

            // Capture Mouse Coordinates for Pointer-Relative Positioning
            if (e && e.type === 'mouseup') {
                ctx.mouseX = e.clientX;
                ctx.mouseY = e.clientY;
            }

            if (State.get('smartSnapping', true) && e && e.type === 'mouseup' && ctx.hasText) {
                try {
                    SelLib.performSnap(true);
                    // Re-fetch context but preserve mouse data
                    const snapCtx = SelLib.getContext();
                    Object.assign(ctx, snapCtx);
                } catch (err) {
                    window.LighthouseUtils.Logger.warn('Lighthouse: Snap error', err);
                }
            }

            // Decided once per selection, on-device (at most a few ms): the text's language, and
            // whether it is foreign to the user
            if (window.LighthouseLanguage) {
                const { foreign, language, reliable } = await window.LighthouseLanguage.inspect(ctx);
                ctx.foreign = foreign;
                ctx.language = language;
                ctx.languageReliable = reliable === true;
                if (SelLib.getContext().text !== ctx.text) return;   // changed meanwhile (e.g. already deleted)
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
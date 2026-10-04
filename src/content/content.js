/**
 * Lighthouse - Main Controller
 * Connects the input manager's events to the pipeline (selectionChanged) and to the bar's state machine.
 */
(function () {
    const UI = window.LighthouseUI, SelLib = window.LighthouseSelection, State = window.LighthouseState;
    const Handles = window.LighthouseHandles, Input = window.LighthouseInput, $ = window.LighthouseUtils;

    let linkHoverTimer = null, linkDestroyTimer = null, interactionTimer = null, selectionRun = 0;
    const close = () => State.send('close');

    function init() {
        State.init();
        UI.init();
        Handles.onRelease(() => selectionChanged('drag'));   // a released handle: the same pipeline
        // The words for prices and measurements in this reader's languages and the page's, once the page is idle
        requestIdleCallback(() => window.LighthouseMath.loadWords([...window.LighthouseLanguage.userLanguages(), window.LighthouseData.baseLanguage(window.LighthouseLanguage.pageLanguage())]));
        UI.onDestroy(() => [linkHoverTimer, linkDestroyTimer, interactionTimer].forEach(clearTimeout));

        // What the state machine (state.js) shows, moves and hides
        State.connect({
            show: (withHandles, inPlace) => { UI.render(State, { inPlace }); if (withHandles) Handles.show(); },
            place: (withHandles) => { UI.updatePosition(State.ctx); if (withHandles) Handles.show(); },
            hide: (barOnly) => { UI.destroy(); if (!barOnly) Handles.hide(); }
        });

        // All input goes through the input manager (input.js): it attaches only what the active scopes
        // need, and nothing on switched-off sites. Each event becomes one pipeline run or one named event.
        // Order matters: a handler that returns true has handled the event, and later ones are skipped.
        const on = (type, scope, handler, extra = {}) => Input.on({ type, scope, handler: (e) => handler(e) || false, ...extra });
        const editor = { inManagedEditors: true };

        // While the bar is open: Escape closes it, Tab accepts the first snippet
        on('keydown', 'bar', () => { close(); return true; }, { keys: ['Escape'] });
        on('keydown', 'bar', (e) => {
            if (State.mode !== 'SNIPPET_MENU' || !State.activeActions.length) return;
            e.preventDefault();
            State.activeActions[0].execute();
            close();
            return true;
        }, { keys: ['Tab'] });
        // Keyboard selections (Shift / arrows); only while there is a selection to extend or a field is focused
        on('keyup', ['selection', 'editable'], (e) => selectionChanged('key', e),
            { afterSelecting: true, keys: ['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], ...editor });
        // In a field: an edit about to happen (also one the page makes itself, which sends no input event),
        // leaving it (coming back is a first click again), and typing (snippets)
        on('beforeinput', 'editable', () => State.send('edit'), editor);
        on('keydown', 'editable', () => State.send('edit'), { keys: ['Backspace', 'Delete'], ...editor });
        on('focusout', 'editable', (e) => State.send('fieldLeft', { to: e.relatedTarget }), editor);
        on('input', 'editable', (e) => { if (!State.acting) { handleTextExpansion(e); State.send('typed'); } }, editor);
        window.LighthouseEditing.init({ onEdit: close });   // tidy spacing, brackets and quotes

        // The third click of a triple-click: the bar leaves now and returns for the paragraph
        on('mousedown', 'page', (e) => { if (e.detail === 3 && e.button === 0 && State.mode !== 'HIDDEN' && !UI.contains(e.target)) close(); });
        on('mouseup', 'page', (e) => selectionChanged('pointer', e));
        on('mouseover', 'page', handleLinkHover);
        on('mouseout', 'page', handleLinkOut);
        on('dragstart', 'page', () => { if (State.mode !== 'HIDDEN') close(); });
        on('selectionchange', 'page', () => { if (!Input.hasSelection()) State.send('selectionLost', { inField: !!Input.fieldKind(Input.focusedElement()) }); });
        on('scroll', 'page', () => State.send('moved'));
        on('resize', 'page', () => State.send('moved'));
        on('blur', 'page', () => { if (State.mode !== 'HIDDEN') close(); });
        window.LighthouseMarkers.init();

        chrome.runtime.onMessage.addListener((request) => { if (request.type === 'LIGHTHOUSE_CONVERT_ALL') convertAllOnPage(); });
    }

    // Called by the "Convert page" item and the popup. Not a page event: pages can't trigger it.
    // refresh: the bar stays after an action (keepOpen) and shows what fits the selection now
    window.LighthouseContent = { convertAllOnPage: () => convertAllOnPage(), refresh: () => selectionChanged('refresh') };

    // Every price and measurement in the page's text, in the user's currency and units
    async function convertAllOnPage() {
        const { currency, units } = State.get('standards');
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (node) => {
            const el = node.parentNode;
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(el.nodeName) || el.isContentEditable) return NodeFilter.FILTER_REJECT;
            if (el.classList && (el.classList.contains('lighthouse-converted') || el.classList.contains('lighthouse-converted-price'))) return NodeFilter.FILTER_REJECT;
            return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        } });
        const nodes = [];
        for (let n; (n = walker.nextNode());) nodes.push(n);
        for (const node of nodes) {
            const text = await window.LighthouseMath.convertText(node.nodeValue, currency, units);
            if (text === null) continue;
            node.parentNode.replaceChild($.create('span', { className: 'lighthouse-converted', text }), node);
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
            State.send('snippetsGone');
            return;
        }

        // Must start at index 0 or immediately follow a space
        if (matchPos > 0 && currentLineText[matchPos - 1] !== ' ') {
            State.send('snippetsGone');
            return;
        }

        const triggerTextWithSlashes = currentLineText.substring(matchPos);

        const isSpace = e.data === ' ';
        const isEnter = e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph';

        // The typed space is in the value, except where the browser trims it (email)
        const spaceInValue = isSpace && /\s$/.test(currentLineText);   // rich text types it as a no-break space

        const rawTrigger = triggerTextWithSlashes.substring(2);
        const triggerTextForMatch = (isSpace || isEnter) ? rawTrigger.substring(0, rawTrigger.length - (spaceInValue ? 1 : 0)).trim() : rawTrigger.trim();

        const shortcuts = State.get('shortcuts');
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
                    close();
                }
            } else {
                State.send('snippetsGone');
            }
            return;
        }

        // Render Snippet Menu UI
        if (matches.length > 0) {
            const ctx = SelLib.getContext();

            ctx.text = triggerTextWithSlashes;
            ctx.hasText = true;

            State.send('snippets', { ctx, actions: matches.slice(0, 4).map((match, i) => ({
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
            })) });
        } else {
            State.send('snippetsGone');
        }
    }

    // The one way a changed selection reaches the bar. reason: 'pointer' (a mouse up, a click into a field),
    // 'key' (a selecting key), 'drag' (a handle released) or 'refresh' (an action that keeps the bar open). Waits for a triple-click to land, reads the
    // selection, snaps a pointer selection (then reads it again), and once its language is known shows the
    // bar, if the selection is still the one that was read.
    function selectionChanged(reason, e = null) {
        const refresh = reason === 'refresh';
        if ((State.busy && !refresh) || State.isDisabledHere()) return;   // a keep-open action or a drag owns the selection
        if (e) {
            if (UI.contains(e.target) || UI.pressed) return;   // a click on the bar, not on the page
            State.lastEvent = e;
        }
        const pointer = reason === 'pointer' ? e : null;
        clearTimeout(interactionTimer);
        const run = ++selectionRun;   // a later selection supersedes this one, also while it waits below
        interactionTimer = setTimeout(async () => {
            // Lighthouse hears the mouseup first (capture), so this runs before the page's own follow-up to it.
            // Editors that keep their own selection (ProseMirror: Claude, Tiptap) write it back to the page in a
            // task queued from their mouseup, which would undo a snap made before it: wait one task behind it
            if (pointer) { await new Promise(r => setTimeout(r, 0)); if (run !== selectionRun) return; }
            let ctx = SelLib.getContext(pointer);
            if (pointer && ctx.hasText && State.get('smartSnapping')) {
                try { SelLib.performSnap(); ctx = SelLib.getContext(pointer); } catch (err) { /* text it can't snap: as selected */ }
            }
            const { foreign, language, reliable } = await ctx.snapshot.language;   // on-device, at most a few ms
            if (!SelLib.isCurrent(ctx.snapshot)) return;   // changed meanwhile (e.g. already deleted)
            Object.assign(ctx, { foreign, language, languageReliable: reliable === true });
            State.send('selected', { ctx, inPlace: refresh });
        }, pointer && pointer.detail === 3 ? 200 : 0);   // a triple-click's paragraph lands after the click
    }

    // Hovering an external link shows its bar; leaving it (and not into the bar) closes that bar
    function handleLinkHover(e) {
        if (UI.atLastPress(e)) return;   // the pointer hasn't moved since a click on the bar: the bar closed over the link
        const link = e.target.closest('a');
        if (link || UI.contains(e.target)) clearTimeout(linkDestroyTimer);
        if (!link || link.hostname === window.location.hostname || UI.contains(e.target)) return;
        clearTimeout(linkHoverTimer);
        linkHoverTimer = setTimeout(() => {
            const ctx = !window.getSelection().toString() && SelLib.getLinkContext(link);
            if (ctx) State.send('link', { ctx });
        }, 400);
    }

    function handleLinkOut(e) {
        if (!e.target.closest('a') && !UI.contains(e.target)) return;
        clearTimeout(linkHoverTimer);
        linkDestroyTimer = setTimeout(() => {
            if (!UI.contains(e.relatedTarget) && State.mode === 'LINK' && !window.getSelection().toString()) close();
        }, 200);
    }

    init();
})();
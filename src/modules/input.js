/**
 * Lighthouse - Input Manager
 *
 * The only place that listens to user input: keyboard, editing, pointer, selection, scroll.
 * Features subscribe with a scope, and every event passes through one shared filter pipeline
 * before any feature sees it.
 *
 * Scopes (where a subscription applies):
 *   'page'      anywhere
 *   'editable'  focus is in a text field or simple editable area
 *   'bar'       the bar (or snippet menu) is open
 *   'drag'      a selection handle is being dragged
 *   'selection' text is currently selected, in the page or inside a text field
 * A subscription may name several scopes; it applies while any of them is active.
 *
 * Browser listeners are attached lazily, only while an active subscription needs them.
 * On sites where Lighthouse is switched off, nothing is attached at all.
 *
 * PRIVACY: input is only inspected to decide whether a feature applies.
 * Nothing is ever stored, logged or sent anywhere.
 */
(function (global) {
    // Where each event is listened to, and how (unchanged from the original listeners)
    const EVENTS = {
        keydown:         { on: () => document, options: true },    // capture: before editors that stop keys
        keyup:           { on: () => document, options: true },
        beforeinput:     { on: () => document, options: true },
        input:           { on: () => document, options: true },
        paste:           { on: () => document, options: true },
        mousedown:       { on: () => document, options: true },
        mouseup:         { on: () => document, options: true },
        mousemove:       { on: () => document, options: false },
        mouseover:       { on: () => document, options: false },
        mouseout:        { on: () => document, options: false },
        dragstart:       { on: () => document, options: false },
        selectionchange: { on: () => document, options: false },
        focusout:        { on: () => document, options: true },
        scroll:          { on: () => global,   options: { capture: true, passive: true } },
        resize:          { on: () => global,   options: { passive: true } },
        blur:            { on: () => global,   options: false }
    };
    const TYPING_EVENTS = new Set(['keydown', 'keyup', 'beforeinput', 'input', 'paste']);

    // Editors that manage their own text: typing helpers step aside here unless a
    // subscription explicitly opts in (e.g. snippet detection).
    const MANAGED_EDITORS = [
        '.cm-editor', '.CodeMirror', '.monaco-editor', '.ace_editor',   // code editors
        '.ProseMirror', '[data-lexical-editor]', '[data-slate-editor]', // rich-text frameworks
        '.ql-editor', '.DraftEditor-root', '.ck-editor__editable', '.tox-edit-area',
        '.notion-page-content', '[data-content-editable-leaf]'          // Notion
    ].join(',');

    // The one definition of "a text field". Controls that never hold free text (pickers included), and password fields:
    const NON_TEXT_CONTROLS = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio',
        'range', 'reset', 'submit', 'password', 'date', 'datetime-local', 'month', 'week', 'time'];
    // Fields where typing helpers would corrupt input: structured values, card numbers and codes
    const SENSITIVE_AUTOCOMPLETE = /\b(cc-|one-time-code|current-password|new-password)/i;
    const STRUCTURED_FIELDS = ['email', 'number', 'url', 'tel'];

    const subscriptions = new Set();
    const activeScopes = new Set(['page']);
    const attached = new Set();

    // ---------- Shared definitions ----------

    const targetOf = (e) => (e.composedPath ? e.composedPath()[0] : e.target) || e.target;

    /**
     * What kind of text surface an element is: 'form' (input/textarea), 'editable'
     * (contentEditable) or null. With { forTyping: true }, fields holding structured
     * values (email, number, url, tel) and card numbers or codes are excluded too.
     */
    function fieldKind(el, { forTyping = false } = {}) {
        if (!el || el.nodeType !== 1) return null;
        if (el.tagName === 'TEXTAREA') return 'form';
        if (el.tagName === 'INPUT') {
            const type = (el.type || 'text').toLowerCase();
            if (NON_TEXT_CONTROLS.includes(type)) return null;
            if (forTyping && (STRUCTURED_FIELDS.includes(type) || isSensitive(el))) return null;
            return 'form';
        }
        if (el.isContentEditable) return 'editable';
        return null;
    }

    const isSensitive = (el) => SENSITIVE_AUTOCOMPLETE.test(el.getAttribute('autocomplete') || '');

    // The fields the browser enforces maxlength on (the HTML spec: these input types and textarea)
    const LENGTH_LIMIT_TYPES = ['text', 'search', 'url', 'tel', 'email'];

    /**
     * The length limit a field states and the browser enforces: { length, max }, or null when it states
     * none. Counted as the browser counts it: UTF-16 code units of the value, so an emoji is 2 and a line
     * break 1. Only what the field itself declares, never a guess.
     */
    function lengthLimit(el) {
        if (!el || !(el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && LENGTH_LIMIT_TYPES.includes((el.type || 'text').toLowerCase())))) return null;
        return el.maxLength >= 0 ? { length: el.value.length, max: el.maxLength } : null;
    }

    /** A field whose caret and selection can be read and set. The browser answers: email and number can't. */
    const hasOffsets = (el) => !!el && typeof el.selectionStart === 'number';

    function isPasswordField(el) {
        return !!el && el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'password';
    }

    function isInsideExtension(el) {
        return !!(global.LighthouseUI && global.LighthouseUI.contains && global.LighthouseUI.contains(el));
    }

    function isDisabledHere() {
        return !!(global.LighthouseState && global.LighthouseState.isDisabledHere && global.LighthouseState.isDisabledHere());
    }

    function isComposing(e) {
        return e.isComposing || e.keyCode === 229;
    }

    // ---------- Filters and dispatch ----------

    const scopesOf = (sub) => Array.isArray(sub.scope) ? sub.scope : [sub.scope];
    const isActive = (sub) => scopesOf(sub).some(s => activeScopes.has(s));

    function accepts(sub, e, target) {
        if (!isActive(sub)) return false;
        const scopes = scopesOf(sub);
        if (scopes.includes('editable') && fieldKind(target)) {
            // From a text field: the field rules apply
            if (isInsideExtension(target)) return false;
            if (!sub.inManagedEditors && target.closest && target.closest(MANAGED_EDITORS)) return false;
        } else if (!scopes.some(sc => sc !== 'editable' && activeScopes.has(sc))) {
            // Not from a field: needs another of its scopes to be active
            return false;
        }
        if (e.type === 'keydown' || e.type === 'keyup') {
            if (!e.key) return false;
            if (e.repeat && !sub.allowRepeat) return false;
            if (sub.withCommand && !(e.ctrlKey || e.metaKey)) return false;
            if (sub.keys && !sub.keys.includes(e.key)) return false;
            if (sub.afterSelecting && (pressInterrupted || !hasSelection())) return false;
        }
        if (sub.typingHelper && !fieldKind(target, { forTyping: true })) return false;
        return true;
    }

    function focusedElement() {
        const active = document.activeElement;
        return active && active.shadowRoot && active.shadowRoot.activeElement ? active.shadowRoot.activeElement : active;
    }

    /** Text is selected: in the page, or inside the focused input/textarea (which keeps its own) */
    function hasSelection() {
        const el = focusedElement();
        if (fieldKind(el) === 'form' && !isSensitive(el)) return hasOffsets(el) && el.selectionStart !== el.selectionEnd;
        const sel = document.getSelection();
        return !!sel && !sel.isCollapsed && sel.toString().length > 0;
    }

    // 'selection' is active only while text is selected. Selection events carry no content.
    function trackSelection() {
        const selected = hasSelection();
        if (selected !== activeScopes.has('selection')) {
            if (selected) activeScopes.add('selection'); else activeScopes.delete('selection');
            sync();
        }
    }

    // A key press that moved focus (Shift+Tab) or edited text (a wrapping bracket) did not make a selection
    let pressInterrupted = false;

    function dispatch(e) {
        if (e.type === 'selectionchange') trackSelection();
        if (e.type === 'keydown' && !e.repeat) pressInterrupted = false;
        if (e.type === 'beforeinput' || e.type === 'input') pressInterrupted = true;
        const target = targetOf(e);
        if (TYPING_EVENTS.has(e.type)) {
            if (isPasswordField(target)) return;
            if (isComposing(e)) return;
        }
        for (const sub of subscriptions) {
            if (sub.type !== e.type || !accepts(sub, e, target)) continue;
            // A handler returns true when it has handled the event; later ones are skipped.
            // The page itself always still receives the event (no stopPropagation).
            if (sub.handler(e, { target }) === true) break;
        }
    }

    // ---------- Lazy attachment ----------

    function needed(type) {
        if (isDisabledHere()) return false;
        for (const sub of subscriptions) {
            if (sub.type === type && isActive(sub)) return true;
            // Tracking the 'selection' scope needs selection events
            if (type === 'selectionchange' && scopesOf(sub).includes('selection')) return true;
            // Knowing whether a press was interrupted needs its start
            if (type === 'keydown' && sub.afterSelecting && isActive(sub)) return true;
        }
        return false;
    }

    function sync() {
        for (const type of Object.keys(EVENTS)) {
            const want = needed(type);
            const { on, options } = EVENTS[type];
            if (want && !attached.has(type)) {
                on().addEventListener(type, dispatch, options);
                attached.add(type);
            } else if (!want && attached.has(type)) {
                on().removeEventListener(type, dispatch, options);
                attached.delete(type);
            }
        }
    }

    // 'editable' is active only while focus is in a text field. Focus events carry no content.
    function onFocusChange() {
        pressInterrupted = true;
        const el = focusedElement();
        const editable = !!fieldKind(el) && !isSensitive(el) && !isInsideExtension(el);
        if (editable) activeScopes.add('editable'); else activeScopes.delete('editable');
        sync();
    }
    document.addEventListener('focusin', onFocusChange, true);
    document.addEventListener('focusout', () => setTimeout(onFocusChange, 0), true);

    // ---------- Public API ----------

    global.LighthouseInput = {
        /**
         * Subscribe to an input event.
         *   type:             one of the EVENTS keys
         *   scope:            'page' | 'editable' | 'bar' | 'drag' | 'selection', or a list of them
         *   keys:             optional list of e.key values to match
         *   withCommand:      require Ctrl/Cmd (e.g. Ctrl+X)
         *   allowRepeat:      also receive automatic key repeats
         *   inManagedEditors: also run inside editors that manage their own text
         *   typingHelper:     changes what is typed, so not in structured fields (email, url...)
         *   afterSelecting:   only when text is selected and the key press didn't move focus or edit
         *   handler(e, info): return true when the event was handled
         * @returns {function} unsubscribe
         */
        on(sub) {
            subscriptions.add(sub);
            sync();
            return () => { subscriptions.delete(sub); sync(); };
        },
        activate(scope) { activeScopes.add(scope); sync(); },
        deactivate(scope) { if (scope !== 'page') { activeScopes.delete(scope); sync(); } },
        /** Re-evaluate listeners, e.g. after settings change (site switched on or off) */
        refresh: sync,
        fieldKind,
        lengthLimit,
        hasOffsets,
        hasSelection,
        focusedElement
    };
})(window);
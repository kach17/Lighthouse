/**
 * Lighthouse - State
 * The settings, and the bar's state machine: which bar shows, with which actions, and why.
 * Touches no DOM: content.js connects the effects.
 */
(function(global) {
    const Config = global.LighthouseConfig, Defaults = Config.defaults;
    const Actions = global.LighthouseActions;

    const State = {
        settings: { ...Defaults },   // until the stored ones load
        ctx: null,                   // the context the bar is for
        mode: 'HIDDEN',
        lastFocusedInput: null,      // the field the caret bar was last shown for (the first-click rule)
        activeActions: [],           // the bar's actions, in order
        lastEvent: null,             // the last pointer or key event (a fallback position)

        // Settings: loaded once and kept current, only ever valid ones (config.js declares them), so a reader
        // never needs a fallback. New actions are added to stored settings by the background
        init: function() {
            chrome.storage.sync.get(Defaults, (items) => { this.settings = { ...Defaults, ...Config.validOnly(items) }; global.LighthouseInput.refresh(); });
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'sync') return;
                for (const key in changes) if (key in Defaults) this.settings[key] = Config.validOnly({ [key]: changes[key].newValue })[key] ?? Defaults[key];
                global.LighthouseInput.refresh();   // e.g. site switched off
            });
        },

        /** The one way to read a setting */
        get: function(key) { return this.settings[key]; },
        set: function(key, value) {
            this.settings[key] = value;
            chrome.storage.sync.set({ [key]: value });
        },

        /** Whether the user has switched Lighthouse off for this site */
        isDisabledHere: function() {
            return this.get('blacklist').includes(global.location.hostname);
        },

        /**
         * The bar's state machine: the one owner of what the bar is doing. Every change arrives as a named
         * event through send(); nothing else writes mode, the field memory or the busy flags.
         *
         *   mode      HIDDEN | SELECTION | SMART | INPUT | LINK | SNIPPET_MENU | DRAGGING
         *   acting    a keep-open action (Case) is running: the bar stays as it is
         *   field     the field the caret bar was last shown for (the first-click rule)
         *
         *   event          from                        to
         *   selected       not DRAGGING, !acting       decide(ctx): HIDDEN, LINK, INPUT, SMART or SELECTION
         *                  (inPlace: a keep-open action's refresh, also while acting: the bar stays where it is)
         *   link           any, !acting                decide(ctx)
         *   snippets       any                         SNIPPET_MENU
         *   snippetsGone   SNIPPET_MENU                HIDDEN
         *   close          any                         HIDDEN
         *   moved          not DRAGGING                the same (bar and handles follow), or HIDDEN if no longer valid
         *   edit           not SNIPPET_MENU, !acting   HIDDEN
         *   typed          not SNIPPET_MENU            HIDDEN, and the field is forgotten after 3 s
         *   selectionLost  not SNIPPET_MENU/DRAGGING, !acting
         *                                              HIDDEN (in a field: only a bar for selected text)
         *   fieldLeft      any                         same mode; the field is forgotten
         *   dragStart      any                         DRAGGING (the bar goes; the handles stay)
         *   dragEnd        DRAGGING                    the mode before the drag
         *   actStart/End   any                         acting on / off
         *   (a released handle sends dragEnd, then its selection arrives as `selected`)
         */
        acting: false,
        _beforeDrag: 'HIDDEN',
        _idleTimer: null,
        _effects: { show: () => {}, hide: () => {} },

        /** effects: show(withHandles, inPlace) renders the bar (inPlace: where it is); place(withHandles) moves it to the selection; hide(barOnly) removes it */
        connect: function(effects) { this._effects = effects; },

        /** Whether a new selection may be read now (not during a keep-open action or a drag) */
        get busy() { return this.acting || this.mode === 'DRAGGING'; },

        send: function(event, data = {}) {
            const was = this.mode, fx = this._effects;
            const hide = () => { this.mode = 'HIDDEN'; this.activeActions = []; fx.hide(); };
            switch (event) {
                case 'selected':   // inPlace: the bar refreshed by its own keep-open action (allowed while acting)
                    if (this.busy && !data.inPlace) return;
                    this.decide(data.ctx);
                    if (this.mode === 'HIDDEN') fx.hide(); else fx.show(data.ctx.hasText, data.inPlace);
                    return;
                case 'link':
                    if (this.acting) return;
                    this.decide(data.ctx);
                    if (this.mode === 'LINK') fx.show(false);
                    return;
                case 'snippets':
                    this.ctx = data.ctx;
                    this.mode = 'SNIPPET_MENU';
                    this.activeActions = data.actions;
                    fx.show(false);
                    return;
                case 'snippetsGone':
                    if (was === 'SNIPPET_MENU') hide();
                    return;
                case 'close':
                    hide();
                    return;
                case 'moved':   // scrolled or resized: the bar and handles follow, or go if what they were for is gone
                    if (was === 'DRAGGING') return;   // the drag positions the handles itself
                    if (was !== 'HIDDEN' && this._stillValid()) fx.place(this.ctx.hasText); else hide();
                    return;
                case 'edit':
                    if (was !== 'SNIPPET_MENU' && !this.acting) hide();
                    return;
                case 'typed':
                    if (was === 'SNIPPET_MENU') return;
                    hide();
                    clearTimeout(this._idleTimer);
                    this._idleTimer = setTimeout(() => { this.lastFocusedInput = null; }, 3000);
                    return;
                case 'selectionLost':
                    if (this.acting || was === 'SNIPPET_MENU' || was === 'DRAGGING') return;
                    if (data.inField && !(was !== 'HIDDEN' && this.ctx && this.ctx.hasText)) return;   // the caret bar stays
                    hide();
                    return;
                case 'fieldLeft': {
                    const field = this.lastFocusedInput;
                    if (field && !(data.to && field.contains(data.to))) this.lastFocusedInput = null;
                    return;
                }
                case 'dragStart':
                    if (was !== 'DRAGGING') this._beforeDrag = was;
                    this.mode = 'DRAGGING';
                    fx.hide(true);
                    return;
                case 'dragEnd':
                    if (was === 'DRAGGING') this.mode = this._beforeDrag;
                    return;
                case 'actStart': this.acting = true; return;
                case 'actEnd': this.acting = false; return;
            }
        },

        /**
         * Which bar a context gets: the mode and its actions. Enforces the "First Click" rule for inputs.
         */
        decide: function(rawCtx) {
            this.ctx = rawCtx;
            const apiCtx = global.LighthouseAPI.prepareContext(rawCtx);
            const set = (mode, actions) => { this.mode = mode; this.activeActions = actions; };

            // Leaving fields: coming back to one is a first click again
            if (!rawCtx.isInput) this.lastFocusedInput = null;

            if (rawCtx.isLink) return set('LINK', this._filterActions('link', apiCtx));
            if (!rawCtx.hasText && !rawCtx.isInput) return set('HIDDEN', []);

            if (rawCtx.isInput) {
                // Text selected in the field: always shown. Its field is remembered, so a click that
                // collapses the selection counts as a later click and hides the bar
                if (rawCtx.hasText) {
                    this.lastFocusedInput = rawCtx.element;
                    const smart = this._filterActions('smart', apiCtx);   // content-matched first, as on the page
                    return set('INPUT', this.orderActions([...this._filterActions('input', apiCtx), ...smart], smart));
                }
                // Caret only: shown on the first click into a field, not on later clicks while editing
                if (rawCtx.element === this.lastFocusedInput && !rawCtx.isEmptyInput) return set('HIDDEN', []);
                const actions = this._filterActions('input', apiCtx);
                if (!actions.length) return set('HIDDEN', []);
                this.lastFocusedInput = rawCtx.element;
                return set('INPUT', actions);
            }

            // Text on the page: content-matched actions first (Convert, Color, Calculate...), so the
            // relevant button is never hidden in More
            const smart = this._filterActions('smart', apiCtx);
            const selection = this._filterActions('selection', apiCtx);
            if (smart.length) return set('SMART', this.orderActions([...smart, ...selection], smart));
            if (selection.length) return set('SELECTION', selection);
            set('HIDDEN', []);
        },

        /** The order a bar's actions appear in: content-matched ones first, then the user's order */
        orderActions: function(candidates, matched = []) {
            const order = this.get('order'), first = new Set(matched);
            const rank = (a) => { const i = order.indexOf(a.id); return i === -1 ? Infinity : i; };
            return [...new Set(candidates)].sort((a, b) => (first.has(b) - first.has(a)) || (rank(a) - rank(b)) || 0);
        },

        // Whether what the bar is for is still there: page text still selected, a field still focused
        _stillValid: function() {
            if (this.mode === 'SELECTION' || this.mode === 'SMART') return !!window.getSelection().toString().trim();
            if (this.mode === 'INPUT') return !(this.ctx && this.ctx.element && global.LighthouseInput.focusedElement() !== this.ctx.element);
            return true;
        },

        // Enabled actions of a category whose condition matches, in the user's order
        _filterActions: function(category, apiCtx) {
            const enabled = this.get('enabled');
            return this.get('order').map(id => Actions.find(a => a.id === id)).filter(a => a && a.category === category && enabled[a.id] !== false && a.condition(apiCtx));
        }
    };

    global.LighthouseState = State;
})(typeof self !== 'undefined' ? self : window);

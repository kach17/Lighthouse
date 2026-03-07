/**
 * Lighthouse - State Management (Centralized)
 * Determines the 'Mode' of the tooltip based on context.
 */
(function(global) {
    const Defaults = global.LighthouseConfig.defaults;
    const Actions = global.LighthouseActions;

    const State = {
        settings: { ...Defaults },
        
        // The current state of the DOM/Selection
        ctx: null,
        
        // 'HIDDEN', 'SELECTION', 'INPUT', 'SMART', 'LINK'
        mode: 'HIDDEN', 
        
        // Logic for Input Toggling (Prevent annoyance)
        lastFocusedInput: null,
        
        // The list of actions to show for the current mode
        activeActions: [],

        init: function() {
            if (typeof chrome !== 'undefined' && chrome.storage) {
                chrome.storage.sync.get(Defaults, (items) => {
                    // Self-healing: Ensure new actions are migrated
                    const currentIds = new Set(items.order);
                    let dirty = false;
                    
                    Actions.forEach(a => {
                        if (!currentIds.has(a.id)) {
                            items.order.push(a.id);
                            if (items.enabled[a.id] === undefined) items.enabled[a.id] = true;
                            dirty = true;
                        }
                    });

                    if (dirty) chrome.storage.sync.set(items);
                    this.settings = items;
                });

                if (chrome.storage.onChanged) {
                    chrome.storage.onChanged.addListener((changes) => {
                        for (let key in changes) {
                            this.settings[key] = changes[key].newValue;
                        }
                    });
                }
            }
        },

        /**
         * The Core Logic: Ingests a raw context and decides the Mode.
         * Enforces the "First Click" rule for inputs.
         */
        update: function(rawCtx) {
            this.ctx = rawCtx;
            const Logger = global.LighthouseUtils.Logger;
            
            // 1. Reset Logic: If clicking outside or on a non-input, reset input tracker
            // This ensures if I click Input A, then Text B, then Input A again -> it shows the tooltip again.
            if (!rawCtx.isInput) {
                this.lastFocusedInput = null;
            }

            // 2. Link Mode (Hover logic handles this separately usually, but good to have)
            if (rawCtx.isLink) {
                this.mode = 'LINK';
                this.activeActions = this._filterActions('link');
                global.LighthouseUtils.logEvent('STATE', 'CHANGE', 'LINK');
                return;
            }

            // 3. Empty Context (No text, no input) -> HIDDEN
            if (!rawCtx.hasText && !rawCtx.isInput) {
                if (this.mode !== 'HIDDEN') global.LighthouseUtils.logEvent('STATE', 'CHANGE', 'HIDDEN (Empty)');
                this.mode = 'HIDDEN';
                this.activeActions = [];
                return;
            }

            // 4. Input Logic (The Complex Part)
            if (rawCtx.isInput) {
                // Case A: Text is selected INSIDE the input. 
                // Always show tooltip (Copy/Cut/etc).
                if (rawCtx.hasText) {
                    const inputActions = this._filterActions('input');
                    const smartActions = this._filterActions('smart');
                    // REMOVED: const selectionActions = this._filterActions('selection');
                    // Selection actions (like Search, Translate) often don't work well with Input text 
                    // or are redundant with Input actions.
                    
                    let combined = [...inputActions, ...smartActions];
                    combined = [...new Set(combined)];
                    
                    combined.sort((a, b) => {
                        if (this.ctx.semanticType) {
                            const aMatch = a.semantic === this.ctx.semanticType;
                            const bMatch = b.semantic === this.ctx.semanticType;
                            if (aMatch && !bMatch) return -1;
                            if (!aMatch && bMatch) return 1;
                        }
                        const idxA = this.settings.order.indexOf(a.id);
                        const idxB = this.settings.order.indexOf(b.id);
                        if (idxA === -1 && idxB === -1) return 0;
                        if (idxA === -1) return 1;
                        if (idxB === -1) return -1;
                        return idxA - idxB;
                    });
                    
                    this.activeActions = combined;
                    this.mode = 'INPUT';
                    // We DO NOT reset lastFocusedInput here. 
                    // If user selects text, then clicks again to collapse, we want Case B (Second Click) to fire and hide it.
                    this.lastFocusedInput = rawCtx.element; 
                    global.LighthouseUtils.logEvent('STATE', 'CHANGE', 'INPUT (Text Selected)');
                    return;
                }

                // Case B: Caret only (No text selected).
                // Rule: Only show on FIRST click (Focus). Subsequent clicks (Edit/Move Cursor) hide it.
                if (rawCtx.element === this.lastFocusedInput) {
                    // User clicked the SAME input again. They want to type/edit.
                    // HIDE IT.
                    this.mode = 'HIDDEN';
                    this.activeActions = [];
                    global.LighthouseUtils.logEvent('STATE', 'CHANGE', 'HIDDEN (Re-focus)');
                    return;
                } else {
                    // User clicked a NEW input (or first time).
                    // SHOW IT (Paste/Clear).
                    this.activeActions = this._filterActions('input');
                    if (this.activeActions.length > 0) {
                        this.mode = 'INPUT';
                        this.lastFocusedInput = rawCtx.element; // Mark as seen
                        global.LighthouseUtils.logEvent('STATE', 'CHANGE', 'INPUT (First Focus)');
                    } else {
                        this.mode = 'HIDDEN';
                        global.LighthouseUtils.logEvent('STATE', 'CHANGE', 'HIDDEN (No Actions)');
                    }
                    return;
                }
            }

            // 5. Smart Mode (Text Selected in DOM)
            // Check for Smart Actions (Math, Currency, QR)
            const smartActions = this._filterActions('smart');
            if (smartActions.length > 0) {
                this.mode = 'SMART';
                // Merge Smart Actions with Standard Selection Actions
                const selectionActions = this._filterActions('selection');
                
                // Combine
                let combined = [...smartActions, ...selectionActions];
                
                // Deduplicate
                combined = [...new Set(combined)];

                // Sort by User Preference (Global Order)
                // This ensures Smart Actions don't arbitrarily jump to the top if the user wants them elsewhere.
                combined.sort((a, b) => {
                    // 0. Semantic Boost (Top Priority)
                    if (this.ctx.semanticType) {
                        const aMatch = a.semantic === this.ctx.semanticType;
                        const bMatch = b.semantic === this.ctx.semanticType;
                        if (aMatch && !bMatch) return -1;
                        if (!aMatch && bMatch) return 1;
                    }

                    const idxA = this.settings.order.indexOf(a.id);
                    const idxB = this.settings.order.indexOf(b.id);
                    // Handle missing items (push to end)
                    if (idxA === -1 && idxB === -1) return 0;
                    if (idxA === -1) return 1;
                    if (idxB === -1) return -1;
                    return idxA - idxB;
                });

                this.activeActions = combined;
                
                global.LighthouseUtils.logEvent('STATE', 'CHANGE', 'SMART');
                return;
            }

            // 6. Standard Selection Mode (Text Selected in DOM)
            this.activeActions = this._filterActions('selection');
            if (this.activeActions.length > 0) {
                this.mode = 'SELECTION';
                global.LighthouseUtils.logEvent('STATE', 'CHANGE', 'SELECTION');
            } else {
                this.mode = 'HIDDEN';
                global.LighthouseUtils.logEvent('STATE', 'CHANGE', 'HIDDEN (No Actions)');
            }
        },

        /**
         * Validates if the current Mode is still valid against the Browser State.
         * Used by the Scroll/Resize loop to kill "Zombies".
         */
        validate: function() {
            if (this.mode === 'HIDDEN') return true; // Already hidden, valid.

            // 1. Validate Selection Mode
            if (this.mode === 'SELECTION' || this.mode === 'SMART') {
                const sel = window.getSelection();
                // If selection is gone or empty, state is invalid.
                if (!sel.rangeCount || sel.toString().trim().length === 0) {
                    return false;
                }
                // (Optional) Check if selection is inside an input (should match INPUT mode, not SELECTION)
                // but getSelection() usually returns empty string for inputs in some browsers, 
                // or we rely on the fact that isForm handles that.
            }

            // 2. Validate Input Mode
            if (this.mode === 'INPUT') {
                const active = document.activeElement;
                // If focus moved away from the element we are tracking
                if (this.ctx && this.ctx.element && active !== this.ctx.element) {
                    return false;
                }
                
                // If user started typing (handled by 'input' event listener mostly, but good check)
                // Note: We allow INPUT mode to persist if text IS selected. 
                // If text is NOT selected, we rely on the toggle logic in update(), 
                // but here we just check raw validity (element still exists/focused).
            }

            // 3. Validate Link Mode
            if (this.mode === 'LINK') {
                // If mouse moved away? handled by mouseout.
                // This is harder to validate passively without event, assume valid until mouseout.
            }

            return true;
        },

        /**
         * Helper to get enabled actions by category
         */
        _filterActions: function(category) {
            const apiCtx = global.LighthouseAPI.prepareContext(this.ctx);
            return this.settings.order
                .map(id => Actions.find(a => a.id === id))
                .filter(a => {
                    if (!a) return false;
                    if (this.settings.enabled[a.id] === false) return false;
                    if (a.category !== category) return false;
                    return a.condition(apiCtx);
                });
        }
    };

    global.LighthouseState = State;

})(typeof self !== 'undefined' ? self : window);
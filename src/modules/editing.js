/**
 * Lighthouse - Smart Editing
 *
 * Small corrections while editing text fields, each switchable in Settings:
 *   Tidy spacing        fix spaces and punctuation when deleting, cutting or pasting
 *   Brackets and quotes 'off' | 'wrap' (wrap a selection) | 'close' (wrap, and auto-close brackets)
 *
 * Everything runs through the input manager (input.js), so password fields, text being
 * composed, command shortcuts, sites where Lighthouse is off and editors that manage
 * their own text are all excluded in one place.
 */
(function (global) {
    const Input = global.LighthouseInput;
    const State = global.LighthouseState;
    const Sel = global.LighthouseSelection;

    const WRAP_PAIRS = global.LighthouseData.WRAP_PAIRS;
    // Brackets that also auto-close while typing (quotes and < only wrap selections)
    const AUTO_CLOSE = Object.fromEntries(['(', '[', '{'].map(k => [k, WRAP_PAIRS[k]]));
    const CLOSERS = new Set(Object.values(AUTO_CLOSE));

    const tidySpacing = () => State.get('tidySpacing');
    const bracketsMode = () => State.get('brackets');

    // Remembers the closing bracket we inserted, so typing it steps over it and Backspace
    // inside an empty pair removes both. It stays "ours" while it sits right after the caret
    // as you type inside the pair; any other edit or caret move ends that.
    let autoClosed = null; // { el, closer }
    const closerAtCaret = (el) => {
        const r = autoClosed && autoClosed.el === el && Sel.surface(el).read({ before: 1, after: 1 });
        return r && !r.text && r.after === autoClosed.closer ? r : null;
    };

    function init({ onEdit }) {
        const done = () => { if (onEdit) onEdit(); };

        // The owed space (selection.js), paid by the next keystroke; the key itself is typed as usual. Shift alone keeps it, for a capital
        Input.on({ type: 'keydown', scope: 'editable', typingHelper: true, inManagedEditors: true,
            handler(e, { target: el }) { if (!e.getModifierState(e.key)) Sel.payOwed(el, e); return false; } });

        // Brackets and quotes: wrap a selection, auto-close, step over, paired delete
        Input.on({
            type: 'keydown', scope: 'editable', typingHelper: true,
            keys: [...Object.keys(WRAP_PAIRS), ...CLOSERS, 'Backspace'],
            handler(e, { target: el }) {
                const mode = bracketsMode();
                if (mode === 'off') return false;
                const surface = Sel.surface(el), pair = closerAtCaret(el);

                // Step over a closing bracket we just inserted
                if (pair && e.key === autoClosed.closer) {
                    e.preventDefault();
                    surface.select({ after: 1 }, 'end');
                    autoClosed = null;
                    return true;
                }

                // Backspace inside an empty auto-closed pair removes both
                if (e.key === 'Backspace') {
                    if (!pair || AUTO_CLOSE[pair.before] !== autoClosed.closer) return false;   // plain Backspace: tidy spacing or the browser
                    e.preventDefault();
                    surface.rewrite({ before: 1, after: 1 }, () => ({ before: '', after: '' }));
                    autoClosed = null;
                    return true;
                }

                if (!WRAP_PAIRS[e.key]) return false;

                // Wrap a selection (a deliberate act, so on by default)
                if (Input.hasSelection()) {
                    e.preventDefault();
                    Sel.insertText(el, e.key);
                    autoClosed = null;
                    done();
                    return true;
                }

                // Auto-close brackets (changes ordinary typing, so opt-in): the caret goes inside the pair
                if (mode === 'close' && AUTO_CLOSE[e.key]) {
                    e.preventDefault();
                    surface.rewrite(null, () => ({ text: e.key + AUTO_CLOSE[e.key] }), { caret: -1 });
                    autoClosed = { el, closer: AUTO_CLOSE[e.key] };
                    return true;
                }
                return false;
            }
        });

        // Typing inside the pair keeps the closer ours; anything else ends it
        Input.on({
            type: 'input', scope: 'editable', typingHelper: true,
            handler(e, { target: el }) {
                if (autoClosed && (e.inputType !== 'insertText' || !closerAtCaret(el))) autoClosed = null;
                return false;
            }
        });

        // Tidy spacing: deleting a selection
        Input.on({
            type: 'keydown', scope: 'editable', typingHelper: true, keys: ['Backspace', 'Delete'], inManagedEditors: true,
            handler(e, { target: el }) {
                if (!tidySpacing() || !Input.hasSelection()) return false;
                const surface = Sel.surface(el);
                // Rich text: the browser or editor deletes; only the caret is placed afterwards
                if (!surface.tidies) { setTimeout(() => Sel.caretToWordEnd(el)); return false; }
                if (!Sel.needsTidy(surface)) return false;   // nothing to tidy: the browser's own edit
                e.preventDefault();
                Sel.insertText(el, '');
                done();
                return true;
            }
        });

        // Tidy spacing: cutting a selection (Ctrl/Cmd+X)
        Input.on({
            type: 'keydown', scope: 'editable', typingHelper: true, keys: ['x', 'X'], withCommand: true,
            handler(e, { target: el }) {
                if (!tidySpacing() || !Input.hasSelection() || !Sel.needsTidy(Sel.surface(el))) return false;   // nothing to tidy: the browser's own edit
                e.preventDefault();
                document.execCommand('copy');
                Sel.insertText(el, '');
                done();
                return true;
            }
        });

        // Tidy spacing: pasting into plain fields (editable areas keep native rich paste)
        Input.on({
            type: 'paste', scope: 'editable', typingHelper: true,
            handler(e, { target: el }) {
                if (!tidySpacing() || !Sel.surface(el).tidies) return false;
                const text = (e.clipboardData || global.clipboardData)?.getData('text/plain');
                if (!text) return false;
                e.preventDefault();
                Sel.insertText(el, text.replace(/^(?:[^\S\r\n]*\r?\n)+|\s+$/g, ''));   // edges only: indentation and inner lines stay
                return true;
            }
        });
    }

    global.LighthouseEditing = { init };
})(window);

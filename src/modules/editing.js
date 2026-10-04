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

    // The owed space: when tidying takes a space away, a word typed next at that caret gets it back first
    // ("I want‸ noodles" + "small"), and after it too where a word follows ("‸noodles"). Any other key ends it
    let owed = null;   // { el, before, after, at }
    const spot = (el) => { const r = Sel.surface(el).read({ before: 20, after: 20 }); return r && !r.text ? r : null; };
    function owe(el) {
        const r = spot(el), before = !!r && Sel.needsSpaceAfter(r.before, r.before.length - 1), after = !!r && Sel.isWord(r.after[0]);
        owed = before || after ? { el, before, after, at: r.before + '|' + r.after } : null;
    }

    function init({ onEdit }) {
        const done = () => { if (onEdit) onEdit(); };

        Input.on({
            type: 'keydown', scope: 'editable', typingHelper: true, inManagedEditors: true,
            handler(e, { target: el }) {
                if (!owed || e.getModifierState(e.key)) return false;   // Shift alone keeps it, for a capital
                const o = owed, r = spot(el);
                owed = null;
                if (o.el !== el || !r || r.before + '|' + r.after !== o.at || e.ctrlKey || e.metaKey || e.altKey || !Sel.isWord(e.key)) return false;
                Sel.surface(el).rewrite(null, () => ({ text: (o.before ? ' ' : '') + (o.after ? ' ' : '') }), { caret: o.after ? -1 : 'end' });
                return false;   // the key is typed between them, as usual
            }
        });

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
                if (!surface.tidies) { setTimeout(() => { if (Sel.caretToWordEnd(el)) owe(el); }); return false; }
                if (!Sel.needsTidy(surface)) return false;   // nothing to tidy: the browser's own edit
                e.preventDefault();
                Sel.insertText(el, '');
                owe(el);
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
                owe(el);
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
/**
 * Lighthouse - Smart Editing
 *
 * Small corrections while editing text fields, each switchable in Settings:
 *   Tidy spacing        fix spaces and punctuation when deleting, cutting, pasting or typing over a selection
 *   Brackets and quotes 'off' | 'wrap' (wrap a selection) | 'close' (wrap, and auto-close brackets)
 *
 * Everything runs through the input manager (input.js), so password fields, text being
 * composed, command shortcuts, sites where Lighthouse is off and the hidden fields code
 * editors type through are all excluded in one place.
 *
 * Brackets work in every editor, rich text included, but only where the editor leaves the key
 * alone: they act on beforeinput, which comes only for a key no editor has taken, so an editor
 * that pairs brackets itself (a code editor, a notes app) keeps its own behavior.
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
        Input.on({ type: 'keydown', scope: 'editable', typingHelper: true, inProxyFields: true,
            handler(e, { target: el }) { if (!e.getModifierState(e.key)) Sel.payOwed(el, e); return false; } });

        // Brackets: our own pair. Its closer typed steps over it; Backspace inside it, empty, removes both
        Input.on({
            type: 'keydown', scope: 'editable', typingHelper: true, keys: [...CLOSERS, 'Backspace'],
            handler(e, { target: el }) {
                const pair = bracketsMode() !== 'off' && closerAtCaret(el);
                if (!pair) return false;
                if (e.key === autoClosed.closer) Sel.surface(el).select({ after: 1 }, 'end');
                else if (e.key === 'Backspace' && AUTO_CLOSE[pair.before] === autoClosed.closer) Sel.surface(el).rewrite({ before: 1, after: 1 }, () => ({ before: '', after: '' }));
                else return false;
                e.preventDefault();
                autoClosed = null;
                return true;
            }
        });

        // A character typed where no editor has taken the key (only then is there a beforeinput). Over a selection,
        // Lighthouse types it when it wraps (brackets and quotes) or replaces a space (tidy spacing: "small " →
        // "big noodles"); with none, an opening bracket closes itself (close mode, opt-in: it changes ordinary typing)
        Input.on({
            type: 'beforeinput', scope: 'editable', typingHelper: true,
            handler(e, { target: el }) {
                const key = e.inputType === 'insertText' && e.data, mode = bracketsMode();
                if (!key || [...key].length !== 1) return false;
                const s = Sel.surface(el), selected = Input.hasSelection() && s.read();
                if (!s.writable) return false;   // across lines in rich text: the editor's
                if (selected ? !((mode !== 'off' && WRAP_PAIRS[key]) || (tidySpacing() && /^\s|\s$/.test(selected.text)))
                    : !(mode === 'close' && AUTO_CLOSE[key])) return false;
                e.preventDefault();
                if (selected) { Sel.insertText(el, key); autoClosed = null; done(); }
                else { Sel.surface(el).rewrite(null, () => ({ text: key + AUTO_CLOSE[key] }), { caret: -1 }); autoClosed = { el, closer: AUTO_CLOSE[key] }; }
                return true;
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
            type: 'keydown', scope: 'editable', typingHelper: true, keys: ['Backspace', 'Delete'],
            handler(e, { target: el }) {
                if (!tidySpacing() || !Input.hasSelection() || !Sel.surface(el).writable) return false;   // across lines in rich text: the editor's
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
                if (!tidySpacing() || !Input.hasSelection() || !Sel.surface(el).writable) return false;
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
                if (e.defaultPrevented || !tidySpacing() || !Sel.surface(el).tidies) return false;   // the page pasted it itself
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
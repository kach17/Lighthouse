/**
 * The last box typed in on this page (a message, a comment, a search box), and where its caret was. Send puts text
 * selected on the page into it, as typing would; the shortcut (Alt+L, the browser's) puts the cursor back in it.
 */
(function() {
    const SelLib = window.LighthouseSelection, State = window.LighthouseState, Input = window.LighthouseInput, $ = window.LighthouseUtils;

    // { ref: the box, weakly (one the page removes goes with it), caret: rich text's when it was left (a textarea keeps its
    // own), view: the text mid-screen while typing in it (where a chat was scrolled, its box fixed below) }
    let composer = null;
    function keep(el, typing) {
        const sel = SelLib.getActiveSelection(), r = sel && sel.rangeCount && sel.getRangeAt(0), same = composer && composer.ref.deref() === el;
        const view = typing ? document.caretRangeFromPoint(innerWidth / 2, innerHeight / 2) : same && composer.view;
        composer = { ref: new WeakRef(el), caret: r && el.contains(r.startContainer) ? r.cloneRange() : null, view };
    }

    // The box while it is on the page and shown, with the name the page gives it, and whether it takes lines
    function current() {
        const el = composer && composer.ref.deref();
        if (!el || !el.isConnected || !el.checkVisibility()) return null;
        const name = el.getAttribute('aria-label') || el.getAttribute('placeholder') || (el.querySelector('[data-placeholder]') || el).getAttribute('data-placeholder');
        return { el, label: name ? $.shorten(name.trim(), 32) : '', multiline: el.tagName !== 'INPUT' };
    }

    // Text into the composer where its caret was (rich text's kept, else at its end), as typed there: tidy joins, one undo
    // step; the page stays (rich editors scroll to their caret). quote: lines of its own, each "> ", then one to write on.
    // A one-line box: lines become spaces, and no quote
    function send(text, { quote = false } = {}) {
        const target = current();
        if (!target || (quote && !target.multiline)) return false;
        if (!target.multiline) text = text.trim().replace(/\s*[\r\n]+\s*/g, ' ');
        const { el } = target, x = window.scrollX, y = window.scrollY;
        let r = composer.caret && el.contains(composer.caret.startContainer) && composer.caret;
        el.focus({ preventScroll: true });
        if (el.isContentEditable) {   // rich text: its caret as kept (a field keeps its own)
            if (!r) { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
            SelLib.selectBetween({}, { node: r.startContainer, offset: r.startOffset }, { node: r.endContainer, offset: r.endOffset });
        }
        if (quote) {
            const at = SelLib.surface(el).read({ before: 1 }), midLine = at && at.before && at.before !== '\n';
            text = (midLine ? '\n' : '') + text.trimEnd().split(/\r?\n/).map(line => '> ' + line).join('\n') + '\n\n';
        }
        SelLib.insertText(el, text);
        State.send('wroteInto', { el });   // the caret is in it now: no first click (no Paste bar over what was sent)
        queueMicrotask(() => { if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y); });   // after the editor's own scroll
        return true;
    }

    // The shortcut flips between the page and the box. To the box: the caret where it was (a field keeps its own; rich
    // text's was kept), the box scrolled into view, and where the reader was kept: what was mid-screen (a chat scrolls
    // in its own panel, not the page) and the selection. In the box again, after such a jump: back there, the box let go
    let left = null;   // { at: the text mid-screen, range: the selection, if any }
    function back() {
        const target = current();
        if (!target || State.isDisabledHere()) return;
        const { el } = target, r = composer.caret, at = left && (left.range || left.at), view = composer.view;
        // Pressed again after a jump here, the cursor still in the box: back to where you were reading
        if (document.activeElement === el && at && at.startContainer.isConnected) {
            el.blur();
            $.reveal(at);   // as scrolling back to a selection does
            const sel = getSelection(); sel.removeAllRanges(); if (left.range) sel.addRange(left.range);
            left = null;
            return;
        }
        const mid = document.caretRangeFromPoint(innerWidth / 2, innerHeight / 2), sel = getSelection();
        left = mid ? { at: mid, range: sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null } : null;
        // To the box. Scrolled away, it comes back (focus brings it, the editor its caret). On the screen still (fixed below a
        // chat): what moved is the chat, back to where it was while typing in the box
        if ($.seen(el)) { el.focus({ preventScroll: true }); if (view && view.startContainer.isConnected) $.reveal(view); }
        else el.focus();
        if (r && el.isContentEditable && el.contains(r.startContainer)) SelLib.selectBetween({}, { node: r.startContainer, offset: r.startOffset }, { node: r.endContainer, offset: r.endOffset });
    }

    // The box is the last one typed in that Lighthouse types into (not a structured or sensitive field, a code editor or
    // a proxy field); leaving it keeps its caret. The shortcut is the browser's: it reaches here as a message, no key listened to
    function init() {
        Input.on({ type: 'input', scope: 'editable', handler: () => { const el = Input.focusedElement(); if (el && Input.fieldKind(el, { forTyping: true })) keep(el, true); return false; } });
        chrome.runtime.onMessage.addListener((m) => { if (m && m.action === 'BACK_TO_BOX') back(); });
        Input.on({ type: 'focusout', scope: 'editable', handler: (e) => { if (composer && e.target === composer.ref.deref()) keep(e.target); return false; } });
    }

    window.LighthouseSend = { init, composer: current, send, back };
})();

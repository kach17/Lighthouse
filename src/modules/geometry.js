/**
 * Lighthouse - Geometry
 * Where a selection is drawn: page selections through their characters' boxes, text fields
 * through an invisible mirror. Answers against the current layout; nothing here is stored
 * past a frame except the field's mirror.
 */
(function() {
    const Input = window.LighthouseInput;

    // ---------- Page selections ----------
    // What is visibly selected: trimmed to its first and last visible characters, with the box of that
    // text alone (a range's own box spans whole list items it contains). null for very large selections.
    // Measured once per frame for the same range: the bar and both handles ask for it on every scroll
    let extentCache = null;
    function extent(range, spaces = false) {   // spaces: see measureExtent
        if (!range) return null;
        const key = [range.startContainer, range.startOffset, range.endContainer, range.endOffset, spaces];
        if (extentCache && key.every((k, i) => k === extentCache.key[i])) return extentCache.value;
        if (!extentCache) requestAnimationFrame(() => { extentCache = null; });
        extentCache = { key, value: measureExtent(range, spaces) };
        return extentCache.value;
    }

    // A space the browser paints within a line (one a Windows double-click takes after a word): it has a box,
    // and the characters beside it share its line (a space at a line break does not: a caret after it shows below)
    function painted(n, i) {
        const box = (k) => { const c = document.createRange(); c.setStart(n, k); c.setEnd(n, k + 1); return [...c.getClientRects()].find(q => q.width > 0); };
        const own = /\s/.test(n.data[i]) && box(i);
        return !!own && [i - 1, i + 1].every(k => { const q = k >= 0 && k < n.length && box(k); return !q || Math.abs(q.top - own.top) < 1; });
    }

    function measureExtent(range, spaces) {
        const trimmed = range.cloneRange(), w = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity, count = 0;
        for (let n = w.currentNode.nodeType === 3 ? w.currentNode : w.nextNode(); n; n = w.nextNode()) {
            if (++count > 500) return null;
            const from = n === range.startContainer ? range.startOffset : 0;
            const text = range.intersectsNode(n) ? n.data.slice(from, n === range.endContainer ? range.endOffset : n.length) : '';
            if (!text.trim()) continue;
            const part = document.createRange();
            part.setStart(n, from + text.search(/\S/));
            part.setEnd(n, from + text.trimEnd().length);
            if (spaces) for (const edge of [true, false]) {   // the handles: also a space painted on its line
                const i = edge ? part.startOffset - 1 : part.endOffset, q = i >= from && i < from + text.length && painted(n, i);
                if (q) edge ? part.setStart(n, i) : part.setEnd(n, i + 1);
            }
            const rects = [...part.getClientRects()].filter(q => q.width);
            if (!rects.length) continue;   // hidden text
            if (l === Infinity) trimmed.setStart(n, part.startOffset);
            trimmed.setEnd(n, part.endOffset);
            rects.forEach(q => { l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
        }
        return l === Infinity ? null : { range: trimmed, box: { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t } };
    }

    // One end of a page range as { dx, dy, lineHeight }. The browser paints a selection across the
    // whole line box (letters plus the line spacing), not just the letters' box: so does this
    function rangeEnd(source, atStart) {
        const range = source.cloneRange();
        range.collapse(atStart);
        const rect = range.getBoundingClientRect();
        let dy = rect.y, lineHeight = rect.height;
        if (rect.height > 0) {
            const node = range.startContainer;
            const el = node && (node.nodeType === 1 ? node : node.parentElement);
            const lineBox = el ? parseFloat(window.getComputedStyle(el).lineHeight) : NaN;   // NaN for 'normal'
            if (!isNaN(lineBox) && lineBox > lineHeight) {
                dy -= (lineBox - lineHeight) / 2;
                lineHeight = lineBox;
            }
        }
        return { dx: rect.x, dy, lineHeight };
    }

    // ---------- Text fields ----------
    // Text fields expose no positions for their text, so an invisible copy laid over the field, styled
    // like it, is measured instead. One mirror while the bar or handles are up: built on first use,
    // rebuilt if the field is swapped or resized, removed by release().
    // The styles that lay out text, copied first. Not every computed style: a textarea ignores some that
    // a div obeys (reading styles such as text-wrap: pretty, on Gemini's message editing), and copying
    // those breaks the lines elsewhere than the field does
    const MIRROR_PROPS = ['boxSizing', 'width', 'height', 'overflowX', 'overflowY',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant',
        'fontVariantLigatures', 'fontVariantNumeric', 'fontFeatureSettings', 'fontVariationSettings',
        'fontOpticalSizing', 'fontKerning', 'fontSynthesis', 'textRendering',
        'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'textAlign', 'direction',
        'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize'];
    const MIRROR_FIXED = { position: 'fixed', right: 'auto', bottom: 'auto', margin: '0', transform: 'none',
        display: 'block', borderStyle: 'solid', borderColor: 'transparent', opacity: '0', visibility: 'visible',
        pointerEvents: 'none', zIndex: '2147483647', transition: 'none', animation: 'none' };
    const MARKER = '\u2060';   // zero-width and never a line-break opportunity, so markers can't change wrapping
    // Fields the list doesn't cover (found by measuring once, below): those get every computed style
    const needsFullCopy = new WeakMap();
    let mirror = null;   // { field, div, w, h, lineHeight, key, ends }

    function copyStyles(field, div, all) {
        const cs = window.getComputedStyle(field);
        if (all) for (const p of cs) div.style.setProperty(p, cs.getPropertyValue(p));
        else MIRROR_PROPS.forEach(p => div.style[p] = cs[p]);
        if (field.tagName !== 'TEXTAREA') div.style.whiteSpace = 'pre';   // single-line fields never wrap
        Object.assign(div.style, MIRROR_FIXED);   // whatever was copied: fixed over the field, invisible, inert
    }

    // The field's text as a div lays it out (a trailing newline still opens a last line)
    const plainText = (v) => v.endsWith('\n') ? v + MARKER : v;

    function syncScroll(m) {
        m.div.scrollTop = m.field.scrollTop;
        m.div.scrollLeft = m.field.scrollLeft;
    }

    function ensureMirror(field) {
        const r = field.getBoundingClientRect();
        if (!mirror || mirror.field !== field || !mirror.div.isConnected || mirror.w !== r.width || mirror.h !== r.height) {
            release();
            const div = document.createElement('div');
            div.setAttribute('aria-hidden', 'true');
            copyStyles(field, div, needsFullCopy.get(field) === true);
            document.body.appendChild(div);
            mirror = { field, div, w: r.width, h: r.height, lineHeight: parseFloat(window.getComputedStyle(field).lineHeight) || 20, key: null, ends: null };
            // Once per field: a mirror that wraps like the field is as tall as its content. If not, the
            // list missed a style that matters here, and the field gets every computed style instead
            if (field.tagName === 'TEXTAREA' && !needsFullCopy.has(field)) {
                div.textContent = plainText(field.value);
                const matches = Math.abs(div.scrollHeight - field.scrollHeight) <= 1;
                needsFullCopy.set(field, !matches);
                if (!matches) copyStyles(field, div, true);
            }
        }
        mirror.div.style.top = r.top + 'px';
        mirror.div.style.left = r.left + 'px';
        return mirror;
    }

    // The bar and handles are going: so is the field's mirror
    function release() {
        if (mirror) mirror.div.remove();
        mirror = null;
    }

    // Where a field's selection starts and ends ({ start, end }, each { dx, dy, lineHeight }), both from one
    // layout; the field's own selection unless offsets are given. Repeated asks for the same text, selection,
    // scroll and position are answered without measuring again
    function fieldEnds(field, from, to) {
        const m = ensureMirror(field);
        const v = field.value;
        // Without offsets (email, number) the caret can't be read: the end of the value
        const [s, e] = !Input.hasOffsets(field) ? [v.length, v.length]
            : from === undefined ? [field.selectionStart, field.selectionEnd] : [from, to];
        const key = [s, e, field.scrollTop, field.scrollLeft, m.div.style.top, m.div.style.left, v].join('|');
        if (m.key === key && m.ends) return m.ends;

        const a = document.createElement('span'), b = document.createElement('span');
        a.textContent = b.textContent = MARKER;
        m.div.replaceChildren(v.slice(0, s), a, v.slice(s, e), b, v.slice(e));
        syncScroll(m);
        const at = (span) => { const r = span.getBoundingClientRect(); return { dx: r.left, dy: r.top, lineHeight: r.height || m.lineHeight }; };
        m.ends = { start: at(a), end: at(b) };
        m.key = key;
        return m.ends;
    }

    // ---------- Answers ----------
    // The text position under a point: an offset in a plain field's value, a DOM point anywhere else; null
    // over no text. A block's padding or empty space counts as its nearest text, so a drag doesn't jump
    function pointAt(snap, x, y) {
        const field = snap.field;
        if (field) {
            const m = ensureMirror(field);
            m.key = null;   // its text is replaced here; the next ends measurement fills it again
            m.div.textContent = plainText(field.value);
            syncScroll(m);
            m.div.style.pointerEvents = 'auto';   // hit-testable only for this one lookup
            const hit = document.caretRangeFromPoint(x, y);
            m.div.style.pointerEvents = 'none';
            const offset = !hit ? 0 : hit.startContainer.nodeType === 3 ? hit.startOffset
                : hit.startContainer === m.div && m.div.firstChild && hit.startOffset ? field.value.length : 0;
            return Math.min(offset, field.value.length);
        }
        const hit = document.caretRangeFromPoint(x, y);
        if (!hit) return null;
        let node = hit.startContainer, offset = hit.startOffset;
        if (node.nodeType === 1 && node.childNodes.length && !/^(INPUT|TEXTAREA)$/.test(node.tagName)) {
            const atEnd = offset >= node.childNodes.length, child = node.childNodes[atEnd ? node.childNodes.length - 1 : offset];
            const w = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
            let text = child.nodeType === 3 ? child : w.nextNode();
            if (atEnd && child.nodeType !== 3) for (let n; (n = w.nextNode());) text = n;
            if (text) { node = text; offset = atEnd ? text.length : 0; }
        }
        return node.nodeType === 3 || /^(INPUT|TEXTAREA)$/.test(node.tagName) ? { node, offset } : null;
    }

    // Where a snapshot is drawn now: { start, end } (each { dx, dy, lineHeight }) and its box, and on the
    // page also its range. kind 'painted' (handles, the bar: a painted edge space included) or 'content'
    // (Highlight: the text without edge whitespace). null when there is nothing to measure.
    function edges(snap, kind = 'painted') {
        if (snap.field) {   // the box: from end to end, the field's width once the selection wraps
            const { start, end } = fieldEnds(snap.field, snap.offsets[0], snap.offsets[1]), f = snap.field.getBoundingClientRect();
            const wraps = end.dy - start.dy > start.lineHeight / 2, left = wraps ? f.left : start.dx, right = wraps ? f.right : end.dx;
            const top = Math.max(f.top, start.dy), bottom = Math.min(f.bottom, end.dy + end.lineHeight);
            return { start, end, box: { left, right, top, bottom, width: right - left, height: bottom - top } };
        }
        if (!snap.range) return null;
        const ext = extent(snap.range, kind === 'painted');
        const range = ext ? ext.range : snap.range;
        return { start: rangeEnd(range, true), end: rangeEnd(range, false), box: ext ? ext.box : range.getBoundingClientRect(), range };
    }

    window.LighthouseGeometry = { edges, pointAt, release };
})();

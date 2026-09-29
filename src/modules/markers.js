// Highlights, painted by the browser (CSS Custom Highlight API): the page's text is never changed
(function () {
    const Input = window.LighthouseInput;
    const markers = [];            // { range, hint, rects (page coordinates), time }
    const highlights = {};         // color → Highlight
    let button = null, hovered = null, pending = null, hideTimer = null, observer = null;

    // Where a highlight is, in page coordinates (so scrolling doesn't change it), and its scrollbar mark
    function measure(m) {
        m.rects = [...m.range.getClientRects()].filter(r => r.width).map(r => ({ l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY }));
        const H = document.documentElement.scrollHeight || 1, top = m.rects.length ? m.rects[0].t : 0, bottom = m.rects.length ? m.rects[m.rects.length - 1].b : top;
        m.hint.style.top = `${Math.min(Math.max(top / H * innerHeight, 5), innerHeight - 5)}px`;
        m.hint.style.height = `${Math.max(10, (bottom - top) / H * innerHeight)}px`;
    }

    function show(m) {
        clearTimeout(hideTimer);
        if (!button) {
            button = $.create('div', { className: 'marker-highlight-delete-floating', attrs: { role: 'button' },
                html: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' });
            button.addEventListener('mouseenter', () => clearTimeout(hideTimer));
            button.addEventListener('click', (e) => { e.stopPropagation(); if (hovered) remove(hovered); });
            document.body.appendChild(button);
        }
        const last = m.rects[m.rects.length - 1];
        if (!last) return;
        hovered = m;
        button.title = 'Marked ' + new Date(m.time).toLocaleString();
        Object.assign(button.style, { display: 'flex', top: `${last.t - 10}px`, left: `${last.r + 5}px` });
    }

    function hide(delay = 200) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { if (button) button.style.display = 'none'; hovered = null; }, delay);
    }

    function remove(m) {
        highlights[m.color].delete(m.range);
        m.hint.remove();
        markers.splice(markers.indexOf(m), 1);
        hide(0);
        if (!markers.length && observer) { observer.disconnect(); observer = null; }
    }

    function markTextSelection(text, color) {
        const Sel = window.LighthouseSelection, sel = Sel.getActiveSelection();
        if (!sel || !sel.rangeCount || sel.isCollapsed) return;
        const ext = Sel.visibleExtent(sel);
        const range = (ext ? ext.range : sel.getRangeAt(0)).cloneRange();
        if (range.commonAncestorContainer.getRootNode() !== document) return;   // inside a component's shadow DOM: not supported
        if (!highlights[color]) CSS.highlights.set('lighthouse-' + color, highlights[color] = new Highlight());
        highlights[color].add(range);

        const hint = $.create('div', { className: 'marker-scrollbar-hint', children: [$.create('span', { className: 'marker-scrollbar-tooltip', text })] });
        hint.style.background = `var(--lh-hl-${color})`;
        const m = { range, hint, color, rects: [], time: Date.now() };
        hint.addEventListener('mousedown', () => m.range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        document.body.appendChild(hint);
        markers.push(m);
        measure(m);
        if (hint.firstChild.getBoundingClientRect().top < 0) hint.firstChild.classList.add('marker-scrollbar-tooltip-bottom');
        // Positions change only when the page's size does (resizing, content loading in)
        if (!observer) (observer = new ResizeObserver(() => markers.forEach(measure))).observe(document.documentElement);
    }

    function init() {
        // Hovering: a cheap check that the element holds a highlight, then an exact one at most once a frame
        Input.on({ type: 'mouseover', scope: 'page', handler: (e) => {
            if (!markers.length || (button && button.contains(e.target))) return false;
            if (!markers.some(m => m.range.intersectsNode(e.target))) { if (hovered) hide(); }
            return false;
        } });
        Input.on({ type: 'mousemove', scope: 'page', handler: (e) => {
            if (!markers.length || (button && button.contains(e.target)) || !markers.some(m => m.range.intersectsNode(e.target))) return false;
            const first = !pending;
            pending = { x: e.clientX + scrollX, y: e.clientY + scrollY };
            if (first) requestAnimationFrame(() => {
                const { x, y } = pending; pending = null;
                const m = markers.find(k => k.rects.some(r => x >= r.l && x <= r.r && y >= r.t && y <= r.b));
                m ? show(m) : (hovered && hide());
            });
            return false;
        } });
    }

    const $ = window.LighthouseUtils;
    window.LighthouseMarkers = { init, markTextSelection };
})();

// Highlights, painted by the browser (CSS Custom Highlight API): the page's text is never changed. Pointed at, a
// highlight opens the bar for it, as a link does (Clear highlight). Their scrollbar hints live with the bar in its
// closed shadow root: never in the page's content, and the page can't read the highlighted text they show
(function () {
    const markers = [];            // { range, hint, color, text, time }
    const highlights = {};         // color → Highlight
    let observer = null;

    // Its scrollbar mark: where the highlight is in the whole page
    function measure(m) {
        const rects = [...m.range.getClientRects()].filter(r => r.width), H = document.documentElement.scrollHeight || 1;
        const top = rects.length ? rects[0].top + scrollY : 0, bottom = rects.length ? rects[rects.length - 1].bottom + scrollY : top;
        m.hint.style.top = `${Math.min(Math.max(top / H * innerHeight, 5), innerHeight - 5)}px`;
        m.hint.style.height = `${Math.max(10, (bottom - top) / H * innerHeight)}px`;
    }

    function remove(m) {
        highlights[m.color].delete(m.range);
        m.hint.remove();
        markers.splice(markers.indexOf(m), 1);
        window.LighthouseContent.point.remove(m.range);
        if (!markers.length && observer) { observer.disconnect(); observer = null; }
    }

    function markTextSelection(text, color) {
        const snap = window.LighthouseSelection.current(), drawn = snap.range && !snap.range.collapsed && snap.edges('content');
        if (!drawn) return;
        const range = drawn.range.cloneRange();   // the text without edge whitespace
        if (range.commonAncestorContainer.getRootNode() !== document) return;   // inside a component's shadow DOM: not supported
        if (!highlights[color]) CSS.highlights.set('lighthouse-' + color, highlights[color] = new Highlight());
        highlights[color].add(range);

        const hint = $.create('div', { className: 'marker-scrollbar-hint', children: [$.create('span', { className: 'marker-scrollbar-tooltip', text })] });
        hint.style.background = `var(--lh-hl-${color})`;
        const m = { range, hint, color, text, time: Date.now() };
        hint.addEventListener('mousedown', () => m.range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        window.LighthouseUI.shadowRoot.appendChild(hint);
        markers.push(m);
        window.LighthouseContent.point.add(range, () => ({ isLink: true, text, element: range, hasText: true, facts: () => [], buttons: [{   // pointed at: its bar (content.js)
            id: 'highlight-clear', label: 'Clear highlight', icon: 'clear', info: () => 'Marked ' + new Date(m.time).toLocaleTimeString([], { timeStyle: 'short' }),   // highlights last while the page is open
            execute: () => { remove(m); return { success: true, message: 'Highlight cleared' }; } }] }));
        measure(m);
        if (hint.firstChild.getBoundingClientRect().top < 0) hint.firstChild.classList.add('marker-scrollbar-tooltip-bottom');
        // Positions change only when the page's size does (resizing, content loading in)
        if (!observer) (observer = new ResizeObserver(() => markers.forEach(measure))).observe(document.documentElement);
    }

    const $ = window.LighthouseUtils;
    window.LighthouseMarkers = { markTextSelection };
})();
/**
 * Lighthouse - Selection handles
 * Two handles at the selection's ends, where they are painted (LighthouseSelection.current().edges).
 * Dragging one moves that end while the other stays; on release the selection goes through the pipeline.
 */
(function() {
    const State = window.LighthouseState, Sel = window.LighthouseSelection, Geometry = window.LighthouseGeometry;
    const Input = window.LighthouseInput, $ = window.LighthouseUtils;
    const EDGE_ZONE = 50, EDGE_STEP = 15;   // auto-scroll: how near the window's edge, and how far per frame
    const duration = () => $.token('--so-duration', 200);
    const other = (role) => role === 'start' ? 'end' : 'start';

    let handles = null;     // { start, end }: the handle elements, by the end each one marks
    let drag = null;        // the drag in progress
    let onRelease = null;   // the pipeline, told when a drag ends (set by content.js)

    // Where the ends are painted: { start, end }, each { dx, dy, lineHeight }. An end with nothing
    // measured (at 0, 0): the last pointer or key event's position
    function ends() {
        let e = null;
        try { e = Sel.current().edges('painted'); } catch (err) { /* nothing to measure */ }
        if (!e) return null;
        const at = (p) => p.dx || p.dy || !State.lastEvent ? { ...p } : { ...p, dx: State.lastEvent.clientX, dy: State.lastEvent.clientY - 8 };
        return { start: at(e.start), end: at(e.end) };
    }

    // The only place a handle is positioned: across the line, centered on the edge, its tab below (CSS)
    function layout(el, role, p, scrollX = 0, scrollY = 0) {
        el.id = `lighthouse-draghandle-${role === 'start' ? 0 : 1}`;   // a name only
        el.classList.toggle('is-start', role === 'start');
        el.classList.toggle('is-end', role === 'end');
        el.firstChild.style.height = `${p.lineHeight || 20}px`;
        el.style.transform = `translate(${p.dx - el.offsetWidth / 2 - scrollX}px, ${p.dy - scrollY}px)`;
    }

    function create() {
        const el = $.create('div', { className: 'lighthouse-tooltip-draghandle', children: [
            $.create('div', { className: 'lighthouse-tooltip-draghandle-line' }),
            $.create('div', { className: 'lighthouse-tooltip-draghandle-circle', events: { mousedown: (e) => startDrag(el, e) } })
        ] });
        ((window.LighthouseUI && window.LighthouseUI.shadowRoot) || document.body).appendChild(el);
        return el;
    }

    function show() {
        if (!State.get('addDragHandles')) return;
        const p = ends();
        if (!p) return;
        const fresh = !handles;
        if (fresh) handles = { start: create(), end: create() };
        const { start, end } = handles;
        layout(start, 'start', p.start);
        layout(end, 'end', p.end);
        if (fresh) $.frame.draw('handles', () => { void start.offsetWidth; start.style.opacity = end.style.opacity = 1; });
    }

    function hide(animated = true) {
        $.frame.cancel('handles');   // hidden before they could appear
        Geometry.release();          // the bar and handles are going: so is the field's mirror
        stopDrag();
        State.send('dragEnd');       // also a drag that couldn't start
        if (!handles) return;
        for (const el of [handles.start, handles.end]) {
            if (!animated) el.style.transition = 'none';
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            setTimeout(() => el.remove(), animated ? duration() : 0);
        }
        handles = null;
    }

    // ---------- Dragging ----------
    function startDrag(el, e) {
        e.preventDefault();
        State.send('dragStart');   // the bar goes while a handle is dragged
        const role = el === handles.start ? 'start' : 'end', snap = Sel.current(), from = ends();
        if (!from) return hide();
        // The end that stays: an offset in a field's value (none where the caret can't be read), else a DOM point
        const r = snap.range, stays = other(role);
        const fixed = snap.field ? snap.offsets[stays === 'start' ? 0 : 1] ?? null
            : r && (stays === 'start' ? { node: r.startContainer, offset: r.startOffset } : { node: r.endContainer, offset: r.endOffset });
        const at = from[role];
        drag = { el, role, snap, from, fixed, text: snap.text, crossed: false, scroll: [window.scrollX, window.scrollY], scrolling: null,
            offsetY: e.clientY - (at.dy + (at.lineHeight || 20) / 2) };

        for (const h of [handles.start, handles.end]) h.lastChild.style.pointerEvents = 'none';   // the text is hit-tested, not the handles
        document.body.style.cursor = 'grabbing';
        el.classList.add('is-dragging');
        Input.activate('drag');
        drag.off = [Input.on({ type: 'mousemove', scope: 'drag', handler: (ev) => { moveDrag(ev); return false; } }),
                    Input.on({ type: 'mouseup', scope: 'drag', handler: (ev) => { ev.preventDefault(); endDrag(); return false; } })];
    }

    function moveDrag(e) {
        const d = drag;
        e.preventDefault();
        // The handle that stays keeps to its text as the page scrolls; the dragged one follows the pointer
        const stays = other(d.role);
        layout(handles[stays], stays, d.from[stays], window.scrollX - d.scroll[0], window.scrollY - d.scroll[1]);
        const y = e.clientY - d.offsetY;
        d.el.style.transform = `translate(${e.clientX - d.el.offsetWidth / 2}px, ${y - (d.from[d.role].lineHeight || 20) / 2}px)`;
        if (d.fixed !== null && d.fixed !== undefined) {
            const focus = Geometry.pointAt(d.snap, e.clientX, y);
            // order: where the dragged end now is relative to the one that stays (-1 before, 0 at, 1 after)
            const order = focus === null ? null : Sel.selectBetween(d.snap, d.fixed, focus);
            if (order !== null) d.crossed = d.role === 'end' ? order < 0 : order > 0;
        }
        // Near the window's top or bottom edge, the page scrolls
        const dir = e.clientY > window.innerHeight - EDGE_ZONE ? 1 : e.clientY < EDGE_ZONE ? -1 : 0;
        if (dir && !d.scrolling) d.scrolling = setInterval(() => window.scrollBy(0, dir * EDGE_STEP), 16);
        else if (!dir && d.scrolling) { clearInterval(d.scrolling); d.scrolling = null; }
    }

    // Listeners off, the page as it was; true if a drag was in progress
    function stopDrag() {
        const d = drag;
        if (!d) return false;
        drag = null;
        d.off.forEach(off => off());
        Input.deactivate('drag');
        clearInterval(d.scrolling);
        document.body.style.cursor = 'unset';
        d.el.classList.remove('is-dragging');
        if (handles) for (const h of [handles.start, handles.end]) h.lastChild.style.pointerEvents = '';
        State.send('dragEnd');
        return d;
    }

    function endDrag() {
        const d = stopDrag();
        setTimeout(() => {   // after the browser has applied the last selection change
            if (!handles) return;
            // A drag that changed nothing takes in the next word on its side
            if (Sel.current().text === d.text) Sel.extendByWord(d.role === 'start');
            // Handles that crossed swap roles, so the start stays the start
            if (d.crossed) handles = { start: handles.end, end: handles.start };
            const p = ends();
            if (!p) return hide();
            for (const role of ['start', 'end']) {
                const el = handles[role];
                el.classList.add('is-settling');   // eases into place
                setTimeout(() => el.classList.remove('is-settling'), duration());
                layout(el, role, p[role]);
            }
            if (onRelease) onRelease();
        });
    }

    window.LighthouseHandles = { show, hide, onRelease: (fn) => { onRelease = fn; } };
})();

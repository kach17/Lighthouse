(function() {
    const State = window.LighthouseState;
    const SelLib = window.LighthouseSelection;

    const Input = window.LighthouseInput;

    // While a handle is dragged, its pointer listeners go through the input manager
    // (never document.onmousemove, which would overwrite the website's own handler).
    let endDrag = null;
    function startDragListeners(onMove, onUp) {
        stopDragListeners();
        Input.activate('drag');
        const offMove = Input.on({ type: 'mousemove', scope: 'drag', handler: (e) => { onMove(e); return false; } });
        const offUp = Input.on({ type: 'mouseup', scope: 'drag', handler: (e) => { onUp(e); return false; } });
        endDrag = () => { offMove(); offUp(); Input.deactivate('drag'); endDrag = null; };
    }
    function stopDragListeners() { if (endDrag) endDrag(); }

    const duration = () => window.LighthouseUtils.token('--so-duration', 200);

    let dragHandles;
    let isDraggingDragHandle = false;
    let draggingHandleIndex = null;
    let selectionHandleLineHeight = 21;
    let initialScrollX = 0;
    let initialScrollY = 0;
    let edgeScrollInterval = null;

    // ---------- Text-field mirror ----------
    // Text fields expose no positions for their text, so an invisible copy laid over the field,
    // styled like it, is measured instead. One mirror per field while its bar/handles are up:
    // built on first use, rebuilt if the field is swapped or resized, removed in hideDragHandles.
    const MIRROR_PROPS = ['boxSizing', 'width', 'height', 'overflowX', 'overflowY',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant',
        'fontVariantLigatures', 'fontVariantNumeric', 'fontFeatureSettings', 'fontVariationSettings',
        'fontOpticalSizing', 'fontKerning', 'fontSynthesis', 'textRendering',
        'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'textAlign', 'direction',
        'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize'];
    // What a mirror always is, whatever was copied: fixed over the field, invisible, inert
    const MIRROR_FIXED = { position: 'fixed', right: 'auto', bottom: 'auto', margin: '0', transform: 'none',
        display: 'block', borderStyle: 'solid', borderColor: 'transparent', opacity: '0', visibility: 'visible',
        pointerEvents: 'none', zIndex: '2147483647', transition: 'none', animation: 'none' };
    const MARKER = '\u2060';   // zero-width and never a line-break opportunity, so markers can't change wrapping
    // Fields whose styling the list doesn't cover (found by measuring once): those get every computed style
    const needsFullCopy = new WeakMap();
    let mirror = null;   // { field, div, w, h, lineHeight, key, ends }

    function copyStyles(field, div, all) {
        const cs = window.getComputedStyle(field);
        if (all) for (const p of cs) div.style.setProperty(p, cs.getPropertyValue(p));
        else MIRROR_PROPS.forEach(p => div.style[p] = cs[p]);
        if (field.tagName !== 'TEXTAREA') div.style.whiteSpace = 'pre';   // single-line fields never wrap
        Object.assign(div.style, MIRROR_FIXED);
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
            destroyMirror();
            const div = document.createElement('div');
            div.setAttribute('aria-hidden', 'true');
            copyStyles(field, div, needsFullCopy.get(field) === true);
            document.body.appendChild(div);
            mirror = { field, div, w: r.width, h: r.height, lineHeight: parseFloat(window.getComputedStyle(field).lineHeight) || 20, key: null, ends: null };
            // Self-check, once per field: a mirror that wraps like the field is as tall as its content
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

    function destroyMirror() {
        if (mirror) mirror.div.remove();
        mirror = null;
    }

    // Where the selection starts and ends in a field, both from one layout; repeated asks for
    // the same text, selection, scroll and position are answered without measuring again
    function measureFieldEnds(field) {
        const m = ensureMirror(field);
        const v = field.value;
        // Without offsets (email, number) the caret can't be read: the end of the value
        const [s, e] = Input.hasOffsets(field) ? [field.selectionStart, field.selectionEnd] : [v.length, v.length];
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

    function getInputCoordinates(element, atStart) {
        try {
            const ends = measureFieldEnds(element);
            return atStart ? ends.start : ends.end;
        } catch (e) {
            return null;
        }
    }

    function getIndexFromCoordinates(element, x, y) {
        let m = null;
        try {
            m = ensureMirror(element);
            m.key = null;   // its text is replaced below; the next ends measurement fills it again
            m.div.textContent = plainText(element.value);
            syncScroll(m);
            m.div.style.pointerEvents = 'auto';   // hit-testable only for this one lookup

            let offset = 0;
            if (document.caretRangeFromPoint) {
                const range = document.caretRangeFromPoint(x, y);
                if (range) {
                    if (range.startContainer.nodeType === 3) {
                        offset = range.startOffset;
                    } else if (range.startContainer === m.div && m.div.firstChild) {
                        // Hit the box itself: its start, or past its text
                        offset = range.startOffset === 0 ? 0 : element.value.length;
                    }
                }
            } else if (document.caretPositionFromPoint) {
                const pos = document.caretPositionFromPoint(x, y);
                if (pos) offset = pos.offset;
            }
            return Math.min(offset, element.value.length);
        } catch (e) {
            return 0;
        } finally {
            if (m) m.div.style.pointerEvents = 'none';
        }
    }

    function getSelectionCoordinates(atStart) {
        if (State.ctx && State.ctx.isInput && State.ctx.element) {
             const coords = getInputCoordinates(State.ctx.element, atStart);
             if (coords) return coords;
        }

        const sel = window.LighthouseSelection.getActiveSelection();
        if (!sel || !sel.rangeCount) return null;
        
        // Where the selection visibly starts or ends (not a line's end or the space between blocks)
        const ext = window.LighthouseSelection.visibleExtent(sel);
        const range = (ext ? ext.range : sel.getRangeAt(0)).cloneRange();
        range.collapse(atStart);
        
        const rect = range.getBoundingClientRect();
        let dx = rect.x;
        let dy = rect.y;
        let lineHeight = rect.height;

        // The browser paints a selection across the whole line box (letters plus the
        // line spacing), not just the letters' box. Match that so handles sit outside it.
        if (rect.height > 0) {
            const node = range.startContainer;
            const el = node && (node.nodeType === 1 ? node : node.parentElement);
            const lineBox = el ? parseFloat(window.getComputedStyle(el).lineHeight) : NaN; // NaN for 'normal'
            if (!isNaN(lineBox) && lineBox > lineHeight) {
                dy -= (lineBox - lineHeight) / 2;
                lineHeight = lineBox;
            }
        }

        // Fallback to mouse event if everything fails
        if (dx === 0 && dy === 0 && State.lastEvent) {
            dx = State.lastEvent.clientX;
            dy = State.lastEvent.clientY - 8;
        }

        return { dx, dy, lineHeight };
    }

    // The handle is exactly as tall as the selected text (the collapsed range's rect),
    // with fallbacks for inputs and unusual layouts.
    function calculateLineHeight(dimensions, isInput, selection) {
        let lh = dimensions && dimensions.lineHeight;
        if (!lh || isNaN(lh)) {
            let source = null;
            if (isInput && State.ctx.element) source = State.ctx.element;
            else if (selection && selection.anchorNode) source = selection.anchorNode.parentElement;
            const parsed = source ? parseFloat(window.getComputedStyle(source).fontSize) * 1.25 : NaN;
            lh = isNaN(parsed) ? 20 : parsed;
        }
        return lh;
    }

    function getRoot() {
        return (window.LighthouseUI && window.LighthouseUI.shadowRoot) ? window.LighthouseUI.shadowRoot : document;
    }

    // ---------- Visual layout: the only place handles are positioned ----------
    // The handle spans the selected line, centered on the selection edge;
    // its tab always hangs just below it (drawn by CSS).
    function layoutHandle(h, idx, dims, scrollDX = 0, scrollDY = 0) {
        if (!h || !dims) return;
        h.classList.toggle('is-start', idx === 0);
        h.classList.toggle('is-end', idx === 1);
        const lh = dims.lineHeight || selectionHandleLineHeight;
        const line = h.querySelector('.lighthouse-tooltip-draghandle-line');
        if (line) line.style.height = `${lh}px`;
        h.style.transform = `translate(${dims.dx - h.offsetWidth / 2 - scrollDX}px, ${dims.dy - scrollDY}px)`;
    }

    // Briefly animate position changes (after a drag settles), using the motion tokens.
    function settle(h) {
        h.classList.add('is-settling');
        setTimeout(() => h.classList.remove('is-settling'), duration());
    }

    function addDragHandle(dragHandleIndex, selStartDimensions, selEndDimensions) {
        const selection = window.LighthouseSelection.getActiveSelection();
        const isInput = State.ctx && State.ctx.isInput;
        if (!isInput && (!selection || !selection.rangeCount)) return;

        try {
            selectionHandleLineHeight = calculateLineHeight(
                dragHandleIndex == 0 ? selStartDimensions : selEndDimensions,
                isInput,
                selection
            );
        } catch (e) {
            window.LighthouseUtils.Logger.warn('[Handles] Error calculating line height:', e);
            selectionHandleLineHeight = 20;
        }

        const fromPointer = () => State.lastEvent
            ? { dx: State.lastEvent.clientX, dy: State.lastEvent.clientY - selectionHandleLineHeight / 2, lineHeight: selectionHandleLineHeight }
            : null;

        try {
            var currentWindowSelection;

            if (selEndDimensions && selEndDimensions.dx == 0 && selEndDimensions.dy == 0) selEndDimensions = fromPointer() || selEndDimensions;
            if (selStartDimensions && selStartDimensions.dx == 0 && selStartDimensions.dy == 0) selStartDimensions = fromPointer() || selStartDimensions;
            if (selStartDimensions == null || selEndDimensions == null) return;

            const dragHandle = document.createElement('div');
            dragHandle.className = 'lighthouse-tooltip-draghandle';
            dragHandle.id = `lighthouse-draghandle-${dragHandleIndex}`;

            const line = document.createElement('div');
            line.className = 'lighthouse-tooltip-draghandle-line';
            const circleDiv = document.createElement('div');
            circleDiv.className = 'lighthouse-tooltip-draghandle-circle';
            dragHandle.append(line, circleDiv);

            const root = getRoot();
            (root === document ? document.body : root).appendChild(dragHandle);
            layoutHandle(dragHandle, dragHandleIndex, dragHandleIndex == 0 ? selStartDimensions : selEndDimensions);
            window.LighthouseUtils.frame.draw('handle' + dragHandleIndex, () => { void dragHandle.offsetWidth; dragHandle.style.opacity = 1; });

            circleDiv.onmousedown = function (e) {
                if (window.LighthouseUI) window.LighthouseUI.destroy();

                // DYNAMIC INDEX RESOLUTION: Always read from DOM to handle swaps
                let activeHandleIndex = parseInt(dragHandle.id.split('-')[2]);
                if (isNaN(activeHandleIndex)) activeHandleIndex = dragHandleIndex;

                isDraggingDragHandle = true;
                draggingHandleIndex = activeHandleIndex;
                e.preventDefault();

                // Make ALL handles transparent to hits so caretRangeFromPoint sees text
                const root = getRoot();
                root.querySelectorAll('.lighthouse-tooltip-draghandle-circle').forEach(c => c.style.pointerEvents = 'none');

                if (window.LighthouseSelection.getActiveSelection) {
                    currentWindowSelection = window.LighthouseSelection.getActiveSelection().toString();
                } else if (document.selection) {
                    currentWindowSelection = document.selection.createRange().toString();
                }

                selStartDimensions = getSelectionCoordinates(true);
                selEndDimensions = getSelectionCoordinates(false);
                if (selStartDimensions == null || selEndDimensions == null) { hideDragHandles(); return; }

                document.body.style.cursor = 'grabbing';
                dragHandle.classList.add('is-dragging');

                initialScrollX = window.scrollX;
                initialScrollY = window.scrollY;

                const draggedDims = activeHandleIndex === 0 ? selStartDimensions : selEndDimensions;
                const draggedLH = draggedDims.lineHeight || selectionHandleLineHeight;
                const textCenterY = draggedDims.dy + draggedLH / 2;
                const dragOffsetY = e.clientY - textCenterY;

                // Capture the fixed end of the selection (the one NOT being dragged)
                let fixedAnchor = null;
                if (State.ctx && State.ctx.isInput && State.ctx.element) {
                    const el = State.ctx.element;
                    fixedAnchor = activeHandleIndex === 0 ? el.selectionEnd : el.selectionStart;
                } else {
                    const sel = window.LighthouseSelection.getActiveSelection();
                    if (sel && sel.rangeCount) {
                        const range = sel.getRangeAt(0);
                        fixedAnchor = activeHandleIndex === 0
                            ? { node: range.endContainer, offset: range.endOffset }
                            : { node: range.startContainer, offset: range.startOffset };
                    }
                }

                const onMove = function (e) {
                    try {
                        e.preventDefault();

                        const scrollDeltaX = window.scrollX - initialScrollX;
                        const scrollDeltaY = window.scrollY - initialScrollY;

                        // The anchor handle stays on its text, compensating for scroll
                        const anchorIndex = 1 - activeHandleIndex;
                        layoutHandle(root.getElementById(`lighthouse-draghandle-${anchorIndex}`), anchorIndex,
                            anchorIndex === 0 ? selStartDimensions : selEndDimensions, scrollDeltaX, scrollDeltaY);

                        // The dragged handle follows the pointer, centered on the line it points at
                        const adjustedY = e.clientY - dragOffsetY;
                        dragHandle.style.transform = `translate(${e.clientX - dragHandle.offsetWidth / 2}px, ${adjustedY - draggedLH / 2}px)`;

                        if (fixedAnchor !== null) {
                            if (State.ctx && State.ctx.isInput && State.ctx.element) {
                                const el = State.ctx.element;
                                const newIndex = getIndexFromCoordinates(el, e.clientX, adjustedY);
                                const start = Math.min(newIndex, fixedAnchor);
                                const end = Math.max(newIndex, fixedAnchor);
                                el.setSelectionRange(start, end, newIndex < fixedAnchor ? 'backward' : 'forward');
                            } else {
                                const focusPoint = SelLib.getPointFromCoords(e.clientX, adjustedY);
                                if (focusPoint) SelLib.setSafeRange(fixedAnchor, focusPoint);
                            }
                        }
                    } catch (e) {}

                    const edgeZone = 50;
                    if (e.clientY > window.innerHeight - edgeZone) {
                        if (!edgeScrollInterval) edgeScrollInterval = setInterval(() => window.scrollBy(0, 15), 16);
                    } else if (e.clientY < edgeZone) {
                        if (!edgeScrollInterval) edgeScrollInterval = setInterval(() => window.scrollBy(0, -15), 16);
                    } else if (edgeScrollInterval) {
                        clearInterval(edgeScrollInterval);
                        edgeScrollInterval = null;
                    }
                };

                const onUp = function (e) {
                    e.preventDefault();
                    stopDragListeners();
                    document.body.style.cursor = 'unset';
                    dragHandle.classList.remove('is-dragging');

                    if (edgeScrollInterval) {
                        clearInterval(edgeScrollInterval);
                        edgeScrollInterval = null;
                    }

                    root.querySelectorAll('.lighthouse-tooltip-draghandle-circle').forEach(c => c.style.pointerEvents = '');

                    setTimeout(function () {
                        const windowSelection = window.LighthouseSelection.getActiveSelection();
                        if (windowSelection && windowSelection.toString() == currentWindowSelection.toString()) {
                            window.LighthouseSelection.extendSelectionByWord(windowSelection, activeHandleIndex);
                        }

                        setTimeout(function () {
                            isDraggingDragHandle = false;
                            draggingHandleIndex = null;

                            let start = getSelectionCoordinates(true);
                            let end = getSelectionCoordinates(false);
                            if (start == null || end == null) { hideDragHandles(); return; }
                            if (end.dx == 0 && end.dy == 0) end = fromPointer() || end;
                            if (start.dx == 0 && start.dy == 0) start = fromPointer() || start;
                            if (end.dx > window.innerWidth - 25 && State.lastEvent) end.dx = State.lastEvent.clientX;

                            // Inversion: if the handles crossed, swap their identities
                            const distToStart = Math.hypot(start.dx - e.clientX, start.dy - e.clientY);
                            const distToEnd = Math.hypot(end.dx - e.clientX, end.dy - e.clientY);
                            if ((activeHandleIndex == 1 && distToStart < distToEnd) || (activeHandleIndex == 0 && distToEnd < distToStart)) {
                                const h0 = root.getElementById('lighthouse-draghandle-0');
                                const h1 = root.getElementById('lighthouse-draghandle-1');
                                if (h0 && h1) {
                                    h0.id = 'lighthouse-draghandle-1';
                                    h1.id = 'lighthouse-draghandle-0';
                                    activeHandleIndex = 1 - activeHandleIndex;
                                }
                            }

                            [0, 1].forEach(idx => {
                                const h = root.getElementById(`lighthouse-draghandle-${idx}`);
                                if (!h) return;
                                settle(h);
                                layoutHandle(h, idx, idx === 0 ? start : end);
                            });

                            const newCtx = SelLib.getContext();
                            const languageCheck = window.LighthouseLanguage ? window.LighthouseLanguage.inspect(newCtx) : Promise.resolve({ foreign: null, language: null });
                            languageCheck.then(({ foreign, language, reliable }) => {
                                newCtx.foreign = foreign;
                                newCtx.language = language;
                                newCtx.languageReliable = reliable === true;
                                State.update(newCtx);
                                if (window.LighthouseUI) window.LighthouseUI.render(State);
                            });
                        }, 2);
                    }, 1);
                };
                startDragListeners(onMove, onUp);
            };
        } catch (e) {}
    }

    function updateDragHandle(dragHandleIndex, selStartDimensions, selEndDimensions) {
        const dragHandle = getRoot().getElementById(`lighthouse-draghandle-${dragHandleIndex}`);
        if (!dragHandle) return;
        const dims = dragHandleIndex == 0 ? selStartDimensions : selEndDimensions;
        selectionHandleLineHeight = calculateLineHeight(dims, State.ctx && State.ctx.isInput, window.LighthouseSelection.getActiveSelection());
        layoutHandle(dragHandle, dragHandleIndex, dims);
    }

    function setDragHandles() {
        if (!State.get('addDragHandles', true)) return;

        const start = getSelectionCoordinates(true);
        const end = getSelectionCoordinates(false);
        
        if (!start || !end) return;
        
        if (start.dontAddDragHandles) return;

        const root = getRoot();

        let existingDragHandle0 = root.getElementById('lighthouse-draghandle-0');
        if (existingDragHandle0 == null || existingDragHandle0 == undefined) {
            addDragHandle(0, start, end);
        } else {
            updateDragHandle(0, start, end);
        }

        let existingDragHandle1 = root.getElementById('lighthouse-draghandle-1');
        if (existingDragHandle1 == null || existingDragHandle1 == undefined) {
            addDragHandle(1, start, end);
        } else {
            updateDragHandle(1, start, end);
        }
        
        if (window.LighthouseUtils && window.LighthouseUtils.logEvent) {
            window.LighthouseUtils.logEvent('HANDLES', 'UPDATE', 'Positions Updated');
        }
    }

    function hideDragHandles(animated = true, shouldIgnoreDragged = false) {
        ['handle0', 'handle1'].forEach(window.LighthouseUtils.frame.cancel);   // hidden before they could appear
        if (!shouldIgnoreDragged) {
            destroyMirror();   // the bar and handles are going: so is the field's mirror
            stopDragListeners();
            isDraggingDragHandle = false;
            draggingHandleIndex = null;
        }
        
        const root = getRoot();
        
        // Re-query every time to ensure we get the latest elements
        dragHandles = root.querySelectorAll('.lighthouse-tooltip-draghandle');

        for (let i = 0, l = dragHandles.length; i < l; i++) {
            const dragHandle = dragHandles[i];

            if (shouldIgnoreDragged && draggingHandleIndex !== null && draggingHandleIndex !== undefined) {
                try {
                    let id = dragHandle.id;
                    let handleIndex = parseInt(id.split('-')[2]);
                    if (handleIndex == draggingHandleIndex) continue;
                } catch (e) {}
            }

            if (!animated) dragHandle.style.transition = 'none';
            dragHandle.style.opacity = "0";
            dragHandle.style.pointerEvents = "none";

            setTimeout(function () {
                dragHandle.remove();
            }, animated ? duration() : 0);
        }
    }

    // Where the selection starts and ends ({ dx, dy, lineHeight } each), as the handles see it
    function selectionEnds() {
        try {
            const start = getSelectionCoordinates(true), end = getSelectionCoordinates(false);
            return start && end && !start.dontAddDragHandles ? { start, end } : null;
        } catch (e) { return null; }
    }

    window.LighthouseHandles = {
        setDragHandles,
        selectionEnds,
        hideDragHandles,
        get isDragging() { return isDraggingDragHandle; },
        get areVisible() { 
            const root = getRoot();
            const h = root.querySelectorAll('.lighthouse-tooltip-draghandle');
            return h.length > 0 && h[0].style.opacity !== '0';
        }
    };
})();
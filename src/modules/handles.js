(function() {
    const State = window.LighthouseState;
    const SelLib = window.LighthouseSelection;

    function getSetting(key, defaultValue) {
        if (State && State.settings && State.settings[key] !== undefined) {
            return State.settings[key];
        }
        return defaultValue;
    }

    const animationDuration = 200;

    let handleLine, handleCircle;
    let dragHandles;
    let isDraggingDragHandle = false;
    let draggingHandleIndex = null;
    let selectionHandleLineHeight = 21;
    let tooltipOnBottom = false;

    function getSelectionRectDimensions() {
        let sel, range;
        let width = 0, height = 0;
        let dx = 0, dy = 0;
        sel = window.getSelection();
        if (sel.rangeCount) {
            range = sel.getRangeAt(0).cloneRange();
            if (range.getBoundingClientRect) {
                const rect = range.getBoundingClientRect();
                width = rect.right - rect.left;
                height = rect.bottom - rect.top;
                dx = rect.left;
                dy = rect.top;
            }
        }
        return { width: width, height: height, dx: dx, dy: dy };
    }

    function getSelectionCoordinates(atStart) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return null;
        
        // Use Selection Module to get precise coordinates
        const range = sel.getRangeAt(0).cloneRange();
        range.collapse(atStart);
        
        const rect = range.getBoundingClientRect();
        let dx = rect.x;
        let dy = rect.y;
        let lineHeight = rect.height;

        // Fallback for empty/collapsed ranges
        if (dx === 0 && dy === 0) {
            const dims = getSelectionRectDimensions();
            if (atStart) {
                dx = dims.dx;
                dy = dims.dy;
            } else {
                dx = dims.dx + dims.width;
                dy = dims.dy + dims.height - (selectionHandleLineHeight - 7.5);
            }
        }

        // Fallback to mouse event if everything fails
        if (dx === 0 && dy === 0 && State.lastEvent) {
            dx = State.lastEvent.clientX;
            dy = State.lastEvent.clientY - 8;
        }

        return { dx, dy, lineHeight };
    }

    function createSelectionFromPoint(anchorX, anchorY, focusX, focusY, handleIndex) {
        // Use Selection Module to get precise points from coordinates
        const p1 = SelLib.getPointFromCoords(anchorX, anchorY);
        const p2 = SelLib.getPointFromCoords(focusX, focusY);

        if (p1 && p2) {
            // Use Selection Module to set the range safely
            // Note: handleIndex logic is simplified here because setSafeRange handles direction
            SelLib.setSafeRange(p1, p2);
        }
    }

    function addDragHandle(dragHandleIndex, selStartDimensions, selEndDimensions) {
        const selection = window.getSelection();
        if (selection == null || selection == undefined || !selection.rangeCount) return;

        const lineWidth = 2.5, circleHeight = 14, verticalOffsetCorrection = -1;

        try {
            selectionHandleLineHeight = (dragHandleIndex == 0 ? selStartDimensions.lineHeight : selEndDimensions.lineHeight) + 3;
            if (!selectionHandleLineHeight || isNaN(selectionHandleLineHeight)) {
                const selectedTextLineHeight = window.getComputedStyle(selection.anchorNode.parentElement, null).getPropertyValue('line-height');
                if (selectedTextLineHeight !== null && selectedTextLineHeight !== undefined && selectedTextLineHeight.includes('px')) {
                    const parsed = parseInt(selectedTextLineHeight.replaceAll('px', ''));
                    selectionHandleLineHeight = isNaN(parsed) ? 21 : parsed + 3;
                } else {
                    selectionHandleLineHeight = 21;
                }
            }
        } catch (e) {
            window.LighthouseUtils.Logger.warn('[Handles] Error calculating line height:', e);
            selectionHandleLineHeight = 21;
        }

        try {
            var currentWindowSelection;

            if (selEndDimensions.dx == 0 && selEndDimensions.dy == 0 && State.lastEvent) selEndDimensions = { dx: State.lastEvent.clientX, dy: State.lastEvent.clientY - (selectionHandleLineHeight / 2) - circleHeight };
            if (selStartDimensions.dx == 0 && selStartDimensions.dy == 0 && State.lastEvent) selStartDimensions = { dx: State.lastEvent.clientX, dy: State.lastEvent.clientY - (selectionHandleLineHeight / 2) - circleHeight };

            if (selStartDimensions == null || selEndDimensions == null) return;

            let dragHandleIsReverted = tooltipOnBottom;

            let dragHandle = document.createElement('div');
            dragHandle.className = 'lighthouse-tooltip-draghandle';
            dragHandle.id = `lighthouse-draghandle-${dragHandleIndex}`;
            dragHandle.style.transform = `translate(${dragHandleIndex == 0 ? selStartDimensions.dx - 2.5 : selEndDimensions.dx}px, ${(dragHandleIndex == 0 ? selStartDimensions.dy : selEndDimensions.dy) + verticalOffsetCorrection}px)`;
            dragHandle.style.transition = `opacity ${animationDuration}ms ease-out`;

            let line;
            if (!handleLine){
                line = document.createElement('div');
                line.className = 'lighthouse-tooltip-draghandle-line';
                line.style.width = `${lineWidth}px`;
                handleLine = line.cloneNode(false);
            } else {
                line = handleLine.cloneNode(false);
            }
            line.style.height = `${selectionHandleLineHeight}px`;
            dragHandle.appendChild(line);

            let circleDiv;
            if (!handleCircle){
                circleDiv = document.createElement('div');
                circleDiv.className = 'lighthouse-tooltip-draghandle-circle';
                circleDiv.style.cursor = 'grab';
                circleDiv.style.transition = `opacity ${animationDuration}ms ease-out, top 200ms ease, bottom 200ms ease`;
                handleCircle = circleDiv.cloneNode(false);
            } else {
                circleDiv = handleCircle.cloneNode(false);
            }

            // User preference: Both handles at bottom by default
            let isTopKnob = false;
            if (dragHandleIsReverted) isTopKnob = !isTopKnob;

            if (isTopKnob) {
                circleDiv.style.top = `-${circleHeight / 2}px`;
                circleDiv.style.bottom = 'auto';
            } else {
                circleDiv.style.top = `${selectionHandleLineHeight - circleHeight / 2}px`;
                circleDiv.style.bottom = 'auto';
            }

            const dragHandleStyle = getSetting('dragHandleStyle', 'circle');

            if (dragHandleStyle == 'triangle') {
                circleDiv.classList.add('draghandle-triangle');
                if (dragHandleIndex == 0) {
                    circleDiv.style.clipPath = 'polygon(0% 0%, 100% 100%, 0% 100%)';
                    circleDiv.style.left = `-${circleHeight}px`;
                    circleDiv.style.right = 'auto';
                } else {
                    circleDiv.style.clipPath = 'polygon(0% 0%, 100% 100%, 100% 0%)';
                    circleDiv.style.left = `${lineWidth}px`;
                    circleDiv.style.right = 'auto';
                }
            } else {
                if (dragHandleStyle == 'square') {
                    circleDiv.classList.add('draghandle-square');
                } else if (dragHandleStyle == 'rhombus') {
                    circleDiv.classList.add('draghandle-rhombus');
                }
                circleDiv.style.left = `${(lineWidth - circleHeight) / 2}px`;
                circleDiv.style.right = 'auto';
            }

            dragHandle.appendChild(circleDiv);

            setTimeout(function () {
                dragHandle.style.opacity = 1.0;
            }, 10);

            circleDiv.onmousedown = function (e) {
                if (window.LighthouseUI) window.LighthouseUI.destroy();
                
                // DYNAMIC INDEX RESOLUTION: Always read from DOM to handle swaps
                let activeHandleIndex = parseInt(dragHandle.id.split('-')[2]);
                if (isNaN(activeHandleIndex)) activeHandleIndex = dragHandleIndex; 

                isDraggingDragHandle = true;
                draggingHandleIndex = activeHandleIndex;
                e.preventDefault();

                // CRITICAL FIX: Make ALL handles transparent to hits so caretRangeFromPoint sees text
                const root = (window.LighthouseUI && window.LighthouseUI.shadowRoot) ? window.LighthouseUI.shadowRoot : document;
                const allHandles = root.querySelectorAll('.lighthouse-tooltip-draghandle');
                allHandles.forEach(h => h.style.pointerEvents = 'none');

                if (window.getSelection) {
                    currentWindowSelection = window.getSelection().toString();
                } else if (document.selection) {
                    currentWindowSelection = document.selection.createRange().toString();
                }

                selStartDimensions = getSelectionCoordinates(true);
                selEndDimensions = getSelectionCoordinates(false);
                if (selStartDimensions == null || selEndDimensions == null) { hideDragHandles(); return; }

                document.body.style.cursor = 'grabbing';
                circleDiv.style.cursor = 'grabbing';
                dragHandle.style.transition = '';

                let edgeScrollInterval = null;

                document.onmousemove = function (e) {
                    try {
                        e.preventDefault();

                        const deltaXFromInitial = activeHandleIndex == 0 ? (selStartDimensions.dx - e.clientX) : (selEndDimensions.dx - e.clientX);
                        const deltaYFromInitial = activeHandleIndex == 0 ? (selStartDimensions.dy - e.clientY) : (e.clientY - selEndDimensions.dy);

                        if (activeHandleIndex == 0) {
                            dragHandle.style.transform = `translate(${e.clientX}px, ${selStartDimensions.dy - selectionHandleLineHeight - deltaYFromInitial + verticalOffsetCorrection}px)`;
                        } else {
                            dragHandle.style.transform = `translate(${e.clientX}px, ${selEndDimensions.dy - (dragHandleIsReverted ? - (circleHeight / 2) : selectionHandleLineHeight) + deltaYFromInitial + verticalOffsetCorrection}px)`;
                        }

                        if (currentWindowSelection !== null && currentWindowSelection !== undefined && currentWindowSelection !== '') {
                            try {
                                if (activeHandleIndex == 0) {
                                    createSelectionFromPoint(
                                        selEndDimensions.dx - 2,
                                        selEndDimensions.dy + (selectionHandleLineHeight / 2),
                                        selStartDimensions.dx - deltaXFromInitial - 0.05,
                                        selStartDimensions.dy - deltaYFromInitial - (selectionHandleLineHeight),
                                        activeHandleIndex
                                    );
                                } else {
                                    createSelectionFromPoint(
                                        selStartDimensions.dx + 3,
                                        selStartDimensions.dy,
                                        selEndDimensions.dx - deltaXFromInitial - 0.05,
                                        selEndDimensions.dy + deltaYFromInitial - (dragHandleIsReverted ? - (selectionHandleLineHeight / 2) : selectionHandleLineHeight / 2),
                                        activeHandleIndex
                                    );
                                }
                            } catch (e) {}
                        }
                    } catch (e) {}

                    let clientY = e.clientY;
                    let sizeOfDetectingZone = 20, scrollStep = 3;

                    if (clientY > window.innerHeight - sizeOfDetectingZone) {
                        if (edgeScrollInterval == null)
                            edgeScrollInterval = setInterval(function () {
                                window.scrollTo({ top: window.scrollY + scrollStep, behavior: 'smooth' });
                            }, 1);
                    } else if (clientY < sizeOfDetectingZone) {
                        if (edgeScrollInterval == null)
                            edgeScrollInterval = setInterval(function () {
                                window.scrollTo({ top: window.scrollY - scrollStep, behavior: 'smooth' });
                            }, 1);
                    } else {
                        clearInterval(edgeScrollInterval);
                        edgeScrollInterval = null;
                    }
                };

                document.onmouseup = function (e) {
                    e.preventDefault();
                    document.onmousemove = null;
                    document.onmouseup = null;
                    document.body.style.cursor = 'unset';
                    circleDiv.style.cursor = 'grab';

                    // Restore pointer events on ALL handles
                    const root = (window.LighthouseUI && window.LighthouseUI.shadowRoot) ? window.LighthouseUI.shadowRoot : document;
                    const allHandles = root.querySelectorAll('.lighthouse-tooltip-draghandle');
                    allHandles.forEach(h => h.style.pointerEvents = 'auto');

                    clearInterval(edgeScrollInterval);
                    edgeScrollInterval = null;

                    setTimeout(function () {
                        let windowSelection = window.getSelection();

                        if (windowSelection.toString() == currentWindowSelection.toString()) {
                            SelLib.extendSelectionByWord(windowSelection, activeHandleIndex);
                        }

                        setTimeout(function () {
                            isDraggingDragHandle = false;
                            draggingHandleIndex = null;

                            let selStartDimensions = getSelectionCoordinates(true);
                            let selEndDimensions = getSelectionCoordinates(false);

                            if (selStartDimensions == null || selEndDimensions == null) { hideDragHandles(); return; }
                            if (selEndDimensions.dx == 0 && selEndDimensions.dy == 0 && State.lastEvent) selEndDimensions = { dx: State.lastEvent.clientX, dy: State.lastEvent.clientY - (selectionHandleLineHeight / 2) - circleHeight };
                            if (selStartDimensions.dx == 0 && selStartDimensions.dy == 0 && State.lastEvent) selStartDimensions = { dx: State.lastEvent.clientX, dy: State.lastEvent.clientY - (selectionHandleLineHeight / 2) - circleHeight };

                            if (selEndDimensions.dx > window.innerWidth - 25 && State.lastEvent) selEndDimensions.dx = State.lastEvent.clientX;

                            // --- INVERSION DETECTION & SWAP ---
                            const distToStart = Math.hypot(selStartDimensions.dx - e.clientX, selStartDimensions.dy - e.clientY);
                            const distToEnd = Math.hypot(selEndDimensions.dx - e.clientX, selEndDimensions.dy - e.clientY);
                            
                            const root = (window.LighthouseUI && window.LighthouseUI.shadowRoot) ? window.LighthouseUI.shadowRoot : document;
                            
                            if ((activeHandleIndex == 1 && distToStart < distToEnd) || (activeHandleIndex == 0 && distToEnd < distToStart)) {
                                const h0 = root.getElementById('lighthouse-draghandle-0');
                                const h1 = root.getElementById('lighthouse-draghandle-1');
                                if (h0 && h1) {
                                    h0.id = 'lighthouse-draghandle-1';
                                    h1.id = 'lighthouse-draghandle-0';
                                    activeHandleIndex = 1 - activeHandleIndex;
                                }
                            }

                            // --- UPDATE BOTH HANDLES ---
                            [0, 1].forEach(idx => {
                                const h = root.getElementById(`lighthouse-draghandle-${idx}`);
                                if (!h) return;

                                const dims = idx === 0 ? selStartDimensions : selEndDimensions;
                                const circle = h.querySelector('.lighthouse-tooltip-draghandle-circle');
                                const lineEl = h.querySelector('.lighthouse-tooltip-draghandle-line');

                                // Update Line Height
                                const lh = (dims.lineHeight || 21) + 6;
                                if (lineEl) lineEl.style.height = `${lh}px`;

                                // Update Position
                                h.style.transition = `transform 200ms ease-in-out, opacity ${animationDuration}ms ease-in-out`;
                                if (idx === 0) {
                                    h.style.transform = `translate(${dims.dx - 1}px, ${dims.dy + verticalOffsetCorrection}px)`;
                                } else {
                                    h.style.transform = `translate(${dims.dx}px, ${dims.dy + verticalOffsetCorrection}px)`;
                                }

                                // Update Knob (Bottom by default)
                                let isTop = false;
                                if (tooltipOnBottom) isTop = !isTop;

                                if (circle) {
                                    if (isTop) {
                                        circle.style.top = `-${circleHeight / 2}px`;
                                        circle.style.bottom = 'auto';
                                    } else {
                                        circle.style.top = `${lh - circleHeight / 2}px`;
                                        circle.style.bottom = 'auto';
                                    }
                                }

                                setTimeout(() => {
                                    h.style.transition = `opacity ${animationDuration}ms ease-in-out`;
                                }, 200);
                            });

                            // Re-trigger tooltip
                            State.update(SelLib.getContext());
                            if (window.LighthouseUI) window.LighthouseUI.render(State);

                        }, 2);

                    }, 1);
                };
            }

            if (window.LighthouseUI && window.LighthouseUI.shadowRoot) {
                window.LighthouseUI.shadowRoot.appendChild(dragHandle);
            } else {
                document.body.appendChild(dragHandle);
            }
        } catch (e) {}
    }

    function setDragHandles() {
        if (!getSetting('addDragHandles', true)) return;

        const start = getSelectionCoordinates(true);
        const end = getSelectionCoordinates(false);
        
        if (!start || !end) return;
        
        if (start.dontAddDragHandles) return;

        const root = (window.LighthouseUI && window.LighthouseUI.shadowRoot) ? window.LighthouseUI.shadowRoot : document;

        let existingDragHandle0 = root.getElementById('lighthouse-draghandle-0');
        if (existingDragHandle0 == null || existingDragHandle0 == undefined) {
            addDragHandle(0, start, end);
        }

        let existingDragHandle1 = root.getElementById('lighthouse-draghandle-1');
        if (existingDragHandle1 == null || existingDragHandle1 == undefined) {
            addDragHandle(1, start, end);
        }
    }

    function hideDragHandles(animated = true, shouldIgnoreDragged = false) {
        const root = (window.LighthouseUI && window.LighthouseUI.shadowRoot) ? window.LighthouseUI.shadowRoot : document;
        
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

            if (!animated) dragHandle.style.transition = '';
            dragHandle.style.opacity = "0";

            setTimeout(function () {
                dragHandle.remove();
            }, animated ? animationDuration : 0);
        }
    }

    window.LighthouseHandles = {
        setDragHandles,
        hideDragHandles,
        get isDragging() { return isDraggingDragHandle; }
    };
})();

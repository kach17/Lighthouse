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
    let initialScrollX = 0;
    let initialScrollY = 0;
    let edgeScrollInterval = null;

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

    function getInputCoordinates(element, atStart) {
        try {
            const index = atStart ? element.selectionStart : element.selectionEnd;
            const div = document.createElement('div');
            const style = window.getComputedStyle(element);
            
            const props = ['fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'whiteSpace', 'padding', 'border', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY', 'textAlign', 'direction'];
            props.forEach(p => div.style[p] = style[p]);
            
            div.style.position = 'fixed';
            div.style.visibility = 'hidden';
            
            const rect = element.getBoundingClientRect();
            div.style.top = rect.top + 'px';
            div.style.left = rect.left + 'px';
            
            div.textContent = element.value.substring(0, index);
            const span = document.createElement('span');
            span.textContent = '\u200b';
            div.appendChild(span);
            
            if (element.tagName === 'TEXTAREA') {
                div.appendChild(document.createTextNode(element.value.substring(index)));
            }

            document.body.appendChild(div);
            div.scrollTop = element.scrollTop;
            div.scrollLeft = element.scrollLeft;
            
            const spanRect = span.getBoundingClientRect();
            document.body.removeChild(div);
            
            return {
                dx: spanRect.left,
                dy: spanRect.top,
                lineHeight: spanRect.height || parseFloat(style.lineHeight) || 20
            };
        } catch (e) {
            return null;
        }
    }

    function getIndexFromCoordinates(element, x, y) {
        try {
            const div = document.createElement('div');
            const style = window.getComputedStyle(element);
            
            const props = ['fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'textIndent', 'whiteSpace', 'padding', 'border', 'boxSizing', 'width', 'height', 'overflowX', 'overflowY', 'textAlign', 'direction'];
            props.forEach(p => div.style[p] = style[p]);
            
            div.style.position = 'fixed';
            div.style.opacity = '0';
            div.style.zIndex = '2147483647';
            div.style.pointerEvents = 'auto';
            
            const rect = element.getBoundingClientRect();
            div.style.top = rect.top + 'px';
            div.style.left = rect.left + 'px';
            
            div.textContent = element.value;
            if (element.tagName === 'TEXTAREA') {
                 div.style.whiteSpace = style.whiteSpace;
            } else {
                 div.style.whiteSpace = 'pre';
            }

            document.body.appendChild(div);
            div.scrollTop = element.scrollTop;
            div.scrollLeft = element.scrollLeft;
            
            let offset = 0;
            if (document.caretRangeFromPoint) {
                const range = document.caretRangeFromPoint(x, y);
                if (range) {
                    if (range.startContainer.nodeType === 3) {
                        offset = range.startOffset;
                    } else if (range.startContainer === div && div.firstChild) {
                         // Fallback if it hits the container
                         // If offset is 0, it's start. If 1 (and 1 child), it's end?
                         // caretRangeFromPoint on element returns child index.
                         if (range.startOffset === 0) offset = 0;
                         else offset = div.textContent.length;
                    }
                }
            } else if (document.caretPositionFromPoint) {
                const pos = document.caretPositionFromPoint(x, y);
                if (pos) offset = pos.offset;
            }
            
            document.body.removeChild(div);
            return offset;
        } catch (e) {
            return 0;
        }
    }

    function getSelectionCoordinates(atStart) {
        if (State.ctx && State.ctx.isInput && State.ctx.element) {
             const coords = getInputCoordinates(State.ctx.element, atStart);
             if (coords) return coords;
        }

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
        if (State.ctx && State.ctx.isInput && State.ctx.element) {
            const el = State.ctx.element;
            const i1 = getIndexFromCoordinates(el, anchorX, anchorY);
            const i2 = getIndexFromCoordinates(el, focusX, focusY);
            const start = Math.min(i1, i2);
            const end = Math.max(i1, i2);
            const dir = i1 > i2 ? 'backward' : 'forward';
            el.setSelectionRange(start, end, dir);
            return;
        }

        // Use Selection Module to get precise points from coordinates
        const p1 = SelLib.getPointFromCoords(anchorX, anchorY);
        const p2 = SelLib.getPointFromCoords(focusX, focusY);

        if (p1 && p2) {
            // Use Selection Module to set the range safely
            // Note: handleIndex logic is simplified here because setSafeRange handles direction
            SelLib.setSafeRange(p1, p2);
        }
    }

    function calculateLineHeight(dimensions, isInput, selection) {
        let lh = dimensions.lineHeight + 3;
        if (!lh || isNaN(lh)) {
            if (isInput && State.ctx.element) {
                const style = window.getComputedStyle(State.ctx.element);
                const parsed = parseInt(style.lineHeight);
                lh = isNaN(parsed) ? 21 : parsed + 3;
            } else if (selection && selection.anchorNode) {
                const selectedTextLineHeight = window.getComputedStyle(selection.anchorNode.parentElement, null).getPropertyValue('line-height');
                if (selectedTextLineHeight && selectedTextLineHeight.includes('px')) {
                    const parsed = parseInt(selectedTextLineHeight.replaceAll('px', ''));
                    lh = isNaN(parsed) ? 21 : parsed + 3;
                } else {
                    lh = 21;
                }
            } else {
                lh = 21;
            }
        }
        return lh;
    }

    function addDragHandle(dragHandleIndex, selStartDimensions, selEndDimensions) {
        const selection = window.getSelection();
        const isInput = State.ctx && State.ctx.isInput;
        if (!isInput && (selection == null || selection == undefined || !selection.rangeCount)) return;

        const lineWidth = 2.25, circleHeight = 10, verticalOffsetCorrection = -1;

        try {
            selectionHandleLineHeight = calculateLineHeight(
                dragHandleIndex == 0 ? selStartDimensions : selEndDimensions,
                isInput,
                selection
            );
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

            circleDiv.style.right = `${(circleHeight / 2) - (lineWidth / 2)}px`;
            circleDiv.style.left = 'auto';

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
                
                initialScrollX = window.scrollX;
                initialScrollY = window.scrollY;

                const textCenterY = activeHandleIndex === 0 ? 
                    selStartDimensions.dy + ((selStartDimensions.lineHeight || 21) / 2) : 
                    selEndDimensions.dy + ((selEndDimensions.lineHeight || 21) / 2);
                const dragOffsetY = e.clientY - textCenterY;

                // Capture Fixed Anchor for robust selection updates (even if off-screen)
                let fixedAnchor = null;
                if (State.ctx && State.ctx.isInput && State.ctx.element) {
                    const el = State.ctx.element;
                    // For inputs, we capture the index of the OPPOSITE end
                    fixedAnchor = activeHandleIndex === 0 ? el.selectionEnd : el.selectionStart;
                } else {
                    const sel = window.getSelection();
                    if (sel.rangeCount) {
                        const range = sel.getRangeAt(0);
                        // For text, we capture the Node/Offset of the OPPOSITE end
                        // Handle 0 is Start (Left), so Anchor is End.
                        // Handle 1 is End (Right), so Anchor is Start.
                        if (activeHandleIndex === 0) {
                            fixedAnchor = { node: range.endContainer, offset: range.endOffset };
                        } else {
                            fixedAnchor = { node: range.startContainer, offset: range.startOffset };
                        }
                    }
                }

                document.onmousemove = function (e) {
                    try {
                        e.preventDefault();

                        const scrollDeltaX = window.scrollX - initialScrollX;
                        const scrollDeltaY = window.scrollY - initialScrollY;

                        // Update Anchor Handle (The one NOT being dragged)
                        const anchorIndex = 1 - activeHandleIndex;
                        const anchorH = root.getElementById(`lighthouse-draghandle-${anchorIndex}`);
                        if (anchorH) {
                            const anchorDims = anchorIndex === 0 ? selStartDimensions : selEndDimensions;
                            anchorH.style.transform = `translate(${anchorDims.dx - (anchorIndex === 0 ? 2.5 : 0) - scrollDeltaX}px, ${anchorDims.dy + verticalOffsetCorrection - scrollDeltaY}px)`;
                        }

                        const deltaXFromInitial = activeHandleIndex == 0 ? (selStartDimensions.dx - e.clientX) : (selEndDimensions.dx - e.clientX);
                        const deltaYFromInitial = activeHandleIndex == 0 ? (selStartDimensions.dy - e.clientY) : (e.clientY - selEndDimensions.dy);

                        // Update Dragged Handle Visuals
                        if (activeHandleIndex == 0) {
                            dragHandle.style.transform = `translate(${e.clientX}px, ${selStartDimensions.dy - selectionHandleLineHeight - deltaYFromInitial + verticalOffsetCorrection}px)`;
                        } else {
                            dragHandle.style.transform = `translate(${e.clientX}px, ${selEndDimensions.dy - (dragHandleIsReverted ? - (circleHeight / 2) : selectionHandleLineHeight) + deltaYFromInitial + verticalOffsetCorrection}px)`;
                        }

                        // Update Selection Logic (Robust Method)
                        if (fixedAnchor !== null) {
                            const adjustedY = e.clientY - dragOffsetY;
                            if (State.ctx && State.ctx.isInput && State.ctx.element) {
                                const el = State.ctx.element;
                                const newIndex = getIndexFromCoordinates(el, e.clientX, adjustedY);
                                const start = Math.min(newIndex, fixedAnchor);
                                const end = Math.max(newIndex, fixedAnchor);
                                el.setSelectionRange(start, end, newIndex < fixedAnchor ? 'backward' : 'forward');
                            } else {
                                const focusPoint = SelLib.getPointFromCoords(e.clientX, adjustedY);
                                if (focusPoint) {
                                    SelLib.setSafeRange(fixedAnchor, focusPoint);
                                }
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

                document.onmouseup = function (e) {
                    e.preventDefault();
                    document.onmousemove = null;
                    document.onmouseup = null;
                    document.body.style.cursor = 'unset';
                    circleDiv.style.cursor = 'grab';

                    if (edgeScrollInterval) {
                        clearInterval(edgeScrollInterval);
                        edgeScrollInterval = null;
                    }

                    // Restore pointer events on ALL handles
                    const root = (window.LighthouseUI && window.LighthouseUI.shadowRoot) ? window.LighthouseUI.shadowRoot : document;
                    const allHandles = root.querySelectorAll('.lighthouse-tooltip-draghandle');
                    allHandles.forEach(h => h.style.pointerEvents = 'auto');

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

    function updateDragHandle(dragHandleIndex, selStartDimensions, selEndDimensions) {
        const root = (window.LighthouseUI && window.LighthouseUI.shadowRoot) ? window.LighthouseUI.shadowRoot : document;
        const dragHandle = root.getElementById(`lighthouse-draghandle-${dragHandleIndex}`);
        if (!dragHandle) return;

        const circleHeight = 10, verticalOffsetCorrection = -1;
        
        selectionHandleLineHeight = calculateLineHeight(
            dragHandleIndex == 0 ? selStartDimensions : selEndDimensions,
            State.ctx && State.ctx.isInput,
            window.getSelection()
        );

        // Update Position
        dragHandle.style.transform = `translate(${dragHandleIndex == 0 ? selStartDimensions.dx - 2.5 : selEndDimensions.dx}px, ${(dragHandleIndex == 0 ? selStartDimensions.dy : selEndDimensions.dy) + verticalOffsetCorrection}px)`;
        
        // Update Line Height
        const line = dragHandle.querySelector('.lighthouse-tooltip-draghandle-line');
        if (line) line.style.height = `${selectionHandleLineHeight}px`;

        // Update Circle Position
        const circleDiv = dragHandle.querySelector('.lighthouse-tooltip-draghandle-circle');
        if (circleDiv) {
             let isTopKnob = false;
             if (tooltipOnBottom) isTopKnob = !isTopKnob;
             
             if (isTopKnob) {
                 circleDiv.style.top = `-${circleHeight / 2}px`;
                 circleDiv.style.bottom = 'auto';
             } else {
                 circleDiv.style.top = `${selectionHandleLineHeight - circleHeight / 2}px`;
                 circleDiv.style.bottom = 'auto';
             }
        }
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
            dragHandle.style.pointerEvents = "none";

            setTimeout(function () {
                dragHandle.remove();
            }, animated ? animationDuration : 0);
        }
    }

    window.LighthouseHandles = {
        setDragHandles,
        hideDragHandles,
        get isDragging() { return isDraggingDragHandle; },
        get areVisible() { 
            const root = (window.LighthouseUI && window.LighthouseUI.shadowRoot) ? window.LighthouseUI.shadowRoot : document;
            const h = root.querySelectorAll('.lighthouse-tooltip-draghandle');
            return h.length > 0 && h[0].style.opacity !== '0';
        }
    };
})();

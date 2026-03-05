(function() {
    const $ = window.LighthouseUtils;
    const State = window.LighthouseState;

    const markers = [];

    function createSelectionHighlightSpan(bg, fg, marker, scrollbarHint) {
        let span = document.createElement("span");
        span.style.backgroundColor = bg ?? "yellow";
        span.style.color = fg ?? "inherit";
        span.style.position = 'relative';
        span.className = 'lighthouse-marker-highlight';
        span.dataset.markerId = marker.id;
        return span;
    }

    function createFloatingDeleteButton(marker) {
        let deleteButton = document.createElement('div');
        deleteButton.className = 'marker-highlight-delete-floating';
        
        // Use SVG for better alignment and theming
        deleteButton.innerHTML = `
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        `;
        
        deleteButton.title = 'Delete';
        deleteButton.dataset.markerId = marker.id;
        deleteButton.style.position = 'absolute';
        deleteButton.style.display = 'none';
        deleteButton.style.zIndex = '999999999';
        
        if (marker.timeAdded) {
            let date = new Date();
            date.setTime(marker.timeAdded);
            deleteButton.title = 'Marked ' + date.toLocaleString();
        }

        deleteButton.onclick = function (e) {
            e.stopPropagation();
            removeMarker(marker.id);
        };

        document.body.appendChild(deleteButton);
        return deleteButton;
    }

    let pendingPositionUpdates = new Set();
    let rafScheduled = false;

    function schedulePositionUpdate(markerId) {
        pendingPositionUpdates.add(markerId);
        
        if (!rafScheduled) {
            rafScheduled = true;
            requestAnimationFrame(() => {
                const updates = [];
                pendingPositionUpdates.forEach(id => {
                    const spans = document.querySelectorAll(`span[data-marker-id="${id}"]`);
                    if (spans.length === 0) return;

                    // Position the button relative to the LAST span in the highlight
                    // This ensures it's always right next to the end of the text
                    const lastSpan = spans[spans.length - 1];
                    const rect = lastSpan.getBoundingClientRect();

                    updates.push({
                        id: id,
                        top: rect.top + window.scrollY - 10,
                        left: rect.right + window.scrollX + 5
                    });
                });

                updates.forEach(update => {
                    const deleteButton = document.querySelector(`.marker-highlight-delete-floating[data-marker-id="${update.id}"]`);
                    if (deleteButton) {
                        deleteButton.style.top = `${update.top}px`;
                        deleteButton.style.left = `${update.left}px`;
                    }
                });

                pendingPositionUpdates.clear();
                rafScheduled = false;
            });
        }
    }

    function positionDeleteButton(markerId) {
        schedulePositionUpdate(markerId);
    }

    function showDeleteButton(markerId) {
        const deleteButton = document.querySelector(`.marker-highlight-delete-floating[data-marker-id="${markerId}"]`);
        if (deleteButton) {
            positionDeleteButton(markerId);
            deleteButton.style.display = 'block';
        }
    }

    function hideDeleteButton(markerId) {
        const deleteButton = document.querySelector(`.marker-highlight-delete-floating[data-marker-id="${markerId}"]`);
        if (deleteButton) {
            deleteButton.style.display = 'none';
        }
    }

    function removeMarker(markerId) {
        try {
            const marker = markers.find(m => m.id === markerId);
            if (!marker) return;

            const deleteButton = document.querySelector(`.marker-highlight-delete-floating[data-marker-id="${markerId}"]`);
            if (deleteButton) deleteButton.remove();

            const spans = document.querySelectorAll(`span[data-marker-id="${markerId}"]`);
            spans.forEach(span => {
                span.style.transition = 'background-color 150ms ease-out';
                span.style.backgroundColor = 'transparent';
            });

            setTimeout(() => {
                if (marker.scrollbarHint) marker.scrollbarHint.remove();

                spans.forEach(span => {
                    const parent = span.parentNode;
                    if (parent) {
                        while (span.firstChild) parent.insertBefore(span.firstChild, span);
                        parent.removeChild(span);
                        parent.normalize();
                    }
                });

                const idx = markers.indexOf(marker);
                if (idx > -1) {
                    markers.splice(idx, 1);
                }
            }, 150);
        } catch (e) {
            window.LighthouseUtils.Logger.warn(e);
        }
    }

    function markTextSelection(bg, fg, text) {
        let selectionRect = { dx: 0, dy: 0, width: 0, height: 0 };
        const sel = window.getSelection();
        if (sel.rangeCount) {
            const rect = sel.getRangeAt(0).getBoundingClientRect();
            selectionRect = { dx: rect.left, dy: rect.top, width: rect.width, height: rect.height };
        }
        
        const minHintHeight = 10;
        let scrollbarHint = document.createElement('div');
        scrollbarHint.className = 'marker-scrollbar-hint';
        scrollbarHint.style.backgroundColor = bg ?? "yellow";

        let dyForHint = ((selectionRect.dy + window.scrollY) * window.innerHeight) / document.body.scrollHeight;
        if (dyForHint < 5) dyForHint = 5;
        if (dyForHint > window.innerHeight - 5) dyForHint = window.innerHeight - 5;
        scrollbarHint.style.top = `${dyForHint}px`;

        let hintHeight = (selectionRect.height * window.innerHeight) / document.body.scrollHeight;
        if (hintHeight < minHintHeight) hintHeight = minHintHeight;
        scrollbarHint.style.height = `${hintHeight}px`;

        const markersOnTheSameHeight = markers.filter(m => m.hintDy === dyForHint);
        if (markersOnTheSameHeight.length !== 0) {
            const shift = 100 * markersOnTheSameHeight.length;
            scrollbarHint.style.transform = `translate(-${shift + 5}%, 0)`;
        }

        let hoverHint = document.createElement('span');
        hoverHint.innerText = text;
        hoverHint.className = 'marker-scrollbar-tooltip';
        hoverHint.style.maxWidth = `${window.innerWidth * 0.3}px`;
        hoverHint.style.maxHeight = `${window.innerHeight * 0.6}px`;
        scrollbarHint.appendChild(hoverHint);
        document.body.appendChild(scrollbarHint);

        if (hoverHint.getBoundingClientRect().top < 0) {
            hoverHint.classList.add('marker-scrollbar-tooltip-bottom');
        }

        const markerId = 'marker-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        
        if (!sel || sel.rangeCount === 0) {
            scrollbarHint.remove();
            return;
        }
        const range = sel.getRangeAt(0);

        let marker = {
            id: markerId,
            hintDy: dyForHint,
            hintHeight: hintHeight,
            background: bg ?? "yellow",
            foreground: fg ?? "inherit",
            text: text,
            scrollbarHint: scrollbarHint
        };

        let success = wrapTextNodes(range, marker, bg, fg);

        if (success) {
            markers.push(marker);
            scrollbarHint.onmousedown = function () {
                const firstSpan = document.querySelector(`span[data-marker-id="${markerId}"]`);
                if (firstSpan) firstSpan.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
            };
        } else {
            scrollbarHint.remove();
        }
    }

    function wrapTextNodes(range, marker, bg, fg) {
        try {
            const startContainer = range.startContainer;
            const endContainer = range.endContainer;
            const startOffset = range.startOffset;
            const endOffset = range.endOffset;

            const textNodesData = [];
            const walker = document.createTreeWalker(
                range.commonAncestorContainer,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function(node) {
                        const nodeRange = document.createRange();
                        nodeRange.selectNodeContents(node);
                        if (range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0 &&
                            range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0) {
                            return NodeFilter.FILTER_ACCEPT;
                        }
                        return NodeFilter.FILTER_REJECT;
                    }
                }
            );

            let node;
            while (node = walker.nextNode()) {
                const isFirst = (node === startContainer);
                const isLast = (node === endContainer);
                let start = 0;
                let end = node.nodeValue.length;
                if (isFirst) start = startOffset;
                if (isLast) end = endOffset;
                if (start < end) {
                    const textContent = node.nodeValue.substring(start, end);
                    // Skip text nodes that are entirely whitespace to prevent breaking flex/grid layouts
                    if (textContent.trim().length > 0) {
                        textNodesData.push({ node: node, start: start, end: end, parent: node.parentNode });
                    }
                }
            }

            if (textNodesData.length === 0) return false;

            const groups = [];
            let currentGroup = [textNodesData[0]];
            for (let i = 1; i < textNodesData.length; i++) {
                const prev = textNodesData[i - 1];
                const curr = textNodesData[i];
                if (curr.parent === prev.parent && curr.node.previousSibling === prev.node) {
                    currentGroup.push(curr);
                } else {
                    groups.push(currentGroup);
                    currentGroup = [curr];
                }
            }
            groups.push(currentGroup);

            groups.forEach(group => {
                if (group.length === 1) {
                    const data = group[0];
                    const text = data.node.nodeValue;
                    const before = text.substring(0, data.start);
                    const highlighted = text.substring(data.start, data.end);
                    const after = text.substring(data.end);
                    
                    const span = createSelectionHighlightSpan(bg, fg, marker, marker.scrollbarHint);
                    span.appendChild(document.createTextNode(highlighted));
                    
                    const parent = data.parent;
                    if (before) parent.insertBefore(document.createTextNode(before), data.node);
                    parent.insertBefore(span, data.node);
                    if (after) parent.insertBefore(document.createTextNode(after), data.node);
                    parent.removeChild(data.node);
                } else {
                    const parent = group[0].parent;
                    const fragment = document.createDocumentFragment();
                    group.forEach((data, idx) => {
                        const text = data.node.nodeValue;
                        const start = data.start;
                        const end = data.end;
                        if (idx === 0 && start > 0) parent.insertBefore(document.createTextNode(text.substring(0, start)), data.node);
                        fragment.appendChild(document.createTextNode(text.substring(start, end)));
                        if (idx === group.length - 1 && end < text.length) parent.insertBefore(document.createTextNode(text.substring(end)), data.node);
                    });
                    const span = createSelectionHighlightSpan(bg, fg, marker, marker.scrollbarHint);
                    span.appendChild(fragment);
                    parent.insertBefore(span, group[0].node);
                    group.forEach(data => parent.removeChild(data.node));
                }
            });

            createFloatingDeleteButton(marker);
            return true;
        } catch (e) {
            window.LighthouseUtils.Logger.error('Error wrapping text nodes:', e);
            return false;
        }
    }

    function initEventDelegation() {
        let hideTimeout = null;
        let currentMarkerId = null;

        document.addEventListener('mouseover', (e) => {
            const span = e.target.closest ? e.target.closest('.lighthouse-marker-highlight') : null;
            const deleteBtn = e.target.closest ? e.target.closest('.marker-highlight-delete-floating') : null;

            if (span) {
                const markerId = span.dataset.markerId;
                if (currentMarkerId !== markerId) {
                    if (currentMarkerId) hideDeleteButton(currentMarkerId);
                    currentMarkerId = markerId;
                }
                clearTimeout(hideTimeout);
                showDeleteButton(markerId);
            } else if (deleteBtn) {
                clearTimeout(hideTimeout);
            } else {
                if (currentMarkerId) {
                    const prevMarkerId = currentMarkerId;
                    hideTimeout = setTimeout(() => {
                        hideDeleteButton(prevMarkerId);
                        if (currentMarkerId === prevMarkerId) {
                            currentMarkerId = null;
                        }
                    }, 200);
                }
            }
        });
    }

    function init() {
        initEventDelegation();
    }

    window.LighthouseMarkers = {
        init,
        markTextSelection
    };
})();

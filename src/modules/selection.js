/**
 * Lighthouse - Selection Module
 * Handles context retrieval, smart snapping, and expansion logic.
 */
(function() {
    const Data = window.LighthouseData; // Import Data
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    
    // Use Data.js for snapping logic
    const PAIRS = Data.SNAPPING_PAIRS;
    const REVERSE_PAIRS = Data.REVERSE_SNAPPING_PAIRS;

    function sanitizeText(text) {
        if (!text) return text;

        // 1. Invisible characters (Zero-width space, Soft hyphen, BOM)
        text = text.replace(/[\u200B\u00AD\uFEFF]/g, '');

        // 2. URL Cleanup
        if (text.match(/^https?:\/\//) || text.match(/^www\./)) {
            try {
                let urlObj = new URL(text.startsWith('www.') ? 'http://' + text : text);
                const paramsToRemove = ['fbclid', 'gclid', 'msclkid'];
                const keys = Array.from(urlObj.searchParams.keys());
                
                keys.forEach(key => {
                    if (paramsToRemove.includes(key) || key.startsWith('utm_')) {
                        urlObj.searchParams.delete(key);
                    }
                });
                text = urlObj.toString();
            } catch (e) {
                 const regex = new RegExp(`([?&])(utm_[^&=]*|fbclid|gclid|msclkid)=[^&]*`, 'gi');
                 text = text.replace(regex, '');
                 text = text.replace(/[?&]$/, '').replace(/\?&/, '?').replace(/&&/, '&');
            }
        }

        // 3. Normalization (Non-breaking spaces to space, trim)
        text = text.replace(/\u00A0/g, ' ').trim();

        return text;
    }

    function getContext() {
        const el = document.activeElement;
        const isForm = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
        const isEditable = el && el.isContentEditable;
        const isInput = isForm || isEditable;
        
        let text = '';
        if (isForm) {
            text = el.value.substring(el.selectionStart, el.selectionEnd);
        } else {
            text = window.getSelection().toString();
            
            // Firefox fallback for textarea if selection is empty but we are in a textarea
            if (text === '' && navigator.userAgent.indexOf("Firefox") > -1 && el && el.tagName === 'TEXTAREA') {
                text = el.value.substring(el.selectionStart, el.selectionEnd);
            }
        }
        
        text = sanitizeText(text);
        
        // Emptiness check for contenteditable
        let isEmptyInput = false;
        if (isInput) {
            if (isEditable) {
                isEmptyInput = el.innerHTML === '' || el.innerHTML === '<br>';
            } else if (isForm) {
                isEmptyInput = !el.value || el.value.trim() === '';
            }
        }
        
        // Semantic Analysis
        const semanticNode = isInput ? el : (window.getSelection().anchorNode ? (window.getSelection().anchorNode.nodeType === 3 ? window.getSelection().anchorNode.parentElement : window.getSelection().anchorNode) : null);
        const semantic = getSemanticInfo(semanticNode, text);

        return { 
            text, 
            isInput, 
            isForm, 
            isEditable, 
            isEmptyInput,
            hasText: text.length > 0, 
            element: isInput ? el : null,
            semanticType: semantic.type
        };
    }

    function getSemanticInfo(element, text) {
        if (!element) return { type: null };

        const tag = element.tagName;
        const type = element.getAttribute('type');
        const name = (element.getAttribute('name') || '').toLowerCase();
        const id = (element.getAttribute('id') || '').toLowerCase();
        const cls = (element.className || '').toString().toLowerCase();

        // 1. Code
        if (tag === 'CODE' || tag === 'PRE' || cls.includes('code') || cls.includes('hljs') || cls.includes('language-')) {
            return { type: 'code' };
        }

        // 2. Inputs
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
            if (type === 'password') return { type: 'password' };
            if (type === 'email' || name.includes('email') || id.includes('email')) return { type: 'email' };
            if (type === 'tel' || name.includes('phone') || name.includes('tel')) return { type: 'phone' };
            if (type === 'date' || name.includes('date') || name.includes('dob')) return { type: 'date' };
            if (type === 'search' || name.includes('search') || name.includes('query')) return { type: 'search' };
        }

        // 3. Text Patterns
        if (text) {
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { type: 'email' };
            if (/^(http|https):\/\//.test(text)) return { type: 'url' };
        }

        return { type: null };
    }

    function getLinkContext(target) {
        const link = target.closest('a');
        if (!link || !link.href) return null;
        
        // Ensure we aren't selecting text *inside* the link
        if (window.getSelection().toString().trim().length > 0) return null;

        return {
            isLink: true,
            url: link.href,
            text: link.textContent.trim(),
            element: link,
            hasText: true // To pass generic checks if needed
        };
    }

    /**
     * Traverses up the DOM to find the language of the selected context.
     * Defaults to navigator.language if no 'lang' attribute is found.
     */
    function getLanguage(ctx) {
        let node = null;
        if (ctx.isInput && ctx.element) {
            node = ctx.element;
        } else if (ctx.isLink) {
            node = ctx.element;
        } else if (window.getSelection().anchorNode) {
            node = window.getSelection().anchorNode;
            // If text node, move up to element
            if (node.nodeType === 3) node = node.parentElement;
        }

        while (node && node.nodeType === 1) {
            if (node.hasAttribute('lang')) return node.getAttribute('lang');
            node = node.parentElement;
        }
        return navigator.language || 'en';
    }

    function insertText(ctx, text) {
        if (ctx.isForm) {
            const el = ctx.element;
            const start = el.selectionStart;
            
            // Try execCommand first to preserve undo stack (Ctrl+Z)
            el.focus();
            const success = document.execCommand('insertText', false, text);
            
            if (success) {
                // execCommand places cursor at the end, we need to re-select
                // This is critical for actions like 'case' cycling where we want to keep acting on the same text.
                el.setSelectionRange(start, start + text.length);
            } else {
                // Fallback if execCommand fails
                el.setRangeText(text, start, el.selectionEnd, 'select');
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } else if (ctx.isEditable) {
            document.execCommand('insertText', false, text);
        }
    }

    function handleExpand() {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        
        let container = range.commonAncestorContainer;
        if (container.nodeType === 3) container = container.parentElement;
    
        const coversNode = (node) => {
            const r = document.createRange(); r.selectNodeContents(node);
            return (range.compareBoundaryPoints(Range.START_TO_START, r) <= 0) && (range.compareBoundaryPoints(Range.END_TO_END, r) >= 0);
        };
    
        if (container.tagName !== 'BODY' && container.tagName !== 'HTML' && !coversNode(container)) {
            selectNode(container); return;
        }
    
        const parent = container.parentElement;
        if (parent && parent.tagName !== 'HTML') {
             const headers = Array.from(parent.querySelectorAll('h1, h2, h3, h4, h5, h6'));
             let startH = null, endH = null;
    
             for (const h of headers) {
                 if (h === container || (h.compareDocumentPosition(container) & Node.DOCUMENT_POSITION_FOLLOWING)) startH = h;
                 else break;
             }
    
             if (startH) {
                 const startLevel = parseInt(startH.tagName.substring(1));
                 endH = headers.find((h, i) => i > headers.indexOf(startH) && parseInt(h.tagName.substring(1)) <= startLevel);
                 
                 const topicRange = document.createRange();
                 topicRange.setStartBefore(startH);
                 endH ? topicRange.setEndBefore(endH) : topicRange.setEndAfter(parent.lastChild);
                 
                 const isBigger = (topicRange.compareBoundaryPoints(Range.START_TO_START, range) < 0) || (topicRange.compareBoundaryPoints(Range.END_TO_END, range) > 0);
                 if (isBigger) { sel.removeAllRanges(); sel.addRange(topicRange); return; }
             }
             selectNode(parent);
        }
    }

    function selectNode(node) {
        const s = window.getSelection(), r = document.createRange();
        r.selectNodeContents(node); s.removeAllRanges(); s.addRange(r);
    }

    // --- Low-Level Point/Range Utilities ---

    function getPointFromCoords(x, y) {
        let range = null;
        
        // 1. Native Hit Test
        if (document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(x, y);
        } else if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(x, y);
            if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
                range.collapse(true);
            }
        }

        if (!range) return null;

        let node = range.startContainer;
        let offset = range.startOffset;

        // 2. Intelligent Drill-Down
        // If the browser returns an ELEMENT (e.g., div, p, section), it often means we hit 
        // padding or the empty space of a block. This causes "div jumping".
        // We must drill down to find the actual TEXT node to keep selection sticky.

        if (node.nodeType === 1) { // ELEMENT_NODE
            
            // Allow inputs to pass through naturally
            if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
                return { node, offset };
            }

            const length = node.childNodes.length;
            if (length > 0) {
                let candidateNode = null;
                let candidateOffset = 0;

                if (offset >= length) {
                    // Hit the end of the element -> Look at last child
                    candidateNode = node.childNodes[length - 1];
                    // If it's text, grab the end
                    if (candidateNode.nodeType === 3) {
                         candidateOffset = candidateNode.textContent.length;
                    } else {
                         // Drill down to finding last text node in that tree
                         const walker = document.createTreeWalker(candidateNode, NodeFilter.SHOW_TEXT, null);
                         let last = null;
                         while(walker.nextNode()) last = walker.currentNode;
                         if (last) { candidateNode = last; candidateOffset = last.textContent.length; }
                         else candidateNode = null; // Empty element
                    }
                } else {
                    // Hit a specific child index -> Look at that child
                    candidateNode = node.childNodes[offset];
                    if (candidateNode.nodeType === 3) {
                         candidateOffset = 0;
                    } else {
                         // Drill down to find first text node in that tree
                         const walker = document.createTreeWalker(candidateNode, NodeFilter.SHOW_TEXT, null);
                         if (walker.nextNode()) {
                             candidateNode = walker.currentNode;
                             candidateOffset = 0;
                         } else candidateNode = null;
                    }
                }

                if (candidateNode && candidateNode.nodeType === 3) {
                    node = candidateNode;
                    offset = candidateOffset;
                }
            }
        }

        // 3. Strict Check: Only return if we found a Text Node (or Input)
        // This effectively ignores hits on "empty" container backgrounds that have no text.
        if (node.nodeType === 3 || (node.nodeType === 1 && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA'))) {
            return { node, offset };
        }

        return null; 
    }

    /**
     * Creates a range between two points, automatically handling start/end ordering.
     */
    function setSafeRange(p1, p2) {
        if (!p1 || !p2) return;
        const sel = window.getSelection();
        
        try {
            const r = document.createRange();
            r.setStart(p1.node, p1.offset);
            
            // Check if p2 is before p1
            const r2 = document.createRange();
            r2.setStart(p2.node, p2.offset);
            
            if (r.compareBoundaryPoints(Range.START_TO_START, r2) <= 0) {
                // p1 is before or equal to p2
                r.setEnd(p2.node, p2.offset);
            } else {
                // p2 is before p1, flip
                r.setStart(p2.node, p2.offset);
                r.setEnd(p1.node, p1.offset);
            }
            
            sel.removeAllRanges();
            sel.addRange(r);
            return r; // Return the valid range
        } catch (e) {
            // Squelch DOM errors (e.g. node in different documents)
            return null;
        }
    }

    // --- Snapping ---

    function performSnap(enabled) {
        if (!enabled) return;
        const activeEl = document.activeElement;
        const isForm = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
    
        if (isForm) snapInput(activeEl);
        else snapDom();
    }
    
    function getSnap(text, offset, type) {
        for (const seg of segmenter.segment(text)) {
          if (offset > seg.index && offset < seg.index + seg.segment.length && seg.isWordLike) return type === 'start' ? seg.index : seg.index + seg.segment.length;
        }
        return offset;
    }
    
    function snapInput(el) {
        let s = el.selectionStart, e = el.selectionEnd, txt = el.value;
        let ns = getSnap(txt, s, 'start'), ne = getSnap(txt, e, 'end');
        if (ne < txt.length && PAIRS[txt.substring(ns, ne).trim()[0]] === txt[ne]) ne++;
        if (ns > 0 && REVERSE_PAIRS[txt.substring(ns, ne).trim().slice(-1)] === txt[ns - 1]) ns--;
        if (ns !== s || ne !== e) el.setSelectionRange(ns, ne);
    }
    
    function normalizeSnapPoint(node, offset, isStart) {
        if (node.nodeType === 3) return { node, offset };
        if (node.nodeType === 1) {
            const childIndex = isStart ? offset : offset - 1;
            if (childIndex >= 0 && childIndex < node.childNodes.length) {
                let child = node.childNodes[childIndex];
                
                // Drill down to find the nearest text node
                while (child) {
                    if (child.nodeType === 3) {
                        return { node: child, offset: isStart ? 0 : child.textContent.length };
                    }
                    if (child.nodeType === 1 && child.childNodes.length > 0) {
                        child = isStart ? child.firstChild : child.lastChild;
                    } else {
                        break;
                    }
                }
            }
        }
        return null;
    }

    function snapDom() {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        
        const start = normalizeSnapPoint(range.startContainer, range.startOffset, true);
        const end = normalizeSnapPoint(range.endContainer, range.endOffset, false);

        if (!start || !end) return;
    
        let sNode = start.node, eNode = end.node;
        let sOff = start.offset, eOff = end.offset;
        let mod = false;
    
        // Safety check: Ensure offsets are within bounds
        if (sOff > sNode.textContent.length) sOff = sNode.textContent.length;
        if (eOff > eNode.textContent.length) eOff = eNode.textContent.length;

        let ns = getSnap(sNode.textContent, sOff, 'start');
        if (ns !== sOff) { sOff = ns; mod = true; }
        let ne = getSnap(eNode.textContent, eOff, 'end');
        if (ne !== eOff) { eOff = ne; mod = true; }

        if (sNode === eNode) {
            const txt = sNode.textContent;
            if (eOff < txt.length && PAIRS[txt.substring(sOff, eOff).trim()[0]] === txt[eOff]) { eOff++; mod = true; }
            if (sOff > 0 && REVERSE_PAIRS[txt.substring(sOff, eOff).trim().slice(-1)] === txt[sOff - 1]) { sOff--; mod = true; }
        }
    
        if (mod) { 
            try {
                range.setStart(sNode, sOff); 
                range.setEnd(eNode, eOff); 
                sel.removeAllRanges(); 
                sel.addRange(range); 
            } catch (e) {
                window.LighthouseUtils.Logger.warn('Lighthouse: Snap failed', e);
            }
        }
    }

    function extendSelectionByWord(sel, dragHandleIndex) {
        // Detect if selection is backwards
        const range = document.createRange();
        range.setStart(sel.anchorNode, sel.anchorOffset);
        range.setEnd(sel.focusNode, sel.focusOffset);
        const backwards = range.collapsed;
        range.detach();

        function extendForward() {
            sel.modify("extend", backwards ? 'backward' : 'forward', "word");
        }

        function extendBackward() {
            const endNode = sel.focusNode;
            const endOffset = sel.focusOffset;
            sel.collapse(sel.anchorNode, sel.anchorOffset);
            
            if (backwards) sel.modify("move", 'forward', "word");
            else sel.modify("move", 'backward', "word");
            
            sel.extend(endNode, endOffset);
        }

        if (dragHandleIndex == 0) {
            if (backwards) extendForward(); else extendBackward();
        } else {
            if (backwards) extendBackward(); else extendForward();
        }
    }

    window.LighthouseSelection = {
        getContext,
        getLinkContext,
        getLanguage,
        insertText,
        handleExpand,
        performSnap,
        getPointFromCoords,
        setSafeRange,
        extendSelectionByWord
    };
})();
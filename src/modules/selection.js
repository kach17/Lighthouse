/**
 * Lighthouse - Selection Module
 * Handles context retrieval, smart snapping, and expansion logic.
 */
(function() {
    const Data = window.LighthouseData; // Import Data

    // "Is this a text field?" has one definition: LighthouseInput.fieldKind
    function isEditableElement(el) {
        const kind = window.LighthouseInput.fieldKind(el);
        return { isForm: kind === 'form', isEditable: kind === 'editable' };
    }
    const segmenter = window.LighthouseUtils.segmenter('word');
    
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
                let urlObj = new URL(text.startsWith('www.') ? 'https://' + text : text);
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

    // What is visibly selected: trimmed to its first and last visible characters, with the box of that
    // text alone (a range's own box spans whole list items it contains). null for very large selections.
    // Measured once per frame for the same selection: the bar and both handles ask for it on every scroll
    let extentCache = null;
    function visibleExtent(sel = getActiveSelection()) {
        const range = sel && sel.rangeCount && sel.getRangeAt(0);
        if (!range) return null;
        const key = [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
        if (extentCache && key.every((k, i) => k === extentCache.key[i])) return extentCache.value;
        if (!extentCache) requestAnimationFrame(() => { extentCache = null; });
        extentCache = { key, value: measureExtent(range) };
        return extentCache.value;
    }

    function measureExtent(range) {
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
            const rects = [...part.getClientRects()].filter(q => q.width);
            if (!rects.length) continue;   // hidden text
            if (l === Infinity) trimmed.setStart(n, part.startOffset);
            trimmed.setEnd(n, part.endOffset);
            rects.forEach(q => { l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); });
        }
        return l === Infinity ? null : { range: trimmed, box: { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t } };
    }

    function getActiveSelection() {
        let sel = window.getSelection();
        
        // Shadow DOM Support (e.g. Gemini, modern editors)
        // If selection is empty or points to a shadow host, check the active element's shadowRoot
        if (!sel || sel.rangeCount === 0 || sel.toString().length === 0) {
            const active = document.activeElement;
            if (active && active.shadowRoot && active.shadowRoot.getSelection) {
                const shadowSel = active.shadowRoot.getSelection();
                if (shadowSel && shadowSel.rangeCount > 0) {
                    return shadowSel;
                }
            }
        }
        return sel;
    }

    function getContext() {
        const el = document.activeElement;
        const { isForm, isEditable } = isEditableElement(el);
        const isInput = isForm || isEditable;
        
        const s = surface(el), selected = s.read(), all = isInput && s.read('all');
        const text = sanitizeText(selected ? selected.text : '');
        const isEmptyInput = !!all && !/\S/.test(all.before + all.text + all.after);
        
        // Semantic Analysis
        const sel = window.getSelection();
        const semanticNode = isInput ? el : (sel.anchorNode ? (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode) : null);
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
    const WRAP_PAIRS = window.LighthouseData.WRAP_PAIRS;
    const PUNCT_AFTER = /^[.,!?;:)\]}'">]/;
    // word chars/closing brackets (original scope) + sentence punctuation — "Hello,world"
    // is as wrong as "Helloworld", so a following word needs a space either way.
    // (owned by WRAP_PAIRS/snapping) or dashes (people repeat those on purpose).
    const DUPLICATE_PUNCT = /^[.,!?;:]$/;
    const isWord = (c) => /^[\p{L}\p{N}_]$/u.test(c || '') && !Data.UNSPACED_SCRIPTS.test(c);   // words that take spaces, any language
    const needsSpaceAfter = (c) => isWord(c) || /^[)\]}'">.,!?;:]$/.test(c || '');

    function normalizeEdges(text, before, after) {
        if (/^\s/.test(text) && /\s$/.test(before)) text = text.replace(/^\s+/, '');
        if (/\s$/.test(text) && (/^\s/.test(after) || PUNCT_AFTER.test(after) || after === '')) text = text.replace(/\s+$/, '');
        if (needsSpaceAfter(before) && isWord(text[0])) text = ' ' + text;
        if (needsSpaceAfter(text.slice(-1)) && isWord(after) && !PUNCT_AFTER.test(after)) text += ' ';
        return text;
    }

    // Deleting val[start, end) in a plain field: bounds widened so no stray space or doubled mark is
    // left, and whether the caret belongs before the space that stays ("I want‸ noodles")
    function planDeletion(val, start, end) {
        const at = (i) => val[i] || '', after = at(end);
        if (at(start - 1) === ' ' && (after === ' ' || after === '' || PUNCT_AFTER.test(after))) {
            start -= 1;
            if (after === ' ' && PUNCT_AFTER.test(at(end + 1))) end += 1;
        } else if (start === 0 && after === ' ') end += 1;
        if (DUPLICATE_PUNCT.test(at(start - 1)) && at(start - 1) === after) end += 1;
        return { start, end, caretBack: at(start - 1) === ' ' && isWord(after) };
    }

    // Rich text, after a deletion: a caret between a space and a word goes to the previous word's end
    function caretToWordEnd(el) {
        const sel = getActiveSelection(), r = sel && sel.isCollapsed && sel.rangeCount && sel.getRangeAt(0);
        if (!r || !el.contains(r.startContainer)) return;
        const x = document.createRange(), side = (start) => { x.selectNodeContents(el); start ? x.setStart(r.startContainer, r.startOffset) : x.setEnd(r.startContainer, r.startOffset); return x.toString(); };
        if (/[^\S\r\n]$/.test(side(false)) && isWord(side(true)[0])) sel.modify('move', 'backward', 'character');
    }

    // Whether deleting the selection needs tidying; if not, the browser deletes as usual
    function needsTidy(s) {
        const r = s.tidies && s.read({ before: 2, after: 2 });
        if (!r) return false;
        const start = r.before.length, end = start + r.text.length, p = planDeletion(r.before + r.text + r.after, start, end);
        return p.caretBack || p.start !== start || p.end !== end;
    }

    // ---------- Surface: the text where the user is, read and changed one way ----------
    // A surface reads the text around its selection and rewrites it as one undoable edit, the same
    // way in plain fields, rich text and fields that hide their caret (email, number). A span says how
    // far to reach from the selection on each side: a number of characters as seen (graphemes), a
    // unit ('word', 'sentence', 'line'), exact text ({ text }), or 'all'; { around } reaches both ways.
    // No span: the selection.
    // Rich text is read within the current line (block edges and <br>), where positions are exact.
    const READ_CAP = 500;
    const LINE_EDGES = 'br,p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,tr,table,section,article,header,footer,hr';
    const graphemes = (str) => Array.from(window.LighthouseUtils.segmenter('grapheme').segment(str), g => g.segment);

    // How much of one side a span reaches (`back`: the side before the selection); null if it isn't there.
    // `whole` and [s, e) give the selection in context, for units that need both sides to find an edge.
    function reachOf(side, want, back, whole, s, e) {
        if (!want) return '';
        if (want === 'all' || want === Infinity) return side;
        if (typeof want === 'object') return (back ? side.endsWith(want.text) : side.startsWith(want.text)) ? want.text : null;
        if (typeof want === 'number') {
            if (side.length <= want) return side;   // fewer code units than wanted: all of it
            const g = graphemes(side);
            return (back ? g.slice(-want) : g.slice(0, want)).join('');
        }
        if (want === 'line') return back ? side.slice(side.lastIndexOf('\n') + 1) : side.split('\n')[0];
        // Words and sentences: the ones the selection overlaps (a caret: the one it is in or ends)
        let from = s, to = e;
        for (const seg of window.LighthouseUtils.segmenter(want).segment(whole)) {
            if (want === 'word' && !seg.isWordLike) continue;   // spaces and marks aren't words
            const x = seg.index, y = x + seg.segment.length;
            if (s === e ? (x < s && y >= s) : (x < e && y > s)) { from = Math.min(from, x); to = Math.max(to, y); }
            if (x >= Math.max(e, s + 1)) break;
        }
        return back ? whole.slice(from, s) : whole.slice(e, to);
    }

    // A plain field: offsets are the value's own
    function fieldBackend(el) {
        return {
            raw(capB, capA) {
                const v = el.value || '', s = el.selectionStart, e = el.selectionEnd;
                return { before: v.slice(Math.max(0, s - capB), s), text: v.slice(s, e), after: v.slice(e, e + capA) };
            },
            // Move the selection edges by signed character counts
            shift(dStart, dEnd) {
                el.setSelectionRange(el.selectionStart + dStart, el.selectionEnd + dEnd);
            },
            selectAll: () => el.select(),
            insert(str) {
                const s = el.selectionStart, e = el.selectionEnd;
                el.focus();
                // A deletion is reported as one, not as typing nothing; execCommand keeps undo (Ctrl+Z)
                if (document.execCommand(str || (s === e && s !== null) ? 'insertText' : 'delete', false, str) || s === null) return;
                el.setRangeText(str, s, e, 'end');   // pages where execCommand fails
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        };
    }

    // Rich text (and page text, read only): positions within the line around a point, in the same
    // characters Range.toString() counts, so what is read and what is selected always agree
    function lineAt(root, node, offset) {
        let block = node.nodeType === 1 ? node : node.parentNode;
        while (block && block !== root && !(block.matches && block.matches(LINE_EDGES))) block = block.parentNode;
        if (!block) block = root;
        const line = document.createRange(); line.selectNodeContents(block);
        const point = document.createRange(); point.setStart(node, offset);
        for (const edge of block.querySelectorAll(LINE_EDGES)) {
            const where = point.comparePoint(edge, 0);
            if (where < 0 && !edge.contains(node)) line.setStartAfter(edge);
            else if (where > 0) { line.setEndBefore(edge); break; }
        }
        const nodes = [];
        const walker = document.createTreeWalker(line.commonAncestorContainer, NodeFilter.SHOW_TEXT);
        for (let t = walker.currentNode.nodeType === 3 ? walker.currentNode : walker.nextNode(); t; t = walker.nextNode())
            if (line.intersectsNode(t)) nodes.push(t);
        const indexOf = (n, o) => { const r = line.cloneRange(); r.setEnd(n, o); return r.toString().length; };
        return {
            text: line.toString(),
            indexOf,
            pointAt(i) {
                let count = 0;
                for (const t of nodes) {
                    const from = t === line.startContainer ? line.startOffset : 0;
                    const to = t === line.endContainer ? line.endOffset : t.length;
                    if (count + (to - from) >= i) return { node: t, offset: from + Math.max(0, i - count) };
                    count += to - from;
                }
                return null;
            }
        };
    }

    function domBackend(root, writable) {
        const range = () => { const sel = getActiveSelection(); return sel && sel.rangeCount ? sel.getRangeAt(0) : null; };
        return {
            raw(capB, capA) {
                const r = range();
                if (!r) return { before: '', text: '', after: '' };
                // One side: nothing, the whole field ('all'), or up to cap characters within the line
                const side = (atStart, cap) => {
                    if (!cap) return '';
                    const [n, o] = atStart ? [r.startContainer, r.startOffset] : [r.endContainer, r.endOffset];
                    if (cap === Infinity) { const x = document.createRange(); x.selectNodeContents(root); if (atStart) x.setEnd(n, o); else x.setStart(n, o); return x.toString(); }
                    const line = lineAt(root, n, o), i = line.indexOf(n, o);
                    return atStart ? line.text.slice(Math.max(0, i - cap), i) : line.text.slice(i, i + cap);
                };
                return { before: side(true, capB), text: r.toString(), after: side(false, capA) };
            },
            shift(dStart, dEnd) {
                const r = range();
                if (!r) return;
                const a = lineAt(root, r.startContainer, r.startOffset), b = lineAt(root, r.endContainer, r.endOffset);
                setSafeRange(a.pointAt(a.indexOf(r.startContainer, r.startOffset) + dStart), b.pointAt(b.indexOf(r.endContainer, r.endOffset) + dEnd));
            },
            selectAll: () => selectNode(root),
            insert: writable ? (str) => document.execCommand('insertText', false, str) : null
        };
    }

    /**
     * The surface for an element (default: the focused one), or for the page selection.
     *   precise   false where the caret can't be read (email, number): only the selection or 'all'
     *   writable  false for page text, which Lighthouse never changes
     *   multiline whether line breaks belong (a textarea or rich text; not a one-line input)
     *   tidies    whether Lighthouse adjusts spacing around edits (plain fields; rich editors keep their own)
     *   sharesContext  whether the sentence around a selection may be sent for spelling (plain fields)
     *   structured     whether there are elements to grow a selection into (page and rich text)
     *   read(span)                   → { before, text, after }, or null where the span isn't there
     *   select(span, collapse)       widen the selection over the span (collapse 'end': the caret after it);
     *                                false if it isn't there
     *   rewrite(span, fn, options)   fn({ before, text, after }) returns the new parts (any omitted stay);
     *                                one minimal edit. caret: 'end' (default) | 'select' |
     *                                a negative number of characters back from the end of the new text
     */
    function surface(el = window.LighthouseInput.focusedElement()) {
        const kindOf = window.LighthouseInput.fieldKind(el);
        const kind = kindOf === 'form' ? 'field' : kindOf === 'editable' ? 'editable' : 'page';
        const precise = kind !== 'field' || window.LighthouseInput.hasOffsets(el);
        const writable = kind !== 'page';
        const multiline = kind !== 'field' || el.tagName === 'TEXTAREA';
        const tidies = kind === 'field' && precise, sharesContext = tidies, structured = kind !== 'field';
        const backend = kind === 'field' ? fieldBackend(el) : domBackend(kind === 'editable' ? el : document.body, writable);
        const sides = (span) => {
            if (!span) return [0, 0];
            if (span === 'all') return ['all', 'all'];
            if (span.around) return [span.around, span.around];
            return [span.before || 0, span.after || 0];
        };

        function read(span) {
            if (!precise) {
                if (span && span !== 'all') return null;
                return { before: '', text: span === 'all' ? el.value : '', after: '' };
            }
            const [b, a] = sides(span);
            const cap = (w) => w === 'all' ? Infinity : w ? READ_CAP : 0;
            const raw = backend.raw(cap(b), cap(a));
            const whole = raw.before + raw.text + raw.after, s = raw.before.length, e = s + raw.text.length;
            const before = reachOf(raw.before, b, true, whole, s, e), after = reachOf(raw.after, a, false, whole, s, e);
            return before === null || after === null ? null : { before, text: raw.text, after };
        }

        function select(span, collapse) {
            if (span === 'all') { backend.selectAll(); return true; }
            const r = precise ? read(span) : !span && {};
            if (!r) return false;
            const len = r.before.length + r.text.length + r.after.length;
            backend.shift(-r.before.length + (collapse === 'end' ? len : 0), r.after.length);
            return true;
        }

        function rewrite(span, fn, options = {}) {
            if (!writable) return false;
            const old = read(span);
            if (!old) return false;   // a span this surface can't locate: clearly nothing happens
            const next = Object.assign({ before: old.before, text: old.text, after: old.after }, fn(old));
            if (span === 'all' || !precise) {   // everything is replaced, or the browser alone knows the caret
                if (span === 'all') backend.selectAll();
                backend.insert(next.before + next.text + next.after);
                return true;
            }
            const was = old.before + old.text + old.after, now = next.before + next.text + next.after;
            // The smallest change: common start, then common end (never splitting a surrogate pair)
            const most = Math.min(was.length, now.length);
            let p = 0; while (p < most && was[p] === now[p]) p++;
            let q = 0; while (q < most - p && was[was.length - 1 - q] === now[now.length - 1 - q]) q++;
            const low = (str, i) => i > 0 && i < str.length && /[\uDC00-\uDFFF]/.test(str[i]);
            while (low(was, p) || low(now, p)) p--;
            while (q > 0 && (low(was, was.length - q) || low(now, now.length - q))) q--;

            const middle = now.slice(p, now.length - q);
            const selStart = old.before.length, selEnd = selStart + old.text.length;
            if (was !== now) {
                backend.shift(p - selStart, (was.length - q) - selEnd);
                backend.insert(middle);
            } else backend.shift(p - selStart, p - selEnd);   // unchanged: collapse where it would have been

            // The caret, relative to the end of what was inserted
            const caret = next.caret !== undefined ? next.caret : options.caret || 'end';
            const at = p + middle.length, textStart = next.before.length, textEnd = textStart + next.text.length;
            const [from, to] = caret === 'select' ? [textStart, textEnd]
                : typeof caret === 'number' ? [textEnd + caret, textEnd + caret] : [textEnd, textEnd];
            if (from !== at || to !== at) backend.shift(from - at, to - at);
            return true;
        }

        return { precise, writable, multiline, tidies, sharesContext, structured, read, select, rewrite };
    }

    // Typing-style insertion over the selection (or over options.span, selected first): edges spaced,
    // marks not doubled, brackets wrapped, and in plain fields a deletion tidied. One rule for every surface.
    function insertText(target, text, options = {}) {
        const s = surface(target && target.nodeType ? target : target.element);
        if (!s || !s.writable || (options.span && !s.select(options.span))) return;
        if (!s.precise) { s.rewrite(null, () => ({ text })); return; }

        s.rewrite({ before: 2, after: 2 }, ({ before, text: selected, after }) => {
            const all = before + selected + after;
            let start = before.length, end = start + selected.length;
            let finalText = text, caret = 'end';

            if (options.smartIndent && options.startLineText !== undefined) {
                const indent = options.startLineText.match(/^\s*/)[0];
                if (indent) finalText = finalText.replace(/\n/g, '\n' + indent);
            }

            if (WRAP_PAIRS[text] && selected) {
                // Wrap what is selected; its outer spaces stay outside, and the caret goes after the pair
                const m = selected.match(/^(\s*)(.*?)(\s*)$/s);
                return { text: m[1] + text + m[2] + WRAP_PAIRS[text], after: m[3] + after };
            }
            if (!finalText) {
                if (!s.tidies) return { text: '' };
                const plan = planDeletion(all, start, end);
                return { before: all.slice(0, plan.start), text: '', after: all.slice(plan.end), caret: plan.caretBack ? -1 : 'end' };
            }
            const charBefore = all[start - 1] || '', charAfter = all[end] || '';
            finalText = normalizeEdges(finalText, charBefore, charAfter);
            // An exact duplicate mark is collapsed by consuming the existing neighbor
            if (DUPLICATE_PUNCT.test(charAfter) && finalText.slice(-1) === charAfter) end += 1;
            if (DUPLICATE_PUNCT.test(charBefore) && finalText[0] === charBefore) start -= 1;
            // appendSpace: re-add the space that triggered snippet expansion
            if (options.appendSpace && !/\s$/.test(finalText)) finalText += ' ';
            // The caret lands after real content, never after a padding space
            if (finalText.endsWith(' ') && !text.endsWith(' ') && !options.appendSpace) caret = -1;
            if (options.select) caret = 'select';
            return { before: all.slice(0, start), text: finalText, after: all.slice(end), caret };
        });
    }

    // Expand: page and rich text grow to the enclosing element; a plain field has no elements,
    // so it grows to the next unit that adds text: word, sentence, line, everything
    function handleExpand() {
        const field = surface();
        if (!field.structured) {
            if (!field.precise) return;
            for (const unit of ['word', 'sentence', 'line']) {
                const r = field.read({ around: unit });
                if (r && (r.before || r.after)) { field.select({ around: unit }); return; }
            }
            field.select('all');
            return;
        }
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

    // The nearest text position for a boundary given as an element and child index
    function normalizeSnapPoint(node, offset, isStart) {
        if (node.nodeType === 3) return { node, offset };
        const child = node.childNodes[isStart ? offset : offset - 1];
        if (!child) return null;
        const w = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
        let text = child.nodeType === 3 ? child : w.nextNode();
        if (!isStart && child.nodeType !== 3) for (let n; (n = w.nextNode());) text = n;
        return text ? { node: text, offset: isStart ? 0 : text.length } : null;
    }

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

        // 2. A block's padding or empty space: the nearest text keeps the selection from jumping
        if (node.nodeType === 1 && node.tagName !== 'INPUT' && node.tagName !== 'TEXTAREA' && node.childNodes.length) {
            const atEnd = offset >= node.childNodes.length;
            const point = normalizeSnapPoint(node, atEnd ? node.childNodes.length : offset, !atEnd);
            if (point) ({ node, offset } = point);
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

    // Snapping: a selection's edges move out to whole words, and to a bracket or quote that pairs with
    // one inside it. One rule for fields, rich text and page text, across formatting.
    function performSnap(enabled) {
        if (!enabled) return;
        const s = surface();
        const r = s.precise && s.read({ before: READ_CAP, after: READ_CAP });
        if (!r || !r.text) return;
        const txt = r.before + r.text + r.after, start = r.before.length, end = start + r.text.length;
        let ns = getSnap(txt, start, 'start'), ne = getSnap(txt, end, 'end');

        let selText = txt.substring(ns, ne);
        if (ne < txt.length && REVERSE_PAIRS[txt[ne]]) {
            const openChar = REVERSE_PAIRS[txt[ne]];
            const openCount = selText.split(openChar).length - 1, closeCount = selText.split(txt[ne]).length - 1;
            if (openChar === txt[ne] ? (openCount % 2 !== 0) : (openCount > closeCount)) ne++;
        }
        selText = txt.substring(ns, ne);
        if (ns > 0 && PAIRS[txt[ns - 1]]) {
            const closeChar = PAIRS[txt[ns - 1]];
            const closeCount = selText.split(closeChar).length - 1, openCount = selText.split(txt[ns - 1]).length - 1;
            if (closeChar === txt[ns - 1] ? (closeCount % 2 !== 0) : (closeCount > openCount)) ns--;
        }
        if (ns !== start || ne !== end) s.select({ before: { text: txt.slice(ns, start) }, after: { text: txt.slice(end, ne) } });
    }

    function getSnap(text, offset, type) {
        for (const seg of segmenter.segment(text)) {
          if (offset > seg.index && offset < seg.index + seg.segment.length && seg.isWordLike) return type === 'start' ? seg.index : seg.index + seg.segment.length;
        }
        return offset;
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
        getActiveSelection,
        needsTidy,
        caretToWordEnd,
        visibleExtent,
        getLinkContext,
        insertText,
        surface,
        handleExpand,
        performSnap,
        getPointFromCoords,
        setSafeRange,
        extendSelectionByWord,
        isEditableElement
    };
})();
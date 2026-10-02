/**
 * Lighthouse - UI Module
 * Standardized Architecture: One Render Path, One Position Logic
 */
(function() {
    const $ = window.LighthouseUtils;
    const API = window.LighthouseAPI;
    
    const HOST_ID = 'lighthouse-host';
    const TOOLTIP_ID = 'lighthouse-extension-tooltip';
    const POPOVER_CLASS = 'lighthouse-popover';
    
    // Persistent References
    let shadowRoot = null;
    let tooltipContainer = null;
    
    // Volatile State
    let actionActive = false;
    let lastState = null;
    const destroyCallbacks = [];
    
    // Cache for preview popovers to prevent duplicate network requests
    const previewCache = new Map();

    const cacheSet = (key, val) => {
        if (previewCache.size >= 5) previewCache.delete(previewCache.keys().next().value);
        previewCache.set(key, val);
    };

    // --- POPOVERS: one mechanism for every level ---
    // A popover lives inside the button that opens it, the same way buttons live inside
    // the bar. It moves with the bar (scroll, transitions, show/hide) and native
    // mouseenter/mouseleave already treat the whole chain as one hover, at any depth.
    function attachPopover(btn, build) {
        btn.classList.add('has-popover');
        let ready = null, timer = null;
        btn.addEventListener('mouseenter', () => {
            clearTimeout(timer);
            timer = setTimeout(async () => {
                ready = ready || Promise.resolve(build($.create('div', { className: POPOVER_CLASS })));
                const el = await ready;
                if (!el) { ready = null; return; }
                if (!el.parentNode) {
                    el.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
                    btn.appendChild(el);
                }
                if (btn.matches(':hover')) placePopover(el);
            }, $.token('--so-popover-delay', 300));
        });
        btn.addEventListener('mouseleave', () => {
            clearTimeout(timer);
            timer = setTimeout(() => ready && ready.then(el => el && el.classList.remove('visible')), $.token('--so-popover-close-delay', 150));
        });
    }

    // Opens on the same side as the bar (away from the selection), flips if it would
    // leave the viewport, and shifts sideways to stay on screen. Offsets only - the
    // popover stays anchored to its button through CSS.
    function placePopover(el) {
        const css = getComputedStyle(el);
        const MARGIN = parseFloat(css.getPropertyValue('--so-viewport-margin')) || 0;
        const GAP = parseFloat(css.getPropertyValue('--so-level-offset')) || 0;
        const b = el.parentElement.getBoundingClientRect();
        const w = el.offsetWidth, h = el.offsetHeight;
        let below = /mode-(bottom|sticky-top)/.test(tooltipContainer.className);
        // A bar button's popover forms beyond the whole bar: past the strip on the strip's side (see styles.css)
        const row = el.parentElement.parentElement === tooltipContainer && tooltipContainer.dataset.strip === 'on' ? $.token('--so-strip-height', 14) + 1 : 0;
        if (below ? b.bottom + GAP + row + h > window.innerHeight - MARGIN : b.top - GAP - row - h < MARGIN) below = !below;
        // Centered on its button, kept on screen, at a whole pixel (relative to the button)
        const centered = b.left + b.width / 2 - w / 2;
        const shift = Math.max(MARGIN - centered, Math.min(0, window.innerWidth - MARGIN - (centered + w)));
        const left = Math.round(b.width / 2 - w / 2 + shift);
        el.classList.toggle('mode-bottom', below);
        el.style.left = `${left}px`;
        el.style.setProperty('--lh-origin-x', `${b.width / 2 - left}px`);   // grows out of its button
        el.classList.add('visible');
    }

    // --- STRIP: the bar's status line ---
    // A row of the bar: facts about the selection; while a button is pointed at, what is new about it
    // (in icon-only mode, its name). A short warm-up before describing a button, instant from button
    // to button, a grace period before returning. Only that change of subject fades.
    let strip = null;   // { el, layers, facts, idle, tool, on, warm, grace }
    const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

    // Characters as seen: an emoji, or a letter with its accents, is one. Below U+0300 (Latin with its
    // accented letters) each code unit is one character, so most text is counted at once; other text
    // is segmented, a long selection in slices between frames so the bar never waits.
    let counted = { text: null, count: 0 }, countTimer = null;
    function countCharacters(text, whenDone) {
        if (counted.text === text) return counted.count;
        const keep = (count) => (counted = { text, count }).count;
        if (!/[^\u0000-\u02FF]/.test(text)) return keep(text.length);
        const graphemes = $.segmenter('grapheme').segment(text);
        if (text.length <= 5000) return keep([...graphemes].length);
        const it = graphemes[Symbol.iterator]();
        let n = 0;
        const slice = () => {
            for (const end = performance.now() + 4; performance.now() < end; n++) if (it.next().done) return whenDone(keep(n));
            countTimer = setTimeout(slice, 0);
        };
        countTimer = setTimeout(slice, 0);
        return null;
    }

    // Most important first: on a narrow bar, as many whole facts as fit are shown (see fitStrip)
    function selectionFacts(ctx) {
        if (!ctx.hasText || !ctx.cleanText) return [];
        const chars = (n) => plural(n, 'character', 'characters');
        const facts = [plural(ctx.wordCount, 'word', 'words')];
        const n = countCharacters(ctx.cleanText.replace(/[\r\n]+/g, ''), (later) => {
            if (!strip) return;
            strip.facts.splice(1, 0, chars(later));
            strip.idle = '';
            if (!strip.tool) fitStrip();
        });
        if (n !== null) facts.push(chars(n));
        const language = ctx.languageReliable && ctx.language && $.languageName(ctx.language);
        if (language) facts.push(language);
        return facts;
    }

    // first: the first button's label, said when there is no selection (what the bar offers first)
    function buildStrip(ctx, iconOnly, first) {
        clearStrip();
        const facts = selectionFacts(ctx);
        if (!facts.length && iconOnly && first) facts.push(first);
        tooltipContainer.dataset.strip = facts.length || iconOnly ? 'on' : 'off';
        if (tooltipContainer.dataset.strip === 'off') return;
        const layers = [$.create('span', { className: 'is-shown', text: facts.join(' · ') }), $.create('span')];
        strip = { el: $.create('div', { className: 'lighthouse-strip', attrs: { 'aria-hidden': 'true' }, children: layers }), layers, facts, idle: '', tool: false, on: null };
        tooltipContainer.appendChild(strip.el);
    }

    function clearStrip() {
        clearTimeout(countTimer);
        if (strip) { clearTimeout(strip.warm); clearTimeout(strip.grace); }
        strip = null;
    }

    // Once the bar has its final width: as many whole facts as fit
    function fitStrip() {
        if (!strip || strip.tool || strip.idle) return;   // once (positioning also runs on every scroll)
        const layer = strip.layers[0], facts = [...strip.facts];
        layer.textContent = facts.join(' · ');
        while (facts.length > 1 && layer.scrollWidth > layer.clientWidth) layer.textContent = (facts.pop(), facts.join(' · '));
        strip.idle = layer.textContent;
    }

    // A change of subject: the old text fades out as the new one fades in
    function stripSay(text, tool) {
        const [shown, next] = strip.layers;
        next.textContent = text;
        shown.classList.remove('is-shown');
        next.classList.add('is-shown');
        strip.layers = [next, shown];
        strip.tool = tool;
    }

    // What the strip says about a button: in icon-only mode its name, and what the action reports
    // about its own decisions (info). Asked once per button per render, and only when pointed at.
    // As [name, info]: the name only in icon-only mode, and not when info already says it
    function describe(btn) {
        return btn._described ||= Promise.resolve(btn._info ? btn._info() : null).catch(() => null).then(info => {
            const label = tooltipContainer.dataset.labels === 'off' && !btn.classList.contains('text-only-btn')
                && btn.querySelector(':scope > .lighthouse-label');
            const name = label && label.textContent.trim();
            return [info && name && info.toLowerCase().includes(name.toLowerCase()) ? null : name, info].filter(Boolean);
        });
    }

    // A button's description: name and info if they fit, else the info alone (the icon names the button)
    function stripTool(parts, fade) {
        const text = parts.join(' · ');
        if (fade) stripSay(text, true); else strip.layers[0].textContent = text;
        const layer = strip.layers[0];
        if (parts.length > 1 && layer.scrollWidth > layer.clientWidth) layer.textContent = parts[parts.length - 1];
    }

    // Feedback from an action that keeps the bar open (Read aloud: 'Stopped reading'): in the strip,
    // for a moment, then back to the button or the selection. False without a strip (then: a toast).
    function stripNotice(text) {
        if (!strip) return false;
        const btn = strip.on;
        clearTimeout(strip.warm);
        clearTimeout(strip.grace);
        stripSay(text, true);
        strip.on = null;   // pointing again describes afresh
        strip.grace = setTimeout(() => {
            if (!strip) return;
            if (btn && btn.matches(':hover')) return stripPoint(btn);
            stripSay(strip.idle || strip.facts.join(' · '), false);
            fitStrip();
        }, $.token('--so-notice-duration', 1500));
        return true;
    }

    function stripPoint(btn) {
        if (!strip || btn === strip.on) return;
        strip.on = btn;
        clearTimeout(strip.warm);
        clearTimeout(strip.grace);
        const back = () => { if (strip && strip.tool) strip.grace = setTimeout(() => { if (strip) { stripSay(strip.idle || strip.facts.join(' · '), false); fitStrip(); } }, $.token('--so-strip-grace', 300)); };
        if (!btn) return back();
        const say = (parts) => {
            if (!strip || strip.on !== btn) return;   // moved on meanwhile
            if (!parts.length) return back();         // nothing new here: after the grace period, back to the selection
            stripTool(parts, !strip.tool);            // scanning: at once
        };
        if (strip.tool) describe(btn).then(say);
        else strip.warm = setTimeout(() => describe(btn).then(say), $.token('--so-label-delay', 350));
    }

    // A button that stays open changed what it would do next (Case): described again
    function redescribe(btn) {
        delete btn._described;
        if (strip && strip.on === btn && strip.tool) describe(btn).then(parts => { if (strip && strip.on === btn && parts.length) stripTool(parts, false); });
    }

    function watchStrip() {
        const pointed = (e) => stripPoint(e.target.closest && e.target.closest('.lighthouse-btn'));
        tooltipContainer.addEventListener('mouseover', pointed);
        tooltipContainer.addEventListener('focusin', pointed);   // the keyboard points at buttons too
        tooltipContainer.addEventListener('mouseleave', () => stripPoint(null));
        tooltipContainer.addEventListener('focusout', (e) => { if (!tooltipContainer.contains(e.relatedTarget)) stripPoint(null); });
    }

    // --- INITIALIZATION ---
    function init() {
        if (document.getElementById(HOST_ID)) return; 

        const host = document.createElement('div');
        host.id = HOST_ID;
        host.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
        document.documentElement.appendChild(host);
        shadowRoot = host.attachShadow({ mode: 'closed' });   // closed: the page can't read what the bar shows (clipboard, collected snippets)

        ['src/content/tokens.css', 'src/content/styles.css'].forEach(path => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = chrome.runtime.getURL(path);
            shadowRoot.appendChild(link);
        });

        const userStyle = document.createElement('style');
        userStyle.id = 'lighthouse-user-styles';
        shadowRoot.appendChild(userStyle);

        tooltipContainer = $.create('div', { 
            attrs: { id: TOOLTIP_ID, role: 'tooltip' }
        });
        shadowRoot.appendChild(tooltipContainer);
        watchStrip();
    }

    // --- MAIN RENDER LOOP ---
    function render(State) {
        if (!shadowRoot) init();
        
        const host = document.getElementById(HOST_ID);
        if (host) host.style.display = 'block';

        lastState = State;
        const { settings, ctx, activeActions } = State;
        if (window.LighthouseInput) window.LighthouseInput.activate('bar'); // its keys listen only while it is open
        
        $.logEvent('UI', 'RENDER', `${State.mode} (${activeActions.length} actions)`);

        // Labels visible or icon-only (a data attribute: positioning rewrites the class list)
        tooltipContainer.dataset.labels = settings.showLabels === false ? 'off' : 'on';

        // 1. Apply Theme
        const styleTag = shadowRoot.getElementById('lighthouse-user-styles');
        const themeCSS = window.LighthouseData.resolveThemeCSS(settings).replace(/:root|:host/g, `:host(#${HOST_ID})`);
        if (styleTag && styleTag.textContent !== themeCSS) styleTag.textContent = themeCSS;

        // Already showing: updatePosition decides whether it stays or hands over
        pendingSnapshot = snapshot();
        tooltipContainer.innerHTML = ''; 

        // 2. Render Header
        if (State.mode === 'LINK') {
            renderLinkHeader(ctx);
        } else if (ctx.hasText) {
            renderTextHeader(ctx);
            const link = $.findLink(ctx.text);
            if (link) { ctx.url = link; renderLinkHeader(ctx); }
        }

        // 3. Render Actions
        const apiCtx = API.prepareContext(ctx);
        const tools = apiCtx.tools;

        const MAX_BUTTONS = 4;
        const overflow = [];

        activeActions.forEach((actionDef, i) => {
            const btn = createButton(actionDef, apiCtx, tools);
            if (i < MAX_BUTTONS) tooltipContainer.appendChild(btn);
            else overflow.push(btn);
        });

        if (overflow.length) {
            const moreBtn = $.create('div', {
                className: 'lighthouse-btn',
                attrs: { role: 'button', tabindex: '0' },
                children: [ $.createSmartIcon('more'), $.create('span', { className: 'lighthouse-label', text: 'More' }) ]
            });
            attachPopover(moreBtn, (el) => {
                el.append(...overflow);
                return el;
            }, 0);
            tooltipContainer.appendChild(moreBtn);
        }

        // 4. Strip (a row of the bar, so positioning and popovers already account for it)
        buildStrip(apiCtx, settings.showLabels === false, activeActions[0] && activeActions[0].label);

        // 5. Show
        updatePosition(ctx);
        void tooltipContainer.offsetWidth;
        tooltipContainer.classList.add('visible');
    }

    // --- UNIFIED COMPONENTS ---

    function renderTextHeader(ctx) {
        let pTxt = ctx.text.trim();
        pTxt = $.shorten(pTxt, 100);
        
        const previewEl = $.create('div', { 
            className: 'lighthouse-preview',
            attrs: { title: 'Scroll to selection' },
            style: 'cursor: pointer;',
            children: [ $.create('span', { className: 'lighthouse-scroll-text', text: `"${pTxt}"` }) ],
            events: {
                mousedown: (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (ctx.isForm && ctx.element) {
                        ctx.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else {
                        const sel = window.getSelection();
                        if (sel.rangeCount > 0) {
                            sel.getRangeAt(0).startContainer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }
                }
            }
        });

        tooltipContainer.appendChild(previewEl);
    }

    function renderLinkHeader(ctx) {
        const apiCtx = API.prepareContext(ctx);
        const tools = apiCtx.tools;

        // The linked page's <head>, fetched once for both the preview and the icon. The setting is
        // checked first, so turning previews off also hides ones fetched earlier.
        const pageHead = async () => {
            if (!window.LighthouseState.get('linkPreviews', false)) return null;
            const cacheKey = `og:${ctx.url}`;
            let html = previewCache.get(cacheKey);
            if (!html) {
                html = await tools.linkPreview(ctx.url);
                if (html) cacheSet(cacheKey, html);
            }
            return html;
        };

        // The button shows where the link goes; the full address is in its title
        const linkBtn = createButton({
            id: 'link-open',
            label: $.displayLink(ctx.url),
            title: `Open ${ctx.url}`,
            icon: null,
            iconUrl: ctx.url,
            // With previews on, the page's own icon (from the same fetched <head> the preview uses)
            findIcon: async () => { const html = await pageHead(); return html ? $.parsePreview(html, ctx.url).icon : null; },
            preview: async () => {
                let card = null;
                try {
                    const html = await pageHead();
                    if (html) {
                        const page = $.parsePreview(html, ctx.url);
                        if (page.title || page.image) {
                            card = $.mediaCard({ image: page.image, title: page.title, body: page.description });
                        }
                    }
                } catch (e) { /* Fail silently */ }

                // The button shows the short form; the popover shows the full address
                const fallbackText = ctx.url.replace(/^https?:\/\//, '');

                return {
                    node: card,
                    previewText: card ? null : fallbackText,
                    previewClick: () => window.open(ctx.url, '_blank')
                };
            },
            execute: () => {
                window.open(ctx.url, '_blank');
                return { success: true };
            }
        }, ctx, tools);

        const copyBtn = createButton({
            id: 'link-copy',
            label: 'Copy',
            icon: 'copy',
            execute: () => {
                tools.copy(ctx.url);
                return { success: true, message: 'Link copied' };
            }
        }, ctx, tools);

        tooltipContainer.appendChild(linkBtn);
        if (ctx.isLink) tooltipContainer.appendChild(copyBtn);
    }

    function createButton(def, ctx, tools) {
        let className = 'lighthouse-btn';
        if (def.textOnly) className += ' text-only-btn';

        const btn = $.create('button', {
            className: className,
            attrs: def.title ? { 'data-action': def.id, title: def.title } : { 'data-action': def.id },
            children: [ 
                $.createSmartIcon(def.icon, def.iconUrl, def.label, def.findIcon),
                $.create('span', { className: 'lighthouse-label', text: def.label })
            ]
        });

        // Toggles (e.g. Read aloud) announce state changes with a 'lighthouse:state' event; no polling
        if (typeof def.isActive === 'function') {
            const sync = () => {
                if (!btn.isConnected) return window.removeEventListener('lighthouse:state', sync);
                btn.classList.toggle('is-active', !!def.isActive());
            };
            window.addEventListener('lighthouse:state', sync);
            sync();
        }

        // A label worked out for this selection: text, or { quote } shown as a quoted value (Paste)
        if (typeof def.dynamicLabel === 'function') {
            Promise.resolve(def.dynamicLabel(ctx, tools)).then(val => {
                const label = btn.querySelector('.lighthouse-label');
                if (!val || !label) return;
                if (typeof val === 'string') return void (label.textContent = val);
                if (val.quote) { label.textContent = `"${val.quote}"`; btn.classList.add('text-only-btn', 'is-quote'); }
            }).catch(() => {});
        }
        if (def.info) btn._info = () => def.info(ctx, tools);

        btn.onmousedown = async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (def.keepOpen) actionActive = true;

            const res = await def.execute(ctx, tools);
            // Feedback: in the strip while the bar stays open; a toast when the bar is closing
            if (res && res.message && !(def.keepOpen && stripNotice(res.message))) showToast(res.message, res.success ? 'success' : 'error');

            if (!def.keepOpen) {
                destroy();
                if (ctx.isForm) ctx.element.focus();
                else if (!ctx.isLink) window.getSelection().collapseToEnd();
            } else {
                const now = (ctx.isInput || ctx.hasText) && tools.surface.read();
                if (now) ctx.text = now.text;
                redescribe(btn);
                setTimeout(() => actionActive = false, 200);
            }
        };

        if (def.preview) {
            attachPopover(btn, async (popover) => {
                const cacheKey = `${def.id}:${ctx.text || ctx.url || ''}`;
                let data = previewCache.get(cacheKey);
                if (!data) {
                    data = await def.preview(ctx, tools);
                    if (data && !data.live) cacheSet(cacheKey, data);   // live: re-read every time (clipboard, collection)
                }
                if (!data) return null;

                const renderItems = () => {
                    if (data.items) {
                        data.items.forEach(item => {
                            const sub = $.create('button', {
                                className: 'lighthouse-btn' + (item.textOnly ? ' text-only-btn' : '') + (item.current ? ' is-current' : ''),
                                children: [ item.color ? $.create('span', { className: 'lighthouse-swatch', style: `background: var(--lh-hl-${item.color})` }) : $.createSmartIcon(item.icon, item.iconUrl, item.label), $.create('span', { className: 'lighthouse-label', text: item.label }) ],
                                events: { mousedown: (e) => { e.preventDefault(); e.stopPropagation(); item.onClick(); destroy(); } }
                            });
                            popover.appendChild(sub);
                        });
                    }
                };

                if (data.prependItems) renderItems();

                if (data.previewText) {
                    const prevEl = $.create('div', { className: 'lighthouse-preview' + (data.isValue ? ' is-value' : '') });
                    prevEl.appendChild($.create('span', { className: 'lighthouse-scroll-text', text: data.previewText }));
                    if (data.previewClick) {
                        prevEl.style.cursor = 'pointer';
                        prevEl.onmousedown = (e) => {
                            e.preventDefault(); e.stopPropagation();
                            data.previewClick();
                            destroy();
                        };
                    }
                    popover.appendChild(prevEl);
                } else if (data.node) {
                    popover.appendChild($.create('div', { className: 'lighthouse-content', children: [data.node] }));
                }

                if (!data.prependItems) renderItems();

                return popover;
            });
        }

        return btn;
    }

    // --- UNIFIED POSITIONING LOGIC ---
    const MODE_CLASSES = ['mode-top', 'mode-bottom', 'mode-sticky-top', 'mode-sticky-bottom'];

    function updatePosition(ctx) {
        if (!tooltipContainer || !ctx) return;

        let rect;
        const ends = ctx.hasText && !ctx.isLink && window.LighthouseHandles ? window.LighthouseHandles.selectionEnds() : null;
        if (ctx.isLink || (ctx.isForm && !ends)) {
            rect = ctx.element.getBoundingClientRect();
        } else if (ctx.isForm) {
            // Text selected in a field: its box from where the selection starts and ends (lines
            // spanning the field when it wraps), then the same rules as on the page
            const f = ctx.element.getBoundingClientRect(), multi = ends.end.dy - ends.start.dy > ends.start.lineHeight / 2;
            const left = multi ? f.left : ends.start.dx, right = multi ? f.right : ends.end.dx;
            const top = Math.max(f.top, ends.start.dy), bottom = Math.min(f.bottom, ends.end.dy + ends.end.lineHeight);
            rect = { left, right, top, bottom, width: right - left, height: bottom - top };
        } else {
            const sel = window.LighthouseSelection.getActiveSelection();
            if (!sel || !sel.rangeCount) return destroy();
            const ext = window.LighthouseSelection.visibleExtent(sel);
            rect = ext ? ext.box : sel.getRangeAt(0).getBoundingClientRect();
            if (!rect || (rect.top === 0 && rect.left === 0 && rect.width === 0)) {
                if (ctx.mouseX !== undefined && ctx.mouseY !== undefined) {
                    rect = { left: ctx.mouseX, top: ctx.mouseY, right: ctx.mouseX, bottom: ctx.mouseY, width: 0, height: 0 };
                } else {
                    return destroy();
                }
            }
        }

        if (!rect || typeof rect.top !== 'number') return destroy();
        
        let anchorLeft = rect.left + (rect.width / 2);
        if (ctx.mouseX !== undefined) anchorLeft = ctx.mouseX;

        // Centered on the selection, on the edge nearer the pointer (or caret); one line: above.
        // Chosen once per selection. Links and fields without a selection: at the element.
        const hasBox = !ctx.isLink && ctx.hasText && rect.width > 0;
        let prefer = 'top';
        if (hasBox) {
            if (!ctx._barSide) {
                const multiLine = ends && ends.end.dy - ends.start.dy > ends.start.lineHeight / 2;
                // Without a pointer, the caret's end: the start when the selection was extended backwards
                const sel = window.LighthouseSelection.getActiveSelection();
                const backward = sel && sel.anchorNode && sel.focusNode && (sel.anchorNode === sel.focusNode
                    ? sel.focusOffset < sel.anchorOffset : !!(sel.anchorNode.compareDocumentPosition(sel.focusNode) & Node.DOCUMENT_POSITION_PRECEDING));
                const y = ctx.mouseY !== undefined ? ctx.mouseY : ends ? (backward ? ends.start.dy : ends.end.dy) : rect.top;
                ctx._barSide = multiLine && (y - rect.top) > (rect.bottom - y) ? 'bottom' : 'top';
            }
            prefer = ctx._barSide;
            anchorLeft = rect.left + rect.width / 2;
        }

        const TOOLTIP_H = tooltipContainer.offsetHeight || 48;
        const VIEW_W = window.innerWidth;
        const VIEW_H = window.innerHeight;
        const MARGIN = $.token('--so-viewport-margin', 8);
        const GAP = $.token('--so-bar-gap', 18);

        // Below the selection, clear of the handle tabs hanging under the line boxes
        let idealBottom = rect.bottom + GAP;
        if (ends && window.LighthouseState.get('addDragHandles', true)) {
            const lineBottom = Math.max(ends.start.dy + ends.start.lineHeight, ends.end.dy + ends.end.lineHeight);
            idealBottom = Math.max(idealBottom, lineBottom + $.token('--so-handle-gap') + $.token('--so-handle-height') + $.token('--so-level-space'));
        }
        const idealTop = rect.top - TOOLTIP_H - GAP;
        
        let top, mode;

        const fitsTop = idealTop >= MARGIN && idealTop <= VIEW_H - TOOLTIP_H - MARGIN;
        const fitsBottom = idealBottom >= MARGIN && idealBottom <= VIEW_H - TOOLTIP_H - MARGIN;
        if (prefer === 'bottom' && fitsBottom) {
            top = idealBottom;
            mode = 'bottom';
        } else if (fitsTop) {
            top = idealTop;
            mode = 'top';
        } else if (fitsBottom) {
            top = idealBottom;
            mode = 'bottom';
        } else {
            if (rect.top > VIEW_H - MARGIN) {
                top = VIEW_H - TOOLTIP_H - MARGIN;
                mode = 'sticky-bottom';
            } else {
                top = MARGIN;
                mode = 'sticky-top';
            }
        }

        // The mode changes what the bar shows, so it's applied before measuring
        MODE_CLASSES.forEach(c => tooltipContainer.classList.toggle(c, c === `mode-${mode}`));
        const TOOLTIP_W = tooltipContainer.offsetWidth || 220;
        fitStrip();   // the bar's final width was just measured: reading the strip now costs no extra layout
        const originPoint = anchorLeft;
        // Centered on its anchor, kept on screen, at a whole pixel
        const left = Math.round(Math.max(MARGIN, Math.min(anchorLeft - TOOLTIP_W / 2, VIEW_W - TOOLTIP_W - MARGIN)));

        // Was showing: same spot, update in place; elsewhere, hand over
        const snap = pendingSnapshot;
        pendingSnapshot = null;
        if (snap) {
            const moved = snap.mode !== `mode-${mode}` || Math.abs(snap.top - Math.round(top)) > 1;
            if (moved) {
                handOver(snap);
                void tooltipContainer.offsetWidth;   // start rising from the beginning
            } else if (snap.left !== left) {
                glideFrom(snap.left - left);         // same line: slide sideways into place
            }
        }

        const originX = Math.max(0, Math.min(TOOLTIP_W, originPoint - left));
        const appearing = !tooltipContainer.classList.contains('visible');
        $.frame.draw('bar', () => {
            tooltipContainer.style.top = `${Math.round(top)}px`;
            tooltipContainer.style.left = `${left}px`;
            tooltipContainer.style.setProperty('--lh-origin-x', `${originX}px`);   // grows out of its anchor
            tooltipContainer.className = `visible mode-${mode} ${ctx.isLink ? 'ctx-link' : 'ctx-standard'}${appearing ? ' arriving' : ''}`;
            // Not clickable while it slides in: a quick next click (a triple-click) meant the text, not a button.
            // Clickable once the slide-in has really ended (slow pages take longer), or after a fallback.
            if (appearing) {
                clearTimeout(arriveTimer);
                tooltipContainer.addEventListener('transitionend', arrive);
                arriveTimer = setTimeout(arrive, $.token('--so-duration', 200) * 4);
            }
            tooltipContainer.querySelectorAll('.' + POPOVER_CLASS + '.visible').forEach(placePopover);
        });
    }

    // --- UTILS ---
    // --- LEAVING ---
    // A snapshot fades out where the bar was, while the real bar resets to rise in again
    let pendingSnapshot = null;   // taken by render() before rebuilding; resolved by updatePosition()

    function snapshot() {
        if (!tooltipContainer || !tooltipContainer.classList.contains('visible')) return null;
        const cs = getComputedStyle(tooltipContainer);
        const ghost = tooltipContainer.cloneNode(true);
        ['id', 'role'].forEach(a => ghost.removeAttribute(a));
        ghost.setAttribute('aria-hidden', 'true');
        ghost.classList.add('lighthouse-ghost');
        Object.assign(ghost.style, { opacity: cs.opacity, transform: cs.transform });
        const pos = (p) => parseFloat(tooltipContainer.style[p]) || 0;
        return { ghost, top: pos('top'), left: pos('left'), mode: MODE_CLASSES.find(c => tooltipContainer.classList.contains(c)) || '' };
    }

    function handOver(snap) {
        if (!snap) return;
        shadowRoot.appendChild(snap.ghost);
        void snap.ghost.offsetWidth;
        snap.ghost.style.opacity = '0';
        setTimeout(() => snap.ghost.remove(), $.token('--so-duration-out', 200) + 50);
        clearTimeout(tooltipContainer._glideEnd);
        Object.assign(tooltipContainer.style, { transition: '', transform: '' });
        tooltipContainer.classList.remove('visible');
        tooltipContainer.querySelectorAll('.' + POPOVER_CLASS + '.visible').forEach(p => p.classList.remove('visible'));
    }

    // Slides the bar from dx pixels away to where it now is (transform only)
    function glideFrom(dx) {
        const el = tooltipContainer;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        Object.assign(el.style, { transition: 'none', transform: `translateX(${dx}px)` });
        void el.offsetWidth;
        Object.assign(el.style, { transition: 'transform var(--so-duration) var(--so-ease)', transform: 'translateX(0)' });
        clearTimeout(el._glideEnd);
        el._glideEnd = setTimeout(() => Object.assign(el.style, { transition: '', transform: '' }), $.token('--so-duration', 200) + 50);
    }

    let arriveTimer = null;
    function arrive(e) {
        if (e && e.target !== tooltipContainer) return;   // a button's own transition, not the bar's
        tooltipContainer.removeEventListener('transitionend', arrive);
        clearTimeout(arriveTimer);
        tooltipContainer.classList.remove('arriving');
    }

    function destroy() {
        $.frame.cancel('bar');   // hidden before it could appear
        clearStrip();
        if (window.LighthouseInput) window.LighthouseInput.deactivate('bar');
        destroyCallbacks.forEach(cb => cb());
        if (tooltipContainer && tooltipContainer.classList.contains('visible')) {
            $.logEvent('UI', 'DESTROY', 'Tooltip Hidden');
            pendingSnapshot = null;
            handOver(snapshot());
        }
    }
    
    function showToast(msg, type) {
        if (!shadowRoot) return;
        const existing = shadowRoot.querySelectorAll('.lighthouse-toast'); existing.forEach(e => e.remove());
        const t = $.create('div', { className: `lighthouse-toast ${type || 'success'}`, text: msg });
        shadowRoot.appendChild(t);
        setTimeout(() => { t.classList.add('fade-out'); setTimeout(() => t.remove(), 300); }, 2000);
    }

    window.LighthouseUI = { 
        init, 
        render, 
        updatePosition, 
        destroy, 
        onDestroy: (cb) => destroyCallbacks.push(cb),
        contains: (t) => document.getElementById(HOST_ID)?.contains(t), 
        showToast, 
        isActionActive: () => actionActive,
        get shadowRoot() { return shadowRoot; },
        get isVisible() { return tooltipContainer && tooltipContainer.classList.contains('visible'); }
    };
})();
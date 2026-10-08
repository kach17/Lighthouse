/**
 * Lighthouse - UI Module
 * The bar, in a closed shadow root: one render path for every mode
 */
(function() {
    const $ = window.LighthouseUtils;
    const API = window.LighthouseAPI;
    
    const HOST_ID = 'lighthouse-host';
    const TOOLTIP_ID = 'lighthouse-extension-tooltip';
    const POPOVER_CLASS = 'lighthouse-popover';
    
    let shadowRoot = null, host = null;
    let tooltipContainer = null;
    
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
        btn._refill = () => ready && ready.then(el => { if (el && el._live) { el.replaceChildren(); build(el); } });   // live: after a keep-open action
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
        const GAP = $.token('--so-pad', 4) + $.token('--so-level-space', 6);   // --so-level-offset (a calc(), unreadable as a number)
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

    // Most important first: on a narrow bar, as many whole facts as fit are shown (see show)
    function selectionFacts(ctx) {
        if (!ctx.hasText || !ctx.cleanText) return [];
        const chars = (n) => plural(n, 'character', 'characters');
        const facts = [plural(ctx.wordCount, 'word', 'words')];
        const n = countCharacters(ctx.cleanText.replace(/[\r\n]+/g, ''), (later) => {
            if (!strip) return;
            strip.facts.splice(1, 0, chars(later));
            if (!strip.tool) show(strip.facts);
        });
        if (n !== null) facts.push(chars(n));
        const language = ctx.languageReliable && ctx.foreign === true && ctx.language && $.languageName(ctx.language);   // only one the user doesn't read
        if (language) facts.push(language);
        return facts;
    }

    // A plain field's own fact, with a caret in it, read live from the field (so a keep-open refresh,
    // Clear all, is current): its length against the limit it states, as the browser counts it
    // (LighthouseInput.lengthLimit: "12/50 characters", the same form when over). Nothing where the
    // field states no limit: never a guess.
    function fieldFacts(ctx) {
        const field = ctx.snapshot && ctx.snapshot.field;   // plain fields only (rich editors state no limit)
        const limit = field && window.LighthouseInput.lengthLimit(field);
        return limit ? [`${limit.length.toLocaleString()}/${limit.max.toLocaleString()} characters`] : [];
    }

    // What the strip says when no button is pointed at: the selection's facts, or with a caret in a
    // field the field's (never both: two counts of different things would read as a contradiction)
    // A context may say what matters about it (facts: a converted value's conversion, a link's address, nothing for a highlight)
    const stripFacts = (ctx) => ctx.facts ? ctx.facts() : ctx.hasText ? selectionFacts(ctx) : fieldFacts(ctx);

    // first: the first button's label, said when there is no selection (what the bar offers first)
    function buildStrip(ctx, iconOnly, first) {
        clearStrip();
        const facts = stripFacts(ctx);
        if (!facts.length && iconOnly && first) facts.push(first);
        tooltipContainer.dataset.strip = facts.length || iconOnly ? 'on' : 'off';
        if (tooltipContainer.dataset.strip === 'off') return;
        const layers = [$.create('span', { className: 'is-shown' }), $.create('span')];
        strip = { el: $.create('div', { className: 'lighthouse-strip', attrs: { 'aria-hidden': 'true' }, children: layers }), layers, facts, tool: false, on: null };
        tooltipContainer.appendChild(strip.el);
        show(facts);   // drawn with the bar, once it has its width
    }

    function clearStrip() {
        clearTimeout(countTimer);
        $.frame.cancel('strip');
        if (strip) { clearTimeout(strip.warm); clearTimeout(strip.grace); }
        strip = null;
    }

    // The one way the strip changes, through frame.draw: one update per frame, so scanning across
    // buttons coalesces. parts: facts, most important first (keep 'first': dropped from the end when
    // they don't fit), or a button's [name, info] (keep 'last': the name goes first). fade: a change
    // of subject, which crossfades.
    function show(parts, { fade = false, keep = 'first' } = {}) {
        const s = strip;
        $.frame.draw('strip', () => {
            if (strip !== s) return;
            if (fade) { s.layers[0].classList.remove('is-shown'); s.layers.reverse(); s.layers[0].classList.add('is-shown'); }
            const layer = s.layers[0], rest = [...parts];
            layer.textContent = rest.join(' · ');
            while (rest.length > 1 && layer.scrollWidth > layer.clientWidth) layer.textContent = (keep === 'first' ? rest.pop() : rest.shift(), rest.join(' · '));
        });
    }

    // Back to the selection's facts, after a delay (the grace period, or a notice's time)
    function backToFacts(delay) {
        clearTimeout(strip.grace);
        strip.grace = setTimeout(() => { if (strip && strip.tool) { strip.tool = false; show(strip.facts, { fade: true }); } }, delay);
    }

    // What the strip says about a button: in icon-only mode its name, and what the action reports
    // about its own decisions (info). Asked once per button per render, and only when pointed at.
    // As [name, info]: the name only in icon-only mode, and not when info already says it
    function describe(btn) {
        return btn._described ||= Promise.resolve(btn._info ? btn._info() : null).catch(() => null).then(info => {
            const label = tooltipContainer.dataset.labels === 'off' && !btn.classList.contains('text-only-btn')
                && btn.querySelector(':scope > .lighthouse-label');
            const name = label && label.textContent.trim();
            if (info) btn.setAttribute('aria-description', info);   // the same, for assistive technology
            return [info && name && info.toLowerCase().includes(name.toLowerCase()) ? null : name, info].filter(Boolean);
        });
    }

    // Describes the pointed-at button: after the warm-up, then at once while scanning
    function stripPoint(btn) {
        if (!strip || btn === strip.on) return;
        strip.on = btn;
        clearTimeout(strip.warm);
        clearTimeout(strip.grace);
        const grace = $.token('--so-strip-grace', 300);
        if (!btn) return strip.tool && backToFacts(grace);
        const say = (parts) => {
            if (!strip || strip.on !== btn) return;                         // moved on meanwhile
            if (!parts.length) return strip.tool && backToFacts(grace);     // nothing new here
            show(parts, { fade: !strip.tool, keep: 'last' });
            strip.tool = true;
        };
        if (strip.tool) describe(btn).then(say);
        else strip.warm = setTimeout(() => describe(btn).then(say), $.token('--so-label-delay', 350));
    }

    // Feedback from an action that keeps the bar open (Read aloud: 'Stopped reading'), for a moment.
    // False without a strip (then: a toast).
    function stripNotice(text) {
        if (!strip) return false;
        clearTimeout(strip.warm);
        show([text], { fade: true });
        strip.tool = true;
        strip.on = null;   // pointing again describes afresh
        backToFacts($.token('--so-notice-duration', 1500));
        return true;
    }

    function watchStrip() {
        const pointed = (e) => stripPoint(e.target.closest && e.target.closest('.lighthouse-btn, .lighthouse-preview'));
        tooltipContainer.addEventListener('mouseover', pointed);
        tooltipContainer.addEventListener('focusin', pointed);   // the keyboard points at buttons too
        tooltipContainer.addEventListener('mouseleave', () => stripPoint(null));
        tooltipContainer.addEventListener('focusout', (e) => { if (!tooltipContainer.contains(e.relatedTarget)) stripPoint(null); });
    }

    // --- INITIALIZATION ---
    // The bar lives in a closed shadow root: the page can't read what it shows (clipboard, collected snippets)
    function init() {
        if (host) return;
        document.getElementById(HOST_ID)?.remove();   // left by an earlier copy (the extension reloaded): its closed root is unreachable
        host = $.create('div', { attrs: { id: HOST_ID }, style: 'display: none; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;' });
        document.documentElement.appendChild(host);
        shadowRoot = host.attachShadow({ mode: 'closed' });
        window.addEventListener('lighthouse:state', () => shownButtons.forEach(b => b._sync && b._sync()));   // toggles
        for (const path of ['src/content/tokens.css', 'src/content/styles.css']) shadowRoot.appendChild($.create('link', { attrs: { rel: 'stylesheet', href: chrome.runtime.getURL(path) } }));
        shadowRoot.appendChild($.create('style', { attrs: { id: 'lighthouse-user-styles' } }));   // the theme
        tooltipContainer = $.create('div', { attrs: { id: TOOLTIP_ID, role: 'tooltip' } });
        shadowRoot.appendChild(tooltipContainer);
        // A press on the bar ends there too: its release (often over the page, once the bar has closed) is
        // part of the click, never a new click on the page. Forgotten just after the release.
        tooltipContainer.addEventListener('mousedown', (e) => { pressed = true; pressedAt = [e.clientX, e.clientY]; }, true);
        window.addEventListener('mouseup', () => setTimeout(() => { pressed = false; }), true);
        watchStrip();
    }

    // --- RENDER ---
    // The bar for the state machine's current state: header, up to four buttons (the rest in More), the strip
    const MAX_BUTTONS = 4;
    // The context the bar's buttons act on, read when they act: a refresh showing the same buttons only swaps
    // it, and the bar stays exactly as it is (Case)
    let current = null, shown = '', shownButtons = [];
    const live = new Proxy({}, { get: (_, k) => current[k], set: (_, k, v) => { current[k] = v; return true; }, has: (_, k) => k in current });
    const liveTools = new Proxy({}, { get: (_, k) => current.tools[k] });
    function render(State, { inPlace = false } = {}) {
        if (!host) init();
        // Pages that swap themselves in place (GitHub, Turbo) can remove what they didn't create: put it back.
        // The closed shadow root stays with the element, so the bar returns exactly as it was
        if (!host.isConnected) document.documentElement.appendChild(host);
        host.style.display = 'block';
        const { settings, ctx, activeActions } = State;
        window.LighthouseInput.activate('bar');   // its keys listen only while it is open

        // Labels visible or icon-only (a data attribute: positioning rewrites the class list), and the theme
        const labels = State.get('showLabels') || !!ctx.pointed;   // icons are for a group you choose from; a thing pointed at keeps its words
        tooltipContainer.dataset.labels = labels ? 'on' : 'off';
        const theme = shadowRoot.getElementById('lighthouse-user-styles');
        const css = window.LighthouseData.resolveThemeCSS(settings).replace(/:root|:host/g, `:host(#${HOST_ID})`);
        if (theme.textContent !== css) theme.textContent = css;

        const apiCtx = API.prepareContext(ctx), ids = activeActions.map(a => a.id).join();
        if (inPlace && ids === shown) {   // the same buttons: their labels worked out again, nothing rebuilt
            current = apiCtx;
            shownButtons.forEach(b => { if (b._relabel) b._relabel(); if (b._refill) b._refill(); });
            if (strip) { strip.facts = stripFacts(apiCtx); if (!strip.tool) show(strip.facts); }   // the selection's and the field's facts
            updatePosition(ctx, true);
            return afterRefresh();
        }
        current = apiCtx;
        shown = ids;

        // Already showing: updatePosition decides whether it stays or hands over
        pendingSnapshot = snapshot();
        tooltipContainer.innerHTML = '';

        // The header: a hovered link, a value (a converted one: what it was), or the quoted selection (and the link in it)
        if (State.mode === 'LINK' && ctx.url) renderLinkHeader(ctx);
        else if (ctx.value) renderValueHeader(ctx);
        else if (ctx.hasText) {
            renderTextHeader(ctx);
            const link = $.findLink(ctx.text);
            if (link) { ctx.url = link; renderLinkHeader(ctx); }
        }

        const buttons = shownButtons = activeActions.map(def => createButton(def, live, liveTools));
        tooltipContainer.append(...buttons.slice(0, MAX_BUTTONS));
        if (buttons.length > MAX_BUTTONS) {
            const more = $.create('div', { className: 'lighthouse-btn', attrs: { role: 'button', tabindex: '0' },
                children: [$.createSmartIcon('more'), $.create('span', { className: 'lighthouse-label', text: 'More' })] });
            attachPopover(more, (el) => { el.append(...buttons.slice(MAX_BUTTONS)); return el; });
            tooltipContainer.appendChild(more);
        }

        // The strip: a row of the bar, so positioning and popovers already account for it
        buildStrip(apiCtx, !labels, activeActions[0] && activeActions[0].label);
        updatePosition(ctx, inPlace);
        void tooltipContainer.offsetWidth;
        tooltipContainer.classList.add('visible');
        if (inPlace) afterRefresh();
    }

    // After a refresh: the strip describes the button under the pointer afresh (it may do something else next:
    // Case), and gives the action's feedback
    function afterRefresh() {
        if (!notice) return;
        const { text, at, success } = notice, under = shadowRoot.elementFromPoint(...at), btn = under && under.closest && under.closest('.lighthouse-btn, .lighthouse-preview');
        notice = null;
        if (btn) { delete btn._described; if (strip && strip.on === btn) strip.on = null; }
        stripPoint(btn);
        if (text && !stripNotice(text)) showToast(text, success ? 'success' : 'error');
    }

    // --- COMPONENTS ---

    // The selection, quoted; a click scrolls to it
    function renderTextHeader(ctx) {
        const el = $.create('div', {
            className: 'lighthouse-preview', style: 'cursor: pointer;',
            children: [$.create('span', { className: 'lighthouse-scroll-text', text: `"${$.excerpt(ctx.text.trim(), 100)}"` })],
            events: { mousedown: stop(() => {
                const sel = window.getSelection();
                const target = ctx.isForm ? ctx.element : sel.rangeCount && sel.getRangeAt(0).startContainer.parentElement;
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }) }
        });
        el._info = () => 'Scroll to selection';   // said in the strip
        tooltipContainer.appendChild(el);
    }

    // A value, shown as previews show values (a converted value: what it was); the strip says its facts
    function renderValueHeader(ctx) {
        const el = $.create('div', { className: 'lighthouse-preview is-value', children: [$.create('span', { className: 'lighthouse-scroll-text', text: ctx.value.text })] });
        tooltipContainer.appendChild(el);
    }

    // A link (hovered, or the selection is one): where it goes, and with previews on, a card for the page
    function renderLinkHeader(ctx) {
        const tools = API.prepareContext(ctx).tools;
        // The page's <head>, fetched once for the preview and the icon. The setting is checked first, so
        // turning previews off also hides ones fetched earlier
        const pageHead = async () => {
            if (!window.LighthouseState.get('linkPreviews')) return null;
            const key = `og:${ctx.url}`;
            if (!previewCache.has(key)) { const html = await tools.query('LINK_PREVIEW', { url: ctx.url }); if (!html) return null; cacheSet(key, html); }
            return previewCache.get(key);
        };
        const page = () => pageHead().then(html => html && $.parsePreview(html, ctx.url)).catch(() => null);
        tooltipContainer.appendChild(createButton({
            id: 'link-open', label: $.displayLink(ctx.url), iconUrl: ctx.url,
            info: () => ctx.url,   // the full address (the label is shortened)
            findIcon: async () => { const p = await page(); return p ? p.icon : null; },   // the page's own icon
            url: () => ctx.url,
            preview: async () => {
                const p = await page();
                return p && (p.title || p.image) ? { node: $.mediaCard({ image: p.image, title: p.title, body: p.description }) }
                    : { previewText: ctx.url.replace(/^https?:\/\//, ''), previewClick: () => tools.open(ctx.url) };   // the full address
            }
        }, ctx, tools));
        if (ctx.isLink) tooltipContainer.appendChild(createButton({
            id: 'link-copy', label: 'Copy', icon: 'copy',
            execute: () => { tools.copy(ctx.url); return { success: true, message: 'Link copied' }; }
        }, ctx, tools));
    }

    // After an action, from a button or a menu item: the bar and its handles close (through the state machine,
    // not only when the selection changes: an action may already have replaced the selected text, as Convert
    // page does), and the text is left as after any edit (a field keeps focus; on the page the selection
    // collapses, revealing e.g. a highlight)
    function finish(ctx) {
        window.LighthouseState.send('close');
        if (ctx.isForm) ctx.element.focus();
        else if (!ctx.isLink) window.getSelection().collapseToEnd();
    }

    const stop = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(e); };

    // Something clicked in the bar (a button, or an item in its menu) does its work, then either the bar is
    // done (it closes; feedback as a toast), or it stays (keepOpen): where it is, showing what fits now, with
    // the feedback in its strip. While it works, its own edits don't close the bar.
    let notice = null;   // feedback for the bar that stays, shown once it has rebuilt
    let pressed = false; // a press that started on the bar, until just after its release
    let pressedAt = null;    // where the last such press was
    async function act(keepOpen, run, ctx, e) {
        if (keepOpen) window.LighthouseState.send('actStart');
        const res = await run();
        if (!keepOpen) {
            if (res && res.message) showToast(res.message, res.success ? 'success' : 'error');
            return finish(ctx);
        }
        notice = { text: res && res.message, at: [e.clientX, e.clientY], success: !res || res.success };
        window.LighthouseContent.refresh();
        setTimeout(() => window.LighthouseState.send('actEnd'), 200);
    }

    // A bar button for an action (see DEVELOPER.md, "Adding an action")
    function createButton(def, ctx, tools) {
        const btn = $.create('button', {
            className: 'lighthouse-btn' + (def.textOnly ? ' text-only-btn' : ''), attrs: { 'data-action': def.id },
            children: [$.createSmartIcon(def.icon, def.iconUrl, def.label, def.findIcon), $.create('span', { className: 'lighthouse-label', text: def.label })]
        });
        // Toggles (Pause) announce state changes with a 'lighthouse:state' event; one listener re-syncs the shown buttons (init)
        if (def.isActive) (btn._sync = () => btn.classList.toggle('is-active', !!def.isActive()))();
        // A label worked out for this selection: text, or { quote } shown as a quoted value that pans on hover (Paste)
        if (def.dynamicLabel) (btn._relabel = () => Promise.resolve(def.dynamicLabel(ctx, tools)).then(val => {
            const label = btn.querySelector('.lighthouse-label');
            if (!val || !label) return;
            if (typeof val === 'string') return void (label.textContent = val);
            if (!val.quote) return;
            label.replaceChildren($.create('span', { className: 'lighthouse-scroll-text', text: `"${val.quote}"` }));
            btn.classList.add('text-only-btn', 'is-quote');
        }).catch(() => {}))();
        if (def.info) btn._info = () => def.info(ctx, tools);

        // An action runs (execute), or opens its page (url). A click acts on the context of that moment, also after an await (Paste reads the clipboard first)
        btn.onmousedown = stop((e) => {
            const [c, t] = ctx === live ? [current, current.tools] : [ctx, tools];
            act(def.keepOpen, def.execute ? () => def.execute(c, t) : () => { const url = def.url(c, t); if (url) t.open(url); return { success: !!url }; }, c, e);
        });
        if (def.preview) attachPopover(btn, (popover) => fillPreview(popover, def, ctx, tools));
        return btn;
    }

    // A preview from what an action's preview() returns: previewText (isValue: shown as a value; previewClick:
    // what clicking it does) or node; items, the menu (label, icon or color, textOnly, current, info, onClick);
    // live: asked again each time (clipboard, collection), else kept for the selection
    async function fillPreview(popover, def, ctx, tools) {
        const key = `${def.id}:${ctx.text || ctx.url || ''}`;
        let data = previewCache.get(key);
        if (!data) {
            data = await def.preview(ctx, tools);
            if (data && !data.live) cacheSet(key, data);
        }
        if (!data) return null;
        popover._live = !!data.live;
        if (data.previewText) {
            const el = $.create('div', { className: 'lighthouse-preview' + (data.isValue ? ' is-value' : ''), children: [$.create('span', { className: 'lighthouse-scroll-text', text: data.previewText })] });
            if (data.previewClick) { el.style.cursor = 'pointer'; el.onmousedown = stop(() => { data.previewClick(); destroy(); }); }
            popover.appendChild(el);
        } else if (data.node) {
            popover.appendChild($.create('div', { className: 'lighthouse-content', children: [data.node] }));
        }
        for (const item of data.items || []) {
            const sub = $.create('button', {
                className: 'lighthouse-btn' + (item.textOnly ? ' text-only-btn' : '') + (item.current ? ' is-current' : ''),
                children: [item.color ? $.create('span', { className: 'lighthouse-swatch', style: `background: var(--lh-hl-${item.color})` }) : $.createSmartIcon(item.icon, item.iconUrl, item.label),
                    $.create('span', { className: 'lighthouse-label', text: item.label })],
                events: { mousedown: stop((e) => act(item.keepOpen, () => item.onClick(), ctx, e)) }
            });
            if (item.info) sub._info = () => item.info;   // what the strip says while it is pointed at
            popover.appendChild(sub);
        }
        return popover;
    }

    // --- UNIFIED POSITIONING LOGIC ---
    const MODE_CLASSES = ['mode-top', 'mode-bottom', 'mode-sticky-top', 'mode-sticky-bottom'];

    // The side the bar takes, chosen once per bar: { owner (the snapshot it opened for), side }
    let barSide = null;

    // inPlace: the same bar refreshed after an action: it keeps its left edge, so buttons that remain don't move
    function updatePosition(ctx, inPlace = false) {
        if (!tooltipContainer || !ctx) return;

        // Where the selection is drawn now; the pointer belongs to the selection the bar opened for.
        // Links and a caret in a field: at the element. Page text drawn nowhere: at the pointer, or gone
        const live = ctx.isLink || (ctx.isForm && !ctx.hasText) ? null : window.LighthouseSelection.current();
        let drawn = null;
        try { drawn = live && live.edges('painted'); } catch (e) { /* nothing to measure */ }
        const ends = ctx.hasText ? drawn : null, pointer = ctx.snapshot && ctx.snapshot.pointer;
        let rect = !live || (ctx.isForm && !ends) ? ctx.element.getBoundingClientRect() : drawn && drawn.box;
        if (rect && live && !ctx.isForm && !rect.top && !rect.left && !rect.width) rect = pointer && { left: pointer.x, top: pointer.y, right: pointer.x, bottom: pointer.y, width: 0, height: 0 };
        if (!rect) return destroy();

        // Centered on the selection, on the edge nearer the pointer (or caret); one line: above.
        // Chosen once per bar. Links and fields without a selection: at the element.
        let anchorLeft = pointer ? pointer.x : rect.left + rect.width / 2, prefer = 'top';
        if (!ctx.isLink && ctx.hasText && rect.width > 0) {
            const owner = ctx.snapshot || ctx;
            if (!barSide || barSide.owner !== owner) {
                const multiLine = ends && ends.end.dy - ends.start.dy > ends.start.lineHeight / 2;
                // Without a pointer, the caret's end: the start when the selection was extended backwards
                const y = pointer ? pointer.y : ends ? (live.backward ? ends.start.dy : ends.end.dy) : rect.top;
                barSide = { owner, side: multiLine && (y - rect.top) > (rect.bottom - y) ? 'bottom' : 'top' };
            }
            prefer = barSide.side;
            anchorLeft = rect.left + rect.width / 2;
        }

        const TOOLTIP_H = tooltipContainer.offsetHeight || 48, VIEW_W = window.innerWidth, VIEW_H = window.innerHeight;
        const MARGIN = $.token('--so-viewport-margin', 8), GAP = $.token('--so-bar-gap', 18);
        // Below the selection, clear of the handle tabs hanging under the line boxes
        let idealBottom = rect.bottom + GAP;
        if (ends && window.LighthouseState.get('addDragHandles')) {
            const lineBottom = Math.max(ends.start.dy + ends.start.lineHeight, ends.end.dy + ends.end.lineHeight);
            idealBottom = Math.max(idealBottom, lineBottom + $.token('--so-handle-gap') + $.token('--so-handle-height') + $.token('--so-level-space'));
        }
        const idealTop = rect.top - TOOLTIP_H - GAP, fits = (y) => y >= MARGIN && y <= VIEW_H - TOOLTIP_H - MARGIN;
        // The preferred side if it fits, else above, else below, else stuck to the edge the selection went past
        const [top, mode] = prefer === 'bottom' && fits(idealBottom) ? [idealBottom, 'bottom'] : fits(idealTop) ? [idealTop, 'top']
            : fits(idealBottom) ? [idealBottom, 'bottom'] : rect.top > VIEW_H - MARGIN ? [VIEW_H - TOOLTIP_H - MARGIN, 'sticky-bottom'] : [MARGIN, 'sticky-top'];

        // The mode changes what the bar shows, so it's applied before measuring
        MODE_CLASSES.forEach(c => tooltipContainer.classList.toggle(c, c === `mode-${mode}`));
        const TOOLTIP_W = tooltipContainer.offsetWidth || 220;
        const originPoint = anchorLeft;
        // Centered on its anchor (a refresh: where it was), kept on screen, at a whole pixel
        const snap = pendingSnapshot, start = inPlace && snap ? snap.left : anchorLeft - TOOLTIP_W / 2;
        const left = Math.round(Math.max(MARGIN, Math.min(start, VIEW_W - TOOLTIP_W - MARGIN)));

        // Was showing: same spot, update in place; elsewhere, hand over
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
        window.LighthouseInput.deactivate('bar');
        destroyCallbacks.forEach(cb => cb());
        if (tooltipContainer && tooltipContainer.classList.contains('visible')) {
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
        contains: (t) => !!host && host.contains(t), 
        showToast, 
        get shadowRoot() { return shadowRoot; },
        get pressed() { return pressed; },
        // An event at the very spot of the last click on the bar: the pointer hasn't moved since, so a hover
        // there came from the click's result (the bar closing over a link), not from the user
        atLastPress: (e) => !!pressedAt && e.clientX === pressedAt[0] && e.clientY === pressedAt[1]
    };
})();
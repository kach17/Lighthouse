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
    let hoverTimeout = null;
    let lastState = null;
    
    // Cache for preview popovers to prevent duplicate network requests
    const previewCache = new Map();

    // #9: Encapsulated cache setter with max-size eviction
    const cacheSet = (key, val) => {
        if (previewCache.size >= 5) previewCache.delete(previewCache.keys().next().value);
        previewCache.set(key, val);
    };

    // #3: Shared preview element style applicator
    const applyPreviewStyle = (el) => {
        el.style.cssText = 'margin-right:8px; display:flex !important; visibility: visible !important; opacity: 1 !important; min-width: auto; max-width: 300px; backdrop-filter: none; -webkit-backdrop-filter: none; mask-image: none; -webkit-mask-image: none;';
    };

    // --- INITIALIZATION ---
    function init() {
        if (document.getElementById(HOST_ID)) return; 

        const host = document.createElement('div');
        host.id = HOST_ID;
        host.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; pointer-events: none;';
        document.documentElement.appendChild(host);
        shadowRoot = host.attachShadow({ mode: 'open' });

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = chrome.runtime.getURL('src/content/styles.css');
        shadowRoot.appendChild(link);

        const userStyle = document.createElement('style');
        userStyle.id = 'lighthouse-user-styles';
        shadowRoot.appendChild(userStyle);

        tooltipContainer = $.create('div', { 
            attrs: { id: TOOLTIP_ID, role: 'tooltip' }
        });
        shadowRoot.appendChild(tooltipContainer);
    }

    // --- MAIN RENDER LOOP ---
    function render(State) {
        if (!shadowRoot) init();
        
        // Ensure host is visible
        const host = document.getElementById(HOST_ID);
        if (host) host.style.display = 'block';

        lastState = State;
        const { settings, ctx, activeActions } = State;
        
        $.logEvent('UI', 'RENDER', `${State.mode} (${activeActions.length} actions)`);

        // 1. Apply Theme
        const styleTag = shadowRoot.getElementById('lighthouse-user-styles');
        if (styleTag && styleTag.textContent !== settings.customStyles) {
            styleTag.textContent = (settings.customStyles || '').replace(/:root|:host/g, `:host(#${HOST_ID})`);
        }

        tooltipContainer.innerHTML = ''; 

        // 2. Render Header (Unified for Link vs Text)
        if (State.mode === 'LINK') {
            renderLinkHeader(ctx);
        } else if (ctx.hasText) {
            // Standard Header for BOTH Inputs and Selection (Always visible)
            renderTextHeader(ctx);
        }

        // 3. Render Actions
        const apiCtx = API.prepareContext(ctx);
        const tools = API.getTools(apiCtx);

        const MAX_BUTTONS = 4;
        let visibleButtons = 0;
        let moreMenu = null;

        activeActions.forEach((actionDef, index) => {
            const btn = createButton(actionDef, apiCtx, tools);
            
            if (visibleButtons < MAX_BUTTONS) {
                tooltipContainer.appendChild(btn);
                visibleButtons++;
            } else {
                if (!moreMenu) {
                    moreMenu = $.create('div', { className: POPOVER_CLASS + ' lighthouse-static-popover', style: 'display: flex; flex-direction: row; padding: 4px; gap: 4px;' });
                    // Use div instead of button to avoid invalid HTML (nested buttons)
                    const moreBtn = $.create('div', {
                        className: 'lighthouse-btn has-popover',
                        attrs: { role: 'button', tabindex: '0' },
                        children: [ $.createSmartIcon('more') ]
                    });
                    moreBtn.appendChild(moreMenu);
                    
                    let moreTimeout;
                    const showMore = () => {
                        clearTimeout(moreTimeout);
                        moreMenu.classList.add('visible');
                    };
                    const hideMore = () => {
                        moreTimeout = setTimeout(() => {
                            moreMenu.classList.remove('visible');
                        }, 200);
                    };

                    moreBtn.onmouseenter = showMore;
                    moreBtn.onmouseleave = hideMore;
                    moreMenu.onmouseenter = showMore;
                    moreMenu.onmouseleave = hideMore;

                    tooltipContainer.appendChild(moreBtn);
                }
                moreMenu.appendChild(btn);
            }
        });

        // 4. Show
        updatePosition(ctx);
        void tooltipContainer.offsetWidth; // Force Reflow
        tooltipContainer.classList.add('visible');
    }

    // --- UNIFIED COMPONENTS ---

    function renderTextHeader(ctx) {
        let pTxt = ctx.text.trim();
        if (pTxt.length > 100) pTxt = pTxt.substring(0, 100) + '...';
        
        const previewEl = $.create('div', { 
            className: 'lighthouse-preview',
            attrs: { title: 'Scroll to selection' },
            style: 'cursor: pointer;',
            children: [ $.create('span', { className: 'lighthouse-scroll-text', text: `"${pTxt}"` }) ],
            events: {
                mousedown: (e) => {
                    e.preventDefault(); e.stopPropagation();
                    // Unified Scroll Logic
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
        tooltipContainer.appendChild($.create('div', { className: 'lighthouse-separator' }));
    }

    function renderLinkHeader(ctx) {
        const Safety = window.LighthouseSafety;
        const safety = Safety ? Safety.assess(ctx.url) : { status: 'UNKNOWN', icon: 'globe', rootDomain: '?' };
        
        // Hoisted once — shared by both linkBtn and copyBtn
        const apiCtx = API.prepareContext(ctx);
        const tools = API.getTools(apiCtx);

        // 1. Link Button (Favicon) - Uses standard button + Popover for details
        const linkBtn = createButton({
            id: 'link-open',
            label: 'Open',
            icon: 'globe', // Fallback
            iconUrl: ctx.url, // Triggers Favicon
            preview: async () => {
                // Prepare Safety Icon (Colored)
                let iconKey = 'lock';
                let color = '#86efac'; // Success Green
                if (safety.status === 'DANGER') { iconKey = 'lock'; color = '#fca5a5'; } // Red
                else if (safety.status === 'SUSPICIOUS') { iconKey = 'warning'; color = '#fde047'; } // Yellow
                
                // Get raw SVG and color it
                let svg = window.LighthouseIcons ? window.LighthouseIcons[iconKey] : null;
                if (svg) svg = svg.replace('<svg ', `<svg style="color: ${color};" `);

                return {
                    // 2) The Link (Textual Button)
                    previewText: ctx.url,
                    previewClick: () => window.open(ctx.url, '_blank'),
                    
                    // 1) The Safety Badge (Button)
                    prependItems: true,
                    items: [{
                        label: `Safety: ${safety.status}`,
                        icon: svg || iconKey, // Pass colored SVG or key
                        onClick: () => { /* Info? */ }
                    }]
                };
            },
            execute: () => {
                if (safety.status === 'DANGER' && !confirm(`WARNING: Malicious link detected.\nProceed to ${safety.rootDomain}?`)) return;
                window.open(ctx.url, '_blank');
                return { success: true };
            }
        }, ctx, tools);

        // 2. Copy Button
        const copyBtn = createButton({
            id: 'link-copy',
            label: 'Copy',
            icon: 'copy',
            execute: () => {
                navigator.clipboard.writeText(ctx.url);
                return { success: true, message: 'Link Copied' };
            }
        }, ctx, tools);

        tooltipContainer.appendChild(linkBtn);
        tooltipContainer.appendChild($.create('div', { className: 'lighthouse-separator' }));
        tooltipContainer.appendChild(copyBtn);
    }

    function createButton(def, ctx, tools) {
        // Base Button
        const btn = $.create('button', {
            className: 'lighthouse-btn',
            attrs: { 'data-action': def.id },
            children: [ 
                $.createSmartIcon(def.icon, def.iconUrl, def.label),
                $.create('span', { className: 'lighthouse-label', text: def.label })
            ]
        });

        // Handle Paste Special Case (Async Content) inside the standard flow
        if (def.id === 'paste') {
            tools.readClipboard().then(text => {
                if (text && text.trim().length > 0) {
                    const clean = text.replace(/\n/g, ' ').trim();
                    const display = clean.length > 20 ? clean.substring(0, 20) + '...' : clean;
                    btn.innerHTML = ''; // Clear icon
                    btn.className = 'lighthouse-paste-btn'; // Switch style
                    btn.appendChild($.create('span', { text: `"${display}"` }));
                }
            });
        }

        // Click Handler
        btn.onmousedown = async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (def.keepOpen) actionActive = true;

            const res = await def.execute(ctx, tools);
            if (res && res.message) showToast(res.message, res.success ? 'success' : 'error');

            if (!def.keepOpen) {
                destroy();
                // Standardize Focus Restore
                if (ctx.isForm) ctx.element.focus();
                else if (!ctx.isLink) window.getSelection().collapseToEnd();
            } else {
                // Update text context in-place for subsequent actions
                if (ctx.isForm) ctx.text = ctx.element.value.substring(ctx.element.selectionStart, ctx.element.selectionEnd);
                else if (ctx.hasText) ctx.text = window.getSelection().toString();
                setTimeout(() => actionActive = false, 200);
            }
        };

        // Popover (Preview) Logic
        if (def.preview) {
            btn.classList.add('has-popover');
            btn.onmouseenter = () => {
                hoverTimeout = setTimeout(async () => {
                    removePopover();
                    
                    // 1. Check Cache
                    const cacheKey = `${def.id}:${ctx.text || ctx.url || ''}`;
                    let data = previewCache.get(cacheKey);
                    
                    // 2. Fetch if not cached
                    if (!data) {
                        data = await def.preview(ctx, tools);
                        if (data) cacheSet(cacheKey, data);
                    }
                    
                    if (!data) return;

                    const popover = $.create('div', { className: POPOVER_CLASS });
                    
                    const renderItems = () => {
                        if (data.items) {
                            data.items.forEach(item => {
                                const sub = $.create('button', {
                                    className: 'lighthouse-btn' + (item.textOnly ? ' text-only-btn' : ''),
                                    children: [ $.createSmartIcon(item.icon, item.iconUrl, item.label), $.create('span', { className: 'lighthouse-label', text: item.label }) ],
                                    events: { mousedown: (e) => { e.preventDefault(); e.stopPropagation(); item.onClick(); destroy(); } }
                                });
                                popover.appendChild(sub);
                            });
                        }
                    };

                    // 1. Items (Prepend)
                    if (data.prependItems) renderItems();

                    // 2. Preview Text or Node
                    if (data.previewNode) {
                        const prevEl = $.create('div', { className: 'lighthouse-preview' });
                        applyPreviewStyle(prevEl);
                        prevEl.appendChild(data.previewNode);
                        popover.appendChild(prevEl);
                    } else if (data.previewText) {
                        const prevEl = $.create('div', { className: 'lighthouse-preview' });
                        applyPreviewStyle(prevEl);
                        prevEl.innerHTML = data.previewText.includes('<') ? data.previewText : `<span class="lighthouse-scroll-text">${data.previewText}</span>`;
                        
                        if (data.previewClick) {
                            prevEl.style.cursor = 'pointer';
                            prevEl.onmousedown = (e) => {
                                e.preventDefault(); e.stopPropagation();
                                data.previewClick();
                                destroy();
                            };
                        }
                        popover.appendChild(prevEl);
                    } else if (data.content) {
                         // Only apply text styling (masking/ellipsis) if explicitly text type
                         const cls = (data.type === 'text') ? 'lighthouse-preview' : '';
                         popover.appendChild($.create('div', { className: cls, html: data.content }));
                    }

                    // 3. Items (Append - Default)
                    if (!data.prependItems) renderItems();

                    btn.appendChild(popover);
                    requestAnimationFrame(() => popover.classList.add('visible'));
                }, 300);
            };
            btn.onmouseleave = () => { clearTimeout(hoverTimeout); removePopover(true); };
        }

        return btn;
    }

    // --- UNIFIED POSITIONING LOGIC ---
    function updatePosition(ctx) {
        if (!tooltipContainer || !ctx) return;

        // 1. Get Target Rectangle (READ PHASE)
        let rect;
        if (ctx.isLink) {
            rect = ctx.element.getBoundingClientRect();
        } else if (ctx.isForm) {
            const elRect = ctx.element.getBoundingClientRect();
            if (ctx.relativePos) {
                // Scroll-Aware Input Logic: Element Rect + Relative Click Offset
                const x = elRect.left + ctx.relativePos.x;
                const y = elRect.top + ctx.relativePos.y;
                rect = { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
            } else {
                // Fallback: Center of input
                rect = { left: elRect.left + elRect.width/2, top: elRect.top + elRect.height/2, width:0, height:0, right: elRect.left + elRect.width/2, bottom: elRect.top + elRect.height/2 };
            }
        } else {
            const sel = window.getSelection();
            if (!sel.rangeCount) return destroy();
            rect = sel.getRangeAt(0).getBoundingClientRect();
            
            // Fallback for empty rects (e.g. backward selections in some browsers)
            if (rect.width === 0 && rect.height === 0 && window.LighthouseState && window.LighthouseState.lastEvent) {
                const e = window.LighthouseState.lastEvent;
                rect = { left: e.clientX, top: e.clientY - 10, right: e.clientX, bottom: e.clientY - 10, width: 0, height: 0 };
            }
        }

        if (!rect || (rect.width === 0 && rect.height === 0 && !ctx.isForm)) return destroy();

        // 2. Calculate Strict Positions (CALCULATE PHASE)
        const TOOLTIP_H = tooltipContainer.offsetHeight || 46;
        const TOOLTIP_W = tooltipContainer.offsetWidth || 200;
        const VIEW_W = window.innerWidth;
        const VIEW_H = window.innerHeight;
        const MARGIN = 10;
        const GAP = 12;

        // Horizontal: Clamp within viewport
        let left = rect.left + (rect.width / 2);
        left = Math.max((TOOLTIP_W / 2) + MARGIN, Math.min(left, VIEW_W - (TOOLTIP_W / 2) - MARGIN));
        
        const idealTop = rect.top - TOOLTIP_H - GAP;
        const idealBottom = rect.bottom + GAP;
        
        let top, mode;

        // Priority 1: Ideal Top (Standard)
        if (idealTop >= MARGIN && idealTop + TOOLTIP_H <= VIEW_H) {
             top = idealTop;
             mode = 'top';
        }
        // Priority 2: Ideal Bottom (Flip) - ONLY if visibly on screen
        else if (idealBottom >= MARGIN && idealBottom + TOOLTIP_H <= VIEW_H - MARGIN) {
             top = idealBottom;
             mode = 'bottom';
        }
        // Priority 3: Sticky (Peek) - Fallback for off-screen
        else {
             if (rect.top < MARGIN) {
                 // Scrolled Up / Past Top -> Stick to Top
                 top = MARGIN;
                 mode = 'sticky-top';
             } else {
                 // Scrolled Down / Past Bottom -> Stick to Bottom
                 top = VIEW_H - TOOLTIP_H - MARGIN;
                 mode = 'sticky-bottom';
             }
        }

        // 3. Apply Styles (WRITE PHASE - Batched via rAF)
        requestAnimationFrame(() => {
            tooltipContainer.style.top = `${top}px`;
            tooltipContainer.style.left = `${left}px`;
            // Classes control arrow orientation
            tooltipContainer.className = `visible mode-${mode} ${ctx.isLink ? 'ctx-link' : 'ctx-standard'}`;
        });
    }

    // --- UTILS ---
    function removePopover(fade) {
        const el = shadowRoot?.querySelector('.' + POPOVER_CLASS + ':not(.lighthouse-static-popover)');
        if (el) {
            if (fade) { el.classList.remove('visible'); setTimeout(() => el.remove(), 200); }
            else el.remove();
        }
    }

    function destroy() {
        if (tooltipContainer && tooltipContainer.classList.contains('visible')) {
            $.logEvent('UI', 'DESTROY', 'Tooltip Hidden');
            tooltipContainer.classList.remove('visible');
        }
    }
    
    function showToast(msg, type) { /* ... same as before ... */
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
        contains: (t) => document.getElementById(HOST_ID)?.contains(t), 
        showToast, 
        isActionActive: () => actionActive,
        get shadowRoot() { return shadowRoot; },
        get isVisible() { return tooltipContainer && tooltipContainer.classList.contains('visible'); }
    };
})();
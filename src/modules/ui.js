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
    let moreTimeout = null;
    let lastState = null;
    const destroyCallbacks = [];
    
    // Cache for preview popovers to prevent duplicate network requests
    const previewCache = new Map();

    const cacheSet = (key, val) => {
        if (previewCache.size >= 5) previewCache.delete(previewCache.keys().next().value);
        previewCache.set(key, val);
    };

    const applyPreviewStyle = (el) => {
        el.style.cssText = 'margin-right:8px; display:flex !important; visibility: visible !important; opacity: 1 !important; min-width: auto; max-width: 300px; backdrop-filter: none; -webkit-backdrop-filter: none; mask-image: none; -webkit-mask-image: none;';
    };

    // --- SHARED POSITIONING LOGIC ---
    // Used by both the main tooltip and popovers — same calculation, different anchors
    function calculatePosition(anchorRect, elementW, elementH) {
        const VIEW_W = window.innerWidth;
        const VIEW_H = window.innerHeight;
        const MARGIN = 8;
        const GAP = 10;

        // Horizontal — center on anchor, clamp to viewport
        let left = anchorRect.left + (anchorRect.width / 2) - (elementW / 2);
        left = Math.max(MARGIN, Math.min(left, VIEW_W - elementW - MARGIN));

        // Vertical — prefer above, flip below if not enough space
        const idealTop = anchorRect.top - elementH - GAP;
        const idealBottom = anchorRect.bottom + GAP;

        let top, direction;
        if (idealTop >= MARGIN) {
            top = idealTop;
            direction = 'top';
        } else if (idealBottom + elementH <= VIEW_H - MARGIN) {
            top = idealBottom;
            direction = 'bottom';
        } else {
            top = MARGIN;
            direction = 'sticky';
        }

        return { top, left, direction };
    }

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

        // 2. Render Header
        if (State.mode === 'LINK') {
            renderLinkHeader(ctx);
        } else if (ctx.hasText) {
            renderTextHeader(ctx);
            const urls = ctx.text.length <= 300 ? ctx.text.match(/https?:\/\/[^\s]+/g) : null;
            if (urls && urls.length === 1) { ctx.url = urls[0]; renderLinkHeader(ctx); }
        }

        // 3. Render Actions
        const apiCtx = API.prepareContext(ctx);
        const tools = API.getTools(apiCtx);

        const MAX_BUTTONS = 4;
        let visibleButtons = 0;
        let moreMenu = null;
        let moreBtn = null;

        activeActions.forEach((actionDef) => {
            const btn = createButton(actionDef, apiCtx, tools);
            
            if (visibleButtons < MAX_BUTTONS) {
                tooltipContainer.appendChild(btn);
                visibleButtons++;
            } else {
                if (!moreMenu) {
                    moreMenu = $.create('div', { className: POPOVER_CLASS + ' lighthouse-static-popover', style: 'display: flex; flex-direction: row; padding: 4px; gap: 4px;' });
                    moreBtn = $.create('div', {
                        className: 'lighthouse-btn has-popover',
                        attrs: { role: 'button', tabindex: '0' },
                        children: [ $.createSmartIcon('more') ]
                    });
                    moreBtn.appendChild(moreMenu);
                    
                    const showMore = () => {
                        clearTimeout(moreTimeout);
                        moreMenu.classList.add('visible');
                        requestAnimationFrame(() => {
                            const br = moreBtn.getBoundingClientRect();
                            const pr = moreMenu.getBoundingClientRect();
                            const pos = calculatePosition(br, pr.width, pr.height);
                            moreMenu.style.top = `${pos.top}px`;
                            moreMenu.style.left = `${pos.left}px`;
                            moreMenu.style.position = 'fixed';
                        });
                    };
                    const hideMore = (e) => {
                        if (e && e.relatedTarget && (moreBtn.contains(e.relatedTarget) || moreMenu.contains(e.relatedTarget))) return;
                        moreTimeout = setTimeout(() => moreMenu.classList.remove('visible'), 400);
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
        void tooltipContainer.offsetWidth;
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
        
        const apiCtx = API.prepareContext(ctx);
        const tools = API.getTools(apiCtx);

        const linkBtn = createButton({
            id: 'link-open',
            label: 'Open',
            icon: null,
            iconUrl: ctx.url,
            preview: async () => {
                let iconKey = 'lock';
                let color = '#86efac'; 
                if (safety.status === 'DANGER') { iconKey = 'lock'; color = '#fca5a5'; } 
                else if (safety.status === 'SUSPICIOUS') { iconKey = 'warning'; color = '#fde047'; } 
                
                let svg = window.LighthouseIcons ? window.LighthouseIcons[iconKey] : null;
                if (svg) svg = svg.replace('<svg ', `<svg style="color: ${color};" `);

                let ogHtml = null;
                try {
                    const cacheKey = `og:${ctx.url}`;
                    let html = previewCache.get(cacheKey);
                    if (!html) {
                        html = await tools.fetchRaw(ctx.url);
                        if (html) cacheSet(cacheKey, html);
                    }
                    if (html) {
                        const tags = window.LighthouseUtils.parseOGTags(html);
                        if (tags.title || tags.image) {
                            ogHtml = `<div style="max-width: 260px; text-align: left; white-space: normal; line-height: 1.4; padding: 4px;">`;
                            if (tags.image) {
                                ogHtml += `<img src="${tags.image}" onerror="this.style.display='none'" style="width: 100%; max-height: 140px; object-fit: cover; border-radius: 6px; margin-bottom: 8px;" referrerpolicy="no-referrer">`;
                            }
                            if (tags.title) {
                                ogHtml += `<strong style="font-size: 14px; color: var(--so-text-color);">${tags.title}</strong>`;
                            }
                            if (tags.description) {
                                ogHtml += `<div style="font-size: 12px; color: var(--so-text-color); margin-top: 4px;">${tags.description}</div>`;
                            }
                            ogHtml += `</div>`;
                        }
                    }
                } catch (e) { /* Fail silently */ }

                const fallbackText = (() => {
                    try { return new URL(ctx.url).hostname; } catch { return ctx.url; }
                })();

                return {
                    type: ogHtml ? 'html' : 'text',
                    content: ogHtml || null,
                    previewText: ogHtml ? null : fallbackText,
                    previewClick: () => window.open(ctx.url, '_blank'),
                    items: safety.status !== 'UNKNOWN' ? [{
                        label: `Safety: ${safety.status}`,
                        icon: svg || iconKey,
                        onClick: () => {}
                    }] : null
                };
            },
            execute: () => {
                if (safety.status === 'DANGER' && !confirm(`WARNING: Malicious link detected.\nProceed to ${safety.rootDomain}?`)) return;
                window.open(ctx.url, '_blank');
                return { success: true };
            }
        }, ctx, tools);

        const copyBtn = createButton({
            id: 'link-copy',
            label: 'Copy',
            icon: 'copy',
            execute: () => {
                navigator.clipboard.writeText(ctx.url).catch(e => console.warn('Lighthouse UI: Clipboard write blocked', e));
                return { success: true, message: 'Link Copied' };
            }
        }, ctx, tools);

        tooltipContainer.appendChild(linkBtn);
        tooltipContainer.appendChild($.create('div', { className: 'lighthouse-separator' }));
        if (ctx.isLink) tooltipContainer.appendChild(copyBtn);
    }

    function createButton(def, ctx, tools) {
        let className = 'lighthouse-btn';
        if (def.textOnly) className += ' text-only-btn';

        const btn = $.create('button', {
            className: className,
            attrs: { 'data-action': def.id },
            children: [ 
                $.createSmartIcon(def.icon, def.iconUrl, def.label),
                $.create('span', { className: 'lighthouse-label', text: def.label })
            ]
        });

        if (typeof def.dynamicLabel === 'function') {
            const res = def.dynamicLabel(ctx);
            if (res instanceof Promise) {
                res.then(val => { if (val) btn.querySelector('.lighthouse-label').textContent = val; });
            } else if (res) {
                btn.querySelector('.lighthouse-label').textContent = res;
            }
        }

        if (def.id === 'paste' && window.LighthouseState?.settings?.pastePreview) {
            tools.readClipboard().then(text => {
                if (text && text.trim().length > 0) {
                    const clean = text.replace(/\n/g, ' ').trim();
                    const display = clean.length > 20 ? clean.substring(0, 20) + '...' : clean;
                    btn.innerHTML = '';
                    btn.className = 'lighthouse-paste-btn';
                    btn.appendChild($.create('span', { text: `"${display}"` }));
                }
            });
        }

        btn.onmousedown = async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (def.keepOpen) actionActive = true;

            const res = await def.execute(ctx, tools);
            if (res && res.message) showToast(res.message, res.success ? 'success' : 'error');

            if (!def.keepOpen) {
                destroy();
                if (ctx.isForm) ctx.element.focus();
                else if (!ctx.isLink) window.getSelection().collapseToEnd();
            } else {
                if (ctx.isForm) ctx.text = ctx.element.value.substring(ctx.element.selectionStart, ctx.element.selectionEnd);
                else if (ctx.hasText) ctx.text = window.getSelection().toString();
                setTimeout(() => actionActive = false, 200);
            }
        };

        if (def.preview) {
            btn.classList.add('has-popover');
            btn.onmouseenter = () => {
                hoverTimeout = setTimeout(async () => {
                    removePopover();
                    
                    const cacheKey = `${def.id}:${ctx.text || ctx.url || ''}`;
                    let data = previewCache.get(cacheKey);
                    
                    if (!data) {
                        data = await def.preview(ctx, tools);
                        if (data) cacheSet(cacheKey, data);
                    }
                    
                    if (!btn.matches(':hover')) return;
                    if (!data) return;

                    const popover = $.create('div', { className: POPOVER_CLASS });

                    // Position using the same logic as the main tooltip
                    // Append to shadow root so it's not constrained by button dimensions
                    shadowRoot.appendChild(popover);
                    
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

                    if (data.prependItems) renderItems();

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
                        const cls = (data.type === 'text') ? 'lighthouse-preview' : '';
                        popover.appendChild($.create('div', { className: cls, html: data.content }));
                    }

                    if (!data.prependItems) renderItems();

                    // Use shared calculatePosition anchored to the button
                    requestAnimationFrame(() => {
                        popover.classList.add('visible');
                        requestAnimationFrame(() => {
                            const br = btn.getBoundingClientRect();
                            const pr = popover.getBoundingClientRect();
                            const pos = calculatePosition(br, pr.width, pr.height);
                            popover.style.position = 'fixed';
                            popover.style.top = `${pos.top}px`;
                            popover.style.left = `${pos.left}px`;
                            popover.style.bottom = 'auto';
                            // sync direction class with tooltip container
                            popover.classList.toggle('mode-bottom', pos.direction === 'bottom');
                        });
                    });
                }, 300);
            };
            btn.onmouseleave = () => { clearTimeout(hoverTimeout); removePopover(true); };
        }

        return btn;
    }

    // --- UNIFIED POSITIONING LOGIC ---
    function updatePosition(ctx) {
        if (!tooltipContainer || !ctx) return;

        let rect;
        if (ctx.isLink) {
            rect = ctx.element.getBoundingClientRect();
        } else if (ctx.isForm) {
            const elRect = ctx.element.getBoundingClientRect();
            if (ctx.hasText && ctx.relativePos) {
                const x = elRect.left + ctx.relativePos.x;
                const y = elRect.top + ctx.relativePos.y;
                rect = { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
            } else {
                rect = { left: elRect.left, top: elRect.top, right: elRect.right, bottom: elRect.bottom, width: elRect.width, height: elRect.height };
            }
        } else {
            const sel = window.getSelection() ||
                (document.activeElement?.shadowRoot?.getSelection?.());
            if (!sel || !sel.rangeCount) return destroy();
            rect = sel.getRangeAt(0).getBoundingClientRect();
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

        const TOOLTIP_H = tooltipContainer.offsetHeight || 48;
        const TOOLTIP_W = tooltipContainer.offsetWidth || 220;
        const VIEW_W = window.innerWidth;
        const VIEW_H = window.innerHeight;
        const MARGIN = 10;
        const GAP = 18;

        let left = Math.max((TOOLTIP_W / 2) + MARGIN, Math.min(anchorLeft, VIEW_W - (TOOLTIP_W / 2) - MARGIN));
        
        const idealTop = rect.top - TOOLTIP_H - GAP;
        const idealBottom = rect.bottom + GAP;
        
        let top, mode;

        if (idealTop >= MARGIN && idealTop <= VIEW_H - TOOLTIP_H - MARGIN) {
            top = idealTop;
            mode = 'top';
        } else if (idealBottom >= MARGIN && idealBottom <= VIEW_H - TOOLTIP_H - MARGIN) {
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

        requestAnimationFrame(() => {
            tooltipContainer.style.top = `${top}px`;
            tooltipContainer.style.left = `${left}px`;
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
        clearTimeout(hoverTimeout);
        clearTimeout(moreTimeout);
        removePopover(false);
        destroyCallbacks.forEach(cb => cb());
        if (tooltipContainer && tooltipContainer.classList.contains('visible')) {
            $.logEvent('UI', 'DESTROY', 'Tooltip Hidden');
            tooltipContainer.classList.remove('visible');
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
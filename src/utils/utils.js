(function() {
  class Logger {
    constructor() {
      this.prefix = '[Lighthouse]';
    }

    get isDebug() {
      if (window.LighthouseState && window.LighthouseState.settings) {
          return !!window.LighthouseState.get('debugMode', false);
      }
      return !!(window.LighthouseConfig && window.LighthouseConfig.defaults && window.LighthouseConfig.defaults.debugMode);
    }

    log(...args) {
      if (this.isDebug) console.log(this.prefix, ...args);
    }

    warn(...args) {
      if (this.isDebug) console.warn(this.prefix, ...args);
    }

    error(...args) {
      if (this.isDebug) console.error(this.prefix, ...args);
    }

    info(...args) {
      if (this.isDebug) console.info(this.prefix, ...args);
    }
  }

  const logger = new Logger();

  const safeImageUrl = (value) => {
    try { const u = new URL(value, location.href); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; }
    catch (e) { return ''; }
  };

  let tokenStyle = null;
  let languageNames = null;   // Intl.DisplayNames, made on first use
  window.LighthouseUtils = {
    Logger: logger,
    /**
     * The one media card (Wiki summaries, link previews), built as elements: text from pages and
     * services is set as text, never parsed as markup. The image must be an http(s) address.
     */
    mediaCard: ({ image, title, desc, body } = {}) => {
      const make = window.LighthouseUtils.create;
      const card = make('div', { className: 'lh-card' });
      const src = image ? safeImageUrl(image) : '';
      if (src) {
        const img = make('img', { attrs: { src, alt: '', referrerpolicy: 'no-referrer' } });
        img.addEventListener('error', () => img.parentElement && img.parentElement.remove());
        card.appendChild(make('div', { className: 'lh-card-media', children: [img] }));
      }
      if (title) card.appendChild(make('div', { className: 'lh-card-title', text: title }));
      if (desc) card.appendChild(make('div', { className: 'lh-card-desc', text: desc }));
      if (body) card.appendChild(make('div', { className: 'lh-card-body', text: body }));
      return card;
    },
    /**
     * DOM Creator Helper
     */
    create: (tag, { className = '', text, html, attrs = {}, events = {}, children = [], style = '' } = {}) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text) el.textContent = text;
      if (html) el.innerHTML = html;
      if (style) el.style.cssText = style;
      
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      Object.entries(events).forEach(([k, v]) => el.addEventListener(k, v));
      
      const kids = Array.isArray(children) ? children : [children];
      kids.forEach(child => {
        if (!child) return;
        if (child instanceof Node) el.appendChild(child);
        else if (typeof child === 'string') el.appendChild(document.createTextNode(child));
      });
      return el;
    },

    /**
     * Create Element from SVG String
     */
    getIconFromSvg: (svgString) => {
        const span = document.createElement('span');
        span.innerHTML = svgString || '';
        return span.firstElementChild || span;
    },

    /**
     * Smart Icon: Accepts Registry Key (e.g. 'copy') or SVG String or URL
     */
    createSmartIcon: (icon, url, name, findIcon = null) => {
        // 1. Registry Lookup (High Priority)
        if (icon && window.LighthouseIcons && window.LighthouseIcons[icon]) {
            return window.LighthouseUtils.getIconFromSvg(window.LighthouseIcons[icon]);
        }
        
        // 2. Direct SVG String
        if (icon && icon.trim().startsWith('<')) {
             return window.LighthouseUtils.getIconFromSvg(icon);
        }
        
        // 3. Favicon (for external links/search engines), else the link icon
        if (url) {
            try {
                const cleanUrl = url.replace('%s', 'test');
                new URL(cleanUrl);   // an invalid address falls through to the generic icon below

                // The icon element is swapped in place (button styles expect it as a direct child)
                let shown = document.createElement('img');
                shown.alt = name || icon || 'icon';
                const show = (el) => { if (shown.parentNode) shown.replaceWith(el); shown = el; };
                const showIcon = (dataUrl) => { const img = document.createElement('img'); img.alt = shown.alt || 'icon'; img.src = dataUrl; show(img); };
                // Without an icon, every site gets the same link icon: no per-language or per-domain rules
                const showGeneric = () => show(window.LighthouseUtils.createSmartIcon('link'));
                const ask = (iconUrl) => window.LighthouseUtils.message('FAVICON', { url: cleanUrl, iconUrl });
                // Chrome's own icon cache first (local, instant); when it has none, the link icon shows
                // at once, and the page's declared icon replaces it if one is found (link previews on)
                ask().then(async (res) => {
                    if (res && res.success) return showIcon(res.dataUrl);
                    showGeneric();
                    if (!findIcon || (res && res.none)) return;   // none: this site was already looked up
                    const iconUrl = await findIcon();
                    const found = iconUrl && await ask(iconUrl);
                    if (found && found.success) showIcon(found.dataUrl);
                });
                return shown;
            } catch (e) { /* Invalid URL */ }
        }
        
        // 4. Fallback Registry Key
        const globeSvg = window.LighthouseIcons && window.LighthouseIcons['search'] ? window.LighthouseIcons['search'] : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
        return window.LighthouseUtils.getIconFromSvg(globeSvg);
    },


    /**
     * Parse Open Graph tags from HTML string
     */
    /**
     * Link preview data from a page's <head>, read with the browser's own HTML parser.
     * The parsed document is inert: nothing in it runs or loads. Entities are decoded, and a
     * relative image address is resolved against the linked page, not the current one.
     */
    parsePreview: (html, baseUrl) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const meta = (...keys) => {
            for (const key of keys) {
                const el = doc.querySelector(`meta[property="${key}"], meta[name="${key}"]`);
                const value = el && el.getAttribute('content');
                if (value && value.trim()) return value.trim();
            }
            return '';
        };
        const title = meta('og:title', 'twitter:title') || (doc.querySelector('title')?.textContent || '').trim();
        let description = meta('og:description', 'twitter:description', 'description');
        if (description.length > 160) description = description.slice(0, 157).trimEnd() + '…';
        let image = meta('og:image:secure_url', 'og:image', 'twitter:image', 'twitter:image:src')
            || doc.querySelector('link[rel="image_src"]')?.getAttribute('href') || '';
        if (image) { try { image = new URL(image, baseUrl).href; } catch (e) { image = ''; } }
        // The page's icon: the one it declares, else the conventional /favicon.ico
        let icon = '';
        try { icon = new URL(doc.querySelector('link[rel~="icon" i]')?.getAttribute('href') || '/favicon.ico', baseUrl).href; } catch (e) { /* no icon */ }
        return { title, description, image, icon };
    },

    /**
     * Finds the one link in a selection, or null. Full http(s) and www. addresses are found
     * anywhere in the text; a bare domain (example.com) only when it is the whole selection,
     * since words like node.js or readme.md would otherwise look like domains.
     */
    findLink: (text) => {
        if (!text || text.length > 300) return null;
        const trim = (candidate) => {
            let link = candidate.replace(/^[\s"'“”«»‘’<(\[]+/, '');
            // Trailing punctuation belongs to the sentence, except a ")" that closes a "(" in the link
            while (/[.,;:!?"'”»’>\]]$/.test(link) || (link.endsWith(')') && (link.match(/\(/g) || []).length < (link.match(/\)/g) || []).length)) {
                link = link.slice(0, -1);
            }
            return link;
        };
        const full = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"]+/gi);
        if (full) {
            if (full.length !== 1) return null;
            const link = trim(full[0]);
            return /^https?:\/\//i.test(link) ? link : 'https://' + link;
        }
        const token = trim(text.trim());
        if (/\s/.test(token)) return null;
        const m = token.match(/^((?:[a-z0-9-]+\.)+)([a-z]{2,})(\/[^\s]*)?$/i);
        if (!m) return null;
        const tld = m[2].toLowerCase();
        const LONG_TLDS = ['info', 'shop', 'site', 'store', 'online', 'tech', 'blog', 'news', 'cloud', 'media', 'design', 'digital', 'agency', 'travel', 'world'];
        const FILE_TYPES = ['js', 'ts', 'md', 'py', 'rb', 'sh', 'go', 'rs', 'cs', 'php', 'css', 'txt', 'zip', 'rar', 'pdf', 'png', 'jpg', 'gif', 'svg', 'mp3', 'mp4', 'mov', 'exe', 'dll', 'bat', 'ini', 'log', 'csv', 'xls', 'doc', 'ppt', 'tar', 'gz', 'bak', 'tmp', 'dat', 'bin', 'img', 'iso', 'apk', 'jar', 'sql', 'db', 'yml', 'xml', 'json', 'html', 'htm', 'jsx', 'tsx', 'vue', 'java', 'lock', 'toml'];
        if (FILE_TYPES.includes(tld)) return null;
        if (tld.length > 3 && !LONG_TLDS.includes(tld)) return null;
        return 'https://' + token;
    },

    /** A link shown compactly: host without www, plus path, shortened. Full address stays in the title. */
    // A language's name in the bar's language (English). The script only when it isn't the language's
    // usual one ('zh-CN' -> 'Chinese', 'zh-TW' -> 'Traditional Chinese'); the region only when asked,
    // where it matters (spelling: 'en-GB' -> 'British English')
    languageName: (code, { region = false } = {}) => {
        try {
            let shown = code;
            if (!region) {
                const full = new Intl.Locale(code).maximize();
                const usual = new Intl.Locale(full.language).maximize().script;
                shown = full.script && full.script !== usual ? `${full.language}-${full.script}` : full.language;
            }
            return (languageNames ||= new Intl.DisplayNames(['en'], { type: 'language' })).of(shown) || null;
        } catch (e) { return null; }
    },

    displayLink: (url, max = 32) => {
        try {
            const u = new URL(url);
            let shown = u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
            return window.LighthouseUtils.shorten(shown, max);
        } catch (e) { return url; }
    },

    /** One drawing step per frame: draw(key, fn) replaces what's pending for key; cancel(key) drops it, so hiding always wins */
    frame: (() => {
        const pending = new Map();
        const flush = () => { const jobs = [...pending.values()]; pending.clear(); jobs.forEach(fn => fn()); };
        return {
            draw: (key, fn) => { if (!pending.size) requestAnimationFrame(flush); pending.set(key, fn); },
            cancel: (key) => pending.delete(key)
        };
    })(),

    shorten: (text, max) => text.length > max ? text.slice(0, max - 1) + '…' : text,

    /** The one way to ask the background worker: resolves with its response, or null on failure */
    message: (action, payload = {}) => new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ action, ...payload }, (res) => resolve(chrome.runtime.lastError ? null : (res || null)));
        } catch (e) { resolve(null); }
    }),

    /** Shared word / sentence segmenters (one instance each) */
    segmenter: (() => {
        const made = {};
        return (granularity = 'word') => made[granularity] || (made[granularity] = new Intl.Segmenter(undefined, { granularity }));
    })(),

    /** A design token as a number (px or ms), read from the tooltip's root or the page */
    token: (name, fallback = 0) => {
        const host = (window.LighthouseUI && window.LighthouseUI.shadowRoot && window.LighthouseUI.shadowRoot.host) || document.documentElement;
        if (!tokenStyle) { tokenStyle = getComputedStyle(host); requestAnimationFrame(() => { tokenStyle = null; }); }   // one style lookup per frame
        const raw = tokenStyle.getPropertyValue(name).trim();
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) return fallback;
        return /\ds$/.test(raw) && !/ms$/.test(raw) ? n * 1000 : n;
    },

    logEvent: (component, event, details = '') => {
        if (!logger.isDebug) return;

        const State = window.LighthouseState;
        const UI = window.LighthouseUI;
        const Handles = window.LighthouseHandles;

        const comp = component.toUpperCase().padEnd(8, ' ');
        const evt = event.toUpperCase().padEnd(10, ' ');

        console.groupCollapsed(`[Lighthouse] ${comp}| ${evt}| ${details}`);
        
        console.log({
            Mode: State?.mode,
            Context: State?.ctx ? { tag: State.ctx.element?.tagName, isInput: State.ctx.isInput } : 'N/A',
            UI: UI?.isVisible ? 'VISIBLE' : 'HIDDEN',
            Handles: Handles?.areVisible ? 'VISIBLE' : 'HIDDEN',
            Actions: State?.activeActions?.length || 0
        });
        
        console.groupEnd();
    }
  };
})();
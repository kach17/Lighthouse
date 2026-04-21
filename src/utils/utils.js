(function() {
  class Logger {
    constructor() {
      this.prefix = '[Lighthouse]';
    }

    get isDebug() {
      if (window.LighthouseState && window.LighthouseState.settings) {
          return !!window.LighthouseState.settings.debugMode;
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

  class EventManager {
    constructor() {
      this.listeners = new Map();
      this.isDestroyed = false;
    }

    add(element, event, handler, options) {
      if (this.isDestroyed) return;
      const key = `${element.constructor.name}-${event}`;
      if (!this.listeners.has(key)) this.listeners.set(key, []);
      const listenerInfo = { element, event, handler, options, id: Math.random().toString(36).substr(2, 9) };
      this.listeners.get(key).push(listenerInfo);
      element.addEventListener(event, handler, options);
      return listenerInfo.id;
    }

    remove(element, event, handler) {
      const key = `${element.constructor.name}-${event}`;
      const listeners = this.listeners.get(key);
      if (listeners) {
        const index = listeners.findIndex(l => l.handler === handler);
        if (index !== -1) {
          listeners.splice(index, 1);
          element.removeEventListener(event, handler);
          if (listeners.length === 0) this.listeners.delete(key);
        }
      }
    }

    destroy() {
      if (this.isDestroyed) return;
      for (const [key, listeners] of this.listeners) {
        listeners.forEach(({ element, event, handler }) => {
          try { element.removeEventListener(event, handler); } catch (e) { logger.warn('Failed to remove listener', e); }
        });
      }
      this.listeners.clear();
      this.isDestroyed = true;
    }
  }

  window.LighthouseUtils = {
    Logger: logger,
    EventManager: new EventManager(),
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
    createSmartIcon: (icon, url, name) => {
        // 1. Registry Lookup (High Priority)
        if (icon && window.LighthouseIcons && window.LighthouseIcons[icon]) {
            return window.LighthouseUtils.getIconFromSvg(window.LighthouseIcons[icon]);
        }
        
        // 2. Direct SVG String
        if (icon && icon.trim().startsWith('<')) {
             return window.LighthouseUtils.getIconFromSvg(icon);
        }
        
        // 3. Favicon Fetcher (for external links/search engines)
        if (url) {
            try {
                const cleanUrl = url.replace('%s', 'test'); 
                const domain = new URL(cleanUrl).hostname;
                const img = document.createElement('img');
                
                // Try Chrome Extension API first if available, otherwise use Google service
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
                    img.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(cleanUrl)}&size=32`;
                } else {
                    img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                }

                img.alt = name || icon || 'icon';
                
                // Fallback to Initial Letter on error
                img.onerror = () => { 
                    // If extension URL failed, try Google service as a secondary attempt
                    if (img.src.includes('chrome-extension') && !img.dataset.triedGoogle) {
                        img.dataset.triedGoogle = "true";
                        img.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                        return;
                    }

                    const displayDomain = domain.replace('www.', '');
                    const letter = (name && name !== 'Open' ? name.charAt(0) : displayDomain.charAt(0)).toUpperCase();
                    const avatar = document.createElement('div');
                    avatar.style.cssText = 'width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; background: #374151; color: #fff; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase;';
                    avatar.textContent = letter;
                    
                    if (img.parentNode) {
                        img.parentNode.replaceChild(avatar, img);
                    }
                };
                return img;
            } catch (e) { /* Invalid URL */ }
        }
        
        // 4. Fallback Registry Key
        const globeSvg = window.LighthouseIcons && window.LighthouseIcons['search'] ? window.LighthouseIcons['search'] : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
        return window.LighthouseUtils.getIconFromSvg(globeSvg);
    },

    /**
     * Get relative time string (e.g. "2 days ago")
     */
    getRelativeTime: (timestamp) => {
        const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
        const diff = (timestamp - Date.now()) / 1000;
        const absDiff = Math.abs(diff);

        if (absDiff < 60) return rtf.format(Math.round(diff), 'second');
        if (absDiff < 3600) return rtf.format(Math.round(diff / 60), 'minute');
        if (absDiff < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
        if (absDiff < 604800) return rtf.format(Math.round(diff / 86400), 'day');
        if (absDiff < 2592000) return rtf.format(Math.round(diff / 604800), 'week');
        if (absDiff < 31536000) return rtf.format(Math.round(diff / 2592000), 'month');
        return rtf.format(Math.round(diff / 31536000), 'year');
    },

    /**
     * Parse Open Graph tags from HTML string
     */
    parseOGTags: (html) => {
        const tags = {};
        const metaRegex = /<meta\s+[^>]*(?:property|name)=["']og:([^"']+)["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
        const metaRegexAlt = /<meta\s+[^+]*content=["']([^"']+)["'][^>]*?(?:property|name)=["']og:([^"']+)["'][^>]*>/gi;
        
        let match;
        while ((match = metaRegex.exec(html)) !== null) {
            tags[match[1].toLowerCase()] = match[2];
        }
        while ((match = metaRegexAlt.exec(html)) !== null) {
            tags[match[2].toLowerCase()] = match[1];
        }

        if (!tags.title) {
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) tags.title = titleMatch[1].trim();
        }
        if (!tags.description) {
            const descMatch = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i);
            if (descMatch) tags.description = descMatch[1].trim();
        }

        return tags;
    },

    detectTextLanguage: (text) => {
        const cleanText = text.replace(/[^\p{L}]/gu, '').toLowerCase();
        if (/[\u0400-\u04FF]/.test(cleanText)) return 'ru';
        if (/[äöüß]/.test(cleanText)) return 'de';
        if (/[àâäéèêëïîôöùûüÿç]/.test(cleanText)) return 'fr';
        if (/[ñáéíóúü]/.test(cleanText)) return 'es';
        if (/[àèéìíîòóù]/.test(cleanText)) return 'it';
        if (/[àáâãçéêíóôõú]/.test(cleanText)) return 'pt';
        if (/[\u4e00-\u9fff]/.test(cleanText)) return 'zh';
        if (/[\u3040-\u309f\u30a0-\u30ff]/.test(cleanText)) return 'ja';
        if (/[\uac00-\ud7af]/.test(cleanText)) return 'ko';
        if (/[\u0600-\u06ff]/.test(cleanText)) return 'ar';
        return 'en';
    },

    isForeign: (ctx) => {
        const SelLib = window.LighthouseSelection;
        if (!SelLib) return false;

        const sourceLang = SelLib.getLanguage ? SelLib.getLanguage(ctx) : 'en';
        const settings = (window.LighthouseState && window.LighthouseState.settings)
            ? window.LighthouseState.settings
            : (window.LighthouseConfig ? window.LighthouseConfig.defaults : {});
        const targetLang = settings.standards?.language || 'en';

        const src = (sourceLang || 'en').split('-')[0].toLowerCase();
        const tgt = (targetLang || 'en').split('-')[0].toLowerCase();

        if (src === tgt) {
            const textLang = window.LighthouseUtils.detectTextLanguage(ctx.text);
            return textLang !== tgt;
        }
        return src !== tgt;
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

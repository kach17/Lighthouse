/**
 * Lighthouse - Configuration
 * Generates default settings dynamically from the Master Action Definitions.
 */
(function(global) {
  
  // Depend on Actions being loaded first (for global.LighthouseActions)
  const actionsList = global.LighthouseActions || [];

  // The default language is the browser's own (a language the user reads, and where translations
  // should go), matched to the languages Lighthouse offers; English only as a last resort.
  const defaultLanguage = (() => {
    const offered = ((global.LighthouseData && global.LighthouseData.LANGUAGES) || []).map(code => code.toLowerCase());
    const browser = ((global.navigator && navigator.language) || 'en').toLowerCase();   // the first language the user reads, as everywhere else
    if (offered.includes(browser)) return browser;
    const base = global.LighthouseData.baseLanguage(browser);
    return offered.find(code => code === base || global.LighthouseData.baseLanguage(code) === base) || 'en';
  })();

  // Default Search Engines now reference the Registry Keys defined in modules/actions.js
  const DEFAULT_SEARCH_ENGINES = [
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', icon: 'google', enabled: true },
    { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s', icon: 'youtube', enabled: true },
    { id: 'maps', name: 'Maps', url: 'https://www.google.com/maps/search/%s', icon: 'maps', enabled: true },
    { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Special:Search?search=%s', icon: 'wikipedia', enabled: false },
    { id: 'reddit', name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s', icon: 'reddit', enabled: false }
  ];

  // Buttons a new bar starts without: of little use to most people, or (Spelling) sending what you write to a server
  const OFF_BY_DEFAULT = ['stack', 'spellcheck', 'math', 'json_format', 'base64_decode', 'color_convert'];
  // The order a new bar starts in; an action not listed (a new one) comes after
  const ORDER = ['copy', 'send', 'stack', 'search', 'translate', 'dictionary', 'wikipedia', 'speak', 'marker', 'expand', 'qr', 'cut', 'paste',
    'translate_to', 'delete', 'clear', 'spellcheck', 'math', 'currency', 'reminder', 'json_format', 'base64_decode', 'color_convert', 'unit', 'case'];
  const ids = actionsList.map(a => a.id);
  // Every setting, declared once: its default, and the values it can take (options), so every reader
  // gets the same default and an imported file can only set what exists, with a value of the right kind
  const SETTINGS = {
    smartSnapping:  { default: true },    // selections snap to whole words
    addDragHandles: { default: true },
    tidySpacing:    { default: true },    // fix spaces and punctuation when deleting, cutting or pasting
    showLabels:     { default: false },   // icon-only buttons: the strip names what's pointed at
    linkPreviews:   { default: false },   // opt-in: fetching the hovered page needs a permission the user grants
    brackets:       { default: 'wrap', options: ['off', 'wrap', 'close'] },   // wrap a selection; close: also auto-close
    highlightColor: { default: 'yellow', options: (global.LighthouseData && global.LighthouseData.HIGHLIGHT_COLORS) || ['yellow'] },   // the last color used
    themeMode:      { default: 'light', options: ['light', 'dark'] },
    customStyles:   { default: '' },      // the theme as CSS, as edited in Settings
    standards:      { default: { units: 'metric', currency: 'USD', language: defaultLanguage, writeLanguage: '' } },   // writeLanguage: Translate to's, '' until chosen
    order:          { default: [...ORDER.filter(id => ids.includes(id)), ...ids.filter(id => !ORDER.includes(id))] },
    enabled:        { default: Object.fromEntries(ids.map(id => [id, !OFF_BY_DEFAULT.includes(id)])) },
    searchEngines:  { default: DEFAULT_SEARCH_ENGINES },
    blacklist:      { default: [] },      // sites where Lighthouse is off
    shortcuts:      { default: [] }       // snippets: { trigger, expansion }
  };
  const kind = (v) => Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
  // Whether a value can be stored for a key: a known setting, a value of its kind, one of its options
  const valid = (key, value) => Object.hasOwn(SETTINGS, key) && kind(value) === kind(SETTINGS[key].default)
    && (!SETTINGS[key].options || SETTINGS[key].options.includes(value));

  global.LighthouseConfig = {
    actions: actionsList,
    settings: SETTINGS,
    defaults: Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, s.default])),
    // Only what can be stored: known settings with values of their kind (an imported file, for one);
    // an object setting gets the parts it leaves out from its default
    validOnly: (items) => Object.fromEntries(Object.entries(items || {}).filter(([k, v]) => valid(k, v))
      .map(([k, v]) => [k, kind(v) === 'object' ? { ...SETTINGS[k].default, ...v }
        : k === 'searchEngines' ? v.filter(e => e && /^https?:\/\//i.test(e.url)) : v]))   // an engine opens its address: web ones only (an import could hold javascript:)
  };
})(typeof self !== 'undefined' ? self : window);
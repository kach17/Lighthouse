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
    const browser = ((global.chrome && chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage())
      || (global.navigator && navigator.language) || 'en').toLowerCase();
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

  // Every setting, declared once: its default, and the values it can take (options), so every reader
  // gets the same default and an imported file can only set what exists, with a value of the right kind
  const SETTINGS = {
    smartSnapping:  { default: true },    // selections snap to whole words
    addDragHandles: { default: true },
    tidySpacing:    { default: true },    // fix spaces and punctuation when deleting, cutting or pasting
    showLabels:     { default: true },    // false: icon-only buttons
    linkPreviews:   { default: false },   // opt-in: fetching the hovered page needs a permission the user grants
    brackets:       { default: 'wrap', options: ['off', 'wrap', 'close'] },   // wrap a selection; close: also auto-close
    highlightColor: { default: 'yellow', options: (global.LighthouseData && global.LighthouseData.HIGHLIGHT_COLORS) || ['yellow'] },   // the last color used
    themeMode:      { default: 'light', options: ['light', 'dark'] },
    customStyles:   { default: '' },      // the theme as CSS, as edited in Settings
    standards:      { default: { units: 'metric', currency: 'USD', language: defaultLanguage } },
    order:          { default: actionsList.map(a => a.id) },
    enabled:        { default: Object.fromEntries(actionsList.map(a => [a.id, true])) },
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
      .map(([k, v]) => [k, kind(v) === 'object' ? { ...SETTINGS[k].default, ...v } : v]))
  };
})(typeof self !== 'undefined' ? self : window);
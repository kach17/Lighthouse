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
    const base = browser.split(/[-_]/)[0];
    return offered.find(code => code === base || code.split('-')[0] === base) || 'en';
  })();

  // Default Search Engines now reference the Registry Keys defined in modules/actions.js
  const DEFAULT_SEARCH_ENGINES = [
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', icon: 'google', enabled: true },
    { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s', icon: 'youtube', enabled: true },
    { id: 'maps', name: 'Maps', url: 'https://www.google.com/maps/search/%s', icon: 'maps', enabled: true },
    { id: 'wikipedia', name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Special:Search?search=%s', icon: 'wikipedia', enabled: false },
    { id: 'reddit', name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s', icon: 'reddit', enabled: false }
  ];

  global.LighthouseConfig = {
    actions: actionsList,
    defaults: {
      debugMode: false,
      smartSnapping: true,
      linkPreviews: false, // opt-in: fetching the hovered page needs a permission the user grants
      highlightColor: 'yellow', // the last color used
      tidySpacing: true,   // fix spaces and punctuation when deleting, cutting or pasting
      brackets: 'wrap',    // 'off' | 'wrap' (wrap a selection) | 'close' (also auto-close brackets)
      showLabels: true, // false = icon-only buttons, labels appear on hover
      addDragHandles: true,
      themeMode: 'light', // 'light' | 'dark'
      customStyles: '', // User Defined CSS Variables or Rules

      // New Standards Section
      standards: {
          units: 'metric', // 'metric' | 'imperial'
          currency: 'USD', // ISO Code
          language: defaultLanguage   // ISO code; defaults to the browser's language
      },

      order: actionsList.map(a => a.id),
      enabled: actionsList.reduce((acc, a) => {
        acc[a.id] = true;
        return acc;
      }, {}),
      searchEngines: DEFAULT_SEARCH_ENGINES,
      blacklist: [],
      
      // Text Expander Shortcuts
      shortcuts: []
    }
  };
})(typeof self !== 'undefined' ? self : window);
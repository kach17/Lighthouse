/**
 * Lighthouse - Configuration
 * Generates default settings dynamically from the Master Action Definitions.
 */
(function(global) {
  
  // Depend on Actions being loaded first (for global.LighthouseActions)
  const actionsList = global.LighthouseActions || [];

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
      addDragHandles: true,
      animationDuration: 200,
      tooltipOpacity: 1.0,
      themeMode: 'dark', // 'dark' | 'light'
      customStyles: '', // User Defined CSS Variables or Rules

      // New Standards Section
      standards: {
          units: 'metric', // 'metric' | 'imperial'
          currency: 'USD', // ISO Code
          language: 'en'   // ISO Code
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
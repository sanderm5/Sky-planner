// ========================================
// LOGGER UTILITY
// ========================================
const Logger = {
  isDev: () => {
    return window.location.hostname === 'localhost'
      || window.location.hostname === '127.0.0.1'
      || window.location.search.includes('debug=true');
  },
  log: function(...args) {
    if (this.isDev()) console.log('[DEBUG]', ...args);
  },
  warn: function(...args) {
    if (this.isDev()) console.warn('[WARN]', ...args);
  },
  error: console.error.bind(console, '[ERROR]')
};

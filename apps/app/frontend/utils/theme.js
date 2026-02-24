// ========================================
// THEME SYSTEM
// ========================================

// Initialize theme on page load
function initializeTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
}

// Toggle between light and dark theme
function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('theme', currentTheme);
  // Map style is handled by toggleNightMode() in map-core.js
}

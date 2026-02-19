// ========================================
// THEME SYSTEM
// ========================================

// Initialize theme on page load
function initializeTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateMapTilesForTheme(currentTheme);
}

// Toggle between light and dark theme
function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('theme', currentTheme);
  updateMapTilesForTheme(currentTheme);
}

// Update map tiles based on theme
function updateMapTilesForTheme(theme) {
  if (!map) return;

  const darkTiles = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const lightTiles = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

  // Find and update the current tile layer
  map.eachLayer(layer => {
    if (layer instanceof L.TileLayer) {
      const url = layer._url;
      // Only update CartoDB tiles, not satellite
      if (url && (url.includes('dark_all') || url.includes('light_all'))) {
        layer.setUrl(theme === 'dark' ? darkTiles : lightTiles);
      }
    }
  });
}

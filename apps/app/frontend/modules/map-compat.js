// ========================================
// MAP COMPATIBILITY LAYER
// Helper functions for Mapbox GL JS migration
// ========================================

// Convert [lat, lng] (Leaflet convention) to [lng, lat] (Mapbox GL JS convention)
function lngLat(lat, lng) {
  return [lng, lat];
}

// Create LngLatBounds from an array of customers with lat/lng properties
function boundsFromCustomers(customerArray) {
  const bounds = new mapboxgl.LngLatBounds();
  customerArray.forEach(c => {
    if (c.lat && c.lng) bounds.extend([c.lng, c.lat]);
  });
  return bounds;
}

// Create LngLatBounds from an array of [lat, lng] points (Leaflet convention)
function boundsFromLatLngArray(points) {
  const bounds = new mapboxgl.LngLatBounds();
  points.forEach(p => bounds.extend([p[1], p[0]]));
  return bounds;
}

// Create an HTML element for use as a Mapbox GL JS marker
function createMarkerElement(className, innerHTML, size) {
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = innerHTML;
  if (size) {
    el.style.width = size[0] + 'px';
    el.style.height = size[1] + 'px';
  }
  return el;
}

// Enable or disable all map interactions (replaces map.dragging.enable/disable pattern)
function setMapInteractive(enabled) {
  if (!map) return;
  const handlers = ['dragPan', 'scrollZoom', 'doubleClickZoom', 'touchZoomRotate', 'keyboard'];
  handlers.forEach(h => {
    if (map[h]) {
      if (enabled) map[h].enable();
      else map[h].disable();
    }
  });
}

// Safely remove a Mapbox GL JS layer and its source
function removeLayerAndSource(layerId) {
  if (!map) return;
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(layerId)) map.removeSource(layerId);
}

// Create a GeoJSON polygon from two corner points (for area selection)
function rectangleGeoJSON(corner1, corner2) {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [corner1.lng, corner1.lat],
        [corner2.lng, corner1.lat],
        [corner2.lng, corner2.lat],
        [corner1.lng, corner2.lat],
        [corner1.lng, corner1.lat]
      ]]
    }
  };
}

// Draw a route line from [lng, lat] coordinates array with custom styling
// Uses the shared 'route-line' source/layer from clearRoute()
function drawRouteGeoJSON(lngLatCoords, options = {}) {
  clearRoute();
  const geojson = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: lngLatCoords }
  };
  const paint = {
    'line-color': options.color || '#2563eb',
    'line-width': options.width || 6,
    'line-opacity': options.opacity || 0.9
  };
  if (options.dasharray) paint['line-dasharray'] = options.dasharray;

  map.addSource('route-line', { type: 'geojson', data: geojson });
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route-line',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint
  });
}

// Track the currently open popup for single-popup behavior
let currentPopup = null;

function showMapPopup(lngLatCoord, html, options = {}) {
  if (currentPopup) currentPopup.remove();
  currentPopup = new mapboxgl.Popup({
    maxWidth: options.maxWidth || '350px',
    offset: options.offset || [0, -35],
    closeButton: options.closeButton !== false
  })
    .setLngLat(lngLatCoord)
    .setHTML(html)
    .addTo(map);
  // Clear reference when user closes popup (X button or map click)
  currentPopup.on('close', () => { currentPopup = null; });
  return currentPopup;
}

function closeMapPopup() {
  if (currentPopup) {
    currentPopup.remove();
    currentPopup = null;
  }
}

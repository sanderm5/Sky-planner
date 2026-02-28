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


// CLUSTER MANAGER — Mapbox GL native clustering (GPU-rendered)
const CLUSTER_SOURCE = 'customer-clusters';
const CLUSTER_CIRCLE_LAYER = 'cluster-circles';
const CLUSTER_COUNT_LAYER = 'cluster-counts';
const CLUSTER_MAX_ZOOM = 11;
let clusterGeoJSONFeatures = [];
let _clusterSourceReady = false;
let supercluster = null; // Legacy reference (kept for compatibility with logging)
let clusterMarkers = new Map(); // HTML marker cache for individual cluster markers

function initClusterManager() {
  if (!map) { console.log('initClusterManager: no map'); return; }
  if (map.getSource(CLUSTER_SOURCE)) { console.log('initClusterManager: source exists, ready'); _clusterSourceReady = true; return; }
  // Style must be loaded before adding sources/layers.
  if (!map.isStyleLoaded()) {
    console.log('initClusterManager: style not loaded, deferring');
    map.once('style.load', () => initClusterManager());
    // Fallback: 'load' event fires after style + tiles are ready
    map.once('load', () => {
      if (!_clusterSourceReady) initClusterManager();
    });
    // Fallback: poll isStyleLoaded() in case events already fired
    let pollCount = 0;
    const pollInterval = setInterval(() => {
      pollCount++;
      if (_clusterSourceReady || pollCount > 50) {
        clearInterval(pollInterval);
        return;
      }
      if (map.isStyleLoaded()) {
        clearInterval(pollInterval);
        if (!_clusterSourceReady) initClusterManager();
      }
    }, 100);
    return;
  }
  console.log('initClusterManager: creating source and layers');
  try {
    map.addSource(CLUSTER_SOURCE, {
      type: 'geojson', data: { type: 'FeatureCollection', features: [] },
      cluster: true, clusterMaxZoom: CLUSTER_MAX_ZOOM,
      clusterRadius: appConfig?.mapClusterRadius || 50,
      clusterProperties: {
        'cluster_name': [
          ['case', ['==', ['accumulated'], ''], ['get', 'cluster_name'], ['accumulated']],
          ['get', 'poststed']
        ]
      }
    });
    map.addLayer({ id: CLUSTER_CIRCLE_LAYER, type: 'circle', source: CLUSTER_SOURCE,
      filter: ['has', 'point_count'],
      paint: { 'circle-color': 'rgba(30,30,30,0.85)',
        'circle-radius': ['step',['get','point_count'],30,20,34,50,40],
        'circle-stroke-width': 2, 'circle-stroke-color': 'rgba(94,129,172,0.6)' }
    });
    map.addLayer({ id: CLUSTER_COUNT_LAYER, type: 'symbol', source: CLUSTER_SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['case',
          ['!=', ['get', 'cluster_name'], ''],
          ['format',
            ['get', 'point_count_abbreviated'], { 'font-scale': 1.1, 'text-font': ['literal', ['DIN Pro Bold','Arial Unicode MS Bold']] },
            '\n', {},
            ['case',
              ['>', ['length', ['get', 'cluster_name']], 10],
              ['concat', ['slice', ['get', 'cluster_name'], 0, 9], '…'],
              ['get', 'cluster_name']
            ], { 'font-scale': 0.65, 'text-font': ['literal', ['DIN Pro Medium','Arial Unicode MS Regular']] }
          ],
          ['format',
            ['get', 'point_count_abbreviated'], { 'font-scale': 1.0, 'text-font': ['literal', ['DIN Pro Bold','Arial Unicode MS Bold']] }
          ]
        ],
        'text-size': ['step',['get','point_count'],13,20,12,50,11],
        'text-allow-overlap': true,
        'text-line-height': 1.3
      },
      paint: { 'text-color': '#ffffff' }
    });
    map.on('click', CLUSTER_CIRCLE_LAYER, onClusterClick);
    map.on('mouseenter', CLUSTER_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', CLUSTER_CIRCLE_LAYER, () => { map.getCanvas().style.cursor = ''; });
    map.on('sourcedata', (e) => {
      if (e.sourceId === CLUSTER_SOURCE && e.isSourceLoaded && map.getZoom() <= CLUSTER_MAX_ZOOM) {
        updateClusters();
      }
    });
    _clusterSourceReady = true;
    console.log('initClusterManager: ready, source created');
    // If customers were loaded while we waited for style, render them now
    if (typeof customers !== 'undefined' && customers.length > 0 && typeof applyFilters === 'function') {
      console.log('initClusterManager: triggering applyFilters for', customers.length, 'customers');
      applyFilters();
    }
  } catch (err) {
    console.error('initClusterManager failed:', err);
    // Retry after style is loaded (event + polling fallback)
    map.once('style.load', () => initClusterManager());
    let pollCount = 0;
    const pollInterval = setInterval(() => {
      pollCount++;
      if (_clusterSourceReady || pollCount > 50) {
        clearInterval(pollInterval);
        return;
      }
      if (map.isStyleLoaded()) {
        clearInterval(pollInterval);
        if (!_clusterSourceReady) initClusterManager();
      }
    }, 100);
  }
}

function loadClusterData(customerData) {
  clusterGeoJSONFeatures = customerData.filter(c => c.lat && c.lng).map(c => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
    properties: { customerId: c.id, poststed: c.poststed || '' }
  }));
  const src = map && map.getSource(CLUSTER_SOURCE);
  if (src) src.setData({ type: 'FeatureCollection', features: clusterGeoJSONFeatures });
}

function updateClusters() {
  if (!map || !_clusterSourceReady) return;
  const zoom = map.getZoom();
  const bounds = map.getBounds();

  if (zoom > CLUSTER_MAX_ZOOM) {
    // Above cluster threshold: hide native cluster layers, show all individual markers
    setClusterLayerVisibility(false);
    for (const cid of Object.keys(markers)) {
      const m = markers[cid], c = customers.find(x => x.id === parseInt(cid));
      if (c && c.lat && c.lng) {
        const inView = bounds.contains([c.lng, c.lat]);
        if (inView && !m._addedToMap) { m.addTo(map); m._addedToMap = true; }
        else if (!inView && m._addedToMap) { m.remove(); m._addedToMap = false; }
      }
    }
  } else {
    // At or below cluster threshold: show cluster layers for grouped points,
    // and show individual DOM markers for unclustered (standalone) points
    setClusterLayerVisibility(true);

    // Query which customer IDs are NOT in any cluster
    const unclustered = new Set();
    try {
      const sf = map.querySourceFeatures(CLUSTER_SOURCE, {
        filter: ['!', ['has', 'point_count']]
      });
      for (const f of sf) {
        if (f.properties?.customerId) unclustered.add(f.properties.customerId);
      }
    } catch (e) { /* source tiles not ready yet — sourcedata event will retry */ }

    for (const cid of Object.keys(markers)) {
      const id = parseInt(cid), mk = markers[cid];
      if (unclustered.has(id)) {
        if (!mk._addedToMap) { mk.addTo(map); mk._addedToMap = true; }
      } else {
        if (mk._addedToMap) { mk.remove(); mk._addedToMap = false; }
      }
    }
  }
}

function setClusterLayerVisibility(visible) {
  if (!map) return;
  const vis = visible ? 'visible' : 'none';
  [CLUSTER_CIRCLE_LAYER, CLUSTER_COUNT_LAYER].forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  });
}

function onClusterClick(e) {
  const feats = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_CIRCLE_LAYER] });
  if (!feats.length) return;
  const clusterId = feats[0].properties.cluster_id;
  const coords = feats[0].geometry.coordinates.slice();
  const src = map.getSource(CLUSTER_SOURCE);
  src.getClusterLeaves(clusterId, Infinity, 0, (err, leaves) => {
    if (err || !leaves || !leaves.length) {
      src.getClusterExpansionZoom(clusterId, (e2, z) => {
        if (!e2) map.easeTo({ center: coords, zoom: Math.min((z||10)+1,15), duration: 500 });
      });
      return;
    }
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const l of leaves) {
      const [a, b] = l.geometry.coordinates;
      if (a < minLng) minLng = a; if (a > maxLng) maxLng = a;
      if (b < minLat) minLat = b; if (b > maxLat) maxLat = b;
    }
    if ((maxLng - minLng) < 0.0001 && (maxLat - minLat) < 0.0001) {
      const ids = leaves.map(f => f.properties.customerId);
      const cc = ids.map(id => customers.find(c => c.id === id)).filter(Boolean);
      showMapPopup(coords, generateClusterPopupContent(cc), { maxWidth: '320px', offset: [0, 0] });
      return;
    }
    src.getClusterExpansionZoom(clusterId, (e2, ez) => {
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
        padding: 80, duration: 600, maxZoom: Math.min((ez || 10) + 1, 15)
      });
    });
  });
}

function generateClusterPopupContent(clusterCustomers) {
  const list = clusterCustomers.slice(0, 10).map(c => {
    const status = getControlStatus(c);
    return `<div class="cluster-popup-item" onclick="focusOnCustomer(${c.id})" style="cursor:pointer;padding:4px 0;border-bottom:1px solid var(--color-border);">
      <span class="popup-status ${status.class}" style="display:inline-block;width:8px;height:8px;border-radius:50;margin-right:6px;"></span>
      <strong>${escapeHtml(c.navn)}</strong>
      ${c.poststed ? `<span style="color:var(--color-text-secondary);font-size:12px;"> — ${escapeHtml(c.poststed)}</span>` : ''}
    </div>`;
  }).join('');
  const moreText = clusterCustomers.length > 10
    ? `<div style="padding:4px 0;color:var(--color-text-secondary);font-size:12px;">+${clusterCustomers.length - 10} flere...</div>`
    : '';
  return `<div class="cluster-popup">
    <div style="font-weight:600;margin-bottom:8px;">${clusterCustomers.length} kunder</div>
    ${list}
    ${moreText}
  </div>`;
}

function clearAllClusters() {
  _clusterSourceReady = false;
  clusterGeoJSONFeatures = [];
  if (!map) return;
  [CLUSTER_COUNT_LAYER, CLUSTER_CIRCLE_LAYER].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
  if (map.getSource(CLUSTER_SOURCE)) map.removeSource(CLUSTER_SOURCE);
}

function refreshClusters() {
  if (!map || !_clusterSourceReady) return;
  const src = map.getSource(CLUSTER_SOURCE);
  if (src && clusterGeoJSONFeatures.length > 0) {
    src.setData({ type: 'FeatureCollection', features: clusterGeoJSONFeatures });
  }
  updateClusters();
}

function readdClusterLayers() {
  if (!map) return;
  _clusterSourceReady = false;
  // Remove old event listeners to prevent duplicates
  map.off('click', CLUSTER_CIRCLE_LAYER, onClusterClick);
  [CLUSTER_COUNT_LAYER, CLUSTER_CIRCLE_LAYER].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
  if (map.getSource(CLUSTER_SOURCE)) map.removeSource(CLUSTER_SOURCE);
  initClusterManager();
  // initClusterManager may defer if style isn't loaded yet —
  // in that case _clusterSourceReady will be set when the callback fires,
  // and it will call applyFilters() to trigger renderMarkers.
  if (_clusterSourceReady && clusterGeoJSONFeatures.length > 0) {
    const src = map.getSource(CLUSTER_SOURCE);
    if (src) src.setData({ type: 'FeatureCollection', features: clusterGeoJSONFeatures });
  }
  if (_clusterSourceReady) updateClusters();
}

// Wait for cluster source to be ready (returns a promise)
function waitForClusterReady(timeoutMs) {
  if (_clusterSourceReady) return Promise.resolve(true);
  return new Promise(function(resolve) {
    var elapsed = 0;
    var interval = setInterval(function() {
      elapsed += 50;
      if (_clusterSourceReady) {
        clearInterval(interval);
        resolve(true);
      } else if (elapsed >= (timeoutMs || 8000)) {
        clearInterval(interval);
        console.warn('waitForClusterReady: timed out after', elapsed, 'ms');
        resolve(false);
      }
    }, 50);
  });
}


// ========================================
// MAPBOX MATRIX SERVICE
// Beregn kjøretider mellom punkter
// ========================================

const MatrixService = {
  cache: new Map(),

  /**
   * Fetch travel time matrix for a list of coordinates
   * @param {Array<[number,number]>} coords - Array of [lng, lat]
   * @param {Object} options - { profile, sources, destinations, depart_at }
   * @returns {Promise<{durations: number[][], distances: number[][]}|null>}
   */
  async getMatrix(coords, options = {}) {
    if (!coords || coords.length < 2) return null;

    // Enforce Mapbox limit of 25 coordinates
    if (coords.length > 25) {
      Logger.log('[MatrixService] Max 25 koordinater, trunkerer');
      coords = coords.slice(0, 25);
    }

    // Build cache key
    const cacheKey = JSON.stringify({ c: coords.map(c => [+c[0].toFixed(4), +c[1].toFixed(4)]), ...options });
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const response = await apiFetch('/api/routes/matrix', {
        method: 'POST',
        body: JSON.stringify({
          coordinates: coords,
          profile: options.profile || 'driving',
          ...(options.sources !== undefined && { sources: options.sources }),
          ...(options.destinations !== undefined && { destinations: options.destinations }),
          ...(options.depart_at && { depart_at: options.depart_at }),
        })
      });

      if (!response.ok) return null;

      const result = await response.json();
      const data = result.data || result;

      const matrixResult = {
        durations: data.durations,
        distances: data.distances,
      };

      // Cache result (expire after 5 minutes)
      this.cache.set(cacheKey, matrixResult);
      setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);

      return matrixResult;
    } catch (err) {
      Logger.log('[MatrixService] Feil:', err);
      return null;
    }
  },

  /**
   * Get sequential travel times for an ordered list of stops
   * @param {Array<[number,number]>} coords - Ordered [lng, lat] coordinates
   * @returns {Promise<Array<{durationSec: number, distanceM: number}>>}
   */
  async getSequentialTimes(coords) {
    if (coords.length < 2) return [];

    const matrix = await this.getMatrix(coords);
    if (!matrix || !matrix.durations) return [];

    const times = [];
    for (let i = 0; i < coords.length - 1; i++) {
      times.push({
        durationSec: matrix.durations[i]?.[i + 1] || 0,
        distanceM: matrix.distances?.[i]?.[i + 1] || 0,
      });
    }
    return times;
  },

  clearCache() {
    this.cache.clear();
  }
};


// ========================================
// HTML & JS ESCAPE UTILITIES
// XSS protection - used in all template literals
// ========================================

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escape a string for safe use inside JavaScript string literals in inline event handlers.
 * Use this instead of escapeHtml() when embedding values in onclick/onchange attributes.
 * Example: onclick="fn('${escapeJsString(userInput)}')"
 */
function escapeJsString(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\//g, '\\/');
}


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


// ========================================
// CSRF TOKEN HELPER
// Gets CSRF token from cookie for API requests
// ========================================
function getCsrfToken() {
  const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}


// ========================================
// FOCUS TRAP - Tilgjengelighet for modaler
// Fanger Tab-navigasjon innenfor en container
// og returnerer fokus til utløser-element ved lukking
// ========================================

const FocusTrap = {
  _previouslyFocused: null,

  _getFocusable(container) {
    return [...container.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(el => el.offsetParent !== null);
  },

  activate(containerEl) {
    this._previouslyFocused = document.activeElement;

    const focusable = this._getFocusable(containerEl);
    if (focusable.length > 0) {
      setTimeout(() => focusable[0].focus(), 50);
    }

    containerEl._trapHandler = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = this._getFocusable(containerEl);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    containerEl.addEventListener('keydown', containerEl._trapHandler);
  },

  deactivate(containerEl) {
    if (containerEl && containerEl._trapHandler) {
      containerEl.removeEventListener('keydown', containerEl._trapHandler);
      delete containerEl._trapHandler;
    }
    if (this._previouslyFocused && this._previouslyFocused.focus) {
      this._previouslyFocused.focus();
      this._previouslyFocused = null;
    }
  }
};


// ========================================
// MODAL SYSTEM - Laila-vennlige dialoger
// Erstatter alert() og confirm() med store,
// lettleste norske dialoger
// ========================================

const ModalSystem = {
  container: null,

  init() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.id = 'modal-system-container';
    this.container.innerHTML = `
      <div class="modal-system-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-system-title" style="
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        z-index: 100000;
        justify-content: center;
        align-items: center;
        padding: 20px;
      ">
        <div class="modal-system-dialog" style="
          background: var(--color-bg-secondary, #1a1a1a);
          border-radius: 16px;
          max-width: 480px;
          width: 100%;
          padding: 32px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          border: 1px solid var(--color-border, #333);
        ">
          <div class="modal-system-icon" style="
            text-align: center;
            margin-bottom: 20px;
            font-size: 48px;
          "></div>
          <h2 class="modal-system-title" id="modal-system-title" style="
            font-size: 22px;
            font-weight: 600;
            color: var(--color-text-primary, #fff);
            margin: 0 0 16px 0;
            text-align: center;
            line-height: 1.4;
          "></h2>
          <p class="modal-system-message" style="
            font-size: 18px;
            color: var(--color-text-secondary, #a0a0a0);
            margin: 0 0 28px 0;
            text-align: center;
            line-height: 1.6;
          "></p>
          <div class="modal-system-buttons" style="
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
          "></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.container);
  },

  show(options) {
    this.init();
    const overlay = this.container.querySelector('.modal-system-overlay');
    const iconEl = this.container.querySelector('.modal-system-icon');
    const titleEl = this.container.querySelector('.modal-system-title');
    const messageEl = this.container.querySelector('.modal-system-message');
    const buttonsEl = this.container.querySelector('.modal-system-buttons');

    // Set icon based on type
    const icons = {
      success: '<span style="color: #4CAF50;">&#10004;</span>',
      error: '<span style="color: #DC2626;">&#10006;</span>',
      warning: '<span style="color: #FFC107;">&#9888;</span>',
      info: '<span style="color: #42A5F5;">&#8505;</span>',
      confirm: '<span style="color: #5E81AC;">&#63;</span>'
    };
    iconEl.innerHTML = icons[options.type] || icons.info;

    // Set title
    titleEl.textContent = options.title || '';
    titleEl.style.display = options.title ? 'block' : 'none';

    // Set message
    messageEl.textContent = options.message || '';

    // Create buttons
    buttonsEl.innerHTML = '';
    const buttonStyle = `
      min-height: 52px;
      padding: 14px 28px;
      font-size: 18px;
      font-weight: 600;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
      min-width: 120px;
    `;

    if (options.buttons) {
      options.buttons.forEach((btn, index) => {
        const button = document.createElement('button');
        button.textContent = btn.text;
        button.style.cssText = buttonStyle;

        if (btn.primary) {
          button.style.background = 'var(--color-accent, #5E81AC)';
          button.style.color = '#fff';
        } else {
          button.style.background = 'var(--color-bg-tertiary, #252525)';
          button.style.color = 'var(--color-text-primary, #fff)';
          button.style.border = '1px solid var(--color-border, #333)';
        }

        button.onclick = () => {
          this.hide();
          if (btn.onClick) btn.onClick();
        };

        // Focus first button for keyboard users
        if (index === 0) {
          setTimeout(() => button.focus(), 100);
        }

        buttonsEl.appendChild(button);
      });
    }

    // Show with animation
    overlay.style.display = 'flex';
    overlay.style.opacity = '0';
    requestAnimationFrame(() => {
      overlay.style.transition = 'opacity 0.2s';
      overlay.style.opacity = '1';
    });

    // Activate focus trap for accessibility
    const dialog = this.container.querySelector('.modal-system-dialog');
    if (dialog && typeof FocusTrap !== 'undefined') {
      FocusTrap.activate(dialog);
    }

    // Close on escape key (store reference for cleanup in hide())
    this._escHandler = (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    };
    document.addEventListener('keydown', this._escHandler);
  },

  hide() {
    // Deactivate focus trap and return focus
    const dialog = this.container?.querySelector('.modal-system-dialog');
    if (dialog && typeof FocusTrap !== 'undefined') {
      FocusTrap.deactivate(dialog);
    }
    // Clean up escape key listener to prevent memory leaks
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
    const overlay = this.container?.querySelector('.modal-system-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.style.display = 'none';
      }, 200);
    }
  }
};

// Vennlig melding (erstatter alert)
function showMessage(message, type = 'info', title = '') {
  const titles = {
    success: 'Fullfort',
    error: 'Feil',
    warning: 'Advarsel',
    info: 'Informasjon'
  };

  ModalSystem.show({
    type: type,
    title: title || titles[type] || '',
    message: message,
    buttons: [
      { text: 'OK', primary: true }
    ]
  });
}

// Vennlig bekreftelse (erstatter confirm) - returnerer Promise
function showConfirm(message, title = 'Bekreft') {
  return new Promise((resolve) => {
    ModalSystem.show({
      type: 'confirm',
      title: title,
      message: message,
      buttons: [
        {
          text: 'Nei',
          primary: false,
          onClick: () => resolve(false)
        },
        {
          text: 'Ja',
          primary: true,
          onClick: () => resolve(true)
        }
      ]
    });
  });
}

// Toast notification
function showToast(message, type = 'info', duration = 3000) {
  // Remove existing toast
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `
    <i aria-hidden="true" class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  // Remove after duration (0 = persistent, caller must remove manually)
  if (duration > 0) {
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  return toast;
}


// ========================================
// PREMIUM SVG ICONS FOR INDUSTRIES
// ========================================
/**
 * Premium SVG icons for map markers
 * Each icon is optimized for 42px display with 2px strokes
 * Uses currentColor for white on colored backgrounds
 */
const svgIcons = {
  // El-Kontroll - Lightning bolt with energy
  'el-kontroll': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
  </svg>`,

  // Brannvarsling - Elegant flame
  'brannvarsling': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/>
  </svg>`,

  // Borettslag/Sameie - Building with units
  'borettslag-sameie': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2"/>
    <path d="M9 22v-4h6v4"/>
    <path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01"/>
  </svg>`,

  // Renhold - Sparkle/clean
  'renhold': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3v5m0 8v5M5.5 8.5l3.5 3.5m6 0l3.5-3.5M3 12h5m8 0h5"/>
    <circle cx="12" cy="12" r="2"/>
  </svg>`,

  // Vaktmester - Gear/wrench combo
  'vaktmester': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>`,

  // HVAC/Ventilasjon - Fan with airflow
  'hvac-ventilasjon': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 9a9.5 9.5 0 005-7"/>
    <path d="M15 12a9.5 9.5 0 007 5"/>
    <path d="M12 15a9.5 9.5 0 00-5 7"/>
    <path d="M9 12a9.5 9.5 0 00-7-5"/>
  </svg>`,

  // Heis/Løfteutstyr - Elevator with arrows
  'heis-lofteutstyr': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2"/>
    <path d="M9 8l3-3 3 3"/>
    <path d="M9 16l3 3 3-3"/>
    <line x1="12" y1="5" x2="12" y2="19"/>
  </svg>`,

  // Sikkerhet/Vakt - Shield with checkmark
  'sikkerhet-vakt': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <path d="M9 12l2 2 4-4"/>
  </svg>`,

  // Skadedyrkontroll - Bug with strike
  'skadedyrkontroll': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 2l1.88 1.88"/>
    <path d="M14.12 3.88L16 2"/>
    <path d="M9 7.13v-1a3.003 3.003 0 116 0v1"/>
    <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6"/>
    <path d="M12 20v-9"/>
    <path d="M6.53 9C4.6 8.8 3 7.1 3 5"/>
    <path d="M6 13H2"/>
    <path d="M3 21c0-2.1 1.7-3.9 3.8-4"/>
    <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/>
    <path d="M22 13h-4"/>
    <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>
  </svg>`,

  // VVS/Rørlegger - Pipe with droplet
  'vvs-rorlegger': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14 6a4 4 0 01-4-4"/>
    <path d="M6 6a4 4 0 014-4"/>
    <path d="M6 6v6a6 6 0 0012 0V6"/>
    <path d="M12 16v4"/>
    <path d="M8 20h8"/>
    <path d="M12 12a2 2 0 100-4 2 2 0 000 4z"/>
  </svg>`,

  // Takservice - House with roof emphasis
  'takservice': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 12l9-9 9 9"/>
    <path d="M5 10v10a1 1 0 001 1h12a1 1 0 001-1V10"/>
    <path d="M9 21v-6a2 2 0 012-2h2a2 2 0 012 2v6"/>
  </svg>`,

  // Hagearbeid - Stylized leaf
  'hagearbeid': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 20A7 7 0 019.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  </svg>`,

  // IT-Service - Monitor with code
  'it-service': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
    <path d="M8 9l-2 2 2 2"/>
    <path d="M16 9l2 2-2 2"/>
  </svg>`,

  // Vinduspuss - Window with sparkle
  'vinduspuss': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="12" y1="3" x2="12" y2="21"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
    <path d="M18 6l-3 3"/>
    <path d="M16.5 4.5l1 1"/>
  </svg>`,

  // Avfallshåndtering - Recycle arrows
  'avfallshandtering': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 19H4.815a1.83 1.83 0 01-1.57-.881 1.785 1.785 0 01-.004-1.784L7.196 9.5"/>
    <path d="M11 19h8.203a1.83 1.83 0 001.556-.89 1.784 1.784 0 00-.004-1.775L16.8 9.5"/>
    <path d="M9.5 6.5l1.474-2.381A1.829 1.829 0 0112.54 3a1.78 1.78 0 011.578.885L17 9.5"/>
    <path d="M2.5 14.5L5 12l2.5 2.5"/>
    <path d="M16.5 12L19 14.5 21.5 12"/>
    <path d="M14 6l-2-3.5L10 6"/>
  </svg>`,

  // Vedlikehold Bygg - Hammer
  'vedlikehold-bygg': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 12l-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 010-3L12 9"/>
    <path d="M17.64 15L22 10.64"/>
    <path d="M20.91 11.7l-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 00-3.94-1.64H9l.92.82A6.18 6.18 0 0112 8.4v1.56l2 2h2.47l2.26 1.91"/>
  </svg>`,

  // Serviceavtaler - Handshake
  'serviceavtaler-generell': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 17a4 4 0 01-8 0v-3a3 3 0 013-3h2"/>
    <path d="M13 17a4 4 0 008 0v-3a3 3 0 00-3-3h-2"/>
    <path d="M11.5 11L9 8.5 11 7l5 4.5"/>
    <path d="M17 8l-5.5 5.5"/>
    <path d="M6 10l1 3"/>
    <path d="M18 10l-1 3"/>
  </svg>`,

  // Generisk service - Wrench (skiftenøkkel)
  'service': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
  </svg>`
};

// ========================================
// PREMIUM COLOR PALETTES FOR INDUSTRIES
// ========================================
/**
 * Premium 3-color gradients for each industry
 * Each palette has: light (highlight), primary, dark (shadow)
 */
const industryPalettes = {
  'el-kontroll':         { light: '#FBBF24', primary: '#F59E0B', dark: '#D97706' },
  'brannvarsling':       { light: '#EF4444', primary: '#DC2626', dark: '#B91C1C' },
  'borettslag-sameie':   { light: '#60A5FA', primary: '#3B82F6', dark: '#2563EB' },
  'renhold':             { light: '#22D3EE', primary: '#06B6D4', dark: '#0891B2' },
  'vaktmester':          { light: '#FCD34D', primary: '#F59E0B', dark: '#D97706' },
  'hvac-ventilasjon':    { light: '#38BDF8', primary: '#0EA5E9', dark: '#0284C7' },
  'heis-lofteutstyr':    { light: '#818CF8', primary: '#6366F1', dark: '#4F46E5' },
  'sikkerhet-vakt':      { light: '#3B82F6', primary: '#1E40AF', dark: '#1E3A8A' },
  'skadedyrkontroll':    { light: '#A3E635', primary: '#84CC16', dark: '#65A30D' },
  'vvs-rorlegger':       { light: '#22D3EE', primary: '#0891B2', dark: '#0E7490' },
  'takservice':          { light: '#A8A29E', primary: '#78716C', dark: '#57534E' },
  'hagearbeid':          { light: '#4ADE80', primary: '#22C55E', dark: '#16A34A' },
  'it-service':          { light: '#A78BFA', primary: '#8B5CF6', dark: '#7C3AED' },
  'vinduspuss':          { light: '#7DD3FC', primary: '#38BDF8', dark: '#0EA5E9' },
  'avfallshandtering':   { light: '#4ADE80', primary: '#16A34A', dark: '#15803D' },
  'vedlikehold-bygg':    { light: '#B45309', primary: '#92400E', dark: '#78350F' },
  'serviceavtaler-generell': { light: '#C4B5FD', primary: '#A855F7', dark: '#9333EA' },
  'service':                 { light: '#60A5FA', primary: '#3B82F6', dark: '#2563EB' }
};


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


// ========================================
// SORTING UTILITIES
// ========================================

// Sort array of objects by 'navn' property using Norwegian locale
function sortByNavn(arr) {
  return arr.sort((a, b) => a.navn.localeCompare(b.navn, 'nb'));
}

// Sort strings using Norwegian locale
function compareNorwegian(a, b) {
  return a.localeCompare(b, 'nb');
}


// ========================================
// FEATURE MODULE SYSTEM
// Granular per-organization feature flags
// Replaces binary app_mode (mvp/full)
// ========================================

/**
 * Check if a specific feature module is enabled for this organization.
 * Features are loaded from the server config endpoint.
 */
function hasFeature(key) {
  return appConfig.enabledFeatures?.includes(key) ?? false;
}

/**
 * Get the configuration for a specific feature module.
 * Returns empty object if feature has no config or is not enabled.
 */
function getFeatureConfig(key) {
  return appConfig.featureConfigs?.[key] ?? {};
}

// Backwards-compatible helpers (used by existing code)
// These use the explicit app_mode set per organization in the database
function isFullMode() {
  // Primary check: explicit app mode set per organization
  if (appConfig.appMode) {
    return appConfig.appMode === 'full';
  }
  // Legacy fallback
  return localStorage.getItem('appMode') === 'full';
}

function isMvpMode() {
  return !isFullMode();
}

/**
 * Apply feature-based UI changes - hide/show elements based on enabled features.
 * Called after DOM is ready and on config changes.
 * Replaces the old binary MVP/full mode with granular feature checks.
 */
function applyMvpModeUI() {
  const isMvp = isMvpMode();

  // Elements to hide when industry-specific features are not enabled
  // Note: categoryFilterButtons is NOT hidden here — categories are shown for all companies
  const mvpHiddenElements = [
    document.getElementById('elTypeFilter'),
    document.getElementById('driftskategoriFilter'),
    document.getElementById('brannsystemFilter'),
    document.querySelector('.color-legend'),
    document.getElementById('dynamicFieldFilters'),
  ];

  mvpHiddenElements.forEach(el => {
    if (el) {
      el.style.display = isMvp ? 'none' : '';
    }
  });

  const filterHeader = document.querySelector('.filter-panel-header h3');
  if (filterHeader) {
    filterHeader.innerHTML = isMvp
      ? '<i aria-hidden="true" class="fas fa-users"></i> Kunder'
      : '<i aria-hidden="true" class="fas fa-filter"></i> Kunder';
  }

  Logger.log(`Feature mode UI applied: ${isMvp ? 'MVP (simplified)' : 'Full (features enabled)'}`);
  if (appConfig.enabledFeatures?.length) {
    Logger.log('Enabled features:', appConfig.enabledFeatures.join(', '));
  }
}


// ========================================
// AUTHENTICATION
// Logout, impersonation, session verification
// ========================================

/**
 * Check if current user has write permissions (redigerer or admin).
 * Returns false for leser role.
 */
function canEdit() {
  const role = localStorage.getItem('userRole') || 'leser';
  return role === 'admin' || role === 'redigerer';
}

/**
 * Check if current user is admin.
 */
function isAdmin() {
  const role = localStorage.getItem('userRole') || 'leser';
  return role === 'admin';
}

/**
 * Apply role-based UI classes to body.
 * Adds 'role-leser' when user is a reader (hides write UI via CSS).
 */
function applyRoleUI() {
  const role = localStorage.getItem('userRole') || 'leser';
  document.body.classList.remove('role-leser', 'role-redigerer', 'role-admin');
  document.body.classList.add(`role-${role}`);
}

// Handle logout (for SPA - shows login view without redirect)
function handleLogout() {
  // Stop proactive token refresh
  stopTokenRefresh();

  // Revoke session on server (cookie-based auth)
  const logoutHeaders = { 'Content-Type': 'application/json' };
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    logoutHeaders['X-CSRF-Token'] = csrfToken;
  }
  fetch('/api/klient/logout', {
    method: 'POST',
    headers: logoutHeaders,
    credentials: 'include'
  }).catch(err => console.error('Logout request failed:', err));

  authToken = null;
  isSuperAdmin = false;
  appInitialized = false;
  localStorage.removeItem('userName');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userType');
  localStorage.removeItem('isSuperAdmin');
  // Multi-tenancy: Clear organization data
  localStorage.removeItem('organizationId');
  localStorage.removeItem('organizationSlug');
  localStorage.removeItem('organizationName');
  // Clear app mode and industry (prevents stale settings on next login)
  localStorage.removeItem('appMode');
  localStorage.removeItem('industrySlug');
  localStorage.removeItem('industryName');
  // Clear impersonation data
  localStorage.removeItem('isImpersonating');
  localStorage.removeItem('impersonatingOrgId');
  localStorage.removeItem('impersonatingOrgName');
  // Reset appConfig to default
  appConfig.appMode = 'mvp';
  // Clear address/location so next login doesn't inherit previous org's data
  appConfig.routeStartLat = undefined;
  appConfig.routeStartLng = undefined;
  appConfig.routeStartAddress = undefined;

  // Remove office marker and address nudges from the map
  removeOfficeMarker();
  removeAddressNudge();
  const adminBadge = document.getElementById('adminAddressBadge');
  if (adminBadge) adminBadge.style.display = 'none';

  showLoginView();
}

// Stop impersonation and return to admin panel (for super-admins)
async function stopImpersonation() {
  try {
    const stopImpHeaders = {
      'Content-Type': 'application/json',
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      stopImpHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/super-admin/stop-impersonation', {
      method: 'POST',
      headers: stopImpHeaders,
      credentials: 'include'
    });

    const data = await response.json();

    if (data.success) {
      // Clear impersonation data
      localStorage.removeItem('isImpersonating');
      localStorage.removeItem('impersonatingOrgId');
      localStorage.removeItem('impersonatingOrgName');

      // Redirect to admin panel
      window.location.href = '/admin';
    } else {
      console.error('Failed to stop impersonation:', data.error);
      alert('Kunne ikke avslutte impersonering');
    }
  } catch (error) {
    console.error('Error stopping impersonation:', error);
    alert('Kunne ikke avslutte impersonering');
  }
}

// Check if user is already logged in (supports both localStorage token and SSO cookie)
async function checkExistingAuth() {
  // First, try SSO verification (checks both Bearer token and SSO cookie)
  try {
    const response = await fetch('/api/klient/verify', {
      credentials: 'include'
    });

    if (response.ok) {
      const data = await response.json();

      if (data.success && data.data && data.data.valid) {
        // SSO session found or token is valid
        const { token, user, organization } = data.data;

        // Keep token in memory (cookie is the primary auth mechanism)
        if (token) {
          authToken = token;
        }

        // Update user info
        if (user) {
          localStorage.setItem('userName', user.navn || 'Bruker');
          localStorage.setItem('userEmail', user.epost || '');
          localStorage.setItem('userType', user.type || 'klient');
          localStorage.setItem('userRole', user.rolle || (user.type === 'bruker' ? 'admin' : 'leser'));
          // Store super admin flag
          if (user.isSuperAdmin) {
            localStorage.setItem('isSuperAdmin', 'true');
          } else {
            localStorage.removeItem('isSuperAdmin');
          }
        }

        // Update organization branding and persist org data
        if (organization) {
          // Store organization data to localStorage (needed for reloadConfigWithAuth)
          localStorage.setItem('organizationId', organization.id);
          localStorage.setItem('organizationSlug', organization.slug);

          appConfig.companyName = organization.navn;
          appConfig.logoUrl = organization.logoUrl;
          appConfig.primaryColor = organization.primaryColor;
          appConfig.brandTitle = organization.brandTitle || organization.navn;
          // App mode: 'mvp' = enkel versjon, 'full' = komplett (TRE Allservice)
          appConfig.appMode = organization.appMode || 'mvp';
          localStorage.setItem('appMode', appConfig.appMode);

          // Store subscription info for timer
          subscriptionInfo = {
            status: organization.subscriptionStatus,
            trialEndsAt: organization.trialEndsAt,
            planType: organization.planType
          };

          // Load full tenant config (includes industry/service types) and apply branding
          await reloadConfigWithAuth();
        }

        // Apply role-based UI restrictions
        applyRoleUI();

        Logger.log('SSO session verified successfully');
        return true;
      }
    }
  } catch (error) {
    Logger.warn('SSO verification failed:', error);
  }

  // Fallback: try existing localStorage token with dashboard endpoint
  if (authToken) {
    try {
      const response = await fetch('/api/klient/dashboard', {
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();
        if (data.klient) {
          localStorage.setItem('userName', data.klient.navn || 'Bruker');
          localStorage.setItem('userRole', data.klient.rolle || 'leser');
          localStorage.setItem('userType', data.klient.type || 'klient');
        }
        applyRoleUI();
        return true;
      }
    } catch (error) {
      // Token verification failed
    }
  }

  // No valid session found - clear any stale data
  authToken = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('userName');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userType');
  return false;
}


// ========================================
// API CLIENT
// Token refresh and authenticated fetch
// ========================================

// Helper function to make authenticated API calls
// Token refresh state to prevent multiple simultaneous refresh attempts
let refreshPromise = null;

// Check if access token is expiring soon (within 2 minutes)
function isAccessTokenExpiringSoon() {
  if (!accessTokenExpiresAt) return false;

  const expiryTime = typeof accessTokenExpiresAt === 'number' ? accessTokenExpiresAt : parseInt(accessTokenExpiresAt, 10);
  const bufferTime = 2 * 60 * 1000; // 2 minutes before expiry
  return Date.now() > (expiryTime - bufferTime);
}

// Refresh the access token using refresh token
async function refreshAccessToken() {
  // If already refreshing, reuse the existing promise (prevents race condition)
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const refreshHeaders = { 'Content-Type': 'application/json' };
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        refreshHeaders['X-CSRF-Token'] = csrfToken;
      }
      const response = await fetch('/api/klient/refresh', {
        method: 'POST',
        headers: refreshHeaders,
        credentials: 'include'
      });

      if (response.ok) {
        const data = await response.json();

        // Tokens are managed via httpOnly cookies
        authToken = data.accessToken || data.token;

        Logger.log('Access token refreshed successfully');
        return true;
      } else {
        // Refresh failed - clear tokens and redirect to login
        Logger.warn('Token refresh failed:', response.status);
        return false;
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Proactive token refresh - runs in background to prevent session expiry during idle
let tokenRefreshInterval = null;

function setupTokenRefresh() {
  // Clear any existing interval
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
  }

  // Check every minute for token expiry
  tokenRefreshInterval = setInterval(async () => {
    if (!accessTokenExpiresAt) return;

    const expiryTime = typeof accessTokenExpiresAt === 'number' ? accessTokenExpiresAt : parseInt(accessTokenExpiresAt, 10);
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    // Refresh 5 minutes before expiry
    if (expiryTime - now < fiveMinutes && expiryTime > now) {
      Logger.log('Proactive token refresh triggered');
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Reload config to ensure we have fresh tenant data
        await reloadConfigWithAuth();
        Logger.log('Config reloaded after token refresh');
      } else {
        // Refresh failed - don't force logout, let next API call handle it
        Logger.warn('Proactive token refresh failed');
      }
    }
  }, 60000); // Check every minute

  Logger.log('Token refresh interval started');
}

function stopTokenRefresh() {
  if (tokenRefreshInterval) {
    clearInterval(tokenRefreshInterval);
    tokenRefreshInterval = null;
    Logger.log('Token refresh interval stopped');
  }
}

async function apiFetch(url, options = {}) {
  // Check if token needs refresh before making request
  if (authToken && isAccessTokenExpiringSoon()) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      // Refresh failed - redirect to login
      handleLogout();
      throw new Error('Sesjon utløpt');
    }
  }

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  // Add CSRF token for state-changing methods
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  const response = await fetch(url, { ...options, headers, credentials: 'include' });

  // Handle 401 - try to refresh token once, then logout if still failing
  if (response.status === 401) {
    const data = await response.json().catch(() => ({}));

    // Try to refresh token and retry the request
    if (authToken && !options._retried) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Retry the original request with new token
        return apiFetch(url, { ...options, _retried: true });
      }
    }

    if (data.requireLogin || data.error === 'Sesjonen har utløpt') {
      handleLogout();
      throw new Error('Ikke innlogget');
    }
  }

  // Handle 403 with subscription error - show modal and redirect
  if (response.status === 403) {
    const data = await response.clone().json().catch(() => ({}));

    if (data.code === 'SUBSCRIPTION_INACTIVE') {
      showSubscriptionError(data);
      throw new Error(data.error || 'Abonnementet er ikke aktivt');
    }
  }

  // Handle 503 maintenance mode (full block)
  if (response.status === 503) {
    const data = await response.clone().json().catch(() => ({}));
    if (data.error && data.error.code === 'MAINTENANCE') {
      showMaintenanceOverlay(data.error.message);
      throw new Error(data.error.message || 'Vedlikehold pågår');
    }
  }

  // Check for maintenance banner header (banner mode — app still works)
  const maintenanceHeader = response.headers.get('X-Maintenance');
  if (maintenanceHeader === 'banner') {
    const msg = response.headers.get('X-Maintenance-Message');
    showMaintenanceBanner(msg ? decodeURIComponent(msg) : 'Vedlikehold pågår');
  } else {
    hideMaintenanceBanner();
  }

  // Check for subscription warning header (grace period / trial ending soon)
  const subscriptionWarning = response.headers.get('X-Subscription-Warning');
  if (subscriptionWarning) {
    showSubscriptionWarningBanner(subscriptionWarning);
  }

  return response;
}

// Maintenance banner (yellow bar at top — app still usable)
let maintenanceBannerEl = null;

function showMaintenanceBanner(message) {
  if (maintenanceBannerEl) {
    maintenanceBannerEl.querySelector('.maintenance-banner-text').textContent = message;
    return;
  }

  maintenanceBannerEl = document.createElement('div');
  maintenanceBannerEl.id = 'maintenance-banner';
  maintenanceBannerEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:#f59e0b;color:#1a1a1a;text-align:center;padding:8px 16px;font-size:14px;font-weight:500;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
  maintenanceBannerEl.innerHTML = '<span class="maintenance-banner-text">' + escapeHtml(message) + '</span>';
  document.body.appendChild(maintenanceBannerEl);
}

function hideMaintenanceBanner() {
  if (maintenanceBannerEl) {
    maintenanceBannerEl.remove();
    maintenanceBannerEl = null;
  }
}

// Maintenance overlay (full screen block — app unusable)
let maintenanceOverlayEl = null;
let maintenancePollInterval = null;

function showMaintenanceOverlay(message) {
  if (maintenanceOverlayEl) return; // Already showing

  maintenanceOverlayEl = document.createElement('div');
  maintenanceOverlayEl.id = 'maintenance-overlay';
  maintenanceOverlayEl.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#0A0E16;display:flex;align-items:center;justify-content:center;';
  maintenanceOverlayEl.innerHTML = '<div style="text-align:center;padding:2rem;max-width:480px;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">'
    + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64" style="margin:0 auto 1.5rem;display:block;"><defs><linearGradient id="mg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#6366f1"/><stop offset="100%" style="stop-color:#a855f7"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#mg)"/><rect x="5" y="18" width="5" height="10" rx="1" fill="white" opacity="0.5"/><rect x="13" y="12" width="5" height="16" rx="1" fill="white" opacity="0.75"/><rect x="21" y="6" width="5" height="22" rx="1" fill="white"/><path d="M6 16L15 9L24 4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 3"/></svg>'
    + '<h1 style="font-size:1.5rem;font-weight:600;margin-bottom:0.75rem;color:#fff;">Vedlikehold pågår</h1>'
    + '<p style="color:#94a3b8;font-size:1rem;line-height:1.6;margin-bottom:2rem;">' + escapeHtml(message) + '</p>'
    + '<div style="width:32px;height:32px;border:3px solid rgba(99,102,241,0.2);border-top-color:#6366f1;border-radius:50%;animation:mtspin 1s linear infinite;margin:0 auto 1rem;"></div>'
    + '<p style="color:#64748b;font-size:0.8rem;">Siden sjekker automatisk om vi er tilbake...</p>'
    + '</div>'
    + '<style>@keyframes mtspin{to{transform:rotate(360deg)}}</style>';
  document.body.appendChild(maintenanceOverlayEl);

  // Poll for maintenance end
  maintenancePollInterval = setInterval(function() {
    fetch('/api/maintenance/status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.maintenance || data.mode !== 'full') {
          clearInterval(maintenancePollInterval);
          maintenancePollInterval = null;
          if (maintenanceOverlayEl) {
            maintenanceOverlayEl.remove();
            maintenanceOverlayEl = null;
          }
          window.location.reload();
        }
      })
      .catch(function() {});
  }, 30000);
}


// ========================================
// SUBSCRIPTION ERROR HANDLING
// ========================================

/**
 * Shows a warning banner for subscription issues (grace period, trial ending)
 * Does not block app usage, just shows a dismissible warning
 */
function showSubscriptionWarningBanner(message) {
  // Only show once per session to avoid spamming
  if (window._subscriptionWarningShown) return;
  window._subscriptionWarningShown = true;

  // Remove existing banner if any
  const existing = document.getElementById('subscriptionWarningBanner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'subscriptionWarningBanner';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:linear-gradient(135deg,#f59e0b,#d97706);color:white;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.2);font-size:14px;';

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <i aria-hidden="true" class="fas fa-exclamation-circle"></i>
      <span>${escapeHtml(message)}</span>
    </div>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:white;cursor:pointer;font-size:18px;padding:0 5px;">&times;</button>
  `;

  document.body.prepend(banner);
}

// ========================================
// SUBSCRIPTION COUNTDOWN TIMER
// ========================================

let subscriptionTimerInterval = null;

/**
 * Decodes a JWT token to extract payload (without verification)
 */
function decodeJWT(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c =>
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

/**
 * Initializes the subscription countdown timer
 * Only shows for users with active trial period
 */
function initSubscriptionTimer() {
  // Skip timer for enterprise plans - they don't have trials
  if (subscriptionInfo?.planType === 'enterprise') {
    hideSubscriptionTimer();
    return;
  }

  if (!subscriptionInfo) return;

  const { status: subscriptionStatus, trialEndsAt } = subscriptionInfo;

  // Only show timer for trialing subscriptions
  if (subscriptionStatus !== 'trialing') {
    hideSubscriptionTimer();
    return;
  }

  // Only show for trialing with valid end date
  if (!trialEndsAt) {
    hideSubscriptionTimer();
    return;
  }

  const targetDate = new Date(trialEndsAt);
  const timerLabel = 'Prøveperiode';

  // Start the countdown
  updateSubscriptionTimer(targetDate, timerLabel);

  // Clear any existing interval
  if (subscriptionTimerInterval) clearInterval(subscriptionTimerInterval);

  // Update every minute
  subscriptionTimerInterval = setInterval(() => {
    updateSubscriptionTimer(targetDate, timerLabel);
  }, 60000);
}

/**
 * Updates the subscription timer display
 */
function updateSubscriptionTimer(targetDate, label) {
  const timerEl = document.getElementById('subscriptionTimer');
  const timerText = document.getElementById('subscriptionTimerText');

  if (!timerEl || !timerText) return;

  const now = new Date();
  const diff = targetDate - now;

  if (diff <= 0) {
    timerText.textContent = 'Utløpt';
    timerEl.classList.add('warning');
    timerEl.style.display = 'flex';
    return;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  let timeStr = '';
  if (days > 0) {
    timeStr = `${days}d ${hours}t`;
  } else if (hours > 0) {
    timeStr = `${hours}t ${minutes}m`;
  } else {
    timeStr = `${minutes}m`;
  }

  timerText.textContent = `${label}: ${timeStr}`;

  // Add warning class if less than 3 days
  if (days < 3) {
    timerEl.classList.add('warning');
  } else {
    timerEl.classList.remove('warning');
  }

  timerEl.style.display = 'flex';
}

/**
 * Hides the subscription timer
 */
function hideSubscriptionTimer() {
  const timerEl = document.getElementById('subscriptionTimer');
  if (timerEl) timerEl.style.display = 'none';

  if (subscriptionTimerInterval) {
    clearInterval(subscriptionTimerInterval);
    subscriptionTimerInterval = null;
  }
}

/**
 * Shows a modal when subscription is inactive
 * Prevents further app usage until subscription is resolved
 */
function showSubscriptionError(errorData) {
  const message = errorData.error || 'Abonnementet er ikke aktivt';
  const details = errorData.details || {};

  // Remove existing modal if any
  const existing = document.getElementById('subscriptionErrorModal');
  if (existing) existing.remove();

  // Create modal
  const modal = document.createElement('div');
  modal.id = 'subscriptionErrorModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:10000;';

  const statusMessages = {
    trial_expired: 'Prøveperioden din har utløpt',
    canceled: 'Abonnementet er kansellert',
    past_due: 'Betalingen har feilet',
    incomplete: 'Abonnementet er ikke fullført',
    grace_period_exceeded: 'Betalingsfristen er utløpt'
  };

  const statusTitle = statusMessages[details.reason] || 'Abonnement kreves';

  modal.innerHTML = `
    <div style="background:var(--card-bg, #1a1a2e);border-radius:12px;padding:32px;max-width:450px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
      <div style="width:64px;height:64px;margin:0 auto 20px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:50%;display:flex;align-items:center;justify-content:center;">
        <i aria-hidden="true" class="fas fa-exclamation-triangle" style="font-size:28px;color:white;"></i>
      </div>
      <h2 style="color:var(--text-primary, #fff);margin:0 0 12px;font-size:24px;">${escapeHtml(statusTitle)}</h2>
      <p style="color:var(--text-secondary, #a0a0a0);margin:0 0 24px;font-size:15px;line-height:1.6;">${escapeHtml(message)}</p>
      <p style="font-size:13px;color:var(--text-muted, #666);">
        Kontakt administrator for å håndtere abonnementet, eller <a href="mailto:sander@efffekt.no" style="color:#3b82f6;">ta kontakt med support</a>.
      </p>
    </div>
  `;

  document.body.appendChild(modal);

  // Prevent any interaction with the app
  modal.addEventListener('click', (e) => {
    // Only allow clicking the email link
    if (e.target.tagName !== 'A') {
      e.stopPropagation();
    }
  });
}


// ========================================
// WEBSOCKET & REAL-TIME UPDATES
// Connection, presence tracking, message handling
// ========================================

// WebSocket for real-time updates
let ws = null;
let wsReconnectTimer = null;
let wsReconnectAttempts = 0;
let wsInitialized = false;
const MAX_RECONNECT_ATTEMPTS = 10;

// Presence tracking: kundeId → { userId, userName, initials }
const presenceClaims = new Map();
let currentClaimedKundeId = null;
let myUserId = null;
let myInitials = null;

// Update connection indicator in UI
function updateWsConnectionIndicator(connected) {
  const indicator = document.getElementById('ws-connection-indicator');
  if (indicator) {
    indicator.className = connected ? 'ws-indicator ws-connected' : 'ws-indicator ws-disconnected';
    indicator.title = connected ? 'Sanntidsoppdateringer aktiv' : 'Frakoblet - prøver å koble til...';
  }
}

// Initialize WebSocket connection for real-time updates
function initWebSocket() {
  // Guard: only initialize once (called from multiple init paths)
  if (wsInitialized && ws && ws.readyState !== WebSocket.CLOSED) return;
  wsInitialized = true;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      Logger.log('WebSocket connected - sanntidsoppdateringer aktiv');
      wsReconnectAttempts = 0;
      updateWsConnectionIndicator(true);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleRealtimeUpdate(message);
      } catch (e) {
        console.error('Error parsing WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      Logger.log('WebSocket disconnected');
      updateWsConnectionIndicator(false);
      attemptReconnect();
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      updateWsConnectionIndicator(false);
    };
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
    updateWsConnectionIndicator(false);
  }
}

// Attempt to reconnect WebSocket
function attemptReconnect() {
  if (wsReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    Logger.log('Max reconnection attempts reached');
    return;
  }

  wsReconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempts), 30000);

  wsReconnectTimer = setTimeout(() => {
    Logger.log(`Attempting WebSocket reconnection (${wsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    wsInitialized = false; // Allow re-init for reconnect
    initWebSocket();
  }, delay);
}

// Handle real-time updates from WebSocket
function handleRealtimeUpdate(message) {
  const { type, data } = message;

  switch (type) {
    case 'connected':
      Logger.log('Server:', data || message.message);
      // Store own identity
      if (data && data.userId) {
        myUserId = data.userId;
        myInitials = data.initials || '';
      }
      // Load initial presence state
      if (data && data.presence) {
        presenceClaims.clear();
        for (const [kundeId, claim] of Object.entries(data.presence)) {
          presenceClaims.set(Number(kundeId), claim);
        }
        updatePresenceBadges();
      }
      break;

    case 'kunde_created':
      // Add new customer to list and re-render
      customers.push(data);
      applyFilters();
      renderCustomerAdmin();
      renderMissingData(); // Update missing data badge
      updateOverdueBadge();
      showNotification(`Ny kunde opprettet: ${data.navn}`);
      break;

    case 'kunde_updated':
      // Update existing customer
      const updateIndex = customers.findIndex(c => c.id === Number.parseInt(data.id));
      if (updateIndex !== -1) {
        customers[updateIndex] = { ...customers[updateIndex], ...data };
        applyFilters();
        renderCustomerAdmin();
        renderMissingData(); // Update missing data badge
        updateOverdueBadge();
      }
      break;

    case 'kunde_deleted':
      // Remove customer from list
      customers = customers.filter(c => c.id !== data.id);
      selectedCustomers.delete(data.id);
      applyFilters();
      renderCustomerAdmin();
      renderMissingData(); // Update missing data badge
      updateOverdueBadge();
      updateSelectionUI();
      break;

    case 'kunder_bulk_updated':
      // Bulk update - reload all customers
      Logger.log(`Bulk update: ${data.count} kunder oppdatert av annen bruker`);
      loadCustomers();
      break;

    case 'avtale_created':
    case 'avtale_updated':
    case 'avtale_deleted':
    case 'avtale_series_deleted':
    case 'avtaler_bulk_created':
      // Calendar changed - reload data and re-render
      Logger.log(`Avtale ${type.replace('avtale_', '').replace('avtaler_', '')}`);
      if (typeof loadAvtaler === 'function') {
        loadAvtaler().then(() => {
          if (typeof renderCalendar === 'function') renderCalendar();
        });
      }
      break;

    case 'rute_created':
    case 'rute_updated':
    case 'rute_deleted':
      // Rute-endringer kan oppdatere kundedata (f.eks. kontrolldatoer ved rute-fullføring)
      Logger.log(`Rute ${type.replace('rute_', '')}`);
      if (typeof loadCustomers === 'function') {
        loadCustomers();
      }
      break;

    case 'customer_claimed':
      // Someone started working on a customer
      presenceClaims.set(data.kundeId, {
        userId: data.userId,
        userName: data.userName,
        initials: data.initials,
      });
      updatePresenceBadgeForKunde(data.kundeId);
      // Show notification if someone else claimed (not ourselves)
      if (data.userId !== myUserId) {
        Logger.log(`${data.userName} jobber med kunde #${data.kundeId}`);
      }
      break;

    case 'customer_released':
      // Someone stopped working on a customer
      presenceClaims.delete(data.kundeId);
      updatePresenceBadgeForKunde(data.kundeId);
      break;

    case 'user_offline':
      // Another user went offline — remove all their claims
      for (const [kundeId, claim] of presenceClaims) {
        if (claim.userId === data.userId) {
          presenceClaims.delete(kundeId);
          updatePresenceBadgeForKunde(kundeId);
        }
      }
      Logger.log(`Bruker frakoblet: ${data.userName}`);
      break;

    case 'time_update':
      // Periodic time update - refresh day counters
      updateDayCounters();
      break;

    case 'chat_message':
      handleIncomingChatMessage(data);
      break;

    case 'chat_typing':
      handleChatTyping(data);
      break;

    case 'chat_typing_stop':
      handleChatTypingStop(data);
      break;

    case 'pong':
      break;
  }
}

// ========================================
// PRESENCE: Show who is working on which customer
// ========================================

/**
 * Send a claim_customer message via WebSocket
 */
function claimCustomer(kundeId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  // Release previous claim if any
  if (currentClaimedKundeId && currentClaimedKundeId !== kundeId) {
    releaseCustomer(currentClaimedKundeId);
  }
  currentClaimedKundeId = kundeId;
  const userName = localStorage.getItem('userName') || 'Bruker';
  ws.send(JSON.stringify({ type: 'claim_customer', kundeId, userName }));
}

/**
 * Send a release_customer message via WebSocket
 */
function releaseCustomer(kundeId) {
  if (!kundeId) return;
  if (currentClaimedKundeId === kundeId) {
    currentClaimedKundeId = null;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'release_customer', kundeId }));
}

/**
 * Get a deterministic color for a user ID (for presence badges)
 * Uses 10 visually distinct colors — each user always gets the same one
 */
const PRESENCE_COLORS = [
  '#2563eb', // blå
  '#dc2626', // rød
  '#16a34a', // grønn
  '#9333ea', // lilla
  '#ea580c', // oransje
  '#0891b2', // cyan
  '#c026d3', // magenta
  '#ca8a04', // gul
  '#4f46e5', // indigo
  '#0d9488', // teal
];
function getPresenceColor(userId) {
  return PRESENCE_COLORS[userId % PRESENCE_COLORS.length];
}

/**
 * Update presence badge on a specific customer's marker
 */
function updatePresenceBadgeForKunde(kundeId) {
  if (!markers || !markers[kundeId]) return;
  const marker = markers[kundeId];
  const el = marker.getElement();
  if (!el) return;

  // Remove existing presence badge
  const existing = el.querySelector('.presence-badge');
  if (existing) existing.remove();

  // Add badge if someone has claimed this customer
  const claim = presenceClaims.get(kundeId);
  if (claim && claim.userId !== myUserId) {
    const badge = document.createElement('div');
    badge.className = 'presence-badge';
    badge.style.backgroundColor = getPresenceColor(claim.userId);
    badge.textContent = claim.initials;
    badge.title = `${claim.userName} jobber med denne kunden`;
    el.appendChild(badge);
  }
}

/**
 * Update all presence badges on map markers
 */
function updatePresenceBadges() {
  if (!markers) return;
  for (const kundeId of Object.keys(markers)) {
    updatePresenceBadgeForKunde(Number(kundeId));
  }
}


// ========================================
// SERVICE TYPE REGISTRY (Multi-Industry Support)
// ========================================

/**
 * ServiceTypeRegistry - Manages dynamic service types loaded from server config
 * Replaces hardcoded 'Sky Planner', 'Brannvarsling' with configurable service types
 */
class ServiceTypeRegistry {
  constructor() {
    this.serviceTypes = new Map();
    this.intervals = [];
    this.industryTemplate = null;
    this.initialized = false;
  }

  /**
   * Initialize registry from appConfig
   */
  loadFromConfig(config) {
    this.serviceTypes.clear();

    if (config.serviceTypes && Array.isArray(config.serviceTypes)) {
      config.serviceTypes.forEach(st => {
        this.serviceTypes.set(st.slug, {
          id: st.id,
          name: st.name,
          slug: st.slug,
          icon: st.icon || 'fa-wrench',
          color: st.color || '#5E81AC',
          defaultInterval: st.defaultInterval || 12,
          description: st.description || '',
          subtypes: st.subtypes || [],
          equipmentTypes: st.equipmentTypes || []
        });
      });
    }

    // Fallback: Generic service type if none were loaded from config
    // This only happens for unauthenticated requests (login page) or orgs without service types
    if (this.serviceTypes.size === 0) {
      this.serviceTypes.set('service', {
        id: 0,
        name: 'Service',
        slug: 'service',
        icon: 'fa-wrench',
        color: '#5E81AC',
        defaultInterval: 12,
        description: 'Generell tjeneste',
        subtypes: [],
        equipmentTypes: []
      });
      Logger.log('Using generic fallback service type (no types configured for this org)');
    }

    this.intervals = config.intervals || [];
    this.industryTemplate = config.industryTemplate || null;
    this.initialized = true;

    Logger.log(`ServiceTypeRegistry loaded: ${this.serviceTypes.size} service types`);
  }

  /**
   * Load service types from an industry template (fetched from API)
   */
  async loadFromIndustry(industrySlug) {
    try {
      const response = await fetch(`/api/industries/${industrySlug}`);
      if (!response.ok) return false;
      const data = await response.json();

      if (data.success && data.data) {
        this.serviceTypes.clear();

        const industry = data.data;
        this.industryTemplate = {
          id: industry.id,
          name: industry.name,
          slug: industry.slug,
          icon: industry.icon,
          color: industry.color
        };

        // Load service types from industry
        if (industry.serviceTypes && Array.isArray(industry.serviceTypes)) {
          industry.serviceTypes.forEach(st => {
            this.serviceTypes.set(st.slug, {
              id: st.id,
              name: st.name,
              slug: st.slug,
              icon: st.icon || 'fa-wrench',
              color: st.color || '#5E81AC',
              defaultInterval: st.defaultInterval || 12,
              description: st.description || '',
              subtypes: st.subtypes || [],
              equipmentTypes: st.equipment || []
            });
          });
        }

        // Load intervals from industry
        if (industry.intervals && Array.isArray(industry.intervals)) {
          this.intervals = industry.intervals.map(i => ({
            months: i.months,
            label: i.label,
            isDefault: i.isDefault
          }));
        }

        this.initialized = true;
        Logger.log(`ServiceTypeRegistry loaded from industry '${industrySlug}': ${this.serviceTypes.size} service types`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error loading industry service types:', error);
      return false;
    }
  }

  /**
   * Get all service types as array
   */
  getAll() {
    return Array.from(this.serviceTypes.values());
  }

  /**
   * Get service type by slug
   */
  getBySlug(slug) {
    return this.serviceTypes.get(slug);
  }

  /**
   * Get service type by ID
   */
  getById(id) {
    return this.getAll().find(st => st.id === id);
  }

  /**
   * Get the default (first) service type for fallback behavior
   * Used when no specific category matches
   */
  getDefaultServiceType() {
    const all = this.getAll();
    return all.length > 0 ? all[0] : {
      slug: 'service',
      name: 'Service',
      icon: 'fa-wrench',
      color: '#5E81AC'
    };
  }

  /**
   * Generate icon HTML for a service type
   */
  getIcon(slugOrServiceType) {
    const st = typeof slugOrServiceType === 'string'
      ? this.getBySlug(slugOrServiceType)
      : slugOrServiceType;
    if (!st) return '<i aria-hidden="true" class="fas fa-wrench"></i>';
    return `<i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color}"></i>`;
  }

  /**
   * Format interval as label
   */
  formatInterval(value) {
    const interval = this.intervals.find(i => i.months === value);
    if (interval?.label) return interval.label;
    // Negative values = days (for weekly intervals)
    if (value < 0) {
      const days = Math.abs(value);
      if (days === 7) return '1 uke';
      if (days % 7 === 0) return `${days / 7} uker`;
      return `${days} dager`;
    }
    if (value < 12) return `${value} mnd`;
    if (value === 12) return '1 år';
    if (value % 12 === 0) return `${value / 12} år`;
    return `${value} mnd`;
  }

  /**
   * Get available intervals for dropdowns
   * Negative values = days (e.g. -7 = weekly, -14 = biweekly)
   * Positive values = months
   */
  getIntervalOptions() {
    if (this.intervals.length > 0) {
      return this.intervals.map(i => ({
        value: i.months,
        label: i.label || this.formatInterval(i.months),
        isDefault: i.isDefault
      }));
    }
    // Fallback to common intervals
    return [
      { value: -7, label: '1 uke', isDefault: false },
      { value: -14, label: '2 uker', isDefault: false },
      { value: 1, label: '1 mnd', isDefault: false },
      { value: 3, label: '3 mnd', isDefault: false },
      { value: 6, label: '6 mnd', isDefault: false },
      { value: 12, label: '1 år', isDefault: true },
      { value: 24, label: '2 år', isDefault: false },
      { value: 36, label: '3 år', isDefault: false },
      { value: 60, label: '5 år', isDefault: false }
    ];
  }

  /**
   * Generate category tabs HTML
   */
  renderCategoryTabs(activeCategory = 'all') {
    const serviceTypes = this.getAll();

    let html = `<button class="kategori-tab ${activeCategory === 'all' ? 'active' : ''}" data-kategori="alle">Alle</button>`;

    serviceTypes.forEach(st => {
      const isActive = activeCategory === st.slug || activeCategory === st.name;
      html += `<button class="kategori-tab ${isActive ? 'active' : ''}" data-kategori="${st.name}">
        ${this.getIcon(st)} ${st.name}
      </button>`;
    });

    // Add combined tab for all categories
    if (serviceTypes.length >= 2) {
      const combinedName = serviceTypes.map(st => st.name).join(' + ');
      const combinedLabel = serviceTypes.length > 2 ? 'Alle' : 'Begge';
      const isActive = activeCategory === combinedName || activeCategory === 'El-Kontroll + Brannvarsling';
      html += `<button class="kategori-tab ${isActive ? 'active' : ''}" data-kategori="${combinedName}">
        ${serviceTypes.map(st => this.getIcon(st)).join('')} ${combinedLabel}
      </button>`;
    }

    return html;
  }

  /**
   * Generate category checkbox HTML (multi-select)
   */
  renderCategoryCheckboxes(selectedValue = '') {
    const serviceTypes = this.getAll();
    const selectedNames = selectedValue.split(' + ').map(s => s.trim()).filter(Boolean);
    const selectedNamesLower = selectedNames.map(s => s.toLowerCase());
    let html = '';

    serviceTypes.forEach(st => {
      // Match by name or slug (case-insensitive)
      const nameMatch = selectedNamesLower.includes(st.name.toLowerCase()) || selectedNamesLower.includes(st.slug.toLowerCase());
      // Auto-check if only one service type and customer has any category
      const autoCheck = serviceTypes.length === 1 && selectedNames.length > 0;
      const checked = nameMatch || autoCheck ? 'checked' : '';
      html += `
        <label class="kategori-checkbox-label">
          <input type="checkbox" name="kategori" value="${escapeHtml(st.name)}" ${checked}>
          <i aria-hidden="true" class="fas ${st.icon || 'fa-clipboard-check'}" style="color:${st.color || '#3B82F6'}"></i>
          ${escapeHtml(st.name)}
        </label>`;
    });

    return html;
  }

  /**
   * Render <option> elements for a <select> dropdown
   */
  renderCategoryOptions(selectedValue = '') {
    const serviceTypes = this.getAll();
    return serviceTypes.map(st => {
      const selected = st.name === selectedValue || st.slug === selectedValue ? 'selected' : '';
      return `<option value="${escapeHtml(st.name)}" ${selected}>${escapeHtml(st.name)}</option>`;
    }).join('');
  }

  /**
   * Get selected categories from checkboxes as " + " joined string
   */
  getSelectedCategories() {
    const checkboxes = document.querySelectorAll('#kategoriCheckboxes input[name="kategori"]:checked');
    return Array.from(checkboxes).map(cb => cb.value).join(' + ');
  }

  /**
   * Generate subtype options for a service type
   */
  renderSubtypeOptions(serviceTypeSlug, selectedValue = '') {
    const st = this.getBySlug(serviceTypeSlug);
    if (!st || !st.subtypes || st.subtypes.length === 0) return '';

    let html = '<option value="">Ikke valgt</option>';
    st.subtypes.forEach(sub => {
      const selected = selectedValue === sub.name || selectedValue === sub.slug ? 'selected' : '';
      html += `<option value="${escapeHtml(sub.name)}" ${selected}>${escapeHtml(sub.name)}</option>`;
    });
    return html;
  }

  /**
   * Generate equipment options for a service type
   */
  renderEquipmentOptions(serviceTypeSlug, selectedValue = '') {
    const st = this.getBySlug(serviceTypeSlug);
    if (!st || !st.equipmentTypes || st.equipmentTypes.length === 0) return '';

    let html = '<option value="">Ikke valgt</option>';
    st.equipmentTypes.forEach(eq => {
      const selected = selectedValue === eq.name || selectedValue === eq.slug ? 'selected' : '';
      html += `<option value="${escapeHtml(eq.name)}" ${selected}>${escapeHtml(eq.name)}</option>`;
    });
    return html;
  }

  /**
   * Generate interval select options
   */
  renderIntervalOptions(selectedValue = null) {
    const options = this.getIntervalOptions();
    let html = '';

    options.forEach(opt => {
      const selected = selectedValue === opt.value || (selectedValue === null && opt.isDefault) ? 'selected' : '';
      html += `<option value="${escapeHtml(String(opt.value))}" ${selected}>${escapeHtml(opt.label)}</option>`;
    });

    return html;
  }

  /**
   * Check if customer matches a category filter
   */
  matchesCategory(customer, categoryFilter) {
    if (categoryFilter === 'all' || categoryFilter === 'alle') return true;

    const kategori = customer.kategori || '';
    if (!kategori) return false;
    const kundeKats = kategori.split(' + ').map(s => s.trim());

    // Direct match with service type slug or name
    const st = this.getBySlug(categoryFilter);
    if (st) {
      return kundeKats.includes(st.name);
    }

    // Combined filter (e.g. "El-Kontroll + Brannvarsling") — customer must have ALL
    const filterKats = categoryFilter.split(' + ').map(s => s.trim());
    if (filterKats.length > 1) {
      return filterKats.every(fk => kundeKats.includes(fk));
    }

    // Direct name match
    return kundeKats.includes(categoryFilter);
  }

  /**
   * Check if a category is known in the current industry
   */
  isKnownCategory(kategori) {
    if (!kategori) return true; // null/empty is considered "default"

    const serviceTypes = this.getAll();

    // Check for exact match
    for (const st of serviceTypes) {
      if (kategori === st.name) return true;
    }

    // Check for combined category (contains '+')
    if (kategori.includes('+')) {
      const parts = kategori.split('+').map(p => p.trim());
      return parts.every(part => serviceTypes.some(st => st.name === part));
    }

    // Check for partial match
    for (const st of serviceTypes) {
      if (kategori.toLowerCase().includes(st.slug.toLowerCase()) ||
          kategori.toLowerCase().includes(st.name.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get CSS class for category badge
   * Dynamically returns the service type slug as CSS class
   * Returns 'unknown-category' for categories not in current industry
   */
  getCategoryClass(kategori) {
    const serviceTypes = this.getAll();
    const defaultSt = this.getDefaultServiceType();

    // Helper to normalize category strings for comparison
    const normalizeCategory = (str) => {
      if (!str) return '';
      return str.toLowerCase()
        .replace(/[\s-]+/g, '')  // Remove spaces and hyphens
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''); // Remove accents
    };

    // Helper to find matching service type
    const findServiceType = (categoryName) => {
      const normalizedCat = normalizeCategory(categoryName);
      for (const st of serviceTypes) {
        if (normalizedCat === normalizeCategory(st.name) ||
            normalizedCat === normalizeCategory(st.slug)) {
          return st;
        }
      }
      for (const st of serviceTypes) {
        if (normalizedCat.includes(normalizeCategory(st.slug)) ||
            normalizeCategory(st.slug).includes(normalizedCat)) {
          return st;
        }
      }
      return null;
    };

    if (!kategori) return defaultSt.slug;

    // Combined category (contains '+')
    if (kategori.includes('+')) {
      const parts = kategori.split('+').map(p => p.trim());
      const matchedTypes = parts.map(part => findServiceType(part)).filter(Boolean);
      return matchedTypes.length > 0 ? 'combined' : defaultSt.slug;
    }

    // Single category - use normalized matching
    const matchedSt = findServiceType(kategori);
    if (matchedSt) {
      return matchedSt.slug;
    }

    // Fallback: check svgIcons directly for known categories
    const normalizedKat = normalizeCategory(kategori);
    for (const slug of Object.keys(svgIcons)) {
      if (normalizedKat.includes(normalizeCategory(slug)) ||
          normalizeCategory(slug).includes(normalizedKat)) {
        return slug;
      }
    }

    // Unknown category - use default service type as fallback
    return defaultSt.slug;
  }

  /**
   * Get icon HTML for a category (handles combined categories)
   * Uses premium SVG icons when available, falls back to default service type
   */
  getIconForCategory(kategori) {
    const serviceTypes = this.getAll();
    const defaultSt = this.getDefaultServiceType();

    // Helper to normalize category strings for comparison
    // "El-Kontroll" -> "elkontroll", "Brannvarsling" -> "brannvarsling"
    const normalizeCategory = (str) => {
      if (!str) return '';
      return str.toLowerCase()
        .replace(/[\s-]+/g, '')  // Remove spaces and hyphens
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''); // Remove accents
    };

    // Helper to get icon HTML - white FontAwesome icon on colored marker background
    const getIconHtml = (st) => {
      return `<i aria-hidden="true" class="fas ${st.icon}"></i>`;
    };

    // Helper to find matching service type using normalized comparison
    const findServiceType = (categoryName) => {
      const normalizedCat = normalizeCategory(categoryName);
      // First: exact normalized match
      for (const st of serviceTypes) {
        if (normalizedCat === normalizeCategory(st.name) ||
            normalizedCat === normalizeCategory(st.slug)) {
          return st;
        }
      }
      // Second: partial normalized match
      for (const st of serviceTypes) {
        if (normalizedCat.includes(normalizeCategory(st.slug)) ||
            normalizeCategory(st.slug).includes(normalizedCat)) {
          return st;
        }
      }
      return null;
    };

    if (!kategori) return getIconHtml(defaultSt);

    // Check for combined category (contains '+')
    if (kategori.includes('+')) {
      const parts = kategori.split('+').map(p => p.trim());
      const matchedTypes = parts.map(part => findServiceType(part)).filter(Boolean);
      if (matchedTypes.length > 0) {
        return matchedTypes.map(st => getIconHtml(st)).join('');
      }
      return getIconHtml(defaultSt);
    }

    // Single service type - use normalized matching
    const matchedSt = findServiceType(kategori);
    if (matchedSt) {
      return getIconHtml(matchedSt);
    }

    // Fallback: check svgIcons directly for known categories
    const normalizedKat = normalizeCategory(kategori);
    for (const slug of Object.keys(svgIcons)) {
      if (normalizedKat.includes(normalizeCategory(slug)) ||
          normalizeCategory(slug).includes(normalizedKat)) {
        return `<span class="marker-svg-icon">${svgIcons[slug]}</span>`;
      }
    }

    // Unknown category - use default service type icon as fallback
    return getIconHtml(defaultSt);
  }

  // renderDriftsOptions() removed — migrated to subcategory system (migration 044)

  /**
   * Render dynamic service sections for customer modal
   * @param {Object} customer - Customer object with optional services array
   * @param {Array<string>} selectedNames - Optional filter: only render sections for these category names
   * @returns {string} HTML for all service sections
   */
  renderServiceSections(customer = {}, selectedNames = null) {
    let serviceTypes = this.getAll();
    if (serviceTypes.length === 0) return '';

    // Filter to only selected categories if specified
    if (selectedNames && selectedNames.length > 0) {
      serviceTypes = serviceTypes.filter(st => selectedNames.includes(st.name));
    }
    if (serviceTypes.length === 0) return '';

    const services = customer.services || [];
    let html = '';

    serviceTypes.forEach(st => {
      // Find existing service data for this type
      let serviceData = services.find(s =>
        s.service_type_slug === st.slug || s.service_type_id === st.id
      ) || {};

      // Fallback to legacy columns if no dynamic service data
      if (!serviceData.siste_kontroll && !serviceData.neste_kontroll) {
        if (st.slug === 'el-kontroll' && (customer.siste_el_kontroll || customer.neste_el_kontroll)) {
          serviceData = {
            ...serviceData,
            siste_kontroll: customer.siste_el_kontroll || '',
            neste_kontroll: customer.neste_el_kontroll || '',
            intervall_months: customer.el_kontroll_intervall || st.defaultInterval
          };
        } else if (st.slug === 'brannvarsling' && (customer.siste_brann_kontroll || customer.neste_brann_kontroll)) {
          serviceData = {
            ...serviceData,
            siste_kontroll: customer.siste_brann_kontroll || '',
            neste_kontroll: customer.neste_brann_kontroll || '',
            intervall_months: customer.brann_kontroll_intervall || st.defaultInterval
          };
        } else if (customer.siste_kontroll || customer.neste_kontroll) {
          serviceData = {
            ...serviceData,
            siste_kontroll: customer.siste_kontroll || '',
            neste_kontroll: customer.neste_kontroll || '',
            intervall_months: customer.kontroll_intervall_mnd || st.defaultInterval
          };
        }
      }

      const hasSubtypes = st.subtypes && st.subtypes.length > 0;
      const hasEquipment = st.equipmentTypes && st.equipmentTypes.length > 0;

      html += `
        <div class="control-section service-section" data-service-slug="${st.slug}" data-service-id="${st.id}">
          <div class="control-section-header">
            <i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color}"></i> ${st.name}
          </div>

          ${hasSubtypes ? `
          <div class="form-group">
            <label for="service_${st.slug}_subtype">Type</label>
            <select id="service_${st.slug}_subtype" name="service_${st.slug}_subtype">
              ${this.renderSubtypeOptions(st.slug, serviceData.subtype_name || '')}
            </select>
          </div>
          ` : ''}

          ${hasEquipment ? `
          <div class="form-group">
            <label for="service_${st.slug}_equipment">System/Utstyr</label>
            <select id="service_${st.slug}_equipment" name="service_${st.slug}_equipment">
              ${this.renderEquipmentOptions(st.slug, serviceData.equipment_name || '')}
            </select>
          </div>
          ` : ''}

          <div class="form-row">
            <div class="form-group">
              <label for="service_${st.slug}_siste">Siste kontroll</label>
              <input type="${appConfig.datoModus === 'month_year' ? 'month' : 'date'}" id="service_${st.slug}_siste" name="service_${st.slug}_siste"
                     value="${appConfig.datoModus === 'month_year' && serviceData.siste_kontroll ? serviceData.siste_kontroll.substring(0, 7) : (serviceData.siste_kontroll || '')}">
            </div>
            <div class="form-group">
              <label for="service_${st.slug}_neste">Neste kontroll</label>
              <input type="${appConfig.datoModus === 'month_year' ? 'month' : 'date'}" id="service_${st.slug}_neste" name="service_${st.slug}_neste"
                     value="${appConfig.datoModus === 'month_year' && serviceData.neste_kontroll ? serviceData.neste_kontroll.substring(0, 7) : (serviceData.neste_kontroll || '')}">
            </div>
          </div>

          <div class="form-group">
            <label for="service_${st.slug}_intervall">Intervall</label>
            <select id="service_${st.slug}_intervall" name="service_${st.slug}_intervall">
              ${this.renderIntervalOptions(serviceData.intervall_months || st.defaultInterval)}
            </select>
          </div>
        </div>
      `;
    });

    return html;
  }

  /**
   * Parse form data for services from dynamically rendered sections
   * @returns {Array} Array of service objects
   */
  parseServiceFormData() {
    const serviceTypes = this.getAll();
    const services = [];

    serviceTypes.forEach(st => {
      const section = document.querySelector(`.service-section[data-service-slug="${st.slug}"]`);
      if (!section) return;

      const sisteInput = document.getElementById(`service_${st.slug}_siste`);
      const nesteInput = document.getElementById(`service_${st.slug}_neste`);
      const intervallSelect = document.getElementById(`service_${st.slug}_intervall`);
      const subtypeSelect = document.getElementById(`service_${st.slug}_subtype`);
      const equipmentSelect = document.getElementById(`service_${st.slug}_equipment`);

      const siste = normalizeDateValue(sisteInput?.value) || null;
      const neste = normalizeDateValue(nesteInput?.value) || null;
      const intervall = intervallSelect?.value ? parseInt(intervallSelect.value, 10) : st.defaultInterval;
      const subtype = subtypeSelect?.value || null;
      const equipment = equipmentSelect?.value || null;

      // Fallback service type (id=0) has no real DB row — writing to
      // customer_services would violate the foreign key constraint.
      // Instead, copy dates to the legacy form fields so they get saved
      // on the main customer record.
      if (!st.id || st.id === 0) {
        const legacySiste = document.getElementById('siste_kontroll');
        const legacyNeste = document.getElementById('neste_kontroll');
        const legacyIntervall = document.getElementById('kontroll_intervall');
        if (legacySiste) legacySiste.value = siste || '';
        if (legacyNeste) legacyNeste.value = neste || '';
        if (legacyIntervall && intervall) legacyIntervall.value = intervall;
        return;
      }

      // Always include rendered service sections (even without dates)
      // Null dates = "service type selected but no dates set yet"
      services.push({
        service_type_id: st.id,
        service_type_slug: st.slug,
        siste_kontroll: siste,
        neste_kontroll: neste,
        intervall_months: intervall,
        subtype_name: subtype,
        equipment_name: equipment
      });
    });

    return services;
  }

  /**
   * Get the combined kategori string from services array
   * @param {Array} services - Array of service objects
   * @returns {string} Combined kategori like "El-Kontroll + Brannvarsling"
   */
  getKategoriFromServices(services) {
    if (!services || services.length === 0) return '';

    const serviceTypes = this.getAll();
    const activeServiceNames = [];

    services.forEach(service => {
      const st = serviceTypes.find(t =>
        t.slug === service.service_type_slug || t.id === service.service_type_id
      );
      if (st && !activeServiceNames.includes(st.name)) {
        activeServiceNames.push(st.name);
      }
    });

    return activeServiceNames.join(' + ');
  }

  /**
   * Generate dynamic popup control info HTML for a customer
   * Replaces hardcoded El-Kontroll/Brannvarsling popup content
   * @param {Object} customer - Customer object
   * @param {Object} controlStatus - Result from getControlStatus()
   * @returns {string} HTML string for control info section
   */
  renderPopupControlInfo(customer, controlStatus) {
    const serviceTypes = this.getAll();
    const kategori = customer.kategori || '';

    const formatDate = (dato) => {
      if (!dato) return null;
      const d = new Date(dato);
      return formatDateInline(d);
    };

    // MVP-modus: vis kontrollinfo per servicetype
    if (isMvpMode()) {
      // Filter service types based on customer's kategori
      if (serviceTypes.length >= 2) {
        const kundeKats = kategori ? kategori.split(' + ').map(s => s.trim()) : [];
        const relevantTypes = kundeKats.length > 0
          ? serviceTypes.filter(st => kundeKats.includes(st.name))
          : serviceTypes;
        const typesToShow = relevantTypes.length > 0 ? relevantTypes : serviceTypes;

        // If only one type matches, use simple single-type view
        if (typesToShow.length === 1) {
          const st = typesToShow[0];
          let nesteKontroll = null;
          let sisteKontroll = null;

          const serviceData = (customer.services || []).find(s =>
            s.service_type_slug === st.slug || s.service_type_id === st.id
          );
          if (serviceData) {
            nesteKontroll = serviceData.neste_kontroll;
            sisteKontroll = serviceData.siste_kontroll;
          }
          if (st.slug === 'el-kontroll') {
            if (!nesteKontroll) nesteKontroll = customer.neste_el_kontroll;
            if (!sisteKontroll) sisteKontroll = customer.siste_el_kontroll;
          } else if (st.slug === 'brannvarsling') {
            if (!nesteKontroll) nesteKontroll = customer.neste_brann_kontroll;
            if (!sisteKontroll) sisteKontroll = customer.siste_brann_kontroll;
          }
          if (!nesteKontroll) nesteKontroll = customer.neste_kontroll;
          if (!sisteKontroll) sisteKontroll = customer.siste_kontroll || customer.last_visit_date;

          return `
            <div class="popup-control-info">
              <p class="popup-status ${controlStatus.class}">
                <strong><i aria-hidden="true" class="fas ${st.icon || 'fa-clipboard-check'}" style="color:${st.color || '#3B82F6'};display:inline-block;width:14px;text-align:center;"></i> Neste kontroll:</strong>
                <span class="control-days">${nesteKontroll ? formatDate(nesteKontroll) : '<span style="color:#5E81AC;">Ikke satt</span>'}</span>
              </p>
              ${sisteKontroll ? `<p style="font-size: 11px; color: var(--color-text-muted, #b3b3b3); margin-top: 4px;">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
            </div>`;
        }

        let html = '<div class="popup-control-info">';
        typesToShow.forEach(st => {
          let nesteKontroll = null;
          let sisteKontroll = null;
          let intervall = null;

          // Check customer service data first
          const serviceData = (customer.services || []).find(s =>
            s.service_type_slug === st.slug || s.service_type_id === st.id
          );
          if (serviceData) {
            nesteKontroll = serviceData.neste_kontroll;
            sisteKontroll = serviceData.siste_kontroll;
          }

          // Fallback to legacy columns based on slug
          if (st.slug === 'el-kontroll') {
            if (!nesteKontroll) nesteKontroll = customer.neste_el_kontroll;
            if (!sisteKontroll) sisteKontroll = customer.siste_el_kontroll;
            if (!intervall) intervall = customer.el_kontroll_intervall;
          } else if (st.slug === 'brannvarsling') {
            if (!nesteKontroll) nesteKontroll = customer.neste_brann_kontroll;
            if (!sisteKontroll) sisteKontroll = customer.siste_brann_kontroll;
            if (!intervall) intervall = customer.brann_kontroll_intervall;
          }

          // Final fallback to generic columns
          if (!nesteKontroll) nesteKontroll = customer.neste_kontroll;
          if (!sisteKontroll) sisteKontroll = customer.siste_kontroll || customer.last_visit_date;
          if (!intervall) intervall = customer.kontroll_intervall_mnd || st.defaultInterval;

          html += `
            <div style="margin-bottom:8px;">
              <p style="margin:0;">
                <strong><i aria-hidden="true" class="fas ${st.icon || 'fa-clipboard-check'}" style="color:${st.color || '#3B82F6'};"></i> ${escapeHtml(st.name)}:</strong>
              </p>
              <p style="margin:2px 0 0 20px;font-size:13px;">Neste: ${nesteKontroll ? formatDate(nesteKontroll) : '<span style="color:#5E81AC;">Ikke satt</span>'}</p>
              ${sisteKontroll ? `<p style="margin:2px 0 0 20px;font-size:11px;color:var(--color-text-muted, #b3b3b3);">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
            </div>`;
        });
        html += '</div>';
        return html;
      }

      // Single service type - simple view
      const st = serviceTypes[0];
      let nesteKontroll = null;
      let sisteKontroll = null;

      const serviceData = (customer.services || []).find(s =>
        s.service_type_slug === st.slug || s.service_type_id === st.id
      );
      if (serviceData) {
        nesteKontroll = serviceData.neste_kontroll;
        sisteKontroll = serviceData.siste_kontroll;
      }
      if (st.slug === 'el-kontroll') {
        if (!nesteKontroll) nesteKontroll = customer.neste_el_kontroll;
        if (!sisteKontroll) sisteKontroll = customer.siste_el_kontroll;
      } else if (st.slug === 'brannvarsling') {
        if (!nesteKontroll) nesteKontroll = customer.neste_brann_kontroll;
        if (!sisteKontroll) sisteKontroll = customer.siste_brann_kontroll;
      }
      if (!nesteKontroll) nesteKontroll = customer.neste_kontroll;
      if (!sisteKontroll) sisteKontroll = customer.siste_kontroll || customer.last_visit_date;

      return `
        <div class="popup-control-info">
          <p class="popup-status ${controlStatus.class}">
            <strong><i aria-hidden="true" class="fas ${st.icon || 'fa-clipboard-check'}" style="color:${st.color || '#3B82F6'};display:inline-block;width:14px;text-align:center;"></i> Neste kontroll:</strong>
            <span class="control-days">${nesteKontroll ? formatDate(nesteKontroll) : '<span style="color:#5E81AC;">Ikke satt</span>'}</span>
          </p>
          ${sisteKontroll ? `<p style="font-size: 11px; color: var(--color-text-muted, #b3b3b3); margin-top: 4px;">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
        </div>`;
    }

    const isCombined = kategori.includes('+');

    if (isCombined && serviceTypes.length >= 2) {
      // Filter service types to only those in the customer's kategori
      const kundeKats = kategori.split(' + ').map(s => s.trim());
      const relevantTypes = serviceTypes.filter(st => kundeKats.includes(st.name));
      const typesToShow = relevantTypes.length > 0 ? relevantTypes : serviceTypes;

      let html = '<div class="popup-controls">';
      typesToShow.forEach(st => {
        const serviceData = (customer.services || []).find(s =>
          s.service_type_slug === st.slug || s.service_type_id === st.id
        );
        let nesteKontroll = serviceData?.neste_kontroll;
        let sisteKontroll = serviceData?.siste_kontroll;

        if (!nesteKontroll && st.slug === 'el-kontroll') {
          nesteKontroll = customer.neste_el_kontroll;
          sisteKontroll = customer.siste_el_kontroll;
        } else if (!nesteKontroll && st.slug === 'brannvarsling') {
          nesteKontroll = customer.neste_brann_kontroll;
          sisteKontroll = customer.siste_brann_kontroll;
        }

        html += `
          <p><strong><i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color};"></i> ${st.name}:</strong></p>
          <p style="margin-left: 20px;">Neste: ${nesteKontroll ? escapeHtml(nesteKontroll) : 'Ikke satt'}</p>
          ${sisteKontroll ? `<p style="margin-left: 20px; font-size: 11px; color: var(--color-text-muted, #b3b3b3);">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
        `;
      });
      html += '</div>';
      return html;
    }

    const matchedSt = serviceTypes.find(st =>
      kategori === st.name || kategori.toLowerCase().includes(st.slug.toLowerCase())
    ) || serviceTypes[0];

    if (!matchedSt) {
      return `
        <div class="popup-control-info">
          <p class="popup-status ${controlStatus.class}">
            <strong>Neste kontroll:</strong>
            <span class="control-days">${escapeHtml(controlStatus.label)}</span>
          </p>
        </div>`;
    }

    const serviceData = (customer.services || []).find(s =>
      s.service_type_slug === matchedSt.slug || s.service_type_id === matchedSt.id
    );
    let sisteKontroll = serviceData?.siste_kontroll;

    if (!sisteKontroll) {
      if (matchedSt.slug === 'el-kontroll') {
        sisteKontroll = customer.siste_el_kontroll;
      } else if (matchedSt.slug === 'brannvarsling') {
        sisteKontroll = customer.siste_brann_kontroll;
      } else {
        sisteKontroll = customer.siste_kontroll;
      }
    }

    return `
      <div class="popup-control-info">
        <p class="popup-status ${controlStatus.class}">
          <strong><i aria-hidden="true" class="fas ${matchedSt.icon}" style="color: ${matchedSt.color};"></i> Neste kontroll:</strong>
          <span class="control-days">${escapeHtml(controlStatus.label)}</span>
        </p>
        ${sisteKontroll ? `<p style="font-size: 11px; color: var(--color-text-muted, #b3b3b3); margin-top: 4px;">Sist: ${formatDate(sisteKontroll)}</p>` : ''}
      </div>`;
  }

  /**
   * Parse custom_data field which may be string or object
   * @param {string|Object} customData - Customer custom_data field
   * @returns {Object} Parsed custom data object
   */
  parseCustomData(customData) {
    if (!customData) return {};
    if (typeof customData === 'object') return customData;
    try { return JSON.parse(customData); } catch { return {}; }
  }

  /**
   * Get appropriate label for subtype based on service type
   * @param {Object} serviceType - Service type object
   * @returns {string} Human-readable label
   */
  getSubtypeLabel(serviceType) {
    // Use industry-specific labels for known service types
    if (serviceType.slug === 'el-kontroll') return 'El-type';
    if (serviceType.slug === 'brannvarsling') return 'Driftstype';
    // Generic label based on service type name
    return `${serviceType.name} type`;
  }

  /**
   * Get appropriate label for equipment based on service type
   * @param {Object} serviceType - Service type object
   * @returns {string} Human-readable label
   */
  getEquipmentLabel(serviceType) {
    if (serviceType.slug === 'brannvarsling') return 'Brannsystem';
    // Generic label
    return `${serviceType.name} utstyr`;
  }

  /**
   * Get subtype value for a customer and service type
   * Checks services array, legacy fields, and custom_data
   * @param {Object} customer - Customer object
   * @param {Object} serviceType - Service type object
   * @returns {string|null} Subtype value or null
   */
  getCustomerSubtypeValue(customer, serviceType) {
    const service = (customer.services || []).find(s =>
      s.service_type_id === serviceType.id || s.service_type_slug === serviceType.slug
    );
    if (service?.subtype_name) return service.subtype_name;

    const customData = this.parseCustomData(customer.custom_data);
    return customData[`${serviceType.slug}_subtype`] || null;
  }

  getCustomerEquipmentValue(customer, serviceType) {
    const service = (customer.services || []).find(s =>
      s.service_type_id === serviceType.id || s.service_type_slug === serviceType.slug
    );
    if (service?.equipment_name) return service.equipment_name;

    const customData = this.parseCustomData(customer.custom_data);
    return customData[`${serviceType.slug}_equipment`] || null;
  }

  // renderPopupIndustryFields() removed — replaced by renderPopupSubcategories() in map-core.js
}

// Global service type registry instance
const serviceTypeRegistry = new ServiceTypeRegistry();

// Update control section headers dynamically based on service types
function updateControlSectionHeaders() {
  const elService = serviceTypeRegistry.getBySlug('el-kontroll');
  const brannService = serviceTypeRegistry.getBySlug('brannvarsling');

  const elHeader = document.querySelector('#elKontrollSection .control-section-header');
  if (elHeader && elService) {
    elHeader.innerHTML = `<i aria-hidden="true" class="fas ${escapeHtml(elService.icon)}" style="color: ${escapeHtml(elService.color)}"></i> ${escapeHtml(elService.name)}`;
  }

  const brannHeader = document.querySelector('#brannvarslingSection .control-section-header');
  if (brannHeader && brannService) {
    brannHeader.innerHTML = `<i aria-hidden="true" class="fas ${escapeHtml(brannService.icon)}" style="color: ${escapeHtml(brannService.color)}"></i> ${escapeHtml(brannService.name)}`;
  }
}



// ========================================
// SMART ROUTE ENGINE
// Geografisk klynging med effektivitetsberegning
// ========================================

const SmartRouteEngine = {
  // Bruker-konfigurerbare parametere
  params: {
    daysAhead: parseInt(localStorage.getItem('smartRoute_daysAhead')) || 60,
    maxCustomersPerRoute: parseInt(localStorage.getItem('smartRoute_maxCustomers')) || 15,
    maxDrivingTimeMinutes: parseInt(localStorage.getItem('smartRoute_maxDrivingTime')) || 480,
    minClusterSize: 3,
    clusterRadiusKm: parseFloat(localStorage.getItem('smartRoute_clusterRadius')) || 5,
    serviceTimeMinutes: 30
  },

  // State
  clusters: [],
  selectedClusterId: null,
  clusterLayer: null,
  showAllRecommendations: false,

  // Lagre parametere til localStorage
  saveParams() {
    localStorage.setItem('smartRoute_daysAhead', this.params.daysAhead);
    localStorage.setItem('smartRoute_maxCustomers', this.params.maxCustomersPerRoute);
    localStorage.setItem('smartRoute_maxDrivingTime', this.params.maxDrivingTimeMinutes);
    localStorage.setItem('smartRoute_clusterRadius', this.params.clusterRadiusKm);
  },

  // Haversine-avstand mellom to punkter (km)
  haversineDistance(lat1, lng1, lat2, lng2) {
    // Valider at alle koordinater er gyldige tall
    if (!Number.isFinite(lat1) || !Number.isFinite(lng1) ||
        !Number.isFinite(lat2) || !Number.isFinite(lng2)) {
      return Infinity; // Ugyldig avstand - vil bli filtrert ut
    }
    const R = 6371; // Jordens radius i km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  // Beregn sentroid for en gruppe kunder
  getCentroid(customerList) {
    if (customerList.length === 0) return null;
    const sumLat = customerList.reduce((sum, c) => sum + c.lat, 0);
    const sumLng = customerList.reduce((sum, c) => sum + c.lng, 0);
    return {
      lat: sumLat / customerList.length,
      lng: sumLng / customerList.length
    };
  },

  // Beregn bounding box for en gruppe kunder
  getBoundingBox(customerList) {
    const lats = customerList.map(c => c.lat);
    const lngs = customerList.map(c => c.lng);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs)
    };
  },

  // Filtrer kunder som trenger kontroll
  getCustomersNeedingControl() {
    // Sjekk at customers array er tilgjengelig og gyldig
    if (!customers || !Array.isArray(customers) || customers.length === 0) {
      return [];
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + this.params.daysAhead);

    return customers.filter(c => {
      if (!c) return false; // Hopp over null/undefined kunder
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return false; // Må ha gyldige koordinater
      const nextDate = getNextControlDate(c);
      if (!nextDate || !(nextDate instanceof Date) || isNaN(nextDate.getTime())) return false;
      return nextDate <= futureDate;
    });
  },

  // DBSCAN-klynging
  dbscanClustering(customerList, epsilon, minPoints) {
    const n = customerList.length;
    if (n === 0) return [];

    const visited = new Array(n).fill(false);
    const noise = new Array(n).fill(false);
    const clusterIds = new Array(n).fill(-1);
    let currentCluster = 0;

    // Bygg spatial grid for raskere nabo-oppslag (O(1) per celle i stedet for O(n))
    const cellSizeKm = epsilon; // Cellestørrelse lik epsilon
    const cellSizeDeg = cellSizeKm / 111; // Konverter km til grader (approx)
    const grid = {};

    // Plasser alle kunder i grid-celler
    customerList.forEach((c, idx) => {
      const cellX = Math.floor(c.lng / cellSizeDeg);
      const cellY = Math.floor(c.lat / cellSizeDeg);
      const key = `${cellX},${cellY}`;
      if (!grid[key]) grid[key] = [];
      grid[key].push(idx);
    });

    // Finn naboer via grid (sjekker kun 9 nærliggende celler)
    const getNeighbors = (pointIndex) => {
      const neighbors = [];
      const p = customerList[pointIndex];
      const cellX = Math.floor(p.lng / cellSizeDeg);
      const cellY = Math.floor(p.lat / cellSizeDeg);

      // Sjekk 3x3 celler rundt punktet
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${cellX + dx},${cellY + dy}`;
          const cellIndices = grid[key];
          if (cellIndices) {
            for (const i of cellIndices) {
              if (i !== pointIndex) {
                const dist = this.haversineDistance(p.lat, p.lng, customerList[i].lat, customerList[i].lng);
                if (dist <= epsilon) {
                  neighbors.push(i);
                }
              }
            }
          }
        }
      }
      return neighbors;
    };

    // Ekspander klynge (optimalisert med Set for O(1) lookup)
    const expandCluster = (pointIndex, neighbors, clusterId) => {
      clusterIds[pointIndex] = clusterId;
      const queue = [...neighbors];
      const queueSet = new Set(neighbors); // O(1) lookup i stedet for O(n)

      while (queue.length > 0) {
        const currentIndex = queue.shift();

        if (!visited[currentIndex]) {
          visited[currentIndex] = true;
          const currentNeighbors = getNeighbors(currentIndex);

          if (currentNeighbors.length >= minPoints) {
            for (const neighbor of currentNeighbors) {
              if (!queueSet.has(neighbor) && clusterIds[neighbor] === -1) {
                queue.push(neighbor);
                queueSet.add(neighbor);
              }
            }
          }
        }

        if (clusterIds[currentIndex] === -1) {
          clusterIds[currentIndex] = clusterId;
        }
      }
    };

    // Hovedløkke
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      visited[i] = true;

      const neighbors = getNeighbors(i);

      if (neighbors.length < minPoints) {
        noise[i] = true;
      } else {
        expandCluster(i, neighbors, currentCluster);
        currentCluster++;
      }
    }

    // Grupper kunder etter klynge-ID
    const clusters = [];
    for (let clusterId = 0; clusterId < currentCluster; clusterId++) {
      const clusterCustomers = customerList.filter((_, idx) => clusterIds[idx] === clusterId);
      if (clusterCustomers.length >= minPoints) {
        clusters.push(clusterCustomers);
      }
    }

    return clusters;
  },

  // Beregn effektivitetsscore for en klynge
  calculateClusterEfficiency(cluster) {
    const n = cluster.length;
    if (n < 2) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start-lokasjon (fra config eller default)
    const startLat = appConfig.routeStartLat || 59.9139;
    const startLng = appConfig.routeStartLng || 10.7522;

    // Sentroid
    const centroid = this.getCentroid(cluster);

    // Avstand fra start til sentroid
    const distanceToStart = this.haversineDistance(startLat, startLng, centroid.lat, centroid.lng);

    // Klyngens kompakthet (gjennomsnittlig avstand fra sentroid)
    const avgDistanceFromCentroid = cluster.reduce((sum, c) =>
      sum + this.haversineDistance(c.lat, c.lng, centroid.lat, centroid.lng), 0
    ) / n;

    // Kundetetthet (kunder per km²)
    const bbox = this.getBoundingBox(cluster);
    const latDiff = (bbox.maxLat - bbox.minLat) * 111; // ~111 km per grad lat
    const lngDiff = (bbox.maxLng - bbox.minLng) * 111 * Math.cos(centroid.lat * Math.PI / 180);
    const area = Math.max(latDiff * lngDiff, 0.1); // Minimum 0.1 km²
    const density = n / area;

    // Tell forfalte kunder
    const overdueCount = cluster.filter(c => {
      const nextDate = getNextControlDate(c);
      return nextDate && nextDate < today;
    }).length;

    // Estimert kjøretid (minutter)
    // - Tur-retur til klynge: avstand * 2 / 50 km/t * 60 min
    // - Intra-klynge kjøring: gjennomsnittlig avstand * antall * 2 / 30 km/t * 60 min
    // - Servicetid per kunde
    const travelToCluster = (distanceToStart * 2 / 50) * 60;
    const intraClusterTravel = (avgDistanceFromCentroid * n * 1.5 / 30) * 60;
    const serviceTime = n * this.params.serviceTimeMinutes;
    const estimatedMinutes = Math.round(travelToCluster + intraClusterTravel + serviceTime);

    // Estimert distanse (km)
    const estimatedKm = Math.round(distanceToStart * 2 + avgDistanceFromCentroid * n * 1.5);

    // Effektivitetsscore (0-100)
    // Høyere er bedre: belønner tetthet og antall, straffer lang avstand
    let rawScore = (density * n * 10) / (1 + distanceToStart * 0.05 + avgDistanceFromCentroid * 0.3);


    const efficiencyScore = Math.min(100, Math.round(rawScore * 10));

    // Finn primært område (mest vanlige poststed)
    const areaCount = {};
    cluster.forEach(c => {
      const area = c.poststed || 'Ukjent';
      areaCount[area] = (areaCount[area] || 0) + 1;
    });
    const sortedAreas = Object.entries(areaCount).sort((a, b) => b[1] - a[1]);
    const primaryArea = sortedAreas.length > 0 ? sortedAreas[0][0] : 'Ukjent';

    // Kategorier i klyngen
    const categories = [...new Set(cluster.map(c => c.kategori).filter(Boolean))];

    return {
      customers: cluster,
      customerCount: n,
      centroid,
      primaryArea,
      categories,
      overdueCount,
      upcomingCount: n - overdueCount,
      efficiencyScore,
      estimatedMinutes,
      estimatedKm,
      density: Math.round(density * 10) / 10,
      avgDistanceFromCentroid: Math.round(avgDistanceFromCentroid * 10) / 10,
      distanceToStart: Math.round(distanceToStart)
    };
  },

  // Enhanced efficiency calculation using Mapbox Matrix API (real travel times)
  async calculateClusterEfficiencyWithMatrix(cluster) {
    const basic = this.calculateClusterEfficiency(cluster);
    if (!basic || cluster.length < 2) return basic;

    if (typeof MatrixService === 'undefined') return basic;

    const routeStart = getRouteStartLocation();
    if (!routeStart) return basic;

    const coords = [
      [routeStart.lng, routeStart.lat],
      ...cluster.filter(c => c.lat && c.lng).map(c => [c.lng, c.lat])
    ];

    // Only use matrix for clusters up to 24 customers (25 - 1 office)
    if (coords.length > 25 || coords.length < 3) return basic;

    const matrix = await MatrixService.getMatrix(coords, {
      sources: '0',
      destinations: 'all'
    });

    if (!matrix || !matrix.durations || !matrix.durations[0]) return basic;

    // Office → each customer times
    const officeTimes = matrix.durations[0].slice(1);
    const officeDistances = matrix.distances ? matrix.distances[0].slice(1) : [];
    const validTimes = officeTimes.filter(t => t !== null && t > 0);

    if (validTimes.length === 0) return basic;

    const avgTravelToCluster = validTimes.reduce((a, b) => a + b, 0) / validTimes.length;

    // Override estimated minutes with real data
    const serviceTime = cluster.length * this.params.serviceTimeMinutes;
    const travelToClusterMin = Math.round(avgTravelToCluster / 60) * 2; // round trip
    basic.estimatedMinutes = travelToClusterMin + serviceTime;

    if (officeDistances.length > 0) {
      const validDist = officeDistances.filter(d => d !== null && d > 0);
      if (validDist.length > 0) {
        basic.estimatedKm = Math.round(validDist.reduce((a, b) => a + b, 0) / 1000 * 2);
      }
    }

    basic.matrixBased = true;
    return basic;
  },

  // Generer anbefalinger
  generateRecommendations() {
    const customersNeedingControl = this.getCustomersNeedingControl();

    Logger.log('SmartRouteEngine: Kunder som trenger kontroll:', customersNeedingControl.length);

    if (customersNeedingControl.length < this.params.minClusterSize) {
      Logger.log('SmartRouteEngine: For få kunder, prøver fallback til område-basert');
      // Fallback til område-basert gruppering
      return this.generateAreaBasedRecommendations(customersNeedingControl);
    }

    // DBSCAN-klynging
    let rawClusters = this.dbscanClustering(
      customersNeedingControl,
      this.params.clusterRadiusKm,
      this.params.minClusterSize
    );

    Logger.log('SmartRouteEngine: DBSCAN fant', rawClusters.length, 'klynger');

    // Hvis DBSCAN ikke finner noe, prøv med større radius eller fallback
    if (rawClusters.length === 0 && customersNeedingControl.length >= 3) {
      Logger.log('SmartRouteEngine: Ingen DBSCAN-klynger, prøver større radius');
      // Prøv med dobbel radius
      rawClusters = this.dbscanClustering(
        customersNeedingControl,
        this.params.clusterRadiusKm * 2,
        this.params.minClusterSize
      );

      // Hvis fortsatt ingen, bruk område-basert fallback
      if (rawClusters.length === 0) {
        Logger.log('SmartRouteEngine: Bruker område-basert fallback');
        return this.generateAreaBasedRecommendations(customersNeedingControl);
      }
    }

    // Beregn effektivitet for hver klynge
    const scoredClusters = rawClusters
      .map((cluster, idx) => {
        const efficiency = this.calculateClusterEfficiency(cluster);
        if (!efficiency) return null;

        // Filtrer ut klynger som tar for lang tid
        if (efficiency.estimatedMinutes > this.params.maxDrivingTimeMinutes) {
          // Del opp i mindre klynger hvis for stor
          if (cluster.length > this.params.maxCustomersPerRoute) {
            return null; // For nå, hopp over
          }
        }

        // Begrens antall kunder per rute
        if (cluster.length > this.params.maxCustomersPerRoute) {
          // Ta de nærmeste til sentroiden
          const sorted = [...cluster].sort((a, b) => {
            const distA = this.haversineDistance(a.lat, a.lng, efficiency.centroid.lat, efficiency.centroid.lng);
            const distB = this.haversineDistance(b.lat, b.lng, efficiency.centroid.lat, efficiency.centroid.lng);
            return distA - distB;
          });
          const trimmed = sorted.slice(0, this.params.maxCustomersPerRoute);
          return this.calculateClusterEfficiency(trimmed);
        }

        return { ...efficiency, id: idx };
      })
      .filter(Boolean);

    // Sorter etter effektivitetsscore (høyest først)
    this.clusters = scoredClusters
      .sort((a, b) => b.efficiencyScore - a.efficiencyScore)
      .map((cluster, idx) => ({ ...cluster, id: idx }));

    return this.clusters;
  },

  // Vis/skjul klynge på kartet (toggle)
  showClusterOnMap(clusterId) {
    const cluster = this.clusters.find(c => c.id === clusterId);
    if (!cluster) return;

    // Sjekk at kart er initialisert
    if (!map) {
      showToast('Kartet er ikke lastet enda', 'warning');
      return;
    }

    // Toggle: Hvis samme klynge allerede vises, skjul den
    if (this.selectedClusterId === clusterId) {
      this.clearClusterVisualization();
      this.updateClusterButtons(); // Oppdater knapper
      return;
    }

    this.clearClusterVisualization();
    this.selectedClusterId = clusterId;
    this.updateClusterButtons(); // Oppdater knapper

    // Track layer IDs for cleanup
    this.clusterLayerIds = [];
    this._clusterMarkers = [];

    // Tegn convex hull polygon rundt kundene
    const positions = cluster.customers.map(c => [c.lat, c.lng]);
    if (positions.length >= 3) {
      const hull = this.convexHull(positions);
      const hullCoords = hull.map(p => [p[1], p[0]]);
      hullCoords.push(hullCoords[0]); // close the ring
      const srcId = 'sre-cluster-hull';
      map.addSource(srcId, {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [hullCoords] } }
      });
      map.addLayer({ id: srcId + '-fill', type: 'fill', source: srcId, paint: { 'fill-color': '#ff6b00', 'fill-opacity': 0.15 } });
      map.addLayer({ id: srcId + '-line', type: 'line', source: srcId, paint: { 'line-color': '#ff6b00', 'line-width': 2, 'line-dasharray': [5, 5] } });
      this.clusterLayerIds.push(srcId + '-fill', srcId + '-line', srcId);
    }

    // Marker kunder i klyngen
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dotFeatures = cluster.customers.map(c => {
      const nextDate = getNextControlDate(c);
      const isOverdue = nextDate && nextDate < today;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
        properties: {
          color: isOverdue ? '#e74c3c' : '#f39c12',
          navn: c.navn, adresse: c.adresse || '',
          status: isOverdue ? 'Forfalt' : 'Kommende'
        }
      };
    });
    const dotSrcId = 'sre-cluster-dots';
    map.addSource(dotSrcId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: dotFeatures }
    });
    map.addLayer({
      id: dotSrcId, type: 'circle', source: dotSrcId,
      paint: {
        'circle-radius': 10, 'circle-color': ['get', 'color'],
        'circle-stroke-width': 2, 'circle-stroke-color': ['get', 'color'],
        'circle-opacity': 0.8
      }
    });
    this.clusterLayerIds.push(dotSrcId);

    // Click on dot shows popup
    map.on('click', dotSrcId, (e) => {
      const props = e.features[0].properties;
      showMapPopup(e.lngLat, `
        <strong>${escapeHtml(props.navn)}</strong><br>
        ${escapeHtml(props.adresse)}<br>
        <small>${props.status}</small>
      `);
    });

    // Marker sentroiden
    const centroidEl = createMarkerElement('cluster-centroid-marker',
      '<div class="centroid-icon"><i aria-hidden="true" class="fas fa-crosshairs"></i></div>', [30, 30]);
    const centroidMarker = new mapboxgl.Marker({ element: centroidEl })
      .setLngLat([cluster.centroid.lng, cluster.centroid.lat])
      .addTo(map);
    this._clusterMarkers.push(centroidMarker);

    // Zoom til klyngen
    const bounds = boundsFromLatLngArray(positions);
    map.fitBounds(bounds, { padding: 50 });

    // Oppdater knapper etter visning
    this.updateClusterButtons();
  },

  // Fjern klynge-visualisering
  clearClusterVisualization() {
    if (this.clusterLayerIds && map) {
      // Remove layers first, then sources
      for (const id of this.clusterLayerIds) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of this.clusterLayerIds) {
        if (map.getSource(id)) map.removeSource(id);
      }
      this.clusterLayerIds = [];
    }
    if (this._clusterMarkers) {
      this._clusterMarkers.forEach(m => m.remove());
      this._clusterMarkers = [];
    }
    this.selectedClusterId = null;
  },

  // Oppdater knapper etter toggle
  updateClusterButtons() {
    // Finn alle "Vis detaljer" knapper og oppdater tekst
    document.querySelectorAll('.recommendation-card.enhanced').forEach(card => {
      const clusterId = parseInt(card.dataset.clusterId);
      const btn = card.querySelector('.rec-actions .btn-secondary');
      if (btn) {
        if (clusterId === this.selectedClusterId) {
          btn.innerHTML = '<i aria-hidden="true" class="fas fa-eye-slash"></i> Skjul';
          card.classList.add('selected');
        } else {
          btn.innerHTML = '<i aria-hidden="true" class="fas fa-map"></i> Vis detaljer';
          card.classList.remove('selected');
        }
      }
    });
  },

  // Convex hull algoritme (Gift wrapping)
  convexHull(points) {
    if (points.length < 3) return points;

    const cross = (o, a, b) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

    // Finn startpunkt (lavest lat, med tiebreaker på lng)
    let start = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i][0] < points[start][0] ||
         (points[i][0] === points[start][0] && points[i][1] < points[start][1])) {
        start = i;
      }
    }

    const hull = [];
    let current = start;

    do {
      hull.push(points[current]);
      let next = 0;

      for (let i = 1; i < points.length; i++) {
        if (next === current || cross(points[current], points[next], points[i]) < 0) {
          next = i;
        }
      }

      current = next;
    } while (current !== start && hull.length < points.length);

    return hull;
  },

  // Opprett rute fra klynge
  createRouteFromCluster(clusterId) {
    const cluster = this.clusters.find(c => c.id === clusterId);
    if (!cluster) return;

    const customerIds = cluster.customers.map(c => c.id);
    createRouteFromCustomerIds(customerIds);
    showToast(`${cluster.customerCount} kunder valgt fra ${cluster.primaryArea}. Beregner rute...`);
    // Auto-calculate route after selecting customers
    planRoute();
  },

  // Fallback: Område-basert gruppering (som den gamle metoden)
  generateAreaBasedRecommendations(customersNeedingControl) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Hvis ingen kunder sendt inn, hent alle som trenger kontroll
    const customerList = customersNeedingControl.length > 0
      ? customersNeedingControl
      : this.getCustomersNeedingControl();

    if (customerList.length === 0) {
      this.clusters = [];
      return [];
    }

    // Grupper etter poststed
    const byArea = {};
    customerList.forEach(c => {
      const area = c.poststed || 'Ukjent';
      if (!byArea[area]) byArea[area] = [];
      byArea[area].push(c);
    });

    // Konverter til klynge-format med effektivitetsberegning
    const areaRecommendations = Object.entries(byArea)
      .filter(([area, custs]) => custs.length >= 2) // Minimum 2 kunder per område
      .map(([area, custs], idx) => {
        // Filtrer til kun kunder med koordinater
        const withCoords = custs.filter(c => c.lat && c.lng);
        if (withCoords.length < 2) return null;

        // Beregn effektivitet
        const efficiency = this.calculateClusterEfficiency(withCoords);
        if (!efficiency) return null;

        return {
          ...efficiency,
          id: idx,
          isAreaBased: true // Marker at dette er område-basert, ikke DBSCAN
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.efficiencyScore - a.efficiencyScore);

    this.clusters = areaRecommendations.map((cluster, idx) => ({ ...cluster, id: idx }));

    Logger.log('SmartRouteEngine: Område-basert fallback fant', this.clusters.length, 'klynger');

    return this.clusters;
  }
};

/**
 * Get smart area recommendations for route planning
 * Groups customers by poststed who need control within daysAhead days
 * @deprecated Use SmartRouteEngine.generateRecommendations() instead
 */
function getSmartAreaRecommendations(daysAhead = 60, minCustomers = 3) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + daysAhead);

  // Find customers needing control within daysAhead days
  const needsControl = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    return nextDate <= futureDate;
  });

  // Group by poststed
  const byArea = {};
  needsControl.forEach(c => {
    const area = c.poststed || 'Ukjent';
    if (!byArea[area]) byArea[area] = [];
    byArea[area].push(c);
  });

  // Filter areas with at least minCustomers customers
  const recommendations = Object.entries(byArea)
    .filter(([area, custs]) => custs.length >= minCustomers)
    .map(([area, custs]) => ({
      area,
      customers: custs,
      count: custs.length,
      overdue: custs.filter(c => getNextControlDate(c) < today).length,
      categories: [...new Set(custs.map(c => c.kategori).filter(Boolean))]
    }))
    .sort((a, b) => b.count - a.count);

  return recommendations;
}

/**
 * Render smart recommendations in Ruteplanlegger tab
 * Uses SmartRouteEngine for geographic clustering
 */
function renderSmartRecommendations() {
  const container = document.getElementById('smartRecommendations');
  if (!container) return;

  // Oppdater SmartRouteEngine params fra HTML inputs
  const daysInput = document.getElementById('smartDaysAhead');
  const customersInput = document.getElementById('smartMaxCustomers');
  const radiusInput = document.getElementById('smartClusterRadius');

  if (daysInput) SmartRouteEngine.params.daysAhead = parseInt(daysInput.value) || 60;
  if (customersInput) SmartRouteEngine.params.maxCustomersPerRoute = parseInt(customersInput.value) || 15;
  if (radiusInput) SmartRouteEngine.params.clusterRadiusKm = parseFloat(radiusInput.value) || 5;

  // Lagre params
  SmartRouteEngine.saveParams();

  // Generer anbefalinger med SmartRouteEngine
  const recommendations = SmartRouteEngine.generateRecommendations();

  let html = '';

  if (recommendations.length === 0) {
    // Vis mer detaljert info om hvorfor ingen anbefalinger ble funnet
    const customersWithDates = customers.filter(c => getNextControlDate(c));
    const customersWithCoords = customers.filter(c => c.lat && c.lng);
    const needingControl = SmartRouteEngine.getCustomersNeedingControl();

    let emptyMessage = 'Ingen ruteklynger funnet.';
    let emptyHint = '';

    if (customers.length === 0) {
      emptyMessage = 'Ingen kunder i systemet.';
    } else if (customersWithCoords.length === 0) {
      emptyMessage = 'Ingen kunder har koordinater.';
      emptyHint = 'Legg til adresser med koordinater for å få ruteanbefalinger.';
    } else if (customersWithDates.length === 0) {
      emptyMessage = 'Ingen kunder har kontrolldatoer.';
      emptyHint = 'Legg til neste kontrolldato for å få ruteanbefalinger.';
    } else if (needingControl.length === 0) {
      emptyMessage = 'Ingen kontroller forfaller innen ' + SmartRouteEngine.params.daysAhead + ' dager.';
      emptyHint = 'Prøv å øke "Dager fremover" i innstillingene.';
    } else if (needingControl.length < 3) {
      emptyMessage = 'Kun ' + needingControl.length + ' kunde(r) trenger kontroll.';
      emptyHint = 'Minimum 2 kunder trengs for å danne en rute.';
    }

    html += `
      <div class="rec-empty">
        <i aria-hidden="true" class="fas fa-info-circle"></i>
        <p>${emptyMessage}</p>
        ${emptyHint ? `<p class="rec-empty-hint">${emptyHint}</p>` : ''}
        <p class="rec-empty-stats">
          <small>${customers.length} kunder totalt | ${customersWithCoords.length} med koordinater | ${needingControl.length} trenger kontroll</small>
        </p>
      </div>`;
    container.innerHTML = html;
    return;
  }

  const maxVisible = SmartRouteEngine.showAllRecommendations ? recommendations.length : 6;
  recommendations.slice(0, maxVisible).forEach(rec => {
    // Bestem effektivitetsklasse
    let efficiencyClass = 'low';
    if (rec.efficiencyScore >= 70) efficiencyClass = 'high';
    else if (rec.efficiencyScore >= 40) efficiencyClass = 'medium';

    // Formater tid
    const hours = Math.floor(rec.estimatedMinutes / 60);
    const mins = rec.estimatedMinutes % 60;
    const timeStr = hours > 0 ? `${hours}t ${mins}m` : `${mins}m`;

    html += `
      <div class="recommendation-card enhanced ${SmartRouteEngine.selectedClusterId === rec.id ? 'selected' : ''}" data-cluster-id="${rec.id}">
        <div class="rec-header">
          <div class="rec-title">
            <span class="rec-cluster-id">#${rec.id + 1}</span>
            <h4><i aria-hidden="true" class="fas fa-map-pin"></i> ${escapeHtml(rec.primaryArea)}</h4>
          </div>
          <div class="rec-efficiency ${efficiencyClass}">
            <span class="efficiency-score">${rec.efficiencyScore}%</span>
            <span class="efficiency-label">effektivitet</span>
          </div>
        </div>

        <div class="rec-metrics">
          <div class="metric">
            <i aria-hidden="true" class="fas fa-users"></i>
            <span>${rec.customerCount} kunder</span>
          </div>
          <div class="metric">
            <i aria-hidden="true" class="fas fa-road"></i>
            <span>~${rec.estimatedKm} km</span>
          </div>
          <div class="metric">
            <i aria-hidden="true" class="fas fa-clock"></i>
            <span>~${timeStr}</span>
          </div>
          ${rec.overdueCount > 0 ? `
          <div class="metric urgency">
            <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
            <span>${rec.overdueCount} forfalte</span>
          </div>
          ` : ''}
        </div>

        <div class="rec-categories">
          ${rec.categories.map(c => `<span class="category-tag">${escapeHtml(c)}</span>`).join('') || '<span class="category-tag">Diverse</span>'}
        </div>

        <div class="rec-actions">
          <button class="btn btn-secondary btn-small" data-action="showClusterOnMap" data-cluster-id="${rec.id}">
            ${SmartRouteEngine.selectedClusterId === rec.id
              ? '<i aria-hidden="true" class="fas fa-eye-slash"></i> Skjul'
              : '<i aria-hidden="true" class="fas fa-map"></i> Vis detaljer'}
          </button>
          <button class="btn btn-primary btn-small" data-action="createRouteFromCluster" data-cluster-id="${rec.id}">
            <i aria-hidden="true" class="fas fa-route"></i> Opprett rute
          </button>
        </div>
      </div>
    `;
  });

  if (recommendations.length > 6) {
    if (SmartRouteEngine.showAllRecommendations) {
      html += `<button class="btn btn-link rec-toggle-all" data-action="toggleShowAllRecommendations">
        <i aria-hidden="true" class="fas fa-chevron-up"></i> Vis færre
      </button>`;
    } else {
      html += `<button class="btn btn-link rec-toggle-all" data-action="toggleShowAllRecommendations">
        <i aria-hidden="true" class="fas fa-chevron-down"></i> Vis alle ${recommendations.length} anbefalinger
      </button>`;
    }
  }

  container.innerHTML = html;
}

/**
 * Toggle showing all recommendations vs limited
 */
function toggleShowAllRecommendations() {
  SmartRouteEngine.showAllRecommendations = !SmartRouteEngine.showAllRecommendations;
  renderSmartRecommendations();
}

/**
 * Update smart route settings and regenerate recommendations
 */
function updateSmartRouteSettings() {
  // Hent verdier fra inputs
  const daysAhead = parseInt(document.getElementById('smartDaysAhead')?.value) || 60;
  const maxCustomers = parseInt(document.getElementById('smartMaxCustomers')?.value) || 15;
  const maxDrivingTime = parseInt(document.getElementById('smartMaxDrivingTime')?.value) || 480;
  const clusterRadius = parseFloat(document.getElementById('smartClusterRadius')?.value) || 5;

  // Oppdater SmartRouteEngine
  SmartRouteEngine.params.daysAhead = daysAhead;
  SmartRouteEngine.params.maxCustomersPerRoute = maxCustomers;
  SmartRouteEngine.params.maxDrivingTimeMinutes = maxDrivingTime;
  SmartRouteEngine.params.clusterRadiusKm = clusterRadius;

  // Lagre til localStorage
  SmartRouteEngine.saveParams();

  // Fjern eventuell klynge-visualisering
  SmartRouteEngine.clearClusterVisualization();

  // Regenerer anbefalinger
  renderSmartRecommendations();

  showToast('Innstillinger oppdatert');
}

// Flag for å unngå duplikate event listeners
let smartRouteListenersInitialized = false;

/**
 * Initialize smart route settings slider listeners and values
 */
function initSmartRouteSettingsListeners() {
  // Params er allerede lastet fra localStorage i SmartRouteEngine.params

  // Oppdater slider-verdier fra lagrede params
  const daysSlider = document.getElementById('smartDaysAhead');
  const customersSlider = document.getElementById('smartMaxCustomers');
  const radiusSlider = document.getElementById('smartClusterRadius');

  if (daysSlider) {
    daysSlider.value = SmartRouteEngine.params.daysAhead;
    const daysValue = document.getElementById('smartDaysAheadValue');
    if (daysValue) daysValue.textContent = `${SmartRouteEngine.params.daysAhead} dager`;
  }

  if (customersSlider) {
    customersSlider.value = SmartRouteEngine.params.maxCustomersPerRoute;
    const customersValue = document.getElementById('smartMaxCustomersValue');
    if (customersValue) customersValue.textContent = `${SmartRouteEngine.params.maxCustomersPerRoute} kunder`;
  }

  if (radiusSlider) {
    radiusSlider.value = SmartRouteEngine.params.clusterRadiusKm;
    const radiusValue = document.getElementById('smartClusterRadiusValue');
    if (radiusValue) radiusValue.textContent = `${SmartRouteEngine.params.clusterRadiusKm} km`;
  }

  // Bare legg til event listeners én gang - men kun hvis sliderne finnes
  if (smartRouteListenersInitialized) return;
  if (!daysSlider || !customersSlider || !radiusSlider) return; // Vent til DOM er klar
  smartRouteListenersInitialized = true;

  // Hjelpefunksjon for å vise tooltip ved slider
  const showSliderTooltip = (slider, value, unit) => {
    let tooltip = slider.parentElement.querySelector('.slider-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'slider-tooltip';
      slider.parentElement.style.position = 'relative';
      slider.parentElement.appendChild(tooltip);
    }

    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const percent = ((parseFloat(slider.value) - min) / (max - min)) * 100;

    tooltip.textContent = `${value}${unit}`;
    tooltip.style.left = `${percent}%`;
    tooltip.classList.add('visible');
  };

  const hideSliderTooltip = (slider) => {
    const tooltip = slider.parentElement.querySelector('.slider-tooltip');
    if (tooltip) {
      tooltip.classList.remove('visible');
    }
  };

  // Dager fremover
  if (daysSlider) {
    daysSlider.addEventListener('input', function() {
      const val = this.value;
      const valueEl = document.getElementById('smartDaysAheadValue');
      if (valueEl) valueEl.textContent = `${val} dager`;
      showSliderTooltip(this, val, ' dager');
    });
    daysSlider.addEventListener('mouseup', function() { hideSliderTooltip(this); });
    daysSlider.addEventListener('mouseleave', function() { hideSliderTooltip(this); });
    daysSlider.addEventListener('touchend', function() { hideSliderTooltip(this); });
  }

  // Maks kunder
  if (customersSlider) {
    customersSlider.addEventListener('input', function() {
      const val = this.value;
      const valueEl = document.getElementById('smartMaxCustomersValue');
      if (valueEl) valueEl.textContent = `${val} kunder`;
      showSliderTooltip(this, val, ' kunder');
    });
    customersSlider.addEventListener('mouseup', function() { hideSliderTooltip(this); });
    customersSlider.addEventListener('mouseleave', function() { hideSliderTooltip(this); });
    customersSlider.addEventListener('touchend', function() { hideSliderTooltip(this); });
  }

  // Klyngeradius
  if (radiusSlider) {
    radiusSlider.addEventListener('input', function() {
      const val = this.value;
      const valueEl = document.getElementById('smartClusterRadiusValue');
      if (valueEl) valueEl.textContent = `${val} km`;
      showSliderTooltip(this, val, ' km');
    });
    radiusSlider.addEventListener('mouseup', function() { hideSliderTooltip(this); });
    radiusSlider.addEventListener('mouseleave', function() { hideSliderTooltip(this); });
    radiusSlider.addEventListener('touchend', function() { hideSliderTooltip(this); });
  }
}

/**
 * Show customers from a specific area on the map
 */
function showAreaOnMap(area) {
  const areaCustomers = customers.filter(c => c.poststed === area);
  if (areaCustomers.length === 0) return;

  // Get valid customers with coordinates
  const validCustomers = areaCustomers.filter(c => c.lat && c.lng);

  if (validCustomers.length === 0) {
    showToast('Ingen kunder med koordinater i dette området', 'warning');
    return;
  }

  // Fit map to bounds
  const bounds = boundsFromCustomers(validCustomers);
  map.fitBounds(bounds, { padding: 50 });

  // Highlight the customers
  highlightCustomersOnMap(areaCustomers.map(c => c.id));

  showToast(`Viser ${areaCustomers.length} kunder i ${area}`);
}

/**
 * Create a route for customers in a specific area
 */
function createRouteForArea(area, customerIds) {
  if (!customerIds || customerIds.length === 0) {
    showToast('Ingen kunder å lage rute for', 'warning');
    return;
  }

  // Use existing route creation function
  createRouteFromCustomerIds(customerIds);
  switchToTab('routes');
  showToast(`Opprettet rute for ${area} med ${customerIds.length} kunder`);
}

/**
 * Highlight specific customers on the map with area highlight
 */
function highlightCustomersOnMap(customerIds) {
  // Clear previous highlights
  clearMapHighlights();

  window.highlightedCustomerIds = customerIds;
  window._highlightLayerIds = [];

  // Get positions of all customers to highlight
  const positions = [];
  customers.forEach(c => {
    if (customerIds.includes(c.id) && c.lat && c.lng) {
      positions.push([c.lng, c.lat]); // [lng, lat] for GeoJSON
    }
  });

  if (positions.length === 0) {
    showToast('Ingen kunder med koordinater funnet', 'warning');
    return;
  }

  // Add dot markers at each position
  const dotFeatures = positions.map(p => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: p }
  }));
  map.addSource('sre-highlight-dots', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: dotFeatures }
  });
  map.addLayer({
    id: 'sre-highlight-dots', type: 'circle', source: 'sre-highlight-dots',
    paint: {
      'circle-radius': 8, 'circle-color': '#ff6b00',
      'circle-stroke-width': 2, 'circle-stroke-color': '#ff6b00',
      'circle-opacity': 0.8
    }
  });
  window._highlightLayerIds.push('sre-highlight-dots');

  // Create area highlight around all points
  if (positions.length >= 3) {
    const hull = getConvexHull(positions.map(p => [p[1], p[0]])); // hull expects [lat,lng]
    const hullCoords = hull.map(p => [p[1], p[0]]);
    hullCoords.push(hullCoords[0]);
    map.addSource('sre-highlight-area', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [hullCoords] } }
    });
    map.addLayer({ id: 'sre-highlight-area-fill', type: 'fill', source: 'sre-highlight-area', paint: { 'fill-color': '#ff6b00', 'fill-opacity': 0.1 } });
    map.addLayer({ id: 'sre-highlight-area-line', type: 'line', source: 'sre-highlight-area', paint: { 'line-color': '#ff6b00', 'line-width': 3, 'line-dasharray': [8, 8] } });
    window._highlightLayerIds.push('sre-highlight-area-fill', 'sre-highlight-area-line', 'sre-highlight-area');
  } else if (positions.length === 2) {
    map.addSource('sre-highlight-line', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: positions } }
    });
    map.addLayer({ id: 'sre-highlight-line', type: 'line', source: 'sre-highlight-line', paint: { 'line-color': '#ff6b00', 'line-width': 4, 'line-dasharray': [8, 8] } });
    window._highlightLayerIds.push('sre-highlight-line');
  } else {
    // Single point - draw larger circle (approximate 500m radius)
    map.addSource('sre-highlight-circle', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'Point', coordinates: positions[0] } }
    });
    map.addLayer({
      id: 'sre-highlight-circle', type: 'circle', source: 'sre-highlight-circle',
      paint: {
        'circle-radius': 30, 'circle-color': '#ff6b00',
        'circle-stroke-width': 2, 'circle-stroke-color': '#ff6b00',
        'circle-opacity': 0.1
      }
    });
    window._highlightLayerIds.push('sre-highlight-circle');
  }

  // Show count
  showToast(`${positions.length} kunder i området markert`, 'success');
}

/**
 * Calculate convex hull of points (Graham scan algorithm)
 */
function getConvexHull(points) {
  if (points.length < 3) return points;

  // Find lowest point
  let lowest = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i][0] < points[lowest][0] ||
        (points[i][0] === points[lowest][0] && points[i][1] < points[lowest][1])) {
      lowest = i;
    }
  }

  // Swap lowest to first position
  [points[0], points[lowest]] = [points[lowest], points[0]];
  const pivot = points[0];

  // Sort by polar angle
  const sorted = points.slice(1).sort((a, b) => {
    const angleA = Math.atan2(a[0] - pivot[0], a[1] - pivot[1]);
    const angleB = Math.atan2(b[0] - pivot[0], b[1] - pivot[1]);
    return angleA - angleB;
  });

  // Build hull
  const hull = [pivot];
  for (const point of sorted) {
    while (hull.length > 1 && crossProduct(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
      hull.pop();
    }
    hull.push(point);
  }

  return hull;
}

function crossProduct(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Clear all map highlights
 */
function clearMapHighlights() {
  if (window._highlightLayerIds && map) {
    for (const id of window._highlightLayerIds) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of window._highlightLayerIds) {
      if (map.getSource(id)) map.removeSource(id);
    }
    window._highlightLayerIds = [];
  }
  window.highlightedCustomerIds = [];
}

/**
 * Switch to a specific tab
 */
function switchToTab(tabName) {
  const tabBtn = document.querySelector(`.tab-item[data-tab="${tabName}"]`);
  if (tabBtn) {
    tabBtn.click();
  }
}

// Sync map view to match the active tab context (mobile only)
function syncMapToTab(tabName) {
  if (!isMobile || !map) return;

  switch (tabName) {
    case 'customers': {
      const validCustomers = customers.filter(c => c.lat && c.lng);
      if (validCustomers.length > 0) {
        map.fitBounds(boundsFromCustomers(validCustomers), { padding: 30 });
      }
      break;
    }
    case 'routes': {
      // Route is now a GeoJSON source — try to get its bounds
      try {
        const src = map.getSource('route-line');
        if (src && src._data?.geometry?.coordinates) {
          const coords = src._data.geometry.coordinates;
          const b = new mapboxgl.LngLatBounds();
          coords.forEach(c => b.extend(c));
          map.fitBounds(b, { padding: 30 });
        }
      } catch (e) {
        // route source may not exist
      }
      break;
    }
    case 'overdue': {
      const now = new Date();
      const overdueCustomers = customers.filter(c => c.neste_kontroll && c.lat && c.lng && new Date(c.neste_kontroll) < now);
      if (overdueCustomers.length > 0) {
        map.fitBounds(boundsFromCustomers(overdueCustomers), { padding: 30 });
      }
      break;
    }
  }
}



// ========================================
// CHAT / MESSAGING SYSTEM
// ========================================

const chatState = {
  conversations: [],
  activeConversation: null,
  activeConversationType: null,
  messages: {},
  unreadCounts: {},
  totalUnread: 0,
  orgConversationId: null,
  typingUsers: {},
  view: 'list', // 'list' | 'messages' | 'newDm'
};

let chatTypingTimer = null;
let chatIsTyping = false;
let chatNotificationSound = null;

// Initialize notification sound (small beep)
function initChatSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    chatNotificationSound = audioCtx;
  } catch (e) {
    // Audio not supported
  }
}

function playChatNotificationSound() {
  try {
    if (!chatNotificationSound) initChatSound();
    if (!chatNotificationSound) return;
    const ctx = chatNotificationSound;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    // Silent fail
  }
}

// Build headers for chat API calls (includes CSRF token)
function chatHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return headers;
}

// Initialize chat system
async function initChat() {
  try {
    const response = await fetch('/api/chat/init', {
      method: 'POST',
      headers: chatHeaders(),
    });
    if (!response.ok) {
      console.error('Chat init failed:', response.status, response.statusText);
      try { console.error('Chat init body:', await response.text()); } catch {}
      return;
    }
    const result = await response.json();
    if (result.success && result.data) {
      chatState.orgConversationId = result.data.orgConversationId;
      chatState.totalUnread = result.data.totalUnread;
      updateChatBadge();
    }
  } catch (e) {
    console.error('Failed to init chat:', e);
  }
}

// Fetch conversations
async function loadChatConversations() {
  try {
    const response = await fetch('/api/chat/conversations');
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      chatState.conversations = result.data;
      // Update unread counts
      chatState.totalUnread = 0;
      chatState.unreadCounts = {};
      for (const conv of result.data) {
        if (conv.unread_count > 0) {
          chatState.unreadCounts[conv.id] = conv.unread_count;
          chatState.totalUnread += conv.unread_count;
        }
      }
      updateChatBadge();
      renderChatConversations();
    }
  } catch (e) {
    console.error('Failed to load conversations:', e);
  }
}

// Fetch messages for a conversation
async function loadChatMessages(conversationId, before) {
  try {
    let url = `/api/chat/conversations/${conversationId}/messages?limit=50`;
    if (before) url += `&before=${before}`;
    const response = await fetch(url);
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      if (before) {
        // Prepend older messages
        chatState.messages[conversationId] = [...result.data, ...(chatState.messages[conversationId] || [])];
      } else {
        chatState.messages[conversationId] = result.data;
      }
      renderChatMessages(conversationId);
    }
  } catch (e) {
    console.error('Failed to load messages:', e);
  }
}

// Send a message
async function sendChatMessage(conversationId, content) {
  if (!content.trim()) return;
  try {
    const response = await fetch(`/api/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: chatHeaders(),
      body: JSON.stringify({ content: content.trim() }),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result.success && result.data) {
      // Add message locally (optimistic)
      if (!chatState.messages[conversationId]) chatState.messages[conversationId] = [];
      chatState.messages[conversationId].push(result.data);
      renderChatMessages(conversationId);
      scrollChatToBottom();
      // Update conversation list
      loadChatConversations();
    }
  } catch (e) {
    console.error('Failed to send message:', e);
  }
}

// Mark conversation as read
async function markChatAsRead(conversationId) {
  const messages = chatState.messages[conversationId];
  if (!messages || messages.length === 0) return;
  const lastMsg = messages[messages.length - 1];
  try {
    await fetch(`/api/chat/conversations/${conversationId}/read`, {
      method: 'PUT',
      headers: chatHeaders(),
      body: JSON.stringify({ messageId: lastMsg.id }),
    });
    // Update local state
    const prevCount = chatState.unreadCounts[conversationId] || 0;
    chatState.totalUnread = Math.max(0, chatState.totalUnread - prevCount);
    delete chatState.unreadCounts[conversationId];
    updateChatBadge();
  } catch (e) {
    console.error('Failed to mark as read:', e);
  }
}

// Create or find DM conversation
async function startDmConversation(targetUserId) {
  try {
    const response = await fetch('/api/chat/conversations/dm', {
      method: 'POST',
      headers: chatHeaders(),
      body: JSON.stringify({ targetUserId }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (result.success && result.data) {
      return result.data.id;
    }
  } catch (e) {
    console.error('Failed to start DM:', e);
  }
  return null;
}

// Handle incoming chat message from WebSocket
function handleIncomingChatMessage(data) {
  const convId = data.conversation_id;
  // Add to local messages if we have this conversation loaded
  if (chatState.messages[convId]) {
    // Avoid duplicates
    if (!chatState.messages[convId].some(m => m.id === data.id)) {
      chatState.messages[convId].push(data);
    }
  }

  // Update unread count (if not viewing this conversation)
  const isViewingThis = chatState.activeConversation === convId && chatState.view === 'messages';
  if (!isViewingThis) {
    chatState.unreadCounts[convId] = (chatState.unreadCounts[convId] || 0) + 1;
    chatState.totalUnread++;
    updateChatBadge();
    playChatNotificationSound();
  } else {
    // Auto-mark as read if viewing
    markChatAsRead(convId);
    renderChatMessages(convId);
    scrollChatToBottom();
  }

  // Update conversation list
  renderChatConversations();

  // Remove typing indicator for this user
  handleChatTypingStop({ conversationId: convId, userId: data.sender_id });
}

// Handle typing indicator
function handleChatTyping(data) {
  const key = `${data.conversationId}-${data.userId}`;
  chatState.typingUsers[key] = data.userName;
  renderTypingIndicator(data.conversationId);
  // Auto-clear after 5 seconds
  setTimeout(() => {
    delete chatState.typingUsers[key];
    renderTypingIndicator(data.conversationId);
  }, 5000);
}

function handleChatTypingStop(data) {
  const key = `${data.conversationId}-${data.userId}`;
  delete chatState.typingUsers[key];
  renderTypingIndicator(data.conversationId);
}

// Send typing indicator
function sendChatTypingStart(conversationId) {
  if (chatIsTyping) return;
  chatIsTyping = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chat_typing_start', conversationId }));
  }
  clearTimeout(chatTypingTimer);
  chatTypingTimer = setTimeout(() => {
    chatIsTyping = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat_typing_stop', conversationId }));
    }
  }, 3000);
}

// Update chat badge
function updateChatBadge() {
  const badge = document.getElementById('chatUnreadBadge');
  if (!badge) return;
  if (chatState.totalUnread > 0) {
    badge.textContent = chatState.totalUnread > 99 ? '99+' : chatState.totalUnread;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// Format chat timestamp
function formatChatTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const time = d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return time;
  return d.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' }) + ' ' + time;
}

function formatChatDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'I dag';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'I g\u00e5r';
  return d.toLocaleDateString('no-NO', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Get initials from name
function getChatInitials(name) {
  if (!name) return '??';
  const parts = name.split(/[\s.\-_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

// Render conversation list
function renderChatConversations() {
  const container = document.getElementById('chatConversations');
  if (!container) return;

  if (chatState.conversations.length === 0) {
    container.innerHTML = `
      <div class="chat-empty-state">
        <i aria-hidden="true" class="fas fa-comments"></i>
        <p>Ingen samtaler enn\u00e5</p>
        <p>Start en ny samtale med en kollega</p>
      </div>`;
    return;
  }

  container.innerHTML = chatState.conversations.map(conv => {
    const unread = chatState.unreadCounts[conv.id] || 0;
    const isOrg = conv.type === 'org';
    const name = isOrg ? 'Teamchat' : escapeHtml(conv.participant_name || 'Ukjent');
    const icon = isOrg ? 'fa-users' : 'fa-user';
    const preview = conv.last_message
      ? escapeHtml(conv.last_message.content.substring(0, 50))
      : 'Ingen meldinger enn\u00e5';
    const time = conv.last_message ? formatChatTime(conv.last_message.created_at) : '';

    return `
      <div class="chat-conv-item ${unread > 0 ? 'unread' : ''}" data-conv-id="${conv.id}" data-conv-type="${conv.type}">
        <div class="chat-conv-icon"><i aria-hidden="true" class="fas ${icon}"></i></div>
        <div class="chat-conv-info">
          <div class="chat-conv-name">${name}</div>
          <div class="chat-conv-preview">${preview}</div>
        </div>
        <div class="chat-conv-meta">
          <span class="chat-conv-time">${time}</span>
          ${unread > 0 ? `<span class="chat-conv-unread">${unread}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  // Attach click handlers
  container.querySelectorAll('.chat-conv-item').forEach(item => {
    item.addEventListener('click', () => {
      const convId = parseInt(item.dataset.convId, 10);
      const convType = item.dataset.convType;
      openChatConversation(convId, convType);
    });
  });
}

// Open a conversation
async function openChatConversation(conversationId, type) {
  chatState.activeConversation = conversationId;
  chatState.activeConversationType = type;
  chatState.view = 'messages';

  // Set title
  const titleEl = document.getElementById('chatMessageTitle');
  if (type === 'org') {
    titleEl.textContent = 'Teamchat';
  } else {
    const conv = chatState.conversations.find(c => c.id === conversationId);
    titleEl.textContent = conv?.participant_name || 'Direktemelding';
  }

  // Show message view, hide others
  document.getElementById('chatConversationList').style.display = 'none';
  document.getElementById('chatNewDm').style.display = 'none';
  document.getElementById('chatMessageView').style.display = 'flex';

  // Load messages
  await loadChatMessages(conversationId);
  scrollChatToBottom();

  // Mark as read
  markChatAsRead(conversationId);
}

// Render messages
function renderChatMessages(conversationId) {
  const container = document.getElementById('chatMessages');
  if (!container || chatState.activeConversation !== conversationId) return;

  const messages = chatState.messages[conversationId] || [];
  if (messages.length === 0) {
    container.innerHTML = `
      <div class="chat-empty-state">
        <i aria-hidden="true" class="fas fa-comment-dots"></i>
        <p>Ingen meldinger enn\u00e5. Si hei!</p>
      </div>`;
    return;
  }

  // Group by date
  let lastDate = '';
  let html = '';

  // Load more button if we have exactly 50 messages (might be more)
  if (messages.length >= 50) {
    html += `<div class="chat-load-more"><button onclick="loadOlderChatMessages()">Last eldre meldinger</button></div>`;
  }

  for (const msg of messages) {
    const msgDate = new Date(msg.created_at).toDateString();
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      html += `<div class="chat-msg-date-separator">${formatChatDate(msg.created_at)}</div>`;
    }

    const isSelf = msg.sender_id === myUserId;
    const time = new Date(msg.created_at).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });

    html += `
      <div class="chat-msg ${isSelf ? 'self' : 'other'}">
        <div class="chat-msg-sender">${escapeHtml(msg.sender_name)}</div>
        <div class="chat-msg-content">${escapeHtml(msg.content)}</div>
        <div class="chat-msg-time">${time}</div>
      </div>`;
  }

  container.innerHTML = html;
}

// Scroll chat to bottom
function scrollChatToBottom() {
  const container = document.getElementById('chatMessages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

// Load older messages
function loadOlderChatMessages() {
  if (!chatState.activeConversation) return;
  const messages = chatState.messages[chatState.activeConversation] || [];
  if (messages.length === 0) return;
  const oldestId = messages[0].id;
  loadChatMessages(chatState.activeConversation, oldestId);
}

// Render typing indicator
function renderTypingIndicator(conversationId) {
  const indicator = document.getElementById('chatTypingIndicator');
  const text = document.getElementById('chatTypingText');
  if (!indicator || !text || chatState.activeConversation !== conversationId) return;

  const prefix = `${conversationId}-`;
  const typingNames = Object.entries(chatState.typingUsers)
    .filter(([key]) => key.startsWith(prefix))
    .map(([, name]) => name);

  if (typingNames.length === 0) {
    indicator.style.display = 'none';
  } else {
    indicator.style.display = '';
    if (typingNames.length === 1) {
      text.textContent = `${typingNames[0]} skriver...`;
    } else {
      text.textContent = `${typingNames.join(' og ')} skriver...`;
    }
  }
}

// Show new DM view
async function showNewDmView() {
  chatState.view = 'newDm';
  document.getElementById('chatConversationList').style.display = 'none';
  document.getElementById('chatMessageView').style.display = 'none';
  document.getElementById('chatNewDm').style.display = 'flex';

  const container = document.getElementById('chatTeamList');
  container.innerHTML = `
    <div class="chat-empty-state">
      <i aria-hidden="true" class="fas fa-spinner fa-spin"></i>
      <p>Laster teammedlemmer...</p>
    </div>`;

  // Load team members
  try {
    const response = await fetch('/api/chat/team-members');
    if (!response.ok) {
      console.error('Team members failed:', response.status, response.statusText);
      try { console.error('Team members body:', await response.text()); } catch {}
      container.innerHTML = `
        <div class="chat-empty-state">
          <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
          <p>Kunne ikke laste teammedlemmer</p>
          <p style="font-size:12px;opacity:0.7">Bruk Teamchat for \u00e5 sende melding til alle</p>
        </div>`;
      return;
    }
    const result = await response.json();
    if (result.success && result.data) {
      if (result.data.length === 0) {
        container.innerHTML = `
          <div class="chat-empty-state">
            <i aria-hidden="true" class="fas fa-user-slash"></i>
            <p>Ingen andre teammedlemmer funnet</p>
            <p style="font-size:12px;opacity:0.7">G\u00e5 tilbake og bruk Teamchat for \u00e5 sende melding til alle</p>
          </div>`;
        return;
      }

      container.innerHTML = result.data.map(member => `
        <div class="chat-team-item" data-user-id="${member.id}">
          <div class="chat-team-avatar">${getChatInitials(member.navn)}</div>
          <div class="chat-team-name">${escapeHtml(member.navn)}</div>
        </div>
      `).join('');

      container.querySelectorAll('.chat-team-item').forEach(item => {
        item.addEventListener('click', async () => {
          const userId = parseInt(item.dataset.userId, 10);
          const convId = await startDmConversation(userId);
          if (convId) {
            await loadChatConversations();
            openChatConversation(convId, 'dm');
          }
        });
      });
    }
  } catch (e) {
    console.error('Failed to load team members:', e);
    container.innerHTML = `
      <div class="chat-empty-state">
        <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
        <p>Feil ved lasting av teammedlemmer</p>
        <p style="font-size:12px;opacity:0.7">G\u00e5 tilbake og bruk Teamchat for \u00e5 sende melding til alle</p>
      </div>`;
  }
}

// Navigate back to conversation list
function showChatConversationList() {
  chatState.view = 'list';
  chatState.activeConversation = null;
  chatState.activeConversationType = null;
  document.getElementById('chatMessageView').style.display = 'none';
  document.getElementById('chatNewDm').style.display = 'none';
  document.getElementById('chatConversationList').style.display = '';
  loadChatConversations();
}

// Initialize chat event listeners
function initChatEventListeners() {
  // Send button
  document.getElementById('chatSendBtn')?.addEventListener('click', () => {
    const input = document.getElementById('chatInput');
    if (input && chatState.activeConversation) {
      sendChatMessage(chatState.activeConversation, input.value);
      input.value = '';
      chatIsTyping = false;
    }
  });

  // Enter key to send
  document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const input = e.target;
      if (input.value.trim() && chatState.activeConversation) {
        sendChatMessage(chatState.activeConversation, input.value);
        input.value = '';
        chatIsTyping = false;
      }
    }
  });

  // Typing indicator
  document.getElementById('chatInput')?.addEventListener('input', () => {
    if (chatState.activeConversation) {
      sendChatTypingStart(chatState.activeConversation);
    }
  });

  // Back button
  document.getElementById('chatBackBtn')?.addEventListener('click', showChatConversationList);

  // New DM button
  document.getElementById('chatNewDmBtn')?.addEventListener('click', showNewDmView);

  // New DM back button
  document.getElementById('chatNewDmBackBtn')?.addEventListener('click', showChatConversationList);
}

// Load chat when chat tab is opened
function onChatTabOpened() {
  loadChatConversations();
  resizeChatContainer();
}

// Explicitly size the chat container to fill available space
function resizeChatContainer() {
  const tabContent = document.querySelector('.tab-content');
  const chatPane = document.getElementById('tab-chat');
  if (!tabContent || !chatPane) return;
  const available = tabContent.clientHeight;
  chatPane.style.height = available + 'px';
  chatPane.style.maxHeight = available + 'px';
}

// Re-size on window resize
window.addEventListener('resize', () => {
  const chatPane = document.getElementById('tab-chat');
  if (chatPane && chatPane.classList.contains('active')) {
    resizeChatContainer();
  }
});

// Make load older messages available globally
window.loadOlderChatMessages = loadOlderChatMessages;


// ============================================
// TODAY'S WORK (Dagens arbeid)
// ============================================

let twCurrentDate = new Date().toISOString().split('T')[0];
let twRouteData = null;

function initTodaysWork() {
  // Show tab if feature is enabled
  if (hasFeature('todays_work')) {
    const tab = document.getElementById('todaysWorkTab');
    if (tab) tab.style.display = '';
  }

  // Date navigation
  document.getElementById('twPrevDay')?.addEventListener('click', () => {
    const d = new Date(twCurrentDate);
    d.setDate(d.getDate() - 1);
    twCurrentDate = d.toISOString().split('T')[0];
    loadTodaysWork();
  });

  document.getElementById('twNextDay')?.addEventListener('click', () => {
    const d = new Date(twCurrentDate);
    d.setDate(d.getDate() + 1);
    twCurrentDate = d.toISOString().split('T')[0];
    loadTodaysWork();
  });

  // Start route button
  document.getElementById('twStartRouteBtn')?.addEventListener('click', startTodaysRoute);
}

async function loadTodaysWork() {
  const dateLabel = document.getElementById('twDateLabel');
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  if (twCurrentDate === today) {
    dateLabel.textContent = 'I dag';
  } else if (twCurrentDate === tomorrow) {
    dateLabel.textContent = 'I morgen';
  } else {
    const d = new Date(twCurrentDate);
    dateLabel.textContent = d.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  try {
    const csrfToken = getCsrfToken();
    const response = await fetch(`/api/todays-work/my-route?date=${twCurrentDate}`, {
      headers: { 'X-CSRF-Token': csrfToken }
    });
    if (!response.ok) return;
    const json = await response.json();

    if (json.success && json.data) {
      twRouteData = json.data;
      renderTodaysWork();
      // Cache for offline use
      if (window.OfflineStorage) {
        const userId = localStorage.getItem('userId') || '0';
        OfflineStorage.saveTodaysRoute(twCurrentDate, userId, json.data).catch(() => {});
        OfflineStorage.setLastSyncTime().catch(() => {});
      }
    } else {
      twRouteData = null;
      document.getElementById('twRouteCard').style.display = 'none';
      document.getElementById('twStopsList').innerHTML = '';
      document.getElementById('twEmpty').style.display = 'flex';
      updateTodaysWorkBadge(0, 0);
    }
  } catch (err) {
    console.error('Error loading todays work:', err);
    // Try offline fallback
    if (window.OfflineStorage && !navigator.onLine) {
      const userId = localStorage.getItem('userId') || '0';
      const cached = await OfflineStorage.getTodaysRoute(twCurrentDate, userId);
      if (cached) {
        twRouteData = cached;
        renderTodaysWork();
        showNotification('Viser lagret rute (frakoblet)', 'warning');
        return;
      }
    }
    showNotification('Kunne ikke laste dagens rute', 'error');
  }
}

function renderTodaysWork() {
  const route = twRouteData;
  if (!route) return;

  document.getElementById('twEmpty').style.display = 'none';
  document.getElementById('twRouteCard').style.display = 'block';

  document.getElementById('twRouteName').textContent = escapeHtml(route.navn || 'Rute');

  const isStarted = !!route.execution_started_at;
  const isCompleted = !!route.execution_ended_at;
  const statusEl = document.getElementById('twRouteStatus');

  if (isCompleted) {
    statusEl.textContent = 'Fullført';
    statusEl.className = 'tw-route-status tw-status-completed';
    document.getElementById('twStartRouteBtn').style.display = 'none';
  } else if (isStarted) {
    statusEl.textContent = 'Pågår';
    statusEl.className = 'tw-route-status tw-status-active';
    document.getElementById('twStartRouteBtn').style.display = 'none';
  } else {
    statusEl.textContent = 'Planlagt';
    statusEl.className = 'tw-route-status tw-status-planned';
    document.getElementById('twStartRouteBtn').style.display = '';
  }

  const completed = isStarted ? (route.completed_count || 0) : 0;
  const total = route.total_count || 0;
  document.getElementById('twCompleted').textContent = completed;
  document.getElementById('twTotal').textContent = total;

  const pct = total > 0 ? (completed / total) * 100 : 0;
  document.getElementById('twProgressFill').style.width = pct + '%';

  if (route.total_distanse) {
    document.getElementById('twDistanceStat').style.display = '';
    document.getElementById('twDistance').textContent = (route.total_distanse / 1000).toFixed(1) + ' km';
  }

  updateTodaysWorkBadge(completed, total);

  // Render customer stops
  const stopsList = document.getElementById('twStopsList');
  const kunder = route.kunder || [];
  const visits = route.visits || [];

  if (kunder.length === 0) {
    stopsList.innerHTML = '<p class="tw-no-stops">Ingen kunder på denne ruten.</p>';
    return;
  }

  // Find next unvisited stop
  let nextStopIndex = -1;
  if (isStarted && !isCompleted) {
    nextStopIndex = kunder.findIndex(k => {
      const v = visits.find(v => v.kunde_id === k.id);
      return !v || !v.completed;
    });
  }

  let html = '';

  // Show prominent "Next Stop" card on mobile when route is active
  if (isStarted && !isCompleted && nextStopIndex >= 0) {
    const nextKunde = kunder[nextStopIndex];
    const address = [nextKunde.adresse, nextKunde.postnummer, nextKunde.poststed].filter(Boolean).join(', ');
    html += `
      <div class="tw-next-stop-card">
        <div class="tw-next-stop-label">
          <i aria-hidden="true" class="fas fa-arrow-right"></i> Neste stopp (${nextStopIndex + 1}/${kunder.length})
        </div>
        <h3 class="tw-next-stop-name">${escapeHtml(nextKunde.navn)}</h3>
        <p class="tw-next-stop-address">${escapeHtml(address)}</p>
        ${nextKunde.telefon ? `<p class="tw-next-stop-phone"><i aria-hidden="true" class="fas fa-phone"></i> ${escapeHtml(nextKunde.telefon)}</p>` : ''}
        <div class="tw-next-stop-actions">
          <button class="btn btn-primary tw-next-nav-btn" onclick="twNavigateToCustomer(${nextKunde.id})">
            <i aria-hidden="true" class="fas fa-directions"></i> Naviger hit
          </button>
          ${nextKunde.telefon ? `<a href="tel:${escapeHtml(nextKunde.telefon)}" class="btn btn-secondary tw-next-call-btn"><i aria-hidden="true" class="fas fa-phone"></i> Ring</a>` : ''}
          <button class="btn btn-success tw-next-done-btn" onclick="twMarkVisited(${nextKunde.id})">
            <i aria-hidden="true" class="fas fa-check"></i> Fullført
          </button>
        </div>
      </div>
    `;
  }

  // Render stops list - visited stops collapsed, next highlighted
  const visitedStops = [];
  const remainingStops = [];

  kunder.forEach((kunde, index) => {
    const visit = isStarted ? visits.find(v => v.kunde_id === kunde.id) : null;
    const isVisited = visit && visit.completed === true;
    const isNextStop = index === nextStopIndex;

    const card = `
      <div class="tw-stop-card ${isVisited ? 'tw-stop-completed' : ''} ${isNextStop ? 'tw-stop-next' : ''}" data-kunde-id="${kunde.id}">
        <div class="tw-stop-number">${index + 1}</div>
        <div class="tw-stop-info">
          <h4>${escapeHtml(kunde.navn)}</h4>
          ${!isVisited ? `<p>${escapeHtml(kunde.adresse || '')}${kunde.poststed ? ', ' + escapeHtml(kunde.poststed) : ''}</p>` : ''}
          ${!isVisited && kunde.telefon ? `<p class="tw-stop-phone">${escapeHtml(kunde.telefon)}</p>` : ''}
        </div>
        <div class="tw-stop-actions">
          ${!isVisited && kunde.telefon ? `<a href="tel:${escapeHtml(kunde.telefon)}" class="btn btn-icon btn-small tw-action-call" title="Ring"><i aria-hidden="true" class="fas fa-phone"></i></a>` : ''}
          ${!isVisited ? `<button class="btn btn-icon btn-small tw-action-nav" onclick="twNavigateToCustomer(${kunde.id})" title="Naviger"><i aria-hidden="true" class="fas fa-directions"></i></button>` : ''}
          ${isVisited
            ? '<span class="tw-visited-check"><i aria-hidden="true" class="fas fa-check-circle"></i></span>'
            : `<button class="btn btn-icon btn-small tw-action-visit" onclick="twMarkVisited(${kunde.id})" title="Marker besøkt"><i aria-hidden="true" class="fas fa-check"></i></button>`
          }
        </div>
      </div>
    `;

    if (isVisited) {
      visitedStops.push(card);
    } else {
      remainingStops.push(card);
    }
  });

  // Show remaining stops first, then collapsed visited section
  html += remainingStops.join('');

  if (visitedStops.length > 0) {
    html += `
      <div class="tw-visited-section">
        <button class="tw-visited-toggle" onclick="this.parentElement.classList.toggle('expanded')">
          <i aria-hidden="true" class="fas fa-check-circle"></i>
          <span>Besøkt (${visitedStops.length})</span>
          <i aria-hidden="true" class="fas fa-chevron-down tw-visited-chevron"></i>
        </button>
        <div class="tw-visited-list">
          ${visitedStops.join('')}
        </div>
      </div>
    `;
  }

  stopsList.innerHTML = html;
}

function updateTodaysWorkBadge(completed, total) {
  const badge = document.getElementById('todaysWorkBadge');
  if (badge) {
    if (total > 0) {
      badge.textContent = `${completed}/${total}`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
}

async function startTodaysRoute() {
  if (!twRouteData) return;

  try {
    const csrfToken = getCsrfToken();
    const response = await fetch(`/api/todays-work/start-route/${twRouteData.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
    });
    const json = await response.json();
    if (json.success) {
      showNotification('Rute startet!', 'success');
      loadTodaysWork();
    }
  } catch (err) {
    showNotification('Kunne ikke starte ruten', 'error');
  }
}

async function twMarkVisited(kundeId) {
  if (!twRouteData) return;

  try {
    const csrfToken = getCsrfToken();
    const response = await fetch(`/api/todays-work/visit/${kundeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ rute_id: twRouteData.id, completed: true })
    });
    const json = await response.json();
    if (json.success) {
      showNotification('Kunde markert som besøkt', 'success');
      loadTodaysWork();
    }
  } catch (err) {
    // Offline: optimistic update + queue for sync
    if (!navigator.onLine && window.SyncManager) {
      // Update local state optimistically
      if (twRouteData.visits) {
        const existing = twRouteData.visits.find(v => v.kunde_id === kundeId);
        if (existing) {
          existing.completed = true;
          existing.visited_at = new Date().toISOString();
        } else {
          twRouteData.visits.push({ kunde_id: kundeId, completed: true, visited_at: new Date().toISOString() });
        }
      }
      twRouteData.completed_count = (twRouteData.completed_count || 0) + 1;
      renderTodaysWork();

      // Queue for sync
      await SyncManager.queueOfflineAction({
        type: 'VISIT_CUSTOMER',
        url: `/api/todays-work/visit/${kundeId}`,
        method: 'POST',
        body: { rute_id: twRouteData.id, completed: true }
      });

      // Update offline cache
      if (window.OfflineStorage) {
        const userId = localStorage.getItem('userId') || '0';
        OfflineStorage.saveTodaysRoute(twCurrentDate, userId, twRouteData).catch(() => {});
      }

      showNotification('Besøk registrert (synkroniseres når du er online)', 'warning');
    } else {
      showNotification('Kunne ikke registrere besøk', 'error');
    }
  }
}

function twNavigateToCustomer(kundeId) {
  const kunde = twRouteData?.kunder?.find(k => k.id === kundeId);
  if (!kunde) return;

  const address = [kunde.adresse, kunde.postnummer, kunde.poststed].filter(Boolean).join(', ');

  if (kunde.latitude && kunde.longitude) {
    // Use coordinates for precision
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      window.open(`maps://maps.apple.com/?daddr=${kunde.latitude},${kunde.longitude}&dirflg=d`);
    } else {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${kunde.latitude},${kunde.longitude}`);
    }
  } else if (address) {
    // Fallback to address
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`);
  }
}

window.twMarkVisited = twMarkVisited;
window.twNavigateToCustomer = twNavigateToCustomer;


// ========================================
// ONBOARDING
// ========================================

// Update onboarding step via API
async function updateOnboardingStep(step, data = {}) {
  try {
    const onboardHeaders = {
      'Content-Type': 'application/json',
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      onboardHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/onboarding/step', {
      method: 'POST',
      headers: onboardHeaders,
      credentials: 'include',
      body: JSON.stringify({ step, data })
    });
    return await response.json();
  } catch (error) {
    console.error('Error updating onboarding step:', error);
    return { success: false };
  }
}

// Skip onboarding entirely
async function skipOnboarding() {
  try {
    const skipHeaders = {
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      skipHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/onboarding/skip', {
      method: 'POST',
      headers: skipHeaders,
      credentials: 'include'
    });
    return await response.json();
  } catch (error) {
    console.error('Error skipping onboarding:', error);
    return { success: false };
  }
}

// Get onboarding status
async function getOnboardingStatus() {
  try {
    const response = await fetch('/api/onboarding/status', {
      credentials: 'include'
    });
    return await response.json();
  } catch (error) {
    console.error('Error getting onboarding status:', error);
    return { success: false };
  }
}

// ========================================
// ONBOARDING WIZARD - Multi-step
// ========================================

const onboardingWizard = {
  currentStep: 0,
  // Note: Industry selection has been moved to the website registration/settings
  steps: [
    { id: 'company', title: 'Firmainformasjon', icon: 'fa-building' },
    { id: 'map', title: 'Kartinnstillinger', icon: 'fa-map-marker-alt' },
    { id: 'complete', title: 'Ferdig', icon: 'fa-check-circle' }
  ],
  data: {
    industry: null,
    company: {},
    map: {}
  },
  overlay: null,
  resolve: null
};

// Show onboarding wizard
async function showOnboardingWizard() {
  return new Promise(async (resolve) => {
    onboardingWizard.resolve = resolve;
    onboardingWizard.currentStep = 0;

    // Industry selection is now handled on the website dashboard, not in the app
    // Build wizard steps (without industry selection)
    onboardingWizard.steps = [
      { id: 'company', title: 'Firmainformasjon', icon: 'fa-building' },
      { id: 'import', title: 'Importer kunder', icon: 'fa-file-excel' },
      { id: 'map', title: 'Kartinnstillinger', icon: 'fa-map-marker-alt' },
      { id: 'complete', title: 'Ferdig', icon: 'fa-check-circle' }
    ];

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'onboardingWizardOverlay';
    overlay.className = 'onboarding-overlay';
    onboardingWizard.overlay = overlay;

    document.body.appendChild(overlay);

    // Render initial step
    await renderWizardStep();

    // Animate in
    requestAnimationFrame(() => {
      overlay.classList.add('visible');
    });
  });
}

// Render current wizard step
async function renderWizardStep() {
  const overlay = onboardingWizard.overlay;
  const step = onboardingWizard.steps[onboardingWizard.currentStep];

  let stepContent = '';

  switch (step.id) {
    case 'company':
      stepContent = renderCompanyStep();
      break;
    case 'import':
      stepContent = renderWizardImportStep();
      break;
    case 'map':
      stepContent = renderMapStep();
      break;
    case 'complete':
      stepContent = renderCompleteStep();
      break;
  }

  overlay.innerHTML = `
    <div class="onboarding-container wizard-container">
      ${renderWizardProgress()}
      <div class="wizard-content" data-step="${step.id}">
        ${stepContent}
      </div>
    </div>
  `;

  // Attach step-specific event listeners
  attachStepListeners(step.id);
}

// Render progress indicator
function renderWizardProgress() {
  const steps = onboardingWizard.steps;
  const current = onboardingWizard.currentStep;

  return `
    <div class="wizard-progress">
      <div class="wizard-progress-bar">
        <div class="wizard-progress-fill" style="width: ${(current / (steps.length - 1)) * 100}%"></div>
      </div>
      <div class="wizard-steps">
        ${steps.map((step, index) => `
          <div class="wizard-step ${index < current ? 'completed' : ''} ${index === current ? 'active' : ''} ${index > current ? 'upcoming' : ''}">
            <div class="wizard-step-icon">
              ${index < current ? '<i aria-hidden="true" class="fas fa-check"></i>' : `<span>${index + 1}</span>`}
            </div>
            <div class="wizard-step-label">${step.title}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Render company info step
function renderCompanyStep() {
  const data = onboardingWizard.data.company;

  return `
    <div class="wizard-step-header">
      <h1><i aria-hidden="true" class="fas fa-building"></i> Firmainformasjon</h1>
      <p>Oppgi firmaets adresse. Dette brukes som utgangspunkt for ruteplanlegging.</p>
    </div>

    <div class="wizard-form">
      <div class="wizard-form-group">
        <label for="companyAddress"><i aria-hidden="true" class="fas fa-map-marker-alt"></i> Firmaadresse</label>
        <div class="wizard-address-wrapper">
          <input type="text" id="companyAddress" placeholder="Begynn å skrive adresse..." value="${escapeHtml(data.address || '')}" autocomplete="off">
          <div class="wizard-address-suggestions" id="wizardAddressSuggestions"></div>
        </div>
      </div>

      <div class="wizard-form-row">
        <div class="wizard-form-group">
          <label for="companyPostnummer"><i aria-hidden="true" class="fas fa-hashtag"></i> Postnummer</label>
          <div class="wizard-postnummer-wrapper">
            <input type="text" id="companyPostnummer" placeholder="0000" maxlength="4" value="${escapeHtml(data.postnummer || '')}" autocomplete="off">
            <span class="wizard-postnummer-status" id="wizardPostnummerStatus"></span>
          </div>
        </div>
        <div class="wizard-form-group">
          <label for="companyPoststed"><i aria-hidden="true" class="fas fa-city"></i> Poststed</label>
          <input type="text" id="companyPoststed" placeholder="Fylles automatisk" value="${escapeHtml(data.poststed || '')}">
        </div>
      </div>

      <div class="wizard-form-group">
        <label><i aria-hidden="true" class="fas fa-route"></i> Rute-startpunkt</label>
        <p class="wizard-form-hint">Klikk på kartet for å velge startpunkt for ruter, eller bruk firmaadresse.</p>
        <div id="wizardRouteMap" class="wizard-mini-map"></div>
        <div class="wizard-coordinates" id="routeCoordinates">
          ${data.route_start_lat ? `<span>Valgt: ${data.route_start_lat.toFixed(5)}, ${data.route_start_lng.toFixed(5)}</span>` : '<span class="not-set">Ikke valgt - klikk på kartet</span>'}
        </div>
        <button class="wizard-btn wizard-btn-secondary" onclick="useAddressAsRouteStart()">
          <i aria-hidden="true" class="fas fa-home"></i> Bruk firmaadresse
        </button>
      </div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-skip" onclick="handleSkipOnboarding()">
        <i aria-hidden="true" class="fas fa-forward"></i> Hopp over oppsett
      </button>
      <button class="wizard-btn wizard-btn-primary" onclick="nextWizardStep()">
        Neste <i aria-hidden="true" class="fas fa-arrow-right"></i>
      </button>
    </div>
  `;
}

// Render map settings step
function renderMapStep() {
  const data = onboardingWizard.data.map;

  return `
    <div class="wizard-step-header">
      <h1><i aria-hidden="true" class="fas fa-map-marker-alt"></i> Kartinnstillinger</h1>
      <p>Velg standard kartvisning. Dra og zoom kartet til ønsket område.</p>
    </div>

    <div class="wizard-form">
      <div class="wizard-form-group">
        <label><i aria-hidden="true" class="fas fa-map"></i> Standard kartsentrum</label>
        <p class="wizard-form-hint">Panorer og zoom kartet til det området du vanligvis jobber i.</p>
        <div id="wizardMainMap" class="wizard-map"></div>
      </div>

      <div class="wizard-form-group">
        <label for="defaultZoom"><i aria-hidden="true" class="fas fa-search-plus"></i> Standard zoom-nivå</label>
        <div class="wizard-slider-container">
          <input type="range" id="defaultZoom" min="5" max="18" value="${data.zoom || 10}">
          <span class="wizard-slider-value" id="zoomValue">${data.zoom || 10}</span>
        </div>
      </div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="prevWizardStep()">
        <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-primary" onclick="nextWizardStep()">
        Fullfør oppsett <i aria-hidden="true" class="fas fa-check"></i>
      </button>
    </div>
  `;
}

// Render completion step
function renderCompleteStep() {
  // Use industry from appConfig (set during registration on website)
  const industryName = appConfig?.industry?.name || onboardingWizard.data.industry?.name || 'din virksomhet';

  return `
    <div class="wizard-step-header wizard-complete">
      <div class="wizard-complete-icon">
        <i aria-hidden="true" class="fas fa-check-circle"></i>
      </div>
      <h1>Oppsettet er fullført!</h1>
      <p>Flott! Systemet er nå tilpasset for ${escapeHtml(industryName)}.</p>
    </div>

    <div class="wizard-complete-summary">
      <h3>Hva skjer nå?</h3>
      <ul class="wizard-tips-list">
        <li><i aria-hidden="true" class="fas fa-users"></i> Legg til dine første kunder</li>
        <li><i aria-hidden="true" class="fas fa-route"></i> Planlegg effektive ruter</li>
        <li><i aria-hidden="true" class="fas fa-calendar-alt"></i> Bruk kalenderen for å holde oversikt</li>
        <li><i aria-hidden="true" class="fas fa-cog"></i> Tilpass ytterligere i innstillinger</li>
      </ul>
    </div>

    <div class="wizard-footer wizard-footer-center">
      <button class="wizard-btn wizard-btn-primary wizard-btn-large" onclick="completeOnboardingWizard()">
        <i aria-hidden="true" class="fas fa-rocket"></i> Start å bruke Sky Planner
      </button>
    </div>
  `;
}

// ========================================
// WIZARD IMPORT STEP - Excel/CSV Import
// ========================================

// Shared field type map for import mapping (used by both preview and commit)
const IMPORT_FIELD_TYPE_MAP = {
  navn: 'string', adresse: 'string', postnummer: 'postnummer', poststed: 'string',
  telefon: 'phone', epost: 'email', kontaktperson: 'string', notater: 'string',
  kategori: 'kategori', el_type: 'string', brann_system: 'string',
  brann_driftstype: 'string', driftskategori: 'string',
  siste_el_kontroll: 'date', neste_el_kontroll: 'date',
  siste_brann_kontroll: 'date', neste_brann_kontroll: 'date',
  siste_kontroll: 'date', neste_kontroll: 'date',
  kontroll_intervall_mnd: 'integer', el_kontroll_intervall: 'integer',
  brann_kontroll_intervall: 'integer', ekstern_id: 'string', org_nummer: 'string',
};

// State management for wizard import
const wizardImportState = {
  currentImportStep: 1, // Sub-steps: 1=upload, 2=cleaning, 3=mapping, 4=preview, 5=results
  sessionId: null,
  batchId: null, // Staging batch ID from advanced backend
  previewData: null,
  columnMapping: {},
  categoryMapping: {},
  customFieldMapping: {},  // Tracks what to do with unmapped columns
  validCategories: [],
  importResults: null,
  isLoading: false,
  loadingPhase: null, // 'uploading' | 'parsing' | 'ai-mapping' | 'validating' | 'importing'
  loadingProgress: 0, // 0-100 for import progress
  importedSoFar: 0,
  totalToImport: 0,
  aiQuestions: [], // Questions from AI for ambiguous mappings
  questionAnswers: {}, // User answers to AI questions
  requiredMappings: { navn: null, adresse: null }, // User-selected columns for required fields
  error: null,
  // Row selection and editing state
  selectedRows: new Set(), // Set of selected row indices
  editedRows: {}, // Map of row index to edited values { rowIndex: { field: newValue } }
  editingCell: null, // Currently editing cell { row: number, field: string }
  // Cleaning state
  cleaningReport: null,         // CleaningReport from backend
  cleanedPreview: null,         // Cleaned rows from backend
  originalPreview: null,        // Original (uncleaned) rows
  enabledCleaningRules: {},     // { ruleId: boolean } - user toggles
  useCleanedData: true,         // Whether to proceed with cleaned data
  // Pagination & display state
  cleaningTablePage: 0,         // Current page in cleaning full table
  previewTablePage: 0,          // Current page in preview table
  previewShowBeforeAfter: false, // Toggle before/after transformation view
  fieldToHeaderMapping: {},     // Maps target field -> source header name
  showMethodChoice: true        // Show import method choice (integration vs file) before upload
};

// Track if we're in standalone import mode (vs onboarding wizard)
let standaloneImportMode = false;

// Reset wizard import state
function resetWizardImportState() {
  wizardImportState.currentImportStep = 1;
  wizardImportState.sessionId = null;
  wizardImportState.batchId = null;
  wizardImportState.previewData = null;
  wizardImportState.columnMapping = {};
  wizardImportState.categoryMapping = {};
  wizardImportState.customFieldMapping = {};
  wizardImportState.validCategories = [];
  wizardImportState.importResults = null;
  wizardImportState.isLoading = false;
  wizardImportState.loadingPhase = null;
  wizardImportState.loadingProgress = 0;
  wizardImportState.importedSoFar = 0;
  wizardImportState.totalToImport = 0;
  wizardImportState.aiQuestions = [];
  wizardImportState.questionAnswers = {};
  wizardImportState.requiredMappings = { navn: null, adresse: null };
  wizardImportState.error = null;
  wizardImportState.selectedRows = new Set();
  wizardImportState.editedRows = {};
  wizardImportState.editingCell = null;
  wizardImportState.cleaningReport = null;
  wizardImportState.cleanedPreview = null;
  wizardImportState.originalPreview = null;
  wizardImportState.enabledCleaningRules = {};
  wizardImportState.useCleanedData = true;
  wizardImportState.cleaningTablePage = 0;
  wizardImportState.previewTablePage = 0;
  wizardImportState.previewShowBeforeAfter = false;
  wizardImportState.fieldToHeaderMapping = {};
  wizardImportState.showMethodChoice = true;
}

// Show standalone import modal
function showImportModal() {
  standaloneImportMode = true;
  resetWizardImportState();

  const modal = document.getElementById('importModal');
  const content = document.getElementById('importModalContent');

  if (!modal || !content) return;

  // Render the import wizard content (reuse existing function)
  content.innerHTML = renderStandaloneImportWizard();

  // Show the modal
  modal.classList.remove('hidden');

  // Attach import-specific event listeners
  attachWizardImportListeners();
}

// Close standalone import modal
function closeImportModal() {
  const modal = document.getElementById('importModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  standaloneImportMode = false;

  // If import was completed, refresh the customer list
  if (wizardImportState.importResults?.imported > 0) {
    loadCustomers();
  }

  resetWizardImportState();
}

// Render standalone import wizard (without onboarding wrapper)
function renderStandaloneImportWizard() {
  const importStep = wizardImportState.currentImportStep;

  return `
    <!-- Import sub-steps indicator -->
    <div class="wizard-import-steps">
      <div class="import-step-indicator ${importStep >= 1 ? 'active' : ''}" data-step="1">
        <span class="step-number">1</span>
        <span class="step-label">Last opp</span>
      </div>
      <div class="import-step-connector ${importStep >= 2 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 2 ? 'active' : ''}" data-step="2">
        <span class="step-number">2</span>
        <span class="step-label">Datarensing</span>
      </div>
      <div class="import-step-connector ${importStep >= 3 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 3 ? 'active' : ''}" data-step="3">
        <span class="step-number">3</span>
        <span class="step-label">Mapping</span>
      </div>
      <div class="import-step-connector ${importStep >= 4 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 4 ? 'active' : ''}" data-step="4">
        <span class="step-number">4</span>
        <span class="step-label">Forhåndsvis</span>
      </div>
      <div class="import-step-connector ${importStep >= 5 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 5 ? 'active' : ''}" data-step="5">
        <span class="step-number">5</span>
        <span class="step-label">Resultat</span>
      </div>
    </div>

    <!-- Dynamic content based on sub-step -->
    <div class="wizard-import-content" id="wizardImportContent">
      ${renderWizardImportSubStep(importStep)}
    </div>
  `;
}

// Update standalone import modal content
function updateStandaloneImportContent() {
  if (!standaloneImportMode) return;

  const content = document.getElementById('importModalContent');
  if (content) {
    content.innerHTML = renderStandaloneImportWizard();
    attachWizardImportListeners();
  }
}

/**
 * Convert backend mapping format to frontend format
 * Backend: { "ExcelHeader": "dbField" } e.g., { "Kundenavn": "navn" }
 * Frontend: { "dbField": columnIndex } e.g., { "navn": 0 }
 */
function convertBackendToFrontendMapping(backendMapping, headers) {
  const frontendMapping = {};
  for (const [header, field] of Object.entries(backendMapping)) {
    const index = headers.indexOf(header);
    if (index !== -1) {
      frontendMapping[field] = index;
    }
  }
  return frontendMapping;
}

/**
 * Convert frontend mapping format to backend format
 * Frontend: { "dbField": columnIndex } e.g., { "navn": 0 }
 * Backend: { "ExcelHeader": "dbField" } e.g., { "Kundenavn": "navn" }
 */
function convertFrontendToBackendMapping(frontendMapping, headers) {
  const backendMapping = {};
  for (const [field, index] of Object.entries(frontendMapping)) {
    if (index !== undefined && index !== '' && headers[index]) {
      backendMapping[headers[index]] = field;
    }
  }
  return backendMapping;
}

/**
 * Get sample value for a field from sample data
 * @param {Object} sampleData - First row of raw data
 * @param {number} columnIndex - Index of the column
 * @param {Array} headers - Array of header names
 */
function getSampleValueForColumn(sampleData, columnIndex, headers) {
  if (!sampleData || columnIndex === undefined || columnIndex === '' || !headers) {
    return '-';
  }
  const header = headers[columnIndex];
  if (!header) return '-';
  const value = sampleData[header];
  if (value === undefined || value === null || value === '') return '-';
  return String(value);
}

// Render import method choice (integration vs file upload)
function renderWizardImportMethodChoice() {
  return `
    <div class="wizard-step-header">
      <h1><i aria-hidden="true" class="fas fa-download"></i> Importer kunder</h1>
      <p>Velg hvordan du vil hente inn dine eksisterende kunder.</p>
    </div>

    <div class="wizard-import-method-choice">
      <div class="wizard-method-card" role="button" tabindex="0" onclick="selectImportMethodIntegration()">
        <div class="wizard-method-icon">
          <i aria-hidden="true" class="fas fa-plug"></i>
        </div>
        <h3>Regnskapssystem</h3>
        <p>Koble til Tripletex, Fiken eller PowerOffice og synkroniser kunder automatisk.</p>
        <span class="wizard-method-action">Koble til <i aria-hidden="true" class="fas fa-external-link-alt"></i></span>
      </div>

      <div class="wizard-method-card" role="button" tabindex="0" onclick="selectImportMethodFile()">
        <div class="wizard-method-icon">
          <i aria-hidden="true" class="fas fa-file-excel"></i>
        </div>
        <h3>Excel / CSV</h3>
        <p>Last opp en fil med kundedata. AI-assistert mapping hjelper deg med kolonnene.</p>
        <span class="wizard-method-action">Last opp fil <i aria-hidden="true" class="fas fa-arrow-right"></i></span>
      </div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="prevWizardStep()">
        <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-skip" onclick="skipWizardImport()">
        Hopp over <i aria-hidden="true" class="fas fa-forward"></i>
      </button>
    </div>
  `;
}

// Handle integration method selection in onboarding wizard
function selectImportMethodIntegration() {
  const webUrl = appConfig.webUrl || '';
  window.open(webUrl + '/dashboard/innstillinger/integrasjoner', '_blank');
  showToast('Koble til regnskapssystemet i fanen som ble apnet. Kom tilbake hit for a fortsette oppsettet.', 'info', 8000);
}

// Handle file import method selection in onboarding wizard
function selectImportMethodFile() {
  wizardImportState.showMethodChoice = false;
  // Re-render the import step to show file upload
  const container = document.querySelector('.wizard-content[data-step="import"]');
  if (container) {
    container.innerHTML = renderWizardImportStep();
    attachWizardImportListeners();
  }
}

// Render wizard import step
function renderWizardImportStep() {
  // Show method choice screen if not yet selected (only in onboarding wizard, not standalone)
  if (wizardImportState.showMethodChoice && !standaloneImportMode) {
    return renderWizardImportMethodChoice();
  }

  const importStep = wizardImportState.currentImportStep;

  return `
    <div class="wizard-step-header">
      <h1><i aria-hidden="true" class="fas fa-file-excel"></i> Importer kunder</h1>
      <p>Last opp en Excel- eller CSV-fil med dine eksisterende kunder.</p>
    </div>

    <!-- Import sub-steps indicator -->
    <div class="wizard-import-steps">
      <div class="import-step-indicator ${importStep >= 1 ? 'active' : ''}" data-step="1">
        <span class="step-number">1</span>
        <span class="step-label">Last opp</span>
      </div>
      <div class="import-step-connector ${importStep >= 2 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 2 ? 'active' : ''}" data-step="2">
        <span class="step-number">2</span>
        <span class="step-label">Datarensing</span>
      </div>
      <div class="import-step-connector ${importStep >= 3 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 3 ? 'active' : ''}" data-step="3">
        <span class="step-number">3</span>
        <span class="step-label">Mapping</span>
      </div>
      <div class="import-step-connector ${importStep >= 4 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 4 ? 'active' : ''}" data-step="4">
        <span class="step-number">4</span>
        <span class="step-label">Forhåndsvis</span>
      </div>
      <div class="import-step-connector ${importStep >= 5 ? 'active' : ''}"></div>
      <div class="import-step-indicator ${importStep >= 5 ? 'active' : ''}" data-step="5">
        <span class="step-number">5</span>
        <span class="step-label">Resultat</span>
      </div>
    </div>

    <!-- Dynamic content based on sub-step -->
    <div class="wizard-import-content" id="wizardImportContent">
      ${renderWizardImportSubStep(importStep)}
    </div>
  `;
}

// Render loading state with phase-specific messages and AI animation
function renderWizardLoadingState() {
  const phase = wizardImportState.loadingPhase;
  const progress = wizardImportState.loadingProgress;

  const phases = {
    'uploading': { icon: 'fa-cloud-upload-alt', message: 'Laster opp fil...', isAI: false },
    'parsing': { icon: 'fa-file-excel', message: 'Leser kolonner og rader...', isAI: false },
    'ai-mapping': { icon: 'fa-robot', message: 'AI analyserer kolonner...', isAI: true },
    'cleaning': { icon: 'fa-broom', message: 'Renser data...', isAI: false },
    'mapping': { icon: 'fa-columns', message: 'Kobler kolonner til felt...', isAI: false },
    'validating': { icon: 'fa-check-circle', message: 'Validerer data...', isAI: false },
    'importing': { icon: 'fa-database', message: `Importerer kunder...`, isAI: false, showProgress: true }
  };

  const current = phases[phase] || { icon: 'fa-spinner', message: 'Behandler...', isAI: false };

  return `
    <div class="wizard-import-loading ${current.isAI ? 'ai-active' : ''}">
      <div class="wizard-loading-icon ${current.isAI ? 'ai-pulse' : 'spinning'}">
        <i aria-hidden="true" class="fas ${current.icon}"></i>
      </div>
      <p class="wizard-loading-message">${current.message}</p>
      ${current.isAI ? `
        <div class="wizard-ai-thinking">
          <span class="ai-dot"></span>
          <span class="ai-dot"></span>
          <span class="ai-dot"></span>
        </div>
        <p class="wizard-ai-hint">AI forstår kolonnenavn som "Hvem ringer vi?" → kontaktperson</p>
      ` : ''}
      ${current.showProgress ? `
        <div class="wizard-progress-container">
          <div class="wizard-progress-bar">
            <div class="wizard-progress-fill" style="width: ${progress}%"></div>
          </div>
          <p class="wizard-progress-text">${wizardImportState.importedSoFar} av ${wizardImportState.totalToImport} kunder</p>
        </div>
      ` : ''}
    </div>
  `;
}

// Render sub-step content
function renderWizardImportSubStep(step) {
  if (wizardImportState.isLoading) {
    return renderWizardLoadingState();
  }

  if (wizardImportState.error) {
    return `
      <div class="wizard-import-error">
        <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
        <p>${escapeHtml(wizardImportState.error)}</p>
        <button class="wizard-btn wizard-btn-secondary" onclick="wizardImportRetry()">
          <i aria-hidden="true" class="fas fa-redo"></i> Prøv igjen
        </button>
      </div>
    `;
  }

  switch (step) {
    case 1:
      return renderWizardImportUpload();
    case 2:
      return renderWizardImportCleaning();
    case 3:
      return renderWizardImportMapping();
    case 4:
      return renderWizardImportPreview();
    case 5:
      return renderWizardImportResults();
    default:
      return renderWizardImportUpload();
  }
}

// Sub-step 2: Data cleaning preview
function renderWizardImportCleaning() {
  const report = wizardImportState.cleaningReport;
  const totalChanges = report ? (report.totalCellsCleaned + report.totalRowsRemoved) : 0;
  const data = wizardImportState.previewData;
  const totalRows = data ? data.totalRows : 0;

  // No issues found
  if (!report || totalChanges === 0) {
    return `
      <div class="wizard-cleaning-container">
        <div class="wizard-cleaning-summary wizard-cleaning-clean">
          <i aria-hidden="true" class="fas fa-check-circle"></i>
          <div>
            <strong>Ingen problemer funnet</strong>
            <p>Filen ser bra ut! ${totalRows} rader klare for import.</p>
          </div>
        </div>
        <div class="wizard-import-actions">
          <button class="wizard-btn wizard-btn-secondary" onclick="wizardCleaningBack()">
            <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
          </button>
          <button class="wizard-btn wizard-btn-primary" onclick="wizardCleaningApprove()">
            Gå videre <i aria-hidden="true" class="fas fa-arrow-right"></i>
          </button>
        </div>
      </div>
    `;
  }

  // Get active changes based on enabled rules
  const enabledRules = wizardImportState.enabledCleaningRules;
  const activeCellChanges = report.cellChanges.filter(c => enabledRules[c.ruleId]);
  const activeRowRemovals = report.rowRemovals.filter(r => enabledRules[r.ruleId]);
  const activeTotal = activeCellChanges.length + activeRowRemovals.length;

  // Diff table - show max 50 cell changes
  const maxDiffRows = 50;
  const visibleChanges = activeCellChanges.slice(0, maxDiffRows);
  const hasMoreChanges = activeCellChanges.length > maxDiffRows;

  return `
    <div class="wizard-cleaning-container">
      <!-- Summary banner -->
      <div class="wizard-cleaning-summary">
        <i aria-hidden="true" class="fas fa-broom"></i>
        <div>
          <strong>${activeTotal} ${activeTotal === 1 ? 'endring' : 'endringer'} funnet i ${totalRows} rader</strong>
          <p>${activeCellChanges.length} ${activeCellChanges.length === 1 ? 'celle' : 'celler'} renset, ${activeRowRemovals.length} ${activeRowRemovals.length === 1 ? 'rad' : 'rader'} foreslått fjernet.</p>
        </div>
      </div>

      <!-- Rule toggles -->
      <div class="wizard-cleaning-rules">
        <h3>Renseregler</h3>
        <div class="wizard-cleaning-rules-list">
          ${report.rules.filter(r => r.affectedCount > 0).map(rule => `
            <label class="wizard-cleaning-rule-toggle">
              <input type="checkbox" ${enabledRules[rule.ruleId] ? 'checked' : ''}
                onchange="wizardToggleCleaningRule('${rule.ruleId}', this.checked)">
              <span class="wizard-cleaning-rule-info">
                <span class="wizard-cleaning-rule-name">${escapeHtml(rule.name)}</span>
                <span class="wizard-cleaning-rule-desc">${escapeHtml(rule.description)}</span>
              </span>
              <span class="wizard-cleaning-rule-count">${rule.affectedCount} ${rule.category === 'rows' ? (rule.affectedCount === 1 ? 'rad' : 'rader') : (rule.affectedCount === 1 ? 'celle' : 'celler')}</span>
            </label>
          `).join('')}
        </div>
      </div>

      ${visibleChanges.length > 0 ? `
      <!-- Diff table -->
      <div class="wizard-cleaning-diff-section">
        <h3>Endringsoversikt</h3>
        <div class="wizard-cleaning-diff-table-wrapper">
          <table class="wizard-cleaning-diff-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Kolonne</th>
                <th>Rad</th>
                <th>Opprinnelig</th>
                <th>Renset</th>
              </tr>
            </thead>
            <tbody>
              ${visibleChanges.map((change, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${escapeHtml(change.column)}</td>
                  <td>${change.rowIndex + 2}</td>
                  <td class="cell-original">${formatCleaningValue(change.originalValue)}</td>
                  <td class="cell-cleaned">${formatCleaningValue(change.cleanedValue)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${hasMoreChanges ? `
          <p class="wizard-cleaning-more">Viser ${maxDiffRows} av ${activeCellChanges.length} endringer</p>
        ` : ''}
      </div>
      ` : ''}

      ${renderCleaningFullTable()}

      ${activeRowRemovals.length > 0 ? `
      <!-- Removed rows -->
      <details class="wizard-cleaning-removed">
        <summary>${activeRowRemovals.length} ${activeRowRemovals.length === 1 ? 'rad' : 'rader'} fjernet</summary>
        <div class="wizard-cleaning-removed-list">
          ${activeRowRemovals.map(removal => `
            <div class="wizard-cleaning-removed-item">
              <span class="removal-row">Rad ${removal.rowIndex + 2}</span>
              <span class="removal-reason">${escapeHtml(removal.reason)}</span>
            </div>
          `).join('')}
        </div>
      </details>
      ` : ''}

      <!-- Actions -->
      <div class="wizard-import-actions">
        <button class="wizard-btn wizard-btn-secondary" onclick="wizardCleaningBack()">
          <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
        </button>
        <button class="wizard-btn wizard-btn-ghost" onclick="wizardCleaningSkip()">
          Hopp over rensing
        </button>
        <button class="wizard-btn wizard-btn-primary" onclick="wizardCleaningApprove()">
          <i aria-hidden="true" class="fas fa-check"></i> Godkjenn rensing <i aria-hidden="true" class="fas fa-arrow-right"></i>
        </button>
      </div>
    </div>
  `;
}

// Format a value for display in the diff table
function formatCleaningValue(val) {
  if (val === null || val === undefined) return '<span class="cleaning-null">(tom)</span>';
  const str = String(val);
  if (str === '') return '<span class="cleaning-null">(tom)</span>';
  // Show whitespace visually
  const visual = str.replace(/ /g, '\u00B7').replace(/\t/g, '\u2192');
  return escapeHtml(visual);
}

// Toggle a cleaning rule on/off
function wizardToggleCleaningRule(ruleId, enabled) {
  wizardImportState.enabledCleaningRules[ruleId] = enabled;
  updateWizardImportContent();
}

// Pagination for cleaning full table
function wizardCleaningTablePage(page) {
  wizardImportState.cleaningTablePage = Math.max(0, page);
  updateWizardImportContent();
}
window.wizardCleaningTablePage = wizardCleaningTablePage;

// Render full data table for cleaning step
function renderCleaningFullTable() {
  const originalRows = wizardImportState.originalPreview;
  const headers = wizardImportState.previewData?.headers || [];
  const report = wizardImportState.cleaningReport;
  const enabledRules = wizardImportState.enabledCleaningRules;

  if (!originalRows || originalRows.length === 0 || headers.length === 0) return '';

  // Build change map: "rowIndex|column" -> { originalValue, cleanedValue }
  const changeMap = new Map();
  if (report) {
    for (const change of report.cellChanges) {
      if (!enabledRules[change.ruleId]) continue;
      changeMap.set(`${change.rowIndex}|${change.column}`, change);
    }
  }

  // Build removed indices set
  const removedIndices = new Set();
  if (report) {
    for (const removal of report.rowRemovals) {
      if (enabledRules[removal.ruleId]) {
        removedIndices.add(removal.rowIndex);
      }
    }
  }

  // Pagination
  const pageSize = 50;
  const currentPage = wizardImportState.cleaningTablePage || 0;
  const totalPages = Math.ceil(originalRows.length / pageSize);
  const validPage = Math.min(currentPage, totalPages - 1);
  const startIdx = validPage * pageSize;
  const pageRows = originalRows.slice(startIdx, startIdx + pageSize);

  // Show max 8 columns, scrollable
  const maxCols = 8;
  const displayHeaders = headers.slice(0, maxCols);
  const hasMoreColumns = headers.length > maxCols;

  return `
    <div class="wizard-cleaning-fulltable-section">
      <h3><i aria-hidden="true" class="fas fa-table"></i> Fullstendig dataoversikt</h3>
      <p class="wizard-section-desc">${originalRows.length} rader totalt. Endrede celler er markert. Fjernede rader er gjennomstreket.</p>
      <div class="wizard-cleaning-fulltable-wrapper">
        <table class="wizard-cleaning-fulltable">
          <thead>
            <tr>
              <th>#</th>
              ${displayHeaders.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
              ${hasMoreColumns ? '<th>...</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${pageRows.map((row, i) => {
              const globalIdx = row._rowIndex !== undefined ? row._rowIndex : (startIdx + i);
              const isRemoved = removedIndices.has(globalIdx);
              return `
                <tr class="${isRemoved ? 'row-removed' : ''}">
                  <td>${globalIdx + 2}</td>
                  ${displayHeaders.map(col => {
                    const change = changeMap.get(`${globalIdx}|${col}`);
                    const value = isRemoved
                      ? String(row[col] ?? '')
                      : (change ? String(change.cleanedValue ?? '') : String(row[col] ?? ''));
                    const cellClass = change && !isRemoved ? 'cell-was-cleaned' : '';
                    const title = change && !isRemoved
                      ? `Opprinnelig: ${String(change.originalValue ?? '(tom)')}`
                      : (isRemoved ? 'Denne raden fjernes' : '');
                    return `<td class="${cellClass}" ${title ? `title="${escapeHtml(title)}"` : ''}>${escapeHtml(value || '-')}</td>`;
                  }).join('')}
                  ${hasMoreColumns ? '<td>...</td>' : ''}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      ${totalPages > 1 ? `
        <div class="wizard-cleaning-pagination">
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary"
            onclick="wizardCleaningTablePage(${validPage - 1})" ${validPage === 0 ? 'disabled' : ''}>
            <i aria-hidden="true" class="fas fa-chevron-left"></i> Forrige
          </button>
          <span>Side ${validPage + 1} av ${totalPages}</span>
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary"
            onclick="wizardCleaningTablePage(${validPage + 1})" ${validPage >= totalPages - 1 ? 'disabled' : ''}>
            Neste <i aria-hidden="true" class="fas fa-chevron-right"></i>
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

// Go back from cleaning step to upload
function wizardCleaningBack() {
  wizardImportState.currentImportStep = 1;
  updateWizardImportContent();
}

// Skip cleaning and proceed with original data
function wizardCleaningSkip() {
  wizardImportState.useCleanedData = false;
  wizardImportState.currentImportStep = 3;
  updateWizardImportContent();
}

// Approve cleaning and proceed to mapping
function wizardCleaningApprove() {
  wizardImportState.useCleanedData = true;

  // Apply enabled rules to compute effective cleaned data
  const effectiveData = getEffectiveCleanedData();
  if (effectiveData) {
    wizardImportState.previewData = {
      ...wizardImportState.previewData,
      preview: effectiveData,
      totalRows: effectiveData.length,
    };
  }

  wizardImportState.currentImportStep = 3;
  updateWizardImportContent();
}

// Compute effective cleaned data based on enabled rules
function getEffectiveCleanedData() {
  const report = wizardImportState.cleaningReport;
  const originalRows = wizardImportState.originalPreview;
  if (!report || !originalRows) return null;

  const enabledRules = wizardImportState.enabledCleaningRules;

  // Start with deep copy of original rows
  let rows = originalRows.map(row => ({ ...row }));

  // Apply enabled row removals (collect indices to remove)
  const removedIndices = new Set();
  for (const removal of report.rowRemovals) {
    if (enabledRules[removal.ruleId]) {
      removedIndices.add(removal.rowIndex);
    }
  }
  rows = rows.filter((row, i) => !removedIndices.has(row._rowIndex !== undefined ? row._rowIndex : i));

  // Build a map of cell changes by (rowIndex, column) for enabled rules
  const changeMap = new Map();
  for (const change of report.cellChanges) {
    if (!enabledRules[change.ruleId]) continue;
    if (removedIndices.has(change.rowIndex)) continue; // Row was removed
    const key = `${change.rowIndex}|${change.column}`;
    // Later rules overwrite earlier ones (they are applied in order)
    changeMap.set(key, change.cleanedValue);
  }

  // Apply cell changes
  for (const row of rows) {
    const rowIdx = row._rowIndex !== undefined ? row._rowIndex : -1;
    for (const [key, cleanedValue] of changeMap) {
      const [changeRowIdx, column] = key.split('|');
      if (Number(changeRowIdx) === rowIdx) {
        row[column] = cleanedValue;
      }
    }
  }

  // Re-index rows
  return rows.map((row, i) => ({ ...row, _rowIndex: i }));
}

// Sub-step 1: File upload
function renderWizardImportUpload() {
  // Get industry name from appConfig if available
  const industryName = appConfig?.industry?.name || 'din bransje';

  return `
    <div class="wizard-import-upload">
      <!-- AI Feature Banner -->
      <div class="wizard-ai-feature-banner">
        <div class="ai-feature-icon">
          <i aria-hidden="true" class="fas fa-robot"></i>
        </div>
        <div class="ai-feature-content">
          <h4><i aria-hidden="true" class="fas fa-magic"></i> AI-assistert import</h4>
          <p>Vår AI forstår <strong>${escapeHtml(industryName)}</strong> og mapper automatisk kolonner til riktige felt - selv med kreative kolonnenavn!</p>
        </div>
      </div>

      <div class="wizard-import-dropzone" id="wizardImportDropzone" role="button" tabindex="0" aria-label="Last opp fil. Dra og slipp, eller trykk for å velge fil.">
        <i aria-hidden="true" class="fas fa-cloud-upload-alt"></i>
        <p><strong>Dra og slipp fil her</strong></p>
        <p>eller klikk for å velge</p>
        <span class="import-formats">Støttede formater: .xlsx, .xls, .csv (maks 10MB)</span>
        <input type="file" id="wizardImportFileInput" accept=".xlsx,.xls,.csv" hidden>
      </div>

      <div class="wizard-import-tips">
        <h4><i aria-hidden="true" class="fas fa-lightbulb"></i> Tips for import</h4>
        <ul>
          <li>Filen bør ha én rad per kunde</li>
          <li>Første rad bør inneholde kolonneoverskrifter</li>
          <li>Påkrevde felt: Navn og adresse</li>
          <li>AI gjenkjenner bransje-spesifikke felt automatisk</li>
        </ul>
      </div>
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="prevWizardStep()">
        <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-skip" onclick="skipWizardImport()">
        Hopp over <i aria-hidden="true" class="fas fa-forward"></i>
      </button>
    </div>
  `;
}

// Render AI questions for ambiguous column mappings
function renderAIQuestions() {
  const questions = wizardImportState.aiQuestions || [];

  if (questions.length === 0) {
    return '';
  }

  return `
    <div class="wizard-ai-questions">
      <div class="wizard-ai-questions-header">
        <i aria-hidden="true" class="fas fa-question-circle"></i>
        <span>AI trenger din hjelp med ${questions.length} ${questions.length === 1 ? 'kolonne' : 'kolonner'}</span>
        <button class="wizard-btn-link" onclick="skipAIQuestions()">Bruk AI-anbefalinger</button>
      </div>
      <div class="wizard-ai-questions-list">
        ${questions.map((q, index) => `
          <div class="wizard-ai-question-card" data-question-index="${index}">
            <div class="question-header">
              <span class="question-column">"${escapeHtml(q.header)}"</span>
              <span class="question-confidence">${Math.round((q.confidence || 0) * 100)}% sikker</span>
            </div>
            <p class="question-text">Hva inneholder denne kolonnen?</p>
            <div class="question-options">
              <label class="question-option ${wizardImportState.questionAnswers[q.header] === q.targetField ? 'selected' : ''}">
                <input type="radio" name="q_${index}" value="${q.targetField || ''}"
                  ${wizardImportState.questionAnswers[q.header] === q.targetField || (!wizardImportState.questionAnswers[q.header] && q.targetField) ? 'checked' : ''}
                  onchange="handleAIQuestionAnswer('${escapeJsString(q.header)}', '${escapeJsString(q.targetField || '')}')">
                <span>${escapeHtml(q.targetField || 'Egendefinert felt')} <span class="recommended">(Anbefalt av AI)</span></span>
              </label>
              <label class="question-option ${wizardImportState.questionAnswers[q.header] === '_custom' ? 'selected' : ''}">
                <input type="radio" name="q_${index}" value="_custom"
                  ${wizardImportState.questionAnswers[q.header] === '_custom' ? 'checked' : ''}
                  onchange="handleAIQuestionAnswer('${escapeJsString(q.header)}', '_custom')">
                <span>Behold som egendefinert felt</span>
              </label>
              <label class="question-option ${wizardImportState.questionAnswers[q.header] === '_skip' ? 'selected' : ''}">
                <input type="radio" name="q_${index}" value="_skip"
                  ${wizardImportState.questionAnswers[q.header] === '_skip' ? 'checked' : ''}
                  onchange="handleAIQuestionAnswer('${escapeJsString(q.header)}', '_skip')">
                <span>Ignorer denne kolonnen</span>
              </label>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// Handle AI question answer
function handleAIQuestionAnswer(header, value) {
  wizardImportState.questionAnswers[header] = value;
  updateWizardImportContent();
}

// Skip AI questions and use recommendations
function skipAIQuestions() {
  // Clear questions to hide the section
  wizardImportState.aiQuestions = [];
  updateWizardImportContent();
}

// Update required field mapping (navn or adresse)
function updateRequiredMapping(field, column) {
  wizardImportState.requiredMappings[field] = column;
  updateWizardImportContent();
}

// Check if required fields are mapped (and different)
function areRequiredFieldsMapped() {
  const { navn, adresse } = wizardImportState.requiredMappings;
  // Both must be selected
  if (!navn || !adresse) return false;
  // They must be different columns
  if (navn === adresse) return false;
  return true;
}

// Check if same column is selected for both required fields
function isSameColumnSelected() {
  const { navn, adresse } = wizardImportState.requiredMappings;
  return navn && adresse && navn === adresse;
}

// Render REQUIRED field selectors - user MUST confirm these before import
function renderRequiredFieldSelectors(data) {
  const allColumns = data.allColumns || data.headers || [];
  const currentMappings = wizardImportState.requiredMappings;

  if (allColumns.length === 0) {
    return '';
  }

  const bothMapped = currentMappings.navn && currentMappings.adresse &&
    currentMappings.navn !== '-- Velg kolonne --' && currentMappings.adresse !== '-- Velg kolonne --';

  return `
    <div class="wizard-required-fields ${bothMapped ? 'wizard-fields-ok' : ''}">
      ${bothMapped ? `
        <div class="wizard-required-header wizard-header-success">
          <i aria-hidden="true" class="fas fa-check-circle"></i>
          <span>Kolonner gjenkjent automatisk</span>
        </div>
        <p class="wizard-required-desc">Endre hvis noe er feil.</p>
      ` : `
        <div class="wizard-required-header">
          <i aria-hidden="true" class="fas fa-columns"></i>
          <span>Velg kolonner</span>
        </div>
        <p class="wizard-required-desc">Velg hvilken kolonne som er kundenavn og adresse.</p>
      `}

      <div class="wizard-required-grid">
        <div class="wizard-required-row">
          <label>
            <i aria-hidden="true" class="fas fa-user"></i>
            Kundenavn
          </label>
          <select id="navnColumnSelect" onchange="updateRequiredMapping('navn', this.value)" class="wizard-required-select">
            <option value="">-- Velg kolonne --</option>
            ${allColumns.map(col => `
              <option value="${escapeHtml(col)}" ${currentMappings.navn === col ? 'selected' : ''}>
                ${escapeHtml(col)}
              </option>
            `).join('')}
          </select>
        </div>

        <div class="wizard-required-row">
          <label>
            <i aria-hidden="true" class="fas fa-map-marker-alt"></i>
            Adresse
          </label>
          <select id="adresseColumnSelect" onchange="updateRequiredMapping('adresse', this.value)" class="wizard-required-select">
            <option value="">-- Velg kolonne --</option>
            ${allColumns.map(col => `
              <option value="${escapeHtml(col)}" ${currentMappings.adresse === col ? 'selected' : ''}>
                ${escapeHtml(col)}
              </option>
            `).join('')}
          </select>
        </div>
      </div>

      ${isSameColumnSelected() ? `
        <div class="wizard-required-warning wizard-required-error">
          <i aria-hidden="true" class="fas fa-times-circle"></i>
          <span>Kundenavn og adresse kan ikke bruke samme kolonne.</span>
        </div>
      ` : ''}
    </div>
  `;
}

// Sub-step 2: FULLAUTOMATISK forhåndsvisning
function renderWizardImportMapping() {
  const data = wizardImportState.previewData;
  if (!data) {
    return renderWizardImportUpload();
  }

  const stats = data.stats || {};
  const recognizedColumns = data.recognizedColumns || [];
  const newFields = data.newFields || [];
  const preview = data.preview || [];

  // Count AI-mapped columns
  const aiMappedCount = recognizedColumns.filter(c => c.source === 'ai').length;
  const deterministicCount = recognizedColumns.filter(c => c.source === 'deterministic').length;

  return `
    <div class="wizard-auto-preview">
      <!-- Summary header -->
      <div class="wizard-auto-summary">
        <div class="wizard-auto-success">
          <i aria-hidden="true" class="fas fa-check-circle"></i>
          <span>Fant <strong>${data.totalRows || 0}</strong> kunder i filen</span>
        </div>

        <div class="wizard-auto-stats">
          <div class="wizard-auto-stat">
            <i aria-hidden="true" class="fas fa-columns"></i>
            <span>${data.totalColumns || 0} kolonner totalt</span>
          </div>
          <div class="wizard-auto-stat wizard-auto-stat-success">
            <i aria-hidden="true" class="fas fa-check"></i>
            <span>${recognizedColumns.length} gjenkjent</span>
          </div>
          ${newFields.length > 0 ? `
            <div class="wizard-auto-stat wizard-auto-stat-new">
              <i aria-hidden="true" class="fas fa-plus"></i>
              <span>${newFields.length} nye felt</span>
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Mapping Status indicator -->
      <div class="wizard-ai-status wizard-ai-enabled">
        <i aria-hidden="true" class="fas fa-magic"></i>
        <span>
          <strong>Automatisk kolonnemap</strong>
          ${aiMappedCount > 0 ? `- ${aiMappedCount} kolonner gjenkjent` : '- Velg kolonner manuelt nedenfor'}
        </span>
      </div>

      <!-- REQUIRED: Column selection for name and address -->
      ${renderRequiredFieldSelectors(data)}

      <!-- AI Questions for ambiguous mappings -->
      ${renderAIQuestions()}

      <!-- Recognized columns -->
      ${recognizedColumns.length > 0 ? `
        <div class="wizard-auto-section">
          <h4><i aria-hidden="true" class="fas fa-check-circle"></i> Gjenkjente kolonner</h4>
          <div class="wizard-auto-columns">
            ${recognizedColumns.map(col => `
              <div class="wizard-auto-column recognized ${col.source === 'ai' ? 'ai-mapped' : ''}">
                <span class="column-from">${escapeHtml(col.header)}</span>
                <i aria-hidden="true" class="fas fa-arrow-right"></i>
                <span class="column-to">${escapeHtml(col.mappedTo)}</span>
                ${col.source === 'ai' ? `
                  <span class="mapping-source ai" title="Mappet av AI med ${Math.round((col.confidence || 0) * 100)}% sikkerhet">
                    <i aria-hidden="true" class="fas fa-robot"></i>
                  </span>
                ` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- New fields that will be created -->
      ${newFields.length > 0 ? `
        <div class="wizard-auto-section">
          <h4><i aria-hidden="true" class="fas fa-plus-circle"></i> Nye felt som opprettes automatisk</h4>
          <div class="wizard-auto-columns">
            ${newFields.map(f => `
              <div class="wizard-auto-column new-field">
                <span class="column-from">"${escapeHtml(f.header)}"</span>
                <i aria-hidden="true" class="fas fa-arrow-right"></i>
                <span class="column-to">
                  ${escapeHtml(f.displayName)}
                  <span class="field-type">(${escapeHtml(f.typeDisplay)}${f.optionsCount > 0 ? `, ${f.optionsCount} valg` : ''})</span>
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Preview table -->
      ${preview.length > 0 ? `
        <div class="wizard-auto-section">
          <h4><i aria-hidden="true" class="fas fa-table"></i> Forhåndsvisning</h4>
          <div class="wizard-auto-table-wrapper">
            <table class="wizard-auto-table">
              <thead>
                <tr>
                  ${Object.keys(preview[0] || {}).slice(0, 6).map(key => `
                    <th>${escapeHtml(key)}</th>
                  `).join('')}
                  ${Object.keys(preview[0] || {}).length > 6 ? '<th>...</th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${preview.slice(0, 3).map(row => `
                  <tr>
                    ${Object.values(row).slice(0, 6).map(val => `
                      <td>${escapeHtml(String(val || '-'))}</td>
                    `).join('')}
                    ${Object.keys(row).length > 6 ? '<td>...</td>' : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- Validation info -->
      ${stats.invalid > 0 ? `
        <div class="wizard-auto-warning">
          <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
          <span>${stats.invalid} rader mangler påkrevd data og vil bli hoppet over</span>
        </div>
      ` : ''}
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="wizardImportBack()">
        <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
      </button>
      <button class="wizard-btn wizard-btn-primary"
        onclick="wizardImportNext()"
        ${!areRequiredFieldsMapped() ? 'disabled title="Velg kolonner for kundenavn og adresse først"' : ''}>
        Forhåndsvis <i aria-hidden="true" class="fas fa-arrow-right"></i>
      </button>
    </div>
  `;
}

/**
 * Render section for unmapped columns (columns in Excel that aren't mapped to standard fields)
 */
function renderUnmappedColumnsSection(data, headers, mapping, targetFields) {
  const unmappedColumns = data.unmappedColumns || [];

  // If no unmapped columns, return empty
  if (unmappedColumns.length === 0) {
    return '';
  }

  // Get list of mapped column indices
  const mappedIndices = new Set(Object.values(mapping).filter(v => v !== undefined && v !== ''));

  // Filter to only show columns that are truly unmapped
  const visibleUnmapped = unmappedColumns.filter(col => {
    const index = headers.indexOf(col.header);
    return !mappedIndices.has(index);
  });

  if (visibleUnmapped.length === 0) {
    return '';
  }

  // Initialize customFieldMapping if not exists
  if (!wizardImportState.customFieldMapping) {
    wizardImportState.customFieldMapping = {};
  }

  return `
    <div class="wizard-unmapped-section">
      <h4 class="wizard-section-title">
        <i aria-hidden="true" class="fas fa-plus-circle"></i>
        Ekstra kolonner i filen (${visibleUnmapped.length})
      </h4>
      <p class="wizard-section-desc">
        Disse kolonnene finnes ikke i standardfeltene. Velg hva du vil gjøre med dem:
      </p>

      <div class="wizard-unmapped-grid">
        ${visibleUnmapped.map(col => {
          const currentAction = wizardImportState.customFieldMapping[col.header] || 'ignore';
          return `
            <div class="wizard-unmapped-row">
              <div class="wizard-unmapped-info">
                <span class="wizard-unmapped-header">${escapeHtml(col.header)}</span>
                <span class="wizard-unmapped-sample">Eksempel: ${escapeHtml(col.sampleValue || '-')}</span>
              </div>
              <div class="wizard-unmapped-action">
                <select onchange="handleUnmappedColumn('${escapeJsString(col.header)}', this.value)">
                  <option value="ignore" ${currentAction === 'ignore' ? 'selected' : ''}>
                    Ignorer
                  </option>
                  <option value="create" ${currentAction === 'create' ? 'selected' : ''}>
                    Opprett felt "${escapeHtml(col.suggestedDisplayName || col.header)}"
                  </option>
                  ${targetFields.map(f => `
                    <option value="map:${f.key}" ${currentAction === 'map:' + f.key ? 'selected' : ''}>
                      Mapp til ${escapeHtml(f.label)}
                    </option>
                  `).join('')}
                </select>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

/**
 * Handle user choice for unmapped column
 */
function handleUnmappedColumn(header, action) {
  if (!wizardImportState.customFieldMapping) {
    wizardImportState.customFieldMapping = {};
  }

  if (action === 'ignore') {
    delete wizardImportState.customFieldMapping[header];
  } else if (action === 'create') {
    wizardImportState.customFieldMapping[header] = 'create';
  } else if (action.startsWith('map:')) {
    const targetField = action.substring(4);
    // Map this column to the target field
    const headers = wizardImportState.previewData?.headers || [];
    const index = headers.indexOf(header);
    if (index !== -1) {
      wizardImportState.columnMapping[targetField] = index;
    }
    delete wizardImportState.customFieldMapping[header];
  }

  updateWizardImportContent();
}

// Expose to window
window.handleUnmappedColumn = handleUnmappedColumn;

// Sub-step 3: Preview with category mapping
function renderWizardImportPreview() {
  const data = wizardImportState.previewData;
  if (!data || !data.preview) {
    return renderWizardImportMapping();
  }

  const preview = data.preview;
  const stats = data.stats || {};
  const categoryMatches = data.categoryMatches || [];
  const reimportPreview = data.reimportPreview || {};
  const features = data.features || {};
  const validCategories = wizardImportState.validCategories || [];

  // Build category mapping UI if there are unmatched categories
  let categoryMappingHtml = '';
  if (categoryMatches.length > 0) {
    categoryMappingHtml = `
      <div class="wizard-category-mapping">
        <h4><i aria-hidden="true" class="fas fa-tags"></i> Kategori-mapping</h4>
        <p>Følgende kategorier ble funnet i filen. Koble dem til eksisterende kategorier eller opprett nye.</p>
        <div class="wizard-category-list">
          ${categoryMatches.map(match => `
            <div class="wizard-category-row">
              <div class="wizard-category-original">
                <span class="category-label">Fra fil:</span>
                <span class="category-value">${escapeHtml(match.original)}</span>
                <span class="category-count">(${match.count} kunder)</span>
              </div>
              <div class="wizard-category-arrow"><i aria-hidden="true" class="fas fa-arrow-right"></i></div>
              <div class="wizard-category-select">
                <select data-original="${escapeHtml(match.original)}" onchange="updateWizardCategoryMapping('${escapeJsString(match.original)}', this.value)">
                  ${match.suggested ? `
                    <option value="${escapeHtml(match.suggested.id)}" selected>
                      ${escapeHtml(match.suggested.name)} (anbefalt)
                    </option>
                  ` : '<option value="">-- Velg kategori --</option>'}
                  ${validCategories.filter(c => !match.suggested || c.id !== match.suggested.id).map(cat => `
                    <option value="${escapeHtml(cat.id)}">${escapeHtml(cat.name)}</option>
                  `).join('')}
                  <option value="__skip__">Hopp over (ingen kategori)</option>
                  <option value="__new__">Opprett ny kategori</option>
                </select>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // Determine display columns dynamically from mapped data
  const sampleRow = preview[0] || {};
  const allMappedFields = Object.keys(sampleRow).filter(k =>
    !k.startsWith('_') && k !== 'hasError' && k !== 'hasWarning' &&
    k !== 'errorMessage' && k !== 'validationErrors' && k !== 'fieldErrors'
  );
  const standardFields = ['navn', 'adresse', 'postnummer', 'poststed', 'epost', 'telefon', 'kontaktperson', 'kategori', 'siste_kontroll', 'neste_kontroll'];
  const displayColumns = [
    ...standardFields.filter(f => allMappedFields.includes(f)),
    ...allMappedFields.filter(f => !standardFields.includes(f))
  ];

  // Paginated preview
  const previewPageSize = 50;
  const previewPage = wizardImportState.previewTablePage || 0;
  const previewTotalPages = Math.ceil(preview.length / previewPageSize);
  const validPreviewPage = Math.min(previewPage, Math.max(0, previewTotalPages - 1));
  const previewRows = preview.slice(validPreviewPage * previewPageSize, (validPreviewPage + 1) * previewPageSize);

  // Before/after toggle state
  const showBeforeAfter = wizardImportState.previewShowBeforeAfter;
  const fieldToHeader = wizardImportState.fieldToHeaderMapping || {};

  return `
    <div class="wizard-import-preview">
      <!-- Stats summary -->
      <div class="wizard-preview-stats">
        <div class="stat-item">
          <i aria-hidden="true" class="fas fa-file-alt"></i>
          <span class="stat-value">${stats.totalRows || 0}</span>
          <span class="stat-label">Totalt rader</span>
        </div>
        <div class="stat-item ${stats.validRows > 0 ? 'success' : ''}">
          <i aria-hidden="true" class="fas fa-check-circle"></i>
          <span class="stat-value">${stats.validRows || 0}</span>
          <span class="stat-label">Gyldige</span>
        </div>
        <div class="stat-item ${stats.warnings > 0 ? 'warning' : ''}">
          <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
          <span class="stat-value">${stats.warnings || 0}</span>
          <span class="stat-label">Advarsler</span>
        </div>
        <div class="stat-item ${stats.errors > 0 ? 'error' : ''}">
          <i aria-hidden="true" class="fas fa-times-circle"></i>
          <span class="stat-value">${stats.errors || 0}</span>
          <span class="stat-label">Feil</span>
        </div>
        <div class="stat-item ${stats.duplicates > 0 ? 'warning' : ''}">
          <i aria-hidden="true" class="fas fa-copy"></i>
          <span class="stat-value">${stats.duplicates || 0}</span>
          <span class="stat-label">Duplikater</span>
        </div>
      </div>

      ${features.updateEnabled || features.deletionDetectionEnabled ? `
        <!-- Re-import Preview Summary -->
        <div class="wizard-reimport-summary">
          <h4><i aria-hidden="true" class="fas fa-sync-alt"></i> Oppsummering av import</h4>
          <div class="wizard-reimport-stats">
            <div class="reimport-stat-item new">
              <i aria-hidden="true" class="fas fa-plus-circle"></i>
              <span class="stat-value">${reimportPreview.toCreate || 0}</span>
              <span class="stat-label">Nye kunder</span>
            </div>
            ${features.updateEnabled ? `
              <div class="reimport-stat-item update">
                <i aria-hidden="true" class="fas fa-edit"></i>
                <span class="stat-value">${reimportPreview.toUpdate || 0}</span>
                <span class="stat-label">Oppdateres</span>
              </div>
              <div class="reimport-stat-item unchanged">
                <i aria-hidden="true" class="fas fa-equals"></i>
                <span class="stat-value">${reimportPreview.unchanged || 0}</span>
                <span class="stat-label">Uendret</span>
              </div>
            ` : ''}
          </div>
          ${features.deletionDetectionEnabled && reimportPreview.notInImport && reimportPreview.notInImport.length > 0 ? `
            <div class="wizard-not-in-import-info">
              <i aria-hidden="true" class="fas fa-info-circle"></i>
              <div>
                <strong>${reimportPreview.notInImport.length} eksisterende kunder finnes ikke i importfilen</strong>
                <p>Disse kundene vil <strong>IKKE</strong> bli slettet. De vises kun for informasjon.</p>
                <details>
                  <summary>Vis kunder</summary>
                  <ul class="not-in-import-list">
                    ${reimportPreview.notInImport.slice(0, 10).map(k => `
                      <li>${escapeHtml(k.navn)} - ${escapeHtml(k.adresse)}</li>
                    `).join('')}
                    ${reimportPreview.notInImport.length > 10 ? `<li>...og ${reimportPreview.notInImport.length - 10} flere</li>` : ''}
                  </ul>
                </details>
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${categoryMappingHtml}

      <!-- Preview table with selection -->
      <div class="wizard-preview-table-wrapper">
        <div class="wizard-preview-header">
          <h4><i aria-hidden="true" class="fas fa-table"></i> Forhåndsvisning (${preview.length} rader)</h4>
          <div class="wizard-preview-controls">
            <label class="wizard-toggle-label">
              <input type="checkbox" ${showBeforeAfter ? 'checked' : ''}
                onchange="wizardToggleBeforeAfter(this.checked)">
              <span>Vis transformasjoner</span>
            </label>
            <div class="wizard-selection-actions">
              <button class="wizard-btn wizard-btn-small" onclick="wizardSelectAllRows()">
                <i aria-hidden="true" class="fas fa-check-square"></i> Velg alle
              </button>
              <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDeselectAllRows()">
                <i aria-hidden="true" class="fas fa-square"></i> Velg ingen
              </button>
              <span class="wizard-selection-count" id="wizardSelectionCount">
                ${getSelectedRowCount()} av ${stats.validRows || 0} valgt
              </span>
            </div>
          </div>
        </div>
        <p class="wizard-edit-hint"><i aria-hidden="true" class="fas fa-info-circle"></i> Dobbeltklikk på en celle for å redigere</p>
        <table class="wizard-preview-table wizard-preview-table-editable">
          <thead>
            <tr>
              <th class="col-checkbox">
                <input type="checkbox" id="wizardSelectAllCheckbox" onchange="wizardToggleAllRows(this.checked)" ${areAllRowsSelected(previewRows) ? 'checked' : ''}>
              </th>
              <th class="col-rownum">#</th>
              ${displayColumns.map(col => `<th>${escapeHtml(col)}</th>`).join('')}
              <th class="col-status">Status</th>
            </tr>
          </thead>
          <tbody>
            ${previewRows.map((row, localIdx) => {
              const globalIdx = validPreviewPage * previewPageSize + localIdx;
              const isSelected = wizardImportState.selectedRows.has(globalIdx);
              const rowEdits = wizardImportState.editedRows[globalIdx] || {};
              const rowClass = !isSelected ? 'row-excluded' : (row.hasError ? 'row-error' : (row.hasWarning ? 'row-warning' : 'row-valid'));

              return `
              <tr class="${rowClass}" data-row-index="${globalIdx}">
                <td class="col-checkbox">
                  <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="wizardToggleRow(${globalIdx}, this.checked)">
                </td>
                <td class="col-rownum">${globalIdx + 1}</td>
                ${displayColumns.map(col => {
                  const originalValue = row[col] || '';
                  const editedValue = rowEdits[col];
                  const displayValue = editedValue !== undefined ? editedValue : originalValue;
                  const isEdited = editedValue !== undefined && editedValue !== originalValue;
                  const hasFieldError = row.fieldErrors && row.fieldErrors[col];

                  // Before/after transformation comparison
                  const sourceHeader = fieldToHeader[col];
                  const rawVal = row._rawValues ? String(row._rawValues[sourceHeader] || row._rawValues[col] || '') : '';
                  const mappedVal = row._mappedValues ? String(row._mappedValues[col] || '') : '';
                  const wasTransformed = showBeforeAfter && rawVal && mappedVal && rawVal !== mappedVal;

                  const cellTitle = wasTransformed
                    ? `Fra fil: ${String(rawVal)}`
                    : (hasFieldError ? escapeHtml(hasFieldError) : (isEdited ? 'Redigert (original: ' + escapeHtml(originalValue) + ')' : 'Dobbeltklikk for å redigere'));

                  return `
                  <td class="import-cell-editable ${isEdited ? 'cell-edited' : ''} ${hasFieldError ? 'cell-error' : ''} ${wasTransformed ? 'cell-transformed' : ''}"
                      data-row="${globalIdx}"
                      data-field="${col}"
                      data-original="${escapeHtml(originalValue)}"
                      ondblclick="wizardStartCellEdit(${globalIdx}, '${col}')"
                      title="${escapeHtml(cellTitle)}">
                    ${wasTransformed ? `<span class="cell-before">${escapeHtml(rawVal)}</span> <i aria-hidden="true" class="fas fa-arrow-right cell-arrow"></i> <span class="cell-after">${escapeHtml(mappedVal)}</span>` : escapeHtml(displayValue || '-')}
                  </td>
                `;}).join('')}
                <td class="col-status">
                  ${!isSelected ? '<span class="status-excluded" title="Ikke valgt for import"><i aria-hidden="true" class="fas fa-minus-circle"></i></span>' :
                    row.hasError ? `<span class="status-error" title="${escapeHtml(row.errorMessage || 'Feil')}"><i aria-hidden="true" class="fas fa-times-circle"></i></span>` :
                    row.hasWarning ? `<span class="status-warning" title="${escapeHtml(row.warningMessage || 'Advarsel')}"><i aria-hidden="true" class="fas fa-exclamation-triangle"></i></span>` :
                    '<span class="status-ok"><i aria-hidden="true" class="fas fa-check-circle"></i></span>'}
                </td>
              </tr>
            `;}).join('')}
          </tbody>
        </table>
      </div>

      ${previewTotalPages > 1 ? `
        <div class="wizard-preview-pagination">
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary"
            onclick="wizardPreviewTablePage(${validPreviewPage - 1})" ${validPreviewPage === 0 ? 'disabled' : ''}>
            <i aria-hidden="true" class="fas fa-chevron-left"></i> Forrige
          </button>
          <span>Side ${validPreviewPage + 1} av ${previewTotalPages}</span>
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary"
            onclick="wizardPreviewTablePage(${validPreviewPage + 1})" ${validPreviewPage >= previewTotalPages - 1 ? 'disabled' : ''}>
            Neste <i aria-hidden="true" class="fas fa-chevron-right"></i>
          </button>
        </div>
      ` : ''}

      ${stats.errors > 0 ? `
        <div class="wizard-preview-warning">
          <i aria-hidden="true" class="fas fa-info-circle"></i>
          <p>${stats.errors} rad(er) har feil og vil ikke bli importert. Du kan redigere eller fjerne dem fra utvalget.</p>
        </div>
      ` : ''}

      ${renderErrorGrouping(preview)}

      ${data.qualityReport ? renderQualityReport(data.qualityReport) : ''}
    </div>

    <div class="wizard-footer">
      <button class="wizard-btn wizard-btn-secondary" onclick="wizardImportBack()">
        <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
      </button>
      <div class="wizard-footer-right">
        ${wizardImportState.batchId ? `
          <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDownloadErrorReport()" title="Last ned feilrapport som CSV">
            <i aria-hidden="true" class="fas fa-download"></i> Feilrapport
          </button>
        ` : ''}
        <button class="wizard-btn wizard-btn-primary" onclick="wizardStartImport()" ${getSelectedValidRowCount() === 0 ? 'disabled' : ''}>
          <i aria-hidden="true" class="fas fa-file-import"></i> Importer ${getSelectedValidRowCount()} kunder
        </button>
      </div>
    </div>
  `;
}

// Sub-step 4: Import results
function renderWizardImportResults() {
  const results = wizardImportState.importResults;
  if (!results) {
    return renderWizardImportPreview();
  }

  const isSuccess = results.success && results.importedCount > 0;

  return `
    <div class="wizard-import-results">
      <div class="wizard-results-icon ${isSuccess ? 'success' : 'partial'}">
        <i aria-hidden="true" class="fas ${isSuccess ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
      </div>

      <h2>${isSuccess ? 'Import fullført!' : 'Import delvis fullført'}</h2>

      <div class="wizard-results-stats">
        ${results.createdCount > 0 ? `
          <div class="result-stat success">
            <i aria-hidden="true" class="fas fa-plus"></i>
            <span class="stat-value">${results.createdCount}</span>
            <span class="stat-label">Nye kunder opprettet</span>
          </div>
        ` : ''}
        ${results.updatedCount > 0 ? `
          <div class="result-stat info">
            <i aria-hidden="true" class="fas fa-sync-alt"></i>
            <span class="stat-value">${results.updatedCount}</span>
            <span class="stat-label">Eksisterende oppdatert</span>
          </div>
        ` : ''}
        ${!results.createdCount && !results.updatedCount ? `
          <div class="result-stat success">
            <i aria-hidden="true" class="fas fa-check"></i>
            <span class="stat-value">${results.importedCount || 0}</span>
            <span class="stat-label">Kunder importert</span>
          </div>
        ` : ''}
        ${results.skippedCount > 0 ? `
          <div class="result-stat warning">
            <i aria-hidden="true" class="fas fa-forward"></i>
            <span class="stat-value">${results.skippedCount}</span>
            <span class="stat-label">Hoppet over</span>
          </div>
        ` : ''}
        ${results.errorCount > 0 ? `
          <div class="result-stat error">
            <i aria-hidden="true" class="fas fa-times"></i>
            <span class="stat-value">${results.errorCount}</span>
            <span class="stat-label">Feilet</span>
          </div>
        ` : ''}
      </div>

      ${results.importedCount > 0 || results.createdCount > 0 || results.updatedCount > 0 ? `
        <p class="wizard-results-message">
          Kundene er nå tilgjengelige i systemet. Du kan se dem på kartet etter at oppsettet er fullført.
          ${results.durationMs ? `<br><small>Importert på ${(results.durationMs / 1000).toFixed(1)} sekunder.</small>` : ''}
        </p>
      ` : ''}

      ${results.errors && results.errors.length > 0 ? `
        <div class="wizard-results-errors">
          <h4><i aria-hidden="true" class="fas fa-exclamation-triangle"></i> Feil under import</h4>
          <ul>
            ${results.errors.slice(0, 5).map(err => `
              <li>${escapeHtml((err.rowNumber || err.row) ? `Rad ${err.rowNumber || err.row}: ` : '')}${escapeHtml(err.error || err.message || 'Ukjent feil')}</li>
            `).join('')}
            ${results.errors.length > 5 ? `<li>...og ${results.errors.length - 5} flere feil</li>` : ''}
          </ul>
        </div>
      ` : ''}
    </div>

    <div class="wizard-footer wizard-footer-center">
      ${results.batchId ? `
        <button class="wizard-btn wizard-btn-secondary" onclick="wizardRollbackImport()" title="Angre hele importen">
          <i aria-hidden="true" class="fas fa-undo"></i> Angre import
        </button>
      ` : ''}
      ${results.errorCount > 0 ? `
        <button class="wizard-btn wizard-btn-secondary" onclick="wizardReimportFailed()" title="Prøv å importere feilede rader på nytt">
          <i aria-hidden="true" class="fas fa-redo"></i> Reimporter feilede (${results.errorCount})
        </button>
      ` : ''}
      ${results.batchId ? `
        <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDownloadErrorReport()" title="Last ned feilrapport">
          <i aria-hidden="true" class="fas fa-download"></i> Feilrapport
        </button>
      ` : ''}
      ${standaloneImportMode ? `
        <button class="wizard-btn wizard-btn-primary" onclick="closeImportModal()">
          <i aria-hidden="true" class="fas fa-check"></i> Ferdig
        </button>
      ` : `
        <button class="wizard-btn wizard-btn-primary" onclick="wizardImportComplete()">
          Fortsett til neste steg <i aria-hidden="true" class="fas fa-arrow-right"></i>
        </button>
      `}
    </div>
  `;
}

// ========================================
// ROW SELECTION AND EDITING FUNCTIONS
// ========================================

// Initialize row selection when preview data is loaded
function initializeRowSelection() {
  const data = wizardImportState.previewData;
  if (!data || !data.preview) return;

  // Select all valid rows by default
  wizardImportState.selectedRows = new Set();
  data.preview.forEach((row, index) => {
    if (!row.hasError) {
      wizardImportState.selectedRows.add(index);
    }
  });
}

// Get count of selected rows
function getSelectedRowCount() {
  return wizardImportState.selectedRows.size;
}

// Get count of selected valid rows (for import)
function getSelectedValidRowCount() {
  const data = wizardImportState.previewData;
  if (!data || !data.preview) return 0;

  let count = 0;
  wizardImportState.selectedRows.forEach(index => {
    if (data.preview[index] && !data.preview[index].hasError) {
      count++;
    }
  });
  return count;
}

// Check if all valid rows are selected
function areAllRowsSelected(previewRows, startIdx = 0) {
  if (!previewRows || previewRows.length === 0) return false;

  for (let i = 0; i < previewRows.length; i++) {
    const globalIdx = previewRows[i]._originalIndex !== undefined ? previewRows[i]._originalIndex : (startIdx + i);
    if (!previewRows[i].hasError && !wizardImportState.selectedRows.has(globalIdx)) {
      return false;
    }
  }
  return true;
}

// Toggle single row selection
function wizardToggleRow(rowIndex, isSelected) {
  if (isSelected) {
    wizardImportState.selectedRows.add(rowIndex);
  } else {
    wizardImportState.selectedRows.delete(rowIndex);
  }
  updateSelectionDisplay();
}

// Toggle all rows
function wizardToggleAllRows(isSelected) {
  const data = wizardImportState.previewData;
  if (!data || !data.preview) return;

  if (isSelected) {
    data.preview.forEach((row, index) => {
      if (!row.hasError) {
        wizardImportState.selectedRows.add(index);
      }
    });
  } else {
    wizardImportState.selectedRows.clear();
  }
  updateWizardImportContent();
}

// Select all valid rows
function wizardSelectAllRows() {
  wizardToggleAllRows(true);
}

// Deselect all rows
function wizardDeselectAllRows() {
  wizardToggleAllRows(false);
}

// Update selection count display
function updateSelectionDisplay() {
  const countEl = document.getElementById('wizardSelectionCount');
  const data = wizardImportState.previewData;
  if (countEl && data && data.stats) {
    countEl.textContent = `${getSelectedRowCount()} av ${data.stats.validRows || 0} valgt`;
  }

  // Update select all checkbox
  const selectAllCheckbox = document.getElementById('wizardSelectAllCheckbox');
  if (selectAllCheckbox && data && data.preview) {
    selectAllCheckbox.checked = areAllRowsSelected(data.preview.slice(0, 10));
  }

  // Update import button
  const importBtn = document.querySelector('.wizard-footer .wizard-btn-primary');
  if (importBtn) {
    const count = getSelectedValidRowCount();
    importBtn.disabled = count === 0;
    importBtn.innerHTML = `<i aria-hidden="true" class="fas fa-file-import"></i> Importer ${count} kunder`;
  }

  // Update row styling
  document.querySelectorAll('.wizard-preview-table tbody tr').forEach(row => {
    const index = parseInt(row.dataset.rowIndex);
    const isSelected = wizardImportState.selectedRows.has(index);
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = isSelected;

    // Update row class
    row.classList.toggle('row-excluded', !isSelected);
  });
}

// Start editing a cell
function wizardStartCellEdit(rowIndex, field) {
  const cell = document.querySelector(`td[data-row="${rowIndex}"][data-field="${field}"]`);
  if (!cell) return;

  const originalValue = cell.dataset.original || '';
  const currentValue = wizardImportState.editedRows[rowIndex]?.[field] ?? originalValue;

  // Create input element
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cell-edit-input';
  input.value = currentValue;

  // Clear cell and add input
  cell.innerHTML = '';
  cell.appendChild(input);
  cell.classList.add('cell-editing');

  // Focus and select all
  input.focus();
  input.select();

  // Handle blur (save)
  input.addEventListener('blur', () => {
    wizardSaveCellEdit(rowIndex, field, input.value, originalValue);
  });

  // Handle keyboard
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      wizardCancelCellEdit(rowIndex, field, originalValue);
    } else if (e.key === 'Tab') {
      // Allow tab to save and move to next cell
      input.blur();
    }
  });

  wizardImportState.editingCell = { row: rowIndex, field };
}

// Save cell edit
function wizardSaveCellEdit(rowIndex, field, newValue, originalValue) {
  const cell = document.querySelector(`td[data-row="${rowIndex}"][data-field="${field}"]`);
  if (!cell) return;

  // Store edited value if different from original
  if (newValue !== originalValue) {
    if (!wizardImportState.editedRows[rowIndex]) {
      wizardImportState.editedRows[rowIndex] = {};
    }
    wizardImportState.editedRows[rowIndex][field] = newValue;
  } else {
    // Remove edit if reverted to original
    if (wizardImportState.editedRows[rowIndex]) {
      delete wizardImportState.editedRows[rowIndex][field];
      if (Object.keys(wizardImportState.editedRows[rowIndex]).length === 0) {
        delete wizardImportState.editedRows[rowIndex];
      }
    }
  }

  // Update cell display
  const isEdited = newValue !== originalValue;
  cell.innerHTML = escapeHtml(newValue || '-');
  cell.classList.remove('cell-editing');
  cell.classList.toggle('cell-edited', isEdited);
  cell.title = isEdited ? `Redigert (original: ${originalValue})` : 'Dobbeltklikk for å redigere';

  wizardImportState.editingCell = null;
}

// Cancel cell edit
function wizardCancelCellEdit(rowIndex, field, originalValue) {
  const cell = document.querySelector(`td[data-row="${rowIndex}"][data-field="${field}"]`);
  if (!cell) return;

  const currentValue = wizardImportState.editedRows[rowIndex]?.[field] ?? originalValue;
  const isEdited = currentValue !== originalValue;

  cell.innerHTML = escapeHtml(currentValue || '-');
  cell.classList.remove('cell-editing');
  cell.classList.toggle('cell-edited', isEdited);

  wizardImportState.editingCell = null;
}

// Expose functions to window for onclick handlers
window.wizardToggleRow = wizardToggleRow;
window.wizardToggleAllRows = wizardToggleAllRows;
window.wizardSelectAllRows = wizardSelectAllRows;
window.wizardDeselectAllRows = wizardDeselectAllRows;
window.wizardStartCellEdit = wizardStartCellEdit;

// Update column mapping
function updateWizardMapping(field, value) {
  if (value === '') {
    delete wizardImportState.columnMapping[field];
  } else {
    wizardImportState.columnMapping[field] = parseInt(value, 10);
  }
}

// Update category mapping
function updateWizardCategoryMapping(original, value) {
  if (value === '' || value === '__skip__') {
    delete wizardImportState.categoryMapping[original];
  } else if (value === '__new__') {
    // Create new category with same name
    wizardImportState.categoryMapping[original] = { createNew: true, name: original };
  } else {
    wizardImportState.categoryMapping[original] = value;
  }
}

// Validate required mappings
function validateWizardMapping() {
  const required = wizardImportState.requiredMappings;
  const errors = [];

  if (!required.navn || required.navn === '' || required.navn === '-- Velg kolonne --') {
    errors.push('Kundenavn er påkrevd - velg kolonne for navn');
  }
  if (!required.adresse || required.adresse === '' || required.adresse === '-- Velg kolonne --') {
    errors.push('Adresse er påkrevd - velg kolonne for adresse');
  }

  return errors;
}

// Navigate between import sub-steps
function wizardImportBack() {
  if (wizardImportState.currentImportStep > 1) {
    wizardImportState.currentImportStep--;
    wizardImportState.error = null;
    updateWizardImportContent();
  }
}

async function wizardImportNext() {
  const currentStep = wizardImportState.currentImportStep;

  if (currentStep === 3) {
    // Validate mapping before proceeding (mapping is now step 3)
    const errors = validateWizardMapping();
    if (errors.length > 0) {
      showMessage(errors.join('. '), 'error');
      return;
    }

    // Call preview API with mapping
    await wizardFetchPreview();
  } else if (currentStep < 5) {
    wizardImportState.currentImportStep++;
    updateWizardImportContent();
  }
}

// Skip import and go to next wizard step
function skipWizardImport() {
  resetWizardImportState();
  nextWizardStep();
}

// Complete import and go to next wizard step
function wizardImportComplete() {
  resetWizardImportState();
  nextWizardStep();
}

// Retry after error
function wizardImportRetry() {
  wizardImportState.error = null;
  wizardImportState.isLoading = false;
  if (wizardImportState.currentImportStep > 1) {
    wizardImportState.currentImportStep = 1;
  }
  updateWizardImportContent();
}

// Update wizard import content without re-rendering entire wizard
function updateWizardImportContent() {
  const container = document.getElementById('wizardImportContent');
  if (container) {
    container.innerHTML = renderWizardImportSubStep(wizardImportState.currentImportStep);
    attachWizardImportListeners();
  }

  // Update sub-step indicators
  const indicators = document.querySelectorAll('.import-step-indicator');
  const connectors = document.querySelectorAll('.import-step-connector');
  indicators.forEach((indicator, index) => {
    const step = index + 1;
    indicator.classList.toggle('active', step <= wizardImportState.currentImportStep);
  });
  connectors.forEach((connector, index) => {
    const step = index + 2;
    connector.classList.toggle('active', step <= wizardImportState.currentImportStep);
  });
}

// Attach event listeners for wizard import
function attachWizardImportListeners() {
  const dropzone = document.getElementById('wizardImportDropzone');
  const fileInput = document.getElementById('wizardImportFileInput');

  if (!dropzone || !fileInput) return;

  // Click to select file
  dropzone.addEventListener('click', () => fileInput.click());

  // Keyboard support for dropzone (WCAG 2.1.1)
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  // Drag and drop handlers
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dragover');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      wizardHandleFileSelect(files[0]);
    }
  });

  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      wizardHandleFileSelect(e.target.files[0]);
    }
  });
}

// Handle file selection
async function wizardHandleFileSelect(file) {
  // Validate file type
  const validTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv', // .csv
    'application/csv'
  ];
  const validExtensions = ['.xlsx', '.xls', '.csv'];
  const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

  if (!validTypes.includes(file.type) && !validExtensions.includes(extension)) {
    showMessage('Ugyldig filtype. Bruk .xlsx, .xls eller .csv', 'error');
    return;
  }

  // Validate file size (10MB max)
  if (file.size > 10 * 1024 * 1024) {
    showMessage('Filen er for stor. Maks størrelse er 10MB', 'error');
    return;
  }

  // Show loading with phases
  wizardImportState.isLoading = true;
  wizardImportState.loadingPhase = 'uploading';
  updateWizardImportContent();

  let phaseTimer1, phaseTimer2;
  try {
    // Upload file and get initial preview
    const formData = new FormData();
    formData.append('file', file);

    // Switch to parsing phase after a brief moment (track timers for cleanup)
    phaseTimer1 = setTimeout(() => {
      if (wizardImportState.isLoading) {
        wizardImportState.loadingPhase = 'parsing';
        updateWizardImportContent();
      }
    }, 500);

    // Switch to AI mapping phase after parsing starts
    phaseTimer2 = setTimeout(() => {
      if (wizardImportState.isLoading) {
        wizardImportState.loadingPhase = 'ai-mapping';
        updateWizardImportContent();
      }
    }, 1200);

    const importPreviewHeaders = {
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      importPreviewHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/import/upload', {
      method: 'POST',
      headers: importPreviewHeaders,
      credentials: 'include',
      body: formData
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      const errorMsg = result.error?.message || (typeof result.error === 'string' ? result.error : null) || 'Kunne ikke behandle filen';
      throw new Error(errorMsg);
    }

    // Store batch ID from staging backend
    wizardImportState.batchId = result.data.batchId;

    // Store preview data in memory
    wizardImportState.previewData = result.data;

    // Store original and cleaned preview data for the cleaning step
    wizardImportState.originalPreview = result.data.originalPreview;
    wizardImportState.cleanedPreview = result.data.cleanedPreview || result.data.originalPreview;
    wizardImportState.cleaningReport = result.data.cleaningReport || null;

    // Initialize cleaning rule toggles (all enabled by default)
    if (result.data.cleaningReport && result.data.cleaningReport.rules) {
      const enabledRules = {};
      result.data.cleaningReport.rules.forEach(rule => {
        enabledRules[rule.ruleId] = rule.enabled;
      });
      wizardImportState.enabledCleaningRules = enabledRules;
    }

    // Initialize required field mappings from suggested mapping
    const suggestedMapping = result.data.suggestedMapping || {};
    const headers = result.data.headers || [];

    // Find which header maps to 'navn' and 'adresse'
    let navnHeader = null;
    let adresseHeader = null;
    for (const [header, field] of Object.entries(suggestedMapping)) {
      if (field === 'navn') navnHeader = header;
      if (field === 'adresse') adresseHeader = header;
    }

    wizardImportState.requiredMappings = {
      navn: navnHeader || headers[0] || null,
      adresse: adresseHeader || headers[1] || null
    };
    console.log('[DEBUG] Required mappings initialized:', wizardImportState.requiredMappings);

    // Convert backend mapping format to frontend format (header -> field becomes field -> headerIndex)
    const backendMapping = suggestedMapping;
    wizardImportState.columnMapping = convertBackendToFrontendMapping(backendMapping, headers);

    wizardImportState.validCategories = result.data.validCategories || [];
    wizardImportState.isLoading = false;
    clearTimeout(phaseTimer1);
    clearTimeout(phaseTimer2);

    // Pre-fill category mapping with suggestions
    if (result.data.categoryMatches) {
      result.data.categoryMatches.forEach(match => {
        if (match.suggested) {
          wizardImportState.categoryMapping[match.original] = match.suggested.id;
        }
      });
    }

    // Always go to cleaning step first (step 2)
    wizardImportState.currentImportStep = 2;
    updateWizardImportContent();

  } catch (error) {
    console.error('Wizard import error:', error);
    wizardImportState.isLoading = false;
    clearTimeout(phaseTimer1);
    clearTimeout(phaseTimer2);
    wizardImportState.error = error.message || 'En feil oppstod under behandling av filen';
    updateWizardImportContent();
  }
}

// Apply mapping and show preview (all in memory, no backend call)
async function wizardFetchPreview() {
  const data = wizardImportState.previewData;
  if (!data || !data.preview) {
    wizardImportState.error = 'Ingen data å vise';
    updateWizardImportContent();
    return;
  }

  // Validate required mappings
  const { navn, adresse } = wizardImportState.requiredMappings;
  if (!navn || !adresse) {
    showMessage('Du må velge kolonner for navn og adresse', 'warning');
    return;
  }

  // Build reverse mapping: field -> header (from columnMapping which is field -> headerIndex)
  const headers = data.headers || [];
  const fieldToHeader = {};
  for (const [field, headerIndex] of Object.entries(wizardImportState.columnMapping)) {
    if (headerIndex !== undefined && headers[headerIndex]) {
      fieldToHeader[field] = headers[headerIndex];
    }
  }
  // Ensure required fields are in the mapping
  fieldToHeader['navn'] = navn;
  fieldToHeader['adresse'] = adresse;

  // Store field→header mapping for before/after comparison in preview
  wizardImportState.fieldToHeaderMapping = { ...fieldToHeader };

  // If we have a batchId, use the staging API for mapping + validation
  if (wizardImportState.batchId) {
    try {
      wizardImportState.isLoading = true;
      wizardImportState.loadingPhase = 'validating';
      updateWizardImportContent();

      const csrfToken = getCsrfToken();
      const apiHeaders = { 'Content-Type': 'application/json' };
      if (csrfToken) apiHeaders['X-CSRF-Token'] = csrfToken;

      // Build ImportMappingConfig for the staging API
      const mappings = [];
      for (const [field, header] of Object.entries(fieldToHeader)) {
        mappings.push({
          sourceColumn: header,
          targetField: field,
          targetFieldType: IMPORT_FIELD_TYPE_MAP[field] || 'string',
          required: field === 'navn' || field === 'adresse',
        });
      }

      const mappingConfig = {
        version: '1.0',
        mappings,
        options: {
          skipHeaderRows: 1,
          skipEmptyRows: true,
          trimWhitespace: true,
          duplicateDetection: 'name_address',
          duplicateAction: 'skip',
          stopOnFirstError: false,
          maxErrors: 0,
          dateFormat: 'DD.MM.YYYY',
          fallbackDateFormats: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'],
          autoCreateCategories: false,
        }
      };

      // Step 1: Apply mapping to staging rows
      const mappingResponse = await fetch(`/api/import/batches/${wizardImportState.batchId}/mapping`, {
        method: 'POST',
        headers: apiHeaders,
        credentials: 'include',
        body: JSON.stringify({ mappingConfig })
      });

      const mappingResult = await mappingResponse.json();
      if (!mappingResponse.ok || !mappingResult.success) {
        throw new Error(mappingResult.error || 'Mapping feilet');
      }

      // Step 2: Validate mapped data
      const validateResponse = await fetch(`/api/import/batches/${wizardImportState.batchId}/validate`, {
        method: 'POST',
        headers: apiHeaders,
        credentials: 'include',
      });

      const validateResult = await validateResponse.json();
      if (!validateResponse.ok || !validateResult.success) {
        throw new Error(validateResult.error || 'Validering feilet');
      }

      // Step 3: Get preview with errors
      const previewResponse = await fetch(`/api/import/batches/${wizardImportState.batchId}/preview?showErrors=true&limit=200`, {
        method: 'GET',
        headers: apiHeaders,
        credentials: 'include',
      });

      const previewResult = await previewResponse.json();
      if (!previewResponse.ok || !previewResult.success) {
        throw new Error(previewResult.error || 'Forhåndsvisning feilet');
      }

      const previewData = previewResult.data;
      const validationData = validateResult.data;

      // Convert staging preview rows to format compatible with existing frontend
      const mappedPreview = previewData.previewRows.map((row, index) => {
        const hasError = row.validationStatus === 'invalid';
        const hasWarning = row.validationStatus === 'warning';
        const errorMessages = (row.errors || []).map(e => e.message).join('; ');

        // Use mapped_data for display, fall back to raw values
        const rawValues = row.values || {};
        const displayData = row.mappedValues || rawValues;

        return {
          ...rawValues,
          _rowIndex: index,
          _stagingRowId: row.stagingRowId || row.rowNumber, // Use actual DB ID for exclusion/edits
          _selected: !hasError,
          _rawValues: rawValues,        // Preserve raw for before/after comparison
          _mappedValues: displayData,   // Preserve mapped for before/after comparison
          hasError,
          hasWarning,
          errorMessage: errorMessages,
          validationErrors: row.errors || [],
          ...displayData
        };
      });

      // Update preview data with validated results
      wizardImportState.previewData = {
        ...data,
        preview: mappedPreview,
        stats: {
          totalRows: previewData.totalRows,
          validRows: validationData.validCount,
          warnings: validationData.warningCount,
          errors: validationData.errorCount,
        }
      };

      wizardImportState.isLoading = false;
      wizardImportState.currentImportStep = 4;
      initializeRowSelection();
      updateWizardImportContent();
      return;

    } catch (error) {
      console.error('Staging API preview error:', error);
      wizardImportState.isLoading = false;
      // Fall through to client-side preview as fallback
    }
  }

  // Fallback: Client-side mapping preview (when no batchId)
  let validRows = 0;
  let errorRows = 0;

  const mappedPreview = data.preview.map((row, index) => {
    const mappedRow = { ...row };
    const navnValue = String(row[navn] || '').trim();
    const adresseValue = String(row[adresse] || '').trim();

    let hasError = false;
    let errorMessage = '';

    if (!navnValue) {
      hasError = true;
      errorMessage = 'Mangler navn';
    } else if (!adresseValue) {
      hasError = true;
      errorMessage = 'Mangler adresse';
    }

    if (hasError) {
      errorRows++;
    } else {
      validRows++;
    }

    const mappedFields = {};
    for (const [field, header] of Object.entries(fieldToHeader)) {
      mappedFields[field] = String(row[header] || '').trim();
    }

    return {
      ...mappedRow,
      _rowIndex: index,
      _selected: !hasError,
      _rawValues: { ...row },
      _mappedValues: { ...mappedFields },
      hasError,
      errorMessage,
      ...mappedFields
    };
  });

  wizardImportState.previewData = {
    ...data,
    preview: mappedPreview,
    stats: {
      totalRows: data.totalRows,
      validRows: validRows,
      warnings: 0,
      errors: errorRows
    }
  };

  wizardImportState.isLoading = false;
  wizardImportState.currentImportStep = 4;
  initializeRowSelection();
  updateWizardImportContent();
}

// Execute import - sends requiredMappings to override AI mapping
async function wizardStartImport(confirmUpdate = false, confirmDeletions = false) {
  // Enhanced validation of required field mappings
  const { navn, adresse } = wizardImportState.requiredMappings;

  if (!navn || navn === '' || navn === '-- Velg kolonne --') {
    showMessage('Du må velge hvilken kolonne som inneholder kundenavn', 'error');
    return;
  }

  if (!adresse || adresse === '' || adresse === '-- Velg kolonne --') {
    showMessage('Du må velge hvilken kolonne som inneholder adresse', 'error');
    return;
  }

  // Check if same column is selected for both fields
  if (navn === adresse) {
    showMessage('Kundenavn og adresse kan ikke bruke samme kolonne. Velg forskjellige kolonner.', 'error');
    return;
  }

  // Get selected rows (with any edits applied)
  const previewData = wizardImportState.previewData;
  const allRows = previewData?.preview || [];
  const selectedRows = allRows.filter((row, idx) => wizardImportState.selectedRows.has(idx));

  // Apply any edits to selected rows (use original _rowIndex for edit lookup)
  const rowsToImport = selectedRows.map(row => {
    const originalIndex = row._rowIndex !== undefined ? row._rowIndex : 0;
    const edits = wizardImportState.editedRows[originalIndex] || {};
    return { ...row, ...edits };
  });

  // Build column mapping (header name -> field name)
  const columnMapping = {
    navn: navn,
    adresse: adresse
  };

  // Add other mappings from wizardImportState.columnMapping if available
  const headers = previewData?.headers || [];
  for (const [field, headerIndex] of Object.entries(wizardImportState.columnMapping)) {
    if (headerIndex !== undefined && headers[headerIndex]) {
      columnMapping[field] = headers[headerIndex];
    }
  }

  // Log what we're sending for debugging
  console.log('Starting import with:', {
    selectedCount: rowsToImport.length,
    columnMapping: columnMapping
  });

  wizardImportState.isLoading = true;
  wizardImportState.loadingPhase = 'importing';
  wizardImportState.loadingProgress = 0;
  wizardImportState.importedSoFar = 0;
  wizardImportState.totalToImport = rowsToImport.length;
  updateWizardImportContent();

  try {
    const executeHeaders = {
      'Content-Type': 'application/json'
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      executeHeaders['X-CSRF-Token'] = csrfToken;
    }

    // Use staging commit API if we have a batchId, otherwise fall back to simple API
    if (wizardImportState.batchId) {
      const batchId = wizardImportState.batchId;

      // --- Step 1: Apply column mapping ---
      wizardImportState.loadingPhase = 'mapping';
      updateWizardImportContent();

      // Build ImportMappingConfig from frontend state
      const mappingHeaders = wizardImportState.previewData?.headers || [];
      const mappings = [];

      // Add required mappings (navn, adresse) from requiredMappings (header names)
      for (const [field, headerName] of Object.entries(wizardImportState.requiredMappings)) {
        if (headerName) {
          const idx = mappingHeaders.indexOf(headerName);
          mappings.push({
            sourceColumn: headerName,
            sourceColumnIndex: idx >= 0 ? idx : undefined,
            targetField: field,
            targetFieldType: IMPORT_FIELD_TYPE_MAP[field] || 'string',
            required: true,
            humanConfirmed: true,
          });
        }
      }

      // Add other mappings from columnMapping (field -> headerIndex)
      for (const [field, headerIndex] of Object.entries(wizardImportState.columnMapping)) {
        // Skip if already added via requiredMappings
        if (field === 'navn' || field === 'adresse') continue;
        if (headerIndex === undefined || headerIndex === '') continue;
        const sourceColumn = mappingHeaders[headerIndex];
        if (!sourceColumn) continue;
        mappings.push({
          sourceColumn: sourceColumn,
          sourceColumnIndex: parseInt(headerIndex, 10),
          targetField: field,
          targetFieldType: IMPORT_FIELD_TYPE_MAP[field] || 'string',
          required: false,
          humanConfirmed: true,
        });
      }

      const mappingConfig = {
        version: '1.0',
        mappings: mappings,
        options: {
          skipHeaderRows: 1,
          skipEmptyRows: true,
          trimWhitespace: true,
          duplicateDetection: 'name_address',
          duplicateAction: 'skip',
          stopOnFirstError: false,
          maxErrors: 0,
          dateFormat: 'DD.MM.YYYY',
          fallbackDateFormats: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'],
          autoCreateCategories: false,
        }
      };

      console.log('[Import] Applying mapping config:', mappingConfig);

      const mappingResponse = await fetch(`/api/import/batches/${batchId}/mapping`, {
        method: 'POST',
        headers: executeHeaders,
        credentials: 'include',
        body: JSON.stringify({ mappingConfig })
      });

      const mappingResult = await mappingResponse.json();
      if (!mappingResponse.ok || !mappingResult.success) {
        const msg = mappingResult.error?.message || mappingResult.message || 'Mapping feilet';
        throw new Error(msg);
      }
      console.log('[Import] Mapping applied:', mappingResult.data);

      // --- Step 2: Validate ---
      wizardImportState.loadingPhase = 'validating';
      wizardImportState.loadingProgress = 30;
      updateWizardImportContent();

      const validateResponse = await fetch(`/api/import/batches/${batchId}/validate`, {
        method: 'POST',
        headers: executeHeaders,
        credentials: 'include',
        body: JSON.stringify({})
      });

      const validateResult = await validateResponse.json();
      if (!validateResponse.ok || !validateResult.success) {
        const msg = validateResult.error?.message || validateResult.message || 'Validering feilet';
        throw new Error(msg);
      }
      console.log('[Import] Validation result:', validateResult.data);

      // --- Step 3: Commit ---
      wizardImportState.loadingPhase = 'importing';
      wizardImportState.loadingProgress = 60;
      updateWizardImportContent();

      // Build excluded row IDs from deselected rows
      const allRows = wizardImportState.previewData?.preview || [];
      const excludedRowIds = [];
      allRows.forEach((row, idx) => {
        if (!wizardImportState.selectedRows.has(idx)) {
          // Use staging row number if available
          if (row._stagingRowId) {
            excludedRowIds.push(row._stagingRowId);
          }
        }
      });

      // Build row edits keyed by staging row ID
      const rowEdits = {};
      for (const [rowIdx, edits] of Object.entries(wizardImportState.editedRows)) {
        const row = allRows[parseInt(rowIdx)];
        if (row && row._stagingRowId) {
          rowEdits[row._stagingRowId] = edits;
        }
      }

      const response = await fetch(`/api/import/batches/${batchId}/commit`, {
        method: 'POST',
        headers: executeHeaders,
        credentials: 'include',
        body: JSON.stringify({
          dryRun: false,
          excludedRowIds,
          rowEdits,
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorMsg = typeof result.error === 'string'
          ? result.error
          : (result.error?.message || result.message || 'Import feilet');
        throw new Error(errorMsg);
      }

      wizardImportState.importResults = {
        success: true,
        importedCount: result.data.created + result.data.updated,
        createdCount: result.data.created,
        updatedCount: result.data.updated,
        skippedCount: result.data.skipped,
        errorCount: result.data.failed,
        errors: result.data.errors || [],
        batchId: wizardImportState.batchId,
        durationMs: result.data.durationMs,
      };
      wizardImportState.isLoading = false;
      wizardImportState.currentImportStep = 5;

      updateWizardImportContent();

      if (result.data.created > 0 || result.data.updated > 0) {
        refreshCustomerData();
      }

    } else {
      // Fallback: Simple import API (no staging)
      const response = await fetch('/api/kunder/import/execute', {
        method: 'POST',
        headers: executeHeaders,
        credentials: 'include',
        body: JSON.stringify({
          rows: rowsToImport,
          columnMapping: columnMapping
        })
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorMsg = typeof result.error === 'string'
          ? result.error
          : (result.error?.message || result.message || 'Import feilet');
        throw new Error(errorMsg);
      }

      wizardImportState.importResults = {
        success: true,
        importedCount: result.data.created,
        createdCount: result.data.created,
        updatedCount: 0,
        skippedCount: 0,
        errorCount: result.data.failed,
        errors: result.data.errors || []
      };
      wizardImportState.isLoading = false;
      wizardImportState.currentImportStep = 5;

      updateWizardImportContent();

      if (result.data.created > 0) {
        refreshCustomerData();
      }
    }

  } catch (error) {
    console.error('Wizard import execute error:', error);
    wizardImportState.isLoading = false;
    let errorMsg = 'En feil oppstod under import';
    if (typeof error === 'string') {
      errorMsg = error;
    } else if (error && typeof error.message === 'string') {
      errorMsg = error.message;
    } else if (error && typeof error.error === 'string') {
      errorMsg = error.error;
    }
    wizardImportState.error = errorMsg;
    updateWizardImportContent();
  }
}

// Refresh customer data after import
// Rollback a committed import batch
async function wizardRollbackImport() {
  const results = wizardImportState.importResults;
  if (!results || !results.batchId) {
    showMessage('Ingen import å angre', 'error');
    return;
  }

  const confirmed = await showConfirm('Er du sikker på at du vil angre hele importen? Alle opprettede kunder vil bli slettet.', 'Angre import');
  if (!confirmed) return;

  try {
    const apiHeaders = { 'Content-Type': 'application/json' };
    const csrfToken = getCsrfToken();
    if (csrfToken) apiHeaders['X-CSRF-Token'] = csrfToken;

    const response = await fetch(`/api/import/batches/${results.batchId}/rollback`, {
      method: 'POST',
      headers: apiHeaders,
      credentials: 'include',
      body: JSON.stringify({ reason: 'Bruker angret importen' })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error?.message || (typeof result.error === 'string' ? result.error : null) || 'Kunne ikke angre importen');
    }

    showMessage(`Import angret: ${result.data.recordsDeleted} kunder slettet`, 'success');
    resetWizardImportState();
    updateWizardImportContent();
    refreshCustomerData();

  } catch (error) {
    console.error('Rollback error:', error);
    showMessage(error.message || 'Kunne ikke angre importen', 'error');
  }
}

async function refreshCustomerData() {
  try {
    // This will be available after wizard completes and app loads
    if (typeof loadCustomers === 'function') {
      await loadCustomers();
    }
  } catch (error) {
    console.error('Error refreshing customer data:', error);
  }
}

// ========================================
// ERROR GROUPING & QUALITY REPORT
// ========================================

function renderErrorGrouping(preview) {
  if (!preview || !Array.isArray(preview)) return '';

  // Collect errors grouped by type
  const errorGroups = {};
  for (const row of preview) {
    if (!row.fieldErrors) continue;
    for (const [field, message] of Object.entries(row.fieldErrors)) {
      const key = `${field}:${message}`;
      if (!errorGroups[key]) {
        errorGroups[key] = { field, message, count: 0, rows: [] };
      }
      errorGroups[key].count++;
      errorGroups[key].rows.push(row);
    }
  }

  const groups = Object.values(errorGroups).sort((a, b) => b.count - a.count);
  if (groups.length === 0) return '';

  return `
    <div class="wizard-error-groups">
      <h4><i aria-hidden="true" class="fas fa-layer-group"></i> Feilsammendrag</h4>
      <div class="error-group-list">
        ${groups.slice(0, 8).map(group => `
          <div class="error-group-item">
            <div class="error-group-info">
              <span class="error-group-field">${escapeHtml(group.field)}</span>
              <span class="error-group-message">${escapeHtml(group.message)}</span>
              <span class="error-group-count">${group.count} rader</span>
            </div>
            ${group.field === 'epost' && group.message.includes('skrivefeil') ? `
              <button class="wizard-btn wizard-btn-small" onclick="wizardFixAllSimilar('${escapeJsString(group.field)}', '${escapeJsString(group.message)}')">
                <i aria-hidden="true" class="fas fa-magic"></i> Fiks alle
              </button>
            ` : `
              <button class="wizard-btn wizard-btn-small wizard-btn-secondary" onclick="wizardDeselectErrorRows('${escapeJsString(group.field)}', '${escapeJsString(group.message)}')">
                <i aria-hidden="true" class="fas fa-minus-circle"></i> Fjern fra import
              </button>
            `}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderQualityReport(report) {
  if (!report) return '';

  const scoreColor = report.overallScore >= 80 ? 'success' : report.overallScore >= 60 ? 'warning' : 'error';

  return `
    <div class="wizard-quality-report">
      <h4><i aria-hidden="true" class="fas fa-chart-bar"></i> Kvalitetsrapport</h4>
      <div class="quality-score-bar">
        <div class="quality-score-fill ${scoreColor}" style="width: ${report.overallScore}%"></div>
        <span class="quality-score-label">${report.overallScore}%</span>
      </div>
      ${report.suggestions && report.suggestions.length > 0 ? `
        <ul class="quality-suggestions">
          ${report.suggestions.map(s => `<li><i aria-hidden="true" class="fas fa-lightbulb"></i> ${escapeHtml(s)}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `;
}

function wizardFixAllSimilar(field, message) {
  const preview = wizardImportState.previewData?.preview;
  if (!preview) return;

  let fixCount = 0;
  for (let i = 0; i < preview.length; i++) {
    const row = preview[i];
    if (row.fieldErrors && row.fieldErrors[field] === message && row.suggestion && row.suggestion[field]) {
      if (!wizardImportState.editedRows[i]) wizardImportState.editedRows[i] = {};
      wizardImportState.editedRows[i][field] = row.suggestion[field];
      fixCount++;
    }
  }

  if (fixCount > 0) {
    showMessage(`${fixCount} felt korrigert automatisk`, 'success');
    updateWizardImportContent();
  }
}

function wizardDeselectErrorRows(field, message) {
  const preview = wizardImportState.previewData?.preview;
  if (!preview) return;

  let count = 0;
  for (let i = 0; i < preview.length; i++) {
    if (preview[i].fieldErrors && preview[i].fieldErrors[field] === message) {
      wizardImportState.selectedRows.delete(i);
      count++;
    }
  }

  if (count > 0) {
    showMessage(`${count} rader fjernet fra import`, 'info');
    updateWizardImportContent();
  }
}

async function wizardDownloadErrorReport() {
  const batchId = wizardImportState.batchId;
  if (!batchId) {
    showMessage('Ingen batch tilgjengelig for feilrapport', 'error');
    return;
  }

  try {
    const response = await fetch(`/api/import/batches/${batchId}/error-report`, {
      credentials: 'include'
    });

    if (!response.ok) throw new Error('Kunne ikke laste ned feilrapport');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feilrapport-batch-${batchId}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Download error:', error);
    showMessage(error.message || 'Kunne ikke laste ned feilrapport', 'error');
  }
}

async function wizardReimportFailed() {
  const results = wizardImportState.importResults;
  if (!results || !results.batchId) {
    showMessage('Ingen import å reimportere', 'error');
    return;
  }

  showMessage('Setter opp reimport av feilede rader...', 'info');

  // Go back to preview step with only failed rows selected
  wizardImportState.currentImportStep = 4; // Preview step
  // The batchId is preserved, so re-validating will re-fetch the batch
  wizardImportState.importResults = null;
  updateWizardImportContent();
}

// Attach event listeners for current step
function attachStepListeners(stepId) {
  switch (stepId) {
    case 'company':
      attachCompanyListeners();
      break;
    case 'import':
      attachWizardImportListeners();
      break;
    case 'map':
      attachMapListeners();
      break;
  }
}

// Company step listeners
let wizardRouteMap = null;
let wizardRouteMarker = null;

function attachCompanyListeners() {
  // Initialize mini map for route start
  setTimeout(() => {
    const mapContainer = document.getElementById('wizardRouteMap');
    if (mapContainer && !wizardRouteMap) {
      const data = onboardingWizard.data.company;
      const lat = data.route_start_lat || 59.9139;
      const lng = data.route_start_lng || 10.7522;

      wizardRouteMap = new mapboxgl.Map({
        container: 'wizardRouteMap',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [lng, lat],
        zoom: 10,
        accessToken: mapboxgl.accessToken
      });

      if (data.route_start_lat) {
        wizardRouteMarker = new mapboxgl.Marker().setLngLat([lng, lat]).addTo(wizardRouteMap);
      }

      wizardRouteMap.on('click', (e) => {
        if (wizardRouteMarker) wizardRouteMarker.remove();
        wizardRouteMarker = new mapboxgl.Marker().setLngLat(e.lngLat).addTo(wizardRouteMap);
        onboardingWizard.data.company.route_start_lat = e.lngLat.lat;
        onboardingWizard.data.company.route_start_lng = e.lngLat.lng;
        document.getElementById('routeCoordinates').innerHTML =
          `<span>Valgt: ${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}</span>`;
      });
    }
  }, 100);

  // Basic input listeners for manual typing (poststed only, others handled by autocomplete)
  const poststedInput = document.getElementById('companyPoststed');
  if (poststedInput) poststedInput.addEventListener('input', (e) => {
    onboardingWizard.data.company.poststed = e.target.value;
  });

  // Setup address autocomplete with Kartverket
  setupWizardAddressAutocomplete();

  // Setup postal code lookup with Bring
  setupWizardPostnummerLookup();
}

// Wizard address autocomplete state
let wizardAddressSuggestions = [];
let wizardSelectedIndex = -1;

// Setup address autocomplete for the wizard
function setupWizardAddressAutocomplete() {
  const addressInput = document.getElementById('companyAddress');
  const suggestionsContainer = document.getElementById('wizardAddressSuggestions');

  if (!addressInput || !suggestionsContainer) return;

  // Debounced search using Kartverket API
  const debouncedSearch = debounce(async (query) => {
    if (query.length < 3) {
      suggestionsContainer.classList.remove('visible');
      wizardAddressSuggestions = [];
      return;
    }

    wizardAddressSuggestions = await searchAddresses(query);
    wizardSelectedIndex = -1;
    renderWizardAddressSuggestions(wizardAddressSuggestions);
  }, 300);

  // Input event - update state and search
  addressInput.addEventListener('input', (e) => {
    onboardingWizard.data.company.address = e.target.value;
    debouncedSearch(e.target.value);
  });

  // Keyboard navigation
  addressInput.addEventListener('keydown', (e) => {
    if (!wizardAddressSuggestions.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      wizardSelectedIndex = Math.min(wizardSelectedIndex + 1, wizardAddressSuggestions.length - 1);
      updateWizardSuggestionSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      wizardSelectedIndex = Math.max(wizardSelectedIndex - 1, 0);
      updateWizardSuggestionSelection();
    } else if (e.key === 'Enter' && wizardSelectedIndex >= 0) {
      e.preventDefault();
      selectWizardAddressSuggestion(wizardAddressSuggestions[wizardSelectedIndex]);
    } else if (e.key === 'Escape') {
      suggestionsContainer.classList.remove('visible');
      wizardAddressSuggestions = [];
    }
  });

  // Click outside to close suggestions
  document.addEventListener('click', (e) => {
    if (!addressInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
      suggestionsContainer.classList.remove('visible');
    }
  });
}

// Render wizard address suggestions dropdown
function renderWizardAddressSuggestions(results) {
  const container = document.getElementById('wizardAddressSuggestions');
  if (!container) return;

  if (!results || results.length === 0) {
    container.innerHTML = '';
    container.classList.remove('visible');
    return;
  }

  container.innerHTML = results.map((addr, index) => `
    <div class="wizard-address-suggestion" data-index="${index}">
      <i aria-hidden="true" class="fas fa-map-marker-alt"></i>
      <div class="wizard-address-text">
        <div class="wizard-address-main">${escapeHtml(addr.adresse)}</div>
        <div class="wizard-address-detail">${escapeHtml(addr.postnummer)} ${escapeHtml(addr.poststed)}${addr.kommune ? `, ${escapeHtml(addr.kommune)}` : ''}</div>
      </div>
    </div>
  `).join('');

  container.classList.add('visible');

  // Add click handlers to each suggestion
  container.querySelectorAll('.wizard-address-suggestion').forEach(item => {
    item.addEventListener('click', () => {
      const index = parseInt(item.dataset.index);
      selectWizardAddressSuggestion(wizardAddressSuggestions[index]);
    });
  });
}

// Update visual selection in suggestions
function updateWizardSuggestionSelection() {
  const items = document.querySelectorAll('.wizard-address-suggestion');
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === wizardSelectedIndex);
  });
}

// Select an address suggestion and fill all fields
function selectWizardAddressSuggestion(suggestion) {
  const addressInput = document.getElementById('companyAddress');
  const postnummerInput = document.getElementById('companyPostnummer');
  const poststedInput = document.getElementById('companyPoststed');
  const suggestionsContainer = document.getElementById('wizardAddressSuggestions');

  // Fill form fields
  if (addressInput) addressInput.value = suggestion.adresse;
  if (postnummerInput) postnummerInput.value = suggestion.postnummer;
  if (poststedInput) {
    poststedInput.value = suggestion.poststed;
    poststedInput.classList.add('auto-filled');
  }

  // Update wizard state
  onboardingWizard.data.company.address = suggestion.adresse;
  onboardingWizard.data.company.postnummer = suggestion.postnummer;
  onboardingWizard.data.company.poststed = suggestion.poststed;
  onboardingWizard.data.company.route_start_lat = suggestion.lat;
  onboardingWizard.data.company.route_start_lng = suggestion.lng;

  // Update map marker
  if (wizardRouteMap) {
    if (wizardRouteMarker) wizardRouteMarker.remove();
    wizardRouteMarker = new mapboxgl.Marker().setLngLat([suggestion.lng, suggestion.lat]).addTo(wizardRouteMap);
    wizardRouteMap.flyTo({ center: [suggestion.lng, suggestion.lat], zoom: 14 });
  }

  // Update coordinates display
  const coordsEl = document.getElementById('routeCoordinates');
  if (coordsEl) {
    coordsEl.innerHTML = `<span>Valgt: ${suggestion.lat.toFixed(5)}, ${suggestion.lng.toFixed(5)}</span>`;
  }

  // Update postnummer status
  updateWizardPostnummerStatus('valid');

  // Hide suggestions
  if (suggestionsContainer) {
    suggestionsContainer.classList.remove('visible');
    wizardAddressSuggestions = [];
  }
}

// Setup postal code lookup for the wizard
function setupWizardPostnummerLookup() {
  const postnummerInput = document.getElementById('companyPostnummer');
  const poststedInput = document.getElementById('companyPoststed');

  if (!postnummerInput) return;

  postnummerInput.addEventListener('input', async (e) => {
    const value = e.target.value;
    onboardingWizard.data.company.postnummer = value;

    // Only lookup when we have exactly 4 digits
    if (value.length === 4 && /^\d{4}$/.test(value)) {
      updateWizardPostnummerStatus('loading');

      const poststed = await lookupPostnummer(value);

      if (poststed) {
        if (poststedInput) {
          poststedInput.value = poststed;
          poststedInput.classList.add('auto-filled');
        }
        onboardingWizard.data.company.poststed = poststed;
        updateWizardPostnummerStatus('valid');
      } else {
        updateWizardPostnummerStatus('invalid');
      }
    } else if (value.length < 4) {
      updateWizardPostnummerStatus('');
    }
  });
}

// Update wizard postnummer status indicator
function updateWizardPostnummerStatus(status) {
  const statusEl = document.getElementById('wizardPostnummerStatus');
  if (!statusEl) return;

  statusEl.className = 'wizard-postnummer-status';

  switch (status) {
    case 'valid':
      statusEl.innerHTML = '<i aria-hidden="true" class="fas fa-check"></i>';
      statusEl.classList.add('valid');
      break;
    case 'invalid':
      statusEl.innerHTML = '<i aria-hidden="true" class="fas fa-times"></i>';
      statusEl.classList.add('invalid');
      break;
    case 'loading':
      statusEl.innerHTML = '<i aria-hidden="true" class="fas fa-spinner fa-spin"></i>';
      statusEl.classList.add('loading');
      break;
    default:
      statusEl.innerHTML = '';
  }
}

// Map step listeners
let wizardMainMap = null;

function attachMapListeners() {
  setTimeout(() => {
    const mapContainer = document.getElementById('wizardMainMap');
    if (mapContainer && !wizardMainMap) {
      const data = onboardingWizard.data.map;
      const company = onboardingWizard.data.company;
      const lat = data.center_lat || company.route_start_lat || 59.9139;
      const lng = data.center_lng || company.route_start_lng || 10.7522;
      const zoom = data.zoom || 10;

      wizardMainMap = new mapboxgl.Map({
        container: 'wizardMainMap',
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [lng, lat],
        zoom: zoom,
        accessToken: mapboxgl.accessToken
      });

      wizardMainMap.on('moveend', () => {
        const center = wizardMainMap.getCenter();
        onboardingWizard.data.map.center_lat = center.lat;
        onboardingWizard.data.map.center_lng = center.lng;
        onboardingWizard.data.map.zoom = wizardMainMap.getZoom();
        document.getElementById('defaultZoom').value = wizardMainMap.getZoom();
        document.getElementById('zoomValue').textContent = wizardMainMap.getZoom();
      });
    }
  }, 100);

  const zoomSlider = document.getElementById('defaultZoom');
  if (zoomSlider) {
    zoomSlider.addEventListener('input', (e) => {
      const zoom = parseInt(e.target.value);
      document.getElementById('zoomValue').textContent = zoom;
      onboardingWizard.data.map.zoom = zoom;
      if (wizardMainMap) {
        wizardMainMap.setZoom(zoom);
      }
    });
  }
}

// Use company address as route start
async function useAddressAsRouteStart() {
  const address = onboardingWizard.data.company.address;
  const postnummer = onboardingWizard.data.company.postnummer;
  const poststed = onboardingWizard.data.company.poststed;

  if (!address || !postnummer || !poststed) {
    showMessage('Fyll ut firmaadresse først', 'warning');
    return;
  }

  const fullAddress = `${address}, ${postnummer} ${poststed}, Norge`;

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}`);
    const data = await response.json();

    if (data && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lng = parseFloat(data[0].lon);

      onboardingWizard.data.company.route_start_lat = lat;
      onboardingWizard.data.company.route_start_lng = lng;

      if (wizardRouteMap) {
        if (wizardRouteMarker) wizardRouteMarker.remove();
        wizardRouteMarker = new mapboxgl.Marker().setLngLat([lng, lat]).addTo(wizardRouteMap);
        wizardRouteMap.flyTo({ center: [lng, lat], zoom: 14 });
      }

      document.getElementById('routeCoordinates').innerHTML =
        `<span>Valgt: ${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`;
    } else {
      showMessage('Kunne ikke finne adressen. Prøv å klikke på kartet manuelt.', 'warning');
    }
  } catch (error) {
    console.error('Geocoding error:', error);
    showMessage('Feil ved søk etter adresse', 'error');
  }
}

// Navigate to next step
async function nextWizardStep() {
  try {
    console.log('nextWizardStep called, current step:', onboardingWizard.currentStep);
    const currentStepId = onboardingWizard.steps[onboardingWizard.currentStep].id;
    console.log('Current step ID:', currentStepId);

    // Save current step data to server
    if (currentStepId === 'company') {
      const data = onboardingWizard.data.company;
      console.log('Saving company data:', data);
      const result = await updateOnboardingStep('company_info', {
        company_address: data.address,
        company_postnummer: data.postnummer,
        company_poststed: data.poststed,
        route_start_lat: data.route_start_lat,
        route_start_lng: data.route_start_lng
      });
      console.log('Company step save result:', result);
    } else if (currentStepId === 'map') {
      const data = onboardingWizard.data.map;
      console.log('Saving map data:', data);
      const result = await updateOnboardingStep('map_settings', {
        map_center_lat: data.center_lat,
        map_center_lng: data.center_lng,
        map_zoom: data.zoom
      });
      console.log('Map step save result:', result);
    }

    // Cleanup maps before step change
    cleanupWizardMaps();

    onboardingWizard.currentStep++;
    console.log('Moving to step:', onboardingWizard.currentStep);
    await renderWizardStep();
  } catch (error) {
    console.error('Error in nextWizardStep:', error);
    showMessage('Det oppstod en feil. Prøv igjen.', 'error');
  }
}

// Navigate to previous step
async function prevWizardStep() {
  if (onboardingWizard.currentStep > 0) {
    cleanupWizardMaps();
    onboardingWizard.currentStep--;
    await renderWizardStep();
  }
}

// Cleanup wizard maps
function cleanupWizardMaps() {
  if (wizardRouteMap) {
    wizardRouteMap.remove();
    wizardRouteMap = null;
    wizardRouteMarker = null;
  }
  if (wizardMainMap) {
    wizardMainMap.remove();
    wizardMainMap = null;
  }
}

// Complete onboarding wizard
async function completeOnboardingWizard() {
  await updateOnboardingStep('completed', {});

  cleanupWizardMaps();

  const overlay = onboardingWizard.overlay;
  overlay.classList.remove('visible');

  setTimeout(() => {
    overlay.remove();
    onboardingWizard.overlay = null;

    // Show first-time tips
    showContextTips();

    if (onboardingWizard.resolve) {
      onboardingWizard.resolve();
    }
  }, 400);
}

// Skip onboarding
async function handleSkipOnboarding() {
  const confirmed = await showConfirm('Er du sikker på at du vil hoppe over oppsettet? Du kan alltid endre innstillinger senere.', 'Hopp over oppsett');
  if (confirmed) {
    await skipOnboarding();
    cleanupWizardMaps();

    const overlay = onboardingWizard.overlay;
    overlay.classList.remove('visible');

    setTimeout(() => {
      overlay.remove();
      onboardingWizard.overlay = null;

      if (onboardingWizard.resolve) {
        onboardingWizard.resolve();
      }
    }, 400);
  }
}

// Export wizard functions for onclick handlers
window.nextWizardStep = nextWizardStep;
window.prevWizardStep = prevWizardStep;
window.handleSkipOnboarding = handleSkipOnboarding;
window.useAddressAsRouteStart = useAddressAsRouteStart;
window.completeOnboardingWizard = completeOnboardingWizard;

// Pagination for preview table
function wizardPreviewTablePage(page) {
  wizardImportState.previewTablePage = Math.max(0, page);
  updateWizardImportContent();
}

// Toggle before/after transformation view in preview
function wizardToggleBeforeAfter(show) {
  wizardImportState.previewShowBeforeAfter = show;
  updateWizardImportContent();
}

// Export wizard import functions for onclick handlers
window.skipWizardImport = skipWizardImport;
window.wizardImportBack = wizardImportBack;
window.wizardImportNext = wizardImportNext;
window.wizardStartImport = wizardStartImport;
window.wizardRollbackImport = wizardRollbackImport;
window.wizardReimportFailed = wizardReimportFailed;
window.wizardDownloadErrorReport = wizardDownloadErrorReport;
window.wizardFixAllSimilar = wizardFixAllSimilar;
window.wizardDeselectErrorRows = wizardDeselectErrorRows;
window.wizardImportComplete = wizardImportComplete;
window.wizardImportRetry = wizardImportRetry;
window.updateWizardMapping = updateWizardMapping;
window.updateWizardCategoryMapping = updateWizardCategoryMapping;
window.wizardPreviewTablePage = wizardPreviewTablePage;
window.wizardToggleBeforeAfter = wizardToggleBeforeAfter;


// ========================================
// ADMIN: FIELD MANAGEMENT
// ========================================

/**
 * Get field type display name
 */
function getFieldTypeName(type) {
  const types = { text: 'Tekst', select: 'Rullegardin', number: 'Tall', date: 'Dato' };
  return types[type] || type;
}

/**
 * Render organization fields in admin panel
 */
function renderAdminFields() {
  const listContainer = document.getElementById('fieldsList');
  const emptyContainer = document.getElementById('fieldsEmpty');

  if (!listContainer) return;

  if (organizationFields.length === 0) {
    listContainer.style.display = 'none';
    if (emptyContainer) emptyContainer.style.display = 'block';
    return;
  }

  listContainer.style.display = 'flex';
  if (emptyContainer) emptyContainer.style.display = 'none';

  listContainer.innerHTML = organizationFields.map((field, index) => `
    <div class="sortable-item" data-id="${field.id}" data-index="${index}" draggable="true">
      <div class="drag-handle">
        <i aria-hidden="true" class="fas fa-grip-vertical"></i>
      </div>
      <div class="item-info">
        <span class="item-name">${escapeHtml(field.display_name)}</span>
        <span class="item-meta">
          ${escapeHtml(field.field_name)} | ${getFieldTypeName(field.field_type)}
          ${field.is_filterable ? '<span class="badge">Filter</span>' : ''}
          ${field.is_required ? '<span class="badge warning">Obligatorisk</span>' : ''}
          ${!field.is_visible ? '<span class="badge muted">Skjult</span>' : ''}
        </span>
      </div>
      <div class="item-actions">
        <button class="btn-icon" onclick="openFieldModal(${field.id})" title="Rediger">
          <i aria-hidden="true" class="fas fa-edit"></i>
        </button>
        <button class="btn-icon danger" onclick="confirmDeleteField(${field.id})" title="Slett">
          <i aria-hidden="true" class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');

  initSortable(listContainer, 'fields');
}

/**
 * Open field modal for adding/editing
 */
function openFieldModal(fieldId = null) {
  const modal = document.getElementById('fieldModal');
  const title = document.getElementById('fieldModalTitle');
  const deleteBtn = document.getElementById('deleteFieldBtn');
  const fieldNameInput = document.getElementById('fieldName');

  // Reset form
  document.getElementById('fieldForm').reset();
  document.getElementById('fieldId').value = '';
  document.getElementById('fieldVisible').checked = true;
  document.getElementById('fieldOptionsSection').style.display = 'none';
  document.getElementById('fieldOptionsList').innerHTML = '';

  if (fieldId) {
    const field = organizationFields.find(f => f.id === fieldId);
    if (!field) return;

    title.textContent = 'Rediger felt';
    document.getElementById('fieldId').value = field.id;
    document.getElementById('fieldDisplayName').value = field.display_name;
    fieldNameInput.value = field.field_name;
    fieldNameInput.disabled = true; // Can't change field_name
    document.getElementById('fieldType').value = field.field_type;
    document.getElementById('fieldFilterable').checked = field.is_filterable === 1 || field.is_filterable === true;
    document.getElementById('fieldRequired').checked = field.is_required === 1 || field.is_required === true;
    document.getElementById('fieldVisible').checked = field.is_visible === 1 || field.is_visible === true;

    if (field.field_type === 'select') {
      document.getElementById('fieldOptionsSection').style.display = 'block';
      renderFieldOptions(field.options || []);
    }

    deleteBtn.style.display = 'inline-block';
  } else {
    title.textContent = 'Nytt felt';
    fieldNameInput.disabled = false;
    deleteBtn.style.display = 'none';
  }

  modal.classList.remove('hidden');
}

/**
 * Render options list for select fields
 */
function renderFieldOptions(options) {
  const container = document.getElementById('fieldOptionsList');
  container.innerHTML = options.map((opt, index) => `
    <div class="option-item" data-index="${index}" data-id="${opt.id || ''}">
      <input type="text" class="option-value" value="${escapeHtml(opt.value || '')}" placeholder="Verdi">
      <input type="text" class="option-display" value="${escapeHtml(opt.display_name || '')}" placeholder="Visningsnavn">
      <button type="button" class="btn-icon danger" onclick="removeFieldOption(this)" title="Fjern">
        <i aria-hidden="true" class="fas fa-times"></i>
      </button>
    </div>
  `).join('');
}

/**
 * Add a new option input
 */
function addFieldOption() {
  const container = document.getElementById('fieldOptionsList');
  const index = container.children.length;
  const html = `
    <div class="option-item" data-index="${index}" data-id="">
      <input type="text" class="option-value" placeholder="Verdi">
      <input type="text" class="option-display" placeholder="Visningsnavn">
      <button type="button" class="btn-icon danger" onclick="removeFieldOption(this)" title="Fjern">
        <i aria-hidden="true" class="fas fa-times"></i>
      </button>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', html);
}

/**
 * Remove an option input
 */
function removeFieldOption(btn) {
  const item = btn.closest('.option-item');
  if (item) item.remove();
}

/**
 * Save field (create or update)
 */
async function saveField(event) {
  event.preventDefault();

  const id = document.getElementById('fieldId').value;
  const data = {
    field_name: document.getElementById('fieldName').value,
    display_name: document.getElementById('fieldDisplayName').value,
    field_type: document.getElementById('fieldType').value,
    is_filterable: document.getElementById('fieldFilterable').checked ? 1 : 0,
    is_required: document.getElementById('fieldRequired').checked ? 1 : 0,
    is_visible: document.getElementById('fieldVisible').checked ? 1 : 0
  };

  try {
    const url = id ? `/api/fields/${id}` : '/api/fields';
    const method = id ? 'PUT' : 'POST';

    const response = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Kunne ikke lagre felt');
    }

    const savedField = await response.json();

    // If select type, save options
    if (data.field_type === 'select') {
      await saveFieldOptions(savedField.id || id);
    }

    // Reload fields and close modal
    await loadOrganizationFields();
    renderAdminFields();
    document.getElementById('fieldModal').classList.add('hidden');

    showToast('Felt lagret', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Save field options
 */
async function saveFieldOptions(fieldId) {
  const optionItems = document.querySelectorAll('#fieldOptionsList .option-item');
  const existingField = organizationFields.find(f => f.id === parseInt(fieldId));
  const existingOptions = existingField?.options || [];

  // Collect current options from form
  const currentOptions = [];
  optionItems.forEach((item, index) => {
    const value = item.querySelector('.option-value').value.trim();
    const displayName = item.querySelector('.option-display').value.trim();
    const existingId = item.dataset.id;
    if (value) {
      currentOptions.push({
        id: existingId ? parseInt(existingId) : null,
        value,
        display_name: displayName || value,
        sort_order: index
      });
    }
  });

  // Delete removed options
  for (const existingOpt of existingOptions) {
    const stillExists = currentOptions.some(opt => opt.id === existingOpt.id);
    if (!stillExists) {
      try {
        await apiFetch(`/api/fields/${fieldId}/options/${existingOpt.id}`, { method: 'DELETE' });
      } catch (e) {
        Logger.warn('Could not delete option:', e);
      }
    }
  }

  // Add new options (those without id)
  for (const opt of currentOptions) {
    if (!opt.id) {
      try {
        await apiFetch(`/api/fields/${fieldId}/options`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opt)
        });
      } catch (e) {
        Logger.warn('Could not add option:', e);
      }
    }
  }
}

/**
 * Confirm and delete field
 */
async function confirmDeleteField(id) {
  const confirmed = await showConfirm('Er du sikker på at du vil slette dette feltet? Data i kunderegistreringer vil bli beholdt, men ikke lenger vises.', 'Slette felt');
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/fields/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Kunne ikke slette felt');

    await loadOrganizationFields();
    renderAdminFields();
    renderDynamicFieldFilters();
    showToast('Felt slettet', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ========================================
// ADMIN: CATEGORY MANAGEMENT
// ========================================

/**
 * Render organization categories in admin panel
 */
/**
 * Open category list modal (from gear icon)
 */
function openCategoryListModal() {
  renderCategoryListItems();
  document.getElementById('categoryListModal').classList.remove('hidden');
}

/**
 * Render category list inside the list modal
 */
function renderCategoryListItems() {
  const container = document.getElementById('categoryListItems');
  if (!container) return;

  if (organizationCategories.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--color-text-muted); padding: 16px 0;">Ingen kategorier enda.</p>';
    return;
  }

  container.innerHTML = organizationCategories.map(cat => `
    <div class="category-list-item">
      <div class="category-list-info">
        <i aria-hidden="true" class="fas ${escapeHtml(cat.icon || 'fa-tag')}" style="color: ${escapeHtml(cat.color || '#6B7280')}; margin-right: 8px;"></i>
        <span>${escapeHtml(cat.name)}</span>
        <span class="category-list-meta">${cat.default_interval_months || 12} mnd</span>
      </div>
      <div class="category-list-actions">
        <button class="btn-icon" onclick="document.getElementById('categoryListModal').classList.add('hidden'); openCategoryModal(${cat.id});" title="Rediger">
          <i aria-hidden="true" class="fas fa-edit"></i>
        </button>
        <button class="btn-icon danger" onclick="confirmDeleteCategory(${cat.id})" title="Slett">
          <i aria-hidden="true" class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function renderAdminCategories() {
  const listContainer = document.getElementById('categoriesList');
  const emptyContainer = document.getElementById('categoriesEmpty');

  if (!listContainer) return;

  if (organizationCategories.length === 0) {
    listContainer.style.display = 'none';
    if (emptyContainer) emptyContainer.style.display = 'block';
    return;
  }

  listContainer.style.display = 'flex';
  if (emptyContainer) emptyContainer.style.display = 'none';

  listContainer.innerHTML = organizationCategories.map((cat, index) => `
    <div class="sortable-item" data-id="${cat.id}" data-index="${index}" draggable="true">
      <div class="drag-handle">
        <i aria-hidden="true" class="fas fa-grip-vertical"></i>
      </div>
      <div class="item-info">
        <span class="item-name">
          <i aria-hidden="true" class="fas ${escapeHtml(cat.icon || 'fa-tag')}" style="color: ${escapeHtml(cat.color || '#6B7280')}; margin-right: 8px;"></i>
          ${escapeHtml(cat.name)}
        </span>
        <span class="item-meta">
          ${escapeHtml(cat.slug)} | ${cat.default_interval_months || 12} mnd intervall
        </span>
      </div>
      <div class="item-actions">
        <button class="btn-icon" onclick="openCategoryModal(${cat.id})" title="Rediger">
          <i aria-hidden="true" class="fas fa-edit"></i>
        </button>
        <button class="btn-icon danger" onclick="confirmDeleteCategory(${cat.id})" title="Slett">
          <i aria-hidden="true" class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');

  initSortable(listContainer, 'categories');
}

/**
 * Open category modal for adding/editing
 */
const CATEGORY_ICONS = [
  'fa-wrench', 'fa-bolt', 'fa-fire', 'fa-fan',
  'fa-faucet', 'fa-shield-alt', 'fa-thermometer-half', 'fa-building',
  'fa-solar-panel', 'fa-tools', 'fa-hard-hat', 'fa-plug',
  'fa-tractor', 'fa-home', 'fa-cog', 'fa-check-circle'
];

function renderCategoryIconPicker(selectedIcon) {
  const container = document.getElementById('categoryIconPicker');
  if (!container) return;

  container.innerHTML = CATEGORY_ICONS.map(icon => `
    <button type="button" class="icon-btn ${icon === selectedIcon ? 'selected' : ''}"
            data-icon="${escapeHtml(icon)}" title="${escapeHtml(icon.replace('fa-', ''))}"
            onclick="selectCategoryIcon(this, '${escapeJsString(icon)}')">
      <i aria-hidden="true" class="fas ${escapeHtml(icon)}"></i>
    </button>
  `).join('');
}

function selectCategoryIcon(btn, icon) {
  document.querySelectorAll('#categoryIconPicker .icon-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('categoryIcon').value = icon;
  console.log('[Category] Icon selected:', icon);
}

function updateCategoryColorPreview(color) {
  const preview = document.getElementById('categoryColorPreview');
  if (preview) preview.style.background = color;
}

function openCategoryModal(categoryId = null) {
  const modal = document.getElementById('categoryModal');
  const title = document.getElementById('categoryModalTitle');
  const deleteBtn = document.getElementById('deleteCategoryBtn');
  const sourceGroup = document.getElementById('categorySourceGroup');

  // Reset form
  document.getElementById('categoryForm').reset();
  document.getElementById('categoryId').value = '';
  document.getElementById('categorySlug').value = '';
  document.getElementById('categoryColor').value = '#5E81AC';
  document.getElementById('categoryInterval').value = '12';
  document.getElementById('categoryIcon').value = 'fa-wrench';
  document.getElementById('categoryDescription').value = '';
  sourceGroup.style.display = 'none';
  updateCategoryColorPreview('#5E81AC');
  renderCategoryIconPicker('fa-wrench');

  if (categoryId) {
    const category = organizationCategories.find(c => c.id === categoryId);
    if (!category) return;

    title.textContent = 'Rediger kategori';
    document.getElementById('categoryId').value = category.id;
    document.getElementById('categoryName').value = category.name;
    document.getElementById('categorySlug').value = category.slug;
    document.getElementById('categoryIcon').value = category.icon || 'fa-wrench';
    document.getElementById('categoryColor').value = category.color || '#5E81AC';
    document.getElementById('categoryInterval').value = String(category.default_interval_months || 12);
    document.getElementById('categoryDescription').value = category.description || '';

    updateCategoryColorPreview(category.color || '#5E81AC');
    renderCategoryIconPicker(category.icon || 'fa-wrench');

    // Show source badge
    if (category.source) {
      sourceGroup.style.display = 'block';
      const badge = document.getElementById('categorySourceBadge');
      const sourceLabels = { template: 'Bransjemal', tripletex: 'Tripletex', manual: 'Manuell' };
      badge.textContent = sourceLabels[category.source] || 'Manuell';
      badge.className = 'source-badge ' + (category.source || 'manual');
    }

    deleteBtn.style.display = 'inline-block';
  } else {
    title.textContent = 'Ny kategori';
    deleteBtn.style.display = 'none';
  }

  modal.classList.remove('hidden');
}

/**
 * Save category (create or update)
 */
async function saveCategory(event) {
  event.preventDefault();

  const id = document.getElementById('categoryId').value;
  const name = document.getElementById('categoryName').value.trim();
  if (!name) return;

  // Use existing slug when editing, auto-generate for new
  let slug = document.getElementById('categorySlug').value;
  if (!slug) {
    slug = name.toLowerCase()
      .replace(/[æ]/g, 'ae').replace(/[ø]/g, 'o').replace(/[å]/g, 'a')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  const description = document.getElementById('categoryDescription').value.trim();
  const icon = document.getElementById('categoryIcon').value;
  const color = document.getElementById('categoryColor').value;
  const data = {
    name,
    slug,
    icon,
    color,
    default_interval_months: parseInt(document.getElementById('categoryInterval').value) || 12,
    description: description || undefined
  };

  // Remember old name so we can update local customers if renamed
  let oldName = null;
  if (id) {
    const existing = organizationCategories.find(c => c.id === parseInt(id));
    if (existing && existing.name !== name) {
      oldName = existing.name;
    }
  }

  console.log('[Category] Saving:', data, oldName ? `(renaming from "${oldName}")` : '');

  try {
    const url = id ? `/api/service-types/${id}` : '/api/service-types';
    const method = id ? 'PUT' : 'POST';

    const response = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || error.error || 'Kunne ikke lagre kategori');
    }

    // Update local customers if category was renamed (backend already updated DB)
    if (oldName) {
      customers.forEach(c => {
        if (c.kategori === oldName) {
          c.kategori = name;
        }
      });
    }

    // Reload categories and close modal
    await loadOrganizationCategories();
    renderAdminCategories();
    renderFilterPanelCategories();
    renderCategoryListItems();
    renderMarkers(customers.filter(c => c.lat && c.lng));
    updateCategoryFilterCounts();
    document.getElementById('categoryModal').classList.add('hidden');

    showToast('Kategori lagret', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/**
 * Confirm and delete category
 */
async function confirmDeleteCategory(id) {
  const confirmed = await showConfirm('Er du sikker på at du vil slette denne kategorien?', 'Slette kategori');
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/service-types/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Kunne ikke slette kategori');

    await loadOrganizationCategories();
    renderAdminCategories();
    renderFilterPanelCategories();
    renderCategoryListItems();
    renderMarkers(customers.filter(c => c.lat && c.lng));
    updateCategoryFilterCounts();
    showToast('Kategori slettet', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ========================================
// ADMIN: SUBCATEGORIES MANAGEMENT
// ========================================

/**
 * Render subcategory management section in admin tab.
 * Shows groups + subcategories (standalone, not per service type).
 */
async function renderAdminSubcategories() {
  const content = document.getElementById('subcategoriesAdminContent');
  const empty = document.getElementById('subcategoriesAdminEmpty');
  if (!content) return;

  const groups = allSubcategoryGroups || [];

  content.style.display = 'block';
  if (empty) empty.style.display = groups.length === 0 ? 'block' : 'none';

  content.innerHTML = groups.map(group => `
    <div class="subcat-group" data-group-id="${group.id}" style="margin-bottom: 10px; border-left: 2px solid var(--color-border, #444); padding-left: 10px;">
      <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
        <i aria-hidden="true" class="fas fa-folder" style="color: var(--color-text-muted, #888); font-size: 11px;"></i>
        <span style="color: var(--color-text, #fff); font-size: 13px; font-weight: 500;">${escapeHtml(group.navn)}</span>
        <span style="color: var(--color-text-muted, #888); font-size: 11px;">(${(group.subcategories || []).length})</span>
        <button class="btn-icon" style="padding: 2px 4px;" onclick="editSubcatGroup(${group.id}, '${escapeJsString(group.navn)}')" title="Gi nytt navn">
          <i aria-hidden="true" class="fas fa-pen" style="font-size: 10px;"></i>
        </button>
        <button class="btn-icon danger" style="padding: 2px 4px;" onclick="deleteSubcatGroup(${group.id}, '${escapeJsString(group.navn)}')" title="Slett gruppe">
          <i aria-hidden="true" class="fas fa-trash" style="font-size: 10px;"></i>
        </button>
      </div>

      ${(group.subcategories || []).map(sub => `
        <div style="display: flex; align-items: center; gap: 6px; margin-left: 16px; padding: 2px 0;">
          <span style="width: 5px; height: 5px; border-radius: 50%; background: var(--color-text-muted, #888); flex-shrink: 0;"></span>
          <span style="color: var(--color-text-secondary, #ccc); font-size: 13px;">${escapeHtml(sub.navn)}</span>
          <button class="btn-icon" style="padding: 2px 4px; opacity: 0.5;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5" onclick="editSubcatItem(${sub.id}, '${escapeJsString(sub.navn)}')" title="Gi nytt navn">
            <i aria-hidden="true" class="fas fa-pen" style="font-size: 10px;"></i>
          </button>
          <button class="btn-icon danger" style="padding: 2px 4px; opacity: 0.5;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.5" onclick="deleteSubcatItem(${sub.id}, '${escapeJsString(sub.navn)}')" title="Slett">
            <i aria-hidden="true" class="fas fa-trash" style="font-size: 10px;"></i>
          </button>
        </div>
      `).join('')}

      <div style="display: flex; gap: 6px; margin-left: 16px; margin-top: 4px;">
        <input type="text" class="form-control" placeholder="Ny underkategori..." maxlength="100"
          style="flex: 1; font-size: 12px; padding: 4px 8px; height: 28px;"
          data-add-subcat-for-group="${group.id}"
          onkeydown="if(event.key==='Enter'){addSubcatItem(${group.id}, this); event.preventDefault();}">
        <button class="btn btn-primary btn-small" style="font-size: 11px; padding: 4px 8px; height: 28px;" onclick="addSubcatItem(${group.id}, this.previousElementSibling)">
          <i aria-hidden="true" class="fas fa-plus"></i>
        </button>
      </div>
    </div>
  `).join('') + `
    <div style="display: flex; gap: 6px; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--color-border, #333);">
      <input type="text" class="form-control" placeholder="Ny gruppe..." maxlength="100"
        style="flex: 1; font-size: 12px; padding: 4px 8px; height: 28px;"
        id="adminAddGroupInput"
        onkeydown="if(event.key==='Enter'){addSubcatGroup(this); event.preventDefault();}">
      <button class="btn btn-secondary btn-small" style="font-size: 11px; padding: 4px 8px; height: 28px;" onclick="addSubcatGroup(document.getElementById('adminAddGroupInput'))">
        <i aria-hidden="true" class="fas fa-plus" style="margin-right: 4px;"></i> Gruppe
      </button>
    </div>
  `;
}

async function addSubcatGroup(inputEl) {
  const navn = inputEl.value.trim();
  if (!navn) { inputEl.focus(); return; }

  try {
    const res = await apiFetch('/api/subcategories/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ navn })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Kunne ikke opprette gruppe');
    }
    const json = await res.json();
    subcatRegistryAddGroup(json.data || { id: Date.now(), navn });
    showToast('Gruppe opprettet', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function addSubcatItem(groupId, inputEl) {
  const navn = inputEl.value.trim();
  if (!navn) { inputEl.focus(); return; }

  try {
    const res = await apiFetch('/api/subcategories/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: groupId, navn })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error?.message || 'Kunne ikke opprette underkategori');
    }
    const json = await res.json();
    subcatRegistryAddItem(groupId, json.data || { id: Date.now(), navn });
    showToast('Underkategori opprettet', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function editSubcatGroup(groupId, currentName) {
  const newName = prompt('Nytt navn for gruppen:', currentName);
  if (!newName || newName.trim() === currentName) return;

  try {
    const res = await apiFetch(`/api/subcategories/groups/${groupId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ navn: newName.trim() })
    });
    if (!res.ok) throw new Error('Kunne ikke oppdatere gruppe');
    subcatRegistryEditGroup(groupId, newName.trim());
    showToast('Gruppe oppdatert', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteSubcatGroup(groupId, groupName) {
  const confirmed = await showConfirm(`Slett gruppen "${groupName}"? Alle underkategorier i gruppen slettes også.`, 'Slette gruppe');
  if (!confirmed) return;

  try {
    const res = await apiFetch(`/api/subcategories/groups/${groupId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Kunne ikke slette gruppe');
    subcatRegistryDeleteGroup(groupId);
    showToast('Gruppe slettet', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function editSubcatItem(subcatId, currentName) {
  const newName = prompt('Nytt navn:', currentName);
  if (!newName || newName.trim() === currentName) return;

  try {
    const res = await apiFetch(`/api/subcategories/items/${subcatId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ navn: newName.trim() })
    });
    if (!res.ok) throw new Error('Kunne ikke oppdatere underkategori');
    subcatRegistryEditItem(subcatId, newName.trim());
    showToast('Underkategori oppdatert', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deleteSubcatItem(subcatId, subcatName) {
  const confirmed = await showConfirm(`Slett underkategorien "${subcatName}"?`, 'Slette underkategori');
  if (!confirmed) return;

  try {
    const res = await apiFetch(`/api/subcategories/items/${subcatId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Kunne ikke slette underkategori');
    subcatRegistryDeleteItem(subcatId);
    showToast('Underkategori slettet', 'success');
    renderAdminSubcategories();
    renderSubcategoryFilter();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// reloadAppConfig removed — subcategory CRUD now updates serviceTypeRegistry in-place
// via subcatRegistry* helpers in filter-panel.js (shared global scope)

// ========================================
// ADMIN: DRAG AND DROP SORTING
// ========================================

/**
 * Initialize drag-and-drop sorting for a list container
 */
function initSortable(container, type) {
  if (!container) return;

  // Skip if already initialized (prevent duplicate listeners)
  if (container.dataset.sortableInitialized === 'true') return;
  container.dataset.sortableInitialized = 'true';

  let draggedItem = null;

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.sortable-item');
    if (!item) return;
    draggedItem = item;
    draggedItem.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', () => {
    if (draggedItem) {
      draggedItem.classList.remove('dragging');
      updateSortOrder(container, type);
      draggedItem = null;
    }
  });

  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedItem) return;

    const afterElement = getDragAfterElement(container, e.clientY);
    if (afterElement == null) {
      container.appendChild(draggedItem);
    } else {
      container.insertBefore(draggedItem, afterElement);
    }
  });
}

/**
 * Get the element after which the dragged item should be inserted
 */
function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.sortable-item:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/**
 * Update sort order after drag-and-drop
 */
async function updateSortOrder(container, type) {
  const items = container.querySelectorAll('.sortable-item');
  const updates = [];

  items.forEach((item, index) => {
    updates.push({ id: parseInt(item.dataset.id), sort_order: index });
  });

  try {
    // Update sort_order for each item
    for (const update of updates) {
      const endpoint = type === 'fields'
        ? `/api/fields/${update.id}`
        : `/api/service-types/${update.id}`;

      await apiFetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort_order: update.sort_order })
      });
    }

    // Reload to ensure consistency
    if (type === 'fields') {
      await loadOrganizationFields();
    } else {
      await loadOrganizationCategories();
    }
  } catch (error) {
    Logger.error('Failed to update sort order:', error);
    showToast('Kunne ikke oppdatere rekkefølge', 'error');
  }
}


// ========================================
// ADMIN TAB FUNCTIONS
// ========================================

let loginLogOffset = 0;
const LOGIN_LOG_LIMIT = 20;

async function loadAdminData() {
  // Initialize company address UI
  initCompanyAddressUI();
  // Initialize team members UI
  initTeamMembersUI();
  // Initialize fields management UI
  initFieldsManagementUI();

  // Load team members
  await loadTeamMembers();
  // Load login stats
  await loadLoginStats();
  // Load login log
  loginLogOffset = 0;
  await loadLoginLog(false);

  // Render admin fields, categories, and subcategories
  renderAdminFields();
  renderAdminCategories();
  renderAdminSubcategories();

  // Check and load super admin data if applicable
  await checkSuperAdminStatus();

  // Setup load more button
  document.getElementById('loadMoreLogins')?.addEventListener('click', () => loadLoginLog(true));
}

async function loadTeamMembers() {
  try {
    const response = await apiFetch('/api/team-members');

    if (!response.ok) {
      console.error('Failed to load team members');
      return;
    }

    const result = await response.json();
    const list = document.getElementById('teamMembersList');
    const emptyState = document.getElementById('teamMembersEmpty');
    const quotaBadge = document.getElementById('teamQuotaBadge');

    if (!list) return;

    // Update quota badge
    if (quotaBadge && result.data?.limits) {
      const { current_count, max_brukere } = result.data.limits;
      quotaBadge.textContent = `${current_count} / ${max_brukere}`;
      quotaBadge.classList.remove('near-limit', 'at-limit');
      if (current_count >= max_brukere) {
        quotaBadge.classList.add('at-limit');
      } else if (current_count >= max_brukere - 1) {
        quotaBadge.classList.add('near-limit');
      }
    }

    list.innerHTML = '';

    const members = result.data?.members || [];
    // Store for event delegation lookup
    teamMembersData = members;

    if (members.length > 0) {
      if (emptyState) emptyState.style.display = 'none';
      list.style.display = 'flex';

      // Use innerHTML with data-action attributes for event delegation
      list.innerHTML = members.map(member => {
        const initials = getInitials(member.navn);
        const lastLogin = member.sist_innlogget
          ? formatRelativeTime(member.sist_innlogget)
          : 'Aldri innlogget';

        return `
          <div class="team-member-item" data-action="editTeamMember" data-member-id="${member.id}">
            <div class="team-member-status ${member.aktiv ? '' : 'inactive'}"></div>
            <div class="team-member-avatar">${initials}</div>
            <div class="team-member-info">
              <div class="team-member-name">${escapeHtml(member.navn)}</div>
              <div class="team-member-email">${escapeHtml(member.epost)}</div>
              <div class="team-member-meta">
                <span class="team-member-role">${escapeHtml(member.rolle || 'medlem')}</span>
                <span class="team-member-last-login">Sist: ${lastLogin}</span>
              </div>
            </div>
            <div class="team-member-actions">
              <button class="btn-icon" data-action="editTeamMember" data-member-id="${member.id}" title="Rediger"><i aria-hidden="true" class="fas fa-pen"></i></button>
              <button class="btn-icon delete" data-action="deleteTeamMember" data-member-id="${member.id}" title="Slett"><i aria-hidden="true" class="fas fa-trash"></i></button>
            </div>
          </div>
        `;
      }).join('');
    } else {
      list.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';
    }
  } catch (error) {
    console.error('Error loading team members:', error);
  }
}

function openTeamMemberModal(member = null) {
  const modal = document.getElementById('teamMemberModal');
  const title = document.getElementById('teamMemberModalTitle');
  const form = document.getElementById('teamMemberForm');
  const deleteBtn = document.getElementById('deleteTeamMemberBtn');
  const passwordInput = document.getElementById('memberPassord');

  if (!modal || !form) return;

  // Reset form
  form.reset();
  document.getElementById('teamMemberId').value = '';

  if (member) {
    // Edit mode
    title.textContent = 'Rediger teammedlem';
    document.getElementById('teamMemberId').value = member.id;
    document.getElementById('memberNavn').value = member.navn || '';
    document.getElementById('memberEpost').value = member.epost || '';
    document.getElementById('memberTelefon').value = member.telefon || '';
    document.getElementById('memberRolle').value = member.rolle || 'medlem';
    passwordInput.required = false;
    passwordInput.placeholder = 'La stå tom for å beholde';
    deleteBtn.style.display = 'inline-flex';
  } else {
    // Create mode
    title.textContent = 'Nytt teammedlem';
    passwordInput.required = true;
    passwordInput.placeholder = 'Minst 8 tegn';
    deleteBtn.style.display = 'none';
  }

  modal.classList.remove('hidden');
}

function closeTeamMemberModal() {
  const modal = document.getElementById('teamMemberModal');
  if (modal) modal.classList.add('hidden');
}

async function saveTeamMember(e) {
  e.preventDefault();

  const memberId = document.getElementById('teamMemberId').value;
  const isEdit = !!memberId;

  const data = {
    navn: document.getElementById('memberNavn').value.trim(),
    epost: document.getElementById('memberEpost').value.trim(),
    telefon: document.getElementById('memberTelefon').value.trim() || null,
    rolle: document.getElementById('memberRolle').value
  };

  const password = document.getElementById('memberPassord').value;
  if (password) {
    data.passord = password;
  } else if (!isEdit) {
    showToast('Passord er påkrevd', 'error');
    return;
  }

  try {
    const url = isEdit ? `/api/team-members/${memberId}` : '/api/team-members';
    const method = isEdit ? 'PUT' : 'POST';

    const teamMemberHeaders = {
      'Content-Type': 'application/json',
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      teamMemberHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(url, {
      method,
      headers: teamMemberHeaders,
      credentials: 'include',
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok) {
      showToast(result.error?.message || 'Kunne ikke lagre bruker', 'error');
      return;
    }

    showToast(isEdit ? 'Bruker oppdatert' : 'Bruker opprettet', 'success');
    closeTeamMemberModal();
    await loadTeamMembers();
  } catch (error) {
    console.error('Error saving team member:', error);
    showToast('En feil oppstod', 'error');
  }
}

async function deleteTeamMember(member) {
  const confirmed = await showConfirm(`Er du sikker på at du vil slette ${member.navn}?`, 'Slette teammedlem');
  if (!confirmed) return;

  try {
    const deleteHeaders = {};
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      deleteHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(`/api/team-members/${member.id}`, {
      method: 'DELETE',
      headers: deleteHeaders,
      credentials: 'include'
    });
    if (!response.ok) {
      const result = await response.json();
      showToast(result.error?.message || 'Kunne ikke slette bruker', 'error');
      return;
    }

    showToast('Bruker slettet', 'success');
    closeTeamMemberModal();
    await loadTeamMembers();
  } catch (error) {
    console.error('Error deleting team member:', error);
    showToast('En feil oppstod', 'error');
  }
}

function initTeamMembersUI() {
  // Add member buttons
  document.getElementById('addTeamMemberBtn')?.addEventListener('click', () => openTeamMemberModal());
  document.getElementById('addFirstMemberBtn')?.addEventListener('click', () => openTeamMemberModal());

  // Modal close buttons
  document.getElementById('closeTeamMemberModal')?.addEventListener('click', closeTeamMemberModal);
  document.getElementById('cancelTeamMember')?.addEventListener('click', closeTeamMemberModal);

  // Form submit
  document.getElementById('teamMemberForm')?.addEventListener('submit', saveTeamMember);

  // Delete button in modal
  document.getElementById('deleteTeamMemberBtn')?.addEventListener('click', () => {
    const memberId = document.getElementById('teamMemberId').value;
    if (memberId) {
      const memberName = document.getElementById('memberNavn').value;
      deleteTeamMember({ id: memberId, navn: memberName });
    }
  });
}

/**
 * Initialize field and category management UI
 */
function initFieldsManagementUI() {
  // Field buttons
  document.getElementById('addFieldBtn')?.addEventListener('click', () => openFieldModal());
  document.getElementById('addFirstFieldBtn')?.addEventListener('click', () => openFieldModal());

  // Field modal
  document.getElementById('closeFieldModal')?.addEventListener('click', () => {
    document.getElementById('fieldModal').classList.add('hidden');
  });
  document.getElementById('cancelField')?.addEventListener('click', () => {
    document.getElementById('fieldModal').classList.add('hidden');
  });
  document.getElementById('fieldForm')?.addEventListener('submit', saveField);
  document.getElementById('deleteFieldBtn')?.addEventListener('click', () => {
    const fieldId = document.getElementById('fieldId').value;
    if (fieldId) confirmDeleteField(parseInt(fieldId));
  });

  // Field type change - show/hide options section
  document.getElementById('fieldType')?.addEventListener('change', (e) => {
    const optionsSection = document.getElementById('fieldOptionsSection');
    if (optionsSection) {
      optionsSection.style.display = e.target.value === 'select' ? 'block' : 'none';
    }
  });

  // Add field option button
  document.getElementById('addFieldOptionBtn')?.addEventListener('click', addFieldOption);

  // Auto-generate field_name from display_name
  document.getElementById('fieldDisplayName')?.addEventListener('input', (e) => {
    const fieldNameInput = document.getElementById('fieldName');
    if (fieldNameInput && !fieldNameInput.disabled) {
      fieldNameInput.value = e.target.value.toLowerCase()
        .replace(/[æ]/g, 'ae')
        .replace(/[ø]/g, 'o')
        .replace(/[å]/g, 'a')
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    }
  });

  // Category buttons
  document.getElementById('addCategoryBtn')?.addEventListener('click', () => openCategoryModal());
  document.getElementById('addFirstCategoryBtn')?.addEventListener('click', () => openCategoryModal());
  document.getElementById('manageCategoriesBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openCategoryListModal();
  });

  // Category modal
  document.getElementById('closeCategoryModal')?.addEventListener('click', () => {
    document.getElementById('categoryModal').classList.add('hidden');
  });
  document.getElementById('cancelCategory')?.addEventListener('click', () => {
    document.getElementById('categoryModal').classList.add('hidden');
  });
  document.getElementById('categoryForm')?.addEventListener('submit', saveCategory);
  document.getElementById('deleteCategoryBtn')?.addEventListener('click', () => {
    const categoryId = document.getElementById('categoryId').value;
    if (categoryId) confirmDeleteCategory(parseInt(categoryId));
  });

  // Auto-generate slug from name (only for new categories)
  document.getElementById('categoryName')?.addEventListener('input', (e) => {
    const slugInput = document.getElementById('categorySlug');
    const idInput = document.getElementById('categoryId');
    // Only auto-generate slug for new categories (no id yet)
    if (slugInput && !idInput?.value) {
      slugInput.value = e.target.value.toLowerCase()
        .replace(/[æ]/g, 'ae')
        .replace(/[ø]/g, 'o')
        .replace(/[å]/g, 'a')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    }
  });

  // Icon picker grid click handler
  document.getElementById('categoryIconPicker')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.icon-btn');
    if (!btn) return;
    document.querySelectorAll('#categoryIconPicker .icon-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('categoryIcon').value = btn.dataset.icon;
  });

  // Color preview update
  document.getElementById('categoryColor')?.addEventListener('input', (e) => {
    updateCategoryColorPreview(e.target.value);
  });
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRelativeTime(dateString) {
  if (!dateString) return 'Ukjent';

  let date = dateString;
  if (!date.endsWith('Z') && !date.includes('+')) {
    date = date.replace(' ', 'T') + 'Z';
  }

  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Nå';
  if (diffMins < 60) return `${diffMins} min siden`;
  if (diffHours < 24) return `${diffHours} t siden`;
  if (diffDays < 7) return `${diffDays} d siden`;

  return then.toLocaleDateString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

async function loadLoginStats() {
  try {
    const response = await fetch('/api/login-logg/stats', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load login stats');
      return;
    }

    const stats = await response.json();

    document.getElementById('statTotalLogins').textContent = stats.total || 0;
    document.getElementById('statSuccessLogins').textContent = stats.vellykket || 0;
    document.getElementById('statFailedLogins').textContent = stats.feilet || 0;
    document.getElementById('statLast24h').textContent = stats.siste24t || 0;
  } catch (error) {
    console.error('Error loading login stats:', error);
  }
}

async function loadLoginLog(append = false) {
  try {
    if (!append) {
      loginLogOffset = 0;
    }

    const response = await fetch(`/api/login-logg?limit=${LOGIN_LOG_LIMIT}&offset=${loginLogOffset}`, {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load login log');
      return;
    }

    const data = await response.json();
    const tbody = document.getElementById('loginLogBody');

    if (!append) {
      tbody.innerHTML = '';
    }

    if (data.logg && data.logg.length > 0) {
      data.logg.forEach(entry => {
        const row = document.createElement('tr');
        // SQLite stores UTC, add 'Z' suffix if missing to parse as UTC
        let tidspunkt = entry.tidspunkt;
        if (tidspunkt && !tidspunkt.endsWith('Z') && !tidspunkt.includes('+')) {
          tidspunkt = tidspunkt.replace(' ', 'T') + 'Z';
        }
        const tid = new Date(tidspunkt).toLocaleString('nb-NO', {
          timeZone: 'Europe/Oslo',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        const statusClass = entry.status === 'vellykket' ? 'success' : 'failed';
        const statusText = entry.status === 'vellykket' ? 'OK' : 'Feilet';
        const statusIcon = entry.status === 'vellykket' ? 'fa-check' : 'fa-times';

        // Parse user agent for device info
        const ua = entry.user_agent || '';
        let device = 'Ukjent';
        if (ua.includes('iPhone')) device = 'iPhone';
        else if (ua.includes('iPad')) device = 'iPad';
        else if (ua.includes('Android')) device = 'Android';
        else if (ua.includes('Windows')) device = 'Windows';
        else if (ua.includes('Mac')) device = 'Mac';
        else if (ua.includes('Linux')) device = 'Linux';

        row.innerHTML = `
          <td>${tid}</td>
          <td>${escapeHtml(entry.bruker_navn || '-')}</td>
          <td>${escapeHtml(entry.epost)}</td>
          <td><span class="status-badge ${statusClass}"><i aria-hidden="true" class="fas ${statusIcon}"></i> ${statusText}</span></td>
          <td class="ip-address">${escapeHtml(entry.ip_adresse || '-')}</td>
          <td class="user-agent" title="${escapeHtml(ua)}">${device}</td>
        `;
        tbody.appendChild(row);
      });

      loginLogOffset += data.logg.length;

      // Hide load more if no more data
      const loadMoreBtn = document.getElementById('loadMoreLogins');
      if (loadMoreBtn) {
        loadMoreBtn.style.display = data.logg.length < LOGIN_LOG_LIMIT ? 'none' : 'block';
      }
    } else if (!append) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--color-text-tertiary);">Ingen innlogginger registrert</td></tr>';
    }
  } catch (error) {
    console.error('Error loading login log:', error);
  }
}

function renderSeasonChart() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
  const monthCounts = new Array(12).fill(0);

  // Count kontroller per month (based on neste_el_kontroll and neste_brann_kontroll)
  customers.forEach(c => {
    // El-kontroll
    if (c.neste_el_kontroll) {
      const date = new Date(c.neste_el_kontroll);
      if (!Number.isNaN(date.getTime())) {
        monthCounts[date.getMonth()]++;
      }
    }
    // Brann-kontroll
    if (c.neste_brann_kontroll) {
      const date = new Date(c.neste_brann_kontroll);
      if (!Number.isNaN(date.getTime())) {
        monthCounts[date.getMonth()]++;
      }
    }
  });

  const maxCount = Math.max(...monthCounts, 1);

  const container = document.getElementById('seasonChart');
  if (!container) return;

  container.innerHTML = months.map((month, i) => {
    const count = monthCounts[i];
    const height = (count / maxCount) * 100;
    return `
      <div class="season-bar">
        <span class="season-bar-value">${count}</span>
        <div class="season-bar-fill combined" style="height: ${height}%"></div>
        <span class="season-bar-label">${month}</span>
      </div>
    `;
  }).join('');
}

// Generic helper for rendering bar statistics
function renderBarStats(containerId, data, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (options.limit) sorted.splice(options.limit);

  if (sorted.length === 0) {
    container.innerHTML = '<p style="color: var(--color-text-muted); font-size: 13px;">Ingen data</p>';
    return;
  }

  const total = options.total || Object.values(data).reduce((a, b) => a + b, 0) || 1;
  const maxForPct = options.useMaxAsBase ? (sorted[0]?.[1] || 1) : total;

  container.innerHTML = sorted.map(([label, count]) => {
    const pct = (count / maxForPct) * 100;
    const barClass = options.getBarClass ? options.getBarClass(label) : options.barClass || 'default';
    const valueText = options.showPercent === false ? `${count}` : `${count} (${pct.toFixed(0)}%)`;
    return `
      <div class="stat-bar-item">
        <div class="stat-bar-header">
          <span class="stat-bar-label">${label}</span>
          <span class="stat-bar-value">${valueText}</span>
        </div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill ${barClass}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderCategoryStats() {
  const categories = {};
  customers.forEach(c => {
    const cat = c.kategori || 'Ukjent';
    categories[cat] = (categories[cat] || 0) + 1;
  });

  renderBarStats('categoryStats', categories, {
    total: customers.length,
    getBarClass: (cat) => serviceTypeRegistry.getCategoryClass(cat)
  });
}

function renderAreaStats() {
  const areas = {};
  customers.forEach(c => {
    const area = c.poststed || 'Ukjent';
    areas[area] = (areas[area] || 0) + 1;
  });

  renderBarStats('areaStats', areas, {
    limit: 10,
    useMaxAsBase: true,
    showPercent: false,
    barClass: 'area'
  });
}

function renderEltypeStats() {
  const types = {};
  customers.forEach(c => {
    if (c.el_type) types[c.el_type] = (types[c.el_type] || 0) + 1;
  });

  renderBarStats('eltypeStats', types, { barClass: 'eltype' });
}

function renderBrannsystemStats() {
  const systems = {};
  customers.forEach(c => {
    if (c.brann_system) systems[c.brann_system] = (systems[c.brann_system] || 0) + 1;
  });

  renderBarStats('brannsystemStats', systems, { barClass: 'brannsystem' });
}

// ========================================
// COMPANY ADDRESS FUNCTIONS
// ========================================

let adminAddressSuggestions = [];
let adminSelectedIndex = -1;
let adminAddressDebounceTimer = null;

function initCompanyAddressUI() {
  loadCompanyAddress();
  setupAdminAddressAutocomplete();
  setupAdminPostnummerLookup();
}

function loadCompanyAddress() {
  const addressInput = document.getElementById('adminCompanyAddress');
  const postnummerInput = document.getElementById('adminCompanyPostnummer');
  const poststedInput = document.getElementById('adminCompanyPoststed');
  const coordsDisplay = document.getElementById('adminCoordinates');
  const clearBtn = document.getElementById('clearCompanyAddressBtn');

  if (!addressInput) return;

  // Fill from appConfig
  if (appConfig.routeStartAddress) {
    addressInput.value = appConfig.routeStartAddress;
  }
  if (appConfig.routeStartLat && appConfig.routeStartLng) {
    coordsDisplay.innerHTML = `<span>${appConfig.routeStartLat.toFixed(5)}, ${appConfig.routeStartLng.toFixed(5)}</span>`;
    clearBtn.style.display = '';
  } else {
    coordsDisplay.innerHTML = '<span class="not-set">Ikke satt</span>';
    clearBtn.style.display = 'none';
  }
}

function setupAdminAddressAutocomplete() {
  const input = document.getElementById('adminCompanyAddress');
  const suggestionsContainer = document.getElementById('adminAddressSuggestions');
  if (!input || !suggestionsContainer) return;

  input.addEventListener('input', () => {
    const query = input.value.trim();
    clearTimeout(adminAddressDebounceTimer);
    if (query.length < 3) {
      suggestionsContainer.classList.remove('visible');
      adminAddressSuggestions = [];
      return;
    }
    adminAddressDebounceTimer = setTimeout(async () => {
      try {
        const results = await searchAddresses(query);
        adminAddressSuggestions = results;
        adminSelectedIndex = -1;
        renderAdminAddressSuggestions(results);
      } catch (err) {
        Logger.warn('Address search error:', err);
      }
    }, 300);
  });

  input.addEventListener('keydown', (e) => {
    if (!adminAddressSuggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      adminSelectedIndex = Math.min(adminSelectedIndex + 1, adminAddressSuggestions.length - 1);
      highlightAdminSuggestion();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      adminSelectedIndex = Math.max(adminSelectedIndex - 1, 0);
      highlightAdminSuggestion();
    } else if (e.key === 'Enter' && adminSelectedIndex >= 0) {
      e.preventDefault();
      selectAdminAddressSuggestion(adminAddressSuggestions[adminSelectedIndex]);
    } else if (e.key === 'Escape') {
      suggestionsContainer.classList.remove('visible');
    }
  });

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.admin-address-wrapper')) {
      suggestionsContainer.classList.remove('visible');
    }
  });
}

function renderAdminAddressSuggestions(results) {
  const container = document.getElementById('adminAddressSuggestions');
  if (!container) return;

  if (!results.length) {
    container.classList.remove('visible');
    return;
  }

  container.innerHTML = results.map((r, i) => `
    <div class="admin-address-suggestion${i === adminSelectedIndex ? ' selected' : ''}"
         onclick="selectAdminAddressSuggestion(adminAddressSuggestions[${i}])">
      <i class="fas fa-map-marker-alt"></i>
      <span>${escapeHtml(r.adresse)} &mdash; ${escapeHtml(r.postnummer)} ${escapeHtml(r.poststed)}</span>
    </div>
  `).join('');
  container.classList.add('visible');
}

function highlightAdminSuggestion() {
  const items = document.querySelectorAll('.admin-address-suggestion');
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === adminSelectedIndex);
  });
}

function selectAdminAddressSuggestion(suggestion) {
  if (!suggestion) return;

  const addressInput = document.getElementById('adminCompanyAddress');
  const postnummerInput = document.getElementById('adminCompanyPostnummer');
  const poststedInput = document.getElementById('adminCompanyPoststed');
  const coordsDisplay = document.getElementById('adminCoordinates');
  const suggestionsContainer = document.getElementById('adminAddressSuggestions');

  addressInput.value = suggestion.adresse || '';
  postnummerInput.value = suggestion.postnummer || '';
  poststedInput.value = suggestion.poststed || '';

  if (suggestion.lat && suggestion.lng) {
    coordsDisplay.innerHTML = `<span>${Number(suggestion.lat).toFixed(5)}, ${Number(suggestion.lng).toFixed(5)}</span>`;
    coordsDisplay.dataset.lat = suggestion.lat;
    coordsDisplay.dataset.lng = suggestion.lng;
  }

  suggestionsContainer.classList.remove('visible');
  adminAddressSuggestions = [];
  adminSelectedIndex = -1;
}

function setupAdminPostnummerLookup() {
  const input = document.getElementById('adminCompanyPostnummer');
  const status = document.getElementById('adminPostnummerStatus');
  const poststedInput = document.getElementById('adminCompanyPoststed');
  if (!input) return;

  input.addEventListener('input', async () => {
    const value = input.value.trim();
    if (!/^\d{4}$/.test(value)) {
      if (status) status.textContent = '';
      return;
    }

    if (status) { status.textContent = '⟳'; status.className = 'admin-postnummer-status loading'; }

    try {
      const result = await lookupPostnummer(value);
      if (result && result.poststed) {
        poststedInput.value = result.poststed;
        if (status) { status.textContent = '✓'; status.className = 'admin-postnummer-status valid'; }
      } else {
        if (status) { status.textContent = '✗'; status.className = 'admin-postnummer-status invalid'; }
      }
    } catch {
      if (status) { status.textContent = '✗'; status.className = 'admin-postnummer-status invalid'; }
    }
  });
}

async function saveCompanyAddress() {
  const address = document.getElementById('adminCompanyAddress')?.value.trim() || '';
  const postnummer = document.getElementById('adminCompanyPostnummer')?.value.trim() || '';
  const poststed = document.getElementById('adminCompanyPoststed')?.value.trim() || '';
  const coordsDisplay = document.getElementById('adminCoordinates');

  let lat = coordsDisplay?.dataset?.lat ? Number(coordsDisplay.dataset.lat) : null;
  let lng = coordsDisplay?.dataset?.lng ? Number(coordsDisplay.dataset.lng) : null;

  // If we have address but no coords, try to geocode
  if (address && (!lat || !lng)) {
    try {
      const fullAddress = `${address}, ${postnummer} ${poststed}, Norge`;
      const geoResponse = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`);
      const geoData = await geoResponse.json();
      if (geoData.length > 0) {
        lat = Number(geoData[0].lat);
        lng = Number(geoData[0].lon);
      }
    } catch (err) {
      Logger.warn('Geocoding failed:', err);
    }
  }

  const saveBtn = document.getElementById('saveCompanyAddressBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Lagrer...';

  try {
    const response = await apiFetch('/api/organization/address', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_address: address || null,
        company_postnummer: postnummer || null,
        company_poststed: poststed || null,
        route_start_lat: lat,
        route_start_lng: lng,
      }),
    });

    const result = await response.json();
    if (result.success) {
      // Update appConfig in memory
      appConfig.routeStartAddress = address || undefined;
      appConfig.routeStartLat = lat || undefined;
      appConfig.routeStartLng = lng || undefined;

      // Update office marker on map
      updateOfficeMarkerPosition();

      // Fly map to the newly saved office location
      if (lat && lng && map) {
        map.flyTo({ center: [lng, lat], zoom: 6, duration: 1600, essential: true });
      }

      // Update coordinates display
      if (lat && lng) {
        coordsDisplay.innerHTML = `<span>${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`;
        coordsDisplay.dataset.lat = lat;
        coordsDisplay.dataset.lng = lng;
        document.getElementById('clearCompanyAddressBtn').style.display = '';
      }

      // Remove address banner, nudge pill and admin badge
      dismissAddressBanner();
      removeAddressNudge();
      const adminBadge = document.getElementById('adminAddressBadge');
      if (adminBadge) adminBadge.style.display = 'none';

      showToast('Firmaadresse lagret', 'success');
    } else {
      showToast(result.error?.message || 'Kunne ikke lagre adresse', 'error');
    }
  } catch (err) {
    Logger.error('Save company address error:', err);
    showToast('Feil ved lagring av adresse', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="fas fa-save"></i> Lagre adresse';
  }
}

async function clearCompanyAddress() {
  if (!confirm('Er du sikker på at du vil fjerne firmaadresse?')) return;

  try {
    const response = await apiFetch('/api/organization/address', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_address: null,
        company_postnummer: null,
        company_poststed: null,
        route_start_lat: null,
        route_start_lng: null,
      }),
    });

    const result = await response.json();
    if (result.success) {
      // Clear appConfig
      appConfig.routeStartAddress = undefined;
      appConfig.routeStartLat = undefined;
      appConfig.routeStartLng = undefined;

      // Clear form
      document.getElementById('adminCompanyAddress').value = '';
      document.getElementById('adminCompanyPostnummer').value = '';
      document.getElementById('adminCompanyPoststed').value = '';
      const coordsDisplay = document.getElementById('adminCoordinates');
      coordsDisplay.innerHTML = '<span class="not-set">Ikke satt</span>';
      delete coordsDisplay.dataset.lat;
      delete coordsDisplay.dataset.lng;
      document.getElementById('clearCompanyAddressBtn').style.display = 'none';

      // Hide office marker
      updateOfficeMarkerPosition();

      showToast('Firmaadresse fjernet', 'success');
    }
  } catch (err) {
    Logger.error('Clear company address error:', err);
    showToast('Feil ved fjerning av adresse', 'error');
  }
}



// ========================================
// SUPER ADMIN FUNCTIONS
// ========================================

let isSuperAdmin = false;
let superAdminOrganizations = [];
let selectedOrgId = null;
let selectedOrgData = null;

async function checkSuperAdminStatus() {
  // Check if user is super admin from the login response stored in sessionStorage/localStorage
  // This is set during login
  const storedSuperAdmin = sessionStorage.getItem('isSuperAdmin') || localStorage.getItem('isSuperAdmin');
  isSuperAdmin = storedSuperAdmin === 'true';

  if (isSuperAdmin) {
    const superAdminSection = document.getElementById('superAdminSection');
    if (superAdminSection) {
      superAdminSection.style.display = 'block';
      await loadSuperAdminData();
    }
  }
}

async function loadSuperAdminData() {
  if (!isSuperAdmin) return;

  try {
    // Load global statistics
    await loadGlobalStatistics();
    // Load organizations list
    await loadOrganizations();
    // Setup event listeners
    initSuperAdminUI();
  } catch (error) {
    console.error('Error loading super admin data:', error);
  }
}

async function loadGlobalStatistics() {
  try {
    const response = await fetch('/api/super-admin/statistics', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load global statistics');
      return;
    }

    const result = await response.json();
    if (result.success && result.data) {
      const stats = result.data;
      updateElement('statTotalOrgs', stats.totalOrganizations || 0);
      updateElement('statGlobalKunder', stats.totalKunder || 0);
      updateElement('statGlobalBrukere', stats.totalBrukere || 0);
      updateElement('statActiveOrgs', stats.activeOrganizations || 0);
    }
  } catch (error) {
    console.error('Error loading global statistics:', error);
  }
}

function updateElement(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function loadOrganizations() {
  try {
    const response = await fetch('/api/super-admin/organizations', {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load organizations');
      return;
    }

    const result = await response.json();
    if (result.success) {
      // Support paginated response format
      const data = result.data;
      superAdminOrganizations = Array.isArray(data) ? data : (data.organizations || []);
      renderOrganizationList();
    }
  } catch (error) {
    console.error('Error loading organizations:', error);
  }
}

function renderOrganizationList(filter = '') {
  const tbody = document.getElementById('orgListBody');
  if (!tbody) return;

  const filtered = filter
    ? superAdminOrganizations.filter(org =>
        org.navn.toLowerCase().includes(filter.toLowerCase()) ||
        org.slug.toLowerCase().includes(filter.toLowerCase())
      )
    : superAdminOrganizations;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 20px; color: var(--text-secondary);">
          ${filter ? 'Ingen organisasjoner funnet' : 'Ingen organisasjoner registrert'}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(org => {
    const planBadge = getPlanBadge(org.plan_type);
    const statusBadge = getSubscriptionStatusBadge(org.subscription_status);
    const opprettet = org.opprettet ? new Date(org.opprettet).toLocaleDateString('nb-NO') : '-';

    return `
      <tr data-org-id="${org.id}">
        <td><strong>${escapeHtml(org.navn)}</strong><br><small style="color: var(--text-tertiary);">${escapeHtml(org.slug)}</small></td>
        <td>${planBadge}</td>
        <td>${statusBadge}</td>
        <td>${org.kunde_count || 0}</td>
        <td>${org.bruker_count || 0}</td>
        <td>${opprettet}</td>
        <td>
          <button class="btn btn-small btn-secondary" data-action="selectOrganization" data-org-id="${org.id}">
            <i aria-hidden="true" class="fas fa-eye"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function getPlanBadge(plan) {
  const badges = {
    'free': '<span class="badge badge-secondary">Gratis</span>',
    'standard': '<span class="badge badge-primary">Standard</span>',
    'premium': '<span class="badge badge-success">Premium</span>',
    'enterprise': '<span class="badge badge-warning">Enterprise</span>'
  };
  return badges[plan] || badges.free;
}

function getSubscriptionStatusBadge(status) {
  const badges = {
    'active': '<span class="badge badge-success">Aktiv</span>',
    'trialing': '<span class="badge badge-info">Prøveperiode</span>',
    'past_due': '<span class="badge badge-warning">Forfalt</span>',
    'canceled': '<span class="badge badge-danger">Kansellert</span>',
    'incomplete': '<span class="badge badge-secondary">Ufullstendig</span>'
  };
  return badges[status] || '<span class="badge badge-secondary">Ukjent</span>';
}

async function selectOrganization(orgId) {
  selectedOrgId = orgId;

  try {
    // Load organization details
    const response = await fetch(`/api/super-admin/organizations/${orgId}`, {
      credentials: 'include'
    });

    if (!response.ok) {
      showNotification('Kunne ikke laste organisasjonsdetaljer', 'error');
      return;
    }

    const result = await response.json();
    if (result.success) {
      selectedOrgData = result.data;
      renderSelectedOrganization();

      // Show the details section
      const detailsSection = document.getElementById('selectedOrgSection');
      if (detailsSection) {
        detailsSection.style.display = 'block';
        detailsSection.scrollIntoView({ behavior: 'smooth' });
      }

      // Load customers for this org
      await loadOrgCustomers(orgId);
      await loadOrgUsers(orgId);
    }
  } catch (error) {
    console.error('Error loading organization:', error);
    showNotification('Feil ved lasting av organisasjon', 'error');
  }
}

function renderSelectedOrganization() {
  if (!selectedOrgData) return;

  updateElement('selectedOrgName', selectedOrgData.navn);
  updateElement('orgInfoSlug', selectedOrgData.slug);
  updateElement('orgInfoPlan', selectedOrgData.plan_type || 'free');
  updateElement('orgInfoSubscription', selectedOrgData.subscription_status || 'ukjent');
  updateElement('orgInfoIndustry', selectedOrgData.industry_template_id ? `ID: ${selectedOrgData.industry_template_id}` : 'Ingen');
}

async function loadOrgCustomers(orgId) {
  try {
    const response = await fetch(`/api/super-admin/organizations/${orgId}/kunder`, {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load org customers');
      return;
    }

    const result = await response.json();
    if (result.success) {
      const kunder = result.data?.data || [];
      renderOrgCustomers(kunder);
      updateElement('orgCustomerCount', kunder.length);
    }
  } catch (error) {
    console.error('Error loading org customers:', error);
  }
}

function renderOrgCustomers(customers) {
  const tbody = document.getElementById('orgCustomersBody');
  if (!tbody) return;

  if (customers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 20px; color: var(--text-secondary);">
          Ingen kunder registrert
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = customers.map(kunde => `
    <tr data-kunde-id="${kunde.id}">
      <td><strong>${escapeHtml(kunde.navn)}</strong></td>
      <td>${escapeHtml(kunde.adresse || '-')}</td>
      <td>${escapeHtml(kunde.telefon || '-')}</td>
      <td>${escapeHtml(kunde.epost || '-')}</td>
      <td>
        <button class="btn-icon" data-action="editOrgCustomer" data-kunde-id="${kunde.id}" title="Rediger">
          <i aria-hidden="true" class="fas fa-pen"></i>
        </button>
        <button class="btn-icon delete" data-action="deleteOrgCustomer" data-kunde-id="${kunde.id}" title="Slett">
          <i aria-hidden="true" class="fas fa-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

async function loadOrgUsers(orgId) {
  try {
    const response = await fetch(`/api/super-admin/organizations/${orgId}/brukere`, {
      credentials: 'include'
    });

    if (!response.ok) {
      console.error('Failed to load org users');
      return;
    }

    const result = await response.json();
    if (result.success) {
      renderOrgUsers(result.data || []);
      updateElement('orgUserCount', (result.data || []).length);
    }
  } catch (error) {
    console.error('Error loading org users:', error);
  }
}

function renderOrgUsers(users) {
  const tbody = document.getElementById('orgUsersBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 20px; color: var(--text-secondary);">
          Ingen brukere registrert
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = users.map(user => {
    const sistInnlogget = user.sist_innlogget
      ? formatRelativeTime(user.sist_innlogget)
      : 'Aldri';
    const opprettet = user.opprettet
      ? new Date(user.opprettet).toLocaleDateString('nb-NO')
      : '-';

    return `
      <tr>
        <td><strong>${escapeHtml(user.navn)}</strong></td>
        <td>${escapeHtml(user.epost)}</td>
        <td>${sistInnlogget}</td>
        <td>${opprettet}</td>
      </tr>
    `;
  }).join('');
}

function closeOrgDetails() {
  selectedOrgId = null;
  selectedOrgData = null;
  const detailsSection = document.getElementById('selectedOrgSection');
  if (detailsSection) {
    detailsSection.style.display = 'none';
  }
}

async function addOrgCustomer() {
  if (!selectedOrgId) return;

  // Use the existing customer modal but in "add for org" mode
  openCustomerModal(null, selectedOrgId);
}

async function editOrgCustomer(kundeId) {
  if (!selectedOrgId) return;

  try {
    // Fetch customer data
    const response = await fetch(`/api/super-admin/organizations/${selectedOrgId}/kunder`, {
      credentials: 'include'
    });

    if (!response.ok) return;

    const result = await response.json();
    const kunde = (result.data?.data || []).find(k => k.id === kundeId);

    if (kunde) {
      openCustomerModal(kunde, selectedOrgId);
    }
  } catch (error) {
    console.error('Error fetching customer:', error);
  }
}

async function deleteOrgCustomer(kundeId) {
  if (!selectedOrgId) return;

  const confirmed = await showConfirm('Er du sikker på at du vil slette denne kunden?', 'Slett');
  if (!confirmed) return;

  try {
    const deleteHeaders = {};
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      deleteHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(`/api/super-admin/organizations/${selectedOrgId}/kunder/${kundeId}`, {
      method: 'DELETE',
      headers: deleteHeaders,
      credentials: 'include'
    });

    if (response.ok) {
      showNotification('Kunde slettet');
      await loadOrgCustomers(selectedOrgId);
      await loadGlobalStatistics();
    } else {
      const result = await response.json();
      showNotification(result.error?.message || 'Kunne ikke slette kunden', 'error');
    }
  } catch (error) {
    console.error('Error deleting customer:', error);
    showNotification('Feil ved sletting av kunde', 'error');
  }
}

// Open customer modal for super admin - reuse existing modal or create simple version
function openCustomerModal(kunde = null, forOrgId = null) {
  // For super admin, we'll create a simple modal inline
  const existingModal = document.getElementById('superAdminCustomerModal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'superAdminCustomerModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width: 500px;">
      <div class="modal-header">
        <h2>${kunde ? 'Rediger kunde' : 'Ny kunde'}</h2>
        <button class="modal-close" id="saCloseModalBtn">&times;</button>
      </div>
      <form id="superAdminCustomerForm">
        <input type="hidden" id="saKundeId" value="${kunde?.id || ''}">
        <input type="hidden" id="saKundeOrgId" value="${forOrgId || ''}">

        <div class="form-group">
          <label for="saKundeNavn">Navn *</label>
          <input type="text" id="saKundeNavn" value="${escapeHtml(kunde?.navn || '')}" required>
        </div>

        <div class="form-group">
          <label for="saKundeAdresse">Adresse *</label>
          <input type="text" id="saKundeAdresse" value="${escapeHtml(kunde?.adresse || '')}" required>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="saKundePostnummer">Postnummer</label>
            <input type="text" id="saKundePostnummer" value="${escapeHtml(kunde?.postnummer || '')}">
          </div>
          <div class="form-group">
            <label for="saKundePoststed">Poststed</label>
            <input type="text" id="saKundePoststed" value="${escapeHtml(kunde?.poststed || '')}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="saKundeTelefon">Telefon</label>
            <input type="text" id="saKundeTelefon" value="${escapeHtml(kunde?.telefon || '')}">
          </div>
          <div class="form-group">
            <label for="saKundeEpost">E-post</label>
            <input type="email" id="saKundeEpost" value="${escapeHtml(kunde?.epost || '')}">
          </div>
        </div>

        <div class="form-group">
          <label for="saKundeKontaktperson">Kontaktperson</label>
          <input type="text" id="saKundeKontaktperson" value="${escapeHtml(kunde?.kontaktperson || '')}">
        </div>

        <div class="form-group">
          <label for="saKundeNotater">Notater</label>
          <textarea id="saKundeNotater" rows="3">${escapeHtml(kunde?.notater || '')}</textarea>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="saCancelModalBtn">Avbryt</button>
          <button type="submit" class="btn btn-primary">${kunde ? 'Lagre' : 'Opprett'}</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);

  // Attach event listeners (CSP-compliant, no inline handlers)
  document.getElementById('saCloseModalBtn').addEventListener('click', closeSuperAdminCustomerModal);
  document.getElementById('saCancelModalBtn').addEventListener('click', closeSuperAdminCustomerModal);
  document.getElementById('superAdminCustomerForm').addEventListener('submit', saveSuperAdminCustomer);
}

function closeSuperAdminCustomerModal() {
  const modal = document.getElementById('superAdminCustomerModal');
  if (modal) modal.remove();
}

async function saveSuperAdminCustomer(e) {
  e.preventDefault();

  const kundeId = document.getElementById('saKundeId').value;
  const orgId = document.getElementById('saKundeOrgId').value;

  const data = {
    navn: document.getElementById('saKundeNavn').value,
    adresse: document.getElementById('saKundeAdresse').value,
    postnummer: document.getElementById('saKundePostnummer').value,
    poststed: document.getElementById('saKundePoststed').value,
    telefon: document.getElementById('saKundeTelefon').value,
    epost: document.getElementById('saKundeEpost').value,
    kontaktperson: document.getElementById('saKundeKontaktperson').value,
    notater: document.getElementById('saKundeNotater').value
  };

  try {
    let url = `/api/super-admin/organizations/${orgId}/kunder`;
    let method = 'POST';

    if (kundeId) {
      url += `/${kundeId}`;
      method = 'PUT';
    }

    const saHeaders = {
      'Content-Type': 'application/json'
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      saHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch(url, {
      method,
      headers: saHeaders,
      credentials: 'include',
      body: JSON.stringify(data)
    });

    if (response.ok) {
      showNotification(kundeId ? 'Kunde oppdatert' : 'Kunde opprettet');
      closeSuperAdminCustomerModal();
      await loadOrgCustomers(orgId);
      await loadGlobalStatistics();
    } else {
      const result = await response.json();
      showNotification(result.error?.message || 'Kunne ikke lagre kunden', 'error');
    }
  } catch (error) {
    console.error('Error saving customer:', error);
    showNotification('Feil ved lagring av kunde', 'error');

  }
}

function initSuperAdminUI() {
  // Organization search
  const orgSearchInput = document.getElementById('orgSearchInput');
  if (orgSearchInput) {
    orgSearchInput.addEventListener('input', debounce((e) => {
      renderOrganizationList(e.target.value);
    }, 300));
  }

  // Close org details button
  const closeOrgBtn = document.getElementById('closeOrgDetailsBtn');
  if (closeOrgBtn) {
    closeOrgBtn.addEventListener('click', closeOrgDetails);
  }

  // Add customer button
  const addOrgCustomerBtn = document.getElementById('addOrgCustomerBtn');
  if (addOrgCustomerBtn) {
    addOrgCustomerBtn.addEventListener('click', addOrgCustomer);
  }

  // Organization detail tabs
  const tabBtns = document.querySelectorAll('.org-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;

      // Update active button
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/hide tabs
      document.getElementById('orgCustomersTab').style.display = tab === 'customers' ? 'block' : 'none';
      document.getElementById('orgUsersTab').style.display = tab === 'users' ? 'block' : 'none';
    });
  });

  // Event delegation for super admin data-action buttons (CSP-compliant)
  const superAdminSection = document.getElementById('superAdminSection');
  if (superAdminSection) {
    superAdminSection.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;

      const action = actionEl.dataset.action;
      switch (action) {
        case 'selectOrganization': {
          const orgId = Number(actionEl.dataset.orgId);
          if (orgId) selectOrganization(orgId);
          break;
        }
        case 'editOrgCustomer': {
          const kundeId = Number(actionEl.dataset.kundeId);
          if (kundeId) editOrgCustomer(kundeId);
          break;
        }
        case 'deleteOrgCustomer': {
          const kundeId = Number(actionEl.dataset.kundeId);
          if (kundeId) deleteOrgCustomer(kundeId);
          break;
        }
      }
    });
  }
}


// ============================================
// MOBILE RESPONSIVENESS
// ============================================

let isMobile = window.innerWidth <= 768;
let contentPanelMode = 'closed'; // 'half' | 'full' | 'closed'
let touchStartY = 0;
let sidebarOpen = false;
let mobileFilterSheetExpanded = false;
let moreMenuOpen = false;
let activeBottomTab = 'map';

function initMobileUI() {
  // Check if mobile
  isMobile = window.innerWidth <= 768;

  if (isMobile) {
    initBottomTabBar();
  }

  // Listen for resize
  window.addEventListener('resize', debounce(() => {
    const wasMobile = isMobile;
    isMobile = window.innerWidth <= 768;

    if (isMobile && !wasMobile) {
      initBottomTabBar();
    } else if (!isMobile && wasMobile) {
      removeBottomTabBar();
    }
  }, 250));
}

// ============================================
// PATCH NOTES / NYHETER
// ============================================

const PATCH_NOTES_STORAGE_KEY = 'skyplanner_lastSeenPatchNote';

async function checkForNewPatchNotes() {
  try {
    const lastSeenId = parseInt(localStorage.getItem(PATCH_NOTES_STORAGE_KEY) || '0', 10);
    const csrfToken = getCsrfToken();
    const headers = {};
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const response = await fetch('/api/patch-notes/latest-id', {
      credentials: 'include',
      headers
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result.data && result.data.latestId > lastSeenId) {
      showPatchNotesBadge();
      await loadAndShowPatchNotes(lastSeenId);
    }
  } catch (err) {
    console.warn('Could not check patch notes:', err);
  }
}

async function loadAndShowPatchNotes(sinceId) {
  try {
    const csrfToken = getCsrfToken();
    const headers = {};
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const url = sinceId > 0 ? `/api/patch-notes?since=${sinceId}` : '/api/patch-notes';
    const response = await fetch(url, {
      credentials: 'include',
      headers
    });
    if (!response.ok) return;
    const result = await response.json();
    const notes = result.data || [];
    if (notes.length === 0) {
      showPatchNotesEmptyState();
      return;
    }
    showPatchNotesModal(notes);
    const latestId = Math.max(...notes.map(n => n.id));
    localStorage.setItem(PATCH_NOTES_STORAGE_KEY, String(latestId));
    hidePatchNotesBadge();
  } catch (err) {
    console.warn('Could not load patch notes:', err);
  }
}

function showPatchNotesEmptyState() {
  const existing = document.getElementById('patchNotesModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'patchNotesModal';
  modal.className = 'patch-notes-overlay';
  modal.innerHTML = `<div class="patch-notes-modal">
    <div class="patch-notes-modal-header">
      <h2><i aria-hidden="true" class="fas fa-bullhorn"></i> Nyheter</h2>
      <button class="patch-notes-close" id="closePatchNotesBtn" aria-label="Lukk">
        <i aria-hidden="true" class="fas fa-times"></i>
      </button>
    </div>
    <div class="patch-notes-modal-body" style="display:flex;align-items:center;justify-content:center;text-align:center;min-height:200px;">
      <div>
        <i aria-hidden="true" class="fas fa-newspaper" style="font-size:48px;color:var(--color-text-muted, #999);margin-bottom:16px;display:block;"></i>
        <p style="font-size:16px;color:var(--color-text-secondary, #666);margin:0 0 8px;">Ingen nyheter enn\u00e5</p>
        <p style="font-size:13px;color:var(--color-text-muted, #999);margin:0;">Nye funksjoner og oppdateringer vil vises her.</p>
      </div>
    </div>
    <div class="patch-notes-modal-footer">
      <button class="patch-notes-close-btn" id="closePatchNotesFooterBtn">Lukk</button>
    </div>
  </div>`;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#closePatchNotesBtn').addEventListener('click', closeModal);
  modal.querySelector('#closePatchNotesFooterBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
}

function showPatchNotesModal(notes) {
  const existing = document.getElementById('patchNotesModal');
  if (existing) existing.remove();

  const typeLabels = { nytt: 'Nytt', forbedring: 'Forbedring', fiks: 'Fiks' };
  const typeColors = { nytt: '#10b981', forbedring: '#3b82f6', fiks: '#f59e0b' };

  let contentHtml = '';
  for (const note of notes) {
    const dateStr = new Date(note.published_at).toLocaleDateString('nb-NO', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    const itemsHtml = (note.items || []).map(item => {
      const typeLabel = typeLabels[item.type] || item.type;
      const typeColor = typeColors[item.type] || '#666';
      const proBadge = item.visibility === 'full'
        ? '<span class="patch-note-pro-badge">Pro</span>'
        : '';
      const tabLink = item.tab
        ? `<button class="patch-note-tab-link" data-patch-tab="${escapeHtml(item.tab)}">Vis <i aria-hidden="true" class="fas fa-arrow-right"></i></button>`
        : '';
      const descHtml = item.description
        ? `<span class="patch-note-description">${escapeHtml(item.description)}</span>`
        : '';
      return `<li class="patch-note-item">
        <span class="patch-note-type" style="background: ${typeColor};">${escapeHtml(typeLabel)}</span>
        <div class="patch-note-item-content">
          <span class="patch-note-text">${escapeHtml(item.text)}${proBadge}${tabLink}</span>
          ${descHtml}
        </div>
      </li>`;
    }).join('');

    contentHtml += `<div class="patch-note-release">
      <div class="patch-note-release-header">
        <span class="patch-note-version">${escapeHtml(note.version)}</span>
        <span class="patch-note-date">${escapeHtml(dateStr)}</span>
      </div>
      <h3 class="patch-note-title">${escapeHtml(note.title)}</h3>
      ${note.summary ? `<p class="patch-note-summary">${escapeHtml(note.summary)}</p>` : ''}
      <ul class="patch-note-items">${itemsHtml}</ul>
    </div>`;
  }

  const modal = document.createElement('div');
  modal.id = 'patchNotesModal';
  modal.className = 'patch-notes-overlay';
  modal.innerHTML = `<div class="patch-notes-modal">
    <div class="patch-notes-modal-header">
      <h2><i aria-hidden="true" class="fas fa-bullhorn"></i> Nyheter</h2>
      <button class="patch-notes-close" id="closePatchNotesBtn" aria-label="Lukk">
        <i aria-hidden="true" class="fas fa-times"></i>
      </button>
    </div>
    <div class="patch-notes-modal-body">${contentHtml}</div>
    <div class="patch-notes-modal-footer">
      <button class="patch-notes-close-btn" id="closePatchNotesFooterBtn">Lukk</button>
    </div>
  </div>`;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.querySelector('#closePatchNotesBtn').addEventListener('click', closeModal);
  modal.querySelector('#closePatchNotesFooterBtn').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Tab navigation links
  modal.querySelectorAll('.patch-note-tab-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.patchTab;
      closeModal();
      switchToTab(tabName);
    });
  });
}

function showPatchNotesBadge() {
  const badge = document.getElementById('patchNotesBadge');
  if (badge) badge.style.display = '';
}

function hidePatchNotesBadge() {
  const badge = document.getElementById('patchNotesBadge');
  if (badge) badge.style.display = 'none';
}

// ============================================
// BOTTOM TAB BAR
// ============================================

function initBottomTabBar() {
  if (document.getElementById('bottomTabBar')) return;

  document.body.classList.add('has-bottom-tab-bar');

  const hasTodaysWork = hasFeature('todays_work');

  const tabs = [
    { id: 'map', icon: 'fa-map-marker-alt', label: 'Kart', action: 'showMap' },
    { id: 'work', icon: 'fa-briefcase', label: 'Arbeid',
      action: hasTodaysWork ? 'todays-work' : 'weekly-plan' },
    { id: 'calendar', icon: 'fa-calendar-alt', label: 'Kalender', action: 'calendar' },
    { id: 'more', icon: 'fa-ellipsis-h', label: 'Mer', action: 'showMore' }
  ];

  const bar = document.createElement('nav');
  bar.id = 'bottomTabBar';
  bar.className = 'bottom-tab-bar';
  bar.setAttribute('role', 'tablist');

  tabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'bottom-tab-item' + (tab.id === 'map' ? ' active' : '');
    btn.dataset.bottomTab = tab.id;
    btn.dataset.action = tab.action;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-label', tab.label);
    btn.innerHTML = `<i aria-hidden="true" class="fas ${tab.icon}"></i><span>${tab.label}</span>`;

    btn.addEventListener('click', () => handleBottomTabClick(tab));
    bar.appendChild(btn);
  });

  document.body.appendChild(bar);

  // Create More menu (filter sheet is lazy-created on FAB click)
  createMoreMenuOverlay();

  // Create search FAB and selection indicator
  createMobileSearchFab();
  createMobileSelectionFab();

  // Prevent body scroll
  document.body.style.overflow = 'hidden';

  // Initial badge sync
  setTimeout(syncBottomBarBadges, 500);
}

function removeBottomTabBar() {
  document.body.classList.remove('has-bottom-tab-bar');

  const bar = document.getElementById('bottomTabBar');
  if (bar) bar.remove();

  const moreMenu = document.getElementById('moreMenuOverlay');
  if (moreMenu) moreMenu.remove();

  // Move filter panel back
  restoreFilterPanel();

  const filterSheet = document.getElementById('mobileFilterSheet');
  if (filterSheet) filterSheet.remove();

  const searchFab = document.getElementById('mobileSearchFab');
  if (searchFab) searchFab.remove();

  const selectionFab = document.getElementById('mobileSelectionFab');
  if (selectionFab) selectionFab.remove();

  document.body.style.overflow = '';
  moreMenuOpen = false;
  mobileFilterSheetExpanded = false;

  // Restore sidebar for desktop
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.style.display = '';
    sidebar.classList.remove('mobile-open');
  }
}

function handleBottomTabClick(tab) {
  // Update active state
  document.querySelectorAll('.bottom-tab-item').forEach(b =>
    b.classList.toggle('active', b.dataset.bottomTab === tab.id)
  );
  activeBottomTab = tab.id;

  // Hide search FAB when leaving map tab
  const searchFab = document.getElementById('mobileSearchFab');

  if (tab.action === 'showMap') {
    // Close content panel, close more menu, show search FAB
    closeContentPanelMobile();
    closeMoreMenu();
    hideMobileFilterSheet();
    if (searchFab) searchFab.classList.remove('hidden');
  } else if (tab.action === 'showMore') {
    closeContentPanelMobile();
    hideMobileFilterSheet();
    if (searchFab) searchFab.classList.add('hidden');
    toggleMoreMenu();
  } else {
    // Open the corresponding tab in the content panel
    closeMoreMenu();
    hideMobileFilterSheet();
    if (searchFab) searchFab.classList.add('hidden');
    switchToTab(tab.action);
  }
}

function closeContentPanelMobile() {
  const cp = document.getElementById('contentPanel');
  if (cp) {
    cp.classList.add('closed');
    cp.classList.remove('open', 'half-height', 'full-height');
    contentPanelMode = 'closed';
  }
  const overlay = document.getElementById('contentPanelOverlay');
  if (overlay) overlay.classList.remove('visible');
}

// ============================================
// MORE MENU
// ============================================

function createMoreMenuOverlay() {
  if (document.getElementById('moreMenuOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'moreMenuOverlay';
  overlay.className = 'more-menu-overlay';

  const userRole = localStorage.getItem('userRole') || '';
  const userType = localStorage.getItem('userType') || '';
  const isAdmin = userType === 'bruker' || userRole === 'admin';

  const items = [
    { tab: 'dashboard', icon: 'fa-th-large', label: 'Dashboard' },
    { tab: 'customers', icon: 'fa-users', label: 'Kunder' },
    { tab: 'overdue', icon: 'fa-exclamation-triangle', label: 'Forfalte', badgeId: 'overdueBadge' },
    { tab: 'warnings', icon: 'fa-bell', label: 'Kommende', badgeId: 'upcomingBadge' },
    { tab: 'planner', icon: 'fa-route', label: 'Planlegger' },
    { tab: 'statistikk', icon: 'fa-chart-line', label: 'Statistikk' },
    { tab: 'missingdata', icon: 'fa-exclamation-circle', label: 'Mangler data', badgeId: 'missingDataBadge' },
  ];

  if (isAdmin) {
    items.push({ tab: 'admin', icon: 'fa-shield-alt', label: 'Admin' });
  }

  // Add Today's Work to More menu if it's not the primary work tab
  const hasTodaysWork = hasFeature('todays_work');
  if (!hasTodaysWork) {
    const todaysWorkTab = document.getElementById('todaysWorkTab');
    if (todaysWorkTab && todaysWorkTab.style.display !== 'none') {
      items.splice(2, 0, { tab: 'todays-work', icon: 'fa-briefcase', label: 'Dagens arbeid', badgeId: 'todaysWorkBadge' });
    }
  }

  overlay.innerHTML = `
    <div class="more-menu-header">
      <h3>Alle funksjoner</h3>
      <button class="more-menu-close" id="moreMenuCloseBtn" aria-label="Lukk">
        <i aria-hidden="true" class="fas fa-times"></i>
      </button>
    </div>
    <div class="more-menu-grid">
      ${items.map(item => `
        <button class="more-menu-item" data-more-tab="${escapeHtml(item.tab)}">
          <i aria-hidden="true" class="fas ${escapeHtml(item.icon)}"></i>
          <span>${escapeHtml(item.label)}</span>
          ${item.badgeId ? `<span class="more-menu-badge" data-mirror-badge="${escapeHtml(item.badgeId)}" style="display:none;"></span>` : ''}
        </button>
      `).join('')}
      <button class="more-menu-item" id="moreMenuPatchNotes">
        <i aria-hidden="true" class="fas fa-bullhorn"></i>
        <span>Nyheter</span>
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close button
  document.getElementById('moreMenuCloseBtn').addEventListener('click', closeMoreMenu);

  // Item click handlers
  overlay.querySelectorAll('.more-menu-item[data-more-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.moreTab;
      closeMoreMenu();
      // Keep "Mer" highlighted
      document.querySelectorAll('.bottom-tab-item').forEach(b =>
        b.classList.toggle('active', b.dataset.bottomTab === 'more')
      );
      activeBottomTab = 'more';
      hideMobileFilterSheet();
      switchToTab(tabName);
    });
  });

  // Patch notes button in More menu
  document.getElementById('moreMenuPatchNotes')?.addEventListener('click', () => {
    closeMoreMenu();
    loadAndShowPatchNotes(0);
  });
}

function toggleMoreMenu() {
  const overlay = document.getElementById('moreMenuOverlay');
  if (!overlay) return;

  moreMenuOpen = !moreMenuOpen;
  overlay.classList.toggle('open', moreMenuOpen);

  // Sync badges when opening
  if (moreMenuOpen) {
    syncMoreMenuBadges();
  }
}

function closeMoreMenu() {
  const overlay = document.getElementById('moreMenuOverlay');
  if (!overlay) return;

  moreMenuOpen = false;
  overlay.classList.remove('open');
}

// ============================================
// MOBILE FILTER SHEET
// ============================================

function createMobileFilterSheet() {
  if (document.getElementById('mobileFilterSheet')) return;

  const sheet = document.createElement('div');
  sheet.id = 'mobileFilterSheet';
  sheet.className = 'mobile-filter-sheet';

  sheet.innerHTML = `
    <div class="filter-sheet-handle" id="filterSheetHandle">
      <div class="filter-sheet-search-peek">
        <i aria-hidden="true" class="fas fa-search"></i>
        <span>Søk og filtrer kunder</span>
        <span class="filter-sheet-count" id="filterSheetCount">0</span>
        <button class="filter-sheet-close" id="filterSheetClose" aria-label="Lukk">
          <i aria-hidden="true" class="fas fa-times"></i>
        </button>
      </div>
    </div>
    <div class="filter-sheet-content" id="filterSheetContent"></div>
  `;

  document.body.appendChild(sheet);

  // Close button
  const closeBtn = document.getElementById('filterSheetClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideMobileFilterSheet();
    });
  }

  // Handle click/tap - no longer toggles, sheet opens fully via FAB
  const handle = document.getElementById('filterSheetHandle');
  if (handle) {
    // Swipe gestures on filter sheet
    let sheetTouchStartY = 0;
    handle.addEventListener('touchstart', (e) => {
      sheetTouchStartY = e.touches[0].clientY;
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      if (!sheetTouchStartY) return;
      const diff = sheetTouchStartY - e.touches[0].clientY;
      // Swipe down: close filter sheet
      if (diff < -40) {
        e.preventDefault();
        hideMobileFilterSheet();
        sheetTouchStartY = 0;
      }
    }, { passive: false });

    handle.addEventListener('touchend', () => {
      sheetTouchStartY = 0;
    }, { passive: true });
  }
}

function moveFilterPanelToSheet() {
  const filterPanel = document.querySelector('.filter-panel');
  const sheetContent = document.getElementById('filterSheetContent');
  if (filterPanel && sheetContent && !sheetContent.contains(filterPanel)) {
    filterPanel.dataset.originalParent = filterPanel.parentElement?.id || 'map-container';
    sheetContent.appendChild(filterPanel);
    filterPanel.classList.remove('collapsed');
  }
  updateFilterSheetCount();
}

function restoreFilterPanel() {
  const filterPanel = document.querySelector('.filter-panel');
  if (!filterPanel || !filterPanel.dataset.originalParent) return;

  const originalParent = document.getElementById(filterPanel.dataset.originalParent) ||
                         document.querySelector('.map-container');
  if (originalParent) {
    originalParent.appendChild(filterPanel);
    delete filterPanel.dataset.originalParent;
  }
}

function showMobileFilterSheet() {
  let sheet = document.getElementById('mobileFilterSheet');
  // Lazy-create: only build the filter sheet when first needed
  if (!sheet) {
    createMobileFilterSheet();
    moveFilterPanelToSheet();
    sheet = document.getElementById('mobileFilterSheet');
  }
  if (sheet) {
    sheet.style.setProperty('display', 'block', 'important');
    mobileFilterSheetExpanded = true;
    updateFilterSheetCount();
  }
  // Hide search FAB when filter sheet is open
  const searchFab = document.getElementById('mobileSearchFab');
  if (searchFab) searchFab.classList.add('hidden');
}

function hideMobileFilterSheet() {
  const sheet = document.getElementById('mobileFilterSheet');
  if (sheet) {
    sheet.style.setProperty('display', 'none', 'important');
    mobileFilterSheetExpanded = false;
  }
  // Show search FAB when filter sheet is closed (only on map tab)
  if (activeBottomTab === 'map') {
    const searchFab = document.getElementById('mobileSearchFab');
    if (searchFab) searchFab.classList.remove('hidden');
  }
}

function updateFilterSheetCount() {
  const countEl = document.getElementById('filterSheetCount');
  if (countEl && typeof customers !== 'undefined') {
    countEl.textContent = customers.length;
  }
}

// Search FAB - opens filter sheet on tap
function createMobileSearchFab() {
  if (document.getElementById('mobileSearchFab')) return;
  const fab = document.createElement('button');
  fab.id = 'mobileSearchFab';
  fab.className = 'mobile-search-fab';
  fab.setAttribute('aria-label', 'Søk og filtrer kunder');
  fab.innerHTML = '<i aria-hidden="true" class="fas fa-search"></i>';
  fab.addEventListener('click', () => {
    showMobileFilterSheet();
  });
  document.body.appendChild(fab);
}

// Selection FAB - shows count of selected customers
function createMobileSelectionFab() {
  if (document.getElementById('mobileSelectionFab')) return;
  const fab = document.createElement('button');
  fab.id = 'mobileSelectionFab';
  fab.className = 'mobile-selection-fab';
  fab.innerHTML = '<i aria-hidden="true" class="fas fa-check-circle"></i> <span id="mobileSelectionCount">0</span> valgt';
  fab.addEventListener('click', () => {
    // Open planner tab to show selected customers
    switchToTab('planner');
    if (document.getElementById('bottomTabBar')) {
      document.querySelectorAll('.bottom-tab-item').forEach(b =>
        b.classList.toggle('active', b.dataset.bottomTab === 'planner')
      );
      activeBottomTab = 'planner';
    }
  });
  document.body.appendChild(fab);
}

// Update mobile selection indicator visibility
function updateMobileSelectionFab() {
  const fab = document.getElementById('mobileSelectionFab');
  const countEl = document.getElementById('mobileSelectionCount');
  if (!fab || !countEl) return;
  if (selectedCustomers.size > 0) {
    countEl.textContent = selectedCustomers.size;
    fab.classList.add('visible');
  } else {
    fab.classList.remove('visible');
  }
}

// ============================================
// BADGE SYNCHRONIZATION
// ============================================

function syncBottomBarBadges() {
  if (!document.getElementById('bottomTabBar')) return;

  // Work tab badge - mirror from todaysWorkBadge
  const workBtn = document.querySelector('.bottom-tab-item[data-bottom-tab="work"]');
  if (workBtn) {
    const source = document.getElementById('todaysWorkBadge');
    let badge = workBtn.querySelector('.bottom-tab-badge');

    if (source && source.style.display !== 'none' && source.textContent.trim()) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'bottom-tab-badge';
        workBtn.appendChild(badge);
      }
      badge.textContent = source.textContent;
      badge.style.display = '';
    } else if (badge) {
      badge.style.display = 'none';
    }
  }

  // Sync More menu badges
  syncMoreMenuBadges();

  // Update filter sheet count
  updateFilterSheetCount();
}

function syncMoreMenuBadges() {
  document.querySelectorAll('[data-mirror-badge]').forEach(el => {
    const source = document.getElementById(el.dataset.mirrorBadge);
    if (source && source.style.display !== 'none' && source.textContent.trim()) {
      el.textContent = source.textContent;
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });
}

// Hook badge sync into existing update cycles
const badgeIds = ['overdueBadge', 'upcomingBadge', 'todaysWorkBadge', 'missingDataBadge'];

// Use MutationObserver to detect badge changes
function setupBadgeObserver() {
  badgeIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const observer = new MutationObserver(() => {
      syncBottomBarBadges();
    });
    observer.observe(el, { childList: true, attributes: true, attributeFilter: ['style'] });
  });
}

// Delay observer setup until badges exist
setTimeout(setupBadgeObserver, 2000);

function setupMobileInteractions() {
  const sidebar = document.querySelector('.sidebar');
  const sidebarHeader = document.querySelector('.sidebar-header');
  const filterPanel = document.querySelector('.filter-panel');
  const customersTab = document.querySelector('#tab-customers');

  if (!sidebar) return;

  // Remove collapsed class on mobile - we use bottom sheet instead
  sidebar.classList.remove('collapsed');

  // Move filter panel (customer list) into the Kunder tab on mobile
  if (filterPanel && customersTab && !customersTab.contains(filterPanel)) {
    // Store original parent for when switching back to desktop
    filterPanel.dataset.originalParent = 'map-container';
    customersTab.appendChild(filterPanel);
    filterPanel.classList.remove('collapsed');
  }

  // Touch swipe to open/close sidebar
  if (sidebarHeader) {
    sidebarHeader.addEventListener('touchstart', handleTouchStart, { passive: true });
    sidebarHeader.addEventListener('touchmove', handleTouchMove, { passive: false });
    sidebarHeader.addEventListener('touchend', handleTouchEnd, { passive: true });

    // Click to toggle
    sidebarHeader.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // Don't toggle if clicking a button
      toggleMobileSidebar();
    });
  }

  // Close sidebar when clicking on map
  const mapContainer = document.querySelector('.map-container');
  if (mapContainer) {
    mapContainer.addEventListener('click', () => {
      if (sidebarOpen) {
        closeMobileSidebar();
      }
    });
  }

  // Add mobile menu toggle button
  addMobileMenuButton();

  // Prevent body scroll when sidebar is open
  document.body.style.overflow = 'hidden';
}

function removeMobileInteractions() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.classList.remove('mobile-open');
  }

  // Move filter panel back to map container on desktop
  const filterPanel = document.querySelector('.filter-panel');
  const mapContainer = document.querySelector('.map-container');
  if (filterPanel && mapContainer && filterPanel.dataset.originalParent === 'map-container') {
    mapContainer.appendChild(filterPanel);
    delete filterPanel.dataset.originalParent;
  }

  // Remove mobile menu button
  const mobileBtn = document.querySelector('.mobile-menu-toggle');
  if (mobileBtn) {
    mobileBtn.remove();
  }

  document.body.style.overflow = '';
}

function addMobileMenuButton() {
  // Check if already exists
  if (document.querySelector('.mobile-menu-toggle')) return;

  const btn = document.createElement('button');
  btn.className = 'mobile-menu-toggle';
  btn.innerHTML = '<i aria-hidden="true" class="fas fa-bars"></i>';
  btn.setAttribute('aria-label', 'Åpne meny');

  btn.addEventListener('click', () => {
    toggleMobileSidebar();
    btn.classList.toggle('active', sidebarOpen);
    btn.innerHTML = sidebarOpen ? '<i aria-hidden="true" class="fas fa-times"></i>' : '<i aria-hidden="true" class="fas fa-bars"></i>';
  });

  document.body.appendChild(btn);
}

function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle('mobile-open', sidebarOpen);

  // Update button
  const btn = document.querySelector('.mobile-menu-toggle');
  if (btn) {
    btn.classList.toggle('active', sidebarOpen);
    btn.innerHTML = sidebarOpen ? '<i aria-hidden="true" class="fas fa-times"></i>' : '<i aria-hidden="true" class="fas fa-bars"></i>';
  }
}

function closeMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  sidebarOpen = false;
  sidebar.classList.remove('mobile-open');

  const btn = document.querySelector('.mobile-menu-toggle');
  if (btn) {
    btn.classList.remove('active');
    btn.innerHTML = '<i aria-hidden="true" class="fas fa-bars"></i>';
  }
}

function openMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  sidebarOpen = true;
  sidebar.classList.add('mobile-open');

  const btn = document.querySelector('.mobile-menu-toggle');
  if (btn) {
    btn.classList.add('active');
    btn.innerHTML = '<i aria-hidden="true" class="fas fa-times"></i>';
  }
}

// Touch handlers for swipe gestures
function handleTouchStart(e) {
  touchStartY = e.touches[0].clientY;
}

function handleTouchMove(e) {
  if (!touchStartY) return;

  const currentY = e.touches[0].clientY;
  const diff = touchStartY - currentY;

  // If swiping up significantly, open sidebar
  if (diff > 50 && !sidebarOpen) {
    e.preventDefault();
    openMobileSidebar();
    touchStartY = 0;
  }
  // If swiping down significantly, close sidebar
  else if (diff < -50 && sidebarOpen) {
    e.preventDefault();
    closeMobileSidebar();
    touchStartY = 0;
  }
}

function handleTouchEnd() {
  touchStartY = 0;
}

// Initialize mobile UI after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Wait a bit for other initialization
  setTimeout(initMobileUI, 100);
});

// Also handle viewport meta for better mobile experience
function setViewportHeight() {
  // Fix for mobile browsers with dynamic toolbar
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}

setViewportHeight();
window.addEventListener('resize', setViewportHeight);

// Export mobile functions
window.toggleMobileSidebar = toggleMobileSidebar;
window.closeMobileSidebar = closeMobileSidebar;
window.openMobileSidebar = openMobileSidebar;
window.closeMoreMenu = closeMoreMenu;
window.syncBottomBarBadges = syncBottomBarBadges;


// CONTEXT TIPS - First-time user guidance
// ========================================

const contextTips = {
  tips: [
    {
      id: 'map-intro',
      target: '#map',
      title: 'Interaktivt kart',
      message: 'Her ser du alle kundene dine på kartet. Klikk på en markør for å se detaljer.',
      position: 'top',
      icon: 'fa-map-marked-alt'
    },
    {
      id: 'add-customer',
      target: '.customer-add-btn, .add-client-btn, #addClientBtn',
      title: 'Legg til kunder',
      message: 'Klikk her for å legge til din første kunde.',
      position: 'bottom',
      icon: 'fa-user-plus'
    },
    {
      id: 'route-planning',
      target: '.route-btn, #routeBtn, [data-action="route"]',
      title: 'Ruteplanlegging',
      message: 'Planlegg effektive ruter mellom kundene dine.',
      position: 'bottom',
      icon: 'fa-route'
    },
    {
      id: 'calendar',
      target: '.calendar-btn, #calendarBtn, [data-view="calendar"]',
      title: 'Kalender',
      message: 'Hold oversikt over avtaler og oppgaver i kalenderen.',
      position: 'bottom',
      icon: 'fa-calendar-alt'
    }
  ],
  shownTips: [],
  currentTipIndex: 0,
  tipOverlay: null
};

// Initialize context tips
function initContextTips() {
  const stored = localStorage.getItem('shownContextTips');
  if (stored) {
    try {
      contextTips.shownTips = JSON.parse(stored);
    } catch (e) {
      contextTips.shownTips = [];
    }
  }
}

// Show context tips for first-time users
function showContextTips() {
  initContextTips();

  // Filter tips that haven't been shown
  const unshownTips = contextTips.tips.filter(tip => !contextTips.shownTips.includes(tip.id));

  if (unshownTips.length === 0) return;

  // Show first unshown tip after a delay
  setTimeout(() => {
    showTip(unshownTips[0]);
  }, 1000);
}

// Show a single tip
function showTip(tip) {
  const target = document.querySelector(tip.target);
  if (!target) {
    // Target not found, mark as shown and try next
    markTipAsShown(tip.id);
    showNextTip();
    return;
  }

  // Create tip overlay
  const overlay = document.createElement('div');
  overlay.className = 'context-tip-overlay';
  overlay.innerHTML = `
    <div class="context-tip-backdrop" onclick="dismissCurrentTip()"></div>
    <div class="context-tip" id="contextTip-${tip.id}">
      <div class="context-tip-arrow"></div>
      <div class="context-tip-icon">
        <i aria-hidden="true" class="fas ${tip.icon}"></i>
      </div>
      <div class="context-tip-content">
        <h4>${escapeHtml(tip.title)}</h4>
        <p>${escapeHtml(tip.message)}</p>
      </div>
      <div class="context-tip-actions">
        <button class="context-tip-btn context-tip-btn-skip" onclick="skipAllTips()">
          Hopp over alle
        </button>
        <button class="context-tip-btn context-tip-btn-next" onclick="dismissCurrentTip()">
          Forstått <i aria-hidden="true" class="fas fa-check"></i>
        </button>
      </div>
      <div class="context-tip-progress">
        ${contextTips.currentTipIndex + 1} av ${contextTips.tips.length - contextTips.shownTips.length}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  contextTips.tipOverlay = overlay;

  // Position the tip near the target
  positionTip(overlay.querySelector('.context-tip'), target, tip.position);

  // Highlight target
  target.classList.add('context-tip-highlight');

  // Animate in
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
  });
}

// Position tip relative to target
function positionTip(tipElement, target, position) {
  const targetRect = target.getBoundingClientRect();
  const tipRect = tipElement.getBoundingClientRect();

  let top, left;
  const margin = 12;

  switch (position) {
    case 'top':
      top = targetRect.top - tipRect.height - margin;
      left = targetRect.left + (targetRect.width / 2) - (tipRect.width / 2);
      tipElement.classList.add('position-top');
      break;
    case 'bottom':
      top = targetRect.bottom + margin;
      left = targetRect.left + (targetRect.width / 2) - (tipRect.width / 2);
      tipElement.classList.add('position-bottom');
      break;
    case 'left':
      top = targetRect.top + (targetRect.height / 2) - (tipRect.height / 2);
      left = targetRect.left - tipRect.width - margin;
      tipElement.classList.add('position-left');
      break;
    case 'right':
      top = targetRect.top + (targetRect.height / 2) - (tipRect.height / 2);
      left = targetRect.right + margin;
      tipElement.classList.add('position-right');
      break;
    default:
      top = targetRect.bottom + margin;
      left = targetRect.left;
  }

  // Keep within viewport
  left = Math.max(16, Math.min(left, window.innerWidth - tipRect.width - 16));
  top = Math.max(16, Math.min(top, window.innerHeight - tipRect.height - 16));

  tipElement.style.position = 'fixed';
  tipElement.style.top = `${top}px`;
  tipElement.style.left = `${left}px`;
}

// Mark tip as shown
function markTipAsShown(tipId) {
  if (!contextTips.shownTips.includes(tipId)) {
    contextTips.shownTips.push(tipId);
    localStorage.setItem('shownContextTips', JSON.stringify(contextTips.shownTips));
  }
}

// Dismiss current tip and show next
function dismissCurrentTip() {
  const unshownTips = contextTips.tips.filter(tip => !contextTips.shownTips.includes(tip.id));

  if (unshownTips.length > 0) {
    markTipAsShown(unshownTips[0].id);
  }

  // Remove highlight from all elements
  document.querySelectorAll('.context-tip-highlight').forEach(el => {
    el.classList.remove('context-tip-highlight');
  });

  // Remove overlay
  if (contextTips.tipOverlay) {
    contextTips.tipOverlay.classList.remove('visible');
    setTimeout(() => {
      contextTips.tipOverlay.remove();
      contextTips.tipOverlay = null;
      showNextTip();
    }, 300);
  }
}

// Show next tip
function showNextTip() {
  contextTips.currentTipIndex++;
  const unshownTips = contextTips.tips.filter(tip => !contextTips.shownTips.includes(tip.id));

  if (unshownTips.length > 0) {
    setTimeout(() => showTip(unshownTips[0]), 500);
  }
}

// Skip all tips
function skipAllTips() {
  contextTips.tips.forEach(tip => {
    markTipAsShown(tip.id);
  });

  // Remove highlight from all elements
  document.querySelectorAll('.context-tip-highlight').forEach(el => {
    el.classList.remove('context-tip-highlight');
  });

  if (contextTips.tipOverlay) {
    contextTips.tipOverlay.classList.remove('visible');
    setTimeout(() => {
      contextTips.tipOverlay.remove();
      contextTips.tipOverlay = null;
    }, 300);
  }
}

// Reset context tips (for testing)
function resetContextTips() {
  contextTips.shownTips = [];
  contextTips.currentTipIndex = 0;
  localStorage.removeItem('shownContextTips');
}


// Render markers on map — Mapbox GL JS version
let renderMarkersRetryCount = 0;
const MAX_RENDER_RETRIES = 30;

function renderMarkers(customerData) {
  // Don't render markers if still on login view
  if (currentView === 'login') {
    Logger.log('renderMarkers skipped - still on login view');
    renderMarkersRetryCount = 0;
    return;
  }

  // Safety check - cluster manager must be initialized
  // If not ready, wait — initClusterManager will call applyFilters() when done
  if (!_clusterSourceReady) {
    if (renderMarkersRetryCount >= MAX_RENDER_RETRIES) {
      console.error('renderMarkers: cluster manager never initialized after', MAX_RENDER_RETRIES, 'retries');
      renderMarkersRetryCount = 0;
      return;
    }
    renderMarkersRetryCount++;
    setTimeout(() => renderMarkers(customerData), 200);
    return;
  }

  renderMarkersRetryCount = 0;

  // Clear existing markers
  for (const [id, marker] of Object.entries(markers)) {
    marker.remove();
  }
  // Clear cluster markers
  for (const [key, marker] of clusterMarkers) {
    marker.remove();
  }
  clusterMarkers.clear();
  markers = {};

  // Log what we're rendering
  const kategorier = {};
  customerData.forEach(c => {
    const kat = c.kategori || 'null';
    kategorier[kat] = (kategorier[kat] || 0) + 1;
  });
  Logger.log('renderMarkers:', customerData.length, 'kunder', kategorier);

  customerData.forEach(customer => {
    if (customer.lat && customer.lng) {
      const isSelected = selectedCustomers.has(customer.id);
      const controlStatus = getControlStatus(customer);

      // Create marker with simplified label
      const shortName = customer.navn.length > 20 ? customer.navn.substring(0, 18) + '...' : customer.navn;

      // Show warning icon for urgent statuses
      const showWarning = controlStatus.status === 'forfalt' || controlStatus.status === 'denne-uke' || controlStatus.status === 'snart';
      const warningBadge = showWarning ? '<span class="marker-warning-badge">!</span>' : '';

      // Determine category icon dynamically from ServiceTypeRegistry
      let categoryIcon, categoryClass;
      const serviceTypes = serviceTypeRegistry.getAll();
      if (customer.kategori && serviceTypes.length > 0) {
        categoryIcon = serviceTypeRegistry.getIconForCategory(customer.kategori);
        categoryClass = serviceTypeRegistry.getCategoryClass(customer.kategori);
      } else if (serviceTypes.length > 0) {
        const defaultSt = serviceTypeRegistry.getDefaultServiceType();
        categoryIcon = serviceTypeRegistry.getIconForCategory(defaultSt.name);
        categoryClass = serviceTypeRegistry.getCategoryClass(defaultSt.name);
      } else {
        categoryIcon = `<span class="marker-svg-icon">${svgIcons['service']}</span>`;
        categoryClass = 'service';
      }

      // Create DOM element for marker (replaces L.divIcon)
      const el = document.createElement('div');
      el.className = `custom-marker-with-label ${isSelected ? 'selected' : ''} ${controlStatus.class}`;
      el.innerHTML = `
        <div class="marker-icon ${categoryClass} ${controlStatus.class}" data-status="${controlStatus.status}">
          ${categoryIcon}
          ${warningBadge}
        </div>
        <div class="marker-label">
          <span class="marker-name">${escapeHtml(shortName)}</span>
        </div>
      `;
      el.dataset.customerId = String(customer.id);

      // Create Mapbox GL JS marker
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([customer.lng, customer.lat]);

      // Store customer data on marker for cluster access
      marker._customerData = {
        id: customer.id,
        poststed: customer.poststed,
        hasWarning: showWarning
      };
      marker._addedToMap = false;

      // Click — open popup
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        showMapPopup(
          [customer.lng, customer.lat],
          generatePopupContent(customer),
          { maxWidth: '350px', offset: [0, -35] }
        );
      });

      // Context menu (right-click)
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showMarkerContextMenu(customer, ev.clientX, ev.clientY);
      });

      // Long-press for mobile (500ms threshold)
      let longPressTimer = null;
      el.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          const touch = e.touches[0];
          if (touch) {
            showMarkerContextMenu(customer, touch.clientX, touch.clientY);
          }
        }, 500);
      }, { passive: true });
      el.addEventListener('touchend', () => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      });
      el.addEventListener('touchmove', () => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      });

      // Hover tooltip (PC only)
      if (hasFeature('hover_tooltip')) {
        el.addEventListener('mouseenter', (ev) => {
          if (window.innerWidth > 768 && !currentPopup) {
            showMarkerTooltip(customer, el, ev);
          }
        });
        el.addEventListener('mouseleave', () => {
          // Delay hide to allow moving mouse to tooltip actions
          setTimeout(() => {
            if (activeTooltipEl && !activeTooltipEl._hovered) {
              hideMarkerTooltip();
            }
          }, 100);
        });
      }

      // Drag-to-weekplan: custom drag with mousedown
      el.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        const startX = ev.clientX;
        const startY = ev.clientY;
        let isDragging = false;
        let dragTimeout = null;

        dragTimeout = setTimeout(() => {
          isDragging = true;
          map.dragPan.disable();
          startMarkerDrag(customer.id, startX, startY);
        }, 300);

        const onMouseMove = (moveEv) => {
          if (!isDragging) {
            const dist = Math.abs(moveEv.clientX - startX) + Math.abs(moveEv.clientY - startY);
            if (dist > 10) {
              clearTimeout(dragTimeout);
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
            }
            return;
          }
          updateMarkerDrag(moveEv.clientX, moveEv.clientY);
        };

        const onMouseUp = () => {
          clearTimeout(dragTimeout);
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          if (isDragging) {
            endMarkerDrag(customer.id);
            map.dragPan.enable();
          }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      markers[customer.id] = marker;
    }
  });

  // Load data into Supercluster and render
  loadClusterData(customerData);
  updateClusters();

  Logger.log('renderMarkers: Created', Object.keys(markers).length, 'markers with Supercluster clustering');

  // Re-apply presence badges after markers are in DOM
  if (presenceClaims.size > 0) {
    setTimeout(updatePresenceBadges, 200);
  }
}

// Focus on customer on map
function focusOnCustomer(customerId) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;

  // On mobile: close content panel and switch to map view
  if (isMobile && document.getElementById('bottomTabBar')) {
    closeContentPanelMobile();
    hideMobileFilterSheet();
    document.querySelectorAll('.bottom-tab-item').forEach(b =>
      b.classList.toggle('active', b.dataset.bottomTab === 'map')
    );
    activeBottomTab = 'map';
    const searchFab = document.getElementById('mobileSearchFab');
    if (searchFab) searchFab.classList.remove('hidden');
  }

  if (customer.lat && customer.lng) {
    const delay = isMobile ? 150 : 0;
    setTimeout(() => {
      map.resize();
      map.flyTo({ center: [customer.lng, customer.lat], zoom: 14, duration: 1000 });

      // Open popup after fly animation
      setTimeout(() => {
        showMapPopup(
          [customer.lng, customer.lat],
          generatePopupContent(customer),
          { maxWidth: '350px', offset: [0, -35] }
        );
      }, 1100);
    }, delay);
  } else {
    showNotification(`${customer.navn} mangler koordinater - bruk geokoding`);
  }
}

// Toggle customer selection
function toggleCustomerSelection(customerId) {
  if (selectedCustomers.has(customerId)) {
    selectedCustomers.delete(customerId);
  } else {
    selectedCustomers.add(customerId);
  }
  updateSelectionUI();
}

// Update UI based on selection
function updateSelectionUI() {
  if (selectedCount) selectedCount.textContent = selectedCustomers.size;
  if (planRouteBtn) planRouteBtn.disabled = selectedCustomers.size < 2;
  if (clearSelectionBtn) clearSelectionBtn.disabled = selectedCustomers.size === 0;

  // Update mobile FAB visibility
  const mobileRouteFab = document.getElementById('mobileRouteBtn');
  const mobileRouteCount = document.getElementById('mobileRouteCount');
  if (mobileRouteFab && mobileRouteCount) {
    if (selectedCustomers.size >= 2) {
      mobileRouteFab.classList.remove('hidden');
      mobileRouteCount.textContent = selectedCustomers.size;
    } else {
      mobileRouteFab.classList.add('hidden');
    }
  }

  // Update mobile selection indicator
  updateMobileSelectionFab();

  // Update list items
  document.querySelectorAll('.customer-item').forEach(item => {
    const id = Number.parseInt(item.dataset.id);
    item.classList.toggle('selected', selectedCustomers.has(id));
  });

  // Update marker selection styles without full re-render
  updateMarkerSelectionStyles();
}

// Update selection CSS on existing markers
function updateMarkerSelectionStyles() {
  for (const [id, marker] of Object.entries(markers)) {
    const el = marker.getElement();
    if (!el) continue;
    const customerId = Number.parseInt(id);
    const isSelected = selectedCustomers.has(customerId);
    el.classList.toggle('selected', isSelected);
    const iconDiv = el.querySelector('.marker-icon');
    if (iconDiv) iconDiv.classList.toggle('selected', isSelected);
  }
}

// Update route selection UI after programmatic selection changes
function updateRouteSelection() {
  updateSelectionUI();
}

// Clear selection
function clearSelection() {
  selectedCustomers.clear();
  updateSelectionUI();
  clearRoute();
}


// ===== QUICK MARK VISITED + SEARCH FILTER =====

// Quick mark a single customer as visited from map popup
async function quickMarkVisited(customerId) {
  const customer = customers.find(c => c.id === customerId);
  const serviceTypes = serviceTypeRegistry.getAll();
  const today = new Date().toISOString().split('T')[0];

  // Build service type checkboxes
  const checkboxesHtml = serviceTypes.map(st => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:15px;color:var(--color-text-primary,#fff);cursor:pointer;">
      <input type="checkbox" class="qmv-kontroll-cb" data-slug="${escapeHtml(st.slug)}" checked
        style="width:20px;height:20px;accent-color:${escapeHtml(st.color || '#5E81AC')};">
      <i aria-hidden="true" class="fas ${escapeHtml(st.icon || 'fa-clipboard-check')}" style="color:${escapeHtml(st.color || '#5E81AC')};"></i>
      ${escapeHtml(st.name)}
    </label>
  `).join('');

  // Create dialog overlay
  const overlay = document.createElement('div');
  overlay.className = 'qmv-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:100001;display:flex;justify-content:center;align-items:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--color-bg-secondary,#1a1a1a);border-radius:16px;max-width:400px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid var(--color-border,#333);">
      <h3 style="margin:0 0 16px;font-size:18px;color:var(--color-text-primary,#fff);">
        Marker besøkt: ${escapeHtml(customer?.navn || 'Kunde')}
      </h3>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:13px;color:var(--color-text-secondary,#a0a0a0);margin-bottom:6px;">Dato for besøk</label>
        <input type="${appConfig.datoModus === 'month_year' ? 'month' : 'date'}" id="qmvDate" value="${appConfig.datoModus === 'month_year' ? today.substring(0, 7) : today}" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--color-border,#333);background:var(--color-bg-tertiary,#252525);color:var(--color-text-primary,#fff);font-size:15px;">
      </div>
      ${serviceTypes.length > 0 ? `
        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:13px;color:var(--color-text-secondary,#a0a0a0);margin-bottom:6px;">Oppdater kontrolldatoer</label>
          ${checkboxesHtml}
        </div>
      ` : ''}
      <div style="display:flex;gap:12px;justify-content:flex-end;">
        <button id="qmvCancel" style="padding:12px 24px;font-size:15px;font-weight:600;border-radius:10px;border:1px solid var(--color-border,#333);background:var(--color-bg-tertiary,#252525);color:var(--color-text-primary,#fff);cursor:pointer;">Avbryt</button>
        <button id="qmvConfirm" style="padding:12px 24px;font-size:15px;font-weight:600;border-radius:10px;border:none;background:var(--color-accent,#5E81AC);color:#fff;cursor:pointer;">Marker besøkt</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on escape or overlay click
  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', escHandler); overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', escHandler);

  overlay.querySelector('#qmvCancel').addEventListener('click', close);
  overlay.querySelector('#qmvConfirm').addEventListener('click', async () => {
    const confirmBtn = overlay.querySelector('#qmvConfirm');
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Oppdaterer...';

    const dateValue = normalizeDateValue(document.getElementById('qmvDate').value);
    const selectedSlugs = Array.from(overlay.querySelectorAll('.qmv-kontroll-cb:checked')).map(cb => cb.dataset.slug);

    close();

    try {
      const response = await apiFetch('/api/kunder/mark-visited', {
        method: 'POST',
        body: JSON.stringify({
          kunde_ids: [customerId],
          visited_date: dateValue,
          service_type_slugs: selectedSlugs
        })
      });

      const result = await response.json();
      if (response.ok && result.success) {
        const msg = selectedSlugs.length > 0
          ? `${escapeHtml(customer?.navn || 'Kunde')} markert som besøkt (kontrolldatoer oppdatert)`
          : `${escapeHtml(customer?.navn || 'Kunde')} markert som besøkt`;
        showNotification(msg);
        await loadCustomers();
      } else {
        showNotification(typeof result.error === 'string' ? result.error : 'Kunne ikke markere som besøkt', 'error');
      }
    } catch (error) {
      console.error('Feil ved rask avhuking:', error);
      showNotification('Feil ved oppdatering', 'error');
    }
  });
}

// Bulk mark visited for multiple customers (used by area-select)
async function bulkMarkVisited(customerIds) {
  const serviceTypes = serviceTypeRegistry.getAll();
  const today = new Date().toISOString().split('T')[0];
  const count = customerIds.length;

  const checkboxesHtml = serviceTypes.map(st => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:15px;color:var(--color-text-primary,#fff);cursor:pointer;">
      <input type="checkbox" class="bmv-kontroll-cb" data-slug="${escapeHtml(st.slug)}" checked
        style="width:20px;height:20px;accent-color:${escapeHtml(st.color || '#5E81AC')};">
      <i aria-hidden="true" class="fas ${escapeHtml(st.icon || 'fa-clipboard-check')}" style="color:${escapeHtml(st.color || '#5E81AC')};"></i>
      ${escapeHtml(st.name)}
    </label>
  `).join('');

  const overlay = document.createElement('div');
  overlay.className = 'qmv-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:100001;display:flex;justify-content:center;align-items:center;padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--color-bg-secondary,#1a1a1a);border-radius:16px;max-width:400px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,0.5);border:1px solid var(--color-border,#333);">
      <h3 style="margin:0 0 16px;font-size:18px;color:var(--color-text-primary,#fff);">
        Marker ${count} kunder som besøkt
      </h3>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:13px;color:var(--color-text-secondary,#a0a0a0);margin-bottom:6px;">Dato for besøk</label>
        <input type="${appConfig.datoModus === 'month_year' ? 'month' : 'date'}" id="bmvDate" value="${appConfig.datoModus === 'month_year' ? today.substring(0, 7) : today}" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--color-border,#333);background:var(--color-bg-tertiary,#252525);color:var(--color-text-primary,#fff);font-size:15px;">
      </div>
      ${serviceTypes.length > 0 ? `
        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:13px;color:var(--color-text-secondary,#a0a0a0);margin-bottom:6px;">Oppdater kontrolldatoer</label>
          ${checkboxesHtml}
        </div>
      ` : ''}
      <div style="display:flex;gap:12px;justify-content:flex-end;">
        <button id="bmvCancel" style="padding:12px 24px;font-size:15px;font-weight:600;border-radius:10px;border:1px solid var(--color-border,#333);background:var(--color-bg-tertiary,#252525);color:var(--color-text-primary,#fff);cursor:pointer;">Avbryt</button>
        <button id="bmvConfirm" style="padding:12px 24px;font-size:15px;font-weight:600;border-radius:10px;border:none;background:var(--color-accent,#5E81AC);color:#fff;cursor:pointer;">Marker besøkt</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const escHandler = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', escHandler); overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', escHandler);

  overlay.querySelector('#bmvCancel').addEventListener('click', close);
  overlay.querySelector('#bmvConfirm').addEventListener('click', async () => {
    const confirmBtn = overlay.querySelector('#bmvConfirm');
    if (confirmBtn.disabled) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Oppdaterer...';

    const dateValue = normalizeDateValue(document.getElementById('bmvDate').value);
    const selectedSlugs = Array.from(overlay.querySelectorAll('.bmv-kontroll-cb:checked')).map(cb => cb.dataset.slug);

    close();

    try {
      const response = await apiFetch('/api/kunder/mark-visited', {
        method: 'POST',
        body: JSON.stringify({
          kunde_ids: customerIds,
          visited_date: dateValue,
          service_type_slugs: selectedSlugs
        })
      });

      const result = await response.json();
      if (response.ok && result.success) {
        showNotification(`${result.data.updated} kunder markert som besøkt`);
        await loadCustomers();
      } else {
        showNotification(typeof result.error === 'string' ? result.error : 'Kunne ikke markere som besøkt', 'error');
      }
    } catch (error) {
      console.error('Feil ved bulk avhuking:', error);
      showNotification('Feil ved oppdatering', 'error');
    }
  });
}

// Make functions globally available
window.quickMarkVisited = quickMarkVisited;
window.bulkMarkVisited = bulkMarkVisited;

// Search/filter customers
function filterCustomers() {
  applyFilters();
}


async function geocodeAddress(address, postnummer, poststed) {
  const query = `${address || ''}, ${postnummer || ''} ${poststed || ''}`.trim();

  try {
    const response = await apiFetch('/api/geocode/forward', {
      method: 'POST',
      body: JSON.stringify({ query, limit: 1 })
    });

    if (response.ok) {
      const result = await response.json();
      const suggestion = result.data?.suggestions?.[0];
      if (suggestion) {
        return {
          lat: suggestion.lat,
          lng: suggestion.lng,
          formatted: `${suggestion.adresse}, ${suggestion.postnummer} ${suggestion.poststed}`.trim()
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Geocoding feil:', error);
    return null;
  }
}

// ============================================
// Address Autocomplete & Postnummer Lookup
// ============================================

// Debounce utility function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// AbortController for canceling in-flight address searches
let addressSearchController = null;

// Client-side cache for address search results
const _addressSearchCache = new Map();
const _ADDRESS_CACHE_MAX = 50;
const _ADDRESS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedAddressSearch(key) {
  const entry = _addressSearchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > _ADDRESS_CACHE_TTL) {
    _addressSearchCache.delete(key);
    return null;
  }
  return entry.results;
}

function setCachedAddressSearch(key, results) {
  if (_addressSearchCache.size >= _ADDRESS_CACHE_MAX) {
    const firstKey = _addressSearchCache.keys().next().value;
    if (firstKey) _addressSearchCache.delete(firstKey);
  }
  _addressSearchCache.set(key, { results, ts: Date.now() });
}

// Parse Kartverket response into suggestion objects
function parseKartverketResults(data) {
  if (!data.adresser || data.adresser.length === 0) return [];
  return data.adresser
    .filter(addr => addr.representasjonspunkt)
    .map(addr => ({
      adresse: addr.adressetekst || '',
      postnummer: addr.postnummer || '',
      poststed: addr.poststed || '',
      lat: addr.representasjonspunkt.lat,
      lng: addr.representasjonspunkt.lon,
      kommune: addr.kommunenavn || ''
    }));
}

// Search addresses directly via Kartverket API (fast, public, no backend round-trip)
// Falls back to backend proxy (Mapbox) if Kartverket fails
async function searchAddresses(query) {
  if (!query || query.length < 2) return [];

  // Check client-side cache first
  const cacheKey = query.trim().toLowerCase();
  const cached = getCachedAddressSearch(cacheKey);
  if (cached) return cached;

  // Cancel any in-flight request to prevent stale results
  if (addressSearchController) {
    addressSearchController.abort();
  }
  addressSearchController = new AbortController();
  const signal = addressSearchController.signal;

  const encoded = encodeURIComponent(query.trim());

  // Try Kartverket exact search first (very fast, no fuzzy)
  try {
    const response = await fetch(
      `https://ws.geonorge.no/adresser/v1/sok?sok=${encoded}&treffPerSide=5`,
      { signal }
    );
    if (response.ok) {
      const results = parseKartverketResults(await response.json());
      if (results.length > 0) {
        setCachedAddressSearch(cacheKey, results);
        return results;
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') return [];
  }

  // Fallback: Kartverket with fuzzy (slower but catches typos)
  try {
    const response = await fetch(
      `https://ws.geonorge.no/adresser/v1/sok?sok=${encoded}&fuzzy=true&treffPerSide=5`,
      { signal }
    );
    if (response.ok) {
      const results = parseKartverketResults(await response.json());
      if (results.length > 0) {
        setCachedAddressSearch(cacheKey, results);
        return results;
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') return [];
  }

  // Last resort: backend proxy (Mapbox)
  try {
    const proximity = map ? [map.getCenter().lng, map.getCenter().lat] : undefined;
    const response = await apiFetch('/api/geocode/forward', {
      method: 'POST',
      body: JSON.stringify({ query, limit: 5, proximity }),
      signal
    });
    if (!response.ok) return [];
    const result = await response.json();
    const suggestions = (result.data?.suggestions || []).map(s => ({
      adresse: s.adresse,
      postnummer: s.postnummer,
      poststed: s.poststed,
      lat: s.lat,
      lng: s.lng,
      kommune: s.kommune || ''
    }));
    if (suggestions.length > 0) {
      setCachedAddressSearch(cacheKey, suggestions);
    }
    return suggestions;
  } catch (error) {
    if (error.name === 'AbortError') return [];
    return [];
  }
}

// Lookup postal code using Bring API
async function lookupPostnummer(postnummer) {
  if (!/^\d{4}$/.test(postnummer)) return null;

  try {
    const url = `https://api.bring.com/shippingguide/api/postalCode.json?clientUrl=elkontroll&country=NO&pnr=${postnummer}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.valid) {
      return data.result;
    }
    return null;
  } catch (error) {
    console.error('Postnummer-oppslag feilet:', error);
    return null;
  }
}

// Position the address suggestions dropdown relative to the input (fixed positioning)
function positionAddressSuggestions() {
  const container = document.getElementById('addressSuggestions');
  const adresseInput = document.getElementById('adresse');
  if (!container || !adresseInput) return;

  const rect = adresseInput.getBoundingClientRect();
  container.style.top = `${rect.bottom}px`;
  container.style.left = `${rect.left}px`;
  container.style.width = `${rect.width}px`;
}

// Render address suggestions dropdown
function renderAddressSuggestions(results) {
  const container = document.getElementById('addressSuggestions');
  if (!container) return;

  const adresseInput = document.getElementById('adresse');

  if (!results || results.length === 0) {
    container.innerHTML = '';
    container.classList.remove('visible');
    if (adresseInput) adresseInput.setAttribute('aria-expanded', 'false');
    return;
  }

  container.setAttribute('role', 'listbox');

  container.innerHTML = results.map((addr, index) => `
    <div class="address-suggestion-item" role="option" data-index="${index}">
      <i aria-hidden="true" class="fas fa-map-marker-alt"></i>
      <div class="address-suggestion-text">
        <div class="address-suggestion-main">${escapeHtml(addr.adresse)}</div>
        <div class="address-suggestion-detail">${escapeHtml(addr.postnummer)} ${escapeHtml(addr.poststed)}${addr.kommune ? `, ${escapeHtml(addr.kommune)}` : ''}</div>
      </div>
    </div>
  `).join('');

  // Position dropdown below the input using fixed positioning
  positionAddressSuggestions();

  container.classList.add('visible');
  if (adresseInput) adresseInput.setAttribute('aria-expanded', 'true');
}

// Select an address suggestion and fill form fields
function selectAddressSuggestion(suggestion) {
  const adresseInput = document.getElementById('adresse');
  const postnummerInput = document.getElementById('postnummer');
  const poststedInput = document.getElementById('poststed');
  const latInput = document.getElementById('lat');
  const lngInput = document.getElementById('lng');
  const suggestionsContainer = document.getElementById('addressSuggestions');

  if (adresseInput) adresseInput.value = suggestion.adresse;
  if (postnummerInput) postnummerInput.value = suggestion.postnummer;
  if (poststedInput) {
    poststedInput.value = suggestion.poststed;
    poststedInput.classList.add('auto-filled');
  }
  if (latInput) latInput.value = suggestion.lat.toFixed(6);
  if (lngInput) lngInput.value = suggestion.lng.toFixed(6);

  // Update geocode quality badge
  updateGeocodeQualityBadge('exact');

  // Hide suggestions
  if (suggestionsContainer) {
    suggestionsContainer.classList.remove('visible');
  }
  if (adresseInput) adresseInput.setAttribute('aria-expanded', 'false');

  // Update postnummer status
  updatePostnummerStatus('valid');

  showNotification(`Adresse valgt: ${suggestion.adresse}, ${suggestion.postnummer} ${suggestion.poststed}`);
}

// Update postnummer status indicator
function updatePostnummerStatus(status) {
  const statusEl = document.getElementById('postnummerStatus');
  if (!statusEl) return;

  statusEl.className = 'postnummer-status';

  switch (status) {
    case 'valid':
      statusEl.innerHTML = '<i aria-hidden="true" class="fas fa-check"></i>';
      statusEl.classList.add('valid');
      break;
    case 'invalid':
      statusEl.innerHTML = '<i aria-hidden="true" class="fas fa-times"></i>';
      statusEl.classList.add('invalid');
      break;
    case 'loading':
      statusEl.innerHTML = '<i aria-hidden="true" class="fas fa-spinner fa-spin"></i>';
      statusEl.classList.add('loading');
      break;
    default:
      statusEl.innerHTML = '';
  }
}

// Address autocomplete state
let addressSuggestions = [];
let selectedSuggestionIndex = -1;

// Reset autocomplete state (call when opening/closing customer modal)
function resetAddressAutocomplete() {
  addressSuggestions = [];
  selectedSuggestionIndex = -1;
  if (addressSearchController) {
    addressSearchController.abort();
    addressSearchController = null;
  }
  const container = document.getElementById('addressSuggestions');
  if (container) {
    container.innerHTML = '';
    container.classList.remove('visible');
  }
  const adresseInput = document.getElementById('adresse');
  if (adresseInput) adresseInput.setAttribute('aria-expanded', 'false');
}

// Setup address autocomplete functionality
function setupAddressAutocomplete() {
  const adresseInput = document.getElementById('adresse');
  const postnummerInput = document.getElementById('postnummer');
  const poststedInput = document.getElementById('poststed');
  const suggestionsContainer = document.getElementById('addressSuggestions');

  if (!adresseInput || !suggestionsContainer) return;

  // ARIA combobox attributes for accessibility
  adresseInput.setAttribute('role', 'combobox');
  adresseInput.setAttribute('aria-autocomplete', 'list');
  adresseInput.setAttribute('aria-expanded', 'false');
  adresseInput.setAttribute('aria-controls', 'addressSuggestions');

  // Show loading state in dropdown
  function showSearchLoading() {
    suggestionsContainer.innerHTML = `
      <div class="address-suggestion-item" style="justify-content:center;opacity:0.6;pointer-events:none;">
        <i aria-hidden="true" class="fas fa-spinner fa-spin"></i>
        <span>Søker...</span>
      </div>`;
    positionAddressSuggestions();
    suggestionsContainer.classList.add('visible');
    adresseInput.setAttribute('aria-expanded', 'true');
  }

  // Debounced search function
  const debouncedSearch = debounce(async (query) => {
    if (query.length < 2) {
      suggestionsContainer.classList.remove('visible');
      adresseInput.setAttribute('aria-expanded', 'false');
      return;
    }

    addressSuggestions = await searchAddresses(query);
    selectedSuggestionIndex = -1;
    renderAddressSuggestions(addressSuggestions);
  }, 150);

  // Input event for address search
  adresseInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (val.length >= 2) showSearchLoading();
    debouncedSearch(val);
  });

  // Keyboard navigation
  adresseInput.addEventListener('keydown', (e) => {
    if (!suggestionsContainer.classList.contains('visible')) return;

    const items = suggestionsContainer.querySelectorAll('.address-suggestion-item');

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
        updateSelectedSuggestion(items);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
        updateSelectedSuggestion(items);
        break;
      case 'Enter':
        if (selectedSuggestionIndex >= 0 && addressSuggestions[selectedSuggestionIndex]) {
          e.preventDefault();
          selectAddressSuggestion(addressSuggestions[selectedSuggestionIndex]);
        }
        break;
      case 'Escape':
        suggestionsContainer.classList.remove('visible');
        adresseInput.setAttribute('aria-expanded', 'false');
        selectedSuggestionIndex = -1;
        break;
    }
  });

  // Click on suggestion
  suggestionsContainer.addEventListener('click', (e) => {
    const item = e.target.closest('.address-suggestion-item');
    if (item) {
      const index = parseInt(item.dataset.index, 10);
      if (addressSuggestions[index]) {
        selectAddressSuggestion(addressSuggestions[index]);
      }
    }
  });

  // Hide suggestions when clicking outside (check both wrapper and fixed dropdown)
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.address-autocomplete-wrapper') && !e.target.closest('.address-suggestions')) {
      suggestionsContainer.classList.remove('visible');
      adresseInput.setAttribute('aria-expanded', 'false');
    }
  });

  // Reposition or hide dropdown on modal scroll
  const modalContent = adresseInput.closest('.modal-content');
  if (modalContent) {
    modalContent.addEventListener('scroll', () => {
      if (suggestionsContainer.classList.contains('visible')) {
        // Hide if input scrolled out of view
        const rect = adresseInput.getBoundingClientRect();
        const modalRect = modalContent.getBoundingClientRect();
        if (rect.bottom < modalRect.top || rect.top > modalRect.bottom) {
          suggestionsContainer.classList.remove('visible');
          adresseInput.setAttribute('aria-expanded', 'false');
        } else {
          positionAddressSuggestions();
        }
      }
    });
  }

  // Postnummer auto-lookup
  if (postnummerInput && poststedInput) {
    postnummerInput.addEventListener('input', async (e) => {
      const value = e.target.value.replace(/\D/g, '').slice(0, 4);
      e.target.value = value;

      // Remove auto-filled class from poststed when user edits postnummer
      poststedInput.classList.remove('auto-filled');
      updatePostnummerStatus('');

      if (value.length === 4) {
        const valueAtRequest = value;
        updatePostnummerStatus('loading');
        const result = await lookupPostnummer(value);

        // Only update if postnummer hasn't changed while we were fetching
        if (postnummerInput.value === valueAtRequest && result) {
          // Only auto-fill poststed if user hasn't manually typed something
          if (!poststedInput.value || poststedInput.classList.contains('auto-filled')) {
            poststedInput.value = result;
            poststedInput.classList.add('auto-filled');
          }
          updatePostnummerStatus('valid');
        } else if (postnummerInput.value === valueAtRequest && !result) {
          updatePostnummerStatus('invalid');
        }
      }
    });
  }
}

// Update visual selection in suggestions list
function updateSelectedSuggestion(items) {
  items.forEach((item, index) => {
    if (index === selectedSuggestionIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}


async function planRoute() {
  // Check if route planning is configured on server (uses server-side proxy)
  if (!appConfig.orsApiKeyConfigured) {
    showMessage('Ruteplanlegging er ikke konfigurert. Kontakt administrator.', 'warning');
    return;
  }

  const selectedCustomerData = customers.filter(c => selectedCustomers.has(c.id) && c.lat && c.lng);

  if (selectedCustomerData.length < 1) {
    showMessage('Velg minst 1 kunde med gyldige koordinater', 'warning');
    return;
  }

  const routeStart = getRouteStartLocation();
  if (!routeStart) {
    showMessage('Sett firmaadresse i admin-innstillinger for å bruke ruteplanlegging.', 'warning');
    return;
  }

  planRouteBtn.classList.add('loading');
  planRouteBtn.disabled = true;

  // Get start location from config (company address)
  const startLocation = [routeStart.lng, routeStart.lat];

  try {
    const optimizeHeaders = { 'Content-Type': 'application/json' };
    const csrfToken = getCsrfToken();
    if (csrfToken) optimizeHeaders['X-CSRF-Token'] = csrfToken;

    const response = await fetch('/api/routes/optimize', {
      method: 'POST',
      headers: optimizeHeaders,
      credentials: 'include',
      body: JSON.stringify({
        jobs: selectedCustomerData.map((c, i) => ({
          id: i + 1,
          location: [c.lng, c.lat],
          service: 1800
        })),
        vehicles: [{
          id: 1,
          profile: 'driving-car',
          start: startLocation,
          end: startLocation
        }]
      })
    });

    if (!response.ok) {
      showMessage('Ruteoptimering ikke tilgjengelig, bruker enkel rute', 'info');
      await planSimpleRoute(selectedCustomerData);
      return;
    }

    const data = await response.json();

    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const orderedCustomers = route.steps
        .filter(s => s.type === 'job')
        .map(s => selectedCustomerData[s.job - 1]);

      await drawRoute(orderedCustomers);

      const hours = Math.floor(route.duration / 3600);
      const minutes = Math.floor((route.duration % 3600) / 60);
      const km = (route.distance / 1000).toFixed(1);
      const timeStr = hours > 0 ? `${hours}t ${minutes}min` : `${minutes} min`;
      showNotification(`Rute beregnet: ${orderedCustomers.length} stopp, ${km} km, ~${timeStr}`);
    }
  } catch (error) {
    console.error('Ruteplanlegging feil:', error);
    await planSimpleRoute(customers.filter(c => selectedCustomers.has(c.id) && c.lat && c.lng));
  } finally {
    planRouteBtn.classList.remove('loading');
    planRouteBtn.disabled = false;
  }
}

// Simple route without optimization
async function planSimpleRoute(customerData) {
  try {
    const routeStart = getRouteStartLocation();
    if (!routeStart) {
      showMessage('Sett firmaadresse i admin-innstillinger for å bruke ruteplanlegging.', 'warning');
      return;
    }
    const startLocation = [routeStart.lng, routeStart.lat];
    const startLngLat = [routeStart.lng, routeStart.lat];

    const coordinates = [
      startLocation,
      ...customerData.map(c => [c.lng, c.lat]),
      startLocation
    ];

    const directionsHeaders = { 'Content-Type': 'application/json' };
    const dirCsrfToken = getCsrfToken();
    if (dirCsrfToken) directionsHeaders['X-CSRF-Token'] = dirCsrfToken;

    const response = await fetch('/api/routes/directions', {
      method: 'POST',
      headers: directionsHeaders,
      credentials: 'include',
      body: JSON.stringify({ coordinates })
    });

    const rawData = await response.json();

    if (!response.ok) {
      if (rawData.error && rawData.error.message) {
        if (rawData.error.message.includes('Could not find routable point')) {
          throw new Error('En eller flere kunder har koordinater som ikke er nær en vei.');
        }
        throw new Error(rawData.error.message);
      }
      throw new Error('Kunne ikke beregne rute');
    }

    const geoData = rawData.data || rawData;

    if (geoData.features && geoData.features.length > 0) {
      const feature = geoData.features[0];
      drawRouteFromGeoJSON(feature);

      // Add start marker (company location)
      const startEl = createMarkerElement('route-marker route-start', '<i aria-hidden="true" class="fas fa-home"></i>', [30, 30]);
      const startMarker = new mapboxgl.Marker({ element: startEl, anchor: 'center' })
        .setLngLat(startLngLat)
        .setPopup(new mapboxgl.Popup({ offset: 15 }).setHTML(`<strong>Start:</strong><br>${escapeHtml(appConfig.routeStartAddress || 'Kontor')}`))
        .addTo(map);
      routeMarkers.push(startMarker);

      // Add numbered markers for customers
      customerData.forEach((customer, index) => {
        const el = createMarkerElement('route-marker', `${index + 1}`, [30, 30]);
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([customer.lng, customer.lat])
          .addTo(map);
        routeMarkers.push(marker);
      });

      // Fit map to route
      const bounds = new mapboxgl.LngLatBounds();
      bounds.extend(startLngLat);
      customerData.forEach(c => bounds.extend([c.lng, c.lat]));
      map.fitBounds(bounds, { padding: 50 });

      let duration = feature.properties?.summary?.duration || 0;
      let distance = feature.properties?.summary?.distance || 0;
      if (duration === 0 && feature.properties?.segments?.length > 0) {
        for (const seg of feature.properties.segments) {
          duration += seg.duration || 0;
          distance += seg.distance || 0;
        }
      }

      const hours = Math.floor(duration / 3600);
      const minutes = Math.floor((duration % 3600) / 60);
      const km = (distance / 1000).toFixed(1);
      const timeStr = hours > 0 ? `${hours}t ${minutes}min` : `${minutes} min`;
      showNotification(`Rute beregnet: ${customerData.length} stopp, ${km} km, ~${timeStr}`);
    }
  } catch (error) {
    console.error('Enkel rute feil:', error);
    showMessage(error.message || 'Kunne ikke beregne rute.', 'error');
  }
}

// Draw route on map
async function drawRoute(orderedCustomers) {
  clearRoute();

  const routeStart = getRouteStartLocation();
  if (!routeStart) return;
  const startLocation = [routeStart.lng, routeStart.lat];
  const startLngLat = [routeStart.lng, routeStart.lat];

  const coordinates = [
    startLocation,
    ...orderedCustomers.map(c => [c.lng, c.lat]),
    startLocation
  ];

  try {
    const directionsHeaders = { 'Content-Type': 'application/json' };
    const dirCsrfToken = getCsrfToken();
    if (dirCsrfToken) directionsHeaders['X-CSRF-Token'] = dirCsrfToken;

    const response = await fetch('/api/routes/directions', {
      method: 'POST',
      headers: directionsHeaders,
      credentials: 'include',
      body: JSON.stringify({ coordinates })
    });

    const rawData = await response.json();
    const geoData = rawData.data || rawData;

    if (geoData.features && geoData.features.length > 0) {
      drawRouteFromGeoJSON(geoData.features[0]);
    }
  } catch (error) {
    console.error('Tegning av rute feil:', error);
  }

  // Add start marker
  const startEl = createMarkerElement('route-marker route-start', '<i aria-hidden="true" class="fas fa-home"></i>', [30, 30]);
  const startMarker = new mapboxgl.Marker({ element: startEl, anchor: 'center' })
    .setLngLat(startLngLat)
    .setPopup(new mapboxgl.Popup({ offset: 15 }).setHTML(`<strong>Start:</strong><br>${escapeHtml(appConfig.routeStartAddress || 'Kontor')}`))
    .addTo(map);
  routeMarkers.push(startMarker);

  // Add numbered markers for customers
  orderedCustomers.forEach((customer, index) => {
    const el = createMarkerElement('route-marker', `${index + 1}`, [30, 30]);
    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([customer.lng, customer.lat])
      .addTo(map);
    routeMarkers.push(marker);
  });

  // Fit map to route
  const bounds = new mapboxgl.LngLatBounds();
  bounds.extend(startLngLat);
  orderedCustomers.forEach(c => bounds.extend([c.lng, c.lat]));
  map.fitBounds(bounds, { padding: 50 });
}

// Draw route from GeoJSON using Mapbox GL JS source + layer
function drawRouteFromGeoJSON(feature) {
  clearRoute();

  if (feature?.geometry?.coordinates) {
    // GeoJSON is already [lng, lat] — no conversion needed!
    if (map.getSource('route-line')) {
      map.getSource('route-line').setData(feature);
    } else {
      map.addSource('route-line', { type: 'geojson', data: feature });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route-line',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#2563eb', 'line-width': 6, 'line-opacity': 0.9 }
      });
    }
  }
}

// Clear route from map
function clearRoute() {
  if (map.getLayer('route-line')) map.removeLayer('route-line');
  if (map.getSource('route-line')) map.removeSource('route-line');
  routeMarkers.forEach(m => m.remove());
  routeMarkers = [];
}

// Current route data for saving (used by weekplan)
let currentRouteData = null;

// Navigate to a single customer using device maps app
function navigateToCustomer(lat, lng, _name) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const routeStart = getRouteStartLocation();
  if (!routeStart) {
    showMessage('Sett firmaadresse i admin-innstillinger for å bruke navigasjon.', 'warning');
    return;
  }
  const startLat = routeStart.lat;
  const startLng = routeStart.lng;

  if (isIOS) {
    window.open(`https://maps.apple.com/?saddr=${startLat},${startLng}&daddr=${lat},${lng}&dirflg=d`, '_blank');
  } else {
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLng}&destination=${lat},${lng}&travelmode=driving`, '_blank');
  }

  closeMapPopup();
}


// ========================================
// EMAIL DIALOG (Feature: email_templates)
// ========================================

let emailDialogState = {
  kundeId: null,
  templates: [],
  selectedTemplateId: null,
};

async function openEmailDialog(kundeId) {
  const customer = customers.find(c => c.id === kundeId);
  if (!customer) {
    showNotification('Kunde ikke funnet', 'error');
    return;
  }

  if (!customer.epost) {
    showNotification('Kunden har ingen e-postadresse', 'error');
    return;
  }

  emailDialogState.kundeId = kundeId;

  // Fetch templates
  try {
    const res = await apiFetch('/api/customer-emails/templates');
    emailDialogState.templates = res.data || [];
  } catch {
    showNotification('Kunne ikke hente e-postmaler', 'error');
    return;
  }

  renderEmailDialog(customer);
}

function renderEmailDialog(customer) {
  // Remove existing dialog
  const existing = document.querySelector('.email-dialog-overlay');
  if (existing) existing.remove();

  const templates = emailDialogState.templates;
  const firstTemplate = templates[0];
  emailDialogState.selectedTemplateId = firstTemplate?.id || null;

  const overlay = document.createElement('div');
  overlay.className = 'email-dialog-overlay';
  overlay.innerHTML = `
    <div class="email-dialog">
      <div class="email-dialog-header">
        <h3><i aria-hidden="true" class="fas fa-envelope"></i> Send e-post</h3>
        <button class="email-dialog-close" onclick="closeEmailDialog()"><i aria-hidden="true" class="fas fa-times"></i></button>
      </div>
      <div class="email-dialog-body">
        <div class="email-dialog-recipient">
          <label>Til:</label>
          <span>${escapeHtml(customer.navn)} &lt;${escapeHtml(customer.epost)}&gt;</span>
        </div>

        <div class="email-dialog-field">
          <label for="emailTemplateSelect">Velg mal:</label>
          <select id="emailTemplateSelect" class="email-dialog-select" onchange="onEmailTemplateChange()">
            ${templates.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${escapeHtml(t.category)})</option>`).join('')}
          </select>
        </div>

        <div id="emailCustomFields" class="email-dialog-custom-fields" style="display:none">
          <div class="email-dialog-field">
            <label for="emailCustomSubject">Emne:</label>
            <input id="emailCustomSubject" type="text" class="email-dialog-input" placeholder="Skriv emne...">
          </div>
          <div class="email-dialog-field">
            <label for="emailCustomMessage">Melding:</label>
            <textarea id="emailCustomMessage" class="email-dialog-textarea" rows="4" placeholder="Skriv melding..."></textarea>
          </div>
        </div>

        <div class="email-dialog-preview-section">
          <button class="email-dialog-preview-btn" onclick="previewEmail()">
            <i aria-hidden="true" class="fas fa-eye"></i> Forhåndsvis
          </button>
          <div id="emailPreviewContainer" class="email-preview-container" style="display:none">
            <div class="email-preview-subject" id="emailPreviewSubject"></div>
            <iframe id="emailPreviewFrame" class="email-preview-frame"></iframe>
          </div>
        </div>
      </div>
      <div class="email-dialog-footer">
        <button class="btn btn-secondary" onclick="closeEmailDialog()">Avbryt</button>
        <button class="btn btn-primary email-send-btn" onclick="sendEmailFromDialog()">
          <i aria-hidden="true" class="fas fa-paper-plane"></i> Send e-post
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEmailDialog();
  });

  // Show custom fields for "generell" template
  onEmailTemplateChange();
}

function onEmailTemplateChange() {
  const select = document.getElementById('emailTemplateSelect');
  if (!select) return;
  emailDialogState.selectedTemplateId = Number(select.value);

  const template = emailDialogState.templates.find(t => t.id === emailDialogState.selectedTemplateId);
  const customFields = document.getElementById('emailCustomFields');
  if (customFields) {
    customFields.style.display = template?.category === 'generell' ? 'block' : 'none';
  }

  // Hide preview when template changes
  const previewContainer = document.getElementById('emailPreviewContainer');
  if (previewContainer) previewContainer.style.display = 'none';
}

async function previewEmail() {
  if (!emailDialogState.selectedTemplateId || !emailDialogState.kundeId) return;

  const customVariables = {};
  const template = emailDialogState.templates.find(t => t.id === emailDialogState.selectedTemplateId);
  if (template?.category === 'generell') {
    const subjectEl = document.getElementById('emailCustomSubject');
    const messageEl = document.getElementById('emailCustomMessage');
    if (subjectEl) customVariables.emne = subjectEl.value;
    if (messageEl) customVariables.melding = messageEl.value;
  }

  try {
    const res = await apiFetch('/api/customer-emails/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: emailDialogState.selectedTemplateId,
        kunde_id: emailDialogState.kundeId,
        custom_variables: customVariables,
      }),
    });

    const previewContainer = document.getElementById('emailPreviewContainer');
    const subjectEl = document.getElementById('emailPreviewSubject');
    const frameEl = document.getElementById('emailPreviewFrame');

    if (previewContainer && subjectEl && frameEl) {
      previewContainer.style.display = 'block';
      subjectEl.textContent = `Emne: ${res.data.subject}`;
      // Write HTML into iframe for safe rendering
      const doc = frameEl.contentDocument || frameEl.contentWindow.document;
      doc.open();
      doc.write(res.data.html);
      doc.close();
    }
  } catch {
    showNotification('Kunne ikke generere forhåndsvisning', 'error');
  }
}

async function sendEmailFromDialog() {
  if (!emailDialogState.selectedTemplateId || !emailDialogState.kundeId) return;

  const sendBtn = document.querySelector('.email-send-btn');
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i aria-hidden="true" class="fas fa-spinner fa-spin"></i> Sender...';
  }

  const customVariables = {};
  const template = emailDialogState.templates.find(t => t.id === emailDialogState.selectedTemplateId);
  if (template?.category === 'generell') {
    const subjectEl = document.getElementById('emailCustomSubject');
    const messageEl = document.getElementById('emailCustomMessage');
    if (subjectEl) customVariables.emne = subjectEl.value;
    if (messageEl) customVariables.melding = messageEl.value;

    if (!customVariables.emne || !customVariables.melding) {
      showNotification('Fyll inn emne og melding', 'error');
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<i aria-hidden="true" class="fas fa-paper-plane"></i> Send e-post';
      }
      return;
    }
  }

  try {
    await apiFetch('/api/customer-emails/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: emailDialogState.selectedTemplateId,
        kunde_id: emailDialogState.kundeId,
        custom_variables: customVariables,
      }),
    });

    showNotification('E-post sendt!', 'success');
    closeEmailDialog();

    // Refresh customers to update lifecycle colors
    await loadCustomers();
  } catch (err) {
    showNotification(err.message || 'Kunne ikke sende e-post', 'error');
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i aria-hidden="true" class="fas fa-paper-plane"></i> Send e-post';
    }
  }
}

function closeEmailDialog() {
  const overlay = document.querySelector('.email-dialog-overlay');
  if (overlay) overlay.remove();
  emailDialogState = { kundeId: null, templates: [], selectedTemplateId: null };
}


function renderOverdue() {
  const container = document.getElementById('overdueContainer');
  const countHeader = document.getElementById('overdueCountHeader');
  const sortSelect = document.getElementById('overdueSortSelect');
  const sortBy = sortSelect?.value || 'proximity';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

  // Get overdue customers - forfalt kun når kontrollens måned er passert
  let overdueCustomers = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    return controlMonthValue < currentMonthValue;
  });

  // Calculate days overdue for each
  overdueCustomers = overdueCustomers.map(c => {
    const nextDate = getNextControlDate(c);
    const daysOverdue = Math.ceil((today - nextDate) / (1000 * 60 * 60 * 24));
    return { ...c, daysOverdue, _controlDate: nextDate };
  });

  // Sort based on selection - default: ferskeste (lavest dager) først
  if (sortBy === 'days') {
    // Ferskeste først (lavest antall dager forfalt øverst)
    overdueCustomers.sort((a, b) => a.daysOverdue - b.daysOverdue);
  } else if (sortBy === 'days-desc') {
    // Eldste først (høyest antall dager forfalt øverst)
    overdueCustomers.sort((a, b) => b.daysOverdue - a.daysOverdue);
  } else if (sortBy === 'name') {
    sortByNavn(overdueCustomers);
  } else if (sortBy === 'category') {
    overdueCustomers.sort((a, b) => {
      const catA = a.kategori || 'Annen';
      const catB = b.kategori || 'Annen';
      if (catA !== catB) return compareNorwegian(catA, catB);
      return a.daysOverdue - b.daysOverdue;
    });
  } else if (sortBy === 'area') {
    overdueCustomers.sort((a, b) => {
      const areaA = a.poststed || 'Ukjent';
      const areaB = b.poststed || 'Ukjent';
      if (areaA !== areaB) return compareNorwegian(areaA, areaB);
      return a.daysOverdue - b.daysOverdue;
    });
  } else if (sortBy === 'proximity') {
    // No pre-sort needed - clustering handles grouping
  }

  // Update badge
  updateBadge('overdueBadge', overdueCustomers.length);

  // Update header count
  if (countHeader) {
    countHeader.textContent = overdueCustomers.length > 0
      ? `(${overdueCustomers.length} stk)`
      : '';
  }

  // Render
  let html = '';

  if (overdueCustomers.length === 0) {
    html = `
      <div class="overdue-empty">
        <i aria-hidden="true" class="fas fa-check-circle"></i>
        <p>Ingen forfalte kontroller</p>
        <span>Bra jobba!</span>
      </div>
    `;
  } else {
    // Group by severity
    const critical = overdueCustomers.filter(c => c.daysOverdue > 60);
    const warning = overdueCustomers.filter(c => c.daysOverdue > 30 && c.daysOverdue <= 60);
    const mild = overdueCustomers.filter(c => c.daysOverdue <= 30);

    const renderGroup = (title, items, severity) => {
      if (items.length === 0) return '';
      return `
        <div class="overdue-section overdue-${severity}">
          <div class="overdue-section-header">
            <span class="overdue-severity-dot ${severity}"></span>
            ${title} (${items.length})
          </div>
          ${items.map(c => `
            <div class="overdue-item" data-action="focusOnCustomer" data-customer-id="${c.id}">
              <div class="overdue-customer-info">
                <div class="overdue-customer-main">
                  <h4>${escapeHtml(c.navn)}</h4>
                  <span class="overdue-category">${escapeHtml(c.kategori || 'Ukjent')}</span>
                </div>
                <p class="overdue-address">${escapeHtml(c.adresse)}, ${escapeHtml(c.poststed || '')}</p>
                ${c.telefon ? `<a href="tel:${c.telefon}" class="overdue-phone" onclick="event.stopPropagation();"><i aria-hidden="true" class="fas fa-phone"></i> ${escapeHtml(c.telefon)}</a>` : ''}
              </div>
              <div class="overdue-status">
                <span class="overdue-days">${c.daysOverdue} dager</span>
                <span class="overdue-date">${formatDate(c._controlDate)}</span>
                <button class="btn-remind" data-action="sendReminder" data-customer-id="${c.id}" title="Send påminnelse">
                  <i aria-hidden="true" class="fas fa-envelope"></i>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    };

    const renderGroupedItems = (items) => {
      return items.map(c => {
        const kat = c.kategori || '';
        const katBadge = kat ? `<span class="overdue-kat-badge ${kat.includes('El') ? 'kat-el' : kat.includes('Brann') ? 'kat-brann' : 'kat-other'}">${escapeHtml(kat)}</span>` : '';
        return `
        <div class="overdue-item" data-action="focusOnCustomer" data-customer-id="${c.id}">
          <div class="overdue-customer-info">
            <div class="overdue-customer-main">
              <h4>${escapeHtml(c.navn)}</h4>
              ${katBadge}
              <span class="overdue-days-inline ${c.daysOverdue > 60 ? 'critical' : c.daysOverdue > 30 ? 'warning' : 'mild'}">${c.daysOverdue}d forfalt</span>
            </div>
            <p class="overdue-address">${escapeHtml(c.adresse)}, ${escapeHtml(c.poststed || '')}</p>
            ${c.telefon ? `<a href="tel:${c.telefon}" class="overdue-phone" onclick="event.stopPropagation();"><i aria-hidden="true" class="fas fa-phone"></i> ${escapeHtml(c.telefon)}</a>` : ''}
          </div>
          <div class="overdue-status">
            <span class="overdue-date">${formatDate(c._controlDate)}</span>
            <button class="btn-remind" data-action="sendReminder" data-customer-id="${c.id}" title="Send påminnelse">
              <i aria-hidden="true" class="fas fa-envelope"></i>
            </button>
            <button class="btn-wp-single" data-action="addGroupToWeekPlan" data-customer-ids="${c.id}" title="Legg til i ukeplan">
              <i aria-hidden="true" class="fas fa-calendar-plus"></i>
            </button>
          </div>
        </div>
      `;
      }).join('');
    };

    // Helper: generate type breakdown badges for a group of customers
    const renderTypeBadges = (items) => {
      const types = {};
      items.forEach(c => {
        const kat = c.kategori || 'Annen';
        types[kat] = (types[kat] || 0) + 1;
      });
      return Object.entries(types).map(([kat, count]) =>
        `<span class="overdue-kat-badge ${kat.includes('El') ? 'kat-el' : kat.includes('Brann') ? 'kat-brann' : 'kat-other'}">${count} ${escapeHtml(kat)}</span>`
      ).join('');
    };

    if (sortBy === 'category') {
      // Group by category
      const byCategory = {};
      overdueCustomers.forEach(c => {
        const cat = c.kategori || 'Annen';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(c);
      });

      Object.keys(byCategory).sort((a, b) => a.localeCompare(b, 'no')).forEach(cat => {
        const customerIds = byCategory[cat].map(c => c.id).join(',');
        html += `
          <div class="overdue-section">
            <div class="overdue-section-header">
              <i aria-hidden="true" class="fas fa-folder"></i>
              ${escapeHtml(cat)} (${byCategory[cat].length})
              <button class="btn-group-route" data-action="createRouteFromGroup" data-customer-ids="${customerIds}" title="Lag rute for denne gruppen">
                <i aria-hidden="true" class="fas fa-route"></i>
              </button>
              <button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${customerIds}" title="Legg til i ukeplan">
                <i aria-hidden="true" class="fas fa-calendar-plus"></i>
              </button>
            </div>
            ${renderGroupedItems(byCategory[cat])}
          </div>
        `;
      });
    } else if (sortBy === 'area') {
      // Group by area (poststed)
      const byArea = {};
      overdueCustomers.forEach(c => {
        const area = c.poststed || 'Ukjent område';
        if (!byArea[area]) byArea[area] = [];
        byArea[area].push(c);
      });

      Object.keys(byArea).sort(compareNorwegian).forEach(area => {
        const customerIds = byArea[area].map(c => c.id).join(',');
        html += `
          <div class="overdue-section overdue-area-section">
            <div class="overdue-section-header">
              <i aria-hidden="true" class="fas fa-map-marker-alt"></i>
              ${escapeHtml(area)} (${byArea[area].length})
              <button class="btn-group-route" data-action="createRouteFromGroup" data-customer-ids="${customerIds}" title="Lag rute for ${escapeHtml(area)}">
                <i aria-hidden="true" class="fas fa-route"></i>
              </button>
              <button class="btn-group-map" data-action="showGroupOnMap" data-customer-ids="${customerIds}" title="Vis på kart">
                <i aria-hidden="true" class="fas fa-map"></i>
              </button>
              <button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${customerIds}" title="Legg til i ukeplan">
                <i aria-hidden="true" class="fas fa-calendar-plus"></i>
              </button>
            </div>
            <div class="overdue-type-summary">${renderTypeBadges(byArea[area])}</div>
            ${renderGroupedItems(byArea[area])}
          </div>
        `;
      });
    } else if (sortBy === 'proximity') {
      // Group by geographic proximity using DBSCAN clustering
      const { clusters, noise, summary } = clusterCustomersByProximity(overdueCustomers);

      // Summary line
      const overdueCustWord = overdueCustomers.length === 1 ? 'kunde' : 'kunder';
      const summaryParts = [];
      if (summary.clusterCount > 0) summaryParts.push(`${summary.clusterCount} ${summary.clusterCount === 1 ? 'område' : 'områder'}`);
      if (summary.noiseCount > 0) summaryParts.push(`${summary.noiseCount} ${summary.noiseCount === 1 ? 'spredt' : 'spredte'}`);
      html += `
        <div class="proximity-summary">
          <i aria-hidden="true" class="fas fa-layer-group"></i>
          <span>${overdueCustomers.length} ${overdueCustWord} fordelt på ${summaryParts.join(' + ')}</span>
        </div>
      `;

      clusters.forEach((cluster, idx) => {
        // Sort customers within cluster: most overdue first
        cluster.customers.sort((a, b) => b.daysOverdue - a.daysOverdue);
        const customerIds = cluster.customers.map(c => c.id).join(',');
        const custWord = cluster.customers.length === 1 ? 'kunde' : 'kunder';
        const radiusText = cluster.radiusKm < 1
          ? `~${Math.round(cluster.radiusKm * 1000)}m`
          : `~${cluster.radiusKm.toFixed(1)} km`;

        // Severity breakdown for this cluster
        const critCount = cluster.customers.filter(c => c.daysOverdue > 60).length;
        const warnCount = cluster.customers.filter(c => c.daysOverdue > 30 && c.daysOverdue <= 60).length;
        const mildCount = cluster.customers.filter(c => c.daysOverdue <= 30).length;
        let severityBadges = '';
        if (critCount > 0) severityBadges += `<span class="proximity-severity critical">${critCount} kritisk</span>`;
        if (warnCount > 0) severityBadges += `<span class="proximity-severity warning">${warnCount} advarsel</span>`;
        if (mildCount > 0) severityBadges += `<span class="proximity-severity mild">${mildCount} ny</span>`;

        // Determine dominant severity for border color
        const severityClass = critCount > 0 ? 'severity-critical' : warnCount > 0 ? 'severity-warning' : 'severity-mild';

        html += `
          <div class="overdue-section overdue-proximity-section ${severityClass}">
            <div class="overdue-section-header">
              <span class="proximity-number">${idx + 1}</span>
              <i aria-hidden="true" class="fas fa-map-pin"></i>
              ${escapeHtml(cluster.areaName)}
              <span class="proximity-meta">${cluster.customers.length} ${custWord}, ${radiusText}</span>
              ${severityBadges}
              <button class="btn-group-route" data-action="createRouteFromGroup" data-customer-ids="${customerIds}" title="Lag rute for denne klyngen">
                <i aria-hidden="true" class="fas fa-route"></i>
              </button>
              <button class="btn-group-map" data-action="showGroupOnMap" data-customer-ids="${customerIds}" title="Vis på kart">
                <i aria-hidden="true" class="fas fa-map"></i>
              </button>
              <button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${customerIds}" title="Legg til i ukeplan">
                <i aria-hidden="true" class="fas fa-calendar-plus"></i>
              </button>
            </div>
            <div class="overdue-type-summary">${renderTypeBadges(cluster.customers)}</div>
            ${renderGroupedItems(cluster.customers)}
          </div>
        `;
      });

      if (noise.length > 0) {
        // Sort noise: most overdue first
        noise.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));
        const noiseIds = noise.filter(c => c.id).map(c => c.id).join(',');
        const noiseWord = noise.length === 1 ? 'kunde' : 'kunder';
        html += `
          <div class="overdue-section overdue-noise-section">
            <div class="overdue-section-header">
              <i aria-hidden="true" class="fas fa-map-marker-alt"></i>
              Spredte ${noiseWord} (${noise.length})
              ${noiseIds ? `<button class="btn-group-map" data-action="showGroupOnMap" data-customer-ids="${noiseIds}" title="Vis på kart"><i aria-hidden="true" class="fas fa-map"></i></button>` : ''}
              ${noiseIds ? `<button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${noiseIds}" title="Legg til i ukeplan"><i aria-hidden="true" class="fas fa-calendar-plus"></i></button>` : ''}
            </div>
            ${renderGroupedItems(noise)}
          </div>
        `;
      }
    } else {
      // Vis grupper basert på sorteringsvalg
      if (sortBy === 'days') {
        // Ferskeste først - mild først
        html += renderGroup('Nylig forfalt (1-30 dager)', mild, 'mild');
        html += renderGroup('Advarsel (31-60 dager)', warning, 'warning');
        html += renderGroup('Kritisk (over 60 dager)', critical, 'critical');
      } else {
        // Standard/eldste først - kritisk først
        html += renderGroup('Kritisk (over 60 dager)', critical, 'critical');
        html += renderGroup('Advarsel (31-60 dager)', warning, 'warning');
        html += renderGroup('Nylig forfalt (1-30 dager)', mild, 'mild');
      }
    }
  }

  container.innerHTML = html;

  // Show/hide proximity settings
  const proxSettings = document.getElementById('overdueProximitySettings');
  if (proxSettings) {
    proxSettings.style.display = sortBy === 'proximity' ? '' : 'none';
  }
}

// Update overdue badge count — same logic as renderOverdue()
function updateOverdueBadge() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

  const overdueCount = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    return controlMonthValue < currentMonthValue;
  }).length;

  updateBadge('overdueBadge', overdueCount);

  // Also update upcoming badge
  updateUpcomingBadge();
}

function updateUpcomingBadge() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();
  const thirtyDaysFromNow = new Date(today);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const upcomingCount = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    // Include current month (not overdue) up to 30 days from now
    return controlMonthValue >= currentMonthValue && nextDate <= thirtyDaysFromNow;
  }).length;

  updateBadge('upcomingBadge', upcomingCount);
}

// Render warnings for upcoming controls
function renderWarnings() {
  const container = document.getElementById('warningsContainer');
  const sortSelect = document.getElementById('warningSortSelect');
  const sortBy = sortSelect?.value || 'proximity';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysFromNow = new Date(today);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

  // Get customers needing control in next 30 days (includes current month past dates)
  const warningCustomers = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    // Include current month (not overdue) up to 30 days from now
    return controlMonthValue >= currentMonthValue && nextDate <= thirtyDaysFromNow;
  }).map(c => ({
    ...c,
    _nextDate: getNextControlDate(c)
  }));

  const renderWarningItem = (c) => {
    const controlStatus = getControlStatus(c);
    const daysUntil = Math.ceil((c._nextDate - today) / (1000 * 60 * 60 * 24));
    const dateStr = c._nextDate.toISOString().split('T')[0];
    const kat = c.kategori || '';
    const katBadge = kat ? `<span class="overdue-kat-badge ${kat.includes('El') ? 'kat-el' : kat.includes('Brann') ? 'kat-brann' : 'kat-other'}">${escapeHtml(kat)}</span>` : '';
    return `
      <div class="warning-item" data-action="focusOnCustomer" data-customer-id="${c.id}">
        <div class="warning-customer">
          <h4>${escapeHtml(c.navn)} ${katBadge}</h4>
          <p>${escapeHtml(c.adresse)} (${escapeHtml(c.postnummer)})</p>
        </div>
        <div class="warning-date">
          <span class="control-status ${controlStatus.class}">${daysUntil < 0 ? Math.abs(daysUntil) + ' dager over' : daysUntil + ' dager'}</span>
          <p style="font-size: 10px; color: #666; margin: 2px 0 0 0;">${escapeHtml(dateStr)}</p>
          <button class="btn-wp-single" data-action="addGroupToWeekPlan" data-customer-ids="${c.id}" title="Legg til i ukeplan">
            <i aria-hidden="true" class="fas fa-calendar-plus"></i>
          </button>
        </div>
      </div>
    `;
  };

  // Helper: generate type breakdown badges for warning groups
  const renderWarningTypeBadges = (items) => {
    const types = {};
    items.forEach(c => {
      const kat = c.kategori || 'Annen';
      types[kat] = (types[kat] || 0) + 1;
    });
    return Object.entries(types).map(([kat, count]) =>
      `<span class="overdue-kat-badge ${kat.includes('El') ? 'kat-el' : kat.includes('Brann') ? 'kat-brann' : 'kat-other'}">${count} ${escapeHtml(kat)}</span>`
    ).join('');
  };

  // Render
  let html = '';

  if (warningCustomers.length === 0) {
    html = '<p style="padding: 20px; text-align: center; color: #666;">Ingen kommende kontroller</p>';
  } else if (sortBy === 'proximity') {
    // Group by geographic proximity
    const { clusters, noise, summary } = clusterCustomersByProximity(warningCustomers);

    // Summary line
    const warnCustWord = warningCustomers.length === 1 ? 'kunde' : 'kunder';
    const summaryParts = [];
    if (summary.clusterCount > 0) summaryParts.push(`${summary.clusterCount} ${summary.clusterCount === 1 ? 'område' : 'områder'}`);
    if (summary.noiseCount > 0) summaryParts.push(`${summary.noiseCount} ${summary.noiseCount === 1 ? 'spredt' : 'spredte'}`);
    html += `
      <div class="proximity-summary">
        <i aria-hidden="true" class="fas fa-layer-group"></i>
        <span>${warningCustomers.length} ${warnCustWord} fordelt på ${summaryParts.join(' + ')}</span>
      </div>
    `;

    clusters.forEach((cluster, idx) => {
      // Sort customers within cluster: soonest control date first
      cluster.customers.sort((a, b) => a._nextDate - b._nextDate);
      const customerIds = cluster.customers.map(c => c.id).join(',');
      const custWord = cluster.customers.length === 1 ? 'kunde' : 'kunder';
      const radiusText = cluster.radiusKm < 1
        ? `~${Math.round(cluster.radiusKm * 1000)}m`
        : `~${cluster.radiusKm.toFixed(1)} km`;
      html += `<div class="warning-section overdue-proximity-section">
        <div class="warning-header proximity-header">
          <span class="proximity-number">${idx + 1}</span>
          <i aria-hidden="true" class="fas fa-map-pin"></i>
          ${escapeHtml(cluster.areaName)}
          <span class="proximity-meta">${cluster.customers.length} ${custWord}, ${radiusText}</span>
          <button class="btn-group-route" data-action="createRouteFromGroup" data-customer-ids="${customerIds}" title="Lag rute for denne klyngen">
            <i aria-hidden="true" class="fas fa-route"></i>
          </button>
          <button class="btn-group-map" data-action="showGroupOnMap" data-customer-ids="${customerIds}" title="Vis på kart">
            <i aria-hidden="true" class="fas fa-map"></i>
          </button>
          <button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${customerIds}" title="Legg til i ukeplan">
            <i aria-hidden="true" class="fas fa-calendar-plus"></i>
          </button>
        </div>
        <div class="overdue-type-summary">${renderWarningTypeBadges(cluster.customers)}</div>
        ${cluster.customers.map(renderWarningItem).join('')}
      </div>`;
    });

    if (noise.length > 0) {
      // Sort noise: soonest control date first
      noise.sort((a, b) => (a._nextDate || 0) - (b._nextDate || 0));
      const noiseIds = noise.filter(c => c.id).map(c => c.id).join(',');
      const noiseWord = noise.length === 1 ? 'kunde' : 'kunder';
      html += `<div class="warning-section overdue-noise-section">
        <div class="warning-header proximity-header">
          <i aria-hidden="true" class="fas fa-map-marker-alt"></i>
          Spredte ${noiseWord} (${noise.length})
          ${noiseIds ? `<button class="btn-group-map" data-action="showGroupOnMap" data-customer-ids="${noiseIds}" title="Vis på kart"><i aria-hidden="true" class="fas fa-map"></i></button>` : ''}
          ${noiseIds ? `<button class="btn-group-weekplan" data-action="addGroupToWeekPlan" data-customer-ids="${noiseIds}" title="Legg til i ukeplan"><i aria-hidden="true" class="fas fa-calendar-plus"></i></button>` : ''}
        </div>
        ${noise.map(renderWarningItem).join('')}
      </div>`;
    }
  } else {
    // Default: Group by kategori
    const byCategory = {};
    warningCustomers.forEach(c => {
      const cat = c.kategori || 'Annen';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(c);
    });

    Object.values(byCategory).forEach(sortByNavn);

    const categoryOrder = serviceTypeRegistry.getAll().map(st => st.name);
    const sortedCats = Object.keys(byCategory).sort((a, b) => {
      const indexA = categoryOrder.indexOf(a);
      const indexB = categoryOrder.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedCats.forEach(category => {
      html += `<div class="warning-section">
        <div class="warning-header">${escapeHtml(category)} (${byCategory[category].length})</div>
        ${byCategory[category].map(renderWarningItem).join('')}
      </div>`;
    });
  }

  container.innerHTML = html;

  // Show/hide proximity settings
  const proxSettings = document.getElementById('warningProximitySettings');
  if (proxSettings) {
    proxSettings.style.display = sortBy === 'proximity' ? '' : 'none';
  }
}



// === Calendar helper functions ===

function formatDateISO(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getNextMonday(fromDate) {
  const d = new Date(fromDate);
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : (8 - day);
  d.setDate(d.getDate() + daysUntilMonday);
  return d;
}

function addDaysToDate(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getCreatorDisplay(name, short = false) {
  if (!name || name === 'admin' || !name.trim()) return '';
  const parts = name.trim().split(/\s+/);
  if (short) {
    // Initialer: "Sander Martinsen" → "SM"
    return parts.map(p => p[0].toUpperCase()).join('');
  }
  // Kort: "Sander Martinsen" → "Sander M."
  if (parts.length > 1) {
    return parts[0] + ' ' + parts[1][0].toUpperCase() + '.';
  }
  return parts[0];
}

function getUniqueAreas(dayAvtaler) {
  const areaMap = new Map();
  dayAvtaler.forEach(a => {
    const area = a.kunder?.poststed || a.poststed || null;
    if (!area) return;
    if (!areaMap.has(area)) {
      areaMap.set(area, { count: 0, customers: [] });
    }
    const group = areaMap.get(area);
    group.count++;
    group.customers.push(a.kunder?.navn || a.kunde_navn || 'Ukjent');
  });
  return areaMap;
}

function getAreaTooltip(dayAvtaler) {
  const areas = getUniqueAreas(dayAvtaler);
  return Array.from(areas.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .map(([area, data]) => `${area}: ${data.count}`)
    .join(', ');
}

function renderAreaBadges(dayAvtaler) {
  const areas = getUniqueAreas(dayAvtaler);
  if (areas.size === 0) return '';

  const sorted = Array.from(areas.entries()).sort((a, b) => b[1].count - a[1].count);
  return `
    <div class="week-day-areas">
      ${sorted.map(([area, data]) => `
        <span class="area-badge" title="${escapeHtml(data.customers.join(', '))}">
          <i aria-hidden="true" class="fas fa-map-marker-alt"></i> ${escapeHtml(area)} (${data.count})
        </span>
      `).join('')}
    </div>
  `;
}

// === WEEKLY PLAN (Ukeplan - planlagte oppdrag) ===

const weekDayKeys = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag'];
const weekDayLabels = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag'];
const monthNamesShort = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

function formatMinutes(totalMin) {
  if (!totalMin || totalMin <= 0) return '';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}t ${m}m` : `${h}t`;
}

function formatTimeOfDay(minutesOffset, startHour = 8, startMinute = 0) {
  const totalMinutes = (startHour * 60 + startMinute) + minutesOffset;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getDayEstimatedTotal(dayKey) {
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return 0;
  return dayData.planned.reduce((sum, c) => sum + (c.estimertTid || 30), 0);
}

const TEAM_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#c026d3', '#ca8a04'];
let wpFocusedTeamMember = null; // currently highlighted team member name
let wpFocusedMemberIds = null; // Set of customer IDs for focused member (used by cluster icons)
let wpRouteActive = false; // true when navigating a route (dims markers)
let wpRouteStopIds = null; // Set of customer IDs that are stops in the active route

function getWeekTeamMembers() {
  if (!weekPlanState.days) return [];
  const weekDates = new Set(weekDayKeys.map(k => weekPlanState.days[k]?.date).filter(Boolean));
  const teamMap = new Map(); // name → { initials, count, kundeIds: Set }

  // Planned (unsaved) - use global assigned technician, or current user
  const userName = localStorage.getItem('userName') || '';
  const globalAssigned = weekPlanState.globalAssignedTo || userName;
  for (const dayKey of weekDayKeys) {
    const dayData = weekPlanState.days[dayKey];
    if (!dayData || dayData.planned.length === 0) continue;
    const assignedName = globalAssigned || userName;
    if (!assignedName) continue;
    for (const c of dayData.planned) {
      if (!teamMap.has(assignedName)) teamMap.set(assignedName, { initials: getCreatorDisplay(assignedName, true), count: 0, kundeIds: new Set() });
      const entry = teamMap.get(assignedName);
      entry.count++;
      entry.kundeIds.add(c.id);
    }
  }

  // Existing avtaler this week
  for (const a of avtaler) {
    if (!weekDates.has(a.dato) || !a.kunde_id) continue;
    const creator = a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '';
    if (!creator) continue;
    if (!teamMap.has(creator)) teamMap.set(creator, { initials: getCreatorDisplay(creator, true), count: 0, kundeIds: new Set() });
    const entry = teamMap.get(creator);
    if (!entry.kundeIds.has(a.kunde_id)) {
      entry.count++;
      entry.kundeIds.add(a.kunde_id);
    }
  }

  // Convert to array sorted by count desc, then assign colors by sorted position
  const sorted = Array.from(teamMap.entries()).map(([name, data]) => ({
    name,
    initials: data.initials,
    count: data.count,
    kundeIds: data.kundeIds,
    color: '' // assigned after sort
  })).sort((a, b) => b.count - a.count);

  sorted.forEach((member, idx) => {
    member.color = TEAM_COLORS[idx % TEAM_COLORS.length];
  });
  return sorted;
}

function focusTeamMemberOnMap(memberName) {
  if (wpFocusedTeamMember === memberName) {
    // Toggle off - remove focus
    wpFocusedTeamMember = null;
    wpFocusedMemberIds = null;
    applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();
    renderWeeklyPlan();
    return;
  }

  wpFocusedTeamMember = memberName;
  const team = getWeekTeamMembers();
  const member = team.find(t => t.name === memberName);
  if (!member) return;

  // Normalize all IDs to numbers for consistent lookup
  wpFocusedMemberIds = new Set([...member.kundeIds].map(id => Number(id)));

  // Collect bounds from actual map markers
  const bounds = new mapboxgl.LngLatBounds();
  let hasPoints = false;
  for (const kundeId of wpFocusedMemberIds) {
    const m = markers[kundeId];
    if (m) {
      const ll = m.getLngLat();
      if (ll && ll.lat && ll.lng) {
        bounds.extend(ll);
        hasPoints = true;
      }
    }
  }

  // Zoom map FIRST, then apply styling after zoom settles
  if (hasPoints) {
    map.fitBounds(bounds, { maxZoom: 11, padding: 40 });
  }

  // Delay focus styling until after zoom animation completes
  setTimeout(() => {
    applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();
  }, 400);

  renderWeeklyPlan();
}

// Refresh focused member IDs after plan changes (remove/delete).
// If the focused member no longer has customers, reset focus entirely.
function refreshTeamFocus() {
  if (!wpFocusedTeamMember) return;
  const team = getWeekTeamMembers();
  const member = team.find(t => t.name === wpFocusedTeamMember);
  if (!member || member.kundeIds.size === 0) {
    // Member no longer has any customers — clear focus
    wpFocusedTeamMember = null;
    wpFocusedMemberIds = null;
  } else {
    wpFocusedMemberIds = new Set([...member.kundeIds].map(id => Number(id)));
  }
  applyTeamFocusToMarkers();
  if (typeof refreshClusters === 'function') refreshClusters();
}

// Apply focus/dim styling to individual markers (called after zoom changes too)
function applyTeamFocusToMarkers() {
  for (const kundeId of Object.keys(markers)) {
    const el = markers[kundeId]?.getElement?.();
    if (!el) continue;
    const id = Number(kundeId);

    if (wpRouteActive) {
      // Route active: highlight route stops, dim everything else
      if (wpRouteStopIds && wpRouteStopIds.has(id)) {
        el.style.opacity = '1';
        el.style.filter = '';
        el.style.pointerEvents = '';
      } else {
        el.style.opacity = '0.3';
        el.style.filter = 'grayscale(0.8)';
        el.style.pointerEvents = 'none';
      }
    } else if (wpFocusedMemberIds) {
      // Team focus active
      if (wpFocusedMemberIds.has(id)) {
        el.style.opacity = '1';
        el.style.filter = '';
        el.style.pointerEvents = '';
      } else {
        el.style.opacity = '0.15';
        el.style.filter = 'grayscale(1)';
        el.style.pointerEvents = 'none';
      }
    } else {
      // Nothing active - reset
      el.style.opacity = '';
      el.style.filter = '';
      el.style.pointerEvents = '';
    }
  }
}

let weekPlanState = {
  weekStart: null,
  activeDay: null,
  days: {},
  globalAssignedTo: ''
};

function initWeekPlanState(weekStart) {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  // Ensure it's a Monday
  const day = start.getDay();
  if (day !== 1) {
    start.setDate(start.getDate() - ((day + 6) % 7));
  }
  weekPlanState.weekStart = new Date(start);
  weekPlanState.days = {};
  for (let i = 0; i < 5; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    weekPlanState.days[weekDayKeys[i]] = {
      date: formatDateISO(d),
      planned: [],
      assignedTo: ''
    };
  }
}

function getWeekPlanTotalPlanned() {
  let total = 0;
  for (const key of weekDayKeys) {
    total += (weekPlanState.days[key]?.planned?.length || 0);
  }
  return total;
}

let wpTeamMembers = null;
async function loadWpTeamMembers() {
  if (wpTeamMembers) return wpTeamMembers;
  try {
    const resp = await apiFetch('/api/team-members');
    const json = await resp.json();
    if (json.success && json.data) {
      wpTeamMembers = json.data.filter(m => m.aktiv);
    }
  } catch (e) { /* silent */ }
  return wpTeamMembers || [];
}

async function renderWeeklyPlan() {
  const container = document.getElementById('weeklyPlanContainer');
  if (!container) return;

  // Initialize state for current week if not set
  if (!weekPlanState.weekStart) {
    initWeekPlanState(new Date());
  }

  // Ensure avtaler are loaded
  if (avtaler.length === 0) {
    await loadAvtaler();
  }

  // Load team members for technician assignment dropdown
  const allTeamMembers = await loadWpTeamMembers();

  const weekNum = getISOWeekNumber(weekPlanState.weekStart);
  const totalPlanned = getWeekPlanTotalPlanned();
  const todayStr = formatDateISO(new Date());

  let html = `<div class="wp-container">`;

  // Header: week nav
  html += `
    <div class="wp-header">
      <button class="btn btn-small btn-secondary" data-action="weekPlanPrev" aria-label="Forrige uke"><i aria-hidden="true" class="fas fa-chevron-left"></i></button>
      <span class="wp-week-title">Uke ${weekNum}</span>
      <button class="btn btn-small btn-secondary" data-action="weekPlanNext" aria-label="Neste uke"><i aria-hidden="true" class="fas fa-chevron-right"></i></button>
    </div>
  `;

  // Admin: technician assignment panel
  const wpIsAdmin = localStorage.getItem('userRole') === 'admin' || localStorage.getItem('userType') === 'bruker';
  if (wpIsAdmin && allTeamMembers.length > 0) {
    const globalAssigned = weekPlanState.globalAssignedTo || '';
    const tmOpts = allTeamMembers.map(m =>
      `<option value="${escapeHtml(m.navn)}" ${globalAssigned === m.navn ? 'selected' : ''}>${escapeHtml(m.navn)}</option>`
    ).join('');
    html += `<div class="wp-dispatch-bar">
      <i aria-hidden="true" class="fas fa-user-hard-hat"></i>
      <span>Planlegg for:</span>
      <select class="wp-dispatch-select" id="wpDispatchSelect">
        <option value="">Meg selv</option>
        ${tmOpts}
      </select>
    </div>`;
  }

  // Customer search bar (always visible)
  html += `<div class="wp-search-container">
    <div class="wp-search-wrapper">
      <i aria-hidden="true" class="fas fa-search wp-search-icon"></i>
      <input type="text" class="wp-search-input" id="wpCustomerSearch"
        placeholder="S\u00f8k kunde (navn, adresse, sted)..." autocomplete="off">
    </div>
    <div class="wp-search-results" id="wpSearchResults"></div>
  </div>`;

  // Status bar when selecting
  if (weekPlanState.activeDay) {
    const dispatchName = weekPlanState.globalAssignedTo || '';
    const forWho = dispatchName ? ` for ${dispatchName}` : '';
    html += `<div class="wp-status"><i aria-hidden="true" class="fas fa-crosshairs"></i> Dra over kunder på kartet for <strong>${weekDayLabels[weekDayKeys.indexOf(weekPlanState.activeDay)]}</strong>${forWho}</div>`;
  } else if (totalPlanned === 0) {
    html += `<div class="wp-status muted"><i aria-hidden="true" class="fas fa-hand-pointer"></i> Velg en dag for å starte</div>`;
  }

  // Team bar - show all employees with planned work this week
  const teamMembers = getWeekTeamMembers();
  if (teamMembers.length > 0) {
    html += `<div class="wp-team-bar">`;
    html += `<span class="wp-team-label"><i aria-hidden="true" class="fas fa-users"></i></span>`;
    for (const member of teamMembers) {
      const isActive = wpFocusedTeamMember === member.name;
      html += `<span class="wp-team-chip ${isActive ? 'active' : ''}" style="background:${member.color}" data-action="focusTeamMember" data-member-name="${escapeHtml(member.name)}" title="Vis ${escapeHtml(member.name)} på kartet" role="button" tabindex="0">${escapeHtml(member.initials)} <span class="chip-count">${member.count}</span></span>`;
    }
    if (wpFocusedTeamMember) {
      html += `<span class="wp-team-chip" style="background:var(--bg-tertiary, #666);font-size:11px;" data-action="focusTeamMember" data-member-name="${escapeHtml(wpFocusedTeamMember)}" title="Vis alle" role="button" tabindex="0"><i aria-hidden="true" class="fas fa-times"></i></span>`;
    }
    html += `</div>`;
  }

  // Build team color map for consistent coloring
  const teamColorMap = new Map(teamMembers.map(m => [m.name, m.color]));
  const currentUser = localStorage.getItem('userName') || '';
  const currentUserColor = teamColorMap.get(currentUser) || TEAM_COLORS[0];

  // Day list
  html += `<div class="wp-days">`;

  for (let i = 0; i < 5; i++) {
    const dayKey = weekDayKeys[i];
    const dayData = weekPlanState.days[dayKey];
    const dateStr = dayData.date;
    const dayDate = new Date(dateStr + 'T00:00:00');
    const isActive = weekPlanState.activeDay === dayKey;
    const isToday = todayStr === dateStr;
    const existingAvtaler = avtaler.filter(a => a.dato === dateStr);
    const plannedCount = dayData.planned.length;
    const existingCount = existingAvtaler.length;
    const hasContent = plannedCount > 0 || existingCount > 0;

    // Day row (clickable header)
    html += `<div class="wp-day ${isActive ? 'active' : ''} ${isToday ? 'today' : ''}" data-day="${dayKey}" data-action="setActiveDay" role="button" tabindex="0">`;

    // Day bar
    const estTotalBar = getDayEstimatedTotal(dayKey);
    html += `<div class="wp-day-bar">`;
    html += `<span class="wp-day-label">${weekDayLabels[i].substring(0, 3)}</span>`;
    html += `<span class="wp-day-date">${dayDate.getDate()}. ${monthNamesShort[dayDate.getMonth()]}</span>`;
    if (plannedCount > 0) {
      html += `<span class="wp-badge new">${plannedCount} ny${plannedCount > 1 ? 'e' : ''}</span>`;
    }
    if (existingCount > 0) {
      html += `<span class="wp-badge existing">${existingCount}</span>`;
    }
    if (estTotalBar > 0) {
      html += `<span class="wp-time-badge">~${formatMinutes(estTotalBar)}</span>`;
    }
    if (isActive) {
      html += `<i aria-hidden="true" class="fas fa-crosshairs wp-active-icon"></i>`;
    }
    html += `</div>`;

    // Expanded content (always visible if has content, or if active)
    if (hasContent || isActive) {
      html += `<div class="wp-day-content">`;

      // Progress bar showing estimated time vs 8-hour workday
      if (hasContent) {
        const estProgress = getDayEstimatedTotal(dayKey);
        const workdayMinutes = 480;
        const fillPct = Math.min(100, Math.round((estProgress / workdayMinutes) * 100));
        const overloaded = estProgress > workdayMinutes;
        html += `<div class="wp-progress-container">
          <div class="wp-progress-bar ${overloaded ? 'overloaded' : ''}" style="width:${fillPct}%"></div>
          <span class="wp-progress-label">${formatMinutes(estProgress)} / 8t</span>
        </div>`;
      }

      // Cumulative time tracker for timeline
      let cumulativeMin = 0;
      let stopIndex = 1;

      // Planned customers (new - with timeline)
      for (const c of dayData.planned) {
        const addrParts = [c.adresse, c.postnummer, c.poststed].filter(Boolean);
        const addrStr = addrParts.join(', ');
        const startTime = formatTimeOfDay(cumulativeMin);
        cumulativeMin += (c.estimertTid || 30);
        const endTime = formatTimeOfDay(cumulativeMin);
        const custAssignedName = c.addedBy || currentUser;
        const custInitials = custAssignedName ? getCreatorDisplay(custAssignedName, true) : '';
        const custColor = teamColorMap.get(custAssignedName) || currentUserColor;
        html += `
          <div class="wp-item new wp-timeline-item" data-customer-id="${c.id}" data-day="${dayKey}" style="border-left:3px solid ${custColor}">
            <span class="wp-stop-badge"><span class="wp-stop-num" style="background:${custColor}">${stopIndex}</span>${custInitials ? `<span class="wp-stop-initials" style="background:${custColor}">${escapeHtml(custInitials)}</span>` : ''}</span>
            <div class="wp-item-main">
              <span class="wp-item-name">${escapeHtml(c.navn)}</span>
              ${addrStr ? `<span class="wp-item-addr" title="${escapeHtml(addrStr)}">${escapeHtml(addrStr)}</span>` : ''}
              ${c.telefon ? `<span class="wp-item-phone"><i aria-hidden="true" class="fas fa-phone" style="font-size:8px;margin-right:3px;"></i>${escapeHtml(c.telefon)}</span>` : ''}
              <span class="wp-item-timerange"><i aria-hidden="true" class="fas fa-clock" style="font-size:8px;margin-right:2px;"></i>${startTime} - ${endTime}</span>
            </div>
            <div class="wp-item-meta">
              <input type="number" class="wp-time-input" value="${c.estimertTid || 30}" min="5" step="5"
                data-action="setEstimatedTime" data-day="${dayKey}" data-customer-id="${c.id}">
              <span>min</span>
              <button class="wp-remove" data-action="removeFromPlan" data-day="${dayKey}" data-customer-id="${c.id}" title="Fjern" aria-label="Fjern">&times;</button>
            </div>
          </div>`;
        stopIndex++;
      }

      // Existing avtaler (with team color-coded creator + timeline)
      for (const a of existingAvtaler) {
        const name = a.kunder?.navn || a.kunde_navn || 'Ukjent';
        const addr = [a.kunder?.adresse, a.kunder?.postnummer, a.kunder?.poststed].filter(Boolean).join(', ');
        const phone = a.kunder?.telefon || a.telefon || '';
        const creatorName = a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '';
        const creatorColor = creatorName ? (teamColorMap.get(creatorName) || '#999') : '';
        const exStartTime = formatTimeOfDay(cumulativeMin);
        cumulativeMin += (a.varighet || 30);
        const exEndTime = formatTimeOfDay(cumulativeMin);
        html += `
          <div class="wp-item existing wp-timeline-item" data-avtale-id="${a.id}" data-avtale-name="${escapeHtml(name)}" style="${creatorColor ? 'border-left:3px solid ' + creatorColor : ''}" title="${creatorName ? 'Opprettet av ' + escapeHtml(creatorName) : ''}">
            <span class="wp-stop-badge"><span class="wp-stop-num" style="background:${creatorColor || 'var(--bg-tertiary, #666)'}">${stopIndex}</span>${creatorName ? `<span class="wp-stop-initials" style="background:${creatorColor || 'var(--bg-tertiary, #666)'}">${escapeHtml(getCreatorDisplay(creatorName, true))}</span>` : ''}</span>
            <div class="wp-item-main">
              <span class="wp-item-name">${escapeHtml(name)}</span>
              ${addr ? `<span class="wp-item-addr">${escapeHtml(addr)}</span>` : ''}
              ${phone ? `<span class="wp-item-phone"><i aria-hidden="true" class="fas fa-phone" style="font-size:8px;margin-right:3px;"></i>${escapeHtml(phone)}</span>` : ''}
              <span class="wp-item-timerange"><i aria-hidden="true" class="fas fa-clock" style="font-size:8px;margin-right:2px;"></i>${exStartTime} - ${exEndTime}</span>
            </div>
            <button class="wp-remove" data-action="deleteAvtale" data-avtale-id="${a.id}" data-avtale-name="${escapeHtml(name)}" title="Slett avtale" aria-label="Fjern">&times;</button>
          </div>`;
        stopIndex++;
      }

      // Empty active day hint
      if (!hasContent && isActive) {
        html += `<div class="wp-empty-hint"><i aria-hidden="true" class="fas fa-crosshairs"></i> Dra over kunder på kartet eller søk etter kunde</div>`;
      }

      html += `</div>`;

      // Day footer with summary and action buttons
      if (hasContent) {
        const estTotal = getDayEstimatedTotal(dayKey);
        const totalCount = plannedCount + existingCount;
        const hasCoords = dayData.planned.some(c => c.lat && c.lng) ||
          existingAvtaler.some(a => { const k = customers.find(c => c.id === a.kunde_id); return k?.lat && k?.lng; });
        html += `<div class="wp-day-footer">`;
        html += `<div class="wp-day-stats">`;
        html += `<span class="wp-day-summary">${totalCount} stopp${estTotal > 0 ? ` · ~${formatMinutes(estTotal)}` : ''}</span>`;
        html += `</div>`;
        html += `<div class="wp-day-actions">`;
        if (hasCoords && totalCount >= 3) {
          html += `<button class="btn btn-small btn-secondary wp-opt-btn" data-action="wpOptimizeOrder" data-day="${dayKey}" title="Optimaliser rekkefølge" aria-label="Optimaliser rekkefølge"><i aria-hidden="true" class="fas fa-sort-amount-down"></i></button>`;
        }
        if (hasCoords) {
          html += `<button class="btn btn-small btn-secondary wp-nav-btn" data-action="wpNavigateDay" data-day="${dayKey}"><i aria-hidden="true" class="fas fa-directions"></i> Naviger</button>`;
        }
        html += `</div>`;
        html += `</div>`;
      }
    }

    html += `</div>`; // close wp-day
  }

  html += `</div>`; // close wp-days

  // Action bar (sticky at bottom)
  if (totalPlanned > 0) {
    html += `
      <div class="wp-actions">
        <button class="btn btn-primary wp-save-btn" data-action="saveWeeklyPlan"><i aria-hidden="true" class="fas fa-check"></i> Opprett ${totalPlanned} avtale${totalPlanned > 1 ? 'r' : ''}</button>
        <button class="btn btn-secondary wp-clear-btn" data-action="clearWeekPlan" aria-label="Tøm plan"><i aria-hidden="true" class="fas fa-trash"></i></button>
      </div>`;
  }

  html += `</div>`; // close wp-container
  container.innerHTML = html;

  // Customer search handler for active day
  const wpSearchInput = document.getElementById('wpCustomerSearch');
  if (wpSearchInput) {
    wpSearchInput.addEventListener('input', debounce(function() {
      const query = this.value.toLowerCase().trim();
      const resultsDiv = document.getElementById('wpSearchResults');
      if (!resultsDiv) return;

      if (query.length < 1) {
        resultsDiv.innerHTML = '';
        resultsDiv.style.display = 'none';
        return;
      }

      const dayKey = weekPlanState.activeDay;
      if (!dayKey || !weekPlanState.days[dayKey]) {
        resultsDiv.innerHTML = '<div class="wp-search-item wp-search-no-results">Velg en dag først</div>';
        resultsDiv.style.display = 'block';
        return;
      }
      const dayData = weekPlanState.days[dayKey];
      const dateStr = dayData.date;
      const existingIds = new Set(avtaler.filter(a => a.dato === dateStr).map(a => a.kunde_id));
      const plannedIds = new Set(dayData.planned.map(c => c.id));

      const filtered = customers.filter(c =>
        (c.navn && c.navn.toLowerCase().includes(query)) ||
        (c.poststed && c.poststed.toLowerCase().includes(query)) ||
        (c.adresse && c.adresse.toLowerCase().includes(query))
      );
      const matches = sortByNavn(filtered).slice(0, 8);

      if (matches.length === 0) {
        resultsDiv.innerHTML = '<div class="wp-search-item wp-search-no-results">Ingen kunder funnet</div>';
        resultsDiv.style.display = 'block';
        return;
      }

      resultsDiv.innerHTML = matches.map(c => {
        const alreadyAdded = existingIds.has(c.id) || plannedIds.has(c.id);
        const addrText = [c.adresse, c.poststed].filter(Boolean).join(', ');
        return `<div class="wp-search-item ${alreadyAdded ? 'disabled' : ''}"
          data-action="wpAddSearchResult" data-customer-id="${c.id}"
          ${alreadyAdded ? 'title="Allerede lagt til"' : ''} role="button" tabindex="0">
          <span class="wp-search-name">${escapeHtml(c.navn)}</span>
          <span class="wp-search-addr">${escapeHtml(addrText)}</span>
          ${alreadyAdded ? '<i aria-hidden="true" class="fas fa-check" style="color:var(--color-success, #10b981);"></i>' : '<i aria-hidden="true" class="fas fa-plus"></i>'}
        </div>`;
      }).join('');
      resultsDiv.style.display = 'block';
    }, 200));
  }

  // Right-click context menu on weekplan items
  container.addEventListener('contextmenu', (e) => {
    // Existing avtaler
    const existingItem = e.target.closest('.wp-item.existing[data-avtale-id]');
    if (existingItem) {
      e.preventDefault();
      const avtaleId = Number(existingItem.dataset.avtaleId);
      const avtale = typeof avtaler !== 'undefined' ? avtaler.find(a => a.id === avtaleId) : null;
      if (avtale) {
        showWeekplanExistingContextMenu(avtale, e.clientX, e.clientY);
      }
      return;
    }
    // Planned (unsaved) items
    const plannedItem = e.target.closest('.wp-item.new[data-customer-id]');
    if (plannedItem) {
      e.preventDefault();
      const customerId = Number(plannedItem.dataset.customerId);
      const dayKey = plannedItem.dataset.day;
      const customer = typeof customers !== 'undefined' ? customers.find(c => c.id === customerId) : null;
      if (customer && dayKey) {
        showWeekplanPlannedContextMenu(customer, dayKey, e.clientX, e.clientY);
      }
      return;
    }
  });

  // Update map markers with plan badges
  updateWeekPlanBadges();

  // Load travel times asynchronously for each day with content
  if (typeof MatrixService !== 'undefined') {
    for (let i = 0; i < 5; i++) {
      const dayKey = weekDayKeys[i];
      const dayData = weekPlanState.days[dayKey];
      const dateStr = dayData.date;
      const existingCount = avtaler.filter(a => a.dato === dateStr).length;
      if (dayData.planned.length > 0 || existingCount > 0) {
        wpLoadTravelTimes(dayKey);
      }
    }
  }
}

// Load and display travel times between stops for a day
async function wpLoadTravelTimes(dayKey) {
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return;

  const dateStr = dayData.date;
  const routeStart = getRouteStartLocation();
  if (!routeStart) return;

  // Build coordinate array: [office, stop1, stop2, ..., office]
  const coords = [[routeStart.lng, routeStart.lat]];

  for (const c of dayData.planned) {
    if (c.lat && c.lng) coords.push([c.lng, c.lat]);
  }

  const existingAvtaler = avtaler.filter(a => a.dato === dateStr);
  for (const a of existingAvtaler) {
    const kunde = customers.find(c => c.id === a.kunde_id);
    if (kunde?.lat && kunde?.lng) {
      coords.push([kunde.lng, kunde.lat]);
    }
  }

  // Return to office
  coords.push([startLng, startLat]);

  if (coords.length < 3) return; // Need at least office + 1 stop + office

  const times = await MatrixService.getSequentialTimes(coords);
  if (!times || times.length === 0) return;

  // Verify we're still showing this day (user might have navigated away)
  const dayEl = document.querySelector(`.wp-day[data-day="${dayKey}"] .wp-day-content`);
  if (!dayEl) return;

  // Remove any previously inserted separators
  dayEl.querySelectorAll('.wp-drive-separator').forEach(el => el.remove());

  const items = dayEl.querySelectorAll('.wp-timeline-item');

  items.forEach((item, idx) => {
    const time = times[idx]; // drive from previous to this stop
    if (!time || time.durationSec === 0) return;

    const driveMin = Math.round(time.durationSec / 60);
    const sep = document.createElement('div');
    sep.className = 'wp-drive-separator';
    sep.innerHTML = `<i aria-hidden="true" class="fas fa-car" style="font-size:9px"></i> ${formatMinutes(driveMin) || '0m'} kjøretid`;
    item.parentNode.insertBefore(sep, item);
  });

  // Update the footer summary with total driving info
  const totalDriveSec = times.reduce((sum, t) => sum + t.durationSec, 0);
  const totalDriveMin = Math.round(totalDriveSec / 60);
  const totalKm = Math.round(times.reduce((sum, t) => sum + t.distanceM, 0) / 1000);

  const summaryEl = dayEl.parentNode.querySelector('.wp-day-stats .wp-day-summary');
  if (summaryEl && totalDriveMin > 0) {
    summaryEl.textContent += ` · ${formatMinutes(totalDriveMin)} kjøretid · ${totalKm} km`;
  }
}

// Day-picker popup for adding customers to weekly plan from overdue/upcoming views
function showWeekPlanDayPicker(customerIdStr, anchorEl) {
  if (!weekPlanState.weekStart) initWeekPlanState(new Date());
  closeWeekPlanDayPicker();

  const popup = document.createElement('div');
  popup.id = 'wpDayPickerPopup';
  popup.className = 'wp-day-picker-popup';

  let html = '<div class="wp-day-picker-header">Velg dag i ukeplan</div><div class="wp-day-picker-days">';
  weekDayKeys.forEach((key, i) => {
    const dayData = weekPlanState.days[key];
    if (!dayData) return;
    const d = new Date(dayData.date + 'T00:00:00');
    const dateNum = d.getDate();
    const monthStr = monthNamesShort[d.getMonth()];
    const label = weekDayLabels[i];
    const planned = dayData.planned?.length || 0;
    const badge = planned > 0 ? ` <span class="wp-dp-badge">${planned}</span>` : '';
    html += `<button class="wp-dp-day-btn" data-wp-day="${key}" data-customer-ids="${escapeHtml(customerIdStr)}">
      <span class="wp-dp-day-name">${label}</span>
      <span class="wp-dp-day-date">${dateNum}. ${monthStr}${badge}</span>
    </button>`;
  });
  html += '</div>';
  popup.innerHTML = html;
  document.body.appendChild(popup);

  // Position relative to anchor button
  const rect = anchorEl.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  let top = rect.bottom + 4;
  let left = rect.left;
  if (top + popupRect.height > window.innerHeight) {
    top = rect.top - popupRect.height - 4;
  }
  if (left + popupRect.width > window.innerWidth) {
    left = window.innerWidth - popupRect.width - 8;
  }
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;

  // Day button click handlers
  popup.querySelectorAll('.wp-dp-day-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dayKey = btn.dataset.wpDay;
      const ids = btn.dataset.customerIds.split(',').map(id => Number.parseInt(id));
      const custList = ids.map(id => customers.find(c => c.id === id)).filter(Boolean);

      const prevActiveDay = weekPlanState.activeDay;
      weekPlanState.activeDay = dayKey;
      addCustomersToWeekPlan(custList);
      weekPlanState.activeDay = prevActiveDay;
      closeWeekPlanDayPicker();
    });
  });

  // Close on outside click (deferred)
  setTimeout(() => {
    const outsideHandler = (e) => {
      if (!popup.contains(e.target)) closeWeekPlanDayPicker();
    };
    document.addEventListener('click', outsideHandler, { once: true });
  }, 0);

  // Close on Escape
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeWeekPlanDayPicker();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function closeWeekPlanDayPicker() {
  document.getElementById('wpDayPickerPopup')?.remove();
}

function addCustomersToWeekPlan(customersList) {
  if (!weekPlanState.activeDay) return;

  const dayKey = weekPlanState.activeDay;
  const dayData = weekPlanState.days[dayKey];
  const dateStr = dayData.date;
  const existingAvtaleKundeIds = new Set(
    avtaler.filter(a => a.dato === dateStr).map(a => a.kunde_id)
  );

  let added = 0;
  let skippedExisting = 0;
  let skippedDuplicate = 0;

  for (const customer of customersList) {
    // Skip if already has an avtale for this date
    if (existingAvtaleKundeIds.has(customer.id)) {
      skippedExisting++;
      continue;
    }

    // Skip if already planned for this day
    if (dayData.planned.some(c => c.id === customer.id)) {
      skippedDuplicate++;
      continue;
    }

    dayData.planned.push({
      id: customer.id,
      navn: customer.navn,
      adresse: customer.adresse || '',
      postnummer: customer.postnummer || '',
      poststed: customer.poststed || '',
      telefon: customer.telefon || '',
      kategori: customer.kategori || null,
      lat: customer.lat || null,
      lng: customer.lng || null,
      estimertTid: customer.estimert_tid || 30,
      addedBy: weekPlanState.globalAssignedTo || localStorage.getItem('userName') || 'admin'
    });
    added++;
  }

  let msg = `${added} kunder lagt til ${weekDayLabels[weekDayKeys.indexOf(dayKey)]}`;
  if (skippedExisting > 0) msg += ` (${skippedExisting} har allerede avtale)`;
  if (skippedDuplicate > 0) msg += ` (${skippedDuplicate} allerede lagt til)`;
  showToast(msg, added > 0 ? 'success' : 'info');

  renderWeeklyPlan();
}

// Add a single customer to weekplan from map tooltip/context menu
function addToWeekPlanFromMap(customerId) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;
  if (!weekPlanState.activeDay) {
    showToast('Åpne ukeplanen og velg en dag først', 'info');
    return;
  }
  addCustomersToWeekPlan([customer]);
}

async function saveWeeklyPlan() {
  const totalPlanned = getWeekPlanTotalPlanned();
  if (totalPlanned === 0) return;

  const confirmed = await showConfirm(
    `Opprett ${totalPlanned} avtaler for uke ${getISOWeekNumber(weekPlanState.weekStart)}?`,
    'Bekreft oppretting'
  );
  if (!confirmed) return;

  let created = 0;
  let errors = 0;
  let lastError = '';
  const userName = localStorage.getItem('userName') || 'admin';

  // Collect all planned items with per-customer technician assignment
  const allItems = [];
  for (const dayKey of weekDayKeys) {
    const dayData = weekPlanState.days[dayKey];
    for (const customer of dayData.planned) {
      const assignedName = customer.addedBy || weekPlanState.globalAssignedTo || userName;
      allItems.push({ customer, date: dayData.date, opprettetAv: assignedName });
    }
  }

  // Show progress toast
  const progressToast = showToast(`Oppretter avtaler... 0/${allItems.length}`, 'info', 0);

  // Process in parallel batches of 5
  const BATCH_SIZE = 5;
  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    const batch = allItems.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ customer, date, opprettetAv }) => {
        const payload = {
          kunde_id: customer.id,
          dato: date,
          beskrivelse: customer.kategori || 'Planlagt oppdrag',
          opprettet_av: opprettetAv,
          varighet: customer.estimertTid || 30
        };
        const response = await apiFetch('/api/avtaler', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData.error?.message || errData.error || errData.message || response.statusText;
          throw new Error(`${customer.navn}: ${errMsg}`);
        }
        return customer.navn;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        created++;
      } else {
        errors++;
        lastError = r.reason?.message || 'Ukjent feil';
        console.error('Avtale-feil:', r.reason);
      }
    }

    // Update progress
    if (progressToast) {
      const done = Math.min(i + BATCH_SIZE, allItems.length);
      const span = progressToast.querySelector('span');
      if (span) span.textContent = `Oppretter avtaler... ${done}/${allItems.length}`;
    }
  }

  // Remove progress toast
  if (progressToast) progressToast.remove();

  if (created > 0) {
    showToast(`${created} avtaler opprettet!`, 'success');
  }
  if (errors > 0) {
    showToast(`${errors} avtaler feilet: ${lastError}`, 'error');
  }

  // Clear planned, reload
  for (const dayKey of weekDayKeys) {
    weekPlanState.days[dayKey].planned = [];
  }
  weekPlanState.activeDay = null;

  // Deactivate area select if active
  if (areaSelectMode) toggleAreaSelect();

  await loadAvtaler();
  refreshTeamFocus();
  renderWeeklyPlan();
}

// Weekplan context menu is now handled by the generic showContextMenu() system
// See context-menu.js: showWeekplanExistingContextMenu() and showWeekplanPlannedContextMenu()

function clearWeekPlan() {
  for (const dayKey of weekDayKeys) {
    weekPlanState.days[dayKey].planned = [];
  }
  weekPlanState.activeDay = null;
  if (areaSelectMode) toggleAreaSelect();
  refreshTeamFocus();
  renderWeeklyPlan();
  showToast('Plan tømt', 'info');
}

async function wpOptimizeOrder(dayKey) {
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return;

  const stops = dayData.planned.filter(c => c.lat && c.lng);
  if (stops.length < 3) {
    showToast('Trenger minst 3 stopp for optimalisering', 'info');
    return;
  }

  const routeStart = getRouteStartLocation();
  if (!routeStart) {
    showToast('Sett firmaadresse i admin for å optimalisere rekkefølge', 'warning');
    return;
  }
  const loadingToast = showToast('Optimaliserer rekkefølge...', 'info', 0);

  try {
    const optimizeBody = {
      jobs: stops.map((s, idx) => ({
        id: idx + 1,
        location: [s.lng, s.lat],
        service: (s.estimertTid || 30) * 60
      })),
      vehicles: [{
        id: 1,
        profile: 'driving-car',
        start: [routeStart.lng, routeStart.lat],
        end: [routeStart.lng, routeStart.lat]
      }]
    };

    const headers = { 'Content-Type': 'application/json' };
    const csrfToken = getCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const response = await fetch('/api/routes/optimize', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(optimizeBody)
    });

    if (loadingToast) loadingToast.remove();

    if (!response.ok) {
      showToast('Kunne ikke optimalisere rute', 'error');
      return;
    }

    const result = await response.json();
    const optData = result.data || result;
    if (optData.routes?.[0]?.steps) {
      const jobSteps = optData.routes[0].steps.filter(s => s.type === 'job');
      const optimizedStops = jobSteps.map(step => stops[step.job - 1]).filter(Boolean);
      if (optimizedStops.length === stops.length) {
        const plannedOptimized = [];
        for (const s of optimizedStops) {
          const p = dayData.planned.find(c => c.id === s.id);
          if (p) plannedOptimized.push(p);
        }
        for (const p of dayData.planned) {
          if (!plannedOptimized.some(o => o.id === p.id)) plannedOptimized.push(p);
        }
        dayData.planned = plannedOptimized;
        renderWeeklyPlan();
        showToast('Rekkefølge optimalisert', 'success');
      }
    }
  } catch (err) {
    if (loadingToast) loadingToast.remove();
    console.warn('[wpOptimizeOrder] Failed:', err);
    showToast('Feil ved optimalisering', 'error');
  }
}

async function wpNavigateDay(dayKey) {
  const dayData = weekPlanState.days[dayKey];
  if (!dayData) return;
  const dateStr = dayData.date;

  // Collect all customers with coordinates + estimated time
  const stops = [];

  // Planned customers
  for (const c of dayData.planned) {
    if (c.lat && c.lng) {
      stops.push({ id: c.id, lat: c.lat, lng: c.lng, navn: c.navn, adresse: c.adresse || '', estimertTid: c.estimertTid || 30 });
    }
  }

  // Existing avtaler - look up coordinates from customers array
  const existingAvtaler = avtaler.filter(a => a.dato === dateStr);
  for (const a of existingAvtaler) {
    const kunde = customers.find(c => c.id === a.kunde_id);
    if (kunde?.lat && kunde?.lng) {
      if (!stops.some(s => s.lat === kunde.lat && s.lng === kunde.lng)) {
        stops.push({ id: kunde.id, lat: kunde.lat, lng: kunde.lng, navn: kunde.navn, adresse: kunde.adresse || '', estimertTid: 30 });
      }
    }
  }

  if (stops.length === 0) {
    showToast('Ingen kunder med koordinater for denne dagen', 'info');
    return;
  }

  const routeStart = getRouteStartLocation();
  if (!routeStart) {
    showToast('Sett firmaadresse i admin for å tegne rute', 'warning');
    return;
  }
  const startLatLng = [routeStart.lat, routeStart.lng];

  // Loading toast
  const loadingToast = showToast('Optimaliserer rute...', 'info', 0);

  // Step 1: Optimize stop order via VROOM (3+ stops)
  if (stops.length >= 3) {
    try {
      const optimizeBody = {
        jobs: stops.map((s, idx) => ({
          id: idx + 1,
          location: [s.lng, s.lat],
          service: (s.estimertTid || 30) * 60
        })),
        vehicles: [{
          id: 1,
          profile: 'driving-car',
          start: [routeStart.lng, routeStart.lat],
          end: [routeStart.lng, routeStart.lat]
        }]
      };

      const optHeaders = { 'Content-Type': 'application/json' };
      const optCsrf = getCsrfToken();
      if (optCsrf) optHeaders['X-CSRF-Token'] = optCsrf;

      const optResp = await fetch('/api/routes/optimize', {
        method: 'POST',
        headers: optHeaders,
        credentials: 'include',
        body: JSON.stringify(optimizeBody)
      });

      if (optResp.ok) {
        const optResult = await optResp.json();
        const optData = optResult.data || optResult;
        if (optData.routes?.[0]?.steps) {
          const jobSteps = optData.routes[0].steps.filter(s => s.type === 'job');
          const optimizedStops = jobSteps.map(step => stops[step.job - 1]).filter(Boolean);
          if (optimizedStops.length === stops.length) {
            // Reorder stops array
            stops.length = 0;
            stops.push(...optimizedStops);
            // Reorder planned array in state to match
            const plannedOptimized = [];
            for (const s of optimizedStops) {
              const p = dayData.planned.find(c => c.id === s.id);
              if (p) plannedOptimized.push(p);
            }
            for (const p of dayData.planned) {
              if (!plannedOptimized.some(o => o.id === p.id)) plannedOptimized.push(p);
            }
            dayData.planned = plannedOptimized;
            renderWeeklyPlan();
          }
        }
      }
    } catch (e) {
      console.warn('[wpNavigateDay] Optimization failed, using original order:', e);
    }
  }

  // Step 2: Build coordinates and get directions
  if (loadingToast) loadingToast.textContent = 'Beregner rute...';
  const coordinates = [
    [routeStart.lng, routeStart.lat],
    ...stops.map(s => [s.lng, s.lat]),
    [routeStart.lng, routeStart.lat]
  ];

  try {
    const headers = { 'Content-Type': 'application/json' };
    const csrfToken = getCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const response = await fetch('/api/routes/directions', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ coordinates })
    });

    // Remove loading toast
    if (loadingToast) loadingToast.remove();

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error('[wpNavigateDay] API error:', response.status, errBody);
      showToast(`Kunne ikke beregne rute (${response.status})`, 'error');
      return;
    }

    const rawData = await response.json();

    // Handle wrapped ({ success, data: {...} }) or raw ORS response
    const geoData = rawData.data || rawData;
    const feature = geoData.features?.[0];

    // Extract driving summary
    let drivingSeconds = 0;
    let distanceMeters = 0;
    if (feature?.properties?.summary) {
      drivingSeconds = feature.properties.summary.duration || 0;
      distanceMeters = feature.properties.summary.distance || 0;
    }
    // Fallback: sum segments if no top-level summary
    if (drivingSeconds === 0 && feature?.properties?.segments?.length > 0) {
      for (const seg of feature.properties.segments) {
        drivingSeconds += seg.duration || 0;
        distanceMeters += seg.distance || 0;
      }
    }

    // Clear any existing route
    clearRoute();

    // Dim all markers/clusters via CSS class on map
    wpRouteActive = true;
    wpRouteStopIds = new Set(stops.map(s => Number(s.id)));
    applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();

    // Build route line: start → stop1 → stop2 → ... → start
    // Note: startLatLng is [lat, lng], convert to [lng, lat] for GeoJSON
    const lineCoords = [
      [startLatLng[1], startLatLng[0]],
      ...stops.map(s => [s.lng, s.lat]),
      [startLatLng[1], startLatLng[0]]
    ];

    // Try ORS road-following geometry, fall back to straight lines
    let routeDrawn = false;
    if (feature?.geometry?.coordinates?.length > 2) {
      try {
        const geomType = feature.geometry.type;
        let routeCoords;
        if (geomType === 'MultiLineString') {
          routeCoords = feature.geometry.coordinates.flat();
        } else {
          routeCoords = feature.geometry.coordinates;
        }
        if (routeCoords.length > 2 && !isNaN(routeCoords[0][0]) && !isNaN(routeCoords[0][1])) {
          drawRouteGeoJSON(routeCoords, { color: '#2563eb', width: 5, opacity: 0.85 });
          routeDrawn = true;
        }
      } catch (e) {
        console.warn('[wpNavigateDay] ORS geometry failed:', e);
      }
    }
    // Fallback: straight dashed lines between stops
    if (!routeDrawn) {
      drawRouteGeoJSON(lineCoords, { color: '#2563eb', width: 4, opacity: 0.7, dasharray: [10, 8] });
    }

    // Fit map to route
    const allBounds = boundsFromLatLngArray([startLatLng, ...stops.map(s => [s.lat, s.lng])]);
    map.fitBounds(allBounds, { padding: 50 });

    // Store for export to Maps
    currentRouteData = { customers: stops, duration: drivingSeconds, distance: distanceMeters };

    // Show summary panel
    showWpRouteSummary(dayKey, stops, drivingSeconds, distanceMeters);

  } catch (err) {
    if (loadingToast) loadingToast.remove();
    console.error('Ruteberegning feilet:', err);
    showToast('Feil ved ruteberegning', 'error');
    wpRouteActive = false;
    wpRouteStopIds = null;
    applyTeamFocusToMarkers();
    if (typeof refreshClusters === 'function') refreshClusters();
  }
}

// Show weekly plan route summary panel
function showWpRouteSummary(dayKey, stops, drivingSeconds, distanceMeters) {
  // Only remove previous panel element (don't clear route - we just drew a new one)
  const oldPanel = document.getElementById('wpRouteSummary');
  if (oldPanel) oldPanel.remove();

  const drivingMin = Math.round(drivingSeconds / 60);
  const customerMin = stops.reduce((sum, s) => sum + (s.estimertTid || 30), 0);
  const totalMin = drivingMin + customerMin;
  const km = (distanceMeters / 1000).toFixed(1);
  const dayLabel = weekDayLabels[weekDayKeys.indexOf(dayKey)];

  const panel = document.createElement('div');
  panel.id = 'wpRouteSummary';
  panel.className = 'wp-route-summary';
  panel.innerHTML = `
    <div class="wp-route-header">
      <strong>${escapeHtml(dayLabel)} — ${stops.length} stopp</strong>
      <button class="wp-route-close" data-action="closeWpRoute" aria-label="Fjern">&times;</button>
    </div>
    <div class="wp-route-stats">
      <div class="wp-route-stat">
        <i aria-hidden="true" class="fas fa-car"></i>
        <span>Kjøretid: ~${formatMinutes(drivingMin)}</span>
      </div>
      <div class="wp-route-stat">
        <i aria-hidden="true" class="fas fa-user-clock"></i>
        <span>Hos kunder: ~${formatMinutes(customerMin)}</span>
      </div>
      <div class="wp-route-stat total">
        <i aria-hidden="true" class="fas fa-clock"></i>
        <span>Totalt: ~${formatMinutes(totalMin)}</span>
      </div>
      <div class="wp-route-stat">
        <i aria-hidden="true" class="fas fa-road"></i>
        <span>${km} km</span>
      </div>
    </div>
    <div class="wp-route-actions">
      <button class="btn btn-small btn-primary" data-action="wpExportMaps" data-day="${dayKey}">
        <i aria-hidden="true" class="fas fa-external-link-alt"></i> Åpne i Maps
      </button>
      <button class="btn btn-small btn-secondary" data-action="closeWpRoute">
        <i aria-hidden="true" class="fas fa-times"></i> Lukk rute
      </button>
    </div>
  `;

  document.body.appendChild(panel);
}

// Close weekly plan route summary and clear route from map
function closeWpRouteSummary() {
  const panel = document.getElementById('wpRouteSummary');
  if (panel) panel.remove();
  clearRoute();
  wpRouteActive = false;
  wpRouteStopIds = null;
  applyTeamFocusToMarkers();
  if (typeof refreshClusters === 'function') refreshClusters();
}

// Export weekly plan route to Google/Apple Maps
function wpExportToMaps() {
  if (!currentRouteData || !currentRouteData.customers.length) return;

  const stops = currentRouteData.customers;
  const routeStart = getRouteStartLocation();
  if (!routeStart) {
    showToast('Sett firmaadresse i admin for å eksportere rute', 'warning');
    return;
  }
  const startCoord = `${routeStart.lat},${routeStart.lng}`;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isIOS) {
    const daddr = stops.map(s => `${s.lat},${s.lng}`).join('+to:') + `+to:${startCoord}`;
    window.open(`https://maps.apple.com/?saddr=${startCoord}&daddr=${daddr}&dirflg=d`, '_blank');
  } else {
    const waypoints = stops.map(s => `${s.lat},${s.lng}`).join('|');
    let url = `https://www.google.com/maps/dir/?api=1&origin=${startCoord}&destination=${startCoord}`;
    url += `&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`;
    window.open(url, '_blank');
  }
}

// === Quick Calendar Menu (from map markers) ===

function closeCalendarQuickMenu() {
  document.getElementById('quickCalendarMenu')?.remove();
  document.removeEventListener('click', handleQuickMenuOutsideClick);
}

function handleQuickMenuOutsideClick(e) {
  const menu = document.getElementById('quickCalendarMenu');
  if (menu && !menu.contains(e.target)) {
    closeCalendarQuickMenu();
  }
}

function showCalendarQuickMenu(customerId, customerName, anchorEl) {
  closeCalendarQuickMenu();

  const today = new Date();
  const tomorrow = addDaysToDate(today, 1);
  const nextMonday = getNextMonday(today);

  const menu = document.createElement('div');
  menu.id = 'quickCalendarMenu';
  menu.className = 'quick-calendar-menu';
  menu.innerHTML = `
    <div class="quick-menu-header">${escapeHtml(customerName)}</div>
    <div class="quick-menu-item" data-action="quickAddAvtale" data-customer-id="${customerId}" data-customer-name="${escapeHtml(customerName)}" data-quick-date="${formatDateISO(today)}" role="button" tabindex="0">
      <i aria-hidden="true" class="fas fa-calendar-day"></i> I dag (${today.getDate()}.${today.getMonth() + 1})
    </div>
    <div class="quick-menu-item" data-action="quickAddAvtale" data-customer-id="${customerId}" data-customer-name="${escapeHtml(customerName)}" data-quick-date="${formatDateISO(tomorrow)}" role="button" tabindex="0">
      <i aria-hidden="true" class="fas fa-calendar-day"></i> I morgen (${tomorrow.getDate()}.${tomorrow.getMonth() + 1})
    </div>
    <div class="quick-menu-item" data-action="quickAddAvtale" data-customer-id="${customerId}" data-customer-name="${escapeHtml(customerName)}" data-quick-date="${formatDateISO(nextMonday)}" role="button" tabindex="0">
      <i aria-hidden="true" class="fas fa-calendar-week"></i> Neste mandag (${nextMonday.getDate()}.${nextMonday.getMonth() + 1})
    </div>
    <div class="quick-menu-item" data-action="addCustomerToCalendar" data-customer-id="${customerId}" data-customer-name="${escapeHtml(customerName)}" role="button" tabindex="0">
      <i aria-hidden="true" class="fas fa-calendar-alt"></i> Velg dato...
    </div>
  `;

  document.body.appendChild(menu);

  // Position near anchor element
  if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    menu.style.left = Math.min(rect.left, window.innerWidth - 200) + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';
  } else {
    menu.style.left = '50%';
    menu.style.top = '50%';
    menu.style.transform = 'translate(-50%, -50%)';
  }

  // Ensure menu stays within viewport
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - menuRect.height - 10) + 'px';
    }
    if (menuRect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - menuRect.width - 10) + 'px';
    }
  });

  setTimeout(() => {
    document.addEventListener('click', handleQuickMenuOutsideClick);
  }, 10);
}

async function quickAddAvtaleForDate(customerId, customerName, date) {
  const customer = customers.find(c => c.id === customerId);
  const avtaleType = customer?.kategori || 'Kontroll';
  const varighet = customer?.estimert_tid || undefined;

  try {
    const response = await apiFetch('/api/avtaler', {
      method: 'POST',
      body: JSON.stringify({
        kunde_id: customerId,
        dato: date,
        type: avtaleType,
        beskrivelse: avtaleType,
        varighet,
        opprettet_av: localStorage.getItem('userName') || 'admin'
      })
    });

    if (response.ok) {
      showToast(`${customerName} lagt til ${date}`, 'success');
      await loadAvtaler();
      renderCalendar();
      if (splitViewOpen) renderSplitWeekContent();
    } else {
      const err = await response.json().catch(() => ({}));
      showToast('Kunne ikke opprette avtale: ' + (err.error || 'ukjent feil'), 'error');
    }
  } catch (err) {
    console.error('Error quick-adding avtale:', err);
    showToast('Kunne ikke opprette avtale', 'error');
  }
}


// Format minutes as "Xt Ym" for calendar display
function formatEstTid(min) {
  if (!min || min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}t ${m}m` : `${h}t`;
}

// Build Google Maps directions URL for a list of avtaler on a given date
// Route: Kontor → kunde1 → kunde2 → ... → Kontor
function buildGoogleMapsUrl(dayAvtaler) {
  // Office start/end point
  const officeLat = appConfig.routeStartLat;
  const officeLng = appConfig.routeStartLng;
  const officeAddr = appConfig.routeStartAddress;
  let officeWaypoint = null;
  if (officeLat && officeLng) {
    officeWaypoint = `${officeLat},${officeLng}`;
  } else if (officeAddr) {
    officeWaypoint = officeAddr;
  }

  const stops = [];
  for (const a of dayAvtaler) {
    const kunde = customers.find(c => c.id === a.kunde_id);
    if (!kunde) continue;
    if (kunde.lat && kunde.lng) {
      stops.push(`${kunde.lat},${kunde.lng}`);
    } else {
      const parts = [kunde.adresse, kunde.postnummer, kunde.poststed].filter(Boolean);
      if (parts.length > 0) stops.push(parts.join(', '));
    }
  }
  if (stops.length === 0) return null;

  // Build route: office → stops → office
  const waypoints = [];
  if (officeWaypoint) waypoints.push(officeWaypoint);
  waypoints.push(...stops);
  if (officeWaypoint) waypoints.push(officeWaypoint);

  return 'https://www.google.com/maps/dir/' + waypoints.map(a => encodeURIComponent(a)).join('/');
}

function getAvtaleServiceColor(avtale) {
  const kunde = customers.find(c => c.id === avtale.kunde_id);
  const kategori = kunde?.kategori || avtale.type || '';
  if (!kategori) return null;
  const serviceTypes = serviceTypeRegistry.getAll();
  for (const st of serviceTypes) {
    if (kategori === st.name || kategori.includes(st.name)) return st.color;
  }
  return null;
}

function getAvtaleServiceIcon(avtale) {
  const kunde = customers.find(c => c.id === avtale.kunde_id);
  const kategori = kunde?.kategori || avtale.type || '';
  if (!kategori) return '';
  return serviceTypeRegistry.getIconForCategory(kategori);
}

async function loadAvtaler() {
  try {
    const response = await apiFetch('/api/avtaler');
    if (response.ok) {
      const avtaleResult = await response.json();
      avtaler = avtaleResult.data || avtaleResult;
      // Refresh plan badges on map if weekly plan is active
      if (weekPlanState.weekStart) {
        updateWeekPlanBadges();
      }
    }
  } catch (error) {
    console.error('Error loading avtaler:', error);
  }
}

// Calendar rendering with avtaler support
async function renderCalendar() {
  const container = document.getElementById('calendarContainer');
  if (!container) return;

  // Load avtaler if not already loaded
  if (avtaler.length === 0) {
    await loadAvtaler();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get avtaler for this month
  const monthAvtaler = avtaler.filter(a => {
    const d = new Date(a.dato);
    return d.getMonth() === currentCalendarMonth && d.getFullYear() === currentCalendarYear;
  });

  const daysInMonth = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();
  const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay();

  const monthNames = ['Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Desember'];

  let html = `
    <div class="calendar-header">
      <button class="calendar-nav" id="prevMonth" aria-label="Forrige måned"><i aria-hidden="true" class="fas fa-chevron-left"></i></button>
      <h3>${monthNames[currentCalendarMonth]} ${currentCalendarYear}</h3>
      <button class="calendar-nav" id="nextMonth" aria-label="Neste måned"><i aria-hidden="true" class="fas fa-chevron-right"></i></button>
      <div style="margin-left:auto;display:flex;gap:4px;">
        <button class="btn btn-small ${calendarViewMode === 'week' ? 'btn-primary' : 'btn-secondary'}" id="toggleWeekView">
          <i aria-hidden="true" class="fas fa-calendar-week"></i> Uke
        </button>
        <button class="btn btn-small btn-primary" id="openCalendarSplit" title="Åpne fullskjerm kalender" aria-label="Åpne fullskjerm kalender">
          <i aria-hidden="true" class="fas fa-expand"></i>
        </button>
        <button class="btn btn-primary calendar-add-btn" id="addAvtaleBtn">
          <i aria-hidden="true" class="fas fa-plus"></i> Ny avtale
        </button>
      </div>
    </div>
    <div class="calendar-grid">
      <div class="calendar-day-header">Man</div>
      <div class="calendar-day-header">Tir</div>
      <div class="calendar-day-header">Ons</div>
      <div class="calendar-day-header">Tor</div>
      <div class="calendar-day-header">Fre</div>
      <div class="calendar-day-header">Lør</div>
      <div class="calendar-day-header">Søn</div>
  `;

  // Adjust for Monday start (European calendar)
  const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1;

  // Empty cells before first day
  for (let i = 0; i < adjustedFirstDay; i++) {
    html += '<div class="calendar-day empty"></div>';
  }

  // Days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentCalendarYear}-${String(currentCalendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayAvtaler = monthAvtaler.filter(a => a.dato === dateStr);
    const dayDate = new Date(currentCalendarYear, currentCalendarMonth, day);
    const isToday = dayDate.getTime() === today.getTime();
    const isPast = dayDate < today;
    const hasContent = dayAvtaler.length > 0;

    const areaHint = dayAvtaler.length > 0 ? getAreaTooltip(dayAvtaler) : '';
    const areaCount = dayAvtaler.length > 0 ? getUniqueAreas(dayAvtaler).size : 0;

    html += `
      <div class="calendar-day ${isToday ? 'today' : ''} ${isPast ? 'past' : ''} ${hasContent ? 'has-content' : ''}"
           data-date="${dateStr}" data-action="openDayDetail" role="button" tabindex="0">
        <div class="day-top-row">
          <span class="day-number">${day}</span>
          ${areaCount > 0 ? `<span class="day-area-hint" title="${escapeHtml(areaHint)}">${areaCount} omr.</span>` : ''}
          ${dayAvtaler.length >= 2 ? `<a class="day-gmaps" href="${buildGoogleMapsUrl(dayAvtaler)}" target="_blank" rel="noopener" title="Åpne rute i Google Maps" onclick="event.stopPropagation()"><i aria-hidden="true" class="fas fa-directions"></i></a>` : ''}
        </div>
        <div class="calendar-events">
          ${dayAvtaler.map(a => {
            const serviceColor = getAvtaleServiceColor(a);
            const serviceIcon = getAvtaleServiceIcon(a);
            const poststed = a.kunder?.poststed || '';
            return `
            <div class="calendar-avtale ${a.status === 'fullført' ? 'completed' : ''}"
                 data-avtale-id="${a.id}"${serviceColor ? ` style="border-left-color:${serviceColor}"` : ''}>
              <div class="avtale-content" data-avtale-id="${a.id}" data-action="editAvtale" role="button" tabindex="0">
                ${a.status === 'fullført' ? '<i aria-hidden="true" class="fas fa-check" style="font-size:0.6em;margin-right:2px;color:var(--color-good)" title="Fullført"></i><span class="sr-only">Fullført:</span>' : ''}${serviceIcon ? `<span class="avtale-service-icon">${serviceIcon}</span>` : ''}${a.rute_id ? '<i aria-hidden="true" class="fas fa-route" style="font-size:0.6em;margin-right:2px;color:var(--primary)" title="Fra rute"></i>' : ''}${a.er_gjentakelse || a.original_avtale_id ? '<i aria-hidden="true" class="fas fa-sync-alt" style="font-size:0.6em;margin-right:2px" title="Gjentakende"></i>' : ''}
                ${a.klokkeslett ? `<span class="avtale-time">${a.klokkeslett.substring(0, 5)}</span>` : ''}
                <span class="avtale-kunde">${escapeHtml(a.kunder?.navn || a.kunde_navn || 'Ukjent')}</span>
                ${poststed ? `<span class="avtale-poststed">${escapeHtml(poststed)}</span>` : ''}
                ${a.opprettet_av && a.opprettet_av !== 'admin' ? `<span class="avtale-creator" title="Opprettet av ${escapeHtml(a.opprettet_av)}">${escapeHtml(getCreatorDisplay(a.opprettet_av, true))}</span>` : ''}
              </div>
              <button class="avtale-quick-delete" data-action="quickDeleteAvtale" data-avtale-id="${a.id}" title="Slett avtale" aria-label="Slett avtale"><i aria-hidden="true" class="fas fa-times"></i></button>
            </div>
          `; }).join('')}
        </div>
      </div>
    `;
  }

  html += '</div>';

  // === UKEVISNING ===
  if (calendarViewMode === 'week' && currentWeekStart) {
    // Erstatt månedsgriden med ukevisning
    const weekDayNames = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
    const weekNum = getISOWeekNumber(currentWeekStart);

    html = `
      <div class="calendar-header">
        <button class="calendar-nav" id="prevWeek" aria-label="Forrige uke"><i aria-hidden="true" class="fas fa-chevron-left"></i></button>
        <h3>Uke ${weekNum} - ${currentWeekStart.getFullYear()}</h3>
        <button class="calendar-nav" id="nextWeek" aria-label="Neste uke"><i aria-hidden="true" class="fas fa-chevron-right"></i></button>
        <div style="margin-left:auto;display:flex;gap:4px;">
          <button class="btn btn-small btn-primary" id="openCalendarSplit" title="Åpne fullskjerm kalender" aria-label="Åpne fullskjerm kalender">
            <i aria-hidden="true" class="fas fa-expand"></i>
          </button>
          <button class="btn btn-small btn-secondary" id="toggleWeekView">
            <i aria-hidden="true" class="fas fa-calendar-alt"></i> Måned
          </button>
          <button class="btn btn-primary calendar-add-btn" id="addAvtaleBtn">
            <i aria-hidden="true" class="fas fa-plus"></i> Ny avtale
          </button>
        </div>
      </div>
      <div class="week-view">
    `;

    let totalWeekMinutes = 0;
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(currentWeekStart);
      dayDate.setDate(currentWeekStart.getDate() + i);
      const dateStr = formatDateISO(dayDate);
      const todayCheck = new Date();
      todayCheck.setHours(0, 0, 0, 0);
      const isToday = dayDate.getTime() === todayCheck.getTime();

      const dayAvtaler = avtaler.filter(a => a.dato === dateStr);

      // Beregn total estimert tid for denne dagen
      let dayMinutes = 0;
      dayAvtaler.forEach(a => {
        const kunde = customers.find(c => c.id === a.kunde_id);
        if (kunde?.estimert_tid) dayMinutes += kunde.estimert_tid;
      });
      totalWeekMinutes += dayMinutes;

      html += `
        <div class="week-day ${isToday ? 'today' : ''}" data-date="${dateStr}">
          <div class="week-day-header">
            <span class="week-day-name">${weekDayNames[i].substring(0, 3)}</span>
            <span class="week-day-date">${dayDate.getDate()}</span>
            ${dayMinutes > 0 ? `<span class="week-day-time">${formatEstTid(dayMinutes)}</span>` : ''}
            ${dayAvtaler.length >= 2 ? `<a class="week-day-gmaps" href="${buildGoogleMapsUrl(dayAvtaler)}" target="_blank" rel="noopener" title="Åpne rute i Google Maps"><i aria-hidden="true" class="fas fa-directions"></i></a>` : ''}
          </div>
          ${renderAreaBadges(dayAvtaler)}
          <div class="week-day-content">
            ${dayAvtaler.map(a => {
              const navn = a.kunder?.navn || a.kunde_navn || 'Ukjent';
              const addr = [a.kunder?.adresse || '', a.kunder?.postnummer || '', a.kunder?.poststed || ''].filter(Boolean).join(', ');
              const phone = a.kunder?.telefon || a.telefon || '';
              const creator = a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '';
              const initials = creator ? getCreatorDisplay(creator, true) : '';
              const serviceColor = getAvtaleServiceColor(a);
              const serviceIcon = getAvtaleServiceIcon(a);
              const kunde = customers.find(c => c.id === a.kunde_id);
              const estTid = a.varighet || kunde?.estimert_tid || 0;
              return `
                <div class="week-avtale-card ${a.status === 'fullført' ? 'completed' : ''}" data-avtale-id="${a.id}" data-action="editAvtale" role="button" tabindex="0"${serviceColor ? ` style="border-left-color:${serviceColor}"` : ''}>
                  <div class="week-card-header">
                    ${a.status === 'fullført' ? '<i aria-hidden="true" class="fas fa-check" style="font-size:0.6em;margin-right:2px;color:var(--color-good)" title="Fullført"></i><span class="sr-only">Fullført:</span>' : ''}${serviceIcon ? `<span class="avtale-service-icon">${serviceIcon}</span>` : ''}
                    ${initials ? `<span class="week-card-initials" title="${escapeHtml(creator)}">${escapeHtml(initials)}</span>` : ''}
                    <span class="week-card-name">${escapeHtml(navn)}</span>
                    ${estTid ? `<span class="avtale-duration">${formatEstTid(estTid)}</span>` : ''}
                    <button class="week-card-delete" data-action="quickDeleteAvtale" data-avtale-id="${a.id}" title="Slett avtale" aria-label="Slett avtale"><i aria-hidden="true" class="fas fa-times"></i></button>
                  </div>
                  ${addr ? `<div class="week-card-addr">${escapeHtml(addr)}</div>` : ''}
                  ${phone ? `<div class="week-card-phone"><i aria-hidden="true" class="fas fa-phone"></i>${escapeHtml(phone)}</div>` : ''}
                  ${a.klokkeslett ? `<div class="week-card-time"><i aria-hidden="true" class="fas fa-clock"></i>${a.klokkeslett.substring(0, 5)}${a.varighet ? ` (${formatEstTid(a.varighet)})` : ''}</div>` : ''}
                </div>
              `;
            }).join('')}
            ${dayAvtaler.length === 0 ? '<div class="week-empty">Ingen avtaler</div>' : ''}
          </div>
          <div class="week-day-add" data-date="${dateStr}" data-action="openDayDetail" role="button" tabindex="0">
            <i aria-hidden="true" class="fas fa-plus"></i> Legg til
          </div>
        </div>
      `;
    }

    html += `</div>`;
    html += `<div class="week-summary"><strong>Total estimert tid denne uken:</strong> ${formatEstTid(totalWeekMinutes)}</div>`;

    container.innerHTML = html;
    runTabCleanup('calendar');
    // Event listeners legges til nedenfor (felles kode)
  }

  if (calendarViewMode !== 'week') {
  // Upcoming section (kun månedsvisning)
  const upcomingAvtaler = avtaler
    .filter(a => new Date(a.dato) >= today && a.status !== 'fullført')
    .sort((a, b) => {
      const dateCompare = new Date(a.dato) - new Date(b.dato);
      if (dateCompare !== 0) return dateCompare;
      return (a.klokkeslett || '').localeCompare(b.klokkeslett || '');
    })
    .slice(0, 8);

  if (upcomingAvtaler.length > 0) {
    html += `
      <div class="upcoming-section">
        <h4><i aria-hidden="true" class="fas fa-calendar-check"></i> Kommende avtaler</h4>
        <div class="upcoming-list">
          ${upcomingAvtaler.map(a => `
            <div class="upcoming-item" data-avtale-id="${a.id}" data-action="editAvtale" role="button" tabindex="0">
              <div class="upcoming-date">
                <span class="upcoming-day">${new Date(a.dato).getDate()}</span>
                <span class="upcoming-month">${monthNames[new Date(a.dato).getMonth()].substring(0, 3)}</span>
              </div>
              <div class="upcoming-info">
                <strong>${a.er_gjentakelse || a.original_avtale_id ? '<i aria-hidden="true" class="fas fa-sync-alt" style="font-size:0.7em;margin-right:3px" title="Gjentakende"></i>' : ''}${escapeHtml(a.kunder?.navn || a.kunde_navn || 'Ukjent')}</strong>
                <span>${a.klokkeslett ? a.klokkeslett.substring(0, 5) : ''} ${a.type || ''}</span>
                ${a.opprettet_av && a.opprettet_av !== 'admin' ? `<span class="upcoming-creator">Av: ${escapeHtml(getCreatorDisplay(a.opprettet_av))}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  runTabCleanup('calendar');
  } // end if (calendarViewMode !== 'week')

  // Get elements
  const prevBtn = document.getElementById('prevMonth');
  const nextBtn = document.getElementById('nextMonth');
  const addBtn = document.getElementById('addAvtaleBtn');

  // Named handlers for cleanup
  const handlePrevMonth = () => {
    currentCalendarMonth--;
    if (currentCalendarMonth < 0) {
      currentCalendarMonth = 11;
      currentCalendarYear--;
    }
    renderCalendar();
  };

  const handleNextMonth = () => {
    currentCalendarMonth++;
    if (currentCalendarMonth > 11) {
      currentCalendarMonth = 0;
      currentCalendarYear++;
    }
    renderCalendar();
  };

  const handleAddAvtale = () => openAvtaleModal();
  const toggleWeekBtn = document.getElementById('toggleWeekView');
  const handleToggleWeek = () => {
    if (calendarViewMode === 'month') {
      calendarViewMode = 'week';
      // Sett ukestart til mandag i inneværende uke
      const now = new Date();
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      monday.setHours(0, 0, 0, 0);
      currentWeekStart = monday;
    } else {
      calendarViewMode = 'month';
    }
    renderCalendar();
  };

  // Add event listeners
  prevBtn?.addEventListener('click', handlePrevMonth);
  nextBtn?.addEventListener('click', handleNextMonth);
  addBtn?.addEventListener('click', handleAddAvtale);
  toggleWeekBtn?.addEventListener('click', handleToggleWeek);

  // Ukevisning: navigasjonsknapper
  const prevWeekBtn = document.getElementById('prevWeek');
  const nextWeekBtn = document.getElementById('nextWeek');
  const handlePrevWeek = () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    renderCalendar();
  };
  const handleNextWeek = () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    renderCalendar();
  };
  prevWeekBtn?.addEventListener('click', handlePrevWeek);
  nextWeekBtn?.addEventListener('click', handleNextWeek);

  // Open split view
  const splitBtn = document.getElementById('openCalendarSplit');
  const handleOpenSplit = () => openCalendarSplitView();
  splitBtn?.addEventListener('click', handleOpenSplit);

  // Store cleanup function
  tabCleanupFunctions.calendar = () => {
    prevBtn?.removeEventListener('click', handlePrevMonth);
    nextBtn?.removeEventListener('click', handleNextMonth);
    addBtn?.removeEventListener('click', handleAddAvtale);
    toggleWeekBtn?.removeEventListener('click', handleToggleWeek);
    prevWeekBtn?.removeEventListener('click', handlePrevWeek);
    nextWeekBtn?.removeEventListener('click', handleNextWeek);
    splitBtn?.removeEventListener('click', handleOpenSplit);
    closeCalendarSplitView();
  };
}

// ========== SPLIT VIEW: Calendar + Map side-by-side ==========
let splitViewOpen = false;
let splitWeekStart = null;
let splitDividerCleanup = null;
let splitViewState = { activeDay: null }; // ISO date string for active day

function openCalendarSplitView() {
  if (splitViewOpen) return; // Guard against double-open
  const overlay = document.getElementById('calendarSplitOverlay');
  if (!overlay) return;

  // Initialize week start from current calendar week or today
  if (currentWeekStart) {
    splitWeekStart = new Date(currentWeekStart);
  } else {
    const now = new Date();
    const dayOfWeek = now.getDay();
    splitWeekStart = new Date(now);
    splitWeekStart.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    splitWeekStart.setHours(0, 0, 0, 0);
  }

  overlay.classList.remove('hidden');
  splitViewOpen = true;

  // Render content
  renderSplitWeekContent();

  // Navigation
  const prevBtn = document.getElementById('splitPrevWeek');
  const nextBtn = document.getElementById('splitNextWeek');
  const closeBtn = document.getElementById('closeSplitView');
  const addBtn = document.getElementById('addAvtaleSplit');

  const handlePrev = () => { splitWeekStart.setDate(splitWeekStart.getDate() - 7); renderSplitWeekContent(); };
  const handleNext = () => { splitWeekStart.setDate(splitWeekStart.getDate() + 7); renderSplitWeekContent(); };
  const handleClose = () => closeCalendarSplitView();
  const handleAdd = () => openAvtaleModal();

  prevBtn?.addEventListener('click', handlePrev);
  nextBtn?.addEventListener('click', handleNext);
  closeBtn?.addEventListener('click', handleClose);
  addBtn?.addEventListener('click', handleAdd);

  // ESC to close
  const handleEsc = (e) => { if (e.key === 'Escape') closeCalendarSplitView(); };
  document.addEventListener('keydown', handleEsc);

  // Drag divider
  setupSplitDivider();

  // Delegated event handlers for cards
  const content = document.getElementById('calendarSplitContent');
  const handleContentClick = async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'editAvtale') {
      const avtaleId = target.dataset.avtaleId;
      const avtale = avtaler.find(a => String(a.id) === String(avtaleId));
      if (avtale) openAvtaleModal(avtale);
    } else if (action === 'quickDeleteAvtale') {
      e.stopPropagation();
      const avtaleId = Number.parseInt(target.dataset.avtaleId);
      const delAvtale = avtaler.find(a => a.id === avtaleId);
      const delName = delAvtale?.kunder?.navn || delAvtale?.kunde_navn || 'denne avtalen';
      const confirmed = await showConfirm(`Slett avtale for ${delName}?`, 'Bekreft sletting');
      if (!confirmed) return;
      try {
        const delResp = await apiFetch(`/api/avtaler/${avtaleId}`, { method: 'DELETE' });
        if (delResp.ok) {
          showToast('Avtale slettet', 'success');
          await loadAvtaler();
          renderCalendar();
        } else {
          showToast('Kunne ikke slette avtalen', 'error');
        }
      } catch (err) {
        console.error('Error deleting avtale from split view:', err);
        showToast('Kunne ikke slette avtalen', 'error');
      }
    } else if (action === 'openDayDetail') {
      const date = target.dataset.date;
      if (date) openAvtaleModal(null, date);
    } else if (action === 'setSplitActiveDay') {
      e.stopPropagation();
      const clickedDate = target.dataset.date;
      if (splitViewState.activeDay === clickedDate) {
        splitViewState.activeDay = null;
        if (areaSelectMode) toggleAreaSelect();
      } else {
        splitViewState.activeDay = clickedDate;
        if (!areaSelectMode) toggleAreaSelect();
        const d = new Date(clickedDate + 'T00:00:00');
        showToast(`${d.toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' })} valgt — dra over kunder på kartet`, 'info');
      }
      renderSplitWeekContent();
    } else if (action === 'confirmDay') {
      e.stopPropagation();
      const date = target.dataset.date;
      if (date) showConfirmDayPanel(date);
    } else if (action === 'toggleUpcomingAreas') {
      const body = document.getElementById('splitUpcomingBody');
      if (body) body.classList.toggle('collapsed');
      const chevron = target.querySelector('.split-upcoming-chevron') || target.closest('[data-action]').querySelector('.split-upcoming-chevron');
      if (chevron) chevron.classList.toggle('rotated');
    }
  };
  content?.addEventListener('click', handleContentClick);

  // Store cleanup
  splitDividerCleanup = () => {
    prevBtn?.removeEventListener('click', handlePrev);
    nextBtn?.removeEventListener('click', handleNext);
    closeBtn?.removeEventListener('click', handleClose);
    addBtn?.removeEventListener('click', handleAdd);
    document.removeEventListener('keydown', handleEsc);
    content?.removeEventListener('click', handleContentClick);
  };

  // Invalidate map size so tiles re-render in the visible area
  setTimeout(() => {
    if (window.map) window.map.resize();
  }, 100);
}

function closeCalendarSplitView() {
  const overlay = document.getElementById('calendarSplitOverlay');
  if (!overlay) return;

  overlay.classList.add('hidden');
  splitViewOpen = false;

  // Deactivate area select if active
  splitViewState.activeDay = null;
  if (areaSelectMode) toggleAreaSelect();

  if (splitDividerCleanup) {
    splitDividerCleanup();
    splitDividerCleanup = null;
  }

  // Reset panel width
  const panel = document.getElementById('calendarSplitPanel');
  if (panel) panel.style.width = '';

  // Invalidate map size
  setTimeout(() => {
    if (window.map) window.map.resize();
  }, 100);
}

function renderSplitWeekContent() {
  const content = document.getElementById('calendarSplitContent');
  const titleEl = document.getElementById('calendarSplitTitle');
  if (!content || !splitWeekStart) return;

  const weekNum = getISOWeekNumber(splitWeekStart);
  if (titleEl) titleEl.textContent = `Uke ${weekNum} — ${splitWeekStart.getFullYear()}`;

  const weekDayNames = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Upcoming areas panel
  let html = renderUpcomingAreas(splitWeekStart);

  html += '<div class="split-week-grid">';

  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(splitWeekStart);
    dayDate.setDate(splitWeekStart.getDate() + i);
    const dateStr = formatDateISO(dayDate);
    const isToday = dayDate.getTime() === today.getTime();
    const isActive = splitViewState.activeDay === dateStr;

    const dayAvtaler = avtaler.filter(a => a.dato === dateStr);

    // Estimate time
    let dayMinutes = 0;
    dayAvtaler.forEach(a => {
      dayMinutes += (a.varighet || 0);
      if (!a.varighet) {
        const kunde = customers.find(c => c.id === a.kunde_id);
        if (kunde?.estimert_tid) dayMinutes += kunde.estimert_tid;
      }
    });

    html += `
      <div class="split-week-day ${isToday ? 'today' : ''} ${isActive ? 'active' : ''}" data-date="${dateStr}">
        <div class="split-week-day-header" data-action="setSplitActiveDay" data-date="${dateStr}" title="${isActive ? 'Klikk for å deaktivere dag' : 'Klikk for å velge dag — dra over kartet for å legge til kunder'}" role="button" tabindex="0">
          <span class="split-day-name">${weekDayNames[i].substring(0, 3)}</span>
          <span class="split-day-date">${dayDate.getDate()}</span>
          ${isActive ? '<i aria-hidden="true" class="fas fa-crosshairs split-active-icon"></i>' : ''}
          ${dayMinutes > 0 ? `<span class="split-day-time">${formatEstTid(dayMinutes)}</span>` : ''}
          ${dayAvtaler.length > 0 ? `<span class="split-day-count">${dayAvtaler.length} avtale${dayAvtaler.length !== 1 ? 'r' : ''}</span>` : ''}
          ${dayAvtaler.length >= 2 ? `<a class="split-day-gmaps" href="${buildGoogleMapsUrl(dayAvtaler)}" target="_blank" rel="noopener" title="Åpne rute i Google Maps" onclick="event.stopPropagation()"><i aria-hidden="true" class="fas fa-directions"></i></a>` : ''}
        </div>
        ${dayAvtaler.length > 0 ? renderAreaBadges(dayAvtaler) : ''}
        <div class="split-day-content">
    `;

    if (dayAvtaler.length === 0) {
      html += '<div class="split-day-empty">Ingen avtaler</div>';
    }

    dayAvtaler.forEach(a => {
      const navn = a.kunder?.navn || a.kunde_navn || 'Ukjent';
      const addr = [a.kunder?.adresse || '', a.kunder?.postnummer || '', a.kunder?.poststed || ''].filter(Boolean).join(', ');
      const phone = a.kunder?.telefon || a.telefon || '';
      const creator = a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '';
      const initials = creator ? getCreatorDisplay(creator, true) : '';
      const serviceColor = getAvtaleServiceColor(a);
      const serviceIcon = getAvtaleServiceIcon(a);
      const kunde = customers.find(c => c.id === a.kunde_id);
      const estTid = a.varighet || kunde?.estimert_tid || 0;

      html += `
        <div class="split-avtale-card ${a.status === 'fullført' ? 'completed' : ''}" data-avtale-id="${a.id}" data-action="editAvtale" role="button" tabindex="0"${serviceColor ? ` style="border-left-color:${serviceColor}"` : ''}>
          <div class="split-card-header">
            ${serviceIcon ? `<span class="avtale-service-icon">${serviceIcon}</span>` : ''}
            ${initials ? `<span class="split-card-initials" title="${escapeHtml(creator)}">${escapeHtml(initials)}</span>` : ''}
            <span class="split-card-name">${escapeHtml(navn)}</span>
            ${estTid ? `<span class="avtale-duration">${formatEstTid(estTid)}</span>` : ''}
            <button class="split-card-delete" data-action="quickDeleteAvtale" data-avtale-id="${a.id}" title="Slett avtale" aria-label="Slett avtale"><i aria-hidden="true" class="fas fa-times"></i></button>
          </div>
          ${addr ? `<div class="split-card-addr"><i aria-hidden="true" class="fas fa-map-marker-alt" style="font-size:8px;margin-right:3px;"></i>${escapeHtml(addr)}</div>` : ''}
          ${phone ? `<div class="split-card-phone"><i aria-hidden="true" class="fas fa-phone"></i>${escapeHtml(phone)}</div>` : ''}
          ${a.klokkeslett ? `<div class="split-card-time"><i aria-hidden="true" class="fas fa-clock"></i>${a.klokkeslett.substring(0, 5)}${a.varighet ? ` (${formatEstTid(a.varighet)})` : ''}</div>` : ''}
        </div>
      `;
    });

    const pendingAvtaler = dayAvtaler.filter(a => a.status !== 'fullført');
    html += `
        </div>
        <div class="split-day-footer">
          <div class="split-day-add" data-date="${dateStr}" data-action="openDayDetail" role="button" tabindex="0">
            <i aria-hidden="true" class="fas fa-plus"></i> Legg til
          </div>
          ${pendingAvtaler.length > 0 ? `
          <div class="split-day-confirm" data-date="${dateStr}" data-action="confirmDay" role="button" tabindex="0">
            <i aria-hidden="true" class="fas fa-check-double"></i> Bekreft dag
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  html += '</div>';
  content.innerHTML = html;
}

function renderUpcomingAreas(fromDate) {
  // Look ahead 4 weeks
  const endDate = new Date(fromDate);
  endDate.setDate(endDate.getDate() + 28);
  const fromStr = formatDateISO(fromDate);
  const endStr = formatDateISO(endDate);

  const upcoming = avtaler.filter(a => a.dato >= fromStr && a.dato <= endStr);
  if (upcoming.length === 0) return '';

  const areaMap = new Map();
  upcoming.forEach(a => {
    const area = a.kunder?.poststed || a.poststed || null;
    if (!area) return;
    if (!areaMap.has(area)) {
      areaMap.set(area, { count: 0, dates: new Set(), customers: [], types: {} });
    }
    const group = areaMap.get(area);
    group.count++;
    group.dates.add(a.dato);
    const name = a.kunder?.navn || a.kunde_navn || 'Ukjent';
    if (!group.customers.includes(name)) group.customers.push(name);
    // Track control types
    const kunde = customers.find(c => c.id === a.kunde_id);
    const kat = kunde?.kategori || a.type || '';
    if (kat) {
      group.types[kat] = (group.types[kat] || 0) + 1;
    }
  });

  if (areaMap.size === 0) return '';
  const sorted = Array.from(areaMap.entries()).sort((a, b) => b[1].count - a[1].count);

  return `
    <div class="split-upcoming-areas">
      <div class="split-upcoming-header" data-action="toggleUpcomingAreas" role="button" tabindex="0">
        <i aria-hidden="true" class="fas fa-map-marked-alt"></i>
        <span>Kommende områder (${sorted.length})</span>
        <i aria-hidden="true" class="fas fa-chevron-down split-upcoming-chevron"></i>
      </div>
      <div class="split-upcoming-body" id="splitUpcomingBody">
        ${sorted.slice(0, 10).map(([area, data]) => {
          const typeBadges = Object.entries(data.types).map(([kat, count]) =>
            `<span class="overdue-kat-badge ${kat.includes('El') ? 'kat-el' : kat.includes('Brann') ? 'kat-brann' : 'kat-other'}">${count} ${escapeHtml(kat)}</span>`
          ).join('');
          return `
          <div class="split-upcoming-item" title="${escapeHtml(data.customers.join(', '))}">
            <div class="split-upcoming-item-top">
              <span class="split-upcoming-area"><i aria-hidden="true" class="fas fa-map-marker-alt"></i> ${escapeHtml(area)}</span>
              <span class="split-upcoming-count">${data.count} avtale${data.count !== 1 ? 'r' : ''}</span>
              <span class="split-upcoming-days">${data.dates.size} dag${data.dates.size !== 1 ? 'er' : ''}</span>
            </div>
            ${typeBadges ? `<div class="split-upcoming-types">${typeBadges}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function showConfirmDayPanel(dateStr) {
  const dayAvtaler = avtaler.filter(a => a.dato === dateStr && a.status !== 'fullført');
  if (dayAvtaler.length === 0) {
    showToast('Ingen ventende avtaler på denne dagen', 'info');
    return;
  }

  const datoLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' });

  // Remove existing panel
  document.getElementById('confirmDayPanel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'confirmDayPanel';
  panel.className = 'confirm-day-panel';
  panel.innerHTML = `
    <div class="confirm-day-header">
      <div>
        <strong>Bekreft kontroll — ${escapeHtml(datoLabel)}</strong>
        <div style="font-size:11px;color:var(--color-text-secondary);">${dayAvtaler.length} kunde${dayAvtaler.length !== 1 ? 'r' : ''}</div>
      </div>
      <button class="area-select-close" id="closeConfirmDay" aria-label="Lukk">&times;</button>
    </div>
    <div class="confirm-day-list">
      ${dayAvtaler.map(a => {
        const navn = a.kunder?.navn || a.kunde_navn || 'Ukjent';
        const addr = a.kunder?.poststed || a.poststed || '';
        const kunde = customers.find(c => c.id === a.kunde_id);
        const kategoriInterval = kunde?.kontroll_intervall_mnd || null;
        return `
          <div class="confirm-day-item">
            <div class="confirm-day-item-info">
              <span class="confirm-day-item-name">${escapeHtml(navn)}</span>
              ${addr ? `<span class="confirm-day-item-area">${escapeHtml(addr)}</span>` : ''}
            </div>
            ${kategoriInterval ? `<span class="confirm-day-item-interval" title="Intervall fra kategori">${kategoriInterval} mnd</span>` : ''}
          </div>`;
      }).join('')}
    </div>
    <div class="confirm-day-interval">
      <label style="font-size:12px;font-weight:600;">Kontrollintervall</label>
      <div style="font-size:10px;color:var(--color-text-secondary);margin-bottom:4px;">Kunder med eksisterende intervall beholder sitt. Øvrige får verdien under.</div>
      <select id="confirmDayIntervalSelect" style="width:100%;padding:6px;border-radius:4px;border:1px solid var(--color-border);background:var(--bg-primary);color:var(--color-text-primary);">
        <option value="6">6 måneder</option>
        <option value="12" selected>12 måneder (1 år)</option>
        <option value="24">24 måneder (2 år)</option>
        <option value="36">36 måneder (3 år)</option>
        <option value="48">48 måneder (4 år)</option>
        <option value="60">60 måneder (5 år)</option>
      </select>
    </div>
    <div class="confirm-day-actions">
      <button class="btn btn-small btn-secondary" id="confirmDayCancel" style="flex:1;">Avbryt</button>
      <button class="btn btn-small btn-success" id="confirmDaySubmit" style="flex:2;">
        <i aria-hidden="true" class="fas fa-check-double"></i> Bekreft ${dayAvtaler.length} kunder
      </button>
    </div>
  `;

  document.body.appendChild(panel);

  document.getElementById('closeConfirmDay').addEventListener('click', () => panel.remove());
  document.getElementById('confirmDayCancel').addEventListener('click', () => panel.remove());

  document.getElementById('confirmDaySubmit').addEventListener('click', async () => {
    const submitBtn = document.getElementById('confirmDaySubmit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i aria-hidden="true" class="fas fa-spinner fa-spin"></i> Bekrefter...';

    const fallbackInterval = Number.parseInt(document.getElementById('confirmDayIntervalSelect').value) || 12;

    // 1. Mark all avtaler as fullført
    let completedCount = 0;
    for (const a of dayAvtaler) {
      try {
        const resp = await apiFetch('/api/avtaler/' + a.id + '/complete', { method: 'POST' });
        if (resp.ok) completedCount++;
      } catch (err) {
        console.error('Error completing avtale:', err);
      }
    }

    // 2. Update kontroll dates for each customer
    const kundeIds = [...new Set(dayAvtaler.map(a => a.kunde_id).filter(Boolean))];
    if (kundeIds.length > 0) {
      const types = [...new Set(dayAvtaler.map(a => a.type).filter(Boolean))];
      const slugs = types.map(t => t.toLowerCase().replace(/\s+/g, '-'));

      try {
        await apiFetch('/api/kunder/mark-visited', {
          method: 'POST',
          body: JSON.stringify({
            kunde_ids: kundeIds,
            visited_date: dateStr,
            service_type_slugs: slugs
          })
        });
      } catch (err) {
        console.error('Error marking visited:', err);
      }

      // For customers without category interval, update kontroll_intervall_mnd
      for (const kundeId of kundeIds) {
        const kunde = customers.find(c => c.id === kundeId);
        if (kunde && !kunde.kontroll_intervall_mnd) {
          try {
            await apiFetch('/api/kunder/' + kundeId, {
              method: 'PUT',
              body: JSON.stringify({ kontroll_intervall_mnd: fallbackInterval })
            });
          } catch (err) {
            console.error('Error updating interval:', err);
          }
        }
      }
    }

    panel.remove();
    showToast(`${completedCount} avtale${completedCount !== 1 ? 'r' : ''} fullført — neste kontroll beregnet`, 'success');

    // Refresh data
    await loadAvtaler();
    await loadCustomers();
    renderCalendar();
    if (splitViewOpen) renderSplitWeekContent();
  });
}

function setupSplitDivider() {
  const divider = document.getElementById('calendarSplitDivider');
  const panel = document.getElementById('calendarSplitPanel');
  const overlay = document.getElementById('calendarSplitOverlay');
  if (!divider || !panel || !overlay) return;

  let isDragging = false;

  const onMouseDown = (e) => {
    isDragging = true;
    divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  };

  const onMouseMove = (e) => {
    if (!isDragging) return;
    const overlayRect = overlay.getBoundingClientRect();
    const newWidth = e.clientX - overlayRect.left;
    const minW = 400;
    const maxW = overlayRect.width - 200;
    panel.style.width = Math.max(minW, Math.min(maxW, newWidth)) + 'px';
  };

  const onMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Re-render map
    setTimeout(() => { if (window.map) window.map.resize(); }, 50);
  };

  divider.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  // Touch support
  divider.addEventListener('touchstart', (e) => {
    isDragging = true;
    divider.classList.add('dragging');
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const overlayRect = overlay.getBoundingClientRect();
    const newWidth = touch.clientX - overlayRect.left;
    const minW = 400;
    const maxW = overlayRect.width - 200;
    panel.style.width = Math.max(minW, Math.min(maxW, newWidth)) + 'px';
  }, { passive: true });
  document.addEventListener('touchend', onMouseUp);

  // Extend cleanup to remove these listeners
  const existingCleanup = splitDividerCleanup;
  splitDividerCleanup = () => {
    if (existingCleanup) existingCleanup();
    divider.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('touchend', onMouseUp);
  };
}

// Re-render split view when avtaler change (if open)
const _origLoadAvtaler = loadAvtaler;
loadAvtaler = async function() {
  await _origLoadAvtaler();
  if (splitViewOpen) renderSplitWeekContent();
};

// Avtale modal functions
function openAvtaleModal(avtale = null, preselectedDate = null) {
  const modal = document.getElementById('avtaleModal');
  const form = document.getElementById('avtaleForm');
  const title = document.getElementById('avtaleModalTitle');
  const deleteBtn = document.getElementById('deleteAvtaleBtn');
  const deleteSeriesBtn = document.getElementById('deleteAvtaleSeriesBtn');
  const kundeSearch = document.getElementById('avtaleKundeSearch');
  const kundeInput = document.getElementById('avtaleKunde');
  const kundeResults = document.getElementById('avtaleKundeResults');
  const avtaleTypeSelect = document.getElementById('avtaleType');
  const gjentakelseSelect = document.getElementById('avtaleGjentakelse');
  const gjentakelseSluttGroup = document.getElementById('avtaleGjentakelseSluttGroup');
  const gjentakelseGroup = document.getElementById('avtaleGjentakelseGroup');
  const showOnMapBtn = document.getElementById('showAvtaleOnMapBtn');

  // Populate type dropdown dynamically from ServiceTypeRegistry
  if (avtaleTypeSelect) {
    avtaleTypeSelect.innerHTML = serviceTypeRegistry.renderCategoryOptions('');
  }

  // Clear search field
  kundeSearch.value = '';
  kundeInput.value = '';
  kundeResults.innerHTML = '';
  kundeResults.classList.remove('active');

  // Toggle gjentakelse slutt visibility
  gjentakelseSelect.onchange = function() {
    gjentakelseSluttGroup.classList.toggle('hidden', !this.value);
  };

  if (avtale) {
    // Edit mode
    title.textContent = 'Rediger avtale';
    document.getElementById('avtaleId').value = avtale.id;
    kundeInput.value = avtale.kunde_id;
    // Find kunde name for display
    const kunde = customers.find(c => c.id === avtale.kunde_id);
    if (kunde) {
      kundeSearch.value = `${kunde.navn} (${kunde.poststed || 'Ukjent'})`;
    }
    document.getElementById('avtaleDato').value = avtale.dato;
    document.getElementById('avtaleKlokkeslett').value = avtale.klokkeslett || '';
    document.getElementById('avtaleType').value = avtale.type || serviceTypeRegistry.getDefaultServiceType().name;
    document.getElementById('avtaleBeskrivelse').value = avtale.beskrivelse || '';
    gjentakelseSelect.value = avtale.gjentakelse_regel || '';
    document.getElementById('avtaleGjentakelseSlutt').value = avtale.gjentakelse_slutt || '';
    gjentakelseSluttGroup.classList.toggle('hidden', !avtale.gjentakelse_regel);

    // Hide recurrence fields when editing (only on create)
    gjentakelseGroup.style.display = 'none';
    gjentakelseSluttGroup.style.display = 'none';

    deleteBtn.style.display = 'inline-block';
    // Show "delete series" button if this is part of a recurring series
    const isPartOfSeries = avtale.er_gjentakelse || avtale.original_avtale_id;
    deleteSeriesBtn.style.display = isPartOfSeries ? 'inline-block' : 'none';

    // Show "Vis på kart" button with click handler
    if (showOnMapBtn) {
      showOnMapBtn.style.display = 'inline-block';
      showOnMapBtn.onclick = () => {
        modal.classList.add('hidden');
        focusOnCustomer(avtale.kunde_id);
      };
    }
  } else {
    // New avtale
    title.textContent = 'Ny avtale';
    form.reset();
    document.getElementById('avtaleId').value = '';
    kundeSearch.value = '';
    kundeInput.value = '';
    gjentakelseSelect.value = '';
    document.getElementById('avtaleGjentakelseSlutt').value = '';
    gjentakelseSluttGroup.classList.add('hidden');
    gjentakelseGroup.style.display = '';
    if (preselectedDate) {
      document.getElementById('avtaleDato').value = preselectedDate;
    }
    deleteBtn.style.display = 'none';
    deleteSeriesBtn.style.display = 'none';
    if (showOnMapBtn) showOnMapBtn.style.display = 'none';
  }

  modal.classList.remove('hidden');

  // Focus on search field
  setTimeout(() => kundeSearch.focus(), 100);
}

// Open new avtale with preselected customer (from map tooltip/context menu)
function openNewAvtaleForCustomer(customerId) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;
  openAvtaleModal(null, null);
  // Pre-fill customer
  const kundeSearch = document.getElementById('avtaleKundeSearch');
  const kundeInput = document.getElementById('avtaleKunde');
  if (kundeSearch) kundeSearch.value = `${customer.navn} (${customer.poststed || 'Ukjent'})`;
  if (kundeInput) kundeInput.value = customer.id;
  // Set today's date
  const datoInput = document.getElementById('avtaleDato');
  if (datoInput && !datoInput.value) {
    datoInput.value = new Date().toISOString().split('T')[0];
  }
}

// Kunde search for avtale modal
function setupAvtaleKundeSearch() {
  const searchInput = document.getElementById('avtaleKundeSearch');
  const kundeInput = document.getElementById('avtaleKunde');
  const resultsDiv = document.getElementById('avtaleKundeResults');

  if (!searchInput) return;

  searchInput.addEventListener('input', function() {
    const query = this.value.toLowerCase().trim();

    if (query.length < 1) {
      resultsDiv.innerHTML = '';
      resultsDiv.classList.remove('active');
      return;
    }

    // Filter customers
    const filtered = customers.filter(c =>
      c.navn.toLowerCase().includes(query) ||
      (c.poststed && c.poststed.toLowerCase().includes(query)) ||
      (c.adresse && c.adresse.toLowerCase().includes(query))
    );
    const matches = sortByNavn(filtered).slice(0, 10);

    if (matches.length === 0) {
      resultsDiv.innerHTML = '<div class="kunde-search-item no-results">Ingen kunder funnet</div>';
      resultsDiv.classList.add('active');
      return;
    }

    resultsDiv.innerHTML = matches.map(c => `
      <div class="kunde-search-item" data-id="${c.id}" data-name="${escapeHtml(c.navn)} (${c.poststed || 'Ukjent'})">
        <span class="kunde-name">${escapeHtml(c.navn)}</span>
        <span class="kunde-location">${c.poststed || 'Ukjent'}</span>
      </div>
    `).join('');
    resultsDiv.classList.add('active');
  });

  // Handle click on result
  resultsDiv.addEventListener('click', function(e) {
    const item = e.target.closest('.kunde-search-item');
    if (item && !item.classList.contains('no-results')) {
      kundeInput.value = item.dataset.id;
      searchInput.value = item.dataset.name;
      resultsDiv.innerHTML = '';
      resultsDiv.classList.remove('active');
    }
  });

  // Close results when clicking outside
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.kunde-search-wrapper')) {
      resultsDiv.classList.remove('active');
    }
  });

  // Keyboard navigation
  searchInput.addEventListener('keydown', function(e) {
    const items = resultsDiv.querySelectorAll('.kunde-search-item:not(.no-results)');
    const activeItem = resultsDiv.querySelector('.kunde-search-item.active');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!activeItem && items.length > 0) {
        items[0].classList.add('active');
      } else if (activeItem && activeItem.nextElementSibling) {
        activeItem.classList.remove('active');
        activeItem.nextElementSibling.classList.add('active');
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (activeItem && activeItem.previousElementSibling) {
        activeItem.classList.remove('active');
        activeItem.previousElementSibling.classList.add('active');
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = activeItem || items[0];
      if (selected && !selected.classList.contains('no-results')) {
        kundeInput.value = selected.dataset.id;
        searchInput.value = selected.dataset.name;
        resultsDiv.innerHTML = '';
        resultsDiv.classList.remove('active');
      }
    }
  });
}

function closeAvtaleModal() {
  document.getElementById('avtaleModal').classList.add('hidden');
}

async function saveAvtale(e) {
  e.preventDefault();

  const avtaleId = document.getElementById('avtaleId').value;
  const gjentakelse = document.getElementById('avtaleGjentakelse').value;
  const data = {
    kunde_id: Number.parseInt(document.getElementById('avtaleKunde').value),
    dato: document.getElementById('avtaleDato').value,
    klokkeslett: document.getElementById('avtaleKlokkeslett').value || null,
    type: document.getElementById('avtaleType').value,
    beskrivelse: document.getElementById('avtaleBeskrivelse').value || null,
    opprettet_av: localStorage.getItem('userName') || 'admin',
    ...(gjentakelse && !avtaleId ? {
      gjentakelse_regel: gjentakelse,
      gjentakelse_slutt: document.getElementById('avtaleGjentakelseSlutt').value || undefined,
    } : {}),
  };

  try {
    let response;
    if (avtaleId) {
      response = await apiFetch(`/api/avtaler/${avtaleId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    } else {
      response = await apiFetch('/api/avtaler', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    }

    if (response.ok) {
      await loadAvtaler();
      renderCalendar();
      applyFilters(); // Oppdater kart-markører med ny avtale-status
      closeAvtaleModal();
    } else {
      const error = await response.json();
      showMessage('Kunne ikke lagre: ' + (error.error || 'Ukjent feil'), 'error');
    }
  } catch (error) {
    console.error('Error saving avtale:', error);
    showMessage('Kunne ikke lagre avtalen. Prøv igjen.', 'error');
  }
}

async function deleteAvtale() {
  const avtaleId = document.getElementById('avtaleId').value;
  if (!avtaleId) return;

  const confirmed = await showConfirm(
    'Er du sikker på at du vil slette denne avtalen?',
    'Slette avtale'
  );
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/avtaler/${avtaleId}`, { method: 'DELETE' });
    if (response.ok) {
      await loadAvtaler();
      renderCalendar();
      applyFilters(); // Oppdater kart-markører
      closeAvtaleModal();
    }
  } catch (error) {
    console.error('Error deleting avtale:', error);
    showMessage('Kunne ikke slette avtalen. Prøv igjen.', 'error');
  }
}

async function deleteAvtaleSeries() {
  const avtaleId = document.getElementById('avtaleId').value;
  if (!avtaleId) return;

  const confirmed = await showConfirm(
    'Er du sikker på at du vil slette hele serien? Alle gjentakende avtaler i denne serien vil bli slettet.',
    'Slette avtaleserie'
  );
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/avtaler/${avtaleId}/series`, { method: 'DELETE' });
    if (response.ok) {
      const result = await response.json();
      showMessage(`${result.data.deletedCount} avtaler slettet`, 'success');
      await loadAvtaler();
      renderCalendar();
      applyFilters(); // Oppdater kart-markører
      closeAvtaleModal();
    }
  } catch (error) {
    console.error('Error deleting avtale series:', error);
    showMessage('Kunne ikke slette avtaleserien. Prøv igjen.', 'error');
  }
}


// Render planner - Smart Route Recommendations
function renderPlanner() {
  // Initialiser slider-lyttere og verdier
  initSmartRouteSettingsListeners();

  // Render anbefalinger
  renderSmartRecommendations();
}

// Create route for all customers in an area for a specific year
function createRouteForAreaYear(area, year) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get all customers in this area needing control in this year
  const areaCustomers = customers.filter(c => {
    if (!c.neste_kontroll) return false;
    const nextDate = new Date(c.neste_kontroll);
    return nextDate.getFullYear() === Number.parseInt(year) && (c.poststed === area);
  });

  if (areaCustomers.length === 0) {
    showMessage(`Ingen kunder i ${area} for ${year}`, 'info');
    return;
  }

  // Clear current selection and select all area customers
  selectedCustomers.clear();
  areaCustomers.forEach(c => {
    if (c.lat && c.lng) {
      selectedCustomers.add(c.id);
    }
  });

  updateSelectionUI();
  showNotification(`${areaCustomers.filter(c => c.lat && c.lng).length} kunder valgt for ${area} - ${year}. Bruk "Planlegg rute" for å beregne rute.`);

  // Zoom to area
  const areaData = areaCustomers.filter(c => c.lat && c.lng);
  if (areaData.length > 0) {
    const bounds = boundsFromCustomers(areaData);
    map.fitBounds(bounds, { padding: 50 });
  }
}

// Select all customers needing control
async function selectCustomersNeedingControl() {
  try {
    const response = await apiFetch('/api/kunder/kontroll-varsler?dager=30');
    const varselResult = await response.json();
    const varselKunder = varselResult.data || varselResult;

    selectedCustomers.clear();
    varselKunder.forEach(k => {
      if (k.lat && k.lng) {
        selectedCustomers.add(k.id);
      }
    });

    updateSelectionUI();

    if (selectedCustomers.size > 0) {
      // Zoom to selected customers
      const selectedData = customers.filter(c => selectedCustomers.has(c.id) && c.lat && c.lng);
      if (selectedData.length > 0) {
        const bounds = boundsFromCustomers(selectedData);
        map.fitBounds(bounds, { padding: 50 });
      }
    }
  } catch (error) {
    console.error('Feil ved henting av varsler:', error);
  }
}

// Check login and show user bar - redirect if not logged in
function checkLoginStatus() {
  // Check if auth is disabled via config (development mode)
  // Handle both boolean false and string "false"
  const authDisabled = appConfig.requireAuth === false || appConfig.requireAuth === 'false';
  Logger.log('checkLoginStatus: requireAuth =', appConfig.requireAuth, '-> authDisabled =', authDisabled);
  if (authDisabled) {
    // Auth disabled - allow access without login
    Logger.log('Auth disabled - bypassing login');
    const userBar = document.getElementById('userBar');
    if (userBar) userBar.style.display = 'none';
    return true;
  }

  // Auth is now cookie-based - check stored user info
  const navn = localStorage.getItem('userName');
  const rolle = localStorage.getItem('userRole');
  const userBar = document.getElementById('userBar');
  const userNameDisplay = document.getElementById('userNameDisplay');

  // If no stored user info, show SPA login overlay
  if (!navn) {
    showLoginView();
    return false;
  }

  // Multi-tenancy: Reload config with auth to get tenant-specific branding
  reloadConfigWithAuth();

  if (userBar) {
    userBar.style.display = 'flex';
    if (userNameDisplay) userNameDisplay.textContent = navn || 'Bruker';
  }

  // Hide email tab for non-admin users
  const emailTab = document.querySelector('.tab-item[data-tab="email"]');
  const isAdmin = rolle && rolle === 'admin';
  if (emailTab && !isAdmin) {
    emailTab.style.display = 'none';
  }

  return true;
}

// Logout function
function logoutUser(logoutAllDevices = false) {
  // Stop proactive token refresh
  stopTokenRefresh();

  // Send logout request (cookie-based auth, server clears cookie)
  const logoutHeaders = { 'Content-Type': 'application/json' };
  const csrfToken = getCsrfToken();
  if (csrfToken) {
    logoutHeaders['X-CSRF-Token'] = csrfToken;
  }
  fetch('/api/klient/logout', {
    method: 'POST',
    headers: logoutHeaders,
    credentials: 'include',
    body: JSON.stringify({ logoutAll: logoutAllDevices })
  }).catch(() => {
    // Retry once after 1 second to ensure token is blacklisted
    setTimeout(() => {
      fetch('/api/klient/logout', {
        method: 'POST',
        headers: logoutHeaders,
        credentials: 'include',
        body: JSON.stringify({ logoutAll: logoutAllDevices })
      }).catch(err => console.error('Logout retry failed:', err));
    }, 1000);
  });

  // Clear UI-related localStorage (keep non-auth items)
  localStorage.removeItem('userName');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userType');
  localStorage.removeItem('isSuperAdmin');
  localStorage.removeItem('isImpersonating');
  localStorage.removeItem('impersonatingOrgName');
  // Multi-tenancy: Clear organization data
  localStorage.removeItem('organizationId');
  localStorage.removeItem('organizationSlug');
  localStorage.removeItem('organizationName');
  // Clear app mode and industry
  localStorage.removeItem('appMode');
  localStorage.removeItem('industrySlug');
  localStorage.removeItem('industryName');

  // Reset auth state
  authToken = null;

  // Stop inactivity tracking and dismiss any warning modal
  stopInactivityTracking();

  // Show login screen (SPA - no redirect)
  showLoginView();
}


// ========================================
// INACTIVITY AUTO-LOGOUT (15 min)
// ========================================
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const INACTIVITY_WARNING_MS = 13 * 60 * 1000; // Warning at 13 min (2 min before logout)
let inactivityTimer = null;
let inactivityWarningTimer = null;
let inactivityWarningVisible = false;

function resetInactivityTimers() {
  if (inactivityWarningVisible) return; // Don't reset if warning is showing

  clearTimeout(inactivityTimer);
  clearTimeout(inactivityWarningTimer);

  // Only track when user is logged in
  if (!authToken && !document.cookie.includes('skyplanner_session')) return;

  inactivityWarningTimer = setTimeout(showInactivityWarning, INACTIVITY_WARNING_MS);
  inactivityTimer = setTimeout(() => {
    dismissInactivityWarning();
    logoutUser();
  }, INACTIVITY_TIMEOUT_MS);
}

function showInactivityWarning() {
  if (inactivityWarningVisible) return;
  inactivityWarningVisible = true;

  const existing = document.getElementById('inactivityWarningModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'inactivityWarningModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10001;';

  let secondsLeft = 120;
  modal.innerHTML = `
    <div style="background:var(--card-bg, #1a1a2e);border-radius:12px;padding:32px;max-width:420px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
      <div style="width:64px;height:64px;margin:0 auto 20px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:50%;display:flex;align-items:center;justify-content:center;">
        <i aria-hidden="true" class="fas fa-clock" style="font-size:28px;color:white;"></i>
      </div>
      <h2 style="color:var(--text-primary, #fff);margin:0 0 12px;font-size:20px;">Inaktivitet oppdaget</h2>
      <p style="color:var(--text-secondary, #a0a0a0);margin:0 0 8px;font-size:15px;">Du logges ut om <strong id="inactivityCountdown">${secondsLeft}</strong> sekunder på grunn av inaktivitet.</p>
      <p style="color:var(--text-muted, #666);margin:0 0 24px;font-size:13px;">Klikk knappen under for å forbli innlogget.</p>
      <button id="extendSessionBtn" style="background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;border:none;padding:12px 32px;border-radius:8px;font-size:15px;cursor:pointer;font-weight:600;">Fortsett sesjonen</button>
    </div>
  `;

  document.body.appendChild(modal);

  const countdownEl = document.getElementById('inactivityCountdown');
  const countdownInterval = setInterval(() => {
    secondsLeft--;
    if (countdownEl) countdownEl.textContent = secondsLeft;
    if (secondsLeft <= 0) clearInterval(countdownInterval);
  }, 1000);

  document.getElementById('extendSessionBtn').addEventListener('click', () => {
    clearInterval(countdownInterval);
    dismissInactivityWarning();
    resetInactivityTimers();
  });

  modal._countdownInterval = countdownInterval;
}

function dismissInactivityWarning() {
  inactivityWarningVisible = false;
  const modal = document.getElementById('inactivityWarningModal');
  if (modal) {
    if (modal._countdownInterval) clearInterval(modal._countdownInterval);
    modal.remove();
  }
}

const INACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'];

function startInactivityTracking() {
  // Remove any existing listeners first to prevent duplicates
  stopInactivityTracking();
  INACTIVITY_EVENTS.forEach(event => {
    document.addEventListener(event, resetInactivityTimers, { passive: true });
  });
  resetInactivityTimers();
}

function stopInactivityTracking() {
  clearTimeout(inactivityTimer);
  clearTimeout(inactivityWarningTimer);
  // Remove event listeners to prevent memory leaks
  INACTIVITY_EVENTS.forEach(event => {
    document.removeEventListener(event, resetInactivityTimers);
  });
  dismissInactivityWarning();
}


// Open email client to contact customer about scheduling control
function sendManualReminder(customerId) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;

  if (!customer.epost || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.epost)) {
    showMessage(`${customer.navn} har ingen gyldig e-postadresse registrert.`, 'warning');
    return;
  }

  // Determine control type
  const kontrollType = customer.kategori || 'El-kontroll';

  // Build email subject and body
  const companySignature = appConfig.companyName || 'Sky Planner';
  const subject = encodeURIComponent(`${kontrollType} - Avtale tid for kontroll`);
  const body = encodeURIComponent(
    `Hei!\n\n` +
    `Vi ønsker å avtale tid for ${kontrollType.toLowerCase()} hos ${customer.navn}.\n\n` +
    `Adresse: ${customer.adresse || ''}, ${customer.postnummer || ''} ${customer.poststed || ''}\n\n` +
    `Vennligst gi beskjed om når det passer for deg.\n\n` +
    `Med vennlig hilsen\n` +
    `${companySignature}`
  );

  // Open mailto link with encoded email
  window.location.href = `mailto:${encodeURIComponent(customer.epost)}?subject=${subject}&body=${body}`;
}

// === OVERDUE MAP FUNCTIONS ===

// Get all overdue customers
function getOverdueCustomers() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

  return customers.filter(c => {
    if (!c.neste_kontroll) return false;
    const nextDate = new Date(c.neste_kontroll);
    const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
    return controlMonthValue < currentMonthValue;
  });
}

// Show all overdue customers on the map
function showOverdueOnMap() {
  const overdueCustomers = getOverdueCustomers();

  if (overdueCustomers.length === 0) {
    showMessage('Ingen forfalte kontroller å vise på kartet.', 'info');
    return;
  }

  // Clear current selection and add overdue customers
  selectedCustomers.clear();
  overdueCustomers.forEach(c => selectedCustomers.add(c.id));

  // Re-render markers to highlight overdue
  renderMarkers(customers);

  // Zoom to fit all overdue customers
  const bounds = boundsFromCustomers(overdueCustomers.filter(c => c.lat && c.lng));

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 50 });
  }

  // Show notification
  const notification = document.createElement('div');
  notification.className = 'map-notification';
  notification.innerHTML = `<i aria-hidden="true" class="fas fa-map-marker-alt"></i> Viser ${overdueCustomers.length} forfalte kunder på kartet`;
  document.querySelector('.map-container')?.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

// Show specific customers on map by IDs
function showCustomersOnMap(customerIds) {
  const customersToShow = customers.filter(c => customerIds.includes(c.id));

  if (customersToShow.length === 0) return;

  // Clear current selection and add these customers
  selectedCustomers.clear();
  customersToShow.forEach(c => selectedCustomers.add(c.id));

  // Re-render markers
  renderMarkers(customers);

  // Zoom to fit these customers
  const bounds = boundsFromCustomers(customersToShow.filter(c => c.lat && c.lng));

  if (!bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 50 });
  }
}

// Create route from all overdue customers
async function createOverdueRoute() {
  const overdueCustomers = getOverdueCustomers();

  if (overdueCustomers.length === 0) {
    showMessage('Ingen forfalte kontroller å lage rute for.', 'info');
    return;
  }

  if (overdueCustomers.length > 25) {
    const proceed = await showConfirm(`Du har ${overdueCustomers.length} forfalte kontroller. OpenRouteService har en grense på 25 stopp per rute. Vil du velge de 25 mest kritiske?`, 'For mange kontroller');
    if (!proceed) return;

    // Sort by most overdue and take first 25
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    overdueCustomers.sort((a, b) => {
      const daysA = Math.ceil((today - new Date(a.neste_kontroll)) / (1000 * 60 * 60 * 24));
      const daysB = Math.ceil((today - new Date(b.neste_kontroll)) / (1000 * 60 * 60 * 24));
      return daysB - daysA;
    });
    overdueCustomers.length = 25;
  }

  createRouteFromCustomerIds(overdueCustomers.map(c => c.id));
}

// Create route from specific customer IDs
function createRouteFromCustomerIds(customerIds) {
  const customersForRoute = customers.filter(c => customerIds.includes(c.id) && c.lat && c.lng);

  if (customersForRoute.length === 0) {
    showMessage('Ingen kunder med gyldige koordinater.', 'warning');
    return;
  }

  if (customersForRoute.length > 25) {
    showMessage('Maks 25 stopp per rute. Velg færre kunder.', 'warning');
    return;
  }

  // Clear current selection and add these
  selectedCustomers.clear();
  customersForRoute.forEach(c => selectedCustomers.add(c.id));

  // Update UI
  updateSelectionUI();
}

// === EMAIL FUNCTIONS ===

// Load all email data
async function loadEmailData() {
  await Promise.all([
    loadEmailStats(),
    loadEmailUpcoming(),
    loadEmailStatus(),
    loadEmailHistory()
  ]);
}

// Load email statistics
async function loadEmailStats() {
  try {
    const response = await apiFetch('/api/email/stats');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const stats = await response.json();

    document.getElementById('statPending').textContent = stats.pending || 0;
    document.getElementById('statSent').textContent = stats.sent || 0;
    document.getElementById('statFailed').textContent = stats.failed || 0;
  } catch (error) {
    console.error('Feil ved lasting av e-post-statistikk:', error);
  }
}

// Load upcoming notifications
async function loadEmailUpcoming() {
  try {
    const response = await apiFetch('/api/email/upcoming');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const upcoming = await response.json();

    const content = document.getElementById('emailUpcomingContent');
    const countBadge = document.getElementById('upcomingCount');
    if (!content) return;

    if (countBadge) countBadge.textContent = upcoming.length;

    if (upcoming.length === 0) {
      content.innerHTML = '<div class="upcoming-empty">Ingen kommende varsler de neste 30 dagene</div>';
      return;
    }

    content.innerHTML = upcoming.map(item => {
      const days = item.days_until;
      let daysClass = 'normal';
      let daysText = `${days} dager`;

      if (days <= 0) {
        daysClass = 'urgent';
        daysText = days === 0 ? 'I dag' : `${Math.abs(days)} dager siden`;
      } else if (days <= 10) {
        daysClass = 'urgent';
      } else if (days <= 30) {
        daysClass = 'soon';
      }

      const hasEmail = item.epost && item.epost.trim() !== '';
      return `
        <div class="upcoming-item" data-customer-id="${item.id}">
          <div class="upcoming-info">
            <span class="upcoming-name">${escapeHtml(item.navn)}</span>
            <span class="upcoming-email">${escapeHtml(item.epost || 'Mangler e-post')}</span>
          </div>
          <div class="upcoming-actions">
            <button class="upcoming-email-btn ${hasEmail ? '' : 'disabled'}"
                    data-action="sendEmail"
                    data-customer-id="${item.id}"
                    title="${hasEmail ? 'Send e-post' : 'Ingen e-post registrert'}">
              <i aria-hidden="true" class="fas fa-envelope"></i>
            </button>
            <span class="upcoming-days ${daysClass}">${daysText}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Feil ved lasting av kommende varsler:', error);
  }
}

// Load email status/config
async function loadEmailStatus() {
  try {
    const response = await apiFetch('/api/email/status');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status = await response.json();

    const content = document.getElementById('emailStatusContent');
    if (!content) return;

    content.innerHTML = `
      <div class="config-item">
        <span class="config-label">E-postvarsling</span>
        <span class="config-value ${status.enabled ? 'enabled' : 'disabled'}">
          ${status.enabled ? 'Aktivert' : 'Deaktivert'}
        </span>
      </div>
      <div class="config-item">
        <span class="config-label">E-post server</span>
        <span class="config-value ${status.emailConfigured ? 'enabled' : 'disabled'}">
          ${status.emailConfigured ? 'Konfigurert' : 'Ikke konfigurert'}
        </span>
      </div>
      <div class="config-item">
        <span class="config-label">Første varsel</span>
        <span class="config-value">${status.firstReminderDays} dager før</span>
      </div>
      <div class="config-item">
        <span class="config-label">Påminnelse</span>
        <span class="config-value">${status.reminderAfterDays} dager etter første</span>
      </div>
    `;
  } catch (error) {
    console.error('Feil ved lasting av e-post-status:', error);
  }
}

// Load email history with optional filter
async function loadEmailHistory(filter = 'all') {
  try {
    const response = await apiFetch('/api/email/historikk?limit=50');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let history = await response.json();

    // Apply filter
    if (filter !== 'all') {
      history = history.filter(item => item.status === filter);
    }

    const content = document.getElementById('emailHistoryContent');
    if (!content) return;

    if (history.length === 0) {
      content.innerHTML = '<div class="email-history-empty">Ingen varsler å vise</div>';
      return;
    }

    content.innerHTML = history.map(item => {
      const statusText = {
        'sent': 'Sendt',
        'failed': 'Feilet',
        'pending': 'Venter'
      }[item.status] || item.status;

      return `
        <div class="email-history-item">
          <div class="history-header">
            <span class="history-customer">${escapeHtml(item.kunde_navn || 'Test')}</span>
            <span class="history-status ${escapeHtml(item.status)}">${escapeHtml(statusText)}</span>
          </div>
          <div class="history-subject">${escapeHtml(item.emne || '')}</div>
          <div class="history-message">${escapeHtml(item.melding.substring(0, 80))}${item.melding.length > 80 ? '...' : ''}</div>
          <div class="history-date">${new Date(item.opprettet).toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' })}</div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Feil ved lasting av e-post-historikk:', error);
  }
}

// Send test email
async function sendTestEmail() {
  const epost = document.getElementById('testEmailAddress')?.value;
  const melding = document.getElementById('testEmailMessage')?.value;

  if (!epost) {
    showMessage('Skriv inn en e-postadresse', 'warning');
    return;
  }

  const btn = document.getElementById('sendTestEmailBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i aria-hidden="true" class="fas fa-spinner fa-spin"></i> Sender...';
  }

  try {
    const response = await apiFetch('/api/email/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ epost, melding })
    });

    const result = await response.json();

    if (result.success) {
      showMessage('Test e-post sendt!', 'success');
      loadEmailHistory();
    } else {
      showMessage('Feil ved sending: ' + (result.error?.message || (typeof result.error === 'string' ? result.error : null) || 'Ukjent feil'), 'error');
    }
  } catch (error) {
    console.error('Feil ved sending av test e-post:', error);
    showMessage('Kunne ikke sende e-post. Prøv igjen.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i aria-hidden="true" class="fas fa-paper-plane"></i> Send Test';
    }
  }
}

// Trigger email check manually
async function triggerEmailCheck() {
  const btn = document.getElementById('triggerEmailCheckBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i aria-hidden="true" class="fas fa-spinner fa-spin"></i> Sender...';
  }

  try {
    const response = await apiFetch('/api/email/send-varsler', { method: 'POST' });
    const result = await response.json();

    showMessage(`Varselsjekk fullført! Sendt: ${result.sent}, Hoppet over: ${result.skipped}, Feil: ${result.errors}`, 'success', 'Varsler sendt');
    // Refresh all email data
    loadEmailData();
  } catch (error) {
    console.error('Feil ved varselsjekk:', error);
    showMessage('Kunne ikke kjøre varselsjekk', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i aria-hidden="true" class="fas fa-paper-plane"></i><span>Send varsler nå</span>';
    }
  }
}

// Load email settings for a customer
async function loadCustomerEmailSettings(kundeId) {
  try {
    const response = await apiFetch(`/api/email/innstillinger/${kundeId}`);
    if (!response.ok) return;
    const result = await response.json();
    const settings = result.data || result;

    const emailAktiv = document.getElementById('emailAktiv');
    const forsteVarsel = document.getElementById('forsteVarsel');
    const paaminnelseEtter = document.getElementById('paaminnelseEtter');
    const emailOptions = document.getElementById('emailOptions');

    if (emailAktiv) emailAktiv.checked = settings.email_aktiv === 1 || settings.email_aktiv === true;
    if (forsteVarsel) forsteVarsel.value = settings.forste_varsel_dager || 30;
    if (paaminnelseEtter) paaminnelseEtter.value = settings.paaminnelse_etter_dager || 7;

    // Toggle options visibility
    if (emailOptions) {
      emailOptions.classList.toggle('hidden', !emailAktiv?.checked);
    }
  } catch (error) {
    console.error('Feil ved lasting av e-post-innstillinger:', error);
  }
}

// Save email settings for a customer
async function saveCustomerEmailSettings(kundeId) {
  const emailAktiv = document.getElementById('emailAktiv')?.checked;
  const forsteVarsel = document.getElementById('forsteVarsel')?.value;
  const paaminnelseEtter = document.getElementById('paaminnelseEtter')?.value;

  try {
    await apiFetch(`/api/email/innstillinger/${kundeId}`, {
      method: 'PUT',
      body: JSON.stringify({
        email_aktiv: emailAktiv,
        forste_varsel_dager: Number.parseInt(forsteVarsel) || 30,
        paaminnelse_etter_dager: Number.parseInt(paaminnelseEtter) || 7
      })
    });
  } catch (error) {
    console.error('Feil ved lagring av e-post-innstillinger:', error);
    showMessage('Kunne ikke lagre e-post-innstillinger. Prøv igjen.', 'error');
  }
}

// ==================== KONTAKTLOGG ====================

let currentKontaktloggKundeId = null;

// ========================================
// SUBCATEGORY MANAGEMENT
// ========================================

// Load all subcategory assignments for the organization (bulk, for filtering)
async function loadAllSubcategoryAssignments() {
  try {
    const response = await apiFetch('/api/subcategories/kunde-assignments');
    if (response.ok) {
      const result = await response.json();
      const assignments = result.data || [];
      kundeSubcatMap = {};
      assignments.forEach(a => {
        if (!kundeSubcatMap[a.kunde_id]) kundeSubcatMap[a.kunde_id] = [];
        kundeSubcatMap[a.kunde_id].push({ group_id: a.group_id, subcategory_id: a.subcategory_id });
      });
    }
  } catch (error) {
    console.error('Error loading subcategory assignments:', error);
  }
  renderSubcategoryFilter();
}

// Load subcategories for a specific customer (for edit form)
async function loadKundeSubcategories(kundeId) {
  try {
    const response = await apiFetch(`/api/subcategories/kunde/${kundeId}`);
    if (!response.ok) return;
    const result = await response.json();
    const assignments = result.data || [];
    // Update local cache and re-render dropdowns with actual data
    kundeSubcatMap[kundeId] = assignments.map(a => ({ group_id: a.group_id, subcategory_id: a.subcategory_id }));
    const customer = customers.find(c => c.id === kundeId);
    renderSubcategoryDropdowns(customer || { id: kundeId });
  } catch (error) {
    console.error('Error loading kunde subcategories:', error);
  }
}

// Subcategory manager modal — manage subcategory groups and items per service type
function openSubcategoryManager() {
  const existingModal = document.getElementById('subcatManagerModal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'subcatManagerModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:560px">
      <div class="modal-header">
        <h2>Administrer underkategorier</h2>
        <button class="modal-close" id="closeSubcatManager">&times;</button>
      </div>
      <div id="subcatManagerBody" style="max-height:60vh;overflow-y:auto;padding:12px;"></div>
    </div>
  `;
  document.body.appendChild(modal);

  renderSubcatManagerBody();

  document.getElementById('closeSubcatManager').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function renderSubcatManagerBody() {
  const bodyEl = document.getElementById('subcatManagerBody');
  if (!bodyEl) return;

  const groups = allSubcategoryGroups || [];

  let html = '';

  if (groups.length === 0) {
    html += `<p style="padding:8px 0;color:var(--color-text-muted);font-size:13px;">
      Ingen underkategori-grupper opprettet enda.
    </p>`;
  }

  for (const group of groups) {
    const subs = group.subcategories || [];
    html += `
      <div class="subcat-group-item" data-group-id="${group.id}" style="margin-bottom:12px;border:1px solid var(--color-border);border-radius:6px;padding:10px;">
        <div style="display:flex;align-items:center;gap:6px;padding:4px 0;">
          <i aria-hidden="true" class="fas fa-folder" style="color:var(--color-text-muted);font-size:12px;"></i>
          <strong style="font-size:13px;">${escapeHtml(group.navn)}</strong>
          <span style="font-size:11px;color:var(--color-text-muted)">(${subs.length})</span>
          <button class="btn-icon-tiny btn-icon-danger" data-action="deleteGroup" data-group-id="${group.id}" title="Slett gruppe">
            <i aria-hidden="true" class="fas fa-trash"></i>
          </button>
        </div>
        <div style="margin-left:12px;">
          ${subs.map(sub => `
            <div style="display:flex;align-items:center;gap:4px;padding:2px 0;font-size:13px;">
              <span>${escapeHtml(sub.navn)}</span>
              <button class="btn-icon-tiny btn-icon-danger" data-action="deleteSubcat" data-subcat-id="${sub.id}" title="Slett">
                <i aria-hidden="true" class="fas fa-trash"></i>
              </button>
            </div>
          `).join('')}
          <div style="display:flex;gap:4px;margin-top:4px;">
            <input type="text" class="subcat-inline-input" placeholder="Ny underkategori..." maxlength="100" data-group-id="${group.id}" style="flex:1;padding:4px 8px;font-size:12px;border:1px solid var(--color-border);border-radius:4px;">
            <button class="btn btn-small btn-primary subcat-inline-add" data-group-id="${group.id}" style="padding:4px 8px;">
              <i aria-hidden="true" class="fas fa-plus"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Add new group form
  html += `
    <div style="margin-top:8px;">
      <div style="display:flex;gap:4px;">
        <input type="text" class="new-group-input" placeholder="Ny gruppe..." maxlength="100" style="flex:1;padding:4px 8px;font-size:12px;border:1px solid var(--color-border);border-radius:4px;">
        <button class="btn btn-small btn-secondary new-group-add" style="padding:4px 8px;">
          <i aria-hidden="true" class="fas fa-plus"></i> Gruppe
        </button>
      </div>
    </div>
  `;

  bodyEl.innerHTML = html;
  attachSubcatManagerHandlers();
}

function attachSubcatManagerHandlers() {
  const bodyEl = document.getElementById('subcatManagerBody');
  if (!bodyEl) return;

  // Delete group
  bodyEl.querySelectorAll('[data-action="deleteGroup"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const groupId = btn.dataset.groupId;
      if (!confirm('Slett denne gruppen og alle underkategorier?')) return;
      const response = await apiFetch(`/api/subcategories/groups/${groupId}`, { method: 'DELETE' });
      if (response.ok) {
        await reloadServiceTypesAndRefresh();
        renderSubcatManagerBody();
      }
    });
  });

  // Delete subcategory
  bodyEl.querySelectorAll('[data-action="deleteSubcat"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const subcatId = btn.dataset.subcatId;
      const response = await apiFetch(`/api/subcategories/items/${subcatId}`, { method: 'DELETE' });
      if (response.ok) {
        await reloadServiceTypesAndRefresh();
        renderSubcatManagerBody();
      }
    });
  });

  // Add subcategory inline
  bodyEl.querySelectorAll('.subcat-inline-add').forEach(btn => {
    btn.addEventListener('click', () => addSubcategoryInline(Number(btn.dataset.groupId)));
  });
  bodyEl.querySelectorAll('.subcat-inline-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSubcategoryInline(Number(input.dataset.groupId));
      }
    });
  });

  // Add new group
  bodyEl.querySelectorAll('.new-group-add').forEach(btn => {
    btn.addEventListener('click', () => addGroupInline());
  });
  bodyEl.querySelectorAll('.new-group-input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addGroupInline();
      }
    });
  });
}

async function addSubcategoryInline(groupId) {
  const input = document.querySelector(`.subcat-inline-input[data-group-id="${groupId}"]`);
  const navn = input?.value?.trim();
  if (!navn) return;

  try {
    const response = await apiFetch('/api/subcategories/items', {
      method: 'POST',
      body: JSON.stringify({ group_id: groupId, navn }),
    });
    if (response.ok) {
      input.value = '';
      await reloadServiceTypesAndRefresh();
      renderSubcatManagerBody();
    } else {
      const err = await response.json();
      showMessage(err.error?.message || 'Kunne ikke opprette underkategori', 'error');
    }
  } catch (error) {
    console.error('Error creating subcategory:', error);
  }
}

async function addGroupInline() {
  const input = document.querySelector('.new-group-input');
  const navn = input?.value?.trim();
  if (!navn) return;

  try {
    const response = await apiFetch('/api/subcategories/groups', {
      method: 'POST',
      body: JSON.stringify({ navn }),
    });
    if (response.ok) {
      input.value = '';
      await reloadServiceTypesAndRefresh();
      renderSubcatManagerBody();
    } else {
      const err = await response.json();
      showMessage(err.error?.message || 'Kunne ikke opprette gruppe', 'error');
    }
  } catch (error) {
    console.error('Error creating group:', error);
  }
}

// Create a new service type inline (from subcategory manager)
// Reload service types from server and update registry
async function reloadServiceTypesAndRefresh() {
  try {
    const response = await apiFetch('/api/config');
    if (response.ok) {
      const result = await response.json();
      // Always reload — handles adding first type and removing last type
      serviceTypeRegistry.loadFromConfig(result.data);
      allSubcategoryGroups = result.data.subcategoryGroups || [];
    }
  } catch (error) {
    console.error('Error reloading service types:', error);
  }
}

async function loadKontaktlogg(kundeId) {
  currentKontaktloggKundeId = kundeId;
  const listEl = document.getElementById('kontaktloggList');

  try {
    const response = await apiFetch(`/api/kunder/${kundeId}/kontaktlogg`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    const logg = result.data || result;

    if (logg.length === 0) {
      listEl.innerHTML = '<div class="kontaktlogg-empty">Ingen registrerte kontakter</div>';
      return;
    }

    listEl.innerHTML = logg.map(k => {
      const dato = new Date(k.dato);
      const datoStr = dato.toLocaleDateString('nb-NO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      return `
        <div class="kontaktlogg-item" data-id="${k.id}">
          <div class="kontaktlogg-info">
            <div class="kontaktlogg-header">
              <span class="kontaktlogg-type">${escapeHtml(k.type)}</span>
              <span class="kontaktlogg-date">${datoStr}</span>
            </div>
            ${k.notat ? `<div class="kontaktlogg-notat">${escapeHtml(k.notat)}</div>` : ''}
          </div>
          <button type="button" class="kontaktlogg-delete" data-action="deleteKontakt" data-id="${k.id}" title="Slett">
            <i aria-hidden="true" class="fas fa-trash"></i>
          </button>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Feil ved lasting av kontaktlogg:', error);
    listEl.innerHTML = '<div class="kontaktlogg-empty">Feil ved lasting</div>';
  }
}

async function addKontaktlogg() {
  if (!currentKontaktloggKundeId) return;

  const typeEl = document.getElementById('kontaktType');
  const notatEl = document.getElementById('kontaktNotat');

  const type = typeEl.value;
  const notat = notatEl.value.trim();

  if (!notat) {
    showMessage('Vennligst skriv et notat', 'warning');
    notatEl.focus();
    return;
  }

  try {
    await apiFetch(`/api/kunder/${currentKontaktloggKundeId}/kontaktlogg`, {
      method: 'POST',
      body: JSON.stringify({
        type,
        notat,
        opprettet_av: localStorage.getItem('userName') || 'Ukjent'
      })
    });

    // Clear input and reload
    notatEl.value = '';
    await loadKontaktlogg(currentKontaktloggKundeId);
  } catch (error) {
    console.error('Feil ved lagring av kontakt:', error);
    showMessage('Feil ved lagring av kontakt', 'error');
  }
}

async function deleteKontaktlogg(id) {
  const confirmed = await showConfirm('Slette denne kontaktregistreringen?', 'Slette kontakt');
  if (!confirmed) return;

  try {
    await apiFetch(`/api/kontaktlogg/${id}`, { method: 'DELETE' });
    await loadKontaktlogg(currentKontaktloggKundeId);
  } catch (error) {
    console.error('Feil ved sletting av kontakt:', error);
  }
}

// === KONTAKTPERSONER FUNCTIONS ===

let currentKontaktpersonerKundeId = null;

async function loadKontaktpersoner(kundeId) {
  currentKontaktpersonerKundeId = kundeId;
  const listEl = document.getElementById('kontaktpersonerList');
  document.getElementById('kontaktpersonerSection').style.display = 'block';

  try {
    const response = await apiFetch(`/api/kunder/${kundeId}/kontaktpersoner`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    const personer = result.data || [];

    if (personer.length === 0) {
      listEl.innerHTML = '<div class="kontaktpersoner-empty">Ingen registrerte kontaktpersoner</div>';
      return;
    }

    const rolleLabels = { teknisk: 'Teknisk', faktura: 'Faktura', daglig: 'Daglig leder', annet: 'Annet' };

    listEl.innerHTML = personer.map(p => {
      const rolleBadge = p.rolle
        ? `<span class="kontaktperson-rolle">${escapeHtml(rolleLabels[p.rolle] || p.rolle)}</span>`
        : '';
      const primaerBadge = p.er_primaer
        ? '<span class="kontaktperson-primaer-badge"><i aria-hidden="true" class="fas fa-star"></i> Primær</span>'
        : '';

      return `
        <div class="kontaktperson-item" data-id="${p.id}">
          <div class="kontaktperson-info">
            <div class="kontaktperson-header">
              <span class="kontaktperson-navn">${escapeHtml(p.navn)}</span>
              ${rolleBadge}
              ${primaerBadge}
            </div>
            <div class="kontaktperson-details">
              ${p.telefon ? `<span class="kontaktperson-detail"><i aria-hidden="true" class="fas fa-phone"></i> ${escapeHtml(p.telefon)}</span>` : ''}
              ${p.epost ? `<span class="kontaktperson-detail"><i aria-hidden="true" class="fas fa-envelope"></i> ${escapeHtml(p.epost)}</span>` : ''}
            </div>
          </div>
          <button type="button" class="kontaktperson-delete" data-action="deleteKontaktperson" data-id="${p.id}" title="Slett">
            <i aria-hidden="true" class="fas fa-trash"></i>
          </button>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Feil ved lasting av kontaktpersoner:', error);
    listEl.innerHTML = '<div class="kontaktpersoner-empty">Feil ved lasting</div>';
  }
}

async function addKontaktperson() {
  if (!currentKontaktpersonerKundeId) return;

  const navnEl = document.getElementById('kontaktpersonNavn');
  const rolleEl = document.getElementById('kontaktpersonRolle');
  const telefonEl = document.getElementById('kontaktpersonTelefon');
  const epostEl = document.getElementById('kontaktpersonEpost');
  const primaerEl = document.getElementById('kontaktpersonPrimaer');

  const navn = navnEl.value.trim();
  if (!navn) {
    showMessage('Vennligst fyll inn navn', 'warning');
    navnEl.focus();
    return;
  }

  try {
    await apiFetch(`/api/kunder/${currentKontaktpersonerKundeId}/kontaktpersoner`, {
      method: 'POST',
      body: JSON.stringify({
        navn,
        rolle: rolleEl.value || undefined,
        telefon: telefonEl.value.trim() || undefined,
        epost: epostEl.value.trim() || undefined,
        er_primaer: primaerEl.checked
      })
    });

    navnEl.value = '';
    rolleEl.value = '';
    telefonEl.value = '';
    epostEl.value = '';
    primaerEl.checked = false;
    await loadKontaktpersoner(currentKontaktpersonerKundeId);
  } catch (error) {
    console.error('Feil ved lagring av kontaktperson:', error);
    showMessage('Feil ved lagring av kontaktperson', 'error');
  }
}

async function deleteKontaktperson(id) {
  const confirmed = await showConfirm('Slette denne kontaktpersonen?', 'Slette kontaktperson');
  if (!confirmed) return;

  try {
    await apiFetch(`/api/kontaktpersoner/${id}`, { method: 'DELETE' });
    await loadKontaktpersoner(currentKontaktpersonerKundeId);
  } catch (error) {
    console.error('Feil ved sletting av kontaktperson:', error);
  }
}

// === MISSING DATA FUNCTIONS ===

function renderMissingData() {
  // Filter customers by missing data
  const missingPhone = customers.filter(c => !c.telefon || c.telefon.trim() === '');
  const missingEmail = customers.filter(c => !c.epost || c.epost.trim() === '');
  const missingCoords = customers.filter(c => c.lat === null || c.lng === null);
  const missingControl = customers.filter(c => !c.neste_kontroll && !c.neste_el_kontroll && !c.neste_brann_kontroll);

  // Update counts
  document.getElementById('missingPhoneCount').textContent = missingPhone.length;
  document.getElementById('missingEmailCount').textContent = missingEmail.length;
  document.getElementById('missingCoordsCount').textContent = missingCoords.length;
  document.getElementById('missingControlCount').textContent = missingControl.length;

  // Update badge
  const totalMissing = missingPhone.length + missingEmail.length + missingCoords.length + missingControl.length;
  updateBadge('missingDataBadge', totalMissing);

  // Render lists
  renderMissingList('missingPhoneList', missingPhone, 'telefon');
  renderMissingList('missingEmailList', missingEmail, 'e-post');
  renderMissingList('missingCoordsList', missingCoords, 'koordinater');
  renderMissingList('missingControlList', missingControl, 'neste kontroll');
}

function renderMissingList(containerId, customersList, missingType) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (customersList.length === 0) {
    container.innerHTML = `<div class="missing-empty">Ingen kunder mangler ${escapeHtml(missingType)}</div>`;
    return;
  }

  container.innerHTML = customersList.map(c => `
    <div class="missing-item" data-action="editCustomer" data-customer-id="${c.id}">
      <div class="missing-item-name">${escapeHtml(c.navn)}</div>
      <div class="missing-item-address">${escapeHtml(c.adresse || '')}${c.poststed ? ', ' + escapeHtml(c.poststed) : ''}</div>
    </div>
  `).join('');
}

// Handle toggle for missing data sections
document.addEventListener('click', function(e) {
  const header = e.target.closest('.missing-header');
  if (header) {
    const toggleId = header.dataset.toggle;
    // Convert 'missing-phone' to 'missingPhoneList'
    const listId = 'missing' + toggleId.replace('missing-', '').charAt(0).toUpperCase() + toggleId.replace('missing-', '').slice(1) + 'List';
    const list = document.getElementById(listId);
    if (list) {
      list.classList.toggle('collapsed');
      header.querySelector('.toggle-icon').classList.toggle('rotated');
    }
  }
});

// === STATISTIKK FUNCTIONS ===

function renderStatistikk() {
  // Calculate status counts
  let forfalte = 0;
  let snart = 0;
  let ok = 0;

  customers.forEach(c => {
    const status = getControlStatus(c);
    if (status.status === 'forfalt') forfalte++;
    else if (status.status === 'snart') snart++;
    else if (status.status === 'ok' || status.status === 'god') ok++;
  });

  // Update overview cards
  document.getElementById('statTotalKunder').textContent = customers.length;
  document.getElementById('statForfalte').textContent = forfalte;
  document.getElementById('statSnart').textContent = snart;
  document.getElementById('statOk').textContent = ok;

  // Render season chart (kontroller per måned)
  renderSeasonChart();

  // Render category stats
  renderCategoryStats();

  // Render area stats
  renderAreaStats();

  // Render el-type stats
  renderEltypeStats();

  // Render brann-system stats
  renderBrannsystemStats();
}


// Add all customers from a cluster to route
function addClusterToRoute(customerIds) {
  customerIds.forEach(id => {
    if (!selectedCustomers.has(id)) {
      selectedCustomers.add(id);
    }
  });
  updateSelectionUI();
  closeMapPopup();

  // Show feedback
  const count = customerIds.length;
  showNotification(`${count} kunder lagt til ruten`);
}

// Zoom to cluster location
function zoomToCluster(lat, lng) {
  closeMapPopup();
  map.flyTo({ center: [lng, lat], zoom: map.getZoom() + 2 });
}

// Simple notification toast
function showNotification(message, type = 'success') {
  // Remove existing notification
  const existing = document.querySelector('.notification-toast');
  if (existing) existing.remove();

  const icons = {
    success: 'fa-check-circle',
    error: 'fa-exclamation-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle'
  };

  const toast = document.createElement('div');
  toast.className = `notification-toast notification-${type}`;
  toast.innerHTML = `<i aria-hidden="true" class="fas ${icons[type] || icons.success}"></i> ${escapeHtml(message)}`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// Make functions available globally for onclick handlers
window.editCustomer = editCustomer;
window.toggleCustomerSelection = toggleCustomerSelection;
window.focusOnCustomer = focusOnCustomer;
window.createRouteForArea = createRouteForArea;
window.addClusterToRoute = addClusterToRoute;
window.zoomToCluster = zoomToCluster;




window.closeContentPanelMobile = closeContentPanelMobile;


// Get next control date for a customer (DYNAMIC via customer.services)
function getNextControlDate(customer) {
  // Use dynamic services array if available
  if (customer.services && Array.isArray(customer.services) && customer.services.length > 0) {
    // Find the earliest upcoming control date from all services
    let earliestDate = null;
    for (const service of customer.services) {
      let nextDate = null;
      if (service.neste_kontroll) {
        nextDate = new Date(service.neste_kontroll);
      } else if (service.siste_kontroll) {
        nextDate = new Date(service.siste_kontroll);
        nextDate.setMonth(nextDate.getMonth() + (service.intervall_months || 12));
      }
      if (nextDate && (!earliestDate || nextDate < earliestDate)) {
        earliestDate = nextDate;
      }
    }
    if (earliestDate) return earliestDate;
  }

  // Legacy fallback: Use hardcoded columns
  const kategori = customer.kategori || '';

  // El-Kontroll or combined
  if (kategori.includes('El-Kontroll')) {
    if (customer.neste_el_kontroll) {
      return new Date(customer.neste_el_kontroll);
    }
    if (customer.siste_el_kontroll) {
      const date = new Date(customer.siste_el_kontroll);
      date.setMonth(date.getMonth() + (customer.el_kontroll_intervall || 36));
      return date;
    }
  }

  // Brannvarsling only
  if (kategori === 'Brannvarsling') {
    if (customer.neste_brann_kontroll) {
      return new Date(customer.neste_brann_kontroll);
    }
    if (customer.siste_brann_kontroll) {
      const date = new Date(customer.siste_brann_kontroll);
      date.setMonth(date.getMonth() + (customer.brann_kontroll_intervall || 12));
      return date;
    }
  }

  // Legacy generic fields fallback
  if (customer.neste_kontroll) {
    return new Date(customer.neste_kontroll);
  }
  if (customer.siste_kontroll) {
    const date = new Date(customer.siste_kontroll);
    date.setMonth(date.getMonth() + (customer.kontroll_intervall_mnd || 12));
    return date;
  }

  return null;
}

// Get all upcoming control dates for a customer (returns array of service dates)
function getCustomerServiceDates(customer) {
  const dates = [];

  // Use dynamic services array if available
  if (customer.services && Array.isArray(customer.services)) {
    for (const service of customer.services) {
      let nextDate = null;
      if (service.neste_kontroll) {
        nextDate = new Date(service.neste_kontroll);
      } else if (service.siste_kontroll) {
        nextDate = new Date(service.siste_kontroll);
        nextDate.setMonth(nextDate.getMonth() + (service.intervall_months || 12));
      }
      if (nextDate) {
        dates.push({
          service_type_name: service.service_type_name,
          service_type_slug: service.service_type_slug,
          service_type_icon: service.service_type_icon,
          service_type_color: service.service_type_color,
          neste_kontroll: nextDate,
          siste_kontroll: service.siste_kontroll ? new Date(service.siste_kontroll) : null,
          intervall_months: service.intervall_months
        });
      }
    }
  }

  return dates;
}

// Format date
function getISOWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const yearStart = new Date(d.getFullYear(), 0, 4);
  return Math.round(((d - yearStart) / 86400000 + 1) / 7);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  if (appConfig.datoModus === 'month_year') {
    return date.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString('nb-NO');
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  if (appConfig.datoModus === 'month_year') {
    return date.toLocaleDateString('nb-NO', { month: 'short', year: 'numeric' });
  }
  return date.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' });
}

function formatDateInline(date) {
  if (!date) return '';
  if (isNaN(date.getTime())) return '';
  if (appConfig.datoModus === 'month_year') {
    return date.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function normalizeDateValue(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return value + '-01';
  return value;
}

function applyDateModeToInputs() {
  if (appConfig.datoModus !== 'month_year') return;
  document.querySelectorAll('input[type="date"]').forEach(input => {
    input.type = 'month';
    if (input.value && input.value.length === 10) {
      input.value = input.value.substring(0, 7);
    }
  });
}

// Save API key
function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (apiKey) {
    localStorage.setItem('ors_api_key', apiKey);
    apiKeyModal.classList.add('hidden');
    planRoute(); // Retry route planning
  }
}


// ========================================
// DYNAMIC FILTER PANEL CATEGORIES
// ========================================

/**
 * Render category filter buttons dynamically based on ServiceTypeRegistry
 */
function renderFilterPanelCategories() {
  const container = document.getElementById('categoryFilterButtons');
  if (!container) return;

  const serviceTypes = serviceTypeRegistry.getAll();

  // Start with "Alle" button
  let html = `
    <button class="category-btn ${selectedCategory === 'all' ? 'active' : ''}" data-category="all">
      <i aria-hidden="true" class="fas fa-list"></i> Alle
    </button>
  `;

  // Add button for each service type
  serviceTypes.forEach(st => {
    const isActive = selectedCategory === st.name || selectedCategory === st.slug;
    html += `
      <button class="category-btn ${isActive ? 'active' : ''}" data-category="${st.name}">
        <i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color}"></i> ${st.name}
      </button>
    `;
  });

  // Add combined option if 2+ service types
  if (serviceTypes.length >= 2) {
    const combinedName = serviceTypes.map(st => st.name).join(' + ');
    const icons = serviceTypes.map(st => `<i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color}"></i>`).join('');
    const isActive = selectedCategory === combinedName;
    html += `
      <button class="category-btn ${isActive ? 'active' : ''}" data-category="${combinedName}">
        ${icons} ${serviceTypes.length > 2 ? 'Alle' : 'Begge'}
      </button>
    `;
  }

  container.innerHTML = html;
  attachCategoryFilterHandlers();
  attachCategoryDropHandlers();
}

/**
 * No-op: drop handlers are handled by custom drag system
 */
function attachCategoryDropHandlers() {}

// ========================================
// MARKER DRAG-TO-CATEGORY SYSTEM
// ========================================

let dragGhost = null;
let dragHoveredBtn = null;

/**
 * Start custom drag from a map marker
 */
function startMarkerDrag(customerId, x, y) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;

  // Create floating ghost element
  dragGhost = document.createElement('div');
  dragGhost.className = 'drag-ghost';
  dragGhost.innerHTML = `<i aria-hidden="true" class="fas fa-map-marker-alt"></i> ${escapeHtml(customer.navn)}`;
  dragGhost.style.left = x + 'px';
  dragGhost.style.top = y + 'px';
  document.body.appendChild(dragGhost);
  document.body.classList.add('marker-dragging');
}

/**
 * Update ghost position and highlight drop target
 */
function updateMarkerDrag(x, y) {
  if (!dragGhost) return;
  dragGhost.style.left = x + 'px';
  dragGhost.style.top = y + 'px';

  // Check which category button is under cursor
  const elUnder = document.elementFromPoint(x, y);
  const btn = elUnder?.closest('.category-btn');

  if (dragHoveredBtn && dragHoveredBtn !== btn) {
    dragHoveredBtn.classList.remove('drop-hover');
  }

  if (btn && btn.dataset.category && btn.dataset.category !== 'all') {
    btn.classList.add('drop-hover');
    dragHoveredBtn = btn;
  } else {
    dragHoveredBtn = null;
  }
}

/**
 * End drag - assign category if dropped on a button
 */
function endMarkerDrag(customerId) {
  const targetCategory = dragHoveredBtn?.dataset?.category;

  // Clean up
  if (dragGhost) {
    dragGhost.remove();
    dragGhost = null;
  }
  if (dragHoveredBtn) {
    dragHoveredBtn.classList.remove('drop-hover');
    dragHoveredBtn = null;
  }
  document.body.classList.remove('marker-dragging');

  // Assign category if valid target
  if (targetCategory && targetCategory !== 'all') {
    assignCustomerCategory(customerId, targetCategory);
  }
}

/**
 * Assign a category to a customer via drag-and-drop
 */
async function assignCustomerCategory(customerId, categoryName) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;

  if (customer.kategori === categoryName) {
    showToast('Kunden har allerede denne kategorien', 'info');
    return;
  }

  try {
    const response = await apiFetch(`/api/kunder/${customerId}`, {
      method: 'PUT',
      body: JSON.stringify({
        navn: customer.navn,
        adresse: customer.adresse,
        postnummer: customer.postnummer,
        poststed: customer.poststed,
        telefon: customer.telefon,
        epost: customer.epost,
        lat: customer.lat,
        lng: customer.lng,
        kategori: categoryName
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Kunne ikke oppdatere kategori');
    }

    // Update local data and re-render
    customer.kategori = categoryName;
    renderMarkers(customers.filter(c => c.lat && c.lng));
    updateCategoryFilterCounts();
    showToast(`${escapeHtml(customer.navn)} flyttet til ${escapeHtml(categoryName)}`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// Legacy filter functions (normalizeDriftstype, renderDriftskategoriFilter,
// normalizeBrannsystem, renderBrannsystemFilter, renderElTypeFilter, etc.)
// removed — migrated to subcategory system (migration 044).
// All filtering now handled by renderSubcategoryFilter() below.

/**
 * Attach click handlers to category filter buttons
 */
function attachCategoryFilterHandlers() {
  const container = document.getElementById('categoryFilterButtons');
  if (!container) return;

  container.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from all
      container.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
      // Add active to clicked
      btn.classList.add('active');
      // Update selected category
      selectedCategory = btn.dataset.category;

      // Apply filter
      applyFilters();
    });
  });
}

// ========================================
// SUBCATEGORY FILTER
// ========================================

/**
 * Render subcategory filter buttons grouped by service type and subcategory group
 */
/**
 * Render subcategory section: filter buttons + inline management.
 * Always visible when organization has service types.
 */
let subcatAdminMode = false;
let collapsedSubcatGroups = (() => {
  try {
    const saved = localStorage.getItem('skyplanner_subcatCollapsed');
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
})();

function renderSubcategoryFilter() {
  const contentEl = document.getElementById('subcategoryFilterContent');
  const filterContainer = document.getElementById('subcategoryFilter');
  if (!contentEl || !filterContainer) return;

  const groups = allSubcategoryGroups || [];

  if (groups.length === 0) {
    // Still show filter container with add-group input for admins
    filterContainer.style.display = 'block';
    contentEl.innerHTML = `<div class="subcat-add-row subcat-add-group-row">
      <input type="text" class="subcat-add-input" placeholder="Ny gruppe..." maxlength="100" data-add-group-input>
      <button class="subcat-add-btn subcat-add-group-btn" data-action="addGroup" title="Legg til gruppe"><i aria-hidden="true" class="fas fa-plus"></i> Gruppe</button>
    </div>`;
    attachSubcategoryHandlers();
    return;
  }

  filterContainer.style.display = 'block';

  // Sync admin toggle button state
  const toggleBtn = document.getElementById('subcatAdminToggle');
  if (toggleBtn) toggleBtn.classList.toggle('active', subcatAdminMode);

  // Count customers per subcategory
  const subcatCounts = {};
  Object.values(kundeSubcatMap).forEach(assignments => {
    assignments.forEach(a => {
      const key = `${a.group_id}_${a.subcategory_id}`;
      subcatCounts[key] = (subcatCounts[key] || 0) + 1;
    });
  });

  // Initialize collapsed state: default all groups to collapsed on first render
  if (!collapsedSubcatGroups) {
    collapsedSubcatGroups = {};
    groups.forEach(g => { collapsedSubcatGroups[g.id] = true; });
    try { localStorage.setItem('skyplanner_subcatCollapsed', JSON.stringify(collapsedSubcatGroups)); } catch {}
  }

  let html = '';

  groups.forEach(group => {
    const subs = group.subcategories || [];
    const activeSubcatId = selectedSubcategories[group.id];
    // Default new groups to collapsed
    const isCollapsed = collapsedSubcatGroups[group.id] !== false;
    const activeSub = activeSubcatId ? subs.find(s => s.id === activeSubcatId) : null;

    // Group heading (clickable for collapse)
    html += `<div class="subcat-group ${isCollapsed ? 'subcat-group-collapsed' : ''}">
      <div class="subcat-group-header">
        <span class="subcat-group-name" data-toggle-group="${group.id}">
          <i aria-hidden="true" class="fas fa-chevron-${isCollapsed ? 'right' : 'down'} subcat-chevron"></i>
          ${escapeHtml(group.navn)}
          ${isCollapsed && activeSub ? `<span class="subcat-active-indicator">${escapeHtml(activeSub.navn)}</span>` : ''}
        </span>
        <span class="subcat-admin-only">
          <button class="category-manage-btn" data-action="editGroup" data-group-id="${group.id}" data-group-navn="${escapeHtml(group.navn)}" title="Rediger"><i aria-hidden="true" class="fas fa-pen"></i></button>
          <button class="category-manage-btn subcat-delete-btn" data-action="deleteGroup" data-group-id="${group.id}" data-group-navn="${escapeHtml(group.navn)}" title="Slett"><i aria-hidden="true" class="fas fa-trash"></i></button>
        </span>
      </div>`;

    // Filter buttons (hidden when collapsed)
    html += `<div class="subcat-group-body">`;
    if (subs.length > 0) {
      html += `<div class="category-filter-buttons subcat-filter-buttons">`;
      html += `<button class="category-btn subcat-btn ${!activeSubcatId ? 'active' : ''}" data-group-id="${group.id}" data-subcat-id="all">Alle</button>`;
      subs.forEach(sub => {
        const count = subcatCounts[`${group.id}_${sub.id}`] || 0;
        const isActive = activeSubcatId === sub.id;
        html += `<span class="subcat-btn-wrapper">
          <button class="category-btn subcat-btn ${isActive ? 'active' : ''}" data-group-id="${group.id}" data-subcat-id="${sub.id}">
            ${escapeHtml(sub.navn)} <span class="subcat-count">${count}</span>
          </button>
          <span class="subcat-admin-only subcat-item-actions">
            <button class="category-manage-btn" data-action="editSubcat" data-subcat-id="${sub.id}" data-subcat-navn="${escapeHtml(sub.navn)}" title="Rediger"><i aria-hidden="true" class="fas fa-pen"></i></button>
            <button class="category-manage-btn subcat-delete-btn" data-action="deleteSubcat" data-subcat-id="${sub.id}" data-subcat-navn="${escapeHtml(sub.navn)}" title="Slett"><i aria-hidden="true" class="fas fa-trash"></i></button>
          </span>
        </span>`;
      });
      html += `</div>`;
    }

    // Add subcategory input (admin only)
    html += `<div class="subcat-add-row subcat-admin-only">
      <input type="text" class="subcat-add-input" placeholder="Ny underkategori..." maxlength="100" data-add-subcat-input data-group-id="${group.id}">
      <button class="subcat-add-btn" data-action="addSubcat" data-group-id="${group.id}" title="Legg til"><i aria-hidden="true" class="fas fa-plus"></i></button>
    </div>`;

    html += `</div>`; // close subcat-group-body
    html += `</div>`; // close subcat-group
  });

  // Add group input (admin only)
  html += `<div class="subcat-add-row subcat-add-group-row subcat-admin-only">
    <input type="text" class="subcat-add-input" placeholder="Ny gruppe..." maxlength="100" data-add-group-input>
    <button class="subcat-add-btn subcat-add-group-btn" data-action="addGroup" title="Legg til gruppe"><i aria-hidden="true" class="fas fa-plus"></i> Gruppe</button>
  </div>`;

  contentEl.innerHTML = html;
  contentEl.classList.toggle('subcat-admin-active', subcatAdminMode);
  attachSubcategoryHandlers();
}

/**
 * Attach click handlers for subcategory filter buttons and CRUD actions
 */
function attachSubcategoryHandlers() {
  const contentEl = document.getElementById('subcategoryFilterContent');
  if (!contentEl) return;

  // Admin toggle button (outside contentEl — attach once globally)
  const adminToggle = document.getElementById('subcatAdminToggle');
  if (adminToggle && !adminToggle.dataset.handlerAttached) {
    adminToggle.dataset.handlerAttached = 'true';
    adminToggle.addEventListener('click', () => {
      subcatAdminMode = !subcatAdminMode;
      adminToggle.classList.toggle('active', subcatAdminMode);
      contentEl.classList.toggle('subcat-admin-active', subcatAdminMode);
    });
  }

  // All handlers via delegation (only attach once)
  if (contentEl.dataset.subcatHandlersAttached) return;
  contentEl.dataset.subcatHandlersAttached = 'true';

  contentEl.addEventListener('click', async (e) => {
    // Collapse/expand group toggle
    const groupToggle = e.target.closest('[data-toggle-group]');
    if (groupToggle) {
      const groupId = parseInt(groupToggle.dataset.toggleGroup, 10);
      // Toggle: if currently collapsed (true or undefined), open it (false); if open (false), collapse it (true)
      collapsedSubcatGroups[groupId] = collapsedSubcatGroups[groupId] === false;
      try { localStorage.setItem('skyplanner_subcatCollapsed', JSON.stringify(collapsedSubcatGroups)); } catch {}
      renderSubcategoryFilter();
      return;
    }

    // Filter button clicks
    const filterBtn = e.target.closest('.subcat-btn');
    if (filterBtn) {
      const groupId = parseInt(filterBtn.dataset.groupId, 10);
      const subcatId = filterBtn.dataset.subcatId;
      if (subcatId === 'all') {
        delete selectedSubcategories[groupId];
      } else {
        selectedSubcategories[groupId] = parseInt(subcatId, 10);
      }
      renderSubcategoryFilter();
      applyFilters();
      return;
    }

    // CRUD action buttons
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;

    if (action === 'addGroup') {
      const input = contentEl.querySelector('input[data-add-group-input]');
      const navn = input?.value?.trim();
      if (!navn) { input?.focus(); return; }
      btn.disabled = true;
      try {
        const res = await apiFetch('/api/subcategories/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ navn })
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'Feil'); }
        const json = await res.json();
        subcatRegistryAddGroup(json.data || { id: Date.now(), navn });
        showToast('Gruppe opprettet', 'success');
        renderSubcategoryFilter();
      } catch (err) { showToast(err.message, 'error'); }
      finally { btn.disabled = false; }
    }

    else if (action === 'addSubcat') {
      const groupId = parseInt(btn.dataset.groupId, 10);
      const input = contentEl.querySelector(`input[data-add-subcat-input][data-group-id="${groupId}"]`);
      const navn = input?.value?.trim();
      if (!navn) { input?.focus(); return; }
      btn.disabled = true;
      try {
        const res = await apiFetch('/api/subcategories/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: groupId, navn })
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'Feil'); }
        const json = await res.json();
        subcatRegistryAddItem(groupId, json.data || { id: Date.now(), navn });
        showToast('Underkategori opprettet', 'success');
        renderSubcategoryFilter();
      } catch (err) { showToast(err.message, 'error'); }
      finally { btn.disabled = false; }
    }

    else if (action === 'editGroup') {
      const groupId = parseInt(btn.dataset.groupId, 10);
      const currentName = btn.dataset.groupNavn;
      const newName = prompt('Nytt navn for gruppen:', currentName);
      if (!newName || newName.trim() === currentName) return;
      try {
        const res = await apiFetch(`/api/subcategories/groups/${groupId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ navn: newName.trim() })
        });
        if (!res.ok) throw new Error('Kunne ikke oppdatere');
        subcatRegistryEditGroup(groupId, newName.trim());
        showToast('Gruppe oppdatert', 'success');
        renderSubcategoryFilter();
      } catch (err) { showToast(err.message, 'error'); }
    }

    else if (action === 'deleteGroup') {
      const groupId = parseInt(btn.dataset.groupId, 10);
      const navn = btn.dataset.groupNavn;
      const confirmed = await showConfirm(`Slett gruppen "${navn}"? Alle underkategorier slettes også.`, 'Slette gruppe');
      if (!confirmed) return;
      try {
        const res = await apiFetch(`/api/subcategories/groups/${groupId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Kunne ikke slette');
        subcatRegistryDeleteGroup(groupId);
        delete selectedSubcategories[groupId];
        showToast('Gruppe slettet', 'success');
        renderSubcategoryFilter();
        applyFilters();
      } catch (err) { showToast(err.message, 'error'); }
    }

    else if (action === 'editSubcat') {
      const subcatId = parseInt(btn.dataset.subcatId, 10);
      const currentName = btn.dataset.subcatNavn;
      const newName = prompt('Nytt navn:', currentName);
      if (!newName || newName.trim() === currentName) return;
      try {
        const res = await apiFetch(`/api/subcategories/items/${subcatId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ navn: newName.trim() })
        });
        if (!res.ok) throw new Error('Kunne ikke oppdatere');
        subcatRegistryEditItem(subcatId, newName.trim());
        showToast('Underkategori oppdatert', 'success');
        renderSubcategoryFilter();
      } catch (err) { showToast(err.message, 'error'); }
    }

    else if (action === 'deleteSubcat') {
      const subcatId = parseInt(btn.dataset.subcatId, 10);
      const navn = btn.dataset.subcatNavn;
      const confirmed = await showConfirm(`Slett "${navn}"?`, 'Slette underkategori');
      if (!confirmed) return;
      try {
        const res = await apiFetch(`/api/subcategories/items/${subcatId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Kunne ikke slette');
        subcatRegistryDeleteItem(subcatId);
        showToast('Underkategori slettet', 'success');
        renderSubcategoryFilter();
        applyFilters();
      } catch (err) { showToast(err.message, 'error'); }
    }
  });

  // Enter key to submit inline inputs
  contentEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const input = e.target;
    if (input.dataset.addGroupInput !== undefined) {
      contentEl.querySelector('button[data-action="addGroup"]')?.click();
      e.preventDefault();
    } else if (input.dataset.addSubcatInput !== undefined) {
      const groupId = input.dataset.groupId;
      contentEl.querySelector(`button[data-action="addSubcat"][data-group-id="${groupId}"]`)?.click();
      e.preventDefault();
    }
  });
}

/**
 * Local registry helpers — update allSubcategoryGroups in-place
 * instead of reloading the full /api/config (which runs 6+ DB queries).
 */
function subcatRegistryAddGroup(group) {
  allSubcategoryGroups.push({ id: group.id, navn: group.navn, subcategories: [] });
}

function subcatRegistryAddItem(groupId, item) {
  const group = allSubcategoryGroups.find(g => g.id === groupId);
  if (group) {
    if (!group.subcategories) group.subcategories = [];
    group.subcategories.push({ id: item.id, navn: item.navn });
  }
}

function subcatRegistryEditGroup(groupId, newName) {
  const group = allSubcategoryGroups.find(g => g.id === groupId);
  if (group) group.navn = newName;
}

function subcatRegistryDeleteGroup(groupId) {
  const idx = allSubcategoryGroups.findIndex(g => g.id === groupId);
  if (idx !== -1) allSubcategoryGroups.splice(idx, 1);
}

function subcatRegistryEditItem(subcatId, newName) {
  for (const group of allSubcategoryGroups) {
    const item = (group.subcategories || []).find(s => s.id === subcatId);
    if (item) { item.navn = newName; return; }
  }
}

function subcatRegistryDeleteItem(subcatId) {
  for (const group of allSubcategoryGroups) {
    if (!group.subcategories) continue;
    const idx = group.subcategories.findIndex(s => s.id === subcatId);
    if (idx !== -1) { group.subcategories.splice(idx, 1); return; }
  }
}

// ========================================
// DYNAMIC FIELD FILTERS
// ========================================

/**
 * Render dynamic filter sections for organization fields with is_filterable = 1
 */
function renderDynamicFieldFilters() {
  const container = document.getElementById('dynamicFieldFilters');
  if (!container) return;

  const filterableFields = organizationFields.filter(f => f.is_filterable === 1 || f.is_filterable === true);

  if (filterableFields.length === 0) {
    container.innerHTML = '';
    return;
  }

  const html = filterableFields.map(field => {
    const isExpanded = localStorage.getItem(`fieldFilterExpanded-${field.field_name}`) === 'true';

    return `
      <div class="category-filter dynamic-field-filter" data-field="${escapeHtml(field.field_name)}">
        <div class="category-filter-title clickable-header" data-toggle="field-${escapeHtml(field.field_name)}">
          <span>${escapeHtml(field.display_name)}</span>
          <i aria-hidden="true" class="fas fa-chevron-${isExpanded ? 'down' : 'right'} toggle-icon"></i>
        </div>
        <div class="dynamic-filter-content" id="fieldFilter-${escapeHtml(field.field_name)}" style="display: ${isExpanded ? 'block' : 'none'};">
          ${renderFieldFilterInput(field)}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
  attachDynamicFilterHandlers();
}

/**
 * Render the appropriate filter input based on field type
 */
function renderFieldFilterInput(field) {
  const currentValue = dynamicFieldFilters[field.field_name];

  switch (field.field_type) {
    case 'select':
      return renderSelectFilterButtons(field, currentValue);
    case 'text':
      return renderTextFilterInput(field, currentValue);
    case 'number':
      return renderNumberRangeFilter(field, currentValue);
    case 'date':
      return renderDateRangeFilter(field, currentValue);
    default:
      return renderTextFilterInput(field, currentValue);
  }
}

/**
 * Render select field as button group
 */
function renderSelectFilterButtons(field, currentValue) {
  const options = field.options || [];
  let html = `<div class="category-filter-buttons">
    <button class="category-btn dynamic-field-btn ${!currentValue || currentValue === 'all' ? 'active' : ''}"
            data-field="${escapeHtml(field.field_name)}" data-value="all">
      <i aria-hidden="true" class="fas fa-list"></i> Alle
    </button>`;

  options.forEach(opt => {
    const isActive = currentValue === opt.value;
    html += `
      <button class="category-btn dynamic-field-btn ${isActive ? 'active' : ''}"
              data-field="${escapeHtml(field.field_name)}" data-value="${escapeHtml(opt.value)}">
        ${escapeHtml(opt.display_name || opt.value)}
      </button>`;
  });

  html += '</div>';
  return html;
}

/**
 * Render text field as search input
 */
function renderTextFilterInput(field, currentValue) {
  return `
    <div class="filter-input-wrapper">
      <input type="text"
             class="dynamic-filter-input"
             data-field="${escapeHtml(field.field_name)}"
             placeholder="Filtrer på ${escapeHtml(field.display_name)}..."
             value="${escapeHtml(currentValue || '')}">
    </div>`;
}

/**
 * Render number field as min/max range
 */
function renderNumberRangeFilter(field, currentValue) {
  const min = currentValue?.min || '';
  const max = currentValue?.max || '';
  return `
    <div class="filter-range-wrapper">
      <input type="number" class="dynamic-filter-range" data-field="${escapeHtml(field.field_name)}" data-range="min" placeholder="Min" value="${min}">
      <span class="range-separator">-</span>
      <input type="number" class="dynamic-filter-range" data-field="${escapeHtml(field.field_name)}" data-range="max" placeholder="Maks" value="${max}">
    </div>`;
}

/**
 * Render date field as from/to range
 */
function renderDateRangeFilter(field, currentValue) {
  const from = currentValue?.from || '';
  const to = currentValue?.to || '';
  const dateInputType = appConfig.datoModus === 'month_year' ? 'month' : 'date';
  return `
    <div class="filter-range-wrapper">
      <input type="${dateInputType}" class="dynamic-filter-range" data-field="${escapeHtml(field.field_name)}" data-range="from" value="${from}">
      <span class="range-separator">til</span>
      <input type="${dateInputType}" class="dynamic-filter-range" data-field="${escapeHtml(field.field_name)}" data-range="to" value="${to}">
    </div>`;
}

/**
 * Attach event handlers for dynamic field filters
 */
function attachDynamicFilterHandlers() {
  const container = document.getElementById('dynamicFieldFilters');
  if (!container) return;

  // Toggle handlers for section headers
  container.querySelectorAll('.clickable-header').forEach(header => {
    header.addEventListener('click', () => {
      const fieldName = header.dataset.toggle.replace('field-', '');
      const content = document.getElementById(`fieldFilter-${fieldName}`);
      const icon = header.querySelector('.toggle-icon');

      if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.classList.replace('fa-chevron-right', 'fa-chevron-down');
        localStorage.setItem(`fieldFilterExpanded-${fieldName}`, 'true');
      } else {
        content.style.display = 'none';
        icon.classList.replace('fa-chevron-down', 'fa-chevron-right');
        localStorage.setItem(`fieldFilterExpanded-${fieldName}`, 'false');
      }
    });
  });

  // Select button handlers
  container.querySelectorAll('.dynamic-field-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fieldName = btn.dataset.field;
      const value = btn.dataset.value;

      // Update active state
      btn.parentElement.querySelectorAll('.dynamic-field-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update filter state
      if (value === 'all') {
        delete dynamicFieldFilters[fieldName];
      } else {
        dynamicFieldFilters[fieldName] = value;
      }

      applyFilters();
    });
  });

  // Text input handlers with debounce
  let textInputTimeout;
  container.querySelectorAll('.dynamic-filter-input').forEach(input => {
    input.addEventListener('input', () => {
      clearTimeout(textInputTimeout);
      textInputTimeout = setTimeout(() => {
        const fieldName = input.dataset.field;
        const value = input.value.trim();

        if (value) {
          dynamicFieldFilters[fieldName] = value;
        } else {
          delete dynamicFieldFilters[fieldName];
        }

        applyFilters();
      }, 300);
    });
  });

  // Range input handlers (number and date)
  container.querySelectorAll('.dynamic-filter-range').forEach(input => {
    input.addEventListener('change', () => {
      const fieldName = input.dataset.field;
      const rangeType = input.dataset.range;
      const value = input.value;

      if (!dynamicFieldFilters[fieldName] || typeof dynamicFieldFilters[fieldName] !== 'object') {
        dynamicFieldFilters[fieldName] = {};
      }

      if (value) {
        dynamicFieldFilters[fieldName][rangeType] = value;
      } else {
        delete dynamicFieldFilters[fieldName][rangeType];
        if (Object.keys(dynamicFieldFilters[fieldName]).length === 0) {
          delete dynamicFieldFilters[fieldName];
        }
      }

      applyFilters();
    });
  });
}


// ========================================
// DASHBOARD FUNCTIONS
// ========================================

/**
 * Update dashboard with current customer statistics
 */
function updateDashboard() {
  if (!customers || customers.length === 0) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let overdueCount = 0;
  let upcomingCount = 0;
  let okCount = 0;
  const categoryStats = {};

  customers.forEach(customer => {
    const nextDate = getNextControlDate(customer);

    if (nextDate) {
      const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));

      if (daysUntil < 0) {
        overdueCount++;
      } else if (daysUntil <= 30) {
        upcomingCount++;
      } else {
        okCount++;
      }
    }

    // Count by category
    const cat = customer.kategori || 'Ukjent';
    categoryStats[cat] = (categoryStats[cat] || 0) + 1;
  });

  // Update stat cards
  const totalEl = document.getElementById('dashTotalKunder');
  const overdueEl = document.getElementById('dashForfalte');
  const upcomingEl = document.getElementById('dashKommende');
  const okEl = document.getElementById('dashFullfort');
  const overdueCountEl = document.getElementById('dashOverdueCount');

  if (totalEl) totalEl.textContent = customers.length;
  if (overdueEl) overdueEl.textContent = overdueCount;
  if (upcomingEl) upcomingEl.textContent = upcomingCount;
  if (okEl) okEl.textContent = okCount;
  if (overdueCountEl) overdueCountEl.textContent = overdueCount;

  // Update sidebar quick stats
  const quickKunder = document.getElementById('quickStatKunder');
  const quickForfalte = document.getElementById('quickStatForfalte');
  const quickKommende = document.getElementById('quickStatKommende');
  const quickOk = document.getElementById('quickStatOk');

  if (quickKunder) quickKunder.textContent = customers.length;
  if (quickForfalte) quickForfalte.textContent = overdueCount;
  if (quickKommende) quickKommende.textContent = upcomingCount;
  if (quickOk) quickOk.textContent = okCount;

  // Update category overview
  renderDashboardCategories(categoryStats);

  // Update area list
  renderDashboardAreas();
}

/**
 * Render category statistics in dashboard
 */
function renderDashboardCategories(categoryStats) {
  const container = document.getElementById('dashCategoryOverview');
  if (!container) return;

  const serviceTypes = serviceTypeRegistry.getAll();
  let html = '';

  // Use service types for display
  serviceTypes.forEach(st => {
    const count = categoryStats[st.name] || 0;
    html += `
      <div class="category-stat">
        <i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color}"></i>
        <span class="cat-name">${st.name}</span>
        <span class="cat-count">${count}</span>
      </div>
    `;
  });

  // Add combined category if exists
  const combinedName = serviceTypes.map(st => st.name).join(' + ');
  const combinedCount = categoryStats[combinedName] || 0;
  if (combinedCount > 0) {
    const icons = serviceTypes.map(st => `<i aria-hidden="true" class="fas ${st.icon}" style="color: ${st.color}"></i>`).join('');
    html += `
      <div class="category-stat">
        ${icons}
        <span class="cat-name">${serviceTypes.length > 2 ? 'Alle' : 'Begge'}</span>
        <span class="cat-count">${combinedCount}</span>
      </div>
    `;
  }

  container.innerHTML = html;
}

/**
 * Render area quick links in dashboard
 */
function renderDashboardAreas() {
  const container = document.getElementById('dashAreaList');
  if (!container) return;

  // Count customers per area
  const areaCounts = {};
  customers.forEach(c => {
    const area = c.poststed || 'Ukjent';
    areaCounts[area] = (areaCounts[area] || 0) + 1;
  });

  // Sort by count descending, take top 10
  const sortedAreas = Object.entries(areaCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  let html = '';
  sortedAreas.forEach(([area, count]) => {
    html += `
      <div class="area-chip" data-area="${escapeHtml(area)}">
        ${escapeHtml(area)}
        <span class="area-count">${count}</span>
      </div>
    `;
  });

  container.innerHTML = html;

  // Add click handlers
  container.querySelectorAll('.area-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const area = chip.dataset.area;
      // Switch to customers tab and filter by area
      switchToTab('customers');
      // Set area filter if available
      const areaSelect = document.getElementById('omradeFilter');
      if (areaSelect) {
        areaSelect.value = area;
        applyFilters();
      }
    });
  });
}


// ========================================
// SPA VIEW MANAGEMENT — Mapbox GL JS v3
// ========================================

// Default view: show all of Norway (used when no office address is configured)
const NORWAY_CENTER = [10.0, 64.0]; // [lng, lat]
const NORWAY_ZOOM = 4.0;

// Get Mapbox access token from server config
function getMapboxToken() {
  if (appConfig.mapboxAccessToken) {
    return appConfig.mapboxAccessToken;
  }
  Logger.error('Mapbox token mangler - sett MAPBOX_ACCESS_TOKEN i server-miljøvariabler');
  return '';
}

// Refresh map tiles when Mapbox token becomes available (e.g. after auth)
function refreshMapTiles() {
  if (!map) return;
  const token = getMapboxToken();
  if (!token) return;
  if (mapboxgl.accessToken === token) return;
  Logger.log('Refreshing map with updated Mapbox token');
  mapboxgl.accessToken = token;
}

// Map mode: 'satellite' or 'dark'
let mapMode = 'satellite';

// Track whether custom layers need re-adding after style change
let _pendingStyleReload = false;

// 3D terrain state
let terrainEnabled = false;
let terrainExaggeration = 1.5;
const TERRAIN_EXAGGERATION_DEFAULT = 1.5;
const TERRAIN_EXAGGERATION_MIN = 0.3;
const TERRAIN_EXAGGERATION_MAX = 3.0;
const TERRAIN_EXAGGERATION_STEP = 0.1;
let terrainPitch = 72;
const TERRAIN_PITCH_DEFAULT = 72;
const TERRAIN_PITCH_MIN = 0;
const TERRAIN_PITCH_MAX = 85;
const TERRAIN_PITCH_STEP = 1;
const TERRAIN_LS_KEY = 'skyplanner_terrainEnabled';
const TERRAIN_EXAG_LS_KEY = 'skyplanner_terrainExaggeration';
const TERRAIN_PITCH_LS_KEY = 'skyplanner_terrainPitch';

// Toggle between satellite and dark map style
function toggleNightMode() {
  if (!map) return;

  const btn = document.getElementById('nightmodeBtn');
  const icon = btn?.querySelector('i');
  const mapContainer = document.getElementById('map');

  // Disable button during transition
  if (btn) btn.disabled = true;

  // Fade out the map
  mapContainer.style.transition = 'opacity 0.4s ease-out';
  mapContainer.style.opacity = '0';

  setTimeout(() => {
    if (mapMode === 'dark') {
      map.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
      mapMode = 'satellite';
      btn?.classList.add('satellite-active');
      if (icon) icon.className = 'fas fa-sun';
      btn?.setAttribute('title', 'Bytt til mørkt kart');
    } else {
      map.setStyle('mapbox://styles/mapbox/navigation-night-v1');
      mapMode = 'dark';
      btn?.classList.remove('satellite-active');
      if (icon) icon.className = 'fas fa-moon';
      btn?.setAttribute('title', 'Bytt til satellittkart');
    }

    // Re-add custom layers after style loads
    map.once('style.load', () => {
      addNorwayBorder();
      reapplyTerrain();
      // Re-add cluster source/layers (native GL layers are lost on style change)
      if (typeof readdClusterLayers === 'function') readdClusterLayers();
    });

    // Fade back in
    setTimeout(() => {
      mapContainer.style.opacity = '1';
      if (btn) btn.disabled = false;
    }, 300);
  }, 400);
}

// ========================================
// 3D TERRAIN TOGGLE
// ========================================

function enableTerrain(animate = true) {
  if (!map) return;

  // Restore saved exaggeration from localStorage
  const savedExag = localStorage.getItem(TERRAIN_EXAG_LS_KEY);
  if (savedExag) {
    const parsed = parseFloat(savedExag);
    if (!isNaN(parsed) && parsed >= TERRAIN_EXAGGERATION_MIN && parsed <= TERRAIN_EXAGGERATION_MAX) {
      terrainExaggeration = parsed;
    }
  }

  // Restore saved pitch from localStorage
  const savedPitch = localStorage.getItem(TERRAIN_PITCH_LS_KEY);
  if (savedPitch) {
    const parsed = parseFloat(savedPitch);
    if (!isNaN(parsed) && parsed >= TERRAIN_PITCH_MIN && parsed <= TERRAIN_PITCH_MAX) {
      terrainPitch = parsed;
    }
  }

  // Add Mapbox DEM source if not present
  if (!map.getSource('mapbox-dem')) {
    map.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14
    });
  }

  // Enable terrain with exaggeration
  map.setTerrain({ source: 'mapbox-dem', exaggeration: terrainExaggeration });

  // Add sky layer for atmosphere effect
  if (!map.getLayer('sky-layer')) {
    map.addLayer({
      id: 'sky-layer',
      type: 'sky',
      paint: {
        'sky-type': 'atmosphere',
        'sky-atmosphere-sun': [0.0, 0.0],
        'sky-atmosphere-sun-intensity': 15
      }
    });
  }

  // Animate or set pitch for 3D viewing angle
  if (animate) {
    map.easeTo({ pitch: terrainPitch, duration: 1000 });
  } else {
    map.setPitch(terrainPitch);
  }

  // Enable compass on NavigationControl for pitch reset
  if (map._zoomControl) {
    map.removeControl(map._zoomControl);
    map._zoomControl = new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: true });
    map.addControl(map._zoomControl, 'top-right');
  }

  terrainEnabled = true;
  localStorage.setItem(TERRAIN_LS_KEY, 'true');
  updateTerrainButton(true);
  show3DIndicator(true);
  Logger.log('3D terreng aktivert');
}

function disableTerrain() {
  if (!map) return;

  map.setTerrain(null);

  if (map.getLayer('sky-layer')) {
    map.removeLayer('sky-layer');
  }

  // Animate pitch back to flat
  map.easeTo({ pitch: 0, duration: 1000 });

  // Restore NavigationControl without compass
  if (map._zoomControl) {
    map.removeControl(map._zoomControl);
    map._zoomControl = new mapboxgl.NavigationControl({ showCompass: false });
    map.addControl(map._zoomControl, 'top-right');
  }

  terrainEnabled = false;
  localStorage.setItem(TERRAIN_LS_KEY, 'false');
  updateTerrainButton(false);
  show3DIndicator(false);
  Logger.log('3D terreng deaktivert');
}

function toggleTerrain() {
  if (terrainEnabled) {
    disableTerrain();
  } else {
    enableTerrain();
  }
}

function updateTerrainButton(active) {
  const btn = document.getElementById('terrainToggle');
  if (!btn) return;
  if (active) {
    btn.classList.add('active');
    btn.title = 'Slå av 3D-terreng';
  } else {
    btn.classList.remove('active');
    btn.title = 'Slå på 3D-terreng';
  }
  showTerrainSlider(active);
  // Sync slider values
  const exagSlider = document.getElementById('terrainExagRange');
  if (exagSlider) exagSlider.value = terrainExaggeration;
  const exagLabel = document.getElementById('terrainExagLabel');
  if (exagLabel) exagLabel.textContent = terrainExaggeration.toFixed(1) + 'x';
  const pitchSlider = document.getElementById('terrainPitchRange');
  if (pitchSlider) pitchSlider.value = terrainPitch;
  const pitchLabel = document.getElementById('terrainPitchLabel');
  if (pitchLabel) pitchLabel.textContent = Math.round(terrainPitch) + '°';
}

function setTerrainExaggeration(value) {
  terrainExaggeration = Math.max(TERRAIN_EXAGGERATION_MIN, Math.min(TERRAIN_EXAGGERATION_MAX, value));
  localStorage.setItem(TERRAIN_EXAG_LS_KEY, terrainExaggeration.toString());
  if (terrainEnabled && map) {
    map.setTerrain({ source: 'mapbox-dem', exaggeration: terrainExaggeration });
  }
  // Update slider label
  const label = document.getElementById('terrainExagLabel');
  if (label) label.textContent = terrainExaggeration.toFixed(1) + 'x';
}

function setTerrainPitch(value) {
  terrainPitch = Math.max(TERRAIN_PITCH_MIN, Math.min(TERRAIN_PITCH_MAX, value));
  localStorage.setItem(TERRAIN_PITCH_LS_KEY, terrainPitch.toString());
  if (terrainEnabled && map) {
    map.easeTo({ pitch: terrainPitch, duration: 200 });
  }
  const label = document.getElementById('terrainPitchLabel');
  if (label) label.textContent = Math.round(terrainPitch) + '°';
}

function showTerrainSlider(show) {
  const slider = document.getElementById('terrainExagSlider');
  if (slider) {
    slider.classList.toggle('visible', show);
  }
}

function show3DIndicator(show) {
  let indicator = document.getElementById('terrain3dIndicator');
  if (show) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'terrain3dIndicator';
      indicator.className = 'terrain-3d-indicator';
      indicator.innerHTML = '<i class="fas fa-mountain" aria-hidden="true"></i> 3D-modus aktivert';
      document.body.appendChild(indicator);
    }
    requestAnimationFrame(() => indicator.classList.add('visible'));
  } else if (indicator) {
    indicator.classList.remove('visible');
    setTimeout(() => indicator.remove(), 300);
  }
}


function reapplyTerrain() {
  if (!terrainEnabled || !map) return;
  if (!map.getSource('mapbox-dem')) {
    map.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14
    });
  }
  map.setTerrain({ source: 'mapbox-dem', exaggeration: terrainExaggeration });
  if (!map.getLayer('sky-layer')) {
    map.addLayer({
      id: 'sky-layer',
      type: 'sky',
      paint: {
        'sky-type': 'atmosphere',
        'sky-atmosphere-sun': [0.0, 0.0],
        'sky-atmosphere-sun-intensity': 15
      }
    });
  }
}

// Office location marker (glowing house icon)
let officeMarker = null;

function initSharedMap(options = {}) {
  const mapEl = document.getElementById('map');
  if (mapEl && !map) {
    // Set Mapbox GL JS access token
    mapboxgl.accessToken = getMapboxToken();

    // If returning user, skip globe view and start at office location (or Norway overview)
    const skipGlobe = options.skipGlobe || false;
    const hasOfficeLocation = appConfig.routeStartLat && appConfig.routeStartLng;
    const initialCenter = skipGlobe
      ? (hasOfficeLocation ? [appConfig.routeStartLng, appConfig.routeStartLat] : NORWAY_CENTER)
      : NORWAY_CENTER;
    const initialZoom = skipGlobe ? (hasOfficeLocation ? 6 : NORWAY_ZOOM) : 3.0;

    // Create Mapbox GL JS map with globe projection
    map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: initialCenter,
      zoom: initialZoom,
      minZoom: 1,
      maxZoom: 19,
      projection: 'globe',
      interactive: skipGlobe, // Enable immediately for returning users
      attributionControl: false
    });

    // Add fog/atmosphere for globe effect
    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(186, 210, 235)',
        'high-color': 'rgb(36, 92, 223)',
        'horizon-blend': 0.02,
        'space-color': 'rgb(11, 11, 25)',
        'star-intensity': 0.6
      });

      // Add Norway border on first load
      addNorwayBorder();
    });

    // Only spin globe on login screen (not for returning users)
    if (!skipGlobe) {
      startGlobeSpin();
    }

    // Speed up scroll-wheel zoom (default is ~1/450, higher = faster)
    map.scrollZoom.setWheelZoomRate(1 / 200);
    map.scrollZoom.setZoomRate(1 / 50);

    Logger.log('Mapbox GL JS map initialized with globe projection');

    // Office marker is added after login via updateOfficeMarkerPosition()
    // (pre-login config may contain env fallback coords that don't belong to the user)
  }
}

function createOfficeMarkerElement() {
  const el = createMarkerElement('office-marker-glow', `
    <div class="office-marker-container">
      <div class="office-glow-ring"></div>
      <div class="office-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </div>
    </div>
  `, [60, 60]);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

// Remove office marker (called on logout)
function removeOfficeMarker() {
  if (officeMarker) {
    officeMarker.remove();
    officeMarker = null;
  }
}

// Update office marker position when org-specific config is loaded after auth
function updateOfficeMarkerPosition() {
  const homeLng = appConfig.routeStartLng;
  const homeLat = appConfig.routeStartLat;

  if (homeLng && homeLat) {
    if (officeMarker) {
      officeMarker.setLngLat([homeLng, homeLat]);
    } else if (map) {
      const officeEl = createOfficeMarkerElement();
      officeMarker = new mapboxgl.Marker({ element: officeEl, anchor: 'center' })
        .setLngLat([homeLng, homeLat])
        .addTo(map);
    }
  } else if (officeMarker) {
    officeMarker.remove();
    officeMarker = null;
  }
}

// Get configured route start location, or null if not set
function getRouteStartLocation() {
  if (appConfig.routeStartLat && appConfig.routeStartLng) {
    return { lat: appConfig.routeStartLat, lng: appConfig.routeStartLng };
  }
  return null;
}

// Show prominent prompt to set office address
function showAddressBannerIfNeeded() {
  // Only show if no address is configured
  if (getRouteStartLocation()) return;

  // If already dismissed this session, show persistent nudge instead
  if (sessionStorage.getItem('addressBannerDismissed')) {
    showPersistentAddressNudge();
    const adminBadge = document.getElementById('adminAddressBadge');
    if (adminBadge) adminBadge.style.display = 'inline-flex';
    return;
  }

  // Remove any existing prompt
  const existing = document.getElementById('addressSetupBanner');
  if (existing) existing.remove();

  const prompt = document.createElement('div');
  prompt.id = 'addressSetupBanner';
  prompt.className = 'address-setup-prompt';
  prompt.innerHTML = `
    <div class="address-prompt-backdrop" onclick="dismissAddressBanner()"></div>
    <div class="address-prompt-card">
      <div class="address-prompt-step-indicator">Kom i gang</div>
      <div class="address-prompt-icon address-prompt-icon-animated">
        <i class="fas fa-map-marker-alt" aria-hidden="true"></i>
      </div>
      <h2>Hvor holder dere til?</h2>
      <p>Legg inn firmaadresse for å se kontoret ditt på kartet og bruke ruteplanlegging. Det tar bare et øyeblikk.</p>
      <div class="address-prompt-actions">
        <button class="address-prompt-btn-primary" onclick="openAdminAddressTab()">
          <i class="fas fa-map-marker-alt" aria-hidden="true"></i> Legg inn adresse nå
        </button>
        <button class="address-prompt-btn-secondary" onclick="dismissAddressBanner()">
          Jeg gjør det senere
        </button>
      </div>
    </div>
  `;

  const mapContainer = document.getElementById('sharedMapContainer');
  if (mapContainer) {
    mapContainer.appendChild(prompt);
    requestAnimationFrame(() => prompt.classList.add('visible'));
  }

  // Show action-needed badge on admin tab
  const adminBadge = document.getElementById('adminAddressBadge');
  if (adminBadge) adminBadge.style.display = 'inline-flex';
}

function dismissAddressBanner() {
  const prompt = document.getElementById('addressSetupBanner');
  if (prompt) {
    prompt.classList.remove('visible');
    setTimeout(() => prompt.remove(), 300);
  }
  sessionStorage.setItem('addressBannerDismissed', 'true');

  // Show persistent nudge pill after banner is dismissed
  setTimeout(() => showPersistentAddressNudge(), 400);
}

function openAdminAddressTab() {
  dismissAddressBanner();
  // Switch to admin tab
  const adminTab = document.getElementById('adminTab');
  if (adminTab) {
    adminTab.click();
    // Scroll to address section after tab renders
    setTimeout(() => {
      const section = document.getElementById('companyAddressSection');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
  }
}

// Persistent floating nudge pill (visible after banner dismissal if address still not set)
function showPersistentAddressNudge() {
  if (getRouteStartLocation()) return;
  if (document.getElementById('addressNudgePill')) return;

  const nudge = document.createElement('div');
  nudge.id = 'addressNudgePill';
  nudge.className = 'address-nudge-pill';
  nudge.innerHTML = `
    <i class="fas fa-map-marker-alt" aria-hidden="true"></i>
    <span>Firmaadresse ikke satt</span>
  `;
  nudge.addEventListener('click', () => {
    openAdminAddressTab();
    removeAddressNudge();
  });

  const mapContainer = document.getElementById('sharedMapContainer');
  if (mapContainer) {
    mapContainer.appendChild(nudge);
    requestAnimationFrame(() => nudge.classList.add('visible'));
  }
}

function removeAddressNudge() {
  const nudge = document.getElementById('addressNudgePill');
  if (nudge) {
    nudge.classList.remove('visible');
    setTimeout(() => nudge.remove(), 300);
  }
}

// Globe spin animation for login screen
let globeSpinRAF = null;

function startGlobeSpin() {
  if (!map) return;
  const secondsPerRevolution = 480; // Very slow: 8 minutes per full rotation
  const degreesPerSecond = 360 / secondsPerRevolution;
  let lastTime = performance.now();

  function spin() {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    const center = map.getCenter();
    center.lng += degreesPerSecond * delta;
    map.setCenter(center);

    globeSpinRAF = requestAnimationFrame(spin);
  }
  globeSpinRAF = requestAnimationFrame(spin);
}

function stopGlobeSpin() {
  if (globeSpinRAF) {
    cancelAnimationFrame(globeSpinRAF);
    globeSpinRAF = null;
  }
}

// Initialize login view (just set up form handler, map is already initialized)
function initLoginView() {
  const loginForm = document.getElementById('spaLoginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleSpaLogin);
  }
}

// DOM Elements (initialized after DOM is ready)
let customerList;
let searchInput;
let addCustomerBtn;
let planRouteBtn;
let clearSelectionBtn;
let selectedCount;
let customerModal;
let customerForm;
let apiKeyModal;
let routeInfo;

// Initialize DOM references
function initDOMElements() {
  customerList = document.getElementById('customerList');
  searchInput = document.getElementById('searchInput');
  addCustomerBtn = document.getElementById('addCustomerBtn');
  planRouteBtn = document.getElementById('planRouteBtn');
  clearSelectionBtn = document.getElementById('clearSelectionBtn');
  selectedCount = document.getElementById('selectedCount');
  customerModal = document.getElementById('customerModal');
  customerForm = document.getElementById('customerForm');
  apiKeyModal = document.getElementById('apiKeyModal');
  routeInfo = document.getElementById('routeInfo');
}

// Initialize map features (clustering, borders, controls, etc.)
// Note: The base map is created in initSharedMap() at page load
let mapInitialized = false;
function initMap() {
  if (mapInitialized) {
    // Controls already added — re-init clusters (needed after logout → login)
    // Use readdClusterLayers which removes stale layers, re-creates source,
    // and repopulates data — more robust than bare initClusterManager()
    if (typeof readdClusterLayers === 'function') {
      readdClusterLayers();
    } else {
      initClusterManager();
    }
    return;
  }
  mapInitialized = true;
  Logger.log('initMap() starting, map exists:', !!map);

  if (!map) {
    mapInitialized = false;
    console.error('Map not initialized - call initSharedMap() first');
    return;
  }

  // Add scale control
  map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  // Add "My location" button (custom IControl)
  class LocateControl {
    onAdd(mapInstance) {
      this._map = mapInstance;
      this._container = document.createElement('div');
      this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = 'Min posisjon';
      btn.setAttribute('aria-label', 'Min posisjon');
      btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:34px;height:34px;font-size:16px;cursor:pointer;';
      btn.innerHTML = '<i aria-hidden="true" class="fas fa-location-crosshairs"></i>';

      let locationMarker = null;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const coords = [pos.coords.longitude, pos.coords.latitude];
            mapInstance.flyTo({ center: coords, zoom: 15, duration: 1500 });
            if (locationMarker) locationMarker.remove();
            const el = document.createElement('div');
            el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#4285F4;border:2px solid #fff;box-shadow:0 0 6px rgba(66,133,244,0.5);';
            locationMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
              .setLngLat(coords)
              .setPopup(new mapboxgl.Popup({ offset: 10 }).setText('Du er her'))
              .addTo(mapInstance);
          },
          () => showNotification('Kunne ikke finne posisjonen din', 'error'),
          { enableHighAccuracy: true }
        );
      });

      this._container.appendChild(btn);
      return this._container;
    }
    onRemove() {
      this._container.parentNode?.removeChild(this._container);
      this._map = undefined;
    }
  }
  map.addControl(new LocateControl(), 'top-left');

  // Initialize clustering — must wait for map style to be loaded
  if (map.isStyleLoaded()) {
    initClusterManager();
  } else {
    map.once('style.load', () => initClusterManager());
    // Fallback: 'load' event fires after style + tiles are ready
    map.once('load', () => {
      if (!_clusterSourceReady) initClusterManager();
    });
  }

  // Update clusters after map movement completes (not during zoom — markers are
  // geo-anchored and follow the map automatically, updating mid-zoom causes jitter)
  map.on('moveend', () => {
    requestAnimationFrame(() => {
      if (typeof updateClusters === 'function') updateClusters();
      if (typeof reapplyPlanBadges === 'function') reapplyPlanBadges();
      if (wpFocusedMemberIds || wpRouteActive) {
        if (typeof applyTeamFocusToMarkers === 'function') applyTeamFocusToMarkers();
      }
    });
  });

  // Update marker labels visibility based on zoom level
  map.on('zoomend', updateMarkerLabelsVisibility);

  // Listen for popup actions via event delegation on map container
  map.getContainer().addEventListener('click', handlePopupAction);

  // Init area select (dra-for-å-velge)
  initAreaSelect();

  // Add 3D terrain toggle button (inside shared toolbar container)
  const mapContainer = document.getElementById('sharedMapContainer');
  if (mapContainer && !document.getElementById('terrainToggle')) {
    // Opprett eller finn delt toolbar-container
    let toolbar = document.getElementById('mapToolbarCenter');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'mapToolbarCenter';
      toolbar.className = 'map-toolbar-center';
      mapContainer.appendChild(toolbar);
    }
    const terrainBtn = document.createElement('button');
    terrainBtn.id = 'terrainToggle';
    terrainBtn.className = 'terrain-toggle-btn';
    terrainBtn.title = 'Slå på 3D-terreng';
    terrainBtn.innerHTML = '<i aria-hidden="true" class="fas fa-mountain"></i>';
    terrainBtn.addEventListener('click', () => toggleTerrain());
    toolbar.appendChild(terrainBtn);

    // Terrain controls panel (shown when 3D is active)
    const sliderPanel = document.createElement('div');
    sliderPanel.id = 'terrainExagSlider';
    sliderPanel.className = 'terrain-exag-slider';
    sliderPanel.innerHTML = `
      <div class="terrain-slider-row">
        <label for="terrainExagRange" class="terrain-exag-title">Skarphet</label>
        <input type="range" id="terrainExagRange"
          min="${TERRAIN_EXAGGERATION_MIN}" max="${TERRAIN_EXAGGERATION_MAX}"
          step="${TERRAIN_EXAGGERATION_STEP}" value="${terrainExaggeration}">
        <span id="terrainExagLabel" class="terrain-exag-label">${terrainExaggeration.toFixed(1)}x</span>
      </div>
      <div class="terrain-slider-row">
        <label for="terrainPitchRange" class="terrain-exag-title">Vinkel</label>
        <input type="range" id="terrainPitchRange"
          min="${TERRAIN_PITCH_MIN}" max="${TERRAIN_PITCH_MAX}"
          step="${TERRAIN_PITCH_STEP}" value="${terrainPitch}">
        <span id="terrainPitchLabel" class="terrain-exag-label">${Math.round(terrainPitch)}°</span>
      </div>
    `;
    toolbar.appendChild(sliderPanel);

    // Slider input handlers
    sliderPanel.querySelector('#terrainExagRange').addEventListener('input', (e) => {
      setTerrainExaggeration(parseFloat(e.target.value));
    });
    sliderPanel.querySelector('#terrainPitchRange').addEventListener('input', (e) => {
      setTerrainPitch(parseFloat(e.target.value));
    });
  }

  // Restore terrain preference from localStorage (only after login)
  if (localStorage.getItem(TERRAIN_LS_KEY) === 'true') {
    if (map.isStyleLoaded()) {
      enableTerrain(false);
    } else {
      map.once('style.load', () => enableTerrain(false));
    }
  }

  Logger.log('initMap() complete — Mapbox GL JS with Supercluster clustering');
}

// Handle popup button clicks via event delegation
function handlePopupAction(e) {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'zoomToCluster') {
    const lat = parseFloat(actionEl.dataset.lat);
    const lng = parseFloat(actionEl.dataset.lng);
    map.flyTo({ center: [lng, lat], zoom: map.getZoom() + 3, duration: 500 });
    closeMapPopup();
  } else if (action === 'addClusterToRoute') {
    const ids = actionEl.dataset.customerIds.split(',').map(Number);
    ids.forEach(id => selectedCustomers.add(id));
    updateSelectionUI();
    closeMapPopup();
    showNotification(`${ids.length} kunder lagt til rute`, 'success');
  }
}

// Show/hide marker labels based on zoom level
function updateMarkerLabelsVisibility() {
  if (!map) return;
  const zoom = map.getZoom();
  const mapContainer = document.getElementById('map');

  if (zoom < 10) {
    mapContainer.classList.add('hide-marker-labels');
  } else {
    mapContainer.classList.remove('hide-marker-labels');
  }
}

// Add Norway border visualization using GeoJSON sources and layers
function addNorwayBorder() {
  if (!map) return;

  // Remove existing layers if present (needed after style change)
  ['norway-border-line', 'sweden-overlay', 'sweden-overlay-fill'].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  });

  // Norge-Sverige grense coordinates [lng, lat] for GeoJSON
  const borderCoords = [
    [20.55, 69.06], [20.10, 68.95], [18.10, 68.45], [17.90, 68.15],
    [17.15, 67.95], [16.40, 67.50], [15.50, 66.60], [14.60, 66.15],
    [14.25, 65.10], [13.95, 64.15], [12.70, 63.70], [12.30, 62.65],
    [12.10, 61.80], [12.15, 61.00], [11.80, 59.80], [11.45, 59.10],
    [11.15, 58.95]
  ];

  // Border line
  map.addSource('norway-border-line', {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: borderCoords }
    }
  });
  map.addLayer({
    id: 'norway-border-line',
    type: 'line',
    source: 'norway-border-line',
    paint: {
      'line-color': '#ef4444',
      'line-width': 2,
      'line-opacity': 0.7,
      'line-dasharray': [4, 2]
    }
  });

  // Sweden dim overlay (east of border)
  const swedenCoords = [[
    [20.5, 71.5], [32.0, 71.5], [32.0, 58.0], [11.0, 58.0],
    [11.5, 59.0], [12.2, 61.0], [12.5, 63.5], [14.5, 66.0],
    [17.5, 68.0], [20.0, 69.0], [20.5, 71.5]
  ]];

  map.addSource('sweden-overlay', {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: swedenCoords }
    }
  });
  map.addLayer({
    id: 'sweden-overlay-fill',
    type: 'fill',
    source: 'sweden-overlay',
    paint: {
      'fill-color': '#000',
      'fill-opacity': 0.25
    }
  });
}

/**
 * Render subcategory assignments for a customer in the popup.
 * Uses kundeSubcatMap (global) and serviceTypeRegistry to resolve names.
 */
function renderPopupSubcategories(customer) {
  const assignments = kundeSubcatMap[customer.id];
  if (!assignments || assignments.length === 0) return '';

  const labels = [];

  for (const a of assignments) {
    for (const group of allSubcategoryGroups) {
      if (group.id !== a.group_id) continue;
      const sub = (group.subcategories || []).find(s => s.id === a.subcategory_id);
      if (sub) {
        labels.push(`<strong>${escapeHtml(group.navn)}:</strong> ${escapeHtml(sub.navn)}`);
      }
    }
  }

  if (labels.length === 0) return '';
  return labels.map(l => `<p>${l}</p>`).join('');
}

// Generate popup content lazily (performance optimization - only called when popup opens)
function generatePopupContent(customer) {
  const isSelected = selectedCustomers.has(customer.id);
  const controlStatus = getControlStatus(customer);
  const hasEmail = customer.epost && customer.epost.trim() !== '';

  // Generate dynamic popup control info based on selected industry
  const kontrollInfoHtml = serviceTypeRegistry.renderPopupControlInfo(customer, controlStatus);

  // Generate custom organization fields from Excel import
  const customFieldsHtml = renderPopupCustomFields(customer);

  // Show org.nr., kundenr, prosjektnr, estimert tid
  let extraFieldsHtml = '';
  const orgNr = customer.org_nummer || (customer.notater && customer.notater.match(/\[ORGNR:(\d{9})\]/)?.[1]);
  if (orgNr) extraFieldsHtml += `<p><strong>Org.nr:</strong> ${escapeHtml(orgNr)}</p>`;
  if (customer.kundenummer) extraFieldsHtml += `<p><strong>Kundenr:</strong> ${escapeHtml(customer.kundenummer)}</p>`;
  if (customer.prosjektnummer) extraFieldsHtml += `<p><strong>Prosjektnr:</strong> ${escapeHtml(customer.prosjektnummer)}</p>`;
  if (customer.estimert_tid) {
    const _h = Math.floor(customer.estimert_tid / 60);
    const _m = customer.estimert_tid % 60;
    const tidStr = _h > 0 ? (_m > 0 ? `${_h}t ${_m}m` : `${_h}t`) : `${_m}m`;
    extraFieldsHtml += `<p><strong>Est. tid:</strong> ${tidStr}</p>`;
  }

  // Show notater if present (strip internal tags for cleaner display)
  let notatHtml = '';
  if (customer.notater) {
    const cleanedNotater = customer.notater
      .replace(/\[TRIPLETEX:[^\]]*\]\s*/g, '')
      .replace(/\[ORGNR:[^\]]*\]\s*/g, '')
      .replace(/^\s*\|\s*/, '')
      .trim();
    if (cleanedNotater) {
      notatHtml = `<p class="popup-notater"><strong>Notater:</strong> ${escapeHtml(cleanedNotater)}</p>`;
    }
  }

  // Presence warning: show if another user is working on this customer
  const claim = presenceClaims.get(customer.id);
  const presenceBanner = (claim && claim.userId !== myUserId)
    ? `<div class="presence-warning-banner" style="background:${escapeHtml(getPresenceColor(claim.userId))}18;border-left:3px solid ${escapeHtml(getPresenceColor(claim.userId))};padding:6px 10px;margin-bottom:8px;border-radius:4px;font-size:13px;">
        <strong>${escapeHtml(claim.initials)}</strong> ${escapeHtml(claim.userName)} jobber med denne kunden
      </div>`
    : '';

  // Generate subcategory assignments display
  const subcatHtml = renderPopupSubcategories(customer);

  return `
    ${presenceBanner}
    <h3>${escapeHtml(customer.navn)}</h3>
    ${customer.kategori ? `<p><strong>Kategori:</strong> ${escapeHtml(customer.kategori)}</p>` : ''}
    ${subcatHtml}
    ${extraFieldsHtml}
    ${customFieldsHtml}
    <p>${escapeHtml(customer.adresse)}</p>
    <p>${escapeHtml(customer.postnummer || '')} ${escapeHtml(customer.poststed || '')}</p>
    ${customer.telefon ? `<p>Tlf: ${escapeHtml(customer.telefon)}</p>` : ''}
    ${customer.epost ? `<p>E-post: ${escapeHtml(customer.epost)}</p>` : ''}
    ${kontrollInfoHtml}
    ${notatHtml}
    <div class="popup-actions">
      <button class="btn btn-small btn-navigate" data-action="navigateToCustomer" data-lat="${customer.lat}" data-lng="${customer.lng}" data-name="${escapeHtml(customer.navn)}">
        <i aria-hidden="true" class="fas fa-directions"></i> Naviger
      </button>
      <button class="btn btn-small btn-primary" data-action="toggleCustomerSelection" data-customer-id="${customer.id}">
        ${isSelected ? 'Fjern fra rute' : 'Legg til rute'}
      </button>
      <div class="popup-btn-group">
        <button class="btn btn-small btn-calendar" data-action="quickAddToday" data-customer-id="${customer.id}" data-customer-name="${escapeHtml(customer.navn)}">
          <i aria-hidden="true" class="fas fa-calendar-plus"></i> I dag
        </button>
        <button class="btn btn-small btn-calendar" data-action="showCalendarQuickMenu" data-customer-id="${customer.id}" data-customer-name="${escapeHtml(customer.navn)}">
          <i aria-hidden="true" class="fas fa-chevron-down" style="font-size:9px"></i>
        </button>
      </div>
      ${splitViewOpen && splitViewState.activeDay ? `
      <button class="btn btn-small btn-calendar" data-action="quickAddToSplitDay" data-customer-id="${customer.id}" data-customer-name="${escapeHtml(customer.navn)}" style="background:var(--color-primary);color:#fff;width:100%;">
        <i aria-hidden="true" class="fas fa-calendar-plus"></i> Legg til ${new Date(splitViewState.activeDay + 'T00:00:00').toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })}
      </button>
      ` : ''}
      <button class="btn btn-small btn-success" data-action="quickMarkVisited" data-customer-id="${customer.id}">
        <i aria-hidden="true" class="fas fa-check"></i> Marker besøkt
      </button>
      <button class="btn btn-small btn-secondary" data-action="editCustomer" data-customer-id="${customer.id}">
        Rediger
      </button>
      <button class="btn btn-small ${hasEmail ? 'btn-email' : 'btn-disabled'}"
              data-action="sendEmail"
              data-customer-id="${customer.id}"
              ${hasEmail ? '' : 'disabled'}>
        <i aria-hidden="true" class="fas fa-envelope"></i> E-post
      </button>
    </div>
  `;
}


// Handle SPA login
async function handleSpaLogin(e) {
  e.preventDefault();

  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const rememberMe = document.getElementById('loginRememberMe').checked;
  const loginBtn = document.getElementById('spaLoginBtn');
  const errorMessage = document.getElementById('loginErrorMessage');
  const errorText = document.getElementById('loginErrorText');

  loginBtn.disabled = true;
  loginBtn.innerHTML = '<div class="login-spinner"></div><span>Logger inn...</span>';
  errorMessage.classList.remove('show');

  try {
    const loginHeaders = { 'Content-Type': 'application/json' };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      loginHeaders['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch('/api/klient/login', {
      method: 'POST',
      headers: loginHeaders,
      credentials: 'include',
      body: JSON.stringify({ epost: email, passord: password, rememberMe })
    });

    const rawData = await response.json();
    // Handle wrapped API response format: { success: true, data: { ... } }
    const data = rawData.success && rawData.data ? rawData.data : rawData;

    if (response.ok && (data.accessToken || data.token)) {
      // Auth is now managed via httpOnly cookies (set by server)
      // Keep authToken in memory for backward compat during transition
      authToken = data.accessToken || data.token;
      if (data.expiresAt) accessTokenExpiresAt = data.expiresAt;
      localStorage.setItem('userName', data.klient?.navn || data.bruker?.navn || 'Bruker');
      localStorage.setItem('userEmail', email || data.klient?.epost || data.bruker?.epost || '');
      localStorage.setItem('userRole', data.klient?.rolle || data.bruker?.rolle || 'leser');
      localStorage.setItem('userType', data.klient?.type || 'klient');

      // Apply role-based UI restrictions
      applyRoleUI();

      // Multi-tenancy: Store organization context
      if (data.klient?.organizationId) {
        localStorage.setItem('organizationId', data.klient.organizationId);
        localStorage.setItem('organizationSlug', data.klient.organizationSlug || '');
        localStorage.setItem('organizationName', data.klient.organizationName || '');
      }

      // Multi-tenancy: Apply organization branding if returned with login
      if (data.organization) {
        appConfig.primaryColor = data.organization.primaryColor || appConfig.primaryColor;
        appConfig.secondaryColor = data.organization.secondaryColor || appConfig.secondaryColor;
        appConfig.logoUrl = data.organization.logoUrl || appConfig.logoUrl;
        appConfig.companyName = data.organization.navn || appConfig.companyName;
        appConfig.appName = data.organization.brandTitle || appConfig.appName;
        appConfig.companySubtitle = data.organization.brandSubtitle || appConfig.companySubtitle;
        // App mode: 'mvp' = enkel versjon, 'full' = komplett (TRE Allservice)
        appConfig.appMode = data.organization.appMode || 'mvp';
        localStorage.setItem('appMode', appConfig.appMode);

        // Store subscription info for timer
        subscriptionInfo = {
          status: data.organization.subscriptionStatus,
          trialEndsAt: data.organization.trialEndsAt,
          planType: data.organization.planType
        };

        applyBranding();
        applyMvpModeUI();
      }

      // Show admin tab and manage button if user is admin/bruker
      const isAdmin = data.klient?.type === 'bruker' || data.klient?.rolle === 'admin';
      const adminTab = document.getElementById('adminTab');
      if (adminTab) {
        adminTab.style.display = isAdmin ? 'flex' : 'none';
      }

      // Show success state
      loginBtn.innerHTML = `
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="18" height="18">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
        <span>Velkommen!</span>
      `;
      loginBtn.style.background = '#4CAF50';

      // Check if user is a super-admin - if so, redirect to admin panel
      if (data.klient?.type === 'bruker') {
        try {
          const verifyRes = await fetch('/api/klient/verify', {
            credentials: 'include'
          });
          const verifyData = await verifyRes.json();
          if (verifyData.data?.user?.isSuperAdmin) {
            localStorage.setItem('isSuperAdmin', 'true');
            setTimeout(() => {
              window.location.href = '/admin';
            }, 500);
            return;
          }
        } catch (e) {
          // Super-admin check failed, continue to main app
        }
      }

      // Check if onboarding is needed (first login / no industry selected)
      const needsOnboarding = data.organization && !data.organization.onboardingCompleted;

      // Start the transition to app view (with onboarding if needed)
      setTimeout(async () => {
        if (needsOnboarding) {
          // Show onboarding wizard
          await showOnboardingWizard();
        }
        transitionToAppView();
      }, 300);
    } else {
      // Handle both wrapped error format { error: { message } } and legacy format { error: "string" }
      const errorMsg = data.error?.message || data.error || rawData.error?.message || 'Feil e-post eller passord';
      errorText.textContent = errorMsg;
      errorMessage.classList.add('show');
      resetLoginButton();
    }
  } catch (error) {
    console.error('Login error:', error);
    // Gi mer spesifikk feilmelding basert på feiltype
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      errorText.textContent = 'Kunne ikke koble til server - sjekk internettforbindelsen';
    } else if (error.name === 'SyntaxError' || error.message.includes('JSON')) {
      errorText.textContent = 'Ugyldig respons fra server';
    } else if (error.name === 'AbortError') {
      errorText.textContent = 'Forespørselen ble avbrutt';
    } else {
      errorText.textContent = error.message || 'Ukjent feil ved innlogging';
    }
    errorMessage.classList.add('show');
    resetLoginButton();
  }
}

function resetLoginButton() {
  const loginBtn = document.getElementById('spaLoginBtn');
  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.style.background = '';
    loginBtn.innerHTML = `
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/>
      </svg>
      <span>Logg inn</span>
    `;
  }
}

// Show user bar with name and update admin tab visibility
function showUserBar() {
  const userBar = document.getElementById('userBar');
  const userNameDisplay = document.getElementById('userNameDisplay');
  const userName = localStorage.getItem('userName') || localStorage.getItem('klientNavn') || 'Bruker';
  const userRole = localStorage.getItem('userRole') || '';
  const userType = localStorage.getItem('userType') || '';

  if (userBar) {
    userBar.style.display = 'flex';
    if (userNameDisplay) userNameDisplay.textContent = userName;
    // Set dashboard link to web app URL
    const dashLink = document.getElementById('dashboardLinkBtn');
    if (dashLink && appConfig.webUrl) {
      dashLink.href = appConfig.webUrl + '/dashboard';
    }
  }

  // Show admin tab and manage button if user is admin/bruker
  const isAdmin = userType === 'bruker' || userRole === 'admin';
  const adminTab = document.getElementById('adminTab');
  if (adminTab) {
    adminTab.style.display = isAdmin ? 'flex' : 'none';
  }

  // Initialize subscription countdown timer
  initSubscriptionTimer();
}

// Hide user bar
function hideUserBar() {
  const userBar = document.getElementById('userBar');
  if (userBar) userBar.style.display = 'none';

  // Hide subscription timer
  hideSubscriptionTimer();
}


// Transition from login to app view with smooth animations
// Single map architecture: map never changes, only UI overlays animate
function transitionToAppView() {
  const loginOverlay = document.getElementById('loginOverlay');
  const appView = document.getElementById('appView');
  const sidebar = document.getElementById('sidebar');
  const filterPanel = document.getElementById('filterPanel');
  const loginSide = document.querySelector('.login-side');
  const loginBrandContent = document.querySelector('.login-brand-content');
  const loginMapOverlay = document.querySelector('.login-map-overlay');

  // Show user bar
  showUserBar();

  // Start proactive token refresh
  setupTokenRefresh();

  // Always show app view and prepare for animation
  appView.classList.remove('hidden');

  // Pre-position sidebar and filter for animation (every time)
  if (sidebar) {
    sidebar.style.transform = 'translateX(-100%)';
    sidebar.style.opacity = '0';
  }
  if (filterPanel) {
    filterPanel.style.transform = 'translateX(100%)';
    filterPanel.style.opacity = '0';
  }

  // Pre-position content panel if it should be open (from localStorage)
  const contentPanel = document.getElementById('contentPanel');
  const shouldOpenPanel = localStorage.getItem('contentPanelOpen') === 'true';
  if (shouldOpenPanel && contentPanel) {
    contentPanel.style.transform = 'translateX(-100%)';
    contentPanel.style.opacity = '0';
    contentPanel.classList.remove('closed');
    contentPanel.classList.add('open');
  }

  // Set currentView to 'app' BEFORE loading customers (so renderMarkers isn't blocked)
  currentView = 'app';

  // PHASE 1: Slide out login form (left side)
  if (loginSide) {
    loginSide.style.transition = 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease-out';
    loginSide.style.transform = 'translateX(-100%)';
    loginSide.style.opacity = '0';
  }

  // PHASE 2: Fade out brand content and gradient overlay
  setTimeout(() => {
    if (loginBrandContent) {
      loginBrandContent.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
      loginBrandContent.style.opacity = '0';
      loginBrandContent.style.transform = 'translateY(-30px)';
    }
    if (loginMapOverlay) {
      loginMapOverlay.style.transition = 'opacity 0.6s ease-out';
      loginMapOverlay.style.opacity = '0';
    }
  }, 200);

  // PHASE 3: Stop globe spin and fly to office location (or Norway center as fallback)
  setTimeout(() => {
    if (map) {
      stopGlobeSpin();
      const hasOfficeLocation = appConfig.routeStartLat && appConfig.routeStartLng;
      map.flyTo({
        center: hasOfficeLocation
          ? [appConfig.routeStartLng, appConfig.routeStartLat]
          : NORWAY_CENTER,
        zoom: hasOfficeLocation ? 6 : NORWAY_ZOOM,
        duration: 1600,
        essential: true,
        curve: 1.42
      });
    }
  }, 300);

  // PHASE 4: Hide login overlay completely (pointer-events already handled by CSS)
  setTimeout(() => {
    loginOverlay.classList.add('hidden');
  }, 700);

  // PHASE 5: Enable map interactivity
  setTimeout(() => {
    if (map) {
      setMapInteractive(true);
      // Add zoom/navigation control after login
      if (!map._zoomControl) {
        map._zoomControl = new mapboxgl.NavigationControl({ showCompass: false });
        map.addControl(map._zoomControl, 'top-right');
      }
      // Block browser context menu on map area
      map.getContainer().addEventListener('contextmenu', (e) => {
        e.preventDefault();
      });
    }

    // Restore floating map control buttons (hidden on logout)
    document.querySelectorAll('.terrain-toggle-btn, .area-select-toggle-btn, .isochrone-toggle-btn, .coverage-area-toggle-btn').forEach(btn => {
      btn.style.transition = 'opacity 0.4s ease-out';
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    });

    // Restore Mapbox GL native controls
    document.querySelectorAll('.mapboxgl-ctrl').forEach(ctrl => {
      ctrl.style.transition = 'opacity 0.4s ease-out';
      ctrl.style.opacity = '1';
      ctrl.style.pointerEvents = 'auto';
    });
  }, 800);

  // PHASE 5b: Load data AFTER flyTo animation mostly completes (~1.6s)
  // This prevents UI jank during the login transition
  setTimeout(() => {
    if (!appInitialized) {
      initializeApp();
      appInitialized = true;
    } else {
      // Re-initialize clusters (cleared on logout) before loading customers
      if (typeof readdClusterLayers === 'function') readdClusterLayers();
      loadCustomers();
    }
  }, 1700);

  // PHASE 6: Slide in sidebar and show tab navigation
  setTimeout(() => {
    if (sidebar) {
      sidebar.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease-out';
      sidebar.style.transform = 'translateX(0)';
      sidebar.style.opacity = '1';
    }
    // Show tab navigation and sidebar toggle (hidden on logout)
    const tabNavigation = document.querySelector('.tab-navigation');
    if (tabNavigation) {
      tabNavigation.style.transition = 'opacity 0.4s ease-out';
      tabNavigation.style.opacity = '1';
      tabNavigation.style.pointerEvents = 'auto';
    }
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
      sidebarToggle.style.transition = 'opacity 0.4s ease-out';
      sidebarToggle.style.opacity = '1';
      sidebarToggle.style.pointerEvents = 'auto';
    }
  }, 900);

  // PHASE 7: Slide in filter panel
  setTimeout(() => {
    if (filterPanel) {
      filterPanel.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease-out';
      filterPanel.style.transform = 'translateX(0)';
      filterPanel.style.opacity = '1';
    }

    // Slide in content panel if it should be open
    const contentPanel = document.getElementById('contentPanel');
    const shouldOpenPanel = localStorage.getItem('contentPanelOpen') === 'true';
    if (shouldOpenPanel && contentPanel) {
      contentPanel.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease-out';
      contentPanel.style.transform = 'translateX(0)';
      contentPanel.style.opacity = '1';
    }
  }, 1050);

  // PHASE 8: Clean up inline styles (after easeTo settles at ~2.6s)
  setTimeout(() => {
    // Clean up sidebar/filter inline styles
    if (sidebar) {
      sidebar.style.transition = '';
      sidebar.style.transform = '';
      sidebar.style.opacity = '';
    }
    if (filterPanel) {
      filterPanel.style.transition = '';
      filterPanel.style.transform = '';
      filterPanel.style.opacity = '';
    }

    // Clean up content panel inline styles
    const contentPanel = document.getElementById('contentPanel');
    if (contentPanel) {
      contentPanel.style.transition = '';
      contentPanel.style.transform = '';
      contentPanel.style.opacity = '';
    }

    // Reset login elements for potential re-login
    if (loginSide) {
      loginSide.style.transition = '';
      loginSide.style.transform = '';
      loginSide.style.opacity = '';
    }
    if (loginBrandContent) {
      loginBrandContent.style.transition = '';
      loginBrandContent.style.opacity = '';
      loginBrandContent.style.transform = '';
    }
    if (loginMapOverlay) {
      loginMapOverlay.style.transition = '';
      loginMapOverlay.style.opacity = '';
    }

    // Clean up map control button inline styles
    document.querySelectorAll('.terrain-toggle-btn, .area-select-toggle-btn, .isochrone-toggle-btn, .coverage-area-toggle-btn, .mapboxgl-ctrl').forEach(el => {
      el.style.transition = '';
      el.style.opacity = '';
      el.style.pointerEvents = '';
    });
  }, 2800);
}

// Show login view (for logout)
function showLoginView() {
  const loginOverlay = document.getElementById('loginOverlay');
  const appView = document.getElementById('appView');
  const sidebar = document.getElementById('sidebar');
  const filterPanel = document.getElementById('filterPanel');
  const loginSide = document.querySelector('.login-side');
  const loginBrandContent = document.querySelector('.login-brand-content');
  const loginMapOverlay = document.querySelector('.login-map-overlay');

  // Hide user bar with fade
  hideUserBar();

  // Reset login form
  const loginForm = document.getElementById('spaLoginForm');
  if (loginForm) loginForm.reset();
  resetLoginButton();

  // Hide error message
  const errorMessage = document.getElementById('loginErrorMessage');
  if (errorMessage) errorMessage.classList.remove('show');

  // Step 1: Prepare login elements for fade-in (start invisible)
  if (loginSide) {
    loginSide.style.transition = 'none';
    loginSide.style.transform = 'translateX(-30px)';
    loginSide.style.opacity = '0';
  }
  if (loginBrandContent) {
    loginBrandContent.style.transition = 'none';
    loginBrandContent.style.transform = 'scale(0.9)';
    loginBrandContent.style.opacity = '0';
  }
  if (loginMapOverlay) {
    loginMapOverlay.style.transition = 'none';
    loginMapOverlay.style.opacity = '0';
  }

  // Step 2: Fade out sidebar and filter panel
  const isMobile = window.innerWidth <= 768;
  if (sidebar) {
    sidebar.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-out';
    // On mobile, sidebar is a bottom sheet - slide down instead of left
    sidebar.style.transform = isMobile ? 'translateY(100%)' : 'translateX(-100%)';
    sidebar.style.opacity = '0';
    sidebar.classList.remove('mobile-open');
  }
  if (filterPanel) {
    filterPanel.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-out';
    filterPanel.style.transform = isMobile ? 'translateY(100%)' : 'translateX(100%)';
    filterPanel.style.opacity = '0';
  }

  // Animate out content panel if open
  const contentPanel = document.getElementById('contentPanel');
  if (contentPanel && !contentPanel.classList.contains('closed')) {
    contentPanel.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-out';
    contentPanel.style.transform = 'translateX(-100%)';
    contentPanel.style.opacity = '0';
  }

  // Hide bulk action bar if visible
  const bulkActionBar = document.querySelector('.bulk-action-bar');
  if (bulkActionBar) {
    bulkActionBar.classList.remove('visible');
  }

  // Hide mobile route FAB
  const mobileRouteFab = document.getElementById('mobileRouteBtn');
  if (mobileRouteFab) {
    mobileRouteFab.classList.add('hidden');
  }

  // Hide tab navigation and sidebar toggle on mobile (logout)
  const tabNavigation = document.querySelector('.tab-navigation');
  if (tabNavigation) {
    tabNavigation.style.transition = 'opacity 0.3s ease-out';
    tabNavigation.style.opacity = '0';
    tabNavigation.style.pointerEvents = 'none';
  }
  const sidebarToggle = document.getElementById('sidebarToggle');
  if (sidebarToggle) {
    sidebarToggle.style.transition = 'opacity 0.3s ease-out';
    sidebarToggle.style.opacity = '0';
    sidebarToggle.style.pointerEvents = 'none';
  }

  // Hide floating map control buttons (same z-index as login overlay)
  document.querySelectorAll('.terrain-toggle-btn, .area-select-toggle-btn, .isochrone-toggle-btn, .coverage-area-toggle-btn').forEach(btn => {
    btn.style.transition = 'opacity 0.3s ease-out';
    btn.style.opacity = '0';
    btn.style.pointerEvents = 'none';
  });

  // Hide Mapbox GL native controls (locate, zoom, etc.)
  document.querySelectorAll('.mapboxgl-ctrl').forEach(ctrl => {
    ctrl.style.transition = 'opacity 0.3s ease-out';
    ctrl.style.opacity = '0';
    ctrl.style.pointerEvents = 'none';
  });

  // Step 3: Fade out all markers (customers + clusters) gradually
  const allMarkerEls = document.querySelectorAll('.mapboxgl-marker');
  allMarkerEls.forEach(el => {
    el.style.transition = 'opacity 0.5s ease-out';
    el.style.opacity = '0';
  });
  setTimeout(() => {
    // Remove all customer markers
    for (const [id, marker] of Object.entries(markers)) {
      marker.remove();
    }
    Object.keys(markers).forEach(k => delete markers[k]);
    // Remove all cluster markers
    if (typeof clearAllClusters === 'function') clearAllClusters();
  }, 500);

  // Clear route if any
  clearRoute();

  // Step 4: Show login overlay and start map fly animation
  setTimeout(() => {
    loginOverlay.classList.remove('hidden');

    // Step 5: Animate login elements in with smooth timing
    setTimeout(() => {
      // Fade in the dark overlay
      if (loginMapOverlay) {
        loginMapOverlay.style.transition = 'opacity 0.8s ease-out';
        loginMapOverlay.style.opacity = '1';
      }

      // Slide in and fade login side panel
      if (loginSide) {
        loginSide.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.5s ease-out';
        loginSide.style.transform = 'translateX(0)';
        loginSide.style.opacity = '1';
      }

      // Scale and fade brand content with slight delay
      setTimeout(() => {
        if (loginBrandContent) {
          loginBrandContent.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease-out';
          loginBrandContent.style.transform = 'scale(1)';
          loginBrandContent.style.opacity = '1';
        }
      }, 150);
    }, 50);
  }, 300);

  // Zoom map back to login position with smooth animation
  if (map) {
    // Disable interactivity
    setMapInteractive(false);

    // Remove zoom control if present
    if (map._zoomControl) {
      map.removeControl(map._zoomControl);
      map._zoomControl = null;
    }

    map.flyTo({
      center: [15.0, 65.0],
      zoom: 3.0,
      duration: 2000,
      essential: true,
      curve: 1.5
    });

    // Start globe spin again after fly-out completes
    setTimeout(() => startGlobeSpin(), 2200);
  }

  // Step 6: Hide app view and reset styles after animation completes
  setTimeout(() => {
    appView.classList.add('hidden');

    // Reset sidebar/filter styles for next login
    if (sidebar) {
      sidebar.style.transition = '';
      sidebar.style.transform = '';
      sidebar.style.opacity = '';
    }
    if (filterPanel) {
      filterPanel.style.transition = '';
      filterPanel.style.transform = '';
      filterPanel.style.opacity = '';
    }

    // Reset content panel styles and close it
    const contentPanel = document.getElementById('contentPanel');
    if (contentPanel) {
      contentPanel.style.transition = '';
      contentPanel.style.transform = '';
      contentPanel.style.opacity = '';
      contentPanel.classList.add('closed');
      contentPanel.classList.remove('open');
    }

    // Reset login element transitions (keep final positions)
    if (loginSide) {
      loginSide.style.transition = '';
    }
    if (loginBrandContent) {
      loginBrandContent.style.transition = '';
    }
    if (loginMapOverlay) {
      loginMapOverlay.style.transition = '';
    }
  }, 1000);

  currentView = 'login';
}


// ========================================
function applyIndustryChanges() {
  Logger.log('Applying industry changes...');

  // Update login page features to match current industry
  renderLoginFeatures();

  // Update category tabs in customer admin view
  const kategoriTabs = document.getElementById('kategoriTabs');
  if (kategoriTabs) {
    kategoriTabs.innerHTML = serviceTypeRegistry.renderCategoryTabs(selectedCategory);
    // Re-attach click handlers
    attachKategoriTabHandlers();
  }

  // Update filter panel categories (right side panel)
  renderFilterPanelCategories();
  // Apply MVP mode UI changes (hide industry-specific elements)
  applyMvpModeUI();

  // Update all dropdowns that depend on service types
  updateServiceTypeDropdowns();

  // Update map legend
  updateMapLegend();

  // Apply dynamic CSS colors for service types
  applyIndustryColors();

  // Refresh markers with new colors/icons
  if (customers && customers.length > 0) {
    renderMarkers(customers);
    renderCustomerAdmin();

    // Check for customers with unknown categories and show notification
    const unknownCategoryCount = customers.filter(c =>
      c.kategori && !serviceTypeRegistry.isKnownCategory(c.kategori)
    ).length;

    if (unknownCategoryCount > 0) {
      showUnknownCategoryNotification(unknownCategoryCount);
    }
  }

  // Update branding (titles, features, etc.) to match new industry
  applyBranding();

  Logger.log('Industry changes applied');
}

// Show notification about customers with unknown categories
function showUnknownCategoryNotification(count) {
  // Remove existing notification if present
  const existingNotification = document.getElementById('unknownCategoryNotification');
  if (existingNotification) {
    existingNotification.remove();
  }

  const notification = document.createElement('div');
  notification.id = 'unknownCategoryNotification';
  notification.className = 'unknown-category-notification';
  notification.innerHTML = `
    <div class="notification-content">
      <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
      <span><strong>${count}</strong> kunde${count > 1 ? 'r' : ''} har kategorier fra tidligere bransje og m&aring; oppdateres.</span>
      <button class="btn-close-notification" onclick="this.parentElement.parentElement.remove()">
        <i aria-hidden="true" class="fas fa-times"></i>
      </button>
    </div>
  `;

  // Insert after header or at top of main content
  const mainContent = document.querySelector('.content') || document.querySelector('main') || document.body;
  mainContent.insertBefore(notification, mainContent.firstChild);

  // Auto-hide after 10 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }
  }, 10000);
}

// Attach click handlers to kategori tabs
function attachKategoriTabHandlers() {
  const tabs = document.querySelectorAll('#kategoriTabs .category-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedCategory = tab.dataset.category || 'all';
      applyFilters();
    });
  });
}

// Update all dropdowns that depend on service types
function updateServiceTypeDropdowns() {
  // Customer modal category checkboxes
  const kategoriContainer = document.getElementById('kategoriCheckboxes');
  if (kategoriContainer) {
    const currentValue = serviceTypeRegistry.getSelectedCategories();
    kategoriContainer.innerHTML = serviceTypeRegistry.renderCategoryCheckboxes(currentValue);
  }
}

// Apply dynamic CSS variables for industry service type colors
function applyIndustryColors() {
  const serviceTypes = serviceTypeRegistry.getAll();
  const root = document.documentElement;

  serviceTypes.forEach((st) => {
    root.style.setProperty(`--service-color-${st.slug}`, st.color);
  });

  // For combined markers - gradient of first two service types
  if (serviceTypes.length >= 2) {
    const gradient = `linear-gradient(135deg, ${serviceTypes[0].color} 50%, ${serviceTypes[1].color} 50%)`;
    root.style.setProperty('--service-color-combined', gradient);
  }

  // Inject dynamic marker CSS styles based on loaded service types
  injectDynamicMarkerStyles();
}

/**
 * Darken a hex color by a percentage
 * @param {string} hex - Hex color code (with or without #)
 * @param {number} percent - Percentage to darken (0-100)
 * @returns {string} Darkened hex color
 */
function darkenColor(hex, percent) {
  // Remove # if present
  hex = hex.replace('#', '');

  // Parse RGB
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Darken
  r = Math.max(0, Math.floor(r * (1 - percent / 100)));
  g = Math.max(0, Math.floor(g * (1 - percent / 100)));
  b = Math.max(0, Math.floor(b * (1 - percent / 100)));

  // Convert back to hex
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Inject dynamic CSS for marker category styles based on loaded service types
 * Uses premium 3-layer gradients and sophisticated shadows for professional look
 */
function injectDynamicMarkerStyles() {
  // Remove any previously injected dynamic styles
  const existingStyle = document.getElementById('dynamic-marker-styles');
  if (existingStyle) {
    existingStyle.remove();
  }

  const serviceTypes = serviceTypeRegistry.getAll();
  if (serviceTypes.length === 0) return;

  const styleElement = document.createElement('style');
  styleElement.id = 'dynamic-marker-styles';

  let css = '';

  // Generate premium styles for each service type
  serviceTypes.forEach((st) => {
    // Use premium palette if available, otherwise calculate colors
    const palette = industryPalettes[st.slug] || {
      light: st.color,
      primary: st.color,
      dark: darkenColor(st.color, 20)
    };

    // Premium 3-layer gradient with inner highlight
    css += `
      /* Premium marker style for ${st.name} */
      .custom-marker-with-label .marker-icon.${st.slug} {
        background: linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%);
        box-shadow:
          0 2px 8px rgba(0, 0, 0, 0.4),
          0 0 0 1px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.25);
      }

      .custom-marker-with-label .marker-icon.${st.slug}[data-status="forfalt"] {
        background: linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%) !important;
      }

      .custom-marker-with-label .marker-icon.${st.slug}[data-status="snart"] {
        background: linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%) !important;
      }
    `;
  });

  // Generate combined style if multiple service types exist
  if (serviceTypes.length >= 2) {
    const palette1 = industryPalettes[serviceTypes[0].slug] || { primary: serviceTypes[0].color };
    const palette2 = industryPalettes[serviceTypes[1].slug] || { primary: serviceTypes[1].color };
    const color1 = palette1.primary;
    const color2 = palette2.primary;

    css += `
      /* Premium combined marker style */
      .custom-marker-with-label .marker-icon.combined {
        width: 48px;
        height: 48px;
        min-width: 48px;
        min-height: 48px;
        background: linear-gradient(135deg, ${color1} 0%, ${color1} 48%, ${color2} 52%, ${color2} 100%);
        font-size: 15px;
        box-shadow:
          0 2px 8px rgba(0, 0, 0, 0.4),
          0 0 0 1px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }

      .custom-marker-with-label .marker-icon.combined[data-status="forfalt"] {
        background: linear-gradient(135deg, ${color1} 0%, ${color1} 48%, ${color2} 52%, ${color2} 100%) !important;
      }

      .custom-marker-with-label .marker-icon.combined[data-status="snart"] {
        background: linear-gradient(135deg, ${color1} 0%, ${color1} 48%, ${color2} 52%, ${color2} 100%) !important;
      }
    `;
  }

  styleElement.textContent = css;
  document.head.appendChild(styleElement);

  Logger.log('Premium marker styles injected for', serviceTypes.length, 'service types');
}

// Update map legend for current industry with premium styling
function updateMapLegend() {
  const legendItems = document.getElementById('legendItems');
  if (!legendItems) return;

  const serviceTypes = serviceTypeRegistry.getAll();

  if (serviceTypes.length === 0) {
    legendItems.innerHTML = '<div class="legend-item"><span class="legend-color" style="background: linear-gradient(135deg, #FBBF24, #D97706)"></span> Kunde</div>';
    return;
  }

  // Use premium palettes for legend
  legendItems.innerHTML = serviceTypes.map(st => {
    const palette = industryPalettes[st.slug] || { light: st.color, primary: st.color, dark: st.color };
    const gradient = `linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%)`;
    return `
      <div class="legend-item">
        <span class="legend-color" style="background: ${gradient}"></span>
        <span>${st.name}</span>
      </div>
    `;
  }).join('');

  // Add combined if multiple service types
  if (serviceTypes.length >= 2) {
    const palette1 = industryPalettes[serviceTypes[0].slug] || { primary: serviceTypes[0].color };
    const palette2 = industryPalettes[serviceTypes[1].slug] || { primary: serviceTypes[1].color };
    const combinedGradient = `linear-gradient(135deg, ${palette1.primary} 48%, ${palette2.primary} 52%)`;
    const combinedName = serviceTypes.map(st => escapeHtml(st.name)).join(' + ');
    legendItems.innerHTML += `
      <div class="legend-item">
        <span class="legend-color" style="background: ${combinedGradient}"></span>
        <span>${combinedName}</span>
      </div>
    `;
  }
}

// Apply branding from config to UI elements
function applyBranding() {
  // Login page branding
  const loginLogo = document.getElementById('loginLogo');
  const loginBrandTitle = document.getElementById('loginBrandTitle');
  const loginBrandSubtitle = document.getElementById('loginBrandSubtitle');
  const loginContact = document.getElementById('loginContact');
  const loginAddress = document.getElementById('loginAddress');
  const loginContactLinks = document.getElementById('loginContactLinks');
  const loginFooterCopyright = document.getElementById('loginFooterCopyright');

  // Header/sidebar branding
  const headerLogo = document.getElementById('headerLogo');
  const headerCompanyName = document.getElementById('headerCompanyName');
  const headerAppName = document.getElementById('headerAppName');
  const headerYear = document.getElementById('headerYear');

  // Apply logo if configured
  if (appConfig.logoUrl) {
    if (loginLogo) {
      loginLogo.src = appConfig.logoUrl;
      loginLogo.style.display = 'block';
    }
    if (headerLogo) {
      headerLogo.src = appConfig.logoUrl;
      headerLogo.style.display = 'block';
    }
  }

  // Apply organization name to sidebar H1 (fallback to app name, then Sky Planner)
  if (headerAppName) {
    headerAppName.textContent = appConfig.companyName || appConfig.appName || 'Sky Planner';
  }

  // Apply industry name as subtitle in header
  const industryName = appConfig.industry?.name;
  if (industryName) {
    if (headerCompanyName) {
      headerCompanyName.textContent = industryName;
      headerCompanyName.style.display = '';
    }
  } else {
    // Hide industry name element if not available
    if (headerCompanyName) headerCompanyName.style.display = 'none';
  }

  // Apply company name to login brand title
  if (appConfig.companyName && loginBrandTitle) {
    loginBrandTitle.textContent = appConfig.companyName;
  }

  // Apply year dynamically
  const currentYear = appConfig.appYear || new Date().getFullYear();
  if (headerYear) {
    headerYear.textContent = currentYear;
  }

  // Apply login footer copyright
  if (loginFooterCopyright) {
    const developerName = appConfig.developerName || 'Efffekt AS';
    loginFooterCopyright.innerHTML = `&copy; ${currentYear} ${escapeHtml(developerName)}. All rights reserved.`;
  }

  // Apply subtitle
  if (loginBrandSubtitle && appConfig.companySubtitle) {
    loginBrandSubtitle.textContent = appConfig.companySubtitle;
  }

  // Apply contact info if configured
  if (loginContact && (appConfig.contactAddress || appConfig.contactPhone || appConfig.contactEmail)) {
    loginContact.style.display = 'block';

    if (loginAddress && appConfig.contactAddress) {
      loginAddress.textContent = appConfig.contactAddress;
    }

    if (loginContactLinks) {
      let links = [];
      if (appConfig.contactPhone) {
        // Validate phone format: only digits, spaces, +, and - allowed
        const phoneClean = appConfig.contactPhone.replace(/[^\d\s\+\-\(\)]/g, '');
        const phoneHref = phoneClean.replace(/\s/g, '');
        links.push(`<a href="tel:${escapeHtml(phoneHref)}">${escapeHtml(phoneClean)}</a>`);
      }
      if (appConfig.contactEmail) {
        links.push(`<a href="mailto:${escapeHtml(appConfig.contactEmail)}">${escapeHtml(appConfig.contactEmail)}</a>`);
      }
      loginContactLinks.innerHTML = links.join('<span class="login-contact-divider">·</span>');
    }
  }

  // Multi-tenancy: Apply custom colors from tenant config
  applyTenantColors();

  // Multi-tenancy: Update page title
  if (appConfig.appName) {
    document.title = appConfig.appName;
  }

  // Update dynamic UI elements based on service types
  updateCategoryTabs();

  // Render dynamic login features based on industry/service types
  renderLoginFeatures();

  Logger.log('Branding applied from config');
}

// Render dynamic login features based on industry/service types
function renderLoginFeatures() {
  const container = document.getElementById('loginFeatures');
  if (!container) return;

  // Get service types from registry (or use defaults)
  let serviceTypes = [];
  try {
    serviceTypes = serviceTypeRegistry.getAll() || [];
  } catch (e) {
    // ServiceTypeRegistry not initialized yet
  }

  // Default features if no service types configured
  const defaultFeatures = [
    { icon: 'fas fa-clipboard-check', name: 'Kontroll', description: 'Periodisk oppfølging av kunder' },
    { icon: 'fas fa-route', name: 'Ruteplanlegging', description: 'Planlegg og optimaliser ruter' }
  ];

  // Use service types or defaults
  const features = serviceTypes.length > 0
    ? serviceTypes.slice(0, 3).map(s => {
        // Ensure icon has 'fas' prefix for Font Awesome 5
        let icon = s.icon || 'fa-check-circle';
        if (!icon.startsWith('fas ') && !icon.startsWith('far ') && !icon.startsWith('fab ')) {
          icon = 'fas ' + icon;
        }
        return {
          icon: icon,
          name: s.name,
          description: s.description || 'Periodisk kontroll'
        };
      })
    : defaultFeatures;

  // Always add standard features
  const standardFeatures = [
    { icon: 'fas fa-route', name: 'Ruteplanlegging', description: 'Effektive serviceruter' },
    { icon: 'fas fa-bell', name: 'Varsler', description: 'Automatiske påminnelser' }
  ];

  const allFeatures = [...features, ...standardFeatures];

  // Render feature cards
  container.innerHTML = allFeatures.map(feature => `
    <div class="login-feature">
      <div class="login-feature-icon">
        <i class="${feature.icon}"></i>
      </div>
      <div class="login-feature-text">
        <h4>${feature.name}</h4>
        <p>${feature.description}</p>
      </div>
    </div>
  `).join('');
}

// Apply tenant-specific colors using CSS custom properties
// NOTE: Accent colors are now set by Polarnatt theme (polarnatt.css) for all orgs.
// Per-org primaryColor is no longer applied — everyone gets the same brand.
function applyTenantColors() {
  const root = document.documentElement;

  // Secondary color (sidebar/background)
  if (appConfig.secondaryColor) {
    root.style.setProperty('--color-sidebar-bg', appConfig.secondaryColor);
  }

  Logger.log('Tenant colors applied (Polarnatt theme active)');
}

// Helper: Adjust color brightness (positive = lighter, negative = darker)
function adjustColor(hex, percent) {
  if (!hex) return hex;

  // Remove # if present
  hex = hex.replace('#', '');

  // Parse RGB
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Adjust brightness
  r = Math.min(255, Math.max(0, r + Math.round(r * percent / 100)));
  g = Math.min(255, Math.max(0, g + Math.round(g * percent / 100)));
  b = Math.min(255, Math.max(0, b + Math.round(b * percent / 100)));

  // Convert back to hex
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Reload config with auth token (after login for tenant-specific branding)
async function reloadConfigWithAuth() {
  try {
    const response = await fetch('/api/config', {
      credentials: 'include'
    });

    if (response.ok) {
      const configResponse = await response.json();
      appConfig = configResponse.data || configResponse;

      // Load service types: prefer org-specific types from config, fall back to industry template
      if (appConfig.serviceTypes && appConfig.serviceTypes.length > 0) {
        // Org has custom service types (from organization_service_types table)
        serviceTypeRegistry.loadFromConfig(appConfig);
        Logger.log('Service types loaded from org config:', appConfig.serviceTypes.length);
      } else {
        // Fall back to industry template service types
        const serverIndustry = appConfig.industry;
        if (serverIndustry && serverIndustry.slug) {
          localStorage.setItem('industrySlug', serverIndustry.slug);
          localStorage.setItem('industryName', serverIndustry.name || serverIndustry.slug);
          await serviceTypeRegistry.loadFromIndustry(serverIndustry.slug);
          Logger.log('Industry loaded from server:', serverIndustry.slug);
        } else {
          const industrySlug = localStorage.getItem('industrySlug');
          if (industrySlug) {
            await serviceTypeRegistry.loadFromIndustry(industrySlug);
          } else {
            serviceTypeRegistry.loadFromConfig(appConfig);
          }
        }
      }

      updateControlSectionHeaders();
      renderFilterPanelCategories();
      applyMvpModeUI();
      applyBranding();
      applyDateModeToInputs();
      // Refresh map tiles in case token was missing at initial load
      refreshMapTiles();
      // Update office marker position with org-specific coordinates
      updateOfficeMarkerPosition();
      Logger.log('Tenant-specific config loaded:', appConfig.organizationSlug);
    }
  } catch (error) {
    Logger.warn('Could not reload tenant config:', error);
  }
}


// Toggle map legend visibility
function toggleMapLegend() {
  const legend = document.getElementById('mapLegend');
  if (legend) {
    legend.classList.toggle('expanded');
  }
}

// Simple toast notification
// Initialize misc event listeners
function initMiscEventListeners() {
  // Excel/CSV Import functionality
  initExcelImport();

  // Map legend toggle
  const legendToggle = document.getElementById('legendToggle');
  if (legendToggle) {
    legendToggle.addEventListener('click', toggleMapLegend);
  }
}

/**
 * Enhanced Excel/CSV import functionality with wizard UI
 */
function initExcelImport() {
  // State
  const importState = {
    sessionId: null,
    previewData: null,
    columnMapping: {},
    categoryMapping: {},
    currentPage: 0,
    rowsPerPage: 50,
    validCategories: []
  };

  // Elements
  const dropzone = document.getElementById('importDropzone');
  const fileInput = document.getElementById('importFileInput');
  const steps = {
    step1: document.getElementById('importStep1'),
    step2: document.getElementById('importStep2'),
    step3: document.getElementById('importStep3'),
    step4: document.getElementById('importStep4')
  };

  if (!dropzone || !fileInput) return;

  // Step navigation
  function showStep(stepNum) {
    // Hide all steps
    Object.values(steps).forEach(step => {
      if (step) step.classList.add('hidden');
    });

    // Show target step
    const targetStep = steps[`step${stepNum}`];
    if (targetStep) targetStep.classList.remove('hidden');

    // Update step indicator
    document.querySelectorAll('.step-item').forEach(item => {
      const itemStep = parseInt(item.dataset.step);
      item.classList.remove('active', 'completed');
      if (itemStep < stepNum) item.classList.add('completed');
      if (itemStep === stepNum) item.classList.add('active');
    });
  }

  // File selection handlers
  dropzone.setAttribute('role', 'button');
  dropzone.setAttribute('tabindex', '0');
  dropzone.setAttribute('aria-label', 'Last opp fil. Dra og slipp, eller trykk for å velge fil.');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFileSelect(fileInput.files[0]);
    }
  });

  async function handleFileSelect(file) {
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

    if (!validExtensions.includes(ext)) {
      showNotification('Ugyldig filtype. Kun Excel (.xlsx, .xls) og CSV (.csv) er tillatt.', 'error');
      return;
    }

    // Show loading state
    dropzone.innerHTML = `
      <i aria-hidden="true" class="fas fa-spinner fa-spin"></i>
      <p>Analyserer fil...</p>
      <span class="import-formats">${file.name}</span>
    `;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await apiFetch('/api/kunder/import-excel/preview', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (response.ok) {
        importState.sessionId = data.sessionId;
        importState.previewData = data;
        importState.validCategories = data.validCategories || [];

        // Initialize column mapping from detected columns
        importState.columnMapping = {};
        data.columns.detected.forEach(col => {
          if (col.suggestedMapping) {
            importState.columnMapping[col.excelHeader] = col.suggestedMapping;
          }
        });

        renderColumnMapping(data);
        showStep(2);
      } else {
        throw new Error(data.error || 'Kunne ikke analysere filen');
      }
    } catch (error) {
      showNotification(error.message, 'error');
      resetDropzone();
    }
  }

  function resetDropzone() {
    dropzone.innerHTML = `
      <i aria-hidden="true" class="fas fa-cloud-upload-alt"></i>
      <p>Dra og slipp fil her, eller klikk for å velge</p>
      <span class="import-formats">Støttede formater: .xlsx, .xls, .csv (maks 10MB)</span>
    `;
    fileInput.value = '';
  }

  function resetImport() {
    importState.sessionId = null;
    importState.previewData = null;
    importState.columnMapping = {};
    importState.categoryMapping = {};
    importState.currentPage = 0;
    resetDropzone();
    showStep(1);
  }

  // Column mapping UI
  function renderColumnMapping(data) {
    const container = document.getElementById('columnMappingContainer');
    if (!container) return;

    const dbFields = [
      { value: '', label: '-- Ignorer --' },
      { value: 'navn', label: 'Navn *', required: true },
      { value: 'adresse', label: 'Adresse *', required: true },
      { value: 'postnummer', label: 'Postnummer' },
      { value: 'poststed', label: 'Poststed' },
      { value: 'telefon', label: 'Telefon' },
      { value: 'epost', label: 'E-post' },
      { value: 'kategori', label: 'Kategori' },
      { value: 'el_type', label: 'El-type' },
      { value: 'brann_system', label: 'Brannsystem' },
      { value: 'brann_driftstype', label: 'Driftstype' },
      { value: 'notater', label: 'Notater' },
      { value: 'lat', label: 'Breddegrad' },
      { value: 'lng', label: 'Lengdegrad' }
    ];

    container.innerHTML = data.columns.detected.map(col => `
      <div class="mapping-row">
        <div class="mapping-excel">
          <strong>${escapeHtml(col.excelHeader)}</strong>
          <span class="sample-values">${col.sampleValues.map(v => escapeHtml(v)).join(', ') || 'Ingen verdier'}</span>
        </div>
        <i aria-hidden="true" class="fas fa-arrow-right mapping-arrow"></i>
        <div class="mapping-db">
          <select class="column-select" data-excel="${escapeHtml(col.excelHeader)}">
            ${dbFields.map(f => `
              <option value="${f.value}" ${col.suggestedMapping === f.value ? 'selected' : ''}>
                ${f.label}
              </option>
            `).join('')}
          </select>
          ${col.confidence < 1 && col.suggestedMapping ?
            `<span class="confidence-badge">${Math.round(col.confidence * 100)}%</span>` : ''}
        </div>
      </div>
    `).join('');

    // Add change listeners
    container.querySelectorAll('.column-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const excelCol = e.target.dataset.excel;
        importState.columnMapping[excelCol] = e.target.value;
      });
    });
  }

  // Preview table
  function renderPreview(data) {
    const analysis = data.analysis;

    // Update summary cards
    document.getElementById('newCount').textContent = analysis.toCreate || 0;
    document.getElementById('updateCount').textContent = analysis.toUpdate || 0;
    document.getElementById('warningCount').textContent = analysis.warningRows || 0;
    document.getElementById('errorCount').textContent = analysis.errorRows || 0;

    // Update import button count
    const importableCount = (analysis.toCreate || 0) + (analysis.toUpdate || 0);
    document.getElementById('importCountLabel').textContent = importableCount;

    // Render category mapping if needed
    renderCategoryMapping(data.categoryAnalysis);

    // Render dynamic schema suggestions
    renderDynamicSchema(data.dynamicSchema);

    // Render preview table
    renderPreviewTable(data.previewData);
  }

  function renderCategoryMapping(categoryAnalysis) {
    const section = document.getElementById('categoryMappingSection');
    const list = document.getElementById('categoryMappingList');

    if (!categoryAnalysis || categoryAnalysis.unknown.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    list.innerHTML = categoryAnalysis.unknown.map(item => `
      <div class="category-mapping-row">
        <span class="original-value">"${escapeHtml(item.value)}"</span>
        <span class="occurrence-count">(${item.count} forekomster)</span>
        <select class="category-select" data-original="${escapeHtml(item.value)}">
          <option value="">-- Velg kategori --</option>
          ${importState.validCategories.map(cat => `
            <option value="${cat}">${cat}</option>
          `).join('')}
        </select>
      </div>
    `).join('');

    // Add change listeners
    list.querySelectorAll('.category-select').forEach(select => {
      select.addEventListener('change', (e) => {
        const originalValue = e.target.dataset.original;
        importState.categoryMapping[originalValue] = e.target.value;
      });
    });
  }

  // Render dynamic schema suggestions from Excel analysis
  function renderDynamicSchema(dynamicSchema) {
    const section = document.getElementById('dynamicSchemaSection');
    const newCategoriesSection = document.getElementById('newCategoriesSection');
    const newFieldsSection = document.getElementById('newFieldsSection');
    const newFieldValuesSection = document.getElementById('newFieldValuesSection');

    if (!section || !dynamicSchema) {
      if (section) section.classList.add('hidden');
      return;
    }

    const hasNewCategories = dynamicSchema.newCategories && dynamicSchema.newCategories.length > 0;
    const hasNewFields = dynamicSchema.newFields && dynamicSchema.newFields.length > 0;
    const hasNewFieldValues = dynamicSchema.newFieldValues && Object.keys(dynamicSchema.newFieldValues).length > 0;

    // Hide if nothing to show
    if (!hasNewCategories && !hasNewFields && !hasNewFieldValues) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');

    // Initialize state for tracking selections
    importState.dynamicSchema = {
      selectedCategories: {},
      selectedFields: {},
      selectedFieldValues: {}
    };

    // Render new categories
    if (hasNewCategories) {
      newCategoriesSection.classList.remove('hidden');
      const list = document.getElementById('newCategoriesList');
      list.innerHTML = dynamicSchema.newCategories.map((cat, idx) => `
        <div class="schema-item">
          <input type="checkbox" class="schema-item-checkbox" id="newCat_${idx}" data-category="${escapeHtml(cat.name)}" checked>
          <div class="schema-item-color" style="background-color: ${cat.color}"></div>
          <div class="schema-item-icon">
            <i aria-hidden="true" class="fas ${cat.icon}"></i>
          </div>
          <div class="schema-item-info">
            <label for="newCat_${idx}" class="schema-item-name">${escapeHtml(cat.name)}</label>
            <div class="schema-item-meta">Intervall: ${cat.default_interval_months || 12} mnd</div>
          </div>
        </div>
      `).join('');

      // Track selections
      list.querySelectorAll('.schema-item-checkbox').forEach(checkbox => {
        const catName = checkbox.dataset.category;
        importState.dynamicSchema.selectedCategories[catName] = checkbox.checked;
        checkbox.addEventListener('change', (e) => {
          importState.dynamicSchema.selectedCategories[catName] = e.target.checked;
        });
      });
    } else {
      newCategoriesSection.classList.add('hidden');
    }

    // Render new fields
    if (hasNewFields) {
      newFieldsSection.classList.remove('hidden');
      const list = document.getElementById('newFieldsList');
      list.innerHTML = dynamicSchema.newFields.map((field, idx) => `
        <div class="schema-item">
          <input type="checkbox" class="schema-item-checkbox" id="newField_${idx}" data-field="${escapeHtml(field.field_name)}" checked>
          <div class="schema-item-info">
            <label for="newField_${idx}" class="schema-item-name">${escapeHtml(field.display_name)}</label>
            <div class="schema-item-meta">
              <span class="schema-field-type">${field.field_type}</span>
              ${field.is_filterable ? '<span class="schema-field-type" style="background: #10B981;">Filtrerbart</span>' : ''}
            </div>
            ${field.options && field.options.length > 0 ? `
              <div class="schema-item-preview">
                ${field.options.slice(0, 5).map(opt => `
                  <span class="schema-item-preview-tag">${escapeHtml(opt.value || opt)}</span>
                `).join('')}
                ${field.options.length > 5 ? `<span class="schema-item-preview-tag">+${field.options.length - 5} mer</span>` : ''}
              </div>
            ` : ''}
          </div>
        </div>
      `).join('');

      // Track selections
      list.querySelectorAll('.schema-item-checkbox').forEach(checkbox => {
        const fieldName = checkbox.dataset.field;
        importState.dynamicSchema.selectedFields[fieldName] = checkbox.checked;
        checkbox.addEventListener('change', (e) => {
          importState.dynamicSchema.selectedFields[fieldName] = e.target.checked;
        });
      });
    } else {
      newFieldsSection.classList.add('hidden');
    }

    // Render new field values
    if (hasNewFieldValues) {
      newFieldValuesSection.classList.remove('hidden');
      const list = document.getElementById('newFieldValuesList');
      const entries = Object.entries(dynamicSchema.newFieldValues);

      list.innerHTML = entries.map(([fieldName, values], idx) => `
        <div class="schema-item">
          <input type="checkbox" class="schema-item-checkbox" id="newValues_${idx}" data-field="${escapeHtml(fieldName)}" checked>
          <div class="schema-item-info">
            <label for="newValues_${idx}" class="schema-item-name">${escapeHtml(fieldName)}</label>
            <div class="schema-item-preview">
              ${values.slice(0, 5).map(v => `
                <span class="schema-item-preview-tag">${escapeHtml(v)}</span>
              `).join('')}
              ${values.length > 5 ? `<span class="schema-item-preview-tag">+${values.length - 5} mer</span>` : ''}
            </div>
          </div>
        </div>
      `).join('');

      // Track selections
      list.querySelectorAll('.schema-item-checkbox').forEach(checkbox => {
        const fieldName = checkbox.dataset.field;
        importState.dynamicSchema.selectedFieldValues[fieldName] = checkbox.checked;
        checkbox.addEventListener('change', (e) => {
          importState.dynamicSchema.selectedFieldValues[fieldName] = e.target.checked;
        });
      });
    } else {
      newFieldValuesSection.classList.add('hidden');
    }
  }

  function renderPreviewTable(rows) {
    const thead = document.getElementById('previewTableHead');
    const tbody = document.getElementById('previewTableBody');

    if (!rows || rows.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = '<tr><td colspan="5">Ingen data</td></tr>';
      return;
    }

    // Headers
    thead.innerHTML = `
      <tr>
        <th>Rad</th>
        <th>Status</th>
        <th>Navn</th>
        <th>Adresse</th>
        <th>Info</th>
      </tr>
    `;

    // Paginate
    const start = importState.currentPage * importState.rowsPerPage;
    const pageRows = rows.slice(start, start + importState.rowsPerPage);

    tbody.innerHTML = pageRows.map(row => {
      const statusClass = {
        'valid': 'status-new',
        'warning': 'status-warning',
        'error': 'status-error',
        'duplicate': 'status-update'
      }[row.status] || '';

      const statusIcon = {
        'valid': '<i aria-hidden="true" class="fas fa-plus-circle"></i>',
        'warning': '<i aria-hidden="true" class="fas fa-exclamation-triangle"></i>',
        'error': '<i aria-hidden="true" class="fas fa-times-circle"></i>',
        'duplicate': '<i aria-hidden="true" class="fas fa-sync-alt"></i>'
      }[row.status] || '';

      const statusText = {
        'valid': 'Ny',
        'warning': 'Advarsel',
        'error': 'Feil',
        'duplicate': 'Oppdateres'
      }[row.status] || row.status;

      return `
        <tr class="${statusClass}">
          <td>${row.rowNumber}</td>
          <td><span class="status-badge ${statusClass}">${statusIcon} ${statusText}</span></td>
          <td>${escapeHtml(row.normalizedData?.navn || '-')}</td>
          <td>${escapeHtml(row.normalizedData?.adresse || '-')}</td>
          <td class="info-cell">
            ${row.issues.length > 0 ?
              `<span class="issues-tooltip" title="${row.issues.map(i => escapeHtml(i)).join('\n')}">
                <i aria-hidden="true" class="fas fa-info-circle"></i> ${row.issues.length} melding${row.issues.length > 1 ? 'er' : ''}
              </span>` : '-'}
          </td>
        </tr>
      `;
    }).join('');

    // Update pagination
    updatePagination(rows.length);
  }

  function updatePagination(totalRows) {
    const totalPages = Math.ceil(totalRows / importState.rowsPerPage);
    const currentPage = importState.currentPage + 1;

    document.getElementById('pageInfo').textContent = `Side ${currentPage} av ${totalPages}`;
    document.getElementById('prevPageBtn').disabled = importState.currentPage === 0;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
  }

  // Pagination handlers
  document.getElementById('prevPageBtn')?.addEventListener('click', () => {
    if (importState.currentPage > 0) {
      importState.currentPage--;
      renderPreviewTable(importState.previewData.previewData);
    }
  });

  document.getElementById('nextPageBtn')?.addEventListener('click', () => {
    const totalPages = Math.ceil(importState.previewData.previewData.length / importState.rowsPerPage);
    if (importState.currentPage < totalPages - 1) {
      importState.currentPage++;
      renderPreviewTable(importState.previewData.previewData);
    }
  });

  // Navigation buttons
  document.getElementById('backToStep1Btn')?.addEventListener('click', resetImport);

  document.getElementById('proceedToStep3Btn')?.addEventListener('click', () => {
    // Validate required mappings
    const hasNavn = Object.values(importState.columnMapping).includes('navn');
    const hasAdresse = Object.values(importState.columnMapping).includes('adresse');

    if (!hasNavn || !hasAdresse) {
      showNotification('Du må mappe minst "Navn" og "Adresse" kolonnene.', 'error');
      return;
    }

    renderPreview(importState.previewData);
    showStep(3);
  });

  document.getElementById('backToStep2Btn')?.addEventListener('click', () => {
    showStep(2);
  });

  // Execute import
  document.getElementById('startImportBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('startImportBtn');
    btn.disabled = true;

    showStep(4);
    document.getElementById('importProgress').classList.remove('hidden');
    document.getElementById('importResult').classList.add('hidden');

    const progressFill = document.getElementById('importProgressFill');
    const progressText = document.getElementById('importProgressText');

    progressFill.style.width = '5%';
    progressText.textContent = 'Oppretter nye kategorier og felt...';

    try {
      // First, create selected dynamic schema items
      if (importState.dynamicSchema) {
        const dynamicSchema = importState.previewData?.dynamicSchema;

        // Create selected categories
        const selectedCategories = dynamicSchema?.newCategories?.filter(cat =>
          importState.dynamicSchema.selectedCategories[cat.name]
        ) || [];

        if (selectedCategories.length > 0) {
          progressText.textContent = `Oppretter ${selectedCategories.length} nye kategorier...`;
          for (const cat of selectedCategories) {
            try {
              await apiFetch('/api/service-types', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: cat.name,
                  icon: cat.icon || 'fa-wrench',
                  color: cat.color || '#5E81AC',
                  default_interval_months: cat.default_interval_months || 12,
                })
              });
            } catch (catError) {
              console.warn(`Could not create category ${cat.name}:`, catError);
            }
          }
          await loadOrganizationCategories();
          renderFilterPanelCategories();
        }

        progressFill.style.width = '10%';

        // Create selected fields
        const selectedFields = dynamicSchema?.newFields?.filter(field =>
          importState.dynamicSchema.selectedFields[field.field_name]
        ) || [];

        if (selectedFields.length > 0) {
          progressText.textContent = `Oppretter ${selectedFields.length} nye felt...`;
          try {
            await apiFetch('/api/fields/bulk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fields: selectedFields })
            });
          } catch (fieldError) {
            console.warn('Could not create fields:', fieldError);
          }
        }

        progressFill.style.width = '15%';
      }

      progressFill.style.width = '20%';
      progressText.textContent = 'Starter kundeimport...';

      const response = await apiFetch('/api/kunder/import-excel/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: importState.sessionId,
          categoryMapping: importState.categoryMapping,
          geocodeAfterImport: document.getElementById('geocodeAfterImport')?.checked || false
        })
      });

      progressFill.style.width = '90%';
      progressText.textContent = 'Fullfører...';

      const data = await response.json();

      progressFill.style.width = '100%';

      // Show result
      setTimeout(() => {
        document.getElementById('importProgress').classList.add('hidden');
        document.getElementById('importResult').classList.remove('hidden');
        showImportResult(response.ok && data.success, data);

        if (response.ok && data.success) {
          loadCustomers();
        }
      }, 500);

    } catch (error) {
      document.getElementById('importProgress').classList.add('hidden');
      document.getElementById('importResult').classList.remove('hidden');
      showImportResult(false, { error: error.message });
    }

    btn.disabled = false;
  });

  function showImportResult(success, data) {
    const icon = document.getElementById('resultIcon');
    const title = document.getElementById('importResultTitle');

    if (success) {
      icon.innerHTML = '<i aria-hidden="true" class="fas fa-check-circle"></i>';
      icon.className = 'result-icon success';
      title.textContent = 'Import fullført!';

      document.getElementById('resultCreated').textContent = data.created || 0;
      document.getElementById('resultUpdated').textContent = data.updated || 0;
      document.getElementById('resultSkipped').textContent = data.skipped || 0;

      // Show errors if any
      const errorsSection = document.getElementById('resultErrors');
      const errorList = document.getElementById('errorList');
      if (data.errors && data.errors.length > 0) {
        errorsSection.classList.remove('hidden');
        errorList.innerHTML = data.errors.slice(0, 10).map(e =>
          `<li>Rad ${e.row}: ${escapeHtml(e.navn || '')} - ${escapeHtml(e.error)}</li>`
        ).join('');
        if (data.errors.length > 10) {
          errorList.innerHTML += `<li>... og ${data.errors.length - 10} flere</li>`;
        }
      } else {
        errorsSection.classList.add('hidden');
      }

      // Show geocoding note
      const noteEl = document.getElementById('resultNote');
      if (data.geocodingNote) {
        noteEl.textContent = data.geocodingNote;
        noteEl.classList.remove('hidden');
      } else {
        noteEl.classList.add('hidden');
      }
    } else {
      icon.innerHTML = '<i aria-hidden="true" class="fas fa-times-circle"></i>';
      icon.className = 'result-icon error';
      title.textContent = 'Import feilet';

      document.getElementById('resultCreated').textContent = '0';
      document.getElementById('resultUpdated').textContent = '0';
      document.getElementById('resultSkipped').textContent = '0';

      const noteEl = document.getElementById('resultNote');
      noteEl.textContent = data.error || 'En ukjent feil oppstod.';
      noteEl.classList.remove('hidden');
    }
  }

  // Close result
  document.getElementById('closeImportResultBtn')?.addEventListener('click', resetImport);

  // Helper function
}


/**
 * Update week plan badges on map markers.
 * Shows initials of who planned/owns each customer for the current week.
 */
function updateWeekPlanBadges() {
  if (!markers) return;

  // Use team members to get consistent colors per person
  const teamMembers = getWeekTeamMembers();
  const colorByName = new Map();
  teamMembers.forEach(m => colorByName.set(m.name, m.color));

  // Build a map: kundeId → { initials, day, color }
  const planMap = new Map();
  const userName = localStorage.getItem('userName') || '';
  const userInitials = getCreatorDisplay(userName, true);

  // Planned (unsaved) customers from weekly plan
  if (weekPlanState.days) {
    for (const dayKey of weekDayKeys) {
      const dayData = weekPlanState.days[dayKey];
      if (!dayData) continue;
      for (const c of dayData.planned) {
        planMap.set(c.id, {
          initials: userInitials,
          day: weekDayLabels[weekDayKeys.indexOf(dayKey)].substring(0, 3),
          color: colorByName.get(userName) || TEAM_COLORS[0],
          creator: userName
        });
      }
    }
  }

  // Existing avtaler for the current week
  if (weekPlanState.days) {
    const weekDates = new Set(weekDayKeys.map(k => weekPlanState.days[k]?.date).filter(Boolean));
    for (const a of avtaler) {
      if (!weekDates.has(a.dato) || !a.kunde_id) continue;
      if (planMap.has(a.kunde_id)) continue;
      const creator = a.opprettet_av && a.opprettet_av !== 'admin' ? a.opprettet_av : '';
      if (!creator) continue;
      const initials = getCreatorDisplay(creator, true);
      const dayDate = new Date(a.dato + 'T00:00:00');
      const dayIdx = (dayDate.getDay() + 6) % 7;
      planMap.set(a.kunde_id, {
        initials,
        day: dayIdx < 5 ? weekDayLabels[dayIdx].substring(0, 3) : '',
        color: colorByName.get(creator) || TEAM_COLORS[1],
        creator
      });
    }
  }

  // Update all markers
  for (const kundeId of Object.keys(markers)) {
    const marker = markers[kundeId];
    const el = marker.getElement();
    if (!el) continue;

    // Remove existing plan badge
    const existing = el.querySelector('.wp-plan-badge');
    if (existing) existing.remove();

    const plan = planMap.get(Number(kundeId));
    if (plan) {
      const badge = document.createElement('div');
      badge.className = 'wp-plan-badge';
      badge.style.backgroundColor = plan.color;
      badge.textContent = plan.initials;
      badge.title = `${plan.day} - ${plan.initials}`;
      el.appendChild(badge);
    }
  }

  // Store plan data on markers for cluster icon access
  for (const [kundeId, plan] of planMap) {
    if (markers[kundeId]) {
      markers[kundeId]._customerData = {
        ...markers[kundeId]._customerData,
        planned: true,
        plannedInitials: plan.initials,
        plannedColor: plan.color
      };
    }
  }
  // Clear planned flag for non-planned markers
  for (const kundeId of Object.keys(markers)) {
    if (!planMap.has(Number(kundeId)) && markers[kundeId]._customerData) {
      delete markers[kundeId]._customerData.planned;
      delete markers[kundeId]._customerData.plannedInitials;
      delete markers[kundeId]._customerData.plannedColor;
    }
  }
  if (typeof refreshClusters === 'function') refreshClusters();
}

// Lightweight re-apply of plan badges on visible markers (uses data stored on marker.options)
function reapplyPlanBadges() {
  if (!markers) return;

  for (const kundeId of Object.keys(markers)) {
    const marker = markers[kundeId];
    const el = marker.getElement();
    if (!el) continue;

    // Skip if badge already exists
    if (el.querySelector('.wp-plan-badge')) continue;

    const cd = marker._customerData;
    if (cd && cd.planned && cd.plannedInitials) {
      const badge = document.createElement('div');
      badge.className = 'wp-plan-badge';
      badge.style.backgroundColor = cd.plannedColor || TEAM_COLORS[0];
      badge.textContent = cd.plannedInitials;
      el.appendChild(badge);
    }
  }
}

// Update all day counters in the UI (called periodically)
function updateDayCounters() {
  // Re-render lists that show day counts
  const activeTab = document.querySelector('.tab-item.active')?.dataset.tab;

  if (activeTab === 'customers') {
    renderCustomerAdmin();
  } else if (activeTab === 'overdue') {
    renderOverdue();
  } else if (activeTab === 'warnings') {
    renderWarnings();
  } else if (activeTab === 'planner') {
    renderPlanner();
  }

  // Always update the badges
  updateOverdueBadge();
  renderMissingData(); // Update missing data badge

  // Update filter panel customer list
  applyFilters();
}

// Schedule update at next midnight to refresh day counters
function scheduleNextMidnightUpdate() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 1, 0); // 1 second after midnight

  const msUntilMidnight = tomorrow.getTime() - now.getTime();

  setTimeout(() => {
    Logger.log('Midnight update - refreshing day counters');
    updateDayCounters();
    // Schedule next midnight update
    scheduleNextMidnightUpdate();
  }, msUntilMidnight);

  Logger.log(`Next midnight update scheduled in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`);
}


// ===== UI HELPERS =====

// Update category tabs dynamically based on service types from config
function updateCategoryTabs() {
  if (!serviceTypeRegistry.initialized) return;

  const container = document.getElementById('kategoriTabs');
  if (!container) return;

  // Generate dynamic tabs
  container.innerHTML = serviceTypeRegistry.renderCategoryTabs(customerAdminKategori);

  Logger.log('Category tabs updated from service registry');
}

// Update badge visibility and count
function updateBadge(badgeId, count) {
  const badge = document.getElementById(badgeId);
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// Get the nearest upcoming control date for a customer (returns Date object)
function getNearestControlDate(customer) {
  const dates = [customer.neste_el_kontroll, customer.neste_brann_kontroll, customer.neste_kontroll]
    .filter(Boolean)
    .map(d => {
      const [y, m, day] = d.split('-').map(Number);
      return new Date(y, m - 1, day);
    });
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates));
}

// Load configuration from server
async function loadConfig() {
  try {
    // Use regular fetch for config - no auth required
    const response = await fetch('/api/config', { credentials: 'include' });
    if (!response.ok) throw new Error(`Config load failed: ${response.status}`);
    const configResponse = await response.json();
    appConfig = configResponse.data || configResponse;

    // Initialize service type registry from config
    serviceTypeRegistry.loadFromConfig(appConfig);
    allSubcategoryGroups = appConfig.subcategoryGroups || [];

    // Check localStorage for saved industry (for login page display before auth)
    const savedIndustrySlug = localStorage.getItem('industrySlug');
    if (savedIndustrySlug) {
      try {
        await serviceTypeRegistry.loadFromIndustry(savedIndustrySlug);
        Logger.log('Loaded saved industry from localStorage:', savedIndustrySlug);
      } catch (e) {
        Logger.warn('Could not load saved industry:', e);
      }
    }

    // Update control section headers with dynamic service type names/icons
    updateControlSectionHeaders();

    // Render dynamic filter panel categories
    renderFilterPanelCategories();
    // Apply MVP mode UI changes (hide industry-specific elements)
    applyMvpModeUI();

    Logger.log('Application configuration loaded:', appConfig);
    Logger.log('Route planning configured:', appConfig.orsApiKeyConfigured);
  } catch (error) {
    Logger.warn('Could not load configuration from server:', error);
    // Use defaults - requireAuth: true by default for safety
    appConfig = {
      appName: 'Sky Planner',
      companyName: '',
      companySubtitle: 'Kontroll. Oversikt. Alltid.',
      logoUrl: '/skyplanner-logo.svg',
      contactAddress: '',
      contactPhone: '',
      contactEmail: '',
      appYear: '2026',
      mapCenterLat: 65.5,
      mapCenterLng: 12.0,
      mapZoom: 5,
      mapClusterRadius: 80,
      enableRoutePlanning: true,
      showUpcomingWidget: true,
      upcomingControlDays: 30,
      defaultControlInterval: 12,
      controlIntervals: [6, 12, 24, 36],
      requireAuth: true
    };
  }
}


// Load customers from API
async function loadCustomers() {
  Logger.log('loadCustomers() called, supercluster:', !!supercluster);
  try {
    const response = await apiFetch('/api/kunder');
    if (!response.ok) throw new Error(`HTTP ${response.status}: Kunne ikke laste kunder`);
    const result = await response.json();
    customers = result.data || result; // Handle both { data: [...] } and direct array
    Logger.log('loadCustomers() fetched', customers.length, 'customers');
    applyFilters(); // Handles both renderCustomerList(filtered) and renderMarkers(filtered)

    // If no office location is configured, fit map to all customers
    if (!appConfig.routeStartLat && !appConfig.routeStartLng && customers.length > 0 && map) {
      const customersWithCoords = customers.filter(c => c.lat && c.lng);
      if (customersWithCoords.length > 0) {
        const bounds = boundsFromCustomers(customersWithCoords);
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 1000 });
        }
      }
    }
    renderCustomerAdmin();
    updateOverdueBadge();
    renderMissingData(); // Update missing data badge and lists
    updateDashboard(); // Update dashboard stats
    updateGettingStartedBanner(); // Show/hide getting started banner

    // Load avtaler and subcategory assignments in parallel
    if (!weekPlanState.weekStart) initWeekPlanState(new Date());
    await Promise.all([
      loadAvtaler(),
      loadAllSubcategoryAssignments()
    ]);
  } catch (error) {
    console.error('Feil ved lasting av kunder:', error);
  }
}

// Show or hide the getting started banner based on customer count
function updateGettingStartedBanner() {
  const existing = document.getElementById('gettingStartedBanner');

  // Remove banner if customers exist
  if (customers.length > 0) {
    if (existing) existing.remove();
    return;
  }

  // Don't show if user has dismissed it
  if (localStorage.getItem('gettingStartedDismissed') === 'true') {
    return;
  }

  // Don't show if banner already exists
  if (existing) return;

  // Create and insert banner
  const banner = document.createElement('div');
  banner.id = 'gettingStartedBanner';
  banner.className = 'getting-started-banner';
  banner.innerHTML = renderGettingStartedBanner();

  const mapContainer = document.getElementById('sharedMapContainer');
  if (mapContainer) {
    mapContainer.appendChild(banner);
  }

  // Event delegation for banner actions (avoids inline onclick for CSP compliance)
  banner.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'dismiss-getting-started') {
      dismissGettingStartedBanner();
    } else if (action === 'open-integrations') {
      window.open(target.dataset.url, '_blank');
    } else if (action === 'contact-import') {
      window.location.href = target.dataset.url;
    } else if (action === 'add-customer-manual') {
      dismissGettingStartedBanner();
      addCustomer();
    }
  });
}

// Render getting started banner HTML
function renderGettingStartedBanner() {
  const webUrl = appConfig.webUrl || '';

  return `
    <div class="getting-started-header">
      <div>
        <h2>Velkommen til Sky Planner!</h2>
        <p>Legg til dine kunder for å komme i gang.</p>
      </div>
      <button class="getting-started-close" data-action="dismiss-getting-started" title="Lukk">
        <i aria-hidden="true" class="fas fa-times"></i>
      </button>
    </div>
    <div class="getting-started-cards">
      <div class="getting-started-card" data-action="open-integrations" data-url="${escapeHtml(webUrl)}/dashboard/innstillinger/integrasjoner">
        <div class="getting-started-card-icon">
          <i aria-hidden="true" class="fas fa-plug"></i>
        </div>
        <h3>Koble til regnskapssystem</h3>
        <p>Synkroniser kunder fra Tripletex, Fiken eller PowerOffice.</p>
      </div>
      <div class="getting-started-card" data-action="contact-import" data-url="mailto:support@skyplanner.no?subject=Hjelp med dataimport">
        <div class="getting-started-card-icon">
          <i aria-hidden="true" class="fas fa-file-import"></i>
        </div>
        <h3>Importer eksisterende data</h3>
        <p>Har du data i Excel eller annet format? Kontakt oss, s&aring; hjelper vi deg.</p>
      </div>
      <div class="getting-started-card" data-action="add-customer-manual">
        <div class="getting-started-card-icon">
          <i aria-hidden="true" class="fas fa-plus-circle"></i>
        </div>
        <h3>Legg til manuelt</h3>
        <p>Opprett kunder en og en direkte i systemet.</p>
      </div>
    </div>
  `;
}

// Dismiss getting started banner
function dismissGettingStartedBanner() {
  localStorage.setItem('gettingStartedDismissed', 'true');
  const banner = document.getElementById('gettingStartedBanner');
  if (banner) {
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(-20px)';
    setTimeout(() => banner.remove(), 300);
  }
}

// Load områder for filter
async function loadOmrader() {
  try {
    const response = await apiFetch('/api/omrader');
    if (!response.ok) throw new Error(`HTTP ${response.status}: Kunne ikke laste områder`);
    const omrResult = await response.json();
    omrader = omrResult.data || omrResult;
    renderOmradeFilter();
  } catch (error) {
    console.error('Feil ved lasting av områder:', error);
  }
}

// Render område filter dropdown
function renderOmradeFilter() {
  const filterContainer = document.getElementById('omradeFilter');
  if (!filterContainer) return;

  filterContainer.innerHTML = `
    <div style="display:flex;gap:4px;align-items:center;">
      <select id="omradeSelect" style="flex:1;">
        <option value="alle">Alle områder</option>
        <option value="varsler">Trenger kontroll</option>
        ${omrader.map(o => `<option value="${escapeHtml(o.poststed)}">${escapeHtml(o.poststed)} (${o.antall})</option>`).join('')}
      </select>
      <button id="showOverdueInAreaBtn" class="btn btn-small btn-warning" style="display:none;white-space:nowrap;" title="Vis forfalte i området på kartet">
        <i aria-hidden="true" class="fas fa-exclamation-triangle"></i>
      </button>
    </div>
  `;

  // Use event delegation on filterContainer to avoid memory leaks
  // Remove old listener by replacing with clone, then add new one
  const oldSelect = document.getElementById('omradeSelect');
  const newSelect = oldSelect.cloneNode(true);
  oldSelect.parentNode.replaceChild(newSelect, oldSelect);

  newSelect.addEventListener('change', (e) => {
    currentFilter = e.target.value;
    showOnlyWarnings = currentFilter === 'varsler';
    applyFilters();

    // Vis/skjul knapp for å vise forfalte i valgt område
    const overdueBtn = document.getElementById('showOverdueInAreaBtn');
    if (overdueBtn) {
      overdueBtn.style.display = (currentFilter !== 'alle' && currentFilter !== 'varsler') ? 'inline-flex' : 'none';
    }
  });

  // Knapp: vis forfalte i valgt område på kartet
  const overdueBtn = document.getElementById('showOverdueInAreaBtn');
  if (overdueBtn) {
    overdueBtn.addEventListener('click', () => {
      const currentMonthValue = new Date().getFullYear() * 12 + new Date().getMonth();
      const overdueInArea = customers.filter(c => {
        if (c.poststed !== currentFilter) return false;
        const nextDate = getNextControlDate(c);
        if (!nextDate) return false;
        const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
        return controlMonthValue < currentMonthValue;
      });
      if (overdueInArea.length === 0) {
        showToast('Ingen forfalte kontroller i dette området', 'info');
        return;
      }
      const ids = overdueInArea.map(c => c.id);
      showCustomersOnMap(ids);
      highlightCustomersOnMap(ids);
      showToast(`${overdueInArea.length} forfalte kontroller i ${currentFilter}`, 'warning');
    });
  }
}


// Apply all filters
async function applyFilters() {
  // Avbryt pågående request for å unngå race condition
  if (filterAbortController) {
    filterAbortController.abort();
  }
  filterAbortController = new AbortController();

  let filtered = [...customers];
  const searchQuery = searchInput?.value?.toLowerCase() || '';

  // Category filter - exact match on kategori string
  if (selectedCategory !== 'all') {
    const beforeCount = filtered.length;
    filtered = filtered.filter(c => {
      if (!c.kategori) return false;
      return c.kategori === selectedCategory;
    });
    Logger.log(`applyFilters: "${selectedCategory}" - ${beforeCount} -> ${filtered.length} kunder`);
  }

  // Subcategory filter (AND logic between groups: customer must match all selected groups)
  const activeSubcatFilters = Object.entries(selectedSubcategories).filter(([_, v]) => v);
  if (activeSubcatFilters.length > 0) {
    filtered = filtered.filter(c => {
      const assignments = kundeSubcatMap[c.id] || [];
      return activeSubcatFilters.every(([groupId, subcatId]) => {
        return assignments.some(a => a.group_id === Number(groupId) && a.subcategory_id === Number(subcatId));
      });
    });
  }

  // Dynamic field filters
  if (Object.keys(dynamicFieldFilters).length > 0) {
    filtered = filtered.filter(customer => {
      let customData = customer.custom_data;
      if (typeof customData === 'string') {
        try { customData = JSON.parse(customData); } catch { customData = {}; }
      }
      customData = customData || {};

      return Object.entries(dynamicFieldFilters).every(([fieldName, filterValue]) => {
        const customerValue = customData[fieldName];
        const field = organizationFields.find(f => f.field_name === fieldName);

        if (!field) return true;

        switch (field.field_type) {
          case 'select':
            return customerValue === filterValue;

          case 'text':
            return customerValue && String(customerValue).toLowerCase().includes(String(filterValue).toLowerCase());

          case 'number':
            if (!customerValue && customerValue !== 0) return false;
            const num = parseFloat(customerValue);
            if (isNaN(num)) return false;
            if (filterValue.min && num < parseFloat(filterValue.min)) return false;
            if (filterValue.max && num > parseFloat(filterValue.max)) return false;
            return true;

          case 'date':
            if (!customerValue) return false;
            const date = new Date(customerValue);
            if (isNaN(date.getTime())) return false;
            if (filterValue.from && date < new Date(filterValue.from)) return false;
            if (filterValue.to && date > new Date(filterValue.to)) return false;
            return true;

          default:
            return customerValue && String(customerValue).toLowerCase().includes(String(filterValue).toLowerCase());
        }
      });
    });
  }

  // Område filter
  if (showOnlyWarnings) {
    try {
      const response = await apiFetch('/api/kunder/kontroll-varsler?dager=30', {
        signal: filterAbortController.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: Kunne ikke laste varsler`);
      const varselResult = await response.json();
      const varselKunder = varselResult.data || varselResult;
      const varselIds = new Set(varselKunder.map(k => k.id));
      filtered = filtered.filter(c => varselIds.has(c.id));
    } catch (error) {
      if (error.name === 'AbortError') return; // Request avbrutt av nyere request
      console.error('Feil ved henting av varsler:', error);
      showNotification('Kunne ikke laste varsler. Prøv igjen senere.', 'error');
    }
  } else if (currentFilter !== 'alle') {
    filtered = filtered.filter(c => c.poststed === currentFilter);
  }

  // Search filter
  if (searchQuery) {
    filtered = filtered.filter(c =>
      c.navn.toLowerCase().includes(searchQuery) ||
      c.adresse.toLowerCase().includes(searchQuery) ||
      (c.poststed && c.poststed.toLowerCase().includes(searchQuery)) ||
      (c.postnummer && c.postnummer.includes(searchQuery))
    );
  }

  renderCustomerList(filtered);
  renderMarkers(filtered);
  updateCategoryFilterCounts();

  // Fremhev søketreff på kartet
  const activeSearch = searchInput?.value?.trim();
  if (activeSearch && filtered.length > 0 && filtered.length < 50) {
    highlightCustomersOnMap(filtered.map(c => c.id));
  } else {
    clearMapHighlights();
  }

  // Update search result counter
  const counterEl = document.getElementById('filterResultCount');
  if (counterEl) {
    if (filtered.length !== customers.length) {
      counterEl.textContent = `Viser ${filtered.length} av ${customers.length} kunder`;
      counterEl.style.display = 'block';
    } else {
      counterEl.style.display = 'none';
    }
  }
}

// Update category filter button counts (exact match - matches filter behavior)
function updateCategoryFilterCounts() {
  const serviceTypes = serviceTypeRegistry.getAll();

  // "Alle" button (left sidebar + right sidebar tab)
  const allBtn = document.querySelector('[data-category="all"]');
  if (allBtn) allBtn.innerHTML = `<i aria-hidden="true" class="fas fa-list"></i> Alle (${customers.length})`;
  const alleTab = document.querySelector('[data-kategori="alle"]');
  if (alleTab) alleTab.innerHTML = `Alle (${customers.length})`;

  // Update each service type button/tab dynamically
  serviceTypes.forEach(st => {
    // Count customers with exactly this category
    const count = customers.filter(c => c.kategori === st.name).length;
    const icon = serviceTypeRegistry.getIcon(st);

    // Left sidebar category buttons
    const btn = document.querySelector(`[data-category="${st.name}"]`);
    if (btn) btn.innerHTML = `${icon} ${escapeHtml(st.name)} (${count})`;

    // Right sidebar kategori tabs
    const tab = document.querySelector(`[data-kategori="${st.name}"]`);
    if (tab) tab.innerHTML = `${icon} ${escapeHtml(st.name)} (${count})`;
  });

  // Combined category (when org has 2+ service types)
  if (serviceTypes.length >= 2) {
    const combinedName = serviceTypes.map(st => st.name).join(' + ');
    // Count customers with the exact combined category
    const beggeCount = customers.filter(c => c.kategori === combinedName).length;
    const combinedIcons = serviceTypes.map(st => serviceTypeRegistry.getIcon(st)).join('');

    const combinedLabel = serviceTypes.length > 2 ? 'Alle' : 'Begge';
    const beggeBtn = document.querySelector(`[data-category="${combinedName}"]`);
    if (beggeBtn) beggeBtn.innerHTML = `${combinedIcons} ${combinedLabel} (${beggeCount})`;

    const beggeTab = document.querySelector(`[data-kategori="${combinedName}"]`);
    if (beggeTab) beggeTab.innerHTML = `${combinedIcons} ${combinedLabel} (${beggeCount})`;
  }

}

// Check if customer needs control soon - includes lifecycle stages when feature is enabled
function getControlStatus(customer) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Lifecycle-aware statuses (checked first, override date-based if active)
  if (hasFeature('lifecycle_colors')) {
    // Recently visited → dim/faded (low priority, already done)
    if (customer.last_visit_date) {
      const visitDate = new Date(customer.last_visit_date);
      const daysSinceVisit = Math.ceil((today - visitDate) / (1000 * 60 * 60 * 24));
      if (daysSinceVisit <= 14) {
        return { status: 'besøkt', label: `Besøkt ${daysSinceVisit}d siden`, class: 'status-visited', date: formatDateInline(visitDate), daysUntil: null };
      }
    }

    // Inquiry sent → purple pulsing (waiting for response)
    if (customer.inquiry_sent_date) {
      const inquiryDate = new Date(customer.inquiry_sent_date);
      const daysSinceInquiry = Math.ceil((today - inquiryDate) / (1000 * 60 * 60 * 24));
      if (daysSinceInquiry <= 30) {
        return { status: 'forespørsel', label: `Forespørsel sendt ${daysSinceInquiry}d siden`, class: 'status-inquiry', date: formatDateInline(inquiryDate), daysUntil: null };
      }
    }

    // Job confirmed → colored border based on type
    if (customer.job_confirmed_type) {
      const typeLabels = { a: 'Type A', b: 'Type B', begge: 'Begge' };
      const typeLabel = typeLabels[customer.job_confirmed_type] || customer.job_confirmed_type;
      const statusClass = customer.job_confirmed_type === 'begge' ? 'status-confirmed-both' :
        customer.job_confirmed_type === 'b' ? 'status-confirmed-b' : 'status-confirmed-a';
      return { status: 'bekreftet', label: `Bekreftet: ${typeLabel}`, class: statusClass, date: null, daysUntil: null };
    }
  }

  // Standard date-based control status
  const nextDate = getNextControlDate(customer);

  if (!nextDate) {
    return { status: 'ukjent', label: 'Ikke registrert', class: 'status-unknown', date: null, daysUntil: null };
  }

  const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
  const dateFormatted = formatDateInline(nextDate);

  // Forfalt = kun når kontrollens måned+år er i fortiden (ikke bare dato passert)
  const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
  const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

  if (controlMonthValue < currentMonthValue) {
    return { status: 'forfalt', label: `${Math.abs(daysUntil)} dager over`, class: 'status-overdue', date: dateFormatted, daysUntil };
  } else if (daysUntil < 0) {
    // Current month but date has passed — show as overdue within month
    return { status: 'forfaller', label: `${Math.abs(daysUntil)} dager over`, class: 'status-this-week', date: dateFormatted, daysUntil };
  } else if (daysUntil <= 7) {
    return { status: 'denne-uke', label: `${daysUntil} dager`, class: 'status-this-week', date: dateFormatted, daysUntil };
  } else if (daysUntil <= 30) {
    return { status: 'snart', label: `${daysUntil} dager`, class: 'status-soon', date: dateFormatted, daysUntil };
  } else if (daysUntil <= 60) {
    return { status: 'neste-mnd', label: `${daysUntil} dager`, class: 'status-next-month', date: dateFormatted, daysUntil };
  } else if (daysUntil <= 90) {
    return { status: 'ok', label: `${daysUntil} dager`, class: 'status-ok', date: dateFormatted, daysUntil };
  }
  return { status: 'god', label: formatDate(nextDate), class: 'status-good', date: dateFormatted, daysUntil };
}

// Render customer list in sidebar
function renderCustomerList(customerData) {
  // Group by area/poststed first
  const groupedByArea = {};
  customerData.forEach(customer => {
    const area = customer.poststed || 'Ukjent område';
    if (!groupedByArea[area]) {
      groupedByArea[area] = [];
    }
    groupedByArea[area].push(customer);
  });

  // Sort areas by postnummer (ascending), then alphabetically
  const sortedAreas = Object.keys(groupedByArea).sort((a, b) => {
    const customerA = groupedByArea[a][0];
    const customerB = groupedByArea[b][0];
    const postnummerA = customerA?.postnummer || '9999';
    const postnummerB = customerB?.postnummer || '9999';
    if (postnummerA !== postnummerB) {
      return postnummerA.localeCompare(postnummerB);
    }
    return a.localeCompare(b);
  });

  // Sort customers within each area alphabetically by name
  sortedAreas.forEach(area => {
    sortByNavn(groupedByArea[area]);
  });

  // Count urgent/warning customers per area
  const getAreaStats = (customers) => {
    let urgent = 0, warning = 0;
    customers.forEach(c => {
      const status = getControlStatus(c);
      if (status.class === 'overdue') urgent++;
      else if (status.class === 'warning') warning++;
    });
    return { urgent, warning };
  };

  // Empty state
  if (customerData.length === 0) {
    if (customerList) {
      const isFiltered = customers.length > 0;
      customerList.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--color-text-secondary,#a0a0a0);">
          <i aria-hidden="true" class="fas ${isFiltered ? 'fa-filter' : 'fa-users'}" style="font-size:32px;margin-bottom:12px;display:block;opacity:0.5;"></i>
          <p style="font-size:15px;margin:0 0 8px;">${isFiltered ? 'Ingen kunder matcher filteret' : 'Ingen kunder lagt til enn\u00e5'}</p>
          <p style="font-size:13px;margin:0;opacity:0.7;">${isFiltered ? 'Pr\u00f8v \u00e5 endre s\u00f8k eller filter' : 'Klikk + for \u00e5 legge til din f\u00f8rste kunde'}</p>
        </div>
      `;
    }
    return;
  }

  // Render list with area sections
  let html = '';
  sortedAreas.forEach((area) => {
    const areaCustomers = groupedByArea[area];
    const postnummer = areaCustomers[0]?.postnummer || '';
    const isExpanded = localStorage.getItem(`areaExpanded-${area}`) === 'true';
    const stats = getAreaStats(areaCustomers);

    // Build status badges
    let statusBadges = '';
    if (stats.urgent > 0) {
      statusBadges += `<span class="area-badge urgent">${stats.urgent}</span>`;
    }
    if (stats.warning > 0) {
      statusBadges += `<span class="area-badge warning">${stats.warning}</span>`;
    }

    html += `
      <div class="customer-section">
        <button class="section-header" data-area="${escapeHtml(area)}" data-action="toggleSection">
          <span class="section-toggle-icon">
            <i aria-hidden="true" class="fas fa-chevron-${isExpanded ? 'down' : 'right'}"></i>
          </span>
          <span class="section-title">
            <span class="section-postnr">${postnummer}</span>
            <span class="section-name">${escapeHtml(area)}</span>
          </span>
          <span class="section-meta">
            ${statusBadges}
            <span class="section-count">${areaCustomers.length}</span>
          </span>
        </button>
        <div class="section-content ${isExpanded ? '' : 'collapsed'}">
          ${areaCustomers.map(customer => {
            const controlStatus = getControlStatus(customer);
            const nextDate = customer.neste_kontroll
              ? formatDateInline(new Date(customer.neste_kontroll))
              : 'Ikke satt';
            const daysUntil = customer.neste_kontroll
              ? Math.ceil((new Date(customer.neste_kontroll) - new Date()) / (1000 * 60 * 60 * 24))
              : null;

            let daysText = '';
            if (daysUntil !== null) {
              if (daysUntil < 0) {
                daysText = `${Math.abs(daysUntil)}d over`;
              } else if (daysUntil === 0) {
                daysText = 'I dag';
              } else {
                daysText = `${daysUntil}d`;
              }
            }

            const hasEmail = customer.epost && customer.epost.trim() !== '';
            return `
              <div class="customer-item ${selectedCustomers.has(customer.id) ? 'selected' : ''} ${controlStatus.class}"
                   data-id="${customer.id}" data-action="selectCustomer" data-customer-id="${customer.id}">
                <div class="customer-status-indicator ${controlStatus.class}"></div>
                <div class="customer-info">
                  <h3>${escapeHtml(customer.navn)}</h3>
                  <p>${escapeHtml(customer.adresse)}</p>
                </div>
                <div class="customer-actions">
                  <button class="customer-email-btn ${hasEmail ? '' : 'disabled'}"
                          data-action="sendEmail"
                          data-customer-id="${customer.id}"
                          title="${hasEmail ? 'Send e-post' : 'Ingen e-post registrert'}">
                    <i aria-hidden="true" class="fas fa-envelope"></i>
                  </button>
                </div>
                <div class="customer-control-info">
                  <span class="control-date ${controlStatus.class}">${escapeHtml(nextDate)}</span>
                  ${daysText ? `<span class="control-days ${controlStatus.class}">${escapeHtml(daysText)}</span>` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });

  customerList.innerHTML = html;
  // Event listeners are handled via event delegation in setupEventListeners()
  // Using data-action attributes on elements for CSP compliance and memory efficiency
}


// ========================================
// CONTEXT MENU — Generisk system
// Brukes av kart, kundeliste, kalender, ukeplan
// ========================================

let activeContextMenu = null;
let activeContextMenuContext = null;
const contextMenuActions = new Map();
let _ctxCloseClickHandler = null;
let _ctxCloseContextHandler = null;

// ── Generisk motor ──────────────────────────────────────────

function registerContextMenuAction(name, handler) {
  contextMenuActions.set(name, handler);
}

/**
 * Vis en kontekstmeny ved gitte koordinater.
 * @param {Object} opts
 * @param {string} opts.header - Tittel (escapes automatisk)
 * @param {Array}  opts.items  - Menyvalg-definisjoner
 * @param {number} opts.x      - clientX
 * @param {number} opts.y      - clientY
 * @param {Object} [opts.context] - Vilkårlig data tilgjengelig for action-handlers
 */
function showContextMenu({ header, items, x, y, context }) {
  closeContextMenu();
  activeContextMenuContext = context || {};

  const menu = document.createElement('div');
  menu.className = 'marker-context-menu';
  menu.setAttribute('role', 'menu');

  let menuHtml = `<div class="context-menu-header">${escapeHtml(header)}</div>`;

  for (const item of items) {
    if (item.hidden) continue;

    if (item.type === 'divider') {
      menuHtml += '<div class="context-menu-divider"></div>';
      continue;
    }

    // Data-attributter
    const dataAttrs = [`data-action="${escapeHtml(item.action || '')}"`];
    if (item.data) {
      for (const [k, v] of Object.entries(item.data)) {
        if (v != null) dataAttrs.push(`data-${escapeHtml(k)}="${escapeHtml(String(v))}"`);
      }
    }

    const cssClass = `context-menu-item${item.className ? ' ' + item.className : ''}${item.disabled ? ' disabled' : ''}`;

    if (item.type === 'submenu' && item.children) {
      menuHtml += `
      <div class="${cssClass} context-menu-parent" role="menuitem" tabindex="-1">
        <span>${item.icon ? `<i class="${item.icon}"></i> ` : ''}${escapeHtml(item.label)}</span>
        <i aria-hidden="true" class="fas fa-chevron-right context-menu-arrow"></i>
        <div class="context-menu-submenu" role="menu">
          ${item.children.filter(c => !c.hidden).map(child => {
            const childDataAttrs = [`data-action="${escapeHtml(child.action || '')}"`];
            if (child.data) {
              for (const [k, v] of Object.entries(child.data)) {
                if (v != null) childDataAttrs.push(`data-${escapeHtml(k)}="${escapeHtml(String(v))}"`);
              }
            }
            return `<div class="context-menu-item" role="menuitem" tabindex="-1" ${childDataAttrs.join(' ')}>${child.icon ? `<i class="${child.icon}"></i> ` : ''}${escapeHtml(child.label)}</div>`;
          }).join('')}
        </div>
      </div>`;
    } else {
      menuHtml += `
      <div class="${cssClass}" role="menuitem" tabindex="-1" ${dataAttrs.join(' ')}>
        ${item.icon ? `<i class="${item.icon}"></i> ` : ''}${escapeHtml(item.label)}
      </div>`;
    }
  }

  menu.innerHTML = menuHtml;

  // Posisjonering innenfor viewport
  document.body.appendChild(menu);
  const menuRect = menu.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  if (x + menuRect.width > viewportW) x = viewportW - menuRect.width - 8;
  if (y + menuRect.height > viewportH) y = viewportH - menuRect.height - 8;
  if (x < 8) x = 8;
  if (y < 8) y = 8;

  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  activeContextMenu = menu;

  // Klikk-delegering
  menu.addEventListener('click', handleContextMenuClick);

  // Lukk ved klikk utenfor (utsatt for å unngå umiddelbar lukking)
  _ctxCloseClickHandler = () => closeContextMenu();
  _ctxCloseContextHandler = () => closeContextMenu();
  requestAnimationFrame(() => {
    document.addEventListener('click', _ctxCloseClickHandler, { once: true });
    document.addEventListener('contextmenu', _ctxCloseContextHandler, { once: true });
  });

  // Tastaturnavigasjon
  const keydownHandler = (e) => {
    if (!activeContextMenu) {
      document.removeEventListener('keydown', keydownHandler);
      return;
    }
    const menuItems = Array.from(activeContextMenu.querySelectorAll(':scope > [role="menuitem"]'));
    const currentIndex = menuItems.indexOf(document.activeElement);
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0;
        menuItems[nextIndex].focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1;
        menuItems[prevIndex].focus();
        break;
      }
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (document.activeElement && document.activeElement.closest('.marker-context-menu')) {
          document.activeElement.click();
        }
        break;
      case 'Escape':
        e.preventDefault();
        closeContextMenu();
        document.removeEventListener('keydown', keydownHandler);
        return;
    }
  };
  document.addEventListener('keydown', keydownHandler);

  // Fokuser første element
  const firstItem = menu.querySelector('[role="menuitem"]');
  if (firstItem) firstItem.focus();
}

function closeContextMenu() {
  if (_ctxCloseClickHandler) {
    document.removeEventListener('click', _ctxCloseClickHandler);
    _ctxCloseClickHandler = null;
  }
  if (_ctxCloseContextHandler) {
    document.removeEventListener('contextmenu', _ctxCloseContextHandler);
    _ctxCloseContextHandler = null;
  }
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
    activeContextMenuContext = null;
  }
}

function handleContextMenuClick(e) {
  const item = e.target.closest('[data-action]');
  if (!item || !item.dataset.action) return;

  const action = item.dataset.action;
  const ctx = activeContextMenuContext || {};

  console.log('[ContextMenu] click action:', action, 'ctx:', ctx);

  closeContextMenu();

  const handler = contextMenuActions.get(action);
  if (handler) {
    try {
      handler(item.dataset, ctx);
    } catch (err) {
      console.error('[ContextMenu] action error:', action, err);
    }
  } else {
    console.warn('[ContextMenu] no handler for action:', action);
  }
}

// ── Registrer felles actions ────────────────────────────────

registerContextMenuAction('ctx-details', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id) editCustomer(id);
});

registerContextMenuAction('ctx-navigate', (data) => {
  const lat = Number(data.lat);
  const lng = Number(data.lng);
  if (lat && lng) navigateToCustomer(lat, lng);
});

registerContextMenuAction('ctx-add-route', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id) toggleCustomerSelection(id);
});

registerContextMenuAction('ctx-mark-visited', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id) quickMarkVisited(id);
});

registerContextMenuAction('ctx-email', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (typeof openEmailDialog === 'function') {
    openEmailDialog(id);
  } else {
    editCustomer(id);
  }
});

registerContextMenuAction('ctx-focus-map', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id && typeof focusOnCustomer === 'function') {
    focusOnCustomer(id);
  } else {
    // Fallback: fly til koordinater
    const lat = Number(data.lat);
    const lng = Number(data.lng);
    if (lat && lng && typeof map !== 'undefined' && map) {
      map.flyTo({ center: [lng, lat], zoom: 16 });
    }
  }
});

registerContextMenuAction('ctx-add-weekplan', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id && typeof addToWeekPlanFromMap === 'function') addToWeekPlanFromMap(id);
});

registerContextMenuAction('ctx-new-avtale', (data, ctx) => {
  const id = ctx.customerId || Number(data.id);
  if (id && typeof openNewAvtaleForCustomer === 'function') openNewAvtaleForCustomer(id);
});

// Tripletex-spesifikke actions
registerContextMenuAction('ctx-create-project', (data) => {
  const id = Number(data.id);
  const projectType = data.type;
  if (id) createTripletexProjectFromMenu(id, projectType);
});

registerContextMenuAction('ctx-push-tripletex', (data) => {
  const id = Number(data.id);
  if (id) pushCustomerToTripletex(id);
});

// Avtale-actions (kalender + ukeplan)
registerContextMenuAction('ctx-edit-avtale', (data, ctx) => {
  console.log('[ctx-edit-avtale] ctx:', ctx, 'data:', data, 'openAvtaleModal:', typeof openAvtaleModal);
  if (ctx.avtale && typeof openAvtaleModal === 'function') {
    openAvtaleModal(ctx.avtale);
  } else {
    const avtaleId = ctx.avtaleId || Number(data.avtaleId);
    const avtale = typeof avtaler !== 'undefined' ? avtaler.find(a => a.id === avtaleId) : null;
    console.log('[ctx-edit-avtale] fallback, avtaleId:', avtaleId, 'avtale:', avtale);
    if (avtale && typeof openAvtaleModal === 'function') openAvtaleModal(avtale);
  }
});

registerContextMenuAction('ctx-toggle-complete-avtale', async (data, ctx) => {
  const avtaleId = ctx.avtaleId || Number(data.avtaleId);
  if (!avtaleId) return;
  try {
    const resp = await apiFetch(`/api/avtaler/${avtaleId}/complete`, { method: 'POST' });
    if (resp.ok) {
      showToast('Avtale oppdatert', 'success');
      if (typeof loadAvtaler === 'function') await loadAvtaler();
      if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof renderWeeklyPlan === 'function') renderWeeklyPlan();
    } else {
      showToast('Kunne ikke oppdatere avtale', 'error');
    }
  } catch (err) {
    showToast('Feil ved oppdatering: ' + err.message, 'error');
  }
});

registerContextMenuAction('ctx-delete-avtale', async (data, ctx) => {
  const avtaleId = ctx.avtaleId || Number(data.avtaleId);
  if (!avtaleId) return;
  try {
    const resp = await apiFetch(`/api/avtaler/${avtaleId}`, { method: 'DELETE' });
    if (resp.ok) {
      showToast('Avtale slettet', 'success');
      if (typeof loadAvtaler === 'function') await loadAvtaler();
      if (typeof refreshTeamFocus === 'function') refreshTeamFocus();
      if (typeof renderCalendar === 'function') renderCalendar();
      if (typeof renderWeeklyPlan === 'function') renderWeeklyPlan();
      if (typeof applyFilters === 'function') applyFilters();
    } else {
      const err = await resp.json().catch(() => ({}));
      showToast(err.error?.message || 'Kunne ikke slette avtale', 'error');
    }
  } catch (err) {
    showToast('Feil ved sletting: ' + err.message, 'error');
  }
});

registerContextMenuAction('ctx-remove-from-plan', (data) => {
  const dayKey = data.day;
  const customerId = Number(data.customerId);
  if (dayKey && customerId && typeof weekPlanState !== 'undefined') {
    weekPlanState.days[dayKey].planned = weekPlanState.days[dayKey].planned.filter(c => c.id !== customerId);
    if (typeof renderWeeklyPlan === 'function') renderWeeklyPlan();
    if (typeof updateWeekPlanBadges === 'function') updateWeekPlanBadges();
  }
});

// ── Kart-markør kontekstmeny (wrapper) ──────────────────────

function getMarkerContextMenuItems(customer) {
  const isSelected = selectedCustomers.has(customer.id);
  const hasEmail = customer.epost && customer.epost.trim() !== '';

  const items = [
    { type: 'item', label: 'Se detaljer', icon: 'fas fa-info-circle', action: 'ctx-details', data: { id: customer.id } },
    { type: 'item', label: 'Naviger hit', icon: 'fas fa-directions', action: 'ctx-navigate', data: { lat: customer.lat, lng: customer.lng } },
    { type: 'divider' },
    { type: 'item', label: isSelected ? 'Fjern fra rute' : 'Legg til i rute', icon: 'fas fa-route', action: 'ctx-add-route', data: { id: customer.id } },
    { type: 'item', label: 'Marker besøkt', icon: 'fas fa-check', action: 'ctx-mark-visited', data: { id: customer.id } },
    { type: 'divider', hidden: !hasEmail },
    { type: 'item', label: 'Send e-post', icon: 'fas fa-envelope', action: 'ctx-email', data: { id: customer.id }, hidden: !hasEmail },
  ];

  // Tripletex project creation (feature: tripletex_projects)
  if (typeof hasFeature === 'function' && hasFeature('tripletex_projects') && appConfig.integrations?.tripletex?.active !== false) {
    const categories = (typeof getFeatureConfig === 'function' ? getFeatureConfig('tripletex_projects')?.project_categories : null) || [
      { key: 'elkontroll', label: '01 - Elkontroll' },
      { key: 'arskontroll', label: '02 - Årskontroll' },
      { key: 'begge', label: '03 - Begge' }
    ];

    items.push({ type: 'divider' });
    items.push({
      type: 'submenu',
      label: 'Opprett prosjekt',
      icon: 'fas fa-folder-plus',
      children: categories.map(cat => ({
        type: 'item',
        label: cat.label,
        action: 'ctx-create-project',
        data: { id: customer.id, type: cat.key }
      }))
    });
  }

  // Push/sync customer to Tripletex (if connected)
  if (typeof appConfig !== 'undefined' && appConfig.integrations?.tripletex?.active !== false) {
    const isLinked = customer.external_source === 'tripletex' && customer.external_id;
    items.push({ type: 'divider' });
    items.push({
      type: 'item',
      label: isLinked ? 'Oppdater i Tripletex' : 'Opprett i Tripletex',
      icon: isLinked ? 'fas fa-sync' : 'fas fa-cloud-upload-alt',
      action: 'ctx-push-tripletex',
      data: { id: customer.id }
    });
  }

  return items;
}

function showMarkerContextMenu(customer, x, y) {
  showContextMenu({
    header: customer.navn,
    items: getMarkerContextMenuItems(customer),
    x, y,
    context: { customer, customerId: customer.id }
  });
}

// ── Kundeliste kontekstmeny ─────────────────────────────────

function showCustomerListContextMenu(customer, x, y) {
  const isSelected = selectedCustomers.has(customer.id);
  const hasEmail = customer.epost && customer.epost.trim() !== '';
  const hasCoords = customer.lat && customer.lng;

  showContextMenu({
    header: customer.navn,
    items: [
      { type: 'item', label: 'Se detaljer', icon: 'fas fa-info-circle', action: 'ctx-details' },
      { type: 'item', label: 'Vis på kart', icon: 'fas fa-map-marker-alt', action: 'ctx-focus-map', hidden: !hasCoords, data: { lat: customer.lat, lng: customer.lng } },
      { type: 'item', label: 'Naviger hit', icon: 'fas fa-directions', action: 'ctx-navigate', hidden: !hasCoords, data: { lat: customer.lat, lng: customer.lng } },
      { type: 'divider' },
      { type: 'item', label: isSelected ? 'Fjern fra rute' : 'Legg til i rute', icon: 'fas fa-route', action: 'ctx-add-route' },
      { type: 'item', label: 'Legg til i ukeplan', icon: 'fas fa-calendar-week', action: 'ctx-add-weekplan' },
      { type: 'item', label: 'Ny avtale', icon: 'fas fa-calendar-plus', action: 'ctx-new-avtale' },
      { type: 'item', label: 'Marker besøkt', icon: 'fas fa-check', action: 'ctx-mark-visited' },
      { type: 'divider', hidden: !hasEmail },
      { type: 'item', label: 'Send e-post', icon: 'fas fa-envelope', action: 'ctx-email', hidden: !hasEmail },
    ],
    x, y,
    context: { customer, customerId: customer.id }
  });
}

// ── Kalender kontekstmeny ───────────────────────────────────

function showCalendarContextMenu(avtale, x, y) {
  const kunde = typeof customers !== 'undefined' ? customers.find(c => c.id === avtale.kunde_id) : null;
  const hasCoords = kunde && kunde.lat && kunde.lng;
  const isCompleted = avtale.status === 'fullført';

  showContextMenu({
    header: kunde?.navn || avtale.kunde_navn || 'Avtale',
    items: [
      { type: 'item', label: 'Rediger avtale', icon: 'fas fa-edit', action: 'ctx-edit-avtale' },
      { type: 'item', label: isCompleted ? 'Marker uferdig' : 'Marker fullført', icon: 'fas fa-check-circle', action: 'ctx-toggle-complete-avtale' },
      { type: 'divider' },
      { type: 'item', label: 'Se kundedetaljer', icon: 'fas fa-user', action: 'ctx-details', hidden: !avtale.kunde_id },
      { type: 'item', label: 'Vis på kart', icon: 'fas fa-map-marker-alt', action: 'ctx-focus-map', hidden: !hasCoords, data: { lat: kunde?.lat, lng: kunde?.lng } },
      { type: 'item', label: 'Naviger hit', icon: 'fas fa-directions', action: 'ctx-navigate', hidden: !hasCoords, data: { lat: kunde?.lat, lng: kunde?.lng } },
      { type: 'divider' },
      { type: 'item', label: 'Slett avtale', icon: 'fas fa-trash', action: 'ctx-delete-avtale', className: 'danger' },
    ],
    x, y,
    context: { avtale, avtaleId: avtale.id, customerId: avtale.kunde_id }
  });
}

// ── Ukeplan kontekstmeny ────────────────────────────────────

function showWeekplanExistingContextMenu(avtale, x, y) {
  const kunde = typeof customers !== 'undefined' ? customers.find(c => c.id === avtale.kunde_id) : null;
  const hasCoords = kunde && kunde.lat && kunde.lng;

  showContextMenu({
    header: kunde?.navn || avtale.kunde_navn || 'Avtale',
    items: [
      { type: 'item', label: 'Rediger avtale', icon: 'fas fa-edit', action: 'ctx-edit-avtale' },
      { type: 'item', label: 'Marker fullført', icon: 'fas fa-check-circle', action: 'ctx-toggle-complete-avtale' },
      { type: 'divider' },
      { type: 'item', label: 'Se kundedetaljer', icon: 'fas fa-user', action: 'ctx-details', hidden: !avtale.kunde_id },
      { type: 'item', label: 'Vis på kart', icon: 'fas fa-map-marker-alt', action: 'ctx-focus-map', hidden: !hasCoords, data: { lat: kunde?.lat, lng: kunde?.lng } },
      { type: 'item', label: 'Naviger hit', icon: 'fas fa-directions', action: 'ctx-navigate', hidden: !hasCoords, data: { lat: kunde?.lat, lng: kunde?.lng } },
      { type: 'divider' },
      { type: 'item', label: 'Slett avtale', icon: 'fas fa-trash', action: 'ctx-delete-avtale', className: 'danger' },
    ],
    x, y,
    context: { avtale, avtaleId: avtale.id, customerId: avtale.kunde_id }
  });
}

function showWeekplanPlannedContextMenu(customer, dayKey, x, y) {
  const hasCoords = customer.lat && customer.lng;

  showContextMenu({
    header: customer.navn,
    items: [
      { type: 'item', label: 'Se kundedetaljer', icon: 'fas fa-user', action: 'ctx-details' },
      { type: 'item', label: 'Vis på kart', icon: 'fas fa-map-marker-alt', action: 'ctx-focus-map', hidden: !hasCoords, data: { lat: customer.lat, lng: customer.lng } },
      { type: 'item', label: 'Naviger hit', icon: 'fas fa-directions', action: 'ctx-navigate', hidden: !hasCoords, data: { lat: customer.lat, lng: customer.lng } },
      { type: 'divider' },
      { type: 'item', label: 'Fjern fra plan', icon: 'fas fa-times', action: 'ctx-remove-from-plan', className: 'danger', data: { day: dayKey, customerId: customer.id } },
    ],
    x, y,
    context: { customer, customerId: customer.id }
  });
}

// ── Tripletex-hjelpefunksjoner (uendret) ────────────────────

async function createTripletexProjectFromMenu(kundeId, projectType) {
  try {
    showNotification('Oppretter prosjekt i Tripletex...', 'info');

    const featureConfig = typeof getFeatureConfig === 'function' ? getFeatureConfig('tripletex_projects') : null;
    const categories = featureConfig?.project_categories || [];
    const matchedCategory = categories.find(c => c.key === projectType);

    const response = await apiFetch('/api/integrations/tripletex/create-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kunde_id: kundeId,
        category_id: matchedCategory?.tripletex_category_id || null,
        description: matchedCategory?.label || projectType,
      }),
    });

    const data = await response.json();

    if (data.success) {
      showNotification(`Prosjekt ${data.data.projectNumber} opprettet i Tripletex`, 'success');
      const customer = customers.find(c => c.id === kundeId);
      if (customer) {
        const existing = customer.prosjektnummer ? customer.prosjektnummer.split(', ') : [];
        existing.push(data.data.projectNumber);
        customer.prosjektnummer = existing.join(', ');
      }
    } else {
      showNotification(data.error || 'Kunne ikke opprette prosjekt', 'error');
    }
  } catch (error) {
    console.error('Tripletex project creation failed:', error);
    showNotification('Feil ved opprettelse av prosjekt i Tripletex', 'error');
  }
}

async function pushCustomerToTripletex(kundeId) {
  try {
    const customer = customers.find(c => c.id === kundeId);
    const isUpdate = customer?.external_source === 'tripletex' && customer?.external_id;
    showNotification(isUpdate ? 'Oppdaterer kunde i Tripletex...' : 'Oppretter kunde i Tripletex...', 'info');

    const response = await apiFetch('/api/integrations/tripletex/push-customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kunde_id: kundeId }),
    });

    const data = await response.json();

    if (data.success) {
      showNotification(data.message, 'success');
      if (customer && data.data.action === 'created') {
        customer.external_source = 'tripletex';
        customer.external_id = String(data.data.tripletexId);
        if (data.data.customerNumber) {
          customer.kundenummer = String(data.data.customerNumber);
        }
      }
    } else {
      showNotification(data.error || 'Kunne ikke sende kunde til Tripletex', 'error');
    }
  } catch (error) {
    console.error('Tripletex customer push failed:', error);
    showNotification('Feil ved sending av kunde til Tripletex', 'error');
  }
}

// ========================================
// HOVER TOOLTIP (Feature: hover_tooltip)
// Lightweight info on marker hover
// ========================================

let activeTooltipEl = null;

function showMarkerTooltip(customer, markerIconEl, mouseEvent) {
  hideMarkerTooltip();

  const controlStatus = getControlStatus(customer);

  // Get service type summary
  let serviceInfo = 'Ikke spesifisert';
  if (customer.services && customer.services.length > 0) {
    serviceInfo = customer.services.map(s => s.service_type_name).filter(Boolean).join(', ');
  } else if (customer.kategori) {
    serviceInfo = customer.kategori;
  }

  const isSelected = selectedCustomers.has(customer.id);

  const tooltip = document.createElement('div');
  tooltip.className = 'marker-hover-tooltip';
  tooltip.innerHTML = `
    <div class="tooltip-header">${escapeHtml(customer.navn)}</div>
    <div class="tooltip-body">
      <div class="tooltip-row"><i aria-hidden="true" class="fas fa-map-marker-alt"></i> ${escapeHtml(customer.adresse || '')}${customer.postnummer ? `, ${escapeHtml(customer.postnummer)}` : ''} ${escapeHtml(customer.poststed || '')}</div>
      ${customer.telefon ? `<div class="tooltip-row"><i aria-hidden="true" class="fas fa-phone"></i> ${escapeHtml(customer.telefon)}</div>` : ''}
      <div class="tooltip-service"><i aria-hidden="true" class="fas fa-tools"></i> ${escapeHtml(serviceInfo)}</div>
      <div class="tooltip-status ${controlStatus.class}">${escapeHtml(controlStatus.label)}</div>
    </div>
    <div class="tooltip-actions">
      <button class="tooltip-action-btn" data-action="select" title="${isSelected ? 'Fjern fra utvalg' : 'Velg kunde'}">
        <i aria-hidden="true" class="fas ${isSelected ? 'fa-check-square' : 'fa-square'}"></i>
      </button>
      <button class="tooltip-action-btn" data-action="weekplan" title="Legg til ukeplan">
        <i aria-hidden="true" class="fas fa-calendar-week"></i>
      </button>
      <button class="tooltip-action-btn" data-action="calendar" title="Ny avtale">
        <i aria-hidden="true" class="fas fa-calendar-plus"></i>
      </button>
    </div>
  `;

  // Prevent tooltip from disappearing when hovering over it
  tooltip.addEventListener('mouseenter', () => { tooltip._hovered = true; });
  tooltip.addEventListener('mouseleave', () => {
    tooltip._hovered = false;
    hideMarkerTooltip();
  });

  // Quick action buttons
  tooltip.addEventListener('click', (e) => {
    const btn = e.target.closest('.tooltip-action-btn');
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;
    if (action === 'select') {
      toggleCustomerSelection(customer.id);
      hideMarkerTooltip();
    } else if (action === 'weekplan') {
      hideMarkerTooltip();
      if (typeof addToWeekPlanFromMap === 'function') addToWeekPlanFromMap(customer.id);
    } else if (action === 'calendar') {
      hideMarkerTooltip();
      if (typeof openNewAvtaleForCustomer === 'function') openNewAvtaleForCustomer(customer.id);
    }
  });

  document.body.appendChild(tooltip);

  // Position: use mouse coordinates if available, fall back to marker icon position
  const tooltipRect = tooltip.getBoundingClientRect();
  let left, top;

  if (mouseEvent) {
    left = mouseEvent.clientX + 12;
    top = mouseEvent.clientY - 10;
  } else if (markerIconEl) {
    const rect = markerIconEl.getBoundingClientRect();
    left = rect.left + rect.width / 2 + 12;
    top = rect.top - 4;
  } else {
    left = 100;
    top = 100;
  }

  // Keep within viewport
  if (left + tooltipRect.width > window.innerWidth) {
    left = (mouseEvent ? mouseEvent.clientX : left) - tooltipRect.width - 12;
  }
  if (top + tooltipRect.height > window.innerHeight) {
    top = window.innerHeight - tooltipRect.height - 8;
  }
  if (left < 4) left = 4;
  if (top < 4) top = 4;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;

  activeTooltipEl = tooltip;
}

function hideMarkerTooltip() {
  if (activeTooltipEl) {
    activeTooltipEl.remove();
    activeTooltipEl = null;
  }
}


// ========================================

// === AREA SELECT (dra-for-å-velge kunder på kartet) ===
let areaSelectMode = false;
let areaSelectStart = null;

function initAreaSelect() {
  if (!map) return;

  // Legg til flytende knapp over kartet (inne i map-toolbar-center)
  const mapContainer = document.getElementById('sharedMapContainer');
  if (!mapContainer) return;
  const existingBtn = document.getElementById('areaSelectToggle');
  if (existingBtn) existingBtn.remove();

  // Opprett eller finn delt toolbar-container
  let toolbar = document.getElementById('mapToolbarCenter');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.id = 'mapToolbarCenter';
    toolbar.className = 'map-toolbar-center';
    mapContainer.appendChild(toolbar);
  }

  const btn = document.createElement('button');
  btn.id = 'areaSelectToggle';
  btn.className = 'area-select-toggle-btn';
  btn.title = 'Velg område';
  btn.innerHTML = '<i aria-hidden="true" class="fas fa-expand"></i>';
  btn.addEventListener('click', () => toggleAreaSelect());
  toolbar.appendChild(btn);

  // Mouse events for area selection
  map.on('mousedown', onAreaSelectStart);
  map.on('mousemove', onAreaSelectMove);
  map.on('mouseup', onAreaSelectEnd);
}

function toggleAreaSelect() {
  areaSelectMode = !areaSelectMode;
  const btn = document.getElementById('areaSelectToggle');
  const mapEl = document.getElementById('map');

  if (areaSelectMode) {
    btn?.classList.add('active');
    mapEl.style.cursor = 'crosshair';
    map.dragPan.disable();
    showToast('Dra over kunder for å velge dem', 'info');
  } else {
    btn?.classList.remove('active');
    mapEl.style.cursor = '';
    map.dragPan.enable();
    // Remove selection rectangle layers
    removeLayerAndSource('area-select-fill');
    removeLayerAndSource('area-select-line');
    removeLayerAndSource('area-select-rect');
  }
}

function onAreaSelectStart(e) {
  if (!areaSelectMode) return;
  areaSelectStart = e.lngLat;

  // Remove existing rectangle
  removeLayerAndSource('area-select-fill');
  removeLayerAndSource('area-select-line');
  removeLayerAndSource('area-select-rect');

  // Create rectangle source
  const geojson = rectangleGeoJSON(areaSelectStart, areaSelectStart);
  map.addSource('area-select-rect', { type: 'geojson', data: geojson });
  map.addLayer({
    id: 'area-select-fill',
    type: 'fill',
    source: 'area-select-rect',
    paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.15 }
  });
  map.addLayer({
    id: 'area-select-line',
    type: 'line',
    source: 'area-select-rect',
    paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [3, 2] }
  });
}

function onAreaSelectMove(e) {
  if (!areaSelectMode || !areaSelectStart) return;
  const source = map.getSource('area-select-rect');
  if (source) {
    source.setData(rectangleGeoJSON(areaSelectStart, e.lngLat));
  }
}

function onAreaSelectEnd(e) {
  if (!areaSelectMode || !areaSelectStart) return;

  const end = e.lngLat;
  const start = areaSelectStart;
  areaSelectStart = null;

  // Bounding box check
  const minLng = Math.min(start.lng, end.lng);
  const maxLng = Math.max(start.lng, end.lng);
  const minLat = Math.min(start.lat, end.lat);
  const maxLat = Math.max(start.lat, end.lat);

  // Finn kunder innenfor rektangelet
  const selected = customers.filter(c =>
    c.lat && c.lng &&
    c.lng >= minLng && c.lng <= maxLng &&
    c.lat >= minLat && c.lat <= maxLat
  );

  if (selected.length === 0) {
    removeLayerAndSource('area-select-fill');
    removeLayerAndSource('area-select-line');
    removeLayerAndSource('area-select-rect');
    showToast('Ingen kunder i valgt område', 'info');
    return;
  }

  // Vis handlingsmeny
  const center = {
    lng: (minLng + maxLng) / 2,
    lat: (minLat + maxLat) / 2
  };
  showAreaSelectMenu(selected, center);
}

function showAreaSelectMenu(selectedCustomersList, center) {
  // Fjern eksisterende meny
  document.getElementById('areaSelectMenu')?.remove();

  // Initialize weekplan if not yet
  if (!weekPlanState.weekStart) {
    initWeekPlanState(new Date());
  }
  const wpDayActive = weekPlanState.activeDay;
  const wpDayLabel = wpDayActive ? weekDayLabels[weekDayKeys.indexOf(wpDayActive)] : '';
  const showWpButton = true;

  // Build weekplan day picker if no active day
  let wpDayPickerHtml = '';
  if (showWpButton && !wpDayActive) {
    wpDayPickerHtml = `
      <div class="asm-day-picker" id="asmDayPicker" style="display:none;">
        ${weekDayKeys.map((key, i) => {
          const dayData = weekPlanState.days[key];
          if (!dayData) return '';
          const d = new Date(dayData.date);
          const label = weekDayLabels[i];
          const dateNum = d.getDate();
          return `<button class="asm-day-option" data-wp-day="${key}">${label} ${dateNum}.</button>`;
        }).join('')}
      </div>`;
  }

  // Collect area names for context
  const areas = [...new Set(selectedCustomersList.map(c => c.poststed).filter(Boolean))];
  const areaText = areas.length > 0 ? areas.slice(0, 2).join(', ') : '';

  const menu = document.createElement('div');
  menu.id = 'areaSelectMenu';
  menu.className = 'area-select-menu';
  menu.innerHTML = `
    <div class="area-select-menu-header">
      <div class="asm-title">
        <strong>${selectedCustomersList.length} kunder valgt</strong>
        ${areaText ? `<span class="asm-area">${escapeHtml(areaText)}</span>` : ''}
      </div>
      <button class="area-select-close" id="closeAreaMenu">&times;</button>
    </div>
    <div class="area-select-menu-actions">
      ${showWpButton ? `
        <button class="btn btn-small asm-btn asm-btn-weekplan" id="areaAddToWeekPlan">
          <i aria-hidden="true" class="fas fa-clipboard-list"></i> ${wpDayActive ? `Legg til ${escapeHtml(wpDayLabel)}` : 'Legg til ukeplan'}
        </button>
        ${wpDayPickerHtml}
      ` : ''}
      ${splitViewOpen && splitViewState.activeDay ? `
        <button class="btn btn-small asm-btn asm-btn-calendar" id="areaAddToSplitDay" style="background:var(--color-primary);color:#fff;">
          <i aria-hidden="true" class="fas fa-calendar-plus"></i> Legg til ${new Date(splitViewState.activeDay + 'T00:00:00').toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })}
        </button>
      ` : ''}
      <button class="btn btn-small asm-btn asm-btn-route" id="areaAddToRoute">
        <i aria-hidden="true" class="fas fa-route"></i> Legg til rute
      </button>
      <button class="btn btn-small asm-btn asm-btn-calendar" id="areaAddToCalendar">
        <i aria-hidden="true" class="fas fa-calendar-plus"></i> Legg i kalender
      </button>
      <button class="btn btn-small asm-btn asm-btn-check" id="areaMarkVisited">
        <i aria-hidden="true" class="fas fa-check-circle"></i> Marker besøkt
      </button>
    </div>
  `;

  document.body.appendChild(menu);

  // Legg til ukeplan
  const wpBtn = document.getElementById('areaAddToWeekPlan');
  if (wpBtn) {
    wpBtn.addEventListener('click', () => {
      if (wpDayActive) {
        addCustomersToWeekPlan(selectedCustomersList);
        closeAreaSelectMenu();
        renderWeeklyPlan();
      } else {
        const picker = document.getElementById('asmDayPicker');
        if (picker) picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
      }
    });

    const dayPicker = document.getElementById('asmDayPicker');
    if (dayPicker) {
      dayPicker.querySelectorAll('.asm-day-option').forEach(btn => {
        btn.addEventListener('click', () => {
          weekPlanState.activeDay = btn.dataset.wpDay;
          addCustomersToWeekPlan(selectedCustomersList);
          closeAreaSelectMenu();
          renderWeeklyPlan();
        });
      });
    }
  }

  // Split-view day button
  const splitDayBtn = document.getElementById('areaAddToSplitDay');
  if (splitDayBtn) {
    splitDayBtn.addEventListener('click', () => {
      const dato = splitViewState.activeDay;
      const datoLabel = new Date(dato + 'T00:00:00').toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' });
      const actionsDiv = menu.querySelector('.area-select-menu-actions');
      actionsDiv.innerHTML = `
        <div class="asm-duration-step" style="grid-column:1/-1;">
          <div style="font-size:12px;font-weight:600;margin-bottom:6px;">Tidsbruk per kunde — ${escapeHtml(datoLabel)}</div>
          <div class="asm-duration-list" style="max-height:240px;overflow-y:auto;">
            ${selectedCustomersList.map((c, i) => {
              const defaultMin = c.estimert_tid || 30;
              return `
                <div class="asm-duration-row" style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--color-border);">
                  <span style="flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(c.adresse || '')}">${escapeHtml(c.navn)}</span>
                  <input type="number" class="asm-duration-input" data-index="${i}" value="${defaultMin}" min="5" max="480" step="5"
                    style="width:60px;padding:3px 4px;border-radius:4px;border:1px solid var(--color-border);text-align:center;font-size:12px;background:var(--bg-primary);color:var(--color-text-primary);">
                  <span style="font-size:11px;color:var(--color-text-secondary);">min</span>
                </div>`;
            }).join('')}
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button class="btn btn-small btn-secondary" id="asmDurationBack" style="flex:1;">
              <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
            </button>
            <button class="btn btn-small btn-primary" id="asmDurationConfirm" style="flex:2;">
              <i aria-hidden="true" class="fas fa-calendar-plus"></i> Opprett ${selectedCustomersList.length} avtaler
            </button>
          </div>
        </div>
      `;

      document.getElementById('asmDurationBack').addEventListener('click', () => {
        showAreaSelectMenu(selectedCustomersList, center);
      });

      document.getElementById('asmDurationConfirm').addEventListener('click', async () => {
        const confirmBtn = document.getElementById('asmDurationConfirm');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Oppretter...';
        const inputs = actionsDiv.querySelectorAll('.asm-duration-input');
        let created = 0;
        for (let i = 0; i < selectedCustomersList.length; i++) {
          const c = selectedCustomersList[i];
          const varighet = inputs[i] ? Number.parseInt(inputs[i].value) || 30 : 30;
          try {
            const avtaleType = c.kategori || 'Kontroll';
            const response = await apiFetch('/api/avtaler', {
              method: 'POST',
              body: JSON.stringify({
                kunde_id: c.id, dato, type: avtaleType,
                beskrivelse: avtaleType, varighet,
                opprettet_av: localStorage.getItem('userName') || 'admin'
              })
            });
            if (response.ok) created++;
          } catch (err) {
            console.error('Error creating avtale from area select:', err);
          }
        }
        if (created > 0) {
          showToast(`${created} avtale${created !== 1 ? 'r' : ''} opprettet for ${datoLabel}`, 'success');
        }
        closeAreaSelectMenu();
        await loadAvtaler();
        renderCalendar();
        if (splitViewOpen) renderSplitWeekContent();
      });
    });
  }

  // Legg til rute
  document.getElementById('areaAddToRoute').addEventListener('click', () => {
    selectedCustomersList.forEach(c => selectedCustomers.add(c.id));
    updateSelectionUI();
    closeAreaSelectMenu();
    showToast(`${selectedCustomersList.length} kunder lagt til rute`, 'success');
  });

  // Legg i kalender
  document.getElementById('areaAddToCalendar').addEventListener('click', () => {
    const actionsDiv = menu.querySelector('.area-select-menu-actions');
    actionsDiv.innerHTML = `
      <div style="padding:4px 0;">
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Dato</label>
        <input type="date" id="areaCalDate" value="${new Date().toISOString().split('T')[0]}"
          style="width:100%;padding:6px;border-radius:4px;border:1px solid #ccc;box-sizing:border-box;">
      </div>
      <div style="padding:4px 0;">
        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Type</label>
        <select id="areaCalType" style="width:100%;padding:6px;border-radius:4px;border:1px solid #ccc;box-sizing:border-box;">
          ${serviceTypeRegistry ? serviceTypeRegistry.renderCategoryOptions('Kontroll') : '<option>Kontroll</option>'}
        </select>
      </div>
      <div style="display:flex;gap:8px;padding-top:4px;">
        <button class="btn btn-small btn-secondary" id="areaCalBack" style="flex:1;">
          <i aria-hidden="true" class="fas fa-arrow-left"></i> Tilbake
        </button>
        <button class="btn btn-small btn-primary" id="areaCalConfirm" style="flex:2;">
          Opprett ${selectedCustomersList.length} avtaler
        </button>
      </div>
    `;

    document.getElementById('areaCalBack').addEventListener('click', () => {
      showAreaSelectMenu(selectedCustomersList, center);
    });

    document.getElementById('areaCalConfirm').addEventListener('click', async () => {
      const dato = document.getElementById('areaCalDate').value;
      const type = document.getElementById('areaCalType').value || 'Kontroll';
      if (!dato) { showToast('Velg en dato', 'error'); return; }
      const confirmBtn = document.getElementById('areaCalConfirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Oppretter...';
      let created = 0;
      let lastError = '';
      for (const c of selectedCustomersList) {
        try {
          const avtaleType = c.kategori || type || undefined;
          const response = await apiFetch('/api/avtaler', {
            method: 'POST',
            body: JSON.stringify({
              kunde_id: c.id, dato, type: avtaleType,
              beskrivelse: avtaleType || 'Kontroll',
              opprettet_av: localStorage.getItem('userName') || 'admin'
            })
          });
          if (response.ok) { created++; }
          else {
            const errData = await response.json().catch(() => ({}));
            lastError = errData.error?.message || errData.error || response.statusText;
          }
        } catch (err) {
          lastError = err.message;
        }
      }
      if (created > 0) showToast(`${created} avtaler opprettet for ${dato}`, 'success');
      else showToast(`Kunne ikke opprette avtaler: ${lastError}`, 'error');
      closeAreaSelectMenu();
      await loadAvtaler();
      renderCalendar();
    });
  });

  // Marker besøkt (bulk)
  document.getElementById('areaMarkVisited').addEventListener('click', () => {
    const ids = selectedCustomersList.map(c => c.id);
    closeAreaSelectMenu();
    bulkMarkVisited(ids);
  });

  // Lukk
  document.getElementById('closeAreaMenu').addEventListener('click', closeAreaSelectMenu);
}

function closeAreaSelectMenu() {
  document.getElementById('areaSelectMenu')?.remove();
  removeLayerAndSource('area-select-fill');
  removeLayerAndSource('area-select-line');
  removeLayerAndSource('area-select-rect');
  if (areaSelectMode) toggleAreaSelect();
}


// Render subcategory dropdowns (standalone, not tied to service types)
function renderSubcategoryDropdowns(customer = null) {
  const section = document.getElementById('subcategorySection');
  const container = document.getElementById('subcategoryDropdowns');
  if (!section || !container) return;

  const groups = allSubcategoryGroups || [];
  if (groups.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Get existing assignments for this customer
  const kundeId = customer?.id;
  const assignments = kundeId ? (kundeSubcatMap[kundeId] || []) : [];

  let html = '';
  groups.forEach(group => {
    if (!group.subcategories || group.subcategories.length === 0) return;

    const currentAssignment = assignments.find(a => a.group_id === group.id);
    const selectedSubId = currentAssignment?.subcategory_id || '';

    html += `
      <div class="form-group">
        <label for="subcat_group_${group.id}">${escapeHtml(group.navn)}</label>
        <select id="subcat_group_${group.id}" data-group-id="${group.id}" class="subcat-dropdown">
          <option value="">Ikke valgt</option>
          ${group.subcategories.map(sub =>
            `<option value="${sub.id}" ${sub.id === selectedSubId ? 'selected' : ''}>${escapeHtml(sub.navn)}</option>`
          ).join('')}
        </select>
      </div>
    `;
  });

  container.innerHTML = html;
}

// Collect subcategory assignments from dropdowns
function collectSubcategoryAssignments() {
  const assignments = [];
  document.querySelectorAll('.subcat-dropdown').forEach(select => {
    const groupId = parseInt(select.dataset.groupId, 10);
    const subcatId = parseInt(select.value, 10);
    if (groupId && subcatId) {
      assignments.push({ group_id: groupId, subcategory_id: subcatId });
    }
  });
  return assignments;
}

// Populate dynamic dropdowns from ServiceTypeRegistry
function populateDynamicDropdowns(customer = null) {
  // Kategori checkboxes (multi-select)
  const kategoriContainer = document.getElementById('kategoriCheckboxes');
  if (kategoriContainer) {
    kategoriContainer.innerHTML = serviceTypeRegistry.renderCategoryCheckboxes(customer?.kategori || '');
    // Attach change handlers for control section visibility
    kategoriContainer.querySelectorAll('input[name="kategori"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const selected = serviceTypeRegistry.getSelectedCategories();
        updateControlSectionsVisibility(selected);
        renderSubcategoryDropdowns(customer);
      });
    });
  }

  // Render subcategory dropdowns for selected service type
  renderSubcategoryDropdowns(customer);

  // Intervaller (populeres alltid, også i MVP-modus)
  const elIntervallSelect = document.getElementById('el_kontroll_intervall');
  if (elIntervallSelect) {
    elIntervallSelect.innerHTML = serviceTypeRegistry.renderIntervalOptions(customer?.el_kontroll_intervall || 36);
  }

  const brannIntervallSelect = document.getElementById('brann_kontroll_intervall');
  if (brannIntervallSelect) {
    brannIntervallSelect.innerHTML = serviceTypeRegistry.renderIntervalOptions(customer?.brann_kontroll_intervall || 12);
  }

}

// Edit customer
function editCustomer(id) {
  const customer = customers.find(c => c.id === id);
  if (!customer) return;

  // Sett referanse til kunden som redigeres (brukes av renderDynamicServiceSections)
  _editingCustomer = customer;

  // Claim this customer (presence system)
  claimCustomer(id);

  // Reset address autocomplete state from previous session
  resetAddressAutocomplete();

  // Populate dynamic dropdowns first
  populateDynamicDropdowns(customer);

  document.getElementById('modalTitle').textContent = 'Rediger kunde';

  // Show presence warning if another user is working on this customer
  const existingBanner = document.getElementById('presenceWarningBanner');
  if (existingBanner) existingBanner.remove();
  const claim = presenceClaims.get(id);
  if (claim && claim.userId !== myUserId) {
    const banner = document.createElement('div');
    banner.id = 'presenceWarningBanner';
    banner.style.cssText = `background:${getPresenceColor(claim.userId)}18;border-left:3px solid ${getPresenceColor(claim.userId)};padding:8px 12px;margin-bottom:12px;border-radius:4px;font-size:13px;color:#333;`;
    banner.innerHTML = `<strong>${escapeHtml(claim.initials)}</strong> ${escapeHtml(claim.userName)} jobber med denne kunden`;
    const modalTitle = document.getElementById('modalTitle');
    modalTitle.parentNode.insertBefore(banner, modalTitle.nextSibling);
  }

  document.getElementById('customerId').value = customer.id;
  document.getElementById('navn').value = customer.navn || '';
  document.getElementById('adresse').value = customer.adresse || '';
  document.getElementById('postnummer').value = customer.postnummer || '';
  document.getElementById('poststed').value = customer.poststed || '';
  // Fyll org_nummer fra dedikert felt, eller fallback til [ORGNR:] tag i notater
  const orgNrValue = customer.org_nummer || (customer.notater && customer.notater.match(/\[ORGNR:(\d{9})\]/)?.[1]) || '';
  document.getElementById('org_nummer').value = orgNrValue;
  // Set estimated time (hours + minutes inputs)
  if (window.setEstimertTidFromMinutes) {
    window.setEstimertTidFromMinutes(customer.estimert_tid || 0);
  } else {
    document.getElementById('estimert_tid').value = customer.estimert_tid || '';
  }
  document.getElementById('telefon').value = customer.telefon || '';
  document.getElementById('epost').value = customer.epost || '';
  const trimDate = (v) => appConfig.datoModus === 'month_year' && v && v.length >= 7 ? v.substring(0, 7) : (v || '');
  document.getElementById('siste_kontroll').value = trimDate(customer.siste_kontroll);
  document.getElementById('neste_kontroll').value = trimDate(customer.neste_kontroll);
  document.getElementById('kontroll_intervall').value = customer.kontroll_intervall_mnd || 12;
  document.getElementById('notater').value = (customer.notater || '').replace(/\[ORGNR:\d{9}\]\s*/g, '').replace(/^\s*\|\s*/, '').trim();
  document.getElementById('lat').value = customer.lat ? Number(customer.lat).toFixed(6) : '';
  document.getElementById('lng').value = customer.lng ? Number(customer.lng).toFixed(6) : '';

  // Update geocode quality badge
  updateGeocodeQualityBadge(customer.geocode_quality || (customer.lat ? 'exact' : null));

  // Separate kontroll-felt for El-Kontroll
  document.getElementById('siste_el_kontroll').value = trimDate(customer.siste_el_kontroll);
  document.getElementById('neste_el_kontroll').value = trimDate(customer.neste_el_kontroll);

  // Separate kontroll-felt for Brannvarsling
  document.getElementById('siste_brann_kontroll').value = trimDate(customer.siste_brann_kontroll);
  document.getElementById('neste_brann_kontroll').value = trimDate(customer.neste_brann_kontroll);

  // Vis/skjul kontroll-seksjoner basert på kategori
  updateControlSectionsVisibility(customer.kategori);

  // Load email settings for this customer
  loadCustomerEmailSettings(customer.id);

  // Populate custom organization fields
  populateCustomFields(customer.custom_data);

  // Show kontaktlogg section and load data
  document.getElementById('kontaktloggSection').style.display = 'block';
  loadKontaktlogg(customer.id);

  // Load subcategories for this customer
  loadKundeSubcategories(customer.id);

  // Load kontaktpersoner for this customer
  loadKontaktpersoner(customer.id);

  document.getElementById('deleteCustomerBtn').classList.remove('hidden');
  openModal(customerModal);

  // Highlight missing fields
  highlightMissingFields(customer);

  // Show integration buttons if relevant
  const integrationSection = document.getElementById('integrationActionsSection');
  const tripletexBtn = document.getElementById('pushToTripletexBtn');
  const ekkBtn = document.getElementById('createEkkReportBtn');
  let showIntegrationSection = false;

  if (tripletexBtn && appConfig.integrations?.tripletex?.active !== false) {
    const isLinked = customer.external_source === 'tripletex' && customer.external_id;
    document.getElementById('tripletexBtnLabel').textContent = isLinked ? 'Oppdater i Tripletex' : 'Opprett i Tripletex';
    tripletexBtn.classList.remove('hidden');
    showIntegrationSection = true;
  } else if (tripletexBtn) {
    tripletexBtn.classList.add('hidden');
  }

  if (ekkBtn && hasFeature('ekk_integration')) {
    ekkBtn.classList.remove('hidden');
    showIntegrationSection = true;
  } else if (ekkBtn) {
    ekkBtn.classList.add('hidden');
  }

  if (integrationSection) {
    integrationSection.classList.toggle('hidden', !showIntegrationSection);
  }
}

// Highlight fields that are missing data
function highlightMissingFields(customer) {
  // Remove previous highlights and aria-invalid
  document.querySelectorAll('.missing-field').forEach(el => {
    el.classList.remove('missing-field');
    el.removeAttribute('aria-invalid');
  });

  // Check and highlight missing fields
  const fieldsToCheck = [
    { id: 'telefon', value: customer.telefon },
    { id: 'epost', value: customer.epost },
    { id: 'neste_el_kontroll', value: customer.neste_el_kontroll, condition: customer.kategori?.includes('El-Kontroll') },
    { id: 'neste_brann_kontroll', value: customer.neste_brann_kontroll, condition: customer.kategori?.includes('Brann') }
  ];

  fieldsToCheck.forEach(field => {
    // Skip if condition is defined and false
    if (field.condition === false) return;

    const element = document.getElementById(field.id);
    if (element && (!field.value || field.value.trim() === '')) {
      element.classList.add('missing-field');
      element.setAttribute('aria-invalid', 'true');
    }
  });
}

// ========================================
// ORGANIZATION DYNAMIC FIELDS
// ========================================

/**
 * Load organization-specific custom fields from the API
 */
async function loadOrganizationFields() {
  try {
    const response = await apiFetch('/api/fields');
    if (response.ok) {
      organizationFields = await response.json();
      renderCustomFieldsInForm();
      renderDynamicFieldFilters();
      Logger.log('Loaded organization fields:', organizationFields.length);
    }
  } catch (error) {
    Logger.warn('Could not load organization fields:', error);
    organizationFields = [];
  }
}

/**
 * Load organization-specific categories
 */
async function loadOrganizationCategories() {
  try {
    const response = await apiFetch('/api/service-types');
    if (response.ok) {
      const result = await response.json();
      organizationCategories = result.data || result;

      // Sync serviceTypeRegistry so sidebar/filter UI stays up to date
      if (appConfig) {
        appConfig.serviceTypes = organizationCategories.map(cat => ({
            id: cat.id, name: cat.name, slug: cat.slug,
            icon: cat.icon, color: cat.color,
            defaultInterval: cat.default_interval_months,
        }));
        serviceTypeRegistry.loadFromConfig(appConfig);
        injectDynamicMarkerStyles();
      }

      // Re-render category UI to reflect loaded categories
      renderFilterPanelCategories();
      renderSubcategoryFilter();
      updateMapLegend();

      Logger.log('Loaded organization categories:', organizationCategories.length);
    }
  } catch (error) {
    Logger.warn('Could not load organization categories:', error);
    organizationCategories = [];
  }
}

/**
 * Render custom organization fields for the popup display
 * Shows fields from Excel import stored in custom_data
 * @param {Object} customer - Customer object with custom_data
 * @returns {string} HTML string for custom fields section
 */
function renderPopupCustomFields(customer) {
  // Filter to only visible fields
  const visibleFields = organizationFields.filter(f =>
    f.is_visible && f.is_visible !== 0
  );

  if (visibleFields.length === 0) return '';

  // Parse custom_data
  let customData = customer.custom_data;
  if (typeof customData === 'string') {
    try { customData = JSON.parse(customData); } catch { customData = {}; }
  }
  customData = customData || {};

  let html = '';

  for (const field of visibleFields) {
    const value = customData[field.field_name];
    if (value !== undefined && value !== null && value !== '') {
      // Format value based on field type
      let displayValue = value;

      if (field.field_type === 'date') {
        try {
          displayValue = formatDate(value);
        } catch { displayValue = value; }
      } else if (field.field_type === 'select' && field.options) {
        // Find display_name for the value
        const option = field.options.find(o => o.value === value);
        displayValue = option?.display_name || value;
      }

      html += `<p><strong>${escapeHtml(field.display_name)}:</strong> ${escapeHtml(String(displayValue))}</p>`;
    }
  }

  return html;
}

/**
 * Render custom fields in the customer form based on organization_fields
 */
function renderCustomFieldsInForm() {
  const section = document.getElementById('customFieldsSection');
  const container = document.getElementById('customFieldsContainer');

  if (!section || !container) return;

  // Filter to only visible fields
  const visibleFields = organizationFields.filter(f => f.is_visible);

  if (visibleFields.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');

  // Generate form fields
  container.innerHTML = visibleFields.map(field => {
    const fieldId = `custom_${field.field_name}`;
    const required = field.is_required ? 'required' : '';
    const requiredMark = field.is_required ? ' *' : '';

    let inputHtml = '';

    switch (field.field_type) {
      case 'select':
        const options = (field.options || []).map(opt =>
          `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.display_name || opt.value)}</option>`
        ).join('');
        inputHtml = `
          <select id="${fieldId}" ${required}>
            <option value="">-- Velg --</option>
            ${options}
          </select>
        `;
        break;

      case 'date':
        inputHtml = `<input type="date" id="${fieldId}" ${required}>`;
        break;

      case 'number':
        inputHtml = `<input type="number" id="${fieldId}" ${required}>`;
        break;

      case 'text':
      default:
        inputHtml = `<input type="text" id="${fieldId}" ${required}>`;
        break;
    }

    return `
      <div class="form-group">
        <label for="${fieldId}">${escapeHtml(field.display_name)}${requiredMark}</label>
        ${inputHtml}
      </div>
    `;
  }).join('');
}

/**
 * Populate custom fields with customer data
 * @param {Object} customData - The custom_data JSON from the customer record
 */
function populateCustomFields(customData) {
  if (!customData) return;

  let data = customData;
  if (typeof customData === 'string') {
    try {
      data = JSON.parse(customData);
    } catch (e) {
      data = {};
    }
  }

  for (const field of organizationFields) {
    const element = document.getElementById(`custom_${field.field_name}`);
    if (element && data[field.field_name] !== undefined) {
      element.value = data[field.field_name];
    }
  }
}

/**
 * Clear all custom fields in the form
 */
function clearCustomFields() {
  for (const field of organizationFields) {
    const element = document.getElementById(`custom_${field.field_name}`);
    if (element) {
      element.value = '';
    }
  }
}

/**
 * Collect custom field values from the form
 * @returns {Object} Custom data object
 */
function collectCustomFieldValues() {
  const customData = {};

  for (const field of organizationFields) {
    const element = document.getElementById(`custom_${field.field_name}`);
    if (element && element.value) {
      customData[field.field_name] = element.value;
    }
  }

  return customData;
}


// Add new customer
async function addCustomer() {
  // Nullstill referanse til redigert kunde
  _editingCustomer = null;

  // Populate dynamic dropdowns first (with defaults)
  populateDynamicDropdowns(null);

  // Reset address autocomplete state from previous session
  resetAddressAutocomplete();

  document.getElementById('modalTitle').textContent = 'Ny kunde';
  customerForm.reset();
  document.getElementById('customerId').value = '';
  document.getElementById('kontroll_intervall').value = 12;
  // Clear estimated time
  if (window.setEstimertTidFromMinutes) {
    window.setEstimertTidFromMinutes(0);
  }
  document.getElementById('lat').value = '';
  document.getElementById('lng').value = '';
  updateGeocodeQualityBadge(null);

  // Clear custom organization fields
  clearCustomFields();

  // Reset separate kontroll-felt
  document.getElementById('siste_el_kontroll').value = '';
  document.getElementById('neste_el_kontroll').value = '';
  document.getElementById('el_kontroll_intervall').value = 36;
  document.getElementById('siste_brann_kontroll').value = '';
  document.getElementById('neste_brann_kontroll').value = '';
  document.getElementById('brann_kontroll_intervall').value = 12;

  // Tøm dynamiske service-seksjoner
  const dynContainer = document.getElementById('dynamicServiceSections');
  if (dynContainer) dynContainer.innerHTML = '';

  // Vis kontroll-seksjoner basert på valgt kategori (eller default)
  const selectedKategori = serviceTypeRegistry.getSelectedCategories() ||
    (isMvpMode() ? '' : serviceTypeRegistry.getDefaultServiceType().name);
  updateControlSectionsVisibility(selectedKategori);

  // Reset email settings to defaults
  const emailAktiv = document.getElementById('emailAktiv');
  const forsteVarsel = document.getElementById('forsteVarsel');
  const paaminnelseEtter = document.getElementById('paaminnelseEtter');
  const emailOptions = document.getElementById('emailOptions');
  if (emailAktiv) emailAktiv.checked = true;
  if (forsteVarsel) forsteVarsel.value = 30;
  if (paaminnelseEtter) paaminnelseEtter.value = 7;
  if (emailOptions) emailOptions.classList.remove('hidden');

  // Hide kontaktlogg for new customers
  document.getElementById('kontaktloggSection').style.display = 'none';
  document.getElementById('kontaktloggList').innerHTML = '';

  // Hide kontaktpersoner for new customers
  document.getElementById('kontaktpersonerSection').style.display = 'none';
  document.getElementById('kontaktpersonerList').innerHTML = '';

  // Render subcategory dropdowns for new customer
  renderSubcategoryDropdowns(null);

  document.getElementById('deleteCustomerBtn').classList.add('hidden');
  openModal(customerModal);
}

// Referanse til kunden som redigeres (for å populere dynamiske seksjoner)
let _editingCustomer = null;

// Render dynamiske service-seksjoner basert på valgte kategorier
function renderDynamicServiceSections(customer = null) {
  const container = document.getElementById('dynamicServiceSections');
  if (!container) return;

  const selected = serviceTypeRegistry.getSelectedCategories();
  const selectedNames = selected ? selected.split(' + ').map(s => s.trim()).filter(Boolean) : [];

  if (selectedNames.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Lagre eksisterende verdier fra dynamiske seksjoner før re-render
  const savedValues = {};
  container.querySelectorAll('.service-section').forEach(section => {
    const slug = section.dataset.serviceSlug;
    if (!slug) return;
    const sisteInput = document.getElementById(`service_${slug}_siste`);
    const nesteInput = document.getElementById(`service_${slug}_neste`);
    const intervallSelect = document.getElementById(`service_${slug}_intervall`);
    const subtypeSelect = document.getElementById(`service_${slug}_subtype`);
    const equipmentSelect = document.getElementById(`service_${slug}_equipment`);
    savedValues[slug] = {
      siste: sisteInput?.value || '',
      neste: nesteInput?.value || '',
      intervall: intervallSelect?.value || '',
      subtype: subtypeSelect?.value || '',
      equipment: equipmentSelect?.value || ''
    };
  });

  // Render nye seksjoner kun for valgte kategorier
  const customerData = customer || _editingCustomer || {};
  container.innerHTML = serviceTypeRegistry.renderServiceSections(customerData, selectedNames);

  // Gjenopprett lagrede verdier for seksjoner som fortsatt finnes
  Object.entries(savedValues).forEach(([slug, vals]) => {
    const sisteInput = document.getElementById(`service_${slug}_siste`);
    const nesteInput = document.getElementById(`service_${slug}_neste`);
    const intervallSelect = document.getElementById(`service_${slug}_intervall`);
    const subtypeSelect = document.getElementById(`service_${slug}_subtype`);
    const equipmentSelect = document.getElementById(`service_${slug}_equipment`);
    if (sisteInput && vals.siste) sisteInput.value = vals.siste;
    if (nesteInput && vals.neste) nesteInput.value = vals.neste;
    if (intervallSelect && vals.intervall) intervallSelect.value = vals.intervall;
    if (subtypeSelect && vals.subtype) subtypeSelect.value = vals.subtype;
    if (equipmentSelect && vals.equipment) equipmentSelect.value = vals.equipment;
  });
}

// Vis/skjul kontroll-seksjoner basert på kategori og app mode
function updateControlSectionsVisibility(kategori) {
  const elSection = document.getElementById('elKontrollSection');
  const brannSection = document.getElementById('brannvarslingSection');
  const mvpSection = document.getElementById('mvpKontrollSection');
  const driftskategoriGroup = document.getElementById('driftskategori')?.closest('.form-group');

  // Skjul alle legacy-seksjoner — vi bruker dynamiske seksjoner i stedet
  if (elSection) elSection.style.display = 'none';
  if (brannSection) brannSection.style.display = 'none';
  if (mvpSection) mvpSection.style.display = 'none';
  if (driftskategoriGroup && isMvpMode()) driftskategoriGroup.style.display = 'none';

  // Render dynamiske dato-seksjoner per valgt kategori
  renderDynamicServiceSections();
}

// Auto-geocode address via backend proxy (Mapbox → Kartverket → Nominatim)
async function geocodeAddressAuto(adresse, postnummer, poststed) {
  const query = `${adresse || ''}, ${postnummer || ''} ${poststed || ''}`.trim();
  if (!query || query.length < 3) return null;

  // Try Kartverket directly first (fast)
  try {
    const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(query)}&fuzzy=true&treffPerSide=1`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      const addr = data.adresser?.[0];
      if (addr?.representasjonspunkt) {
        return { lat: addr.representasjonspunkt.lat, lng: addr.representasjonspunkt.lon };
      }
    }
  } catch (error) {
    // Kartverket failed, fall through to backend
  }

  // Fallback to backend proxy (Mapbox → Kartverket)
  try {
    const response = await apiFetch('/api/geocode/forward', {
      method: 'POST',
      body: JSON.stringify({ query, limit: 1 })
    });
    if (response.ok) {
      const result = await response.json();
      const suggestion = result.data?.suggestions?.[0];
      if (suggestion) {
        return { lat: suggestion.lat, lng: suggestion.lng };
      }
    }
  } catch (error) {
    Logger.log('Geocode auto failed:', error);
  }

  return null;
}

// Save customer
async function saveCustomer(e) {
  e.preventDefault();

  const customerId = document.getElementById('customerId').value;
  let lat = Number.parseFloat(document.getElementById('lat').value) || null;
  let lng = Number.parseFloat(document.getElementById('lng').value) || null;

  const adresse = document.getElementById('adresse').value;
  const postnummer = document.getElementById('postnummer').value;
  const poststed = document.getElementById('poststed').value;

  // Auto-geocode if no coordinates
  if (!lat || !lng) {
    showNotification('Geokoder adresse...');
    const coords = await geocodeAddressAuto(adresse, postnummer, poststed);
    if (coords) {
      lat = coords.lat;
      lng = coords.lng;
      document.getElementById('lat').value = lat.toFixed(6);
      document.getElementById('lng').value = lng.toFixed(6);
    }
  }


  // Bruk kategori-checkboxes for alle (MVP + Full)
  let kategori = serviceTypeRegistry.getSelectedCategories() || null;

  // Finn valgte kategori-slugs for å nullstille datoer for avhukede kategorier
  const selectedNames = (kategori || '').split(' + ').map(s => s.trim()).filter(Boolean);
  const allServiceTypes = serviceTypeRegistry.getAll();
  const selectedSlugs = selectedNames.map(name => {
    const st = allServiceTypes.find(s => s.name === name);
    return st?.slug;
  }).filter(Boolean);

  const hasEl = selectedSlugs.includes('el-kontroll');
  const hasBrann = selectedSlugs.includes('brannvarsling');

  // Parse services FØR vi leser legacy-felt, fordi parseServiceFormData()
  // kopierer datoer til legacy-feltene for default-kategorien (id=0)
  const parsedServices = serviceTypeRegistry.parseServiceFormData();

  const data = {
    navn: document.getElementById('navn').value,
    adresse: adresse,
    postnummer: postnummer,
    poststed: poststed,
    telefon: document.getElementById('telefon').value,
    epost: document.getElementById('epost').value,
    org_nummer: document.getElementById('org_nummer').value || null,
    estimert_tid: Number.parseInt(document.getElementById('estimert_tid').value) || null,
    lat: lat,
    lng: lng,
    // Legacy date fields: prefer form value, fallback to existing customer data (hidden inputs may be empty)
    siste_kontroll: normalizeDateValue(document.getElementById('siste_kontroll').value) || (_editingCustomer?.siste_kontroll || null),
    neste_kontroll: normalizeDateValue(document.getElementById('neste_kontroll').value) || (_editingCustomer?.neste_kontroll || null),
    kontroll_intervall_mnd: Number.parseInt(document.getElementById('kontroll_intervall').value) || (_editingCustomer?.kontroll_intervall_mnd || 12),
    kategori: kategori,
    notater: (document.getElementById('notater').value || '').replace(/\[ORGNR:\d{9}\]\s*/g, '').trim(),
    // Separate El-Kontroll felt — null ut hvis el-kontroll ikke er valgt, bevar eksisterende verdier
    siste_el_kontroll: hasEl ? (normalizeDateValue(document.getElementById('siste_el_kontroll').value) || (_editingCustomer?.siste_el_kontroll || null)) : null,
    neste_el_kontroll: hasEl ? (normalizeDateValue(document.getElementById('neste_el_kontroll').value) || (_editingCustomer?.neste_el_kontroll || null)) : null,
    el_kontroll_intervall: hasEl ? (Number.parseInt(document.getElementById('el_kontroll_intervall').value) || (_editingCustomer?.el_kontroll_intervall || 36)) : null,
    // Separate Brannvarsling felt — null ut hvis brannvarsling ikke er valgt, bevar eksisterende verdier
    siste_brann_kontroll: hasBrann ? (normalizeDateValue(document.getElementById('siste_brann_kontroll').value) || (_editingCustomer?.siste_brann_kontroll || null)) : null,
    neste_brann_kontroll: hasBrann ? (normalizeDateValue(document.getElementById('neste_brann_kontroll').value) || (_editingCustomer?.neste_brann_kontroll || null)) : null,
    brann_kontroll_intervall: hasBrann ? (Number.parseInt(document.getElementById('brann_kontroll_intervall').value) || (_editingCustomer?.brann_kontroll_intervall || 12)) : null,
    // Dynamiske tjeneste-datoer fra dynamiske seksjoner
    services: parsedServices,
    // Custom organization fields
    custom_data: JSON.stringify(collectCustomFieldValues())
  };

  try {
    const url = customerId ? `/api/kunder/${customerId}` : '/api/kunder';
    const method = customerId ? 'PUT' : 'POST';

    Logger.log('Saving customer:', { url, method, data });

    const response = await apiFetch(url, {
      method,
      body: JSON.stringify(data)
    });

    const result = await response.json();
    Logger.log('Server response:', response.status, result);

    if (!response.ok) {
      const validationErrors = result.error?.details?.errors;
      const errorMsg = Array.isArray(validationErrors)
        ? validationErrors.map(e => e.message).join(', ')
        : (result.error?.message || (typeof result.error === 'string' ? result.error : null) || 'Ukjent feil');
      showMessage('Kunne ikke lagre: ' + errorMsg, 'error');
      return;
    }

    const kundeData = result.data || result;
    const savedCustomerId = customerId || kundeData.id;

    // Close modal and show notification immediately — don't block on secondary saves
    releaseCustomer(currentClaimedKundeId);
    customerModal.classList.add('hidden');
    showNotification('Kunde lagret!');

    // Fire secondary saves and data reload in parallel (non-blocking for UX)
    const secondarySaves = [];
    if (savedCustomerId) {
      const subcatAssignments = collectSubcategoryAssignments();
      secondarySaves.push(
        apiFetch(`/api/subcategories/kunde/${savedCustomerId}`, {
          method: 'PUT',
          body: JSON.stringify({ assignments: subcatAssignments })
        }).catch(err => console.error('Error saving subcategory assignments:', err))
      );
      secondarySaves.push(
        saveCustomerEmailSettings(savedCustomerId).catch(err => console.error('Error saving email settings:', err))
      );
    }
    await Promise.all(secondarySaves);

    // Reset filter to show all customers so the new/updated one is visible
    currentFilter = 'alle';
    showOnlyWarnings = false;
    const omradeSelect = document.getElementById('omradeSelect');
    if (omradeSelect) omradeSelect.value = 'alle';

    // Reload data in parallel
    await Promise.all([loadCustomers(), loadOmrader()]);

    // Refresh open popup with updated customer data
    if (savedCustomerId) {
      const updatedCustomer = customers.find(c => c.id === Number(savedCustomerId));
      if (updatedCustomer && updatedCustomer.lat && updatedCustomer.lng) {
        showMapPopup(
          [updatedCustomer.lng, updatedCustomer.lat],
          generatePopupContent(updatedCustomer),
          { maxWidth: '350px', offset: [0, -35] }
        );
      }
    }
  } catch (error) {
    console.error('Lagring feilet:', error);
    showMessage('Kunne ikke lagre kunden: ' + error.message, 'error');
  }
}

// Delete customer
async function deleteCustomer() {
  const customerId = document.getElementById('customerId').value;
  if (!customerId) return;

  const kundeNavn = document.getElementById('navn').value || 'denne kunden';
  const confirmed = await showConfirm(
    `Er du sikker på at du vil slette "${kundeNavn}"? Dette kan ikke angres.`,
    'Slette kunde'
  );
  if (!confirmed) return;

  try {
    await apiFetch(`/api/kunder/${customerId}`, { method: 'DELETE' });
    releaseCustomer(currentClaimedKundeId);
    customerModal.classList.add('hidden');
    selectedCustomers.delete(Number.parseInt(customerId));
    await loadCustomers();
    await loadOmrader();
    updateSelectionUI();
  } catch (error) {
    console.error('Sletting feilet:', error);
    showMessage('Kunne ikke slette kunden. Prøv igjen senere.', 'error');
  }
}

// Geocode button handler
async function handleGeocode() {
  const address = document.getElementById('adresse').value;
  const postnummer = document.getElementById('postnummer').value;
  const poststed = document.getElementById('poststed').value;

  if (!address) {
    showMessage('Skriv inn en adresse først', 'warning');
    return;
  }

  const geocodeBtn = document.getElementById('geocodeBtn');
  geocodeBtn.classList.add('loading');
  geocodeBtn.disabled = true;

  const result = await geocodeAddress(address, postnummer, poststed);

  geocodeBtn.classList.remove('loading');
  geocodeBtn.disabled = false;

  if (result) {
    document.getElementById('lat').value = result.lat.toFixed(6);
    document.getElementById('lng').value = result.lng.toFixed(6);
    updateGeocodeQualityBadge('exact');
    showNotification('Koordinater funnet!', 'success');
  } else {
    showMessage('Kunne ikke finne koordinater for adressen. Sjekk at adressen er riktig.', 'warning');
  }
}

// Enable coordinate picking from map
let isPickingCoordinates = false;
let pickingIndicator = null;

function enableCoordinatePicking() {
  if (isPickingCoordinates) {
    disableCoordinatePicking();
    return;
  }

  isPickingCoordinates = true;

  // Hide the customer modal temporarily
  const customerModal = document.getElementById('customerModal');
  customerModal.classList.add('hidden');

  // Add picking mode class to map
  const mapContainer = document.getElementById('sharedMapContainer');
  mapContainer.classList.add('map-picking-mode');

  // Show indicator
  pickingIndicator = document.createElement('div');
  pickingIndicator.className = 'picking-mode-indicator';
  pickingIndicator.innerHTML = '<i aria-hidden="true" class="fas fa-crosshairs"></i> Klikk på kartet for å velge posisjon';
  document.body.appendChild(pickingIndicator);

  // Add click handler to map
  map.once('click', handleMapPick);

  // Allow escape to cancel
  document.addEventListener('keydown', handlePickingEscape);
}

async function handleMapPick(e) {
  const lat = e.lngLat.lat;
  const lng = e.lngLat.lng;

  // Update form fields
  document.getElementById('lat').value = lat.toFixed(6);
  document.getElementById('lng').value = lng.toFixed(6);

  // Update quality badge
  updateGeocodeQualityBadge('manual');

  // Clean up and show modal again
  disableCoordinatePicking();
  const customerModal = document.getElementById('customerModal');
  openModal(customerModal);

  // Reverse geocode to fill address fields
  try {
    const response = await apiFetch('/api/geocode/reverse', {
      method: 'POST',
      body: JSON.stringify({ lat, lng })
    });
    if (response.ok) {
      const result = await response.json();
      const addr = result.data;
      if (addr) {
        const adresseInput = document.getElementById('adresse');
        const postnummerInput = document.getElementById('postnummer');
        const poststedInput = document.getElementById('poststed');

        if (adresseInput && addr.address && !adresseInput.value) {
          adresseInput.value = addr.address;
        }
        if (postnummerInput && addr.postnummer && !postnummerInput.value) {
          postnummerInput.value = addr.postnummer;
        }
        if (poststedInput && addr.poststed && !poststedInput.value) {
          poststedInput.value = addr.poststed;
          poststedInput.classList.add('auto-filled');
        }
        showNotification(`Adresse funnet: ${escapeHtml(addr.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`)}`, 'success');
      } else {
        showNotification(`Koordinater valgt: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
      }
    } else {
      showNotification(`Koordinater valgt: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
    }
  } catch (err) {
    Logger.log('Reverse geocode failed:', err);
    showNotification(`Koordinater valgt: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
  }
}

function handlePickingEscape(e) {
  if (e.key === 'Escape' && isPickingCoordinates) {
    disableCoordinatePicking();
    // Show modal again
    const customerModal = document.getElementById('customerModal');
    openModal(customerModal);
    showNotification('Avbrutt', 'info');
  }
}

function disableCoordinatePicking() {
  isPickingCoordinates = false;

  // Remove picking mode class
  const mapContainer = document.getElementById('sharedMapContainer');
  mapContainer.classList.remove('map-picking-mode');

  // Remove indicator
  if (pickingIndicator) {
    pickingIndicator.remove();
    pickingIndicator = null;
  }

  // Remove event listeners
  map.off('click', handleMapPick);
  document.removeEventListener('keydown', handlePickingEscape);
}

function updateGeocodeQualityBadge(quality) {
  const badge = document.getElementById('geocodeQualityBadge');
  const warning = document.getElementById('geocodeWarning');

  if (!badge) return;

  badge.className = 'geocode-quality-badge';

  switch (quality) {
    case 'exact':
      badge.textContent = 'Eksakt';
      badge.classList.add('quality-exact');
      if (warning) warning.style.display = 'none';
      break;
    case 'street':
      badge.textContent = 'Gate-nivå';
      badge.classList.add('quality-street');
      if (warning) warning.style.display = 'none';
      break;
    case 'area':
      badge.textContent = 'Område-nivå';
      badge.classList.add('quality-area');
      if (warning) warning.style.display = 'flex';
      break;
    case 'manual':
      badge.textContent = 'Manuelt valgt';
      badge.classList.add('quality-manual');
      if (warning) warning.style.display = 'none';
      break;
    default:
      badge.textContent = '';
      if (warning) warning.style.display = 'none';
  }
}


// ============================================
// CUSTOMER ADMIN TAB
// ============================================

let customerAdminKategori = 'alle';
let customerAdminSearch = '';

function renderCustomerAdmin() {
  const container = document.getElementById('customerAdminList');
  const countDisplay = document.getElementById('customerCountDisplay');

  if (!container) return;

  // Set up event delegation for buttons (only once)
  if (!container.dataset.delegationSetup) {
    container.dataset.delegationSetup = 'true';
    container.addEventListener('click', (e) => {
      // Handle map focus button clicks
      const mapBtn = e.target.closest('.btn-map-focus');
      if (mapBtn) {
        e.stopPropagation();
        const customerId = Number.parseInt(mapBtn.dataset.customerId);
        focusOnCustomer(customerId);
        return;
      }

      const item = e.target.closest('.customer-admin-item');
      if (!item) return;

      const id = Number.parseInt(item.dataset.id);
      editCustomer(id);
    });
  }

  // Filter customers
  let filtered = [...customers];

  // Kategori filter (using dynamic service type registry)
  if (customerAdminKategori !== 'alle') {
    const beforeCount = filtered.length;
    filtered = filtered.filter(c => serviceTypeRegistry.matchesCategory(c, customerAdminKategori));
    Logger.log(`Filter: "${customerAdminKategori}" - ${beforeCount} -> ${filtered.length} kunder`);
  }

  // Search filter
  if (customerAdminSearch) {
    const search = customerAdminSearch.toLowerCase();
    filtered = filtered.filter(c =>
      c.navn.toLowerCase().includes(search) ||
      (c.adresse && c.adresse.toLowerCase().includes(search)) ||
      (c.poststed && c.poststed.toLowerCase().includes(search))
    );
  }

  // Sort by name
  sortByNavn(filtered);

  // Update stats
  if (countDisplay) countDisplay.textContent = `${filtered.length} av ${customers.length} kunder`;

  // Render list
  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--color-text-muted);">Ingen kunder funnet</div>';
    return;
  }

  container.innerHTML = filtered.map(c => {
    const hasCoords = c.lat && c.lng;

    // Beregn neste kontroll status
    let nextControlInfo = '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Show control badges per service type (dynamic from registry)
    const adminServiceTypes = serviceTypeRegistry.getAll();
    adminServiceTypes.forEach(st => {
      // Check services array first, then legacy columns by slug
      const serviceData = (c.services || []).find(s => s.service_type_slug === st.slug || s.service_type_id === st.id);
      let nesteKontroll = serviceData?.neste_kontroll;
      if (!nesteKontroll && st.slug === 'el-kontroll') nesteKontroll = c.neste_el_kontroll;
      if (!nesteKontroll && st.slug === 'brannvarsling') nesteKontroll = c.neste_brann_kontroll;
      if (nesteKontroll) {
        const nextDate = new Date(nesteKontroll);
        const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
        const statusClass = daysUntil < 0 ? 'overdue' : daysUntil <= 30 ? 'warning' : 'ok';
        const shortName = st.name.length > 10 ? st.name.substring(0, 8) + '..' : st.name;
        nextControlInfo += `<span class="control-badge ${statusClass}">${escapeHtml(shortName)}: ${escapeHtml(formatDateShort(nesteKontroll))}</span>`;
      }
    });
    // Fallback: generic neste_kontroll for customers without per-service-type dates
    if (!nextControlInfo && c.neste_kontroll) {
      const nextDate = new Date(c.neste_kontroll);
      const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
      const statusClass = daysUntil < 0 ? 'overdue' : daysUntil <= 30 ? 'warning' : 'ok';
      nextControlInfo = `<span class="control-badge ${statusClass}">${escapeHtml(formatDateShort(c.neste_kontroll))}</span>`;
    }

    // Build service info badges from subcategory assignments
    let serviceInfo = '';
    const assignments = kundeSubcatMap[c.id] || [];
    if (assignments.length > 0) {
      for (const a of assignments) {
        for (const group of allSubcategoryGroups) {
          if (group.id !== a.group_id) continue;
          const sub = (group.subcategories || []).find(s => s.id === a.subcategory_id);
          if (sub) {
            serviceInfo += `<span class="service-badge">${escapeHtml(sub.navn)}</span>`;
          }
        }
      }
    }

    return `
      <div class="customer-admin-item ${!hasCoords ? 'no-coords' : ''}" data-id="${c.id}">
        <div class="customer-info">
          <span class="customer-name">${escapeHtml(c.navn)}</span>
          <span class="customer-location">${escapeHtml(c.poststed || '')}</span>
          ${serviceInfo}
          ${nextControlInfo}
        </div>
        ${hasCoords ? `<button class="btn-map-focus" data-customer-id="${c.id}" title="Vis på kart"><i aria-hidden="true" class="fas fa-map-marker-alt"></i></button>` : ''}
      </div>
    `;
  }).join('');
}

async function deleteCustomerAdmin(id) {
  const customer = customers.find(c => c.id === id);
  if (!customer) return;

  const confirmed = await showConfirm(
    `Er du sikker på at du vil slette "${customer.navn}"? Dette kan ikke angres.`,
    'Slette kunde'
  );
  if (!confirmed) return;

  try {
    const response = await apiFetch(`/api/kunder/${id}`, { method: 'DELETE' });
    if (response.ok) {
      await loadCustomers();
      await loadOmrader();
      showNotification('Kunde slettet');
    }
  } catch (error) {
    console.error('Feil ved sletting:', error);
    showMessage('Kunne ikke slette kunden. Prøv igjen senere.', 'error');
  }
}

// Make available globally
window.deleteCustomerAdmin = deleteCustomerAdmin;


// Cluster customers by geographic proximity using DBSCAN
function getProximityRadius() {
  return Number(localStorage.getItem('proximity_radiusKm')) || 15;
}

function clusterCustomersByProximity(customerList) {
  const epsilonKm = getProximityRadius();

  // Filter to only customers with valid coordinates
  const withCoords = customerList.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  const withoutCoords = customerList.filter(c => !Number.isFinite(c.lat) || !Number.isFinite(c.lng));

  if (withCoords.length === 0) {
    return {
      clusters: [],
      noise: withoutCoords,
      summary: { totalCustomers: withoutCoords.length, clusterCount: 0, noiseCount: withoutCoords.length }
    };
  }

  // dbscanClustering returns Array<Array<Customer>> — each inner array is one cluster.
  // Customers not in any returned cluster are "noise" (isolated points).
  let dbscanResult;
  try {
    dbscanResult = SmartRouteEngine.dbscanClustering(withCoords, epsilonKm, 2);
  } catch (err) {
    console.error('DBSCAN clustering failed, falling back to poststed grouping:', err);
    dbscanResult = null;
  }

  // Fallback: group by poststed if DBSCAN failed or returned nothing usable
  if (!dbscanResult || !Array.isArray(dbscanResult)) {
    const byPoststed = {};
    withCoords.forEach(c => {
      const ps = c.poststed || 'Ukjent';
      if (!byPoststed[ps]) byPoststed[ps] = [];
      byPoststed[ps].push(c);
    });
    const fallbackClusters = Object.entries(byPoststed).map(([ps, custs]) => ({
      customers: custs,
      centroid: SmartRouteEngine.getCentroid(custs),
      radiusKm: 0,
      areaName: ps
    }));
    fallbackClusters.sort((a, b) => b.customers.length - a.customers.length);
    return {
      clusters: fallbackClusters,
      noise: withoutCoords,
      summary: { totalCustomers: customerList.length, clusterCount: fallbackClusters.length, noiseCount: withoutCoords.length }
    };
  }

  // Identify noise: customers with coords that aren't in any DBSCAN cluster
  const clusteredSet = new Set();
  dbscanResult.forEach(clusterArr => {
    clusterArr.forEach(c => clusteredSet.add(c));
  });
  const noise = [...withoutCoords, ...withCoords.filter(c => !clusteredSet.has(c))];

  // If DBSCAN produced 0 clusters (all noise), group all into one
  if (dbscanResult.length === 0 && withCoords.length > 0) {
    const centroid = SmartRouteEngine.getCentroid(withCoords);
    const poststedCounts = {};
    withCoords.forEach(c => { poststedCounts[c.poststed || 'Ukjent'] = (poststedCounts[c.poststed || 'Ukjent'] || 0) + 1; });
    const topPoststed = Object.entries(poststedCounts).sort((a, b) => b[1] - a[1])[0][0];
    return {
      clusters: [{ customers: withCoords, centroid, radiusKm: 0, areaName: topPoststed }],
      noise: withoutCoords,
      summary: { totalCustomers: customerList.length, clusterCount: 1, noiseCount: withoutCoords.length }
    };
  }

  // Build cluster objects with metadata from each DBSCAN cluster array
  const clusters = dbscanResult.map(clusterCustomers => {
    const centroid = SmartRouteEngine.getCentroid(clusterCustomers);
    let maxDist = 0;
    clusterCustomers.forEach(c => {
      const dist = SmartRouteEngine.haversineDistance(centroid.lat, centroid.lng, c.lat, c.lng);
      if (dist > maxDist) maxDist = dist;
    });

    // Build area name from unique poststeder (most common first)
    const poststedCounts = {};
    clusterCustomers.forEach(c => {
      const ps = c.poststed || 'Ukjent';
      poststedCounts[ps] = (poststedCounts[ps] || 0) + 1;
    });
    const sortedPoststeder = Object.entries(poststedCounts).sort((a, b) => b[1] - a[1]);
    let areaName;
    if (sortedPoststeder.length === 1) {
      areaName = sortedPoststeder[0][0];
    } else if (sortedPoststeder.length === 2) {
      areaName = `${sortedPoststeder[0][0]} / ${sortedPoststeder[1][0]}`;
    } else {
      areaName = `${sortedPoststeder[0][0]}-området (${sortedPoststeder.length} steder)`;
    }

    return {
      customers: clusterCustomers,
      centroid,
      radiusKm: maxDist,
      areaName
    };
  });

  // Sort clusters by size descending
  clusters.sort((a, b) => b.customers.length - a.customers.length);

  return {
    clusters,
    noise,
    summary: { totalCustomers: customerList.length, clusterCount: clusters.length, noiseCount: noise.length }
  };
}


// @ts-nocheck
// State
let map;
// Single map architecture - map is always visible behind login/app overlays
let markers = {};
// Clustering now handled by Supercluster (cluster-manager.js)
let selectedCustomers = new Set();
let customers = [];
let routeMarkers = []; // Used by route-planning.js for stop markers
let avtaler = [];
let omrader = [];
let currentFilter = 'alle';
let showOnlyWarnings = false;
let selectedCategory = 'all'; // 'all', 'El-Kontroll', 'Brannvarsling', 'El-Kontroll + Brannvarsling'
let selectedSubcategories = {}; // Filter state: { groupId: subcategoryId }
let kundeSubcatMap = {}; // Bulk cache: { kundeId: [{ group_id, subcategory_id }] }
let allSubcategoryGroups = []; // Organization-level subcategory groups from config
let currentCalendarMonth = new Date().getMonth();
let currentCalendarYear = new Date().getFullYear();
let calendarViewMode = 'month'; // 'month' or 'week'
let currentWeekStart = null; // Date object for start of current week view
let filterAbortController = null; // For å unngå race condition i applyFilters

// Organization Dynamic Fields
let organizationFields = [];
let organizationCategories = [];
let dynamicFieldFilters = {}; // { field_name: value or { min, max } or { from, to } }
let teamMembersData = []; // Store team members for event delegation

// SPA View State
let currentView = 'login'; // 'login' or 'app'
let appInitialized = false;

// Theme State
let currentTheme = localStorage.getItem('theme') || 'dark';

// Application Configuration
let appConfig = {};

// Authentication token (managed via httpOnly cookies, variable kept for backward compat)
let authToken = null;
let subscriptionInfo = null; // { status, trialEndsAt, planType } - populated from login/verify
let accessTokenExpiresAt = null; // Token expiry timestamp - for proactive refresh

// ========================================
// ACCESSIBLE MODAL HELPERS
// Wraps modal open/close with focus trap
// ========================================
function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove('hidden');
  if (typeof FocusTrap !== 'undefined') {
    const content = modalEl.querySelector('.modal-content') || modalEl;
    FocusTrap.activate(content);
  }
}
function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add('hidden');
  if (typeof FocusTrap !== 'undefined') {
    const content = modalEl.querySelector('.modal-content') || modalEl;
    FocusTrap.deactivate(content);
  }
}

// ========================================
// TAB CLEANUP REGISTRY
// Prevents memory leaks from accumulated event listeners
// ========================================
const tabCleanupFunctions = {
  calendar: null,
  overdue: null,
  warnings: null,
  planner: null,
  customers: null,
  statistikk: null,
  missingdata: null,
  admin: null
};

// Cleanup function runner
function runTabCleanup(tabName) {
  if (tabName && tabCleanupFunctions[tabName]) {
    tabCleanupFunctions[tabName]();
    tabCleanupFunctions[tabName] = null;
  }
}


// Event listeners
document.addEventListener('DOMContentLoaded', async () => {
  // Start inactivity tracking
  startInactivityTracking();
  // Attach event listeners for elements previously using inline handlers (CSP security)
  const stopImpersonationBtn = document.getElementById('stopImpersonationBtn');
  if (stopImpersonationBtn) stopImpersonationBtn.addEventListener('click', () => stopImpersonation());

  const smartDaysAhead = document.getElementById('smartDaysAhead');
  if (smartDaysAhead) smartDaysAhead.addEventListener('input', function() {
    document.getElementById('smartDaysAheadValue').textContent = this.value + ' dager';
  });

  const smartMaxCustomers = document.getElementById('smartMaxCustomers');
  if (smartMaxCustomers) smartMaxCustomers.addEventListener('input', function() {
    document.getElementById('smartMaxCustomersValue').textContent = this.value + ' kunder';
  });

  const smartClusterRadius = document.getElementById('smartClusterRadius');
  if (smartClusterRadius) smartClusterRadius.addEventListener('input', function() {
    document.getElementById('smartClusterRadiusValue').textContent = this.value + ' km';
  });

  const refreshSmartBtn = document.getElementById('refreshSmartRecommendationsBtn');
  if (refreshSmartBtn) refreshSmartBtn.addEventListener('click', () => renderSmartRecommendations());

  // Initialize theme immediately (before any content renders)
  initializeTheme();

  // Load configuration first
  await loadConfig();

  // Apply branding from config
  applyBranding();

  // ALWAYS initialize the shared map first (it's visible behind login overlay)
  // Check localStorage hint — if user was logged in before, skip globe animation
  // and start at app view to avoid black screen while satellite tiles load
  const likelyReturningUser = !!localStorage.getItem('userName');
  initSharedMap({ skipGlobe: likelyReturningUser });

  // Set up login form handler
  initLoginView();

  // Check if already logged in
  const isAuthenticated = await checkExistingAuth();

  if (isAuthenticated) {
    // Check for impersonation or super-admin redirect
    const isImpersonatingCheck = localStorage.getItem('isImpersonating') === 'true';
    const isSuperAdminCheck = localStorage.getItem('isSuperAdmin') === 'true';

    // If super-admin and NOT impersonating, redirect to admin panel
    if (isSuperAdminCheck && !isImpersonatingCheck) {
      window.location.href = '/admin';
      return;
    }

    // If impersonating, show the impersonation banner
    if (isImpersonatingCheck) {
      const banner = document.getElementById('impersonationBanner');
      const orgName = localStorage.getItem('impersonatingOrgName') || 'Ukjent bedrift';
      if (banner) {
        document.getElementById('impersonatingOrgName').textContent = orgName;
        banner.style.display = 'flex';
        document.body.classList.add('is-impersonating');
      }
    }

    // Already logged in - skip to app view directly (no animation)
    const loginOverlay = document.getElementById('loginOverlay');
    const appView = document.getElementById('appView');

    // Hide login overlay, show app
    if (loginOverlay) loginOverlay.classList.add('hidden');
    if (appView) appView.classList.remove('hidden');

    currentView = 'app';
    appInitialized = true;

    // Enable map interactivity and fly to office location
    if (map) {
      setMapInteractive(true);
      if (!map._zoomControl) {
        map._zoomControl = new mapboxgl.NavigationControl({ showCompass: false });
        map.addControl(map._zoomControl, 'top-right');
      }
      stopGlobeSpin(); // Safety: ensure globe spin is stopped

      // Always fly to office location or Norway overview
      const hasOfficeLocation = appConfig.routeStartLat && appConfig.routeStartLng;
      map.flyTo({
        center: hasOfficeLocation
          ? [appConfig.routeStartLng, appConfig.routeStartLat]
          : NORWAY_CENTER,
        zoom: hasOfficeLocation ? 6 : NORWAY_ZOOM,
        duration: 1600,
        essential: true
      });
    }

    // Initialize DOM and app
    initDOMElements();
    initMap(); // Add map features (clustering, borders, etc.)

    // Show office marker if company address is configured
    updateOfficeMarkerPosition();

    // Wait for cluster source before loading customers (prevents blank map)
    if (!_clusterSourceReady && typeof waitForClusterReady === 'function') {
      await waitForClusterReady(8000);
    }
    // Load categories and fields first so markers render with correct icons
    await loadOrganizationCategories();
    await loadOrganizationFields();
    // Then load customers (renders markers using serviceTypeRegistry)
    loadCustomers();
    loadOmrader();
    initWebSocket();

    // Show user bar with name
    showUserBar();

    // Setup event listeners
    setupEventListeners();

    // Initialize chat system
    initChat();
    initChatEventListeners();
  } else {
    // Not logged in - login overlay is already visible by default
    currentView = 'login';

    // If we skipped the globe (thought user was returning) but auth failed,
    // fly back to globe view and start spinning
    if (likelyReturningUser && map) {
      map.flyTo({ center: [15.0, 65.0], zoom: 3.0, duration: 1500 });
      setMapInteractive(false);
      setTimeout(() => startGlobeSpin(), 1500);
    }

    // Hide tab navigation and sidebar toggle when not logged in
    const tabNavigation = document.querySelector('.tab-navigation');
    if (tabNavigation) {
      tabNavigation.style.opacity = '0';
      tabNavigation.style.pointerEvents = 'none';
    }
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
      sidebarToggle.style.opacity = '0';
      sidebarToggle.style.pointerEvents = 'none';
    }
  }
});

// Initialize the app after successful login
async function initializeApp() {
  Logger.log('initializeApp() starting...');

  // Reload config now that user is authenticated
  // (initial loadConfig() ran before login, so org-specific data like subcategories was missing)
  await loadConfig();

  // Initialize DOM references
  initDOMElements();

  // Initialize map features (clustering, borders, etc.)
  // The base map is already created by initSharedMap()
  initMap();

  // Show office marker if company address is configured
  updateOfficeMarkerPosition();

  Logger.log('initializeApp() after initMap, _clusterSourceReady:', _clusterSourceReady);

  // Wait for cluster source to be ready before loading customers
  // This prevents markers from failing to render after login
  if (!_clusterSourceReady && typeof waitForClusterReady === 'function') {
    Logger.log('initializeApp() waiting for cluster source...');
    await waitForClusterReady(8000);
    Logger.log('initializeApp() cluster source ready:', _clusterSourceReady);
  }

  // Load categories and fields first so markers render with correct icons
  try {
    await Promise.all([
      loadOrganizationCategories(),
      loadOrganizationFields()
    ]);
  } catch (err) {
    console.error('Error loading org config:', err);
  }

  // Then load remaining data in parallel
  Promise.all([
    loadCustomers(),
    loadOmrader()
  ]).then(() => {
    Logger.log('initializeApp() all data loaded');
  }).catch(err => {
    console.error('Error loading initial data:', err);
  });

  initWebSocket();

  // Setup event listeners
  setupEventListeners();

  // Initialize misc event listeners (import, map legend)
  initMiscEventListeners();

  // Update map legend with current service types
  updateMapLegend();

  // Apply MVP mode UI changes based on organization settings
  applyMvpModeUI();

  // Initialize Today's Work feature
  initTodaysWork();

  // Initialize chat system
  initChat();
  initChatEventListeners();

  // Show address setup banner if no office address is configured
  showAddressBannerIfNeeded();

  Logger.log('initializeApp() complete');
}

// Setup all event listeners
function setupEventListeners() {
  // WCAG 2.1.1: Keyboard support for role="button" elements (Enter/Space activates click)
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) {
      e.preventDefault();
      e.target.click();
    }
  });

  // Patch notes
  checkForNewPatchNotes();
  document.getElementById('patchNotesLink')?.addEventListener('click', () => {
    loadAndShowPatchNotes(0);
  });

  // Logout button - use SPA logout
  document.getElementById('logoutBtnMain')?.addEventListener('click', handleLogout);

  // Nightmode toggle button (map tiles)
  document.getElementById('nightmodeBtn')?.addEventListener('click', toggleNightMode);

  // Theme toggle button (UI light/dark mode)
  document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);

  // Dashboard action cards
  document.querySelectorAll('.dashboard-actions .action-card').forEach(card => {
    card.addEventListener('click', () => {
      const action = card.dataset.action;
      if (action === 'showOverdueTab') {
        switchToTab('overdue');
      } else if (action === 'showRoutesTab') {
        switchToTab('routes');
      } else if (action === 'showCalendarTab') {
        switchToTab('calendar');
      }
    });
  });

  // Add event listeners with null checks
  searchInput?.addEventListener('input', debounce(() => filterCustomers(), 200));
  addCustomerBtn?.addEventListener('click', addCustomer);
  planRouteBtn?.addEventListener('click', planRoute);
  clearSelectionBtn?.addEventListener('click', clearSelection);

  // Mobile route FAB
  document.getElementById('mobileRouteFabBtn')?.addEventListener('click', planRoute);
  customerForm?.addEventListener('submit', saveCustomer);
  document.getElementById('cancelBtn')?.addEventListener('click', () => {
    releaseCustomer(currentClaimedKundeId);
    closeModal(customerModal);
  });
  document.getElementById('deleteCustomerBtn')?.addEventListener('click', deleteCustomer);
  document.getElementById('geocodeBtn')?.addEventListener('click', handleGeocode);
  document.getElementById('pickFromMapBtn')?.addEventListener('click', enableCoordinatePicking);

  // Setup address autocomplete and postnummer lookup
  setupAddressAutocomplete();

  // Kategori-checkboxes: change-handlers settes i populateDynamicDropdowns()
  document.getElementById('saveApiKey')?.addEventListener('click', saveApiKey);

  // Warning actions
  document.getElementById('selectWarningsBtn')?.addEventListener('click', selectCustomersNeedingControl);

  // Customer admin tab
  document.getElementById('addCustomerBtnTab')?.addEventListener('click', addCustomer);
  document.getElementById('importCustomersBtn')?.addEventListener('click', showImportModal);

  // Export dropdown
  const exportBtn = document.getElementById('exportCustomersBtn');
  const exportDropdown = document.getElementById('exportDropdown');
  if (exportBtn && exportDropdown) {
    exportBtn.setAttribute('aria-haspopup', 'true');
    exportBtn.setAttribute('aria-expanded', 'false');
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportDropdown.classList.toggle('hidden');
      exportBtn.setAttribute('aria-expanded', String(!exportDropdown.classList.contains('hidden')));
    });
    exportDropdown.querySelectorAll('.export-option').forEach(opt => {
      opt.addEventListener('click', async () => {
        const format = opt.dataset.format;
        exportDropdown.classList.add('hidden');
        try {
          const exportHeaders = {};
          const exportCsrf = getCsrfToken();
          if (exportCsrf) exportHeaders['X-CSRF-Token'] = exportCsrf;
          const response = await fetch(`/api/export/kunder?format=${format}`, {
            headers: exportHeaders,
            credentials: 'include'
          });
          if (!response.ok) throw new Error('Eksport feilet');
          const blob = await response.blob();
          const disposition = response.headers.get('Content-Disposition') || '';
          const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
          const filename = filenameMatch ? filenameMatch[1] : `kunder.${format}`;
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = filename;
          link.click();
          URL.revokeObjectURL(link.href);
          showNotification(`Eksportert ${format.toUpperCase()} med suksess`, 'success');
        } catch (err) {
          showNotification('Eksport feilet: ' + err.message, 'error');
        }
      });
    });
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      exportDropdown.classList.add('hidden');
      exportBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // Integration buttons in customer modal
  document.getElementById('pushToTripletexBtn')?.addEventListener('click', () => {
    const kundeId = Number(document.getElementById('customerId').value);
    if (kundeId) pushCustomerToTripletex(kundeId);
  });

  document.getElementById('createEkkReportBtn')?.addEventListener('click', async () => {
    const kundeId = Number(document.getElementById('customerId').value);
    if (!kundeId) return;
    try {
      const response = await apiFetch('/api/ekk/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kunde_id: kundeId, report_type: 'elkontroll' }),
      });
      const data = await response.json();
      if (data.success) {
        showNotification('EKK-rapport opprettet som utkast', 'success');
      } else {
        showNotification(data.error?.message || 'Kunne ikke opprette rapport', 'error');
      }
    } catch (err) {
      showNotification('Feil ved oppretting av EKK-rapport', 'error');
    }
  });

  document.getElementById('closeImportModal')?.addEventListener('click', closeImportModal);
  document.getElementById('customerSearchInput')?.addEventListener('input', (e) => {
    customerAdminSearch = e.target.value;
    renderCustomerAdmin();
  });

  // Kategori tabs
  document.getElementById('kategoriTabs')?.addEventListener('click', async (e) => {
    const tab = e.target.closest('.kategori-tab');
    if (!tab) return;

    // Update active state
    document.querySelectorAll('.kategori-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    // Filter - update both variables
    customerAdminKategori = tab.dataset.kategori;
    // Map kategori tab values to selectedCategory values
    if (customerAdminKategori === 'alle') {
      selectedCategory = 'all';
    } else {
      selectedCategory = customerAdminKategori;
    }

    renderCustomerAdmin();
    await applyFilters();
  });

  // Customer list toggle
  const toggleListBtn = document.getElementById('toggleCustomerList');
  const customerAdminList = document.getElementById('customerAdminList');

  if (toggleListBtn && customerAdminList) {
    toggleListBtn.addEventListener('click', () => {
      customerAdminList.classList.toggle('collapsed');
      toggleListBtn.classList.toggle('collapsed');
      const isCollapsed = customerAdminList.classList.contains('collapsed');
      toggleListBtn.setAttribute('aria-expanded', String(!isCollapsed));
      localStorage.setItem('customerListCollapsed', isCollapsed);
    });

    // Restore state
    if (localStorage.getItem('customerListCollapsed') === 'true') {
      customerAdminList.classList.add('collapsed');
      toggleListBtn.classList.add('collapsed');
      toggleListBtn.setAttribute('aria-expanded', 'false');
    } else {
      toggleListBtn.setAttribute('aria-expanded', 'true');
    }
  }

  // Sidebar toggle functionality
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');

  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      // Don't toggle collapsed on mobile
      if (window.innerWidth <= 768) return;

      sidebar.classList.toggle('collapsed');
      // Save preference to localStorage
      const isCollapsed = sidebar.classList.contains('collapsed');
      localStorage.setItem('sidebarCollapsed', isCollapsed);
      sidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
    });

    // Restore sidebar state from localStorage (only on desktop)
    const wasCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (wasCollapsed && window.innerWidth > 768) {
      sidebar.classList.add('collapsed');
      sidebarToggle.setAttribute('aria-expanded', 'false');
    }
  }

  // Customer list toggle functionality
  const customerListToggle = document.getElementById('customerListToggle');
  const customerListContainer = document.getElementById('customerListContainer');

  if (customerListToggle && customerListContainer) {
    customerListToggle.addEventListener('click', () => {
      customerListContainer.classList.toggle('hidden');
      customerListToggle.classList.toggle('collapsed');
      localStorage.setItem('customerListHidden', customerListContainer.classList.contains('hidden'));
    });

    // Restore customer list state from localStorage
    const wasHidden = localStorage.getItem('customerListHidden') === 'true';
    if (wasHidden) {
      customerListContainer.classList.add('hidden');
      customerListToggle.classList.add('collapsed');
    }
  }

  // Right-click context menu on customer list items
  document.getElementById('customerList')?.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.customer-item[data-id]');
    if (!item) return;
    e.preventDefault();
    const customerId = Number(item.dataset.id);
    const customer = typeof customers !== 'undefined' ? customers.find(c => c.id === customerId) : null;
    if (customer) showCustomerListContextMenu(customer, e.clientX, e.clientY);
  });

  // Right-click context menu on calendar events
  document.getElementById('calendarContainer')?.addEventListener('contextmenu', (e) => {
    const avtaleEl = e.target.closest('.calendar-avtale[data-avtale-id], .week-avtale-card[data-avtale-id], .upcoming-item[data-avtale-id]');
    if (!avtaleEl) return;
    e.preventDefault();
    const avtaleId = Number(avtaleEl.dataset.avtaleId);
    const avtale = typeof avtaler !== 'undefined' ? avtaler.find(a => a.id === avtaleId) : null;
    if (avtale) showCalendarContextMenu(avtale, e.clientX, e.clientY);
  });

  // Right-click context menu on split-view calendar events
  document.getElementById('calendarSplitOverlay')?.addEventListener('contextmenu', (e) => {
    const avtaleEl = e.target.closest('.split-avtale-card[data-avtale-id]');
    if (!avtaleEl) return;
    e.preventDefault();
    const avtaleId = Number(avtaleEl.dataset.avtaleId);
    const avtale = typeof avtaler !== 'undefined' ? avtaler.find(a => a.id === avtaleId) : null;
    if (avtale) showCalendarContextMenu(avtale, e.clientX, e.clientY);
  });

  // Close modals on escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      releaseCustomer(currentClaimedKundeId);
      closeModal(customerModal);
      closeModal(apiKeyModal);
    }
  });

  // Close modal on X button click
  document.getElementById('closeCustomerModal')?.addEventListener('click', () => {
    releaseCustomer(currentClaimedKundeId);
    closeModal(customerModal);
  });
  document.getElementById('closeApiKeyModal')?.addEventListener('click', () => {
    closeModal(apiKeyModal);
  });
  // Close modal on backdrop click
  customerModal.addEventListener('click', (e) => {
    if (e.target === customerModal) {
      releaseCustomer(currentClaimedKundeId);
      closeModal(customerModal);
    }
  });
  apiKeyModal.addEventListener('click', (e) => {
    if (e.target === apiKeyModal) {
      closeModal(apiKeyModal);
    }
  });
  // Avtale modal event listeners
  document.getElementById('closeAvtaleModal')?.addEventListener('click', closeAvtaleModal);
  document.getElementById('cancelAvtale')?.addEventListener('click', closeAvtaleModal);
  document.getElementById('avtaleForm')?.addEventListener('submit', saveAvtale);
  document.getElementById('deleteAvtaleBtn')?.addEventListener('click', deleteAvtale);
  document.getElementById('deleteAvtaleSeriesBtn')?.addEventListener('click', deleteAvtaleSeries);
  document.getElementById('avtaleModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'avtaleModal') closeAvtaleModal();
  });

  // Setup kunde search in avtale modal
  setupAvtaleKundeSearch();

  // Kontaktlogg event listeners
  document.getElementById('addKontaktBtn')?.addEventListener('click', addKontaktlogg);
  document.getElementById('kontaktNotat')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKontaktlogg();
    }
  });
  document.getElementById('kontaktloggList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="deleteKontakt"]');
    if (btn) {
      deleteKontaktlogg(btn.dataset.id);
    }
  });

  // Kontaktpersoner event listeners
  document.getElementById('addKontaktpersonBtn')?.addEventListener('click', addKontaktperson);
  document.getElementById('kontaktpersonNavn')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKontaktperson();
    }
  });
  document.getElementById('kontaktpersonerList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="deleteKontaktperson"]');
    if (btn) {
      deleteKontaktperson(btn.dataset.id);
    }
  });

  // Subcategory manager button
  document.getElementById('manageSubcategoriesBtn')?.addEventListener('click', openSubcategoryManager);

  // Tab switching functionality
  const tabItems = document.querySelectorAll('.tab-item');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const contentPanel = document.getElementById('contentPanel');
  const contentPanelOverlay = document.getElementById('contentPanelOverlay');
  const panelTitle = document.getElementById('panelTitle');
  const contentPanelClose = document.getElementById('contentPanelClose');

  // Tab name to title mapping
  const tabTitles = {
    'dashboard': 'Dashboard',
    'customers': 'Kunder',
    'overdue': 'Forfalte',
    'warnings': 'Kommende kontroller',
    'calendar': 'Kalender',
    'weekly-plan': 'Planlagte oppdrag',
    'planner': 'Planlegger',
    'statistikk': 'Statistikk',
    'missingdata': 'Mangler data',
    'chat': 'Meldinger',
    'admin': 'Admin'
  };

  // Open content panel
  function openContentPanel() {
    if (contentPanel) {
      contentPanel.classList.remove('closed');
      contentPanel.classList.add('open');
      localStorage.setItem('contentPanelOpen', 'true');

      // On mobile, default to half-height mode
      if (isMobile && document.getElementById('bottomTabBar')) {
        contentPanel.classList.add('half-height');
        contentPanel.classList.remove('full-height');
        contentPanelMode = 'half';
      }
    }
    if (contentPanelOverlay && window.innerWidth <= 768 && contentPanelMode === 'full') {
      contentPanelOverlay.classList.add('visible');
    }
  }

  // Close content panel
  function closeContentPanel() {
    if (contentPanel) {
      contentPanel.classList.add('closed');
      contentPanel.classList.remove('open', 'half-height', 'full-height');
      localStorage.setItem('contentPanelOpen', 'false');
      contentPanelMode = 'closed';
    }
    if (contentPanelOverlay) {
      contentPanelOverlay.classList.remove('visible');
    }
  }

  // Close button click
  if (contentPanelClose) {
    contentPanelClose.addEventListener('click', () => {
      closeContentPanel();
      // Reset bottom tab bar to Kart when closing content panel
      if (isMobile && document.getElementById('bottomTabBar')) {
        document.querySelectorAll('.bottom-tab-item').forEach(b =>
          b.classList.toggle('active', b.dataset.bottomTab === 'map')
        );
        activeBottomTab = 'map';
        const fab = document.getElementById('mobileSearchFab');
        if (fab) fab.classList.remove('hidden');
      }
    });
  }

  // Overlay click to close (mobile)
  if (contentPanelOverlay) {
    contentPanelOverlay.addEventListener('click', () => {
      closeContentPanel();
      if (isMobile && document.getElementById('bottomTabBar')) {
        document.querySelectorAll('.bottom-tab-item').forEach(b =>
          b.classList.toggle('active', b.dataset.bottomTab === 'map')
        );
        activeBottomTab = 'map';
        const fab = document.getElementById('mobileSearchFab');
        if (fab) fab.classList.remove('hidden');
      }
    });
  }

  // Swipe gesture on content panel header for half/full toggle (mobile)
  if (contentPanel) {
    const panelHeader = contentPanel.querySelector('.content-panel-header');
    if (panelHeader) {
      let panelSwipeStartY = 0;

      panelHeader.addEventListener('touchstart', (e) => {
        panelSwipeStartY = e.touches[0].clientY;
      }, { passive: true });

      panelHeader.addEventListener('touchend', (e) => {
        if (!isMobile || !panelSwipeStartY) return;
        const diff = panelSwipeStartY - e.changedTouches[0].clientY;
        panelSwipeStartY = 0;

        // Swipe up: half → full
        if (diff > 50 && contentPanelMode === 'half') {
          contentPanel.classList.remove('half-height');
          contentPanel.classList.add('full-height');
          contentPanelMode = 'full';
          if (contentPanelOverlay) contentPanelOverlay.classList.add('visible');
        }
        // Swipe down: full → half
        else if (diff < -50 && contentPanelMode === 'full') {
          contentPanel.classList.remove('full-height');
          contentPanel.classList.add('half-height');
          contentPanelMode = 'half';
          if (contentPanelOverlay) contentPanelOverlay.classList.remove('visible');
        }
        // Swipe down: half → close
        else if (diff < -50 && contentPanelMode === 'half') {
          closeContentPanel();
          if (document.getElementById('bottomTabBar')) {
            document.querySelectorAll('.bottom-tab-item').forEach(b =>
              b.classList.toggle('active', b.dataset.bottomTab === 'map')
            );
            activeBottomTab = 'map';
            const fab = document.getElementById('mobileSearchFab');
            if (fab) fab.classList.remove('hidden');
          }
        }
      }, { passive: true });
    }
  }

  // Content panel resize functionality (desktop only)
  const contentPanelResize = document.getElementById('contentPanelResize');
  if (contentPanelResize && contentPanel) {
    let isResizing = false;

    // Restore saved width
    const savedWidth = localStorage.getItem('contentPanelWidth');
    if (savedWidth && window.innerWidth > 768) {
      contentPanel.style.width = savedWidth + 'px';
    }

    const startResize = (e) => {
      if (window.innerWidth <= 768) return;
      e.preventDefault();
      isResizing = true;
      contentPanelResize.classList.add('dragging');
      contentPanel.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };

    const doResize = (e) => {
      if (!isResizing) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const panelLeft = contentPanel.getBoundingClientRect().left;
      const newWidth = clientX - panelLeft;
      const clampedWidth = Math.max(280, Math.min(700, newWidth));
      contentPanel.style.width = clampedWidth + 'px';
    };

    const stopResize = () => {
      if (!isResizing) return;
      isResizing = false;
      contentPanelResize.classList.remove('dragging');
      contentPanel.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const currentWidth = parseInt(contentPanel.style.width);
      if (currentWidth) {
        localStorage.setItem('contentPanelWidth', currentWidth);
      }
    };

    contentPanelResize.addEventListener('mousedown', startResize);
    contentPanelResize.addEventListener('touchstart', startResize, { passive: false });
    document.addEventListener('mousemove', doResize);
    document.addEventListener('touchmove', doResize, { passive: false });
    document.addEventListener('mouseup', stopResize);
    document.addEventListener('touchend', stopResize);

    // Double-click to reset width
    contentPanelResize.addEventListener('dblclick', () => {
      contentPanel.style.width = '';
      localStorage.removeItem('contentPanelWidth');
    });
  }

  tabItems.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = tab.getAttribute('data-tab');

      // Cleanup previous tab's event listeners before switching
      const prevTab = document.querySelector('.tab-item.active')?.dataset.tab;
      if (prevTab) {
        runTabCleanup(prevTab);
      }

      // Deactivate weekly plan area-select mode when leaving that tab
      if (prevTab === 'weekly-plan') {
        if (weekPlanState.activeDay) {
          weekPlanState.activeDay = null;
          if (areaSelectMode) toggleAreaSelect();
        }
        // Reset team focus - restore all markers
        if (wpFocusedTeamMember) {
          wpFocusedTeamMember = null;
          wpFocusedMemberIds = null;
          applyTeamFocusToMarkers();
          if (typeof refreshClusters === 'function') refreshClusters();
        }
        // Close route summary if open
        closeWpRouteSummary();
      }

      // Remove active class from all tabs and panes
      tabItems.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tabPanes.forEach(p => p.classList.remove('active'));

      // Add active class to clicked tab and corresponding pane
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const tabPane = document.getElementById(`tab-${tabName}`);
      if (tabPane) {
        tabPane.classList.add('active');

        // Fjern compact-mode slik at alle faner kan scrolle
        contentPanel.classList.remove('compact-mode');

        // Update panel title
        if (panelTitle) {
          panelTitle.textContent = tabTitles[tabName] || tabName;
        }

        // Open content panel
        openContentPanel();

        // Sync map to tab context on mobile
        syncMapToTab(tabName);

        // Save active tab to localStorage
        localStorage.setItem('activeTab', tabName);

        // On mobile, close sidebar when opening content panel
        const isMobile = window.innerWidth <= 768;
        if (isMobile && typeof closeMobileSidebar === 'function') {
          closeMobileSidebar();
        }

        // Render content for the active tab
        if (tabName === 'overdue') {
          renderOverdue();
        } else if (tabName === 'warnings') {
          renderWarnings();
        } else if (tabName === 'calendar') {
          renderCalendar();
          openCalendarSplitView();
        } else if (tabName === 'weekly-plan') {
          renderWeeklyPlan();
        } else if (tabName === 'planner') {
          renderPlanner();
        } else if (tabName === 'email') {
          loadEmailData();
        } else if (tabName === 'statistikk') {
          renderStatistikk();
        } else if (tabName === 'missingdata') {
          renderMissingData();
        } else if (tabName === 'customers') {
          renderCustomerAdmin();
        } else if (tabName === 'admin') {
          loadAdminData();
        } else if (tabName === 'todays-work') {
          loadTodaysWork();
        } else if (tabName === 'chat') {
          onChatTabOpened();
        }
      }
    });
  });

  // Restore saved tab and content panel state
  const savedTab = localStorage.getItem('activeTab');
  const savedPanelState = localStorage.getItem('contentPanelOpen');

  // Only open content panel on desktop if user had it open before
  if (window.innerWidth > 768 && savedPanelState === 'true') {
    openContentPanel();
  }

  // On mobile with bottom tab bar, start on map view (don't restore saved tab)
  const hasMobileTabBar = window.innerWidth <= 768;
  if (!hasMobileTabBar) {
    if (savedTab) {
      const savedTabBtn = document.querySelector(`.tab-item[data-tab="${savedTab}"]`);
      if (savedTabBtn) {
        setTimeout(() => {
          savedTabBtn.click();
        }, 100);
      }
    }
  }

  // Email event listeners
  document.getElementById('sendTestEmailBtn')?.addEventListener('click', sendTestEmail);
  document.getElementById('triggerEmailCheckBtn')?.addEventListener('click', triggerEmailCheck);

  // Open/close test email panel
  document.getElementById('openTestEmailBtn')?.addEventListener('click', () => {
    document.getElementById('emailTestPanel')?.classList.remove('hidden');
  });
  document.getElementById('closeTestPanel')?.addEventListener('click', () => {
    document.getElementById('emailTestPanel')?.classList.add('hidden');
  });

  // Config card toggle
  document.getElementById('toggleEmailConfig')?.addEventListener('click', () => {
    document.getElementById('emailConfigCard')?.classList.toggle('collapsed');
  });

  // Overdue sort select
  document.getElementById('overdueSortSelect')?.addEventListener('change', () => {
    renderOverdue();
  });

  // Warning sort select
  document.getElementById('warningSortSelect')?.addEventListener('change', () => {
    renderWarnings();
  });

  // Proximity radius sliders (synced, persisted to localStorage)
  const savedRadius = getProximityRadius();
  const initProximitySlider = (sliderId, valueId, renderFn) => {
    const slider = document.getElementById(sliderId);
    const valueEl = document.getElementById(valueId);
    if (!slider) return;
    slider.value = savedRadius;
    if (valueEl) valueEl.textContent = `${savedRadius} km`;
    slider.addEventListener('input', () => {
      const val = Number(slider.value);
      if (valueEl) valueEl.textContent = `${val} km`;
      localStorage.setItem('proximity_radiusKm', val);
      // Sync the other slider
      document.querySelectorAll('.proximity-settings input[type="range"]').forEach(s => {
        if (s !== slider) s.value = val;
      });
      document.querySelectorAll('.proximity-radius-value').forEach(el => {
        el.textContent = `${val} km`;
      });
      renderFn();
    });
  };
  initProximitySlider('overdueProximityRadius', 'overdueProximityRadiusValue', renderOverdue);
  initProximitySlider('warningProximityRadius', 'warningProximityRadiusValue', renderWarnings);

  // Overdue map and route buttons
  document.getElementById('showOverdueOnMapBtn')?.addEventListener('click', showOverdueOnMap);
  document.getElementById('createOverdueRouteBtn')?.addEventListener('click', createOverdueRoute);

  // History filter
  document.getElementById('historyFilter')?.addEventListener('change', (e) => {
    loadEmailHistory(e.target.value);
  });

  // Email toggle in customer modal
  document.getElementById('emailAktiv')?.addEventListener('change', (e) => {
    const emailOptions = document.getElementById('emailOptions');
    if (emailOptions) {
      emailOptions.classList.toggle('hidden', !e.target.checked);
    }
  });

  // Estimated time: sync hidden field from hours+minutes inputs
  function syncEstimertTid() {
    const h = parseInt(document.getElementById('estimert_tid_timer')?.value) || 0;
    const m = parseInt(document.getElementById('estimert_tid_min')?.value) || 0;
    const total = h * 60 + m;
    const hidden = document.getElementById('estimert_tid');
    if (hidden) hidden.value = total > 0 ? total : '';
    document.querySelectorAll('.tid-preset').forEach(b => {
      b.classList.toggle('active', b.dataset.tid === String(total));
    });
  }
  function setEstimertTidFromMinutes(totalMin) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const timerInput = document.getElementById('estimert_tid_timer');
    const minInput = document.getElementById('estimert_tid_min');
    const hidden = document.getElementById('estimert_tid');
    if (timerInput) timerInput.value = h || '';
    if (minInput) minInput.value = m || '';
    if (hidden) hidden.value = totalMin > 0 ? totalMin : '';
    document.querySelectorAll('.tid-preset').forEach(b => {
      b.classList.toggle('active', b.dataset.tid === String(totalMin));
    });
  }
  // Make available globally for customer-form.js
  window.setEstimertTidFromMinutes = setEstimertTidFromMinutes;

  // Preset buttons
  document.querySelectorAll('.tid-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      setEstimertTidFromMinutes(parseInt(btn.dataset.tid));
    });
  });
  // Sync when user types in hours/minutes
  document.getElementById('estimert_tid_timer')?.addEventListener('input', syncEstimertTid);
  document.getElementById('estimert_tid_min')?.addEventListener('input', syncEstimertTid);

  // Filter panel toggle (collapse/expand)
  const filterPanelToggle = document.getElementById('filterPanelToggle');
  const filterPanel = document.getElementById('filterPanel');

  if (filterPanelToggle && filterPanel) {
    // Restore state from localStorage
    const wasCollapsed = localStorage.getItem('filterPanelCollapsed') === 'true';
    if (wasCollapsed) {
      filterPanel.classList.add('collapsed');
    }

    filterPanelToggle.addEventListener('click', () => {
      filterPanel.classList.toggle('collapsed');
      const isCollapsed = filterPanel.classList.contains('collapsed');
      localStorage.setItem('filterPanelCollapsed', isCollapsed);
    });
  }

  // Update total customer count
  function updateCustomerCount() {
    const countEl = document.getElementById('totalCustomerCount');
    if (countEl) {
      countEl.textContent = customers.length;
    }
  }

  // Category filter buttons (kun kategori, ikke drift)
  document.querySelectorAll('.category-btn[data-category]').forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state for category buttons only
      document.querySelectorAll('.category-btn[data-category]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Apply filter
      selectedCategory = btn.dataset.category;
      applyFilters();
    });
  });

  // Call once customers are loaded
  setTimeout(updateCustomerCount, 500);

  // Initialize WebSocket for real-time updates
  initWebSocket();

  // Auto-update day counters every minute to ensure accuracy
  setInterval(() => {
    updateDayCounters();
  }, 60 * 1000); // Every 60 seconds

  // Also update at midnight to ensure day changes are reflected
  scheduleNextMidnightUpdate();

  // Auto-calculate "neste kontroll" from "siste kontroll" + intervall
  const kontrollGroups = [
    { siste: 'siste_kontroll', neste: 'neste_kontroll', intervall: 'kontroll_intervall' },
    { siste: 'siste_el_kontroll', neste: 'neste_el_kontroll', intervall: 'el_kontroll_intervall' },
    { siste: 'siste_brann_kontroll', neste: 'neste_brann_kontroll', intervall: 'brann_kontroll_intervall' },
  ];
  document.addEventListener('change', (e) => {
    const id = e.target.id;

    // Handle dynamic service sections (service_<slug>_siste / service_<slug>_intervall)
    const dynSisteMatch = id.match(/^service_(.+)_siste$/);
    const dynIntervallMatch = id.match(/^service_(.+)_intervall$/);
    if (dynSisteMatch || dynIntervallMatch) {
      const slug = (dynSisteMatch || dynIntervallMatch)[1];
      const sisteEl = document.getElementById(`service_${slug}_siste`);
      const nesteEl = document.getElementById(`service_${slug}_neste`);
      const intervallEl = document.getElementById(`service_${slug}_intervall`);
      if (!sisteEl?.value || !intervallEl?.value) return;
      // When changing siste: only auto-fill if neste is empty
      if (dynSisteMatch && nesteEl?.value) return;

      const siste = new Date(sisteEl.value);
      if (isNaN(siste.getTime())) return;

      const intervall = parseInt(intervallEl.value);
      const neste = new Date(siste);
      if (intervall < 0) {
        neste.setDate(neste.getDate() + Math.abs(intervall));
      } else {
        neste.setMonth(neste.getMonth() + intervall);
      }

      if (nesteEl) {
        nesteEl.value = appConfig?.datoModus === 'month_year'
          ? neste.toISOString().substring(0, 7)
          : neste.toISOString().substring(0, 10);
      }
      return;
    }

    // Handle legacy kontroll groups
    for (const g of kontrollGroups) {
      if (id === g.siste || id === g.intervall) {
        const sisteEl = document.getElementById(g.siste);
        const nesteEl = document.getElementById(g.neste);
        const intervallEl = document.getElementById(g.intervall);
        if (!sisteEl?.value || !intervallEl?.value) break;
        // When changing siste: only auto-fill if neste is empty
        // When changing intervall: always recalculate
        if (id === g.siste && nesteEl?.value) break;

        const siste = new Date(sisteEl.value);
        if (isNaN(siste.getTime())) break;

        const intervall = parseInt(intervallEl.value);
        const neste = new Date(siste);
        if (intervall < 0) {
          neste.setDate(neste.getDate() + Math.abs(intervall));
        } else {
          neste.setMonth(neste.getMonth() + intervall);
        }

        if (nesteEl) {
          nesteEl.value = appConfig?.datoModus === 'month_year'
            ? neste.toISOString().substring(0, 7)
            : neste.toISOString().substring(0, 10);
        }
        break;
      }
    }
  });

  // Technician dispatch handler for weekly plan (admin only)
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('wp-dispatch-select')) {
      weekPlanState.globalAssignedTo = e.target.value;
      renderWeeklyPlan();
    }
  });

  // Estimated time input handler for weekly plan
  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('wp-time-input')) {
      const input = e.target;
      const day = input.dataset.day;
      const customerId = Number.parseInt(input.dataset.customerId);
      const val = Math.max(5, parseInt(input.value) || 30);
      input.value = val;
      const item = weekPlanState.days[day]?.planned.find(c => c.id === customerId);
      if (item) {
        item.estimertTid = val;
        const dayEl = input.closest('.wp-day');
        const summaryEl = dayEl?.querySelector('.wp-day-summary');
        const badgeEl = dayEl?.querySelector('.wp-time-badge');
        const total = getDayEstimatedTotal(day);
        const dayPlanned = weekPlanState.days[day].planned.length;
        const dayExisting = avtaler.filter(a => a.dato === weekPlanState.days[day].date).length;
        if (summaryEl) summaryEl.textContent = `${dayPlanned + dayExisting} kunder · ~${formatMinutes(total)}`;
        if (badgeEl) badgeEl.textContent = `~${formatMinutes(total)}`;
      }
    }
  });

  // Global event delegation for data-action buttons (CSP-compliant)
  document.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    switch (action) {
      case 'focusOnCustomer':
        focusOnCustomer(Number.parseInt(actionEl.dataset.customerId));
        break;
      case 'toggleCustomerSelection':
        toggleCustomerSelection(Number.parseInt(actionEl.dataset.customerId));
        break;
      // === Weekly Plan actions ===
      case 'setActiveDay':
        e.stopPropagation();
        const clickedDay = actionEl.dataset.day;
        if (weekPlanState.activeDay === clickedDay) {
          // Deselect if clicking same day
          weekPlanState.activeDay = null;
          if (areaSelectMode) toggleAreaSelect();
          renderWeeklyPlan();
        } else {
          weekPlanState.activeDay = clickedDay;
          if (!areaSelectMode) toggleAreaSelect();
          showToast(`Dra over kunder på kartet for ${weekDayLabels[weekDayKeys.indexOf(clickedDay)]}`, 'info');
          renderWeeklyPlan();
        }
        break;
      case 'removeFromPlan':
        e.stopPropagation();
        const rmDay = actionEl.dataset.day;
        const rmId = Number.parseInt(actionEl.dataset.customerId);
        if (weekPlanState.days[rmDay]) {
          weekPlanState.days[rmDay].planned = weekPlanState.days[rmDay].planned.filter(c => c.id !== rmId);
          refreshTeamFocus();
          renderWeeklyPlan();
        }
        break;
      case 'deleteAvtale':
        e.stopPropagation();
        {
          const delId = actionEl.dataset.avtaleId;
          const delName = actionEl.dataset.avtaleName || 'denne avtalen';
          const confirmDel = await showConfirm(`Slett avtale for ${delName}?`, 'Slett');
          if (confirmDel) {
            try {
              const delResp = await apiFetch(`/api/avtaler/${delId}`, { method: 'DELETE' });
              if (delResp.ok) {
                showToast('Avtale slettet', 'success');
                await loadAvtaler();
                refreshTeamFocus();
                renderWeeklyPlan();
              } else {
                const delErr = await delResp.json().catch(() => ({}));
                showToast(delErr.error?.message || 'Kunne ikke slette avtale', 'error');
              }
            } catch (delError) {
              showToast('Feil ved sletting', 'error');
            }
          }
        }
        break;
      case 'wpAddSearchResult':
        e.stopPropagation();
        if (actionEl.classList.contains('disabled')) break;
        {
          const searchCustId = Number.parseInt(actionEl.dataset.customerId);
          const searchCust = customers.find(c => c.id === searchCustId);
          if (searchCust) {
            // Auto-select first day if none active
            if (!weekPlanState.activeDay) {
              weekPlanState.activeDay = weekDayKeys[0];
            }
            addCustomersToWeekPlan([searchCust]);
            const srchInput = document.getElementById('wpCustomerSearch');
            if (srchInput) srchInput.value = '';
            const srchResults = document.getElementById('wpSearchResults');
            if (srchResults) srchResults.style.display = 'none';
          }
        }
        break;
      case 'saveWeeklyPlan':
        e.stopPropagation();
        await saveWeeklyPlan();
        break;
      case 'clearWeekPlan':
        e.stopPropagation();
        clearWeekPlan();
        break;
      case 'weekPlanPrev':
        e.stopPropagation();
        if (getWeekPlanTotalPlanned() > 0) {
          const confirmNav = await showConfirm('Du har ulagrede endringer. Vil du bytte uke?', 'Bytt uke');
          if (!confirmNav) break;
        }
        closeWpRouteSummary();
        initWeekPlanState(addDaysToDate(weekPlanState.weekStart, -7));
        renderWeeklyPlan();
        break;
      case 'weekPlanNext':
        e.stopPropagation();
        if (getWeekPlanTotalPlanned() > 0) {
          const confirmNavNext = await showConfirm('Du har ulagrede endringer. Vil du bytte uke?', 'Bytt uke');
          if (!confirmNavNext) break;
        }
        closeWpRouteSummary();
        initWeekPlanState(addDaysToDate(weekPlanState.weekStart, 7));
        renderWeeklyPlan();
        break;
      case 'setEstimatedTime':
        e.stopPropagation();
        {
          const etDay = actionEl.dataset.day;
          const etId = Number.parseInt(actionEl.dataset.customerId);
          const etVal = Math.max(5, parseInt(actionEl.value) || 30);
          const etItem = weekPlanState.days[etDay]?.planned.find(c => c.id === etId);
          if (etItem) {
            etItem.estimertTid = etVal;
            // Update summary text without full re-render
            const summaryEl = actionEl.closest('.wp-day')?.querySelector('.wp-day-summary');
            const badgeEl = actionEl.closest('.wp-day')?.querySelector('.wp-time-badge');
            const total = getDayEstimatedTotal(etDay);
            const dayPlanned = weekPlanState.days[etDay].planned.length;
            const dayExisting = avtaler.filter(a => a.dato === weekPlanState.days[etDay].date).length;
            if (summaryEl) summaryEl.textContent = `${dayPlanned + dayExisting} kunder · ~${formatMinutes(total)}`;
            if (badgeEl) badgeEl.textContent = `~${formatMinutes(total)}`;
          }
        }
        break;
      case 'wpOptimizeOrder':
        e.stopPropagation();
        await wpOptimizeOrder(actionEl.dataset.day);
        break;
      case 'wpNavigateDay':
        e.stopPropagation();
        await wpNavigateDay(actionEl.dataset.day);
        break;
      case 'closeWpRoute':
        e.stopPropagation();
        closeWpRouteSummary();
        break;
      case 'wpExportMaps':
        e.stopPropagation();
        wpExportToMaps();
        break;
      case 'focusTeamMember':
        e.stopPropagation();
        focusTeamMemberOnMap(actionEl.dataset.memberName);
        break;

      case 'quickAddToday':
        e.stopPropagation();
        const todayCustomerId = Number.parseInt(actionEl.dataset.customerId);
        const todayCustomerName = actionEl.dataset.customerName;
        await quickAddAvtaleForDate(todayCustomerId, todayCustomerName, formatDateISO(new Date()));
        closeCalendarQuickMenu();
        break;
      case 'quickAddToSplitDay':
        e.stopPropagation();
        if (splitViewOpen && splitViewState.activeDay) {
          const splitCId = Number.parseInt(actionEl.dataset.customerId);
          const splitCName = actionEl.dataset.customerName;
          await quickAddAvtaleForDate(splitCId, splitCName, splitViewState.activeDay);
        }
        break;
      case 'showCalendarQuickMenu':
        e.stopPropagation();
        showCalendarQuickMenu(
          Number.parseInt(actionEl.dataset.customerId),
          actionEl.dataset.customerName,
          actionEl
        );
        break;
      case 'quickAddAvtale':
        e.stopPropagation();
        const qaCustomerId = Number.parseInt(actionEl.dataset.customerId);
        const qaCustomerName = actionEl.dataset.customerName;
        const qaDate = actionEl.dataset.quickDate;
        await quickAddAvtaleForDate(qaCustomerId, qaCustomerName, qaDate);
        closeCalendarQuickMenu();
        break;
      case 'addCustomerToCalendar':
        closeCalendarQuickMenu();
        const calCustomerId = Number.parseInt(actionEl.dataset.customerId);
        const calCustomerName = actionEl.dataset.customerName;
        openAvtaleModal(null, null);
        // Pre-fill kunde i avtale-modalen
        setTimeout(() => {
          const kundeSearch = document.getElementById('avtaleKundeSearch');
          const kundeHidden = document.getElementById('avtaleKunde');
          if (kundeSearch) kundeSearch.value = calCustomerName;
          if (kundeHidden) kundeHidden.value = calCustomerId;
        }, 100);
        break;
      case 'editCustomer':
        editCustomer(Number.parseInt(actionEl.dataset.customerId));
        break;
      case 'navigateToCustomer':
        navigateToCustomer(
          Number.parseFloat(actionEl.dataset.lat),
          Number.parseFloat(actionEl.dataset.lng),
          actionEl.dataset.name
        );
        break;
      case 'createRouteForArea':
        createRouteForAreaYear(actionEl.dataset.area, Number.parseInt(actionEl.dataset.year));
        break;
      case 'addClusterToRoute':
        const ids = actionEl.dataset.customerIds.split(',').map(id => Number.parseInt(id));
        addClusterToRoute(ids);
        break;
      case 'zoomToCluster':
        zoomToCluster(Number.parseFloat(actionEl.dataset.lat), Number.parseFloat(actionEl.dataset.lng));
        break;
      case 'sendReminder':
      case 'sendEmail':
        e.stopPropagation();
        sendManualReminder(Number.parseInt(actionEl.dataset.customerId));
        break;
      case 'createRouteFromGroup':
        e.stopPropagation();
        const groupIds = actionEl.dataset.customerIds.split(',').map(id => Number.parseInt(id));
        createRouteFromCustomerIds(groupIds);
        break;
      case 'showGroupOnMap':
        e.stopPropagation();
        const mapIds = actionEl.dataset.customerIds.split(',').map(id => Number.parseInt(id));
        showCustomersOnMap(mapIds);
        highlightCustomersOnMap(mapIds);
        break;
      case 'addGroupToWeekPlan':
        e.stopPropagation();
        showWeekPlanDayPicker(actionEl.dataset.customerIds, actionEl);
        break;
      case 'showClusterOnMap':
        SmartRouteEngine.showClusterOnMap(Number.parseInt(actionEl.dataset.clusterId));
        break;
      case 'createRouteFromCluster':
        SmartRouteEngine.createRouteFromCluster(Number.parseInt(actionEl.dataset.clusterId));
        break;
      case 'toggleShowAllRecommendations':
        toggleShowAllRecommendations();
        break;
      case 'editAvtale':
        e.stopPropagation();
        const editAvtaleId = Number.parseInt(actionEl.dataset.avtaleId);
        const editAvtale = avtaler.find(a => a.id === editAvtaleId);
        if (editAvtale) openAvtaleModal(editAvtale);
        break;
      case 'quickDeleteAvtale':
        e.stopPropagation();
        const delAvtaleId = Number.parseInt(actionEl.dataset.avtaleId);
        const delAvtale = avtaler.find(a => a.id === delAvtaleId);
        const delName = delAvtale?.kunder?.navn || delAvtale?.kunde_navn || 'denne avtalen';
        const delConfirmed = await showConfirm(
          `Slett avtale for ${delName}?`,
          'Bekreft sletting'
        );
        if (!delConfirmed) break;
        try {
          const delResponse = await apiFetch(`/api/avtaler/${delAvtaleId}`, { method: 'DELETE' });
          if (delResponse.ok) {
            showToast('Avtale slettet', 'success');
            await loadAvtaler();
            renderCalendar();
          } else {
            showToast('Kunne ikke slette avtalen', 'error');
          }
        } catch (err) {
          console.error('Error quick-deleting avtale:', err);
          showToast('Kunne ikke slette avtalen', 'error');
        }
        break;
      case 'quickMarkVisited':
        e.stopPropagation();
        quickMarkVisited(Number.parseInt(actionEl.dataset.customerId));
        break;
      case 'openDayDetail':
        const date = actionEl.dataset.date;
        openAvtaleModal(null, date);
        break;
      case 'toggleSection':
        e.preventDefault();
        const sectionArea = actionEl.dataset.area;
        const sectionContent = actionEl.nextElementSibling;
        const sectionIcon = actionEl.querySelector('.section-toggle-icon i');
        if (sectionContent && sectionIcon) {
          const isCollapsed = sectionContent.classList.contains('collapsed');
          if (isCollapsed) {
            sectionContent.classList.remove('collapsed');
            sectionIcon.classList.remove('fa-chevron-right');
            sectionIcon.classList.add('fa-chevron-down');
            localStorage.setItem(`areaExpanded-${sectionArea}`, 'true');
          } else {
            sectionContent.classList.add('collapsed');
            sectionIcon.classList.remove('fa-chevron-down');
            sectionIcon.classList.add('fa-chevron-right');
            localStorage.setItem(`areaExpanded-${sectionArea}`, 'false');
          }
        }
        break;
      case 'selectCustomer':
        // Skip if clicking on email button (already has its own handler)
        if (e.target.closest('[data-action="sendEmail"]')) return;
        const selectCustomerId = Number.parseInt(actionEl.dataset.customerId);
        focusOnCustomer(selectCustomerId);
        toggleCustomerSelection(selectCustomerId);
        break;
      case 'editTeamMember':
        e.stopPropagation();
        const editMemberId = Number.parseInt(actionEl.dataset.memberId);
        const editMember = teamMembersData.find(m => m.id === editMemberId);
        if (editMember) openTeamMemberModal(editMember);
        break;
      case 'deleteTeamMember':
        e.stopPropagation();
        const deleteMemberId = Number.parseInt(actionEl.dataset.memberId);
        const deleteMember = teamMembersData.find(m => m.id === deleteMemberId);
        if (deleteMember) deleteTeamMember(deleteMember);
        break;
    }
  });

  // Keyboard delegation for non-button data-action elements (WCAG 2.1.1)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    // Let native buttons/links/inputs handle their own keyboard events
    if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(actionEl.tagName)) return;
    e.preventDefault();
    actionEl.click();
  });

  // Arrow key navigation within tablist (WCAG tab pattern)
  const tabNav = document.querySelector('[role="tablist"]');
  if (tabNav) {
    tabNav.addEventListener('keydown', (e) => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      const tabs = [...tabNav.querySelectorAll('[role="tab"]:not([style*="display: none"])')];
      const current = tabs.indexOf(document.activeElement);
      if (current === -1) return;
      e.preventDefault();
      let next;
      if (e.key === 'ArrowDown') next = (current + 1) % tabs.length;
      else if (e.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      tabs[next].focus();
      tabs[next].click();
    });
  }

}
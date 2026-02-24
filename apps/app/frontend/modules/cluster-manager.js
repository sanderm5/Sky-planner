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
  if (!map) { Logger.log('initClusterManager: no map'); return; }
  if (map.getSource(CLUSTER_SOURCE)) { Logger.log('initClusterManager: source exists, ready'); _clusterSourceReady = true; return; }
  // Style must be loaded before adding sources/layers.
  if (!map.isStyleLoaded()) {
    Logger.log('initClusterManager: style not loaded, deferring');
    map.once('style.load', () => initClusterManager());
    // Fallback: 'load' event fires after style + tiles are ready
    map.once('load', () => {
      if (!_clusterSourceReady) initClusterManager();
    });
    return;
  }
  Logger.log('initClusterManager: creating source and layers');
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
    Logger.log('initClusterManager: ready, source created');
    // If customers were loaded while we waited for style, render them now
    if (typeof customers !== 'undefined' && customers.length > 0 && typeof applyFilters === 'function') {
      Logger.log('initClusterManager: triggering applyFilters for', customers.length, 'customers');
      applyFilters();
    }
  } catch (err) {
    console.error('initClusterManager failed:', err);
    // Retry once after style is loaded
    map.once('style.load', () => initClusterManager());
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

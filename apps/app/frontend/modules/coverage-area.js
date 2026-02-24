// ========================================
// COVERAGE AREA MANAGER (Dekningsområde)
// Persistent coverage zones on map + customer filtering
// ========================================

const CoverageAreaManager = {
  // State
  areas: [],
  visible: true,
  layers: [],
  customerCoverageCache: new Map(),
  filterMode: 'all', // 'all' | 'inside' | 'outside'

  /**
   * Initialize from appConfig (called after customers are loaded)
   */
  init() {
    this.loadFromConfig();
    if (this.areas.length > 0) {
      this.initMapButton();
      this.classifyCustomers();
      this.updateFilterPanel();
      if (typeof map !== 'undefined' && map && map.isStyleLoaded && map.isStyleLoaded()) {
        this.renderOverlays();
      }
    }
  },

  /**
   * Load coverage areas from appConfig
   */
  loadFromConfig() {
    this.areas = (typeof appConfig !== 'undefined' && appConfig.coverageAreas) || [];
    this.areas.sort((a, b) => a.zonePriority - b.zonePriority);
  },

  /**
   * Render all coverage area polygons on the map
   */
  renderOverlays() {
    this.clearOverlays();
    if (!map || !this.visible || this.areas.length === 0) return;

    this.areas.forEach((area) => {
      if (!area.polygonGeojson) return;
      const sourceId = `coverage-area-src-${area.id}`;
      const fillId = `coverage-area-fill-${area.id}`;
      const lineId = `coverage-area-line-${area.id}`;

      try {
        map.addSource(sourceId, {
          type: 'geojson',
          data: area.polygonGeojson
        });

        map.addLayer({
          id: fillId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': area.fillColor || '#2563eb',
            'fill-opacity': area.fillOpacity || 0.1
          }
        });

        map.addLayer({
          id: lineId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': area.lineColor || '#2563eb',
            'line-width': 2,
            'line-opacity': 0.5,
            'line-dasharray': area.zonePriority > 0 ? [5, 5] : [1]
          }
        });

        this.layers.push(sourceId, fillId, lineId);
      } catch (err) {
        Logger.log('CoverageArea: Kunne ikke tegne polygon for sone ' + area.navn, err);
      }
    });
  },

  /**
   * Clear all coverage area layers from the map
   */
  clearOverlays() {
    if (!map) return;
    for (const layerId of this.layers) {
      if (typeof removeLayerAndSource === 'function') {
        removeLayerAndSource(layerId);
      } else {
        try {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
          if (map.getSource(layerId)) map.removeSource(layerId);
        } catch { /* ignore */ }
      }
    }
    this.layers = [];
  },

  /**
   * Toggle overlay visibility
   */
  toggleVisibility() {
    this.visible = !this.visible;
    const btn = document.getElementById('coverageAreaToggle');
    if (btn) btn.classList.toggle('active', this.visible);
    if (this.visible) {
      this.renderOverlays();
    } else {
      this.clearOverlays();
    }
  },

  /**
   * Re-render after map style change (dark/satellite toggle)
   */
  onStyleLoad() {
    if (this.visible && this.areas.length > 0) {
      // Small delay to let map style fully load
      setTimeout(() => this.renderOverlays(), 200);
    }
  },

  // ---- Customer coverage checks ----

  /**
   * Point-in-polygon using ray casting algorithm
   * ring is array of [lng, lat] pairs (GeoJSON order)
   */
  pointInPolygon(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  },

  /**
   * Check if point is inside any polygon in a GeoJSON structure
   */
  pointInGeoJSON(lat, lng, geojson) {
    const features = geojson.features || [geojson];
    for (const feature of features) {
      if (!feature.geometry) continue;
      if (feature.geometry.type === 'Polygon') {
        const ring = feature.geometry.coordinates[0];
        if (this.pointInPolygon(lat, lng, ring)) return true;
      } else if (feature.geometry.type === 'MultiPolygon') {
        for (const poly of feature.geometry.coordinates) {
          if (this.pointInPolygon(lat, lng, poly[0])) return true;
        }
      }
    }
    return false;
  },

  /**
   * Classify all customers against all coverage areas (bulk)
   */
  classifyCustomers() {
    this.customerCoverageCache.clear();
    if (this.areas.length === 0 || typeof customers === 'undefined') return;

    customers.forEach(c => {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) {
        this.customerCoverageCache.set(c.id, { zones: [], outsideAll: true });
        return;
      }
      const zones = [];
      for (const area of this.areas) {
        if (!area.polygonGeojson) continue;
        if (this.pointInGeoJSON(c.lat, c.lng, area.polygonGeojson)) {
          zones.push({ id: area.id, navn: area.navn, priority: area.zonePriority });
        }
      }
      this.customerCoverageCache.set(c.id, {
        zones,
        outsideAll: zones.length === 0
      });
    });
  },

  /**
   * Get coverage status for a single customer
   */
  getCustomerCoverage(customerId) {
    return this.customerCoverageCache.get(customerId) || null;
  },

  /**
   * Check if a single point is inside any coverage area
   */
  isPointInsideCoverage(lat, lng) {
    if (this.areas.length === 0) return true;
    for (const area of this.areas) {
      if (!area.polygonGeojson) continue;
      if (this.pointInGeoJSON(lat, lng, area.polygonGeojson)) return true;
    }
    return false;
  },

  // ---- Filter integration ----

  /**
   * Toggle coverage filter mode
   */
  toggleFilter(mode) {
    this.filterMode = mode;
    // Update filter button states
    document.querySelectorAll('.coverage-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.coverageFilter === mode);
    });
    if (typeof applyFilters === 'function') applyFilters();
  },

  /**
   * Apply coverage filter to a customer list (called from applyFilters)
   */
  filterCustomers(customerList) {
    if (this.filterMode === 'all' || this.areas.length === 0) return customerList;
    return customerList.filter(c => {
      const coverage = this.customerCoverageCache.get(c.id);
      if (!coverage) return true;
      if (this.filterMode === 'inside') return !coverage.outsideAll;
      if (this.filterMode === 'outside') return coverage.outsideAll;
      return true;
    });
  },

  // ---- UI ----

  /**
   * Update the coverage area filter panel in the sidebar
   */
  updateFilterPanel() {
    const container = document.getElementById('coverageAreaFilter');
    if (!container) return;
    if (this.areas.length === 0) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';
    container.innerHTML = this.renderFilterButtons();
  },

  /**
   * Add toggle button on the map
   */
  initMapButton() {
    const container = document.getElementById('sharedMapContainer');
    if (!container || document.getElementById('coverageAreaToggle')) return;
    if (this.areas.length === 0) return;

    const btn = document.createElement('button');
    btn.id = 'coverageAreaToggle';
    btn.className = 'coverage-area-toggle-btn active';
    btn.title = 'Vis/skjul dekningsområde';
    btn.innerHTML = '<i class="fas fa-draw-polygon"></i>';
    btn.addEventListener('click', () => this.toggleVisibility());
    container.appendChild(btn);
  },

  /**
   * Render coverage filter buttons in the filter panel
   */
  renderFilterButtons() {
    if (this.areas.length === 0) return '';
    const insideCount = [...this.customerCoverageCache.values()].filter(v => !v.outsideAll).length;
    const outsideCount = [...this.customerCoverageCache.values()].filter(v => v.outsideAll).length;
    return `
      <div class="coverage-filter-row">
        <span class="coverage-filter-label"><i class="fas fa-draw-polygon"></i> Dekning:</span>
        <button class="coverage-filter-btn ${this.filterMode === 'all' ? 'active' : ''}" data-coverage-filter="all" data-action="coverageFilterAll">Alle</button>
        <button class="coverage-filter-btn ${this.filterMode === 'inside' ? 'active' : ''}" data-coverage-filter="inside" data-action="coverageFilterInside">Innenfor (${insideCount})</button>
        <button class="coverage-filter-btn ${this.filterMode === 'outside' ? 'active' : ''}" data-coverage-filter="outside" data-action="coverageFilterOutside">Utenfor (${outsideCount})</button>
      </div>
    `;
  }
};

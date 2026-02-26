// ========================================
// MAPBOX ISOCHRONE - Dekningsvisualisering
// Viser "hvor langt rekker vi på X minutter?"
// ========================================

const IsochroneManager = {
  active: false,
  layers: [],
  marker: null,
  originLng: null,
  originLat: null,
  contourMinutes: [60, 240, 480],
  profile: 'driving',

  // Inner (darkest) → outer (lightest)
  contourColors: ['#2563eb', '#3b82f6', '#93c5fd'],
  contourOpacities: [0.25, 0.15, 0.08],

  init() {
    const container = document.getElementById('sharedMapContainer');
    if (!container || document.getElementById('isochroneToggle')) return;

    const btn = document.createElement('button');
    btn.id = 'isochroneToggle';
    btn.className = 'isochrone-toggle-btn';
    btn.title = 'Vis dekningsområde';
    btn.innerHTML = '<i aria-hidden="true" class="fas fa-bullseye"></i>';
    btn.addEventListener('click', () => this.toggle());
    container.appendChild(btn);
  },

  toggle() {
    if (this.active) {
      this.deactivate();
    } else {
      this.activate();
    }
  },

  activate() {
    this.active = true;
    document.getElementById('isochroneToggle')?.classList.add('active');

    // Default origin: company/office location
    const routeStart = getRouteStartLocation();
    if (!routeStart) {
      showNotification('Sett firmaadresse i admin for å bruke rekkeviddeanalyse', 'warning');
      this.active = false;
      document.getElementById('isochroneToggle')?.classList.remove('active');
      return;
    }
    this.originLng = routeStart.lng;
    this.originLat = routeStart.lat;

    this.showControlPanel();
    this.addOriginMarker();
    this.fetchAndRender();
  },

  deactivate() {
    this.active = false;
    document.getElementById('isochroneToggle')?.classList.remove('active');
    this.clearLayers();
    this.removeOriginMarker();
    this.hideControlPanel();
  },

  showControlPanel() {
    this.hideControlPanel();

    const panel = document.createElement('div');
    panel.id = 'isochronePanel';
    panel.className = 'isochrone-panel';
    panel.innerHTML = `
      <div class="iso-panel-header">
        <strong><i aria-hidden="true" class="fas fa-bullseye" style="margin-right:4px"></i>Dekningsområde</strong>
        <button class="iso-close" data-action="isochroneClose" title="Lukk">&times;</button>
      </div>
      <div class="iso-panel-body">
        <label style="font-size:12px;color:var(--color-text-secondary)">Kjøretid</label>
        <div class="iso-time-buttons">
          ${[
            { min: 60, label: '1t' },
            { min: 120, label: '2t' },
            { min: 240, label: '4t' },
            { min: 480, label: '8t' },
            { min: 1440, label: '1d' },
            { min: 2880, label: '2d' },
            { min: 7200, label: '5d' },
            { min: 20160, label: '14d' },
          ].map(o => `
            <button class="iso-time-btn ${this.contourMinutes.includes(o.min) ? 'active' : ''}"
              data-minutes="${o.min}">${o.label}</button>
          `).join('')}
        </div>
        <p class="iso-hint"><i aria-hidden="true" class="fas fa-hand-pointer" style="margin-right:4px"></i>Dra markøren for å endre startpunkt</p>
      </div>
    `;

    document.body.appendChild(panel);

    // Time button click handlers
    panel.querySelectorAll('.iso-time-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
        this.contourMinutes = [];
        panel.querySelectorAll('.iso-time-btn.active').forEach(b => {
          this.contourMinutes.push(parseInt(b.dataset.minutes, 10));
        });
        this.contourMinutes.sort((a, b) => a - b);
        if (this.contourMinutes.length > 0) {
          this.fetchAndRender();
        } else {
          this.clearLayers();
        }
      });
    });
  },

  hideControlPanel() {
    const panel = document.getElementById('isochronePanel');
    if (panel) panel.remove();
  },

  addOriginMarker() {
    this.removeOriginMarker();

    const el = createMarkerElement('isochrone-origin-marker', `
      <div style="width:24px;height:24px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 2px 8px rgba(37,99,235,0.5);cursor:grab;display:flex;align-items:center;justify-content:center;">
        <i aria-hidden="true" class="fas fa-bullseye" style="font-size:10px;color:#fff;"></i>
      </div>
    `, [24, 24]);

    this.marker = new mapboxgl.Marker({ element: el, anchor: 'center', draggable: true })
      .setLngLat([this.originLng, this.originLat])
      .addTo(map);

    this.marker.on('dragend', () => {
      const lngLat = this.marker.getLngLat();
      this.originLng = lngLat.lng;
      this.originLat = lngLat.lat;
      this.fetchAndRender();
    });
  },

  removeOriginMarker() {
    if (this.marker) {
      this.marker.remove();
      this.marker = null;
    }
  },

  /**
   * Convert minutes to approximate radius in km
   * Assumes average driving speed of 60 km/h with 8h driving per day
   */
  minutesToRadiusKm(minutes) {
    const avgSpeedKmH = 60;
    const drivingHoursPerDay = 8;
    const days = Math.floor(minutes / (24 * 60));
    const remainingMinutes = minutes % (24 * 60);
    const remainingHours = remainingMinutes / 60;
    // For multi-day: 8h driving per day, rest is overnight
    const effectiveHours = days > 0
      ? (days * drivingHoursPerDay) + Math.min(remainingHours, drivingHoursPerDay)
      : remainingHours;
    return effectiveHours * avgSpeedKmH;
  },

  /**
   * Generate a circle polygon as GeoJSON (for large time values)
   */
  generateCircleGeoJSON(lat, lng, radiusKm, label) {
    const points = 64;
    const coords = [];
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * 2 * Math.PI;
      const dx = radiusKm * Math.cos(angle);
      const dy = radiusKm * Math.sin(angle);
      const pLat = lat + dy / 111.32;
      const pLng = lng + dx / (111.32 * Math.cos((lat * Math.PI) / 180));
      coords.push([pLng, pLat]);
    }
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: { label, radiusKm }
      }]
    };
  },

  async fetchAndRender() {
    if (!this.active || this.contourMinutes.length === 0) return;

    try {
      // Split into Mapbox-compatible (≤60 min) and radius-based (>60 min)
      const mapboxMinutes = this.contourMinutes.filter(m => m <= 60);
      const radiusMinutes = this.contourMinutes.filter(m => m > 60);

      let allFeatures = [];

      // Fetch real isochrones for ≤60 min via Mapbox API
      if (mapboxMinutes.length > 0) {
        const minutesStr = mapboxMinutes.join(',');
        const response = await apiFetch(`/api/routes/isochrone?lng=${this.originLng}&lat=${this.originLat}&minutes=${minutesStr}&profile=${this.profile}`);
        if (response.ok) {
          const result = await response.json();
          if (result.data && result.data.features) {
            allFeatures = allFeatures.concat(result.data.features);
          }
        }
      }

      // Generate radius circles for >60 min (Mapbox can't handle these)
      for (const min of radiusMinutes) {
        const radiusKm = this.minutesToRadiusKm(min);
        const label = min >= 1440 ? Math.round(min / 1440) + 'd' : Math.round(min / 60) + 't';
        const circle = this.generateCircleGeoJSON(this.originLat, this.originLng, radiusKm, label);
        allFeatures = allFeatures.concat(circle.features);
      }

      if (allFeatures.length > 0) {
        this.renderContours({ type: 'FeatureCollection', features: allFeatures });
      } else {
        this.clearLayers();
      }
    } catch (err) {
      Logger.log('Isochrone feil:', err);
      showNotification('Feil ved dekningsberegning', 'error');
    }
  },

  renderContours(geojson) {
    this.clearLayers();
    if (!map || !geojson) return;

    // Mapbox Isochrone returns FeatureCollection, features sorted by contour value (largest first)
    const features = geojson.features || [];

    features.forEach((feature, idx) => {
      const sourceId = `isochrone-src-${idx}`;
      const fillId = `isochrone-fill-${idx}`;
      const lineId = `isochrone-line-${idx}`;

      map.addSource(sourceId, { type: 'geojson', data: feature });
      map.addLayer({
        id: fillId,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': this.contourColors[idx] || '#3b82f6',
          'fill-opacity': this.contourOpacities[idx] || 0.1
        }
      });
      map.addLayer({
        id: lineId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': this.contourColors[idx] || '#3b82f6',
          'line-width': 2,
          'line-opacity': 0.6
        }
      });

      this.layers.push(sourceId, fillId, lineId);
    });
  },

  clearLayers() {
    if (!map) return;
    for (const id of this.layers) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of this.layers) {
      if (map.getSource(id)) map.removeSource(id);
    }
    this.layers = [];
  },

  // Re-render after map style change (satellite/dark toggle)
  onStyleLoad() {
    if (this.active) {
      this.fetchAndRender();
    }
  }
};

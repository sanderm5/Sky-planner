// ========================================
// ROUTE SERVICE
// Shared API layer for route optimization, directions, and matrix
// Uses apiFetch for auth/CSRF handling
// ========================================

const RouteService = {
  // In-memory cache with TTL
  _cache: new Map(),
  _cacheTTL: 5 * 60 * 1000, // 5 minutes

  _cacheKey(type, data) {
    return type + ':' + JSON.stringify(data);
  },

  _getCached(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this._cache.delete(key);
      return null;
    }
    return entry.value;
  },

  _setCache(key, value) {
    this._cache.set(key, { value, expires: Date.now() + this._cacheTTL });
  },

  clearCache() {
    this._cache.clear();
  },

  /**
   * Build VROOM optimization request body
   * @param {Array} stops - [{lng, lat, estimertTid?}]
   * @param {{lng, lat}} routeStart - Company address
   * @returns {object} VROOM request body
   */
  buildVroomRequest(stops, routeStart) {
    return {
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
  },

  /**
   * Optimize stop order via VROOM API
   * @param {Array} stops - Customers/stops with lng, lat, estimertTid
   * @param {{lng, lat}} routeStart - Company address
   * @returns {object|null} VROOM route result or null on failure
   */
  async optimize(stops, routeStart) {
    const cacheCoords = stops.map(s => [s.lng, s.lat]);
    const key = this._cacheKey('optimize', { stops: cacheCoords, start: [routeStart.lng, routeStart.lat] });
    const cached = this._getCached(key);
    if (cached) return cached;

    try {
      const body = this.buildVroomRequest(stops, routeStart);
      const response = await apiFetch('/api/routes/optimize', {
        method: 'POST',
        body: JSON.stringify(body)
      });

      if (!response.ok) return null;

      const result = await response.json();
      const data = result.data || result;
      const route = data.routes?.[0];
      if (!route?.steps) return null;

      this._setCache(key, route);
      return route;
    } catch (err) {
      console.warn('[RouteService.optimize] Failed:', err);
      return null;
    }
  },

  /**
   * Get driving directions (road-following geometry) via ORS
   * @param {Array} coordinates - [[lng, lat], ...] in order
   * @returns {object|null} GeoJSON Feature or null
   */
  async directions(coordinates) {
    const key = this._cacheKey('directions', coordinates);
    const cached = this._getCached(key);
    if (cached) return cached;

    try {
      const response = await apiFetch('/api/routes/directions', {
        method: 'POST',
        body: JSON.stringify({ coordinates })
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        if (errBody.error?.message?.includes('Could not find routable point')) {
          throw new Error('En eller flere kunder har koordinater som ikke er nær en vei.');
        }
        throw new Error(errBody.error?.message || 'Kunne ikke beregne rute');
      }

      const rawData = await response.json();
      const geoData = rawData.data || rawData;
      const feature = geoData.features?.[0] || null;

      if (feature) this._setCache(key, feature);
      return feature;
    } catch (err) {
      console.warn('[RouteService.directions] Failed:', err);
      throw err;
    }
  },

  /**
   * Extract driving summary from ORS feature
   * @param {object} feature - GeoJSON Feature from ORS
   * @returns {{drivingSeconds: number, distanceMeters: number}}
   */
  extractSummary(feature) {
    let drivingSeconds = 0;
    let distanceMeters = 0;

    if (feature?.properties?.summary) {
      drivingSeconds = feature.properties.summary.duration || 0;
      distanceMeters = feature.properties.summary.distance || 0;
    }
    // Fallback: sum segments
    if (drivingSeconds === 0 && feature?.properties?.segments?.length > 0) {
      for (const seg of feature.properties.segments) {
        drivingSeconds += seg.duration || 0;
        distanceMeters += seg.distance || 0;
      }
    }

    return { drivingSeconds, distanceMeters };
  },

  /**
   * Build coordinate array for directions: start → stops → start
   * @param {Array} stops - [{lng, lat}]
   * @param {{lng, lat}} routeStart
   * @returns {Array} [[lng, lat], ...]
   */
  buildDirectionsCoords(stops, routeStart) {
    return [
      [routeStart.lng, routeStart.lat],
      ...stops.map(s => [s.lng, s.lat]),
      [routeStart.lng, routeStart.lat]
    ];
  },

  /**
   * Reorder stops array based on VROOM result
   * @param {Array} stops - Original stops array
   * @param {object} vroomRoute - VROOM route result (with steps)
   * @returns {Array} Reordered stops
   */
  reorderByVroom(stops, vroomRoute) {
    const jobSteps = vroomRoute.steps.filter(s => s.type === 'job');
    const optimized = jobSteps.map(step => stops[step.job - 1]).filter(Boolean);
    return optimized.length === stops.length ? optimized : stops;
  },

  /**
   * Format duration for display
   * @param {number} seconds
   * @returns {string} e.g. "1t 23min" or "23 min"
   */
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}t ${minutes}min` : `${minutes} min`;
  },

  /**
   * Format distance for display
   * @param {number} meters
   * @returns {string} e.g. "12.3"
   */
  formatKm(meters) {
    return (meters / 1000).toFixed(1);
  },

  /**
   * Calculate ETA for each stop from VROOM route data
   * @param {object} vroomRoute - VROOM route result (with steps)
   * @param {number} [startMinutes=480] - Start time in minutes from midnight (default 08:00)
   * @returns {Array|null} [{eta: '09:45', arrivalMin}] per job stop, or null
   */
  calculateETAs(vroomRoute, startMinutes = 480) {
    if (!vroomRoute?.steps) return null;
    const jobs = vroomRoute.steps.filter(s => s.type === 'job');
    if (jobs.length === 0) return null;
    return jobs.map(step => {
      const arrivalMin = startMinutes + Math.round(step.arrival / 60);
      const h = Math.floor(arrivalMin / 60);
      const m = arrivalMin % 60;
      return { eta: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, arrivalMin };
    });
  }
};

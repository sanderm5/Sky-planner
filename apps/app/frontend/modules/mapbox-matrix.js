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

// ========================================
// ROUTE RENDERING
// Shared map rendering for route visualization
// Depends on: map-compat.js (clearRoute, createMarkerElement, drawRouteGeoJSON, boundsFromLatLngArray)
// Depends on: route-service.js (RouteService)
// ========================================

/**
 * Render a route on the map: directions line + numbered markers + fitBounds
 * Fetches road-following geometry from ORS, falls back to straight lines.
 *
 * @param {Array} stops - Ordered [{lng, lat, navn?, adresse?, estimertTid?}]
 * @param {{lng, lat}} routeStart - Company address
 * @param {object} [options]
 * @param {boolean} [options.skipDirections] - Skip ORS call, use straight lines
 * @param {string} [options.color] - Route line color (default '#2563eb')
 * @param {number} [options.width] - Route line width (default 5)
 * @param {number} [options.opacity] - Route line opacity (default 0.85)
 * @param {string} [options.startLabel] - Label for start marker popup
 * @returns {{drivingSeconds: number, distanceMeters: number, feature: object|null}}
 */
async function renderRouteOnMap(stops, routeStart, options = {}) {
  clearRoute();

  const startLngLat = [routeStart.lng, routeStart.lat];
  const lineOpts = {
    color: options.color || '#2563eb',
    width: options.width || 5,
    opacity: options.opacity || 0.85
  };

  let feature = null;
  let drivingSeconds = 0;
  let distanceMeters = 0;

  // Try road-following geometry from ORS
  if (!options.skipDirections) {
    try {
      const coords = RouteService.buildDirectionsCoords(stops, routeStart);
      feature = await RouteService.directions(coords);
    } catch (err) {
      console.warn('[renderRouteOnMap] Directions failed:', err);
    }
  }

  // Draw route line
  if (feature?.geometry?.coordinates?.length > 2) {
    try {
      const geomType = feature.geometry.type;
      let routeCoords;
      if (geomType === 'MultiLineString') {
        routeCoords = feature.geometry.coordinates.flat();
      } else {
        routeCoords = feature.geometry.coordinates;
      }
      if (routeCoords.length > 2 && !isNaN(routeCoords[0][0])) {
        drawRouteGeoJSON(routeCoords, lineOpts);
      } else {
        drawStraightFallback(stops, startLngLat, lineOpts);
      }
    } catch (e) {
      console.warn('[renderRouteOnMap] GeoJSON draw failed:', e);
      drawStraightFallback(stops, startLngLat, lineOpts);
    }

    // Extract summary
    const summary = RouteService.extractSummary(feature);
    drivingSeconds = summary.drivingSeconds;
    distanceMeters = summary.distanceMeters;
  } else {
    drawStraightFallback(stops, startLngLat, lineOpts);
  }

  // Add start marker (company location)
  const startEl = createMarkerElement('route-marker route-start', '<i aria-hidden="true" class="fas fa-home"></i>', [30, 30]);
  const startLabel = options.startLabel || appConfig.routeStartAddress || 'Kontor';
  const startMarker = new mapboxgl.Marker({ element: startEl, anchor: 'center' })
    .setLngLat(startLngLat)
    .setPopup(new mapboxgl.Popup({ offset: 15 }).setHTML(`<strong>Start:</strong><br>${escapeHtml(startLabel)}`))
    .addTo(map);
  routeMarkers.push(startMarker);

  // Add numbered markers for each stop (with optional ETA labels)
  stops.forEach((stop, index) => {
    const eta = options.etaData?.[index]?.eta || '';
    const label = eta
      ? `<span class="route-num">${index + 1}</span><span class="route-eta">${eta}</span>`
      : `${index + 1}`;
    const size = eta ? [30, 42] : [30, 30];
    const el = createMarkerElement('route-marker' + (eta ? ' has-eta' : ''), label, size);
    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([stop.lng, stop.lat])
      .addTo(map);
    routeMarkers.push(marker);
  });

  // Fit map to route bounds
  const allPoints = [[routeStart.lat, routeStart.lng], ...stops.map(s => [s.lat, s.lng])];
  const bounds = boundsFromLatLngArray(allPoints);
  map.fitBounds(bounds, { padding: 50 });

  return { drivingSeconds, distanceMeters, feature };
}

/**
 * Draw straight dashed lines as fallback when ORS directions unavailable
 */
function drawStraightFallback(stops, startLngLat, lineOpts) {
  const lineCoords = [
    startLngLat,
    ...stops.map(s => [s.lng, s.lat]),
    startLngLat
  ];
  drawRouteGeoJSON(lineCoords, { ...lineOpts, opacity: 0.7, dasharray: [10, 8] });
}

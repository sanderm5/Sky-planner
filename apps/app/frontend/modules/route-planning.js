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

  planRouteBtn.classList.add('loading');
  planRouteBtn.disabled = true;

  // Get start location from config (company address)
  const startLocation = [
    appConfig.routeStartLng || 17.65274,
    appConfig.routeStartLat || 69.06888
  ];

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
    const startLocation = [
      appConfig.routeStartLng || 17.65274,
      appConfig.routeStartLat || 69.06888
    ];
    const startLngLat = [appConfig.routeStartLng || 17.65274, appConfig.routeStartLat || 69.06888];

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

  const startLocation = [
    appConfig.routeStartLng || 17.65274,
    appConfig.routeStartLat || 69.06888
  ];
  const startLngLat = [appConfig.routeStartLng || 17.65274, appConfig.routeStartLat || 69.06888];

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
  const startLat = appConfig.routeStartLat || 69.06888;
  const startLng = appConfig.routeStartLng || 17.65274;

  if (isIOS) {
    window.open(`https://maps.apple.com/?saddr=${startLat},${startLng}&daddr=${lat},${lng}&dirflg=d`, '_blank');
  } else {
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLng}&destination=${lat},${lng}&travelmode=driving`, '_blank');
  }

  closeMapPopup();
}

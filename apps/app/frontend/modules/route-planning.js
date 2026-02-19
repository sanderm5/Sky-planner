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

    // Use server-side proxy for route optimization (protects API key)
    const optimizeHeaders = {
      'Content-Type': 'application/json',
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      optimizeHeaders['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/routes/optimize', {
      method: 'POST',
      headers: optimizeHeaders,
      credentials: 'include',
      body: JSON.stringify({
        jobs: selectedCustomerData.map((c, i) => ({
          id: i + 1,
          location: [c.lng, c.lat],
          service: 1800 // 30 min per kunde
        })),
        vehicles: [{
          id: 1,
          profile: 'driving-car',
          start: startLocation,  // Always start from company address
          end: startLocation     // Return to company address
        }]
      })
    });

    if (!response.ok) {
      // Fallback to simple directions if optimization fails
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

      // Show toast with route summary
      const hours = Math.floor(route.duration / 3600);
      const minutes = Math.floor((route.duration % 3600) / 60);
      const km = (route.distance / 1000).toFixed(1);
      const timeStr = hours > 0 ? `${hours}t ${minutes}min` : `${minutes} min`;
      showNotification(`Rute beregnet: ${orderedCustomers.length} stopp, ${km} km, ~${timeStr}`);
    }
  } catch (error) {
    console.error('Ruteplanlegging feil:', error);
    // Try simple route as fallback
    await planSimpleRoute(customers.filter(c => selectedCustomers.has(c.id) && c.lat && c.lng));
  } finally {
    planRouteBtn.classList.remove('loading');
    planRouteBtn.disabled = false;
  }
}

// Simple route without optimization
async function planSimpleRoute(customerData) {
  try {
    // Get start location from config (company address)
    const startLocation = [
      appConfig.routeStartLng || 17.65274,
      appConfig.routeStartLat || 69.06888
    ];
    const startLatLng = [appConfig.routeStartLat || 69.06888, appConfig.routeStartLng || 17.65274];

    // Build coordinates: start -> customers -> start
    const coordinates = [
      startLocation,
      ...customerData.map(c => [c.lng, c.lat]),
      startLocation  // Return to start
    ];

    // Use server-side proxy for directions (protects API key)
    const directionsHeaders = {
      'Content-Type': 'application/json',
    };
    const dirCsrfToken = getCsrfToken();
    if (dirCsrfToken) {
      directionsHeaders['X-CSRF-Token'] = dirCsrfToken;
    }
    const response = await fetch('/api/routes/directions', {
      method: 'POST',
      headers: directionsHeaders,
      credentials: 'include',
      body: JSON.stringify({
        coordinates: coordinates
      })
    });

    const rawData = await response.json();

    if (!response.ok) {
      // Parse ORS error message
      if (rawData.error && rawData.error.message) {
        if (rawData.error.message.includes('Could not find routable point')) {
          throw new Error('En eller flere kunder har koordinater som ikke er nær en vei. Velg andre kunder eller oppdater koordinatene.');
        }
        throw new Error(rawData.error.message);
      }
      throw new Error('Kunne ikke beregne rute');
    }

    // Handle wrapped ({ success, data }) or raw ORS response
    const geoData = rawData.data || rawData;

    if (geoData.features && geoData.features.length > 0) {
      const feature = geoData.features[0];
      drawRouteFromGeoJSON(feature);

      // Add start marker (company location)
      const startIcon = L.divIcon({
        className: 'route-marker route-start',
        html: '<i class="fas fa-home"></i>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      const startMarker = L.marker(startLatLng, { icon: startIcon }).addTo(map);
      startMarker.bindPopup(`<strong>Start:</strong><br>${appConfig.routeStartAddress || 'Brøstadveien 343'}`);
      routeMarkers.push(startMarker);

      // Add numbered markers for customers
      customerData.forEach((customer, index) => {
        const icon = L.divIcon({
          className: 'route-marker',
          html: `${index + 1}`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });

        const marker = L.marker([customer.lat, customer.lng], { icon }).addTo(map);
        routeMarkers.push(marker);
      });

      // Fit map to route (include start location)
      const allPoints = [startLatLng, ...customerData.map(c => [c.lat, c.lng])];
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [50, 50] });

      // Extract summary from segments fallback
      let duration = feature.properties?.summary?.duration || 0;
      let distance = feature.properties?.summary?.distance || 0;
      if (duration === 0 && feature.properties?.segments?.length > 0) {
        for (const seg of feature.properties.segments) {
          duration += seg.duration || 0;
          distance += seg.distance || 0;
        }
      }

      // Show toast with route summary
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

  // Get start location from config (company address)
  const startLocation = [
    appConfig.routeStartLng || 17.65274,
    appConfig.routeStartLat || 69.06888
  ];
  const startLatLng = [appConfig.routeStartLat || 69.06888, appConfig.routeStartLng || 17.65274];

  // Build coordinates: start -> customers -> start
  const coordinates = [
    startLocation,
    ...orderedCustomers.map(c => [c.lng, c.lat]),
    startLocation  // Return to start
  ];

  try {
    // Use server-side proxy for directions (protects API key)
    const directionsHeaders = {
      'Content-Type': 'application/json',
    };
    const dirCsrfToken = getCsrfToken();
    if (dirCsrfToken) {
      directionsHeaders['X-CSRF-Token'] = dirCsrfToken;
    }
    const response = await fetch('/api/routes/directions', {
      method: 'POST',
      headers: directionsHeaders,
      credentials: 'include',
      body: JSON.stringify({ coordinates })
    });

    const rawData = await response.json();
    // Handle wrapped ({ success, data }) or raw ORS response
    const geoData = rawData.data || rawData;

    if (geoData.features && geoData.features.length > 0) {
      drawRouteFromGeoJSON(geoData.features[0]);
    }
  } catch (error) {
    console.error('Tegning av rute feil:', error);
  }

  // Add start marker (company location)
  const startIcon = L.divIcon({
    className: 'route-marker route-start',
    html: '<i class="fas fa-home"></i>',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
  const startMarker = L.marker(startLatLng, { icon: startIcon }).addTo(map);
  startMarker.bindPopup(`<strong>Start:</strong><br>${appConfig.routeStartAddress || 'Brøstadveien 343'}`);
  routeMarkers.push(startMarker);

  // Add numbered markers for customers
  orderedCustomers.forEach((customer, index) => {
    const icon = L.divIcon({
      className: 'route-marker',
      html: `${index + 1}`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const marker = L.marker([customer.lat, customer.lng], { icon }).addTo(map);
    routeMarkers.push(marker);
  });

  // Fit map to route (include start location)
  const allPoints = [startLatLng, ...orderedCustomers.map(c => [c.lat, c.lng])];
  const bounds = L.latLngBounds(allPoints);
  map.fitBounds(bounds, { padding: [50, 50] });
}

// Draw route from GeoJSON
function drawRouteFromGeoJSON(feature) {
  clearRoute();

  if (feature && feature.geometry && feature.geometry.coordinates) {
    // Convert GeoJSON [lng, lat] to Leaflet [lat, lng] and draw polyline directly
    const routeCoords = feature.geometry.coordinates.map(c => [c[1], c[0]]);
    routeLayer = L.polyline(routeCoords, {
      color: '#2563eb',
      weight: 6,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Bring route to front
    routeLayer.bringToFront();
  }
}

// Clear route from map
function clearRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  routeMarkers.forEach(m => map.removeLayer(m));
  routeMarkers = [];
}

// Current route data for saving (used by weekplan)
let currentRouteData = null;

// Navigate to a single customer using device maps app
function navigateToCustomer(lat, lng, _name) {
  // Detect if iOS or Android
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const startLat = appConfig.routeStartLat || 69.06888;
  const startLng = appConfig.routeStartLng || 17.65274;

  if (isIOS) {
    // Apple Maps
    const url = `https://maps.apple.com/?saddr=${startLat},${startLng}&daddr=${lat},${lng}&dirflg=d`;
    window.open(url, '_blank');
  } else {
    // Google Maps (works on Android and desktop)
    const url = `https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLng}&destination=${lat},${lng}&travelmode=driving`;
    window.open(url, '_blank');
  }

  // Close popup
  map.closePopup();
}

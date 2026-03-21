// ========================================
// ROUTE PLANNING
// Ad-hoc route planning from customer selection
// Depends on: route-service.js (RouteService), route-rendering.js (renderRouteOnMap)
// ========================================

async function planRoute() {
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

  try {
    // Try VROOM optimization first
    const vroomRoute = await RouteService.optimize(selectedCustomerData, routeStart);

    if (vroomRoute) {
      const orderedCustomers = RouteService.reorderByVroom(selectedCustomerData, vroomRoute);
      await renderRouteOnMap(orderedCustomers, routeStart);

      const timeStr = RouteService.formatDuration(vroomRoute.duration);
      const km = RouteService.formatKm(vroomRoute.distance);
      showNotification(`Rute beregnet: ${orderedCustomers.length} stopp, ${km} km, ~${timeStr}`);
    } else {
      // Fallback: simple directions without optimization
      await planSimpleRoute(selectedCustomerData, routeStart);
    }
  } catch (error) {
    console.error('Ruteplanlegging feil:', error);
    await planSimpleRoute(selectedCustomerData, routeStart);
  } finally {
    planRouteBtn.classList.remove('loading');
    planRouteBtn.disabled = false;
  }
}

// Simple route without optimization (fallback)
async function planSimpleRoute(customerData, routeStart) {
  if (!routeStart) {
    routeStart = getRouteStartLocation();
    if (!routeStart) {
      showMessage('Sett firmaadresse i admin-innstillinger for å bruke ruteplanlegging.', 'warning');
      return;
    }
  }

  try {
    const result = await renderRouteOnMap(customerData, routeStart);

    const timeStr = RouteService.formatDuration(result.drivingSeconds);
    const km = RouteService.formatKm(result.distanceMeters);
    showNotification(`Rute beregnet: ${customerData.length} stopp, ${km} km, ~${timeStr}`);
  } catch (error) {
    console.error('Enkel rute feil:', error);
    showMessage(error.message || 'Kunne ikke beregne rute.', 'error');
  }
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

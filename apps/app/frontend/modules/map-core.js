// ========================================
// SPA VIEW MANAGEMENT
// ========================================

// Get Mapbox access token from server config
function getMapboxToken() {
  if (appConfig.mapboxAccessToken) {
    return appConfig.mapboxAccessToken;
  }
  Logger.error('Mapbox token mangler - sett MAPBOX_ACCESS_TOKEN i server-miljøvariabler');
  return '';
}

// Initialize the shared map (used for both login background and app)
// Get map tile layer - Mapbox Satellite Streets (satellite with roads and labels)
function getMapTileUrl() {
  // Mapbox Satellite Streets - satellittbilder med veier og stedsnavn
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${getMapboxToken()}`;
}

// Get attribution for current tile layer
function getMapAttribution() {
  return '&copy; <a href="https://mapbox.com/">Mapbox</a> &copy; <a href="https://openstreetmap.org/">OpenStreetMap</a>';
}

// Variable to store current tile layer for later switching
let currentTileLayer = null;

// Refresh map tiles when Mapbox token becomes available (e.g. after auth)
function refreshMapTiles() {
  if (!map || !currentTileLayer) return;
  const token = getMapboxToken();
  if (!token) return;
  // Skip if current layer already uses the correct token
  if (currentTileLayer._url && currentTileLayer._url.includes(token)) return;
  Logger.log('Refreshing map tiles with updated Mapbox token');
  map.removeLayer(currentTileLayer);
  currentTileLayer = L.tileLayer(getMapTileUrl(), {
    maxZoom: 19,
    tileSize: 512,
    zoomOffset: -1,
    attribution: getMapAttribution()
  }).addTo(map);
}

// Map mode: 'satellite' only (dark mode removed)
let mapMode = 'satellite';

// Toggle between street map and satellite view
function toggleNightMode() {
  if (!map || !currentTileLayer) return;

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
      // Switch to Mapbox Satellite Streets (satellite with all roads and labels)
      map.removeLayer(currentTileLayer);
      currentTileLayer = L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${getMapboxToken()}`, {
        maxZoom: 19,
        tileSize: 512,
        zoomOffset: -1,
        attribution: '&copy; Mapbox'
      }).addTo(map);

      mapMode = 'satellite';
      btn?.classList.add('satellite-active');
      if (icon) {
        icon.className = 'fas fa-sun';
      }
      btn?.setAttribute('title', 'Bytt til mørkt kart');
    } else {
      // Switch to Mapbox Navigation Night (dark with visible roads)
      map.removeLayer(currentTileLayer);
      currentTileLayer = L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/tiles/{z}/{x}/{y}?access_token=${getMapboxToken()}`, {
        maxZoom: 19,
        tileSize: 512,
        zoomOffset: -1,
        attribution: '&copy; Mapbox'
      }).addTo(map);

      mapMode = 'dark';
      btn?.classList.remove('satellite-active');
      if (icon) {
        icon.className = 'fas fa-moon';
      }
      btn?.setAttribute('title', 'Bytt til satellittkart');
    }

    // Fade back in
    setTimeout(() => {
      mapContainer.style.opacity = '1';
      if (btn) btn.disabled = false;
    }, 100);
  }, 400);
}

// Office location marker (glowing house icon)
let officeMarker = null;

function initSharedMap() {
  const mapEl = document.getElementById('map');
  if (mapEl && !map) {
    // Start zoomed in on Troms region (company location) for login view
    map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      keyboard: false
    }).setView([69.06888, 17.65274], 11);

    // Always use Mapbox satellite tiles
    const tileUrl = getMapTileUrl();
    Logger.log('Map tile URL:', tileUrl);

    currentTileLayer = L.tileLayer(tileUrl, {
      maxZoom: 19,
      tileSize: 512,
      zoomOffset: -1,
      attribution: getMapAttribution()
    }).addTo(map);

    // Add glowing office marker (Brøstadveien 343, 9311 Brøstadbotn)
    const officeIcon = L.divIcon({
      className: 'office-marker-glow',
      html: `
        <div class="office-marker-container">
          <div class="office-glow-ring"></div>
          <div class="office-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
        </div>
      `,
      iconSize: [60, 60],
      iconAnchor: [30, 30]
    });

    officeMarker = L.marker([69.06888, 17.65274], {
      icon: officeIcon,
      interactive: false,  // Not clickable - just visual decoration
      keyboard: false
    }).addTo(map);

    // Mark decorative marker as hidden from assistive tech
    const el = officeMarker.getElement();
    if (el) {
      el.setAttribute('aria-hidden', 'true');
      el.removeAttribute('tabindex');
      el.removeAttribute('role');
    }
  }
}

// Initialize login view (just set up form handler, map is already initialized)
function initLoginView() {
  // Set up login form handler
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

// Initialize map features (clustering, borders, etc.)
// Note: The base map is created in initSharedMap() at page load
let mapInitialized = false;
function initMap() {
  if (mapInitialized) return; // Guard against double initialization (login + already-authenticated paths)
  mapInitialized = true;
  Logger.log('initMap() starting, map exists:', !!map);
  // Map should already exist from initSharedMap()
  if (!map) {
    mapInitialized = false; // Reset so it can retry
    console.error('Map not initialized - call initSharedMap() first');
    return;
  }

  // Add Norway border overlay from Kartverket
  addNorwayBorder();

  // Add scale control
  L.control.scale({
    metric: true,
    imperial: false,
    position: 'bottomleft'
  }).addTo(map);

  // Add "My location" button
  const LocateControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function() {
      const btn = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      btn.innerHTML = '<a href="#" title="Min posisjon" role="button" aria-label="Min posisjon" style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;font-size:16px;"><i class="fas fa-location-crosshairs"></i></a>';
      let locationMarker = null;
      L.DomEvent.on(btn, 'click', function(e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        map.locate({ setView: true, maxZoom: 15 });
      });
      map.on('locationfound', function(e) {
        if (locationMarker) map.removeLayer(locationMarker);
        locationMarker = L.circleMarker(e.latlng, {
          radius: 8, fillColor: '#4285F4', fillOpacity: 1,
          color: '#fff', weight: 2
        }).addTo(map).bindPopup('Du er her');
      });
      map.on('locationerror', function() {
        showNotification('Kunne ikke finne posisjonen din', 'error');
      });
      return btn;
    }
  });
  new LocateControl().addTo(map);

  // Initialize marker cluster group - reduced radius for better overview
  const clusterRadius = appConfig.mapClusterRadius || 60;
  markerClusterGroup = L.markerClusterGroup({
    maxClusterRadius: clusterRadius,
    iconCreateFunction: createClusterIcon,
    // Disable clustering at zoom 14 - keep clustering longer for better performance
    disableClusteringAtZoom: 14,
    // Enable spiderfy only at max zoom (not on every zoom)
    spiderfyOnMaxZoom: true,
    spiderfyOnEveryZoom: false,
    spiderfyDistanceMultiplier: 2.5,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true, // Zoom to bounds instead of spiderfying immediately
    // Animate cluster split
    animate: true,
    animateAddingMarkers: false,
    // Keep single markers visible (not clustered alone)
    singleMarkerMode: false
  });
  map.addLayer(markerClusterGroup);

  // Handle spiderfied markers - make them compact
  markerClusterGroup.on('spiderfied', (e) => {
    e.markers.forEach(marker => {
      if (marker._icon) {
        marker._icon.classList.add('spiderfied-marker');
      }
    });
  });

  markerClusterGroup.on('unspiderfied', (e) => {
    e.markers.forEach(marker => {
      if (marker._icon) {
        marker._icon.classList.remove('spiderfied-marker');
      }
    });
  });

  // Re-apply badges and focus styling on ANY map zoom/pan (new marker DOM elements appear)
  map.on('moveend', () => {
    requestAnimationFrame(() => {
      reapplyPlanBadges();
      if (wpFocusedMemberIds || wpRouteActive) applyTeamFocusToMarkers();
    });
  });
  markerClusterGroup.on('animationend', () => {
    reapplyPlanBadges();
    if (wpFocusedMemberIds || wpRouteActive) applyTeamFocusToMarkers();
  });

  Logger.log('initMap() markerClusterGroup created and added to map');

  // Handle cluster click - show popup with options
  markerClusterGroup.on('clusterclick', function(e) {
    const cluster = e.layer;
    const childMarkers = cluster.getAllChildMarkers();
    const customerIds = [];
    const customerNames = [];

    // Extract customer IDs from markers
    childMarkers.forEach(marker => {
      // Find customer ID by matching marker position
      for (const [id, m] of Object.entries(markers)) {
        if (m === marker) {
          customerIds.push(Number.parseInt(id));
          const customer = customers.find(c => c.id === Number.parseInt(id));
          if (customer) {
            customerNames.push(customer.navn);
          }
          break;
        }
      }
    });

    // Create popup content with options
    const areaNames = new Set();
    const typeCounts = {};  // el_type: Landbruk, Næring, etc.
    const driftCounts = {}; // brann_driftstype: Storfe, Sau, etc.
    const systemCounts = {}; // brann_system: Elotec, ICAS, etc.

    customerIds.forEach(id => {
      const customer = customers.find(c => c.id === id);
      if (customer) {
        if (customer.poststed) areaNames.add(customer.poststed);

        // Count el_type (Landbruk, Næring, Bolig, etc.)
        if (customer.el_type) typeCounts[customer.el_type] = (typeCounts[customer.el_type] || 0) + 1;

        // Count driftstype
        const drift = normalizeDriftstype(customer.brann_driftstype);
        if (drift) driftCounts[drift] = (driftCounts[drift] || 0) + 1;

        // Count brannsystem
        const system = normalizeBrannsystem(customer.brann_system);
        if (system) systemCounts[system] = (systemCounts[system] || 0) + 1;
      }
    });

    // Build category summary HTML
    let categoryHtml = '';
    const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const driftEntries = Object.entries(driftCounts).sort((a, b) => b[1] - a[1]);
    const systemEntries = Object.entries(systemCounts).sort((a, b) => b[1] - a[1]);

    if (typeEntries.length > 0 || driftEntries.length > 0 || systemEntries.length > 0) {
      categoryHtml = '<div class="cluster-categories">';
      if (typeEntries.length > 0) {
        categoryHtml += '<div class="cluster-category-group"><strong>Type:</strong> ';
        categoryHtml += typeEntries.map(([name, count]) => `<span class="cluster-tag type-tag clickable" data-action="filterByElType" data-value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</span>`).join(' ');
        categoryHtml += '</div>';
      }
      if (systemEntries.length > 0) {
        categoryHtml += '<div class="cluster-category-group"><strong>System:</strong> ';
        categoryHtml += systemEntries.map(([name, count]) => `<span class="cluster-tag system-tag clickable" data-action="filterByBrannsystem" data-value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</span>`).join(' ');
        categoryHtml += '</div>';
      }
      if (driftEntries.length > 0) {
        categoryHtml += '<div class="cluster-category-group"><strong>Drift:</strong> ';
        categoryHtml += driftEntries.map(([name, count]) => `<span class="cluster-tag drift-tag clickable" data-action="filterByDrift" data-value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</span>`).join(' ');
        categoryHtml += '</div>';
      }
      categoryHtml += '</div>';
    }

    const areaText = Array.from(areaNames).slice(0, 2).join(' / ') || 'Område';
    const popupContent = `
      <div class="cluster-popup">
        <h3>${escapeHtml(areaText)}</h3>
        <p><strong>${customerIds.length}</strong> kunder i dette området</p>
        ${categoryHtml}
        <div class="cluster-popup-actions">
          <button class="btn btn-primary btn-small" data-action="addClusterToRoute" data-customer-ids="${customerIds.join(',')}">
            <i class="fas fa-route"></i> Legg til rute
          </button>
          <button class="btn btn-secondary btn-small" data-action="zoomToCluster" data-lat="${e.latlng.lat}" data-lng="${e.latlng.lng}">
            <i class="fas fa-search-plus"></i> Zoom inn
          </button>
        </div>
        <div class="cluster-customer-list">
          ${customerNames.slice(0, 5).map(name => `<span class="cluster-customer-name">${escapeHtml(name)}</span>`).join('')}
          ${customerNames.length > 5 ? `<span class="cluster-more">+${customerNames.length - 5} flere...</span>` : ''}
        </div>
      </div>
    `;

    L.popup()
      .setLatLng(e.latlng)
      .setContent(popupContent)
      .openOn(map);
  });

  // Update marker labels visibility based on zoom level
  map.on('zoomend', updateMarkerLabelsVisibility);

  // Init area select (dra-for-å-velge)
  initAreaSelect();
}

// Show/hide marker labels based on zoom level
function updateMarkerLabelsVisibility() {
  const zoom = map.getZoom();
  const mapContainer = document.getElementById('map');

  // At low zoom levels (zoomed out), hide labels to reduce clutter
  // Show labels when zoomed in (zoom >= 10) so names and addresses are visible
  if (zoom < 10) {
    mapContainer.classList.add('hide-marker-labels');
  } else {
    mapContainer.classList.remove('hide-marker-labels');
  }
}

// Add Norway border visualization
function addNorwayBorder() {
  // Norge-Sverige grense (forenklet men synlig)
  const borderCoords = [
    [69.06, 20.55], // Treriksrøysa (Norge-Sverige-Finland)
    [68.95, 20.10],
    [68.45, 18.10],
    [68.15, 17.90],
    [67.95, 17.15],
    [67.50, 16.40],
    [66.60, 15.50],
    [66.15, 14.60],
    [65.10, 14.25],
    [64.15, 13.95],
    [63.70, 12.70],
    [62.65, 12.30],
    [61.80, 12.10],
    [61.00, 12.15],
    [59.80, 11.80],
    [59.10, 11.45],
    [58.95, 11.15]  // Svinesund
  ];

  // Grense som stiplet linje
  L.polyline(borderCoords, {
    color: '#ef4444',
    weight: 2,
    opacity: 0.7,
    dashArray: '8, 4'
  }).addTo(map);

  // Sverige-etikett (nærmere grensen i Troms-området)
  L.marker([68.5, 19.5], {
    icon: L.divIcon({
      className: 'country-label',
      html: '<span>SVERIGE</span>',
      iconSize: [100, 20]
    })
  }).addTo(map);

  // Dim overlay over Sverige (øst for grensen)
  L.polygon([
    [71.5, 20.5], [71.5, 32.0], [58.0, 32.0], [58.0, 11.0],
    [59.0, 11.5], [61.0, 12.2], [63.5, 12.5], [66.0, 14.5],
    [68.0, 17.5], [69.0, 20.0], [71.5, 20.5]
  ], {
    color: 'transparent',
    fillColor: '#000',
    fillOpacity: 0.25,
    interactive: false
  }).addTo(map);
}

// Create custom cluster icon with area name and warning count
function createClusterIcon(cluster) {
  const childMarkers = cluster.getAllChildMarkers();
  const areaNames = new Set();
  let warningCount = 0;

  // Collect all unique area names, count warnings and planned markers
  const plannedByUser = new Map(); // initials → count
  let plannedCount = 0;
  let focusedInCluster = 0; // how many of the focused member's markers are in this cluster
  let routeStopsInCluster = 0; // how many route stop markers are in this cluster

  childMarkers.forEach(marker => {
    const customerData = marker.options.customerData;
    if (customerData) {
      if (customerData.poststed) {
        areaNames.add(customerData.poststed);
      }
      if (customerData.hasWarning) {
        warningCount++;
      }
      if (customerData.planned) {
        plannedCount++;
        const initials = customerData.plannedInitials || '?';
        plannedByUser.set(initials, (plannedByUser.get(initials) || 0) + 1);
      }
      // Check if this marker belongs to the focused team member
      if (wpFocusedMemberIds && customerData.id != null && wpFocusedMemberIds.has(Number(customerData.id))) {
        focusedInCluster++;
      }
      // Check if this marker is a route stop
      if (wpRouteStopIds && customerData.id != null && wpRouteStopIds.has(Number(customerData.id))) {
        routeStopsInCluster++;
      }
    }
  });

  const size = childMarkers.length;
  const warningBadge = warningCount > 0 ? `<div class="cluster-warning">${warningCount}</div>` : '';

  // Plan badge on cluster: shows initials and count
  let planBadge = '';
  if (plannedCount > 0) {
    const entries = Array.from(plannedByUser.entries());
    const badgeText = entries.map(([init, count]) => `${init} ${count}`).join(' · ');
    planBadge = `<div class="cluster-plan-badge">${badgeText}</div>`;
  }

  // Use "Region Nord" only when nearly all customers are clustered (zoomed fully out)
  let areaText;
  if (size >= 100) {
    areaText = 'Region Nord';
  } else {
    areaText = Array.from(areaNames).slice(0, 2).join(' / ');
  }

  // Size class determines color gradient (green → blue → orange → red)
  let sizeClass = 'cluster-small';
  if (size >= 50) sizeClass = 'cluster-xlarge';
  else if (size >= 20) sizeClass = 'cluster-large';
  else if (size >= 8) sizeClass = 'cluster-medium';

  // Dim cluster if route/focus is active and this cluster has none of the highlighted markers
  let dimStyle = '';
  if (wpRouteActive && wpRouteStopIds) {
    dimStyle = routeStopsInCluster === 0 ? 'opacity:0.3;filter:grayscale(0.8);pointer-events:none;' : '';
  } else if (wpFocusedMemberIds) {
    dimStyle = focusedInCluster === 0 ? 'opacity:0.15;filter:grayscale(1);pointer-events:none;' : '';
  }

  return L.divIcon({
    html: `
      <div class="cluster-icon ${sizeClass}" style="${dimStyle}">
        <div class="cluster-count">${wpFocusedMemberIds && focusedInCluster > 0 ? focusedInCluster : size}</div>
        <div class="cluster-area">${areaText}</div>
        ${warningBadge}
        ${planBadge}
      </div>
    `,
    className: 'custom-cluster',
    iconSize: [70, 70],
    iconAnchor: [35, 35]
  });
}

// Generate popup content lazily (performance optimization - only called when popup opens)
function generatePopupContent(customer) {
  const isSelected = selectedCustomers.has(customer.id);
  const controlStatus = getControlStatus(customer);
  const hasEmail = customer.epost && customer.epost.trim() !== '';

  // Generate dynamic popup control info based on selected industry
  const kontrollInfoHtml = serviceTypeRegistry.renderPopupControlInfo(customer, controlStatus);

  // Generate dynamic industry-specific fields
  const industryFieldsHtml = serviceTypeRegistry.renderPopupIndustryFields(customer);

  // Generate custom organization fields from Excel import
  const customFieldsHtml = renderPopupCustomFields(customer);

  // Fallback: show el_type, brann_system, brann_driftstype directly if not rendered by service type registry
  let directFieldsHtml = '';
  if (!industryFieldsHtml) {
    if (customer.el_type) directFieldsHtml += `<p><strong>Type:</strong> ${escapeHtml(customer.el_type)}</p>`;
    if (customer.brann_system) directFieldsHtml += `<p><strong>Brannsystem:</strong> ${escapeHtml(customer.brann_system)}</p>`;
    if (customer.brann_driftstype) directFieldsHtml += `<p><strong>Driftstype:</strong> ${escapeHtml(customer.brann_driftstype)}</p>`;
  }
  // Show org.nr. from dedicated field or fallback to notater tag
  const orgNr = customer.org_nummer || (customer.notater && customer.notater.match(/\[ORGNR:(\d{9})\]/)?.[1]);
  if (orgNr) directFieldsHtml += `<p><strong>Org.nr:</strong> ${escapeHtml(orgNr)}</p>`;
  // Show Tripletex kundenummer and prosjektnummer if present
  if (customer.kundenummer) directFieldsHtml += `<p><strong>Kundenr:</strong> ${escapeHtml(customer.kundenummer)}</p>`;
  if (customer.prosjektnummer) directFieldsHtml += `<p><strong>Prosjektnr:</strong> ${escapeHtml(customer.prosjektnummer)}</p>`;
  if (customer.estimert_tid) directFieldsHtml += `<p><strong>Est. tid:</strong> ${customer.estimert_tid} min</p>`;

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

  return `
    ${presenceBanner}
    <h3>${escapeHtml(customer.navn)}</h3>
    <p><strong>Kategori:</strong> ${escapeHtml(customer.kategori || 'Annen')}</p>
    ${industryFieldsHtml}
    ${directFieldsHtml}
    ${customFieldsHtml}
    <p>${escapeHtml(customer.adresse)}</p>
    <p>${escapeHtml(customer.postnummer || '')} ${escapeHtml(customer.poststed || '')}</p>
    ${customer.telefon ? `<p>Tlf: ${escapeHtml(customer.telefon)}</p>` : ''}
    ${customer.epost ? `<p>E-post: ${escapeHtml(customer.epost)}</p>` : ''}
    ${kontrollInfoHtml}
    ${notatHtml}
    <div class="popup-actions">
      <button class="btn btn-small btn-navigate" data-action="navigateToCustomer" data-lat="${customer.lat}" data-lng="${customer.lng}" data-name="${escapeHtml(customer.navn)}">
        <i class="fas fa-directions"></i> Naviger
      </button>
      <button class="btn btn-small btn-primary" data-action="toggleCustomerSelection" data-customer-id="${customer.id}">
        ${isSelected ? 'Fjern fra rute' : 'Legg til rute'}
      </button>
      <div class="popup-btn-group">
        <button class="btn btn-small btn-calendar" data-action="quickAddToday" data-customer-id="${customer.id}" data-customer-name="${escapeHtml(customer.navn)}">
          <i class="fas fa-calendar-plus"></i> I dag
        </button>
        <button class="btn btn-small btn-calendar" data-action="showCalendarQuickMenu" data-customer-id="${customer.id}" data-customer-name="${escapeHtml(customer.navn)}">
          <i class="fas fa-chevron-down" style="font-size:9px"></i>
        </button>
      </div>
      ${splitViewOpen && splitViewState.activeDay ? `
      <button class="btn btn-small btn-calendar" data-action="quickAddToSplitDay" data-customer-id="${customer.id}" data-customer-name="${escapeHtml(customer.navn)}" style="background:var(--color-primary);color:#fff;width:100%;">
        <i class="fas fa-calendar-plus"></i> Legg til ${new Date(splitViewState.activeDay + 'T00:00:00').toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })}
      </button>
      ` : ''}
      <button class="btn btn-small btn-success" data-action="quickMarkVisited" data-customer-id="${customer.id}">
        <i class="fas fa-check"></i> Marker besøkt
      </button>
      <button class="btn btn-small btn-secondary" data-action="editCustomer" data-customer-id="${customer.id}">
        Rediger
      </button>
      <button class="btn btn-small ${hasEmail ? 'btn-email' : 'btn-disabled'}"
              data-action="sendEmail"
              data-customer-id="${customer.id}"
              ${hasEmail ? '' : 'disabled'}>
        <i class="fas fa-envelope"></i> E-post
      </button>
    </div>
  `;
}

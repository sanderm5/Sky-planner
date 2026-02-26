// ========================================
// SPA VIEW MANAGEMENT — Mapbox GL JS v3
// ========================================

// Default view: show all of Norway (used when no office address is configured)
const NORWAY_CENTER = [10.0, 64.0]; // [lng, lat]
const NORWAY_ZOOM = 4.0;

// Get Mapbox access token from server config
function getMapboxToken() {
  if (appConfig.mapboxAccessToken) {
    return appConfig.mapboxAccessToken;
  }
  Logger.error('Mapbox token mangler - sett MAPBOX_ACCESS_TOKEN i server-miljøvariabler');
  return '';
}

// Refresh map tiles when Mapbox token becomes available (e.g. after auth)
function refreshMapTiles() {
  if (!map) return;
  const token = getMapboxToken();
  if (!token) return;
  if (mapboxgl.accessToken === token) return;
  Logger.log('Refreshing map with updated Mapbox token');
  mapboxgl.accessToken = token;
}

// Map mode: 'satellite' or 'dark'
let mapMode = 'satellite';

// Track whether custom layers need re-adding after style change
let _pendingStyleReload = false;

// 3D terrain state
let terrainEnabled = false;
let terrainExaggeration = 1.5;
const TERRAIN_EXAGGERATION_DEFAULT = 1.5;
const TERRAIN_EXAGGERATION_MIN = 0.3;
const TERRAIN_EXAGGERATION_MAX = 3.0;
const TERRAIN_EXAGGERATION_STEP = 0.1;
let terrainPitch = 72;
const TERRAIN_PITCH_DEFAULT = 72;
const TERRAIN_PITCH_MIN = 0;
const TERRAIN_PITCH_MAX = 85;
const TERRAIN_PITCH_STEP = 1;
const TERRAIN_LS_KEY = 'skyplanner_terrainEnabled';
const TERRAIN_EXAG_LS_KEY = 'skyplanner_terrainExaggeration';
const TERRAIN_PITCH_LS_KEY = 'skyplanner_terrainPitch';

// Toggle between satellite and dark map style
function toggleNightMode() {
  if (!map) return;

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
      map.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
      mapMode = 'satellite';
      btn?.classList.add('satellite-active');
      if (icon) icon.className = 'fas fa-sun';
      btn?.setAttribute('title', 'Bytt til mørkt kart');
    } else {
      map.setStyle('mapbox://styles/mapbox/navigation-night-v1');
      mapMode = 'dark';
      btn?.classList.remove('satellite-active');
      if (icon) icon.className = 'fas fa-moon';
      btn?.setAttribute('title', 'Bytt til satellittkart');
    }

    // Re-add custom layers after style loads
    map.once('style.load', () => {
      addNorwayBorder();
      reapplyTerrain();
      // Re-add cluster source/layers (native GL layers are lost on style change)
      if (typeof readdClusterLayers === 'function') readdClusterLayers();
    });

    // Fade back in
    setTimeout(() => {
      mapContainer.style.opacity = '1';
      if (btn) btn.disabled = false;
    }, 300);
  }, 400);
}

// ========================================
// 3D TERRAIN TOGGLE
// ========================================

function enableTerrain(animate = true) {
  if (!map) return;

  // Restore saved exaggeration from localStorage
  const savedExag = localStorage.getItem(TERRAIN_EXAG_LS_KEY);
  if (savedExag) {
    const parsed = parseFloat(savedExag);
    if (!isNaN(parsed) && parsed >= TERRAIN_EXAGGERATION_MIN && parsed <= TERRAIN_EXAGGERATION_MAX) {
      terrainExaggeration = parsed;
    }
  }

  // Restore saved pitch from localStorage
  const savedPitch = localStorage.getItem(TERRAIN_PITCH_LS_KEY);
  if (savedPitch) {
    const parsed = parseFloat(savedPitch);
    if (!isNaN(parsed) && parsed >= TERRAIN_PITCH_MIN && parsed <= TERRAIN_PITCH_MAX) {
      terrainPitch = parsed;
    }
  }

  // Add Mapbox DEM source if not present
  if (!map.getSource('mapbox-dem')) {
    map.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14
    });
  }

  // Enable terrain with exaggeration
  map.setTerrain({ source: 'mapbox-dem', exaggeration: terrainExaggeration });

  // Add sky layer for atmosphere effect
  if (!map.getLayer('sky-layer')) {
    map.addLayer({
      id: 'sky-layer',
      type: 'sky',
      paint: {
        'sky-type': 'atmosphere',
        'sky-atmosphere-sun': [0.0, 0.0],
        'sky-atmosphere-sun-intensity': 15
      }
    });
  }

  // Animate or set pitch for 3D viewing angle
  if (animate) {
    map.easeTo({ pitch: terrainPitch, duration: 1000 });
  } else {
    map.setPitch(terrainPitch);
  }

  // Enable compass on NavigationControl for pitch reset
  if (map._zoomControl) {
    map.removeControl(map._zoomControl);
    map._zoomControl = new mapboxgl.NavigationControl({ showCompass: true, visualizePitch: true });
    map.addControl(map._zoomControl, 'top-right');
  }

  terrainEnabled = true;
  localStorage.setItem(TERRAIN_LS_KEY, 'true');
  updateTerrainButton(true);
  show3DIndicator(true);
  Logger.log('3D terreng aktivert');
}

function disableTerrain() {
  if (!map) return;

  map.setTerrain(null);

  if (map.getLayer('sky-layer')) {
    map.removeLayer('sky-layer');
  }

  // Animate pitch back to flat
  map.easeTo({ pitch: 0, duration: 1000 });

  // Restore NavigationControl without compass
  if (map._zoomControl) {
    map.removeControl(map._zoomControl);
    map._zoomControl = new mapboxgl.NavigationControl({ showCompass: false });
    map.addControl(map._zoomControl, 'top-right');
  }

  terrainEnabled = false;
  localStorage.setItem(TERRAIN_LS_KEY, 'false');
  updateTerrainButton(false);
  show3DIndicator(false);
  Logger.log('3D terreng deaktivert');
}

function toggleTerrain() {
  if (terrainEnabled) {
    disableTerrain();
  } else {
    enableTerrain();
  }
}

function updateTerrainButton(active) {
  const btn = document.getElementById('terrainToggle');
  if (!btn) return;
  if (active) {
    btn.classList.add('active');
    btn.title = 'Slå av 3D-terreng';
  } else {
    btn.classList.remove('active');
    btn.title = 'Slå på 3D-terreng';
  }
  showTerrainSlider(active);
  // Sync slider values
  const exagSlider = document.getElementById('terrainExagRange');
  if (exagSlider) exagSlider.value = terrainExaggeration;
  const exagLabel = document.getElementById('terrainExagLabel');
  if (exagLabel) exagLabel.textContent = terrainExaggeration.toFixed(1) + 'x';
  const pitchSlider = document.getElementById('terrainPitchRange');
  if (pitchSlider) pitchSlider.value = terrainPitch;
  const pitchLabel = document.getElementById('terrainPitchLabel');
  if (pitchLabel) pitchLabel.textContent = Math.round(terrainPitch) + '°';
}

function setTerrainExaggeration(value) {
  terrainExaggeration = Math.max(TERRAIN_EXAGGERATION_MIN, Math.min(TERRAIN_EXAGGERATION_MAX, value));
  localStorage.setItem(TERRAIN_EXAG_LS_KEY, terrainExaggeration.toString());
  if (terrainEnabled && map) {
    map.setTerrain({ source: 'mapbox-dem', exaggeration: terrainExaggeration });
  }
  // Update slider label
  const label = document.getElementById('terrainExagLabel');
  if (label) label.textContent = terrainExaggeration.toFixed(1) + 'x';
}

function setTerrainPitch(value) {
  terrainPitch = Math.max(TERRAIN_PITCH_MIN, Math.min(TERRAIN_PITCH_MAX, value));
  localStorage.setItem(TERRAIN_PITCH_LS_KEY, terrainPitch.toString());
  if (terrainEnabled && map) {
    map.easeTo({ pitch: terrainPitch, duration: 200 });
  }
  const label = document.getElementById('terrainPitchLabel');
  if (label) label.textContent = Math.round(terrainPitch) + '°';
}

function showTerrainSlider(show) {
  const slider = document.getElementById('terrainExagSlider');
  if (slider) {
    slider.classList.toggle('visible', show);
  }
}

function show3DIndicator(show) {
  let indicator = document.getElementById('terrain3dIndicator');
  if (show) {
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'terrain3dIndicator';
      indicator.className = 'terrain-3d-indicator';
      indicator.innerHTML = '<i class="fas fa-mountain" aria-hidden="true"></i> 3D-modus aktivert';
      document.body.appendChild(indicator);
    }
    requestAnimationFrame(() => indicator.classList.add('visible'));
  } else if (indicator) {
    indicator.classList.remove('visible');
    setTimeout(() => indicator.remove(), 300);
  }
}


function reapplyTerrain() {
  if (!terrainEnabled || !map) return;
  if (!map.getSource('mapbox-dem')) {
    map.addSource('mapbox-dem', {
      type: 'raster-dem',
      url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom: 14
    });
  }
  map.setTerrain({ source: 'mapbox-dem', exaggeration: terrainExaggeration });
  if (!map.getLayer('sky-layer')) {
    map.addLayer({
      id: 'sky-layer',
      type: 'sky',
      paint: {
        'sky-type': 'atmosphere',
        'sky-atmosphere-sun': [0.0, 0.0],
        'sky-atmosphere-sun-intensity': 15
      }
    });
  }
}

// Office location marker (glowing house icon)
let officeMarker = null;

function initSharedMap(options = {}) {
  const mapEl = document.getElementById('map');
  if (mapEl && !map) {
    // Set Mapbox GL JS access token
    mapboxgl.accessToken = getMapboxToken();

    // If returning user, skip globe view and start at office location (or Norway overview)
    const skipGlobe = options.skipGlobe || false;
    const hasOfficeLocation = appConfig.routeStartLat && appConfig.routeStartLng;
    const initialCenter = skipGlobe
      ? (hasOfficeLocation ? [appConfig.routeStartLng, appConfig.routeStartLat] : NORWAY_CENTER)
      : NORWAY_CENTER;
    const initialZoom = skipGlobe ? (hasOfficeLocation ? 6 : NORWAY_ZOOM) : 3.0;

    // Create Mapbox GL JS map with globe projection
    map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: initialCenter,
      zoom: initialZoom,
      minZoom: 1,
      maxZoom: 19,
      projection: 'globe',
      interactive: skipGlobe, // Enable immediately for returning users
      attributionControl: false
    });

    // Add fog/atmosphere for globe effect
    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(186, 210, 235)',
        'high-color': 'rgb(36, 92, 223)',
        'horizon-blend': 0.02,
        'space-color': 'rgb(11, 11, 25)',
        'star-intensity': 0.6
      });

      // Add Norway border on first load
      addNorwayBorder();
    });

    // Only spin globe on login screen (not for returning users)
    if (!skipGlobe) {
      startGlobeSpin();
    }

    // Speed up scroll-wheel zoom (default is ~1/450, higher = faster)
    map.scrollZoom.setWheelZoomRate(1 / 200);
    map.scrollZoom.setZoomRate(1 / 50);

    Logger.log('Mapbox GL JS map initialized with globe projection');

    // Office marker is added after login via updateOfficeMarkerPosition()
    // (pre-login config may contain env fallback coords that don't belong to the user)
  }
}

function createOfficeMarkerElement() {
  const el = createMarkerElement('office-marker-glow', `
    <div class="office-marker-container">
      <div class="office-glow-ring"></div>
      <div class="office-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </div>
    </div>
  `, [60, 60]);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

// Update office marker position when org-specific config is loaded after auth
function updateOfficeMarkerPosition() {
  const homeLng = appConfig.routeStartLng;
  const homeLat = appConfig.routeStartLat;

  if (homeLng && homeLat) {
    if (officeMarker) {
      officeMarker.setLngLat([homeLng, homeLat]);
    } else if (map) {
      const officeEl = createOfficeMarkerElement();
      officeMarker = new mapboxgl.Marker({ element: officeEl, anchor: 'center' })
        .setLngLat([homeLng, homeLat])
        .addTo(map);
    }
  } else if (officeMarker) {
    officeMarker.remove();
    officeMarker = null;
  }
}

// Get configured route start location, or null if not set
function getRouteStartLocation() {
  if (appConfig.routeStartLat && appConfig.routeStartLng) {
    return { lat: appConfig.routeStartLat, lng: appConfig.routeStartLng };
  }
  return null;
}

// Show prominent prompt to set office address
function showAddressBannerIfNeeded() {
  // Only show if no address is configured
  if (getRouteStartLocation()) return;

  // If already dismissed this session, show persistent nudge instead
  if (sessionStorage.getItem('addressBannerDismissed')) {
    showPersistentAddressNudge();
    const adminBadge = document.getElementById('adminAddressBadge');
    if (adminBadge) adminBadge.style.display = 'inline-flex';
    return;
  }

  // Remove any existing prompt
  const existing = document.getElementById('addressSetupBanner');
  if (existing) existing.remove();

  const prompt = document.createElement('div');
  prompt.id = 'addressSetupBanner';
  prompt.className = 'address-setup-prompt';
  prompt.innerHTML = `
    <div class="address-prompt-backdrop" onclick="dismissAddressBanner()"></div>
    <div class="address-prompt-card">
      <div class="address-prompt-step-indicator">Kom i gang</div>
      <div class="address-prompt-icon address-prompt-icon-animated">
        <i class="fas fa-map-marker-alt" aria-hidden="true"></i>
      </div>
      <h2>Hvor holder dere til?</h2>
      <p>Legg inn firmaadresse for å se kontoret ditt på kartet og bruke ruteplanlegging. Det tar bare et øyeblikk.</p>
      <div class="address-prompt-actions">
        <button class="address-prompt-btn-primary" onclick="openAdminAddressTab()">
          <i class="fas fa-map-marker-alt" aria-hidden="true"></i> Legg inn adresse nå
        </button>
        <button class="address-prompt-btn-secondary" onclick="dismissAddressBanner()">
          Jeg gjør det senere
        </button>
      </div>
    </div>
  `;

  const mapContainer = document.getElementById('sharedMapContainer');
  if (mapContainer) {
    mapContainer.appendChild(prompt);
    requestAnimationFrame(() => prompt.classList.add('visible'));
  }

  // Show action-needed badge on admin tab
  const adminBadge = document.getElementById('adminAddressBadge');
  if (adminBadge) adminBadge.style.display = 'inline-flex';
}

function dismissAddressBanner() {
  const prompt = document.getElementById('addressSetupBanner');
  if (prompt) {
    prompt.classList.remove('visible');
    setTimeout(() => prompt.remove(), 300);
  }
  sessionStorage.setItem('addressBannerDismissed', 'true');

  // Show persistent nudge pill after banner is dismissed
  setTimeout(() => showPersistentAddressNudge(), 400);
}

function openAdminAddressTab() {
  dismissAddressBanner();
  // Switch to admin tab
  const adminTab = document.getElementById('adminTab');
  if (adminTab) {
    adminTab.click();
    // Scroll to address section after tab renders
    setTimeout(() => {
      const section = document.getElementById('companyAddressSection');
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
  }
}

// Persistent floating nudge pill (visible after banner dismissal if address still not set)
function showPersistentAddressNudge() {
  if (getRouteStartLocation()) return;
  if (document.getElementById('addressNudgePill')) return;

  const nudge = document.createElement('div');
  nudge.id = 'addressNudgePill';
  nudge.className = 'address-nudge-pill';
  nudge.innerHTML = `
    <i class="fas fa-map-marker-alt" aria-hidden="true"></i>
    <span>Firmaadresse ikke satt</span>
  `;
  nudge.addEventListener('click', () => {
    openAdminAddressTab();
    removeAddressNudge();
  });

  const mapContainer = document.getElementById('sharedMapContainer');
  if (mapContainer) {
    mapContainer.appendChild(nudge);
    requestAnimationFrame(() => nudge.classList.add('visible'));
  }
}

function removeAddressNudge() {
  const nudge = document.getElementById('addressNudgePill');
  if (nudge) {
    nudge.classList.remove('visible');
    setTimeout(() => nudge.remove(), 300);
  }
}

// Globe spin animation for login screen
let globeSpinRAF = null;

function startGlobeSpin() {
  if (!map) return;
  const secondsPerRevolution = 480; // Very slow: 8 minutes per full rotation
  const degreesPerSecond = 360 / secondsPerRevolution;
  let lastTime = performance.now();

  function spin() {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    const center = map.getCenter();
    center.lng += degreesPerSecond * delta;
    map.setCenter(center);

    globeSpinRAF = requestAnimationFrame(spin);
  }
  globeSpinRAF = requestAnimationFrame(spin);
}

function stopGlobeSpin() {
  if (globeSpinRAF) {
    cancelAnimationFrame(globeSpinRAF);
    globeSpinRAF = null;
  }
}

// Initialize login view (just set up form handler, map is already initialized)
function initLoginView() {
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

// Initialize map features (clustering, borders, controls, etc.)
// Note: The base map is created in initSharedMap() at page load
let mapInitialized = false;
function initMap() {
  if (mapInitialized) {
    // Controls already added — re-init clusters (needed after logout → login)
    // Use readdClusterLayers which removes stale layers, re-creates source,
    // and repopulates data — more robust than bare initClusterManager()
    if (typeof readdClusterLayers === 'function') {
      readdClusterLayers();
    } else {
      initClusterManager();
    }
    return;
  }
  mapInitialized = true;
  Logger.log('initMap() starting, map exists:', !!map);

  if (!map) {
    mapInitialized = false;
    console.error('Map not initialized - call initSharedMap() first');
    return;
  }

  // Add scale control
  map.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  // Add "My location" button (custom IControl)
  class LocateControl {
    onAdd(mapInstance) {
      this._map = mapInstance;
      this._container = document.createElement('div');
      this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = 'Min posisjon';
      btn.setAttribute('aria-label', 'Min posisjon');
      btn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:34px;height:34px;font-size:16px;cursor:pointer;';
      btn.innerHTML = '<i aria-hidden="true" class="fas fa-location-crosshairs"></i>';

      let locationMarker = null;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const coords = [pos.coords.longitude, pos.coords.latitude];
            mapInstance.flyTo({ center: coords, zoom: 15, duration: 1500 });
            if (locationMarker) locationMarker.remove();
            const el = document.createElement('div');
            el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#4285F4;border:2px solid #fff;box-shadow:0 0 6px rgba(66,133,244,0.5);';
            locationMarker = new mapboxgl.Marker({ element: el, anchor: 'center' })
              .setLngLat(coords)
              .setPopup(new mapboxgl.Popup({ offset: 10 }).setText('Du er her'))
              .addTo(mapInstance);
          },
          () => showNotification('Kunne ikke finne posisjonen din', 'error'),
          { enableHighAccuracy: true }
        );
      });

      this._container.appendChild(btn);
      return this._container;
    }
    onRemove() {
      this._container.parentNode?.removeChild(this._container);
      this._map = undefined;
    }
  }
  map.addControl(new LocateControl(), 'top-left');

  // Initialize clustering — must wait for map style to be loaded
  if (map.isStyleLoaded()) {
    initClusterManager();
  } else {
    map.once('style.load', () => initClusterManager());
    // Fallback: 'load' event fires after style + tiles are ready
    map.once('load', () => {
      if (!_clusterSourceReady) initClusterManager();
    });
  }

  // Update clusters after map movement completes (not during zoom — markers are
  // geo-anchored and follow the map automatically, updating mid-zoom causes jitter)
  map.on('moveend', () => {
    requestAnimationFrame(() => {
      if (typeof updateClusters === 'function') updateClusters();
      if (typeof reapplyPlanBadges === 'function') reapplyPlanBadges();
      if (wpFocusedMemberIds || wpRouteActive) {
        if (typeof applyTeamFocusToMarkers === 'function') applyTeamFocusToMarkers();
      }
    });
  });

  // Update marker labels visibility based on zoom level
  map.on('zoomend', updateMarkerLabelsVisibility);

  // Listen for popup actions via event delegation on map container
  map.getContainer().addEventListener('click', handlePopupAction);

  // Init area select (dra-for-å-velge)
  initAreaSelect();

  // Add 3D terrain toggle button (inside shared toolbar container)
  const mapContainer = document.getElementById('sharedMapContainer');
  if (mapContainer && !document.getElementById('terrainToggle')) {
    // Opprett eller finn delt toolbar-container
    let toolbar = document.getElementById('mapToolbarCenter');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.id = 'mapToolbarCenter';
      toolbar.className = 'map-toolbar-center';
      mapContainer.appendChild(toolbar);
    }
    const terrainBtn = document.createElement('button');
    terrainBtn.id = 'terrainToggle';
    terrainBtn.className = 'terrain-toggle-btn';
    terrainBtn.title = 'Slå på 3D-terreng';
    terrainBtn.innerHTML = '<i aria-hidden="true" class="fas fa-mountain"></i>';
    terrainBtn.addEventListener('click', () => toggleTerrain());
    toolbar.appendChild(terrainBtn);

    // Terrain controls panel (shown when 3D is active)
    const sliderPanel = document.createElement('div');
    sliderPanel.id = 'terrainExagSlider';
    sliderPanel.className = 'terrain-exag-slider';
    sliderPanel.innerHTML = `
      <div class="terrain-slider-row">
        <label for="terrainExagRange" class="terrain-exag-title">Skarphet</label>
        <input type="range" id="terrainExagRange"
          min="${TERRAIN_EXAGGERATION_MIN}" max="${TERRAIN_EXAGGERATION_MAX}"
          step="${TERRAIN_EXAGGERATION_STEP}" value="${terrainExaggeration}">
        <span id="terrainExagLabel" class="terrain-exag-label">${terrainExaggeration.toFixed(1)}x</span>
      </div>
      <div class="terrain-slider-row">
        <label for="terrainPitchRange" class="terrain-exag-title">Vinkel</label>
        <input type="range" id="terrainPitchRange"
          min="${TERRAIN_PITCH_MIN}" max="${TERRAIN_PITCH_MAX}"
          step="${TERRAIN_PITCH_STEP}" value="${terrainPitch}">
        <span id="terrainPitchLabel" class="terrain-exag-label">${Math.round(terrainPitch)}°</span>
      </div>
    `;
    toolbar.appendChild(sliderPanel);

    // Slider input handlers
    sliderPanel.querySelector('#terrainExagRange').addEventListener('input', (e) => {
      setTerrainExaggeration(parseFloat(e.target.value));
    });
    sliderPanel.querySelector('#terrainPitchRange').addEventListener('input', (e) => {
      setTerrainPitch(parseFloat(e.target.value));
    });
  }

  // Restore terrain preference from localStorage (only after login)
  if (localStorage.getItem(TERRAIN_LS_KEY) === 'true') {
    if (map.isStyleLoaded()) {
      enableTerrain(false);
    } else {
      map.once('style.load', () => enableTerrain(false));
    }
  }

  Logger.log('initMap() complete — Mapbox GL JS with Supercluster clustering');
}

// Handle popup button clicks via event delegation
function handlePopupAction(e) {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'zoomToCluster') {
    const lat = parseFloat(actionEl.dataset.lat);
    const lng = parseFloat(actionEl.dataset.lng);
    map.flyTo({ center: [lng, lat], zoom: map.getZoom() + 3, duration: 500 });
    closeMapPopup();
  } else if (action === 'addClusterToRoute') {
    const ids = actionEl.dataset.customerIds.split(',').map(Number);
    ids.forEach(id => selectedCustomers.add(id));
    updateSelectionUI();
    closeMapPopup();
    showNotification(`${ids.length} kunder lagt til rute`, 'success');
  }
}

// Show/hide marker labels based on zoom level
function updateMarkerLabelsVisibility() {
  if (!map) return;
  const zoom = map.getZoom();
  const mapContainer = document.getElementById('map');

  if (zoom < 10) {
    mapContainer.classList.add('hide-marker-labels');
  } else {
    mapContainer.classList.remove('hide-marker-labels');
  }
}

// Add Norway border visualization using GeoJSON sources and layers
function addNorwayBorder() {
  if (!map) return;

  // Remove existing layers if present (needed after style change)
  ['norway-border-line', 'sweden-overlay', 'sweden-overlay-fill'].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  });

  // Norge-Sverige grense coordinates [lng, lat] for GeoJSON
  const borderCoords = [
    [20.55, 69.06], [20.10, 68.95], [18.10, 68.45], [17.90, 68.15],
    [17.15, 67.95], [16.40, 67.50], [15.50, 66.60], [14.60, 66.15],
    [14.25, 65.10], [13.95, 64.15], [12.70, 63.70], [12.30, 62.65],
    [12.10, 61.80], [12.15, 61.00], [11.80, 59.80], [11.45, 59.10],
    [11.15, 58.95]
  ];

  // Border line
  map.addSource('norway-border-line', {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: borderCoords }
    }
  });
  map.addLayer({
    id: 'norway-border-line',
    type: 'line',
    source: 'norway-border-line',
    paint: {
      'line-color': '#ef4444',
      'line-width': 2,
      'line-opacity': 0.7,
      'line-dasharray': [4, 2]
    }
  });

  // Sweden dim overlay (east of border)
  const swedenCoords = [[
    [20.5, 71.5], [32.0, 71.5], [32.0, 58.0], [11.0, 58.0],
    [11.5, 59.0], [12.2, 61.0], [12.5, 63.5], [14.5, 66.0],
    [17.5, 68.0], [20.0, 69.0], [20.5, 71.5]
  ]];

  map.addSource('sweden-overlay', {
    type: 'geojson',
    data: {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: swedenCoords }
    }
  });
  map.addLayer({
    id: 'sweden-overlay-fill',
    type: 'fill',
    source: 'sweden-overlay',
    paint: {
      'fill-color': '#000',
      'fill-opacity': 0.25
    }
  });
}

/**
 * Render subcategory assignments for a customer in the popup.
 * Uses kundeSubcatMap (global) and serviceTypeRegistry to resolve names.
 */
function renderPopupSubcategories(customer) {
  const assignments = kundeSubcatMap[customer.id];
  if (!assignments || assignments.length === 0) return '';

  const labels = [];

  for (const a of assignments) {
    for (const group of allSubcategoryGroups) {
      if (group.id !== a.group_id) continue;
      const sub = (group.subcategories || []).find(s => s.id === a.subcategory_id);
      if (sub) {
        labels.push(`<strong>${escapeHtml(group.navn)}:</strong> ${escapeHtml(sub.navn)}`);
      }
    }
  }

  if (labels.length === 0) return '';
  return labels.map(l => `<p>${l}</p>`).join('');
}

// Generate popup content lazily (performance optimization - only called when popup opens)
function generatePopupContent(customer) {
  const isSelected = selectedCustomers.has(customer.id);
  const controlStatus = getControlStatus(customer);
  const hasEmail = customer.epost && customer.epost.trim() !== '';

  // Generate dynamic popup control info based on selected industry
  const kontrollInfoHtml = serviceTypeRegistry.renderPopupControlInfo(customer, controlStatus);

  // Generate custom organization fields from Excel import
  const customFieldsHtml = renderPopupCustomFields(customer);

  // Show org.nr., kundenr, prosjektnr, estimert tid
  let extraFieldsHtml = '';
  const orgNr = customer.org_nummer || (customer.notater && customer.notater.match(/\[ORGNR:(\d{9})\]/)?.[1]);
  if (orgNr) extraFieldsHtml += `<p><strong>Org.nr:</strong> ${escapeHtml(orgNr)}</p>`;
  if (customer.kundenummer) extraFieldsHtml += `<p><strong>Kundenr:</strong> ${escapeHtml(customer.kundenummer)}</p>`;
  if (customer.prosjektnummer) extraFieldsHtml += `<p><strong>Prosjektnr:</strong> ${escapeHtml(customer.prosjektnummer)}</p>`;
  if (customer.estimert_tid) {
    const _h = Math.floor(customer.estimert_tid / 60);
    const _m = customer.estimert_tid % 60;
    const tidStr = _h > 0 ? (_m > 0 ? `${_h}t ${_m}m` : `${_h}t`) : `${_m}m`;
    extraFieldsHtml += `<p><strong>Est. tid:</strong> ${tidStr}</p>`;
  }

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

  // Generate subcategory assignments display
  const subcatHtml = renderPopupSubcategories(customer);

  return `
    ${presenceBanner}
    <h3>${escapeHtml(customer.navn)}</h3>
    ${customer.kategori ? `<p><strong>Kategori:</strong> ${escapeHtml(customer.kategori)}</p>` : ''}
    ${subcatHtml}
    ${extraFieldsHtml}
    ${customFieldsHtml}
    <p>${escapeHtml(customer.adresse)}</p>
    <p>${escapeHtml(customer.postnummer || '')} ${escapeHtml(customer.poststed || '')}</p>
    ${customer.telefon ? `<p>Tlf: ${escapeHtml(customer.telefon)}</p>` : ''}
    ${customer.epost ? `<p>E-post: ${escapeHtml(customer.epost)}</p>` : ''}
    ${kontrollInfoHtml}
    ${notatHtml}
    <div class="popup-actions">
      <button class="btn btn-small btn-navigate" data-action="navigateToCustomer" data-lat="${customer.lat}" data-lng="${customer.lng}" data-name="${escapeHtml(customer.navn)}">
        <i aria-hidden="true" class="fas fa-directions"></i> Naviger
      </button>
      <button class="btn btn-small btn-primary" data-action="toggleCustomerSelection" data-customer-id="${customer.id}">
        ${isSelected ? 'Fjern fra rute' : 'Legg til rute'}
      </button>
      <div class="popup-btn-group">
        <button class="btn btn-small btn-calendar" data-action="quickAddToday" data-customer-id="${customer.id}" data-customer-name="${escapeHtml(customer.navn)}">
          <i aria-hidden="true" class="fas fa-calendar-plus"></i> I dag
        </button>
        <button class="btn btn-small btn-calendar" data-action="showCalendarQuickMenu" data-customer-id="${customer.id}" data-customer-name="${escapeHtml(customer.navn)}">
          <i aria-hidden="true" class="fas fa-chevron-down" style="font-size:9px"></i>
        </button>
      </div>
      ${splitViewOpen && splitViewState.activeDay ? `
      <button class="btn btn-small btn-calendar" data-action="quickAddToSplitDay" data-customer-id="${customer.id}" data-customer-name="${escapeHtml(customer.navn)}" style="background:var(--color-primary);color:#fff;width:100%;">
        <i aria-hidden="true" class="fas fa-calendar-plus"></i> Legg til ${new Date(splitViewState.activeDay + 'T00:00:00').toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })}
      </button>
      ` : ''}
      <button class="btn btn-small btn-success" data-action="quickMarkVisited" data-customer-id="${customer.id}">
        <i aria-hidden="true" class="fas fa-check"></i> Marker besøkt
      </button>
      <button class="btn btn-small btn-secondary" data-action="editCustomer" data-customer-id="${customer.id}">
        Rediger
      </button>
      <button class="btn btn-small ${hasEmail ? 'btn-email' : 'btn-disabled'}"
              data-action="sendEmail"
              data-customer-id="${customer.id}"
              ${hasEmail ? '' : 'disabled'}>
        <i aria-hidden="true" class="fas fa-envelope"></i> E-post
      </button>
    </div>
  `;
}

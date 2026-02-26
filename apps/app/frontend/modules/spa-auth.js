// Handle SPA login
async function handleSpaLogin(e) {
  e.preventDefault();

  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const rememberMe = document.getElementById('loginRememberMe').checked;
  const loginBtn = document.getElementById('spaLoginBtn');
  const errorMessage = document.getElementById('loginErrorMessage');
  const errorText = document.getElementById('loginErrorText');

  loginBtn.disabled = true;
  loginBtn.innerHTML = '<div class="login-spinner"></div><span>Logger inn...</span>';
  errorMessage.classList.remove('show');

  try {
    const loginHeaders = { 'Content-Type': 'application/json' };
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      loginHeaders['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch('/api/klient/login', {
      method: 'POST',
      headers: loginHeaders,
      credentials: 'include',
      body: JSON.stringify({ epost: email, passord: password, rememberMe })
    });

    const rawData = await response.json();
    // Handle wrapped API response format: { success: true, data: { ... } }
    const data = rawData.success && rawData.data ? rawData.data : rawData;

    if (response.ok && (data.accessToken || data.token)) {
      // Auth is now managed via httpOnly cookies (set by server)
      // Keep authToken in memory for backward compat during transition
      authToken = data.accessToken || data.token;
      if (data.expiresAt) accessTokenExpiresAt = data.expiresAt;
      localStorage.setItem('userName', data.klient?.navn || data.bruker?.navn || 'Bruker');
      localStorage.setItem('userEmail', email || data.klient?.epost || data.bruker?.epost || '');
      localStorage.setItem('userRole', data.klient?.rolle || data.bruker?.rolle || 'leser');
      localStorage.setItem('userType', data.klient?.type || 'klient');

      // Apply role-based UI restrictions
      applyRoleUI();

      // Multi-tenancy: Store organization context
      if (data.klient?.organizationId) {
        localStorage.setItem('organizationId', data.klient.organizationId);
        localStorage.setItem('organizationSlug', data.klient.organizationSlug || '');
        localStorage.setItem('organizationName', data.klient.organizationName || '');
      }

      // Multi-tenancy: Apply organization branding if returned with login
      if (data.organization) {
        appConfig.primaryColor = data.organization.primaryColor || appConfig.primaryColor;
        appConfig.secondaryColor = data.organization.secondaryColor || appConfig.secondaryColor;
        appConfig.logoUrl = data.organization.logoUrl || appConfig.logoUrl;
        appConfig.companyName = data.organization.navn || appConfig.companyName;
        appConfig.appName = data.organization.brandTitle || appConfig.appName;
        appConfig.companySubtitle = data.organization.brandSubtitle || appConfig.companySubtitle;
        // App mode: 'mvp' = enkel versjon, 'full' = komplett (TRE Allservice)
        appConfig.appMode = data.organization.appMode || 'mvp';
        localStorage.setItem('appMode', appConfig.appMode);

        // Store subscription info for timer
        subscriptionInfo = {
          status: data.organization.subscriptionStatus,
          trialEndsAt: data.organization.trialEndsAt,
          planType: data.organization.planType
        };

        applyBranding();
        applyMvpModeUI();
      }

      // Show admin tab and manage button if user is admin/bruker
      const isAdmin = data.klient?.type === 'bruker' || data.klient?.rolle === 'admin';
      const adminTab = document.getElementById('adminTab');
      if (adminTab) {
        adminTab.style.display = isAdmin ? 'flex' : 'none';
      }

      // Show success state
      loginBtn.innerHTML = `
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="18" height="18">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
        </svg>
        <span>Velkommen!</span>
      `;
      loginBtn.style.background = '#4CAF50';

      // Check if user is a super-admin - if so, redirect to admin panel
      if (data.klient?.type === 'bruker') {
        try {
          const verifyRes = await fetch('/api/klient/verify', {
            credentials: 'include'
          });
          const verifyData = await verifyRes.json();
          if (verifyData.data?.user?.isSuperAdmin) {
            localStorage.setItem('isSuperAdmin', 'true');
            setTimeout(() => {
              window.location.href = '/admin';
            }, 500);
            return;
          }
        } catch (e) {
          // Super-admin check failed, continue to main app
        }
      }

      // Check if onboarding is needed (first login / no industry selected)
      const needsOnboarding = data.organization && !data.organization.onboardingCompleted;

      // Start the transition to app view (with onboarding if needed)
      setTimeout(async () => {
        if (needsOnboarding) {
          // Show onboarding wizard
          await showOnboardingWizard();
        }
        transitionToAppView();
      }, 300);
    } else {
      // Handle both wrapped error format { error: { message } } and legacy format { error: "string" }
      const errorMsg = data.error?.message || data.error || rawData.error?.message || 'Feil e-post eller passord';
      errorText.textContent = errorMsg;
      errorMessage.classList.add('show');
      resetLoginButton();
    }
  } catch (error) {
    console.error('Login error:', error);
    // Gi mer spesifikk feilmelding basert på feiltype
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      errorText.textContent = 'Kunne ikke koble til server - sjekk internettforbindelsen';
    } else if (error.name === 'SyntaxError' || error.message.includes('JSON')) {
      errorText.textContent = 'Ugyldig respons fra server';
    } else if (error.name === 'AbortError') {
      errorText.textContent = 'Forespørselen ble avbrutt';
    } else {
      errorText.textContent = error.message || 'Ukjent feil ved innlogging';
    }
    errorMessage.classList.add('show');
    resetLoginButton();
  }
}

function resetLoginButton() {
  const loginBtn = document.getElementById('spaLoginBtn');
  if (loginBtn) {
    loginBtn.disabled = false;
    loginBtn.style.background = '';
    loginBtn.innerHTML = `
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/>
      </svg>
      <span>Logg inn</span>
    `;
  }
}

// Show user bar with name and update admin tab visibility
function showUserBar() {
  const userBar = document.getElementById('userBar');
  const userNameDisplay = document.getElementById('userNameDisplay');
  const userName = localStorage.getItem('userName') || localStorage.getItem('klientNavn') || 'Bruker';
  const userRole = localStorage.getItem('userRole') || '';
  const userType = localStorage.getItem('userType') || '';

  if (userBar) {
    userBar.style.display = 'flex';
    if (userNameDisplay) userNameDisplay.textContent = userName;
    // Set dashboard link to web app URL
    const dashLink = document.getElementById('dashboardLinkBtn');
    if (dashLink && appConfig.webUrl) {
      dashLink.href = appConfig.webUrl + '/dashboard';
    }
  }

  // Show admin tab and manage button if user is admin/bruker
  const isAdmin = userType === 'bruker' || userRole === 'admin';
  const adminTab = document.getElementById('adminTab');
  if (adminTab) {
    adminTab.style.display = isAdmin ? 'flex' : 'none';
  }

  // Initialize subscription countdown timer
  initSubscriptionTimer();
}

// Hide user bar
function hideUserBar() {
  const userBar = document.getElementById('userBar');
  if (userBar) userBar.style.display = 'none';

  // Hide subscription timer
  hideSubscriptionTimer();
}


// Transition from login to app view with smooth animations
// Single map architecture: map never changes, only UI overlays animate
function transitionToAppView() {
  const loginOverlay = document.getElementById('loginOverlay');
  const appView = document.getElementById('appView');
  const sidebar = document.getElementById('sidebar');
  const filterPanel = document.getElementById('filterPanel');
  const loginSide = document.querySelector('.login-side');
  const loginBrandContent = document.querySelector('.login-brand-content');
  const loginMapOverlay = document.querySelector('.login-map-overlay');

  // Show user bar
  showUserBar();

  // Start proactive token refresh
  setupTokenRefresh();

  // Always show app view and prepare for animation
  appView.classList.remove('hidden');

  // Pre-position sidebar and filter for animation (every time)
  if (sidebar) {
    sidebar.style.transform = 'translateX(-100%)';
    sidebar.style.opacity = '0';
  }
  if (filterPanel) {
    filterPanel.style.transform = 'translateX(100%)';
    filterPanel.style.opacity = '0';
  }

  // Pre-position content panel if it should be open (from localStorage)
  const contentPanel = document.getElementById('contentPanel');
  const shouldOpenPanel = localStorage.getItem('contentPanelOpen') === 'true';
  if (shouldOpenPanel && contentPanel) {
    contentPanel.style.transform = 'translateX(-100%)';
    contentPanel.style.opacity = '0';
    contentPanel.classList.remove('closed');
    contentPanel.classList.add('open');
  }

  // Set currentView to 'app' BEFORE loading customers (so renderMarkers isn't blocked)
  currentView = 'app';

  // PHASE 1: Slide out login form (left side)
  if (loginSide) {
    loginSide.style.transition = 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease-out';
    loginSide.style.transform = 'translateX(-100%)';
    loginSide.style.opacity = '0';
  }

  // PHASE 2: Fade out brand content and gradient overlay
  setTimeout(() => {
    if (loginBrandContent) {
      loginBrandContent.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';
      loginBrandContent.style.opacity = '0';
      loginBrandContent.style.transform = 'translateY(-30px)';
    }
    if (loginMapOverlay) {
      loginMapOverlay.style.transition = 'opacity 0.6s ease-out';
      loginMapOverlay.style.opacity = '0';
    }
  }, 200);

  // PHASE 3: Stop globe spin and fly to office location (or Norway center as fallback)
  setTimeout(() => {
    if (map) {
      stopGlobeSpin();
      const hasOfficeLocation = appConfig.routeStartLat && appConfig.routeStartLng;
      map.flyTo({
        center: hasOfficeLocation
          ? [appConfig.routeStartLng, appConfig.routeStartLat]
          : NORWAY_CENTER,
        zoom: hasOfficeLocation ? 6 : NORWAY_ZOOM,
        duration: 1600,
        essential: true,
        curve: 1.42
      });
    }
  }, 300);

  // PHASE 4: Hide login overlay completely (pointer-events already handled by CSS)
  setTimeout(() => {
    loginOverlay.classList.add('hidden');
  }, 700);

  // PHASE 5: Enable map interactivity
  setTimeout(() => {
    if (map) {
      setMapInteractive(true);
      // Add zoom/navigation control after login
      if (!map._zoomControl) {
        map._zoomControl = new mapboxgl.NavigationControl({ showCompass: false });
        map.addControl(map._zoomControl, 'top-right');
      }
      // Block browser context menu on map area
      map.getContainer().addEventListener('contextmenu', (e) => {
        e.preventDefault();
      });
    }

    // Restore floating map control buttons (hidden on logout)
    document.querySelectorAll('.terrain-toggle-btn, .area-select-toggle-btn, .isochrone-toggle-btn, .coverage-area-toggle-btn').forEach(btn => {
      btn.style.transition = 'opacity 0.4s ease-out';
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    });

    // Restore Mapbox GL native controls
    document.querySelectorAll('.mapboxgl-ctrl').forEach(ctrl => {
      ctrl.style.transition = 'opacity 0.4s ease-out';
      ctrl.style.opacity = '1';
      ctrl.style.pointerEvents = 'auto';
    });
  }, 800);

  // PHASE 5b: Load data AFTER flyTo animation mostly completes (~1.6s)
  // This prevents UI jank during the login transition
  setTimeout(() => {
    if (!appInitialized) {
      initializeApp();
      appInitialized = true;
    } else {
      // Re-initialize clusters (cleared on logout) before loading customers
      if (typeof readdClusterLayers === 'function') readdClusterLayers();
      loadCustomers();
    }
  }, 1700);

  // PHASE 6: Slide in sidebar and show tab navigation
  setTimeout(() => {
    if (sidebar) {
      sidebar.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease-out';
      sidebar.style.transform = 'translateX(0)';
      sidebar.style.opacity = '1';
    }
    // Show tab navigation and sidebar toggle (hidden on logout)
    const tabNavigation = document.querySelector('.tab-navigation');
    if (tabNavigation) {
      tabNavigation.style.transition = 'opacity 0.4s ease-out';
      tabNavigation.style.opacity = '1';
      tabNavigation.style.pointerEvents = 'auto';
    }
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) {
      sidebarToggle.style.transition = 'opacity 0.4s ease-out';
      sidebarToggle.style.opacity = '1';
      sidebarToggle.style.pointerEvents = 'auto';
    }
  }, 900);

  // PHASE 7: Slide in filter panel
  setTimeout(() => {
    if (filterPanel) {
      filterPanel.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease-out';
      filterPanel.style.transform = 'translateX(0)';
      filterPanel.style.opacity = '1';
    }

    // Slide in content panel if it should be open
    const contentPanel = document.getElementById('contentPanel');
    const shouldOpenPanel = localStorage.getItem('contentPanelOpen') === 'true';
    if (shouldOpenPanel && contentPanel) {
      contentPanel.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease-out';
      contentPanel.style.transform = 'translateX(0)';
      contentPanel.style.opacity = '1';
    }
  }, 1050);

  // PHASE 8: Clean up inline styles (after easeTo settles at ~2.6s)
  setTimeout(() => {
    // Clean up sidebar/filter inline styles
    if (sidebar) {
      sidebar.style.transition = '';
      sidebar.style.transform = '';
      sidebar.style.opacity = '';
    }
    if (filterPanel) {
      filterPanel.style.transition = '';
      filterPanel.style.transform = '';
      filterPanel.style.opacity = '';
    }

    // Clean up content panel inline styles
    const contentPanel = document.getElementById('contentPanel');
    if (contentPanel) {
      contentPanel.style.transition = '';
      contentPanel.style.transform = '';
      contentPanel.style.opacity = '';
    }

    // Reset login elements for potential re-login
    if (loginSide) {
      loginSide.style.transition = '';
      loginSide.style.transform = '';
      loginSide.style.opacity = '';
    }
    if (loginBrandContent) {
      loginBrandContent.style.transition = '';
      loginBrandContent.style.opacity = '';
      loginBrandContent.style.transform = '';
    }
    if (loginMapOverlay) {
      loginMapOverlay.style.transition = '';
      loginMapOverlay.style.opacity = '';
    }

    // Clean up map control button inline styles
    document.querySelectorAll('.terrain-toggle-btn, .area-select-toggle-btn, .isochrone-toggle-btn, .coverage-area-toggle-btn, .mapboxgl-ctrl').forEach(el => {
      el.style.transition = '';
      el.style.opacity = '';
      el.style.pointerEvents = '';
    });
  }, 2800);
}

// Show login view (for logout)
function showLoginView() {
  const loginOverlay = document.getElementById('loginOverlay');
  const appView = document.getElementById('appView');
  const sidebar = document.getElementById('sidebar');
  const filterPanel = document.getElementById('filterPanel');
  const loginSide = document.querySelector('.login-side');
  const loginBrandContent = document.querySelector('.login-brand-content');
  const loginMapOverlay = document.querySelector('.login-map-overlay');

  // Hide user bar with fade
  hideUserBar();

  // Reset login form
  const loginForm = document.getElementById('spaLoginForm');
  if (loginForm) loginForm.reset();
  resetLoginButton();

  // Hide error message
  const errorMessage = document.getElementById('loginErrorMessage');
  if (errorMessage) errorMessage.classList.remove('show');

  // Step 1: Prepare login elements for fade-in (start invisible)
  if (loginSide) {
    loginSide.style.transition = 'none';
    loginSide.style.transform = 'translateX(-30px)';
    loginSide.style.opacity = '0';
  }
  if (loginBrandContent) {
    loginBrandContent.style.transition = 'none';
    loginBrandContent.style.transform = 'scale(0.9)';
    loginBrandContent.style.opacity = '0';
  }
  if (loginMapOverlay) {
    loginMapOverlay.style.transition = 'none';
    loginMapOverlay.style.opacity = '0';
  }

  // Step 2: Fade out sidebar and filter panel
  const isMobile = window.innerWidth <= 768;
  if (sidebar) {
    sidebar.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-out';
    // On mobile, sidebar is a bottom sheet - slide down instead of left
    sidebar.style.transform = isMobile ? 'translateY(100%)' : 'translateX(-100%)';
    sidebar.style.opacity = '0';
    sidebar.classList.remove('mobile-open');
  }
  if (filterPanel) {
    filterPanel.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-out';
    filterPanel.style.transform = isMobile ? 'translateY(100%)' : 'translateX(100%)';
    filterPanel.style.opacity = '0';
  }

  // Animate out content panel if open
  const contentPanel = document.getElementById('contentPanel');
  if (contentPanel && !contentPanel.classList.contains('closed')) {
    contentPanel.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.4s ease-out';
    contentPanel.style.transform = 'translateX(-100%)';
    contentPanel.style.opacity = '0';
  }

  // Hide bulk action bar if visible
  const bulkActionBar = document.querySelector('.bulk-action-bar');
  if (bulkActionBar) {
    bulkActionBar.classList.remove('visible');
  }

  // Hide mobile route FAB
  const mobileRouteFab = document.getElementById('mobileRouteBtn');
  if (mobileRouteFab) {
    mobileRouteFab.classList.add('hidden');
  }

  // Hide tab navigation and sidebar toggle on mobile (logout)
  const tabNavigation = document.querySelector('.tab-navigation');
  if (tabNavigation) {
    tabNavigation.style.transition = 'opacity 0.3s ease-out';
    tabNavigation.style.opacity = '0';
    tabNavigation.style.pointerEvents = 'none';
  }
  const sidebarToggle = document.getElementById('sidebarToggle');
  if (sidebarToggle) {
    sidebarToggle.style.transition = 'opacity 0.3s ease-out';
    sidebarToggle.style.opacity = '0';
    sidebarToggle.style.pointerEvents = 'none';
  }

  // Hide floating map control buttons (same z-index as login overlay)
  document.querySelectorAll('.terrain-toggle-btn, .area-select-toggle-btn, .isochrone-toggle-btn, .coverage-area-toggle-btn').forEach(btn => {
    btn.style.transition = 'opacity 0.3s ease-out';
    btn.style.opacity = '0';
    btn.style.pointerEvents = 'none';
  });

  // Hide Mapbox GL native controls (locate, zoom, etc.)
  document.querySelectorAll('.mapboxgl-ctrl').forEach(ctrl => {
    ctrl.style.transition = 'opacity 0.3s ease-out';
    ctrl.style.opacity = '0';
    ctrl.style.pointerEvents = 'none';
  });

  // Step 3: Fade out all markers (customers + clusters) gradually
  const allMarkerEls = document.querySelectorAll('.mapboxgl-marker');
  allMarkerEls.forEach(el => {
    el.style.transition = 'opacity 0.5s ease-out';
    el.style.opacity = '0';
  });
  setTimeout(() => {
    // Remove all customer markers
    for (const [id, marker] of Object.entries(markers)) {
      marker.remove();
    }
    Object.keys(markers).forEach(k => delete markers[k]);
    // Remove all cluster markers
    if (typeof clearAllClusters === 'function') clearAllClusters();
  }, 500);

  // Clear route if any
  clearRoute();

  // Step 4: Show login overlay and start map fly animation
  setTimeout(() => {
    loginOverlay.classList.remove('hidden');

    // Step 5: Animate login elements in with smooth timing
    setTimeout(() => {
      // Fade in the dark overlay
      if (loginMapOverlay) {
        loginMapOverlay.style.transition = 'opacity 0.8s ease-out';
        loginMapOverlay.style.opacity = '1';
      }

      // Slide in and fade login side panel
      if (loginSide) {
        loginSide.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.5s ease-out';
        loginSide.style.transform = 'translateX(0)';
        loginSide.style.opacity = '1';
      }

      // Scale and fade brand content with slight delay
      setTimeout(() => {
        if (loginBrandContent) {
          loginBrandContent.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease-out';
          loginBrandContent.style.transform = 'scale(1)';
          loginBrandContent.style.opacity = '1';
        }
      }, 150);
    }, 50);
  }, 300);

  // Zoom map back to login position with smooth animation
  if (map) {
    // Disable interactivity
    setMapInteractive(false);

    // Remove zoom control if present
    if (map._zoomControl) {
      map.removeControl(map._zoomControl);
      map._zoomControl = null;
    }

    map.flyTo({
      center: [15.0, 65.0],
      zoom: 3.0,
      duration: 2000,
      essential: true,
      curve: 1.5
    });

    // Start globe spin again after fly-out completes
    setTimeout(() => startGlobeSpin(), 2200);
  }

  // Step 6: Hide app view and reset styles after animation completes
  setTimeout(() => {
    appView.classList.add('hidden');

    // Reset sidebar/filter styles for next login
    if (sidebar) {
      sidebar.style.transition = '';
      sidebar.style.transform = '';
      sidebar.style.opacity = '';
    }
    if (filterPanel) {
      filterPanel.style.transition = '';
      filterPanel.style.transform = '';
      filterPanel.style.opacity = '';
    }

    // Reset content panel styles and close it
    const contentPanel = document.getElementById('contentPanel');
    if (contentPanel) {
      contentPanel.style.transition = '';
      contentPanel.style.transform = '';
      contentPanel.style.opacity = '';
      contentPanel.classList.add('closed');
      contentPanel.classList.remove('open');
    }

    // Reset login element transitions (keep final positions)
    if (loginSide) {
      loginSide.style.transition = '';
    }
    if (loginBrandContent) {
      loginBrandContent.style.transition = '';
    }
    if (loginMapOverlay) {
      loginMapOverlay.style.transition = '';
    }
  }, 1000);

  currentView = 'login';
}

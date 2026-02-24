// ========================================
function applyIndustryChanges() {
  Logger.log('Applying industry changes...');

  // Update login page features to match current industry
  renderLoginFeatures();

  // Update category tabs in customer admin view
  const kategoriTabs = document.getElementById('kategoriTabs');
  if (kategoriTabs) {
    kategoriTabs.innerHTML = serviceTypeRegistry.renderCategoryTabs(selectedCategory);
    // Re-attach click handlers
    attachKategoriTabHandlers();
  }

  // Update filter panel categories (right side panel)
  renderFilterPanelCategories();
  // Apply MVP mode UI changes (hide industry-specific elements)
  applyMvpModeUI();

  // Update all dropdowns that depend on service types
  updateServiceTypeDropdowns();

  // Update map legend
  updateMapLegend();

  // Apply dynamic CSS colors for service types
  applyIndustryColors();

  // Refresh markers with new colors/icons
  if (customers && customers.length > 0) {
    renderMarkers(customers);
    renderCustomerAdmin();

    // Check for customers with unknown categories and show notification
    const unknownCategoryCount = customers.filter(c =>
      c.kategori && !serviceTypeRegistry.isKnownCategory(c.kategori)
    ).length;

    if (unknownCategoryCount > 0) {
      showUnknownCategoryNotification(unknownCategoryCount);
    }
  }

  // Update branding (titles, features, etc.) to match new industry
  applyBranding();

  Logger.log('Industry changes applied');
}

// Show notification about customers with unknown categories
function showUnknownCategoryNotification(count) {
  // Remove existing notification if present
  const existingNotification = document.getElementById('unknownCategoryNotification');
  if (existingNotification) {
    existingNotification.remove();
  }

  const notification = document.createElement('div');
  notification.id = 'unknownCategoryNotification';
  notification.className = 'unknown-category-notification';
  notification.innerHTML = `
    <div class="notification-content">
      <i class="fas fa-exclamation-triangle"></i>
      <span><strong>${count}</strong> kunde${count > 1 ? 'r' : ''} har kategorier fra tidligere bransje og m&aring; oppdateres.</span>
      <button class="btn-close-notification" onclick="this.parentElement.parentElement.remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;

  // Insert after header or at top of main content
  const mainContent = document.querySelector('.content') || document.querySelector('main') || document.body;
  mainContent.insertBefore(notification, mainContent.firstChild);

  // Auto-hide after 10 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }
  }, 10000);
}

// Attach click handlers to kategori tabs
function attachKategoriTabHandlers() {
  const tabs = document.querySelectorAll('#kategoriTabs .category-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectedCategory = tab.dataset.category || 'all';
      applyFilters();
    });
  });
}

// Update all dropdowns that depend on service types
function updateServiceTypeDropdowns() {
  // Customer modal category checkboxes
  const kategoriContainer = document.getElementById('kategoriCheckboxes');
  if (kategoriContainer) {
    const currentValue = serviceTypeRegistry.getSelectedCategories();
    kategoriContainer.innerHTML = serviceTypeRegistry.renderCategoryCheckboxes(currentValue);
  }
}

// Apply dynamic CSS variables for industry service type colors
function applyIndustryColors() {
  const serviceTypes = serviceTypeRegistry.getAll();
  const root = document.documentElement;

  serviceTypes.forEach((st) => {
    root.style.setProperty(`--service-color-${st.slug}`, st.color);
  });

  // For combined markers - gradient of first two service types
  if (serviceTypes.length >= 2) {
    const gradient = `linear-gradient(135deg, ${serviceTypes[0].color} 50%, ${serviceTypes[1].color} 50%)`;
    root.style.setProperty('--service-color-combined', gradient);
  }

  // Inject dynamic marker CSS styles based on loaded service types
  injectDynamicMarkerStyles();
}

/**
 * Darken a hex color by a percentage
 * @param {string} hex - Hex color code (with or without #)
 * @param {number} percent - Percentage to darken (0-100)
 * @returns {string} Darkened hex color
 */
function darkenColor(hex, percent) {
  // Remove # if present
  hex = hex.replace('#', '');

  // Parse RGB
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Darken
  r = Math.max(0, Math.floor(r * (1 - percent / 100)));
  g = Math.max(0, Math.floor(g * (1 - percent / 100)));
  b = Math.max(0, Math.floor(b * (1 - percent / 100)));

  // Convert back to hex
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Inject dynamic CSS for marker category styles based on loaded service types
 * Uses premium 3-layer gradients and sophisticated shadows for professional look
 */
function injectDynamicMarkerStyles() {
  // Remove any previously injected dynamic styles
  const existingStyle = document.getElementById('dynamic-marker-styles');
  if (existingStyle) {
    existingStyle.remove();
  }

  const serviceTypes = serviceTypeRegistry.getAll();
  if (serviceTypes.length === 0) return;

  const styleElement = document.createElement('style');
  styleElement.id = 'dynamic-marker-styles';

  let css = '';

  // Generate premium styles for each service type
  serviceTypes.forEach((st) => {
    // Use premium palette if available, otherwise calculate colors
    const palette = industryPalettes[st.slug] || {
      light: st.color,
      primary: st.color,
      dark: darkenColor(st.color, 20)
    };

    // Premium 3-layer gradient with inner highlight
    css += `
      /* Premium marker style for ${st.name} */
      .custom-marker-with-label .marker-icon.${st.slug} {
        background: linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%);
        box-shadow:
          0 2px 8px rgba(0, 0, 0, 0.4),
          0 0 0 1px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.25);
      }

      .custom-marker-with-label .marker-icon.${st.slug}[data-status="forfalt"] {
        background: linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%) !important;
      }

      .custom-marker-with-label .marker-icon.${st.slug}[data-status="snart"] {
        background: linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%) !important;
      }
    `;
  });

  // Generate combined style if multiple service types exist
  if (serviceTypes.length >= 2) {
    const palette1 = industryPalettes[serviceTypes[0].slug] || { primary: serviceTypes[0].color };
    const palette2 = industryPalettes[serviceTypes[1].slug] || { primary: serviceTypes[1].color };
    const color1 = palette1.primary;
    const color2 = palette2.primary;

    css += `
      /* Premium combined marker style */
      .custom-marker-with-label .marker-icon.combined {
        width: 48px;
        height: 48px;
        min-width: 48px;
        min-height: 48px;
        background: linear-gradient(135deg, ${color1} 0%, ${color1} 48%, ${color2} 52%, ${color2} 100%);
        font-size: 15px;
        box-shadow:
          0 2px 8px rgba(0, 0, 0, 0.4),
          0 0 0 1px rgba(0, 0, 0, 0.1),
          inset 0 1px 0 rgba(255, 255, 255, 0.2);
      }

      .custom-marker-with-label .marker-icon.combined[data-status="forfalt"] {
        background: linear-gradient(135deg, ${color1} 0%, ${color1} 48%, ${color2} 52%, ${color2} 100%) !important;
      }

      .custom-marker-with-label .marker-icon.combined[data-status="snart"] {
        background: linear-gradient(135deg, ${color1} 0%, ${color1} 48%, ${color2} 52%, ${color2} 100%) !important;
      }
    `;
  }

  styleElement.textContent = css;
  document.head.appendChild(styleElement);

  Logger.log('Premium marker styles injected for', serviceTypes.length, 'service types');
}

// Update map legend for current industry with premium styling
function updateMapLegend() {
  const legendItems = document.getElementById('legendItems');
  if (!legendItems) return;

  const serviceTypes = serviceTypeRegistry.getAll();

  if (serviceTypes.length === 0) {
    legendItems.innerHTML = '<div class="legend-item"><span class="legend-color" style="background: linear-gradient(135deg, #FBBF24, #D97706)"></span> Kunde</div>';
    return;
  }

  // Use premium palettes for legend
  legendItems.innerHTML = serviceTypes.map(st => {
    const palette = industryPalettes[st.slug] || { light: st.color, primary: st.color, dark: st.color };
    const gradient = `linear-gradient(135deg, ${palette.light} 0%, ${palette.primary} 40%, ${palette.dark} 100%)`;
    return `
      <div class="legend-item">
        <span class="legend-color" style="background: ${gradient}"></span>
        <span>${st.name}</span>
      </div>
    `;
  }).join('');

  // Add combined if multiple service types
  if (serviceTypes.length >= 2) {
    const palette1 = industryPalettes[serviceTypes[0].slug] || { primary: serviceTypes[0].color };
    const palette2 = industryPalettes[serviceTypes[1].slug] || { primary: serviceTypes[1].color };
    const combinedGradient = `linear-gradient(135deg, ${palette1.primary} 48%, ${palette2.primary} 52%)`;
    const combinedName = serviceTypes.map(st => escapeHtml(st.name)).join(' + ');
    legendItems.innerHTML += `
      <div class="legend-item">
        <span class="legend-color" style="background: ${combinedGradient}"></span>
        <span>${combinedName}</span>
      </div>
    `;
  }
}

// Apply branding from config to UI elements
function applyBranding() {
  // Login page branding
  const loginLogo = document.getElementById('loginLogo');
  const loginBrandTitle = document.getElementById('loginBrandTitle');
  const loginBrandSubtitle = document.getElementById('loginBrandSubtitle');
  const loginContact = document.getElementById('loginContact');
  const loginAddress = document.getElementById('loginAddress');
  const loginContactLinks = document.getElementById('loginContactLinks');
  const loginFooterCopyright = document.getElementById('loginFooterCopyright');

  // Header/sidebar branding
  const headerLogo = document.getElementById('headerLogo');
  const headerCompanyName = document.getElementById('headerCompanyName');
  const headerAppName = document.getElementById('headerAppName');
  const headerYear = document.getElementById('headerYear');

  // Apply logo if configured
  if (appConfig.logoUrl) {
    if (loginLogo) {
      loginLogo.src = appConfig.logoUrl;
      loginLogo.style.display = 'block';
    }
    if (headerLogo) {
      headerLogo.src = appConfig.logoUrl;
      headerLogo.style.display = 'block';
    }
  }

  // Apply organization name to sidebar H1 (fallback to app name, then Sky Planner)
  if (headerAppName) {
    headerAppName.textContent = appConfig.companyName || appConfig.appName || 'Sky Planner';
  }

  // Apply industry name as subtitle in header
  const industryName = appConfig.industry?.name;
  if (industryName) {
    if (headerCompanyName) {
      headerCompanyName.textContent = industryName;
      headerCompanyName.style.display = '';
    }
  } else {
    // Hide industry name element if not available
    if (headerCompanyName) headerCompanyName.style.display = 'none';
  }

  // Apply company name to login brand title
  if (appConfig.companyName && loginBrandTitle) {
    loginBrandTitle.textContent = appConfig.companyName;
  }

  // Apply year dynamically
  const currentYear = appConfig.appYear || new Date().getFullYear();
  if (headerYear) {
    headerYear.textContent = currentYear;
  }

  // Apply login footer copyright
  if (loginFooterCopyright) {
    const developerName = appConfig.developerName || 'Efffekt AS';
    loginFooterCopyright.innerHTML = `&copy; ${currentYear} ${escapeHtml(developerName)}. All rights reserved.`;
  }

  // Apply subtitle
  if (loginBrandSubtitle && appConfig.companySubtitle) {
    loginBrandSubtitle.textContent = appConfig.companySubtitle;
  }

  // Apply contact info if configured
  if (loginContact && (appConfig.contactAddress || appConfig.contactPhone || appConfig.contactEmail)) {
    loginContact.style.display = 'block';

    if (loginAddress && appConfig.contactAddress) {
      loginAddress.textContent = appConfig.contactAddress;
    }

    if (loginContactLinks) {
      let links = [];
      if (appConfig.contactPhone) {
        // Validate phone format: only digits, spaces, +, and - allowed
        const phoneClean = appConfig.contactPhone.replace(/[^\d\s\+\-\(\)]/g, '');
        const phoneHref = phoneClean.replace(/\s/g, '');
        links.push(`<a href="tel:${escapeHtml(phoneHref)}">${escapeHtml(phoneClean)}</a>`);
      }
      if (appConfig.contactEmail) {
        links.push(`<a href="mailto:${escapeHtml(appConfig.contactEmail)}">${escapeHtml(appConfig.contactEmail)}</a>`);
      }
      loginContactLinks.innerHTML = links.join('<span class="login-contact-divider">·</span>');
    }
  }

  // Multi-tenancy: Apply custom colors from tenant config
  applyTenantColors();

  // Multi-tenancy: Update page title
  if (appConfig.appName) {
    document.title = appConfig.appName;
  }

  // Update dynamic UI elements based on service types
  updateCategoryTabs();

  // Render dynamic login features based on industry/service types
  renderLoginFeatures();

  Logger.log('Branding applied from config');
}

// Render dynamic login features based on industry/service types
function renderLoginFeatures() {
  const container = document.getElementById('loginFeatures');
  if (!container) return;

  // Get service types from registry (or use defaults)
  let serviceTypes = [];
  try {
    serviceTypes = serviceTypeRegistry.getAll() || [];
  } catch (e) {
    // ServiceTypeRegistry not initialized yet
  }

  // Default features if no service types configured
  const defaultFeatures = [
    { icon: 'fas fa-clipboard-check', name: 'Kontroll', description: 'Periodisk oppfølging av kunder' },
    { icon: 'fas fa-route', name: 'Ruteplanlegging', description: 'Planlegg og optimaliser ruter' }
  ];

  // Use service types or defaults
  const features = serviceTypes.length > 0
    ? serviceTypes.slice(0, 3).map(s => {
        // Ensure icon has 'fas' prefix for Font Awesome 5
        let icon = s.icon || 'fa-check-circle';
        if (!icon.startsWith('fas ') && !icon.startsWith('far ') && !icon.startsWith('fab ')) {
          icon = 'fas ' + icon;
        }
        return {
          icon: icon,
          name: s.name,
          description: s.description || 'Periodisk kontroll'
        };
      })
    : defaultFeatures;

  // Always add standard features
  const standardFeatures = [
    { icon: 'fas fa-route', name: 'Ruteplanlegging', description: 'Effektive serviceruter' },
    { icon: 'fas fa-bell', name: 'Varsler', description: 'Automatiske påminnelser' }
  ];

  const allFeatures = [...features, ...standardFeatures];

  // Render feature cards
  container.innerHTML = allFeatures.map(feature => `
    <div class="login-feature">
      <div class="login-feature-icon">
        <i class="${feature.icon}"></i>
      </div>
      <div class="login-feature-text">
        <h4>${feature.name}</h4>
        <p>${feature.description}</p>
      </div>
    </div>
  `).join('');
}

// Apply tenant-specific colors using CSS custom properties
// NOTE: Accent colors are now set by Polarnatt theme (polarnatt.css) for all orgs.
// Per-org primaryColor is no longer applied — everyone gets the same brand.
function applyTenantColors() {
  const root = document.documentElement;

  // Secondary color (sidebar/background)
  if (appConfig.secondaryColor) {
    root.style.setProperty('--color-sidebar-bg', appConfig.secondaryColor);
  }

  Logger.log('Tenant colors applied (Polarnatt theme active)');
}

// Helper: Adjust color brightness (positive = lighter, negative = darker)
function adjustColor(hex, percent) {
  if (!hex) return hex;

  // Remove # if present
  hex = hex.replace('#', '');

  // Parse RGB
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Adjust brightness
  r = Math.min(255, Math.max(0, r + Math.round(r * percent / 100)));
  g = Math.min(255, Math.max(0, g + Math.round(g * percent / 100)));
  b = Math.min(255, Math.max(0, b + Math.round(b * percent / 100)));

  // Convert back to hex
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Reload config with auth token (after login for tenant-specific branding)
async function reloadConfigWithAuth() {
  try {
    const response = await fetch('/api/config', {
      credentials: 'include'
    });

    if (response.ok) {
      const configResponse = await response.json();
      appConfig = configResponse.data || configResponse;

      // Load service types: prefer org-specific types from config, fall back to industry template
      if (appConfig.serviceTypes && appConfig.serviceTypes.length > 0) {
        // Org has custom service types (from organization_service_types table)
        serviceTypeRegistry.loadFromConfig(appConfig);
        Logger.log('Service types loaded from org config:', appConfig.serviceTypes.length);
      } else {
        // Fall back to industry template service types
        const serverIndustry = appConfig.industry;
        if (serverIndustry && serverIndustry.slug) {
          localStorage.setItem('industrySlug', serverIndustry.slug);
          localStorage.setItem('industryName', serverIndustry.name || serverIndustry.slug);
          await serviceTypeRegistry.loadFromIndustry(serverIndustry.slug);
          Logger.log('Industry loaded from server:', serverIndustry.slug);
        } else {
          const industrySlug = localStorage.getItem('industrySlug');
          if (industrySlug) {
            await serviceTypeRegistry.loadFromIndustry(industrySlug);
          } else {
            serviceTypeRegistry.loadFromConfig(appConfig);
          }
        }
      }

      updateControlSectionHeaders();
      renderFilterPanelCategories();
      applyMvpModeUI();
      applyBranding();
      applyDateModeToInputs();
      // Refresh map tiles in case token was missing at initial load
      refreshMapTiles();
      // Update office marker position with org-specific coordinates
      updateOfficeMarkerPosition();
      Logger.log('Tenant-specific config loaded:', appConfig.organizationSlug);
    }
  } catch (error) {
    Logger.warn('Could not reload tenant config:', error);
  }
}

// Render markers on map — Mapbox GL JS version
let renderMarkersRetryCount = 0;
const MAX_RENDER_RETRIES = 30;

function renderMarkers(customerData) {
  // Don't render markers if still on login view
  if (currentView === 'login') {
    Logger.log('renderMarkers skipped - still on login view');
    renderMarkersRetryCount = 0;
    return;
  }

  // Safety check - cluster manager must be initialized
  // If not ready, wait — initClusterManager will call applyFilters() when done
  if (!_clusterSourceReady) {
    if (renderMarkersRetryCount >= MAX_RENDER_RETRIES) {
      console.error('renderMarkers: cluster manager never initialized after', MAX_RENDER_RETRIES, 'retries');
      renderMarkersRetryCount = 0;
      return;
    }
    renderMarkersRetryCount++;
    setTimeout(() => renderMarkers(customerData), 200);
    return;
  }

  renderMarkersRetryCount = 0;

  // Clear existing markers
  for (const [id, marker] of Object.entries(markers)) {
    marker.remove();
  }
  // Clear cluster markers
  for (const [key, marker] of clusterMarkers) {
    marker.remove();
  }
  clusterMarkers.clear();
  markers = {};

  // Log what we're rendering
  const kategorier = {};
  customerData.forEach(c => {
    const kat = c.kategori || 'null';
    kategorier[kat] = (kategorier[kat] || 0) + 1;
  });
  Logger.log('renderMarkers:', customerData.length, 'kunder', kategorier);

  customerData.forEach(customer => {
    if (customer.lat && customer.lng) {
      const isSelected = selectedCustomers.has(customer.id);
      const controlStatus = getControlStatus(customer);

      // Create marker with simplified label
      const shortName = customer.navn.length > 20 ? customer.navn.substring(0, 18) + '...' : customer.navn;

      // Show warning icon for urgent statuses
      const showWarning = controlStatus.status === 'forfalt' || controlStatus.status === 'denne-uke' || controlStatus.status === 'snart';
      const warningBadge = showWarning ? '<span class="marker-warning-badge">!</span>' : '';

      // Determine category icon dynamically from ServiceTypeRegistry
      let categoryIcon, categoryClass;
      const serviceTypes = serviceTypeRegistry.getAll();
      if (customer.kategori && serviceTypes.length > 0) {
        categoryIcon = serviceTypeRegistry.getIconForCategory(customer.kategori);
        categoryClass = serviceTypeRegistry.getCategoryClass(customer.kategori);
      } else if (serviceTypes.length > 0) {
        const defaultSt = serviceTypeRegistry.getDefaultServiceType();
        categoryIcon = serviceTypeRegistry.getIconForCategory(defaultSt.name);
        categoryClass = serviceTypeRegistry.getCategoryClass(defaultSt.name);
      } else {
        categoryIcon = `<span class="marker-svg-icon">${svgIcons['service']}</span>`;
        categoryClass = 'service';
      }

      // Create DOM element for marker (replaces L.divIcon)
      const el = document.createElement('div');
      el.className = `custom-marker-with-label ${isSelected ? 'selected' : ''} ${controlStatus.class}`;
      el.innerHTML = `
        <div class="marker-icon ${categoryClass} ${controlStatus.class}" data-status="${controlStatus.status}">
          ${categoryIcon}
          ${warningBadge}
        </div>
        <div class="marker-label">
          <span class="marker-name">${escapeHtml(shortName)}</span>
        </div>
      `;
      el.dataset.customerId = String(customer.id);

      // Create Mapbox GL JS marker
      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([customer.lng, customer.lat]);

      // Store customer data on marker for cluster access
      marker._customerData = {
        id: customer.id,
        poststed: customer.poststed,
        hasWarning: showWarning
      };
      marker._addedToMap = false;

      // Click — open popup
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        showMapPopup(
          [customer.lng, customer.lat],
          generatePopupContent(customer),
          { maxWidth: '350px', offset: [0, -35] }
        );
      });

      // Context menu (right-click)
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showMarkerContextMenu(customer, ev.clientX, ev.clientY);
      });

      // Long-press for mobile (500ms threshold)
      let longPressTimer = null;
      el.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          const touch = e.touches[0];
          if (touch) {
            showMarkerContextMenu(customer, touch.clientX, touch.clientY);
          }
        }, 500);
      }, { passive: true });
      el.addEventListener('touchend', () => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      });
      el.addEventListener('touchmove', () => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      });

      // Hover tooltip (PC only)
      if (hasFeature('hover_tooltip')) {
        el.addEventListener('mouseenter', (ev) => {
          if (window.innerWidth > 768 && !currentPopup) {
            showMarkerTooltip(customer, el, ev);
          }
        });
        el.addEventListener('mouseleave', () => {
          // Delay hide to allow moving mouse to tooltip actions
          setTimeout(() => {
            if (activeTooltipEl && !activeTooltipEl._hovered) {
              hideMarkerTooltip();
            }
          }, 100);
        });
      }

      // Drag-to-weekplan: custom drag with mousedown
      el.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        const startX = ev.clientX;
        const startY = ev.clientY;
        let isDragging = false;
        let dragTimeout = null;

        dragTimeout = setTimeout(() => {
          isDragging = true;
          map.dragPan.disable();
          startMarkerDrag(customer.id, startX, startY);
        }, 300);

        const onMouseMove = (moveEv) => {
          if (!isDragging) {
            const dist = Math.abs(moveEv.clientX - startX) + Math.abs(moveEv.clientY - startY);
            if (dist > 10) {
              clearTimeout(dragTimeout);
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
            }
            return;
          }
          updateMarkerDrag(moveEv.clientX, moveEv.clientY);
        };

        const onMouseUp = () => {
          clearTimeout(dragTimeout);
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          if (isDragging) {
            endMarkerDrag(customer.id);
            map.dragPan.enable();
          }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      markers[customer.id] = marker;
    }
  });

  // Load data into Supercluster and render
  loadClusterData(customerData);
  updateClusters();

  Logger.log('renderMarkers: Created', Object.keys(markers).length, 'markers with Supercluster clustering');

  // Re-apply presence badges after markers are in DOM
  if (presenceClaims.size > 0) {
    setTimeout(updatePresenceBadges, 200);
  }
}

// Focus on customer on map
function focusOnCustomer(customerId) {
  const customer = customers.find(c => c.id === customerId);
  if (!customer) return;

  // On mobile: close content panel and switch to map view
  if (isMobile && document.getElementById('bottomTabBar')) {
    closeContentPanelMobile();
    hideMobileFilterSheet();
    document.querySelectorAll('.bottom-tab-item').forEach(b =>
      b.classList.toggle('active', b.dataset.bottomTab === 'map')
    );
    activeBottomTab = 'map';
    const searchFab = document.getElementById('mobileSearchFab');
    if (searchFab) searchFab.classList.remove('hidden');
  }

  if (customer.lat && customer.lng) {
    const delay = isMobile ? 150 : 0;
    setTimeout(() => {
      map.resize();
      map.flyTo({ center: [customer.lng, customer.lat], zoom: 14, duration: 1000 });

      // Open popup after fly animation
      setTimeout(() => {
        showMapPopup(
          [customer.lng, customer.lat],
          generatePopupContent(customer),
          { maxWidth: '350px', offset: [0, -35] }
        );
      }, 1100);
    }, delay);
  } else {
    showNotification(`${customer.navn} mangler koordinater - bruk geokoding`);
  }
}

// Toggle customer selection
function toggleCustomerSelection(customerId) {
  if (selectedCustomers.has(customerId)) {
    selectedCustomers.delete(customerId);
  } else {
    selectedCustomers.add(customerId);
  }
  updateSelectionUI();
}

// Update UI based on selection
function updateSelectionUI() {
  if (selectedCount) selectedCount.textContent = selectedCustomers.size;
  if (planRouteBtn) planRouteBtn.disabled = selectedCustomers.size < 2;
  if (clearSelectionBtn) clearSelectionBtn.disabled = selectedCustomers.size === 0;

  // Update mobile FAB visibility
  const mobileRouteFab = document.getElementById('mobileRouteBtn');
  const mobileRouteCount = document.getElementById('mobileRouteCount');
  if (mobileRouteFab && mobileRouteCount) {
    if (selectedCustomers.size >= 2) {
      mobileRouteFab.classList.remove('hidden');
      mobileRouteCount.textContent = selectedCustomers.size;
    } else {
      mobileRouteFab.classList.add('hidden');
    }
  }

  // Update mobile selection indicator
  updateMobileSelectionFab();

  // Update list items
  document.querySelectorAll('.customer-item').forEach(item => {
    const id = Number.parseInt(item.dataset.id);
    item.classList.toggle('selected', selectedCustomers.has(id));
  });

  // Update marker selection styles without full re-render
  updateMarkerSelectionStyles();
}

// Update selection CSS on existing markers
function updateMarkerSelectionStyles() {
  for (const [id, marker] of Object.entries(markers)) {
    const el = marker.getElement();
    if (!el) continue;
    const customerId = Number.parseInt(id);
    const isSelected = selectedCustomers.has(customerId);
    el.classList.toggle('selected', isSelected);
    const iconDiv = el.querySelector('.marker-icon');
    if (iconDiv) iconDiv.classList.toggle('selected', isSelected);
  }
}

// Update route selection UI after programmatic selection changes
function updateRouteSelection() {
  updateSelectionUI();
}

// Clear selection
function clearSelection() {
  selectedCustomers.clear();
  updateSelectionUI();
  clearRoute();
}

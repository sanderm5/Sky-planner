// Render markers on map
let renderMarkersRetryCount = 0;
const MAX_RENDER_RETRIES = 10;

function renderMarkers(customerData) {
  // Don't render markers if still on login view (prevents markers showing through login overlay)
  if (currentView === 'login') {
    Logger.log('renderMarkers skipped - still on login view');
    renderMarkersRetryCount = 0;
    return;
  }

  // Safety check - markerClusterGroup must be initialized
  if (!markerClusterGroup) {
    if (renderMarkersRetryCount >= MAX_RENDER_RETRIES) {
      console.error('renderMarkers failed after max retries - markerClusterGroup never initialized');
      renderMarkersRetryCount = 0;
      return;
    }
    renderMarkersRetryCount++;
    console.error(`renderMarkers called but markerClusterGroup is null - retry ${renderMarkersRetryCount}/${MAX_RENDER_RETRIES}`);
    setTimeout(() => renderMarkers(customerData), 100);
    return;
  }

  // Reset retry count on successful render
  renderMarkersRetryCount = 0;

  // Clear existing markers from cluster (with error handling for animation edge cases)
  try {
    markerClusterGroup.clearLayers();
  } catch (e) {
    // Leaflet animation race condition - recreate cluster group
    console.warn('clearLayers failed, recreating cluster group:', e.message);
    map.removeLayer(markerClusterGroup);
    markerClusterGroup = L.markerClusterGroup({
      maxClusterRadius: appConfig.mapClusterRadius || 60,
      iconCreateFunction: createClusterIcon,
      disableClusteringAtZoom: 14,
      spiderfyOnMaxZoom: true,
      spiderfyOnEveryZoom: false,
      spiderfyDistanceMultiplier: 2.5,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      animate: true,
      animateAddingMarkers: false,
      singleMarkerMode: false
    });
    map.addLayer(markerClusterGroup);
  }
  markers = {};

  // Log what we're rendering
  const kategorier = {};
  customerData.forEach(c => {
    const kat = c.kategori || 'null';
    kategorier[kat] = (kategorier[kat] || 0) + 1;
  });
  Logger.log('renderMarkers:', customerData.length, 'kunder', kategorier);

  // Collect markers to add with staggered animation
  const markersToAdd = [];

  customerData.forEach(customer => {
    if (customer.lat && customer.lng) {
      const isSelected = selectedCustomers.has(customer.id);
      const controlStatus = getControlStatus(customer);

      // Create marker with simplified label (performance optimization)
      const shortName = customer.navn.length > 20 ? customer.navn.substring(0, 18) + '...' : customer.navn;

      // Show warning icon for urgent statuses
      const showWarning = controlStatus.status === 'forfalt' || controlStatus.status === 'denne-uke' || controlStatus.status === 'snart';
      const warningBadge = showWarning ? '<span class="marker-warning-badge">!</span>' : '';

      // Determine category icon dynamically from ServiceTypeRegistry
      let categoryIcon, categoryClass;
      const serviceTypes = serviceTypeRegistry.getAll();
      if (customer.kategori && serviceTypes.length > 0) {
        // Use the customer's own category to determine icon
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

      const icon = L.divIcon({
        className: `custom-marker-with-label ${isSelected ? 'selected' : ''} ${controlStatus.class}`,
        html: `
          <div class="marker-icon ${categoryClass} ${controlStatus.class}" data-status="${controlStatus.status}">
            ${categoryIcon}
            ${warningBadge}
          </div>
          <div class="marker-label">
            <span class="marker-name">${escapeHtml(shortName)}</span>
          </div>
        `,
        iconSize: [42, 42],
        iconAnchor: [21, 35]
      });

      // Lazy popup - generate content only when opened (performance optimization)
      // Store customer data on marker for cluster icon (avoids parsing popup content)
      const marker = L.marker([customer.lat, customer.lng], {
        icon,
        customerData: {
          id: customer.id,
          poststed: customer.poststed,
          hasWarning: showWarning
        }
      }).bindPopup(() => generatePopupContent(customer), { maxWidth: 350 });

      marker.on('click', () => {
        marker.openPopup();
      });

      // Context menu (right-click on PC, long-press on mobile)
      // Leaflet contextmenu event on marker
      marker.on('contextmenu', (e) => {
        L.DomEvent.stopPropagation(e);
        L.DomEvent.preventDefault(e);
        showMarkerContextMenu(customer, e.originalEvent.clientX, e.originalEvent.clientY);
      });

      // Also attach native contextmenu to DOM element for reliability
      // Leaflet's divIcon can miss events depending on click target within the icon
      marker.on('add', () => {
        const el = marker.getElement();
        if (el && !el.dataset.ctxInit) {
          el.dataset.ctxInit = 'true';
          el.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            showMarkerContextMenu(customer, ev.clientX, ev.clientY);
          });
        }
      });

      // Long-press for mobile (500ms threshold)
      let longPressTimer = null;
      marker.on('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          const touch = e.originalEvent.touches[0];
          if (touch) {
            showMarkerContextMenu(customer, touch.clientX, touch.clientY);
          }
        }, 500);
      });
      marker.on('touchend touchmove', () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });
      // Clear timer if marker is removed from DOM (e.g. cluster animation)
      marker.on('remove', () => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      });

      // Hover tooltip (PC only - mouseover)
      if (hasFeature('hover_tooltip')) {
        marker.on('mouseover', (e) => {
          if (window.innerWidth > 768 && !marker.isPopupOpen()) {
            showMarkerTooltip(customer, e.target._icon, e.originalEvent);
          }
        });
        marker.on('mouseout', () => {
          hideMarkerTooltip();
        });
        marker.on('popupopen', () => {
          hideMarkerTooltip();
        });
      }

      // Drag-to-category: custom drag with mousedown/mousemove/mouseup
      marker.on('add', () => {
        const el = marker.getElement();
        if (el && !el.dataset.dragInit) {
          el.dataset.dragInit = 'true';
          el.dataset.customerId = String(customer.id);
          let dragTimeout = null;

          el.addEventListener('mousedown', (ev) => {
            if (ev.button !== 0) return; // Only left click
            const startX = ev.clientX;
            const startY = ev.clientY;
            let isDragging = false;

            // Start drag after holding 300ms (avoids conflict with click)
            dragTimeout = setTimeout(() => {
              isDragging = true;
              map.dragging.disable();
              startMarkerDrag(customer.id, startX, startY);
            }, 300);

            const onMouseMove = (moveEv) => {
              // Cancel if mouse moved significantly before timeout (user is panning)
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
                map.dragging.enable();
              }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
          });
        }
      });

      // Collect marker for staggered animation
      markersToAdd.push({ marker, customerId: customer.id });
      markers[customer.id] = marker;
    }
  });

  // Add markers to the map
  if (markersToAdd.length > 0) {
    // Add all markers at once
    markersToAdd.forEach(item => {
      markerClusterGroup.addLayer(item.marker);
    });
    Logger.log('renderMarkers: Added', markersToAdd.length, 'markers to cluster group');

    // Re-apply presence badges after markers are in DOM
    if (presenceClaims.size > 0) {
      setTimeout(updatePresenceBadges, 200);
    }
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
      map.invalidateSize();
      map.setView([customer.lat, customer.lng], 14);
      if (markers[customerId]) {
        markers[customerId].openPopup();
      }
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

// Update selection CSS on existing markers (avoids expensive full re-render)
function updateMarkerSelectionStyles() {
  for (const [id, marker] of Object.entries(markers)) {
    const el = marker.getElement();
    if (!el) continue;
    const customerId = Number.parseInt(id);
    const isSelected = selectedCustomers.has(customerId);
    el.classList.toggle('selected', isSelected);
    // Also update the inner marker-icon div
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


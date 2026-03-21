// PANEL ZOOM OPACITY - Fade all panels when zooming into the map
// ================================================================
// When the map zooms in (any method: scroll wheel, flyTo, fitBounds),
// sidebar, content panel and filter panel become progressively more
// transparent so the map gets focus. Hovering a panel restores its
// own opacity temporarily.
//
// Uses a CSS custom property + ::after overlay instead of element opacity
// to avoid breaking stacking context / z-index / pointer-events.

let _panelBaseZoom = null;
const _hoveredPanels = new Set();
const PANEL_OPACITY_MIN = 0.35;
const PANEL_OPACITY_MAX_DELTA = 10;

const PANEL_IDS = ['sidebar', 'contentPanel', 'filterPanel'];

function _getVisiblePanels() {
  const panels = [];
  for (const id of PANEL_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.classList.contains('closed') || el.classList.contains('slide-out') || el.classList.contains('collapsed')) continue;
    panels.push(el);
  }
  return panels;
}

function _calcDim(zoomDelta) {
  if (zoomDelta <= 0) return 0;
  const t = Math.min(zoomDelta / PANEL_OPACITY_MAX_DELTA, 1);
  return t * (1.0 - PANEL_OPACITY_MIN);
}

function _applyDim(panel, dim) {
  if (dim <= 0) {
    panel.classList.remove('zoom-dimmed');
    panel.style.removeProperty('--zoom-dim');
  } else {
    panel.style.setProperty('--zoom-dim', dim);
    panel.classList.add('zoom-dimmed');
  }
}

function updatePanelZoomOpacity() {
  if (_panelBaseZoom === null) return;

  const currentZoom = map.getZoom();
  const zoomDelta = currentZoom - _panelBaseZoom;

  if (zoomDelta <= 0) {
    _panelBaseZoom = currentZoom;
    for (const panel of _getVisiblePanels()) {
      _applyDim(panel, 0);
    }
    return;
  }

  const dim = _calcDim(zoomDelta);
  for (const panel of _getVisiblePanels()) {
    if (_hoveredPanels.has(panel.id)) continue;
    _applyDim(panel, dim);
  }
}

function resetPanelOpacity() {
  for (const id of PANEL_IDS) {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('zoom-fading', 'zoom-dimmed');
      el.style.removeProperty('--zoom-dim');
    }
  }
  _panelBaseZoom = null;
  _hoveredPanels.clear();
}

function initPanelZoomOpacity() {
  if (!map) return;

  _panelBaseZoom = map.getZoom();

  // Wrap flyTo and fitBounds to add zoom-fading class for smooth CSS transitions
  const originalFlyTo = map.flyTo.bind(map);
  const originalFitBounds = map.fitBounds.bind(map);

  map.flyTo = function(options, eventData) {
    for (const panel of _getVisiblePanels()) {
      panel.classList.add('zoom-fading');
    }
    return originalFlyTo(options, eventData);
  };

  map.fitBounds = function(bounds, options, eventData) {
    for (const panel of _getVisiblePanels()) {
      panel.classList.add('zoom-fading');
    }
    return originalFitBounds(bounds, options, eventData);
  };

  // Continuous opacity update during any zoom
  map.on('zoom', updatePanelZoomOpacity);

  // Remove transition class after programmatic zoom ends
  map.on('zoomend', () => {
    setTimeout(() => {
      for (const id of PANEL_IDS) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('zoom-fading');
      }
    }, 150);
  });

  // Restore on hover per panel
  for (const id of PANEL_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;

    el.addEventListener('mouseenter', () => {
      _hoveredPanels.add(id);
      _applyDim(el, 0);
    });

    el.addEventListener('mouseleave', () => {
      _hoveredPanels.delete(id);
      if (_panelBaseZoom !== null && map) {
        const zoomDelta = map.getZoom() - _panelBaseZoom;
        if (zoomDelta > 0) {
          _applyDim(el, _calcDim(zoomDelta));
        }
      }
    });
  }
}

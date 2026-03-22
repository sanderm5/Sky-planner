// ========================================
// TEAM ZONES — Territory + marker coloring per team member
// 1. Colors customer marker borders by assigned team member
// 2. Draws filled zone polygons on the map
// ========================================

const TeamZones = {
  visible: false,
  layerIds: [],
  legendEl: null,

  toggle() {
    this.visible = !this.visible;
    localStorage.setItem('skyplanner_teamZonesVisible', this.visible ? '1' : '');
    if (this.visible) {
      this.render();
      this.colorMarkers();
      this.showLegend();
    } else {
      this.clear();
      this.clearMarkerColors();
      this.removeLegend();
    }
    const btn = document.querySelector('.wp-team-zone-toggle');
    if (btn) btn.classList.toggle('active', this.visible);
  },

  update() {
    if (!this.visible) return;
    this.clear();
    this.render();
    this.colorMarkers();
    this.showLegend();
  },

  restore() {
    this.visible = localStorage.getItem('skyplanner_teamZonesVisible') === '1';
    if (this.visible && typeof map !== 'undefined' && map) {
      this.render();
      this.colorMarkers();
      this.showLegend();
    }
  },

  // ---- Marker coloring ----

  colorMarkers() {
    if (typeof getWeekTeamMembers !== 'function' || typeof markers === 'undefined') return;
    const teamMembers = getWeekTeamMembers();

    // Build kundeId → color map
    const colorMap = new Map();
    for (const m of teamMembers) {
      for (const id of m.kundeIds) {
        colorMap.set(id, m.color);
      }
    }

    for (const kundeId of Object.keys(markers)) {
      const el = markers[kundeId].getElement();
      if (!el) continue;
      const iconEl = el.querySelector('.marker-icon');
      if (!iconEl) continue;

      const color = colorMap.get(Number(kundeId));
      if (color) {
        iconEl.style.borderColor = color;
        iconEl.style.borderWidth = '4px';
        iconEl.style.boxShadow = `0 0 0 2px ${color}40, 0 0 12px ${color}60, 0 2px 8px rgba(0,0,0,0.5)`;
        el.dataset.teamZoneColor = color;
      }
    }
  },

  clearMarkerColors() {
    if (typeof markers === 'undefined') return;
    for (const kundeId of Object.keys(markers)) {
      const el = markers[kundeId].getElement();
      if (!el || !el.dataset.teamZoneColor) continue;
      const iconEl = el.querySelector('.marker-icon');
      if (iconEl) {
        iconEl.style.borderColor = '';
        iconEl.style.borderWidth = '';
        iconEl.style.boxShadow = '';
      }
      delete el.dataset.teamZoneColor;
    }
  },

  // ---- Zone rendering ----

  render() {
    if (!map || typeof getWeekTeamMembers !== 'function') return;

    const teamMembers = getWeekTeamMembers();
    if (teamMembers.length === 0) return;

    for (const member of teamMembers) {
      const coords = this._collectCoords(member.kundeIds);
      if (coords.length === 0) continue;

      // Generate buffered points around each customer (3km radius, 12 segments)
      // This guarantees a polygon with area even when points are collinear
      const bufferedPoints = [];
      const radiusM = 3000;
      const midLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      const cosLat = Math.cos(midLat * Math.PI / 180);
      const rLat = radiusM / 111320;
      const rLng = rLat / cosLat;

      for (const [lng, lat] of coords) {
        for (let i = 0; i < 12; i++) {
          const angle = (2 * Math.PI * i) / 12;
          bufferedPoints.push([
            lat + rLat * Math.sin(angle),
            lng + rLng * Math.cos(angle)
          ]);
        }
      }

      // Compute convex hull of all buffered points
      const hull = getConvexHull(bufferedPoints);
      const polygon = hull.map(p => [p[1], p[0]]); // back to [lng, lat]
      polygon.push(polygon[0]); // close ring

      const srcId = `team-zone-${member.name.replace(/[^a-zA-Z0-9]/g, '-')}`;
      const fillId = srcId + '-fill';
      const lineId = srcId + '-line';

      try {
        this._removeIfExists(srcId, fillId, lineId);

        map.addSource(srcId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Polygon', coordinates: [polygon] }
          }
        });

        map.addLayer({
          id: fillId,
          type: 'fill',
          source: srcId,
          paint: {
            'fill-color': member.color,
            'fill-opacity': 0.22
          }
        });

        map.addLayer({
          id: lineId,
          type: 'line',
          source: srcId,
          paint: {
            'line-color': member.color,
            'line-width': 3,
            'line-opacity': 0.8
          }
        });

        this.layerIds.push(srcId, fillId, lineId);
      } catch (err) {
        Logger.log('TeamZones: Kunne ikke tegne sone for ' + member.name, err);
      }
    }
  },

  clear() {
    if (!map) return;
    for (const id of this.layerIds) {
      try {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      } catch { /* ignore */ }
    }
    this.layerIds = [];
  },

  // ---- Legend ----

  showLegend() {
    this.removeLegend();
    if (typeof getWeekTeamMembers !== 'function') return;

    const teamMembers = getWeekTeamMembers();
    if (teamMembers.length === 0) return;

    const legend = document.createElement('div');
    legend.className = 'team-zones-legend';

    let html = '<div class="team-zones-legend-handle"><i class="fas fa-grip-lines" aria-hidden="true"></i></div>';
    html += '<div class="team-zones-legend-title">Teamområder denne uken</div>';
    for (const m of teamMembers) {
      html += `<div class="team-zones-legend-item">
        <span class="team-zones-legend-swatch" style="background:${m.color}"></span>
        <span class="team-zones-legend-name">${escapeHtml(m.name)}</span>
        <span class="team-zones-legend-count">${m.count} kunder</span>
      </div>`;
    }
    legend.innerHTML = html;
    document.body.appendChild(legend);
    this.legendEl = legend;
    this._makeDraggable(legend);
  },

  _makeDraggable(el) {
    let startX, startY, startLeft, startTop;
    const handle = el.querySelector('.team-zones-legend-handle') || el;

    const onMove = (e) => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      el.style.left = (startLeft + cx - startX) + 'px';
      el.style.top = (startTop + cy - startY) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.transform = 'none';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };
    const onDown = (e) => {
      e.preventDefault();
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      const rect = el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    };
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
  },

  removeLegend() {
    if (this.legendEl) {
      this.legendEl.remove();
      this.legendEl = null;
    }
  },

  onStyleLoad() {
    if (this.visible) {
      setTimeout(() => {
        this.clear();
        this.render();
      }, 200);
    }
  },

  // ---- Helpers ----

  _collectCoords(kundeIds) {
    const coords = [];
    if (!kundeIds || typeof markers === 'undefined') return coords;
    for (const id of kundeIds) {
      const marker = markers[id];
      if (!marker) continue;
      const lngLat = marker.getLngLat();
      if (lngLat) coords.push([lngLat.lng, lngLat.lat]);
    }
    return coords;
  },

  _removeIfExists(srcId, fillId, lineId) {
    try {
      if (map.getLayer(fillId)) map.removeLayer(fillId);
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getSource(srcId)) map.removeSource(srcId);
    } catch { /* ignore */ }
  }
};

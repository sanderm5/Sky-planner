// ========================================
// SMART ROUTE ENGINE
// Geografisk klynging med effektivitetsberegning
// ========================================

const SmartRouteEngine = {
  // Bruker-konfigurerbare parametere
  params: {
    daysAhead: parseInt(localStorage.getItem('smartRoute_daysAhead')) || 60,
    maxCustomersPerRoute: parseInt(localStorage.getItem('smartRoute_maxCustomers')) || 15,
    maxDrivingTimeMinutes: parseInt(localStorage.getItem('smartRoute_maxDrivingTime')) || 480,
    minClusterSize: 3,
    clusterRadiusKm: parseFloat(localStorage.getItem('smartRoute_clusterRadius')) || 5,
    serviceTimeMinutes: 30
  },

  // State
  clusters: [],
  selectedClusterId: null,
  clusterLayer: null,
  showAllRecommendations: false,

  // Lagre parametere til localStorage
  saveParams() {
    localStorage.setItem('smartRoute_daysAhead', this.params.daysAhead);
    localStorage.setItem('smartRoute_maxCustomers', this.params.maxCustomersPerRoute);
    localStorage.setItem('smartRoute_maxDrivingTime', this.params.maxDrivingTimeMinutes);
    localStorage.setItem('smartRoute_clusterRadius', this.params.clusterRadiusKm);
  },

  // Haversine-avstand mellom to punkter (km)
  haversineDistance(lat1, lng1, lat2, lng2) {
    // Valider at alle koordinater er gyldige tall
    if (!Number.isFinite(lat1) || !Number.isFinite(lng1) ||
        !Number.isFinite(lat2) || !Number.isFinite(lng2)) {
      return Infinity; // Ugyldig avstand - vil bli filtrert ut
    }
    const R = 6371; // Jordens radius i km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  // Beregn sentroid for en gruppe kunder
  getCentroid(customerList) {
    if (customerList.length === 0) return null;
    const sumLat = customerList.reduce((sum, c) => sum + c.lat, 0);
    const sumLng = customerList.reduce((sum, c) => sum + c.lng, 0);
    return {
      lat: sumLat / customerList.length,
      lng: sumLng / customerList.length
    };
  },

  // Beregn bounding box for en gruppe kunder
  getBoundingBox(customerList) {
    const lats = customerList.map(c => c.lat);
    const lngs = customerList.map(c => c.lng);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs)
    };
  },

  // Filtrer kunder som trenger kontroll
  getCustomersNeedingControl() {
    // Sjekk at customers array er tilgjengelig og gyldig
    if (!customers || !Array.isArray(customers) || customers.length === 0) {
      return [];
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + this.params.daysAhead);

    return customers.filter(c => {
      if (!c) return false; // Hopp over null/undefined kunder
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return false; // Må ha gyldige koordinater
      const nextDate = getNextControlDate(c);
      if (!nextDate || !(nextDate instanceof Date) || isNaN(nextDate.getTime())) return false;
      return nextDate <= futureDate;
    });
  },

  // DBSCAN-klynging
  dbscanClustering(customerList, epsilon, minPoints) {
    const n = customerList.length;
    if (n === 0) return [];

    const visited = new Array(n).fill(false);
    const noise = new Array(n).fill(false);
    const clusterIds = new Array(n).fill(-1);
    let currentCluster = 0;

    // Bygg spatial grid for raskere nabo-oppslag (O(1) per celle i stedet for O(n))
    const cellSizeKm = epsilon; // Cellestørrelse lik epsilon
    const cellSizeDeg = cellSizeKm / 111; // Konverter km til grader (approx)
    const grid = {};

    // Plasser alle kunder i grid-celler
    customerList.forEach((c, idx) => {
      const cellX = Math.floor(c.lng / cellSizeDeg);
      const cellY = Math.floor(c.lat / cellSizeDeg);
      const key = `${cellX},${cellY}`;
      if (!grid[key]) grid[key] = [];
      grid[key].push(idx);
    });

    // Finn naboer via grid (sjekker kun 9 nærliggende celler)
    const getNeighbors = (pointIndex) => {
      const neighbors = [];
      const p = customerList[pointIndex];
      const cellX = Math.floor(p.lng / cellSizeDeg);
      const cellY = Math.floor(p.lat / cellSizeDeg);

      // Sjekk 3x3 celler rundt punktet
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${cellX + dx},${cellY + dy}`;
          const cellIndices = grid[key];
          if (cellIndices) {
            for (const i of cellIndices) {
              if (i !== pointIndex) {
                const dist = this.haversineDistance(p.lat, p.lng, customerList[i].lat, customerList[i].lng);
                if (dist <= epsilon) {
                  neighbors.push(i);
                }
              }
            }
          }
        }
      }
      return neighbors;
    };

    // Ekspander klynge (optimalisert med Set for O(1) lookup)
    const expandCluster = (pointIndex, neighbors, clusterId) => {
      clusterIds[pointIndex] = clusterId;
      const queue = [...neighbors];
      const queueSet = new Set(neighbors); // O(1) lookup i stedet for O(n)

      while (queue.length > 0) {
        const currentIndex = queue.shift();

        if (!visited[currentIndex]) {
          visited[currentIndex] = true;
          const currentNeighbors = getNeighbors(currentIndex);

          if (currentNeighbors.length >= minPoints) {
            for (const neighbor of currentNeighbors) {
              if (!queueSet.has(neighbor) && clusterIds[neighbor] === -1) {
                queue.push(neighbor);
                queueSet.add(neighbor);
              }
            }
          }
        }

        if (clusterIds[currentIndex] === -1) {
          clusterIds[currentIndex] = clusterId;
        }
      }
    };

    // Hovedløkke
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      visited[i] = true;

      const neighbors = getNeighbors(i);

      if (neighbors.length < minPoints) {
        noise[i] = true;
      } else {
        expandCluster(i, neighbors, currentCluster);
        currentCluster++;
      }
    }

    // Grupper kunder etter klynge-ID
    const clusters = [];
    for (let clusterId = 0; clusterId < currentCluster; clusterId++) {
      const clusterCustomers = customerList.filter((_, idx) => clusterIds[idx] === clusterId);
      if (clusterCustomers.length >= minPoints) {
        clusters.push(clusterCustomers);
      }
    }

    return clusters;
  },

  // Beregn effektivitetsscore for en klynge
  calculateClusterEfficiency(cluster) {
    const n = cluster.length;
    if (n < 2) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Start-lokasjon (fra config eller default)
    const startLat = appConfig.routeStartLat || 59.9139;
    const startLng = appConfig.routeStartLng || 10.7522;

    // Sentroid
    const centroid = this.getCentroid(cluster);

    // Avstand fra start til sentroid
    const distanceToStart = this.haversineDistance(startLat, startLng, centroid.lat, centroid.lng);

    // Klyngens kompakthet (gjennomsnittlig avstand fra sentroid)
    const avgDistanceFromCentroid = cluster.reduce((sum, c) =>
      sum + this.haversineDistance(c.lat, c.lng, centroid.lat, centroid.lng), 0
    ) / n;

    // Kundetetthet (kunder per km²)
    const bbox = this.getBoundingBox(cluster);
    const latDiff = (bbox.maxLat - bbox.minLat) * 111; // ~111 km per grad lat
    const lngDiff = (bbox.maxLng - bbox.minLng) * 111 * Math.cos(centroid.lat * Math.PI / 180);
    const area = Math.max(latDiff * lngDiff, 0.1); // Minimum 0.1 km²
    const density = n / area;

    // Tell forfalte kunder
    const overdueCount = cluster.filter(c => {
      const nextDate = getNextControlDate(c);
      return nextDate && nextDate < today;
    }).length;

    // Estimert kjøretid (minutter)
    // - Tur-retur til klynge: avstand * 2 / 50 km/t * 60 min
    // - Intra-klynge kjøring: gjennomsnittlig avstand * antall * 2 / 30 km/t * 60 min
    // - Servicetid per kunde
    const travelToCluster = (distanceToStart * 2 / 50) * 60;
    const intraClusterTravel = (avgDistanceFromCentroid * n * 1.5 / 30) * 60;
    const serviceTime = n * this.params.serviceTimeMinutes;
    const estimatedMinutes = Math.round(travelToCluster + intraClusterTravel + serviceTime);

    // Estimert distanse (km)
    const estimatedKm = Math.round(distanceToStart * 2 + avgDistanceFromCentroid * n * 1.5);

    // Effektivitetsscore (0-100)
    // Høyere er bedre: belønner tetthet og antall, straffer lang avstand
    const rawScore = (density * n * 10) / (1 + distanceToStart * 0.05 + avgDistanceFromCentroid * 0.3);
    const efficiencyScore = Math.min(100, Math.round(rawScore * 10));

    // Finn primært område (mest vanlige poststed)
    const areaCount = {};
    cluster.forEach(c => {
      const area = c.poststed || 'Ukjent';
      areaCount[area] = (areaCount[area] || 0) + 1;
    });
    const sortedAreas = Object.entries(areaCount).sort((a, b) => b[1] - a[1]);
    const primaryArea = sortedAreas.length > 0 ? sortedAreas[0][0] : 'Ukjent';

    // Kategorier i klyngen
    const categories = [...new Set(cluster.map(c => c.kategori).filter(Boolean))];

    return {
      customers: cluster,
      customerCount: n,
      centroid,
      primaryArea,
      categories,
      overdueCount,
      upcomingCount: n - overdueCount,
      efficiencyScore,
      estimatedMinutes,
      estimatedKm,
      density: Math.round(density * 10) / 10,
      avgDistanceFromCentroid: Math.round(avgDistanceFromCentroid * 10) / 10,
      distanceToStart: Math.round(distanceToStart)
    };
  },

  // Generer anbefalinger
  generateRecommendations() {
    const customersNeedingControl = this.getCustomersNeedingControl();

    Logger.log('SmartRouteEngine: Kunder som trenger kontroll:', customersNeedingControl.length);

    if (customersNeedingControl.length < this.params.minClusterSize) {
      Logger.log('SmartRouteEngine: For få kunder, prøver fallback til område-basert');
      // Fallback til område-basert gruppering
      return this.generateAreaBasedRecommendations(customersNeedingControl);
    }

    // DBSCAN-klynging
    let rawClusters = this.dbscanClustering(
      customersNeedingControl,
      this.params.clusterRadiusKm,
      this.params.minClusterSize
    );

    Logger.log('SmartRouteEngine: DBSCAN fant', rawClusters.length, 'klynger');

    // Hvis DBSCAN ikke finner noe, prøv med større radius eller fallback
    if (rawClusters.length === 0 && customersNeedingControl.length >= 3) {
      Logger.log('SmartRouteEngine: Ingen DBSCAN-klynger, prøver større radius');
      // Prøv med dobbel radius
      rawClusters = this.dbscanClustering(
        customersNeedingControl,
        this.params.clusterRadiusKm * 2,
        this.params.minClusterSize
      );

      // Hvis fortsatt ingen, bruk område-basert fallback
      if (rawClusters.length === 0) {
        Logger.log('SmartRouteEngine: Bruker område-basert fallback');
        return this.generateAreaBasedRecommendations(customersNeedingControl);
      }
    }

    // Beregn effektivitet for hver klynge
    const scoredClusters = rawClusters
      .map((cluster, idx) => {
        const efficiency = this.calculateClusterEfficiency(cluster);
        if (!efficiency) return null;

        // Filtrer ut klynger som tar for lang tid
        if (efficiency.estimatedMinutes > this.params.maxDrivingTimeMinutes) {
          // Del opp i mindre klynger hvis for stor
          if (cluster.length > this.params.maxCustomersPerRoute) {
            return null; // For nå, hopp over
          }
        }

        // Begrens antall kunder per rute
        if (cluster.length > this.params.maxCustomersPerRoute) {
          // Ta de nærmeste til sentroiden
          const sorted = [...cluster].sort((a, b) => {
            const distA = this.haversineDistance(a.lat, a.lng, efficiency.centroid.lat, efficiency.centroid.lng);
            const distB = this.haversineDistance(b.lat, b.lng, efficiency.centroid.lat, efficiency.centroid.lng);
            return distA - distB;
          });
          const trimmed = sorted.slice(0, this.params.maxCustomersPerRoute);
          return this.calculateClusterEfficiency(trimmed);
        }

        return { ...efficiency, id: idx };
      })
      .filter(Boolean);

    // Sorter etter effektivitetsscore (høyest først)
    this.clusters = scoredClusters
      .sort((a, b) => b.efficiencyScore - a.efficiencyScore)
      .map((cluster, idx) => ({ ...cluster, id: idx }));

    return this.clusters;
  },

  // Vis/skjul klynge på kartet (toggle)
  showClusterOnMap(clusterId) {
    const cluster = this.clusters.find(c => c.id === clusterId);
    if (!cluster) return;

    // Sjekk at kart er initialisert
    if (!map) {
      showToast('Kartet er ikke lastet enda', 'warning');
      return;
    }

    // Toggle: Hvis samme klynge allerede vises, skjul den
    if (this.selectedClusterId === clusterId) {
      this.clearClusterVisualization();
      this.updateClusterButtons(); // Oppdater knapper
      return;
    }

    this.clearClusterVisualization();
    this.selectedClusterId = clusterId;
    this.updateClusterButtons(); // Oppdater knapper

    // Lag layer group for visualisering
    this.clusterLayer = L.layerGroup().addTo(map);

    // Tegn convex hull polygon rundt kundene
    const positions = cluster.customers.map(c => [c.lat, c.lng]);
    if (positions.length >= 3) {
      const hull = this.convexHull(positions);
      const polygon = L.polygon(hull, {
        color: '#ff6b00',
        weight: 2,
        fillColor: '#ff6b00',
        fillOpacity: 0.15,
        dashArray: '5, 5'
      }).addTo(this.clusterLayer);
    }

    // Marker kunder i klyngen
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    cluster.customers.forEach((c, idx) => {
      const nextDate = getNextControlDate(c);
      const isOverdue = nextDate && nextDate < today;

      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 10,
        color: isOverdue ? '#e74c3c' : '#f39c12',
        weight: 2,
        fillColor: isOverdue ? '#e74c3c' : '#f39c12',
        fillOpacity: 0.8
      }).addTo(this.clusterLayer);

      marker.bindPopup(`
        <strong>${escapeHtml(c.navn)}</strong><br>
        ${escapeHtml(c.adresse || '')}<br>
        <small>${isOverdue ? 'Forfalt' : 'Kommende'}</small>
      `);
    });

    // Marker sentroiden
    const centroidMarker = L.marker([cluster.centroid.lat, cluster.centroid.lng], {
      icon: L.divIcon({
        className: 'cluster-centroid-marker',
        html: `<div class="centroid-icon"><i class="fas fa-crosshairs"></i></div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      })
    }).addTo(this.clusterLayer);

    // Zoom til klyngen
    const bounds = L.latLngBounds(positions);
    map.fitBounds(bounds, { padding: [50, 50] });

    // Oppdater knapper etter visning
    this.updateClusterButtons();
  },

  // Fjern klynge-visualisering
  clearClusterVisualization() {
    if (this.clusterLayer && map) {
      map.removeLayer(this.clusterLayer);
      this.clusterLayer = null;
    }
    this.selectedClusterId = null;
  },

  // Oppdater knapper etter toggle
  updateClusterButtons() {
    // Finn alle "Vis detaljer" knapper og oppdater tekst
    document.querySelectorAll('.recommendation-card.enhanced').forEach(card => {
      const clusterId = parseInt(card.dataset.clusterId);
      const btn = card.querySelector('.rec-actions .btn-secondary');
      if (btn) {
        if (clusterId === this.selectedClusterId) {
          btn.innerHTML = '<i class="fas fa-eye-slash"></i> Skjul';
          card.classList.add('selected');
        } else {
          btn.innerHTML = '<i class="fas fa-map"></i> Vis detaljer';
          card.classList.remove('selected');
        }
      }
    });
  },

  // Convex hull algoritme (Gift wrapping)
  convexHull(points) {
    if (points.length < 3) return points;

    const cross = (o, a, b) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

    // Finn startpunkt (lavest lat, med tiebreaker på lng)
    let start = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i][0] < points[start][0] ||
         (points[i][0] === points[start][0] && points[i][1] < points[start][1])) {
        start = i;
      }
    }

    const hull = [];
    let current = start;

    do {
      hull.push(points[current]);
      let next = 0;

      for (let i = 1; i < points.length; i++) {
        if (next === current || cross(points[current], points[next], points[i]) < 0) {
          next = i;
        }
      }

      current = next;
    } while (current !== start && hull.length < points.length);

    return hull;
  },

  // Opprett rute fra klynge
  createRouteFromCluster(clusterId) {
    const cluster = this.clusters.find(c => c.id === clusterId);
    if (!cluster) return;

    const customerIds = cluster.customers.map(c => c.id);
    createRouteFromCustomerIds(customerIds);
    showToast(`${cluster.customerCount} kunder valgt fra ${cluster.primaryArea}. Beregner rute...`);
    // Auto-calculate route after selecting customers
    planRoute();
  },

  // Fallback: Område-basert gruppering (som den gamle metoden)
  generateAreaBasedRecommendations(customersNeedingControl) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Hvis ingen kunder sendt inn, hent alle som trenger kontroll
    const customerList = customersNeedingControl.length > 0
      ? customersNeedingControl
      : this.getCustomersNeedingControl();

    if (customerList.length === 0) {
      this.clusters = [];
      return [];
    }

    // Grupper etter poststed
    const byArea = {};
    customerList.forEach(c => {
      const area = c.poststed || 'Ukjent';
      if (!byArea[area]) byArea[area] = [];
      byArea[area].push(c);
    });

    // Konverter til klynge-format med effektivitetsberegning
    const areaRecommendations = Object.entries(byArea)
      .filter(([area, custs]) => custs.length >= 2) // Minimum 2 kunder per område
      .map(([area, custs], idx) => {
        // Filtrer til kun kunder med koordinater
        const withCoords = custs.filter(c => c.lat && c.lng);
        if (withCoords.length < 2) return null;

        // Beregn effektivitet
        const efficiency = this.calculateClusterEfficiency(withCoords);
        if (!efficiency) return null;

        return {
          ...efficiency,
          id: idx,
          isAreaBased: true // Marker at dette er område-basert, ikke DBSCAN
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.efficiencyScore - a.efficiencyScore);

    this.clusters = areaRecommendations.map((cluster, idx) => ({ ...cluster, id: idx }));

    Logger.log('SmartRouteEngine: Område-basert fallback fant', this.clusters.length, 'klynger');

    return this.clusters;
  }
};

/**
 * Get smart area recommendations for route planning
 * Groups customers by poststed who need control within daysAhead days
 * @deprecated Use SmartRouteEngine.generateRecommendations() instead
 */
function getSmartAreaRecommendations(daysAhead = 60, minCustomers = 3) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + daysAhead);

  // Find customers needing control within daysAhead days
  const needsControl = customers.filter(c => {
    const nextDate = getNextControlDate(c);
    if (!nextDate) return false;
    return nextDate <= futureDate;
  });

  // Group by poststed
  const byArea = {};
  needsControl.forEach(c => {
    const area = c.poststed || 'Ukjent';
    if (!byArea[area]) byArea[area] = [];
    byArea[area].push(c);
  });

  // Filter areas with at least minCustomers customers
  const recommendations = Object.entries(byArea)
    .filter(([area, custs]) => custs.length >= minCustomers)
    .map(([area, custs]) => ({
      area,
      customers: custs,
      count: custs.length,
      overdue: custs.filter(c => getNextControlDate(c) < today).length,
      categories: [...new Set(custs.map(c => c.kategori).filter(Boolean))]
    }))
    .sort((a, b) => b.count - a.count);

  return recommendations;
}

/**
 * Render smart recommendations in Ruteplanlegger tab
 * Uses SmartRouteEngine for geographic clustering
 */
function renderSmartRecommendations() {
  const container = document.getElementById('smartRecommendations');
  if (!container) return;

  // Oppdater SmartRouteEngine params fra HTML inputs
  const daysInput = document.getElementById('smartDaysAhead');
  const customersInput = document.getElementById('smartMaxCustomers');
  const radiusInput = document.getElementById('smartClusterRadius');

  if (daysInput) SmartRouteEngine.params.daysAhead = parseInt(daysInput.value) || 60;
  if (customersInput) SmartRouteEngine.params.maxCustomersPerRoute = parseInt(customersInput.value) || 15;
  if (radiusInput) SmartRouteEngine.params.clusterRadiusKm = parseFloat(radiusInput.value) || 5;

  // Lagre params
  SmartRouteEngine.saveParams();

  // Generer anbefalinger med SmartRouteEngine
  const recommendations = SmartRouteEngine.generateRecommendations();

  let html = '';

  if (recommendations.length === 0) {
    // Vis mer detaljert info om hvorfor ingen anbefalinger ble funnet
    const customersWithDates = customers.filter(c => getNextControlDate(c));
    const customersWithCoords = customers.filter(c => c.lat && c.lng);
    const needingControl = SmartRouteEngine.getCustomersNeedingControl();

    let emptyMessage = 'Ingen ruteklynger funnet.';
    let emptyHint = '';

    if (customers.length === 0) {
      emptyMessage = 'Ingen kunder i systemet.';
    } else if (customersWithCoords.length === 0) {
      emptyMessage = 'Ingen kunder har koordinater.';
      emptyHint = 'Legg til adresser med koordinater for å få ruteanbefalinger.';
    } else if (customersWithDates.length === 0) {
      emptyMessage = 'Ingen kunder har kontrolldatoer.';
      emptyHint = 'Legg til neste kontrolldato for å få ruteanbefalinger.';
    } else if (needingControl.length === 0) {
      emptyMessage = 'Ingen kontroller forfaller innen ' + SmartRouteEngine.params.daysAhead + ' dager.';
      emptyHint = 'Prøv å øke "Dager fremover" i innstillingene.';
    } else if (needingControl.length < 3) {
      emptyMessage = 'Kun ' + needingControl.length + ' kunde(r) trenger kontroll.';
      emptyHint = 'Minimum 2 kunder trengs for å danne en rute.';
    }

    html += `
      <div class="rec-empty">
        <i class="fas fa-info-circle"></i>
        <p>${emptyMessage}</p>
        ${emptyHint ? `<p class="rec-empty-hint">${emptyHint}</p>` : ''}
        <p class="rec-empty-stats">
          <small>${customers.length} kunder totalt | ${customersWithCoords.length} med koordinater | ${needingControl.length} trenger kontroll</small>
        </p>
      </div>`;
    container.innerHTML = html;
    return;
  }

  const maxVisible = SmartRouteEngine.showAllRecommendations ? recommendations.length : 6;
  recommendations.slice(0, maxVisible).forEach(rec => {
    // Bestem effektivitetsklasse
    let efficiencyClass = 'low';
    if (rec.efficiencyScore >= 70) efficiencyClass = 'high';
    else if (rec.efficiencyScore >= 40) efficiencyClass = 'medium';

    // Formater tid
    const hours = Math.floor(rec.estimatedMinutes / 60);
    const mins = rec.estimatedMinutes % 60;
    const timeStr = hours > 0 ? `${hours}t ${mins}m` : `${mins}m`;

    html += `
      <div class="recommendation-card enhanced ${SmartRouteEngine.selectedClusterId === rec.id ? 'selected' : ''}" data-cluster-id="${rec.id}">
        <div class="rec-header">
          <div class="rec-title">
            <span class="rec-cluster-id">#${rec.id + 1}</span>
            <h4><i class="fas fa-map-pin"></i> ${escapeHtml(rec.primaryArea)}</h4>
          </div>
          <div class="rec-efficiency ${efficiencyClass}">
            <span class="efficiency-score">${rec.efficiencyScore}%</span>
            <span class="efficiency-label">effektivitet</span>
          </div>
        </div>

        <div class="rec-metrics">
          <div class="metric">
            <i class="fas fa-users"></i>
            <span>${rec.customerCount} kunder</span>
          </div>
          <div class="metric">
            <i class="fas fa-road"></i>
            <span>~${rec.estimatedKm} km</span>
          </div>
          <div class="metric">
            <i class="fas fa-clock"></i>
            <span>~${timeStr}</span>
          </div>
          ${rec.overdueCount > 0 ? `
          <div class="metric urgency">
            <i class="fas fa-exclamation-triangle"></i>
            <span>${rec.overdueCount} forfalte</span>
          </div>
          ` : ''}
        </div>

        <div class="rec-categories">
          ${rec.categories.map(c => `<span class="category-tag">${escapeHtml(c)}</span>`).join('') || '<span class="category-tag">Diverse</span>'}
        </div>

        <div class="rec-actions">
          <button class="btn btn-secondary btn-small" data-action="showClusterOnMap" data-cluster-id="${rec.id}">
            ${SmartRouteEngine.selectedClusterId === rec.id
              ? '<i class="fas fa-eye-slash"></i> Skjul'
              : '<i class="fas fa-map"></i> Vis detaljer'}
          </button>
          <button class="btn btn-primary btn-small" data-action="createRouteFromCluster" data-cluster-id="${rec.id}">
            <i class="fas fa-route"></i> Opprett rute
          </button>
        </div>
      </div>
    `;
  });

  if (recommendations.length > 6) {
    if (SmartRouteEngine.showAllRecommendations) {
      html += `<button class="btn btn-link rec-toggle-all" data-action="toggleShowAllRecommendations">
        <i class="fas fa-chevron-up"></i> Vis færre
      </button>`;
    } else {
      html += `<button class="btn btn-link rec-toggle-all" data-action="toggleShowAllRecommendations">
        <i class="fas fa-chevron-down"></i> Vis alle ${recommendations.length} anbefalinger
      </button>`;
    }
  }

  container.innerHTML = html;
}

/**
 * Toggle showing all recommendations vs limited
 */
function toggleShowAllRecommendations() {
  SmartRouteEngine.showAllRecommendations = !SmartRouteEngine.showAllRecommendations;
  renderSmartRecommendations();
}

/**
 * Update smart route settings and regenerate recommendations
 */
function updateSmartRouteSettings() {
  // Hent verdier fra inputs
  const daysAhead = parseInt(document.getElementById('smartDaysAhead')?.value) || 60;
  const maxCustomers = parseInt(document.getElementById('smartMaxCustomers')?.value) || 15;
  const maxDrivingTime = parseInt(document.getElementById('smartMaxDrivingTime')?.value) || 480;
  const clusterRadius = parseFloat(document.getElementById('smartClusterRadius')?.value) || 5;

  // Oppdater SmartRouteEngine
  SmartRouteEngine.params.daysAhead = daysAhead;
  SmartRouteEngine.params.maxCustomersPerRoute = maxCustomers;
  SmartRouteEngine.params.maxDrivingTimeMinutes = maxDrivingTime;
  SmartRouteEngine.params.clusterRadiusKm = clusterRadius;

  // Lagre til localStorage
  SmartRouteEngine.saveParams();

  // Fjern eventuell klynge-visualisering
  SmartRouteEngine.clearClusterVisualization();

  // Regenerer anbefalinger
  renderSmartRecommendations();

  showToast('Innstillinger oppdatert');
}

// Flag for å unngå duplikate event listeners
let smartRouteListenersInitialized = false;

/**
 * Initialize smart route settings slider listeners and values
 */
function initSmartRouteSettingsListeners() {
  // Params er allerede lastet fra localStorage i SmartRouteEngine.params

  // Oppdater slider-verdier fra lagrede params
  const daysSlider = document.getElementById('smartDaysAhead');
  const customersSlider = document.getElementById('smartMaxCustomers');
  const radiusSlider = document.getElementById('smartClusterRadius');

  if (daysSlider) {
    daysSlider.value = SmartRouteEngine.params.daysAhead;
    const daysValue = document.getElementById('smartDaysAheadValue');
    if (daysValue) daysValue.textContent = `${SmartRouteEngine.params.daysAhead} dager`;
  }

  if (customersSlider) {
    customersSlider.value = SmartRouteEngine.params.maxCustomersPerRoute;
    const customersValue = document.getElementById('smartMaxCustomersValue');
    if (customersValue) customersValue.textContent = `${SmartRouteEngine.params.maxCustomersPerRoute} kunder`;
  }

  if (radiusSlider) {
    radiusSlider.value = SmartRouteEngine.params.clusterRadiusKm;
    const radiusValue = document.getElementById('smartClusterRadiusValue');
    if (radiusValue) radiusValue.textContent = `${SmartRouteEngine.params.clusterRadiusKm} km`;
  }

  // Bare legg til event listeners én gang - men kun hvis sliderne finnes
  if (smartRouteListenersInitialized) return;
  if (!daysSlider || !customersSlider || !radiusSlider) return; // Vent til DOM er klar
  smartRouteListenersInitialized = true;

  // Hjelpefunksjon for å vise tooltip ved slider
  const showSliderTooltip = (slider, value, unit) => {
    let tooltip = slider.parentElement.querySelector('.slider-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'slider-tooltip';
      slider.parentElement.style.position = 'relative';
      slider.parentElement.appendChild(tooltip);
    }

    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const percent = ((parseFloat(slider.value) - min) / (max - min)) * 100;

    tooltip.textContent = `${value}${unit}`;
    tooltip.style.left = `${percent}%`;
    tooltip.classList.add('visible');
  };

  const hideSliderTooltip = (slider) => {
    const tooltip = slider.parentElement.querySelector('.slider-tooltip');
    if (tooltip) {
      tooltip.classList.remove('visible');
    }
  };

  // Dager fremover
  if (daysSlider) {
    daysSlider.addEventListener('input', function() {
      const val = this.value;
      const valueEl = document.getElementById('smartDaysAheadValue');
      if (valueEl) valueEl.textContent = `${val} dager`;
      showSliderTooltip(this, val, ' dager');
    });
    daysSlider.addEventListener('mouseup', function() { hideSliderTooltip(this); });
    daysSlider.addEventListener('mouseleave', function() { hideSliderTooltip(this); });
    daysSlider.addEventListener('touchend', function() { hideSliderTooltip(this); });
  }

  // Maks kunder
  if (customersSlider) {
    customersSlider.addEventListener('input', function() {
      const val = this.value;
      const valueEl = document.getElementById('smartMaxCustomersValue');
      if (valueEl) valueEl.textContent = `${val} kunder`;
      showSliderTooltip(this, val, ' kunder');
    });
    customersSlider.addEventListener('mouseup', function() { hideSliderTooltip(this); });
    customersSlider.addEventListener('mouseleave', function() { hideSliderTooltip(this); });
    customersSlider.addEventListener('touchend', function() { hideSliderTooltip(this); });
  }

  // Klyngeradius
  if (radiusSlider) {
    radiusSlider.addEventListener('input', function() {
      const val = this.value;
      const valueEl = document.getElementById('smartClusterRadiusValue');
      if (valueEl) valueEl.textContent = `${val} km`;
      showSliderTooltip(this, val, ' km');
    });
    radiusSlider.addEventListener('mouseup', function() { hideSliderTooltip(this); });
    radiusSlider.addEventListener('mouseleave', function() { hideSliderTooltip(this); });
    radiusSlider.addEventListener('touchend', function() { hideSliderTooltip(this); });
  }
}

/**
 * Show customers from a specific area on the map
 */
function showAreaOnMap(area) {
  const areaCustomers = customers.filter(c => c.poststed === area);
  if (areaCustomers.length === 0) return;

  // Get valid coordinates
  const coords = areaCustomers
    .filter(c => c.lat && c.lng)
    .map(c => [c.lat, c.lng]);

  if (coords.length === 0) {
    showToast('Ingen kunder med koordinater i dette området', 'warning');
    return;
  }

  // Fit map to bounds
  const bounds = L.latLngBounds(coords);
  map.fitBounds(bounds, { padding: [50, 50] });

  // Highlight the customers
  highlightCustomersOnMap(areaCustomers.map(c => c.id));

  showToast(`Viser ${areaCustomers.length} kunder i ${area}`);
}

/**
 * Create a route for customers in a specific area
 */
function createRouteForArea(area, customerIds) {
  if (!customerIds || customerIds.length === 0) {
    showToast('Ingen kunder å lage rute for', 'warning');
    return;
  }

  // Use existing route creation function
  createRouteFromCustomerIds(customerIds);
  switchToTab('routes');
  showToast(`Opprettet rute for ${area} med ${customerIds.length} kunder`);
}

/**
 * Highlight specific customers on the map with area highlight
 */
function highlightCustomersOnMap(customerIds) {
  // Clear previous highlights
  clearMapHighlights();

  // Create a layer group for highlight rings
  window.highlightLayer = L.layerGroup().addTo(map);
  window.highlightedCustomerIds = customerIds;

  // Get positions of all customers to highlight
  const positions = [];
  customers.forEach(c => {
    if (customerIds.includes(c.id) && c.lat && c.lng) {
      positions.push([c.lat, c.lng]);
    }
  });

  if (positions.length === 0) {
    showToast('Ingen kunder med koordinater funnet', 'warning');
    return;
  }

  // Add small marker at each position
  positions.forEach(pos => {
    const dot = L.circleMarker(pos, {
      radius: 8,
      color: '#ff6b00',
      weight: 2,
      fillColor: '#ff6b00',
      fillOpacity: 0.8,
      className: 'highlight-dot'
    }).addTo(window.highlightLayer);
  });

  // Create area highlight around all points
  if (positions.length >= 3) {
    // Use convex hull for 3+ points
    const hull = getConvexHull(positions);
    const polygon = L.polygon(hull, {
      color: '#ff6b00',
      weight: 3,
      fillColor: '#ff6b00',
      fillOpacity: 0.1,
      dashArray: '8, 8',
      className: 'highlight-area'
    }).addTo(window.highlightLayer);
  } else if (positions.length === 2) {
    // Draw line between 2 points with buffer
    const line = L.polyline(positions, {
      color: '#ff6b00',
      weight: 4,
      dashArray: '8, 8',
      className: 'highlight-area'
    }).addTo(window.highlightLayer);
  } else {
    // Single point - draw larger circle
    const circle = L.circle(positions[0], {
      radius: 500,
      color: '#ff6b00',
      weight: 2,
      fillColor: '#ff6b00',
      fillOpacity: 0.1,
      dashArray: '8, 8',
      className: 'highlight-area'
    }).addTo(window.highlightLayer);
  }

  // Show count
  showToast(`${positions.length} kunder i området markert`, 'success');
}

/**
 * Calculate convex hull of points (Graham scan algorithm)
 */
function getConvexHull(points) {
  if (points.length < 3) return points;

  // Find lowest point
  let lowest = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i][0] < points[lowest][0] ||
        (points[i][0] === points[lowest][0] && points[i][1] < points[lowest][1])) {
      lowest = i;
    }
  }

  // Swap lowest to first position
  [points[0], points[lowest]] = [points[lowest], points[0]];
  const pivot = points[0];

  // Sort by polar angle
  const sorted = points.slice(1).sort((a, b) => {
    const angleA = Math.atan2(a[0] - pivot[0], a[1] - pivot[1]);
    const angleB = Math.atan2(b[0] - pivot[0], b[1] - pivot[1]);
    return angleA - angleB;
  });

  // Build hull
  const hull = [pivot];
  for (const point of sorted) {
    while (hull.length > 1 && crossProduct(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
      hull.pop();
    }
    hull.push(point);
  }

  return hull;
}

function crossProduct(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/**
 * Clear all map highlights
 */
function clearMapHighlights() {
  if (window.highlightLayer) {
    window.highlightLayer.clearLayers();
    map.removeLayer(window.highlightLayer);
    window.highlightLayer = null;
  }
  window.highlightedCustomerIds = [];
}

/**
 * Switch to a specific tab
 */
function switchToTab(tabName) {
  const tabBtn = document.querySelector(`.tab-item[data-tab="${tabName}"]`);
  if (tabBtn) {
    tabBtn.click();
  }
}

// Sync map view to match the active tab context (mobile only)
function syncMapToTab(tabName) {
  if (!isMobile || !map) return;

  switch (tabName) {
    case 'customers': {
      const positions = customers
        .filter(c => c.lat && c.lng)
        .map(c => [c.lat, c.lng]);
      if (positions.length > 0) {
        map.fitBounds(L.latLngBounds(positions), { padding: [30, 30] });
      }
      break;
    }
    case 'routes': {
      if (routeLayer && routeLayer.getBounds) {
        try {
          map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
        } catch (e) {
          // routeLayer may be empty
        }
      }
      break;
    }
    case 'overdue': {
      const now = new Date();
      const overduePositions = customers
        .filter(c => c.neste_kontroll && c.lat && c.lng && new Date(c.neste_kontroll) < now)
        .map(c => [c.lat, c.lng]);
      if (overduePositions.length > 0) {
        map.fitBounds(L.latLngBounds(overduePositions), { padding: [30, 30] });
      }
      break;
    }
  }
}


// Cluster customers by geographic proximity using DBSCAN
function getProximityRadius() {
  return Number(localStorage.getItem('proximity_radiusKm')) || 15;
}

function clusterCustomersByProximity(customerList) {
  const epsilonKm = getProximityRadius();

  // Filter to only customers with valid coordinates
  const withCoords = customerList.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng));
  const withoutCoords = customerList.filter(c => !Number.isFinite(c.lat) || !Number.isFinite(c.lng));

  if (withCoords.length === 0) {
    return {
      clusters: [],
      noise: withoutCoords,
      summary: { totalCustomers: withoutCoords.length, clusterCount: 0, noiseCount: withoutCoords.length }
    };
  }

  // dbscanClustering returns Array<Array<Customer>> — each inner array is one cluster.
  // Customers not in any returned cluster are "noise" (isolated points).
  let dbscanResult;
  try {
    dbscanResult = SmartRouteEngine.dbscanClustering(withCoords, epsilonKm, 2);
  } catch (err) {
    console.error('DBSCAN clustering failed, falling back to poststed grouping:', err);
    dbscanResult = null;
  }

  // Fallback: group by poststed if DBSCAN failed or returned nothing usable
  if (!dbscanResult || !Array.isArray(dbscanResult)) {
    const byPoststed = {};
    withCoords.forEach(c => {
      const ps = c.poststed || 'Ukjent';
      if (!byPoststed[ps]) byPoststed[ps] = [];
      byPoststed[ps].push(c);
    });
    const fallbackClusters = Object.entries(byPoststed).map(([ps, custs]) => ({
      customers: custs,
      centroid: SmartRouteEngine.getCentroid(custs),
      radiusKm: 0,
      areaName: ps
    }));
    fallbackClusters.sort((a, b) => b.customers.length - a.customers.length);
    return {
      clusters: fallbackClusters,
      noise: withoutCoords,
      summary: { totalCustomers: customerList.length, clusterCount: fallbackClusters.length, noiseCount: withoutCoords.length }
    };
  }

  // Identify noise: customers with coords that aren't in any DBSCAN cluster
  const clusteredSet = new Set();
  dbscanResult.forEach(clusterArr => {
    clusterArr.forEach(c => clusteredSet.add(c));
  });
  const noise = [...withoutCoords, ...withCoords.filter(c => !clusteredSet.has(c))];

  // If DBSCAN produced 0 clusters (all noise), group all into one
  if (dbscanResult.length === 0 && withCoords.length > 0) {
    const centroid = SmartRouteEngine.getCentroid(withCoords);
    const poststedCounts = {};
    withCoords.forEach(c => { poststedCounts[c.poststed || 'Ukjent'] = (poststedCounts[c.poststed || 'Ukjent'] || 0) + 1; });
    const topPoststed = Object.entries(poststedCounts).sort((a, b) => b[1] - a[1])[0][0];
    return {
      clusters: [{ customers: withCoords, centroid, radiusKm: 0, areaName: topPoststed }],
      noise: withoutCoords,
      summary: { totalCustomers: customerList.length, clusterCount: 1, noiseCount: withoutCoords.length }
    };
  }

  // Build cluster objects with metadata from each DBSCAN cluster array
  const clusters = dbscanResult.map(clusterCustomers => {
    const centroid = SmartRouteEngine.getCentroid(clusterCustomers);
    let maxDist = 0;
    clusterCustomers.forEach(c => {
      const dist = SmartRouteEngine.haversineDistance(centroid.lat, centroid.lng, c.lat, c.lng);
      if (dist > maxDist) maxDist = dist;
    });

    // Build area name from unique poststeder (most common first)
    const poststedCounts = {};
    clusterCustomers.forEach(c => {
      const ps = c.poststed || 'Ukjent';
      poststedCounts[ps] = (poststedCounts[ps] || 0) + 1;
    });
    const sortedPoststeder = Object.entries(poststedCounts).sort((a, b) => b[1] - a[1]);
    let areaName;
    if (sortedPoststeder.length === 1) {
      areaName = sortedPoststeder[0][0];
    } else if (sortedPoststeder.length === 2) {
      areaName = `${sortedPoststeder[0][0]} / ${sortedPoststeder[1][0]}`;
    } else {
      areaName = `${sortedPoststeder[0][0]}-området (${sortedPoststeder.length} steder)`;
    }

    return {
      customers: clusterCustomers,
      centroid,
      radiusKm: maxDist,
      areaName
    };
  });

  // Sort clusters by size descending
  clusters.sort((a, b) => b.customers.length - a.customers.length);

  return {
    clusters,
    noise,
    summary: { totalCustomers: customerList.length, clusterCount: clusters.length, noiseCount: noise.length }
  };
}

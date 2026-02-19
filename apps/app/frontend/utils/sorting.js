// ========================================
// SORTING UTILITIES
// ========================================

// Sort array of objects by 'navn' property using Norwegian locale
function sortByNavn(arr) {
  return arr.sort((a, b) => a.navn.localeCompare(b.navn, 'nb'));
}

// Sort strings using Norwegian locale
function compareNorwegian(a, b) {
  return a.localeCompare(b, 'nb');
}

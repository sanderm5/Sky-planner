/**
 * Category Matcher Service
 * Fuzzy matching av kategorier fra Excel-import til gyldige database-verdier
 */

// Gyldige kategorier i systemet
const VALID_CATEGORIES = {
  'El-Kontroll': [
    'el-kontroll', 'el kontroll', 'elkontroll', 'el', 'elsjekk',
    'el-sjekk', 'elektrisk', 'elektrisk kontroll', 'el kontrol',
    'elkontrol', 'el-kontrol', 'elektro', 'elektrokontroll'
  ],
  'Brannvarsling': [
    'brannvarsling', 'brann', 'brannvarsel', 'brannvarsler',
    'brannalarm', 'brann-varsling', 'brann varsling', 'brannvarslingsanlegg',
    'alarm', 'brannsikring', 'brannsikkerhet'
  ],
  'El-Kontroll + Brannvarsling': [
    'el-kontroll + brannvarsling', 'begge', 'el+brann', 'el og brann',
    'el & brann', 'brann og el', 'brann+el', 'el-kontroll og brannvarsling',
    'brannvarsling og el-kontroll', 'full kontroll', 'komplett',
    'el + brann', 'brann + el', 'kombinert', 'alle tjenester'
  ]
};

const VALID_EL_TYPES = {
  'Landbruk': ['landbruk', 'gård', 'gard', 'bonde', 'jordbruk', 'farm', 'fjøs', 'fjos', 'låve', 'lave'],
  'Næring': ['næring', 'naering', 'bedrift', 'kontor', 'butikk', 'industri', 'næringsbygg', 'naeringsbygg', 'firma'],
  'Bolig': ['bolig', 'hus', 'leilighet', 'privat', 'enebolig', 'rekkehus', 'hjem', 'private'],
  'Gartneri': ['gartneri', 'drivhus', 'gartner', 'planteskole', 'veksthus']
};

const VALID_BRANN_SYSTEMS = {
  'Elotec': ['elotec', 'elotec system', 'elotec-system'],
  'ICAS': ['icas', 'icas system', 'icas-system'],
  'Elotec + ICAS': ['elotec + icas', 'elotec og icas', 'begge systemer', 'elotec+icas', 'icas+elotec'],
  '2x Elotec': ['2x elotec', '2 elotec', 'to elotec', 'dobbel elotec', '2xelotec']
};

const VALID_DRIFTSTYPER = {
  'Storfe': ['storfe', 'ku', 'kyr', 'melkeku', 'kjøttfe', 'kjottfe'],
  'Sau': ['sau', 'sauer', 'sauehold'],
  'Geit': ['geit', 'geiter', 'geitehold'],
  'Gris': ['gris', 'griser', 'svin', 'svinehold'],
  'Storfe/Sau': ['storfe/sau', 'storfe og sau', 'sau og storfe', 'kombinert'],
  'Gartneri': ['gartneri', 'drivhus', 'veksthus'],
  'Ingen': ['ingen', 'ikke relevant', 'n/a', 'na', '-', '']
};

/**
 * Beregn Levenshtein-avstand mellom to strenger
 */
function levenshteinDistance(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,  // substitution
          matrix[i][j - 1] + 1,       // insertion
          matrix[i - 1][j] + 1        // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Beregn likhet mellom to strenger (0-1)
 */
function calculateSimilarity(a, b) {
  if (!a || !b) return 0;
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - (distance / maxLength);
}

/**
 * Normaliser input-streng for matching
 */
function normalizeInput(input) {
  if (!input || typeof input !== 'string') return '';

  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')           // Normaliser whitespace
    .replace(/[^\wæøåÆØÅ\s+-\/]/gi, ''); // Behold norske tegn og vanlige separatorer
}

/**
 * Match en verdi mot et sett med gyldige verdier
 * @param {string} input - Verdien som skal matches
 * @param {Object} validValues - Objekt med canonical: [variants]
 * @param {number} threshold - Minimum likhet for fuzzy match (0-1)
 * @returns {Object} { normalizedValue, confidence, matchType, suggestions }
 */
function matchValue(input, validValues, threshold = 0.7) {
  if (!input || typeof input !== 'string') {
    return { normalizedValue: null, confidence: 0, matchType: 'none', suggestions: [] };
  }

  const normalized = normalizeInput(input);

  if (!normalized) {
    return { normalizedValue: null, confidence: 0, matchType: 'none', suggestions: [] };
  }

  // 1. Eksakt match mot canonical verdi
  for (const [canonical, variants] of Object.entries(validValues)) {
    if (canonical.toLowerCase() === normalized) {
      return { normalizedValue: canonical, confidence: 1, matchType: 'exact', suggestions: [] };
    }
  }

  // 2. Eksakt match mot varianter
  for (const [canonical, variants] of Object.entries(validValues)) {
    if (variants.some(v => v === normalized)) {
      return { normalizedValue: canonical, confidence: 0.95, matchType: 'exact', suggestions: [] };
    }
  }

  // 3. Fuzzy match
  let bestMatch = { normalizedValue: null, confidence: 0, matchType: 'none', suggestions: [] };
  const allSuggestions = [];

  for (const [canonical, variants] of Object.entries(validValues)) {
    const allVariants = [canonical.toLowerCase(), ...variants];

    for (const variant of allVariants) {
      const similarity = calculateSimilarity(normalized, variant);

      if (similarity >= threshold) {
        allSuggestions.push({ value: canonical, similarity });

        if (similarity > bestMatch.confidence) {
          bestMatch = {
            normalizedValue: canonical,
            confidence: similarity,
            matchType: 'fuzzy',
            suggestions: []
          };
        }
      }
    }
  }

  // Legg til topp 3 suggestions sortert etter likhet
  bestMatch.suggestions = allSuggestions
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3)
    .map(s => s.value);

  return bestMatch;
}

/**
 * Match kategori
 */
function matchCategory(input) {
  return matchValue(input, VALID_CATEGORIES, 0.6);
}

/**
 * Match el-type
 */
function matchElType(input) {
  return matchValue(input, VALID_EL_TYPES, 0.7);
}

/**
 * Match brann-system
 */
function matchBrannSystem(input) {
  return matchValue(input, VALID_BRANN_SYSTEMS, 0.7);
}

/**
 * Match driftstype
 */
function matchDriftstype(input) {
  return matchValue(input, VALID_DRIFTSTYPER, 0.7);
}

/**
 * Analyser alle kategorier i et datasett
 * @param {Array} rows - Array med rader fra Excel
 * @param {string} categoryColumn - Navn på kategori-kolonnen
 * @returns {Object} { detected: [...], unknown: [...] }
 */
function analyzeCategories(rows, categoryColumn) {
  const categoryMap = new Map(); // original -> { count, matchResult }

  for (const row of rows) {
    const value = row[categoryColumn];
    if (!value) continue;

    const key = String(value).trim();
    if (!categoryMap.has(key)) {
      const matchResult = matchCategory(key);
      categoryMap.set(key, { count: 0, matchResult });
    }
    categoryMap.get(key).count++;
  }

  const detected = [];
  const unknown = [];

  for (const [originalValue, { count, matchResult }] of categoryMap) {
    if (matchResult.normalizedValue) {
      detected.push({
        originalValue,
        normalizedTo: matchResult.normalizedValue,
        confidence: matchResult.confidence,
        count
      });
    } else {
      unknown.push({
        value: originalValue,
        count,
        suggestions: Object.keys(VALID_CATEGORIES)
      });
    }
  }

  return { detected, unknown };
}

/**
 * Hent alle gyldige verdier for en type
 */
function getValidValues(type) {
  switch (type) {
    case 'kategori':
      return Object.keys(VALID_CATEGORIES);
    case 'el_type':
      return Object.keys(VALID_EL_TYPES);
    case 'brann_system':
      return Object.keys(VALID_BRANN_SYSTEMS);
    case 'brann_driftstype':
    case 'driftskategori':
      return Object.keys(VALID_DRIFTSTYPER);
    default:
      return [];
  }
}

export {
  matchCategory,
  matchElType,
  matchBrannSystem,
  matchDriftstype,
  matchValue,
  analyzeCategories,
  getValidValues,
  calculateSimilarity,
  VALID_CATEGORIES,
  VALID_EL_TYPES,
  VALID_BRANN_SYSTEMS,
  VALID_DRIFTSTYPER
};

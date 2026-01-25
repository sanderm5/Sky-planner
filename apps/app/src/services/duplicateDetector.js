/**
 * Duplicate Detector Service
 * Detekterer duplikater i import-data mot eksisterende database
 */

import { calculateSimilarity } from './categoryMatcher.js';

/**
 * Normaliser tekst for sammenligning
 */
function normalizeForComparison(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\wæøåÆØÅ\s]/gi, '');
}

/**
 * Sjekk om to kunder er duplikater basert på navn og adresse
 * @param {Object} kunde1
 * @param {Object} kunde2
 * @returns {Object} { isDuplicate, score, matchedFields }
 */
function compareCustomers(kunde1, kunde2) {
  const name1 = normalizeForComparison(kunde1.navn);
  const name2 = normalizeForComparison(kunde2.navn);
  const addr1 = normalizeForComparison(kunde1.adresse);
  const addr2 = normalizeForComparison(kunde2.adresse);

  // Eksakt match på både navn og adresse
  if (name1 === name2 && addr1 === addr2) {
    return { isDuplicate: true, score: 1, matchedFields: ['navn', 'adresse'], matchType: 'exact' };
  }

  // Fuzzy match på navn
  const nameSimilarity = calculateSimilarity(name1, name2);
  const addrSimilarity = calculateSimilarity(addr1, addr2);

  // Høy likhet på begge
  if (nameSimilarity >= 0.9 && addrSimilarity >= 0.9) {
    return {
      isDuplicate: true,
      score: (nameSimilarity + addrSimilarity) / 2,
      matchedFields: ['navn (fuzzy)', 'adresse (fuzzy)'],
      matchType: 'fuzzy'
    };
  }

  // Eksakt match på navn, fuzzy på adresse
  if (name1 === name2 && addrSimilarity >= 0.8) {
    return {
      isDuplicate: true,
      score: addrSimilarity,
      matchedFields: ['navn', 'adresse (fuzzy)'],
      matchType: 'partial'
    };
  }

  // Sjekk e-post match hvis begge har e-post
  if (kunde1.epost && kunde2.epost) {
    const email1 = kunde1.epost.toLowerCase().trim();
    const email2 = kunde2.epost.toLowerCase().trim();
    if (email1 === email2) {
      return { isDuplicate: true, score: 0.95, matchedFields: ['epost'], matchType: 'email' };
    }
  }

  // Sjekk telefon match hvis begge har telefon
  if (kunde1.telefon && kunde2.telefon) {
    const phone1 = String(kunde1.telefon).replace(/\D/g, '');
    const phone2 = String(kunde2.telefon).replace(/\D/g, '');
    if (phone1.length >= 8 && phone1 === phone2) {
      return { isDuplicate: true, score: 0.9, matchedFields: ['telefon'], matchType: 'phone' };
    }
  }

  return { isDuplicate: false, score: 0, matchedFields: [], matchType: 'none' };
}

/**
 * Finn duplikater i import-filen selv
 * @param {Array} rows - Array med rader fra Excel
 * @returns {Map} rowNumber -> { matchedRow, score, matchedFields }
 */
function findDuplicatesInFile(rows) {
  const duplicates = new Map();
  const seen = new Map(); // normalizedKey -> rowIndex

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = normalizeForComparison(row.navn);
    const addr = normalizeForComparison(row.adresse);
    const key = `${name}|${addr}`;

    if (seen.has(key)) {
      const firstRow = seen.get(key);
      duplicates.set(i, {
        matchedRow: firstRow,
        score: 1,
        matchedFields: ['navn', 'adresse'],
        matchType: 'exact_in_file'
      });
    } else {
      seen.set(key, i);
    }
  }

  return duplicates;
}

/**
 * Sjekk en kunde mot eksisterende kunder i databasen
 * @param {Object} kunde - Kundedata å sjekke
 * @param {Array} existingCustomers - Eksisterende kunder fra databasen
 * @returns {Object|null} Match info eller null
 */
function findDuplicateInDatabase(kunde, existingCustomers) {
  const name = normalizeForComparison(kunde.navn);
  const addr = normalizeForComparison(kunde.adresse);

  for (const existing of existingCustomers) {
    const existingName = normalizeForComparison(existing.navn);
    const existingAddr = normalizeForComparison(existing.adresse);

    // Eksakt match på navn og adresse
    if (name === existingName && addr === existingAddr) {
      return {
        existingId: existing.id,
        existingNavn: existing.navn,
        existingAdresse: existing.adresse,
        score: 1,
        matchedFields: ['navn', 'adresse'],
        matchType: 'exact'
      };
    }

    // Fuzzy match på navn med samme poststed
    const nameSimilarity = calculateSimilarity(name, existingName);
    if (nameSimilarity >= 0.9 && kunde.poststed && existing.poststed) {
      const poststed1 = normalizeForComparison(kunde.poststed);
      const poststed2 = normalizeForComparison(existing.poststed);
      if (poststed1 === poststed2) {
        return {
          existingId: existing.id,
          existingNavn: existing.navn,
          existingAdresse: existing.adresse,
          score: nameSimilarity,
          matchedFields: ['navn (fuzzy)', 'poststed'],
          matchType: 'fuzzy_same_location'
        };
      }
    }

    // E-post match
    if (kunde.epost && existing.epost) {
      const email1 = kunde.epost.toLowerCase().trim();
      const email2 = existing.epost.toLowerCase().trim();
      if (email1 === email2) {
        return {
          existingId: existing.id,
          existingNavn: existing.navn,
          existingAdresse: existing.adresse,
          score: 0.95,
          matchedFields: ['epost'],
          matchType: 'email'
        };
      }
    }

    // Telefon match
    if (kunde.telefon && existing.telefon) {
      const phone1 = String(kunde.telefon).replace(/\D/g, '');
      const phone2 = String(existing.telefon).replace(/\D/g, '');
      if (phone1.length >= 8 && phone1 === phone2) {
        return {
          existingId: existing.id,
          existingNavn: existing.navn,
          existingAdresse: existing.adresse,
          score: 0.9,
          matchedFields: ['telefon'],
          matchType: 'phone'
        };
      }
    }
  }

  return null;
}

/**
 * Analyser alle rader for duplikater
 * @param {Array} rows - Rader fra Excel
 * @param {Array} existingCustomers - Eksisterende kunder fra database
 * @returns {Object} { inFile: Map, inDatabase: Map, summary }
 */
function analyzeDuplicates(rows, existingCustomers) {
  // Finn duplikater i filen
  const inFileDuplicates = findDuplicatesInFile(rows);

  // Finn duplikater mot database
  const inDatabaseDuplicates = new Map();

  for (let i = 0; i < rows.length; i++) {
    // Skip hvis allerede markert som duplikat i fil
    if (inFileDuplicates.has(i)) continue;

    const match = findDuplicateInDatabase(rows[i], existingCustomers);
    if (match) {
      inDatabaseDuplicates.set(i, match);
    }
  }

  // Oppsummering
  const summary = {
    totalRows: rows.length,
    duplicatesInFile: inFileDuplicates.size,
    duplicatesInDatabase: inDatabaseDuplicates.size,
    uniqueNew: rows.length - inFileDuplicates.size - inDatabaseDuplicates.size,
    toUpdate: inDatabaseDuplicates.size
  };

  return {
    inFile: inFileDuplicates,
    inDatabase: inDatabaseDuplicates,
    summary
  };
}

/**
 * Generer SQL for å hente eksisterende kunder effektivt
 * @param {number} organizationId
 * @returns {string} SQL query
 */
function getExistingCustomersQuery(organizationId) {
  return `
    SELECT id, navn, adresse, postnummer, poststed, telefon, epost
    FROM kunder
    WHERE organization_id = ?
  `;
}

export {
  compareCustomers,
  findDuplicatesInFile,
  findDuplicateInDatabase,
  analyzeDuplicates,
  getExistingCustomersQuery,
  normalizeForComparison
};

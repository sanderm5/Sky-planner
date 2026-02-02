#!/usr/bin/env node
/**
 * Rensescript for CSV-import til Tre Allservice
 *
 * Leser: El-kontroll og brannvarsling 01.02.26.csv
 * Skriver: cleaned-for-import.csv
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import iconv from 'iconv-lite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');

// Kilde- og målfiler
const INPUT_FILE = path.join(ROOT_DIR, 'El-kontroll og brannvarsling 01.02.26.csv');
const OUTPUT_FILE = path.join(ROOT_DIR, 'cleaned-for-import.csv');

// Kolonneindekser (0-basert)
const COLS = {
  FLAG: 0,
  EL_TYPE: 2,
  SISTE_EL: 3,
  NESTE_EL: 4,
  MAANED_EL: 5,
  FREKVENS_EL: 6,
  TID_EL: 7,
  SISTE_BRANN: 8,
  NESTE_BRANN: 9,
  MAANED_BRANN: 10,
  BRANN_TYPE: 11,
  TID_BRANN: 12,
  DRIFT: 13,
  TRIP_ID: 14,
  EKK_OPPR: 15,
  EKK_FERDIG: 16,
  DAG: 17,
  KOMMENTAR: 18,
  KUNDE: 19,
  ADRESSE: 20,
  POSTNR: 21,
  POSTSTED: 22,
  OMRAADE: 23,
  ORG_NR: 24,
  // 25 er tom
  TELEFON: 26,
  EPOST: 27,
  FORSIKRING: 28,
  GB_NR: 29,
  UTF_KOMMENTAR: 30
};

// Månedsmapping fra Excel-format
const MONTH_MAP = {
  'jan': 1, 'january': 1, '1-jan': 1,
  'feb': 2, 'february': 2, '2-feb': 2,
  'mar': 3, 'march': 3, '3-mar': 3,
  'apr': 4, 'april': 4, '4-apr': 4,
  'may': 5, 'mai': 5, '5-may': 5,
  'jun': 6, 'june': 6, '6-jun': 6,
  'jul': 7, 'july': 7, '7-jul': 7,
  'aug': 8, 'august': 8, '8-aug': 8,
  'sep': 9, 'sept': 9, 'september': 9, '9-sep': 9,
  'oct': 10, 'okt': 10, 'october': 10, '10-oct': 10,
  'nov': 11, 'november': 11, '11-nov': 11,
  'dec': 12, 'des': 12, 'december': 12, '12-dec': 12
};

/**
 * Parser CSV-rad (håndterer quotes og escapes)
 */
function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

/**
 * Konverterer månedsstreng til månedsnummer
 */
function parseMonth(monthStr) {
  if (!monthStr) return null;

  const lower = monthStr.toLowerCase().trim();

  // Sjekk direkte mapping
  if (MONTH_MAP[lower]) return MONTH_MAP[lower];

  // Prøv å finne månedsnavn i strengen
  for (const [key, value] of Object.entries(MONTH_MAP)) {
    if (lower.includes(key)) return value;
  }

  // Prøv å parse som tall
  const num = parseInt(lower, 10);
  if (num >= 1 && num <= 12) return num;

  return null;
}

/**
 * Parser år fra forskjellige formater (2024, 2024 (03), etc.)
 */
function parseYear(yearStr) {
  if (!yearStr) return null;

  const match = yearStr.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Lager ISO-dato fra år og måned
 */
function makeDate(yearStr, monthStr) {
  const year = parseYear(yearStr);
  const month = parseMonth(monthStr);

  if (!year) return null;

  // Bruk måned 1 som default hvis ingen måned
  const m = month || 1;
  return `${year}-${String(m).padStart(2, '0')}-01`;
}

/**
 * Normaliserer telefonnummer til XX XX XX XX format
 */
function normalizePhone(phone) {
  if (!phone) return '';

  // Ignorer ikke-numeriske verdier som "Facebook"
  if (!/\d/.test(phone)) return '';

  // Fjern alt unntatt tall
  const digits = phone.replace(/\D/g, '');

  // Fjern landkode hvis den finnes
  let normalized = digits;
  if (normalized.startsWith('47') && normalized.length > 8) {
    normalized = normalized.slice(2);
  } else if (normalized.startsWith('0047')) {
    normalized = normalized.slice(4);
  }

  // Sjekk at vi har minst 8 siffer
  if (normalized.length < 8) return phone; // Returner original hvis ugyldig

  // Ta kun de første 8 sifrene
  normalized = normalized.slice(0, 8);

  // Formater som XX XX XX XX
  return normalized.replace(/(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4');
}

/**
 * Normaliserer postnummer til 4 siffer
 */
function normalizePostnummer(postnr) {
  if (!postnr) return '';

  const digits = postnr.replace(/\D/g, '');
  if (digits.length === 0) return '';

  return digits.padStart(4, '0').slice(0, 4);
}

/**
 * Bestemmer kategori basert på hvilke data som finnes
 */
function determineCategory(row) {
  const hasEl = parseYear(row[COLS.SISTE_EL]) || parseYear(row[COLS.NESTE_EL]);
  const hasBrann = parseYear(row[COLS.SISTE_BRANN]) || parseYear(row[COLS.NESTE_BRANN]);

  if (hasEl && hasBrann) return 'El-Kontroll + Brannvarsling';
  if (hasEl) return 'El-Kontroll';
  if (hasBrann) return 'Brannvarsling';
  return '';
}

/**
 * Samler notater fra flere kolonner
 */
function collectNotes(row) {
  const parts = [];

  if (row[COLS.DAG]) parts.push(`Dag: ${row[COLS.DAG]}`);
  if (row[COLS.KOMMENTAR]) parts.push(row[COLS.KOMMENTAR]);
  if (row[COLS.FORSIKRING]) parts.push(`Forsikring: ${row[COLS.FORSIKRING]}`);
  if (row[COLS.UTF_KOMMENTAR]) parts.push(row[COLS.UTF_KOMMENTAR]);
  if (row[COLS.GB_NR]) parts.push(`G/B.nr: ${row[COLS.GB_NR]}`);

  return parts.filter(p => p).join(' | ');
}

/**
 * Escaper CSV-felt
 */
function escapeCSV(value) {
  if (!value) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Hovedprogram
async function main() {
  console.log('Leser fil:', INPUT_FILE);

  // Les fil med Latin-1 encoding
  const buffer = fs.readFileSync(INPUT_FILE);
  const content = iconv.decode(buffer, 'latin1');

  // Del opp i linjer
  const lines = content.split(/\r?\n/);
  console.log(`Totalt ${lines.length} linjer`);

  // Skip metadata-rader (1-11), data starter fra rad 12 (index 11)
  const dataStartIndex = 11;

  // Output-header
  const outputHeader = [
    'navn', 'adresse', 'postnummer', 'poststed', 'telefon', 'epost',
    'kategori', 'el_type', 'brann_system', 'brann_driftstype',
    'siste_el_kontroll', 'neste_el_kontroll', 'siste_brann_kontroll', 'neste_brann_kontroll',
    'el_kontroll_intervall', 'brann_kontroll_intervall',
    'tripletex_id', 'org_nr', 'notater'
  ];

  const outputRows = [outputHeader.join(',')];
  let skippedCount = 0;
  let processedCount = 0;
  const issues = [];

  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const row = parseCSVRow(line);

    // Hent og valider påkrevde felt
    const navn = row[COLS.KUNDE]?.trim() || '';
    const adresse = row[COLS.ADRESSE]?.trim() || '';

    // Skip header-rader som dukker opp midt i dataen
    if (navn.toLowerCase() === 'kunde' || navn.toLowerCase() === 'name') {
      skippedCount++;
      issues.push(`Rad ${i + 1}: Header-rad skippet`);
      continue;
    }

    // Skip rad hvis navn eller adresse mangler
    if (!navn || navn.length < 2) {
      if (row.some(c => c && c.trim())) {
        skippedCount++;
        issues.push(`Rad ${i + 1}: Mangler kundenavn`);
      }
      continue;
    }

    if (!adresse || adresse.length < 3) {
      skippedCount++;
      issues.push(`Rad ${i + 1}: Mangler adresse for "${navn}"`);
      continue;
    }

    // Skip rader uten noen kontrolldata
    const kategori = determineCategory(row);
    if (!kategori) {
      skippedCount++;
      issues.push(`Rad ${i + 1}: Ingen kontrolldata for "${navn}"`);
      continue;
    }

    // Transformer data
    const postnummer = normalizePostnummer(row[COLS.POSTNR]);
    const poststed = row[COLS.POSTSTED]?.trim() || '';
    const telefon = normalizePhone(row[COLS.TELEFON]);
    const epost = row[COLS.EPOST]?.trim() || '';

    const elType = row[COLS.EL_TYPE]?.trim() || '';
    const brannSystem = row[COLS.BRANN_TYPE]?.trim() || '';
    const brannDriftstype = row[COLS.DRIFT]?.trim() || '';

    // Datoer
    const sisteEl = makeDate(row[COLS.SISTE_EL], row[COLS.MAANED_EL]);
    const nesteEl = makeDate(row[COLS.NESTE_EL], row[COLS.MAANED_EL]);
    const sisteBrann = makeDate(row[COLS.SISTE_BRANN], row[COLS.MAANED_BRANN]);
    const nesteBrann = makeDate(row[COLS.NESTE_BRANN], row[COLS.MAANED_BRANN]);

    // Intervaller (år til måneder)
    const frekvensEl = row[COLS.FREKVENS_EL]?.trim();
    const elIntervall = frekvensEl ? String(parseInt(frekvensEl, 10) * 12) : '';

    // Eksterne IDer
    const tripletexId = row[COLS.TRIP_ID]?.trim() || '';
    const orgNr = row[COLS.ORG_NR]?.trim() || '';

    // Notater
    const notater = collectNotes(row);

    // Bygg output-rad
    const outputRow = [
      navn, adresse, postnummer, poststed, telefon, epost,
      kategori, elType, brannSystem, brannDriftstype,
      sisteEl || '', nesteEl || '', sisteBrann || '', nesteBrann || '',
      elIntervall, '', // brann_kontroll_intervall - ikke i kildedata
      tripletexId, orgNr, notater
    ].map(escapeCSV);

    outputRows.push(outputRow.join(','));
    processedCount++;
  }

  // Skriv output-fil
  fs.writeFileSync(OUTPUT_FILE, outputRows.join('\n'), 'utf8');

  console.log('\n--- Resultat ---');
  console.log(`Prosessert: ${processedCount} kunder`);
  console.log(`Skippet: ${skippedCount} rader`);
  console.log(`Output: ${OUTPUT_FILE}`);

  if (issues.length > 0) {
    console.log(`\n--- Problemer (${issues.length}) ---`);
    issues.slice(0, 10).forEach(issue => console.log(issue));
    if (issues.length > 10) {
      console.log(`... og ${issues.length - 10} flere`);
    }
  }
}

main().catch(err => {
  console.error('Feil:', err);
  process.exit(1);
});

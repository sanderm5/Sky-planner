/**
 * Komplett synkronisering av CSV-fasit med database for Tre Allservice AS
 *
 * Usage:
 *   node scripts/sync-csv-tre-allservice.mjs              # Dry-run (rapport)
 *   node scripts/sync-csv-tre-allservice.mjs --apply       # Utfør endringer
 *   node scripts/sync-csv-tre-allservice.mjs --apply --geocode  # + geocode nye kunder
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import iconv from 'iconv-lite';

// ─── Configuration ──────────────────────────────────────────────────────────
const CSV_PATH = path.resolve(process.cwd(), '../../El-kontroll og brannvarsling 01.02.26.csv');
const ORGANIZATION_ID = 5;
const APPLY = process.argv.includes('--apply');
const DO_GEOCODE = process.argv.includes('--geocode');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += char; }
  }
  result.push(current);
  return result;
}

function normalizeString(str) {
  if (!str) return '';
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/[\s+\-]/g, '').replace(/^\+?47/, '');
}

function cleanPhone(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/\s/g, '').trim();
  // Must contain at least one digit and be 8+ chars
  if (cleaned.length >= 8 && /\d/.test(cleaned)) return cleaned;
  return null;
}

// ─── Month parsing ──────────────────────────────────────────────────────────

const MONTH_MAP = {
  'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'mai': 5, 'jun': 6,
  'jul': 7, 'aug': 8, 'sep': 9, 'okt': 10, 'nov': 11, 'des': 12,
  'mars': 3, 'sept': 9,
  // English
  'may': 5, 'oct': 10, 'dec': 12
};

function parseMonth(str) {
  if (!str || str === 'x' || str === '??' || str === 'Måned') return null;
  const lower = str.toLowerCase().trim();
  if (MONTH_MAP[lower]) return MONTH_MAP[lower];

  // Parse "9-Sep", "3-Mar", "15. Mars- 15 april" etc.
  const match = lower.match(/(\d+)?[\.\-]?\s*(\w+)/);
  if (match && match[2]) {
    const monthName = match[2].substring(0, 3);
    return MONTH_MAP[monthName] || null;
  }
  return null;
}

// ─── Year/Date parsing ──────────────────────────────────────────────────────

function parseYear(str) {
  if (!str || str === 'x') return null;
  const match = str.match(/^(\d{4})/);
  if (match) {
    const year = parseInt(match[1]);
    if (year >= 2000 && year <= 2100) return year;
  }
  return null;
}

function parseParenMonth(str) {
  if (!str) return null;
  const match = str.match(/\((\d{1,2})\)/);
  return match ? parseInt(match[1]) : null;
}

function isTextNote(str) {
  if (!str) return false;
  // Not a valid year, not 'x', not empty
  return str.trim() !== '' && str.trim() !== 'x' && !parseYear(str);
}

function makeDate(yearStr, monthStr) {
  const year = parseYear(yearStr);
  if (!year) return null;
  // Check for parenthesized month in year string (e.g., "2024 (03)")
  const parenMonth = parseParenMonth(yearStr);
  const month = parenMonth || parseMonth(monthStr) || 1;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function parseInterval(freqStr) {
  if (!freqStr || freqStr === 'Frekvens') return null;
  const match = freqStr.match(/(\d+)/);
  if (match) {
    const years = parseInt(match[1]);
    if (years > 0 && years <= 10) return years * 12;
  }
  return null;
}

// ─── Levenshtein similarity ─────────────────────────────────────────────────

function calculateSimilarity(a, b) {
  if (!a || !b) return 0;
  const an = normalizeString(a);
  const bn = normalizeString(b);
  if (an === bn) return 1;

  const matrix = [];
  for (let i = 0; i <= an.length; i++) {
    matrix[i] = [i];
    for (let j = 1; j <= bn.length; j++) {
      if (i === 0) { matrix[i][j] = j; continue; }
      const cost = an[i - 1] === bn[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  const maxLen = Math.max(an.length, bn.length);
  return maxLen === 0 ? 1 : 1 - matrix[an.length][bn.length] / maxLen;
}

// ─── Geocode ────────────────────────────────────────────────────────────────

async function geocodeAddress(adresse, postnummer, poststed) {
  if (!adresse && !poststed) return null;
  try {
    const searchText = [adresse, postnummer, poststed].filter(Boolean).join(' ');
    const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(searchText)}&treffPerSide=1`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.adresser && data.adresser.length > 0) {
      const result = data.adresser[0];
      if (result.representasjonspunkt) {
        return { lat: result.representasjonspunkt.lat, lng: result.representasjonspunkt.lon };
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

// ─── Notater builder ────────────────────────────────────────────────────────

function buildNotater(cols) {
  const parts = [];

  // [TRIPLETEX:ID]
  const tripletex = (cols[14] || '').trim();
  if (tripletex && /^\d+$/.test(tripletex)) {
    parts.push(`[TRIPLETEX:${tripletex}]`);
  }

  // [ORGNR:nr]
  const orgNr = (cols[24] || '').trim();
  if (orgNr && /^\d{9}$/.test(orgNr)) {
    parts.push(`[ORGNR:${orgNr}]`);
  }

  // Separator between tags and text
  const tags = parts.join(' ');
  const textParts = [];

  // Non-numeric tripletex = text note
  if (tripletex && !/^\d+$/.test(tripletex)) {
    textParts.push(tripletex);
  }

  // Dag (col 17)
  const dag = (cols[17] || '').trim();
  if (dag && dag !== 'Dag') textParts.push(`Dag: ${dag}`);

  // Kommentar (col 18)
  const kommentar = (cols[18] || '').trim();
  if (kommentar && kommentar !== 'Kommentar') textParts.push(kommentar);

  // EKK (col 15)
  const ekk = (cols[15] || '').trim();
  if (ekk && ekk !== 'EKK') {
    if (ekk.toLowerCase() === 'ok') {
      textParts.push('EKK: ok');
    } else {
      textParts.push(ekk);
    }
  }

  // Sekundærnummer (col 25)
  const tlf2 = (cols[25] || '').trim();
  if (tlf2) textParts.push(`Tlf 2: ${tlf2}`);

  // Kontaktperson i poststed (Lofoten Entreprenør edge case)
  const poststed = (cols[22] || '').trim();
  const postnr = (cols[21] || '').trim();
  if (poststed && !postnr && /^[A-ZÆØÅ][a-zæøåA-ZÆØÅ]+\s+[A-ZÆØÅ]/.test(poststed)) {
    textParts.push(`Kontakt: ${poststed}`);
  }

  // Driftstype dato-notat (Per-Erling Ellingsen edge case)
  const driftstype = (cols[13] || '').trim();
  if (driftstype && driftstype.startsWith('Utf:')) {
    textParts.push(driftstype);
  }

  // Tekst i dato-kolonner
  const sisteElStr = (cols[3] || '').trim();
  const nesteElStr = (cols[4] || '').trim();
  const sisteBrannStr = (cols[8] || '').trim();
  const nesteBrannStr = (cols[9] || '').trim();
  if (isTextNote(sisteElStr)) textParts.push(`Siste El: ${sisteElStr}`);
  if (isTextNote(nesteElStr)) textParts.push(`Neste El: ${nesteElStr}`);
  if (isTextNote(sisteBrannStr)) textParts.push(`Siste Brann: ${sisteBrannStr}`);
  if (isTextNote(nesteBrannStr)) textParts.push(`Neste Brann: ${nesteBrannStr}`);

  // Forsikringsselskap (col 28)
  const forsikring = (cols[28] || '').trim();
  if (forsikring && forsikring !== 'Forsikringsselskap') textParts.push(`Forsikring: ${forsikring}`);

  // G/B.nr (col 29)
  const gbnr = (cols[29] || '').trim();
  if (gbnr && gbnr !== 'G/B.nr') textParts.push(`G/B.nr: ${gbnr}`);

  // Utfyllende kommentar (col 30)
  const utfyllende = (cols[30] || '').trim();
  if (utfyllende && utfyllende !== 'Utfyllende kommentar') textParts.push(utfyllende);

  const textStr = textParts.join(' | ');
  if (tags && textStr) return `${tags} | ${textStr}`;
  if (tags) return tags;
  if (textStr) return textStr;
  return null;
}

// ─── Notater merge ──────────────────────────────────────────────────────────

function mergeNotater(existingNotater, newNotater) {
  if (!existingNotater) return newNotater;
  if (!newNotater) return existingNotater;

  // Parse tags from both
  const existingTripletex = existingNotater.match(/\[TRIPLETEX:\d+\]/);
  const existingOrgNr = existingNotater.match(/\[ORGNR:\d+\]/);
  const newTripletex = newNotater.match(/\[TRIPLETEX:\d+\]/);
  const newOrgNr = newNotater.match(/\[ORGNR:\d+\]/);

  // Get text parts from existing (strip ALL tags including malformed ones)
  let existingText = existingNotater
    .replace(/\[TRIPLETEX:[^\]]*\]/g, '')
    .replace(/\[ORGNR:[^\]]*\]/g, '')
    .replace(/^\s*\|\s*/, '')
    .trim();

  // Get text parts from new (strip tags)
  let newText = newNotater
    .replace(/\[TRIPLETEX:[^\]]*\]/g, '')
    .replace(/\[ORGNR:[^\]]*\]/g, '')
    .replace(/^\s*\|\s*/, '')
    .trim();

  // Use new tags (CSV is fasit), fall back to existing
  const tags = [];
  const tripletex = newTripletex ? newTripletex[0] : existingTripletex ? existingTripletex[0] : null;
  const orgNr = newOrgNr ? newOrgNr[0] : existingOrgNr ? existingOrgNr[0] : null;
  if (tripletex) tags.push(tripletex);
  if (orgNr) tags.push(orgNr);

  // Merge text: prefer new CSV text, but keep unique existing text parts
  const newParts = newText ? newText.split(/\s*\|\s*/).map(p => p.trim()).filter(Boolean) : [];
  const existingParts = existingText ? existingText.split(/\s*\|\s*/).map(p => p.trim()).filter(Boolean) : [];

  // Keep existing parts that don't have a corresponding new part (by prefix)
  const newPrefixes = newParts.map(p => {
    const colonIdx = p.indexOf(':');
    return colonIdx > 0 ? p.substring(0, colonIdx + 1).toLowerCase() : p.toLowerCase();
  });

  for (const ep of existingParts) {
    const epPrefix = ep.indexOf(':') > 0
      ? ep.substring(0, ep.indexOf(':') + 1).toLowerCase()
      : ep.toLowerCase();
    if (!newPrefixes.includes(epPrefix) && !newParts.some(np => normalizeString(np) === normalizeString(ep))) {
      newParts.push(ep);
    }
  }

  const tagsStr = tags.join(' ');
  const textStr = newParts.join(' | ');
  if (tagsStr && textStr) return `${tagsStr} | ${textStr}`;
  if (tagsStr) return tagsStr;
  if (textStr) return textStr;
  return null;
}

// ─── Parse CSV ──────────────────────────────────────────────────────────────

function parseCSVFile() {
  const buffer = fs.readFileSync(CSV_PATH);
  const content = iconv.decode(buffer, 'ISO-8859-1');
  const lines = content.split(/\r?\n/);

  let section = 'aktiv';
  const customers = [];

  const SKIP_PHRASES = [
    'Har prøvd', 'Jeg er i ferd', 'Jeg kan i tillegg', 'Det å samle',
    'Jeg ønsker', 'Alternativt', 'Mvh ', 'Og i den forbindelse'
  ];

  for (let i = 11; i < lines.length; i++) {
    const line = lines[i];

    // Section detection
    if (line.includes('Kunder jeg ikke orker')) { section = 'inaktiv'; continue; }
    if (line.includes('Kunder jeg har mistet')) { section = 'avsluttet'; continue; }

    const cols = parseCSVLine(line);
    const navn = (cols[19] || '').trim();

    // Filter: valid name
    if (!navn || navn.length < 3 || navn === 'Kunde') continue;
    if (navn.length > 80) continue;
    if (SKIP_PHRASES.some(phrase => navn.includes(phrase))) continue;

    // Filter: must have at least one identifying field besides name
    const adresse = (cols[20] || '').trim();
    const postnummer = (cols[21] || '').trim();
    const telefon = cleanPhone((cols[26] || '').trim());
    const epost = (cols[27] || '').trim();
    if (!adresse && !postnummer && !telefon && !epost) continue;

    // Poststed - handle Lofoten Entreprenør edge case
    let poststed = (cols[22] || '').trim();
    if (poststed && !postnummer && /^[A-ZÆØÅ][a-zæøåA-ZÆØÅ]+\s+[A-ZÆØÅ]/.test(poststed)) {
      // This looks like a person name, not a poststed
      poststed = null;
    }

    // El-kontroll
    const elType = (cols[2] || '').trim() || null;
    const sisteElStr = (cols[3] || '').trim();
    const nesteElStr = (cols[4] || '').trim();
    const maanedEl = (cols[5] || '').trim();
    const frekvens = (cols[6] || '').trim();

    const sisteElKontroll = makeDate(sisteElStr, maanedEl);
    const nesteElKontroll = makeDate(nesteElStr, maanedEl);
    const elKontrollIntervall = parseInterval(frekvens);

    // Brann-kontroll
    const sisteBrannStr = (cols[8] || '').trim();
    const nesteBrannStr = (cols[9] || '').trim();
    const maanedBrann = (cols[10] || '').trim();
    let brannSystem = (cols[11] || '').trim() || null;
    let brannDriftstype = (cols[13] || '').trim() || null;

    // Edge case: "Type" is a leaked CSV header, not a real system
    if (brannSystem && brannSystem.toLowerCase() === 'type') {
      brannSystem = null;
    }

    // Edge case: "Utf: 20.1.26" is a note, not driftstype
    if (brannDriftstype && brannDriftstype.startsWith('Utf:')) {
      brannDriftstype = null;
    }

    const sisteBrannKontroll = makeDate(sisteBrannStr, maanedBrann);
    const nesteBrannKontroll = makeDate(nesteBrannStr, maanedBrann);

    // Kategori - el_type er kun klassifisering, ikke bevis på el-kontroll tjeneste
    // brann_system/driftstype betyr faktisk installert brann-utstyr
    const hasElData = Boolean(sisteElKontroll || nesteElKontroll);
    const hasBrannData = Boolean(brannSystem || brannDriftstype || sisteBrannKontroll || nesteBrannKontroll);
    let kategori = null;
    if (hasElData && hasBrannData) kategori = 'El-Kontroll + Brannvarsling';
    else if (hasBrannData) kategori = 'Brannvarsling';
    else if (hasElData) kategori = 'El-Kontroll';

    // Notater
    const notater = buildNotater(cols);

    customers.push({
      line: i + 1,
      section,
      navn,
      adresse: adresse || null,
      postnummer: postnummer || null,
      poststed: poststed || null,
      telefon,
      epost: epost || null,
      el_type: elType,
      siste_el_kontroll: sisteElKontroll,
      neste_el_kontroll: nesteElKontroll,
      el_kontroll_intervall: elKontrollIntervall,
      brann_system: brannSystem,
      brann_driftstype: brannDriftstype,
      siste_brann_kontroll: sisteBrannKontroll,
      neste_brann_kontroll: nesteBrannKontroll,
      brann_kontroll_intervall: hasBrannData ? 12 : null,
      kategori,
      status: section,
      notater
    });
  }

  return customers;
}

// ─── Compare fields ─────────────────────────────────────────────────────────

function compareField(dbVal, csvVal, fieldName) {
  if (csvVal === null || csvVal === undefined) return null; // No CSV value, keep DB

  const dbN = normalizeString(String(dbVal || ''));
  const csvN = normalizeString(String(csvVal));

  if (fieldName === 'telefon') {
    if (normalizePhone(dbVal) === normalizePhone(csvVal)) return null;
  } else if (fieldName === 'epost') {
    if (dbN === csvN) return null;
  } else if (['siste_el_kontroll', 'neste_el_kontroll', 'siste_brann_kontroll', 'neste_brann_kontroll'].includes(fieldName)) {
    // Compare date strings
    const dbDate = (dbVal || '').substring(0, 10);
    const csvDate = (csvVal || '').substring(0, 10);
    if (dbDate === csvDate) return null;
  } else if (['el_kontroll_intervall', 'brann_kontroll_intervall'].includes(fieldName)) {
    if (Number(dbVal) === Number(csvVal)) return null;
  } else {
    if (dbN === csvN) return null;
  }

  return { field: fieldName, dbVal, csvVal };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(70));
  console.log('SYNKRONISERING: CSV → DATABASE (Tre Allservice AS)');
  console.log(`Modus: ${APPLY ? 'APPLY (utfører endringer)' : 'DRY-RUN (kun rapport)'}`);
  console.log('='.repeat(70));

  // 1. Parse CSV
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`FEIL: Fil ikke funnet: ${CSV_PATH}`);
    process.exit(1);
  }

  const csvCustomers = parseCSVFile();
  const activeCount = csvCustomers.filter(c => c.section === 'aktiv').length;
  const inactiveCount = csvCustomers.filter(c => c.section === 'inaktiv').length;
  const lostCount = csvCustomers.filter(c => c.section === 'avsluttet').length;

  console.log(`\nCSV kunder totalt: ${csvCustomers.length}`);
  console.log(`  Aktive: ${activeCount}`);
  console.log(`  Inaktive: ${inactiveCount}`);
  console.log(`  Avsluttet: ${lostCount}`);

  // 2. Fetch database
  const { data: dbCustomers, error } = await supabase
    .from('kunder')
    .select('*')
    .eq('organization_id', ORGANIZATION_ID);

  if (error) {
    console.error('DB feil:', error.message);
    process.exit(1);
  }

  console.log(`DB kunder totalt: ${dbCustomers.length}\n`);

  // 3. Match and compare
  const matched = [];
  const missingInDb = [];
  const matchedDbIds = new Set();

  for (const csv of csvCustomers) {
    // a) Exact match on name+address
    let dbMatch = dbCustomers.find(db =>
      normalizeString(db.navn) === normalizeString(csv.navn) &&
      normalizeString(db.adresse) === normalizeString(csv.adresse) &&
      !matchedDbIds.has(db.id)
    );

    // b) Fuzzy name match + exact address
    if (!dbMatch) {
      dbMatch = dbCustomers.find(db =>
        !matchedDbIds.has(db.id) &&
        normalizeString(db.adresse) === normalizeString(csv.adresse) &&
        calculateSimilarity(db.navn, csv.navn) >= 0.9
      );
    }

    // c) Exact name + fuzzy address
    if (!dbMatch) {
      dbMatch = dbCustomers.find(db =>
        !matchedDbIds.has(db.id) &&
        normalizeString(db.navn) === normalizeString(csv.navn) &&
        calculateSimilarity(db.adresse, csv.adresse) >= 0.9
      );
    }

    // d) Fuzzy both
    if (!dbMatch) {
      dbMatch = dbCustomers.find(db =>
        !matchedDbIds.has(db.id) &&
        calculateSimilarity(db.navn, csv.navn) >= 0.9 &&
        calculateSimilarity(db.adresse, csv.adresse) >= 0.9
      );
    }

    if (dbMatch) {
      matchedDbIds.add(dbMatch.id);

      // Compare all fields
      const diffs = [];
      const fields = [
        ['navn', csv.navn],
        ['adresse', csv.adresse],
        ['postnummer', csv.postnummer],
        ['poststed', csv.poststed],
        ['telefon', csv.telefon],
        ['epost', csv.epost],
        ['el_type', csv.el_type],
        ['siste_el_kontroll', csv.siste_el_kontroll],
        ['neste_el_kontroll', csv.neste_el_kontroll],
        ['el_kontroll_intervall', csv.el_kontroll_intervall],
        ['brann_system', csv.brann_system],
        ['brann_driftstype', csv.brann_driftstype],
        ['siste_brann_kontroll', csv.siste_brann_kontroll],
        ['neste_brann_kontroll', csv.neste_brann_kontroll],
        ['brann_kontroll_intervall', csv.brann_kontroll_intervall],
        ['kategori', csv.kategori],
        ['status', csv.status],
      ];

      for (const [field, csvVal] of fields) {
        const diff = compareField(dbMatch[field], csvVal, field);
        if (diff) diffs.push(diff);
      }

      // Eksplisitt nullstilling av stale verdier som compareField hopper over
      // brann_driftstype: "Utf:"-verdier ble nullet i CSV-parsing, men DB kan ha gammel verdi
      if (csv.brann_driftstype === null && dbMatch.brann_driftstype &&
          (dbMatch.brann_driftstype.startsWith('Utf:') || dbMatch.brann_driftstype.startsWith('utf:'))) {
        diffs.push({ field: 'brann_driftstype', dbVal: dbMatch.brann_driftstype, csvVal: null });
      }
      // brann_system: "Type" er en lekket CSV-header, ikke et ekte system
      if (csv.brann_system === null && dbMatch.brann_system &&
          dbMatch.brann_system.toLowerCase() === 'type') {
        diffs.push({ field: 'brann_system', dbVal: dbMatch.brann_system, csvVal: null });
      }

      // Intervall-felt: CSV er fasit — nullstill DB-verdi hvis CSV ikke har data
      if (csv.brann_kontroll_intervall === null && dbMatch.brann_kontroll_intervall != null) {
        diffs.push({ field: 'brann_kontroll_intervall', dbVal: dbMatch.brann_kontroll_intervall, csvVal: null });
      }
      if (csv.el_kontroll_intervall === null && dbMatch.el_kontroll_intervall != null) {
        diffs.push({ field: 'el_kontroll_intervall', dbVal: dbMatch.el_kontroll_intervall, csvVal: null });
      }

      // Notater comparison - merge rather than replace
      const mergedNotater = mergeNotater(dbMatch.notater, csv.notater);
      if (normalizeString(dbMatch.notater) !== normalizeString(mergedNotater) && mergedNotater) {
        diffs.push({ field: 'notater', dbVal: dbMatch.notater, csvVal: mergedNotater });
      }

      matched.push({ csv, db: dbMatch, diffs });
    } else {
      missingInDb.push(csv);
    }
  }

  const extraInDb = dbCustomers.filter(db => !matchedDbIds.has(db.id));

  // 4. Print report
  const needsUpdate = matched.filter(m => m.diffs.length > 0);

  console.log('='.repeat(70));
  console.log('RAPPORT');
  console.log('='.repeat(70));
  console.log(`Matchet: ${matched.length} (av ${csvCustomers.length} CSV-kunder)`);
  console.log(`  - Trenger oppdatering: ${needsUpdate.length}`);
  console.log(`  - Allerede korrekt: ${matched.length - needsUpdate.length}`);
  console.log(`Mangler i DB (INSERT): ${missingInDb.length}`);
  console.log(`Kun i DB (rapporteres): ${extraInDb.length}`);

  if (needsUpdate.length > 0) {
    console.log('\n--- OPPDATERINGER ---');
    for (const m of needsUpdate) {
      console.log(`\n  L${m.csv.line} ${m.csv.navn} (DB ID ${m.db.id}):`);
      for (const d of m.diffs) {
        const dbStr = d.dbVal === null || d.dbVal === undefined ? '(tom)' : `"${d.dbVal}"`;
        const csvStr = d.csvVal === null || d.csvVal === undefined ? '(tom)' : `"${d.csvVal}"`;
        console.log(`    ${d.field}: ${dbStr} → ${csvStr}`);
      }
    }
  }

  if (missingInDb.length > 0) {
    console.log('\n--- NYE KUNDER (INSERT) ---');
    for (const c of missingInDb) {
      console.log(`  L${c.line} [${c.section}] ${c.navn} | ${c.adresse || '(ingen adresse)'}`);
      if (c.kategori) console.log(`    Kategori: ${c.kategori}`);
      if (c.notater) console.log(`    Notater: ${c.notater}`);
    }
  }

  if (extraInDb.length > 0) {
    console.log('\n--- KUN I DB (ikke i CSV) ---');
    for (const d of extraInDb) {
      console.log(`  ID ${d.id}: ${d.navn} | ${d.adresse || '(ingen adresse)'} [${d.status || 'aktiv'}]`);
    }
  }

  // 5. Apply changes
  if (!APPLY) {
    console.log('\n' + '='.repeat(70));
    console.log('DRY-RUN FERDIG');
    console.log('Kjør med --apply for å utføre endringer');
    console.log('='.repeat(70));
    return;
  }

  console.log('\n' + '='.repeat(70));
  console.log('UTFØRER ENDRINGER...');
  console.log('='.repeat(70));

  let updatedCount = 0;
  let insertedCount = 0;
  let failedCount = 0;

  // UPDATE existing customers
  for (const m of needsUpdate) {
    const updateFields = {};
    for (const d of m.diffs) {
      updateFields[d.field] = d.csvVal;
    }

    const { error: updateError } = await supabase
      .from('kunder')
      .update(updateFields)
      .eq('id', m.db.id);

    if (updateError) {
      console.log(`  FEIL UPDATE ${m.csv.navn}: ${updateError.message}`);
      failedCount++;
    } else {
      updatedCount++;
    }
  }

  // INSERT new customers
  for (const csv of missingInDb) {
    const insertData = {
      organization_id: ORGANIZATION_ID,
      navn: csv.navn,
      adresse: csv.adresse,
      postnummer: csv.postnummer,
      poststed: csv.poststed,
      telefon: csv.telefon,
      epost: csv.epost,
      el_type: csv.el_type,
      siste_el_kontroll: csv.siste_el_kontroll,
      neste_el_kontroll: csv.neste_el_kontroll,
      el_kontroll_intervall: csv.el_kontroll_intervall,
      brann_system: csv.brann_system,
      brann_driftstype: csv.brann_driftstype,
      siste_brann_kontroll: csv.siste_brann_kontroll,
      neste_brann_kontroll: csv.neste_brann_kontroll,
      brann_kontroll_intervall: csv.brann_kontroll_intervall,
      kategori: csv.kategori,
      status: csv.status,
      notater: csv.notater
    };

    // Geocode if requested
    if (DO_GEOCODE && csv.adresse) {
      const coords = await geocodeAddress(csv.adresse, csv.postnummer, csv.poststed);
      if (coords) {
        insertData.lat = coords.lat;
        insertData.lng = coords.lng;
      }
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
    }

    const { error: insertError } = await supabase
      .from('kunder')
      .insert(insertData);

    if (insertError) {
      console.log(`  FEIL INSERT ${csv.navn}: ${insertError.message}`);
      failedCount++;
    } else {
      insertedCount++;
      console.log(`  INSERT OK: ${csv.navn}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTAT');
  console.log('='.repeat(70));
  console.log(`Oppdatert: ${updatedCount}`);
  console.log(`Lagt inn: ${insertedCount}`);
  console.log(`Feilet: ${failedCount}`);

  // 6. Verify
  console.log('\n--- VERIFISERING ---');
  const { data: verifyCustomers } = await supabase
    .from('kunder')
    .select('*')
    .eq('organization_id', ORGANIZATION_ID);

  console.log(`DB kunder etter sync: ${verifyCustomers.length} (forventet: ${csvCustomers.length})`);

  // Quick re-check for remaining diffs
  let remainingDiffs = 0;
  for (const csv of csvCustomers) {
    const dbMatch = verifyCustomers.find(db =>
      normalizeString(db.navn) === normalizeString(csv.navn) &&
      normalizeString(db.adresse) === normalizeString(csv.adresse)
    );
    if (!dbMatch) {
      // Also try without address for Leif-Richard Nordeng
      const nameMatch = verifyCustomers.find(db =>
        normalizeString(db.navn) === normalizeString(csv.navn) && !csv.adresse
      );
      if (!nameMatch) {
        console.log(`  MANGLER FORTSATT: L${csv.line} ${csv.navn}`);
        remainingDiffs++;
      }
    }
  }

  if (remainingDiffs === 0) {
    console.log('  ALLE CSV-kunder finnes i DB ✅');
  }

  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Feil:', err);
  process.exit(1);
});

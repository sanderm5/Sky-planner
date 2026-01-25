/**
 * Data Normalizer Service
 * Renser og normaliserer data fra Excel-import
 */

/**
 * Normaliser telefonnummer til norsk format
 * @param {string} phone - Telefonnummer å normalisere
 * @returns {Object} { value, wasModified, originalValue, warnings }
 */
function normalizePhone(phone) {
  const originalValue = phone || '';
  const warnings = [];

  if (!phone || typeof phone !== 'string') {
    return { value: null, wasModified: false, originalValue: '', warnings: [] };
  }

  let normalized = String(phone).trim();

  // Fjern vanlige prefiks
  normalized = normalized
    .replace(/^\+47\s*/, '')      // +47
    .replace(/^0047\s*/, '')      // 0047
    .replace(/^47(?=\d{8}$)/, '') // 47 før 8 siffer
    .replace(/[\s\-\.\(\)]/g, '') // Fjern formatering
    .trim();

  // Håndter tilfeller der Excel har konvertert til tall
  if (/^\d+$/.test(normalized)) {
    // Fjern leading 47 hvis det gir 8 siffer
    if (normalized.length === 10 && normalized.startsWith('47')) {
      normalized = normalized.substring(2);
    }

    // Sjekk at vi har 8 siffer
    if (normalized.length === 8) {
      // Formater som XX XX XX XX
      normalized = normalized.replace(/(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4');
    } else if (normalized.length !== 8) {
      warnings.push(`Telefonnummer har ${normalized.length} siffer (forventet 8)`);
    }
  } else if (normalized.length > 0) {
    warnings.push('Telefonnummer inneholder ugyldige tegn');
  }

  return {
    value: normalized || null,
    wasModified: normalized !== originalValue.trim(),
    originalValue,
    warnings
  };
}

/**
 * Normaliser postnummer til 4 siffer
 * @param {string|number} postnr - Postnummer å normalisere
 * @returns {Object} { value, wasModified, originalValue, warnings }
 */
function normalizePostnummer(postnr) {
  const originalValue = postnr !== undefined && postnr !== null ? String(postnr) : '';
  const warnings = [];

  if (!postnr && postnr !== 0) {
    return { value: null, wasModified: false, originalValue: '', warnings: [] };
  }

  // Konverter til string og fjern whitespace
  let normalized = String(postnr).trim();

  // Fjern alle ikke-siffer
  normalized = normalized.replace(/\D/g, '');

  // Pad med leading zeros hvis mindre enn 4 siffer
  if (normalized.length > 0 && normalized.length < 4) {
    const padded = normalized.padStart(4, '0');
    warnings.push(`Postnummer paddet fra "${normalized}" til "${padded}"`);
    normalized = padded;
  }

  // Valider område (norske postnummer: 0001-9991)
  if (normalized.length === 4) {
    const num = parseInt(normalized, 10);
    if (num < 1 || num > 9991) {
      warnings.push(`Postnummer ${normalized} er utenfor gyldig område (0001-9991)`);
    }
  } else if (normalized.length > 0) {
    warnings.push(`Ugyldig postnummer: ${normalized}`);
    normalized = null;
  }

  return {
    value: normalized,
    wasModified: normalized !== originalValue.trim(),
    originalValue,
    warnings
  };
}

/**
 * Normaliser e-post
 * @param {string} email - E-postadresse å normalisere
 * @returns {Object} { value, wasModified, originalValue, warnings }
 */
function normalizeEmail(email) {
  const originalValue = email || '';
  const warnings = [];

  if (!email || typeof email !== 'string') {
    return { value: null, wasModified: false, originalValue: '', warnings: [] };
  }

  let normalized = email.toLowerCase().trim();

  // Fjern whitespace i midten (vanlig copy-paste feil)
  normalized = normalized.replace(/\s/g, '');

  // Enkel e-post validering
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalized)) {
    warnings.push('Ugyldig e-postformat');
  }

  return {
    value: normalized || null,
    wasModified: normalized !== originalValue.trim(),
    originalValue,
    warnings
  };
}

/**
 * Normaliser generisk tekstfelt (navn, adresse, etc.)
 * @param {string} value - Verdi å normalisere
 * @returns {Object} { value, wasModified, originalValue, warnings }
 */
function normalizeText(value) {
  const originalValue = value || '';
  const warnings = [];

  if (!value || typeof value !== 'string') {
    return { value: null, wasModified: false, originalValue: '', warnings: [] };
  }

  let normalized = value
    .trim()
    .replace(/\s+/g, ' ')         // Flere mellomrom -> ett
    .replace(/[\x00-\x1F]/g, ''); // Fjern kontroll-tegn

  return {
    value: normalized || null,
    wasModified: normalized !== originalValue,
    originalValue,
    warnings
  };
}

/**
 * Normaliser koordinater
 * @param {string|number} coord - Koordinat å normalisere
 * @param {string} type - 'lat' eller 'lng'
 * @returns {Object} { value, wasModified, originalValue, warnings }
 */
function normalizeCoordinate(coord, type = 'lat') {
  const originalValue = coord !== undefined && coord !== null ? String(coord) : '';
  const warnings = [];

  if (!coord && coord !== 0) {
    return { value: null, wasModified: false, originalValue: '', warnings: [] };
  }

  // Konverter til nummer
  let normalized = parseFloat(String(coord).replace(',', '.').trim());

  if (isNaN(normalized)) {
    warnings.push(`Ugyldig koordinat: ${coord}`);
    return { value: null, wasModified: true, originalValue, warnings };
  }

  // Valider intervall
  if (type === 'lat') {
    if (normalized < -90 || normalized > 90) {
      warnings.push(`Breddegrad ${normalized} er utenfor gyldig område (-90 til 90)`);
    }
    // Norge er mellom ca. 57°N og 71°N
    if (normalized < 57 || normalized > 72) {
      warnings.push(`Breddegrad ${normalized} er utenfor Norge (57-72)`);
    }
  } else if (type === 'lng') {
    if (normalized < -180 || normalized > 180) {
      warnings.push(`Lengdegrad ${normalized} er utenfor gyldig område (-180 til 180)`);
    }
    // Norge er mellom ca. 4°E og 31°E
    if (normalized < 4 || normalized > 32) {
      warnings.push(`Lengdegrad ${normalized} er utenfor Norge (4-32)`);
    }
  }

  return {
    value: normalized,
    wasModified: normalized !== parseFloat(originalValue),
    originalValue,
    warnings
  };
}

/**
 * Normaliser dato
 * @param {string|Date} date - Dato å normalisere
 * @returns {Object} { value, wasModified, originalValue, warnings }
 */
function normalizeDate(date) {
  const originalValue = date || '';
  const warnings = [];

  if (!date) {
    return { value: null, wasModified: false, originalValue: '', warnings: [] };
  }

  let normalized = null;

  // Prøv å parse som Date
  if (date instanceof Date && !isNaN(date)) {
    normalized = date.toISOString().split('T')[0];
  } else if (typeof date === 'string') {
    // Prøv ulike formater
    const dateStr = date.trim();

    // ISO format: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      normalized = dateStr;
    }
    // Norsk format: DD.MM.YYYY
    else if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(dateStr)) {
      const [day, month, year] = dateStr.split('.');
      normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    // Norsk format: DD/MM/YYYY
    else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
      const [day, month, year] = dateStr.split('/');
      normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    // Excel serial number (tall)
    else if (/^\d+$/.test(dateStr)) {
      const excelDate = parseInt(dateStr, 10);
      // Excel bruker 1900-01-01 som dag 1 (med en bug for 1900)
      const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
      if (!isNaN(jsDate)) {
        normalized = jsDate.toISOString().split('T')[0];
      }
    }
  } else if (typeof date === 'number') {
    // Excel serial number
    const jsDate = new Date((date - 25569) * 86400 * 1000);
    if (!isNaN(jsDate)) {
      normalized = jsDate.toISOString().split('T')[0];
    }
  }

  if (!normalized && date) {
    warnings.push(`Kunne ikke parse dato: ${date}`);
  }

  return {
    value: normalized,
    wasModified: normalized !== originalValue,
    originalValue: String(originalValue),
    warnings
  };
}

/**
 * Normaliser et helt kundedata-objekt
 * @param {Object} kunde - Kundedata fra Excel
 * @returns {Object} { normalized: {...}, modifications: [...], warnings: [...] }
 */
function normalizeKunde(kunde) {
  const normalized = {};
  const modifications = [];
  const warnings = [];

  // Tekstfelter
  const textFields = ['navn', 'adresse', 'poststed', 'notater'];
  for (const field of textFields) {
    if (kunde[field] !== undefined) {
      const result = normalizeText(kunde[field]);
      normalized[field] = result.value;
      if (result.wasModified) {
        modifications.push({ field, from: result.originalValue, to: result.value });
      }
      warnings.push(...result.warnings.map(w => ({ field, message: w })));
    }
  }

  // Postnummer
  if (kunde.postnummer !== undefined) {
    const result = normalizePostnummer(kunde.postnummer);
    normalized.postnummer = result.value;
    if (result.wasModified) {
      modifications.push({ field: 'postnummer', from: result.originalValue, to: result.value });
    }
    warnings.push(...result.warnings.map(w => ({ field: 'postnummer', message: w })));
  }

  // Telefon
  if (kunde.telefon !== undefined) {
    const result = normalizePhone(kunde.telefon);
    normalized.telefon = result.value;
    if (result.wasModified) {
      modifications.push({ field: 'telefon', from: result.originalValue, to: result.value });
    }
    warnings.push(...result.warnings.map(w => ({ field: 'telefon', message: w })));
  }

  // E-post
  if (kunde.epost !== undefined) {
    const result = normalizeEmail(kunde.epost);
    normalized.epost = result.value;
    if (result.wasModified) {
      modifications.push({ field: 'epost', from: result.originalValue, to: result.value });
    }
    warnings.push(...result.warnings.map(w => ({ field: 'epost', message: w })));
  }

  // Koordinater
  if (kunde.lat !== undefined) {
    const result = normalizeCoordinate(kunde.lat, 'lat');
    normalized.lat = result.value;
    if (result.wasModified) {
      modifications.push({ field: 'lat', from: result.originalValue, to: result.value });
    }
    warnings.push(...result.warnings.map(w => ({ field: 'lat', message: w })));
  }

  if (kunde.lng !== undefined) {
    const result = normalizeCoordinate(kunde.lng, 'lng');
    normalized.lng = result.value;
    if (result.wasModified) {
      modifications.push({ field: 'lng', from: result.originalValue, to: result.value });
    }
    warnings.push(...result.warnings.map(w => ({ field: 'lng', message: w })));
  }

  // Datoer
  const dateFields = [
    'siste_kontroll', 'neste_kontroll',
    'siste_el_kontroll', 'neste_el_kontroll',
    'siste_brann_kontroll', 'neste_brann_kontroll'
  ];
  for (const field of dateFields) {
    if (kunde[field] !== undefined) {
      const result = normalizeDate(kunde[field]);
      normalized[field] = result.value;
      if (result.wasModified) {
        modifications.push({ field, from: result.originalValue, to: result.value });
      }
      warnings.push(...result.warnings.map(w => ({ field, message: w })));
    }
  }

  // Kopier andre felter uendret
  const handledFields = [
    ...textFields, 'postnummer', 'telefon', 'epost', 'lat', 'lng', ...dateFields
  ];
  for (const [key, value] of Object.entries(kunde)) {
    if (!handledFields.includes(key)) {
      normalized[key] = value;
    }
  }

  return { normalized, modifications, warnings };
}

module.exports = {
  normalizePhone,
  normalizePostnummer,
  normalizeEmail,
  normalizeText,
  normalizeCoordinate,
  normalizeDate,
  normalizeKunde
};

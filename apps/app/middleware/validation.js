/**
 * Validate customer data
 * @param {Object} kunde - Customer data to validate
 * @returns {string[]} Array of error messages (empty if valid)
 */
function validateKunde(kunde) {
  const errors = [];

  // Type safety - ensure string properties are actually strings
  const navn = typeof kunde.navn === 'string' ? kunde.navn : '';
  const adresse = typeof kunde.adresse === 'string' ? kunde.adresse : '';
  const epost = typeof kunde.epost === 'string' ? kunde.epost : '';
  const telefon = typeof kunde.telefon === 'string' ? kunde.telefon : '';

  if (!navn || navn.trim().length < 2) {
    errors.push('Navn må være minst 2 tegn');
  }
  if (!adresse || adresse.trim().length < 3) {
    errors.push('Adresse må være minst 3 tegn');
  }
  if (epost && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost)) {
    errors.push('Ugyldig e-postadresse');
  }

  // Telefonnummer validering - må være tall, mellomrom, +, eller -
  if (telefon && telefon.trim() !== '') {
    const cleanPhone = telefon.replaceAll(/[\s\-\+\(\)]/g, '');
    if (!/^\d+$/.test(cleanPhone) || cleanPhone.length < 8) {
      errors.push('Ugyldig telefonnummer (må inneholde minst 8 siffer)');
    }
  }

  // Dato validering for kontroll-datoer
  const dateFields = [
    'neste_el_kontroll',
    'siste_el_kontroll',
    'neste_brann_kontroll',
    'siste_brann_kontroll',
    'neste_kontroll',
    'siste_kontroll'
  ];

  for (const field of dateFields) {
    const fieldValue = typeof kunde[field] === 'string' ? kunde[field] : '';
    if (fieldValue && fieldValue.trim() !== '') {
      // Godtar YYYY-MM-DD format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fieldValue)) {
        errors.push(`Ugyldig datoformat for ${field} (bruk YYYY-MM-DD)`);
      } else {
        // Sjekk at datoen er gyldig
        const date = new Date(fieldValue);
        if (Number.isNaN(date.getTime())) {
          errors.push(`Ugyldig dato for ${field}`);
        }
      }
    }
  }

  // Koordinat-validering
  if (kunde.lat !== undefined && kunde.lat !== null && kunde.lat !== '') {
    const lat = Number.parseFloat(kunde.lat);
    if (Number.isNaN(lat) || lat < -90 || lat > 90) {
      errors.push('Ugyldig latitude (må være mellom -90 og 90)');
    }
  }
  if (kunde.lng !== undefined && kunde.lng !== null && kunde.lng !== '') {
    const lng = Number.parseFloat(kunde.lng);
    if (Number.isNaN(lng) || lng < -180 || lng > 180) {
      errors.push('Ugyldig longitude (må være mellom -180 og 180)');
    }
  }

  return errors;
}

/**
 * Validate route data
 * @param {Object} rute - Route data to validate
 * @returns {string[]} Array of error messages (empty if valid)
 */
function validateRute(rute) {
  const errors = [];

  if (!rute.navn || typeof rute.navn !== 'string' || rute.navn.trim().length < 2) {
    errors.push('Rutenavn må være minst 2 tegn');
  }

  if (rute.planlagt_dato) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rute.planlagt_dato)) {
      errors.push('Ugyldig datoformat for planlagt_dato (bruk YYYY-MM-DD)');
    }
  }

  return errors;
}

/**
 * Validate appointment data
 * @param {Object} avtale - Appointment data to validate
 * @returns {string[]} Array of error messages (empty if valid)
 */
function validateAvtale(avtale) {
  const errors = [];

  if (!avtale.dato || !/^\d{4}-\d{2}-\d{2}$/.test(avtale.dato)) {
    errors.push('Dato er påkrevd (bruk YYYY-MM-DD format)');
  }

  if (avtale.klokkeslett && !/^\d{2}:\d{2}(:\d{2})?$/.test(avtale.klokkeslett)) {
    errors.push('Ugyldig klokkeslettformat (bruk HH:MM)');
  }

  const validTypes = ['El-Kontroll', 'Brannvarsling', 'El-Kontroll + Brannvarsling'];
  if (avtale.type && !validTypes.includes(avtale.type)) {
    errors.push('Ugyldig avtaletype');
  }

  return errors;
}

/**
 * Sanitize string input to prevent XSS
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeString(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

module.exports = {
  validateKunde,
  validateRute,
  validateAvtale,
  sanitizeString
};

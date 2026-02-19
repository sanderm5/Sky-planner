// Get next control date for a customer (DYNAMIC via customer.services)
function getNextControlDate(customer) {
  // Use dynamic services array if available
  if (customer.services && Array.isArray(customer.services) && customer.services.length > 0) {
    // Find the earliest upcoming control date from all services
    let earliestDate = null;
    for (const service of customer.services) {
      let nextDate = null;
      if (service.neste_kontroll) {
        nextDate = new Date(service.neste_kontroll);
      } else if (service.siste_kontroll) {
        nextDate = new Date(service.siste_kontroll);
        nextDate.setMonth(nextDate.getMonth() + (service.intervall_months || 12));
      }
      if (nextDate && (!earliestDate || nextDate < earliestDate)) {
        earliestDate = nextDate;
      }
    }
    if (earliestDate) return earliestDate;
  }

  // Legacy fallback: Use hardcoded columns
  const kategori = customer.kategori || '';

  // El-Kontroll or combined
  if (kategori.includes('El-Kontroll')) {
    if (customer.neste_el_kontroll) {
      return new Date(customer.neste_el_kontroll);
    }
    if (customer.siste_el_kontroll) {
      const date = new Date(customer.siste_el_kontroll);
      date.setMonth(date.getMonth() + (customer.el_kontroll_intervall || 36));
      return date;
    }
  }

  // Brannvarsling only
  if (kategori === 'Brannvarsling') {
    if (customer.neste_brann_kontroll) {
      return new Date(customer.neste_brann_kontroll);
    }
    if (customer.siste_brann_kontroll) {
      const date = new Date(customer.siste_brann_kontroll);
      date.setMonth(date.getMonth() + (customer.brann_kontroll_intervall || 12));
      return date;
    }
  }

  // Legacy generic fields fallback
  if (customer.neste_kontroll) {
    return new Date(customer.neste_kontroll);
  }
  if (customer.siste_kontroll) {
    const date = new Date(customer.siste_kontroll);
    date.setMonth(date.getMonth() + (customer.kontroll_intervall_mnd || 12));
    return date;
  }

  return null;
}

// Get all upcoming control dates for a customer (returns array of service dates)
function getCustomerServiceDates(customer) {
  const dates = [];

  // Use dynamic services array if available
  if (customer.services && Array.isArray(customer.services)) {
    for (const service of customer.services) {
      let nextDate = null;
      if (service.neste_kontroll) {
        nextDate = new Date(service.neste_kontroll);
      } else if (service.siste_kontroll) {
        nextDate = new Date(service.siste_kontroll);
        nextDate.setMonth(nextDate.getMonth() + (service.intervall_months || 12));
      }
      if (nextDate) {
        dates.push({
          service_type_name: service.service_type_name,
          service_type_slug: service.service_type_slug,
          service_type_icon: service.service_type_icon,
          service_type_color: service.service_type_color,
          neste_kontroll: nextDate,
          siste_kontroll: service.siste_kontroll ? new Date(service.siste_kontroll) : null,
          intervall_months: service.intervall_months
        });
      }
    }
  }

  return dates;
}

// Format date
function getISOWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const yearStart = new Date(d.getFullYear(), 0, 4);
  return Math.round(((d - yearStart) / 86400000 + 1) / 7);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  if (appConfig.datoModus === 'month_year') {
    return date.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString('nb-NO');
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  if (appConfig.datoModus === 'month_year') {
    return date.toLocaleDateString('nb-NO', { month: 'short', year: 'numeric' });
  }
  return date.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' });
}

function formatDateInline(date) {
  if (!date) return '';
  if (isNaN(date.getTime())) return '';
  if (appConfig.datoModus === 'month_year') {
    return date.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' });
  }
  return date.toLocaleDateString('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function normalizeDateValue(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return value + '-01';
  return value;
}

function applyDateModeToInputs() {
  if (appConfig.datoModus !== 'month_year') return;
  document.querySelectorAll('input[type="date"]').forEach(input => {
    input.type = 'month';
    if (input.value && input.value.length === 10) {
      input.value = input.value.substring(0, 7);
    }
  });
}

// Save API key
function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (apiKey) {
    localStorage.setItem('ors_api_key', apiKey);
    apiKeyModal.classList.add('hidden');
    planRoute(); // Retry route planning
  }
}

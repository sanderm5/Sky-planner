async function geocodeAddress(address, postnummer, poststed) {
  const fullAddress = `${address}, ${postnummer || ''} ${poststed || ''}`.trim();

  try {
    // Try Kartverket first (best for Norwegian addresses)
    const response = await fetch(
      `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(fullAddress)}&fuzzy=true&treffPerSide=1`
    );
    if (response.ok) {
      const data = await response.json();
      if (data.adresser && data.adresser.length > 0) {
        const result = data.adresser[0];
        return {
          lat: result.representasjonspunkt.lat,
          lng: result.representasjonspunkt.lon,
          formatted: `${result.adressetekst}, ${result.postnummer} ${result.poststed}`
        };
      }
    }

    // Fallback to Nominatim
    const nomResponse = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullAddress)}&format=json&countrycodes=no&limit=1`
    );
    if (nomResponse.ok) {
      const nomData = await nomResponse.json();
      if (nomData.length > 0) {
        return {
          lat: Number.parseFloat(nomData[0].lat),
          lng: Number.parseFloat(nomData[0].lon),
          formatted: nomData[0].display_name
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Geocoding feil:', error);
    return null;
  }
}

// ============================================
// Address Autocomplete & Postnummer Lookup
// ============================================

// Debounce utility function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// AbortController for canceling in-flight address searches
let addressSearchController = null;

// Search addresses using Kartverket API
async function searchAddresses(query) {
  if (!query || query.length < 3) return [];

  // Cancel any in-flight request to prevent stale results
  if (addressSearchController) {
    addressSearchController.abort();
  }
  addressSearchController = new AbortController();

  try {
    const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(query)}&fuzzy=true&treffPerSide=5`;
    const response = await fetch(url, { signal: addressSearchController.signal });
    const data = await response.json();

    if (data.adresser && data.adresser.length > 0) {
      return data.adresser.map(a => ({
        adresse: a.adressetekst,
        postnummer: a.postnummer,
        poststed: a.poststed,
        lat: a.representasjonspunkt.lat,
        lng: a.representasjonspunkt.lon,
        kommune: a.kommunenavn || ''
      }));
    }
    return [];
  } catch (error) {
    if (error.name === 'AbortError') return [];
    console.error('Adressesøk feilet:', error);
    return [];
  }
}

// Lookup postal code using Bring API
async function lookupPostnummer(postnummer) {
  if (!/^\d{4}$/.test(postnummer)) return null;

  try {
    const url = `https://api.bring.com/shippingguide/api/postalCode.json?clientUrl=elkontroll&country=NO&pnr=${postnummer}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.valid) {
      return data.result;
    }
    return null;
  } catch (error) {
    console.error('Postnummer-oppslag feilet:', error);
    return null;
  }
}

// Render address suggestions dropdown
function renderAddressSuggestions(results) {
  const container = document.getElementById('addressSuggestions');
  if (!container) return;

  const adresseInput = document.getElementById('adresse');

  if (!results || results.length === 0) {
    container.innerHTML = '';
    container.classList.remove('visible');
    if (adresseInput) adresseInput.setAttribute('aria-expanded', 'false');
    return;
  }

  container.setAttribute('role', 'listbox');
  container.setAttribute('id', 'addressSuggestionsList');

  container.innerHTML = results.map((addr, index) => `
    <div class="address-suggestion-item" role="option" data-index="${index}">
      <i class="fas fa-map-marker-alt"></i>
      <div class="address-suggestion-text">
        <div class="address-suggestion-main">${escapeHtml(addr.adresse)}</div>
        <div class="address-suggestion-detail">${escapeHtml(addr.postnummer)} ${escapeHtml(addr.poststed)}${addr.kommune ? `, ${escapeHtml(addr.kommune)}` : ''}</div>
      </div>
    </div>
  `).join('');

  container.classList.add('visible');
  if (adresseInput) adresseInput.setAttribute('aria-expanded', 'true');
}

// Select an address suggestion and fill form fields
function selectAddressSuggestion(suggestion) {
  const adresseInput = document.getElementById('adresse');
  const postnummerInput = document.getElementById('postnummer');
  const poststedInput = document.getElementById('poststed');
  const latInput = document.getElementById('lat');
  const lngInput = document.getElementById('lng');
  const suggestionsContainer = document.getElementById('addressSuggestions');

  if (adresseInput) adresseInput.value = suggestion.adresse;
  if (postnummerInput) postnummerInput.value = suggestion.postnummer;
  if (poststedInput) {
    poststedInput.value = suggestion.poststed;
    poststedInput.classList.add('auto-filled');
  }
  if (latInput) latInput.value = suggestion.lat.toFixed(6);
  if (lngInput) lngInput.value = suggestion.lng.toFixed(6);

  // Update geocode quality badge
  updateGeocodeQualityBadge('exact');

  // Hide suggestions
  if (suggestionsContainer) {
    suggestionsContainer.classList.remove('visible');
  }
  if (adresseInput) adresseInput.setAttribute('aria-expanded', 'false');

  // Update postnummer status
  updatePostnummerStatus('valid');

  showNotification(`Adresse valgt: ${suggestion.adresse}, ${suggestion.postnummer} ${suggestion.poststed}`);
}

// Update postnummer status indicator
function updatePostnummerStatus(status) {
  const statusEl = document.getElementById('postnummerStatus');
  if (!statusEl) return;

  statusEl.className = 'postnummer-status';

  switch (status) {
    case 'valid':
      statusEl.innerHTML = '<i class="fas fa-check"></i>';
      statusEl.classList.add('valid');
      break;
    case 'invalid':
      statusEl.innerHTML = '<i class="fas fa-times"></i>';
      statusEl.classList.add('invalid');
      break;
    case 'loading':
      statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      statusEl.classList.add('loading');
      break;
    default:
      statusEl.innerHTML = '';
  }
}

// Address autocomplete state
let addressSuggestions = [];
let selectedSuggestionIndex = -1;

// Reset autocomplete state (call when opening/closing customer modal)
function resetAddressAutocomplete() {
  addressSuggestions = [];
  selectedSuggestionIndex = -1;
  if (addressSearchController) {
    addressSearchController.abort();
    addressSearchController = null;
  }
  const container = document.getElementById('addressSuggestions');
  if (container) {
    container.innerHTML = '';
    container.classList.remove('visible');
  }
  const adresseInput = document.getElementById('adresse');
  if (adresseInput) adresseInput.setAttribute('aria-expanded', 'false');
}

// Setup address autocomplete functionality
function setupAddressAutocomplete() {
  const adresseInput = document.getElementById('adresse');
  const postnummerInput = document.getElementById('postnummer');
  const poststedInput = document.getElementById('poststed');
  const suggestionsContainer = document.getElementById('addressSuggestions');

  if (!adresseInput || !suggestionsContainer) return;

  // ARIA combobox attributes for accessibility
  adresseInput.setAttribute('role', 'combobox');
  adresseInput.setAttribute('aria-autocomplete', 'list');
  adresseInput.setAttribute('aria-expanded', 'false');
  adresseInput.setAttribute('aria-controls', 'addressSuggestionsList');

  // Debounced search function
  const debouncedSearch = debounce(async (query) => {
    if (query.length < 3) {
      suggestionsContainer.classList.remove('visible');
      adresseInput.setAttribute('aria-expanded', 'false');
      return;
    }

    addressSuggestions = await searchAddresses(query);
    selectedSuggestionIndex = -1;
    renderAddressSuggestions(addressSuggestions);
  }, 300);

  // Input event for address search
  adresseInput.addEventListener('input', (e) => {
    debouncedSearch(e.target.value);
  });

  // Keyboard navigation
  adresseInput.addEventListener('keydown', (e) => {
    if (!suggestionsContainer.classList.contains('visible')) return;

    const items = suggestionsContainer.querySelectorAll('.address-suggestion-item');

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
        updateSelectedSuggestion(items);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
        updateSelectedSuggestion(items);
        break;
      case 'Enter':
        if (selectedSuggestionIndex >= 0 && addressSuggestions[selectedSuggestionIndex]) {
          e.preventDefault();
          selectAddressSuggestion(addressSuggestions[selectedSuggestionIndex]);
        }
        break;
      case 'Escape':
        suggestionsContainer.classList.remove('visible');
        adresseInput.setAttribute('aria-expanded', 'false');
        selectedSuggestionIndex = -1;
        break;
    }
  });

  // Click on suggestion
  suggestionsContainer.addEventListener('click', (e) => {
    const item = e.target.closest('.address-suggestion-item');
    if (item) {
      const index = parseInt(item.dataset.index, 10);
      if (addressSuggestions[index]) {
        selectAddressSuggestion(addressSuggestions[index]);
      }
    }
  });

  // Hide suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.address-autocomplete-wrapper')) {
      suggestionsContainer.classList.remove('visible');
      adresseInput.setAttribute('aria-expanded', 'false');
    }
  });

  // Postnummer auto-lookup
  if (postnummerInput && poststedInput) {
    postnummerInput.addEventListener('input', async (e) => {
      const value = e.target.value.replace(/\D/g, '').slice(0, 4);
      e.target.value = value;

      // Remove auto-filled class from poststed when user edits postnummer
      poststedInput.classList.remove('auto-filled');
      updatePostnummerStatus('');

      if (value.length === 4) {
        const valueAtRequest = value;
        updatePostnummerStatus('loading');
        const result = await lookupPostnummer(value);

        // Only update if postnummer hasn't changed while we were fetching
        if (postnummerInput.value === valueAtRequest && result) {
          // Only auto-fill poststed if user hasn't manually typed something
          if (!poststedInput.value || poststedInput.classList.contains('auto-filled')) {
            poststedInput.value = result;
            poststedInput.classList.add('auto-filled');
          }
          updatePostnummerStatus('valid');
        } else if (postnummerInput.value === valueAtRequest && !result) {
          updatePostnummerStatus('invalid');
        }
      }
    });
  }
}

// Update visual selection in suggestions list
function updateSelectedSuggestion(items) {
  items.forEach((item, index) => {
    if (index === selectedSuggestionIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

async function geocodeAddress(address, postnummer, poststed) {
  const query = `${address || ''}, ${postnummer || ''} ${poststed || ''}`.trim();

  try {
    const response = await apiFetch('/api/geocode/forward', {
      method: 'POST',
      body: JSON.stringify({ query, limit: 1 })
    });

    if (response.ok) {
      const result = await response.json();
      const suggestion = result.data?.suggestions?.[0];
      if (suggestion) {
        return {
          lat: suggestion.lat,
          lng: suggestion.lng,
          formatted: `${suggestion.adresse}, ${suggestion.postnummer} ${suggestion.poststed}`.trim()
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

// Client-side cache for address search results
const _addressSearchCache = new Map();
const _ADDRESS_CACHE_MAX = 50;
const _ADDRESS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedAddressSearch(key) {
  const entry = _addressSearchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > _ADDRESS_CACHE_TTL) {
    _addressSearchCache.delete(key);
    return null;
  }
  return entry.results;
}

function setCachedAddressSearch(key, results) {
  if (_addressSearchCache.size >= _ADDRESS_CACHE_MAX) {
    const firstKey = _addressSearchCache.keys().next().value;
    if (firstKey) _addressSearchCache.delete(firstKey);
  }
  _addressSearchCache.set(key, { results, ts: Date.now() });
}

// Parse Kartverket response into suggestion objects
function parseKartverketResults(data) {
  if (!data.adresser || data.adresser.length === 0) return [];
  return data.adresser
    .filter(addr => addr.representasjonspunkt)
    .map(addr => ({
      adresse: addr.adressetekst || '',
      postnummer: addr.postnummer || '',
      poststed: addr.poststed || '',
      lat: addr.representasjonspunkt.lat,
      lng: addr.representasjonspunkt.lon,
      kommune: addr.kommunenavn || ''
    }));
}

// Search addresses directly via Kartverket API (fast, public, no backend round-trip)
// Falls back to backend proxy (Mapbox) if Kartverket fails
async function searchAddresses(query) {
  if (!query || query.length < 2) return [];

  // Check client-side cache first
  const cacheKey = query.trim().toLowerCase();
  const cached = getCachedAddressSearch(cacheKey);
  if (cached) return cached;

  // Cancel any in-flight request to prevent stale results
  if (addressSearchController) {
    addressSearchController.abort();
  }
  addressSearchController = new AbortController();
  const signal = addressSearchController.signal;

  const encoded = encodeURIComponent(query.trim());

  // Try Kartverket exact search first (very fast, no fuzzy)
  try {
    const response = await fetch(
      `https://ws.geonorge.no/adresser/v1/sok?sok=${encoded}&treffPerSide=5`,
      { signal }
    );
    if (response.ok) {
      const results = parseKartverketResults(await response.json());
      if (results.length > 0) {
        setCachedAddressSearch(cacheKey, results);
        return results;
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') return [];
  }

  // Fallback: Kartverket with fuzzy (slower but catches typos)
  try {
    const response = await fetch(
      `https://ws.geonorge.no/adresser/v1/sok?sok=${encoded}&fuzzy=true&treffPerSide=5`,
      { signal }
    );
    if (response.ok) {
      const results = parseKartverketResults(await response.json());
      if (results.length > 0) {
        setCachedAddressSearch(cacheKey, results);
        return results;
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') return [];
  }

  // Last resort: backend proxy (Mapbox)
  try {
    const proximity = map ? [map.getCenter().lng, map.getCenter().lat] : undefined;
    const response = await apiFetch('/api/geocode/forward', {
      method: 'POST',
      body: JSON.stringify({ query, limit: 5, proximity }),
      signal
    });
    if (!response.ok) return [];
    const result = await response.json();
    const suggestions = (result.data?.suggestions || []).map(s => ({
      adresse: s.adresse,
      postnummer: s.postnummer,
      poststed: s.poststed,
      lat: s.lat,
      lng: s.lng,
      kommune: s.kommune || ''
    }));
    if (suggestions.length > 0) {
      setCachedAddressSearch(cacheKey, suggestions);
    }
    return suggestions;
  } catch (error) {
    if (error.name === 'AbortError') return [];
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

// Position the address suggestions dropdown relative to the input (fixed positioning)
function positionAddressSuggestions() {
  const container = document.getElementById('addressSuggestions');
  const adresseInput = document.getElementById('adresse');
  if (!container || !adresseInput) return;

  const rect = adresseInput.getBoundingClientRect();
  container.style.top = `${rect.bottom}px`;
  container.style.left = `${rect.left}px`;
  container.style.width = `${rect.width}px`;
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

  container.innerHTML = results.map((addr, index) => `
    <div class="address-suggestion-item" role="option" data-index="${index}">
      <i class="fas fa-map-marker-alt"></i>
      <div class="address-suggestion-text">
        <div class="address-suggestion-main">${escapeHtml(addr.adresse)}</div>
        <div class="address-suggestion-detail">${escapeHtml(addr.postnummer)} ${escapeHtml(addr.poststed)}${addr.kommune ? `, ${escapeHtml(addr.kommune)}` : ''}</div>
      </div>
    </div>
  `).join('');

  // Position dropdown below the input using fixed positioning
  positionAddressSuggestions();

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
  adresseInput.setAttribute('aria-controls', 'addressSuggestions');

  // Show loading state in dropdown
  function showSearchLoading() {
    suggestionsContainer.innerHTML = `
      <div class="address-suggestion-item" style="justify-content:center;opacity:0.6;pointer-events:none;">
        <i class="fas fa-spinner fa-spin"></i>
        <span>Søker...</span>
      </div>`;
    positionAddressSuggestions();
    suggestionsContainer.classList.add('visible');
    adresseInput.setAttribute('aria-expanded', 'true');
  }

  // Debounced search function
  const debouncedSearch = debounce(async (query) => {
    if (query.length < 2) {
      suggestionsContainer.classList.remove('visible');
      adresseInput.setAttribute('aria-expanded', 'false');
      return;
    }

    addressSuggestions = await searchAddresses(query);
    selectedSuggestionIndex = -1;
    renderAddressSuggestions(addressSuggestions);
  }, 150);

  // Input event for address search
  adresseInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (val.length >= 2) showSearchLoading();
    debouncedSearch(val);
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

  // Hide suggestions when clicking outside (check both wrapper and fixed dropdown)
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.address-autocomplete-wrapper') && !e.target.closest('.address-suggestions')) {
      suggestionsContainer.classList.remove('visible');
      adresseInput.setAttribute('aria-expanded', 'false');
    }
  });

  // Reposition or hide dropdown on modal scroll
  const modalContent = adresseInput.closest('.modal-content');
  if (modalContent) {
    modalContent.addEventListener('scroll', () => {
      if (suggestionsContainer.classList.contains('visible')) {
        // Hide if input scrolled out of view
        const rect = adresseInput.getBoundingClientRect();
        const modalRect = modalContent.getBoundingClientRect();
        if (rect.bottom < modalRect.top || rect.top > modalRect.bottom) {
          suggestionsContainer.classList.remove('visible');
          adresseInput.setAttribute('aria-expanded', 'false');
        } else {
          positionAddressSuggestions();
        }
      }
    });
  }

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

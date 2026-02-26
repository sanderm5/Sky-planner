'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getCsrfToken } from '@/lib/csrf';
import Link from 'next/link';

interface Industry {
  id: number;
  name: string;
  slug: string;
  icon: string;
  color: string;
  description: string | null;
}

interface Organization {
  id: number;
  navn: string;
  slug: string;
  plan_type: string;
  max_kunder: number;
  max_brukere: number;
  logo_url?: string;
  primary_color?: string;
  app_mode?: string;
  dato_modus?: string;
  [key: string]: any;
}

interface OrgSettingsFormProps {
  organization: Organization;
  isAdmin: boolean;
  isFullMode: boolean;
  currentIndustry: Industry | null;
}

interface AddressSuggestion {
  adresse: string;
  postnummer: string;
  poststed: string;
  lat: number;
  lng: number;
  kommune?: string;
}

export function OrgSettingsForm({
  organization,
  isAdmin,
  isFullMode,
  currentIndustry,
}: OrgSettingsFormProps) {
  // Form state
  const [navn, setNavn] = useState(organization.navn || '');
  const [datoModus, setDatoModus] = useState(
    organization.dato_modus || 'full_date'
  );
  const [companyAddress, setCompanyAddress] = useState(
    (organization as any).company_address || ''
  );
  const [companyPostnummer, setCompanyPostnummer] = useState(
    (organization as any).company_postnummer || ''
  );
  const [companyPoststed, setCompanyPoststed] = useState(
    (organization as any).company_poststed || ''
  );
  const [routeStartLat, setRouteStartLat] = useState(
    (organization as any).route_start_lat?.toString() || ''
  );
  const [routeStartLng, setRouteStartLng] = useState(
    (organization as any).route_start_lng?.toString() || ''
  );
  const [logoUrl, setLogoUrl] = useState(organization.logo_url || '');

  // UI state
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');
  const [saveErrorMsg, setSaveErrorMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');
  const [uploadErrorMsg, setUploadErrorMsg] = useState('');
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  // Industry state
  const [showIndustrySelector, setShowIndustrySelector] = useState(false);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [industriesLoaded, setIndustriesLoaded] = useState(false);
  const [selectedIndustryId, setSelectedIndustryId] = useState(
    currentIndustry?.id?.toString() || ''
  );
  const [savingIndustry, setSavingIndustry] = useState(false);
  const originalIndustryId = currentIndustry?.id?.toString() || '';

  // Address autocomplete state
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [geocodeStatus, setGeocodeStatus] = useState<{
    text: string;
    type: 'info' | 'success' | 'warning' | 'error';
  } | null>(null);

  const addressInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Address search cache
  const addressCacheRef = useRef<
    Map<string, { results: AddressSuggestion[]; ts: number }>
  >(new Map());

  // ---- CSRF helpers ----
  function csrfHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    };
  }

  function backendCsrfHeaders(): Record<string, string> {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return {
      'Content-Type': 'application/json',
      'X-CSRF-Token': match ? match[1] : '',
    };
  }

  const backendCsrfReadyRef = useRef(false);
  async function ensureBackendCsrf() {
    if (backendCsrfReadyRef.current) return;
    try {
      await fetch('/api/app/config', { credentials: 'include' });
      backendCsrfReadyRef.current = true;
    } catch {
      /* ignore */
    }
  }

  // ---- Address autocomplete ----
  function parseKartverketResults(
    data: any
  ): AddressSuggestion[] {
    if (!data.adresser || data.adresser.length === 0) return [];
    return data.adresser
      .filter((addr: any) => addr.representasjonspunkt)
      .map((addr: any) => ({
        adresse: addr.adressetekst || '',
        postnummer: addr.postnummer || '',
        poststed: addr.poststed || '',
        lat: addr.representasjonspunkt.lat,
        lng: addr.representasjonspunkt.lon,
        kommune: addr.kommunenavn || '',
      }));
  }

  function getCachedSearch(key: string): AddressSuggestion[] | null {
    const entry = addressCacheRef.current.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > 5 * 60 * 1000) {
      addressCacheRef.current.delete(key);
      return null;
    }
    return entry.results;
  }

  function setCachedSearch(key: string, results: AddressSuggestion[]) {
    if (addressCacheRef.current.size >= 50) {
      const firstKey = addressCacheRef.current.keys().next().value;
      if (firstKey) addressCacheRef.current.delete(firstKey);
    }
    addressCacheRef.current.set(key, { results, ts: Date.now() });
  }

  function selectSuggestion(s: AddressSuggestion) {
    setCompanyAddress(s.adresse);
    setCompanyPostnummer(s.postnummer || '');
    setCompanyPoststed(s.poststed || '');
    setRouteStartLat(s.lat.toFixed(7));
    setRouteStartLng(s.lng.toFixed(7));
    setGeocodeStatus({
      text: `Koordinater satt: ${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`,
      type: 'success',
    });
    setShowSuggestions(false);
    setSuggestions([]);
  }

  const searchAddress = useCallback(async (query: string) => {
    if (query.length < 2) {
      setShowSuggestions(false);
      setSuggestions([]);
      return;
    }

    const cacheKey = query.trim().toLowerCase();
    const cached = getCachedSearch(cacheKey);
    if (cached) {
      setSuggestions(cached);
      setShowSuggestions(true);
      setActiveSuggestionIndex(-1);
      return;
    }

    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const encoded = encodeURIComponent(query.trim());

    // Show loading
    setSuggestions([]);
    setShowSuggestions(true);

    // Try Kartverket exact search first
    try {
      const response = await fetch(
        `https://ws.geonorge.no/adresser/v1/sok?sok=${encoded}&treffPerSide=5`,
        { signal }
      );
      if (response.ok) {
        const results = parseKartverketResults(await response.json());
        if (results.length > 0) {
          setCachedSearch(cacheKey, results);
          setSuggestions(results);
          setShowSuggestions(true);
          setActiveSuggestionIndex(-1);
          return;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
    }

    // Fallback: Kartverket fuzzy search
    try {
      const response = await fetch(
        `https://ws.geonorge.no/adresser/v1/sok?sok=${encoded}&fuzzy=true&treffPerSide=5`,
        { signal }
      );
      if (response.ok) {
        const results = parseKartverketResults(await response.json());
        if (results.length > 0) {
          setCachedSearch(cacheKey, results);
          setSuggestions(results);
          setShowSuggestions(true);
          setActiveSuggestionIndex(-1);
          return;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
    }

    // Last resort: backend proxy (Mapbox)
    try {
      await ensureBackendCsrf();
      const res = await fetch('/api/app/geocode/forward', {
        method: 'POST',
        headers: backendCsrfHeaders(),
        credentials: 'include',
        body: JSON.stringify({ query, limit: 5 }),
        signal,
      });
      if (!res.ok) {
        setShowSuggestions(false);
        return;
      }
      const data = await res.json();
      const results = data?.data?.suggestions || [];
      if (results.length > 0) {
        setCachedSearch(cacheKey, results);
      }
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setActiveSuggestionIndex(-1);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setShowSuggestions(false);
      }
    }
  }, []);

  function handleAddressInput(value: string) {
    setCompanyAddress(value);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => searchAddress(value.trim()), 150);
  }

  function handleAddressKeyDown(e: React.KeyboardEvent) {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIndex((prev) =>
        Math.min(prev + 1, suggestions.length - 1)
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && activeSuggestionIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeSuggestionIndex]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  }

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        !addressInputRef.current?.contains(e.target as Node) &&
        !suggestionsRef.current?.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // ---- Geocode button ----
  async function handleGeocode() {
    const searchQuery = [companyAddress, companyPostnummer, companyPoststed]
      .filter(Boolean)
      .join(', ');
    if (!searchQuery) {
      setGeocodeStatus({ text: 'Fyll inn adresse først.', type: 'info' });
      return;
    }
    setGeocodeStatus({ text: 'Søker...', type: 'info' });

    // Try Kartverket
    try {
      const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(searchQuery)}&fuzzy=true&treffPerSide=1`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const addr = data.adresser?.[0];
        if (addr?.representasjonspunkt) {
          setRouteStartLat(addr.representasjonspunkt.lat.toFixed(7));
          setRouteStartLng(addr.representasjonspunkt.lon.toFixed(7));
          setGeocodeStatus({
            text: `Funnet: ${addr.adressetekst || searchQuery}`,
            type: 'success',
          });
          return;
        }
      }
    } catch {
      /* fall through */
    }

    // Fallback to backend proxy
    try {
      await ensureBackendCsrf();
      const res = await fetch('/api/app/geocode/forward', {
        method: 'POST',
        headers: backendCsrfHeaders(),
        credentials: 'include',
        body: JSON.stringify({ query: searchQuery, limit: 1 }),
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      const results = data?.data?.suggestions || [];
      if (results.length > 0) {
        const s = results[0];
        setRouteStartLat(s.lat.toFixed(7));
        setRouteStartLng(s.lng.toFixed(7));
        setGeocodeStatus({
          text: `Funnet: ${s.adresse}, ${s.postnummer} ${s.poststed}`,
          type: 'success',
        });
      } else {
        setGeocodeStatus({
          text: 'Fant ingen resultater. Prøv en annen adresse eller fyll inn koordinater manuelt.',
          type: 'warning',
        });
      }
    } catch {
      setGeocodeStatus({
        text: 'Feil ved oppslag. Prøv igjen eller fyll inn koordinater manuelt.',
        type: 'error',
      });
    }
  }

  // ---- Industry ----
  async function loadIndustries() {
    if (industriesLoaded) return;
    try {
      const response = await fetch('/api/industries');
      const data = await response.json();
      if (!response.ok || !data.industries) {
        throw new Error('Kunne ikke laste bransjer');
      }
      setIndustries(data.industries);
      setIndustriesLoaded(true);
    } catch {
      setIndustries([]);
    }
  }

  async function handleSaveIndustry() {
    if (!selectedIndustryId || selectedIndustryId === originalIndustryId) return;
    if (
      !confirm(
        'Er du sikker på at du vil endre bransje? Dette vil oppdatere tilgjengelige tjenesttyper i appen.'
      )
    )
      return;

    setSavingIndustry(true);
    try {
      const res = await fetch('/api/dashboard/organization', {
        method: 'PUT',
        headers: csrfHeaders(),
        body: JSON.stringify({
          industry_template_id: parseInt(selectedIndustryId),
        }),
      });
      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || 'Kunne ikke oppdatere bransje');
      }
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Kunne ikke oppdatere bransje');
      setSavingIndustry(false);
    }
  }

  // ---- Logo upload ----
  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview immediately
    const reader = new FileReader();
    reader.onload = (ev) => {
      setLogoPreviewUrl(ev.target?.result as string);
    };
    reader.readAsDataURL(file);

    setUploading(true);
    setUploadStatus('idle');

    const formData = new FormData();
    formData.append('logo', file);

    try {
      const res = await fetch('/api/dashboard/organization/upload-logo', {
        method: 'POST',
        body: formData,
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Opplasting feilet');

      setLogoUrl(result.logo_url);
      setUploadStatus('success');
      setTimeout(() => setUploadStatus('idle'), 3000);
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      setUploadErrorMsg(
        err instanceof Error ? err.message : 'Opplasting feilet'
      );
      setUploadStatus('error');
      setLogoPreviewUrl(null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRemoveLogo() {
    if (!confirm('Er du sikker på at du vil fjerne logoen?')) return;
    try {
      const res = await fetch('/api/dashboard/organization/upload-logo', {
        method: 'DELETE',
      });
      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || 'Kunne ikke fjerne logo');
      }
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Kunne ikke fjerne logo');
    }
  }

  // ---- Form submit ----
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveStatus('idle');

    const data: Record<string, string | number | null> = {
      navn,
      dato_modus: datoModus || 'full_date',
      company_address: companyAddress || null,
      company_postnummer: companyPostnummer || null,
      company_poststed: companyPoststed || null,
      route_start_lat: routeStartLat ? parseFloat(routeStartLat) : null,
      route_start_lng: routeStartLng ? parseFloat(routeStartLng) : null,
    };

    try {
      const res = await fetch('/api/dashboard/organization', {
        method: 'PUT',
        headers: csrfHeaders(),
        body: JSON.stringify(data),
      });
      const result = await res.json();

      if (!res.ok) {
        setSaveErrorMsg(result.error || 'Kunne ikke lagre endringer');
        setSaveStatus('error');
        return;
      }

      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveErrorMsg('Nettverksfeil. Prøv igjen.');
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }

  // ---- Delete org ----
  function handleDeleteOrg() {
    alert(
      'For å slette organisasjonen, vennligst kontakt support på support@skyplanner.no'
    );
  }

  const geocodeStatusColor =
    geocodeStatus?.type === 'success'
      ? 'text-green-400'
      : geocodeStatus?.type === 'warning'
        ? 'text-amber-400'
        : geocodeStatus?.type === 'error'
          ? 'text-red-400'
          : 'text-dark-400';

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* General Settings */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-6">Generelt</h2>
          <div className="space-y-6">
            <div>
              <label className="input-label" htmlFor="org-navn">
                Organisasjonsnavn *
              </label>
              <input
                type="text"
                id="org-navn"
                value={navn}
                onChange={(e) => setNavn(e.target.value)}
                className="input max-w-md"
                required
                maxLength={100}
                disabled={!isAdmin}
              />
              <p className="text-xs text-dark-400 mt-1">
                Dette vises i appen og på fakturaer.
              </p>
            </div>
            <div>
              <label className="input-label">URL-slug</label>
              <div className="flex items-center gap-2 max-w-md">
                <span className="text-dark-400">skyplanner.no/</span>
                <input
                  type="text"
                  value={organization.slug}
                  className="input flex-1 bg-dark-700/30"
                  disabled
                />
              </div>
              <p className="text-xs text-dark-400 mt-1">
                URL-slug kan ikke endres.
              </p>
            </div>
          </div>
        </div>

        {/* Company Address Settings */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-6">
            Kontoradresse
          </h2>
          <p className="text-dark-400 text-sm mb-4">
            Adressen brukes som hjemikon på kartet og startpunkt for
            ruteplanlegging.
          </p>
          <div className="space-y-4">
            <div className="relative">
              <label className="input-label" htmlFor="company-address">
                Adresse
              </label>
              <input
                ref={addressInputRef}
                type="text"
                id="company-address"
                value={companyAddress}
                onChange={(e) => handleAddressInput(e.target.value)}
                onKeyDown={handleAddressKeyDown}
                className="input max-w-md"
                maxLength={200}
                placeholder="Begynn å skrive for å søke..."
                disabled={!isAdmin}
                autoComplete="off"
              />
              {showSuggestions && (
                <div
                  ref={suggestionsRef}
                  className="absolute top-full left-0 z-[9999] w-full max-w-md mt-1 rounded-xl border border-dark-700 bg-dark-900 shadow-2xl overflow-hidden"
                >
                  {suggestions.length === 0 ? (
                    <div className="p-3 text-center text-dark-400 text-sm">
                      Søker...
                    </div>
                  ) : (
                    suggestions.map((s, i) => {
                      const sub = [s.postnummer, s.poststed, s.kommune]
                        .filter(Boolean)
                        .join(', ');
                      return (
                        <button
                          key={i}
                          type="button"
                          className={`block w-full text-left px-4 py-2.5 border-b border-dark-700/50 transition-colors ${
                            i === activeSuggestionIndex
                              ? 'bg-dark-800'
                              : 'hover:bg-dark-800'
                          }`}
                          onClick={() => selectSuggestion(s)}
                          onMouseEnter={() => setActiveSuggestionIndex(i)}
                        >
                          <div className="text-sm text-dark-200">
                            {s.adresse}
                          </div>
                          {sub && (
                            <div className="text-xs text-dark-400 mt-0.5">
                              {sub}
                            </div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div>
                <label className="input-label" htmlFor="company-postnummer">
                  Postnummer
                </label>
                <input
                  type="text"
                  id="company-postnummer"
                  value={companyPostnummer}
                  onChange={(e) => setCompanyPostnummer(e.target.value)}
                  className="input"
                  maxLength={10}
                  placeholder="0001"
                  disabled={!isAdmin}
                />
              </div>
              <div>
                <label className="input-label" htmlFor="company-poststed">
                  Poststed
                </label>
                <input
                  type="text"
                  id="company-poststed"
                  value={companyPoststed}
                  onChange={(e) => setCompanyPoststed(e.target.value)}
                  className="input"
                  maxLength={100}
                  placeholder="Oslo"
                  disabled={!isAdmin}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center gap-3 mb-2">
                <label className="input-label mb-0">Koordinater</label>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleGeocode}
                    className="text-primary-400 hover:text-primary-300 text-xs font-medium"
                  >
                    Slå opp fra adresse
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 max-w-md">
                <div>
                  <label
                    className="text-xs text-dark-500"
                    htmlFor="route-start-lat"
                  >
                    Breddegrad (lat)
                  </label>
                  <input
                    type="number"
                    id="route-start-lat"
                    value={routeStartLat}
                    onChange={(e) => setRouteStartLat(e.target.value)}
                    className="input"
                    step="any"
                    min={-90}
                    max={90}
                    placeholder="59.9139"
                    disabled={!isAdmin}
                  />
                </div>
                <div>
                  <label
                    className="text-xs text-dark-500"
                    htmlFor="route-start-lng"
                  >
                    Lengdegrad (lng)
                  </label>
                  <input
                    type="number"
                    id="route-start-lng"
                    value={routeStartLng}
                    onChange={(e) => setRouteStartLng(e.target.value)}
                    className="input"
                    step="any"
                    min={-180}
                    max={180}
                    placeholder="10.7522"
                    disabled={!isAdmin}
                  />
                </div>
              </div>
              {geocodeStatus && (
                <p className={`text-xs mt-1 ${geocodeStatusColor}`}>
                  {geocodeStatus.text}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Industry Settings */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-6">Bransje</h2>
          <div className="space-y-4">
            {currentIndustry && !showIndustrySelector ? (
              <div className="flex items-center gap-4 p-4 rounded-xl border border-dark-600 bg-dark-800/50">
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center text-lg"
                  style={{
                    background: `${currentIndustry.color}20`,
                    color: currentIndustry.color,
                  }}
                >
                  <i className={`fas ${currentIndustry.icon}`}></i>
                </div>
                <div className="flex-1">
                  <p className="font-medium text-white">
                    {currentIndustry.name}
                  </p>
                  {currentIndustry.description && (
                    <p className="text-sm text-dark-400">
                      {currentIndustry.description}
                    </p>
                  )}
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={async () => {
                      setShowIndustrySelector(true);
                      await loadIndustries();
                    }}
                    className="text-primary-400 hover:text-primary-300 text-sm font-medium"
                  >
                    Endre bransje
                  </button>
                )}
              </div>
            ) : !showIndustrySelector ? (
              <div className="text-dark-400">Ingen bransje valgt</div>
            ) : null}

            {showIndustrySelector && (
              <div>
                <p className="text-sm text-amber-400 mb-3">
                  Endring av bransje vil oppdatere tilgjengelige tjenesttyper og
                  ikoner i appen.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-72 overflow-y-auto pr-1">
                  {!industriesLoaded ? (
                    <div className="col-span-full text-center text-dark-400 py-4">
                      Laster bransjer...
                    </div>
                  ) : industries.length === 0 ? (
                    <div className="col-span-full text-center text-red-400 py-4">
                      Kunne ikke laste bransjer.
                    </div>
                  ) : (
                    industries.map((industry) => (
                      <button
                        key={industry.id}
                        type="button"
                        className={`p-3 rounded-xl border transition-all text-left ${
                          industry.id.toString() === selectedIndustryId
                            ? 'border-primary-500 bg-primary-500/10'
                            : 'border-dark-600 hover:border-dark-500'
                        }`}
                        onClick={() =>
                          setSelectedIndustryId(industry.id.toString())
                        }
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                            style={{
                              background: `${industry.color}20`,
                              color: industry.color,
                            }}
                          >
                            <i className={`fas ${industry.icon}`}></i>
                          </span>
                          <span className="font-medium text-white text-sm">
                            {industry.name}
                          </span>
                        </div>
                        {industry.description && (
                          <p className="text-xs text-dark-400 line-clamp-2">
                            {industry.description}
                          </p>
                        )}
                      </button>
                    ))
                  )}
                </div>
                <div className="flex items-center gap-3 mt-4">
                  <button
                    type="button"
                    onClick={handleSaveIndustry}
                    className="btn-primary"
                    disabled={
                      savingIndustry ||
                      selectedIndustryId === originalIndustryId
                    }
                  >
                    {savingIndustry ? 'Lagrer...' : 'Lagre bransje'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowIndustrySelector(false);
                      setSelectedIndustryId(originalIndustryId);
                    }}
                    className="btn-secondary"
                  >
                    Avbryt
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Date Format Settings */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-6">Datoformat</h2>
          <p className="text-dark-400 text-sm mb-4">
            Velg hvordan kontrolldatoer vises i appen.
          </p>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="dato_modus"
                value="full_date"
                checked={datoModus !== 'month_year'}
                onChange={() => setDatoModus('full_date')}
                className="text-primary-500"
                disabled={!isAdmin}
              />
              <div>
                <span className="text-white font-medium">Full dato</span>
                <span className="text-dark-400 text-sm block">
                  Viser &quot;1. mars 2025&quot;
                </span>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="dato_modus"
                value="month_year"
                checked={datoModus === 'month_year'}
                onChange={() => setDatoModus('month_year')}
                className="text-primary-500"
                disabled={!isAdmin}
              />
              <div>
                <span className="text-white font-medium">
                  Kun måned og år
                </span>
                <span className="text-dark-400 text-sm block">
                  Viser &quot;mars 2025&quot; (uten dagsnummer)
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Branding Settings */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-6">Branding</h2>
          <div className="space-y-6">
            {/* Logo Upload */}
            <div>
              <label className="input-label">Logo</label>
              <div className="flex items-start gap-6">
                {/* Current Logo Preview */}
                <div className="flex-shrink-0">
                  {logoPreviewUrl ? (
                    <img
                      src={logoPreviewUrl}
                      alt="Logo forhåndsvisning"
                      className="w-24 h-24 rounded-xl object-cover bg-dark-700 border border-dark-600"
                    />
                  ) : logoUrl ? (
                    <img
                      src={logoUrl}
                      alt="Logo"
                      className="w-24 h-24 rounded-xl object-cover bg-dark-700 border border-dark-600"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-xl bg-dark-700 border border-dark-600 flex items-center justify-center">
                      <svg
                        className="w-10 h-10 text-dark-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Upload Controls */}
                {isAdmin ? (
                  <div className="flex-1">
                    <div className="flex flex-col gap-3">
                      <label className="btn-secondary cursor-pointer inline-flex items-center justify-center max-w-xs">
                        <svg
                          className="w-5 h-5 mr-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                          />
                        </svg>
                        <span>
                          {uploading ? 'Laster opp...' : 'Last opp logo'}
                        </span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/svg+xml,image/webp"
                          className="hidden"
                          onChange={handleLogoUpload}
                        />
                      </label>
                      {(logoUrl || organization.logo_url) && (
                        <button
                          type="button"
                          onClick={handleRemoveLogo}
                          className="text-red-400 hover:text-red-300 text-sm font-medium text-left"
                        >
                          Fjern logo
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-dark-400 mt-3">
                      PNG, JPG, SVG eller WebP. Maks 2MB.
                    </p>
                    <p className="text-xs text-dark-400">
                      Anbefalt størrelse: 200x200px eller større.
                    </p>
                    {uploadStatus === 'success' && (
                      <p className="text-green-400 text-sm mt-2">
                        Logo lastet opp!
                      </p>
                    )}
                    {uploadStatus === 'error' && (
                      <p className="text-red-400 text-sm mt-2">
                        {uploadErrorMsg}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex-1">
                    <p className="text-dark-400 text-sm">
                      Kun administratorer kan endre logo.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Plan Info (Read-only) - hidden for enterprise lifetime */}
        {!isFullMode && (
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-white mb-6">
              Abonnement
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-dark-400 mb-1">Plan</p>
                <p className="text-white font-medium capitalize">
                  {organization.plan_type}
                </p>
              </div>
              <div>
                <p className="text-sm text-dark-400 mb-1">Maks brukere</p>
                <p className="text-white font-medium">
                  {organization.max_brukere}
                </p>
              </div>
              <div>
                <p className="text-sm text-dark-400 mb-1">Maks kunder</p>
                <p className="text-white font-medium">
                  {organization.max_kunder}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-dark-700/50">
              <Link
                href="/dashboard/abonnement"
                className="text-primary-400 hover:text-primary-300 text-sm font-medium"
              >
                Administrer abonnement &rarr;
              </Link>
            </div>
          </div>
        )}

        {/* Form Actions */}
        {isAdmin ? (
          <div className="flex items-center gap-4">
            <button
              type="submit"
              className="btn-primary"
              disabled={saving}
            >
              {saving ? 'Lagrer...' : 'Lagre endringer'}
            </button>
            {saveStatus === 'success' && (
              <span className="text-green-400 text-sm">
                Endringer lagret!
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-red-400 text-sm">{saveErrorMsg}</span>
            )}
          </div>
        ) : (
          <div className="glass-card p-4 border border-yellow-500/30">
            <p className="text-dark-400 text-sm">
              Kun administratorer kan endre innstillinger. Kontakt en
              administrator for å gjøre endringer.
            </p>
          </div>
        )}
      </form>

      {/* Danger Zone (admin only) */}
      {isAdmin && (
        <div className="mt-12">
          <h2 className="text-lg font-semibold text-red-400 mb-4">
            Faresone
          </h2>
          <div className="glass-card p-6 border-red-500/30">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-white font-medium">
                  Slett organisasjon
                </h3>
                <p className="text-sm text-dark-400">
                  Permanent sletting av organisasjonen og alle data. Denne
                  handlingen kan ikke angres.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDeleteOrg}
                className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl hover:bg-red-500/20 hover:border-red-500/50 transition-colors text-sm font-medium"
              >
                Slett organisasjon
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

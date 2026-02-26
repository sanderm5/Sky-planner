'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { getCsrfToken } from '@/lib/csrf';

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: string;
  isConnected: boolean;
  lastSyncAt: string | null;
  authType: string;
}

interface PreviewCustomer {
  externalId: string;
  navn: string;
  adresse: string;
  poststed: string;
  prosjektnummer: string;
  kategorier: string[];
  kundenummer: string;
  orgNummer: string;
  beskrivelse: string;
  fakturaEpost: string;
  alreadyImported: boolean;
  isInactive: boolean;
}

interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

interface IntegrasjonsManagerProps {
  isAdmin: boolean;
}

type ModalType =
  | 'none'
  | 'tripletex'
  | 'fiken'
  | 'sync'
  | 'preview';

type SyncState = 'loading' | 'result' | 'error';
type PreviewState = 'loading' | 'content' | 'error';

const iconMap: Record<string, React.ReactNode> = {
  'fa-calculator': (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  'fa-cloud': (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
    </svg>
  ),
  'fa-receipt': (
    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
};

export function IntegrasjonsManager({ isAdmin }: IntegrasjonsManagerProps) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>('none');
  const [currentIntegration, setCurrentIntegration] = useState<string | null>(null);

  // Connect form state
  const [connectError, setConnectError] = useState('');

  // Sync state
  const [syncState, setSyncState] = useState<SyncState>('loading');
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState('');

  // Preview state
  const [previewState, setPreviewState] = useState<PreviewState>('loading');
  const [previewCustomers, setPreviewCustomers] = useState<PreviewCustomer[]>([]);
  const [selectedExternalIds, setSelectedExternalIds] = useState<Set<string>>(new Set());
  const [previewSummary, setPreviewSummary] = useState('');
  const [previewSearch, setPreviewSearch] = useState('');
  const [previewCategoryFilter, setPreviewCategoryFilter] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [allCategories, setAllCategories] = useState<string[]>([]);

  // Import options
  const [showImportOptions, setShowImportOptions] = useState(false);
  const [importKategori, setImportKategori] = useState('');
  const [importAutoCategories, setImportAutoCategories] = useState(true);
  const [importKundenummer, setImportKundenummer] = useState(true);
  const [importDescription, setImportDescription] = useState(true);
  const [importFakturaepost, setImportFakturaepost] = useState(true);

  // ---- Modal helpers ----
  function openModal(type: ModalType) {
    setActiveModal(type);
    document.body.classList.add('overflow-hidden');
  }

  function closeModal() {
    setActiveModal('none');
    document.body.classList.remove('overflow-hidden');
    setConnectError('');
  }

  // Escape key handler
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape' && activeModal !== 'none') {
        closeModal();
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [activeModal]);

  // ---- Load integrations ----
  const loadIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/app/integrations', {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        setIntegrations(data.data);
        setLoadError(false);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  // ---- Actions ----
  async function handleConnect(id: string, authType: string) {
    setCurrentIntegration(id);
    if (authType === 'oauth2') {
      try {
        const redirectUri = `${window.location.origin}/dashboard/innstillinger/oauth-callback`;
        const res = await fetch(
          `/api/app/integrations/${id}/oauth/authorize?redirectUri=${encodeURIComponent(redirectUri)}`,
          { credentials: 'include' }
        );
        const data = await res.json();
        if (data.success) {
          sessionStorage.setItem('oauth_state', data.data.state);
          window.location.href = data.data.authorizationUrl;
        }
      } catch {
        alert('Kunne ikke starte tilkobling. Prøv igjen.');
      }
    } else {
      openModal(id as ModalType);
    }
  }

  async function connectWithCredentials(
    id: string,
    credentials: Record<string, any>
  ) {
    try {
      const res = await fetch(`/api/app/integrations/${id}/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
        body: JSON.stringify(credentials),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error?.message || data.message || 'Tilkobling feilet'
        );
      }
      closeModal();
      await loadIntegrations();
      if (confirm('Tilkobling vellykket! Vil du hente og importere kunder nå?')) {
        await runPreview(id);
      }
    } catch (err: any) {
      setConnectError(err.message);
    }
  }

  async function handleDisconnect(id: string) {
    if (!confirm('Er du sikker på at du vil koble fra denne integrasjonen?'))
      return;
    try {
      const res = await fetch(`/api/app/integrations/${id}/disconnect`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': getCsrfToken() },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Kunne ikke koble fra');
      await loadIntegrations();
    } catch (err: any) {
      alert(err.message);
    }
  }

  // ---- Preview ----
  async function runPreview(id: string) {
    setCurrentIntegration(id);
    openModal('preview');
    setPreviewState('loading');
    setPreviewSearch('');
    setPreviewCategoryFilter('');
    setShowImportOptions(false);

    try {
      const res = await fetch(`/api/app/integrations/${id}/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error?.message || data.message || 'Henting feilet');

      const customers: PreviewCustomer[] = data.data.customers;
      setPreviewCustomers(customers);

      // Default: select all NOT already imported and NOT inactive
      const defaultSelected = new Set(
        customers
          .filter((c) => !c.alreadyImported && !c.isInactive)
          .map((c) => c.externalId)
      );
      setSelectedExternalIds(defaultSelected);

      const alreadyCount = data.data.alreadyImportedCount;
      const inactiveCount = customers.filter((c) => c.isInactive).length;
      const summaryParts = [`${data.data.totalCount} kunder funnet`];
      if (alreadyCount > 0) summaryParts.push(`${alreadyCount} allerede importert`);
      if (inactiveCount > 0) summaryParts.push(`${inactiveCount} inaktive`);
      setPreviewSummary(summaryParts.join(', '));

      // Populate categories
      const allCats = new Set<string>();
      customers.forEach((c) =>
        (c.kategorier || []).forEach((cat) => allCats.add(cat))
      );
      setAllCategories([...allCats].sort());

      setPreviewState('content');
    } catch (err: any) {
      setPreviewError(err.message);
      setPreviewState('error');
    }
  }

  // ---- Sync ----
  async function runSyncWithSelection(
    id: string,
    selectedIds: string[],
    importOptions: Record<string, any>
  ) {
    openModal('sync');
    setSyncState('loading');

    try {
      const res = await fetch(`/api/app/integrations/${id}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
        body: JSON.stringify({
          fullSync: true,
          selectedExternalIds: selectedIds,
          importOptions,
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.error?.message || data.message || 'Synkronisering feilet'
        );

      setSyncResult(data.data);
      setSyncState('result');
      await loadIntegrations();
    } catch (err: any) {
      setSyncError(err.message);
      setSyncState('error');
    }
  }

  function handleImportSelected() {
    if (selectedExternalIds.size === 0 || !currentIntegration) return;
    closeModal();
    runSyncWithSelection(currentIntegration, Array.from(selectedExternalIds), {
      kategori: importKategori,
      autoMapCategories: importAutoCategories,
      importDescription: importDescription,
      importCustomerNumber: importKundenummer,
      importInvoiceEmail: importFakturaepost,
    });
  }

  // ---- Filtered preview customers ----
  function getFilteredCustomers(): PreviewCustomer[] {
    let filtered = previewCustomers;
    if (previewCategoryFilter) {
      filtered = filtered.filter((c) =>
        (c.kategorier || []).includes(previewCategoryFilter)
      );
    }
    if (previewSearch) {
      const q = previewSearch.toLowerCase().trim();
      filtered = filtered.filter(
        (c) =>
          (c.navn || '').toLowerCase().includes(q) ||
          (c.adresse || '').toLowerCase().includes(q) ||
          (c.poststed || '').toLowerCase().includes(q) ||
          (c.prosjektnummer || '').toLowerCase().includes(q) ||
          (c.kategorier || []).join(' ').toLowerCase().includes(q) ||
          (c.kundenummer || '').toLowerCase().includes(q) ||
          (c.beskrivelse || '').toLowerCase().includes(q)
      );
    }
    return filtered;
  }

  function toggleCustomer(externalId: string, checked: boolean) {
    setSelectedExternalIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(externalId);
      } else {
        next.delete(externalId);
      }
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedExternalIds(
        new Set(previewCustomers.map((c) => c.externalId))
      );
    } else {
      setSelectedExternalIds(new Set());
    }
  }

  // ---- Connect form handlers ----
  function handleTripletexSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    connectWithCredentials('tripletex', {
      metadata: { employeeToken: formData.get('employeeToken') },
    });
  }

  function handleFikenSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    connectWithCredentials('fiken', {
      apiKey: formData.get('apiKey'),
    });
  }

  // ---- Render ----
  if (loading) {
    return (
      <>
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-2">
            Regnskapsintegrasjoner
          </h2>
          <p className="text-dark-400 text-sm">
            Koble SkyPlanner til ditt regnskapssystem for automatisk
            synkronisering av kunder.
          </p>
        </div>
        <div className="glass-card p-8 text-center">
          <svg
            className="w-8 h-8 text-primary-400 animate-spin mx-auto mb-4"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <p className="text-dark-400">Laster integrasjoner...</p>
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white mb-2">
            Regnskapsintegrasjoner
          </h2>
        </div>
        <div className="glass-card p-8 text-center border border-red-500/30">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">
            Kunne ikke laste integrasjoner
          </h3>
          <p className="text-dark-400 mb-4">
            Sjekk at du er logget inn og prøv igjen.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="btn-secondary"
          >
            Last inn på nytt
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white mb-2">
          Regnskapsintegrasjoner
        </h2>
        <p className="text-dark-400 text-sm">
          Koble SkyPlanner til ditt regnskapssystem for automatisk
          synkronisering av kunder.
        </p>
      </div>

      {/* Integration Cards */}
      <div className="space-y-6">
        {integrations.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-dark-700/50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">
              Ingen integrasjoner tilgjengelig
            </h3>
            <p className="text-dark-400">
              Kontakt support for å aktivere integrasjoner.
            </p>
          </div>
        ) : (
          integrations.map((integration) => (
            <div key={integration.id} className="glass-card p-6">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-xl bg-dark-700/50 flex items-center justify-center text-primary-400 flex-shrink-0">
                    {iconMap[integration.icon] || iconMap['fa-cloud']}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">
                      {integration.name}
                    </h3>
                    <p className="text-dark-400 text-sm mb-3">
                      {integration.description}
                    </p>
                    {integration.isConnected ? (
                      <div className="flex items-center gap-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5" />
                          Tilkoblet
                        </span>
                        {integration.lastSyncAt && (
                          <span className="text-xs text-dark-400">
                            Sist synkronisert:{' '}
                            {new Date(integration.lastSyncAt).toLocaleDateString(
                              'nb-NO',
                              {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              }
                            )}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-dark-600/50 text-dark-400">
                        Ikke tilkoblet
                      </span>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-2">
                    {integration.isConnected ? (
                      <>
                        <button
                          className="btn-secondary text-sm"
                          onClick={() => runPreview(integration.id)}
                        >
                          Synkroniser
                        </button>
                        <button
                          className="btn-ghost text-sm text-red-400 hover:text-red-300"
                          onClick={() => handleDisconnect(integration.id)}
                        >
                          Koble fra
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn-primary text-sm"
                        onClick={() =>
                          handleConnect(integration.id, integration.authType)
                        }
                      >
                        Koble til
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Connect Modal: Tripletex */}
      {activeModal === 'tripletex' && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-md p-6 relative">
              <button
                onClick={closeModal}
                className="absolute top-4 right-4 text-dark-400 hover:text-white transition-colors"
                aria-label="Lukk"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <h2 className="text-xl font-bold text-white mb-2">
                Koble til Tripletex
              </h2>
              <p className="text-dark-400 text-sm mb-6">
                Du finner Employee Token i Tripletex under Innstillinger &rarr;
                API-tilgang.
              </p>
              <form onSubmit={handleTripletexSubmit} className="space-y-4">
                <div>
                  <label className="input-label" htmlFor="tripletex-employee">
                    Employee Token *
                  </label>
                  <input
                    type="text"
                    id="tripletex-employee"
                    name="employeeToken"
                    className="input w-full"
                    placeholder="Din personlige Employee Token..."
                    required
                  />
                </div>
                {connectError && (
                  <div className="text-red-400 text-sm" role="alert">
                    {connectError}
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="btn-secondary flex-1"
                  >
                    Avbryt
                  </button>
                  <button type="submit" className="btn-primary flex-1">
                    Koble til
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Connect Modal: Fiken */}
      {activeModal === 'fiken' && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-md p-6 relative">
              <button
                onClick={closeModal}
                className="absolute top-4 right-4 text-dark-400 hover:text-white transition-colors"
                aria-label="Lukk"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <h2 className="text-xl font-bold text-white mb-2">
                Koble til Fiken
              </h2>
              <p className="text-dark-400 text-sm mb-6">
                Du finner API-nøkkel i Fiken under Innstillinger &rarr;
                Integrasjoner &rarr; API-nøkler.
              </p>
              <form onSubmit={handleFikenSubmit} className="space-y-4">
                <div>
                  <label className="input-label" htmlFor="fiken-apikey">
                    API-nøkkel *
                  </label>
                  <input
                    type="text"
                    id="fiken-apikey"
                    name="apiKey"
                    className="input w-full"
                    placeholder="Bearer eyJ..."
                    required
                  />
                </div>
                {connectError && (
                  <div className="text-red-400 text-sm" role="alert">
                    {connectError}
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="btn-secondary flex-1"
                  >
                    Avbryt
                  </button>
                  <button type="submit" className="btn-primary flex-1">
                    Koble til
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Sync Modal */}
      {activeModal === 'sync' && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-md p-6 relative">
              <button
                onClick={closeModal}
                className="absolute top-4 right-4 text-dark-400 hover:text-white transition-colors"
                aria-label="Lukk"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {syncState === 'loading' && (
                <div className="text-center">
                  <svg
                    className="w-12 h-12 text-primary-400 animate-spin mx-auto mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <h2 className="text-xl font-bold text-white mb-2">
                    Synkroniserer...
                  </h2>
                  <p className="text-dark-400 text-sm">
                    Henter kunder fra regnskapssystemet
                  </p>
                </div>
              )}

              {syncState === 'result' && syncResult && (
                <div>
                  <div className="text-center mb-6">
                    <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">
                      Synkronisering fullført
                    </h2>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-dark-800/50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-green-400">
                        {syncResult.created}
                      </div>
                      <div className="text-sm text-dark-400">Nye kunder</div>
                    </div>
                    <div className="bg-dark-800/50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-blue-400">
                        {syncResult.updated}
                      </div>
                      <div className="text-sm text-dark-400">Oppdatert</div>
                    </div>
                    <div className="bg-dark-800/50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-dark-300">
                        {syncResult.unchanged}
                      </div>
                      <div className="text-sm text-dark-400">Uendret</div>
                    </div>
                    <div className="bg-dark-800/50 rounded-lg p-4 text-center">
                      <div className="text-2xl font-bold text-red-400">
                        {syncResult.failed}
                      </div>
                      <div className="text-sm text-dark-400">Feilet</div>
                    </div>
                  </div>
                  <button onClick={closeModal} className="btn-primary w-full">
                    Lukk
                  </button>
                </div>
              )}

              {syncState === 'error' && (
                <div className="text-center" role="alert">
                  <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">
                    Synkronisering feilet
                  </h2>
                  <p className="text-dark-400 text-sm mb-6">{syncError}</p>
                  <button onClick={closeModal} className="btn-secondary w-full">
                    Lukk
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preview/Selection Modal */}
      {activeModal === 'preview' && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeModal}
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-4xl max-h-[85vh] p-6 relative flex flex-col">
              <button
                onClick={closeModal}
                className="absolute top-4 right-4 text-dark-400 hover:text-white transition-colors z-10"
                aria-label="Lukk"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Loading state */}
              {previewState === 'loading' && (
                <div className="text-center py-12">
                  <svg
                    className="w-12 h-12 text-primary-400 animate-spin mx-auto mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <h2 className="text-xl font-bold text-white mb-2">
                    Henter kunder...
                  </h2>
                  <p className="text-dark-400 text-sm">
                    Kontakter regnskapssystemet
                  </p>
                </div>
              )}

              {/* Content state */}
              {previewState === 'content' && (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="mb-4">
                    <h2 className="text-xl font-bold text-white">
                      Velg kunder for import
                    </h2>
                    <p className="text-dark-400 text-sm mt-1">
                      {previewSummary}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 mb-4">
                    <input
                      type="text"
                      className="input flex-1"
                      placeholder="Søk etter kunde..."
                      value={previewSearch}
                      onChange={(e) => setPreviewSearch(e.target.value)}
                    />
                    <select
                      className="input text-sm w-40"
                      value={previewCategoryFilter}
                      onChange={(e) => setPreviewCategoryFilter(e.target.value)}
                    >
                      <option value="">Alle kategorier</option>
                      {allCategories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        className="rounded border-dark-600"
                        checked={
                          selectedExternalIds.size === previewCustomers.length
                        }
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                      />
                      Velg alle
                    </label>
                  </div>

                  <div className="flex-1 overflow-auto border border-dark-700 rounded-lg min-h-0">
                    <table className="w-full text-sm">
                      <thead className="bg-dark-800/50 sticky top-0 z-10">
                        <tr>
                          <th className="p-3 text-left w-10"></th>
                          <th className="p-3 text-left text-dark-300 font-medium">
                            Navn
                          </th>
                          <th className="p-3 text-left text-dark-300 font-medium hidden sm:table-cell">
                            Adresse
                          </th>
                          <th className="p-3 text-left text-dark-300 font-medium">
                            Kategori
                          </th>
                          <th className="p-3 text-left text-dark-300 font-medium hidden md:table-cell">
                            Prosjektnr
                          </th>
                          <th className="p-3 text-left text-dark-300 font-medium">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dark-700/50">
                        {getFilteredCustomers().length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="p-8 text-center text-dark-400"
                            >
                              {previewSearch
                                ? 'Ingen treff'
                                : 'Ingen kunder funnet'}
                            </td>
                          </tr>
                        ) : (
                          getFilteredCustomers().map((c) => {
                            const extraInfo: string[] = [];
                            if (c.kundenummer) extraInfo.push(`Kundenr: ${c.kundenummer}`);
                            if (c.orgNummer) extraInfo.push(`Org: ${c.orgNummer}`);
                            if (c.beskrivelse) extraInfo.push(`Beskrivelse: ${c.beskrivelse}`);
                            if (c.fakturaEpost) extraInfo.push(`Faktura-epost: ${c.fakturaEpost}`);

                            return (
                              <tr
                                key={c.externalId}
                                className="hover:bg-dark-800/30 transition-colors"
                                title={extraInfo.length > 0 ? extraInfo.join('\n') : undefined}
                              >
                                <td className="p-3">
                                  <input
                                    type="checkbox"
                                    className="preview-checkbox rounded border-dark-600"
                                    checked={selectedExternalIds.has(c.externalId)}
                                    onChange={(e) =>
                                      toggleCustomer(c.externalId, e.target.checked)
                                    }
                                  />
                                </td>
                                <td className="p-3 text-white font-medium">
                                  {c.navn}
                                  {c.kundenummer && (
                                    <span className="text-dark-500 text-xs ml-1">
                                      #{c.kundenummer}
                                    </span>
                                  )}
                                </td>
                                <td className="p-3 text-dark-300 hidden sm:table-cell">
                                  {c.adresse}
                                  {c.poststed ? `, ${c.poststed}` : ''}
                                </td>
                                <td className="p-3">
                                  {(c.kategorier || []).length > 0 ? (
                                    (c.kategorier || []).map((cat, i) => (
                                      <span
                                        key={i}
                                        className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-dark-700 text-dark-300 mr-1"
                                      >
                                        {cat}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-dark-500 text-xs">
                                      -
                                    </span>
                                  )}
                                </td>
                                <td className="p-3 text-dark-300 font-mono text-xs hidden md:table-cell">
                                  {c.prosjektnummer || '-'}
                                </td>
                                <td className="p-3">
                                  {c.isInactive ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-dark-600 text-dark-400">
                                      Inaktiv
                                    </span>
                                  ) : c.alreadyImported ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-400">
                                      Importert
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-400">
                                      Ny
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Import options */}
                  <div className="mt-4 pt-4 border-t border-dark-700">
                    <button
                      type="button"
                      onClick={() => setShowImportOptions(!showImportOptions)}
                      className="flex items-center gap-2 text-sm text-dark-300 hover:text-white transition-colors mb-3"
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${showImportOptions ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                      </svg>
                      Importinnstillinger
                    </button>
                    {showImportOptions && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-6">
                        <div>
                          <label className="block text-xs text-dark-400 mb-1">
                            Sett kategori
                          </label>
                          <select
                            className="input text-sm w-full"
                            value={importKategori}
                            onChange={(e) => setImportKategori(e.target.value)}
                          >
                            <option value="">
                              Bruk fra Tripletex (auto)
                            </option>
                            {allCategories.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-col gap-2 justify-center">
                          <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer">
                            <input
                              type="checkbox"
                              className="rounded border-dark-600"
                              checked={importAutoCategories}
                              onChange={(e) =>
                                setImportAutoCategories(e.target.checked)
                              }
                            />
                            Importer kategorier fra Tripletex
                          </label>
                          <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer">
                            <input
                              type="checkbox"
                              className="rounded border-dark-600"
                              checked={importKundenummer}
                              onChange={(e) =>
                                setImportKundenummer(e.target.checked)
                              }
                            />
                            Importer kundenummer
                          </label>
                          <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer">
                            <input
                              type="checkbox"
                              className="rounded border-dark-600"
                              checked={importDescription}
                              onChange={(e) =>
                                setImportDescription(e.target.checked)
                              }
                            />
                            Importer beskrivelse som notater
                          </label>
                          <label className="flex items-center gap-2 text-sm text-dark-300 cursor-pointer">
                            <input
                              type="checkbox"
                              className="rounded border-dark-600"
                              checked={importFakturaepost}
                              onChange={(e) =>
                                setImportFakturaepost(e.target.checked)
                              }
                            />
                            Importer faktura-epost
                          </label>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-dark-700">
                    <p className="text-sm text-dark-400">
                      {selectedExternalIds.size} av{' '}
                      {previewCustomers.length} kunder valgt
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={closeModal}
                        className="btn-secondary"
                      >
                        Avbryt
                      </button>
                      <button
                        type="button"
                        onClick={handleImportSelected}
                        className="btn-primary"
                        disabled={selectedExternalIds.size === 0}
                      >
                        Importer valgte
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Error state */}
              {previewState === 'error' && (
                <div className="text-center py-12" role="alert">
                  <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-white mb-2">
                    Kunne ikke hente kunder
                  </h2>
                  <p className="text-dark-400 text-sm mb-6">{previewError}</p>
                  <button onClick={closeModal} className="btn-secondary">
                    Lukk
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

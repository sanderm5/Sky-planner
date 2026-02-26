'use client';

import { useState, useEffect, useCallback } from 'react';
import { getCsrfToken } from '@/lib/csrf';

interface ApiKey {
  id: number;
  name: string;
  description?: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at?: string;
  created_at: string;
}

const SCOPES = [
  { id: 'customers:read', label: 'Kunder (les)', description: 'Hent kundeinformasjon' },
  { id: 'customers:write', label: 'Kunder (skriv)', description: 'Opprett, oppdater og slett kunder' },
  { id: 'routes:read', label: 'Ruter (les)', description: 'Hent ruteinformasjon' },
  { id: 'routes:write', label: 'Ruter (skriv)', description: 'Opprett og oppdater ruter' },
  { id: 'appointments:read', label: 'Avtaler (les)', description: 'Hent avtaleinformasjon' },
  { id: 'appointments:write', label: 'Avtaler (skriv)', description: 'Opprett og oppdater avtaler' },
  { id: 'webhooks:manage', label: 'Webhooks', description: 'Administrer webhook-endepunkter' },
];

interface Props {
  isAdmin: boolean;
}

export function ApiNoklerManager({ isAdmin }: Props) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createScopes, setCreateScopes] = useState<string[]>([]);
  const [createError, setCreateError] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Key created modal state
  const [showKeyCreatedModal, setShowKeyCreatedModal] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState('');
  const [copied, setCopied] = useState(false);

  const loadApiKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/app/api-keys', { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 403) {
          setError('admin_only');
        } else {
          setError('load_error');
        }
        return;
      }
      const data = await res.json();
      setApiKeys(data.data || []);
    } catch {
      setError('load_error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  // Escape key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showCreateModal) setShowCreateModal(false);
        if (showKeyCreatedModal) {
          setShowKeyCreatedModal(false);
          loadApiKeys();
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCreateModal, showKeyCreatedModal, loadApiKeys]);

  function toggleScope(scopeId: string) {
    setCreateScopes(prev =>
      prev.includes(scopeId)
        ? prev.filter(s => s !== scopeId)
        : [...prev, scopeId]
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');

    if (createScopes.length === 0) {
      setCreateError('Velg minst en tilgang');
      return;
    }

    setCreateSubmitting(true);
    try {
      const res = await fetch('/api/app/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        credentials: 'include',
        body: JSON.stringify({
          name: createName,
          description: createDescription || undefined,
          scopes: createScopes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || data.message || 'Kunne ikke opprette nøkkel');
      }

      // Close create modal, reset form
      setShowCreateModal(false);
      setCreateName('');
      setCreateDescription('');
      setCreateScopes([]);

      // Show the key
      setNewKeyValue(data.data.key);
      setShowKeyCreatedModal(true);
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function revokeKey(id: number, name: string) {
    if (!confirm(`Er du sikker på at du vil deaktivere "${name}"? Dette kan ikke angres.`)) return;

    try {
      const res = await fetch(`/api/app/api-keys/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        credentials: 'include',
        body: JSON.stringify({ reason: 'Manuelt deaktivert av bruker' }),
      });
      if (!res.ok) throw new Error('Kunne ikke deaktivere nøkkel');
      await loadApiKeys();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function copyKey() {
    if (newKeyValue) {
      await navigator.clipboard.writeText(newKeyValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">API-nøkler</h2>
          <p className="text-dark-400 text-sm">
            Administrer API-nøkler for tredjeparts-integrasjoner.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowCreateModal(true)} className="btn-primary">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Ny API-nøkkel
          </button>
        )}
      </div>

      {!isAdmin && (
        <div className="glass-card p-6 border border-yellow-500/30 mb-6">
          <div className="flex items-start gap-3">
            <svg className="w-6 h-6 text-yellow-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h3 className="font-semibold text-white mb-1">Kun for administratorer</h3>
              <p className="text-dark-400 text-sm">
                Bare administratorer kan opprette og administrere API-nøkler.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* API Keys List */}
      <div className="space-y-4">
        {loading && (
          <div className="glass-card p-8 text-center">
            <svg className="w-8 h-8 text-primary-400 animate-spin mx-auto mb-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-dark-400">Laster API-nøkler...</p>
          </div>
        )}

        {!loading && error === 'admin_only' && (
          <div className="glass-card p-8 text-center">
            <h3 className="text-lg font-semibold text-white mb-2">Kun for administratorer</h3>
            <p className="text-dark-400">Bare administratorer kan se og administrere API-nøkler.</p>
          </div>
        )}

        {!loading && error === 'load_error' && (
          <div className="glass-card p-8 text-center border border-red-500/30">
            <h3 className="text-lg font-semibold text-white mb-2">Kunne ikke laste API-nøkler</h3>
            <p className="text-dark-400 mb-4">Prøv å laste siden på nytt.</p>
            <button onClick={() => loadApiKeys()} className="btn-secondary">Last inn på nytt</button>
          </div>
        )}

        {!loading && !error && apiKeys.length === 0 && (
          <div className="glass-card p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-dark-700/50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Ingen API-nøkler</h3>
            <p className="text-dark-400 mb-4">Du har ikke opprettet noen API-nøkler ennå.</p>
            {isAdmin && (
              <button onClick={() => setShowCreateModal(true)} className="btn-primary">
                Opprett første nøkkel
              </button>
            )}
          </div>
        )}

        {!loading && !error && apiKeys.map(key => (
          <div key={key.id} className="glass-card p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-semibold text-white">{key.name}</h3>
                  {key.is_active ? (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">Aktiv</span>
                  ) : (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400">Deaktivert</span>
                  )}
                </div>
                {key.description && (
                  <p className="text-dark-400 text-sm mb-3">{key.description}</p>
                )}
                <div className="flex flex-wrap gap-2 mb-3">
                  {key.scopes.map(scope => (
                    <span key={scope} className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-dark-700/50 text-dark-300">
                      {scope}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-xs text-dark-400">
                  <span>Prefix: <code className="text-primary-400">{key.key_prefix}...</code></span>
                  {key.last_used_at && (
                    <span>Sist brukt: {new Date(key.last_used_at).toLocaleDateString('nb-NO')}</span>
                  )}
                  <span>Opprettet: {new Date(key.created_at).toLocaleDateString('nb-NO')}</span>
                </div>
              </div>
              {isAdmin && key.is_active && (
                <button
                  onClick={() => revokeKey(key.id, key.name)}
                  className="btn-ghost text-sm text-red-400 hover:text-red-300"
                >
                  Deaktiver
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="create-api-modal-title">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setShowCreateModal(false)}
                className="absolute top-4 right-4 text-dark-400 hover:text-white transition-colors"
                aria-label="Lukk"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <h2 id="create-api-modal-title" className="text-xl font-bold text-white mb-6">Opprett ny API-nøkkel</h2>

              <form onSubmit={handleCreate} className="space-y-6">
                <div>
                  <label className="input-label" htmlFor="key-name">Navn *</label>
                  <input
                    type="text"
                    id="key-name"
                    className="input w-full"
                    placeholder="F.eks. Min integrasjon"
                    value={createName}
                    onChange={e => setCreateName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label className="input-label" htmlFor="key-description">Beskrivelse</label>
                  <input
                    type="text"
                    id="key-description"
                    className="input w-full"
                    placeholder="Valgfri beskrivelse"
                    value={createDescription}
                    onChange={e => setCreateDescription(e.target.value)}
                  />
                </div>

                <div>
                  <label className="input-label">Tilganger *</label>
                  <p className="text-xs text-dark-400 mb-3">Velg hvilke tilganger denne nøkkelen skal ha.</p>
                  <div className="space-y-2">
                    {SCOPES.map(scope => (
                      <label key={scope.id} className="flex items-start gap-3 p-3 rounded-lg bg-dark-800/50 hover:bg-dark-800 cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={createScopes.includes(scope.id)}
                          onChange={() => toggleScope(scope.id)}
                          className="mt-1 rounded bg-dark-700 border-dark-600 text-primary-500 focus:ring-primary-500"
                        />
                        <div>
                          <div className="text-white text-sm font-medium">{scope.label}</div>
                          <div className="text-dark-400 text-xs">{scope.description}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {createError && (
                  <div className="text-red-400 text-sm" role="alert" aria-live="assertive">{createError}</div>
                )}

                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary flex-1">Avbryt</button>
                  <button type="submit" disabled={createSubmitting} className="btn-primary flex-1">Opprett</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Key Created Modal */}
      {showKeyCreatedModal && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="key-created-modal-title">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-lg p-6 relative">
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                </div>
                <h2 id="key-created-modal-title" className="text-xl font-bold text-white mb-2">API-nøkkel opprettet!</h2>
                <p className="text-dark-400 text-sm">Kopier nøkkelen nå - den vises kun en gang.</p>
              </div>

              <div className="bg-dark-800/50 rounded-lg p-4 mb-6">
                <label className="text-xs text-dark-400 block mb-2">Din API-nøkkel</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-primary-400 font-mono text-sm break-all">{newKeyValue}</code>
                  <button onClick={copyKey} className="btn-secondary p-2" title="Kopier" aria-label="Kopier API-nøkkel">
                    {copied ? (
                      <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="text-sm">
                    <p className="text-yellow-400 font-medium">Viktig!</p>
                    <p className="text-dark-300">Lagre denne nøkkelen et trygt sted. Du kan ikke se den igjen etter at du lukker dette vinduet.</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => { setShowKeyCreatedModal(false); loadApiKeys(); }}
                className="btn-primary w-full"
              >
                Jeg har lagret nøkkelen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

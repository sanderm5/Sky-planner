'use client';

import { useState, useEffect, useCallback } from 'react';
import { getCsrfToken } from '@/lib/csrf';

interface Webhook {
  id: string;
  name: string;
  url: string;
  description: string;
  events: string[];
  is_active: boolean;
  failure_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
}

interface Delivery {
  id: string;
  event_type: string;
  status: 'delivered' | 'failed' | 'pending' | 'retrying';
  response_status: number | null;
  response_time_ms: number | null;
  attempt_count: number;
  error_message: string | null;
  created_at: string;
}

interface EventType {
  id: string;
  label: string;
  category: string;
}

interface WebhooksManagerProps {
  isAdmin: boolean;
}

const eventTypes: EventType[] = [
  { id: 'customer.created', label: 'Kunde opprettet', category: 'Kunder' },
  { id: 'customer.updated', label: 'Kunde oppdatert', category: 'Kunder' },
  { id: 'customer.deleted', label: 'Kunde slettet', category: 'Kunder' },
  { id: 'route.created', label: 'Rute opprettet', category: 'Ruter' },
  { id: 'route.completed', label: 'Rute fullført', category: 'Ruter' },
  {
    id: 'appointment.created',
    label: 'Avtale opprettet',
    category: 'Avtaler',
  },
  {
    id: 'appointment.completed',
    label: 'Avtale fullført',
    category: 'Avtaler',
  },
  {
    id: 'sync.completed',
    label: 'Synkronisering fullført',
    category: 'Integrasjoner',
  },
  {
    id: 'sync.failed',
    label: 'Synkronisering feilet',
    category: 'Integrasjoner',
  },
];

// Group by category
const eventsByCategory: Record<string, EventType[]> = eventTypes.reduce(
  (acc, event) => {
    if (!acc[event.category]) acc[event.category] = [];
    acc[event.category].push(event);
    return acc;
  },
  {} as Record<string, EventType[]>
);

export function WebhooksManager({ isAdmin }: WebhooksManagerProps) {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // Webhook created modal state
  const [showCreatedModal, setShowCreatedModal] = useState(false);
  const [newWebhookSecret, setNewWebhookSecret] = useState('');
  const [secretCopied, setSecretCopied] = useState(false);

  // Deliveries modal state
  const [showDeliveriesModal, setShowDeliveriesModal] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);

  // Form state for create
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formEvents, setFormEvents] = useState<Set<string>>(new Set());

  // ---- Modal helpers ----
  function openModal(setter: (v: boolean) => void) {
    setter(true);
    document.body.classList.add('overflow-hidden');
  }

  function closeModal(setter: (v: boolean) => void) {
    setter(false);
    document.body.classList.remove('overflow-hidden');
  }

  // Escape key handler
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showCreateModal) closeModal(setShowCreateModal);
        if (showCreatedModal) {
          closeModal(setShowCreatedModal);
          loadWebhooks();
        }
        if (showDeliveriesModal) closeModal(setShowDeliveriesModal);
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [showCreateModal, showCreatedModal, showDeliveriesModal]);

  // ---- Load webhooks ----
  const loadWebhooks = useCallback(async () => {
    try {
      const res = await fetch('/api/app/webhooks', {
        credentials: 'include',
      });

      if (!res.ok) {
        if (res.status === 403) {
          setLoadError('forbidden');
        } else {
          setLoadError('error');
        }
        return;
      }

      const data = await res.json();
      setWebhooks(data.data || []);
      setLoadError(null);
    } catch {
      setLoadError('error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWebhooks();
  }, [loadWebhooks]);

  // ---- Create webhook ----
  async function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');

    if (formEvents.size === 0) {
      setCreateError('Velg minst en hendelse');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/app/webhooks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        credentials: 'include',
        body: JSON.stringify({
          name: formName,
          url: formUrl,
          description: formDescription || undefined,
          events: Array.from(formEvents),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error?.message || data.message || 'Kunne ikke opprette webhook'
        );
      }

      closeModal(setShowCreateModal);
      resetForm();

      // Show the secret
      setNewWebhookSecret(data.data.secret);
      openModal(setShowCreatedModal);
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function resetForm() {
    setFormName('');
    setFormUrl('');
    setFormDescription('');
    setFormEvents(new Set());
    setCreateError('');
  }

  // ---- Delete webhook ----
  async function deleteWebhook(id: string, name: string) {
    if (!confirm(`Er du sikker på at du vil slette "${name}"?`)) return;
    try {
      const res = await fetch(`/api/app/webhooks/${id}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': getCsrfToken() },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Kunne ikke slette webhook');
      await loadWebhooks();
    } catch (err: any) {
      alert(err.message);
    }
  }

  // ---- Show deliveries ----
  async function showDeliveries(id: string) {
    openModal(setShowDeliveriesModal);
    setDeliveriesLoading(true);
    setDeliveries([]);

    try {
      const res = await fetch(`/api/app/webhooks/${id}/deliveries?limit=20`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (!data.success || data.data.length === 0) {
        setDeliveries([]);
      } else {
        setDeliveries(data.data);
      }
    } catch {
      setDeliveries([]);
    } finally {
      setDeliveriesLoading(false);
    }
  }

  // ---- Copy secret ----
  async function handleCopySecret() {
    if (newWebhookSecret) {
      await navigator.clipboard.writeText(newWebhookSecret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    }
  }

  // ---- Toggle event ----
  function toggleEvent(eventId: string) {
    setFormEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  // ---- Delivery status helpers ----
  function deliveryStatusLabel(status: string): string {
    switch (status) {
      case 'delivered':
        return 'Levert';
      case 'failed':
        return 'Feilet';
      case 'pending':
        return 'Venter';
      default:
        return 'Forsøker på nytt';
    }
  }

  function deliveryStatusColor(status: string): string {
    switch (status) {
      case 'delivered':
        return 'text-green-400';
      case 'failed':
        return 'text-red-400';
      case 'pending':
        return 'text-yellow-400';
      default:
        return 'text-yellow-400';
    }
  }

  // ---- Render ----
  if (loading) {
    return (
      <>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">
              Webhooks
            </h2>
            <p className="text-dark-400 text-sm">
              Motta varsler når hendelser skjer i SkyPlanner.
            </p>
          </div>
        </div>
        <div className="glass-card p-8 text-center">
          <svg
            className="w-8 h-8 text-primary-400 animate-spin mx-auto mb-4"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-dark-400">Laster webhooks...</p>
        </div>
      </>
    );
  }

  if (loadError === 'forbidden') {
    return (
      <div className="glass-card p-8 text-center">
        <h3 className="text-lg font-semibold text-white mb-2">
          Kun for administratorer
        </h3>
        <p className="text-dark-400">
          Bare administratorer kan se og administrere webhooks.
        </p>
      </div>
    );
  }

  if (loadError === 'error') {
    return (
      <div className="glass-card p-8 text-center border border-red-500/30">
        <h3 className="text-lg font-semibold text-white mb-2">
          Kunne ikke laste webhooks
        </h3>
        <p className="text-dark-400 mb-4">Prøv å laste siden på nytt.</p>
        <button
          onClick={() => window.location.reload()}
          className="btn-secondary"
        >
          Last inn på nytt
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">Webhooks</h2>
          <p className="text-dark-400 text-sm">
            Motta varsler når hendelser skjer i SkyPlanner.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => {
              resetForm();
              openModal(setShowCreateModal);
            }}
            className="btn-primary"
          >
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            Ny webhook
          </button>
        )}
      </div>

      {/* Info box */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-white mb-1">
              Slik fungerer webhooks
            </h3>
            <p className="text-dark-400 text-sm mb-2">
              Webhooks sender HTTP POST-forespørsler til din URL når valgte
              hendelser skjer. Alle forespørsler inkluderer en HMAC-SHA256
              signatur for verifisering.
            </p>
            <a
              href="/api/docs/webhook-signature"
              target="_blank"
              className="text-primary-400 text-sm hover:underline"
            >
              Les om signaturverifisering &rarr;
            </a>
          </div>
        </div>
      </div>

      {/* Webhooks List */}
      <div className="space-y-4">
        {webhooks.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-dark-700/50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-dark-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">
              Ingen webhooks
            </h3>
            <p className="text-dark-400 mb-4">
              Du har ikke opprettet noen webhooks ennå.
            </p>
            {isAdmin && (
              <button
                onClick={() => {
                  resetForm();
                  openModal(setShowCreateModal);
                }}
                className="btn-primary"
              >
                Opprett første webhook
              </button>
            )}
          </div>
        ) : (
          webhooks.map((webhook) => (
            <div key={webhook.id} className="glass-card p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-semibold text-white">
                      {webhook.name}
                    </h3>
                    {webhook.is_active ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">
                        Aktiv
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-500/10 text-red-400">
                        Deaktivert
                      </span>
                    )}
                    {webhook.failure_count > 0 && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-500/10 text-yellow-400">
                        {webhook.failure_count} feil
                      </span>
                    )}
                  </div>
                  <p className="text-dark-400 text-sm mb-2 font-mono">
                    {webhook.url}
                  </p>
                  {webhook.description && (
                    <p className="text-dark-400 text-sm mb-3">
                      {webhook.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost text-sm"
                    onClick={() => showDeliveries(webhook.id)}
                  >
                    Historikk
                  </button>
                  {isAdmin && (
                    <button
                      className="btn-ghost text-sm text-red-400 hover:text-red-300"
                      onClick={() => deleteWebhook(webhook.id, webhook.name)}
                    >
                      Slett
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {webhook.events.map((event) => (
                  <span
                    key={event}
                    className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-dark-700/50 text-dark-300"
                  >
                    {event}
                  </span>
                ))}
              </div>
              {(webhook.last_success_at || webhook.last_failure_at) && (
                <div className="flex items-center gap-4 mt-4 text-xs text-dark-400">
                  {webhook.last_success_at && (
                    <span>
                      Sist levert:{' '}
                      {new Date(webhook.last_success_at).toLocaleString(
                        'nb-NO'
                      )}
                    </span>
                  )}
                  {webhook.last_failure_at && (
                    <span className="text-red-400">
                      Sist feilet:{' '}
                      {new Date(webhook.last_failure_at).toLocaleString(
                        'nb-NO'
                      )}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => closeModal(setShowCreateModal)}
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => closeModal(setShowCreateModal)}
                className="absolute top-4 right-4 text-dark-400 hover:text-white transition-colors"
                aria-label="Lukk"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <h2 className="text-xl font-bold text-white mb-6">
                Opprett ny webhook
              </h2>

              <form onSubmit={handleCreateSubmit} className="space-y-6">
                <div>
                  <label className="input-label" htmlFor="webhook-name">
                    Navn *
                  </label>
                  <input
                    type="text"
                    id="webhook-name"
                    className="input w-full"
                    placeholder="F.eks. CRM-oppdatering"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="input-label" htmlFor="webhook-url">
                    URL *
                  </label>
                  <input
                    type="url"
                    id="webhook-url"
                    className="input w-full"
                    placeholder="https://example.com/webhook"
                    required
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                  />
                  <p className="text-xs text-dark-400 mt-1">
                    Må være en HTTPS URL
                  </p>
                </div>

                <div>
                  <label className="input-label" htmlFor="webhook-description">
                    Beskrivelse
                  </label>
                  <input
                    type="text"
                    id="webhook-description"
                    className="input w-full"
                    placeholder="Valgfri beskrivelse"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                  />
                </div>

                <div>
                  <label className="input-label">Hendelser *</label>
                  <p className="text-xs text-dark-400 mb-3">
                    Velg hvilke hendelser som skal trigge denne webhooken.
                  </p>
                  <div className="space-y-4">
                    {Object.entries(eventsByCategory).map(
                      ([category, events]) => (
                        <div key={category}>
                          <h4 className="text-sm font-medium text-dark-300 mb-2">
                            {category}
                          </h4>
                          <div className="space-y-2">
                            {events.map((event) => (
                              <label
                                key={event.id}
                                className="flex items-center gap-3 p-3 rounded-lg bg-dark-800/50 hover:bg-dark-800 cursor-pointer transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  checked={formEvents.has(event.id)}
                                  onChange={() => toggleEvent(event.id)}
                                  className="rounded bg-dark-700 border-dark-600 text-primary-500 focus:ring-primary-500"
                                />
                                <span className="text-white text-sm">
                                  {event.label}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>

                {createError && (
                  <div className="text-red-400 text-sm" role="alert">
                    {createError}
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => closeModal(setShowCreateModal)}
                    className="btn-secondary flex-1"
                  >
                    Avbryt
                  </button>
                  <button
                    type="submit"
                    className="btn-primary flex-1"
                    disabled={creating}
                  >
                    {creating ? 'Oppretter...' : 'Opprett'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Webhook Created Modal */}
      {showCreatedModal && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-lg p-6 relative">
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold text-white mb-2">
                  Webhook opprettet!
                </h2>
                <p className="text-dark-400 text-sm">
                  Kopier secret nå - den vises kun en gang.
                </p>
              </div>

              <div className="bg-dark-800/50 rounded-lg p-4 mb-6">
                <label className="text-xs text-dark-400 block mb-2">
                  Webhook Secret
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-primary-400 font-mono text-sm break-all">
                    {newWebhookSecret}
                  </code>
                  <button
                    onClick={handleCopySecret}
                    className="btn-secondary p-2"
                    title="Kopier"
                    aria-label="Kopier webhook-secret"
                  >
                    {secretCopied ? (
                      <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
                <p className="text-sm text-dark-300">
                  Bruk denne secret-verdien til å verifisere signaturen på
                  innkommende webhooks.{' '}
                  <a
                    href="/api/docs/webhook-signature"
                    target="_blank"
                    className="text-primary-400 hover:underline"
                  >
                    Les mer
                  </a>
                </p>
              </div>

              <button
                onClick={() => {
                  closeModal(setShowCreatedModal);
                  loadWebhooks();
                }}
                className="btn-primary w-full"
              >
                Jeg har lagret secret
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deliveries Modal */}
      {showDeliveriesModal && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => closeModal(setShowDeliveriesModal)}
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-2xl p-6 relative max-h-[80vh] overflow-y-auto">
              <button
                onClick={() => closeModal(setShowDeliveriesModal)}
                className="absolute top-4 right-4 text-dark-400 hover:text-white transition-colors"
                aria-label="Lukk"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <h2 className="text-xl font-bold text-white mb-6">
                Leveringshistorikk
              </h2>

              {deliveriesLoading ? (
                <div className="text-center py-8">
                  <svg
                    className="w-8 h-8 text-primary-400 animate-spin mx-auto mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
              ) : deliveries.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-dark-400">Ingen leveringer ennå.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {deliveries.map((d) => (
                    <div
                      key={d.id}
                      className="bg-dark-800/50 rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-white">
                          {d.event_type}
                        </span>
                        <span
                          className={`text-xs ${deliveryStatusColor(d.status)}`}
                        >
                          {deliveryStatusLabel(d.status)}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-dark-400">
                        <span>
                          {new Date(d.created_at).toLocaleString('nb-NO')}
                        </span>
                        {d.response_status && (
                          <span>Status: {d.response_status}</span>
                        )}
                        {d.response_time_ms && (
                          <span>{d.response_time_ms}ms</span>
                        )}
                        {d.attempt_count > 1 && (
                          <span>Forsøk: {d.attempt_count}</span>
                        )}
                      </div>
                      {d.error_message && (
                        <p className="text-red-400 text-xs mt-2">
                          {d.error_message}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

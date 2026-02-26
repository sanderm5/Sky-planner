'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Props {
  isCurrentUserAdmin: boolean;
  appUrl: string;
}

export function PersonvernSettings({ isCurrentUserAdmin, appUrl }: Props) {
  const [loading, setLoading] = useState(true);
  const [hasPendingDeletion, setHasPendingDeletion] = useState(false);
  const [scheduledDeletionAt, setScheduledDeletionAt] = useState<string | null>(null);
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  // Cancel deletion state
  const [cancelling, setCancelling] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/delete-account');
      const data = await res.json();

      if (data.hasPendingDeletion) {
        setHasPendingDeletion(true);
        setScheduledDeletionAt(data.scheduledDeletionAt);
        setDaysRemaining(data.daysRemaining);
      }
    } catch {
      // Silently fail - the loading state will still be removed
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Escape key handler for modal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && showDeleteModal) {
        setShowDeleteModal(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showDeleteModal]);

  async function handleCancelDeletion() {
    setCancelling(true);
    try {
      const res = await fetch('/api/dashboard/delete-account', { method: 'DELETE' });
      const data = await res.json();

      if (data.success) {
        setHasPendingDeletion(false);
        setScheduledDeletionAt(null);
        setDaysRemaining(null);
      } else {
        alert(data.error || 'Noe gikk galt');
      }
    } catch {
      alert('Noe gikk galt. Prøv igjen.');
    } finally {
      setCancelling(false);
    }
  }

  function openDeleteModal() {
    setDeletePassword('');
    setDeleteReason('');
    setDeleteError('');
    setShowDeleteModal(true);
  }

  async function handleConfirmDelete() {
    setDeleteError('');

    if (!deletePassword) {
      setDeleteError('Passord er påkrevd');
      return;
    }

    setDeleteSubmitting(true);
    try {
      const res = await fetch('/api/dashboard/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmPassword: deletePassword, reason: deleteReason }),
      });
      const data = await res.json();

      if (data.success) {
        setShowDeleteModal(false);
        setHasPendingDeletion(true);
        setScheduledDeletionAt(data.scheduledDeletionAt);
        setDaysRemaining(data.gracePeriodDays);
      } else {
        setDeleteError(data.error || 'Sletting feilet');
      }
    } catch {
      setDeleteError('Noe gikk galt. Prøv igjen.');
    } finally {
      setDeleteSubmitting(false);
    }
  }

  function formatDeletionDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // Loading state
  if (loading) {
    return (
      <div className="glass-card p-8 text-center">
        <svg className="w-6 h-6 text-primary-400 animate-spin mx-auto mb-3" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-dark-400 text-sm">Henter status...</p>
      </div>
    );
  }

  return (
    <>
      {/* Pending Deletion Banner */}
      {hasPendingDeletion && scheduledDeletionAt && (
        <div className="mb-6">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5">
            <div className="flex gap-3">
              <svg className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div className="flex-1">
                <p className="text-red-300 font-semibold">Kontosletting er planlagt</p>
                <p className="text-red-400/70 text-sm mt-1">
                  Kontoen og alle data vil bli permanent slettet{' '}
                  <span className="font-medium text-red-300">{formatDeletionDate(scheduledDeletionAt)}</span>.
                  {daysRemaining !== null && (
                    <span className="font-medium"> ({daysRemaining} dager igjen)</span>
                  )}
                </p>
                <p className="text-red-400/70 text-sm mt-2">
                  Du kan angre slettingen frem til denne datoen. Etter det er slettingen permanent.
                </p>
                <button
                  onClick={handleCancelDeletion}
                  disabled={cancelling}
                  className="mt-4 px-4 py-2 rounded-xl bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-colors font-medium text-sm"
                >
                  {cancelling ? 'Angrer...' : 'Angre sletting'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="space-y-6">
        {/* Data Export Section */}
        <div className="glass-card p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-white mb-1">Eksporter data</h2>
              <p className="text-dark-400 text-sm mb-4">
                Last ned alle dine data i JSON-format. Eksporten inkluderer kunder, ruter, avtaler og kontaktlogger.
                Dette er i tråd med GDPR artikkel 20 (rett til dataportabilitet).
              </p>
              <a
                href={`${appUrl}/api/export/all`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors font-medium text-sm"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Eksporter mine data
              </a>
            </div>
          </div>
        </div>

        {/* Privacy Info */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Dine rettigheter</h2>
          <div className="space-y-3 text-sm text-dark-300">
            <div className="flex gap-3">
              <svg className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span><strong className="text-white">Innsyn:</strong> Du kan når som helst se all data vi har om deg gjennom dashboard og eksportfunksjonen.</span>
            </div>
            <div className="flex gap-3">
              <svg className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span><strong className="text-white">Retting:</strong> Du kan oppdatere dine opplysninger under Generelt-innstillinger.</span>
            </div>
            <div className="flex gap-3">
              <svg className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span><strong className="text-white">Portabilitet:</strong> Eksporter dine data i maskinlesbart format (JSON).</span>
            </div>
            <div className="flex gap-3">
              <svg className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span><strong className="text-white">Sletting:</strong> Be om sletting av kontoen din med 30 dagers angrefrist.</span>
            </div>
          </div>
          <p className="text-dark-500 text-xs mt-4">
            Les vår fullstendige <Link href="/personvern" className="text-primary-400 hover:text-primary-300">personvernerklæring</Link> for mer informasjon.
          </p>
        </div>

        {/* Danger Zone (admin only) */}
        {isCurrentUserAdmin && !hasPendingDeletion && (
          <div className="glass-card p-6 border-red-500/20">
            <h2 className="text-lg font-semibold text-red-400 mb-1">Faresone</h2>
            <p className="text-dark-400 text-sm mb-4">
              Sletting av kontoen vil permanent fjerne alle data inkludert kunder, ruter, avtaler og brukere.
              Du har en 30-dagers angrefrist etter at forespørselen er sendt.
            </p>
            <button
              onClick={openDeleteModal}
              className="px-4 py-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors font-medium text-sm"
            >
              Slett konto og alle data
            </button>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowDeleteModal(false)} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-md p-6 relative">
              <h3 id="delete-modal-title" className="text-lg font-semibold text-white mb-2">Slett konto</h3>
              <p className="text-dark-400 text-sm mb-2">
                Er du sikker på at du vil slette kontoen din? Følgende skjer:
              </p>
              <ul className="text-dark-400 text-sm mb-4 space-y-1 list-disc list-inside">
                <li>Abonnementet kanselleres</li>
                <li>30-dagers angrefrist starter</li>
                <li>Etter 30 dager slettes <strong className="text-white">alle data permanent</strong></li>
              </ul>
              <p className="text-amber-400 text-xs mb-4">Vi anbefaler at du eksporterer dataene dine før du fortsetter.</p>

              <div className="space-y-3 mb-4">
                <div>
                  <label className="input-label" htmlFor="delete-reason">Grunn (valgfritt)</label>
                  <select
                    id="delete-reason"
                    className="input w-full"
                    value={deleteReason}
                    onChange={e => setDeleteReason(e.target.value)}
                  >
                    <option value="">Velg en grunn...</option>
                    <option value="for_dyrt">For dyrt</option>
                    <option value="mangler_funksjoner">Mangler funksjoner</option>
                    <option value="bytter_system">Bytter til annet system</option>
                    <option value="legger_ned">Legger ned virksomheten</option>
                    <option value="annet">Annet</option>
                  </select>
                </div>
                <div>
                  <label className="input-label" htmlFor="delete-password">Passord *</label>
                  <input
                    type="password"
                    id="delete-password"
                    className="input w-full"
                    placeholder="Bekreft med passordet ditt"
                    value={deletePassword}
                    onChange={e => setDeletePassword(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleConfirmDelete(); }}
                  />
                </div>
                {deleteError && (
                  <p className="text-red-400 text-sm" role="alert" aria-live="assertive">{deleteError}</p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 px-4 py-2 rounded-xl bg-dark-800/50 text-dark-300 border border-dark-700 hover:bg-dark-700/50 hover:text-white transition-colors font-medium text-sm"
                >
                  Avbryt
                </button>
                <button
                  onClick={handleConfirmDelete}
                  disabled={deleteSubmitting}
                  className="flex-1 px-4 py-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors font-medium text-sm"
                >
                  {deleteSubmitting ? 'Sletter...' : 'Ja, slett kontoen min'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

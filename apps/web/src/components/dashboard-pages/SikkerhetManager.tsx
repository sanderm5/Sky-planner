'use client';

import { useState, useEffect, useCallback } from 'react';
import { getCsrfToken } from '@/lib/csrf';

interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  backupCodesRemaining: number | null;
}

interface SetupData {
  qrDataUrl: string;
  secret: string;
  backupCodes: string[];
}

interface Session {
  id: number;
  device_info: string;
  user_agent: string;
  ip_address: string;
  last_activity_at: string;
  created_at: string;
  is_current: boolean;
}

type TwoFAState = 'loading' | 'disabled' | 'enabled';
type SetupStep = 'qr' | 'backup' | 'verify' | 'success';
type SessionsState = 'loading' | 'loaded' | 'empty' | 'error';

export function SikkerhetManager() {
  // 2FA state
  const [twoFAState, setTwoFAState] = useState<TwoFAState>('loading');
  const [twoFAData, setTwoFAData] = useState<TwoFactorStatus | null>(null);
  const [setupData, setSetupData] = useState<SetupData | null>(null);

  // Modal state
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [setupStep, setSetupStep] = useState<SetupStep>('qr');

  // Verify state
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifying, setVerifying] = useState(false);

  // Disable state
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState('');
  const [disabling, setDisabling] = useState(false);

  // Copy codes state
  const [codesCopied, setCodesCopied] = useState(false);

  // Sessions state
  const [sessionsState, setSessionsState] = useState<SessionsState>('loading');
  const [sessions, setSessions] = useState<Session[]>([]);

  // ---- CSRF helpers ----
  function csrfHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    };
  }

  // ---- 2FA Status ----
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/2fa/status');
      const data = await res.json();
      if (data.success && data.data.enabled) {
        setTwoFAData(data.data);
        setTwoFAState('enabled');
      } else {
        setTwoFAState('disabled');
      }
    } catch {
      setTwoFAState('disabled');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // ---- Setup flow ----
  async function handleEnableClick() {
    setShowSetupModal(true);
    setSetupStep('qr');
    document.body.style.overflow = 'hidden';

    try {
      const res = await fetch('/api/dashboard/2fa/setup', {
        method: 'POST',
        headers: { 'X-CSRF-Token': getCsrfToken() },
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Noe gikk galt');
        closeSetupModal();
        return;
      }
      setSetupData(data.data);
    } catch {
      alert('Kunne ikke starte 2FA-oppsett');
      closeSetupModal();
    }
  }

  function closeSetupModal() {
    setShowSetupModal(false);
    document.body.style.overflow = '';
  }

  function closeDisableModal() {
    setShowDisableModal(false);
    document.body.style.overflow = '';
  }

  async function handleCopyCodes() {
    if (setupData?.backupCodes) {
      await navigator.clipboard.writeText(setupData.backupCodes.join('\n'));
      setCodesCopied(true);
      setTimeout(() => setCodesCopied(false), 2000);
    }
  }

  async function handleVerify() {
    const code = verifyCode.trim();
    setVerifyError('');

    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      setVerifyError('Koden må være 6 siffer');
      return;
    }

    setVerifying(true);
    try {
      const res = await fetch('/api/dashboard/2fa/verify', {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        setSetupStep('success');
      } else {
        setVerifyError(data.error || 'Feil kode. Prøv igjen.');
      }
    } catch {
      setVerifyError('Noe gikk galt. Prøv igjen.');
    }
    setVerifying(false);
  }

  function handleDone() {
    closeSetupModal();
    fetchStatus();
  }

  // ---- Disable flow ----
  function handleDisableClick() {
    setShowDisableModal(true);
    setDisablePassword('');
    setDisableError('');
    document.body.style.overflow = 'hidden';
  }

  async function handleConfirmDisable() {
    if (!disablePassword) {
      setDisableError('Passord er påkrevd');
      return;
    }

    setDisabling(true);
    setDisableError('');

    try {
      const res = await fetch('/api/dashboard/2fa/disable', {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify({ password: disablePassword }),
      });
      const data = await res.json();
      if (data.success) {
        closeDisableModal();
        fetchStatus();
      } else {
        setDisableError(data.error || 'Deaktivering feilet');
      }
    } catch {
      setDisableError('Noe gikk galt. Prøv igjen.');
    }
    setDisabling(false);
  }

  // ---- Sessions ----
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/sessions/list');
      const data = await res.json();
      if (!data.success || !data.data.sessions.length) {
        setSessionsState('empty');
        return;
      }
      setSessions(data.data.sessions);
      setSessionsState('loaded');
    } catch {
      setSessionsState('error');
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  async function terminateSession(sessionId: number) {
    if (
      !confirm(
        'Er du sikker på at du vil avslutte denne sesjonen? Enheten vil bli logget ut.'
      )
    )
      return;

    try {
      const res = await fetch('/api/dashboard/sessions/terminate', {
        method: 'POST',
        headers: csrfHeaders(),
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (data.success) {
        fetchSessions();
      } else {
        alert(data.error || 'Kunne ikke avslutte sesjonen');
      }
    } catch {
      alert('Noe gikk galt. Prøv igjen.');
    }
  }

  // ---- Helpers ----
  function formatDate(dateStr: string): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return (
      d.toLocaleDateString('nb-NO', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }) +
      ' ' +
      d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
    );
  }

  function timeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Akkurat nå';
    if (mins < 60) return `${mins} min siden`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} t siden`;
    const days = Math.floor(hours / 24);
    return `${days} d siden`;
  }

  function getDeviceIcon(info: string): React.ReactNode {
    const lower = info.toLowerCase();
    if (
      lower.includes('iphone') ||
      lower.includes('ipad') ||
      lower.includes('ios') ||
      lower.includes('android')
    ) {
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <rect x="7" y="2" width="10" height="20" rx="2" strokeWidth="2" />
          <circle cx="12" cy="18" r="1" fill="currentColor" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth="2" />
        <path strokeLinecap="round" strokeWidth="2" d="M8 21h8M12 17v4" />
      </svg>
    );
  }

  // ---- Escape key ----
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showSetupModal) closeSetupModal();
        if (showDisableModal) closeDisableModal();
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [showSetupModal, showDisableModal]);

  return (
    <>
      {/* 2FA Section */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">
              Tofaktorautentisering (2FA)
            </h2>
            <p className="text-dark-400 text-sm">
              Legg til et ekstra sikkerhetslag med en autentiseringsapp.
            </p>
          </div>
          <div>
            {twoFAState === 'enabled' && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5" />
                Aktiv
              </span>
            )}
            {twoFAState === 'disabled' && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-dark-800/50 text-dark-400 border border-dark-700">
                <span className="w-1.5 h-1.5 rounded-full bg-dark-500 mr-1.5" />
                Inaktiv
              </span>
            )}
          </div>
        </div>

        {/* Loading state */}
        {twoFAState === 'loading' && (
          <div className="flex items-center gap-3 text-dark-400" role="status">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Henter status...
          </div>
        )}

        {/* Disabled state */}
        {twoFAState === 'disabled' && (
          <div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
              <div className="flex gap-3">
                <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="text-amber-300 font-medium text-sm">
                    2FA er ikke aktivert
                  </p>
                  <p className="text-amber-400/70 text-sm mt-1">
                    Vi anbefaler sterkt at du aktiverer tofaktorautentisering
                    for ekstra sikkerhet.
                  </p>
                </div>
              </div>
            </div>
            <button onClick={handleEnableClick} className="btn-primary">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Aktiver 2FA
            </button>
          </div>
        )}

        {/* Enabled state */}
        {twoFAState === 'enabled' && twoFAData && (
          <div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 mb-6">
              <div className="flex gap-3">
                <svg className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <div>
                  <p className="text-green-300 font-medium text-sm">
                    2FA er aktivert
                  </p>
                  <p className="text-green-400/70 text-sm mt-1">
                    Aktivert:{' '}
                    {twoFAData.enabledAt
                      ? new Date(twoFAData.enabledAt).toLocaleDateString(
                          'nb-NO'
                        )
                      : '-'}
                    {' \u2022 '}Reservekoder igjen:{' '}
                    <span className="font-medium">
                      {twoFAData.backupCodesRemaining ?? '-'}
                    </span>
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={handleDisableClick}
              className="px-4 py-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors font-medium text-sm"
            >
              Deaktiver 2FA
            </button>
          </div>
        )}
      </div>

      {/* Active Sessions Section */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">
              Aktive sesjoner
            </h2>
            <p className="text-dark-400 text-sm">
              Se og administrer påloggede enheter. Du kan avslutte sesjoner du
              ikke kjenner igjen.
            </p>
          </div>
        </div>

        {sessionsState === 'loading' && (
          <div className="flex items-center gap-3 text-dark-400" role="status">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Henter sesjoner...
          </div>
        )}

        {sessionsState === 'empty' && (
          <div className="text-dark-400 text-sm">
            Ingen aktive sesjoner funnet.
          </div>
        )}

        {sessionsState === 'error' && (
          <div className="text-red-400 text-sm">
            Kunne ikke hente sesjoner. Prøv å laste siden på nytt.
          </div>
        )}

        {sessionsState === 'loaded' && (
          <div className="space-y-3">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`flex items-center justify-between p-4 rounded-xl border ${
                  s.is_current
                    ? 'bg-primary-500/5 border-primary-500/20'
                    : 'bg-dark-800/30 border-dark-700/50'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      s.is_current
                        ? 'bg-primary-500/10 text-primary-400'
                        : 'bg-dark-700/50 text-dark-400'
                    }`}
                  >
                    {getDeviceIcon(s.device_info || s.user_agent || '')}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white text-sm font-medium truncate">
                        {s.device_info || 'Ukjent enhet'}
                      </p>
                      {s.is_current && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-500/10 text-primary-400 border border-primary-500/20 flex-shrink-0">
                          Nåværende
                        </span>
                      )}
                    </div>
                    <p className="text-dark-400 text-xs mt-0.5">
                      {s.ip_address && (
                        <>
                          {s.ip_address} {'\u2022'}{' '}
                        </>
                      )}
                      Sist aktiv: {timeAgo(s.last_activity_at)} {'\u2022'}{' '}
                      Opprettet: {formatDate(s.created_at)}
                    </p>
                  </div>
                </div>
                {!s.is_current && (
                  <button
                    onClick={() => terminateSession(s.id)}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors text-xs font-medium"
                  >
                    Avslutt
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Setup Modal */}
      {showSetupModal && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeSetupModal}
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto">
              <button
                onClick={closeSetupModal}
                className="absolute top-4 right-4 text-dark-400 hover:text-white"
                aria-label="Lukk"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Step 1: QR Code */}
              {setupStep === 'qr' && setupData && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Skann QR-koden
                  </h3>
                  <p className="text-dark-400 text-sm mb-4">
                    Bruk en autentiseringsapp (Google Authenticator, Authy,
                    1Password) for å skanne koden.
                  </p>
                  <div className="flex justify-center mb-4 bg-white rounded-xl p-4">
                    <img
                      src={setupData.qrDataUrl}
                      width={200}
                      height={200}
                      alt="QR-kode for 2FA"
                    />
                  </div>
                  <details className="mb-4">
                    <summary className="text-dark-400 text-sm cursor-pointer hover:text-dark-300">
                      Kan du ikke skanne? Skriv inn manuelt
                    </summary>
                    <div className="mt-2 bg-dark-800/50 rounded-lg p-3">
                      <code className="text-primary-400 text-sm break-all">
                        {setupData.secret}
                      </code>
                    </div>
                  </details>
                  <button
                    onClick={() => setSetupStep('backup')}
                    className="btn-primary w-full"
                  >
                    Neste: Reservekoder
                  </button>
                </div>
              )}

              {/* Step 2: Backup Codes */}
              {setupStep === 'backup' && setupData && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Lagre reservekodene
                  </h3>
                  <p className="text-dark-400 text-sm mb-4">
                    Lagre disse kodene et trygt sted. Du kan bruke dem hvis du
                    mister tilgang til autentiseringsappen.
                  </p>
                  <div className="bg-dark-800/50 rounded-xl p-4 mb-4">
                    <div className="grid grid-cols-2 gap-2 font-mono text-sm text-white">
                      {setupData.backupCodes.map((code, i) => (
                        <div
                          key={i}
                          className="bg-dark-900/50 rounded px-3 py-2 text-center"
                        >
                          {code}
                        </div>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={handleCopyCodes}
                    className="w-full mb-3 px-4 py-2 rounded-xl bg-dark-800/50 text-dark-300 border border-dark-700 hover:bg-dark-700/50 hover:text-white transition-colors font-medium text-sm"
                  >
                    {codesCopied ? 'Kopiert!' : 'Kopier alle koder'}
                  </button>
                  <button
                    onClick={() => {
                      setSetupStep('verify');
                      setVerifyCode('');
                      setVerifyError('');
                    }}
                    className="btn-primary w-full"
                  >
                    Neste: Verifiser
                  </button>
                </div>
              )}

              {/* Step 3: Verify */}
              {setupStep === 'verify' && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Verifiser oppsettet
                  </h3>
                  <p className="text-dark-400 text-sm mb-4">
                    Skriv inn den 6-sifrede koden fra autentiseringsappen din.
                  </p>
                  <div className="mb-4">
                    <input
                      type="text"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleVerify();
                      }}
                      className="input w-full text-center text-2xl tracking-[0.5em] font-mono"
                      maxLength={6}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="000000"
                      autoComplete="one-time-code"
                      autoFocus
                    />
                    {verifyError && (
                      <p
                        className="text-red-400 text-sm mt-2"
                        role="alert"
                      >
                        {verifyError}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleVerify}
                    className="btn-primary w-full"
                    disabled={verifying}
                  >
                    {verifying ? 'Verifiserer...' : 'Aktiver 2FA'}
                  </button>
                </div>
              )}

              {/* Step 4: Success */}
              {setupStep === 'success' && (
                <div className="text-center">
                  <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    2FA er aktivert!
                  </h3>
                  <p className="text-dark-400 text-sm mb-6">
                    Kontoen din er nå beskyttet med tofaktorautentisering.
                  </p>
                  <button onClick={handleDone} className="btn-primary">
                    Ferdig
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Disable Modal */}
      {showDisableModal && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeDisableModal}
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="glass-card w-full max-w-md p-6 relative">
              <h3 className="text-lg font-semibold text-white mb-2">
                Deaktiver 2FA
              </h3>
              <p className="text-dark-400 text-sm mb-4">
                Dette vil fjerne det ekstra sikkerhetslaget fra kontoen din.
                Skriv inn passordet ditt for å bekrefte.
              </p>
              <div className="mb-4">
                <label className="input-label" htmlFor="disable-password">
                  Passord
                </label>
                <input
                  type="password"
                  id="disable-password"
                  className="input w-full"
                  placeholder="Ditt passord"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmDisable();
                  }}
                  autoFocus
                />
                {disableError && (
                  <p className="text-red-400 text-sm mt-2" role="alert">
                    {disableError}
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={closeDisableModal}
                  className="flex-1 px-4 py-2 rounded-xl bg-dark-800/50 text-dark-300 border border-dark-700 hover:bg-dark-700/50 hover:text-white transition-colors font-medium text-sm"
                >
                  Avbryt
                </button>
                <button
                  onClick={handleConfirmDisable}
                  disabled={disabling}
                  className="flex-1 px-4 py-2 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors font-medium text-sm"
                >
                  {disabling ? 'Deaktiverer...' : 'Deaktiver'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

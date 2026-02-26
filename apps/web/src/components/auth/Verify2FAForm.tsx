'use client';

import { useState, useEffect, useRef } from 'react';

export default function Verify2FAForm() {
  const [showingBackup, setShowingBackup] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [error, setError] = useState('');
  const [errorStyle, setErrorStyle] = useState<{ borderColor?: string; color?: string }>({});
  const [totpLoading, setTotpLoading] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);

  const totpInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus the TOTP input on mount
    totpInputRef.current?.focus();
  }, []);

  const toggleBackup = () => {
    setShowingBackup(!showingBackup);
    setError('');
    setErrorStyle({});
    if (!showingBackup) {
      setTimeout(() => backupInputRef.current?.focus(), 0);
    } else {
      setTimeout(() => totpInputRef.current?.focus(), 0);
    }
  };

  const verify = async (
    code: string,
    setLoadingFn: (loading: boolean) => void,
  ) => {
    setLoadingFn(true);
    setError('');
    setErrorStyle({});

    try {
      // Session token is in HttpOnly cookie, sent automatically via credentials: 'include'
      const response = await fetch('/api/auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Verifisering feilet');
      }

      if (data.usedBackupCode) {
        // Brief notice before redirect
        setError('Reservekode brukt. Du har faerre reservekoder igjen.');
        setErrorStyle({ borderColor: 'rgb(234 179 8)', color: 'rgb(234 179 8)' });
        await new Promise((r) => setTimeout(r, 1500));
      }

      // Redirect to app
      if (data.appUrl && data.redirectUrl) {
        window.location.href = data.appUrl + data.redirectUrl;
      } else if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        window.location.href = '/dashboard';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
      setErrorStyle({});
    } finally {
      setLoadingFn(false);
    }
  };

  const handleTotpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    verify(totpCode.trim(), setTotpLoading);
  };

  const handleBackupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    verify(backupCode.trim(), setBackupLoading);
  };

  return (
    <div className="glass-card p-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary-500/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Tofaktorverifisering</h1>
        <p className="text-dark-400">Skriv inn koden fra autentiseringsappen din</p>
      </div>

      {error && (
        <div
          className="form-error mb-6"
          role="alert"
          aria-live="assertive"
          style={errorStyle}
        >
          {error}
        </div>
      )}

      {/* TOTP Code Form */}
      {!showingBackup && (
        <form onSubmit={handleTotpSubmit} className="space-y-6">
          <div>
            <label htmlFor="totp-code" className="input-label">Engangskode</label>
            <input
              ref={totpInputRef}
              id="totp-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoComplete="one-time-code"
              className="input text-center text-2xl tracking-[0.5em] font-mono"
              placeholder="000000"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={totpLoading}>
            {totpLoading ? 'Verifiserer...' : 'Verifiser'}
          </button>
        </form>
      )}

      {/* Backup code toggle */}
      <div className="mt-6 text-center">
        <button
          onClick={toggleBackup}
          className="text-sm text-primary-400 hover:text-primary-300 font-medium"
        >
          {showingBackup ? 'Bruk engangskode i stedet' : 'Bruk reservekode i stedet'}
        </button>
      </div>

      {/* Backup Code Form */}
      {showingBackup && (
        <form onSubmit={handleBackupSubmit} className="space-y-6 mt-6">
          <div>
            <label htmlFor="backup-code" className="input-label">Reservekode</label>
            <input
              ref={backupInputRef}
              id="backup-code"
              type="text"
              required
              className="input text-center text-lg tracking-wider font-mono"
              placeholder="XXXX-XXXX"
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value)}
            />
            <p className="text-xs text-dark-500 mt-2">Skriv inn en av reservekodene du fikk da du aktiverte 2FA</p>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={backupLoading}>
            {backupLoading ? 'Verifiserer...' : 'Verifiser reservekode'}
          </button>
        </form>
      )}

      <div className="mt-6 text-center">
        <a href="/auth/login" className="text-sm text-dark-400 hover:text-dark-300">
          &larr; Tilbake til innlogging
        </a>
      </div>
    </div>
  );
}

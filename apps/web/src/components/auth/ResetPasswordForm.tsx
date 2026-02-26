'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [passord, setPassord] = useState('');
  const [bekreftPassord, setBekreftPassord] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [formHidden, setFormHidden] = useState(false);

  if (!token) {
    return (
      <div className="glass-card p-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Ugyldig lenke</h1>
          <p className="text-dark-400 mb-6">Denne lenken er ugyldig eller har utløpt.</p>
          <a href="/auth/glemt-passord" className="btn-primary inline-block">
            Be om ny tilbakestillingslenke
          </a>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client-side validation
    if (passord !== bekreftPassord) {
      setError('Passordene stemmer ikke overens');
      return;
    }

    if (passord.length < 8) {
      setError('Passord må være minst 8 tegn');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/auth/tilbakestill-passord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, passord }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Noe gikk galt');
      }

      // Show success and redirect
      setSuccess('Passordet ditt er oppdatert! Du blir nå sendt til innloggingssiden...');
      setFormHidden(true);

      // Redirect to login after 2 seconds
      setTimeout(() => {
        window.location.href = '/auth/login?message=password_reset';
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
      setLoading(false);
    }
  };

  return (
    <div className="glass-card p-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Opprett nytt passord</h1>
        <p className="text-dark-400">Skriv inn ditt nye passord nedenfor.</p>
      </div>

      {!formHidden && (
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="form-error" role="alert" aria-live="assertive">
              {error}
            </div>
          )}
          {success && (
            <div className="form-success" role="status" aria-live="polite">
              {success}
            </div>
          )}

          <div>
            <label htmlFor="passord" className="input-label">Nytt passord</label>
            <input
              id="passord"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input"
              placeholder="Minst 8 tegn"
              value={passord}
              onChange={(e) => setPassord(e.target.value)}
            />
            <p className="text-xs text-dark-400 mt-1">Minst 8 tegn, inkludert stor bokstav, liten bokstav og tall</p>
          </div>

          <div>
            <label htmlFor="bekreft-passord" className="input-label">Bekreft passord</label>
            <input
              id="bekreft-passord"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="input"
              placeholder="Gjenta passordet"
              value={bekreftPassord}
              onChange={(e) => setBekreftPassord(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Oppdaterer...' : 'Oppdater passord'}
          </button>
        </form>
      )}

      {formHidden && success && (
        <div className="form-success" role="status" aria-live="polite">
          {success}
        </div>
      )}

      <div className="mt-6 text-center">
        <a href="/auth/login" className="text-sm text-primary-400 hover:text-primary-300">
          Tilbake til innlogging
        </a>
      </div>
    </div>
  );
}

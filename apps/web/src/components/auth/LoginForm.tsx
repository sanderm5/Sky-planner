'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function LoginForm() {
  const searchParams = useSearchParams();
  const [epost, setEpost] = useState('');
  const [passord, setPassord] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const redirectParam = searchParams.get('redirect');
  const messageParam = searchParams.get('message');

  useEffect(() => {
    if (messageParam === 'password_reset') {
      // Could show a success message, but the original doesn't explicitly handle this
    }
  }, [messageParam]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epost, passord, redirect: redirectParam }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.error || 'Innlogging feilet');
      }

      // 2FA required — redirect to verification page
      // Session token is stored in HttpOnly cookie by the server
      if (data.requires2FA) {
        window.location.href = '/auth/verify-2fa';
        return;
      }

      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card p-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Logg inn</h1>
        <p className="text-dark-400">Velkommen tilbake</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="form-error" role="alert" aria-live="assertive">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="epost" className="input-label">E-postadresse</label>
          <input
            id="epost"
            type="email"
            required
            autoComplete="email"
            className="input"
            placeholder="din@epost.no"
            value={epost}
            onChange={(e) => setEpost(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="passord" className="input-label">Passord</label>
          <input
            id="passord"
            type="password"
            required
            autoComplete="current-password"
            className="input"
            placeholder="Ditt passord"
            value={passord}
            onChange={(e) => setPassord(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <input
              id="remember"
              type="checkbox"
              className="h-4 w-4 rounded border-dark-600 bg-dark-800 text-primary-600 focus:ring-primary-500"
            />
            <label htmlFor="remember" className="ml-2 text-sm text-dark-400">
              Husk meg
            </label>
          </div>

          <a href="/auth/glemt-passord" className="text-sm text-primary-400 hover:text-primary-300">
            Glemt passord?
          </a>
        </div>

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Logger inn...' : 'Logg inn'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-dark-400">
          Har du ikke en konto?{' '}
          <a href="/auth/registrer" className="text-primary-400 hover:text-primary-300 font-medium">
            Opprett konto
          </a>
        </p>
      </div>
    </div>
  );
}

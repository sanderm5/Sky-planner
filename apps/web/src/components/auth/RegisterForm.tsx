'use client';

import { useState } from 'react';
import PasswordStrengthIndicator from '@/components/ui/PasswordStrengthIndicator';

export default function RegisterForm() {
  const [navn, setNavn] = useState('');
  const [firma, setFirma] = useState('');
  const [epost, setEpost] = useState('');
  const [passord, setPassord] = useState('');
  const [vilkar, setVilkar] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ navn, firma, epost, passord, plan: 'standard' }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.error || 'Registrering feilet');
      }

      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
      } else {
        throw new Error('Registrering fullført, men ingen omdirigering mottatt. Vennligst kontakt support.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
      setLoading(false);
    }
  };

  return (
    <div className="glass-card p-6">
      <div className="text-center mb-8">
        <span className="badge mb-4 inline-block">14 dagers gratis prøveperiode</span>
        <h1 className="text-2xl font-bold text-white mb-2">Opprett konto</h1>
        <p className="text-dark-400">Kom i gang med Sky Planner</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="form-error" role="alert" aria-live="assertive">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="navn" className="input-label">Ditt navn *</label>
            <input
              id="navn"
              type="text"
              required
              autoComplete="name"
              className="input"
              placeholder="Ola Nordmann"
              value={navn}
              onChange={(e) => setNavn(e.target.value)}
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="firma" className="input-label">Bedriftsnavn *</label>
            <input
              id="firma"
              type="text"
              required
              autoComplete="organization"
              className="input"
              placeholder="Bedrift AS"
              value={firma}
              onChange={(e) => setFirma(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label htmlFor="epost" className="input-label">E-postadresse *</label>
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
          <label htmlFor="passord" className="input-label">Passord *</label>
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
          <PasswordStrengthIndicator password={passord} minLength={10} />
        </div>

        <div className="flex items-start">
          <input
            id="vilkar"
            type="checkbox"
            required
            className="h-4 w-4 mt-1 rounded border-dark-600 bg-dark-800 text-primary-600 focus:ring-primary-500"
            checked={vilkar}
            onChange={(e) => setVilkar(e.target.checked)}
          />
          <label htmlFor="vilkar" className="ml-2 text-sm text-dark-400">
            Jeg godtar{' '}
            <a href="/vilkar" className="text-primary-400 hover:text-primary-300" target="_blank" rel="noopener noreferrer">
              brukervilkarene
            </a>{' '}
            og{' '}
            <a href="/personvern" className="text-primary-400 hover:text-primary-300" target="_blank" rel="noopener noreferrer">
              personvernerklæringen
            </a>
          </label>
        </div>

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Oppretter konto...' : 'Start gratis prøveperiode'}
        </button>

        <p className="text-xs text-dark-400 text-center">
          Du får tilgang til alle funksjoner i 14 dager.
          Etter prøveperioden kontakter vi deg for tilbud.
        </p>
      </form>

      <div className="mt-6 text-center">
        <p className="text-dark-400">
          Har du allerede en konto?{' '}
          <a href="/auth/login" className="text-primary-400 hover:text-primary-300 font-medium">
            Logg inn
          </a>
        </p>
      </div>
    </div>
  );
}

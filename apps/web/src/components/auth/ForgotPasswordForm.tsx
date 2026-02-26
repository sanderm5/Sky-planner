'use client';

import { useState } from 'react';

export default function ForgotPasswordForm() {
  const [epost, setEpost] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/auth/glemt-passord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epost }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Noe gikk galt');
      }

      // Always show success message (security: don't reveal if email exists)
      setSuccess('Hvis denne e-postadressen er registrert, vil du motta en e-post med instruksjoner for å tilbakestille passordet.');
      setEpost('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card p-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Glemt passord?</h1>
        <p className="text-dark-400">Skriv inn e-postadressen din, så sender vi deg en lenke for å tilbakestille passordet.</p>
      </div>

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

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Sender...' : 'Send tilbakestillingslenke'}
        </button>
      </form>

      <div className="mt-6 text-center">
        <a href="/auth/login" className="text-sm text-primary-400 hover:text-primary-300">
          Tilbake til innlogging
        </a>
      </div>
    </div>
  );
}

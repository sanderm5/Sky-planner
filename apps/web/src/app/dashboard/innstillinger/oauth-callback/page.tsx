'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

type CallbackState = 'loading' | 'success' | 'error';

export default function OAuthCallbackPage() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<CallbackState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function completeOAuth() {
      const code = searchParams.get('code');
      const stateParam = searchParams.get('state');
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      // Check for OAuth error from provider
      if (error) {
        setErrorMessage(errorDescription || `OAuth feil: ${error}`);
        setState('error');
        return;
      }

      // Verify we have the required params
      if (!code || !stateParam) {
        setErrorMessage('Manglende parametre fra OAuth-leverandør.');
        setState('error');
        return;
      }

      // Verify state matches what we stored
      const storedState = sessionStorage.getItem('oauth_state');
      if (!storedState || storedState !== stateParam) {
        setErrorMessage('Ugyldig state-parameter. Mulig CSRF-angrep.');
        setState('error');
        return;
      }

      // Parse state to get integration ID
      let stateData;
      try {
        stateData = JSON.parse(atob(stateParam));
      } catch {
        setErrorMessage('Kunne ikke parse state-data.');
        setState('error');
        return;
      }

      const integrationId = stateData.integrationId;
      const redirectUri = `${window.location.origin}/dashboard/innstillinger/oauth-callback`;

      try {
        const res = await fetch(`/api/app/integrations/${integrationId}/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            metadata: {
              authorizationCode: code,
              redirectUri: redirectUri,
            },
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error?.message || data.message || 'Tilkobling feilet');
        }

        // Clean up stored state
        sessionStorage.removeItem('oauth_state');

        setState('success');
      } catch (err: any) {
        setErrorMessage(err.message);
        setState('error');
      }
    }

    completeOAuth();
  }, [searchParams]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="glass-card p-8 max-w-md w-full text-center">
        {/* Loading State */}
        {state === 'loading' && (
          <div>
            <svg className="w-12 h-12 text-primary-400 animate-spin mx-auto mb-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <h2 className="text-xl font-bold text-white mb-2">Fullfører tilkobling...</h2>
            <p className="text-dark-400">Vennligst vent mens vi kobler til integrasjonen.</p>
          </div>
        )}

        {/* Success State */}
        {state === 'success' && (
          <div>
            <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Tilkobling vellykket!</h2>
            <p className="text-dark-400 mb-6">Integrasjonen er nå koblet til SkyPlanner.</p>
            <Link href="/dashboard/innstillinger/integrasjoner" className="btn-primary inline-block">
              Gå til integrasjoner
            </Link>
          </div>
        )}

        {/* Error State */}
        {state === 'error' && (
          <div>
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Tilkobling feilet</h2>
            <p className="text-dark-400 mb-6">{errorMessage}</p>
            <Link href="/dashboard/innstillinger/integrasjoner" className="btn-secondary inline-block">
              Prøv igjen
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

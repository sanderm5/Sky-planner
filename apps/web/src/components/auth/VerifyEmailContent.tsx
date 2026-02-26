'use client';

import { useSearchParams } from 'next/navigation';

const messages: Record<string, { title: string; message: string; type: 'success' | 'info' | 'error' }> = {
  success: {
    title: 'E-post verifisert!',
    message: 'Din e-postadresse er nå verifisert. Du kan nå logge inn.',
    type: 'success',
  },
  already_verified: {
    title: 'Allerede verifisert',
    message: 'Din e-postadresse er allerede verifisert. Du kan logge inn.',
    type: 'info',
  },
  expired: {
    title: 'Lenken har utløpt',
    message: 'Verifiseringslenken har utløpt. Vennligst be om en ny.',
    type: 'error',
  },
  invalid_token: {
    title: 'Ugyldig lenke',
    message: 'Verifiseringslenken er ugyldig. Vennligst sjekk at du bruker riktig lenke.',
    type: 'error',
  },
  missing_token: {
    title: 'Mangler token',
    message: 'Verifiseringslenken er ufullstendig.',
    type: 'error',
  },
  verification_failed: {
    title: 'Verifisering feilet',
    message: 'Noe gikk galt under verifiseringen. Prøv igjen senere.',
    type: 'error',
  },
  server_error: {
    title: 'Serverfeil',
    message: 'En feil oppstod. Vennligst prøv igjen senere.',
    type: 'error',
  },
};

const iconColors: Record<string, string> = {
  success: 'bg-green-100 text-green-600',
  info: 'bg-blue-100 text-blue-600',
  error: 'bg-red-100 text-red-600',
};

const iconSymbols: Record<string, string> = {
  success: '\u2713',
  info: '\u2139',
  error: '\u2715',
};

export default function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const status = searchParams.get('status');
  const errorParam = searchParams.get('error');

  const result = status ? messages[status] : errorParam ? messages[errorParam] : null;

  return (
    <div
      className="max-w-[400px] mx-auto p-10 bg-white rounded-xl text-center"
      style={{ boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
    >
      {result ? (
        <>
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 text-3xl ${iconColors[result.type]}`}
          >
            {iconSymbols[result.type]}
          </div>
          <h1
            className="text-2xl font-semibold mb-3 text-zinc-900"
            style={{ fontFamily: "'Fraunces', Georgia, serif" }}
          >
            {result.title}
          </h1>
          <p className="text-zinc-500 mb-6 leading-relaxed">{result.message}</p>
          <a
            href="/auth/login"
            className="inline-block px-6 py-3 text-white font-semibold rounded-lg transition-opacity hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            }}
          >
            Logg inn
          </a>
          {result.type === 'error' && (
            <a
              href="/auth/registrer"
              className="inline-block ml-2 px-6 py-3 font-semibold rounded-lg transition-colors bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            >
              Registrer på nytt
            </a>
          )}
        </>
      ) : (
        <>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 text-3xl bg-blue-100 text-blue-600">
            ?
          </div>
          <h1
            className="text-2xl font-semibold mb-3 text-zinc-900"
            style={{ fontFamily: "'Fraunces', Georgia, serif" }}
          >
            Bekreft e-postadressen din
          </h1>
          <p className="text-zinc-500 mb-6 leading-relaxed">
            Sjekk innboksen din for en verifiserings-e-post fra Sky Planner.
            Klikk på lenken i e-posten for å bekrefte adressen.
          </p>
          <a
            href="/auth/login"
            className="inline-block px-6 py-3 text-white font-semibold rounded-lg transition-opacity hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            }}
          >
            Gå til innlogging
          </a>
        </>
      )}
    </div>
  );
}

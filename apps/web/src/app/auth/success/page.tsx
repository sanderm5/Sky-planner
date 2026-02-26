import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Registrering fullført',
};

export default function SuccessPage() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.skyplanner.no';

  return (
    <div className="glass-card p-6 text-center">
      <div className="w-16 h-16 rounded-full bg-secondary-500/20 flex items-center justify-center mx-auto mb-6">
        <svg className="w-8 h-8 text-secondary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-white mb-2">Velkommen til Sky Planner!</h1>
      <p className="text-dark-400 mb-8">
        Din konto er opprettet. Du har nå 14 dagers gratis prøveperiode.
      </p>

      <div className="space-y-4">
        <a href={appUrl} className="btn-primary w-full block">
          Gå til applikasjonen
        </a>
        <a href="/auth/login" className="btn-secondary w-full block">
          Logg inn
        </a>
      </div>
    </div>
  );
}

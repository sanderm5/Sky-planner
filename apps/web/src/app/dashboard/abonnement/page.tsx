import { requireAuth } from '@/lib/auth';
import Link from 'next/link';

export const metadata = { title: 'Abonnement' };

const statusLabels: Record<string, { label: string; color: string }> = {
  active: { label: 'Aktiv', color: 'green' },
  trialing: { label: 'Prøveperiode', color: 'blue' },
  past_due: { label: 'Forfalt', color: 'red' },
  canceled: { label: 'Kansellert', color: 'gray' },
  incomplete: { label: 'Ufullstendig', color: 'yellow' },
};

const plans = [
  {
    id: 'standard',
    name: 'Standard',
    price: 499,
    features: [
      'Opptil 200 kunder',
      'Opptil 5 brukere',
      'Interaktivt kart',
      'Ruteoptimalisering',
      'E-postvarsler',
      'Kalender og avtaler',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 999,
    features: [
      'Opptil 500 kunder',
      'Opptil 10 brukere',
      'Alt i Standard',
      'Avansert statistikk',
      'Prioritert support',
      'API-tilgang',
    ],
    recommended: true,
  },
];

function formatDate(dateStr?: string): string {
  if (!dateStr) return 'Ikke tilgjengelig';
  const date = new Date(dateStr);
  return date.toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function statusBadgeClass(color: string): string {
  switch (color) {
    case 'green': return 'bg-green-500/10 text-green-400';
    case 'blue': return 'bg-blue-500/10 text-blue-400';
    case 'red': return 'bg-red-500/10 text-red-400';
    case 'yellow': return 'bg-yellow-500/10 text-yellow-400';
    default: return 'bg-dark-600/50 text-dark-400';
  }
}

export default async function AbonnementPage() {
  const { organization } = await requireAuth();

  const status = statusLabels[organization.subscription_status || ''] || { label: 'Ukjent', color: 'gray' };
  const currentPlan = plans.find(p => p.id === organization.plan_type) || plans[0];

  return (
    <>
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">Abonnement</h1>
        <p className="text-dark-400">Se din abonnementsstatus. Kontakt oss for endringer eller spørsmål.</p>
      </div>

      {/* Current Plan */}
      <div className="glass-card p-6 mb-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-xl font-bold text-white">{currentPlan.name}</h2>
              <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${statusBadgeClass(status.color)}`}>
                {status.label}
              </span>
            </div>
            <p className="text-3xl font-bold text-white">
              {currentPlan.price} <span className="text-lg text-dark-400 font-normal">kr/mnd</span>
            </p>
            <div className="mt-4 space-y-1 text-sm text-dark-400">
              {organization.subscription_status === 'trialing' && organization.trial_ends_at && (
                <p>Prøveperioden utløper: <span className="text-white">{formatDate(organization.trial_ends_at)}</span></p>
              )}
              {organization.current_period_end && (
                <p>Neste fakturering: <span className="text-white">{formatDate(organization.current_period_end)}</span></p>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="mailto:support@skyplanner.no?subject=Abonnement"
              className="btn-primary"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Kontakt oss om abonnement
            </a>
          </div>
        </div>
      </div>

      {/* Plan Features */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-white mb-4">Din plan inkluderer</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {currentPlan.features.map(feature => (
            <div key={feature} className="flex items-center gap-3 p-3 glass-card">
              <svg className="w-5 h-5 text-green-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-dark-200">{feature}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Plan Comparison */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-white mb-4">Sammenlign planer</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {plans.map(plan => (
            <div
              key={plan.id}
              className={`glass-card p-6 relative ${
                plan.id === organization.plan_type ? 'border-primary-500/50' :
                plan.recommended && plan.id !== organization.plan_type ? 'border-blue-500/30' : ''
              }`}
            >
              {plan.recommended && plan.id !== organization.plan_type && (
                <span className="absolute -top-3 left-4 px-3 py-1 bg-blue-500 text-white text-xs font-medium rounded-full">
                  Anbefalt
                </span>
              )}
              {plan.id === organization.plan_type && (
                <span className="absolute -top-3 left-4 px-3 py-1 bg-primary-500 text-white text-xs font-medium rounded-full">
                  Nåværende plan
                </span>
              )}

              <h4 className="text-xl font-bold text-white mb-2">{plan.name}</h4>
              <p className="text-3xl font-bold text-white mb-4">
                {plan.price} <span className="text-lg text-dark-400 font-normal">kr/mnd</span>
              </p>

              <ul className="space-y-2 mb-6">
                {plan.features.map(feature => (
                  <li key={feature} className="flex items-center gap-2 text-dark-300">
                    <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              {plan.id === organization.plan_type ? (
                <button className="w-full btn-secondary" disabled>
                  Nåværende plan
                </button>
              ) : (
                <a
                  href={`mailto:support@skyplanner.no?subject=${plan.id === 'premium' ? 'Oppgradering' : 'Nedgradering'} til ${plan.name}`}
                  className={`w-full text-center block ${plan.id === 'premium' ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {plan.id === 'premium' ? 'Kontakt oss for oppgradering' : 'Kontakt oss for endring'}
                </a>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Usage Stats */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Bruksstatistikk</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-dark-400">Brukere</span>
              <span className="text-white">{organization.max_brukere} maks</span>
            </div>
            <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-500 to-primary-400 rounded-full"
                style={{ width: `${Math.min(100, (1 / organization.max_brukere) * 100)}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-dark-400">Kunder</span>
              <span className="text-white">{organization.max_kunder} maks</span>
            </div>
            <div className="h-2 bg-dark-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full"
                style={{ width: '0%' }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

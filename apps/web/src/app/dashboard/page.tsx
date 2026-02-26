import { requireAuth } from '@/lib/auth';
import * as db from '@skyplanner/database';
import { initDb } from '@/lib/db';
import { StatCard } from '@/components/dashboard/StatCard';
import Link from 'next/link';

export default async function DashboardPage() {
  const { user, organization } = await requireAuth();

  initDb();

  // Fetch stats in parallel
  const [users, kundeCount] = await Promise.all([
    db.getKlienterByOrganization(organization.id),
    db.getKundeCountByOrganization(organization.id),
  ]);
  const activeUsers = users.filter((u: any) => u.aktiv).length;

  // Format subscription status
  const statusLabels: Record<string, string> = {
    active: 'Aktiv',
    trialing: 'Prøveperiode',
    past_due: 'Forfalt',
    canceled: 'Kansellert',
    incomplete: 'Ufullstendig',
  };

  const subscriptionStatus =
    statusLabels[organization.subscription_status || ''] || 'Ukjent';

  // Format next billing date
  let nextBillingDate = 'Ikke tilgjengelig';
  if (organization.current_period_end) {
    const date = new Date(organization.current_period_end);
    nextBillingDate = date.toLocaleDateString('nb-NO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  // Plan pricing
  const planPrices: Record<string, number> = {
    standard: 499,
    premium: 999,
    enterprise: 2499,
  };
  const monthlyPrice = planPrices[organization.plan_type] || 0;

  // Enterprise lifetime (TRE Allservice) - hide billing
  const isEnterprise = organization.app_mode === 'full';

  return (
    <>
      {/* Launch App Banner */}
      <div className="mb-8 glass-card p-6 bg-gradient-to-r from-primary-500/10 to-accent-purple/10 border-primary-500/30">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            {organization.logo_url ? (
              <img
                src={organization.logo_url}
                alt={organization.navn}
                className="w-14 h-14 rounded-xl object-cover bg-dark-700"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary-500 to-accent-purple flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                  />
                </svg>
              </div>
            )}
            <div>
              <h2 className="text-xl font-bold text-white">
                {organization.navn}
              </h2>
              <p className="text-dark-400">
                Klar til å starte? Gå til applikasjonen for å administrere
                kunder og ruter.
              </p>
            </div>
          </div>
          <a
            href="/api/auth/sso-launch"
            className="btn-primary text-lg px-8 py-4 shadow-glow-orange flex items-center gap-3 group"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Launch
            <svg
              className="w-5 h-5 group-hover:translate-x-1 transition-transform"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </a>
        </div>
      </div>

      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-2">
          Velkommen, {user.navn.split(' ')[0]}
        </h1>
        <p className="text-dark-400">
          Her er en oversikt over din organisasjon.
        </p>
      </div>

      {/* Stats Grid */}
      <div
        className={`grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 ${!isEnterprise ? 'lg:grid-cols-4' : ''}`}
      >
        <StatCard
          title="Brukere"
          value={`${activeUsers} / ${organization.max_brukere}`}
          description="Aktive brukere"
          icon="users"
          href="/dashboard/brukere"
        />
        {!isEnterprise && (
          <StatCard
            title="Abonnement"
            value={
              organization.plan_type.charAt(0).toUpperCase() +
              organization.plan_type.slice(1)
            }
            description={subscriptionStatus}
            icon="credit-card"
            href="/dashboard/abonnement"
          />
        )}
        {!isEnterprise && (
          <StatCard
            title="Neste faktura"
            value={`${monthlyPrice} kr`}
            description={nextBillingDate}
            icon="document"
            href="/dashboard/fakturaer"
          />
        )}
        <StatCard
          title="Kunder"
          value={`${kundeCount} / ${organization.max_kunder}`}
          description="Antall kunder"
          icon="chart"
        />
      </div>

      {/* Quick Actions */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">
          Hurtighandlinger
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link
            href="/dashboard/brukere"
            className="glass-card glass-card-hover p-4 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                />
              </svg>
            </div>
            <div>
              <p className="text-white font-medium">Inviter bruker</p>
              <p className="text-sm text-dark-400">Legg til en ny bruker</p>
            </div>
          </Link>

          {!isEnterprise && (
            <Link
              href="/dashboard/abonnement"
              className="glass-card glass-card-hover p-4 flex items-center gap-4"
            >
              <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center text-green-400">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                  />
                </svg>
              </div>
              <div>
                <p className="text-white font-medium">Oppgrader plan</p>
                <p className="text-sm text-dark-400">Få flere funksjoner</p>
              </div>
            </Link>
          )}

          <Link
            href="/dashboard/innstillinger"
            className="glass-card glass-card-hover p-4 flex items-center gap-4"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
            <div>
              <p className="text-white font-medium">Innstillinger</p>
              <p className="text-sm text-dark-400">Tilpass organisasjonen</p>
            </div>
          </Link>
        </div>
      </div>

      {/* Subscription Alert (if trialing or past due) */}
      {!isEnterprise &&
        (organization.subscription_status === 'trialing' ||
          organization.subscription_status === 'past_due') && (
          <div
            className={`glass-card p-4 flex items-start gap-4 ${
              organization.subscription_status === 'trialing'
                ? 'border-blue-500/30'
                : 'border-red-500/30'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                organization.subscription_status === 'trialing'
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'bg-red-500/10 text-red-400'
              }`}
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="flex-1">
              {organization.subscription_status === 'trialing' ? (
                <>
                  <p className="text-white font-medium">
                    Du er i prøveperioden
                  </p>
                  <p className="text-sm text-dark-400">
                    Prøveperioden utløper{' '}
                    {organization.trial_ends_at
                      ? new Date(organization.trial_ends_at).toLocaleDateString(
                          'nb-NO',
                          { day: 'numeric', month: 'long' }
                        )
                      : 'snart'}
                    . Legg til betalingsmetode for å fortsette etter
                    prøveperioden.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-white font-medium">Betaling forfalt</p>
                  <p className="text-sm text-dark-400">
                    Vi kunne ikke trekke betalingen din. Oppdater
                    betalingsmetoden for å unngå avbrudd i tjenesten.
                  </p>
                </>
              )}
            </div>
            <Link
              href="/dashboard/abonnement"
              className="btn-primary text-sm px-4 py-2"
            >
              Administrer
            </Link>
          </div>
        )}
    </>
  );
}

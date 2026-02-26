import type { Metadata } from 'next';
import Link from 'next/link';
import GlassCard from '@/components/ui/GlassCard';
import Badge from '@/components/ui/Badge';
import CTA from '@/components/sections/CTA';

export const metadata: Metadata = {
  title: 'Priser',
  description: 'Se våre prisplaner for Sky Planner. Start med 14 dagers gratis prøveperiode.',
};

const plans = [
  {
    name: 'Standard',
    price: '499',
    description: 'Perfekt for mindre bedrifter som kommer i gang',
    featured: false,
    features: [
      { name: 'Opptil 200 kunder', included: true },
      { name: 'Opptil 5 brukere', included: true },
      { name: 'Interaktivt kart', included: true },
      { name: 'Ruteoptimalisering', included: true },
      { name: 'Automatiske varsler', included: true },
      { name: 'Kalender og avtaler', included: true },
      { name: 'E-postvarsler', included: true },
      { name: 'API-tilgang', included: false },
      { name: 'Prioritert support', included: false },
    ],
  },
  {
    name: 'Premium',
    price: '999',
    description: 'For voksende bedrifter med flere kunder',
    featured: true,
    features: [
      { name: 'Opptil 500 kunder', included: true },
      { name: 'Opptil 10 brukere', included: true },
      { name: 'Interaktivt kart', included: true },
      { name: 'Ruteoptimalisering', included: true },
      { name: 'Automatiske varsler', included: true },
      { name: 'Kalender og avtaler', included: true },
      { name: 'E-postvarsler', included: true },
      { name: 'API-tilgang', included: true },
      { name: 'Prioritert support', included: true },
    ],
  },
];

const comparisonFeatures = [
  { name: 'Antall kunder', standard: '200', premium: '500', enterprise: 'Ubegrenset' },
  { name: 'Antall brukere', standard: '5', premium: '10', enterprise: 'Ubegrenset' },
  { name: 'Interaktivt kart', standard: true, premium: true, enterprise: true },
  { name: 'Ruteoptimalisering', standard: true, premium: true, enterprise: true },
  { name: 'Automatiske varsler', standard: true, premium: true, enterprise: true },
  { name: 'Kalender og avtaler', standard: true, premium: true, enterprise: true },
  { name: 'E-postvarsler', standard: true, premium: true, enterprise: true },
  { name: 'Kontaktlogg', standard: true, premium: true, enterprise: true },
  { name: 'API-tilgang', standard: false, premium: true, enterprise: true },
  { name: 'Prioritert support', standard: false, premium: true, enterprise: true },
  { name: 'Dedikert kontakt', standard: false, premium: false, enterprise: true },
  { name: 'Tilpasset oppsett', standard: false, premium: false, enterprise: true },
];

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
    </svg>
  );
}

function TableCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function TableXIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

function renderCellValue(value: boolean | string, highlight?: boolean) {
  if (typeof value === 'boolean') {
    return value ? (
      <TableCheckIcon className="w-5 h-5 text-secondary-500 mx-auto" />
    ) : (
      <TableXIcon className="w-5 h-5 text-dark-600 mx-auto" />
    );
  }
  return (
    <span className={highlight ? 'text-primary-400 font-medium' : 'text-dark-300'}>
      {value}
    </span>
  );
}

export default function PriserPage() {
  return (
    <>
      {/* Hero Section */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="container-wide text-center">
          <Badge className="mb-6">14 dagers gratis prøveperiode</Badge>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Enkel og transparent prising
          </h1>
          <p className="text-lg text-dark-300 max-w-2xl mx-auto">
            Velg planen som passer din bedrift. Alle planer inkluderer full tilgang i prøveperioden.
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="pb-20 px-4 sm:px-6 lg:px-8">
        <div className="container-wide">
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`pricing-card relative${plan.featured ? ' featured' : ''}`}
              >
                {plan.featured && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <Badge variant="success">Mest populær</Badge>
                  </div>
                )}

                <div className="text-center mb-8">
                  <h3 className="text-2xl font-bold text-white mb-2">{plan.name}</h3>
                  <p className="text-dark-400 mb-4">{plan.description}</p>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="price">{plan.price}</span>
                    <span className="period">kr/mnd</span>
                  </div>
                </div>

                <ul className="space-y-4 mb-8">
                  {plan.features.map((feature) => (
                    <li key={feature.name} className="flex items-center gap-3">
                      {feature.included ? (
                        <CheckIcon className="w-5 h-5 text-secondary-500 flex-shrink-0" />
                      ) : (
                        <XIcon className="w-5 h-5 text-dark-600 flex-shrink-0" />
                      )}
                      <span className={feature.included ? 'text-dark-200' : 'text-dark-400'}>
                        {feature.name}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link
                  href="/auth/registrer"
                  className={`block w-full text-center py-3 rounded-xl font-semibold transition-all ${
                    plan.featured ? 'btn-primary' : 'btn-secondary'
                  }`}
                >
                  Start gratis prøveperiode
                </Link>
              </div>
            ))}
          </div>

          {/* Enterprise CTA */}
          <div className="mt-12 text-center">
            <GlassCard className="max-w-2xl mx-auto">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white mb-1">Enterprise</h3>
                  <p className="text-dark-400">Trenger du mer? Kontakt oss for en tilpasset løsning.</p>
                </div>
                <Link href="/kontakt" className="btn-secondary whitespace-nowrap">
                  Kontakt oss
                </Link>
              </div>
            </GlassCard>
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="section bg-dark-950/30">
        <div className="container-wide">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            Sammenlign alle funksjoner
          </h2>

          <div className="comparison-table overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr>
                  <th scope="col" className="text-left">Funksjon</th>
                  <th scope="col" className="text-center">Standard</th>
                  <th scope="col" className="text-center text-primary-400">Premium</th>
                  <th scope="col" className="text-center">Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {comparisonFeatures.map((feature) => (
                  <tr key={feature.name}>
                    <td className="text-dark-200">{feature.name}</td>
                    <td className="text-center">
                      {renderCellValue(feature.standard)}
                    </td>
                    <td className="text-center">
                      {renderCellValue(feature.premium, true)}
                    </td>
                    <td className="text-center">
                      {renderCellValue(feature.enterprise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="section">
        <div className="container-narrow">
          <h2 className="text-3xl font-bold text-white text-center mb-12">
            Ofte stilte spørsmål om priser
          </h2>

          <div className="space-y-4">
            <GlassCard>
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer list-none p-2">
                  <span className="font-medium text-white">Kan jeg bytte plan senere?</span>
                  <svg className="w-5 h-5 text-dark-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <p className="text-dark-400 mt-4 pt-4 border-t border-dark-700/50">
                  Ja, du kan oppgradere eller nedgradere planen din når som helst. Kontakt oss så hjelper vi deg med endringen.
                </p>
              </details>
            </GlassCard>

            <GlassCard>
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer list-none p-2">
                  <span className="font-medium text-white">Hva skjer etter prøveperioden?</span>
                  <svg className="w-5 h-5 text-dark-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <p className="text-dark-400 mt-4 pt-4 border-t border-dark-700/50">
                  Etter 14 dager kontakter vi deg for å avtale videre abonnement. Du får tilsendt et tilbud tilpasset dine behov.
                </p>
              </details>
            </GlassCard>

            <GlassCard>
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer list-none p-2">
                  <span className="font-medium text-white">Tilbyr dere rabatt for årlig betaling?</span>
                  <svg className="w-5 h-5 text-dark-400 group-open:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <p className="text-dark-400 mt-4 pt-4 border-t border-dark-700/50">
                  Ja! Ved årlig betaling får du 2 måneder gratis. Kontakt oss for mer informasjon.
                </p>
              </details>
            </GlassCard>
          </div>

          <div className="text-center mt-8">
            <Link href="/faq" className="text-primary-400 hover:text-primary-300 font-medium">
              Se alle spørsmål og svar &rarr;
            </Link>
          </div>
        </div>
      </section>

      <CTA />
    </>
  );
}

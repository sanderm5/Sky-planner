import Link from 'next/link';
import clsx from 'clsx';
import Badge from '../ui/Badge';

const plans = [
  {
    name: 'Standard',
    price: '499',
    description: 'For mindre bedrifter',
    featured: false,
    highlights: ['Opptil 200 kunder', 'Opptil 5 brukere', 'Ruteoptimalisering', 'Automatiske varsler'],
  },
  {
    name: 'Premium',
    price: '999',
    description: 'For voksende bedrifter',
    featured: true,
    highlights: ['Opptil 500 kunder', 'Opptil 10 brukere', 'Alt i Standard', 'API-tilgang + Prioritert support'],
  },
];

export default function PricingPreview() {
  return (
    <section className="section relative overflow-hidden">
      <div className="absolute top-1/2 -translate-y-1/2 -left-24 w-[350px] h-[350px] bg-gradient-radial from-primary-500/[0.04] to-transparent rounded-full filter blur-[80px] pointer-events-none" aria-hidden="true"></div>
      <div className="container-wide relative">
        <div className="text-center mb-12">
          <Badge className="mb-4" data-animate="fade-up">14 dagers gratis prøveperiode</Badge>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4" data-animate="fade-up" data-animate-delay="100">
            Enkel og transparent prising
          </h2>
          <p className="text-lg text-dark-300 max-w-2xl mx-auto" data-animate="fade-up" data-animate-delay="200">
            Velg planen som passer din bedrift. Ingen skjulte kostnader.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto" data-animate-stagger="">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={clsx(
                'glass-card p-6 sm:p-8 relative',
                plan.featured && 'ring-2 ring-primary-500'
              )}
              data-animate="fade-up"
            >
              {plan.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge variant="success">Mest populær</Badge>
                </div>
              )}

              <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-white mb-1">{plan.name}</h3>
                <p className="text-dark-400 text-sm mb-4">{plan.description}</p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-4xl font-bold text-white">{plan.price}</span>
                  <span className="text-dark-400">kr/mnd</span>
                </div>
              </div>

              <ul className="space-y-3 mb-6">
                {plan.highlights.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-dark-200">
                    <svg className="w-5 h-5 text-secondary-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href={`/auth/registrer?plan=${plan.name.toLowerCase()}`}
                className={clsx(
                  'block w-full text-center py-3 rounded-xl font-semibold transition-all',
                  plan.featured ? 'btn-primary' : 'btn-secondary'
                )}
              >
                Kom i gang
              </Link>
            </div>
          ))}
        </div>

        <div className="text-center mt-8" data-animate="fade-up">
          <Link href="/priser" className="text-primary-400 hover:text-primary-300 font-medium inline-flex items-center gap-2">
            Se full prisoversikt og sammenligning
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

import Link from 'next/link';

const steps = [
  {
    number: '1',
    title: 'Registrer deg gratis',
    description: 'Opprett konto på under 2 minutter. Ingen kredittkort påkrevd.',
    icon: 'user-plus',
  },
  {
    number: '2',
    title: 'Legg inn kundene dine',
    description: 'Importer fra Excel eller legg til manuelt. Se alle på kartet umiddelbart.',
    icon: 'upload',
  },
  {
    number: '3',
    title: 'Planlegg og optimaliser',
    description: 'Velg kunder, generer optimal rute, og naviger direkte fra appen.',
    icon: 'route',
  },
];

export default function HowItWorks() {
  return (
    <section className="section relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary-500/15 to-transparent" aria-hidden="true"></div>
      <div className="container-wide relative">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4" data-animate="fade-up">
            Kom i gang på 3 enkle steg
          </h2>
          <p className="text-lg text-dark-300 max-w-2xl mx-auto" data-animate="fade-up" data-animate-delay="100">
            Fra registrering til optimaliserte ruter – raskere enn du tror
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 lg:gap-12" data-animate-stagger="">
          {steps.map((step, index) => (
            <div key={step.number} className="relative" data-animate="fade-up">
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-0.5 bg-gradient-to-r from-primary-500/50 to-transparent"></div>
              )}

              <div className="glass-card p-8 text-center relative">
                {/* Step number */}
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center mx-auto mb-6 text-2xl font-bold text-white shadow-lg shadow-primary-500/25">
                  {step.number}
                </div>

                <h3 className="text-xl font-semibold text-white mb-3">
                  {step.title}
                </h3>
                <p className="text-dark-300">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center mt-12" data-animate="fade-up">
          <Link href="/auth/registrer" className="btn-primary text-lg px-8 py-4">
            Start gratis i dag
            <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

import Link from 'next/link';
import GlassCard from '../ui/GlassCard';
import FeatureIcon from '../ui/FeatureIcon';

const features = [
  {
    icon: 'map' as const,
    title: 'Interaktivt kart',
    description: 'Se alle dine kunder på et oversiktlig kart med markører og clustering. Klikk for detaljer og navigasjon.',
  },
  {
    icon: 'route' as const,
    title: 'Ruteoptimalisering',
    description: 'Planlegg effektive serviceturer med automatisk optimalisering. Eksporter til Google Maps eller Apple Maps.',
  },
  {
    icon: 'bell' as const,
    title: 'Automatiske varsler',
    description: 'Få varsler før kontrollfrister utløper. Aldri gå glipp av en kunde som trenger oppfølging.',
  },
  {
    icon: 'calendar' as const,
    title: 'Kalender og avtaler',
    description: 'Planlegg avtaler og se oversikt i en integrert kalender. Koble avtaler direkte til kunder.',
  },
  {
    icon: 'document' as const,
    title: 'Kontaktlogg',
    description: 'Hold oversikt over all kundekontakt. Registrer telefonsamtaler, e-poster, besøk og notater.',
  },
  {
    icon: 'phone' as const,
    title: 'Mobilvennlig',
    description: 'Bruk systemet på mobil, nettbrett eller PC. Responsivt design som fungerer overalt.',
  },
];

export default function Features() {
  return (
    <section className="section bg-dark-950/30 relative overflow-hidden" id="features">
      {/* Subtle aurora glow */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary-500/20 to-transparent" aria-hidden="true"></div>
      <div className="absolute -top-32 left-1/3 w-[500px] h-[300px] bg-gradient-radial from-primary-500/[0.04] to-transparent rounded-full filter blur-[80px] pointer-events-none" aria-hidden="true"></div>
      <div className="absolute -bottom-32 right-1/4 w-[400px] h-[250px] bg-gradient-radial from-accent-frost/[0.03] to-transparent rounded-full filter blur-[80px] pointer-events-none" aria-hidden="true"></div>
      <div className="container-wide relative">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4" data-animate="fade-up">
            Alt du trenger for effektiv kundehåndtering
          </h2>
          <p className="text-lg text-dark-300 max-w-2xl mx-auto" data-animate="fade-up" data-animate-delay="100">
            Skyplanner gir deg verktøyene du trenger for å holde oversikt over kunder,
            planlegge ruter og sikre at ingen oppgaver blir glemt.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6" data-animate-stagger="">
          {features.map((feature) => (
            <GlassCard key={feature.title} hover className="group" data-animate="fade-up">
              <FeatureIcon icon={feature.icon} className="mb-4 group-hover:scale-110 transition-transform" />
              <h3 className="text-xl font-semibold text-white mb-2">
                {feature.title}
              </h3>
              <p className="text-dark-400">
                {feature.description}
              </p>
            </GlassCard>
          ))}
        </div>

        <div className="text-center mt-12" data-animate="fade-up">
          <Link href="/funksjoner" className="btn-secondary">
            Se alle funksjoner
            <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

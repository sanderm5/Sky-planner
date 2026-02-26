import Link from 'next/link';
import GlassCard from '../ui/GlassCard';

const faqs = [
  {
    q: 'Hva er Sky Planner?',
    a: 'Sky Planner er et skybasert system for kundeadministrasjon og ruteplanlegging, spesielt utviklet for servicebedrifter. Systemet hjelper deg å holde oversikt over kunder, planlegge effektive ruter, og sikre at ingen kontroller blir glemt.',
  },
  {
    q: 'Kan jeg prøve gratis?',
    a: 'Ja! Alle nye kunder får 14 dagers gratis prøveperiode med full tilgang til alle funksjoner. Du trenger ikke oppgi kredittkort for å starte.',
  },
  {
    q: 'Fungerer det på mobil?',
    a: 'Ja, Sky Planner er fullt responsivt og fungerer utmerket på mobil og nettbrett. Du kan se kart, oppdatere kunder, og navigere til adresser direkte fra mobilen.',
  },
  {
    q: 'Kan jeg importere eksisterende kundedata?',
    a: 'Ja, du kan importere kunder fra CSV eller Excel-filer. Systemet støtter de vanligste formatene og hjelper deg å matche kolonner med riktige felter.',
  },
];

export default function FaqPreview() {
  return (
    <section className="section bg-dark-950/30 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-frost/15 to-transparent" aria-hidden="true"></div>
      <div className="container-narrow relative">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4" data-animate="fade-up">
            Ofte stilte spørsmål
          </h2>
          <p className="text-lg text-dark-300" data-animate="fade-up" data-animate-delay="100">
            Svar på de vanligste spørsmålene om Sky Planner
          </p>
        </div>

        <div className="space-y-4" data-animate-stagger="">
          {faqs.map((faq) => (
            <GlassCard key={faq.q} data-animate="fade-up">
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer list-none">
                  <span className="font-medium text-white pr-4">{faq.q}</span>
                  <svg className="w-5 h-5 text-dark-400 group-open:rotate-180 transition-transform flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </summary>
                <p className="text-dark-300 mt-4 pt-4 border-t border-dark-700/50 leading-relaxed">
                  {faq.a}
                </p>
              </details>
            </GlassCard>
          ))}
        </div>

        <div className="text-center mt-8">
          <Link href="/faq" className="text-primary-400 hover:text-primary-300 font-medium inline-flex items-center gap-2">
            Se alle spørsmål og svar
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

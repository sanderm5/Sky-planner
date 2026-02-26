import type { Metadata } from 'next';
import Link from 'next/link';
import Schema from '@/components/seo/Schema';
import GlassCard from '@/components/ui/GlassCard';
import Badge from '@/components/ui/Badge';
import CTA from '@/components/sections/CTA';

export const metadata: Metadata = {
  title: 'FAQ',
  description: 'Ofte stilte spørsmål om Sky Planner. Finn svar på spørsmål om priser, funksjoner, sikkerhet og mer.',
};

const faqCategories = [
  {
    name: 'Generelt',
    questions: [
      {
        q: 'Hva er Sky Planner?',
        a: 'Sky Planner er et skybasert system for kundeadministrasjon og ruteplanlegging, spesielt utviklet for bedrifter som jobber med el-kontroll og brannvarsling. Systemet hjelper deg å holde oversikt over kunder, planlegge effektive serviceruter, og sikre at ingen kontroller blir glemt.',
      },
      {
        q: 'Hvem er Sky Planner for?',
        a: 'Sky Planner er laget for bedrifter som utfører periodiske kontroller hos kunder, som el-kontroll, brannvarsling, brannsikring, og lignende tjenester. Systemet passer for alt fra enkeltpersonforetak til større bedrifter med flere ansatte.',
      },
      {
        q: 'Trenger jeg å installere noe?',
        a: 'Nei, Sky Planner er en nettbasert løsning som fungerer i nettleseren din. Du trenger bare internettilgang og en moderne nettleser. Systemet fungerer på PC, Mac, nettbrett og mobil.',
      },
    ],
  },
  {
    name: 'Priser og betaling',
    questions: [
      {
        q: 'Hvor mye koster Sky Planner?',
        a: 'Vi har to hovedplaner: Standard (499 kr/mnd) for opptil 200 kunder og 5 brukere, og Premium (999 kr/mnd) for opptil 500 kunder og 10 brukere. Se vår prisside for full oversikt over hva som er inkludert i hver plan.',
      },
      {
        q: 'Kan jeg prøve gratis?',
        a: 'Ja! Alle nye kunder får 14 dagers gratis prøveperiode med full tilgang til alle funksjoner. Du trenger ikke oppgi kredittkort for å starte prøveperioden.',
      },
      {
        q: 'Hva skjer etter prøveperioden?',
        a: 'Etter 14 dager vil abonnementet starte automatisk hvis du har lagt inn betalingsinformasjon. Hvis ikke, vil kontoen bli satt på pause til du aktiverer et abonnement. Du mister ingen data.',
      },
      {
        q: 'Kan jeg bytte plan?',
        a: 'Ja, du kan oppgradere eller nedgradere planen din når som helst. Ved oppgradering får du umiddelbart tilgang til de nye funksjonene. Ved nedgradering trer endringen i kraft ved neste faktureringsperiode.',
      },
      {
        q: 'Tilbyr dere rabatt for årlig betaling?',
        a: 'Ja! Ved årlig betaling får du 2 måneder gratis, som tilsvarer ca. 17% rabatt. Kontakt oss for å sette opp årlig fakturering.',
      },
    ],
  },
  {
    name: 'Funksjoner',
    questions: [
      {
        q: 'Hvordan fungerer ruteoptimaliseringen?',
        a: 'Ruteoptimaliseringen bruker avanserte algoritmer for å beregne den mest effektive rekkefølgen å besøke kundene dine i. Du velger hvilke kunder du skal besøke, og systemet foreslår optimal rute basert på avstand og kjøretid. Du kan deretter eksportere ruten til Google Maps eller Apple Maps.',
      },
      {
        q: 'Kan jeg importere eksisterende kundedata?',
        a: 'Ja, du kan importere kunder fra CSV eller Excel-filer. Systemet støtter de vanligste formatene og hjelper deg å matche kolonner med riktige felter.',
      },
      {
        q: 'Fungerer det på mobil?',
        a: 'Ja, Sky Planner er fullt responsivt og fungerer utmerket på mobil og nettbrett. Du kan se kart, oppdatere kunder, og navigere til adresser direkte fra mobilen.',
      },
      {
        q: 'Kan flere ansatte bruke systemet samtidig?',
        a: 'Ja, avhengig av planen din kan du ha flere brukere. Standard-planen inkluderer 5 brukere, og Premium inkluderer 10. Alle brukere kan jobbe samtidig med delt tilgang til kundedata.',
      },
    ],
  },
  {
    name: 'Sikkerhet og personvern',
    questions: [
      {
        q: 'Hvor lagres dataene mine?',
        a: 'Alle data lagres sikkert i skyen hos Supabase, med servere i EU. Vi bruker kryptering for data i transit og i hvile, og følger beste praksis for datasikkerhet.',
      },
      {
        q: 'Er Sky Planner GDPR-kompatibelt?',
        a: 'Ja, vi tar personvern på alvor og følger GDPR-regelverket. Du kan lese vår personvernerklæring for fullstendige detaljer om hvordan vi behandler data.',
      },
      {
        q: 'Hvem har tilgang til dataene mine?',
        a: 'Kun du og brukerne du gir tilgang til kan se dine kundedata. Vårt supportteam kan få begrenset tilgang for å hjelpe deg ved behov, men kun etter din godkjenning.',
      },
    ],
  },
  {
    name: 'Support',
    questions: [
      {
        q: 'Hvordan kontakter jeg support?',
        a: 'Du kan kontakte oss via e-post på support@skyplanner.no, eller bruk kontaktskjemaet på nettsiden. Premium-kunder har også tilgang til prioritert support med raskere responstid.',
      },
      {
        q: 'Tilbyr dere opplæring?',
        a: 'Ja, vi tilbyr gratis onboarding for nye kunder. Dette inkluderer en gjennomgang av systemet og hjelp med oppsett. Vi har også videoguider og dokumentasjon tilgjengelig.',
      },
    ],
  },
];

const allFaqItems = faqCategories.flatMap((cat) =>
  cat.questions.map((faq) => ({ question: faq.q, answer: faq.a }))
);

export default function FaqPage() {
  return (
    <>
      <Schema type="faq" faqItems={allFaqItems} />

      {/* Hero Section */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="container-wide text-center">
          <Badge className="mb-6">Hjelp</Badge>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Ofte stilte spørsmål
          </h1>
          <p className="text-lg text-dark-300 max-w-2xl mx-auto">
            Finn svar på de vanligste spørsmålene om Sky Planner. Finner du ikke det du leter etter?{' '}
            <Link href="/kontakt" className="text-primary-400 hover:text-primary-300">Kontakt oss</Link>.
          </p>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="pb-20 px-4 sm:px-6 lg:px-8">
        <div className="container-narrow">
          {faqCategories.map((category) => (
            <div key={category.name} className="mb-12">
              <h2 className="text-2xl font-bold text-white mb-6">{category.name}</h2>
              <div className="space-y-4">
                {category.questions.map((faq) => (
                  <GlassCard key={faq.q}>
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
            </div>
          ))}
        </div>
      </section>

      {/* Contact CTA */}
      <section className="section bg-dark-950/30">
        <div className="container-narrow text-center">
          <GlassCard>
            <svg className="w-12 h-12 text-primary-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-2xl font-bold text-white mb-2">Fant du ikke svaret?</h2>
            <p className="text-dark-300 mb-6">
              Vårt supportteam hjelper deg gjerne med spørsmål
            </p>
            <Link href="/kontakt" className="btn-primary">
              Kontakt oss
            </Link>
          </GlassCard>
        </div>
      </section>

      <CTA />
    </>
  );
}

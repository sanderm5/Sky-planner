import type { Metadata } from 'next';
import GlassCard from '@/components/ui/GlassCard';
import Badge from '@/components/ui/Badge';
import CTA from '@/components/sections/CTA';

export const metadata: Metadata = {
  title: 'Funksjoner',
  description: 'Utforsk alle funksjonene i Sky Planner - interaktivt kart, ruteoptimalisering, automatiske varsler og mer.',
};

const features = [
  {
    id: 'kart',
    title: 'Interaktivt kundekart',
    description: 'Se alle dine kunder plottet på et oversiktlig kart. Bruk clustering for store datamengder, filtrer etter status, og naviger direkte til kunder.',
    highlights: [
      'Automatisk clustering for mange kunder',
      'Fargekoding etter kontrollstatus',
      'Click-to-navigate til Google Maps / Apple Maps',
      'Tegn egne områder for filtrering',
      'Søk og finn kunder raskt',
    ],
    screenshot: '/screenshots/screenshot-map-detail.jpg',
  },
  {
    id: 'ruter',
    title: 'Ruteoptimalisering',
    description: 'Planlegg effektive serviceturer med automatisk ruteoptimalisering. Spar tid og drivstoff med optimale kjøreruter.',
    highlights: [
      'Automatisk beregning av optimal rekkefølge',
      'Eksporter til Google Maps eller Apple Maps',
      'Lagre og gjenbruk ruter',
      'Se estimert kjøretid og avstand',
      'Håndter flere stopp per tur',
    ],
    screenshot: '/screenshots/screenshot-route-planning.jpg',
  },
  {
    id: 'varsler',
    title: 'Automatiske varsler',
    description: 'Få varsler før kontrollfrister utløper. Systemet holder oversikt så du slipper å huske alt selv.',
    highlights: [
      'Varsler X dager før frist',
      'E-postvarsler til deg og kunden',
      'Dashboard med kommende frister',
      'Prioriteringsliste etter hastegrad',
      'Aldri gå glipp av en kontroll igjen',
    ],
    screenshot: null,
  },
  {
    id: 'kalender',
    title: 'Kalender og avtaler',
    description: 'Planlegg avtaler og se oversikt i en integrert kalender. Koble avtaler direkte til kunder for full sporbarhet.',
    highlights: [
      'Månedsvisning med alle avtaler',
      'Dra-og-slipp for å flytte avtaler',
      'Koble avtaler til kunder',
      'Fargekoding etter type',
      'Påminnelser for avtaler',
    ],
    screenshot: '/screenshots/screenshot-calendar.jpg',
  },
  {
    id: 'kontaktlogg',
    title: 'Kontaktlogg',
    description: 'Hold full oversikt over all kundekontakt. Registrer telefonsamtaler, e-poster, besøk og notater.',
    highlights: [
      'Komplett historikk per kunde',
      'Kategorisering av kontakttype',
      'Søk i notater og historikk',
      'Tidslinje-visning',
      'Delt tilgang for teamet',
    ],
    screenshot: null,
  },
  {
    id: 'epost',
    title: 'E-postvarsler',
    description: 'Send automatiske påminnelser til kunder før kontroller. Profesjonelle maler som du kan tilpasse.',
    highlights: [
      'Automatiske påminnelser',
      'Tilpassbare e-postmaler',
      'Sporbarhet på sendte e-poster',
      'Batch-utsending til flere',
      'Personaliserte meldinger',
    ],
    screenshot: null,
  },
];

function CheckIcon() {
  return (
    <svg className="w-6 h-6 text-secondary-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
    </svg>
  );
}

export default function FunksjonerPage() {
  return (
    <>
      {/* Hero Section */}
      <section className="pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="container-wide text-center">
          <Badge className="mb-6">Alt du trenger</Badge>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Kraftige funksjoner for <span className="gradient-text">effektiv kundehåndtering</span>
          </h1>
          <p className="text-lg text-dark-300 max-w-2xl mx-auto">
            Sky Planner er bygget for bedrifter som jobber med el-kontroll og brannvarsling.
            Her er funksjonene som gjør hverdagen enklere.
          </p>
        </div>
      </section>

      {/* Features Detail */}
      <section className="pb-20 px-4 sm:px-6 lg:px-8">
        <div className="container-wide">
          <div className="space-y-32">
            {features.map((feature, index) => (
              <div
                key={feature.id}
                id={feature.id}
                className={`grid lg:grid-cols-2 gap-12 items-center${index % 2 === 1 ? ' lg:flex-row-reverse' : ''}`}
              >
                {/* Content */}
                <div className={index % 2 === 1 ? 'lg:order-2' : undefined}>
                  <Badge className="mb-4">{feature.title}</Badge>
                  <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                    {feature.title}
                  </h2>
                  <p className="text-lg text-dark-300 mb-8">
                    {feature.description}
                  </p>
                  <ul className="space-y-4">
                    {feature.highlights.map((highlight) => (
                      <li key={highlight} className="flex items-start gap-3">
                        <CheckIcon />
                        <span className="text-dark-200">{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Screenshot */}
                <div className={index % 2 === 1 ? 'lg:order-1' : undefined}>
                  <GlassCard padding="none" className="overflow-hidden aspect-video">
                    {feature.screenshot ? (
                      <img
                        src={feature.screenshot}
                        alt={`Skjermbilde av ${feature.title}`}
                        className="w-full h-full object-cover object-top"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-primary-500/20 to-accent-purple/20 flex items-center justify-center">
                        <div className="text-center p-8">
                          <div className="w-16 h-16 rounded-2xl bg-primary-500/20 flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8 text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                          </div>
                          <p className="text-dark-400 text-sm">Skjermbilde kommer snart</p>
                          <p className="text-dark-400 text-xs mt-1">{feature.title}</p>
                        </div>
                      </div>
                    )}
                  </GlassCard>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Additional Features Grid */}
      <section className="section bg-dark-950/30">
        <div className="container-wide">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">Og mye mer...</h2>
            <p className="text-dark-300">Flere funksjoner som gjør hverdagen enklere</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <GlassCard hover>
              <svg className="w-8 h-8 text-primary-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <h3 className="font-semibold text-white mb-1">Mobilvennlig</h3>
              <p className="text-sm text-dark-400">Fungerer på alle enheter</p>
            </GlassCard>

            <GlassCard hover>
              <svg className="w-8 h-8 text-primary-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <h3 className="font-semibold text-white mb-1">Import/Export</h3>
              <p className="text-sm text-dark-400">CSV og Excel-støtte</p>
            </GlassCard>

            <GlassCard hover>
              <svg className="w-8 h-8 text-primary-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <h3 className="font-semibold text-white mb-1">Flere brukere</h3>
              <p className="text-sm text-dark-400">Delt tilgang for teamet</p>
            </GlassCard>

            <GlassCard hover>
              <svg className="w-8 h-8 text-primary-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <h3 className="font-semibold text-white mb-1">Sikker lagring</h3>
              <p className="text-sm text-dark-400">Kryptert og GDPR-kompatibel</p>
            </GlassCard>
          </div>
        </div>
      </section>

      <CTA />
    </>
  );
}

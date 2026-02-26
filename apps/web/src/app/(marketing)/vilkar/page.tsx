import type { Metadata } from 'next';
import Link from 'next/link';
import GlassCard from '@/components/ui/GlassCard';

export const metadata: Metadata = {
  title: 'Brukervilkår',
  description: 'Les brukervilkårene for Sky Planner - kundeadministrasjon og ruteplanlegging for servicebedrifter.',
};

export default function VilkarPage() {
  return (
    <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
      <div className="container-narrow">
        <h1 className="text-4xl font-bold text-white mb-4">Brukervilkår</h1>
        <p className="text-dark-400 mb-8">for Sky Planner &ndash; levert av Efffekt AS</p>

        <GlassCard className="prose prose-invert max-w-none">
          <p className="text-dark-300 mb-6">
            Sist oppdatert: Februar 2026
          </p>

          {/* 1. Innledning og aksept */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">1. Innledning og aksept av vilkår</h2>
          <p className="text-dark-300 mb-4">
            Disse brukervilkårene (&laquo;Vilkårene&raquo;) utgjør en rettslig bindende avtale mellom deg som bruker
            (&laquo;Kunden&raquo;, &laquo;du&raquo;, &laquo;din&raquo;) og Efffekt AS, org.nr. [ORG.NR], (&laquo;Leverandøren&raquo;, &laquo;vi&raquo;, &laquo;oss&raquo;, &laquo;vår&raquo;),
            om bruk av den skybaserte tjenesten Sky Planner (&laquo;Tjenesten&raquo;).
          </p>
          <p className="text-dark-300 mb-4">
            Ved å opprette en brukerkonto, klikke &laquo;Godta&raquo;, eller på annen måte ta Tjenesten i bruk,
            bekrefter du at du har lest, forstått og aksepterer disse Vilkårene i sin helhet. Dersom du
            inngår avtalen på vegne av en juridisk person (bedrift, organisasjon e.l.), garanterer du at
            du har nødvendig fullmakt til å binde vedkommende til disse Vilkårene.
          </p>
          <p className="text-dark-300 mb-4">
            Vilkårene er utformet i henhold til norsk avtalerett, herunder lov om avslutning av avtaler,
            om fuldmagt og om ugyldige viljeserklæringer (avtaleloven), lov om opplysningsplikt og
            angrerett ved fjernsalg og salg utenom faste forretningslokaler (angrerettloven), og
            lov om visse sider av elektronisk handel og andre informasjonssamfunnstjenester (e-handelsloven).
          </p>

          {/* 2. Definisjoner */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">2. Definisjoner</h2>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li><strong>&laquo;Tjenesten&raquo;</strong> &ndash; Sky Planner skybasert plattform for kundeadministrasjon, ruteplanlegging og tilhørende funksjonalitet, inkludert API-er, integrasjoner og tilleggsfunksjoner.</li>
            <li><strong>&laquo;Kundedata&raquo;</strong> &ndash; alle data, filer, informasjon og innhold som Kunden eller Kundens brukere laster opp, legger inn eller på annen måte overfører til Tjenesten.</li>
            <li><strong>&laquo;Brukerkonto&raquo;</strong> &ndash; en autentisert tilgang til Tjenesten knyttet til en e-postadresse og passord.</li>
            <li><strong>&laquo;Abonnement&raquo;</strong> &ndash; den til enhver tid gjeldende betalingsplanen Kunden har valgt.</li>
            <li><strong>&laquo;Vedlikeholdsvindu&raquo;</strong> &ndash; planlagte perioder for oppdateringer, vedlikehold eller oppgraderinger av Tjenesten.</li>
            <li><strong>&laquo;Tredjepartstjenester&raquo;</strong> &ndash; eksterne tjenester som Tjenesten integrerer med, herunder Stripe, Supabase, kartleverandører og lignende.</li>
          </ul>

          {/* 3. Tjenestebeskrivelse */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">3. Tjenestebeskrivelse og omfang</h2>
          <p className="text-dark-300 mb-4">
            Sky Planner er en skybasert SaaS-plattform (Software as a Service) for kundeadministrasjon
            og ruteplanlegging, primært rettet mot servicebedrifter. Tjenesten tilbyr blant annet:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Interaktiv kartoversikt med kundemarkører og klyngevisning</li>
            <li>Ruteoptimalisering for serviceturer</li>
            <li>Ukeplanlegging med tidsestimater og progresjonssporing</li>
            <li>Kundeadministrasjon med kategorisering og filtrering</li>
            <li>Kalender og avtaleadministrasjon</li>
            <li>Import og eksport av kundedata</li>
            <li>API-tilgang for integrasjoner (avhengig av abonnementsplan)</li>
          </ul>
          <p className="text-dark-300 mb-4">
            Tjenestens konkrete funksjonsomfang kan variere avhengig av valgt abonnementsplan.
            Vi forbeholder oss retten til å endre, legge til eller fjerne funksjoner med rimelig
            varsel, jf. punkt 16.
          </p>

          {/* 4. Registrering og brukerkonto */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">4. Registrering og brukerkonto</h2>
          <p className="text-dark-300 mb-4">
            For å bruke Tjenesten må du opprette en Brukerkonto. Ved registrering forplikter du deg til å oppgi
            korrekt, fullstendig og oppdatert informasjon. Du er ansvarlig for:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Å holde påloggingsinformasjon (inkl. passord og eventuell tofaktorautentisering) konfidensielt</li>
            <li>All aktivitet som skjer via din Brukerkonto, uansett om aktiviteten er autorisert av deg eller ikke</li>
            <li>Å umiddelbart varsle oss dersom du mistenker uautorisert bruk av kontoen din, jf. e-handelsloven &sect; 18</li>
            <li>At personer som gis tilgang under din organisasjon overholder disse Vilkårene</li>
          </ul>
          <p className="text-dark-300 mb-4">
            Vi forbeholder oss retten til å suspendere eller avslutte Brukerkontoer som bryter disse Vilkårene,
            eller der det foreligger mistanke om misbruk eller sikkerhetstrussel.
          </p>

          {/* 5. Prøveperiode */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">5. Prøveperiode</h2>
          <p className="text-dark-300 mb-4">
            Nye kunder tilbys en 14-dagers gratis prøveperiode med tilgang til Tjenestens kjernefunksjoner.
            I samsvar med angrerettloven &sect; 22 bokstav m gjelder følgende:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Prøveperioden starter ved opprettelse av Brukerkonto</li>
            <li>Ingen betalingsinformasjon kreves for prøveperioden</li>
            <li>Etter prøveperioden starter abonnementet kun dersom Kunden aktivt velger en betalingsplan</li>
            <li>Data som er lagt inn i prøveperioden bevares ved overgang til betalt abonnement</li>
            <li>Dersom du ikke velger en plan etter prøveperioden, vil tilgangen begrenses</li>
          </ul>

          {/* 6. Betaling og fakturering */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">6. Betaling og fakturering</h2>
          <p className="text-dark-300 mb-4">
            Tjenesten faktureres i henhold til den abonnementsplan Kunden velger, enten månedlig eller årlig.
            Følgende gjelder for betaling:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Alle priser er oppgitt i norske kroner (NOK) og inkluderer merverdiavgift (MVA) med mindre annet er spesifisert, jf. markedsføringsloven &sect; 6 og prisopplysningsforskriften</li>
            <li>Betalinger behandles sikkert via vår betalingsleverandør Stripe, Inc., i samsvar med PCI DSS-standarder</li>
            <li>Abonnementer fornyes automatisk ved utløp av hver faktureringsperiode med mindre Kunden aktivt avbestiller</li>
            <li>Vi forbeholder oss retten til å endre priser med minst 30 dagers skriftlig varsel før neste faktureringsperiode</li>
            <li>Ved manglende betaling kan tilgangen til Tjenesten suspenderes etter 14 dagers purring</li>
          </ul>
          <p className="text-dark-300 mb-4">
            Fakturering skjer i henhold til bokføringsloven og relevante skatte- og avgiftsregler.
          </p>

          {/* 7. Avbestilling og oppsigelse */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">7. Avbestilling og oppsigelse</h2>
          <p className="text-dark-300 mb-4">
            Kunden kan når som helst avbestille sitt abonnement via kontrollpanelet. Ved avbestilling gjelder følgende:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Avbestillingen trer i kraft ved utløpet av gjeldende faktureringsperiode</li>
            <li>Kunden beholder tilgang til Tjenesten ut den betalte perioden</li>
            <li>Det ytes ikke refusjon for delvis brukte faktureringsperioder, med mindre annet følger av preseptorisk lovgivning</li>
            <li>Kundedata slettes i henhold til punkt 10 og vår personvernerklæring</li>
          </ul>
          <p className="text-dark-300 mb-4">
            Leverandøren kan si opp avtalen med 90 dagers skriftlig varsel. Ved Leverandørens oppsigelse
            tilbakebetales ubenyttet andel av forhåndsbetalte perioder forholdsmessig.
          </p>
          <p className="text-dark-300 mb-4">
            Begge parter kan heve avtalen med umiddelbar virkning ved vesentlig mislighold som ikke er
            rettet innen 30 dager etter skriftlig varsel, jf. avtaleloven og alminnelige kontraktsrettslige prinsipper.
          </p>

          {/* 8. Akseptabel bruk */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">8. Akseptabel bruk</h2>
          <p className="text-dark-300 mb-4">
            Kunden forplikter seg til å bruke Tjenesten i samsvar med gjeldende lovgivning, herunder
            straffeloven, personopplysningsloven, markedsføringsloven og åndsverkloven. Du godtar at du ikke vil:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Bruke Tjenesten til ulovlige formål eller i strid med gjeldende lov og forskrift</li>
            <li>Laste opp, lagre eller distribuere innhold som krenker tredjeparts rettigheter, herunder immaterielle rettigheter og personvern</li>
            <li>Forsøke å oppnå uautorisert tilgang til Tjenestens systemer, data, kildekode eller infrastruktur</li>
            <li>Utføre handlinger som kan skade, overbelaste eller forstyrre Tjenesten eller dens infrastruktur (herunder DDoS-angrep, scraping utover tillatt API-bruk, o.l.)</li>
            <li>Dele, videreselge eller viderelisensiere Tjenesten eller tilgangen til den uten skriftlig samtykke fra Leverandøren</li>
            <li>Forsøke å omgå tekniske sikkerhetstiltak, autentiseringsmekanismer eller tilgangskontroller</li>
            <li>Bruke Tjenesten til automatisert masseinnsamling av data uten godkjenning</li>
            <li>Laste opp innhold som inneholder skadelig programvare, virus eller lignende</li>
          </ul>
          <p className="text-dark-300 mb-4">
            Brudd på denne bestemmelsen kan medføre umiddelbar suspensjon eller avslutning av Brukerkonto
            uten forvarsel, og uten refusjon. Leverandøren forbeholder seg retten til å melde alvorlige
            brudd til relevante myndigheter.
          </p>

          {/* 9. Immaterielle rettigheter */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">9. Immaterielle rettigheter</h2>
          <p className="text-dark-300 mb-4">
            Alle immaterielle rettigheter til Tjenesten, herunder men ikke begrenset til programvare,
            kildekode, algoritmer, brukergrensesnitt, design, logoer, varemerker, databasestrukturer
            og dokumentasjon, tilhører utelukkende Leverandøren og er beskyttet i medhold av
            lov om opphavsrett til åndsverk mv. (åndsverkloven), varemerkeloven, designloven og
            øvrig norsk og internasjonal immaterialrett.
          </p>
          <p className="text-dark-300 mb-4">
            Kunden gis en begrenset, ikke-eksklusiv, ikke-overførbar og gjenkallelig lisens til å bruke
            Tjenesten utelukkende for egne interne forretningsformål, i samsvar med valgt abonnementsplan
            og disse Vilkårene. Denne lisensen inkluderer ikke rett til å:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Kopiere, modifisere, tilpasse eller lage avledede verker av Tjenesten eller dens komponenter</li>
            <li>Dekompilere, demontere eller forsøke å utlede kildekoden til Tjenesten, med unntak av det som er uttrykkelig tillatt etter åndsverkloven &sect; 42</li>
            <li>Fjerne, endre eller skjule opphavsrettsnotiser, varemerker eller andre eiendomsrettslige merknader</li>
            <li>Bruke Tjenesten som grunnlag for å utvikle konkurrerende produkter eller tjenester</li>
          </ul>

          {/* 10. Kundedata og databehandling */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">10. Kundedata og databehandling</h2>
          <p className="text-dark-300 mb-4">
            Kunden beholder full eiendomsrett til alle Kundedata. Leverandøren behandler Kundedata
            utelukkende for å levere Tjenesten, og opptrer som databehandler i henhold til
            personopplysningsloven og EUs personvernforordning (GDPR) artikkel 28.
          </p>
          <p className="text-dark-300 mb-4">
            Kunden er selv behandlingsansvarlig for personopplysninger som lastes opp i Tjenesten.
            Kunden er ansvarlig for at behandlingen av personopplysninger via Tjenesten har gyldig
            rettslig grunnlag etter GDPR artikkel 6, og at eventuelle registrerte er tilstrekkelig informert
            i henhold til GDPR artikkel 13 og 14.
          </p>
          <p className="text-dark-300 mb-4">Ved opphør av avtaleforholdet gjelder følgende:</p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Kunden kan eksportere sine data via Tjenestens eksportfunksjon før opphør</li>
            <li>Kundedata slettes fra Tjenestens aktive systemer innen 30 dager etter opphør</li>
            <li>Sikkerhetskopier som inneholder Kundedata slettes innen 90 dager</li>
            <li>Visse data kan oppbevares lenger der dette er påkrevd etter bokføringsloven, skatteforvaltningsloven eller annen preseptorisk lovgivning</li>
          </ul>

          {/* 11. Tilgjengelighet og tjenestenivå */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">11. Tilgjengelighet og tjenestenivå</h2>
          <p className="text-dark-300 mb-4">
            Leverandøren tilstreber høy tilgjengelighet for Tjenesten, men gir ingen garanti for
            uavbrutt eller feilfri drift. Følgende gjelder:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Planlagt vedlikehold vil så langt det er praktisk mulig gjennomføres utenfor normal arbeidstid og varsles med rimelig forvarsel</li>
            <li>Vi er ikke ansvarlige for nedetid forårsaket av Tredjepartstjenester, herunder hostingleverandører, kartdataleverandører, betalingsløsninger eller internettilkoblinger</li>
            <li>Force majeure-hendelser (jf. punkt 15) fritar Leverandøren fra ansvar for utilgjengelighet</li>
          </ul>

          {/* 12. Ansvarsbegrensning */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">12. Ansvarsbegrensning</h2>
          <p className="text-dark-300 mb-4">
            <strong>Tjenesten leveres &laquo;som den er&raquo; (&laquo;as is&raquo;) og &laquo;som tilgjengelig&raquo; (&laquo;as available&raquo;).</strong>{' '}
            I den utstrekning gjeldende lov tillater det, fraskriver Leverandøren seg alle garantier,
            uttrykkelige eller underforståtte, inkludert men ikke begrenset til underforståtte garantier
            om salgbarhet, egnethet for et bestemt formål, og fravær av rettighetsmangler.
          </p>
          <p className="text-dark-300 mb-4">
            Leverandøren garanterer ikke at:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Tjenesten vil være uavbrutt, rettidig, sikker eller feilfri</li>
            <li>Resultatene oppnådd gjennom Tjenesten (herunder ruteberegninger, tidsestimater, avstander og kartdata) vil være nøyaktige, pålitelige eller fullstendige</li>
            <li>Tjenesten vil oppfylle Kundens spesifikke krav utover det som er beskrevet i punkt 3</li>
            <li>Eventuelle feil i Tjenesten vil bli rettet innen en bestemt tidsramme</li>
          </ul>
          <p className="text-dark-300 mb-4">
            <strong>Leverandørens samlede erstatningsansvar</strong> overfor Kunden, uansett grunnlag (kontrakt, uaktsomhet, objektivt ansvar eller annet), er under alle omstendigheter begrenset til det
            beløpet Kunden faktisk har betalt for Tjenesten i løpet av de siste 12 månedene forut for
            den hendelsen som gir grunnlag for kravet.
          </p>
          <p className="text-dark-300 mb-4">
            <strong>Leverandøren er ikke ansvarlig for:</strong>
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Indirekte tap, følgetap, tapt fortjeneste, tapt omsetning, tapte data (ut over det som er dekket i punkt 10), tap av goodwill, eller tap som følge av driftsavbrudd</li>
            <li>Tap som skyldes Kundens bruk av Tjenesten i strid med disse Vilkårene eller gjeldende lov</li>
            <li>Tap som skyldes feil, mangler eller avbrudd i Tredjepartstjenester</li>
            <li>Beslutninger Kunden treffer basert på informasjon, beregninger eller data fra Tjenesten</li>
            <li>Uautorisert tilgang til Kundedata som skyldes Kundens manglende sikring av påloggingsinformasjon</li>
            <li>Tap forårsaket av virus, skadelig kode eller teknologisk skadelige materialer som overføres til Kundens utstyr gjennom bruk av Tjenesten, der Leverandøren har utøvd rimelig aktsomhet</li>
          </ul>
          <p className="text-dark-300 mb-4">
            Disse begrensningene gjelder i den utstrekning de er tillatt etter norsk preseptorisk lovgivning.
            Ingenting i disse Vilkårene begrenser Leverandørens ansvar for tap som skyldes forsett eller grov uaktsomhet.
          </p>

          {/* 13. Skadesl&oslash;sholdelse */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">13. Skadesl&oslash;sholdelse</h2>
          <p className="text-dark-300 mb-4">
            Kunden aksepterer å holde Leverandøren, dets styremedlemmer, ansatte, konsulenter og
            samarbeidspartnere skadesløse fra og mot ethvert krav, tap, skade, ansvar, kostnader
            og utgifter (herunder rimelige advokatutgifter) som oppstår som følge av eller i
            forbindelse med:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Kundens bruk av Tjenesten i strid med disse Vilkårene eller gjeldende lov</li>
            <li>Kundedata som krenker tredjeparts rettigheter, herunder personvernrettigheter, immaterielle rettigheter eller andre lovbestemte rettigheter</li>
            <li>Kundens manglende overholdelse av personopplysningsloven, GDPR eller annen personvernlovgivning i forbindelse med personopplysninger som behandles via Tjenesten</li>
            <li>Krav fra tredjeparter (herunder Kundens kunder, ansatte eller samarbeidspartnere) relatert til Kundens bruk av Tjenesten</li>
          </ul>

          {/* 14. Konfidensialitet */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">14. Konfidensialitet</h2>
          <p className="text-dark-300 mb-4">
            Begge parter forplikter seg til å behandle konfidensiell informasjon mottatt fra den andre
            parten med tilbørlig forsiktighet, og ikke avsløre slik informasjon til tredjeparter uten
            forutgående skriftlig samtykke. Denne forpliktelsen gjelder ikke informasjon som:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Er eller blir allment kjent uten den mottakende parts medvirkning</li>
            <li>Var kjent for den mottakende part forut for mottak</li>
            <li>Er mottatt fra tredjepart uten brudd på konfidensialitetsforpliktelser</li>
            <li>Må utleveres etter pålegg fra domstol eller offentlig myndighet</li>
          </ul>
          <p className="text-dark-300 mb-4">
            Konfidensialitetsforpliktelsen gjelder i avtaleperioden og i 3 år etter avtalens opphør.
          </p>

          {/* 15. Force majeure */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">15. Force majeure</h2>
          <p className="text-dark-300 mb-4">
            Ingen av partene skal holdes ansvarlige for manglende oppfyllelse av forpliktelser etter
            denne avtalen dersom manglende oppfyllelse skyldes omstendigheter utenfor partens rimelige
            kontroll (&laquo;Force Majeure&raquo;). Force Majeure inkluderer, men er ikke begrenset til:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li>Naturkatastrofer, epidemier eller pandemier</li>
            <li>Krig, terrorisme, oppror eller sivil uro</li>
            <li>Offentlige påbud, sanksjoner, embargoer eller lovendringer</li>
            <li>Svikt i telekommunikasjon, internett, strømforsyning eller annen infrastruktur utenfor partens kontroll</li>
            <li>Cyberangrep, DDoS-angrep eller andre sikkerhetshendelser av ekstraordinær karakter</li>
            <li>Svikt hos underleverandører eller tredjepartsleverandører som ikke kunne vært forutsett eller forhindret</li>
          </ul>
          <p className="text-dark-300 mb-4">
            Den berørte parten skal uten ugrunnet opphold varsle den annen part om Force Majeure-situasjonen
            og iverksette rimelige tiltak for å begrense virkningene.
          </p>

          {/* 16. Endringer i vilkarene */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">16. Endringer i vilkarene</h2>
          <p className="text-dark-300 mb-4">
            Leverandøren forbeholder seg retten til å endre disse Vilkårene. Endringer håndteres som følger:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li><strong>Vesentlige endringer:</strong> Kunden varsles via e-post minst 30 dager før endringene trer i kraft. Kunden har rett til å si opp avtalen uten kostnad innen varslingsperioden dersom endringene er til ugunst for Kunden.</li>
            <li><strong>Mindre endringer:</strong> Justeringer som ikke vesentlig endrer partenes rettigheter og plikter kan gjennomføres med rimelig varsel publisert på Tjenestens nettside.</li>
            <li><strong>Lovpålagte endringer:</strong> Endringer som er nødvendige for å overholde gjeldende lovgivning kan gjennomføres uten forutgående varsel.</li>
          </ul>
          <p className="text-dark-300 mb-4">
            Fortsatt bruk av Tjenesten etter at endringene trer i kraft, anses som aksept av de oppdaterte Vilkårene.
          </p>

          {/* 17. Personvern */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">17. Personvern og databehandleravtale</h2>
          <p className="text-dark-300 mb-4">
            Behandling av personopplysninger i forbindelse med Tjenesten reguleres av vår{' '}
            <Link href="/personvern" className="text-primary-400 hover:text-primary-300">Personvernerklæring</Link>,
            som utgjør en integrert del av disse Vilkårene.
          </p>
          <p className="text-dark-300 mb-4">
            Leverandøren opptrer som databehandler for personopplysninger som Kunden lagrer i Tjenesten.
            De nærmere vilkår for databehandling, herunder behandlingsformål, kategorier av personopplysninger,
            sikkerhetstiltak og rettigheter ved opphør, reguleres i samsvar med GDPR artikkel 28.
            Ved bruk av Tjenesten aksepterer Kunden databehandlervilkårene som fremgår av Personvernerklæring.
          </p>

          {/* 18. Tredjepartstjenester */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">18. Tredjepartstjenester og integrasjoner</h2>
          <p className="text-dark-300 mb-4">
            Tjenesten benytter og integrerer med Tredjepartstjenester, herunder:
          </p>
          <ul className="list-disc list-inside text-dark-300 mb-4 space-y-2">
            <li><strong>Stripe</strong> &ndash; betalingsbehandling (underlagt Stripes tjenestevilkar)</li>
            <li><strong>Supabase</strong> &ndash; databaselagring og autentisering (EU-baserte servere)</li>
            <li><strong>OpenRouteService / VROOM</strong> &ndash; ruteoptimalisering og karttjenester</li>
            <li><strong>Mapbox / Leaflet</strong> &ndash; kartvisning og geokoding</li>
          </ul>
          <p className="text-dark-300 mb-4">
            Leverandøren er ikke ansvarlig for Tredjepartstjenesters tilgjengelighet, ytelse, sikkerhet
            eller vilkårsendringer. Kunden aksepterer at bruk av Tjenesten kan innebære at data overføres
            til og behandles av Tredjepartstjenester i samsvar med deres respektive vilkår og personvernerklæring.
          </p>

          {/* 19. Eksportkontroll */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">19. Eksportkontroll og sanksjoner</h2>
          <p className="text-dark-300 mb-4">
            Kunden skal ikke bruke Tjenesten i strid med gjeldende eksportkontrollregler, sanksjonsregimer
            eller handelsrestriksjoner. Kunden bekrefter at vedkommende ikke er oppført på noen
            sanksjons- eller restriksjonsslister administrert av EU, FN eller norske myndigheter.
          </p>

          {/* 20. Overdragelse */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">20. Overdragelse</h2>
          <p className="text-dark-300 mb-4">
            Kunden kan ikke overdra eller overføre sine rettigheter eller forpliktelser under disse Vilkårene
            til tredjepart uten Leverandørens forutgående skriftlige samtykke. Leverandøren kan overdra
            avtalen til et konsernselskap eller i forbindelse med fusjon, oppkjøp eller salg av hele
            eller vesentlige deler av virksomheten, forutsatt at den overtagende parten påtar seg
            alle forpliktelser under disse Vilkårene.
          </p>

          {/* 21. Delvis ugyldighet */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">21. Delvis ugyldighet (severability)</h2>
          <p className="text-dark-300 mb-4">
            Dersom en eller flere bestemmelser i disse Vilkårene kjennes ugyldige eller ikke kan
            gjøres gjeldende av en kompetent domstol, skal dette ikke påvirke gyldigheten av de
            øvrige bestemmelsene. Den ugyldige bestemmelsen skal erstattes med en gyldig bestemmelse
            som i størst mulig grad ivaretar det opprinnelige formålet, i samsvar med avtaleloven &sect; 36.
          </p>

          {/* 22. Hele avtalen */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">22. Hele avtalen</h2>
          <p className="text-dark-300 mb-4">
            Disse Vilkårene, sammen med Personvernerklæring og eventuelt separat inngåtte avtaler,
            utgjør den fullstendige avtalen mellom partene vedrørende bruk av Tjenesten, og erstatter
            alle tidligere muntlige og skriftlige avtaler, forhandlinger og forståelser mellom partene
            om det samme emnet.
          </p>

          {/* 23. Lovvalg og tvisteløsning */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">23. Lovvalg og tvisteløsning</h2>
          <p className="text-dark-300 mb-4">
            Disse Vilkårene er underlagt og skal tolkes i samsvar med norsk lov, uten hensyn til
            lovvalgsregler som ville ført til anvendelse av fremmed rett.
          </p>
          <p className="text-dark-300 mb-4">
            Eventuelle tvister som oppstår i forbindelse med disse Vilkårene skal søkes løst gjennom
            forhandlinger i god tro. Dersom partene ikke oppnår enighet innen 30 dager, kan tvisten
            bringes inn for de alminnelige norske domstoler med Leverandørens forretningsadresse som
            verneting, jf. tvisteloven.
          </p>
          <p className="text-dark-300 mb-4">
            For forbrukere gjelder forbrukerens alminnelige verneting i samsvar med tvisteloven &sect; 4-5,
            samt retten til å bringe saken inn for Forbrukertilsynet eller Forbrukerrådet.
          </p>

          {/* 24. Kontakt */}
          <h2 className="text-xl font-semibold text-white mt-8 mb-4">24. Kontaktinformasjon</h2>
          <p className="text-dark-300 mb-4">
            Har du spørsmål om disse Vilkårene, kan du kontakte oss:
          </p>
          <div className="text-dark-300 mb-4 space-y-1">
            <p><strong>Efffekt AS</strong></p>
            <p>E-post: <a href="mailto:kontakt@skyplanner.no" className="text-primary-400 hover:text-primary-300">kontakt@skyplanner.no</a></p>
            <p>Nettside: <a href="https://skyplanner.no" className="text-primary-400 hover:text-primary-300">skyplanner.no</a></p>
          </div>
        </GlassCard>
      </div>
    </section>
  );
}

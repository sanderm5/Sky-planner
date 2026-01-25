/**
 * Migration: Seed All Industry Templates
 *
 * This migration adds industry templates to support
 * multiple business types in Sky Planner.
 *
 * Run with: node migrations/003_seed_all_industries.js
 */

require('dotenv').config();

const DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';
const useSupabase = DATABASE_TYPE === 'supabase';

let db = null;
let supabase = null;

// Initialize database connection
async function initDatabase() {
  if (useSupabase) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
    );
    console.log('Connected to Supabase');
  } else {
    const Database = require('better-sqlite3');
    const dbPath = process.env.DATABASE_PATH || './kunder.db';
    db = new Database(dbPath);
    console.log('Connected to SQLite:', dbPath);
  }
}

// Execute SQL for SQLite
function sqliteExec(sql) {
  try {
    db.exec(sql);
    return true;
  } catch (error) {
    if (error.message.includes('already exists') || error.message.includes('duplicate column')) {
      return true;
    }
    throw error;
  }
}

// Execute SQL for Supabase
async function supabaseExec(sql) {
  const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
  if (error && !error.message.includes('already exists')) {
    throw error;
  }
  return true;
}

// All industry templates to seed
const INDUSTRIES = [
  // Note: El-Kontroll + Brannvarsling is seeded in 001_multi_industry_setup.js

  // 1. Borettslag/Sameie
  {
    name: 'Borettslag / Sameie',
    slug: 'borettslag-sameie',
    icon: 'fa-building',
    color: '#3B82F6',
    description: 'Årskontroll og vedlikehold for borettslag og sameier',
    sortOrder: 2,
    serviceTypes: [
      {
        name: 'Årskontroll',
        slug: 'arskontroll',
        icon: 'fa-clipboard-check',
        color: '#3B82F6',
        defaultInterval: 12,
        description: 'Årlig gjennomgang av fellesarealer og tekniske anlegg',
        subtypes: [
          { name: 'Elektrisk anlegg', slug: 'elektrisk', interval: 12 },
          { name: 'Brannvern', slug: 'brannvern', interval: 12 },
          { name: 'Ventilasjonsanlegg', slug: 'ventilasjon', interval: 12 },
          { name: 'Lekeplassutstyr', slug: 'lekeplass', interval: 12 }
        ]
      },
      {
        name: 'Vedlikehold',
        slug: 'vedlikehold',
        icon: 'fa-tools',
        color: '#10B981',
        defaultInterval: 6,
        description: 'Løpende vedlikehold av bygninger og uteområder',
        subtypes: [
          { name: 'Fasade', slug: 'fasade', interval: 60 },
          { name: 'Tak', slug: 'tak', interval: 24 },
          { name: 'Grøntområder', slug: 'gront', interval: 1 }
        ]
      }
    ],
    intervals: [1, 3, 6, 12, 24, 36, 60]
  },

  // 3. Renhold
  {
    name: 'Renhold',
    slug: 'renhold',
    icon: 'fa-broom',
    color: '#06B6D4',
    description: 'Profesjonell rengjøring for næring og privat',
    sortOrder: 3,
    serviceTypes: [
      {
        name: 'Kontorrenhold',
        slug: 'kontorrenhold',
        icon: 'fa-building-user',
        color: '#06B6D4',
        defaultInterval: 1,
        description: 'Daglig eller ukentlig renhold av kontorarealer',
        subtypes: [
          { name: 'Daglig renhold', slug: 'daglig', interval: 0 },
          { name: 'Ukentlig renhold', slug: 'ukentlig', interval: 0 },
          { name: 'Hovedrenhold', slug: 'hovedrenhold', interval: 6 }
        ]
      },
      {
        name: 'Industrirenhold',
        slug: 'industrirenhold',
        icon: 'fa-industry',
        color: '#8B5CF6',
        defaultInterval: 1,
        description: 'Spesialisert rengjøring av industrianlegg',
        subtypes: [
          { name: 'Produksjonslokaler', slug: 'produksjon', interval: 1 },
          { name: 'Lager', slug: 'lager', interval: 3 },
          { name: 'Næringsmiddel', slug: 'naringsmiddel', interval: 1 }
        ]
      },
      {
        name: 'Spesialrenhold',
        slug: 'spesialrenhold',
        icon: 'fa-sparkles',
        color: '#EC4899',
        defaultInterval: 12,
        description: 'Spesialtjenester som vinduspuss og tepperens',
        equipment: [
          { name: 'Vinduspuss', slug: 'vinduspuss' },
          { name: 'Tepperens', slug: 'tepperens' },
          { name: 'Høytrykksspyling', slug: 'hoytrykkspyling' }
        ]
      }
    ],
    intervals: [0, 1, 2, 4, 6, 12]
  },

  // 4. Vaktmestertjenester
  {
    name: 'Vaktmestertjenester',
    slug: 'vaktmester',
    icon: 'fa-wrench',
    color: '#F59E0B',
    description: 'Vedlikehold og driftstjenester for bygninger',
    sortOrder: 4,
    serviceTypes: [
      {
        name: 'Teknisk vedlikehold',
        slug: 'teknisk-vedlikehold',
        icon: 'fa-gear',
        color: '#F59E0B',
        defaultInterval: 1,
        description: 'Løpende teknisk vedlikehold og reparasjoner',
        subtypes: [
          { name: 'VVS', slug: 'vvs', interval: 3 },
          { name: 'Elektro', slug: 'elektro', interval: 6 },
          { name: 'Bygg', slug: 'bygg', interval: 12 }
        ]
      },
      {
        name: 'Uteområder',
        slug: 'uteomrader',
        icon: 'fa-tree',
        color: '#22C55E',
        defaultInterval: 1,
        description: 'Vedlikehold av utearealer og grøntanlegg',
        subtypes: [
          { name: 'Plenklipp', slug: 'plenklipp', interval: 0 },
          { name: 'Snømåking', slug: 'snomaking', interval: 0 },
          { name: 'Høstklargjøring', slug: 'hostklargjoring', interval: 12 }
        ]
      }
    ],
    intervals: [0, 1, 2, 4, 12, 24]
  },

  // 5. HVAC/Ventilasjon
  {
    name: 'HVAC / Ventilasjon',
    slug: 'hvac-ventilasjon',
    icon: 'fa-wind',
    color: '#0EA5E9',
    description: 'Service og vedlikehold av klima- og ventilasjonsanlegg',
    sortOrder: 5,
    serviceTypes: [
      {
        name: 'Ventilasjonsservice',
        slug: 'ventilasjonsservice',
        icon: 'fa-fan',
        color: '#0EA5E9',
        defaultInterval: 12,
        description: 'Årlig service av ventilasjonsanlegg',
        subtypes: [
          { name: 'Bolig', slug: 'bolig', interval: 12 },
          { name: 'Næring', slug: 'naering', interval: 6 },
          { name: 'Industri', slug: 'industri', interval: 3 }
        ],
        equipment: [
          { name: 'Balansert ventilasjon', slug: 'balansert' },
          { name: 'Avtrekksvifte', slug: 'avtrekk' },
          { name: 'Varmepumpe', slug: 'varmepumpe' }
        ]
      },
      {
        name: 'Filterbytte',
        slug: 'filterbytte',
        icon: 'fa-filter',
        color: '#14B8A6',
        defaultInterval: 6,
        description: 'Regelmessig bytte av filtre i ventilasjonsanlegg'
      },
      {
        name: 'Kanalrens',
        slug: 'kanalrens',
        icon: 'fa-broom',
        color: '#6366F1',
        defaultInterval: 60,
        description: 'Rengjøring av ventilasjonskanaler'
      }
    ],
    intervals: [3, 6, 12, 24, 36, 60]
  },

  // 6. Heis/Løfteutstyr
  {
    name: 'Heis / Løfteutstyr',
    slug: 'heis-lofteutstyr',
    icon: 'fa-elevator',
    color: '#6366F1',
    description: 'Sikkerhetskontroll og service av heiser og løfteutstyr',
    sortOrder: 6,
    serviceTypes: [
      {
        name: 'Heisservice',
        slug: 'heisservice',
        icon: 'fa-elevator',
        color: '#6366F1',
        defaultInterval: 3,
        description: 'Kvartalsvis service av personheiser',
        subtypes: [
          { name: 'Personheis', slug: 'personheis', interval: 3 },
          { name: 'Vareheis', slug: 'vareheis', interval: 3 },
          { name: 'Plattformheis', slug: 'plattformheis', interval: 6 }
        ]
      },
      {
        name: 'Sikkerhetskontroll',
        slug: 'sikkerhetskontroll',
        icon: 'fa-shield-check',
        color: '#DC2626',
        defaultInterval: 12,
        description: 'Årlig lovpålagt sikkerhetskontroll'
      },
      {
        name: 'Løfteutstyr',
        slug: 'lofteutstyr',
        icon: 'fa-truck-loading',
        color: '#F97316',
        defaultInterval: 12,
        description: 'Kontroll av trucker, kraner og løftebord',
        equipment: [
          { name: 'Gaffeltruck', slug: 'gaffeltruck' },
          { name: 'Kran', slug: 'kran' },
          { name: 'Løftebord', slug: 'loftebord' },
          { name: 'Personløfter', slug: 'personlofter' }
        ]
      }
    ],
    intervals: [1, 3, 6, 12, 24]
  },

  // 7. Sikkerhet/Vakt
  {
    name: 'Sikkerhet / Vakt',
    slug: 'sikkerhet-vakt',
    icon: 'fa-shield-halved',
    color: '#1E3A8A',
    description: 'Vakthold, alarm og sikkerhetstjenester',
    sortOrder: 7,
    serviceTypes: [
      {
        name: 'Vakthold',
        slug: 'vakthold',
        icon: 'fa-user-shield',
        color: '#1E3A8A',
        defaultInterval: 0,
        description: 'Fast eller periodisk vakthold',
        subtypes: [
          { name: 'Fast vakt', slug: 'fast-vakt', interval: 0 },
          { name: 'Nattevakt', slug: 'nattevakt', interval: 0 },
          { name: 'Rondekjøring', slug: 'rondekjoring', interval: 0 }
        ]
      },
      {
        name: 'Alarmservice',
        slug: 'alarmservice',
        icon: 'fa-bell',
        color: '#DC2626',
        defaultInterval: 12,
        description: 'Service og vedlikehold av alarmanlegg',
        equipment: [
          { name: 'Innbruddsalarm', slug: 'innbruddsalarm' },
          { name: 'Brannalarm', slug: 'brannalarm' },
          { name: 'Adgangskontroll', slug: 'adgangskontroll' },
          { name: 'Videoovervåking', slug: 'video' }
        ]
      }
    ],
    intervals: [0, 1, 3, 6, 12, 24]
  },

  // 8. Skadedyrkontroll
  {
    name: 'Skadedyrkontroll',
    slug: 'skadedyrkontroll',
    icon: 'fa-bug',
    color: '#84CC16',
    description: 'Forebygging og bekjempelse av skadedyr',
    sortOrder: 8,
    serviceTypes: [
      {
        name: 'Inspeksjon',
        slug: 'inspeksjon',
        icon: 'fa-magnifying-glass',
        color: '#84CC16',
        defaultInterval: 3,
        description: 'Regelmessig inspeksjon for skadedyr',
        subtypes: [
          { name: 'Næringsmiddelbedrift', slug: 'naringsmiddel', interval: 1 },
          { name: 'Lager', slug: 'lager', interval: 3 },
          { name: 'Bolig', slug: 'bolig', interval: 12 }
        ]
      },
      {
        name: 'Behandling',
        slug: 'behandling',
        icon: 'fa-spray-can',
        color: '#EF4444',
        defaultInterval: 0,
        description: 'Bekjempelse ved funn av skadedyr',
        subtypes: [
          { name: 'Mus/rotter', slug: 'gnagere', interval: 0 },
          { name: 'Insekter', slug: 'insekter', interval: 0 },
          { name: 'Fugler', slug: 'fugler', interval: 0 }
        ]
      },
      {
        name: 'Forebygging',
        slug: 'forebygging',
        icon: 'fa-shield',
        color: '#22C55E',
        defaultInterval: 12,
        description: 'Forebyggende tiltak mot skadedyr'
      }
    ],
    intervals: [1, 2, 3, 6, 12]
  },

  // 9. VVS/Rørlegger
  {
    name: 'VVS / Rørlegger',
    slug: 'vvs-rorlegger',
    icon: 'fa-faucet',
    color: '#0891B2',
    description: 'Vedlikehold av sanitæranlegg og rørinstallasjoner',
    sortOrder: 9,
    serviceTypes: [
      {
        name: 'Rørsjekk',
        slug: 'rorsjekk',
        icon: 'fa-faucet-drip',
        color: '#0891B2',
        defaultInterval: 24,
        description: 'Kontroll av røropplegg og avløp',
        subtypes: [
          { name: 'Bolig', slug: 'bolig', interval: 24 },
          { name: 'Næring', slug: 'naering', interval: 12 },
          { name: 'Industri', slug: 'industri', interval: 6 }
        ]
      },
      {
        name: 'Spyling',
        slug: 'spyling',
        icon: 'fa-water',
        color: '#06B6D4',
        defaultInterval: 12,
        description: 'Høytrykkspyling av avløp'
      },
      {
        name: 'Vannbehandling',
        slug: 'vannbehandling',
        icon: 'fa-droplet',
        color: '#3B82F6',
        defaultInterval: 12,
        description: 'Service av vannbehandlingsanlegg',
        equipment: [
          { name: 'Vannmykner', slug: 'vannmykner' },
          { name: 'UV-anlegg', slug: 'uv-anlegg' },
          { name: 'Filter', slug: 'filter' }
        ]
      }
    ],
    intervals: [3, 6, 12, 24, 36]
  },

  // 10. Takservice
  {
    name: 'Takservice',
    slug: 'takservice',
    icon: 'fa-house-chimney',
    color: '#78716C',
    description: 'Inspeksjon og vedlikehold av tak og takrenner',
    sortOrder: 10,
    serviceTypes: [
      {
        name: 'Takinspeksjon',
        slug: 'takinspeksjon',
        icon: 'fa-binoculars',
        color: '#78716C',
        defaultInterval: 12,
        description: 'Årlig inspeksjon av tak og beslag',
        subtypes: [
          { name: 'Skråtak', slug: 'skratak', interval: 12 },
          { name: 'Flatt tak', slug: 'flatt-tak', interval: 6 },
          { name: 'Torvtak', slug: 'torvtak', interval: 12 }
        ]
      },
      {
        name: 'Takrennerens',
        slug: 'takrennerens',
        icon: 'fa-broom',
        color: '#A3A3A3',
        defaultInterval: 12,
        description: 'Rengjøring av takrenner og nedløp'
      },
      {
        name: 'Mose-/algebehandling',
        slug: 'mosebehandling',
        icon: 'fa-spray-can',
        color: '#65A30D',
        defaultInterval: 36,
        description: 'Fjerning og forebygging av mose og alger'
      }
    ],
    intervals: [6, 12, 24, 36, 60]
  },

  // 11. Hagearbeid/Uteområder
  {
    name: 'Hagearbeid / Uteområder',
    slug: 'hagearbeid',
    icon: 'fa-leaf',
    color: '#22C55E',
    description: 'Vedlikehold av hager, parker og uteområder',
    sortOrder: 11,
    serviceTypes: [
      {
        name: 'Plenvedlikehold',
        slug: 'plenvedlikehold',
        icon: 'fa-seedling',
        color: '#22C55E',
        defaultInterval: 0,
        description: 'Klipping, gjødsling og stell av plen',
        subtypes: [
          { name: 'Ukentlig', slug: 'ukentlig', interval: 0 },
          { name: 'Hver 14. dag', slug: 'annenhver-uke', interval: 0 },
          { name: 'Månedlig', slug: 'manedlig', interval: 1 }
        ]
      },
      {
        name: 'Snømåking',
        slug: 'snomaking',
        icon: 'fa-snowflake',
        color: '#60A5FA',
        defaultInterval: 0,
        description: 'Brøyting og strøing om vinteren'
      },
      {
        name: 'Sesongarbeid',
        slug: 'sesongarbeid',
        icon: 'fa-calendar',
        color: '#F59E0B',
        defaultInterval: 6,
        description: 'Vår- og høstklargjøring',
        subtypes: [
          { name: 'Vårklargjøring', slug: 'var', interval: 12 },
          { name: 'Høstklargjøring', slug: 'host', interval: 12 },
          { name: 'Beskjæring', slug: 'beskjering', interval: 12 }
        ]
      }
    ],
    intervals: [0, 1, 2, 6, 12]
  },

  // 12. IT-Service
  {
    name: 'IT-Service',
    slug: 'it-service',
    icon: 'fa-laptop',
    color: '#8B5CF6',
    description: 'Vedlikehold og support for IT-utstyr og systemer',
    sortOrder: 12,
    serviceTypes: [
      {
        name: 'Systemvedlikehold',
        slug: 'systemvedlikehold',
        icon: 'fa-server',
        color: '#8B5CF6',
        defaultInterval: 1,
        description: 'Oppdateringer, patching og monitorering',
        subtypes: [
          { name: 'Servere', slug: 'servere', interval: 1 },
          { name: 'Nettverk', slug: 'nettverk', interval: 3 },
          { name: 'Klienter', slug: 'klienter', interval: 1 }
        ]
      },
      {
        name: 'Backup',
        slug: 'backup',
        icon: 'fa-cloud-arrow-up',
        color: '#3B82F6',
        defaultInterval: 1,
        description: 'Backup og gjenoppretting av data'
      },
      {
        name: 'Sikkerhet',
        slug: 'it-sikkerhet',
        icon: 'fa-shield-halved',
        color: '#DC2626',
        defaultInterval: 12,
        description: 'Sikkerhetsgjennomgang og testing',
        subtypes: [
          { name: 'Penetrasjonstest', slug: 'pentest', interval: 12 },
          { name: 'Sårbarhetsscan', slug: 'sarbarhetscan', interval: 3 },
          { name: 'Brannmur-review', slug: 'brannmur', interval: 6 }
        ]
      }
    ],
    intervals: [1, 3, 6, 12, 24]
  },

  // 13. Vinduspuss
  {
    name: 'Vinduspuss',
    slug: 'vinduspuss',
    icon: 'fa-spray-can-sparkles',
    color: '#38BDF8',
    description: 'Profesjonell rengjøring av vinduer og glassfasader',
    sortOrder: 13,
    serviceTypes: [
      {
        name: 'Innvendig vinduspuss',
        slug: 'innvendig',
        icon: 'fa-house',
        color: '#38BDF8',
        defaultInterval: 3,
        description: 'Rengjøring av vinduer innenfra',
        subtypes: [
          { name: 'Bolig', slug: 'bolig', interval: 6 },
          { name: 'Kontor', slug: 'kontor', interval: 1 },
          { name: 'Butikk', slug: 'butikk', interval: 1 }
        ]
      },
      {
        name: 'Utvendig vinduspuss',
        slug: 'utvendig',
        icon: 'fa-building',
        color: '#0EA5E9',
        defaultInterval: 3,
        description: 'Rengjøring av vinduer utenfra'
      },
      {
        name: 'Glassfasade',
        slug: 'glassfasade',
        icon: 'fa-city',
        color: '#0284C7',
        defaultInterval: 1,
        description: 'Rengjøring av store glassfasader',
        equipment: [
          { name: 'Lift', slug: 'lift' },
          { name: 'Klatring', slug: 'klatring' },
          { name: 'Drone', slug: 'drone' }
        ]
      }
    ],
    intervals: [1, 2, 3, 6, 12]
  },

  // 14. Avfallshåndtering
  {
    name: 'Avfallshåndtering',
    slug: 'avfallshandtering',
    icon: 'fa-recycle',
    color: '#16A34A',
    description: 'Tømming, sortering og gjenvinning av avfall',
    sortOrder: 14,
    serviceTypes: [
      {
        name: 'Tømming',
        slug: 'tomming',
        icon: 'fa-trash-can',
        color: '#16A34A',
        defaultInterval: 0,
        description: 'Regelmessig tømming av avfallsbeholdere',
        subtypes: [
          { name: 'Ukentlig', slug: 'ukentlig', interval: 0 },
          { name: 'Hver 14. dag', slug: 'annenhver', interval: 0 },
          { name: 'Månedlig', slug: 'manedlig', interval: 1 }
        ]
      },
      {
        name: 'Containerservice',
        slug: 'containerservice',
        icon: 'fa-dumpster',
        color: '#CA8A04',
        defaultInterval: 0,
        description: 'Utleie og tømming av containere'
      },
      {
        name: 'Spesialavfall',
        slug: 'spesialavfall',
        icon: 'fa-biohazard',
        color: '#EF4444',
        defaultInterval: 0,
        description: 'Håndtering av farlig avfall og spesialavfall',
        subtypes: [
          { name: 'Elektronikk', slug: 'elektronikk', interval: 0 },
          { name: 'Kjemikalier', slug: 'kjemikalier', interval: 0 },
          { name: 'Medisinsk', slug: 'medisinsk', interval: 0 }
        ]
      }
    ],
    intervals: [0, 1, 2, 4, 12]
  },

  // 15. Serviceavtaler Generell
  {
    name: 'Serviceavtaler Generell',
    slug: 'serviceavtaler-generell',
    icon: 'fa-handshake',
    color: '#A855F7',
    description: 'Fleksible serviceavtaler tilpasset kundens behov',
    sortOrder: 15,
    serviceTypes: [
      {
        name: 'Periodisk service',
        slug: 'periodisk-service',
        icon: 'fa-calendar-check',
        color: '#A855F7',
        defaultInterval: 12,
        description: 'Planlagt service med fast intervall',
        subtypes: [
          { name: 'Månedlig', slug: 'manedlig', interval: 1 },
          { name: 'Kvartalsvis', slug: 'kvartalsvis', interval: 3 },
          { name: 'Halvårlig', slug: 'halvarlig', interval: 6 },
          { name: 'Årlig', slug: 'arlig', interval: 12 }
        ]
      },
      {
        name: 'Vedlikeholdsavtale',
        slug: 'vedlikeholdsavtale',
        icon: 'fa-tools',
        color: '#F59E0B',
        defaultInterval: 12,
        description: 'Løpende vedlikehold etter behov'
      },
      {
        name: 'Beredskapstjeneste',
        slug: 'beredskapstjeneste',
        icon: 'fa-phone',
        color: '#DC2626',
        defaultInterval: 0,
        description: 'Tilkalling ved akutte behov'
      }
    ],
    intervals: [0, 1, 3, 6, 12, 24, 36, 60]
  },

  // 16. Vedlikehold Bygg
  {
    name: 'Vedlikehold Bygg',
    slug: 'vedlikehold-bygg',
    icon: 'fa-hammer',
    color: '#92400E',
    description: 'Maling, fasadearbeid og innvendig vedlikehold',
    sortOrder: 16,
    serviceTypes: [
      {
        name: 'Maling',
        slug: 'maling',
        icon: 'fa-paint-roller',
        color: '#F97316',
        defaultInterval: 60,
        description: 'Utvendig og innvendig maling',
        subtypes: [
          { name: 'Fasade', slug: 'fasade', interval: 60 },
          { name: 'Innvendig', slug: 'innvendig', interval: 36 },
          { name: 'Detaljer', slug: 'detaljer', interval: 24 }
        ]
      },
      {
        name: 'Fasadearbeid',
        slug: 'fasadearbeid',
        icon: 'fa-building',
        color: '#78716C',
        defaultInterval: 60,
        description: 'Reparasjon og vedlikehold av fasader',
        subtypes: [
          { name: 'Mur/betong', slug: 'mur-betong', interval: 60 },
          { name: 'Trekledning', slug: 'trekledning', interval: 36 },
          { name: 'Metallkledning', slug: 'metallkledning', interval: 48 }
        ]
      },
      {
        name: 'Gulv',
        slug: 'gulv',
        icon: 'fa-square',
        color: '#A3A3A3',
        defaultInterval: 36,
        description: 'Vedlikehold og behandling av gulv',
        subtypes: [
          { name: 'Parkett', slug: 'parkett', interval: 36 },
          { name: 'Betong', slug: 'betong', interval: 60 },
          { name: 'Vinyl/linoleum', slug: 'vinyl', interval: 24 }
        ]
      }
    ],
    intervals: [12, 24, 36, 48, 60]
  }
];

// Helper to insert industry template
async function insertIndustry(industry) {
  // Check if already exists
  let existing;
  if (useSupabase) {
    const { data } = await supabase
      .from('industry_templates')
      .select('id')
      .eq('slug', industry.slug)
      .single();
    existing = data;
  } else {
    existing = db.prepare('SELECT id FROM industry_templates WHERE slug = ?').get(industry.slug);
  }

  if (existing) {
    console.log(`  - ${industry.name} already exists, skipping`);
    return existing.id;
  }

  // Insert template
  let templateId;
  if (useSupabase) {
    const { data, error } = await supabase
      .from('industry_templates')
      .insert({
        name: industry.name,
        slug: industry.slug,
        icon: industry.icon,
        color: industry.color,
        description: industry.description,
        sort_order: industry.sortOrder
      })
      .select('id')
      .single();
    if (error) throw error;
    templateId = data.id;
  } else {
    const result = db.prepare(`
      INSERT INTO industry_templates (name, slug, icon, color, description, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      industry.name,
      industry.slug,
      industry.icon,
      industry.color,
      industry.description,
      industry.sortOrder
    );
    templateId = result.lastInsertRowid;
  }

  // Insert service types
  for (const serviceType of industry.serviceTypes || []) {
    let serviceTypeId;
    if (useSupabase) {
      const { data, error } = await supabase
        .from('template_service_types')
        .insert({
          template_id: templateId,
          name: serviceType.name,
          slug: serviceType.slug,
          icon: serviceType.icon,
          color: serviceType.color,
          default_interval_months: serviceType.defaultInterval,
          description: serviceType.description,
          sort_order: serviceType.sortOrder || 0
        })
        .select('id')
        .single();
      if (error) throw error;
      serviceTypeId = data.id;
    } else {
      const result = db.prepare(`
        INSERT INTO template_service_types (template_id, name, slug, icon, color, default_interval_months, description, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        templateId,
        serviceType.name,
        serviceType.slug,
        serviceType.icon,
        serviceType.color,
        serviceType.defaultInterval,
        serviceType.description,
        serviceType.sortOrder || 0
      );
      serviceTypeId = result.lastInsertRowid;
    }

    // Insert subtypes
    for (const subtype of serviceType.subtypes || []) {
      if (useSupabase) {
        await supabase.from('template_subtypes').insert({
          service_type_id: serviceTypeId,
          name: subtype.name,
          slug: subtype.slug,
          default_interval_months: subtype.interval
        });
      } else {
        db.prepare(`
          INSERT INTO template_subtypes (service_type_id, name, slug, default_interval_months)
          VALUES (?, ?, ?, ?)
        `).run(serviceTypeId, subtype.name, subtype.slug, subtype.interval);
      }
    }

    // Insert equipment types
    for (const equip of serviceType.equipment || []) {
      if (useSupabase) {
        await supabase.from('template_equipment').insert({
          service_type_id: serviceTypeId,
          name: equip.name,
          slug: equip.slug
        });
      } else {
        db.prepare(`
          INSERT INTO template_equipment (service_type_id, name, slug)
          VALUES (?, ?, ?)
        `).run(serviceTypeId, equip.name, equip.slug);
      }
    }
  }

  // Insert intervals
  const defaultInterval = industry.intervals?.includes(12) ? 12 : industry.intervals?.[0] || 12;
  for (const months of industry.intervals || [12]) {
    const label = months === 0 ? 'Løpende' : months < 12 ? `${months} mnd` : `${months / 12} år`;
    if (useSupabase) {
      await supabase.from('template_intervals').insert({
        template_id: templateId,
        months: months,
        label: label,
        is_default: months === defaultInterval ? 1 : 0
      });
    } else {
      db.prepare(`
        INSERT INTO template_intervals (template_id, months, label, is_default)
        VALUES (?, ?, ?, ?)
      `).run(templateId, months, label, months === defaultInterval ? 1 : 0);
    }
  }

  console.log(`  ✓ ${industry.name} created with ${industry.serviceTypes?.length || 0} service types`);
  return templateId;
}

// Add onboarding_completed to organizations
async function addOnboardingColumn() {
  console.log('Adding onboarding_completed column to organizations...');
  try {
    if (useSupabase) {
      await supabaseExec('ALTER TABLE organizations ADD COLUMN onboarding_completed BOOLEAN DEFAULT FALSE');
    } else {
      sqliteExec('ALTER TABLE organizations ADD COLUMN onboarding_completed INTEGER DEFAULT 0');
    }
    console.log('  ✓ onboarding_completed column added');
  } catch (e) {
    console.log('  - Column already exists or organizations table not found (OK)');
  }
}

// Main migration function
async function migrate() {
  console.log('\n========================================');
  console.log('  Multi-Industry Seed Migration');
  console.log('========================================\n');

  await initDatabase();

  // Add onboarding_completed column
  await addOnboardingColumn();

  // Seed all industries
  console.log('\nSeeding industry templates...\n');

  for (const industry of INDUSTRIES) {
    await insertIndustry(industry);
  }

  // Count total
  let count;
  if (useSupabase) {
    const { count: c } = await supabase
      .from('industry_templates')
      .select('*', { count: 'exact', head: true });
    count = c;
  } else {
    count = db.prepare('SELECT COUNT(*) as count FROM industry_templates').get().count;
  }

  console.log('\n========================================');
  console.log(`  Migration completed!`);
  console.log(`  Total industry templates: ${count}`);
  console.log('========================================\n');
}

// Run migration
migrate().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});

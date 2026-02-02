# Sky Planner App (Backend + Kart-applikasjon)

> Hovedapplikasjonen for kundeadministrasjon og ruteplanlegging.
> **Kjører på:** Express.js + TypeScript

---

## Hurtigoversikt

| Hva | Hvor |
|-----|------|
| Backend API | `src/server.ts` |
| Frontend | `public/app.js` + `public/style.css` |
| Database | Supabase |
| Port | 3000 |

---

## Filstruktur

```
apps/app/
├── src/                    # TypeScript kildekode
│   ├── server.ts           # Express app entry
│   ├── config/
│   │   └── env.ts          # Miljøvariabler
│   ├── routes/
│   │   ├── auth.ts         # Autentisering
│   │   ├── kunder.ts       # Kunde-CRUD
│   │   ├── onboarding.ts   # Onboarding-flow
│   │   ├── team-members.ts # Teammedlemmer
│   │   ├── api-keys.ts     # API-nøkler
│   │   ├── webhooks.ts     # Webhooks-administrasjon
│   │   ├── import.ts       # Dataimport
│   │   ├── integrations.ts # Regnskapssystem-integrasjoner
│   │   ├── super-admin.ts  # Super admin-funksjoner
│   │   ├── docs.ts         # API-dokumentasjon
│   │   └── public-api/     # Public API v1
│   │       └── v1/
│   │           ├── index.ts
│   │           └── customers.ts
│   ├── services/
│   │   ├── database.ts     # Database-operasjoner
│   │   ├── logger.ts       # Logging (Pino)
│   │   ├── token-blacklist.ts
│   │   ├── api-keys.ts     # API-nøkkel-håndtering
│   │   ├── webhooks.ts     # Webhook-utsendelse
│   │   ├── geocoding.ts    # Geokoding
│   │   └── import/         # Import-system
│   │       ├── index.ts
│   │       ├── parser.ts
│   │       ├── validation.ts
│   │       ├── transformers.ts
│   │       ├── database.ts
│   │       └── format-detection.ts
│   ├── integrations/       # Regnskapssystem-adaptere
│   │   ├── index.ts
│   │   ├── base-adapter.ts
│   │   ├── registry.ts
│   │   ├── encryption.ts
│   │   ├── types.ts
│   │   └── adapters/
│   │       ├── tripletex.ts
│   │       ├── fiken.ts
│   │       └── poweroffice.ts
│   ├── middleware/
│   │   ├── auth.ts         # JWT-autentisering
│   │   └── api-key-auth.ts # API-nøkkel-autentisering
│   ├── types/
│   │   ├── index.ts
│   │   ├── api-key.ts
│   │   ├── import.ts
│   │   └── webhook.ts
│   ├── utils/
│   │   └── validation.ts
│   └── docs/
│       └── openapi.yaml    # OpenAPI-spesifikasjon
├── public/                 # Frontend
│   ├── index.html          # Hovedside
│   ├── app.js              # Frontend JavaScript
│   ├── app.min.js          # Minifisert
│   ├── style.css           # Dark theme CSS
│   ├── style.min.css       # Minifisert
│   ├── admin.html          # Admin-panel
│   ├── admin.js
│   └── admin.css
├── scripts/                # Hjelpescripts (migrering, import, etc.)
├── migrations/             # Database-migrasjoner
└── supabase-service.js     # Legacy Supabase-abstraksjon
```

---

## Kjøre lokalt

```bash
cd apps/app
pnpm dev          # Utviklingsmodus med tsx watch
pnpm start        # Produksjon
pnpm build        # Kompiler TypeScript
```

---

## API-endepunkter

### Autentisering
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| POST | `/api/auth/login` | Logg inn |
| POST | `/api/auth/logout` | Logg ut |
| GET | `/api/auth/me` | Hent innlogget bruker |

### Kunder
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/kunder` | Hent alle kunder |
| GET | `/api/kunder/:id` | Hent én kunde |
| POST | `/api/kunder` | Opprett ny kunde |
| PUT | `/api/kunder/:id` | Oppdater kunde |
| DELETE | `/api/kunder/:id` | Slett kunde |
| POST | `/api/kunder/bulk-complete` | Marker flere som ferdige |

### API-nøkler
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/api-keys` | List API-nøkler |
| POST | `/api/api-keys` | Opprett ny nøkkel |
| DELETE | `/api/api-keys/:id` | Slett nøkkel |

### Webhooks
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/webhooks` | List webhooks |
| POST | `/api/webhooks` | Opprett webhook |
| PUT | `/api/webhooks/:id` | Oppdater webhook |
| DELETE | `/api/webhooks/:id` | Slett webhook |

### Import
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| POST | `/api/import/preview` | Forhåndsvis import |
| POST | `/api/import/execute` | Utfør import |

### Integrasjoner
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/integrations` | List integrasjoner |
| POST | `/api/integrations/:provider/connect` | Koble til |
| POST | `/api/integrations/:provider/disconnect` | Koble fra |
| POST | `/api/integrations/:provider/sync` | Synkroniser data |

### Public API (v1)
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/v1/customers` | List kunder |
| GET | `/api/v1/customers/:id` | Hent kunde |
| POST | `/api/v1/customers` | Opprett kunde |
| PUT | `/api/v1/customers/:id` | Oppdater kunde |
| DELETE | `/api/v1/customers/:id` | Slett kunde |

---

## Database-tabeller

- `kunder` - Kundedata med koordinater og kontroll-datoer
- `ruter` - Planlagte serviceruter
- `avtaler` - Kalender-avtaler
- `kontaktlogg` - Kundekontakt-historikk
- `api_keys` - API-nøkler for integrasjoner
- `webhooks` - Webhook-konfigurasjoner
- `import_jobs` - Import-historikk

---

## Frontend-faner (sidebar)

1. **Kunder** - Søk og områdefilter
2. **Varsler** - Kommende kontroller
3. **Ruter** - Lagrede ruter
4. **Kalender** - Månedsoversikt
5. **Planlegger** - År/område-planlegging

---

## Integrasjoner

### Eksterne tjenester
- **OpenRouteService** - Ruteoptimalisering
- **Kartverket API** - Geokoding
- **Leaflet** - Interaktivt kart

### Regnskapssystemer
- **Tripletex** - Synkronisering av kunder
- **Fiken** - Synkronisering av kunder
- **PowerOffice** - Synkronisering av kunder

---

## Migrasjoner

```bash
# Kjør migrasjoner
node migrations/001_initial.cjs
node migrations/005_super_admin.cjs
# SQL-migrasjoner kjøres direkte i Supabase
```

| Migrasjon | Beskrivelse |
|-----------|-------------|
| 005_super_admin | Super admin-rolle |
| 006_import_system | Import-tabeller |
| 007_api_keys | API-nøkler |
| 008_webhooks | Webhooks |
| 009_external_id | Eksterne ID-er for integrasjoner |

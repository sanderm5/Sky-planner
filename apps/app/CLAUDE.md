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
│   │   ├── config.ts       # App-konfigurasjon (branding, kart, etc.)
│   │   ├── onboarding.ts   # Onboarding-flow
│   │   ├── team-members.ts # Teammedlemmer
│   │   ├── api-keys.ts     # API-nøkler
│   │   ├── webhooks.ts     # Webhooks-administrasjon
│   │   ├── import.ts       # Dataimport (staging-basert)
│   │   ├── export.ts       # Dataeksport (CSV, JSON, GDPR)
│   │   ├── integrations.ts # Regnskapssystem-integrasjoner
│   │   ├── integration-webhooks.ts # Innkommende webhooks fra regnskapssystem
│   │   ├── cron.ts         # Planlagte vedlikeholdsoppgaver
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
│   │   ├── alerts.ts       # Varslingssystem (Slack, Discord, webhook)
│   │   ├── export.ts       # Eksport-tjeneste (CSV, JSON, GDPR)
│   │   └── import/         # Import-system
│   │       ├── index.ts
│   │       ├── parser.ts
│   │       ├── validation.ts
│   │       ├── transformers.ts
│   │       ├── database.ts
│   │       ├── format-detection.ts
│   │       ├── cleaner.ts           # Auto-rensing av importdata (10 regler)
│   │       ├── duplicate-detection.ts # Fuzzy duplikatdeteksjon
│   │       ├── ai-mapping.ts        # AI-assistert kolonnemapping (Claude)
│   │       └── postnummer-registry.ts # Norsk postnummerregister (~5000 koder)
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
│   │   ├── api-key-auth.ts # API-nøkkel-autentisering
│   │   ├── csrf.ts         # CSRF-beskyttelse (double-submit cookie)
│   │   └── subscription.ts # Abonnement-sjekk
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

### Eksport
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/export/kunder?format=csv\|json` | Eksporter kunder |
| GET | `/api/export/ruter?format=csv\|json` | Eksporter ruter |
| GET | `/api/export/all` | Full GDPR-dataeksport |

### Integrasjoner
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/integrations` | List integrasjoner |
| POST | `/api/integrations/:provider/connect` | Koble til |
| POST | `/api/integrations/:provider/disconnect` | Koble fra |
| POST | `/api/integrations/:provider/sync` | Synkroniser data |

### Innkommende integrasjon-webhooks
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| POST | `/api/integration-webhooks/tripletex/:orgId` | Tripletex-hendelser |

### Cron-jobber (beskyttet med CRON_SECRET)
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| POST | `/api/cron/cleanup-tokens` | Rydd opp utløpte tokens |
| POST | `/api/cron/cleanup-all` | Kjør all opprydding |
| POST | `/api/cron/process-deletions` | Utfør ventende kontoslettinger |
| POST | `/api/cron/sync-integrations` | Synkroniser aktive integrasjoner |
| GET | `/api/cron/health` | Helsesjekk for cron-overvåking |

### Public API (v1)
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/v1/customers` | List kunder |
| GET | `/api/v1/customers/:id` | Hent kunde |
| POST | `/api/v1/customers` | Opprett kunde |
| PUT | `/api/v1/customers/:id` | Oppdater kunde |
| DELETE | `/api/v1/customers/:id` | Slett kunde |

### Andre
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/csrf-token` | Hent CSRF-token |
| GET | `/api/health` | Helsesjekk |
| GET | `/api/health/detailed` | Detaljert helsesjekk (DB, minne, uptime) |

---

## Database-tabeller

- `kunder` - Kundedata med koordinater og kontroll-datoer
- `ruter` - Planlagte serviceruter
- `avtaler` - Kalender-avtaler
- `kontaktlogg` - Kundekontakt-historikk
- `api_keys` - API-nøkler for integrasjoner
- `webhooks` - Webhook-konfigurasjoner
- `import_jobs` - Import-historikk (med duplikatinfo, kvalitetsrapport)
- `failed_sync_items` - Feilede integrasjonssynkroniseringer (retry-mekanisme)
- `account_deletion_requests` - GDPR kontosletting-forespørsler
- `totp_pending_sessions` - 2FA-sesjoner under innlogging
- `totp_audit_log` - Revisjonslogg for 2FA-hendelser

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
- **Tripletex** - Synkronisering av kunder + innkommende webhooks
- **Fiken** - Synkronisering av kunder
- **PowerOffice** - Synkronisering av kunder

---

## Sikkerhet

| Lag | Beskrivelse |
|-----|-------------|
| CSRF | Double-submit cookie-mønster på alle POST/PUT/PATCH/DELETE |
| Rate limiting | 3 nivåer: generelt API, innlogging, sensitive handlinger |
| Helmet | Sikkerhetshoder inkl. CSP, HSTS (1 år) |
| CORS | Streng origin-validering (prod: ALLOWED_ORIGINS) |
| RLS | Row-Level Security for multi-tenant isolasjon |
| Innholdsvalidering | Avviser forespørsler uten riktig Content-Type |

**Middleware-rekkefølge:** Helmet → CORS → Body parsing → Cookie → CSRF-token → CSRF-validering → Content-Type → Request ID → Logging → Rate limiting

---

## Migrasjoner

```bash
# SQL-migrasjoner kjøres direkte i Supabase
```

| Migrasjon | Beskrivelse |
|-----------|-------------|
| 005_super_admin | Super admin-rolle |
| 006_import_system | Import-tabeller |
| 007_api_keys | API-nøkler |
| 008_webhooks | Webhooks |
| 009_external_id | Eksterne ID-er for integrasjoner |
| 010_rls_security_policies | Row-Level Security-policyer |
| 011_tenant_rls_policies | Tenant-spesifikke RLS-policyer |
| 012_email_verification | E-postverifisering (token, utløpstid) |
| 013_gdpr_account_deletion | GDPR-kontosletting (soft-delete, grace period) |
| 014_two_factor_auth | 2FA/TOTP (kryptert hemmelighet, backup-koder, audit-logg) |
| 015_app_mode | Applikasjonsmodus-konfigurasjon |
| 016_fix_password_reset_tokens | Passordtilbakestilling-fiks |
| 016_mvp_friendly_defaults | MVP-vennlige standardverdier |
| 017_failed_sync_items | Retry-mekanisme for feilede synkroniseringer |
| 018_import_enhancements | Duplikatdeteksjon, kvalitetsrapport, flerark-støtte |

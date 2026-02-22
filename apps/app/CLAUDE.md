# Sky Planner App (Backend + Kart-applikasjon)

> Hovedapplikasjonen for kundeadministrasjon og ruteplanlegging.
> **Kjører på:** Express.js + TypeScript

---

## Hurtigoversikt

| Hva | Hvor |
|-----|------|
| Backend API | `src/server.ts` |
| Frontend kilde | `frontend/` (50 filer → bygges til `public/app.js`) |
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
│   │   ├── config.ts       # App-konfigurasjon + ruteoptimalisering (VROOM)
│   │   ├── onboarding.ts   # Onboarding-flow
│   │   ├── team-members.ts # Teammedlemmer
│   │   ├── api-keys.ts     # API-nøkler
│   │   ├── webhooks.ts     # Webhooks-administrasjon
│   │   ├── import.ts       # Dataimport (staging-basert)
│   │   ├── export.ts       # Dataeksport (CSV, JSON, GDPR)
│   │   ├── integrations.ts # Regnskapssystem-integrasjoner
│   │   ├── integration-webhooks.ts # Innkommende webhooks fra regnskapssystem
│   │   ├── avtaler.ts      # Kalender-avtaler
│   │   ├── ruter.ts        # Ruter og ruteplanlegging
│   │   ├── chat.ts         # Chat-meldinger
│   │   ├── patch-notes.ts  # Patch notes / changelog
│   │   ├── todays-work.ts  # Dagens arbeid-widget
│   │   ├── features.ts     # Feature flags
│   │   ├── industries.ts   # Bransjer
│   │   ├── service-types.ts # Tjenestetyper
│   │   ├── tags.ts         # Kunde-tags og tag-grupper (CRUD)
│   │   ├── reports.ts      # Rapporter
│   │   ├── kontaktlogg.ts  # Kontaktlogg
│   │   ├── kontaktpersoner.ts # Kontaktpersoner
│   │   ├── customer-emails.ts # Kunde-e-poster
│   │   ├── email.ts        # E-postfunksjonalitet
│   │   ├── ekk.ts          # EKK-integrasjon
│   │   ├── outlook.ts      # Outlook-kalendersynkronisering
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
├── frontend/               # Frontend kildekode (rediger her!)
│   ├── utils/              # Hjelpefunksjoner (escapeHtml, logger, csrf, modal, theme, sorting)
│   ├── constants/          # Konstanter (icons)
│   ├── services/           # Tjenester (auth, api, feature-flags, subscription, websocket)
│   ├── modules/            # Feature-moduler (37 filer: markers, weekplan, calendar, etc.)
│   └── app-legacy.js       # Global state + DOMContentLoaded + setupEventListeners
├── public/                 # Generert output (IKKE rediger manuelt!)
│   ├── index.html          # Hovedside
│   ├── app.js              # Bygget fra frontend/ via build-frontend.mjs
│   ├── app.min.js          # Minifisert
│   ├── style.css           # Dark theme CSS
│   ├── style.min.css       # Minifisert
│   ├── admin.html          # Admin-panel
│   ├── admin.js
│   └── admin.css
├── build-frontend.mjs      # Bygger frontend/ → public/app.js (concatenation)
├── scripts/                # Hjelpescripts (migrering, import, etc.)
├── migrations/             # Database-migrasjoner
└── supabase-service.js     # Legacy Supabase-abstraksjon
```

---

## Kjøre lokalt

```bash
cd apps/app
pnpm dev              # Utviklingsmodus med tsx watch
pnpm start            # Produksjon
pnpm build            # Kompiler TypeScript
npm run build:frontend  # Bygg frontend (concat + terser + cleancss)
npm run dev:frontend    # Watch-modus for frontend
```

### Frontend build-system
- Kildekode i `frontend/` → concateneres → `public/app.js` (alle filer deler global scope)
- **Rediger ALLTID i `frontend/`**, ALDRI i `public/app.js` direkte
- `build-frontend.mjs` definerer filrekkefølgen (dependency order)
- Etter endringer: kjør `npm run build:frontend` for å bygge

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

### Tags og tag-grupper
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/tags` | Liste alle tags for organisasjonen |
| POST | `/api/tags` | Opprett tag (valgfri `group_id`) |
| PUT | `/api/tags/:id` | Oppdater tag |
| DELETE | `/api/tags/:id` | Slett tag |
| GET | `/api/tags/groups` | Liste alle tag-grupper |
| POST | `/api/tags/groups` | Opprett tag-gruppe (navn, farge) |
| PUT | `/api/tags/groups/:id` | Oppdater tag-gruppe |
| DELETE | `/api/tags/groups/:id` | Slett tag-gruppe (tags blir ugruppert) |
| GET | `/api/tags/kunde-tags` | Alle kunde-tag-tilordninger for org |
| GET | `/api/tags/kunder/:id/tags` | Tags for en spesifikk kunde |
| POST | `/api/tags/kunder/:id/tags/:tagId` | Legg tag på kunde |
| DELETE | `/api/tags/kunder/:id/tags/:tagId` | Fjern tag fra kunde |

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
- `feature_definitions` - Feature-flag-katalog
- `organization_features` - Feature-aktivering per organisasjon
- `patch_notes` - Changelog/nyheter (global, items JSONB med visibility)
- `chat_messages` - Chat-meldinger
- `todays_work` - Dagens arbeid-oppgaver
- `organizations` - Organisasjoner (multi-tenant)
- `brukere` - Brukere/ansatte per organisasjon
- `klient` - Klient/eier-brukere (auth)
- `tags` - Kunde-tags/kategorier (per org, valgfri `group_id`)
- `tag_groups` - Tag-grupper (hierarki: gruppe → tags, med farge og sortering)
- `kunde_tags` - Kobling mellom kunder og tags
- `organization_service_types` - Org-spesifikke tjenestekategorier

---

## Frontend-faner (sidebar)

1. **Kunder** - Søk og områdefilter
2. **Varsler** - Kommende kontroller
3. **Ruter** - Lagrede ruter
4. **Kalender** - Månedsoversikt
5. **Planlegger** - År/område-planlegging
6. **Ukeplan** - Ukentlig ruteplanlegging med:
   - Manuell kundesøk (alltid synlig)
   - Nummererte stopp med team-initialer og farger
   - Tidsestimater per stopp (08:00-08:30 format)
   - Progresjonslinje (estimert tid vs 8-timers dag)
   - Ruteoptimalisering via VROOM API
   - Slett/fjern kunder fra plan
   - Per-kunde tilordning (hvem la til kunden)

---

## Integrasjoner

### Eksterne tjenester
- **OpenRouteService** - Ruteoptimalisering og VROOM (route optimization)
- **Kartverket API** - Geokoding
- **Leaflet** - Interaktivt kart
- **Mapbox** - Satellittbilder og mørkt kart

### Regnskapssystemer
- **Tripletex** - Synkronisering av kunder + innkommende webhooks
- **Fiken** - Synkronisering av kunder
- **PowerOffice** - Synkronisering av kunder

### Andre integrasjoner
- **EKK** - El-kontroll-integrasjon
- **Outlook** - Kalendersynkronisering

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
| Inaktivitets-logout | Auto-logout etter 15 min inaktivitet (varsel etter 13 min) |
| Kontolåsing | Låser konto ved gjentatte feilet innlogginger |
| TOTP | Replay-beskyttelse mot gjenbruk av 2FA-koder |
| Backup-kryptering | AES-256-GCM kryptering av database-backups |

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
| 019_security_and_features | Sikkerhetsforbedringer og feature-system |
| 020_integration_tables | Integrasjonstabeller |
| 021_prosjektnummer | Prosjektnummer-felt |
| 022_kundenummer_fakturaepost | Kundenummer og faktura-e-post |
| 023_feature_modules | Feature-modul-system (definitions + per-org) |
| 024_customer_lifecycle | Kundelivssyklus |
| 025_rls_multi_tenancy | RLS multi-tenancy policyer |
| 026_field_work | Feltarbeid |
| 027_email_templates | E-postmaler |
| 028_ekk_integration | EKK-integrasjon |
| 029_outlook_sync | Outlook-kalendersynkronisering |
| 030_organization_service_types | Organisasjonsspecifikke tjenestetyper |
| 031_smart_clusters_feature | Smarte klynger-feature |
| 032_todays_work | Dagens arbeid-widget |
| 033_date_mode | Datoformat-modus |
| 034_smart_clusters_default_enabled | Smarte klynger aktivert for alle |
| 035_patch_notes | Patch notes / changelog |
| 036_chat | Chat-system |
| 037_rute_kalender_sync | Rute-kalender-synkronisering |
| 038_account_lockout | Kontolåsing ved feil innlogging |
| 039_database_performance_cleanup | Database-ytelse opprydding |
| 040_rls_performance_optimization | RLS ytelsesoptimalisering |
| 041_rls_security_fixes | RLS sikkerhetsforbedringer |
| 042_tag_groups | Tag-grupper (hierarkisk kategori-system) |

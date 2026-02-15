# Sky Planner - Monorepo

> Kundeadministrasjon og ruteplanlegging for servicebedrifter.
> **Utvikler:** Efffekt AS

---

## Prosjektstruktur

Dette er en **monorepo** med Turborepo og pnpm workspaces.

```
/
├── apps/
│   ├── app/     → Backend API + Kart-applikasjon (Express.js + TypeScript)
│   └── web/     → Marketing-nettside + Dashboard (Astro)
├── packages/
│   ├── auth/    → Delt autentisering (JWT, cookies, TOTP, passordvalidering)
│   ├── database/→ Delt database-logikk (Supabase)
│   ├── email/   → E-postmaler og sending (Resend API)
│   └── payments/→ Betalingshåndtering (Stripe)
└── CLAUDE.md    → Denne filen (oversikt)
```

---

## Applikasjoner

### [apps/app](apps/app/CLAUDE.md) - Hovedapplikasjon
Intern applikasjon for kundeadministrasjon med:
- Interaktivt kart med kundemarkører og smarte klynger
- Ruteoptimalisering for serviceturer (VROOM/ORS)
- Ukeplan med manuell kundesøk, nummererte stopp, tidsestimater, progresjonslinje og ruteoptimalisering
- Kalender og avtaler
- Import-system for kundedata (CSV, Excel) med AI-mapping, duplikatdeteksjon og auto-rensing
- Eksport-system (CSV, JSON) med GDPR-komplett dataeksport
- API-nøkler og Public API (v1)
- Webhooks for integrasjoner (utgående + innkommende fra regnskapssystem)
- Regnskapssystem-integrasjoner (Tripletex, Fiken, PowerOffice)
- EKK-integrasjon og Outlook-kalendersynkronisering
- Patch notes / changelog-system med feature-filtrering
- Chat-system
- CSRF-beskyttelse, rate limiting, sikkerhetshoder (Helmet)
- Cron-jobber for opprydding, kontosletting og integrasjonssynkronisering
- Varslingssystem (Slack, Discord, generisk webhook)
- Inaktivitets-auto-logout (15 min)
- Kontolåsing ved gjentatte feilet innlogginger

**Stack:** Express.js, TypeScript, Vanilla JS, Leaflet, Supabase

### [apps/web](apps/web/CLAUDE.md) - Marketing-nettside
Offentlig nettside og bruker-dashboard med:
- Landing page og priser
- Brukerregistrering og autentisering
- E-postverifisering
- Tofaktorautentisering (2FA/TOTP)
- Passordvalidering med styrkeindikator
- Stripe-betalinger
- Dashboard for organisasjonsinnstillinger
- API-nøkler, integrasjoner og webhooks-administrasjon
- GDPR-kontoførespørsel om sletting (30 dagers utsettelse)

**Stack:** Astro 5, Tailwind CSS, Stripe

---

## Delte pakker

| Pakke | Beskrivelse |
|-------|-------------|
| `@skyplanner/auth` | JWT-tokens, cookies, TOTP/2FA, passordvalidering, auth-typer |
| `@skyplanner/database` | Supabase-klient, organisasjoner, klienter |
| `@skyplanner/email` | E-postmaler (velkomst, verifisering, abonnement, kontosletting) via Resend API |
| `@skyplanner/payments` | Stripe-integrasjon |

---

## Kommandoer

```bash
# Installer avhengigheter
pnpm install

# Kjør alle apps i dev-modus
pnpm dev

# Kjør kun én app
pnpm --filter @skyplanner/app dev
pnpm --filter @skyplanner/web dev

# Bygg alle
pnpm build

# Type-sjekk
pnpm typecheck
```

---

## Når du skal jobbe med prosjektet

| Oppgave | Gå til |
|---------|--------|
| Backend API / Kundedata / Kart | [apps/app/](apps/app/CLAUDE.md) |
| Marketing-nettside / Dashboard | [apps/web/](apps/web/CLAUDE.md) |
| Autentisering (delt) | `packages/auth/` |
| E-post (delt) | `packages/email/` |
| Database-logikk (delt) | `packages/database/` |

**Se CLAUDE.md i hver mappe for detaljert dokumentasjon.**

---

## Kodekonvensjoner

- **UI-tekster:** Norsk
- **Variabelnavn:** Engelsk (camelCase)
- **Database-kolonner:** Norsk med underscore (snake_case)

---

## Deployment

| App | Plattform | URL |
|-----|-----------|-----|
| `apps/web` | Vercel | `sky-planner-web.vercel.app` |
| `apps/app` | Railway | `skyplannerapp-production.up.railway.app` |

**Viktig:** `JWT_SECRET` må være identisk på Vercel og Railway for at SSO/proxy skal fungere.

Web-appen proxyer API-kall via `/api/app/...` → Railway backend `/api/...` (se `apps/web/src/pages/api/app/[...path].ts`).

---

## Miljøvariabler

Kopier `.env.example` til `.env` i `apps/app/`:

```env
# Database
DATABASE_TYPE=sqlite|supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...

# Sikkerhet
JWT_SECRET=...                  # Min 64 tegn i produksjon, IDENTISK på web og app
ENCRYPTION_SALT=...             # Påkrevd i produksjon
COOKIE_DOMAIN=.skyplanner.no   # For cross-subdomain SSO
ALLOWED_ORIGINS=...             # Komma-separert

# Kart og ruter
ORS_API_KEY=...
MAPBOX_ACCESS_TOKEN=...

# AI-assistert import (valgfritt)
AI_IMPORT_ENABLED=false
AI_API_KEY=...                  # Anthropic API-nøkkel

# E-post (Resend)
RESEND_API_KEY=...              # I packages/email

# Cron-jobber
CRON_SECRET=...                 # Beskytter cron-endepunkter

# Varsling (valgfritt)
ALERT_SLACK_WEBHOOK=...
ALERT_DISCORD_WEBHOOK=...

# Backup-kryptering
BACKUP_ENCRYPTION_KEY=...       # AES-256-GCM, generer med openssl rand -base64 48
```

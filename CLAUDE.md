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
│   ├── auth/    → Delt autentisering (JWT, cookies)
│   ├── database/→ Delt database-logikk (Supabase)
│   └── payments/→ Betalingshåndtering (Stripe)
└── CLAUDE.md    → Denne filen (oversikt)
```

---

## Applikasjoner

### [apps/app](apps/app/CLAUDE.md) - Hovedapplikasjon
Intern applikasjon for kundeadministrasjon med:
- Interaktivt kart med kundemarkører
- Ruteoptimalisering for serviceturer
- Kalender og avtaler
- Import-system for kundedata (CSV, Excel)
- API-nøkler og Public API (v1)
- Webhooks for integrasjoner
- Regnskapssystem-integrasjoner (Tripletex, Fiken, PowerOffice)

**Stack:** Express.js, TypeScript, Vanilla JS, Leaflet, Supabase

### [apps/web](apps/web/CLAUDE.md) - Marketing-nettside
Offentlig nettside og bruker-dashboard med:
- Landing page og priser
- Brukerregistrering og autentisering
- Stripe-betalinger
- Dashboard for organisasjonsinnstillinger
- API-nøkler, integrasjoner og webhooks-administrasjon

**Stack:** Astro 5, Tailwind CSS, Stripe

---

## Delte pakker

| Pakke | Beskrivelse |
|-------|-------------|
| `@skyplanner/auth` | JWT-tokens, cookies, auth-typer |
| `@skyplanner/database` | Supabase-klient, organisasjoner, klienter |
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
| Database-logikk (delt) | `packages/database/` |

**Se CLAUDE.md i hver mappe for detaljert dokumentasjon.**

---

## Kodekonvensjoner

- **UI-tekster:** Norsk
- **Variabelnavn:** Engelsk (camelCase)
- **Database-kolonner:** Norsk med underscore (snake_case)

---

## Miljøvariabler

Kopier `.env.example` til `.env` i `apps/app/`:

```env
DATABASE_TYPE=sqlite|supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ORS_API_KEY=...
ENCRYPTION_KEY=...
```

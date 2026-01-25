# Sky Planner - Monorepo

> Kundeadministrasjon og ruteplanlegging for servicebedrifter.
> **Utvikler:** Efffekt AS

---

## Prosjektstruktur

Dette er en **monorepo** med Turborepo og pnpm workspaces.

```
/
├── apps/
│   ├── app/     → Backend API + Kart-applikasjon (Express.js)
│   └── web/     → Marketing-nettside (Astro)
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
- E-postvarsler

**Stack:** Express.js, Vanilla JS, Leaflet, SQLite/Supabase

### [apps/web](apps/web/CLAUDE.md) - Marketing-nettside
Offentlig nettside for produktet med:
- Landing page
- Priser og FAQ
- Brukerregistrering
- Stripe-betalinger

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
| Marketing-nettside / Priser / Registrering | [apps/web/](apps/web/CLAUDE.md) |
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
ORS_API_KEY=...
```

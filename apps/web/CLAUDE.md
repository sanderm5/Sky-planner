# Sky Planner Web (Marketing-nettside + Dashboard)

> Offentlig markedsføringsside og bruker-dashboard for Sky Planner.
> **Kjører på:** Next.js 15 (App Router) + React 19 + Tailwind CSS

---

## Hurtigoversikt

| Hva | Hvor |
|-----|------|
| Framework | Next.js 15 (App Router, React 19) |
| Styling | Tailwind CSS |
| Betalinger | Stripe (midlertidig deaktivert, Fiken-fakturering) |
| Port | 3001 (dev) |

---

## Filstruktur

```
apps/web/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── layout.tsx                # Root layout (<html>, fonts, globals.css)
│   │   ├── globals.css               # Global CSS (aurora, starfield, mountain-animasjoner)
│   │   ├── not-found.tsx             # 404-side
│   │   ├── error.tsx                 # Feilside
│   │   ├── (marketing)/              # Route group — marketing-sider
│   │   │   ├── layout.tsx            # Header + Footer + ScrollAnimationObserver
│   │   │   ├── page.tsx              # Forsiden
│   │   │   ├── priser/page.tsx
│   │   │   ├── faq/page.tsx
│   │   │   ├── kontakt/page.tsx
│   │   │   ├── funksjoner/page.tsx
│   │   │   ├── demo/page.tsx
│   │   │   ├── personvern/page.tsx
│   │   │   └── vilkar/page.tsx
│   │   ├── auth/
│   │   │   ├── layout.tsx            # AuthLayout (fjellbakgrunn)
│   │   │   ├── login/page.tsx
│   │   │   ├── registrer/page.tsx
│   │   │   ├── glemt-passord/page.tsx
│   │   │   ├── tilbakestill-passord/page.tsx
│   │   │   ├── verify-email/page.tsx
│   │   │   ├── verify-2fa/page.tsx
│   │   │   └── success/page.tsx
│   │   ├── dashboard/
│   │   │   ├── layout.tsx            # Auth-sjekk + Sidebar + Header
│   │   │   ├── page.tsx              # Oversikt
│   │   │   ├── brukere/page.tsx
│   │   │   ├── abonnement/page.tsx
│   │   │   ├── fakturaer/page.tsx
│   │   │   └── innstillinger/
│   │   │       ├── page.tsx          # Organisasjonsinnstillinger
│   │   │       ├── tjenester/page.tsx
│   │   │       ├── kategorier/page.tsx
│   │   │       ├── integrasjoner/page.tsx
│   │   │       ├── api-nokler/page.tsx
│   │   │       ├── webhooks/page.tsx
│   │   │       ├── sikkerhet/page.tsx
│   │   │       ├── personvern/page.tsx
│   │   │       └── oauth-callback/page.tsx
│   │   └── api/                      # Route Handlers
│   │       ├── auth/{login,register,logout,...}/route.ts
│   │       ├── dashboard/{organization,users,...}/route.ts
│   │       ├── dashboard/2fa/{setup,verify,disable,status}/route.ts
│   │       ├── webhooks/stripe/route.ts
│   │       ├── app/[...path]/route.ts   # Proxy til app API
│   │       ├── contact/route.ts
│   │       ├── industries/route.ts
│   │       └── cron/backup/route.ts
│   ├── components/
│   │   ├── layout/                   # Header.tsx, Footer.tsx
│   │   ├── sections/                 # Hero, Features, HowItWorks, etc.
│   │   ├── dashboard/                # Sidebar, DashboardHeader, StatCard, SettingsNav
│   │   ├── dashboard-pages/          # Client Components for interaktive dashboard-sider
│   │   │   ├── IntegrasjonsManager.tsx
│   │   │   ├── SikkerhetManager.tsx
│   │   │   ├── WebhooksManager.tsx
│   │   │   ├── ApiNoklerManager.tsx
│   │   │   ├── KategorierManager.tsx
│   │   │   ├── TjenesterManager.tsx
│   │   │   ├── BrukereManager.tsx
│   │   │   ├── OrgSettingsForm.tsx
│   │   │   ├── PersonvernSettings.tsx
│   │   │   └── FakturaerManager.tsx
│   │   ├── ui/                       # GlassCard, Badge, FeatureIcon, PasswordStrengthIndicator
│   │   └── auth/                     # LoginForm, RegisterForm, etc.
│   ├── lib/
│   │   ├── auth.ts                   # requireAuth(), requireApiAuth(), requireAdminApiAuth()
│   │   ├── csrf.ts                   # getCsrfToken() client utility
│   │   └── db.ts                     # Database init helper (singleton)
│   └── hooks/
│       └── (reserved for future hooks)
├── middleware.ts                      # CSRF + sikkerhetsheadere (root-nivå)
├── next.config.ts                     # Next.js-konfigurasjon
├── tailwind.config.js                 # Tailwind-konfigurasjon
└── postcss.config.cjs                 # PostCSS (CommonJS pga "type": "module")
```

---

## Arkitektur

### Server vs Client Components

- **Server Components** (standard): Marketing-sider, dashboard page.tsx-filer, StatCard
- **Client Components** (`'use client'`): Header (usePathname), Sidebar, DashboardHeader, alle auth-skjemaer, alle dashboard-managers (interaktive sider)

### Mønster for dashboard-sider

```tsx
// page.tsx (Server Component) — gjør auth, sender data til client
import { requireAuth } from '@/lib/auth';
import SomeManager from '@/components/dashboard-pages/SomeManager';

export default async function SomePage() {
  const auth = await requireAuth();
  return <SomeManager organizationId={auth.organizationId} />;
}
```

```tsx
// SomeManager.tsx (Client Component) — all interaktivitet
'use client';
export default function SomeManager({ organizationId }: Props) {
  // useState, useEffect, fetch-kall, modaler, etc.
}
```

### CSRF-beskyttelse

- Middleware setter `__csrf`-cookie på GET-forespørsler
- Client components leser token via `getCsrfToken()` fra `@/lib/csrf`
- API-ruter validerer `X-CSRF-Token`-header mot cookie (double-submit)

### Auth-flyt

- `requireAuth()` — for sider (Server Components), redirecter til login ved feil
- `requireApiAuth(request)` — for API-ruter, returnerer Response ved feil
- `requireAdminApiAuth(request)` — som over, men krever admin-rolle
- `isAuthError(result)` — type guard for å sjekke om result er en feil-Response

---

## Kjøre lokalt

```bash
cd apps/web
pnpm dev          # http://localhost:3001
pnpm build        # Produksjonsbygg
pnpm start        # Kjør produksjonsbygg
pnpm typecheck    # Type-sjekk
```

---

## Sider

### Offentlige sider
| Sti | Beskrivelse |
|-----|-------------|
| `/` | Landing page med features og testimonials |
| `/priser` | Prisplaner og sammenligning |
| `/faq` | Ofte stilte spørsmål |
| `/kontakt` | Kontaktskjema |
| `/funksjoner` | Detaljert features-side |
| `/demo` | Demo-videoer |
| `/personvern` | Personvernerklæring |
| `/vilkar` | Vilkår og betingelser |

### Autentisering
| Sti | Beskrivelse |
|-----|-------------|
| `/auth/login` | Innlogging |
| `/auth/registrer` | Opprett ny konto (med passordstyrke-indikator) |
| `/auth/glemt-passord` | Be om passordtilbakestilling |
| `/auth/tilbakestill-passord` | Sett nytt passord (med token) |
| `/auth/verify-email` | E-postverifisering (med token) |
| `/auth/verify-2fa` | 2FA-verifisering |
| `/auth/success` | Bekreftelse etter registrering |

### Dashboard
| Sti | Beskrivelse |
|-----|-------------|
| `/dashboard` | Dashboard-oversikt |
| `/dashboard/brukere` | Administrer brukere |
| `/dashboard/abonnement` | Abonnement-oversikt |
| `/dashboard/fakturaer` | Faktura-historikk |
| `/dashboard/innstillinger` | Organisasjonsinnstillinger |
| `/dashboard/innstillinger/tjenester` | Tjenester (fargevelger, ikoner) |
| `/dashboard/innstillinger/kategorier` | Grupper og tags |
| `/dashboard/innstillinger/api-nokler` | API-nøkler |
| `/dashboard/innstillinger/integrasjoner` | Regnskapssystem-integrasjoner |
| `/dashboard/innstillinger/webhooks` | Webhooks |
| `/dashboard/innstillinger/sikkerhet` | 2FA og sesjoner |
| `/dashboard/innstillinger/personvern` | GDPR-innstillinger |
| `/dashboard/innstillinger/oauth-callback` | OAuth callback-handler |

---

## API Routes

### Autentisering
| Endpoint | Beskrivelse |
|----------|-------------|
| `POST /api/auth/register` | Registrer ny bruker (med passordvalidering) |
| `POST /api/auth/login` | Logg inn bruker |
| `POST /api/auth/logout` | Logg ut bruker |
| `POST /api/auth/glemt-passord` | Be om passordtilbakestilling |
| `POST /api/auth/tilbakestill-passord` | Sett nytt passord |
| `GET /api/auth/verify-email` | Verifiser e-postadresse (med token) |
| `POST /api/auth/verify-2fa` | Verifiser 2FA-kode |

### Dashboard
| Endpoint | Beskrivelse |
|----------|-------------|
| `GET /api/dashboard/invoices` | Hent fakturaer |
| `GET/PUT /api/dashboard/organization` | Hent/oppdater organisasjon |
| `POST /api/dashboard/organization/upload-logo` | Last opp logo |
| `POST /api/dashboard/subscription/portal` | Stripe kundeportal (deaktivert) |
| `GET/POST /api/dashboard/users` | Hent/inviter brukere |
| `PUT/DELETE /api/dashboard/users/[id]` | Oppdater/slett bruker |
| `GET /api/dashboard/sessions/list` | Hent aktive sesjoner |
| `POST /api/dashboard/sessions/terminate` | Avslutt sesjon |
| `GET/POST/DELETE /api/dashboard/delete-account` | GDPR-kontosletting |

### Tofaktorautentisering (2FA)
| Endpoint | Beskrivelse |
|----------|-------------|
| `POST /api/dashboard/2fa/setup` | Initialiser 2FA |
| `POST /api/dashboard/2fa/verify` | Verifiser og aktiver 2FA |
| `POST /api/dashboard/2fa/disable` | Deaktiver 2FA |
| `GET /api/dashboard/2fa/status` | Hent 2FA-status |

### Andre
| Endpoint | Beskrivelse |
|----------|-------------|
| `POST /api/contact` | Kontaktskjema |
| `POST /api/webhooks/stripe` | Stripe webhook (deaktivert) |
| `GET /api/industries` | Hent bransjeliste |
| `ALL /api/app/*` | Proxy til app API (Railway backend) |
| `POST /api/cron/backup` | Database-backup cron |

---

## Avhengigheter

- `@skyplanner/auth` - Delt auth-pakke (JWT, cookies, TOTP, passordvalidering)
- `@skyplanner/database` - Delt database-pakke (Supabase)
- `@skyplanner/email` - E-postmaler og sending (Resend API)
- `stripe` - Betalingshåndtering
- `bcryptjs` - Passord-hashing
- `clsx` - Conditional CSS-klasser

---

## Styling

Bruker Tailwind CSS med custom konfigurasjon:
- Primary color: Blå (`primary-*`)
- Dark theme med glass-effekter
- Responsivt design (mobile-first)

---

## Komponenter

| Komponent | Type | Beskrivelse |
|-----------|------|-------------|
| `Header` | Client | Navigasjonsheader med mobilmeny (usePathname) |
| `Footer` | Server | Sidefooter |
| `GlassCard` | Server | Glass-effekt kort |
| `Badge` | Server | Merkelapp-komponent |
| `Sidebar` | Client | Dashboard-navigasjon |
| `DashboardHeader` | Client | Dashboard-header med brukerinfo |
| `StatCard` | Server | Statistikk-kort |
| `SettingsNav` | Client | Innstillinger-navigasjon (8 tabs) |
| `PasswordStrengthIndicator` | Client | Sanntids passordstyrke-feedback |
| `ScrollAnimationObserver` | Client | IntersectionObserver for scroll-animasjoner |
| `ContactForm` | Client | Kontaktskjema med validering |

---

## Stripe-integrasjon

**Midlertidig deaktivert** — fakturering skjer manuelt via Fiken.

Webhooks konfigurert for:
- `customer.subscription.created/updated` - Abonnement opprettet/endret
- `customer.subscription.deleted` - Abonnement kansellert
- `invoice.payment_succeeded` - Betaling vellykket
- `invoice.payment_failed` - Betaling feilet

For å re-aktivere: Gjenopprett webhook-handler fra git-historikk og fjern early return.

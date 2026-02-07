# Sky Planner Web (Marketing-nettside + Dashboard)

> Offentlig markedsføringsside og bruker-dashboard for Sky Planner.
> **Kjører på:** Astro 5 + Tailwind CSS

---

## Hurtigoversikt

| Hva | Hvor |
|-----|------|
| Framework | Astro 5 (SSR) |
| Styling | Tailwind CSS |
| Betalinger | Stripe |
| Port | 3001 (dev) |

---

## Filstruktur

```
apps/web/
├── src/
│   ├── pages/               # Astro-sider (routing)
│   │   ├── index.astro      # Forsiden (landing page)
│   │   ├── priser.astro     # Prisside
│   │   ├── faq.astro        # FAQ-side
│   │   ├── kontakt.astro    # Kontaktside
│   │   ├── funksjoner.astro # Features-side
│   │   ├── demo.astro       # Demo-side
│   │   ├── personvern.astro # Personvernerklæring
│   │   ├── vilkar.astro     # Vilkår og betingelser
│   │   ├── auth/
│   │   │   ├── login.astro
│   │   │   ├── registrer.astro
│   │   │   ├── glemt-passord.astro
│   │   │   ├── tilbakestill-passord.astro
│   │   │   ├── verify-email.astro   # E-postverifisering
│   │   │   └── success.astro
│   │   ├── dashboard/       # Bruker-dashboard
│   │   │   ├── index.astro
│   │   │   ├── brukere/
│   │   │   ├── abonnement/
│   │   │   ├── fakturaer/
│   │   │   └── innstillinger/
│   │   │       ├── index.astro
│   │   │       ├── api-nokler.astro
│   │   │       ├── integrasjoner.astro
│   │   │       ├── webhooks.astro
│   │   │       └── oauth-callback.astro
│   │   └── api/             # API-routes
│   │       ├── auth/
│   │       │   ├── login.ts
│   │       │   ├── register.ts
│   │       │   ├── logout.ts
│   │       │   ├── glemt-passord.ts
│   │       │   ├── tilbakestill-passord.ts
│   │       │   └── verify-email.ts  # E-postverifisering
│   │       ├── app/
│   │       │   └── [...path].ts  # Proxy til app API
│   │       ├── industries/
│   │       │   └── index.ts
│   │       ├── contact.ts
│   │       ├── dashboard/
│   │       │   ├── invoices/
│   │       │   ├── organization/
│   │       │   ├── subscription/
│   │       │   ├── users/
│   │       │   ├── 2fa/             # 2FA-oppsett og administrasjon
│   │       │   │   ├── setup.ts
│   │       │   │   ├── verify.ts
│   │       │   │   ├── disable.ts
│   │       │   │   └── status.ts
│   │       │   └── delete-account.ts # GDPR-kontosletting
│   │       └── webhooks/
│   │           └── stripe.ts
│   ├── components/
│   │   ├── layout/          # Header, Footer
│   │   ├── sections/        # Hero, Features, etc.
│   │   ├── dashboard/       # Dashboard-komponenter
│   │   ├── ui/              # Gjenbrukbare UI-komponenter
│   │   └── PasswordStrengthIndicator.astro  # Passordstyrke-indikator
│   ├── layouts/
│   │   ├── BaseLayout.astro
│   │   ├── AuthLayout.astro
│   │   └── DashboardLayout.astro
│   ├── middleware.ts        # Auth middleware
│   └── styles/
│       └── global.css
├── astro.config.mjs         # Astro konfigurasjon
└── tailwind.config.mjs      # Tailwind konfigurasjon
```

---

## Kjøre lokalt

```bash
cd apps/web
pnpm dev          # http://localhost:3001
pnpm build        # Produksjonsbygg
pnpm preview      # Forhåndsvis produksjonsbygg
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
| `/auth/success` | Bekreftelse etter registrering |

### Dashboard
| Sti | Beskrivelse |
|-----|-------------|
| `/dashboard` | Dashboard-oversikt |
| `/dashboard/brukere` | Administrer brukere |
| `/dashboard/abonnement` | Abonnement-oversikt |
| `/dashboard/fakturaer` | Faktura-historikk |
| `/dashboard/innstillinger` | Organisasjonsinnstillinger |
| `/dashboard/innstillinger/api-nokler` | API-nøkler |
| `/dashboard/innstillinger/integrasjoner` | Regnskapssystem-integrasjoner |
| `/dashboard/innstillinger/webhooks` | Webhooks |
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

### Dashboard
| Endpoint | Beskrivelse |
|----------|-------------|
| `GET /api/dashboard/invoices` | Hent fakturaer |
| `GET /api/dashboard/organization` | Hent organisasjon |
| `PUT /api/dashboard/organization` | Oppdater organisasjon |
| `POST /api/dashboard/organization/upload-logo` | Last opp logo |
| `POST /api/dashboard/subscription/portal` | Stripe kundeportal |
| `GET /api/dashboard/users` | Hent brukere |
| `POST /api/dashboard/users` | Inviter bruker |

### Tofaktorautentisering (2FA)
| Endpoint | Beskrivelse |
|----------|-------------|
| `POST /api/dashboard/2fa/setup` | Initialiser 2FA (returnerer hemmelighet, URI, backup-koder) |
| `POST /api/dashboard/2fa/verify` | Verifiser kode for å aktivere 2FA |
| `POST /api/dashboard/2fa/disable` | Deaktiver 2FA (krever passord) |
| `GET /api/dashboard/2fa/status` | Hent 2FA-status |

### GDPR-kontosletting
| Endpoint | Beskrivelse |
|----------|-------------|
| `POST /api/dashboard/delete-account` | Be om kontosletting (30 dagers utsettelse) |
| `DELETE /api/dashboard/delete-account` | Avbryt ventende sletting |
| `GET /api/dashboard/delete-account` | Hent slettestatus |

### Andre
| Endpoint | Beskrivelse |
|----------|-------------|
| `POST /api/contact` | Lagre kontaktskjema |
| `POST /api/webhooks/stripe` | Stripe webhook handler |
| `GET /api/industries` | Hent bransjeliste |
| `ALL /api/app/*` | Proxy til app API |

---

## Avhengigheter

- `@skyplanner/auth` - Delt auth-pakke (JWT, cookies, TOTP, passordvalidering)
- `@skyplanner/database` - Delt database-pakke (Supabase)
- `@skyplanner/email` - E-postmaler og sending (Resend API)
- `stripe` - Betalingshåndtering
- `bcryptjs` - Passord-hashing

---

## Styling

Bruker Tailwind CSS med custom konfigurasjon:
- Primary color: Blå (`primary-*`)
- Dark theme med glass-effekter
- Responsivt design (mobile-first)

---

## Komponenter

| Komponent | Beskrivelse |
|-----------|-------------|
| `GlassCard` | Glass-effekt kort |
| `Badge` | Merkelapp-komponent |
| `Header` | Navigasjonsheader |
| `Footer` | Sidefooter |
| `Hero` | Hero-seksjon for landing |
| `Features` | Features-grid |
| `Testimonials` | Kundehistorier |
| `DashboardHeader` | Dashboard-header med brukerinfo |
| `Sidebar` | Dashboard-navigasjon |
| `StatCard` | Statistikk-kort |
| `PasswordStrengthIndicator` | Sanntids passordstyrke-feedback (svak/ok/god/sterk) |

---

## Stripe-integrasjon

Webhooks mottas på `/api/webhooks/stripe` for:
- `checkout.session.completed` - Ny abonnement
- `customer.subscription.updated` - Abonnement endret
- `customer.subscription.deleted` - Abonnement kansellert
- `invoice.payment_succeeded` - Betaling vellykket
- `invoice.payment_failed` - Betaling feilet

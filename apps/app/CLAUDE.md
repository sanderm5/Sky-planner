# Sky Planner App (Backend + Kart-applikasjon)

> Hovedapplikasjonen for kundeadministrasjon og ruteplanlegging.
> **Kjører på:** Express.js + Vanilla JavaScript frontend

---

## Hurtigoversikt

| Hva | Hvor |
|-----|------|
| Backend API | `server.js` (legacy) / `src/server.ts` (ny) |
| Frontend | `public/app.js` + `public/style.css` |
| Database | SQLite (`kunder.db`) eller Supabase |
| Port | 3000 |

---

## Filstruktur

```
apps/app/
├── server.js              # Express API (legacy monolitt)
├── src/                   # TypeScript kildekode (ny struktur)
│   ├── server.ts          # Express app entry
│   ├── routes/            # API-ruter
│   ├── services/          # Database, logger
│   ├── middleware/        # Auth, validation
│   └── utils/             # Hjelpefunksjoner
├── public/                # Frontend
│   ├── index.html         # Hovedside
│   ├── app.js             # Frontend JS (~2400 linjer)
│   └── style.css          # Dark theme CSS (~3700 linjer)
├── supabase-service.js    # Supabase database-abstraksjon
├── email-service.js       # E-postvarsling + cron
├── scripts/               # Hjelpescripts
├── migrations/            # Database-migrasjoner
└── kunder.db              # SQLite database (lokal)
```

---

## Kjøre lokalt

```bash
cd apps/app
npm run dev          # Utviklingsmodus
npm start            # Produksjon
```

---

## API-endepunkter

### Kunder
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/kunder` | Hent alle kunder |
| GET | `/api/kunder/:id` | Hent én kunde |
| POST | `/api/kunder` | Opprett ny kunde |
| PUT | `/api/kunder/:id` | Oppdater kunde |
| DELETE | `/api/kunder/:id` | Slett kunde |
| POST | `/api/kunder/bulk-complete` | Marker flere som ferdige |

### Ruter
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/ruter` | Hent alle ruter |
| POST | `/api/ruter` | Lagre ny rute |
| POST | `/api/ruter/:id/complete` | Fullfør rute |

### Avtaler
| Metode | Endpoint | Beskrivelse |
|--------|----------|-------------|
| GET | `/api/avtaler` | Hent avtaler i periode |
| POST | `/api/avtaler` | Opprett avtale |

---

## Database-tabeller

- `kunder` - Kundedata med koordinater og kontroll-datoer
- `ruter` - Planlagte serviceruter
- `avtaler` - Kalender-avtaler
- `kontaktlogg` - Kundekontakt-historikk
- `email_varsler` - E-postlogg

---

## Frontend-faner (sidebar)

1. **Kunder** - Søk og områdefilter
2. **Varsler** - Kommende kontroller
3. **Ruter** - Lagrede ruter
4. **Kalender** - Månedsoversikt
5. **Planlegger** - År/område-planlegging
6. **E-post** - Varsler og historikk

---

## Integrasjoner

- **OpenRouteService** - Ruteoptimalisering
- **Kartverket API** - Geokoding
- **Nodemailer** - E-postvarsler
- **Leaflet** - Interaktivt kart

---

## Hjelpescripts

```bash
node scripts/create-admin.js     # Opprett admin-bruker
node scripts/backup.js           # Database backup
node scripts/geocode-all.js      # Geokod alle adresser
```

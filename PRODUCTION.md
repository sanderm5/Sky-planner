# Produksjonsmiljø

## Kritiske miljøvariabler for produksjon

### 1. BASE_URL (PÅKREVD for reset-passord)

```bash
BASE_URL=https://your-domain.com
```

**Hvorfor er dette viktig?**
- Reset-passord-linker sendes via e-post
- Uten BASE_URL vil linkene peke til `http://localhost:3000` (fungerer ikke)
- Med BASE_URL satt korrekt: `https://your-domain.com/nytt-passord.html?token=xxx`

### 2. Branding (SaaS-konfigurasjon)

```bash
COMPANY_NAME=Ditt Firmanavn AS
COMPANY_SUBTITLE=Din beskrivelse her
LOGO_URL=/logo.png
CONTACT_ADDRESS=Adresse her
CONTACT_PHONE=+47 xxx xx xxx
CONTACT_EMAIL=kontakt@example.com
```

### 3. E-post-konfigurasjon (PÅKREVD for varsler)

```bash
EMAIL_NOTIFICATIONS_ENABLED=true
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=din@epost.no
EMAIL_PASS=app_passord_her
EMAIL_FROM_NAME=Kontrollsystem
EMAIL_FROM_ADDRESS=noreply@example.com
```

### 4. Database (PÅKREVD)

```bash
DATABASE_TYPE=supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
```

### 5. Node Environment

```bash
NODE_ENV=production
PORT=3000
```

## Sjekkliste før deploy

- [ ] `BASE_URL=https://your-domain.com` er satt i `.env`
- [ ] Branding-variabler (COMPANY_NAME, LOGO_URL, etc.) er konfigurert
- [ ] E-post-konfigurasjon er testet og fungerer
- [ ] `NODE_ENV=production` er satt
- [ ] Supabase-tilkobling er verifisert
- [ ] Server har tilgang til Supabase Storage for backups

## Testing reset-passord i produksjon

1. Gå til https://your-domain.com
2. Klikk "Glemt passord?"
3. Skriv inn en gyldig e-post fra `brukere`-tabellen
4. Sjekk e-posten - du skal motta en link som starter med `https://your-domain.com/nytt-passord.html?token=...`
5. Klikk på linken og velg nytt passord

## Vanlige problemer

### "Fikk aldri mailen"

**Mulige årsaker:**
1. `BASE_URL` er ikke satt → linken peker til localhost
2. E-post-konfigurasjon mangler eller er feil
3. E-post havnet i spam-mappen
4. E-postadressen er ikke i `brukere`-tabellen

**Sjekk server-logger:**
```bash
# Se etter disse linjene:
Attempting to send password reset email to: xxx@yyy.no
Reset URL: https://your-domain.com/nytt-passord.html?token=xxx
Email configured: true
Password reset email sent successfully to xxx@yyy.no

# Hvis du ser WARNING:
⚠️  WARNING: BASE_URL not set in production. Reset links will not work correctly.
   Set BASE_URL=https://your-domain.com in your .env file
```

### E-post sendes, men linken fungerer ikke

**Årsak:** `BASE_URL` peker til feil URL

**Løsning:**
```bash
# I .env fil:
BASE_URL=https://your-domain.com  # RIKTIG
BASE_URL=http://localhost:3000     # FEIL
```

## Manuell reset av passord (emergency)

Hvis e-post-systemet er nede, kan du resette passord manuelt via Supabase:

```sql
-- 1. Hash nytt passord (bruk bcrypt med salt rounds 10)
-- 2. Oppdater i database:
UPDATE brukere
SET passord_hash = 'din_nye_bcrypt_hash_her'
WHERE epost = 'bruker@epost.no';
```

## Monitorering

Sjekk at disse endepunktene fungerer:

```bash
# API fungerer
curl https://your-domain.com/api/config

# Reset-passord API
curl -X POST https://your-domain.com/api/auth/request-reset \
  -H "Content-Type: application/json" \
  -d '{"epost":"test@example.com"}'

# Skal returnere:
{"success":true,"message":"Hvis kontoen finnes, vil du motta en e-post med instruksjoner."}
```

const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

// SSO Cookie utilities from shared auth package
const { extractTokenFromCookies, AUTH_COOKIE_NAME } = require('@skyplanner/auth');

// ========================================
// LOGGER UTILITY
// ========================================
const Logger = {
  isDev: () => process.env.NODE_ENV !== 'production',
  log: function(...args) {
    if (this.isDev()) console.log('[DEBUG]', ...args);
  },
  warn: function(...args) {
    if (this.isDev()) console.warn('[WARN]', ...args);
  },
  info: function(...args) {
    console.log('[INFO]', ...args);
  },
  error: console.error.bind(console, '[ERROR]')
};

// Route modules
const { initializeRoutes } = require('./routes');

// Generate secure random token for password reset
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Helper function to add months to a date, handling month overflow correctly
// e.g., Jan 31 + 1 month = Feb 28 (not Mar 3)
function addMonthsToDate(dateStr, months) {
  const date = new Date(dateStr);
  const day = date.getDate();
  date.setMonth(date.getMonth() + months);
  // If the day changed (month overflow), set to last day of previous month
  if (date.getDate() !== day) {
    date.setDate(0); // Sets to last day of previous month
  }
  return date.toISOString().split('T')[0];
}

// Helper function to get current date/time in Norwegian timezone
function getNorwegianDate() {
  // Use Intl API to get Norwegian date components
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const get = (type) => parts.find(p => p.type === type)?.value || '0';
  return new Date(
    Number.parseInt(get('year'), 10),
    Number.parseInt(get('month'), 10) - 1,
    Number.parseInt(get('day'), 10),
    Number.parseInt(get('hour'), 10),
    Number.parseInt(get('minute'), 10),
    Number.parseInt(get('second'), 10)
  );
}

// Helper function to get today's date at midnight in Norwegian timezone
function getNorwegianToday() {
  const now = getNorwegianDate();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// JWT secret - MUST be set in production
const JWT_SECRET = process.env.JWT_SECRET || process.env.CRON_SECRET;
const isProdEnv = process.env.NODE_ENV === 'production';

if (!JWT_SECRET && isProdEnv) {
  // In production, we MUST have a proper JWT secret
  // Throw error to prevent insecure operation
  throw new Error('CRITICAL: JWT_SECRET environment variable must be set in production!');
}

// Only allow fallback in development mode with explicit warning
const jwtSecret = JWT_SECRET || (() => {
  if (isProdEnv) {
    throw new Error('JWT_SECRET must be set in production');
  }
  Logger.warn('WARNING: Using development-only JWT secret. DO NOT USE IN PRODUCTION!');
  return 'dev-only-jwt-secret-skyplanner-2026';
})();

// Determine database type
const DATABASE_TYPE = process.env.DATABASE_TYPE || 'sqlite';
const useSupabase = DATABASE_TYPE === 'supabase';

// Database imports
let db = null;
let supabaseService = null;

if (useSupabase) {
  supabaseService = require('./supabase-service');
  Logger.log('Using Supabase database');
} else {
  const Database = require('better-sqlite3');
  const dbPath = process.env.DATABASE_PATH || './kunder.db';
  db = new Database(dbPath);
  Logger.log('Using SQLite database:', dbPath);

  // Create tables if they don't exist (SQLite only)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kunder (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      navn TEXT NOT NULL,
      adresse TEXT NOT NULL,
      postnummer TEXT,
      poststed TEXT,
      telefon TEXT,
      epost TEXT,
      lat REAL,
      lng REAL,
      siste_kontroll DATE,
      neste_kontroll DATE,
      kontroll_intervall_mnd INTEGER DEFAULT 12,
      notater TEXT,
      kategori TEXT DEFAULT 'El-Kontroll',
      opprettet DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ruter (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      navn TEXT NOT NULL,
      beskrivelse TEXT,
      planlagt_dato DATE,
      total_distanse REAL,
      total_tid INTEGER,
      opprettet DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'planlagt'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS rute_kunder (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rute_id INTEGER NOT NULL,
      kunde_id INTEGER NOT NULL,
      rekkefolge INTEGER NOT NULL,
      organization_id INTEGER,
      FOREIGN KEY (rute_id) REFERENCES ruter(id) ON DELETE CASCADE,
      FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE
    )
  `);

  // Add organization_id column if it doesn't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE rute_kunder ADD COLUMN organization_id INTEGER`);
  } catch (e) {
    // Column already exists, ignore error
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS kontaktlogg (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kunde_id INTEGER NOT NULL,
      dato DATETIME DEFAULT CURRENT_TIMESTAMP,
      type TEXT DEFAULT 'Telefonsamtale',
      notat TEXT,
      opprettet_av TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS avtaler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kunde_id INTEGER REFERENCES kunder(id) ON DELETE CASCADE,
      dato DATE NOT NULL,
      klokkeslett TEXT,
      type TEXT DEFAULT 'El-Kontroll',
      beskrivelse TEXT,
      status TEXT DEFAULT 'planlagt',
      opprettet_av TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    db.exec(`ALTER TABLE kunder ADD COLUMN kontroll_intervall_mnd INTEGER DEFAULT 12`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE kunder ADD COLUMN kategori TEXT DEFAULT 'El-Kontroll'`);
  } catch (e) {}

  // Login log table for tracking all login attempts
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_logg (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      epost TEXT NOT NULL,
      bruker_navn TEXT,
      bruker_type TEXT,
      status TEXT NOT NULL,
      ip_adresse TEXT,
      user_agent TEXT,
      feil_melding TEXT,
      tidspunkt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Refresh tokens table for JWT refresh token flow
  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      user_type TEXT NOT NULL,
      device_info TEXT,
      ip_address TEXT,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      revoked_at DATETIME,
      replaced_by TEXT
    )
  `);

  // Create index for faster token lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, user_type)
  `);

  // ===== DYNAMIC SERVICE TYPE TABLES =====
  // These tables replace hardcoded El-Kontroll/Brannvarsling

  db.exec(`
    CREATE TABLE IF NOT EXISTS industry_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT DEFAULT 'fa-briefcase',
      color TEXT DEFAULT '#F97316',
      description TEXT,
      aktiv INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS template_service_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      default_interval_months INTEGER DEFAULT 12,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      aktiv INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES industry_templates(id) ON DELETE CASCADE,
      UNIQUE(template_id, slug)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS template_subtypes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      default_interval_months INTEGER,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      aktiv INTEGER DEFAULT 1,
      FOREIGN KEY (service_type_id) REFERENCES template_service_types(id) ON DELETE CASCADE,
      UNIQUE(service_type_id, slug)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS template_equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      aktiv INTEGER DEFAULT 1,
      FOREIGN KEY (service_type_id) REFERENCES template_equipment(id) ON DELETE CASCADE,
      UNIQUE(service_type_id, slug)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS template_intervals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      months INTEGER NOT NULL,
      label TEXT,
      is_default INTEGER DEFAULT 0,
      FOREIGN KEY (template_id) REFERENCES industry_templates(id) ON DELETE CASCADE,
      UNIQUE(template_id, months)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kunde_id INTEGER NOT NULL,
      service_type_id INTEGER NOT NULL,
      subtype_id INTEGER,
      equipment_type_id INTEGER,
      siste_kontroll DATE,
      neste_kontroll DATE,
      intervall_months INTEGER,
      driftstype TEXT,
      notater TEXT,
      aktiv INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE,
      FOREIGN KEY (service_type_id) REFERENCES template_service_types(id),
      FOREIGN KEY (subtype_id) REFERENCES template_subtypes(id),
      FOREIGN KEY (equipment_type_id) REFERENCES template_equipment(id),
      UNIQUE(kunde_id, service_type_id)
    )
  `);

  // Create indexes for customer_services
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_services_kunde ON customer_services(kunde_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_services_type ON customer_services(service_type_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_services_neste ON customer_services(neste_kontroll)`);

  // Seed default industry template if not exists
  const existingTemplate = db.prepare('SELECT id FROM industry_templates WHERE slug = ?').get('el-kontroll-brannvarsling');
  if (!existingTemplate) {
    Logger.log('Seeding default industry template...');

    // Insert industry template
    const templateResult = db.prepare(`
      INSERT INTO industry_templates (name, slug, icon, color, description, sort_order)
      VALUES ('El-Kontroll + Brannvarsling', 'el-kontroll-brannvarsling', 'fa-bolt', '#F97316', 'Periodisk el-kontroll og brannvarsling', 1)
    `).run();
    const templateId = templateResult.lastInsertRowid;

    // Insert El-Kontroll service type
    const elResult = db.prepare(`
      INSERT INTO template_service_types (template_id, name, slug, icon, color, default_interval_months, description, sort_order)
      VALUES (?, 'El-Kontroll', 'el-kontroll', 'fa-bolt', '#F59E0B', 36, 'Periodisk kontroll av elektriske anlegg', 1)
    `).run(templateId);
    const elServiceId = elResult.lastInsertRowid;

    // Insert El-Kontroll subtypes
    db.prepare(`INSERT INTO template_subtypes (service_type_id, name, slug, default_interval_months, sort_order) VALUES (?, 'Landbruk', 'landbruk', 36, 1)`).run(elServiceId);
    db.prepare(`INSERT INTO template_subtypes (service_type_id, name, slug, default_interval_months, sort_order) VALUES (?, 'Næring', 'naering', 12, 2)`).run(elServiceId);
    db.prepare(`INSERT INTO template_subtypes (service_type_id, name, slug, default_interval_months, sort_order) VALUES (?, 'Bolig', 'bolig', 60, 3)`).run(elServiceId);
    db.prepare(`INSERT INTO template_subtypes (service_type_id, name, slug, default_interval_months, sort_order) VALUES (?, 'Gartneri', 'gartneri', 36, 4)`).run(elServiceId);

    // Insert Brannvarsling service type
    const brannResult = db.prepare(`
      INSERT INTO template_service_types (template_id, name, slug, icon, color, default_interval_months, description, sort_order)
      VALUES (?, 'Brannvarsling', 'brannvarsling', 'fa-fire', '#DC2626', 12, 'Årlig kontroll av brannvarslingssystemer', 2)
    `).run(templateId);
    const brannServiceId = brannResult.lastInsertRowid;

    // Insert Brannvarsling equipment types
    db.prepare(`INSERT INTO template_equipment (service_type_id, name, slug, sort_order) VALUES (?, 'Elotec', 'elotec', 1)`).run(brannServiceId);
    db.prepare(`INSERT INTO template_equipment (service_type_id, name, slug, sort_order) VALUES (?, 'ICAS', 'icas', 2)`).run(brannServiceId);
    db.prepare(`INSERT INTO template_equipment (service_type_id, name, slug, sort_order) VALUES (?, 'Elotec + ICAS', 'elotec-icas', 3)`).run(brannServiceId);
    db.prepare(`INSERT INTO template_equipment (service_type_id, name, slug, sort_order) VALUES (?, '2 x Elotec', '2x-elotec', 4)`).run(brannServiceId);

    // Insert control intervals
    db.prepare(`INSERT INTO template_intervals (template_id, months, label, is_default) VALUES (?, 6, '6 mnd', 0)`).run(templateId);
    db.prepare(`INSERT INTO template_intervals (template_id, months, label, is_default) VALUES (?, 12, '1 år', 0)`).run(templateId);
    db.prepare(`INSERT INTO template_intervals (template_id, months, label, is_default) VALUES (?, 24, '2 år', 0)`).run(templateId);
    db.prepare(`INSERT INTO template_intervals (template_id, months, label, is_default) VALUES (?, 36, '3 år', 1)`).run(templateId);
    db.prepare(`INSERT INTO template_intervals (template_id, months, label, is_default) VALUES (?, 48, '4 år', 0)`).run(templateId);
    db.prepare(`INSERT INTO template_intervals (template_id, months, label, is_default) VALUES (?, 60, '5 år', 0)`).run(templateId);

    Logger.log('Default industry template seeded successfully');
  }
}

// Email Service
const emailService = require('./email-service');

const app = express();

// Trust proxy (for ngrok, Heroku, etc.)
app.set('trust proxy', 1);

// ===== SECURITY MIDDLEWARE =====

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdnjs.cloudflare.com", "https://api.mapbox.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdnjs.cloudflare.com", "https://api.mapbox.com", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://api.openrouteservice.org", "https://*.supabase.co", "https://ws.geonorge.no", "https://nominatim.openstreetmap.org", "https://api.mapbox.com", "https://*.tiles.mapbox.com", "https://events.mapbox.com", "wss://localhost:*", "ws://localhost:*"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      workerSrc: ["'self'", "blob:"],
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" }
}));

// CORS configuration
const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:5000',
  'https://trekontroll.no',
  'https://www.trekontroll.no'
];
const isProduction = process.env.NODE_ENV === 'production';
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else if (isProduction) {
      // In production, block unknown origins
      Logger.warn(`CORS blocked request from: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    } else {
      // In development, allow but log warning
      Logger.warn(`CORS warning - request from: ${origin}`);
      callback(null, true);
    }
  },
  credentials: true
}));

// Rate limiting - higher limits for development
const isDev = process.env.NODE_ENV !== 'production';
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDev ? 1000 : 200, // Higher limit in dev, reasonable in prod
  message: { error: 'For mange forespørsler, prøv igjen senere' },
  standardHeaders: true,
  legacyHeaders: false
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // max 10 emails per hour
  message: { error: 'For mange e-poster sendt, prøv igjen senere' }
});

// Session-based authentication middleware
// Supports both Authorization header (Bearer token) and SSO cookies from marketing site
function requireAuth(req, res, next) {
  // Skip auth if disabled (for development only)
  if (process.env.REQUIRE_AUTH === 'false') {
    return next();
  }

  // Allow login and config endpoints without auth
  // Note: req.path is relative to /api when using app.use('/api', requireAuth)
  const publicPaths = ['/klient/login', '/klient/logout', '/config', '/auth/request-reset', '/auth/verify-token', '/auth/reset-password', '/auth/refresh', '/cron/email-varsler'];
  const publicPrefixes = ['/industries', '/industry-templates', '/routes'];
  if (publicPaths.includes(req.path) || publicPrefixes.some(p => req.path.startsWith(p))) {
    return next();
  }

  // Try to get token from Authorization header first
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // If no Authorization header, try SSO cookie from marketing site
  if (!token && req.headers.cookie) {
    token = extractTokenFromCookies(req.headers.cookie, AUTH_COOKIE_NAME);
  }

  if (!token) {
    return res.status(401).json({ error: 'Ikke innlogget', requireLogin: true });
  }

  try {
    // Verify JWT token
    const decoded = jwt.verify(token, jwtSecret);
    req.userSession = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesjonen har utløpt', requireLogin: true });
    }
    return res.status(401).json({ error: 'Ugyldig sesjon', requireLogin: true });
  }
}

// Input validation helper
function validateKunde(kunde) {
  const errors = [];

  // Type safety - ensure string properties are actually strings
  const navn = typeof kunde.navn === 'string' ? kunde.navn : '';
  const adresse = typeof kunde.adresse === 'string' ? kunde.adresse : '';
  const epost = typeof kunde.epost === 'string' ? kunde.epost : '';
  const telefon = typeof kunde.telefon === 'string' ? kunde.telefon : '';

  if (!navn || navn.trim().length < 2) {
    errors.push('Navn må være minst 2 tegn');
  }
  if (!adresse || adresse.trim().length < 3) {
    errors.push('Adresse må være minst 3 tegn');
  }
  if (epost && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost)) {
    errors.push('Ugyldig e-postadresse');
  }
  // Telefonnummer validering - må være tall, mellomrom, +, eller -
  if (telefon && telefon.trim() !== '') {
    const cleanPhone = telefon.replaceAll(/[\s\-\+\(\)]/g, '');
    if (!/^\d+$/.test(cleanPhone) || cleanPhone.length < 8) {
      errors.push('Ugyldig telefonnummer (må inneholde minst 8 siffer)');
    }
  }
  // Dato validering for kontroll-datoer
  const dateFields = ['neste_el_kontroll', 'siste_el_kontroll', 'neste_brann_kontroll', 'siste_brann_kontroll', 'neste_kontroll', 'siste_kontroll'];
  for (const field of dateFields) {
    const fieldValue = typeof kunde[field] === 'string' ? kunde[field] : '';
    if (fieldValue && fieldValue.trim() !== '') {
      // Godtar YYYY-MM-DD format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fieldValue)) {
        errors.push(`Ugyldig datoformat for ${field} (bruk YYYY-MM-DD)`);
      } else {
        // Sjekk at datoen er gyldig
        const date = new Date(fieldValue);
        if (Number.isNaN(date.getTime())) {
          errors.push(`Ugyldig dato for ${field}`);
        }
      }
    }
  }
  if (kunde.lat !== undefined && kunde.lat !== null && kunde.lat !== '') {
    const lat = Number.parseFloat(kunde.lat);
    if (Number.isNaN(lat) || lat < -90 || lat > 90) {
      errors.push('Ugyldig latitude (må være mellom -90 og 90)');
    }
  }
  if (kunde.lng !== undefined && kunde.lng !== null && kunde.lng !== '') {
    const lng = Number.parseFloat(kunde.lng);
    if (Number.isNaN(lng) || lng < -180 || lng > 180) {
      errors.push('Ugyldig longitude (må være mellom -180 og 180)');
    }
  }

  return errors;
}

// Helper function to log login attempts
async function logLoginAttempt(epost, brukerNavn, brukerType, status, ip, userAgent, feilMelding = null) {
  try {
    if (useSupabase) {
      await supabaseService.logLogin(epost, brukerNavn, brukerType, status, ip, userAgent, feilMelding);
    } else {
      db.prepare(`
        INSERT INTO login_logg (epost, bruker_navn, bruker_type, status, ip_adresse, user_agent, feil_melding)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(epost, brukerNavn, brukerType, status, ip, userAgent, feilMelding);
    }
  } catch (err) {
    console.error('Failed to log login attempt:', err.message);
  }
}

app.use(express.json({ limit: '1mb' })); // Limit request body size to prevent DoS

// Static files with caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.min.js') || path.endsWith('.min.css')) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
    }
  }
}));

// Apply rate limiting to API routes
app.use('/api', apiLimiter);
app.use('/api', requireAuth);

// Initialize modular routes
const routeDeps = { db, supabaseService, useSupabase, jwtSecret };
const routes = initializeRoutes(routeDeps);

// Apply subscription check to protected business routes
app.use('/api/kunder', requireActiveSubscription, routes.kunder);
app.use('/api/ruter', requireActiveSubscription, routes.ruter);
app.use('/api/avtaler', requireActiveSubscription, routes.avtaler);
// Industries are public (for onboarding), no subscription check needed
app.use('/api/industries', routes.industries);
// Organization fields/categories (dynamic schema)
app.use('/api/fields', requireActiveSubscription, routes.fields);

// ===== CUSTOMER SERVICES API =====

// Get all services for a customer
app.get('/api/kunder/:id/services', requireKlientAuth, requireActiveSubscription, async (req, res) => {
  try {
    const kundeId = req.params.id;

    if (useSupabase) {
      const services = await supabaseService.getCustomerServices(kundeId);
      res.json(services);
    } else {
      const services = db.prepare(`
        SELECT cs.*,
               st.name as service_type_name, st.slug as service_type_slug,
               st.icon as service_type_icon, st.color as service_type_color,
               sub.name as subtype_name, sub.slug as subtype_slug,
               eq.name as equipment_name, eq.slug as equipment_slug
        FROM customer_services cs
        LEFT JOIN template_service_types st ON cs.service_type_id = st.id
        LEFT JOIN template_subtypes sub ON cs.subtype_id = sub.id
        LEFT JOIN template_equipment eq ON cs.equipment_type_id = eq.id
        WHERE cs.kunde_id = ? AND cs.aktiv = 1
      `).all(kundeId);
      res.json(services);
    }
  } catch (error) {
    console.error('Error fetching customer services:', error);
    res.status(500).json({ error: 'Kunne ikke hente kundetjenester' });
  }
});

// Add or update a service for a customer
app.put('/api/kunder/:id/services/:serviceTypeId', requireKlientAuth, requireActiveSubscription, async (req, res) => {
  try {
    const { id: kundeId, serviceTypeId } = req.params;
    const serviceData = req.body;

    if (useSupabase) {
      const service = await supabaseService.upsertCustomerService(kundeId, serviceTypeId, {
        subtypeId: serviceData.subtype_id,
        equipmentTypeId: serviceData.equipment_type_id,
        sisteKontroll: serviceData.siste_kontroll,
        nesteKontroll: serviceData.neste_kontroll,
        intervallMonths: serviceData.intervall_months,
        notater: serviceData.notater
      });
      res.json(service);
    } else {
      db.prepare(`
        INSERT INTO customer_services (kunde_id, service_type_id, subtype_id, equipment_type_id, siste_kontroll, neste_kontroll, intervall_months, notater, aktiv)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(kunde_id, service_type_id) DO UPDATE SET
          subtype_id = excluded.subtype_id,
          equipment_type_id = excluded.equipment_type_id,
          siste_kontroll = excluded.siste_kontroll,
          neste_kontroll = excluded.neste_kontroll,
          intervall_months = excluded.intervall_months,
          notater = excluded.notater,
          aktiv = 1
      `).run(
        kundeId, serviceTypeId,
        serviceData.subtype_id || null,
        serviceData.equipment_type_id || null,
        serviceData.siste_kontroll || null,
        serviceData.neste_kontroll || null,
        serviceData.intervall_months || null,
        serviceData.notater || null
      );
      res.json({ success: true });
    }

    // Broadcast real-time update
    if (global.wsBroadcast) {
      global.wsBroadcast('kunde_updated', { id: Number.parseInt(kundeId) });
    }
  } catch (error) {
    console.error('Error upserting customer service:', error);
    res.status(500).json({ error: 'Kunne ikke oppdatere kundetjeneste' });
  }
});

// Remove a service from a customer
app.delete('/api/kunder/:id/services/:serviceTypeId', requireKlientAuth, requireActiveSubscription, async (req, res) => {
  try {
    const { id: kundeId, serviceTypeId } = req.params;

    if (useSupabase) {
      await supabaseService.deleteCustomerService(kundeId, serviceTypeId);
      res.json({ success: true });
    } else {
      db.prepare('DELETE FROM customer_services WHERE kunde_id = ? AND service_type_id = ?').run(kundeId, serviceTypeId);
      res.json({ success: true });
    }

    // Broadcast real-time update
    if (global.wsBroadcast) {
      global.wsBroadcast('kunde_updated', { id: Number.parseInt(kundeId) });
    }
  } catch (error) {
    console.error('Error deleting customer service:', error);
    res.status(500).json({ error: 'Kunne ikke slette kundetjeneste' });
  }
});

// Mark a service as complete for a customer
app.post('/api/kunder/:id/services/:serviceTypeId/complete', requireKlientAuth, requireActiveSubscription, async (req, res) => {
  try {
    const { id: kundeId, serviceTypeId } = req.params;
    const { completedDate } = req.body;

    if (!completedDate) {
      return res.status(400).json({ error: 'Dato mangler' });
    }

    // Helper function to add months
    function addMonthsToDate(dateStr, months) {
      const date = new Date(dateStr);
      const day = date.getDate();
      date.setMonth(date.getMonth() + months);
      if (date.getDate() !== day) {
        date.setDate(0);
      }
      return date.toISOString().split('T')[0];
    }

    if (useSupabase) {
      // Get service details
      const { data: service } = await supabaseService.supabase
        .from('customer_services')
        .select('*, template_service_types(default_interval_months, slug)')
        .eq('kunde_id', kundeId)
        .eq('service_type_id', serviceTypeId)
        .single();

      if (!service) {
        return res.status(404).json({ error: 'Tjeneste ikke funnet' });
      }

      const intervall = service.intervall_months || service.template_service_types?.default_interval_months || 12;
      const nesteKontroll = addMonthsToDate(completedDate, intervall);

      await supabaseService.upsertCustomerService(kundeId, serviceTypeId, {
        sisteKontroll: completedDate,
        nesteKontroll: nesteKontroll
      });

      res.json({ success: true, siste_kontroll: completedDate, neste_kontroll: nesteKontroll });
    } else {
      // Get service details
      const service = db.prepare(`
        SELECT cs.*, st.default_interval_months, st.slug
        FROM customer_services cs
        JOIN template_service_types st ON cs.service_type_id = st.id
        WHERE cs.kunde_id = ? AND cs.service_type_id = ?
      `).get(kundeId, serviceTypeId);

      if (!service) {
        return res.status(404).json({ error: 'Tjeneste ikke funnet' });
      }

      const intervall = service.intervall_months || service.default_interval_months || 12;
      const nesteKontroll = addMonthsToDate(completedDate, intervall);

      // Update customer_services
      db.prepare(`
        UPDATE customer_services
        SET siste_kontroll = ?, neste_kontroll = ?
        WHERE kunde_id = ? AND service_type_id = ?
      `).run(completedDate, nesteKontroll, kundeId, serviceTypeId);

      // Also update legacy columns for backward compatibility
      if (service.slug === 'el-kontroll') {
        db.prepare(`UPDATE kunder SET siste_el_kontroll=?, neste_el_kontroll=?, siste_kontroll=?, neste_kontroll=? WHERE id=?`)
          .run(completedDate, nesteKontroll, completedDate, nesteKontroll, kundeId);
      } else if (service.slug === 'brannvarsling') {
        db.prepare(`UPDATE kunder SET siste_brann_kontroll=?, neste_brann_kontroll=? WHERE id=?`)
          .run(completedDate, nesteKontroll, kundeId);
      }

      res.json({ success: true, siste_kontroll: completedDate, neste_kontroll: nesteKontroll });
    }

    // Broadcast real-time update
    if (global.wsBroadcast) {
      global.wsBroadcast('kunde_updated', { id: Number.parseInt(kundeId) });
    }
  } catch (error) {
    console.error('Error completing customer service:', error);
    res.status(500).json({ error: 'Kunne ikke fullføre tjenesten' });
  }
});

app.get('/api/omrader', requireKlientAuth, requireActiveSubscription, async (req, res) => {
  try {
    const orgId = req.organizationId;

    if (useSupabase) {
      const omrader = await supabaseService.getOmrader(orgId);
      res.json(omrader);
    } else {
      const sql = orgId
        ? `SELECT DISTINCT poststed, postnummer, COUNT(*) as antall
           FROM kunder
           WHERE poststed IS NOT NULL AND poststed != '' AND organization_id = ?
           GROUP BY poststed
           ORDER BY poststed`
        : `SELECT DISTINCT poststed, postnummer, COUNT(*) as antall
           FROM kunder
           WHERE poststed IS NOT NULL AND poststed != ''
           GROUP BY poststed
           ORDER BY poststed`;
      const omrader = orgId
        ? db.prepare(sql).all(orgId)
        : db.prepare(sql).all();
      res.json(omrader);
    }
  } catch (error) {
    console.error('Error fetching omrader:', error);
    res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
  }
});

app.post('/api/kunder/import', requireKlientAuth, requireActiveSubscription, async (req, res) => {
  try {
    const { kunder } = req.body;
    if (!Array.isArray(kunder)) {
      return res.status(400).json({ error: 'Forventet en liste med kunder' });
    }

    if (useSupabase) {
      const result = await supabaseService.bulkImportKunder(kunder);
      res.json(result);
    } else {
      const stmt = db.prepare(`
        INSERT INTO kunder (navn, adresse, postnummer, poststed, telefon, epost, lat, lng, siste_kontroll, neste_kontroll, kontroll_intervall_mnd, notater, kategori)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let imported = 0;
      let errors = [];

      kunder.forEach((kunde, index) => {
        try {
          stmt.run(
            kunde.navn, kunde.adresse, kunde.postnummer || null, kunde.poststed || null,
            kunde.telefon || null, kunde.epost || null, kunde.lat || null, kunde.lng || null,
            kunde.siste_kontroll || null, kunde.neste_kontroll || null,
            kunde.kontroll_intervall_mnd || 12, kunde.notater || null, kunde.kategori || 'El-Kontroll'
          );
          imported++;
        } catch (e) {
          errors.push({ index, navn: kunde.navn, error: e.message });
        }
      });

      res.json({ imported, errors, total: kunder.length });
    }
  } catch (error) {
    console.error('Error importing kunder:', error);
    res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
  }
});

// ===== CONFIG API =====

// Config endpoint with optional tenant-specific branding
app.get('/api/config', async (req, res) => {
  // Try to get organization context from auth header (optional)
  let organization = null;
  let industryConfig = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, jwtSecret);
      if (decoded.organizationId) {
        organization = await getOrganizationById(decoded.organizationId);
        // Get industry configuration for this organization
        if (organization?.industry_template_id) {
          if (useSupabase) {
            industryConfig = await supabaseService.getFullIndustryConfig(organization.industry_template_id);
          }
        }
      }
    } catch (e) {
      // Ignore auth errors - just return default config
    }
  }

  // If no organization-specific industry config, load default template
  if (!industryConfig) {
    try {
      if (useSupabase) {
        industryConfig = await supabaseService.getFullIndustryConfig('el-kontroll-brannvarsling');
      }
    } catch (e) {
      Logger.log('Could not load default industry config:', e.message);
    }
  }

  // Build config with tenant overrides
  const config = {
    // Branding - tenant overrides environment variables
    appName: organization?.brand_title || process.env.APP_NAME || 'El-Kontroll + Brannvarsling',
    companyName: organization?.navn || process.env.COMPANY_NAME || '',
    companySubtitle: organization?.brand_subtitle || process.env.COMPANY_SUBTITLE || 'Kontrollsystem',
    logoUrl: organization?.logo_url || process.env.LOGO_URL || '',
    contactAddress: organization?.firma_adresse || process.env.CONTACT_ADDRESS || '',
    contactPhone: organization?.firma_telefon || process.env.CONTACT_PHONE || '',
    contactEmail: organization?.firma_epost || process.env.CONTACT_EMAIL || '',
    appYear: process.env.APP_YEAR || '2026',
    // Tenant-specific colors
    primaryColor: organization?.primary_color || '#F97316',
    secondaryColor: organization?.secondary_color || '#1E293B',
    // Map settings - tenant overrides
    mapCenterLat: organization?.map_center_lat || Number.parseFloat(process.env.MAP_CENTER_LAT || '65.5'),
    mapCenterLng: organization?.map_center_lng || Number.parseFloat(process.env.MAP_CENTER_LNG || '12.0'),
    mapZoom: organization?.map_zoom || Number.parseInt(process.env.MAP_ZOOM || '5'),
    mapTileUrl: process.env.MAP_TILE_URL,
    mapTileAttribution: process.env.MAP_TILE_ATTRIBUTION,
    mapClusterRadius: Number.parseInt(process.env.MAP_CLUSTER_RADIUS || '80'),
    mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN,
    // CesiumJS Ion token for 3D globe
    cesiumIonToken: process.env.CESIUM_ION_TOKEN,
    // SECURITY: ORS API key is no longer exposed - use server-side proxy instead
    orsApiKeyConfigured: !!process.env.ORS_API_KEY,
    routeStartAddress: organization?.route_start_address || process.env.ROUTE_START_ADDRESS || '',
    routeStartLat: organization?.route_start_lat || Number.parseFloat(process.env.ROUTE_START_LAT || '65.5'),
    routeStartLng: organization?.route_start_lng || Number.parseFloat(process.env.ROUTE_START_LNG || '12.0'),
    enableRoutePlanning: process.env.ENABLE_ROUTE_PLANNING === 'true',
    showUpcomingWidget: process.env.SHOW_UPCOMING_WIDGET === 'true',
    upcomingControlDays: Number.parseInt(process.env.UPCOMING_CONTROL_DAYS || '30'),
    defaultControlInterval: Number.parseInt(process.env.DEFAULT_CONTROL_INTERVAL || '12'),
    controlIntervals: (process.env.CONTROL_INTERVALS || '6,12,24,36').split(',').map(Number),
    nodeEnv: process.env.NODE_ENV || 'development',
    databaseType: DATABASE_TYPE,
    requireAuth: process.env.REQUIRE_AUTH !== 'false',
    // Multi-tenancy info
    organizationId: organization?.id || null,
    organizationSlug: organization?.slug || null,
    planType: organization?.plan_type || 'standard',
    maxKunder: organization?.max_kunder || 200,
    // Industry configuration (dynamic service types)
    industryTemplate: industryConfig ? {
      id: industryConfig.id,
      name: industryConfig.name,
      slug: industryConfig.slug,
      icon: industryConfig.icon,
      color: industryConfig.color
    } : null,
    serviceTypes: industryConfig?.serviceTypes || [],
    intervals: industryConfig?.intervals || []
  };

  res.json(config);
});

// ===== KONTAKTLOGG API =====

app.get('/api/kunder/:kundeId/kontaktlogg', requireKlientAuth, requireActiveSubscription, async (req, res) => {
  try {
    const kundeId = req.params.kundeId;
    const orgId = req.organizationId;

    // Verify kunde belongs to this organization
    if (orgId && !useSupabase) {
      const kunde = db.prepare('SELECT id FROM kunder WHERE id = ? AND organization_id = ?').get(kundeId, orgId);
      if (!kunde) {
        return res.status(404).json({ error: 'Kunde ikke funnet' });
      }
    }

    if (useSupabase) {
      const logg = await supabaseService.getKontaktloggByKunde(kundeId);
      res.json(logg);
    } else {
      const logg = db.prepare('SELECT * FROM kontaktlogg WHERE kunde_id = ? ORDER BY dato DESC').all(kundeId);
      res.json(logg);
    }
  } catch (error) {
    console.error('Error fetching kontaktlogg:', error);
    res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
  }
});

app.post('/api/kunder/:kundeId/kontaktlogg', requireKlientAuth, requireActiveSubscription, async (req, res) => {
  try {
    const kundeId = req.params.kundeId;
    const orgId = req.organizationId;
    const { type, notat, opprettet_av } = req.body;

    // Verify kunde belongs to this organization
    if (orgId && !useSupabase) {
      const kunde = db.prepare('SELECT id FROM kunder WHERE id = ? AND organization_id = ?').get(kundeId, orgId);
      if (!kunde) {
        return res.status(404).json({ error: 'Kunde ikke funnet' });
      }
    }

    if (useSupabase) {
      const kontakt = await supabaseService.createKontaktlogg({
        kunde_id: Number.parseInt(kundeId),
        type,
        notat,
        opprettet_av,
        organization_id: orgId
      });
      res.json(kontakt);
    } else {
      const result = db.prepare(`
        INSERT INTO kontaktlogg (kunde_id, dato, type, notat, opprettet_av, organization_id)
        VALUES (?, datetime('now'), ?, ?, ?, ?)
      `).run(kundeId, type || 'Telefonsamtale', notat, opprettet_av, orgId);

      const kontakt = db.prepare('SELECT * FROM kontaktlogg WHERE id = ?').get(result.lastInsertRowid);
      res.json(kontakt);
    }
  } catch (error) {
    console.error('Error creating kontaktlogg:', error);
    res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
  }
});

app.delete('/api/kontaktlogg/:id', requireKlientAuth, requireActiveSubscription, async (req, res) => {
  try {
    const orgId = req.organizationId;

    // Verify kontaktlogg belongs to this organization
    if (orgId && !useSupabase) {
      const existing = db.prepare('SELECT id FROM kontaktlogg WHERE id = ? AND organization_id = ?').get(req.params.id, orgId);
      if (!existing) {
        return res.status(404).json({ error: 'Kontaktlogg ikke funnet' });
      }
    }

    if (useSupabase) {
      await supabaseService.deleteKontaktlogg(req.params.id);
    } else {
      const sql = orgId
        ? 'DELETE FROM kontaktlogg WHERE id = ? AND organization_id = ?'
        : 'DELETE FROM kontaktlogg WHERE id = ?';
      orgId
        ? db.prepare(sql).run(req.params.id, orgId)
        : db.prepare(sql).run(req.params.id);
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting kontaktlogg:', error);
    res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
  }
});

// ===== EMAIL API =====

// Initialize Email tables (SQLite only)
if (!useSupabase) {
  emailService.initEmailTables(db);
}

app.get('/api/email/innstillinger/:kundeId', async (req, res) => {
  try {
    const kundeId = req.params.kundeId;

    if (useSupabase) {
      const settings = await supabaseService.getEmailInnstillinger(kundeId);
      res.json(settings);
    } else {
      let settings = db.prepare('SELECT * FROM email_innstillinger WHERE kunde_id = ?').get(kundeId);

      if (!settings) {
        settings = {
          kunde_id: Number.parseInt(kundeId),
          email_aktiv: 1,
          forste_varsel_dager: Number.parseInt(process.env.EMAIL_FIRST_REMINDER_DAYS) || 30,
          paaminnelse_etter_dager: Number.parseInt(process.env.EMAIL_REMINDER_AFTER_DAYS) || 7
        };
      }

      res.json(settings);
    }
  } catch (error) {
    console.error('Error fetching email settings:', error);
    res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
  }
});

app.put('/api/email/innstillinger/:kundeId', async (req, res) => {
  try {
    const kundeId = req.params.kundeId;
    const { email_aktiv, forste_varsel_dager, paaminnelse_etter_dager } = req.body;

    if (useSupabase) {
      await supabaseService.updateEmailInnstillinger(kundeId, req.body);
      res.json({ success: true });
    } else {
      const existing = db.prepare('SELECT id FROM email_innstillinger WHERE kunde_id = ?').get(kundeId);

      if (existing) {
        db.prepare(`
          UPDATE email_innstillinger
          SET email_aktiv = ?, forste_varsel_dager = ?, paaminnelse_etter_dager = ?
          WHERE kunde_id = ?
        `).run(email_aktiv ? 1 : 0, forste_varsel_dager || 30, paaminnelse_etter_dager || 7, kundeId);
      } else {
        db.prepare(`
          INSERT INTO email_innstillinger (kunde_id, email_aktiv, forste_varsel_dager, paaminnelse_etter_dager)
          VALUES (?, ?, ?, ?)
        `).run(kundeId, email_aktiv ? 1 : 0, forste_varsel_dager || 30, paaminnelse_etter_dager || 7);
      }

      res.json({ success: true });
    }
  } catch (error) {
    console.error('Error updating email settings:', error);
    res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
  }
});

app.get('/api/email/historikk/:kundeId', async (req, res) => {
  try {
    if (useSupabase) {
      const historikk = await supabaseService.getEmailHistorikk(req.params.kundeId);
      res.json(historikk);
    } else {
      const historikk = db.prepare(`
        SELECT * FROM email_varsler
        WHERE kunde_id = ?
        ORDER BY opprettet DESC
        LIMIT 50
      `).all(req.params.kundeId);
      res.json(historikk);
    }
  } catch (error) {
    console.error('Error fetching email history:', error);
    res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
  }
});

app.get('/api/email/historikk', async (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit) || 100;
    const limit = Math.max(1, Math.min(requestedLimit, 1000)); // Clamp between 1 and 1000

    if (useSupabase) {
      const historikk = await supabaseService.getEmailHistorikk(null, limit);
      res.json(historikk);
    } else {
      const historikk = emailService.getEmailHistory(db, null, limit);
      res.json(historikk);
    }
  } catch (error) {
    console.error('Error fetching email history:', error);
    res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
  }
});

app.post('/api/email/test', emailLimiter, async (req, res) => {
  const { epost, melding } = req.body;

  if (!epost) {
    return res.status(400).json({ error: 'E-postadresse er påkrevd' });
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost)) {
    return res.status(400).json({ error: 'Ugyldig e-postformat' });
  }

  const testMessage = melding || `Test-melding fra ${process.env.COMPANY_NAME || 'El-Kontroll'}.\n\nE-postvarsling fungerer!`;
  const result = await emailService.sendTestEmail(useSupabase ? supabaseService : db, epost, testMessage);
  res.json(result);
});

app.post('/api/email/send-varsler', emailLimiter, async (_req, res) => {
  const result = await emailService.checkAndSendReminders(useSupabase ? supabaseService : db);
  res.json(result);
});

// Vercel Cron endpoint for email reminders (no auth required - uses CRON_SECRET)
app.get('/api/cron/email-varsler', async (req, res) => {
  // Verify Vercel Cron secret with timing-safe comparison
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const authHeader = req.headers['authorization'] || '';
  const expectedAuth = `Bearer ${cronSecret}`;

  // Use timing-safe comparison to prevent timing attacks
  const authBuffer = Buffer.from(authHeader);
  const expectedBuffer = Buffer.from(expectedAuth);

  if (authBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(authBuffer, expectedBuffer)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const result = await emailService.checkAndSendReminders(useSupabase ? supabaseService : db);
  res.json({ success: true, ...result, timestamp: new Date().toISOString() });
});

// Send manual reminder to specific customer
app.post('/api/email/send-reminder', emailLimiter, async (req, res) => {
  const { kundeId } = req.body;

  if (!kundeId) {
    return res.status(400).json({ error: 'Kunde-ID er påkrevd' });
  }

  try {
    // Get customer
    let kunde;
    if (useSupabase) {
      kunde = await supabaseService.getKundeById(kundeId);
    } else {
      kunde = db.prepare('SELECT * FROM kunder WHERE id = ?').get(kundeId);
    }

    if (!kunde) {
      return res.status(404).json({ error: 'Kunde ikke funnet' });
    }

    if (!kunde.epost) {
      return res.status(400).json({ error: 'Kunden har ingen e-postadresse' });
    }

    // Calculate days until/overdue (using Norwegian timezone)
    const today = getNorwegianToday();
    const nextControl = new Date(kunde.neste_kontroll);
    const daysUntil = Math.ceil((nextControl - today) / (1000 * 60 * 60 * 24));
    const isOverdue = daysUntil < 0;

    const companyName = process.env.COMPANY_NAME || 'Kontrollsystem';
    const { subject, message } = emailService.generateReminderEmail(kunde, daysUntil, companyName, isOverdue);

    const result = await emailService.sendEmail(kunde.epost, subject, message);

    if (result.success) {
      // Log the reminder
      if (useSupabase) {
        await supabaseService.logEmailReminder(kundeId, daysUntil, 'sendt');
      } else {
        try {
          db.prepare(`
            INSERT INTO email_log (kunde_id, type, mottaker, status, dager_til_kontroll, sendt_dato)
            VALUES (?, 'påminnelse', ?, 'sendt', ?, CURRENT_TIMESTAMP)
          `).run(kundeId, kunde.epost, daysUntil);
        } catch (e) {
          // email_log table might not exist
        }
      }
      res.json({ success: true, message: `Påminnelse sendt til ${kunde.epost}` });
    } else {
      res.json({ success: false, error: result.error || 'Kunne ikke sende e-post' });
    }
  } catch (error) {
    console.error('Error sending manual reminder:', error);
    res.status(500).json({ error: 'Kunne ikke sende påminnelse' });
  }
});

app.get('/api/email/status', (req, res) => {
  const emailConfigured = emailService.isEmailConfigured();

  res.json({
    enabled: process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true',
    emailConfigured,
    firstReminderDays: Number.parseInt(process.env.EMAIL_FIRST_REMINDER_DAYS) || 30,
    reminderAfterDays: Number.parseInt(process.env.EMAIL_REMINDER_AFTER_DAYS) || 7
  });
});

app.post('/api/email/test-reminder', async (req, res) => {
  const { epost, kundeNavn, dagerTilKontroll, kategori, adresse, postnummer, poststed, telefon, kundeEpost } = req.body;

  if (!epost || !kundeNavn) {
    return res.status(400).json({ error: 'E-postadresse og kundenavn er påkrevd' });
  }

  const companyName = process.env.COMPANY_NAME || 'Kontrollsystem';
  const daysUntil = dagerTilKontroll !== undefined ? Number.parseInt(dagerTilKontroll) : 10;

  const mockCustomer = {
    navn: kundeNavn,
    kategori: kategori || 'El-kontroll',
    adresse: adresse || 'Testveien 123',
    postnummer: postnummer || '9311',
    poststed: poststed || 'Brøstadbotn',
    telefon: telefon || '123 45 678',
    epost: kundeEpost || 'kunde@example.com'
  };

  const { subject, message } = emailService.generateReminderEmail(mockCustomer, daysUntil, companyName, false);
  const result = await emailService.sendEmail(epost, subject, message);

  if (result.success) {
    res.json({ success: true, subject, message, messageId: result.messageId });
  } else {
    res.json({ success: false, error: result.error, subject, message });
  }
});

app.get('/api/email/stats', async (req, res) => {
  try {
    if (useSupabase) {
      const stats = await supabaseService.getEmailStats();
      res.json(stats);
    } else {
      const stats = db.prepare(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM email_varsler
      `).get();

      res.json({
        pending: stats?.pending || 0,
        sent: stats?.sent || 0,
        failed: stats?.failed || 0
      });
    }
  } catch (error) {
    console.error('Error fetching email stats:', error);
    res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
  }
});

app.get('/api/email/upcoming', async (req, res) => {
  try {
    const firstReminderDays = Number.parseInt(process.env.EMAIL_FIRST_REMINDER_DAYS) || 30;

    if (useSupabase) {
      const upcoming = await supabaseService.getUpcomingEmails(firstReminderDays);
      res.json(upcoming);
    } else {
      const upcoming = db.prepare(`
        SELECT
          k.id,
          k.navn,
          k.epost,
          k.neste_kontroll,
          COALESCE(e.email_aktiv, 1) as email_aktiv,
          COALESCE(e.forste_varsel_dager, ?) as forste_varsel_dager,
          CAST(julianday(k.neste_kontroll) - julianday('now') AS INTEGER) as days_until
        FROM kunder k
        LEFT JOIN email_innstillinger e ON k.id = e.kunde_id
        WHERE k.neste_kontroll IS NOT NULL
          AND k.epost IS NOT NULL
          AND k.epost != ''
          AND COALESCE(e.email_aktiv, 1) = 1
          AND julianday(k.neste_kontroll) - julianday('now') <= ?
          AND julianday(k.neste_kontroll) - julianday('now') >= -7
        ORDER BY k.neste_kontroll ASC
        LIMIT 20
      `).all(firstReminderDays, firstReminderDays);

      res.json(upcoming);
    }
  } catch (error) {
    console.error('Error fetching upcoming emails:', error);
    res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
  }
});

// ===== KLIENTPORTAL API =====

// Token durations
const ACCESS_TOKEN_EXPIRY = '15m'; // Short-lived access token
const ACCESS_TOKEN_DURATION = 15 * 60 * 1000; // 15 minutes in ms
const REFRESH_TOKEN_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_TOKEN_DURATION_REMEMBER = 30 * 24 * 60 * 60 * 1000; // 30 days

// Legacy session durations (for backwards compatibility during transition)
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const REMEMBER_ME_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days

// Generate cryptographically secure refresh token
function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Hash refresh token for storage (never store plain tokens)
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Store refresh token in database
async function storeRefreshToken(tokenHash, userId, userType, deviceInfo, ipAddress, expiresAt) {
  if (useSupabase) {
    try {
      await supabaseService.storeRefreshToken(tokenHash, userId, userType, deviceInfo, ipAddress, expiresAt.toISOString());
    } catch (err) {
      // Table might not exist yet - log but don't fail login
      Logger.warn('Could not store refresh token (table may not exist):', err.message);
    }
    return;
  }

  db.prepare(`
    INSERT INTO refresh_tokens (token_hash, user_id, user_type, device_info, ip_address, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tokenHash, userId, userType, deviceInfo, ipAddress, expiresAt.toISOString());
}

// Get refresh token from database
async function getRefreshTokenRecord(tokenHash) {
  if (useSupabase) {
    return await supabaseService.getRefreshTokenRecord(tokenHash);
  }

  return db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);
}

// Revoke refresh token (mark as used/revoked)
async function revokeRefreshToken(tokenHash, replacedBy = null) {
  if (useSupabase) {
    return await supabaseService.revokeRefreshToken(tokenHash, replacedBy);
  }

  const sql = replacedBy
    ? 'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, replaced_by = ? WHERE token_hash = ? AND revoked_at IS NULL'
    : 'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL';

  const result = replacedBy
    ? db.prepare(sql).run(replacedBy, tokenHash)
    : db.prepare(sql).run(tokenHash);

  return result.changes > 0;
}

// Revoke all refresh tokens for a user (logout from all devices)
async function revokeAllUserRefreshTokens(userId, userType) {
  if (useSupabase) {
    return await supabaseService.revokeAllUserRefreshTokens(userId, userType);
  }

  const result = db.prepare(`
    UPDATE refresh_tokens
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND user_type = ? AND revoked_at IS NULL
  `).run(userId, userType);

  return result.changes;
}

// Check if refresh token is valid (not revoked, not expired)
function isRefreshTokenValid(tokenRecord) {
  if (!tokenRecord) return false;
  if (tokenRecord.revoked_at) return false;
  if (new Date(tokenRecord.expires_at) < new Date()) return false;
  return true;
}

// Detect token reuse (potential security breach)
function isRefreshTokenReused(tokenRecord) {
  return tokenRecord && (tokenRecord.revoked_at || tokenRecord.replaced_by);
}

// Rate limiter for client login - only count failed attempts
const klientLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 failed attempts per IP per 15 min
  message: { error: 'For mange innloggingsforsøk, prøv igjen om 15 minutter' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Don't count successful logins
});

// Login - checks both klient and brukere tables
app.post('/api/klient/login', klientLoginLimiter, async (req, res) => {
  try {
    const { epost, passord, rememberMe } = req.body;

    if (!epost || !passord) {
      return res.status(400).json({ error: 'E-post og passord er påkrevd' });
    }

    let user = null;
    let userType = null;

    // First check klient table
    if (useSupabase) {
      user = await supabaseService.getKlientByEpost(epost);
    } else {
      user = db.prepare('SELECT * FROM klient WHERE LOWER(epost) = LOWER(?) AND aktiv = 1').get(epost);
    }
    if (user) userType = 'klient';

    // If not found in klient, check brukere (admin) table
    if (!user) {
      try {
        if (useSupabase) {
          user = await supabaseService.getBrukerByEpost(epost);
        } else {
          user = db.prepare('SELECT * FROM brukere WHERE LOWER(epost) = LOWER(?) AND aktiv = 1').get(epost);
        }
        if (user) userType = 'bruker';
      } catch (brukerError) {
        // brukere table might not exist, ignore
        Logger.log('brukere table check failed (might not exist):', brukerError.message);
      }
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Ukjent';
    const userAgent = req.headers['user-agent'] || 'Ukjent';

    if (!user) {
      // Log failed attempt - user not found
      await logLoginAttempt(epost, null, null, 'feilet', ip, userAgent, 'Bruker ikke funnet');
      return res.status(401).json({ error: 'Feil e-post eller passord' });
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(passord, user.passord_hash);
    if (!passwordMatch) {
      // Log failed attempt - wrong password
      await logLoginAttempt(epost, user.navn, userType, 'feilet', ip, userAgent, 'Feil passord');
      return res.status(401).json({ error: 'Feil e-post eller passord' });
    }

    // Update last login
    if (userType === 'klient') {
      if (useSupabase) {
        await supabaseService.updateKlientLastLogin(user.id);
      } else {
        db.prepare('UPDATE klient SET sist_innlogget = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
      }
    } else {
      if (useSupabase) {
        await supabaseService.updateBrukerLastLogin(user.id);
      } else {
        db.prepare('UPDATE brukere SET sist_innlogget = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
      }
    }

    // Multi-tenancy: Fetch organization data
    let organization = null;
    if (user.organization_id) {
      organization = await getOrganizationById(user.organization_id);
    }

    // Generate short-lived access token (15 minutes)
    const accessToken = jwt.sign(
      {
        userId: user.id,
        epost: user.epost,
        rolle: user.rolle || 'klient',
        userType: userType,
        // Multi-tenancy fields
        organizationId: user.organization_id || null,
        organizationSlug: organization?.slug || null,
        organizationName: organization?.navn || null
      },
      jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // Generate long-lived refresh token
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const refreshTokenDuration = rememberMe ? REFRESH_TOKEN_DURATION_REMEMBER : REFRESH_TOKEN_DURATION;
    const refreshTokenExpiresAt = new Date(Date.now() + refreshTokenDuration);

    // Store hashed refresh token in database
    await storeRefreshToken(
      refreshTokenHash,
      user.id,
      userType,
      userAgent,
      ip,
      refreshTokenExpiresAt
    );

    // Calculate expiry timestamps for client
    const accessTokenExpiresAt = Date.now() + ACCESS_TOKEN_DURATION;
    const expiresAt = accessTokenExpiresAt; // Legacy field for backwards compatibility

    // Log successful login
    await logLoginAttempt(epost, user.navn, userType, 'vellykket', ip, userAgent);

    // Send login notification email to admin (async, don't wait)
    const loginNotifyEmail = process.env.LOGIN_NOTIFY_EMAIL || process.env.EMAIL_USER;
    if (loginNotifyEmail && emailService.isEmailConfigured()) {
      const now = new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' });

      const subject = `Innlogging: ${user.navn} (${userType})`;
      const message = `
        <h2>Ny innlogging på TREkontroll</h2>
        <p><strong>Bruker:</strong> ${user.navn}</p>
        <p><strong>E-post:</strong> ${user.epost}</p>
        <p><strong>Type:</strong> ${userType}</p>
        <p><strong>Tidspunkt:</strong> ${now}</p>
        <p><strong>IP-adresse:</strong> ${ip}</p>
        <p><strong>Enhet:</strong> ${userAgent}</p>
      `;

      emailService.sendEmail(loginNotifyEmail, subject, message).catch(err => {
        Logger.log('Login notification email failed:', err.message);
      });
    }

    // Return user info with tokens and organization context
    res.json({
      // New token fields
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt: refreshTokenExpiresAt.getTime(),
      // Legacy fields for backwards compatibility
      token: accessToken,
      expiresAt,
      klient: {
        id: user.id,
        navn: user.navn,
        epost: user.epost,
        telefon: user.telefon,
        adresse: user.adresse,
        postnummer: user.postnummer,
        poststed: user.poststed,
        rolle: userType === 'bruker' ? 'admin' : (user.rolle || 'klient'),
        type: userType,
        // Multi-tenancy
        organizationId: user.organization_id || null,
        organizationSlug: organization?.slug || null,
        organizationName: organization?.navn || null
      },
      // Organization branding for immediate use
      organization: organization ? {
        id: organization.id,
        navn: organization.navn,
        slug: organization.slug,
        logoUrl: organization.logo_url,
        primaryColor: organization.primary_color,
        secondaryColor: organization.secondary_color,
        brandTitle: organization.brand_title,
        brandSubtitle: organization.brand_subtitle,
        // Onboarding status
        onboardingCompleted: !!organization.onboarding_completed,
        industryTemplateId: organization.industry_template_id || null
      } : null
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Innlogging feilet' });
  }
});

// Rate limiter for refresh token endpoint
const refreshTokenLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // max 10 refresh attempts per minute
  message: { error: 'For mange fornyingsforespørsler, prøv igjen om litt' },
  standardHeaders: true,
  legacyHeaders: false
});

// Refresh access token using refresh token
app.post('/api/auth/refresh', refreshTokenLimiter, async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token er påkrevd' });
    }

    // Hash the provided token to look it up
    const tokenHash = hashRefreshToken(refreshToken);
    const tokenRecord = await getRefreshTokenRecord(tokenHash);

    // Check if token exists
    if (!tokenRecord) {
      return res.status(401).json({ error: 'Ugyldig refresh token' });
    }

    // Check for token reuse (potential security breach)
    if (isRefreshTokenReused(tokenRecord)) {
      // Token was already used - revoke all tokens for this user (security measure)
      Logger.warn(`Refresh token reuse detected for user ${tokenRecord.user_id} (${tokenRecord.user_type})`);
      await revokeAllUserRefreshTokens(tokenRecord.user_id, tokenRecord.user_type);
      return res.status(401).json({ error: 'Token gjenbruk oppdaget. Logg inn på nytt.' });
    }

    // Validate token (not expired, not revoked)
    if (!isRefreshTokenValid(tokenRecord)) {
      return res.status(401).json({ error: 'Refresh token er utløpt eller ugyldig' });
    }

    // Get user data
    let user = null;
    let organization = null;

    if (tokenRecord.user_type === 'klient') {
      if (useSupabase) {
        const allKlienter = await supabaseService.getAllKlienter();
        user = allKlienter.find(k => k.id === tokenRecord.user_id);
      } else {
        user = db.prepare('SELECT * FROM klient WHERE id = ? AND aktiv = 1').get(tokenRecord.user_id);
      }
    } else {
      if (useSupabase) {
        user = await supabaseService.getBrukerById(tokenRecord.user_id);
      } else {
        user = db.prepare('SELECT * FROM brukere WHERE id = ? AND aktiv = 1').get(tokenRecord.user_id);
      }
    }

    if (!user) {
      await revokeRefreshToken(tokenHash);
      return res.status(401).json({ error: 'Bruker ikke funnet' });
    }

    // Get organization data if applicable
    if (user.organization_id) {
      organization = await getOrganizationById(user.organization_id);
    }

    // Generate new access token
    const newAccessToken = jwt.sign(
      {
        userId: user.id,
        epost: user.epost,
        rolle: user.rolle || 'klient',
        userType: tokenRecord.user_type,
        organizationId: user.organization_id || null,
        organizationSlug: organization?.slug || null,
        organizationName: organization?.navn || null
      },
      jwtSecret,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // Token rotation: Generate new refresh token and revoke old one
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

    // Calculate new expiration (use remaining time from original or a new period)
    const originalExpiresAt = new Date(tokenRecord.expires_at);
    const now = new Date();
    const remainingTime = originalExpiresAt.getTime() - now.getTime();

    // Use at least 7 days or remaining time, whichever is longer
    const newExpiresAt = new Date(now.getTime() + Math.max(remainingTime, REFRESH_TOKEN_DURATION));

    // Store new refresh token
    await storeRefreshToken(
      newRefreshTokenHash,
      user.id,
      tokenRecord.user_type,
      tokenRecord.device_info,
      tokenRecord.ip_address,
      newExpiresAt
    );

    // Revoke old refresh token (mark as replaced)
    await revokeRefreshToken(tokenHash, newRefreshTokenHash);

    // Calculate expiry timestamps
    const accessTokenExpiresAt = Date.now() + ACCESS_TOKEN_DURATION;

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt: newExpiresAt.getTime(),
      // Legacy fields
      token: newAccessToken,
      expiresAt: accessTokenExpiresAt
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Token fornyelse feilet' });
  }
});

// Logout - revoke refresh token
app.post('/api/klient/logout', async (req, res) => {
  try {
    const { refreshToken, logoutAll } = req.body;

    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      const tokenRecord = await getRefreshTokenRecord(tokenHash);

      if (tokenRecord) {
        if (logoutAll) {
          // Revoke all tokens for this user
          const revokedCount = await revokeAllUserRefreshTokens(tokenRecord.user_id, tokenRecord.user_type);
          Logger.log(`Logged out from all devices: revoked ${revokedCount} tokens for user ${tokenRecord.user_id}`);
        } else {
          // Revoke only this token
          await revokeRefreshToken(tokenHash);
        }
      }
    }

    res.json({ success: true, message: 'Utlogget' });
  } catch (error) {
    console.error('Logout error:', error);
    // Still return success - user intent is to log out
    res.json({ success: true, message: 'Utlogget' });
  }
});

// Verify client token middleware
// Supports both Authorization header (Bearer token) and SSO cookies from marketing site
function requireKlientAuth(req, res, next) {
  // Try to get token from Authorization header first
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  // If no Authorization header, try SSO cookie from marketing site
  if (!token && req.headers.cookie) {
    token = extractTokenFromCookies(req.headers.cookie, AUTH_COOKIE_NAME);
  }

  if (!token) {
    return res.status(401).json({ error: 'Mangler autorisasjon' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.klientSession = decoded;
    req.klientEpost = decoded.epost;
    req.klientToken = token;
    // Multi-tenancy: Extract organization context from JWT
    req.organizationId = decoded.organizationId || null;
    req.organizationSlug = decoded.organizationSlug || null;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesjonen har utløpt' });
    }
    return res.status(401).json({ error: 'Ugyldig token' });
  }
}

// Multi-tenancy: Require valid tenant context
function requireTenantAuth(req, res, next) {
  requireKlientAuth(req, res, () => {
    if (!req.organizationId) {
      return res.status(401).json({ error: 'Mangler organisasjonskontekst' });
    }
    next();
  });
}

// Subscription status check
const SUBSCRIPTION_GRACE_PERIOD_DAYS = Number.parseInt(process.env.SUBSCRIPTION_GRACE_PERIOD_DAYS || '3', 10);
const WEB_DASHBOARD_URL = process.env.WEB_URL || 'https://skyplanner.no';

function checkSubscriptionStatus(status, trialEndsAt, currentPeriodEnd) {
  const now = new Date();

  // No status means legacy/migration - allow access
  if (!status) {
    return { isActive: true, message: 'Ingen abonnementsstatus funnet' };
  }

  switch (status) {
    case 'active':
      return { isActive: true, message: 'Aktivt abonnement' };

    case 'trialing': {
      if (trialEndsAt) {
        const trialEnd = new Date(trialEndsAt);
        if (now > trialEnd) {
          return {
            isActive: false,
            reason: 'trial_expired',
            message: 'Prøveperioden din har utløpt. Oppgrader til et abonnement for å fortsette.'
          };
        }
      }
      return { isActive: true, message: 'I prøveperiode' };
    }

    case 'past_due': {
      if (currentPeriodEnd) {
        const periodEnd = new Date(currentPeriodEnd);
        const graceEnd = new Date(periodEnd);
        graceEnd.setDate(graceEnd.getDate() + SUBSCRIPTION_GRACE_PERIOD_DAYS);

        if (now <= graceEnd) {
          return {
            isActive: true,
            isInGracePeriod: true,
            message: `Betalingen din har feilet. Oppdater betalingsmetode innen ${SUBSCRIPTION_GRACE_PERIOD_DAYS} dager.`
          };
        }
      }
      return {
        isActive: false,
        reason: 'grace_period_exceeded',
        message: 'Betalingen din har feilet og fristen for å oppdatere betalingsmetode er utløpt.'
      };
    }

    case 'canceled':
      return {
        isActive: false,
        reason: 'canceled',
        message: 'Abonnementet ditt er kansellert. Reaktiver for å få tilgang.'
      };

    case 'incomplete':
      return {
        isActive: false,
        reason: 'incomplete',
        message: 'Abonnementet ditt er ikke fullført. Fullfør registreringen for å få tilgang.'
      };

    default:
      return {
        isActive: false,
        reason: 'unknown',
        message: 'Ukjent abonnementsstatus.'
      };
  }
}

function requireActiveSubscription(req, res, next) {
  const session = req.klientSession;

  if (!session) {
    return res.status(401).json({ error: 'Ikke autentisert' });
  }

  const result = checkSubscriptionStatus(
    session.subscriptionStatus,
    session.trialEndsAt,
    session.currentPeriodEnd
  );

  if (result.isInGracePeriod) {
    Logger.warn('User in subscription grace period:', session.userId, session.organizationId);
  }

  if (!result.isActive) {
    Logger.warn('Subscription check failed:', session.userId, result.reason);
    return res.status(403).json({
      error: result.message,
      code: 'SUBSCRIPTION_INACTIVE',
      details: {
        status: session.subscriptionStatus || 'unknown',
        reason: result.reason,
        redirectUrl: `${WEB_DASHBOARD_URL}/dashboard/abonnement`
      }
    });
  }

  next();
}

// Combined middleware: Auth + Tenant + Subscription
function requireFullAuth(req, res, next) {
  requireTenantAuth(req, res, () => {
    requireActiveSubscription(req, res, next);
  });
}

// Helper: Get organization by ID
async function getOrganizationById(orgId) {
  if (useSupabase) {
    return await supabaseService.getOrganizationById(orgId);
  } else {
    return db.prepare('SELECT * FROM organizations WHERE id = ? AND aktiv = 1').get(orgId);
  }
}

// Helper: Get organization by slug
async function getOrganizationBySlug(slug) {
  if (useSupabase) {
    return await supabaseService.getOrganizationBySlug(slug);
  } else {
    return db.prepare('SELECT * FROM organizations WHERE slug = ? AND aktiv = 1').get(slug);
  }
}

// Get login log (admin only)
app.get('/api/login-logg', requireKlientAuth, async (req, res) => {
  try {
    const session = req.klientSession;

    // Only allow admin/bruker to view login log
    if (session.userType !== 'bruker' && session.rolle !== 'admin') {
      return res.status(403).json({ error: 'Ikke tilgang' });
    }

    const limit = Number.parseInt(req.query.limit) || 100;
    const offset = Number.parseInt(req.query.offset) || 0;

    let logg;
    if (useSupabase) {
      logg = await supabaseService.getLoginLogg(limit, offset);
    } else {
      logg = db.prepare(`
        SELECT * FROM login_logg
        ORDER BY tidspunkt DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset);
    }

    // Get total count
    let total;
    if (useSupabase) {
      total = await supabaseService.getLoginLoggCount();
    } else {
      total = db.prepare('SELECT COUNT(*) as count FROM login_logg').get().count;
    }

    res.json({ logg, total });
  } catch (error) {
    console.error('Error fetching login log:', error);
    res.status(500).json({ error: 'Kunne ikke hente login-logg' });
  }
});

// Get login statistics (admin only)
app.get('/api/login-logg/stats', requireKlientAuth, async (req, res) => {
  try {
    const session = req.klientSession;

    if (session.userType !== 'bruker' && session.rolle !== 'admin') {
      return res.status(403).json({ error: 'Ikke tilgang' });
    }

    let stats;
    if (useSupabase) {
      stats = await supabaseService.getLoginStats();
    } else {
      const total = db.prepare('SELECT COUNT(*) as count FROM login_logg').get().count;
      const vellykket = db.prepare("SELECT COUNT(*) as count FROM login_logg WHERE status = 'vellykket'").get().count;
      const feilet = db.prepare("SELECT COUNT(*) as count FROM login_logg WHERE status = 'feilet'").get().count;
      const siste24t = db.prepare("SELECT COUNT(*) as count FROM login_logg WHERE tidspunkt > datetime('now', '-24 hours')").get().count;
      const siste7d = db.prepare("SELECT COUNT(*) as count FROM login_logg WHERE tidspunkt > datetime('now', '-7 days')").get().count;

      stats = { total, vellykket, feilet, siste24t, siste7d };
    }

    res.json(stats);
  } catch (error) {
    console.error('Error fetching login stats:', error);
    res.status(500).json({ error: 'Kunne ikke hente statistikk' });
  }
});

// Get all brukere (team members) for organization (admin only)
app.get('/api/brukere', requireKlientAuth, async (req, res) => {
  try {
    const session = req.klientSession;

    // Only allow admin/bruker to view team members
    if (session.userType !== 'bruker' && session.rolle !== 'admin') {
      return res.status(403).json({ error: 'Ikke tilgang' });
    }

    const organizationId = session.organizationId;
    let brukere;

    if (useSupabase) {
      const { data, error } = await supabaseService.getClient()
        .from('brukere')
        .select('id, navn, epost, rolle, sist_innlogget, opprettet, aktiv')
        .eq('organization_id', organizationId)
        .eq('aktiv', true)
        .order('navn');

      if (error) throw error;
      brukere = data || [];
    } else {
      brukere = db.prepare(`
        SELECT id, navn, epost, rolle, sist_innlogget, opprettet, aktiv
        FROM brukere
        WHERE organization_id = ? AND aktiv = 1
        ORDER BY navn COLLATE NOCASE
      `).all(organizationId);
    }

    res.json({ brukere });
  } catch (error) {
    console.error('Error fetching brukere:', error);
    res.status(500).json({ error: 'Kunne ikke hente brukere' });
  }
});

// Get dashboard data for client
app.get('/api/klient/dashboard', requireKlientAuth, async (req, res) => {
  try {
    const session = req.klientSession;
    let kunder;
    let klient = null;
    let historikk = [];

    // Get klient/bruker info
    if (session.userType === 'klient') {
      if (useSupabase) {
        klient = await supabaseService.getKlientById(session.userId);
      } else {
        klient = db.prepare('SELECT * FROM klient WHERE id = ?').get(session.userId);
      }
    }

    if (useSupabase) {
      kunder = await supabaseService.getAllKunder();
      // Get control history if table exists
      try {
        const { data } = await supabaseService.getClient()
          .from('kontroll_historikk')
          .select('*, kunder(navn)')
          .order('kontroll_dato', { ascending: false })
          .limit(10);
        if (data) {
          historikk = data.map(h => ({
            ...h,
            kunde_navn: h.kunder?.navn
          }));
        }
      } catch (e) {
        // Table might not exist yet
      }
    } else {
      kunder = db.prepare('SELECT * FROM kunder ORDER BY navn COLLATE NOCASE').all();
      // Get control history if table exists
      try {
        historikk = db.prepare(`
          SELECT h.*, k.navn as kunde_navn
          FROM kontroll_historikk h
          LEFT JOIN kunder k ON h.kunde_id = k.id
          ORDER BY h.kontroll_dato DESC
          LIMIT 10
        `).all();
      } catch (e) {
        // Table might not exist yet
      }
    }

    // Calculate stats (using Norwegian timezone)
    const today = getNorwegianToday();

    // Helper to parse date string as local date (not UTC)
    const parseLocalDate = (dateStr) => {
      if (!dateStr) return null;
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    // Helper to get next control date (check all date fields)
    const getNextControlDate = (k) => {
      const dates = [k.neste_el_kontroll, k.neste_brann_kontroll, k.neste_kontroll]
        .filter(Boolean)
        .map(d => parseLocalDate(d));
      if (dates.length === 0) return null;
      return new Date(Math.min(...dates));
    };

    const forfalt = kunder.filter(k => {
      const nextDate = getNextControlDate(k);
      if (!nextDate) return false;
      return nextDate < today;
    });

    const kommendeKontroller = kunder.filter(k => {
      const nextDate = getNextControlDate(k);
      if (!nextDate) return false;
      const daysUntil = Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24));
      return daysUntil >= 0 && daysUntil <= 30;
    });

    // Check if user is admin based on role in database/session
    const isAdmin = session.rolle === 'admin';

    res.json({
      klient: {
        id: session.userId,
        navn: klient?.navn || session.epost,
        epost: klient?.epost || session.epost,
        telefon: klient?.telefon,
        adresse: klient?.adresse,
        postnummer: klient?.postnummer,
        poststed: klient?.poststed,
        rolle: isAdmin ? 'admin' : (session.rolle || 'klient'),
        type: session.userType
      },
      sessionExpiresAt: session.expires,
      stats: {
        totaltKunder: kunder.length,
        forfalt: forfalt.length,
        kommendeKontroller: kommendeKontroller.length
      },
      kommendeKontroller: kommendeKontroller.slice(0, 10).map(k => ({
        id: k.id,
        navn: k.navn,
        adresse: k.adresse,
        poststed: k.poststed,
        kategori: k.kategori,
        neste_kontroll: k.neste_el_kontroll || k.neste_brann_kontroll || k.neste_kontroll
      })),
      forfalt: forfalt.slice(0, 5).map(k => ({
        id: k.id,
        navn: k.navn,
        adresse: k.adresse,
        poststed: k.poststed,
        kategori: k.kategori,
        neste_kontroll: k.neste_el_kontroll || k.neste_brann_kontroll || k.neste_kontroll
      })),
      historikk
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Kunne ikke hente dashboarddata' });
  }
});

// Extend session - with JWT, we just return a new token
app.post('/api/klient/extend-session', requireKlientAuth, (req, res) => {
  const session = req.klientSession;

  // Generate a new token with extended expiry
  const newToken = jwt.sign(
    {
      userId: session.userId,
      epost: session.epost,
      rolle: session.rolle || 'klient',
      userType: session.userType
    },
    jwtSecret,
    { expiresIn: '24h' }
  );

  const newExpiry = Date.now() + SESSION_DURATION;
  res.json({ success: true, expiresAt: newExpiry, token: newToken });
});

// Update client profile
app.put('/api/klient/profile', requireKlientAuth, async (req, res) => {
  try {
    const session = req.klientSession;
    const { navn, epost, telefon, adresse, postnummer, poststed, newPassword } = req.body;

    // Type safety
    if (typeof navn !== 'string' || typeof epost !== 'string' || !navn || !epost) {
      return res.status(400).json({ error: 'Navn og e-post er påkrevd' });
    }

    const updateData = { navn, epost, telefon, adresse, postnummer, poststed };

    // Hash new password if provided
    if (newPassword) {
      if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Passord må være minst 6 tegn' });
      }
      updateData.passord_hash = await bcrypt.hash(newPassword, 10);
    }

    if (session.userType === 'klient') {
      if (useSupabase) {
        const { error } = await supabaseService.getClient()
          .from('klient')
          .update(updateData)
          .eq('id', session.userId);
        if (error) throw error;
      } else {
        const fields = Object.keys(updateData).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(updateData), session.userId];
        db.prepare(`UPDATE klient SET ${fields} WHERE id = ?`).run(...values);
      }
    } else {
      if (useSupabase) {
        const { error } = await supabaseService.getClient()
          .from('brukere')
          .update(updateData)
          .eq('id', session.userId);
        if (error) throw error;
      } else {
        const fields = Object.keys(updateData).map(k => `${k} = ?`).join(', ');
        const values = [...Object.values(updateData), session.userId];
        db.prepare(`UPDATE brukere SET ${fields} WHERE id = ?`).run(...values);
      }
    }

    // With JWT, the old token will still work until it expires
    // Client should re-login to get updated claims if needed
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'Kunne ikke oppdatere profil' });
  }
});

// Client logout - with JWT we just confirm, client removes token locally
app.post('/api/klient/logout', requireKlientAuth, (req, res) => {
  // JWT tokens are stateless - client handles removal
  res.json({ success: true });
});

// ===== PASSWORD RESET =====
const resetTokens = new Map(); // token -> { epost, userType, expires }

// Cleanup expired reset tokens every 15 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;
  for (const [token, data] of resetTokens.entries()) {
    if (now > data.expires) {
      resetTokens.delete(token);
      cleanedCount++;
    }
  }
  if (cleanedCount > 0) {
    Logger.log(`Cleaned up ${cleanedCount} expired reset token(s)`);
  }
}, 15 * 60 * 1000); // 15 minutes

// Request password reset - sends email with reset link
app.post('/api/auth/request-reset', async (req, res) => {
  try {
    const { epost } = req.body;

    if (!epost) {
      return res.status(400).json({ error: 'E-post er påkrevd' });
    }

    let user = null;
    let userType = 'klient';
    let userEmail = null;

    // Check klient table
    if (useSupabase) {
      user = await supabaseService.getKlientByEpost(epost);
    } else {
      user = db.prepare('SELECT * FROM klient WHERE LOWER(epost) = LOWER(?) AND aktiv = 1').get(epost);
    }
    if (user) {
      userEmail = user.epost;
    }

    // Always return success to prevent email enumeration
    if (!user || !userEmail || !userEmail.includes('@')) {
      return res.json({ success: true, message: 'Hvis kontoen finnes, vil du motta en e-post med instruksjoner.' });
    }

    // Generate reset token
    const token = generateToken();
    resetTokens.set(token, {
      epost: user.epost,
      userId: user.id,
      userType: userType,
      expires: Date.now() + (60 * 60 * 1000) // 1 hour
    });

    // Build reset URL
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetUrl = `${baseUrl}/nytt-passord.html?token=${token}`;

    // Warn if BASE_URL is not set in production
    if (process.env.NODE_ENV === 'production' && !process.env.BASE_URL) {
      Logger.warn('⚠️  WARNING: BASE_URL not set in production. Reset links will not work correctly.');
      Logger.warn('   Set BASE_URL=https://trekontroll.no in your .env file');
    }

    // Send email
    try {
      const companyName = process.env.COMPANY_NAME || 'Kontrollsystem';
      const emailSubject = `Tilbakestill passord - ${companyName}`;
      const emailMessage = `
Hei ${user.navn},

Vi har mottatt en forespørsel om å tilbakestille passordet ditt.

Klikk på lenken under for å velge et nytt passord:
${resetUrl}

Lenken er gyldig i 1 time.

Hvis du ikke ba om dette, kan du ignorere denne e-posten.

--
${companyName}
      `.trim();

      Logger.log(`Attempting to send password reset email to: ${userEmail}`);
      Logger.log(`Reset URL: ${resetUrl}`);
      Logger.log(`Email configured: ${emailService.isEmailConfigured()}`);
      const result = await emailService.sendEmail(userEmail, emailSubject, emailMessage);
      if (result.success) {
        Logger.log(`Password reset email sent successfully to ${userEmail}`);
      } else {
        console.error(`Password reset email FAILED for ${userEmail}:`, result.error);
      }
    } catch (emailError) {
      console.error('Failed to send reset email:', emailError);
      // Don't reveal email failure to user
    }

    res.json({ success: true, message: 'Hvis kontoen finnes, vil du motta en e-post med instruksjoner.' });
  } catch (error) {
    console.error('Request reset error:', error);
    res.status(500).json({ error: 'Kunne ikke behandle forespørselen' });
  }
});

// Rate limiter for token verification (prevent brute force)
const tokenVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 attempts per IP
  message: { valid: false, error: 'For mange forsøk, prøv igjen senere' }
});

// Verify reset token (for frontend validation)
app.get('/api/auth/verify-token', tokenVerifyLimiter, (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ valid: false, error: 'Token mangler' });
  }

  const resetData = resetTokens.get(token);
  if (!resetData) {
    return res.status(400).json({ valid: false, error: 'Ugyldig token' });
  }

  if (Date.now() > resetData.expires) {
    resetTokens.delete(token);
    return res.status(400).json({ valid: false, error: 'Token har utløpt' });
  }

  res.json({ valid: true });
});

// Reset password with token
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Type safety
    if (typeof token !== 'string' || typeof newPassword !== 'string' || !token || !newPassword) {
      return res.status(400).json({ error: 'Token og nytt passord er påkrevd' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Passordet må være minst 6 tegn' });
    }

    const resetData = resetTokens.get(token);
    if (!resetData) {
      return res.status(400).json({ error: 'Ugyldig eller utløpt token' });
    }

    if (Date.now() > resetData.expires) {
      resetTokens.delete(token);
      return res.status(400).json({ error: 'Token har utløpt' });
    }

    // Hash new password
    const passordHash = await bcrypt.hash(newPassword, 10);

    // Update password in database (klient table only)
    if (useSupabase) {
      const { error } = await supabaseService.getClient()
        .from('klient')
        .update({ passord_hash: passordHash })
        .eq('id', resetData.userId);
      if (error) throw error;
    } else {
      db.prepare('UPDATE klient SET passord_hash = ? WHERE id = ?').run(passordHash, resetData.userId);
    }

    // Delete used token
    resetTokens.delete(token);

    res.json({ success: true, message: 'Passord oppdatert' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Kunne ikke oppdatere passord' });
  }
});

const PORT = process.env.PORT || 3000;

// Dummy broadcast function for serverless environments
global.wsBroadcast = () => {};

// Check if running on Vercel (serverless) or locally
const isVercel = process.env.VERCEL === '1';

// ===== ORS PROXY API (Server-side to protect API key) =====

// Rate limiter for route planning
const routePlanningLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // max 10 route requests per minute
  message: { error: 'For mange ruteforespørsler, vent litt' }
});

// Proxy for ORS optimization endpoint
app.post('/api/routes/optimize', routePlanningLimiter, async (req, res) => {
  try {
    const orsApiKey = process.env.ORS_API_KEY;
    if (!orsApiKey) {
      return res.status(503).json({ error: 'Ruteplanlegging er ikke konfigurert' });
    }

    const response = await fetch('https://api.openrouteservice.org/optimization', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': orsApiKey
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('ORS optimization error:', error);
    res.status(500).json({ error: 'Feil ved ruteoptimalisering' });
  }
});

// Proxy for ORS directions endpoint
app.post('/api/routes/directions', routePlanningLimiter, async (req, res) => {
  console.log('[ORS] Directions request received, coordinates:', req.body.coordinates?.length || 0);
  try {
    const orsApiKey = process.env.ORS_API_KEY;
    if (!orsApiKey) {
      console.log('[ORS] No API key configured');
      return res.status(503).json({ error: 'Ruteplanlegging er ikke konfigurert' });
    }

    // Validate coordinates array
    if (!req.body.coordinates || !Array.isArray(req.body.coordinates)) {
      return res.status(400).json({ error: 'Koordinater mangler eller er ugyldig format' });
    }

    if (req.body.coordinates.length < 2) {
      return res.status(400).json({ error: 'Minst 2 koordinater er påkrevd' });
    }

    if (req.body.coordinates.length > 50) {
      return res.status(400).json({ error: 'Maks 50 koordinater er tillatt' });
    }

    // Validate each coordinate is [lng, lat] with valid numbers
    for (let i = 0; i < req.body.coordinates.length; i++) {
      const coord = req.body.coordinates[i];
      if (!Array.isArray(coord) || coord.length !== 2) {
        return res.status(400).json({ error: `Ugyldig koordinat ved indeks ${i}` });
      }
      const [lng, lat] = coord;
      if (typeof lng !== 'number' || typeof lat !== 'number' ||
          Number.isNaN(lng) || Number.isNaN(lat) ||
          lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        return res.status(400).json({ error: `Ugyldig koordinatverdier ved indeks ${i}` });
      }
    }

    // Add larger search radius (5km) to find roads for coordinates not directly on roads
    const requestBody = {
      ...req.body,
      radiuses: req.body.coordinates.map(() => 5000)
    };

    const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': orsApiKey
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    console.log('[ORS] Directions response status:', response.status);
    if (!response.ok) {
      console.log('[ORS] Error response:', JSON.stringify(data));
    }
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[ORS] Directions error:', error);
    res.status(500).json({ error: 'Feil ved ruteberegning' });
  }
});

if (isVercel) {
  // Vercel serverless - just export the app
  module.exports = app;
} else {
  // Local development - use WebSocket server
  const http = require('http');

  // Only require ws if available (optional dependency on Vercel)
  let WebSocket;
  try {
    WebSocket = require('ws');
  } catch (e) {
    WebSocket = null;
  }

  const server = http.createServer(app);

  if (WebSocket) {
    const wss = new WebSocket.Server({ server });
    const wsClients = new Set();

    wss.on('connection', (ws) => {
      wsClients.add(ws);
      Logger.log(`WebSocket client connected. Total clients: ${wsClients.size}`);
      ws.send(JSON.stringify({ type: 'connected', message: 'Tilkoblet sanntidsserver' }));

      ws.on('close', () => {
        wsClients.delete(ws);
        Logger.log(`WebSocket client disconnected. Total clients: ${wsClients.size}`);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        wsClients.delete(ws);
      });
    });

    // Override broadcast function with real WebSocket broadcast
    global.wsBroadcast = (type, data) => {
      const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
      wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    };

    Logger.log('WebSocket server aktiv');
  }

  server.listen(PORT, () => {
    Logger.log(`Server kjører på http://localhost:${PORT}`);
    Logger.log(`Database: ${DATABASE_TYPE}`);

    // Start email reminder cron job (only locally, Vercel uses cron)
    if (process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true') {
      emailService.startReminderCron(useSupabase ? supabaseService : db);
    }
  });
}

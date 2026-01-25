const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const XLSX = require('xlsx');
const multer = require('multer');
const { requireKlientAuth } = require('../middleware/auth');
const { validateKunde } = require('../middleware/validation');

// Import services for enhanced Excel import
const { matchCategory, matchElType, matchBrannSystem, matchDriftstype, analyzeCategories, getValidValues } = require('../src/services/categoryMatcher');
const { normalizeKunde } = require('../src/services/dataNormalizer');
const { findDuplicateInDatabase } = require('../src/services/duplicateDetector');
const { analyzeExcelForDynamicSchema } = require('../src/services/fieldManager');

// In-memory session store for import previews (expires after 1 hour)
const importSessions = new Map();
const SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of importSessions) {
    if (now - session.createdAt > SESSION_EXPIRY_MS) {
      importSessions.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv',
      'application/csv'
    ];
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));

    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Ugyldig filtype. Kun Excel (.xlsx, .xls) og CSV (.csv) er tillatt.'));
    }
  }
});

// Column mappings: Excel header -> database column
const COLUMN_MAPPINGS = {
  'navn': 'navn', 'name': 'navn', 'kundenavn': 'navn', 'kunde': 'navn',
  'adresse': 'adresse', 'address': 'adresse', 'gateadresse': 'adresse',
  'postnummer': 'postnummer', 'postnr': 'postnummer', 'zip': 'postnummer',
  'poststed': 'poststed', 'sted': 'poststed', 'by': 'poststed', 'city': 'poststed',
  'telefon': 'telefon', 'tlf': 'telefon', 'mobil': 'telefon', 'phone': 'telefon',
  'epost': 'epost', 'email': 'epost', 'e-post': 'epost', 'mail': 'epost',
  'kategori': 'kategori', 'category': 'kategori', 'tjeneste': 'kategori',
  'el_type': 'el_type', 'el-type': 'el_type', 'eltype': 'el_type',
  'brann_system': 'brann_system', 'brannsystem': 'brann_system', 'brann system': 'brann_system',
  'brann_driftstype': 'brann_driftstype', 'driftstype': 'brann_driftstype', 'drift': 'brann_driftstype',
  'lat': 'lat', 'latitude': 'lat', 'breddegrad': 'lat',
  'lng': 'lng', 'lon': 'lng', 'longitude': 'lng', 'lengdegrad': 'lng',
  'notater': 'notater', 'notes': 'notater', 'kommentar': 'notater', 'merknad': 'notater'
};

// Whitelist of allowed database columns for security
const ALLOWED_DB_COLUMNS = new Set([
  'navn', 'adresse', 'postnummer', 'poststed', 'telefon', 'epost',
  'lat', 'lng', 'notater', 'kategori', 'el_type', 'brann_system',
  'brann_driftstype', 'organization_id', 'siste_el_kontroll',
  'neste_el_kontroll', 'el_kontroll_intervall', 'siste_brann_kontroll',
  'neste_brann_kontroll', 'brann_kontroll_intervall', 'siste_kontroll',
  'neste_kontroll', 'kontroll_intervall_mnd', 'id', 'created_at', 'updated_at',
  'custom_data'
]);

// Validate SQL identifier (column name)
function isValidIdentifier(name) {
  if (!name || typeof name !== 'string') return false;
  // Only lowercase letters, numbers, underscores. Must start with letter/underscore. Max 63 chars.
  return /^[a-z_][a-z0-9_]{0,62}$/.test(name);
}

// Escape SQL identifier for SQLite (double-quote escaping)
function escapeIdentifier(name) {
  if (!isValidIdentifier(name)) {
    throw new Error(`Invalid column name: ${name}`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

// Validate column is either in whitelist or is a valid custom_ prefixed column
function isAllowedColumn(name) {
  if (ALLOWED_DB_COLUMNS.has(name)) return true;
  if (name.startsWith('custom_') && isValidIdentifier(name)) return true;
  return false;
}

// Safely convert value to string (prevents type confusion attacks)
function safeString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return String(value);
  return value;
}

// Generate ETag from data using SHA-256 (truncated for reasonable header size)
function generateETag(data) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return `"${hash.substring(0, 32)}"`;
}

// Helper function to add months to a date
function addMonthsToDate(dateStr, months) {
  const date = new Date(dateStr);
  const day = date.getDate();
  date.setMonth(date.getMonth() + months);
  if (date.getDate() !== day) {
    date.setDate(0);
  }
  return date.toISOString().split('T')[0];
}

/**
 * Creates kunder routes with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.db - SQLite database instance (null if using Supabase)
 * @param {Object} deps.supabaseService - Supabase service (null if using SQLite)
 * @param {boolean} deps.useSupabase - Whether to use Supabase
 */
function createKunderRoutes({ db, supabaseService, useSupabase }) {

  // Helper: Get services for a customer (SQLite)
  function getCustomerServices(kundeId) {
    return db.prepare(`
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
  }

  // Helper: Enrich kunder array with services
  function enrichKunderWithServices(kunder) {
    return kunder.map(kunde => ({
      ...kunde,
      services: getCustomerServices(kunde.id)
    }));
  }

  // GET /api/kunder - Hent alle kunder (med ETag-caching)
  router.get('/', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;
      const includeServices = req.query.includeServices === 'true';

      let kunder;
      if (useSupabase) {
        kunder = orgId
          ? await supabaseService.getAllKunderByTenant(orgId)
          : await supabaseService.getAllKunder();
        // TODO: Enrich with services from Supabase
      } else {
        const sql = orgId
          ? 'SELECT * FROM kunder WHERE organization_id = ? ORDER BY navn COLLATE NOCASE'
          : 'SELECT * FROM kunder ORDER BY navn COLLATE NOCASE';
        kunder = orgId
          ? db.prepare(sql).all(orgId)
          : db.prepare(sql).all();

        // Optionally include services
        if (includeServices) {
          kunder = enrichKunderWithServices(kunder);
        }
      }

      // ETag caching - return 304 if data unchanged
      const etag = generateETag(kunder);
      res.set('ETag', etag);
      res.set('Cache-Control', 'private, must-revalidate');

      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      res.json(kunder);
    } catch (error) {
      console.error('Error fetching kunder:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // GET /api/kunder/kontroll-varsler - Kunder som trenger kontroll (DYNAMIC via customer_services)
  router.get('/kontroll-varsler', requireKlientAuth, async (req, res) => {
    try {
      const dagerFrem = Math.max(1, Math.min(365, Number.parseInt(req.query.dager) || 30));
      const orgId = req.organizationId;

      if (useSupabase) {
        const kunder = await supabaseService.getKontrollVarsler(dagerFrem);
        res.json(kunder);
      } else {
        // Dynamic query using customer_services table
        const kunder = db.prepare(`
          SELECT DISTINCT k.*,
            cs.neste_kontroll as service_neste_kontroll,
            cs.siste_kontroll as service_siste_kontroll,
            cs.intervall_months as service_intervall,
            st.name as service_type_name,
            st.slug as service_type_slug,
            st.icon as service_type_icon,
            st.color as service_type_color
          FROM kunder k
          INNER JOIN customer_services cs ON k.id = cs.kunde_id AND cs.aktiv = 1
          INNER JOIN template_service_types st ON cs.service_type_id = st.id
          WHERE (
            cs.neste_kontroll <= date('now', '+' || ? || ' days')
            OR (cs.neste_kontroll IS NULL AND cs.siste_kontroll IS NOT NULL
                AND date(cs.siste_kontroll, '+' || COALESCE(cs.intervall_months, st.default_interval_months) || ' months') <= date('now', '+' || ? || ' days'))
            OR (cs.neste_kontroll IS NULL AND cs.siste_kontroll IS NULL)
          )
          ${orgId ? 'AND k.organization_id = ?' : ''}
          ORDER BY
            st.sort_order,
            COALESCE(cs.neste_kontroll, date(cs.siste_kontroll, '+' || COALESCE(cs.intervall_months, st.default_interval_months) || ' months')),
            k.navn COLLATE NOCASE
        `).all(orgId ? [dagerFrem, dagerFrem, orgId] : [dagerFrem, dagerFrem]);

        // Enrich with services array for each customer
        const kundeMap = new Map();
        for (const row of kunder) {
          if (!kundeMap.has(row.id)) {
            kundeMap.set(row.id, {
              ...row,
              services: []
            });
          }
          kundeMap.get(row.id).services.push({
            service_type_name: row.service_type_name,
            service_type_slug: row.service_type_slug,
            service_type_icon: row.service_type_icon,
            service_type_color: row.service_type_color,
            neste_kontroll: row.service_neste_kontroll,
            siste_kontroll: row.service_siste_kontroll,
            intervall_months: row.service_intervall
          });
        }

        res.json(Array.from(kundeMap.values()));
      }
    } catch (error) {
      console.error('Error fetching kontroll-varsler:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // GET /api/kunder/omrade/:omrade - Kunder i et område
  router.get('/omrade/:omrade', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      if (useSupabase) {
        const kunder = await supabaseService.getKunderByOmrade(req.params.omrade);
        const filtered = orgId ? kunder.filter(k => k.organization_id === orgId) : kunder;
        res.json(filtered);
      } else {
        const sql = orgId
          ? 'SELECT * FROM kunder WHERE organization_id = ? AND (poststed LIKE ? OR adresse LIKE ?)'
          : 'SELECT * FROM kunder WHERE poststed LIKE ? OR adresse LIKE ?';
        const params = orgId
          ? [orgId, `%${req.params.omrade}%`, `%${req.params.omrade}%`]
          : [`%${req.params.omrade}%`, `%${req.params.omrade}%`];
        const kunder = db.prepare(sql).all(...params);
        res.json(kunder);
      }
    } catch (error) {
      console.error('Error fetching kunder by omrade:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // GET /api/kunder/:id - Hent én kunde (med services)
  router.get('/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      if (useSupabase) {
        const kunde = orgId
          ? await supabaseService.getKundeByIdAndTenant(req.params.id, orgId)
          : await supabaseService.getKundeById(req.params.id);
        if (kunde) {
          // TODO: Enrich with services from Supabase
          res.json(kunde);
        } else {
          res.status(404).json({ error: 'Kunde ikke funnet' });
        }
      } else {
        const sql = orgId
          ? 'SELECT * FROM kunder WHERE id = ? AND organization_id = ?'
          : 'SELECT * FROM kunder WHERE id = ?';
        const kunde = orgId
          ? db.prepare(sql).get(req.params.id, orgId)
          : db.prepare(sql).get(req.params.id);
        if (kunde) {
          // Include services in response
          kunde.services = getCustomerServices(kunde.id);
          res.json(kunde);
        } else {
          res.status(404).json({ error: 'Kunde ikke funnet' });
        }
      }
    } catch (error) {
      console.error('Error fetching kunde:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // Helper: Create customer_services entries based on services array or legacy kategori
  function createCustomerServicesForKunde(kundeId, body) {
    const { services, kategori, siste_el_kontroll, neste_el_kontroll, el_kontroll_intervall,
            siste_brann_kontroll, neste_brann_kontroll, brann_kontroll_intervall,
            el_type, brann_system, brann_driftstype } = body;

    // Get service type IDs
    const serviceTypes = db.prepare('SELECT id, slug FROM template_service_types').all();
    const elServiceType = serviceTypes.find(st => st.slug === 'el-kontroll');
    const brannServiceType = serviceTypes.find(st => st.slug === 'brannvarsling');

    // Get subtype and equipment mappings
    const subtypes = db.prepare('SELECT id, name FROM template_subtypes').all();
    const equipment = db.prepare('SELECT id, name FROM template_equipment').all();
    const subtypeMap = {};
    subtypes.forEach(s => { subtypeMap[s.name.toLowerCase()] = s.id; });
    const equipmentMap = {};
    equipment.forEach(e => { equipmentMap[e.name.toLowerCase()] = e.id; });

    const insertService = db.prepare(`
      INSERT INTO customer_services (kunde_id, service_type_id, subtype_id, equipment_type_id, siste_kontroll, neste_kontroll, intervall_months, driftstype, aktiv)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(kunde_id, service_type_id) DO UPDATE SET
        subtype_id = excluded.subtype_id,
        equipment_type_id = excluded.equipment_type_id,
        siste_kontroll = excluded.siste_kontroll,
        neste_kontroll = excluded.neste_kontroll,
        intervall_months = excluded.intervall_months,
        driftstype = excluded.driftstype,
        aktiv = 1
    `);

    // Use services array if provided (new dynamic way)
    if (services && Array.isArray(services)) {
      for (const service of services) {
        const serviceType = serviceTypes.find(st => st.slug === service.service_type_slug || st.id === service.service_type_id);
        if (serviceType) {
          const subtypeId = service.subtype_id || (service.subtype_name ? subtypeMap[service.subtype_name.toLowerCase()] : null);
          const equipmentId = service.equipment_type_id || (service.equipment_name ? equipmentMap[service.equipment_name.toLowerCase()] : null);
          insertService.run(
            kundeId, serviceType.id, subtypeId || null, equipmentId || null,
            service.siste_kontroll || null, service.neste_kontroll || null,
            service.intervall_months || null, service.driftstype || null
          );
        }
      }
    } else {
      // Fallback: Use legacy kategori field for backward compatibility
      const kategoriValue = safeString(kategori);
      const elTypeValue = safeString(el_type);
      const brannSystemValue = safeString(brann_system);

      if (elServiceType && (kategoriValue.includes('El-Kontroll') || siste_el_kontroll || neste_el_kontroll)) {
        const subtypeId = elTypeValue ? subtypeMap[elTypeValue.toLowerCase()] : null;
        const intervall = el_kontroll_intervall || (elTypeValue === 'Bolig' ? 60 : elTypeValue === 'Næring' ? 12 : 36);
        insertService.run(
          kundeId, elServiceType.id, subtypeId || null, null,
          siste_el_kontroll || null, neste_el_kontroll || null, intervall, null
        );
      }

      if (brannServiceType && (kategoriValue.includes('Brannvarsling') || siste_brann_kontroll || neste_brann_kontroll)) {
        const equipmentId = brannSystemValue ? equipmentMap[brannSystemValue.toLowerCase()] : null;
        insertService.run(
          kundeId, brannServiceType.id, null, equipmentId || null,
          siste_brann_kontroll || null, neste_brann_kontroll || null,
          brann_kontroll_intervall || 12, brann_driftstype || null
        );
      }
    }
  }

  // POST /api/kunder - Opprett ny kunde
  router.post('/', requireKlientAuth, async (req, res) => {
    try {
      const validationErrors = validateKunde(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ errors: validationErrors });
      }

      const orgId = req.organizationId;
      let kunde;

      if (useSupabase) {
        const kundeData = { ...req.body, organization_id: orgId };
        kunde = await supabaseService.createKunde(kundeData);
        // TODO: Create customer_services in Supabase
        res.json(kunde);
      } else {
        const {
          navn, adresse, postnummer, poststed, telefon, epost, lat, lng, notater, kategori,
          siste_el_kontroll, neste_el_kontroll, el_kontroll_intervall,
          siste_brann_kontroll, neste_brann_kontroll, brann_kontroll_intervall,
          el_type, brann_system, brann_driftstype, custom_data
        } = req.body;

        const kategoriValue = safeString(kategori) || 'El-Kontroll';
        const elTypeValue = safeString(el_type);
        let elIntervall = el_kontroll_intervall;
        let brannIntervall = brann_kontroll_intervall;

        if (kategoriValue.includes('El-Kontroll')) {
          elIntervall = elIntervall || (elTypeValue === 'Bolig' ? 60 : elTypeValue === 'Næring' ? 12 : 36);
        }
        if (kategoriValue.includes('Brannvarsling')) {
          brannIntervall = brannIntervall || 12;
        }

        // Insert into kunder table (keeping legacy columns for backward compatibility)
        const stmt = db.prepare(`
          INSERT INTO kunder (
            navn, adresse, postnummer, poststed, telefon, epost, lat, lng, notater, kategori,
            siste_el_kontroll, neste_el_kontroll, el_kontroll_intervall,
            siste_brann_kontroll, neste_brann_kontroll, brann_kontroll_intervall,
            el_type, brann_system, brann_driftstype,
            siste_kontroll, neste_kontroll, kontroll_intervall_mnd,
            organization_id, custom_data
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const genericSiste = siste_el_kontroll || null;
        const genericNeste = neste_el_kontroll || null;
        const genericIntervall = elIntervall || 36;

        const result = stmt.run(
          navn, adresse, postnummer, poststed, telefon, epost, lat, lng, notater, kategoriValue,
          siste_el_kontroll || null, neste_el_kontroll || null, elIntervall || 36,
          siste_brann_kontroll || null, neste_brann_kontroll || null, brannIntervall || 12,
          el_type || null, brann_system || null, brann_driftstype || null,
          genericSiste, genericNeste, genericIntervall,
          orgId, custom_data || '{}'
        );

        const kundeId = result.lastInsertRowid;

        // Also create entries in customer_services table (dynamic system)
        createCustomerServicesForKunde(kundeId, req.body);

        kunde = { id: kundeId, ...req.body };
        kunde.services = getCustomerServices(kundeId);
        res.json(kunde);
      }

      // Broadcast real-time update
      if (global.wsBroadcast) {
        global.wsBroadcast('kunde_created', kunde);
      }
    } catch (error) {
      console.error('Error creating kunde:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // PUT /api/kunder/:id - Oppdater kunde
  router.put('/:id', requireKlientAuth, async (req, res) => {
    try {
      const validationErrors = validateKunde(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ errors: validationErrors });
      }

      const orgId = req.organizationId;

      // Verify kunde belongs to this organization
      if (orgId) {
        const existing = useSupabase
          ? await supabaseService.getKundeByIdAndTenant(req.params.id, orgId)
          : db.prepare('SELECT id FROM kunder WHERE id = ? AND organization_id = ?').get(req.params.id, orgId);
        if (!existing) {
          return res.status(404).json({ error: 'Kunde ikke funnet' });
        }
      }

      let kunde;
      if (useSupabase) {
        kunde = await supabaseService.updateKunde(req.params.id, req.body);
        // TODO: Update customer_services in Supabase
        res.json(kunde);
      } else {
        const {
          navn, adresse, postnummer, poststed, telefon, epost, lat, lng, notater, kategori,
          siste_el_kontroll, neste_el_kontroll, el_kontroll_intervall,
          siste_brann_kontroll, neste_brann_kontroll, brann_kontroll_intervall,
          el_type, brann_system, brann_driftstype, custom_data
        } = req.body;

        const kategoriValue = safeString(kategori) || 'El-Kontroll';
        const elTypeValue = safeString(el_type);
        let elIntervall = el_kontroll_intervall;
        let brannIntervall = brann_kontroll_intervall;

        if (kategoriValue.includes('El-Kontroll')) {
          elIntervall = elIntervall || (elTypeValue === 'Bolig' ? 60 : elTypeValue === 'Næring' ? 12 : 36);
        }
        if (kategoriValue.includes('Brannvarsling')) {
          brannIntervall = brannIntervall || 12;
        }

        // Update kunder table (keeping legacy columns for backward compatibility)
        const stmt = db.prepare(`
          UPDATE kunder SET
            navn = ?, adresse = ?, postnummer = ?, poststed = ?, telefon = ?, epost = ?,
            lat = ?, lng = ?, notater = ?, kategori = ?,
            siste_el_kontroll = ?, neste_el_kontroll = ?, el_kontroll_intervall = ?,
            siste_brann_kontroll = ?, neste_brann_kontroll = ?, brann_kontroll_intervall = ?,
            el_type = ?, brann_system = ?, brann_driftstype = ?,
            siste_kontroll = ?, neste_kontroll = ?, kontroll_intervall_mnd = ?,
            custom_data = ?
          WHERE id = ?
        `);

        const genericSiste = siste_el_kontroll || null;
        const genericNeste = neste_el_kontroll || null;
        const genericIntervall = elIntervall || 36;

        stmt.run(
          navn, adresse, postnummer, poststed, telefon, epost, lat, lng, notater, kategoriValue,
          siste_el_kontroll || null, neste_el_kontroll || null, elIntervall || 36,
          siste_brann_kontroll || null, neste_brann_kontroll || null, brannIntervall || 12,
          el_type || null, brann_system || null, brann_driftstype || null,
          genericSiste, genericNeste, genericIntervall,
          custom_data || '{}',
          req.params.id
        );

        // Also update customer_services table (dynamic system)
        createCustomerServicesForKunde(req.params.id, req.body);

        kunde = { id: req.params.id, ...req.body };
        kunde.services = getCustomerServices(req.params.id);
        res.json(kunde);
      }

      // Broadcast real-time update
      if (global.wsBroadcast) {
        global.wsBroadcast('kunde_updated', kunde);
      }
    } catch (error) {
      console.error('Error updating kunde:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // DELETE /api/kunder/:id - Slett kunde
  router.delete('/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      // Verify kunde belongs to this organization
      if (orgId) {
        const existing = useSupabase
          ? await supabaseService.getKundeByIdAndTenant(req.params.id, orgId)
          : db.prepare('SELECT id FROM kunder WHERE id = ? AND organization_id = ?').get(req.params.id, orgId);
        if (!existing) {
          return res.status(404).json({ error: 'Kunde ikke funnet' });
        }
      }

      if (useSupabase) {
        await supabaseService.deleteKunde(req.params.id);
      } else {
        db.prepare('DELETE FROM kunder WHERE id = ?').run(req.params.id);
      }

      res.json({ success: true });

      // Broadcast real-time update
      if (global.wsBroadcast) {
        global.wsBroadcast('kunde_deleted', { id: req.params.id });
      }
    } catch (error) {
      console.error('Error deleting kunde:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // GET /api/kunder/:kundeId/kontaktlogg - Hent kontaktlogg
  router.get('/:kundeId/kontaktlogg', requireKlientAuth, async (req, res) => {
    try {
      if (useSupabase) {
        const logg = await supabaseService.getKontaktlogg(req.params.kundeId);
        res.json(logg);
      } else {
        const logg = db.prepare(`
          SELECT * FROM kontaktlogg
          WHERE kunde_id = ?
          ORDER BY dato DESC
        `).all(req.params.kundeId);
        res.json(logg);
      }
    } catch (error) {
      console.error('Error fetching kontaktlogg:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // POST /api/kunder/:kundeId/kontaktlogg - Legg til kontaktnotat
  router.post('/:kundeId/kontaktlogg', requireKlientAuth, async (req, res) => {
    try {
      const { type, notat } = req.body;
      const opprettet_av = req.klientSession?.epost || 'Ukjent';

      if (useSupabase) {
        const entry = await supabaseService.addKontaktlogg(req.params.kundeId, type, notat, opprettet_av);
        res.json(entry);
      } else {
        const stmt = db.prepare(`
          INSERT INTO kontaktlogg (kunde_id, type, notat, opprettet_av)
          VALUES (?, ?, ?, ?)
        `);
        const result = stmt.run(req.params.kundeId, type || 'Telefonsamtale', notat, opprettet_av);
        res.json({ id: result.lastInsertRowid, kunde_id: req.params.kundeId, type, notat, opprettet_av });
      }
    } catch (error) {
      console.error('Error adding kontaktlogg:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // POST /api/kunder/bulk-complete - Marker flere kunder som ferdige (DYNAMIC via customer_services)
  router.post('/bulk-complete', requireKlientAuth, async (req, res) => {
    try {
      // Support both legacy (completeEl/completeBrann) and dynamic (serviceTypeSlugs) formats
      const { customerIds, completeEl, completeBrann, completedDate, serviceTypeSlugs } = req.body;

      if (!customerIds || !Array.isArray(customerIds) || customerIds.length === 0) {
        return res.status(400).json({ error: 'Ingen kunder valgt' });
      }

      // Validate all customerIds are valid positive integers
      const validatedIds = customerIds.map(id => {
        const numId = Number(id);
        if (!Number.isInteger(numId) || numId <= 0) {
          return null;
        }
        return numId;
      }).filter(id => id !== null);

      if (validatedIds.length === 0) {
        return res.status(400).json({ error: 'Ugyldige kunde-IDer' });
      }

      if (validatedIds.length > 500) {
        return res.status(400).json({ error: 'Maks 500 kunder kan behandles samtidig' });
      }

      if (!completedDate) {
        return res.status(400).json({ error: 'Dato mangler' });
      }

      // Validate date format (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(completedDate)) {
        return res.status(400).json({ error: 'Ugyldig datoformat (bruk YYYY-MM-DD)' });
      }

      // Validate it's a real date
      const dateObj = new Date(completedDate);
      if (Number.isNaN(dateObj.getTime())) {
        return res.status(400).json({ error: 'Ugyldig dato' });
      }

      // Determine which service types to complete
      let slugsToComplete = serviceTypeSlugs || [];
      if (slugsToComplete.length === 0) {
        // Legacy format: convert completeEl/completeBrann to slugs
        if (completeEl) slugsToComplete.push('el-kontroll');
        if (completeBrann) slugsToComplete.push('brannvarsling');
      }

      if (slugsToComplete.length === 0) {
        return res.status(400).json({ error: 'Velg minst én kontrolltype' });
      }

      let updated = 0;
      const orgId = req.organizationId;

      if (useSupabase) {
        // TODO: Update Supabase implementation to use customer_services
        for (const customerId of validatedIds) {
          const customer = await supabaseService.getKundeById(customerId);
          if (!customer) continue;

          const hasEl = customer.kategori?.includes('El-Kontroll');
          const hasBrann = customer.kategori?.includes('Brannvarsling');

          const updateData = {};
          if (slugsToComplete.includes('el-kontroll') && hasEl) {
            const elIntervall = customer.el_kontroll_intervall || 36;
            updateData.siste_el_kontroll = completedDate;
            updateData.neste_el_kontroll = addMonthsToDate(completedDate, elIntervall);
            updateData.siste_kontroll = completedDate;
            updateData.neste_kontroll = updateData.neste_el_kontroll;
          }
          if (slugsToComplete.includes('brannvarsling') && hasBrann) {
            const brannIntervall = customer.brann_kontroll_intervall || 12;
            updateData.siste_brann_kontroll = completedDate;
            updateData.neste_brann_kontroll = addMonthsToDate(completedDate, brannIntervall);
          }

          if (Object.keys(updateData).length > 0) {
            await supabaseService.updateKunde(customerId, updateData);
            updated++;
          }
        }
      } else {
        // Get service type IDs for the slugs
        const serviceTypes = db.prepare('SELECT id, slug, default_interval_months FROM template_service_types WHERE slug IN (' + slugsToComplete.map(() => '?').join(',') + ')').all(...slugsToComplete);
        const serviceTypeMap = {};
        serviceTypes.forEach(st => { serviceTypeMap[st.slug] = st; });

        for (const customerId of validatedIds) {
          // Get existing services for this customer
          const customerServices = db.prepare(`
            SELECT cs.*, st.slug as service_type_slug, st.default_interval_months
            FROM customer_services cs
            JOIN template_service_types st ON cs.service_type_id = st.id
            WHERE cs.kunde_id = ? AND cs.aktiv = 1
          `).all(customerId);

          let customerUpdated = false;

          for (const slug of slugsToComplete) {
            const serviceType = serviceTypeMap[slug];
            if (!serviceType) continue;

            const existingService = customerServices.find(cs => cs.service_type_slug === slug);
            if (existingService) {
              // Update customer_services
              const intervall = existingService.intervall_months || serviceType.default_interval_months || 12;
              const nextDate = addMonthsToDate(completedDate, intervall);

              db.prepare(`
                UPDATE customer_services
                SET siste_kontroll = ?, neste_kontroll = ?
                WHERE kunde_id = ? AND service_type_id = ?
              `).run(completedDate, nextDate, customerId, serviceType.id);

              // Also update legacy columns for backward compatibility
              if (slug === 'el-kontroll') {
                db.prepare(`UPDATE kunder SET siste_el_kontroll=?, neste_el_kontroll=?, siste_kontroll=?, neste_kontroll=? WHERE id=?`)
                  .run(completedDate, nextDate, completedDate, nextDate, customerId);
              } else if (slug === 'brannvarsling') {
                db.prepare(`UPDATE kunder SET siste_brann_kontroll=?, neste_brann_kontroll=? WHERE id=?`)
                  .run(completedDate, nextDate, customerId);
              }

              customerUpdated = true;
            }
          }

          if (customerUpdated) {
            updated++;
          }
        }
      }

      res.json({ success: true, updated });

      if (global.wsBroadcast) {
        customerIds.forEach(id => {
          const updatedKunde = useSupabase ? null : db.prepare('SELECT * FROM kunder WHERE id = ?').get(id);
          if (updatedKunde) global.wsBroadcast('kunde_updated', updatedKunde, orgId);
        });
      }
    } catch (error) {
      console.error('Error in bulk-complete:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // POST /api/kunder/import - Bulk-import kunder
  router.post('/import', requireKlientAuth, async (req, res) => {
    try {
      const { kunder } = req.body;
      if (!kunder || !Array.isArray(kunder)) {
        return res.status(400).json({ error: 'Ugyldig data' });
      }

      const orgId = req.organizationId;
      let imported = 0;
      const errors = [];

      if (useSupabase) {
        for (let i = 0; i < kunder.length; i++) {
          try {
            const kundeData = { ...kunder[i], organization_id: orgId };
            await supabaseService.createKunde(kundeData);
            imported++;
          } catch (e) {
            errors.push({ index: i, navn: kunder[i].navn, error: e.message });
          }
        }
      } else {
        const stmt = db.prepare(`
          INSERT INTO kunder (navn, adresse, postnummer, poststed, telefon, epost, lat, lng, kategori, organization_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        kunder.forEach((kunde, index) => {
          try {
            const validationErrors = validateKunde(kunde);
            if (validationErrors.length > 0) {
              errors.push({ index, navn: kunde.navn, error: validationErrors.join(', ') });
              return;
            }
            stmt.run(kunde.navn, kunde.adresse, kunde.postnummer, kunde.poststed,
                     kunde.telefon, kunde.epost, kunde.lat, kunde.lng,
                     kunde.kategori || 'El-Kontroll', orgId);
            imported++;
          } catch (e) {
            errors.push({ index, navn: kunde.navn, error: e.message });
          }
        });
      }

      res.json({ imported, errors, total: kunder.length });
    } catch (error) {
      console.error('Error importing kunder:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // POST /api/kunder/import-excel - Import from Excel/CSV file with dynamic columns
  router.post('/import-excel', requireKlientAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Ingen fil lastet opp' });
      }

      const orgId = req.organizationId;

      // Parse Excel/CSV file
      let workbook;
      try {
        workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      } catch (parseError) {
        return res.status(400).json({ error: 'Kunne ikke lese filen. Sjekk at den er en gyldig Excel- eller CSV-fil.' });
      }

      // Validate workbook has at least one sheet
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        return res.status(400).json({ error: 'Filen inneholder ingen ark (sheets). Last opp en fil med data.' });
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      if (!worksheet) {
        return res.status(400).json({ error: 'Kunne ikke lese arket i filen. Prøv å lagre filen på nytt.' });
      }

      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (!jsonData || jsonData.length === 0) {
        return res.status(400).json({ error: 'Filen inneholder ingen data. Sjekk at det er data i første ark.' });
      }

      // Extract headers from first row
      const headers = Object.keys(jsonData[0]);

      // Analyze columns: known vs custom
      const knownColumns = [];
      const customColumns = [];

      headers.forEach(header => {
        const normalizedHeader = header.toLowerCase().trim();
        const mappedColumn = COLUMN_MAPPINGS[normalizedHeader];

        if (mappedColumn) {
          knownColumns.push({ original: header, mapped: mappedColumn });
        } else {
          // Create safe database column name
          const safeColumnName = 'custom_' + normalizedHeader
            .replace(/[^a-z0-9æøåÆØÅ]/gi, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .substring(0, 50)
            .toLowerCase();

          if (safeColumnName && safeColumnName !== 'custom_') {
            customColumns.push({
              original: header,
              dbColumn: safeColumnName,
              displayName: header,
              type: 'TEXT'
            });
          }
        }
      });

      // Add custom columns to database if needed
      const addedColumns = [];
      for (const col of customColumns) {
        try {
          // Validate column name before using in SQL
          if (!isValidIdentifier(col.dbColumn)) {
            console.warn(`Skipping invalid column name: ${col.dbColumn}`);
            continue;
          }
          const safeColumn = escapeIdentifier(col.dbColumn);

          if (useSupabase) {
            // For Supabase, we need to alter the table via SQL
            // Note: This requires appropriate permissions
            const { error } = await supabaseService.getClient()
              .rpc('exec_sql', {
                sql: `ALTER TABLE kunder ADD COLUMN IF NOT EXISTS ${safeColumn} TEXT`
              });
            if (error && !error.message.includes('already exists')) {
              console.warn(`Could not add column ${col.dbColumn}:`, error);
            }
          } else {
            // SQLite: ALTER TABLE ADD COLUMN
            try {
              db.exec(`ALTER TABLE kunder ADD COLUMN ${safeColumn} TEXT`);
              addedColumns.push(col.dbColumn);
            } catch (e) {
              // Column already exists - that's fine
              if (!e.message.includes('duplicate column')) {
                console.warn(`Could not add column ${col.dbColumn}:`, e.message);
              }
            }
          }

          // Track custom field in metadata table
          if (!useSupabase) {
            try {
              db.prepare(`
                INSERT OR IGNORE INTO custom_fields (organization_id, table_name, column_name, display_name, field_type)
                VALUES (?, 'kunder', ?, ?, 'TEXT')
              `).run(orgId, col.dbColumn, col.displayName);
            } catch (e) {
              // Table might not exist yet - that's okay
              console.warn('Could not track custom field:', e.message);
            }
          }
        } catch (e) {
          console.warn(`Error adding custom column ${col.dbColumn}:`, e.message);
        }
      }

      // Import data
      let imported = 0;
      const errors = [];

      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];

        try {
          // Build kunde data from row
          const kundeData = { organization_id: orgId };

          // Map known columns
          knownColumns.forEach(col => {
            if (row[col.original] !== undefined && row[col.original] !== null && row[col.original] !== '') {
              kundeData[col.mapped] = String(row[col.original]).trim();
            }
          });

          // Map custom columns
          customColumns.forEach(col => {
            if (row[col.original] !== undefined && row[col.original] !== null && row[col.original] !== '') {
              kundeData[col.dbColumn] = String(row[col.original]).trim();
            }
          });

          // Validate required fields
          if (!kundeData.navn) {
            errors.push({ index: i, row: i + 2, error: 'Mangler navn' });
            continue;
          }

          // Set default kategori if missing
          if (!kundeData.kategori) {
            kundeData.kategori = 'El-Kontroll';
          }

          // Parse lat/lng if present
          if (kundeData.lat) kundeData.lat = parseFloat(kundeData.lat) || null;
          if (kundeData.lng) kundeData.lng = parseFloat(kundeData.lng) || null;

          if (useSupabase) {
            await supabaseService.createKunde(kundeData);
          } else {
            // Build dynamic insert statement with validated columns
            const allColumns = Object.keys(kundeData);
            const validColumns = allColumns.filter(c => isAllowedColumn(c));

            if (validColumns.length !== allColumns.length) {
              const skipped = allColumns.filter(c => !validColumns.includes(c));
              console.warn('Skipped invalid columns:', skipped);
            }

            const safeColumns = validColumns.map(c => escapeIdentifier(c)).join(', ');
            const placeholders = validColumns.map(() => '?').join(', ');
            const values = validColumns.map(c => kundeData[c]);

            const insertSql = `INSERT INTO kunder (${safeColumns}) VALUES (${placeholders})`;
            db.prepare(insertSql).run(...values);
          }

          imported++;
        } catch (e) {
          const navn = row[knownColumns.find(c => c.mapped === 'navn')?.original] || `Rad ${i + 2}`;
          errors.push({ index: i, row: i + 2, navn, error: e.message });
        }
      }

      res.json({
        success: true,
        imported,
        errors,
        total: jsonData.length,
        columnsDetected: {
          known: knownColumns.map(c => ({ original: c.original, mapped: c.mapped })),
          custom: customColumns.map(c => ({ original: c.original, dbColumn: c.dbColumn }))
        },
        customColumnsAdded: addedColumns
      });
    } catch (error) {
      console.error('Excel import error:', error);
      res.status(500).json({ error: 'Feil ved import av Excel-fil: ' + error.message });
    }
  });

  // ============================================================================
  // ENHANCED IMPORT: Preview and Execute endpoints with fuzzy matching
  // ============================================================================

  // POST /api/kunder/import-excel/preview - Analyze file and return preview
  router.post('/import-excel/preview', requireKlientAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Ingen fil lastet opp' });
      }

      const orgId = req.organizationId;

      // Parse Excel/CSV file
      let workbook;
      try {
        workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
      } catch (parseError) {
        return res.status(400).json({ error: 'Kunne ikke lese filen. Sjekk at den er en gyldig Excel- eller CSV-fil.' });
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      if (jsonData.length === 0) {
        return res.status(400).json({ error: 'Filen inneholder ingen data' });
      }

      // Extract and analyze headers
      const headers = Object.keys(jsonData[0]);
      const columnAnalysis = headers.map(header => {
        const normalizedHeader = header.toLowerCase().trim();
        const mappedColumn = COLUMN_MAPPINGS[normalizedHeader];
        const sampleValues = jsonData
          .slice(0, 5)
          .map(row => row[header])
          .filter(v => v !== null && v !== undefined && v !== '')
          .slice(0, 3)
          .map(v => String(v).substring(0, 50));

        return {
          excelHeader: header,
          suggestedMapping: mappedColumn || null,
          confidence: mappedColumn ? 1 : 0,
          sampleValues
        };
      });

      // Get existing customers for duplicate detection
      let existingCustomers = [];
      if (useSupabase) {
        const { data } = await supabaseService.getClient()
          .from('kunder')
          .select('id, navn, adresse, postnummer, poststed, telefon, epost')
          .eq('organization_id', orgId);
        existingCustomers = data || [];
      } else {
        existingCustomers = db.prepare(`
          SELECT id, navn, adresse, postnummer, poststed, telefon, epost
          FROM kunder WHERE organization_id = ?
        `).all(orgId);
      }

      // Process each row: normalize, match categories, detect duplicates
      const processedRows = [];
      let validCount = 0;
      let warningCount = 0;
      let errorCount = 0;

      // Build column mapping from analysis
      const autoColumnMapping = {};
      columnAnalysis.forEach(col => {
        if (col.suggestedMapping) {
          autoColumnMapping[col.excelHeader] = col.suggestedMapping;
        }
      });

      // Find category column
      const categoryColumn = Object.entries(autoColumnMapping).find(([_, v]) => v === 'kategori')?.[0];

      for (let i = 0; i < jsonData.length; i++) {
        const row = jsonData[i];
        const issues = [];
        const suggestedFixes = {};

        // Map columns
        const mappedData = {};
        for (const [excelHeader, dbColumn] of Object.entries(autoColumnMapping)) {
          if (row[excelHeader] !== undefined && row[excelHeader] !== null) {
            mappedData[dbColumn] = row[excelHeader];
          }
        }

        // Normalize data
        const { normalized, modifications, warnings } = normalizeKunde(mappedData);

        // Add normalization warnings
        warnings.forEach(w => issues.push(`${w.field}: ${w.message}`));

        // Apply suggested fixes from modifications
        modifications.forEach(m => {
          if (m.to !== null) {
            suggestedFixes[m.field] = m.to;
          }
        });

        // Match category if present
        if (normalized.kategori) {
          const categoryMatch = matchCategory(normalized.kategori);
          if (categoryMatch.normalizedValue) {
            if (categoryMatch.matchType === 'fuzzy') {
              issues.push(`Kategori "${normalized.kategori}" tolket som "${categoryMatch.normalizedValue}" (${Math.round(categoryMatch.confidence * 100)}% sikker)`);
            }
            suggestedFixes.kategori = categoryMatch.normalizedValue;
            normalized.kategori = categoryMatch.normalizedValue;
          } else {
            issues.push(`Ukjent kategori: "${normalized.kategori}"`);
          }
        }

        // Match el_type if present
        if (normalized.el_type) {
          const elTypeMatch = matchElType(normalized.el_type);
          if (elTypeMatch.normalizedValue) {
            suggestedFixes.el_type = elTypeMatch.normalizedValue;
            normalized.el_type = elTypeMatch.normalizedValue;
          }
        }

        // Match brann_system if present
        if (normalized.brann_system) {
          const brannMatch = matchBrannSystem(normalized.brann_system);
          if (brannMatch.normalizedValue) {
            suggestedFixes.brann_system = brannMatch.normalizedValue;
            normalized.brann_system = brannMatch.normalizedValue;
          }
        }

        // Match driftstype if present
        if (normalized.brann_driftstype) {
          const driftMatch = matchDriftstype(normalized.brann_driftstype);
          if (driftMatch.normalizedValue) {
            suggestedFixes.brann_driftstype = driftMatch.normalizedValue;
            normalized.brann_driftstype = driftMatch.normalizedValue;
          }
        }

        // Check for duplicates in database
        const duplicateMatch = findDuplicateInDatabase(normalized, existingCustomers);

        // Determine row status
        let status = 'valid';
        if (!normalized.navn || String(normalized.navn).trim().length < 2) {
          status = 'error';
          issues.push('Mangler gyldig navn (minst 2 tegn)');
        } else if (!normalized.adresse || String(normalized.adresse).trim().length < 3) {
          status = 'error';
          issues.push('Mangler gyldig adresse (minst 3 tegn)');
        } else if (duplicateMatch) {
          status = 'duplicate';
          issues.push(`Oppdaterer eksisterende kunde: "${duplicateMatch.existingNavn}"`);
        } else if (issues.length > 0) {
          status = 'warning';
        }

        // Count by status
        if (status === 'error') errorCount++;
        else if (status === 'warning') warningCount++;
        else if (status === 'duplicate') warningCount++; // Duplicates count as warnings
        else validCount++;

        processedRows.push({
          rowNumber: i + 2, // Excel rows are 1-indexed, plus header row
          originalData: row,
          normalizedData: normalized,
          status,
          issues,
          suggestedFixes,
          duplicateOf: duplicateMatch ? {
            type: 'database',
            matchedId: duplicateMatch.existingId,
            matchedName: duplicateMatch.existingNavn,
            matchType: duplicateMatch.matchType
          } : null
        });
      }

      // Analyze categories
      const categoryAnalysis = categoryColumn ? analyzeCategories(jsonData, categoryColumn) : { detected: [], unknown: [] };

      // Analyze for dynamic schema (new fields and categories)
      let existingOrgFields = [];
      let existingOrgCategories = [];
      if (useSupabase) {
        const { data: fields } = await supabaseService.supabase
          .from('organization_fields')
          .select('*, options:organization_field_options(*)')
          .eq('organization_id', orgId);
        const { data: categories } = await supabaseService.supabase
          .from('organization_categories')
          .select('*')
          .eq('organization_id', orgId)
          .eq('aktiv', 1);
        existingOrgFields = fields || [];
        existingOrgCategories = categories || [];
      } else {
        try {
          existingOrgFields = db.prepare('SELECT * FROM organization_fields WHERE organization_id = ?').all(orgId);
          for (const field of existingOrgFields) {
            field.options = db.prepare('SELECT * FROM organization_field_options WHERE field_id = ?').all(field.id);
          }
          existingOrgCategories = db.prepare('SELECT * FROM organization_categories WHERE organization_id = ? AND aktiv = 1').all(orgId);
        } catch (dbError) {
          // Tables might not exist yet if migration hasn't run - this is expected
          console.log('Dynamic schema tables not found (migration may not have run yet):', dbError.message);
          existingOrgFields = [];
          existingOrgCategories = [];
        }
      }

      const dynamicSchemaAnalysis = analyzeExcelForDynamicSchema(jsonData, {
        fields: existingOrgFields,
        categories: existingOrgCategories
      });

      // Create session
      const sessionId = crypto.randomUUID();
      importSessions.set(sessionId, {
        createdAt: Date.now(),
        organizationId: orgId,
        fileName: req.file.originalname,
        processedRows,
        columnMapping: autoColumnMapping,
        existingCustomers
      });

      // Return preview (limit to first 100 rows for UI)
      res.json({
        sessionId,
        fileName: req.file.originalname,
        totalRows: jsonData.length,
        columns: {
          detected: columnAnalysis,
          unmapped: columnAnalysis.filter(c => !c.suggestedMapping).map(c => c.excelHeader)
        },
        analysis: {
          validRows: validCount,
          warningRows: warningCount,
          errorRows: errorCount,
          duplicatesInDatabase: processedRows.filter(r => r.duplicateOf?.type === 'database').length,
          toCreate: processedRows.filter(r => r.status !== 'error' && !r.duplicateOf).length,
          toUpdate: processedRows.filter(r => r.duplicateOf?.type === 'database').length
        },
        previewData: processedRows.slice(0, 100),
        categoryAnalysis,
        validCategories: getValidValues('kategori'),
        validElTypes: getValidValues('el_type'),
        validBrannSystems: getValidValues('brann_system'),
        // Dynamic schema suggestions
        dynamicSchema: {
          newCategories: dynamicSchemaAnalysis.newCategories,
          newFields: dynamicSchemaAnalysis.newFields,
          newFieldValues: dynamicSchemaAnalysis.newFieldValues,
          summary: dynamicSchemaAnalysis.summary,
          existingOrgCategories: existingOrgCategories.map(c => ({ id: c.id, name: c.name, slug: c.slug, icon: c.icon, color: c.color })),
          existingOrgFields: existingOrgFields.map(f => ({ id: f.id, field_name: f.field_name, display_name: f.display_name, field_type: f.field_type }))
        }
      });

    } catch (error) {
      console.error('Excel preview error:', error);
      res.status(500).json({ error: 'Feil ved analyse av Excel-fil: ' + error.message });
    }
  });

  // POST /api/kunder/import-excel/execute - Execute import with user-confirmed mappings
  router.post('/import-excel/execute', requireKlientAuth, async (req, res) => {
    try {
      const { sessionId, categoryMapping, geocodeAfterImport } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'Mangler sessionId' });
      }

      const session = importSessions.get(sessionId);
      if (!session) {
        return res.status(400).json({ error: 'Import-session utløpt eller ugyldig. Vennligst last opp filen på nytt.' });
      }

      if (session.organizationId !== req.organizationId) {
        return res.status(403).json({ error: 'Ingen tilgang til denne import-sessionen' });
      }

      const orgId = req.organizationId;
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors = [];

      // Re-fetch existing customers to handle changes since preview
      let currentExistingCustomers = [];
      if (useSupabase) {
        const { data } = await supabaseService.getClient()
          .from('kunder')
          .select('id, navn, adresse, postnummer, poststed, telefon, epost')
          .eq('organization_id', orgId);
        currentExistingCustomers = data || [];
      } else {
        currentExistingCustomers = db.prepare(`
          SELECT id, navn, adresse, postnummer, poststed, telefon, epost
          FROM kunder WHERE organization_id = ?
        `).all(orgId);
      }

      // Helper function to process a single row
      const processRow = async (row) => {
        // Skip error rows
        if (row.status === 'error') {
          return { action: 'skipped' };
        }

        // Apply suggested fixes and category mapping
        const kundeData = { ...row.normalizedData };

        // Apply category mapping for unknown values
        if (categoryMapping && kundeData.kategori && categoryMapping[kundeData.kategori]) {
          kundeData.kategori = categoryMapping[kundeData.kategori];
        }

        // Apply suggested fixes
        for (const [field, value] of Object.entries(row.suggestedFixes)) {
          kundeData[field] = value;
        }

        // Set default kategori if still missing
        if (!kundeData.kategori) {
          kundeData.kategori = 'El-Kontroll';
        }

        // Add organization_id
        kundeData.organization_id = orgId;

        // Re-check for duplicates against current database state
        // This handles cases where data changed between preview and execute
        const currentDuplicate = findDuplicateInDatabase(kundeData, currentExistingCustomers);

        // Check if this is an update or insert
        if (currentDuplicate) {
          // UPDATE existing customer (using fresh duplicate check)
          const existingId = currentDuplicate.existingId;

          if (useSupabase) {
            const { error } = await supabaseService.getClient()
              .from('kunder')
              .update(kundeData)
              .eq('id', existingId)
              .eq('organization_id', orgId);

            if (error) throw error;
          } else {
            // Build UPDATE statement
            const updateFields = Object.keys(kundeData)
              .filter(k => k !== 'organization_id' && isAllowedColumn(k))
              .map(k => `${escapeIdentifier(k)} = ?`);

            const updateValues = Object.keys(kundeData)
              .filter(k => k !== 'organization_id' && isAllowedColumn(k))
              .map(k => kundeData[k]);

            const updateSql = `UPDATE kunder SET ${updateFields.join(', ')} WHERE id = ? AND organization_id = ?`;
            db.prepare(updateSql).run(...updateValues, existingId, orgId);
          }

          return { action: 'updated' };
        } else {
          // INSERT new customer
          if (useSupabase) {
            await supabaseService.createKunde(kundeData);
          } else {
            const validColumns = Object.keys(kundeData).filter(c => isAllowedColumn(c));
            const safeColumns = validColumns.map(c => escapeIdentifier(c)).join(', ');
            const placeholders = validColumns.map(() => '?').join(', ');
            const values = validColumns.map(c => kundeData[c]);

            const insertSql = `INSERT INTO kunder (${safeColumns}) VALUES (${placeholders})`;
            db.prepare(insertSql).run(...values);
          }

          return { action: 'created' };
        }
      };

      // Process all rows - with transaction for SQLite
      if (useSupabase) {
        // Supabase: Process rows individually (Supabase handles transactions internally)
        for (const row of session.processedRows) {
          try {
            const result = await processRow(row);
            if (result.action === 'created') created++;
            else if (result.action === 'updated') updated++;
            else if (result.action === 'skipped') skipped++;
          } catch (e) {
            errors.push({
              row: row.rowNumber,
              navn: row.normalizedData?.navn || `Rad ${row.rowNumber}`,
              error: e.message
            });
          }
        }
      } else {
        // SQLite: Use transaction for atomicity
        const transaction = db.transaction(() => {
          for (const row of session.processedRows) {
            try {
              const result = processRow(row);
              if (result.action === 'created') created++;
              else if (result.action === 'updated') updated++;
              else if (result.action === 'skipped') skipped++;
            } catch (e) {
              errors.push({
                row: row.rowNumber,
                navn: row.normalizedData?.navn || `Rad ${row.rowNumber}`,
                error: e.message
              });
              // Continue processing other rows, don't abort entire transaction
            }
          }
        });

        try {
          transaction();
        } catch (transactionError) {
          // If transaction fails completely, return error
          console.error('Transaction failed:', transactionError);
          return res.status(500).json({
            error: 'Import feilet. Ingen data ble lagret.',
            details: transactionError.message
          });
        }
      }

      // Clean up session
      importSessions.delete(sessionId);

      // TODO: If geocodeAfterImport is true, queue geocoding job
      // For now, just note it in the response
      const geocodingNote = geocodeAfterImport
        ? 'Geokoding må kjøres manuelt via "Geokod alle" i innstillinger.'
        : null;

      res.json({
        success: true,
        created,
        updated,
        skipped,
        total: session.processedRows.length,
        errors,
        geocodingNote
      });

    } catch (error) {
      console.error('Excel execute error:', error);
      res.status(500).json({ error: 'Feil ved import: ' + error.message });
    }
  });

  // GET /api/kunder/custom-fields - Get custom fields for this organization
  router.get('/custom-fields', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      if (useSupabase) {
        // For Supabase, query the custom_fields table
        const { data, error } = await supabaseService.getClient()
          .from('custom_fields')
          .select('*')
          .eq('organization_id', orgId)
          .eq('table_name', 'kunder');

        if (error) throw error;
        res.json(data || []);
      } else {
        try {
          const fields = db.prepare(`
            SELECT * FROM custom_fields
            WHERE organization_id = ? AND table_name = 'kunder'
            ORDER BY created_at ASC
          `).all(orgId);
          res.json(fields);
        } catch (e) {
          // Table might not exist
          res.json([]);
        }
      }
    } catch (error) {
      console.error('Error fetching custom fields:', error);
      res.status(500).json({ error: 'Kunne ikke hente egendefinerte felt' });
    }
  });

  return router;
}

module.exports = createKunderRoutes;

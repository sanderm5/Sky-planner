const express = require('express');
const router = express.Router();
const { requireKlientAuth } = require('../middleware/auth');
const { validateRute } = require('../middleware/validation');

/**
 * Creates ruter (routes) API routes with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.db - SQLite database instance (null if using Supabase)
 * @param {Object} deps.supabaseService - Supabase service (null if using SQLite)
 * @param {boolean} deps.useSupabase - Whether to use Supabase
 */
function createRuterRoutes({ db, supabaseService, useSupabase }) {

  // GET /api/ruter - Hent alle ruter
  router.get('/', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      if (useSupabase) {
        const ruter = orgId
          ? await supabaseService.getRuterByTenant(orgId)
          : await supabaseService.getAllRuter();
        res.json(ruter);
      } else {
        const sql = orgId
          ? `SELECT r.*,
              (SELECT COUNT(*) FROM rute_kunder WHERE rute_id = r.id) as antall_kunder
             FROM ruter r
             WHERE r.organization_id = ?
             ORDER BY r.planlagt_dato DESC, r.opprettet DESC`
          : `SELECT r.*,
              (SELECT COUNT(*) FROM rute_kunder WHERE rute_id = r.id) as antall_kunder
             FROM ruter r
             ORDER BY r.planlagt_dato DESC, r.opprettet DESC`;
        const ruter = orgId
          ? db.prepare(sql).all(orgId)
          : db.prepare(sql).all();
        res.json(ruter);
      }
    } catch (error) {
      console.error('Error fetching ruter:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // GET /api/ruter/:id - Hent én rute med kunder
  router.get('/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      if (useSupabase) {
        const rute = await supabaseService.getRuteById(req.params.id);
        if (orgId && rute && rute.organization_id !== orgId) {
          return res.status(404).json({ error: 'Rute ikke funnet' });
        }
        res.json(rute);
      } else {
        const sql = orgId
          ? 'SELECT * FROM ruter WHERE id = ? AND organization_id = ?'
          : 'SELECT * FROM ruter WHERE id = ?';
        const rute = orgId
          ? db.prepare(sql).get(req.params.id, orgId)
          : db.prepare(sql).get(req.params.id);

        if (!rute) {
          return res.status(404).json({ error: 'Rute ikke funnet' });
        }

        const kunder = db.prepare(`
          SELECT k.*, rk.rekkefolge
          FROM rute_kunder rk
          JOIN kunder k ON k.id = rk.kunde_id
          WHERE rk.rute_id = ?
          ORDER BY rk.rekkefolge
        `).all(req.params.id);

        res.json({ ...rute, kunder });
      }
    } catch (error) {
      console.error('Error fetching rute:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // POST /api/ruter - Opprett ny rute
  router.post('/', requireKlientAuth, async (req, res) => {
    try {
      const validationErrors = validateRute(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ errors: validationErrors });
      }

      const orgId = req.organizationId;

      if (useSupabase) {
        const ruteData = { ...req.body, organization_id: orgId };
        const rute = await supabaseService.createRute(ruteData);
        res.json(rute);
      } else {
        const { navn, beskrivelse, planlagt_dato, total_distanse, total_tid, kunde_ids } = req.body;

        const insertRute = db.prepare(`
          INSERT INTO ruter (navn, beskrivelse, planlagt_dato, total_distanse, total_tid, organization_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        const result = insertRute.run(navn, beskrivelse, planlagt_dato, total_distanse, total_tid, orgId);
        const ruteId = result.lastInsertRowid;

        if (kunde_ids && Array.isArray(kunde_ids) && kunde_ids.length > 0) {
          const insertKunde = db.prepare(`
            INSERT INTO rute_kunder (rute_id, kunde_id, rekkefolge, organization_id) VALUES (?, ?, ?, ?)
          `);
          kunde_ids.forEach((kundeId, index) => {
            insertKunde.run(ruteId, kundeId, index + 1, orgId);
          });
        }

        res.json({ id: ruteId, ...req.body });
      }
    } catch (error) {
      console.error('Error creating rute:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // PUT /api/ruter/:id - Oppdater rute
  router.put('/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      // Verify rute belongs to this organization
      if (orgId && !useSupabase) {
        const existing = db.prepare('SELECT id FROM ruter WHERE id = ? AND organization_id = ?').get(req.params.id, orgId);
        if (!existing) {
          return res.status(404).json({ error: 'Rute ikke funnet' });
        }
      }

      if (useSupabase) {
        const rute = await supabaseService.updateRute(req.params.id, req.body);
        res.json(rute);
      } else {
        const { navn, beskrivelse, planlagt_dato, status, total_distanse, total_tid, kunde_ids } = req.body;

        const updateRute = db.prepare(`
          UPDATE ruter SET navn = ?, beskrivelse = ?, planlagt_dato = ?, status = ?, total_distanse = ?, total_tid = ?
          WHERE id = ?
        `);
        updateRute.run(navn, beskrivelse, planlagt_dato, status || 'planlagt', total_distanse, total_tid, req.params.id);

        if (kunde_ids && Array.isArray(kunde_ids)) {
          db.prepare('DELETE FROM rute_kunder WHERE rute_id = ?').run(req.params.id);

          const insertKunde = db.prepare(`
            INSERT INTO rute_kunder (rute_id, kunde_id, rekkefolge, organization_id) VALUES (?, ?, ?, ?)
          `);
          kunde_ids.forEach((kundeId, index) => {
            insertKunde.run(req.params.id, kundeId, index + 1, orgId);
          });
        }

        res.json({ id: req.params.id, ...req.body });
      }
    } catch (error) {
      console.error('Error updating rute:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // DELETE /api/ruter/:id - Slett rute
  router.delete('/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      // Verify rute belongs to this organization
      if (orgId && !useSupabase) {
        const existing = db.prepare('SELECT id FROM ruter WHERE id = ? AND organization_id = ?').get(req.params.id, orgId);
        if (!existing) {
          return res.status(404).json({ error: 'Rute ikke funnet' });
        }
      }

      if (useSupabase) {
        await supabaseService.deleteRute(req.params.id);
        res.json({ success: true });
      } else {
        db.prepare('DELETE FROM rute_kunder WHERE rute_id = ?').run(req.params.id);
        const sql = orgId
          ? 'DELETE FROM ruter WHERE id = ? AND organization_id = ?'
          : 'DELETE FROM ruter WHERE id = ?';
        orgId
          ? db.prepare(sql).run(req.params.id, orgId)
          : db.prepare(sql).run(req.params.id);
        res.json({ success: true });
      }
    } catch (error) {
      console.error('Error deleting rute:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // POST /api/ruter/:id/complete - Fullfør rute (oppdaterer kontroll-datoer)
  router.post('/:id/complete', requireKlientAuth, async (req, res) => {
    try {
      const ruteId = req.params.id;
      const dato = req.body.dato || new Date().toISOString().split('T')[0];
      const kontrollType = req.body.kontrollType || 'both';

      if (useSupabase) {
        const result = await supabaseService.completeRute(ruteId, dato);
        res.json(result);
      } else {
        const kunder = db.prepare(`
          SELECT k.id, k.kategori, k.el_kontroll_intervall, k.brann_kontroll_intervall,
                 k.kontroll_intervall_mnd FROM rute_kunder rk
          JOIN kunder k ON k.id = rk.kunde_id
          WHERE rk.rute_id = ?
        `).all(ruteId);

        const updateKundeNew = db.prepare(`
          UPDATE kunder SET
            siste_el_kontroll = CASE WHEN ? IN ('el', 'both') THEN ? ELSE siste_el_kontroll END,
            neste_el_kontroll = CASE WHEN ? IN ('el', 'both') THEN date(?, '+' || COALESCE(el_kontroll_intervall, 36) || ' months') ELSE neste_el_kontroll END,
            siste_brann_kontroll = CASE WHEN ? IN ('brann', 'both') THEN ? ELSE siste_brann_kontroll END,
            neste_brann_kontroll = CASE WHEN ? IN ('brann', 'both') THEN date(?, '+' || COALESCE(brann_kontroll_intervall, 12) || ' months') ELSE neste_brann_kontroll END,
            siste_kontroll = ?,
            neste_kontroll = date(?, '+' || COALESCE(kontroll_intervall_mnd, 12) || ' months')
          WHERE id = ?
        `);

        kunder.forEach(kunde => {
          updateKundeNew.run(
            kontrollType, dato,
            kontrollType, dato,
            kontrollType, dato,
            kontrollType, dato,
            dato,
            dato,
            kunde.id
          );
        });

        db.prepare('UPDATE ruter SET status = ? WHERE id = ?').run('fullført', ruteId);
        res.json({ success: true, oppdaterte_kunder: kunder.length });
      }
    } catch (error) {
      console.error('Error completing rute:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  return router;
}

module.exports = createRuterRoutes;

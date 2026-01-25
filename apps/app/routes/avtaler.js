const express = require('express');
const router = express.Router();
const { requireKlientAuth } = require('../middleware/auth');
const { validateAvtale } = require('../middleware/validation');

/**
 * Creates avtaler (appointments) API routes with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.db - SQLite database instance (null if using Supabase)
 * @param {Object} deps.supabaseService - Supabase service (null if using SQLite)
 * @param {boolean} deps.useSupabase - Whether to use Supabase
 */
function createAvtalerRoutes({ db, supabaseService, useSupabase }) {

  // GET /api/avtaler - Hent avtaler (med optional datofilter)
  router.get('/', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      if (useSupabase) {
        const { start, end } = req.query;
        let avtaler;
        if (orgId) {
          avtaler = await supabaseService.getAvtalerByTenant(orgId, start, end);
        } else if (start && end) {
          avtaler = await supabaseService.getAvtalerByDateRange(start, end);
        } else {
          avtaler = await supabaseService.getAllAvtaler();
        }
        res.json(avtaler);
      } else {
        const { start, end } = req.query;
        let sql = `
          SELECT a.*, k.navn as kunde_navn, k.adresse, k.postnummer, k.poststed, k.telefon, k.kategori
          FROM avtaler a
          LEFT JOIN kunder k ON a.kunde_id = k.id
        `;
        const params = [];

        if (orgId && start && end) {
          sql += ` WHERE a.organization_id = ? AND a.dato >= ? AND a.dato <= ?`;
          params.push(orgId, start, end);
        } else if (orgId) {
          sql += ` WHERE a.organization_id = ?`;
          params.push(orgId);
        } else if (start && end) {
          sql += ` WHERE a.dato >= ? AND a.dato <= ?`;
          params.push(start, end);
        }

        sql += ` ORDER BY a.dato, a.klokkeslett`;
        const avtaler = db.prepare(sql).all(...params);
        res.json(avtaler);
      }
    } catch (error) {
      console.error('Error fetching avtaler:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // GET /api/avtaler/:id - Hent én avtale
  router.get('/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      if (useSupabase) {
        const avtale = await supabaseService.getAvtaleById(req.params.id);
        if (!avtale || (orgId && avtale.organization_id !== orgId)) {
          return res.status(404).json({ error: 'Avtale ikke funnet' });
        }
        res.json(avtale);
      } else {
        const sql = orgId
          ? `SELECT a.*, k.navn as kunde_navn, k.adresse, k.postnummer, k.poststed, k.telefon, k.kategori
             FROM avtaler a
             LEFT JOIN kunder k ON a.kunde_id = k.id
             WHERE a.id = ? AND a.organization_id = ?`
          : `SELECT a.*, k.navn as kunde_navn, k.adresse, k.postnummer, k.poststed, k.telefon, k.kategori
             FROM avtaler a
             LEFT JOIN kunder k ON a.kunde_id = k.id
             WHERE a.id = ?`;
        const avtale = orgId
          ? db.prepare(sql).get(req.params.id, orgId)
          : db.prepare(sql).get(req.params.id);
        if (!avtale) {
          return res.status(404).json({ error: 'Avtale ikke funnet' });
        }
        res.json(avtale);
      }
    } catch (error) {
      console.error('Error fetching avtale:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // POST /api/avtaler - Opprett ny avtale
  router.post('/', requireKlientAuth, async (req, res) => {
    try {
      const validationErrors = validateAvtale(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ errors: validationErrors });
      }

      const orgId = req.organizationId;

      if (useSupabase) {
        const avtaleData = { ...req.body, organization_id: orgId };
        const avtale = await supabaseService.createAvtale(avtaleData);
        if (global.wsBroadcast) global.wsBroadcast('avtale_created', avtale);
        res.json(avtale);
      } else {
        const { kunde_id, dato, klokkeslett, type, beskrivelse, status, opprettet_av } = req.body;
        const result = db.prepare(`
          INSERT INTO avtaler (kunde_id, dato, klokkeslett, type, beskrivelse, status, opprettet_av, organization_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(kunde_id, dato, klokkeslett, type || 'El-Kontroll', beskrivelse, status || 'planlagt', opprettet_av, orgId);

        const avtale = db.prepare(`
          SELECT a.*, k.navn as kunde_navn, k.adresse, k.postnummer, k.poststed, k.telefon, k.kategori
          FROM avtaler a
          LEFT JOIN kunder k ON a.kunde_id = k.id
          WHERE a.id = ?
        `).get(result.lastInsertRowid);

        if (global.wsBroadcast) global.wsBroadcast('avtale_created', avtale);
        res.json(avtale);
      }
    } catch (error) {
      console.error('Error creating avtale:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // PUT /api/avtaler/:id - Oppdater avtale
  router.put('/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      // Verify avtale belongs to this organization
      if (orgId && !useSupabase) {
        const existing = db.prepare('SELECT id FROM avtaler WHERE id = ? AND organization_id = ?').get(req.params.id, orgId);
        if (!existing) {
          return res.status(404).json({ error: 'Avtale ikke funnet' });
        }
      }

      if (useSupabase) {
        const avtale = await supabaseService.updateAvtale(req.params.id, req.body);
        if (global.wsBroadcast) global.wsBroadcast('avtale_updated', avtale);
        res.json(avtale);
      } else {
        const { kunde_id, dato, klokkeslett, type, beskrivelse, status } = req.body;
        db.prepare(`
          UPDATE avtaler SET kunde_id = ?, dato = ?, klokkeslett = ?, type = ?, beskrivelse = ?, status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(kunde_id, dato, klokkeslett, type, beskrivelse, status, req.params.id);

        const avtale = db.prepare(`
          SELECT a.*, k.navn as kunde_navn, k.adresse, k.postnummer, k.poststed, k.telefon, k.kategori
          FROM avtaler a
          LEFT JOIN kunder k ON a.kunde_id = k.id
          WHERE a.id = ?
        `).get(req.params.id);

        if (global.wsBroadcast) global.wsBroadcast('avtale_updated', avtale);
        res.json(avtale);
      }
    } catch (error) {
      console.error('Error updating avtale:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // DELETE /api/avtaler/:id - Slett avtale
  router.delete('/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      // Verify avtale belongs to this organization
      if (orgId && !useSupabase) {
        const existing = db.prepare('SELECT id FROM avtaler WHERE id = ? AND organization_id = ?').get(req.params.id, orgId);
        if (!existing) {
          return res.status(404).json({ error: 'Avtale ikke funnet' });
        }
      }

      if (useSupabase) {
        await supabaseService.deleteAvtale(req.params.id);
      } else {
        const sql = orgId
          ? 'DELETE FROM avtaler WHERE id = ? AND organization_id = ?'
          : 'DELETE FROM avtaler WHERE id = ?';
        orgId
          ? db.prepare(sql).run(req.params.id, orgId)
          : db.prepare(sql).run(req.params.id);
      }
      if (global.wsBroadcast) global.wsBroadcast('avtale_deleted', { id: Number.parseInt(req.params.id) });
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting avtale:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // POST /api/avtaler/:id/complete - Fullfør avtale
  router.post('/:id/complete', requireKlientAuth, async (req, res) => {
    try {
      if (useSupabase) {
        await supabaseService.completeAvtale(req.params.id, req.body);
      } else {
        db.prepare(`UPDATE avtaler SET status = 'fullført', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(req.params.id);
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Error completing avtale:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  return router;
}

module.exports = createAvtalerRoutes;

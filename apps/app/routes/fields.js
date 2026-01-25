/**
 * Routes for managing organization-specific dynamic fields and categories
 *
 * These endpoints allow organizations to:
 * - Define custom fields that appear in customer forms
 * - Create dropdown options for select fields
 * - Manage dynamic categories (service types)
 */

const express = require('express');
const router = express.Router();
const { requireKlientAuth } = require('../middleware/auth');

/**
 * Creates fields routes with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.db - SQLite database instance (null if using Supabase)
 * @param {Object} deps.supabaseService - Supabase service (null if using SQLite)
 * @param {boolean} deps.useSupabase - Whether to use Supabase
 */
function createFieldsRoutes({ db, supabaseService, useSupabase }) {

  // ============================================
  // ORGANIZATION FIELDS
  // ============================================

  /**
   * GET /api/fields
   * Get all custom fields for the organization
   */
  router.get('/', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      let fields;
      if (useSupabase) {
        const { data, error } = await supabaseService.supabase
          .from('organization_fields')
          .select('*, options:organization_field_options(*)')
          .eq('organization_id', orgId)
          .order('sort_order', { ascending: true });

        if (error) throw error;
        fields = data;
      } else {
        fields = db.prepare(`
          SELECT * FROM organization_fields
          WHERE organization_id = ?
          ORDER BY sort_order ASC
        `).all(orgId);

        // Get options for each field
        for (const field of fields) {
          field.options = db.prepare(`
            SELECT * FROM organization_field_options
            WHERE field_id = ?
            ORDER BY sort_order ASC
          `).all(field.id);
        }
      }

      res.json(fields);
    } catch (error) {
      console.error('Error fetching organization fields:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  /**
   * POST /api/fields
   * Create a new custom field
   */
  router.post('/', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;
      const { field_name, display_name, field_type, is_filterable, is_required, is_visible, sort_order } = req.body;

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      if (!field_name || !display_name) {
        return res.status(400).json({ error: 'field_name and display_name are required' });
      }

      // Validate field_name format (snake_case, no special chars)
      const cleanFieldName = field_name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (cleanFieldName !== field_name) {
        return res.status(400).json({
          error: 'field_name must be lowercase with underscores only',
          suggestion: cleanFieldName
        });
      }

      let newField;
      if (useSupabase) {
        const { data, error } = await supabaseService.supabase
          .from('organization_fields')
          .insert({
            organization_id: orgId,
            field_name: cleanFieldName,
            display_name,
            field_type: field_type || 'text',
            is_filterable: is_filterable ? 1 : 0,
            is_required: is_required ? 1 : 0,
            is_visible: is_visible !== false ? 1 : 0,
            sort_order: sort_order || 0
          })
          .select()
          .single();

        if (error) throw error;
        newField = data;
      } else {
        const result = db.prepare(`
          INSERT INTO organization_fields
          (organization_id, field_name, display_name, field_type, is_filterable, is_required, is_visible, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          orgId,
          cleanFieldName,
          display_name,
          field_type || 'text',
          is_filterable ? 1 : 0,
          is_required ? 1 : 0,
          is_visible !== false ? 1 : 0,
          sort_order || 0
        );

        newField = db.prepare('SELECT * FROM organization_fields WHERE id = ?').get(result.lastInsertRowid);
      }

      res.status(201).json(newField);
    } catch (error) {
      console.error('Error creating organization field:', error);
      if (error.message?.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'Et felt med dette navnet finnes allerede' });
      }
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  /**
   * PUT /api/fields/:id
   * Update a custom field
   */
  router.put('/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;
      const fieldId = parseInt(req.params.id, 10);
      const { display_name, field_type, is_filterable, is_required, is_visible, sort_order } = req.body;

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      // Verify field belongs to organization
      let existing;
      if (useSupabase) {
        const { data } = await supabaseService.supabase
          .from('organization_fields')
          .select('id')
          .eq('id', fieldId)
          .eq('organization_id', orgId)
          .single();
        existing = data;
      } else {
        existing = db.prepare('SELECT id FROM organization_fields WHERE id = ? AND organization_id = ?')
          .get(fieldId, orgId);
      }

      if (!existing) {
        return res.status(404).json({ error: 'Felt ikke funnet' });
      }

      let updatedField;
      if (useSupabase) {
        const { data, error } = await supabaseService.supabase
          .from('organization_fields')
          .update({
            display_name,
            field_type,
            is_filterable: is_filterable ? 1 : 0,
            is_required: is_required ? 1 : 0,
            is_visible: is_visible !== false ? 1 : 0,
            sort_order
          })
          .eq('id', fieldId)
          .select()
          .single();

        if (error) throw error;
        updatedField = data;
      } else {
        db.prepare(`
          UPDATE organization_fields
          SET display_name = ?, field_type = ?, is_filterable = ?, is_required = ?, is_visible = ?, sort_order = ?
          WHERE id = ?
        `).run(
          display_name,
          field_type,
          is_filterable ? 1 : 0,
          is_required ? 1 : 0,
          is_visible !== false ? 1 : 0,
          sort_order,
          fieldId
        );

        updatedField = db.prepare('SELECT * FROM organization_fields WHERE id = ?').get(fieldId);
      }

      res.json(updatedField);
    } catch (error) {
      console.error('Error updating organization field:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  /**
   * DELETE /api/fields/:id
   * Delete a custom field and all its options
   */
  router.delete('/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;
      const fieldId = parseInt(req.params.id, 10);

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      // Verify field belongs to organization
      let existing;
      if (useSupabase) {
        const { data } = await supabaseService.supabase
          .from('organization_fields')
          .select('id')
          .eq('id', fieldId)
          .eq('organization_id', orgId)
          .single();
        existing = data;
      } else {
        existing = db.prepare('SELECT id FROM organization_fields WHERE id = ? AND organization_id = ?')
          .get(fieldId, orgId);
      }

      if (!existing) {
        return res.status(404).json({ error: 'Felt ikke funnet' });
      }

      if (useSupabase) {
        const { error } = await supabaseService.supabase
          .from('organization_fields')
          .delete()
          .eq('id', fieldId);

        if (error) throw error;
      } else {
        // Options will be deleted via CASCADE
        db.prepare('DELETE FROM organization_fields WHERE id = ?').run(fieldId);
      }

      res.json({ success: true, message: 'Felt slettet' });
    } catch (error) {
      console.error('Error deleting organization field:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // ============================================
  // FIELD OPTIONS (for select/dropdown fields)
  // ============================================

  /**
   * POST /api/fields/:id/options
   * Add an option to a select field
   */
  router.post('/:id/options', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;
      const fieldId = parseInt(req.params.id, 10);
      const { value, display_name, color, icon, sort_order } = req.body;

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      if (!value) {
        return res.status(400).json({ error: 'value is required' });
      }

      // Verify field belongs to organization and is a select type
      let field;
      if (useSupabase) {
        const { data } = await supabaseService.supabase
          .from('organization_fields')
          .select('id, field_type')
          .eq('id', fieldId)
          .eq('organization_id', orgId)
          .single();
        field = data;
      } else {
        field = db.prepare('SELECT id, field_type FROM organization_fields WHERE id = ? AND organization_id = ?')
          .get(fieldId, orgId);
      }

      if (!field) {
        return res.status(404).json({ error: 'Felt ikke funnet' });
      }

      if (field.field_type !== 'select') {
        return res.status(400).json({ error: 'Kan bare legge til valg på felt av typen "select"' });
      }

      let newOption;
      if (useSupabase) {
        const { data, error } = await supabaseService.supabase
          .from('organization_field_options')
          .insert({
            field_id: fieldId,
            value,
            display_name: display_name || value,
            color,
            icon,
            sort_order: sort_order || 0
          })
          .select()
          .single();

        if (error) throw error;
        newOption = data;
      } else {
        const result = db.prepare(`
          INSERT INTO organization_field_options
          (field_id, value, display_name, color, icon, sort_order)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(fieldId, value, display_name || value, color, icon, sort_order || 0);

        newOption = db.prepare('SELECT * FROM organization_field_options WHERE id = ?').get(result.lastInsertRowid);
      }

      res.status(201).json(newOption);
    } catch (error) {
      console.error('Error creating field option:', error);
      if (error.message?.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'Dette valget finnes allerede' });
      }
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  /**
   * DELETE /api/fields/:fieldId/options/:optionId
   * Delete an option from a select field
   */
  router.delete('/:fieldId/options/:optionId', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;
      const fieldId = parseInt(req.params.fieldId, 10);
      const optionId = parseInt(req.params.optionId, 10);

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      // Verify field belongs to organization
      let field;
      if (useSupabase) {
        const { data } = await supabaseService.supabase
          .from('organization_fields')
          .select('id')
          .eq('id', fieldId)
          .eq('organization_id', orgId)
          .single();
        field = data;
      } else {
        field = db.prepare('SELECT id FROM organization_fields WHERE id = ? AND organization_id = ?')
          .get(fieldId, orgId);
      }

      if (!field) {
        return res.status(404).json({ error: 'Felt ikke funnet' });
      }

      if (useSupabase) {
        const { error } = await supabaseService.supabase
          .from('organization_field_options')
          .delete()
          .eq('id', optionId)
          .eq('field_id', fieldId);

        if (error) throw error;
      } else {
        db.prepare('DELETE FROM organization_field_options WHERE id = ? AND field_id = ?')
          .run(optionId, fieldId);
      }

      res.json({ success: true, message: 'Valg slettet' });
    } catch (error) {
      console.error('Error deleting field option:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  // ============================================
  // ORGANIZATION CATEGORIES (dynamic service types)
  // ============================================

  /**
   * GET /api/fields/categories
   * Get all custom categories for the organization
   */
  router.get('/categories', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      let categories;
      if (useSupabase) {
        const { data, error } = await supabaseService.supabase
          .from('organization_categories')
          .select('*')
          .eq('organization_id', orgId)
          .eq('aktiv', 1)
          .order('sort_order', { ascending: true });

        if (error) throw error;
        categories = data;
      } else {
        categories = db.prepare(`
          SELECT * FROM organization_categories
          WHERE organization_id = ? AND aktiv = 1
          ORDER BY sort_order ASC
        `).all(orgId);
      }

      res.json(categories);
    } catch (error) {
      console.error('Error fetching organization categories:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  /**
   * POST /api/fields/categories
   * Create a new category
   */
  router.post('/categories', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;
      const { name, icon, color, default_interval_months, sort_order } = req.body;

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      if (!name) {
        return res.status(400).json({ error: 'name is required' });
      }

      // Generate slug from name
      const slug = name.toLowerCase()
        .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      let newCategory;
      if (useSupabase) {
        const { data, error } = await supabaseService.supabase
          .from('organization_categories')
          .insert({
            organization_id: orgId,
            name,
            slug,
            icon: icon || 'fa-tag',
            color: color || '#6B7280',
            default_interval_months: default_interval_months || 12,
            sort_order: sort_order || 0
          })
          .select()
          .single();

        if (error) throw error;
        newCategory = data;
      } else {
        const result = db.prepare(`
          INSERT INTO organization_categories
          (organization_id, name, slug, icon, color, default_interval_months, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          orgId,
          name,
          slug,
          icon || 'fa-tag',
          color || '#6B7280',
          default_interval_months || 12,
          sort_order || 0
        );

        newCategory = db.prepare('SELECT * FROM organization_categories WHERE id = ?').get(result.lastInsertRowid);
      }

      res.status(201).json(newCategory);
    } catch (error) {
      console.error('Error creating organization category:', error);
      if (error.message?.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'En kategori med dette navnet finnes allerede' });
      }
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  /**
   * PUT /api/fields/categories/:id
   * Update a category
   */
  router.put('/categories/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;
      const categoryId = parseInt(req.params.id, 10);
      const { name, icon, color, default_interval_months, sort_order, aktiv } = req.body;

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      // Verify category belongs to organization
      let existing;
      if (useSupabase) {
        const { data } = await supabaseService.supabase
          .from('organization_categories')
          .select('id')
          .eq('id', categoryId)
          .eq('organization_id', orgId)
          .single();
        existing = data;
      } else {
        existing = db.prepare('SELECT id FROM organization_categories WHERE id = ? AND organization_id = ?')
          .get(categoryId, orgId);
      }

      if (!existing) {
        return res.status(404).json({ error: 'Kategori ikke funnet' });
      }

      let updatedCategory;
      if (useSupabase) {
        const { data, error } = await supabaseService.supabase
          .from('organization_categories')
          .update({
            name,
            icon,
            color,
            default_interval_months,
            sort_order,
            aktiv: aktiv !== false ? 1 : 0
          })
          .eq('id', categoryId)
          .select()
          .single();

        if (error) throw error;
        updatedCategory = data;
      } else {
        db.prepare(`
          UPDATE organization_categories
          SET name = ?, icon = ?, color = ?, default_interval_months = ?, sort_order = ?, aktiv = ?
          WHERE id = ?
        `).run(
          name,
          icon,
          color,
          default_interval_months,
          sort_order,
          aktiv !== false ? 1 : 0,
          categoryId
        );

        updatedCategory = db.prepare('SELECT * FROM organization_categories WHERE id = ?').get(categoryId);
      }

      res.json(updatedCategory);
    } catch (error) {
      console.error('Error updating organization category:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  /**
   * DELETE /api/fields/categories/:id
   * Delete a category (soft delete by setting aktiv = 0)
   */
  router.delete('/categories/:id', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;
      const categoryId = parseInt(req.params.id, 10);

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      // Verify category belongs to organization
      let existing;
      if (useSupabase) {
        const { data } = await supabaseService.supabase
          .from('organization_categories')
          .select('id')
          .eq('id', categoryId)
          .eq('organization_id', orgId)
          .single();
        existing = data;
      } else {
        existing = db.prepare('SELECT id FROM organization_categories WHERE id = ? AND organization_id = ?')
          .get(categoryId, orgId);
      }

      if (!existing) {
        return res.status(404).json({ error: 'Kategori ikke funnet' });
      }

      // Soft delete
      if (useSupabase) {
        const { error } = await supabaseService.supabase
          .from('organization_categories')
          .update({ aktiv: 0 })
          .eq('id', categoryId);

        if (error) throw error;
      } else {
        db.prepare('UPDATE organization_categories SET aktiv = 0 WHERE id = ?').run(categoryId);
      }

      res.json({ success: true, message: 'Kategori deaktivert' });
    } catch (error) {
      console.error('Error deleting organization category:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  /**
   * POST /api/fields/categories/bulk
   * Create multiple categories at once (used during import)
   */
  router.post('/categories/bulk', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;
      const { categories } = req.body;

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      if (!Array.isArray(categories) || categories.length === 0) {
        return res.status(400).json({ error: 'categories array is required' });
      }

      const created = [];
      const skipped = [];

      for (const cat of categories) {
        if (!cat.name) {
          skipped.push({ name: cat.name, reason: 'name is required' });
          continue;
        }

        const slug = cat.name.toLowerCase()
          .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');

        try {
          if (useSupabase) {
            const { data, error } = await supabaseService.supabase
              .from('organization_categories')
              .insert({
                organization_id: orgId,
                name: cat.name,
                slug,
                icon: cat.icon || 'fa-tag',
                color: cat.color || '#6B7280',
                default_interval_months: cat.default_interval_months || 12,
                sort_order: cat.sort_order || 0
              })
              .select()
              .single();

            if (error) throw error;
            created.push(data);
          } else {
            const result = db.prepare(`
              INSERT INTO organization_categories
              (organization_id, name, slug, icon, color, default_interval_months, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              orgId,
              cat.name,
              slug,
              cat.icon || 'fa-tag',
              cat.color || '#6B7280',
              cat.default_interval_months || 12,
              cat.sort_order || 0
            );

            const newCat = db.prepare('SELECT * FROM organization_categories WHERE id = ?').get(result.lastInsertRowid);
            created.push(newCat);
          }
        } catch (e) {
          if (e.message?.includes('UNIQUE constraint')) {
            skipped.push({ name: cat.name, reason: 'already exists' });
          } else {
            skipped.push({ name: cat.name, reason: e.message });
          }
        }
      }

      res.status(201).json({
        created,
        skipped,
        summary: `${created.length} opprettet, ${skipped.length} hoppet over`
      });
    } catch (error) {
      console.error('Error bulk creating categories:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  /**
   * POST /api/fields/bulk
   * Create multiple fields at once (used during import)
   */
  router.post('/bulk', requireKlientAuth, async (req, res) => {
    try {
      const orgId = req.organizationId;
      const { fields } = req.body;

      if (!orgId) {
        return res.status(400).json({ error: 'Organization ID required' });
      }

      if (!Array.isArray(fields) || fields.length === 0) {
        return res.status(400).json({ error: 'fields array is required' });
      }

      const created = [];
      const skipped = [];

      for (const field of fields) {
        if (!field.field_name || !field.display_name) {
          skipped.push({ field_name: field.field_name, reason: 'field_name and display_name are required' });
          continue;
        }

        const cleanFieldName = field.field_name.toLowerCase().replace(/[^a-z0-9_]/g, '_');

        try {
          let newField;
          if (useSupabase) {
            const { data, error } = await supabaseService.supabase
              .from('organization_fields')
              .insert({
                organization_id: orgId,
                field_name: cleanFieldName,
                display_name: field.display_name,
                field_type: field.field_type || 'text',
                is_filterable: field.is_filterable ? 1 : 0,
                is_required: field.is_required ? 1 : 0,
                is_visible: field.is_visible !== false ? 1 : 0,
                sort_order: field.sort_order || 0
              })
              .select()
              .single();

            if (error) throw error;
            newField = data;
          } else {
            const result = db.prepare(`
              INSERT INTO organization_fields
              (organization_id, field_name, display_name, field_type, is_filterable, is_required, is_visible, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              orgId,
              cleanFieldName,
              field.display_name,
              field.field_type || 'text',
              field.is_filterable ? 1 : 0,
              field.is_required ? 1 : 0,
              field.is_visible !== false ? 1 : 0,
              field.sort_order || 0
            );

            newField = db.prepare('SELECT * FROM organization_fields WHERE id = ?').get(result.lastInsertRowid);
          }

          // If field has options, create them too
          if (field.options && Array.isArray(field.options) && newField) {
            for (const opt of field.options) {
              try {
                if (useSupabase) {
                  await supabaseService.supabase
                    .from('organization_field_options')
                    .insert({
                      field_id: newField.id,
                      value: opt.value || opt,
                      display_name: opt.display_name || opt.value || opt
                    });
                } else {
                  db.prepare(`
                    INSERT INTO organization_field_options (field_id, value, display_name)
                    VALUES (?, ?, ?)
                  `).run(newField.id, opt.value || opt, opt.display_name || opt.value || opt);
                }
              } catch (optError) {
                // Ignore duplicate options
              }
            }
          }

          created.push(newField);
        } catch (e) {
          if (e.message?.includes('UNIQUE constraint')) {
            skipped.push({ field_name: field.field_name, reason: 'already exists' });
          } else {
            skipped.push({ field_name: field.field_name, reason: e.message });
          }
        }
      }

      res.status(201).json({
        created,
        skipped,
        summary: `${created.length} opprettet, ${skipped.length} hoppet over`
      });
    } catch (error) {
      console.error('Error bulk creating fields:', error);
      res.status(500).json({ error: 'En feil oppstod. Prøv igjen senere.' });
    }
  });

  return router;
}

module.exports = createFieldsRoutes;

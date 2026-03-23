/**
 * Organization custom fields routes
 * CRUD for dynamic fields per organization (organization_fields + organization_field_options)
 */

import { Router, Response } from 'express';
import { requireTenantAuth, requireRole } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { getDatabase } from '../services/database';
import type { AuthenticatedRequest } from '../types';

const router: Router = Router();

async function getSupabase() {
  const db = await getDatabase();
  return (db as any).supabase.getClient();
}

/**
 * GET /api/fields
 * List all custom fields (with options) for current organization
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const supabase = await getSupabase();

    const { data: fields, error } = await supabase
      .from('organization_fields')
      .select('*')
      .eq('organization_id', req.organizationId!)
      .order('sort_order', { ascending: true });

    if (error) throw Errors.internal(error.message);

    // Load options for select-type fields
    const selectFields = (fields || []).filter((f: any) => f.field_type === 'select');
    if (selectFields.length > 0) {
      const fieldIds = selectFields.map((f: any) => f.id);
      const { data: options } = await supabase
        .from('organization_field_options')
        .select('*')
        .in('field_id', fieldIds)
        .order('sort_order', { ascending: true });

      const optionsByField = (options || []).reduce((acc: Record<number, any[]>, opt: any) => {
        if (!acc[opt.field_id]) acc[opt.field_id] = [];
        acc[opt.field_id].push(opt);
        return acc;
      }, {});

      for (const field of fields || []) {
        (field as any).options = optionsByField[field.id] || [];
      }
    } else {
      for (const field of fields || []) {
        (field as any).options = [];
      }
    }

    res.json(fields || []);
  })
);

/**
 * POST /api/fields
 * Create a new custom field (admin only)
 */
router.post(
  '/',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { field_name, display_name, field_type, is_filterable, is_required, is_visible } = req.body;

    if (!field_name || !display_name) {
      throw Errors.badRequest('field_name og display_name er påkrevd');
    }

    const supabase = await getSupabase();

    // Determine next sort_order
    const { data: existing } = await supabase
      .from('organization_fields')
      .select('sort_order')
      .eq('organization_id', req.organizationId!)
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextSort = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

    const { data, error } = await supabase
      .from('organization_fields')
      .insert({
        organization_id: req.organizationId!,
        field_name: field_name.trim(),
        display_name: display_name.trim(),
        field_type: field_type || 'text',
        is_filterable: is_filterable ? 1 : 0,
        is_required: is_required ? 1 : 0,
        is_visible: is_visible !== undefined ? (is_visible ? 1 : 0) : 1,
        sort_order: nextSort,
      })
      .select()
      .single();

    if (error) {
      if (error.message.includes('unique') || error.message.includes('duplicate')) {
        throw Errors.badRequest('Et felt med dette navnet finnes allerede');
      }
      throw Errors.internal(error.message);
    }

    res.status(201).json(data);
  })
);

/**
 * POST /api/fields/bulk
 * Bulk create fields (used by Excel import)
 */
router.post(
  '/bulk',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { fields } = req.body;

    if (!Array.isArray(fields) || fields.length === 0) {
      throw Errors.badRequest('fields array er påkrevd');
    }

    const db = await getDatabase();
    const result = await db.createOrganizationFieldsBulk(req.organizationId!, fields);

    res.status(201).json(result);
  })
);

/**
 * PUT /api/fields/:id
 * Update a custom field (admin only)
 */
router.put(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw Errors.badRequest('Ugyldig ID');

    const { field_name, display_name, field_type, is_filterable, is_required, is_visible, sort_order } = req.body;

    const updateData: Record<string, unknown> = {};
    if (field_name !== undefined) updateData.field_name = field_name.trim();
    if (display_name !== undefined) updateData.display_name = display_name.trim();
    if (field_type !== undefined) updateData.field_type = field_type;
    if (is_filterable !== undefined) updateData.is_filterable = is_filterable ? 1 : 0;
    if (is_required !== undefined) updateData.is_required = is_required ? 1 : 0;
    if (is_visible !== undefined) updateData.is_visible = is_visible ? 1 : 0;
    if (sort_order !== undefined) updateData.sort_order = sort_order;

    if (Object.keys(updateData).length === 0) {
      throw Errors.badRequest('Ingen felter å oppdatere');
    }

    const supabase = await getSupabase();

    const { data, error } = await supabase
      .from('organization_fields')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', req.organizationId!)
      .select()
      .single();

    if (error) throw Errors.internal(error.message);
    if (!data) throw Errors.notFound('Felt ikke funnet');

    res.json(data);
  })
);

/**
 * DELETE /api/fields/:id
 * Delete a custom field (admin only)
 */
router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw Errors.badRequest('Ugyldig ID');

    const supabase = await getSupabase();

    const { error } = await supabase
      .from('organization_fields')
      .delete()
      .eq('id', id)
      .eq('organization_id', req.organizationId!);

    if (error) throw Errors.internal(error.message);

    res.json({ success: true });
  })
);

/**
 * POST /api/fields/:id/options
 * Add an option to a select-type field
 */
router.post(
  '/:id/options',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const fieldId = parseInt(req.params.id, 10);
    if (isNaN(fieldId)) throw Errors.badRequest('Ugyldig ID');

    const { value, display_name, color, icon, sort_order } = req.body;
    if (!value) throw Errors.badRequest('value er påkrevd');

    const supabase = await getSupabase();

    // Verify field belongs to this organization
    const { data: field } = await supabase
      .from('organization_fields')
      .select('id')
      .eq('id', fieldId)
      .eq('organization_id', req.organizationId!)
      .single();

    if (!field) throw Errors.notFound('Felt ikke funnet');

    const { data, error } = await supabase
      .from('organization_field_options')
      .insert({
        field_id: fieldId,
        value: value.trim(),
        display_name: display_name?.trim() || value.trim(),
        color: color || null,
        icon: icon || null,
        sort_order: sort_order || 0,
      })
      .select()
      .single();

    if (error) throw Errors.internal(error.message);

    res.status(201).json(data);
  })
);

/**
 * DELETE /api/fields/:id/options/:optionId
 * Delete a field option
 */
router.delete(
  '/:id/options/:optionId',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const fieldId = parseInt(req.params.id, 10);
    const optionId = parseInt(req.params.optionId, 10);
    if (isNaN(fieldId) || isNaN(optionId)) throw Errors.badRequest('Ugyldig ID');

    const supabase = await getSupabase();

    // Verify field belongs to this organization
    const { data: field } = await supabase
      .from('organization_fields')
      .select('id')
      .eq('id', fieldId)
      .eq('organization_id', req.organizationId!)
      .single();

    if (!field) throw Errors.notFound('Felt ikke funnet');

    const { error } = await supabase
      .from('organization_field_options')
      .delete()
      .eq('id', optionId)
      .eq('field_id', fieldId);

    if (error) throw Errors.internal(error.message);

    res.json({ success: true });
  })
);

export default router;

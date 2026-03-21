/**
 * Organization setup database queries.
 * Handles team members, onboarding, subcategories, coverage areas, and kontaktpersoner.
 */

import { dbLogger } from '../logger';
import type { DatabaseContext, KlientRecord } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============ TEAM MEMBER METHODS ============

export async function countOrganizationUsers(ctx: DatabaseContext, organizationId: number): Promise<number> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { count, error } = await supabase
      .from('klient')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('aktiv', true);
    if (error) throw new Error(`Failed to count users: ${error.message}`);
    return count || 0;
  }

  if (!ctx.sqlite) return 0;

  const result = ctx.sqlite.prepare(`
    SELECT COUNT(*) as count FROM klient
    WHERE organization_id = ? AND aktiv = 1
  `).get(organizationId) as { count: number };

  return result?.count || 0;
}

export async function getOrganizationUserLimits(
  ctx: DatabaseContext,
  organizationId: number,
  getOrganizationById: (id: number) => Promise<any>
): Promise<{ max_brukere: number; current_count: number } | null> {
  const org = await getOrganizationById(organizationId);
  if (!org) return null;

  const currentCount = await countOrganizationUsers(ctx, organizationId);

  return {
    max_brukere: org.max_brukere || 5,
    current_count: currentCount,
  };
}

export async function getTeamMembers(ctx: DatabaseContext, organizationId: number): Promise<KlientRecord[]> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('klient')
      .select('id, navn, epost, telefon, rolle, aktiv, sist_innlogget, opprettet')
      .eq('organization_id', organizationId)
      .order('navn', { ascending: true });
    if (error) throw new Error(`Failed to fetch team members: ${error.message}`);
    return (data || []) as KlientRecord[];
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  return ctx.sqlite.prepare(`
    SELECT id, navn, epost, telefon, rolle, aktiv, sist_innlogget, opprettet
    FROM klient
    WHERE organization_id = ?
    ORDER BY navn COLLATE NOCASE
  `).all(organizationId) as KlientRecord[];
}

export async function createTeamMember(ctx: DatabaseContext, data: {
  navn: string;
  epost: string;
  passord_hash: string;
  telefon?: string;
  rolle?: string;
  organization_id: number;
}): Promise<KlientRecord> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data: member, error } = await supabase
      .from('klient')
      .insert({
        navn: data.navn,
        epost: data.epost,
        passord_hash: data.passord_hash,
        telefon: data.telefon || null,
        rolle: data.rolle || 'leser',
        organization_id: data.organization_id,
        aktiv: true,
      })
      .select('id, navn, epost, telefon, rolle, aktiv, sist_innlogget, opprettet')
      .single();
    if (error) throw new Error(`Failed to create team member: ${error.message}`);
    return member as KlientRecord;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const stmt = ctx.sqlite.prepare(`
    INSERT INTO klient (navn, epost, passord_hash, telefon, rolle, organization_id, aktiv)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);

  const result = stmt.run(
    data.navn,
    data.epost,
    data.passord_hash,
    data.telefon || null,
    data.rolle || 'leser',
    data.organization_id
  );

  const member = ctx.sqlite.prepare('SELECT * FROM klient WHERE id = ?').get(result.lastInsertRowid);
  return member as KlientRecord;
}

export async function updateTeamMember(
  ctx: DatabaseContext,
  id: number,
  organizationId: number,
  data: { navn?: string; telefon?: string; rolle?: string; aktiv?: boolean }
): Promise<KlientRecord | null> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const updateData: Record<string, unknown> = {};
    if (data.navn !== undefined) updateData.navn = data.navn;
    if (data.telefon !== undefined) updateData.telefon = data.telefon;
    if (data.rolle !== undefined) updateData.rolle = data.rolle;
    if (data.aktiv !== undefined) updateData.aktiv = data.aktiv;

    if (Object.keys(updateData).length === 0) {
      const { data: existing } = await supabase
        .from('klient')
        .select('id, navn, epost, telefon, rolle, aktiv, sist_innlogget, opprettet')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .single();
      return (existing as KlientRecord) || null;
    }

    const { data: member, error } = await supabase
      .from('klient')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select('id, navn, epost, telefon, rolle, aktiv, sist_innlogget, opprettet')
      .single();
    if (error) throw new Error(`Failed to update team member: ${error.message}`);
    return (member as KlientRecord) || null;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Verify member belongs to organization
  const existing = ctx.sqlite.prepare(`
    SELECT * FROM klient WHERE id = ? AND organization_id = ?
  `).get(id, organizationId) as KlientRecord | undefined;

  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.navn !== undefined) {
    fields.push('navn = ?');
    values.push(data.navn);
  }
  if (data.telefon !== undefined) {
    fields.push('telefon = ?');
    values.push(data.telefon);
  }
  if (data.rolle !== undefined) {
    fields.push('rolle = ?');
    values.push(data.rolle);
  }
  if (data.aktiv !== undefined) {
    fields.push('aktiv = ?');
    values.push(data.aktiv ? 1 : 0);
  }

  if (fields.length === 0) return existing;

  values.push(id, organizationId);
  ctx.sqlite.prepare(`
    UPDATE klient SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?
  `).run(...values);

  return ctx.sqlite.prepare('SELECT * FROM klient WHERE id = ?').get(id) as KlientRecord;
}

export async function deleteTeamMember(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { error, count } = await supabase
      .from('klient')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('organization_id', organizationId);
    if (error) throw new Error(`Failed to delete team member: ${error.message}`);
    return (count ?? 0) > 0;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite.prepare(`
    DELETE FROM klient WHERE id = ? AND organization_id = ?
  `).run(id, organizationId);

  return result.changes > 0;
}

export async function getTeamMemberByEpost(ctx: DatabaseContext, epost: string, organizationId: number): Promise<KlientRecord | null> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('klient')
      .select('id, navn, epost, telefon, rolle, aktiv, sist_innlogget, opprettet')
      .ilike('epost', epost)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw new Error(`Failed to find team member by email: ${error.message}`);
    return (data as KlientRecord) || null;
  }

  if (!ctx.sqlite) return null;

  const result = ctx.sqlite.prepare(`
    SELECT * FROM klient WHERE LOWER(epost) = LOWER(?) AND organization_id = ?
  `).get(epost, organizationId);

  return (result as KlientRecord) || null;
}

// ============ ORGANIZATION FIELDS METHODS ============

/**
 * Create multiple organization fields in bulk
 * Used during Excel import to create custom fields automatically
 */
export async function createOrganizationFieldsBulk(
  ctx: DatabaseContext,
  organizationId: number,
  fields: Array<{
    field_name: string;
    display_name: string;
    field_type: string;
    is_filterable: boolean;
    is_visible: boolean;
    options?: string[];
  }>
): Promise<{ created: number; fieldIds: number[] }> {
  if (ctx.type === 'supabase') {
    // Supabase implementation
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      const fieldIds: number[] = [];
      let created = 0;

      for (const field of fields) {
        // Insert field (upsert to avoid duplicates)
        const { data: fieldData, error: fieldError } = await supabase
          .from('organization_fields')
          .upsert({
            organization_id: organizationId,
            field_name: field.field_name,
            display_name: field.display_name,
            field_type: field.field_type,
            is_filterable: field.is_filterable ? 1 : 0,
            is_visible: field.is_visible ? 1 : 0,
            sort_order: 0
          }, { onConflict: 'organization_id,field_name' })
          .select('id')
          .single();

        if (fieldError) {
          dbLogger.warn({ error: fieldError, field: field.field_name }, 'Failed to create organization field');
          continue;
        }

        if (fieldData) {
          fieldIds.push(fieldData.id);
          created++;

          // Create options for select fields
          if (field.field_type === 'select' && field.options && field.options.length > 0) {
            const optionsToInsert = field.options.map((value, index) => ({
              field_id: fieldData.id,
              value: value,
              display_name: value,
              sort_order: index
            }));

            await supabase
              .from('organization_field_options')
              .upsert(optionsToInsert, { onConflict: 'field_id,value' });
          }
        }
      }

      return { created, fieldIds };
    } catch (error) {
      dbLogger.error({ error }, 'Failed to create organization fields in Supabase');
      return { created: 0, fieldIds: [] };
    }
  }

  // SQLite implementation
  if (!ctx.sqlite) throw new Error('Database not initialized');

  const fieldIds: number[] = [];
  let created = 0;

  // Prepare statements
  const insertFieldStmt = ctx.sqlite.prepare(`
    INSERT OR IGNORE INTO organization_fields
      (organization_id, field_name, display_name, field_type, is_filterable, is_visible, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const getFieldIdStmt = ctx.sqlite.prepare(`
    SELECT id FROM organization_fields WHERE organization_id = ? AND field_name = ?
  `);

  const insertOptionStmt = ctx.sqlite.prepare(`
    INSERT OR IGNORE INTO organization_field_options (field_id, value, display_name, sort_order)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = ctx.sqlite.transaction(() => {
    for (const field of fields) {
      // Insert or ignore field
      insertFieldStmt.run(
        organizationId,
        field.field_name,
        field.display_name,
        field.field_type,
        field.is_filterable ? 1 : 0,
        field.is_visible ? 1 : 0,
        0
      );

      // Get the field ID
      const fieldRecord = getFieldIdStmt.get(organizationId, field.field_name) as { id: number } | undefined;
      if (fieldRecord) {
        fieldIds.push(fieldRecord.id);
        created++;

        // Create options for select fields
        if (field.field_type === 'select' && field.options && field.options.length > 0) {
          field.options.forEach((value, index) => {
            insertOptionStmt.run(fieldRecord.id, value, value, index);
          });
        }
      }
    }
  });

  transaction();

  dbLogger.info({ organizationId, created, total: fields.length }, 'Organization fields created');
  return { created, fieldIds };
}

// ============ ONBOARDING METHODS ============

export async function getOnboardingStatus(ctx: DatabaseContext, organizationId: number): Promise<{
  stage: string;
  completed: boolean;
  industry_template_id: number | null;
} | null> {
  // Use Supabase if configured
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getOnboardingStatus(organizationId);
  }

  if (!ctx.sqlite) return null;

  const result = ctx.sqlite.prepare(`
    SELECT onboarding_stage, onboarding_completed, industry_template_id
    FROM organizations WHERE id = ?
  `).get(organizationId) as {
    onboarding_stage: string;
    onboarding_completed: number;
    industry_template_id: number | null;
  } | undefined;

  if (!result) return null;

  return {
    stage: result.onboarding_stage || 'not_started',
    completed: !!result.onboarding_completed,
    industry_template_id: result.industry_template_id,
  };
}

export async function updateOnboardingStage(
  ctx: DatabaseContext,
  organizationId: number,
  stage: string,
  additionalData?: Partial<{
    onboarding_completed: boolean;
    industry_template_id: number;
    company_address: string;
    company_postnummer: string;
    company_poststed: string;
    map_center_lat: number;
    map_center_lng: number;
    map_zoom: number;
    route_start_lat: number;
    route_start_lng: number;
  }>
): Promise<boolean> {
  // Use Supabase if configured
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.updateOnboardingStage(organizationId, stage, additionalData);
  }

  if (!ctx.sqlite) return false;

  const fields: string[] = ['onboarding_stage = ?'];
  const values: unknown[] = [stage];

  if (additionalData) {
    if (additionalData.onboarding_completed !== undefined) {
      fields.push('onboarding_completed = ?');
      values.push(additionalData.onboarding_completed ? 1 : 0);
    }
    if (additionalData.industry_template_id !== undefined) {
      fields.push('industry_template_id = ?');
      values.push(additionalData.industry_template_id);
    }
    if (additionalData.company_address !== undefined) {
      fields.push('company_address = ?');
      values.push(additionalData.company_address);
    }
    if (additionalData.company_postnummer !== undefined) {
      fields.push('company_postnummer = ?');
      values.push(additionalData.company_postnummer);
    }
    if (additionalData.company_poststed !== undefined) {
      fields.push('company_poststed = ?');
      values.push(additionalData.company_poststed);
    }
    if (additionalData.map_center_lat !== undefined) {
      fields.push('map_center_lat = ?');
      values.push(additionalData.map_center_lat);
    }
    if (additionalData.map_center_lng !== undefined) {
      fields.push('map_center_lng = ?');
      values.push(additionalData.map_center_lng);
    }
    if (additionalData.map_zoom !== undefined) {
      fields.push('map_zoom = ?');
      values.push(additionalData.map_zoom);
    }
    if (additionalData.route_start_lat !== undefined) {
      fields.push('route_start_lat = ?');
      values.push(additionalData.route_start_lat);
    }
    if (additionalData.route_start_lng !== undefined) {
      fields.push('route_start_lng = ?');
      values.push(additionalData.route_start_lng);
    }
  }

  values.push(organizationId);

  try {
    const result = ctx.sqlite.prepare(`
      UPDATE organizations SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return result.changes > 0;
  } catch (error) {
    dbLogger.error({ error, organizationId, stage }, 'Failed to update onboarding stage');
    return false;
  }
}

export async function completeOnboarding(ctx: DatabaseContext, organizationId: number): Promise<boolean> {
  // Use Supabase if configured
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.completeOnboarding(organizationId);
  }
  return updateOnboardingStage(ctx, organizationId, 'completed', { onboarding_completed: true });
}

// ============ SUBCATEGORY GROUPS ============

export async function getSubcatGroupsByOrganization(ctx: DatabaseContext, organizationId: number): Promise<{ id: number; organization_id: number; navn: string; sort_order: number; created_at: string }[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('service_type_subcat_groups')
      .select('*')
      .eq('organization_id', organizationId)
      .order('sort_order')
      .order('navn');
    if (error) throw error;
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare('SELECT * FROM service_type_subcat_groups WHERE organization_id = ? ORDER BY sort_order, navn').all(organizationId) as any[];
}

export async function createSubcatGroup(ctx: DatabaseContext, organizationId: number, navn: string, sortOrder?: number): Promise<any> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('service_type_subcat_groups')
      .insert({ organization_id: organizationId, navn, sort_order: sortOrder ?? 0 })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('INSERT INTO service_type_subcat_groups (organization_id, navn, sort_order) VALUES (?, ?, ?)').run(organizationId, navn, sortOrder ?? 0);
  return ctx.sqlite.prepare('SELECT * FROM service_type_subcat_groups WHERE id = ?').get(result.lastInsertRowid);
}

export async function updateSubcatGroup(ctx: DatabaseContext, groupId: number, navn: string): Promise<any | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('service_type_subcat_groups')
      .update({ navn })
      .eq('id', groupId)
      .select()
      .single();
    if (error) return null;
    return data;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('UPDATE service_type_subcat_groups SET navn = ? WHERE id = ?').run(navn, groupId);
  if (result.changes === 0) return null;
  return ctx.sqlite.prepare('SELECT * FROM service_type_subcat_groups WHERE id = ?').get(groupId);
}

export async function deleteSubcatGroup(ctx: DatabaseContext, groupId: number): Promise<boolean> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { error } = await client
      .from('service_type_subcat_groups')
      .delete()
      .eq('id', groupId);
    return !error;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('DELETE FROM service_type_subcat_groups WHERE id = ?').run(groupId);
  return result.changes > 0;
}

// ============ SUBCATEGORIES ============

export async function getSubcategoriesByGroupIds(ctx: DatabaseContext, groupIds: number[]): Promise<{ id: number; group_id: number; navn: string; sort_order: number; created_at: string }[]> {
  if (groupIds.length === 0) return [];
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('service_type_subcategories')
      .select('*')
      .in('group_id', groupIds)
      .order('sort_order')
      .order('navn');
    if (error) throw error;
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const placeholders = groupIds.map(() => '?').join(',');
  return ctx.sqlite.prepare(`SELECT * FROM service_type_subcategories WHERE group_id IN (${placeholders}) ORDER BY sort_order, navn`).all(...groupIds) as any[];
}

export async function createSubcategory(ctx: DatabaseContext, groupId: number, navn: string, sortOrder?: number): Promise<any> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('service_type_subcategories')
      .insert({ group_id: groupId, navn, sort_order: sortOrder ?? 0 })
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('INSERT INTO service_type_subcategories (group_id, navn, sort_order) VALUES (?, ?, ?)').run(groupId, navn, sortOrder ?? 0);
  return ctx.sqlite.prepare('SELECT * FROM service_type_subcategories WHERE id = ?').get(result.lastInsertRowid);
}

export async function updateSubcategory(ctx: DatabaseContext, id: number, navn: string): Promise<any | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('service_type_subcategories')
      .update({ navn })
      .eq('id', id)
      .select()
      .single();
    if (error) return null;
    return data;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('UPDATE service_type_subcategories SET navn = ? WHERE id = ?').run(navn, id);
  if (result.changes === 0) return null;
  return ctx.sqlite.prepare('SELECT * FROM service_type_subcategories WHERE id = ?').get(id);
}

export async function deleteSubcategory(ctx: DatabaseContext, id: number): Promise<boolean> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { error } = await client
      .from('service_type_subcategories')
      .delete()
      .eq('id', id);
    return !error;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('DELETE FROM service_type_subcategories WHERE id = ?').run(id);
  return result.changes > 0;
}

// ============ KUNDE SUBCATEGORIES ============

export async function getKundeSubcategories(ctx: DatabaseContext, kundeId: number): Promise<{ kunde_id: number; group_id: number; subcategory_id: number }[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('kunde_subcategories')
      .select('*')
      .eq('kunde_id', kundeId);
    if (error) throw error;
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare('SELECT * FROM kunde_subcategories WHERE kunde_id = ?').all(kundeId) as any[];
}

export async function setKundeSubcategories(ctx: DatabaseContext, kundeId: number, assignments: { group_id: number; subcategory_id: number }[]): Promise<boolean> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    // Delete existing assignments
    await client.from('kunde_subcategories').delete().eq('kunde_id', kundeId);
    // Insert new assignments
    if (assignments.length > 0) {
      const rows = assignments.map(a => ({ kunde_id: kundeId, group_id: a.group_id, subcategory_id: a.subcategory_id }));
      const { error } = await client.from('kunde_subcategories').insert(rows);
      if (error) throw error;
    }
    return true;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  ctx.sqlite.prepare('DELETE FROM kunde_subcategories WHERE kunde_id = ?').run(kundeId);
  if (assignments.length > 0) {
    const stmt = ctx.sqlite.prepare('INSERT INTO kunde_subcategories (kunde_id, group_id, subcategory_id) VALUES (?, ?, ?)');
    for (const a of assignments) {
      stmt.run(kundeId, a.group_id, a.subcategory_id);
    }
  }
  return true;
}

export async function getAllKundeSubcategoryAssignments(ctx: DatabaseContext, organizationId: number): Promise<{ kunde_id: number; group_id: number; subcategory_id: number }[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data: kunder } = await client
      .from('kunder')
      .select('id')
      .eq('organization_id', organizationId);
    const kundeIds = (kunder || []).map((k: { id: number }) => k.id);
    if (kundeIds.length === 0) return [];
    const { data, error } = await client
      .from('kunde_subcategories')
      .select('kunde_id, group_id, subcategory_id')
      .in('kunde_id', kundeIds);
    if (error) throw error;
    return (data || []) as { kunde_id: number; group_id: number; subcategory_id: number }[];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare(`
    SELECT ks.kunde_id, ks.group_id, ks.subcategory_id FROM kunde_subcategories ks
    INNER JOIN kunder k ON k.id = ks.kunde_id
    WHERE k.organization_id = ?
  `).all(organizationId) as { kunde_id: number; group_id: number; subcategory_id: number }[];
}

// ============ KONTAKTPERSONER ============

export async function getKontaktpersonerByKunde(ctx: DatabaseContext, kundeId: number, organizationId: number): Promise<any[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('kontaktpersoner')
      .select('*')
      .eq('kunde_id', kundeId)
      .eq('organization_id', organizationId)
      .order('er_primaer', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare(
    'SELECT * FROM kontaktpersoner WHERE kunde_id = ? AND organization_id = ? ORDER BY er_primaer DESC, created_at ASC'
  ).all(kundeId, organizationId);
}

export async function createKontaktperson(ctx: DatabaseContext, data: {
  kunde_id: number;
  organization_id: number;
  navn: string;
  rolle?: string;
  telefon?: string;
  epost?: string;
  er_primaer?: boolean;
}): Promise<any> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data: result, error } = await client
      .from('kontaktpersoner')
      .insert({
        kunde_id: data.kunde_id,
        organization_id: data.organization_id,
        navn: data.navn,
        rolle: data.rolle || null,
        telefon: data.telefon || null,
        epost: data.epost || null,
        er_primaer: data.er_primaer ?? false,
      })
      .select()
      .single();
    if (error) throw error;
    return result;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const stmt = ctx.sqlite.prepare(`
    INSERT INTO kontaktpersoner (kunde_id, organization_id, navn, rolle, telefon, epost, er_primaer)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.kunde_id, data.organization_id, data.navn,
    data.rolle || null, data.telefon || null, data.epost || null,
    data.er_primaer ? 1 : 0
  );
  return ctx.sqlite.prepare('SELECT * FROM kontaktpersoner WHERE id = ?').get(result.lastInsertRowid);
}

export async function updateKontaktperson(ctx: DatabaseContext, id: number, organizationId: number, data: Record<string, any>): Promise<any | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data: result, error } = await client
      .from('kontaktpersoner')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();
    if (error) return null;
    return result;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const fields = Object.keys(data).filter(k => data[k] !== undefined);
  if (fields.length === 0) return null;
  fields.push('updated_at');
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => f === 'updated_at' ? new Date().toISOString() : data[f]);
  const stmt = ctx.sqlite.prepare(`UPDATE kontaktpersoner SET ${setClause} WHERE id = ? AND organization_id = ?`);
  const result = stmt.run(...values, id, organizationId);
  if (result.changes === 0) return null;
  return ctx.sqlite.prepare('SELECT * FROM kontaktpersoner WHERE id = ?').get(id);
}

export async function deleteKontaktperson(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { error } = await client
      .from('kontaktpersoner')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId);
    return !error;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('DELETE FROM kontaktpersoner WHERE id = ? AND organization_id = ?').run(id, organizationId);
  return result.changes > 0;
}

// ============ COVERAGE AREAS ============

export async function getCoverageAreas(ctx: DatabaseContext, organizationId: number): Promise<import('../../types').CoverageArea[]> {
  ctx.validateTenantContext(organizationId, 'getCoverageAreas');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('coverage_areas')
      .select('*')
      .eq('organization_id', organizationId)
      .order('zone_priority', { ascending: true });
    if (error) throw new Error(`Failed to fetch coverage areas: ${error.message}`);
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare(
    'SELECT * FROM coverage_areas WHERE organization_id = ? ORDER BY zone_priority ASC'
  ).all(organizationId) as import('../../types').CoverageArea[];
}

export async function getCoverageAreaById(ctx: DatabaseContext, id: number, organizationId: number): Promise<import('../../types').CoverageArea | null> {
  ctx.validateTenantContext(organizationId, 'getCoverageAreaById');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('coverage_areas')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .single();
    if (error || !data) return null;
    return data;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare(
    'SELECT * FROM coverage_areas WHERE id = ? AND organization_id = ?'
  ).get(id, organizationId);
  return (result as import('../../types').CoverageArea) || null;
}

export async function createCoverageArea(ctx: DatabaseContext, organizationId: number, data: Partial<import('../../types').CoverageArea>): Promise<import('../../types').CoverageArea> {
  ctx.validateTenantContext(organizationId, 'createCoverageArea');

  // Enforce max 5 zones per org
  const existing = await getCoverageAreas(ctx, organizationId);
  if (existing.length >= 5) {
    throw new Error('Maks 5 dekningsområder per organisasjon');
  }

  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data: created, error } = await supabase
      .from('coverage_areas')
      .insert({
        organization_id: organizationId,
        navn: data.navn || 'Hovedområde',
        coverage_type: data.coverage_type,
        coverage_value: data.coverage_value,
        origin_lat: data.origin_lat,
        origin_lng: data.origin_lng,
        polygon_geojson: data.polygon_geojson || null,
        polygon_cached_at: data.polygon_geojson ? new Date().toISOString() : null,
        fill_color: data.fill_color || '#2563eb',
        fill_opacity: data.fill_opacity ?? 0.1,
        line_color: data.line_color || '#2563eb',
        zone_priority: data.zone_priority ?? 0,
        aktiv: data.aktiv ?? true,
      })
      .select()
      .single();
    if (error || !created) throw new Error(`Failed to create coverage area: ${error?.message}`);
    return created;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare(`
    INSERT INTO coverage_areas (organization_id, navn, coverage_type, coverage_value, origin_lat, origin_lng, polygon_geojson, polygon_cached_at, fill_color, fill_opacity, line_color, zone_priority, aktiv)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    organizationId,
    data.navn || 'Hovedområde',
    data.coverage_type,
    data.coverage_value,
    data.origin_lat ?? null,
    data.origin_lng ?? null,
    data.polygon_geojson ? JSON.stringify(data.polygon_geojson) : null,
    data.polygon_geojson ? new Date().toISOString() : null,
    data.fill_color || '#2563eb',
    data.fill_opacity ?? 0.1,
    data.line_color || '#2563eb',
    data.zone_priority ?? 0,
    data.aktiv ?? true
  );
  return ctx.sqlite.prepare('SELECT * FROM coverage_areas WHERE id = ?').get(result.lastInsertRowid) as import('../../types').CoverageArea;
}

export async function updateCoverageArea(ctx: DatabaseContext, id: number, organizationId: number, data: Partial<import('../../types').CoverageArea>): Promise<import('../../types').CoverageArea | null> {
  ctx.validateTenantContext(organizationId, 'updateCoverageArea');

  const allowedFields: Record<string, unknown> = {};
  if (data.navn !== undefined) allowedFields.navn = data.navn;
  if (data.coverage_type !== undefined) allowedFields.coverage_type = data.coverage_type;
  if (data.coverage_value !== undefined) allowedFields.coverage_value = data.coverage_value;
  if (data.origin_lat !== undefined) allowedFields.origin_lat = data.origin_lat;
  if (data.origin_lng !== undefined) allowedFields.origin_lng = data.origin_lng;
  if (data.polygon_geojson !== undefined) {
    allowedFields.polygon_geojson = data.polygon_geojson;
    allowedFields.polygon_cached_at = new Date().toISOString();
  }
  if (data.fill_color !== undefined) allowedFields.fill_color = data.fill_color;
  if (data.fill_opacity !== undefined) allowedFields.fill_opacity = data.fill_opacity;
  if (data.line_color !== undefined) allowedFields.line_color = data.line_color;
  if (data.zone_priority !== undefined) allowedFields.zone_priority = data.zone_priority;
  if (data.aktiv !== undefined) allowedFields.aktiv = data.aktiv;
  allowedFields.updated_at = new Date().toISOString();

  if (Object.keys(allowedFields).length <= 1) return getCoverageAreaById(ctx, id, organizationId);

  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data: updated, error } = await supabase
      .from('coverage_areas')
      .update(allowedFields)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();
    if (error || !updated) return null;
    return updated;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const sets = Object.keys(allowedFields).map(k => `${k} = ?`).join(', ');
  const values = Object.values(allowedFields).map(v =>
    typeof v === 'object' && v !== null ? JSON.stringify(v) : v
  );
  ctx.sqlite.prepare(`UPDATE coverage_areas SET ${sets} WHERE id = ? AND organization_id = ?`).run(...values, id, organizationId);
  return getCoverageAreaById(ctx, id, organizationId);
}

export async function deleteCoverageArea(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'deleteCoverageArea');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { error } = await supabase
      .from('coverage_areas')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId);
    if (error) throw new Error(`Failed to delete coverage area: ${error.message}`);
    return true;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('DELETE FROM coverage_areas WHERE id = ? AND organization_id = ?').run(id, organizationId);
  return result.changes > 0;
}

/**
 * Ukeplan Notater (Weekly Plan Notes) database queries
 * CRUD operations for per-customer weekly notes/reminders
 */

import type { DatabaseContext } from './types';

export interface UkeplanNotat {
  id: number;
  organization_id: number;
  kunde_id: number;
  uke_start: string;
  notat: string;
  fullfort: boolean;
  type: string;
  tilordnet: string | null;
  maldag: string | null;
  overfort_fra: number | null;
  opprettet_av: string | null;
  created_at: string;
  updated_at: string;
  kunde_navn?: string;
  kunde_adresse?: string;
  kunde_poststed?: string;
}

// Supabase row with joined kunder relation
interface NotatWithKundeRow extends Record<string, unknown> {
  kunder?: { navn?: string; adresse?: string; poststed?: string } | null;
}

// ============ UKEPLAN NOTATER ============

export async function getUkeplanNotater(ctx: DatabaseContext, organizationId: number, ukeStart: string): Promise<UkeplanNotat[]> {
  ctx.validateTenantContext(organizationId, 'getUkeplanNotater');

  if (ctx.type === 'supabase') {
    const client = await ctx.getSupabaseClient();
    const { data, error } = await client
      .from('ukeplan_notater')
      .select('*, kunder!inner(navn, adresse, poststed)')
      .eq('organization_id', organizationId)
      .eq('uke_start', ukeStart)
      .order('created_at', { ascending: true });

    if (error) throw error;

    return (data || []).map((row: NotatWithKundeRow) => ({
      ...row,
      kunde_navn: row.kunder?.navn,
      kunde_adresse: row.kunder?.adresse,
      kunde_poststed: row.kunder?.poststed,
      kunder: undefined,
    }));
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  return ctx.sqlite.prepare(`
    SELECT un.*, k.navn as kunde_navn, k.adresse as kunde_adresse, k.poststed as kunde_poststed
    FROM ukeplan_notater un
    JOIN kunder k ON k.id = un.kunde_id
    WHERE un.organization_id = ? AND un.uke_start = ?
    ORDER BY un.created_at ASC
  `).all(organizationId, ukeStart) as UkeplanNotat[];
}

export async function createUkeplanNotat(
  ctx: DatabaseContext,
  data: { organization_id: number; kunde_id: number; uke_start: string; notat: string; opprettet_av?: string; type?: string; tilordnet?: string; maldag?: string; overfort_fra?: number }
): Promise<UkeplanNotat> {
  ctx.validateTenantContext(data.organization_id, 'createUkeplanNotat');

  if (ctx.type === 'supabase') {
    const client = await ctx.getSupabaseClient();
    const insertData: Record<string, unknown> = {
      organization_id: data.organization_id,
      kunde_id: data.kunde_id,
      uke_start: data.uke_start,
      notat: data.notat,
      opprettet_av: data.opprettet_av || null,
    };
    if (data.type) insertData.type = data.type;
    if (data.tilordnet) insertData.tilordnet = data.tilordnet;
    if (data.maldag) insertData.maldag = data.maldag;
    if (data.overfort_fra) insertData.overfort_fra = data.overfort_fra;

    const { data: row, error } = await client
      .from('ukeplan_notater')
      .insert(insertData)
      .select('*, kunder!inner(navn, adresse, poststed)')
      .single();

    if (error) throw error;

    return {
      ...row,
      kunde_navn: row.kunder?.navn,
      kunde_adresse: row.kunder?.adresse,
      kunde_poststed: row.kunder?.poststed,
      kunder: undefined,
    };
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite.prepare(`
    INSERT INTO ukeplan_notater (organization_id, kunde_id, uke_start, notat, opprettet_av, type, tilordnet, maldag, overfort_fra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(data.organization_id, data.kunde_id, data.uke_start, data.notat, data.opprettet_av || null, data.type || 'notat', data.tilordnet || null, data.maldag || null, data.overfort_fra || null);

  return ctx.sqlite.prepare(`
    SELECT un.*, k.navn as kunde_navn, k.adresse as kunde_adresse, k.poststed as kunde_poststed
    FROM ukeplan_notater un
    JOIN kunder k ON k.id = un.kunde_id
    WHERE un.id = ?
  `).get(result.lastInsertRowid) as UkeplanNotat;
}

export async function updateUkeplanNotat(
  ctx: DatabaseContext,
  id: number,
  organizationId: number,
  data: { notat?: string; fullfort?: boolean; type?: string; tilordnet?: string | null; maldag?: string | null }
): Promise<UkeplanNotat | null> {
  ctx.validateTenantContext(organizationId, 'updateUkeplanNotat');

  if (ctx.type === 'supabase') {
    const client = await ctx.getSupabaseClient();
    const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.notat !== undefined) updateData.notat = data.notat;
    if (data.fullfort !== undefined) updateData.fullfort = data.fullfort;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.tilordnet !== undefined) updateData.tilordnet = data.tilordnet;
    if (data.maldag !== undefined) updateData.maldag = data.maldag;

    const { data: row, error } = await client
      .from('ukeplan_notater')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select('*, kunder!inner(navn, adresse, poststed)')
      .single();

    if (error) throw error;
    if (!row) return null;

    return {
      ...row,
      kunde_navn: row.kunder?.navn,
      kunde_adresse: row.kunder?.adresse,
      kunde_poststed: row.kunder?.poststed,
      kunder: undefined,
    };
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sets: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];
  if (data.notat !== undefined) { sets.push('notat = ?'); params.push(data.notat); }
  if (data.fullfort !== undefined) { sets.push('fullfort = ?'); params.push(data.fullfort ? 1 : 0); }
  if (data.type !== undefined) { sets.push('type = ?'); params.push(data.type); }
  if (data.tilordnet !== undefined) { sets.push('tilordnet = ?'); params.push(data.tilordnet); }
  if (data.maldag !== undefined) { sets.push('maldag = ?'); params.push(data.maldag); }
  params.push(id, organizationId);

  const result = ctx.sqlite.prepare(
    `UPDATE ukeplan_notater SET ${sets.join(', ')} WHERE id = ? AND organization_id = ?`
  ).run(...params);

  if (result.changes === 0) return null;

  return ctx.sqlite.prepare(`
    SELECT un.*, k.navn as kunde_navn, k.adresse as kunde_adresse, k.poststed as kunde_poststed
    FROM ukeplan_notater un
    JOIN kunder k ON k.id = un.kunde_id
    WHERE un.id = ?
  `).get(id) as UkeplanNotat;
}

export async function deleteUkeplanNotat(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'deleteUkeplanNotat');

  if (ctx.type === 'supabase') {
    const client = await ctx.getSupabaseClient();
    const { error } = await client
      .from('ukeplan_notater')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId);

    if (error) throw error;
    return true;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite.prepare(
    'DELETE FROM ukeplan_notater WHERE id = ? AND organization_id = ?'
  ).run(id, organizationId);

  return result.changes > 0;
}

export async function getOverforteNotater(ctx: DatabaseContext, organizationId: number, currentUkeStart: string): Promise<UkeplanNotat[]> {
  ctx.validateTenantContext(organizationId, 'getOverforteNotater');

  if (ctx.type === 'supabase') {
    const client = await ctx.getSupabaseClient();
    const { data, error } = await client
      .from('ukeplan_notater')
      .select('*, kunder!inner(navn, adresse, poststed)')
      .eq('organization_id', organizationId)
      .eq('fullfort', false)
      .lt('uke_start', currentUkeStart)
      .order('uke_start', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) throw error;

    return (data || []).map((row: NotatWithKundeRow) => ({
      ...row,
      kunde_navn: row.kunder?.navn,
      kunde_adresse: row.kunder?.adresse,
      kunde_poststed: row.kunder?.poststed,
      kunder: undefined,
    }));
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  return ctx.sqlite.prepare(`
    SELECT un.*, k.navn as kunde_navn, k.adresse as kunde_adresse, k.poststed as kunde_poststed
    FROM ukeplan_notater un
    JOIN kunder k ON k.id = un.kunde_id
    WHERE un.organization_id = ? AND un.fullfort = 0 AND un.uke_start < ?
    ORDER BY un.uke_start DESC, un.created_at ASC
  `).all(organizationId, currentUkeStart) as UkeplanNotat[];
}

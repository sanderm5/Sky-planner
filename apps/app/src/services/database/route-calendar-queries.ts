/**
 * Route (ruter) and calendar (avtaler) database queries.
 * Handles CRUD operations for routes, route customers, visit records,
 * and calendar appointments.
 */

import type { DatabaseContext, Kunde, Rute, Avtale } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============ RUTER CRUD ============

export async function getAllRuter(ctx: DatabaseContext, organizationId: number): Promise<(Rute & { antall_kunder: number })[]> {
  ctx.validateTenantContext(organizationId, 'getAllRuter');

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getAllRuter(organizationId);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sql = `SELECT r.*, (SELECT COUNT(*) FROM rute_kunder WHERE rute_id = r.id) as antall_kunder
       FROM ruter r WHERE r.organization_id = ?
       ORDER BY r.planlagt_dato DESC, r.opprettet DESC`;

  return ctx.sqlite.prepare(sql).all(organizationId) as (Rute & { antall_kunder: number })[];
}

/**
 * Get a route assigned to a specific user for a given date.
 * Used by the "Today's Work" view for team members.
 */
export async function getRouteForUserByDate(ctx: DatabaseContext, userId: number, date: string, organizationId: number): Promise<Rute | null> {
  ctx.validateTenantContext(organizationId, 'getRouteForUserByDate');

  if (ctx.type === 'supabase' && ctx.supabase) {
    // Not yet implemented for Supabase — returns null gracefully
    return null;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sql = `SELECT * FROM ruter
    WHERE assigned_to = ? AND (planned_date = ? OR planlagt_dato = ?) AND organization_id = ?
    LIMIT 1`;

  const result = ctx.sqlite.prepare(sql).get(userId, date, date, organizationId);
  return (result as Rute) || null;
}

/**
 * Get a route by ID.
 * SECURITY: organizationId is required to prevent cross-tenant data access.
 */
export async function getRuteById(ctx: DatabaseContext, id: number, organizationId: number): Promise<Rute | null> {
  ctx.validateTenantContext(organizationId, 'getRuteById');

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getRuteById(id);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sql = 'SELECT * FROM ruter WHERE id = ? AND organization_id = ?';
  const result = ctx.sqlite.prepare(sql).get(id, organizationId);

  return (result as Rute) || null;
}

export async function createRute(ctx: DatabaseContext, data: Partial<Rute> & { kunde_ids?: number[] }): Promise<Rute> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.createRute(data);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const stmt = ctx.sqlite.prepare(`
    INSERT INTO ruter (navn, beskrivelse, planlagt_dato, total_distanse, total_tid, organization_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    data.navn,
    data.beskrivelse,
    data.planlagt_dato,
    data.total_distanse,
    data.total_tid,
    data.organization_id
  );

  return { ...data, id: Number(result.lastInsertRowid), status: 'planlagt' } as Rute;
}

/**
 * Update a route.
 * SECURITY: organizationId is required to prevent cross-tenant data modification.
 */
export async function updateRute(ctx: DatabaseContext, id: number, data: Partial<Rute>, organizationId: number): Promise<Rute | null> {
  ctx.validateTenantContext(organizationId, 'updateRute');

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.updateRute(id, data);
  }

  const existing = await getRuteById(ctx, id, organizationId);
  if (!existing) return null;

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const fields: string[] = [];
  const values: unknown[] = [];

  const updateableFields = ['navn', 'beskrivelse', 'planlagt_dato', 'status', 'total_distanse', 'total_tid', 'assigned_to', 'planned_date', 'execution_started_at', 'execution_ended_at', 'current_stop_index'];

  for (const field of updateableFields) {
    if (field in data) {
      fields.push(`${field} = ?`);
      values.push((data as Record<string, unknown>)[field]);
    }
  }

  if (fields.length === 0) return existing;

  values.push(id);
  const sql = `UPDATE ruter SET ${fields.join(', ')} WHERE id = ?`;
  ctx.sqlite.prepare(sql).run(...values);

  return getRuteById(ctx, id, organizationId);
}

/**
 * Delete a route.
 * SECURITY: organizationId is required to prevent cross-tenant data deletion.
 */
export async function deleteRute(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'deleteRute');

  if (ctx.type === 'supabase' && ctx.supabase) {
    await ctx.supabase.deleteRute(id);
    return true;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Verify ownership first
  const existing = await getRuteById(ctx, id, organizationId);
  if (!existing) return false;

  // Delete rute_kunder first (cascade might not work in all SQLite versions)
  ctx.sqlite.prepare('DELETE FROM rute_kunder WHERE rute_id = ?').run(id);

  const sql = 'DELETE FROM ruter WHERE id = ? AND organization_id = ?';
  const result = ctx.sqlite.prepare(sql).run(id, organizationId);

  return result.changes > 0;
}

// ============ RUTE KUNDER ============

export async function getRuteKunder(ctx: DatabaseContext, ruteId: number): Promise<(Kunde & { rekkefolge: number })[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const rute = await ctx.supabase.getRuteById(ruteId);
    return rute?.kunder || [];
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  return ctx.sqlite.prepare(`
    SELECT k.*, rk.rekkefolge
    FROM rute_kunder rk
    JOIN kunder k ON k.id = rk.kunde_id
    WHERE rk.rute_id = ?
    ORDER BY rk.rekkefolge
  `).all(ruteId) as (Kunde & { rekkefolge: number })[];
}

/**
 * Set customers for a route.
 * SECURITY: organizationId is required to prevent cross-tenant data modification.
 */
export async function setRuteKunder(ctx: DatabaseContext, ruteId: number, kundeIds: number[], organizationId: number): Promise<void> {
  ctx.validateTenantContext(organizationId, 'setRuteKunder');

  if (ctx.type === 'supabase' && ctx.supabase) {
    await ctx.supabase.updateRute(ruteId, { kunde_ids: kundeIds });
    return;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Verify route ownership first
  const rute = await getRuteById(ctx, ruteId, organizationId);
  if (!rute) throw new Error('Route not found or access denied');

  // Clear existing
  ctx.sqlite.prepare('DELETE FROM rute_kunder WHERE rute_id = ?').run(ruteId);

  // Insert new
  const insertStmt = ctx.sqlite.prepare(`
    INSERT INTO rute_kunder (rute_id, kunde_id, rekkefolge, organization_id)
    VALUES (?, ?, ?, ?)
  `);

  kundeIds.forEach((kundeId, index) => {
    insertStmt.run(ruteId, kundeId, index + 1, organizationId);
  });
}

/**
 * Mark a route as complete.
 * SECURITY: organizationId is required to prevent cross-tenant data modification.
 */
export async function completeRute(
  ctx: DatabaseContext,
  id: number,
  dato: string,
  kontrollType: 'el' | 'brann' | 'both',
  organizationId: number
): Promise<{ success: boolean; oppdaterte_kunder: number }> {
  ctx.validateTenantContext(organizationId, 'completeRute');

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.completeRute(id, dato);
  }

  const rute = await getRuteById(ctx, id, organizationId);
  if (!rute) return { success: false, oppdaterte_kunder: 0 };

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const kunder = await getRuteKunder(ctx, id);

  const updateStmt = ctx.sqlite.prepare(`
    UPDATE kunder SET
      last_visit_date = ?,
      siste_el_kontroll = CASE WHEN ? IN ('el', 'both') THEN ? ELSE siste_el_kontroll END,
      neste_el_kontroll = CASE WHEN ? IN ('el', 'both') THEN CASE WHEN COALESCE(el_kontroll_intervall, 36) < 0 THEN date(?, '+' || ABS(COALESCE(el_kontroll_intervall, 36)) || ' days') ELSE date(?, '+' || COALESCE(el_kontroll_intervall, 36) || ' months') END ELSE neste_el_kontroll END,
      siste_brann_kontroll = CASE WHEN ? IN ('brann', 'both') THEN ? ELSE siste_brann_kontroll END,
      neste_brann_kontroll = CASE WHEN ? IN ('brann', 'both') THEN CASE WHEN COALESCE(brann_kontroll_intervall, 12) < 0 THEN date(?, '+' || ABS(COALESCE(brann_kontroll_intervall, 12)) || ' days') ELSE date(?, '+' || COALESCE(brann_kontroll_intervall, 12) || ' months') END ELSE neste_brann_kontroll END,
      siste_kontroll = ?,
      neste_kontroll = CASE WHEN COALESCE(kontroll_intervall_mnd, 12) < 0 THEN date(?, '+' || ABS(COALESCE(kontroll_intervall_mnd, 12)) || ' days') ELSE date(?, '+' || COALESCE(kontroll_intervall_mnd, 12) || ' months') END
    WHERE id = ?
  `);

  for (const kunde of kunder) {
    updateStmt.run(
      dato,
      kontrollType, dato,
      kontrollType, dato, dato,
      kontrollType, dato,
      kontrollType, dato, dato,
      dato,
      dato, dato,
      kunde.id
    );
  }

  ctx.sqlite.prepare('UPDATE ruter SET status = ? WHERE id = ?').run('fullført', id);

  return { success: true, oppdaterte_kunder: kunder.length };
}

// ============ FIELD WORK VISIT METHODS ============

export async function createVisitRecords(ctx: DatabaseContext, ruteId: number, kundeIds: number[], organizationId: number): Promise<void> {
  ctx.validateTenantContext(organizationId, 'createVisitRecords');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    // Delete old visit records first to reset state
    await client.from('rute_kunde_visits')
      .delete()
      .eq('rute_id', ruteId)
      .eq('organization_id', organizationId);
    const records = kundeIds.map(kundeId => ({
      rute_id: ruteId,
      kunde_id: kundeId,
      organization_id: organizationId,
      completed: false,
    }));
    await client.from('rute_kunde_visits').insert(records);
    return;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Delete old visit records first to reset state
  ctx.sqlite.prepare(
    'DELETE FROM rute_kunde_visits WHERE rute_id = ? AND organization_id = ?'
  ).run(ruteId, organizationId);

  const stmt = ctx.sqlite.prepare(
    'INSERT INTO rute_kunde_visits (rute_id, kunde_id, organization_id, completed) VALUES (?, ?, ?, 0)'
  );
  for (const kundeId of kundeIds) {
    stmt.run(ruteId, kundeId, organizationId);
  }
}

export async function upsertVisitRecord(
  ctx: DatabaseContext,
  ruteId: number,
  kundeId: number,
  organizationId: number,
  data: { visited_at: string; completed: boolean; comment?: string; materials_used?: string[]; equipment_registered?: string[]; todos?: string[] }
): Promise<{ id: number }> {
  ctx.validateTenantContext(organizationId, 'upsertVisitRecord');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data: result, error } = await client
      .from('rute_kunde_visits')
      .upsert({
        rute_id: ruteId,
        kunde_id: kundeId,
        organization_id: organizationId,
        ...data,
      }, { onConflict: 'rute_id,kunde_id' })
      .select('id')
      .single();
    if (error) throw error;
    return { id: result.id };
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Try to update existing record
  const existing = ctx.sqlite.prepare(
    'SELECT id FROM rute_kunde_visits WHERE rute_id = ? AND kunde_id = ?'
  ).get(ruteId, kundeId) as { id: number } | undefined;

  if (existing) {
    ctx.sqlite.prepare(`
      UPDATE rute_kunde_visits SET
        visited_at = ?, completed = ?, comment = ?,
        materials_used = ?, equipment_registered = ?, todos = ?
      WHERE id = ?
    `).run(
      data.visited_at, data.completed ? 1 : 0, data.comment || null,
      data.materials_used ? JSON.stringify(data.materials_used) : null,
      data.equipment_registered ? JSON.stringify(data.equipment_registered) : null,
      data.todos ? JSON.stringify(data.todos) : null,
      existing.id
    );
    return { id: existing.id };
  }

  const result = ctx.sqlite.prepare(`
    INSERT INTO rute_kunde_visits (rute_id, kunde_id, organization_id, visited_at, completed, comment, materials_used, equipment_registered, todos)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ruteId, kundeId, organizationId,
    data.visited_at, data.completed ? 1 : 0, data.comment || null,
    data.materials_used ? JSON.stringify(data.materials_used) : null,
    data.equipment_registered ? JSON.stringify(data.equipment_registered) : null,
    data.todos ? JSON.stringify(data.todos) : null,
  );

  return { id: Number(result.lastInsertRowid) };
}

export async function getVisitRecords(ctx: DatabaseContext, ruteId: number, organizationId: number): Promise<Array<{
  id: number; kunde_id: number; visited_at?: string; completed: boolean;
  comment?: string; materials_used?: string[]; equipment_registered?: string[]; todos?: string[];
}>> {
  ctx.validateTenantContext(organizationId, 'getVisitRecords');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data, error } = await client
      .from('rute_kunde_visits')
      .select('*')
      .eq('rute_id', ruteId)
      .eq('organization_id', organizationId);
    if (error) throw error;
    return data || [];
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const rows = ctx.sqlite.prepare(
    'SELECT * FROM rute_kunde_visits WHERE rute_id = ? AND organization_id = ?'
  ).all(ruteId, organizationId) as Array<Record<string, unknown>>;

  return rows.map(row => ({
    id: row.id as number,
    kunde_id: row.kunde_id as number,
    visited_at: row.visited_at as string | undefined,
    completed: Boolean(row.completed),
    comment: row.comment as string | undefined,
    materials_used: row.materials_used ? JSON.parse(row.materials_used as string) : undefined,
    equipment_registered: row.equipment_registered ? JSON.parse(row.equipment_registered as string) : undefined,
    todos: row.todos ? JSON.parse(row.todos as string) : undefined,
  }));
}

// ============ TEAM OVERVIEW (ALL ROUTES FOR A DATE) ============

export interface RouteWithStatus {
  id: number;
  navn: string;
  assigned_to: number | null;
  technician_name: string | null; // team member name (legacy field name)
  planned_date: string;
  total_count: number;
  completed_count: number;
  execution_started_at: string | null;
  execution_ended_at: string | null;
  kunder: Array<{ id: number; navn: string; adresse: string }>;
}

/**
 * Get all routes for an organization on a given date, with team member info and execution status.
 * Used by the team overview endpoint.
 */
export async function getRoutesForDateByOrg(
  ctx: DatabaseContext,
  date: string,
  organizationId: number
): Promise<RouteWithStatus[]> {
  ctx.validateTenantContext(organizationId, 'getRoutesForDateByOrg');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();

    // Get routes for the date — prefer planned_date (canonical), fall back to planlagt_dato
    // Use planned_date as primary match; only check planlagt_dato for legacy routes
    const { data: routes, error: routeError } = await client
      .from('ruter')
      .select('id, navn, assigned_to, planned_date, planlagt_dato, execution_started_at, execution_ended_at, organization_id')
      .eq('organization_id', organizationId)
      .or(`planned_date.eq.${date},and(planned_date.is.null,planlagt_dato.eq.${date})`);

    if (routeError) throw routeError;
    if (!routes || routes.length === 0) return [];

    // Get team member names for assigned routes
    const assignedIds = routes
      .map((r: any) => r.assigned_to)
      .filter((id: any): id is number => id != null);

    let memberNameMap: Record<number, string> = {};
    if (assignedIds.length > 0) {
      const { data: members } = await client
        .from('klient')
        .select('id, navn')
        .in('id', assignedIds);
      if (members) {
        for (const t of members) {
          memberNameMap[t.id] = t.navn;
        }
      }
    }

    // Build results with kunder and visit counts
    const results: RouteWithStatus[] = [];
    for (const route of routes) {
      // Get customers on the route
      const { data: ruteKunder } = await client
        .from('rute_kunder')
        .select('kunde_id, kunder(id, navn, adresse)')
        .eq('rute_id', route.id)
        .order('rekkefolge', { ascending: true });

      const kunder = (ruteKunder || []).map((rk: any) => ({
        id: rk.kunder?.id ?? rk.kunde_id,
        navn: rk.kunder?.navn ?? '',
        adresse: rk.kunder?.adresse ?? '',
      }));

      // Get visit completion count
      const { data: visits } = await client
        .from('rute_kunde_visits')
        .select('completed')
        .eq('rute_id', route.id)
        .eq('organization_id', organizationId);

      const completedCount = (visits || []).filter((v: any) => v.completed).length;

      results.push({
        id: route.id,
        navn: route.navn,
        assigned_to: route.assigned_to,
        technician_name: route.assigned_to ? (memberNameMap[route.assigned_to] || null) : null,
        planned_date: route.planned_date || (route as any).planlagt_dato,
        total_count: kunder.length,
        completed_count: completedCount,
        execution_started_at: route.execution_started_at || null,
        execution_ended_at: route.execution_ended_at || null,
        kunder,
      });
    }

    return results;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // SQLite: get routes with LEFT JOIN to klient for team member name
  const routes = ctx.sqlite.prepare(`
    SELECT r.id, r.navn, r.assigned_to, r.planned_date,
           r.execution_started_at, r.execution_ended_at,
           k.navn as technician_name
    FROM ruter r
    LEFT JOIN klient k ON r.assigned_to = k.id
    WHERE (r.planned_date = ? OR r.planlagt_dato = ?) AND r.organization_id = ?
    ORDER BY r.navn
  `).all(date, date, organizationId) as Array<Record<string, unknown>>;

  const results: RouteWithStatus[] = [];

  for (const route of routes) {
    // Get customers
    const kunder = ctx.sqlite.prepare(`
      SELECT ku.id, ku.navn, ku.adresse
      FROM rute_kunder rk
      JOIN kunder ku ON ku.id = rk.kunde_id
      WHERE rk.rute_id = ?
      ORDER BY rk.rekkefolge
    `).all(route.id as number) as Array<{ id: number; navn: string; adresse: string }>;

    // Get visit completion count
    const visitRow = ctx.sqlite.prepare(`
      SELECT COUNT(*) as completed_count
      FROM rute_kunde_visits
      WHERE rute_id = ? AND organization_id = ? AND completed = 1
    `).get(route.id as number, organizationId) as { completed_count: number } | undefined;

    results.push({
      id: route.id as number,
      navn: route.navn as string,
      assigned_to: (route.assigned_to as number) || null,
      technician_name: (route.technician_name as string) || null,
      planned_date: route.planned_date as string,
      total_count: kunder.length,
      completed_count: visitRow?.completed_count ?? 0,
      execution_started_at: (route.execution_started_at as string) || null,
      execution_ended_at: (route.execution_ended_at as string) || null,
      kunder,
    });
  }

  return results;
}

/**
 * Get all active team members for an organization.
 * Used by team overview to find team members without routes.
 */
export async function getActiveTeamMembersForOrg(
  ctx: DatabaseContext,
  organizationId: number
): Promise<Array<{ id: number; navn: string }>> {
  ctx.validateTenantContext(organizationId, 'getActiveTeamMembersForOrg');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data, error } = await client
      .from('klient')
      .select('id, navn')
      .eq('organization_id', organizationId)
      .eq('aktiv', true)
      .order('navn', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  return ctx.sqlite.prepare(
    'SELECT id, navn FROM klient WHERE organization_id = ? AND aktiv = 1 ORDER BY navn'
  ).all(organizationId) as Array<{ id: number; navn: string }>;
}

// ============ AVTALER (CALENDAR APPOINTMENTS) ============

export async function getAllAvtaler(ctx: DatabaseContext, organizationId: number, start?: string, end?: string): Promise<(Avtale & { kunde_navn?: string })[]> {
  ctx.validateTenantContext(organizationId, 'getAllAvtaler');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const data = await ctx.supabase.getAvtalerByTenant(organizationId, start, end) as any[];
    return (data || []).map((a: any) => ({
      ...a,
      kunde_navn: a.kunder?.navn,
      adresse: a.kunder?.adresse,
      postnummer: a.kunder?.postnummer,
      poststed: a.kunder?.poststed,
      telefon: a.kunder?.telefon,
      kategori: a.kunder?.kategori,
      // Resolve technician name from route assignment (overrides opprettet_av for display)
      tildelt_tekniker: a._tildelt_tekniker || null,
    }));
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  let sql = `
    SELECT a.*, k.navn as kunde_navn, k.adresse, k.postnummer, k.poststed, k.telefon, k.kategori
    FROM avtaler a
    LEFT JOIN kunder k ON a.kunde_id = k.id
    WHERE a.organization_id = ?
  `;
  const params: unknown[] = [organizationId];

  if (start) {
    sql += ' AND a.dato >= ?';
    params.push(start);
  }
  if (end) {
    sql += ' AND a.dato <= ?';
    params.push(end);
  }

  sql += ' ORDER BY a.dato, a.klokkeslett';

  return ctx.sqlite.prepare(sql).all(...params) as (Avtale & { kunde_navn?: string })[];
}

export async function getAvtaleById(ctx: DatabaseContext, id: number, organizationId: number): Promise<(Avtale & { kunde_navn?: string }) | null> {
  ctx.validateTenantContext(organizationId, 'getAvtaleById');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const a = await ctx.supabase.getAvtaleById(id) as any;
    if (!a) return null;
    return {
      ...a,
      kunde_navn: a.kunder?.navn,
      adresse: a.kunder?.adresse,
      postnummer: a.kunder?.postnummer,
      poststed: a.kunder?.poststed,
      telefon: a.kunder?.telefon,
      kategori: a.kunder?.kategori,
    } as Avtale & { kunde_navn?: string };
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sql = `SELECT a.*, k.navn as kunde_navn, k.adresse, k.postnummer, k.poststed, k.telefon, k.kategori
     FROM avtaler a LEFT JOIN kunder k ON a.kunde_id = k.id
     WHERE a.id = ? AND a.organization_id = ?`;

  const result = ctx.sqlite.prepare(sql).get(id, organizationId);

  return (result as (Avtale & { kunde_navn?: string })) || null;
}

export async function createAvtale(ctx: DatabaseContext, data: Partial<Avtale> & { organization_id: number }): Promise<Avtale & { kunde_navn?: string }> {
  ctx.validateTenantContext(data.organization_id, 'createAvtale');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const a = await ctx.supabase.createAvtale(data as any) as any;
    return {
      ...a,
      kunde_navn: a.kunder?.navn,
      adresse: a.kunder?.adresse,
      postnummer: a.kunder?.postnummer,
      poststed: a.kunder?.poststed,
      telefon: a.kunder?.telefon,
      kategori: a.kunder?.kategori,
    } as Avtale & { kunde_navn?: string };
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const stmt = ctx.sqlite.prepare(`
    INSERT INTO avtaler (kunde_id, dato, klokkeslett, type, beskrivelse, status, opprettet_av, organization_id,
      er_gjentakelse, gjentakelse_regel, gjentakelse_slutt, original_avtale_id, rute_id, varighet)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    data.kunde_id,
    data.dato,
    data.klokkeslett,
    data.type || 'El-Kontroll',
    data.beskrivelse,
    data.status || 'planlagt',
    data.opprettet_av,
    data.organization_id,
    data.er_gjentakelse ? 1 : 0,
    data.gjentakelse_regel || null,
    data.gjentakelse_slutt || null,
    data.original_avtale_id || null,
    data.rute_id || null,
    data.varighet || null
  );

  const avtale = await getAvtaleById(ctx, Number(result.lastInsertRowid), data.organization_id);
  return avtale!;
}

export async function deleteAvtalerByRuteId(ctx: DatabaseContext, ruteId: number, organizationId: number): Promise<number> {
  ctx.validateTenantContext(organizationId, 'deleteAvtalerByRuteId');

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.deleteAvtalerByRuteId(ruteId, organizationId);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite.prepare(
    "DELETE FROM avtaler WHERE rute_id = ? AND organization_id = ? AND type = 'Sky Planner'"
  ).run(ruteId, organizationId);

  return result.changes;
}

export async function updateAvtale(ctx: DatabaseContext, id: number, data: Partial<Avtale>, organizationId: number): Promise<(Avtale & { kunde_navn?: string }) | null> {
  ctx.validateTenantContext(organizationId, 'updateAvtale');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const a = await ctx.supabase.updateAvtale(id, data as any) as any;
    if (!a) return null;
    return {
      ...a,
      kunde_navn: a.kunder?.navn,
      adresse: a.kunder?.adresse,
      postnummer: a.kunder?.postnummer,
      poststed: a.kunder?.poststed,
      telefon: a.kunder?.telefon,
      kategori: a.kunder?.kategori,
    } as Avtale & { kunde_navn?: string };
  }

  const existing = await getAvtaleById(ctx, id, organizationId);
  if (!existing) return null;

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const fields: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: unknown[] = [];

  const updateableFields = ['kunde_id', 'dato', 'klokkeslett', 'type', 'beskrivelse', 'status', 'er_gjentakelse', 'gjentakelse_regel', 'gjentakelse_slutt'];

  for (const field of updateableFields) {
    if (field in data) {
      fields.push(`${field} = ?`);
      values.push((data as Record<string, unknown>)[field]);
    }
  }

  values.push(id, organizationId);
  const sql = `UPDATE avtaler SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`;
  ctx.sqlite.prepare(sql).run(...values);

  return getAvtaleById(ctx, id, organizationId);
}

export async function deleteAvtale(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'deleteAvtale');

  if (ctx.type === 'supabase' && ctx.supabase) {
    await ctx.supabase.deleteAvtale(id);
    return true;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sql = 'DELETE FROM avtaler WHERE id = ? AND organization_id = ?';
  const result = ctx.sqlite.prepare(sql).run(id, organizationId);

  return result.changes > 0;
}

export async function completeAvtale(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'completeAvtale');

  if (ctx.type === 'supabase' && ctx.supabase) {
    await ctx.supabase.completeAvtale(id, {});
    return true;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sql = `UPDATE avtaler SET status = 'fullført', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`;
  const result = ctx.sqlite.prepare(sql).run(id, organizationId);

  return result.changes > 0;
}

export async function deleteAvtaleSeries(ctx: DatabaseContext, parentId: number, organizationId: number): Promise<number> {
  ctx.validateTenantContext(organizationId, 'deleteAvtaleSeries');

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.deleteAvtaleSeries(parentId, organizationId);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Delete all instances linked to this parent, plus the parent itself
  const resultInstances = ctx.sqlite.prepare(
    'DELETE FROM avtaler WHERE original_avtale_id = ? AND organization_id = ?'
  ).run(parentId, organizationId);

  const resultParent = ctx.sqlite.prepare(
    'DELETE FROM avtaler WHERE id = ? AND organization_id = ?'
  ).run(parentId, organizationId);

  return resultInstances.changes + resultParent.changes;
}

/**
 * Customer (kunder) database queries.
 * Handles CRUD operations, services, search, kontroll alerts, and bulk operations.
 */

import { dbLogger } from '../logger';
import type { DatabaseContext, Kunde } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============ KUNDER CRUD ============

export async function getAllKunder(ctx: DatabaseContext, organizationId: number): Promise<Kunde[]> {
  ctx.validateTenantContext(organizationId, 'getAllKunder');

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getAllKunderWithServices(organizationId);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sql = 'SELECT * FROM kunder WHERE organization_id = ? ORDER BY navn COLLATE NOCASE';
  return ctx.sqlite.prepare(sql).all(organizationId) as Kunde[];
}

export async function getAllKunderPaginated(
  ctx: DatabaseContext,
  organizationId: number,
  options: { limit?: number; offset?: number; search?: string; kategori?: string; status?: string } = {}
): Promise<{ data: Kunde[]; total: number; limit: number; offset: number }> {
  const { limit = 100, offset = 0, search, kategori, status } = options;

  if (ctx.type === 'supabase') {
    const client = await ctx.getSupabaseClient();
    let query = (client as any)
      .from('kunder')
      .select('*', { count: 'exact' })
      .eq('organization_id', organizationId)
      .order('navn', { ascending: true });

    if (search) {
      query = query.or(`navn.ilike.%${search}%,adresse.ilike.%${search}%,poststed.ilike.%${search}%`);
    }
    if (kategori) {
      query = query.eq('kategori', kategori);
    }
    if (status) {
      query = query.eq('status', status);
    }

    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) throw error;

    return { data: (data || []) as Kunde[], total: count || 0, limit, offset };
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const conditions: string[] = ['organization_id = ?'];
  const params: (string | number)[] = [organizationId];

  if (search) {
    conditions.push('(navn LIKE ? OR adresse LIKE ? OR poststed LIKE ?)');
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  if (kategori) {
    conditions.push('kategori = ?');
    params.push(kategori);
  }

  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const whereClause = conditions.join(' AND ');

  const countSql = `SELECT COUNT(*) as total FROM kunder WHERE ${whereClause}`;
  const countResult = ctx.sqlite.prepare(countSql).get(...params) as { total: number };
  const total = countResult.total;

  const dataSql = `
    SELECT * FROM kunder
    WHERE ${whereClause}
    ORDER BY navn COLLATE NOCASE
    LIMIT ? OFFSET ?
  `;
  const data = ctx.sqlite.prepare(dataSql).all(...params, limit, offset) as Kunde[];

  return { data, total, limit, offset };
}

export async function getKundeById(ctx: DatabaseContext, id: number, organizationId: number): Promise<Kunde | null> {
  ctx.validateTenantContext(organizationId, 'getKundeById');

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getKundeByIdWithServices(id, organizationId);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sql = 'SELECT * FROM kunder WHERE id = ? AND organization_id = ?';
  const result = ctx.sqlite.prepare(sql).get(id, organizationId);

  return (result as Kunde) || null;
}

export async function createKunde(ctx: DatabaseContext, data: Partial<Kunde> & { custom_data?: string }): Promise<Kunde> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.createKunde(data);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const stmt = ctx.sqlite.prepare(`
    INSERT INTO kunder (
      navn, adresse, postnummer, poststed, telefon, epost, lat, lng, notater, kategori,
      siste_el_kontroll, neste_el_kontroll, el_kontroll_intervall,
      siste_brann_kontroll, neste_brann_kontroll, brann_kontroll_intervall,
      el_type, brann_system, brann_driftstype, organization_id, kontaktperson, custom_data,
      org_nummer
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    data.navn,
    data.adresse,
    data.postnummer,
    data.poststed,
    data.telefon,
    data.epost,
    data.lat,
    data.lng,
    data.notater,
    data.kategori || 'El-Kontroll',
    data.siste_el_kontroll,
    data.neste_el_kontroll,
    data.el_kontroll_intervall || 36,
    data.siste_brann_kontroll,
    data.neste_brann_kontroll,
    data.brann_kontroll_intervall || 12,
    data.el_type,
    data.brann_system,
    data.brann_driftstype,
    data.organization_id,
    data.kontaktperson || null,
    data.custom_data || '{}',
    data.org_nummer || null
  );

  return { ...data, id: Number(result.lastInsertRowid) } as Kunde;
}

export async function updateKunde(
  ctx: DatabaseContext,
  id: number,
  data: Partial<Kunde>,
  organizationId: number
): Promise<Kunde | null> {
  ctx.validateTenantContext(organizationId, 'updateKunde');

  const existing = await getKundeById(ctx, id, organizationId);
  if (!existing) return null;

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.updateKunde(id, data, organizationId);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const fields: string[] = [];
  const values: unknown[] = [];

  const updateableFields = [
    'navn', 'adresse', 'postnummer', 'poststed', 'telefon', 'epost',
    'lat', 'lng', 'notater', 'kategori', 'el_type', 'brann_system', 'brann_driftstype',
    'siste_el_kontroll', 'neste_el_kontroll', 'el_kontroll_intervall',
    'siste_brann_kontroll', 'neste_brann_kontroll', 'brann_kontroll_intervall',
    'siste_kontroll', 'neste_kontroll', 'kontroll_intervall_mnd',
    'prosjektnummer', 'kundenummer', 'faktura_epost',
    'external_source', 'external_id', 'last_sync_at',
    'lifecycle_stage', 'inquiry_sent_date', 'last_visit_date', 'job_confirmed_type',
  ];

  for (const field of updateableFields) {
    if (field in data) {
      fields.push(`${field} = ?`);
      values.push((data as Record<string, unknown>)[field]);
    }
  }

  if (fields.length === 0) {
    return existing;
  }

  values.push(id, organizationId);

  const sql = `UPDATE kunder SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`;
  ctx.sqlite.prepare(sql).run(...values);

  return getKundeById(ctx, id, organizationId);
}

export async function deleteKunde(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'deleteKunde');

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.deleteKunde(id, organizationId);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sql = 'DELETE FROM kunder WHERE id = ? AND organization_id = ?';
  const result = ctx.sqlite.prepare(sql).run(id, organizationId);

  return result.changes > 0;
}

// ============ CUSTOMER SERVICES ============

export async function saveCustomerServices(
  ctx: DatabaseContext,
  kundeId: number,
  services: Array<{
    service_type_id: number;
    service_type_slug?: string;
    siste_kontroll?: string | null;
    neste_kontroll?: string | null;
    intervall_months?: number | null;
  }>,
  organizationId: number
): Promise<void> {
  if (services.length === 0) return;

  if (ctx.type === 'supabase' && ctx.supabase) {
    const activeIds = services.map(s => s.service_type_id).filter(Boolean);
    await Promise.all([
      ctx.supabase.createOrUpdateCustomerServices(kundeId, services),
      ctx.supabase.deactivateCustomerServices(kundeId, activeIds),
    ]);
    return;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  for (const s of services) {
    const existing = ctx.sqlite.prepare(
      'SELECT id FROM customer_services WHERE kunde_id = ? AND service_type_id = ?'
    ).get(kundeId, s.service_type_id) as { id: number } | undefined;

    if (existing) {
      ctx.sqlite.prepare(`
        UPDATE customer_services SET siste_kontroll = ?, neste_kontroll = ?, intervall_months = ?, aktiv = 1
        WHERE id = ?
      `).run(s.siste_kontroll || null, s.neste_kontroll || null, s.intervall_months || null, existing.id);
    } else {
      ctx.sqlite.prepare(`
        INSERT INTO customer_services (kunde_id, service_type_id, siste_kontroll, neste_kontroll, intervall_months, aktiv)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(kundeId, s.service_type_id, s.siste_kontroll || null, s.neste_kontroll || null, s.intervall_months || null);
    }
  }

  const activeIds = services.map(s => s.service_type_id).filter(Boolean);
  if (activeIds.length > 0) {
    ctx.sqlite.prepare(`
      UPDATE customer_services SET aktiv = 0
      WHERE kunde_id = ? AND service_type_id NOT IN (${activeIds.map(() => '?').join(',')})
    `).run(kundeId, ...activeIds);
  } else {
    ctx.sqlite.prepare('UPDATE customer_services SET aktiv = 0 WHERE kunde_id = ?').run(kundeId);
  }
}

// ============ SEARCH & FILTERS ============

export async function getKunderByOmrade(ctx: DatabaseContext, omrade: string, organizationId: number): Promise<Kunde[]> {
  ctx.validateTenantContext(organizationId, 'getKunderByOmrade');

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getKunderByOmrade(omrade, organizationId);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sql = 'SELECT * FROM kunder WHERE organization_id = ? AND (poststed LIKE ? OR adresse LIKE ?) ORDER BY navn COLLATE NOCASE';
  const pattern = `%${omrade}%`;
  return ctx.sqlite.prepare(sql).all(organizationId, pattern, pattern) as Kunde[];
}

/**
 * Get customers with upcoming control deadlines.
 * Requires getOrganizationById for app_mode check.
 */
export async function getKontrollVarsler(
  ctx: DatabaseContext,
  dager: number,
  organizationId: number,
  getOrganizationById: (id: number) => Promise<any>
): Promise<Kunde[]> {
  ctx.validateTenantContext(organizationId, 'getKontrollVarsler');

  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getKontrollVarsler(dager, organizationId);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const org = await getOrganizationById(organizationId);
  const appMode = org?.app_mode ?? 'mvp';

  if (appMode === 'full') {
    const params = [organizationId, dager, dager, dager, dager];
    const sql = `
      SELECT * FROM kunder
      WHERE organization_id = ? AND kategori IN ('El-Kontroll', 'Brannvarsling', 'El-Kontroll + Brannvarsling')
        AND (
          (kategori IN ('El-Kontroll', 'El-Kontroll + Brannvarsling') AND
            (neste_el_kontroll <= date('now', '+' || ? || ' days')
            OR (neste_el_kontroll IS NULL AND siste_el_kontroll IS NOT NULL
                AND CASE WHEN COALESCE(el_kontroll_intervall, 36) < 0 THEN date(siste_el_kontroll, '+' || ABS(COALESCE(el_kontroll_intervall, 36)) || ' days') ELSE date(siste_el_kontroll, '+' || COALESCE(el_kontroll_intervall, 36) || ' months') END <= date('now', '+' || ? || ' days'))
            OR (neste_el_kontroll IS NULL AND siste_el_kontroll IS NULL)))
          OR (kategori IN ('Brannvarsling', 'El-Kontroll + Brannvarsling') AND
            (neste_brann_kontroll <= date('now', '+' || ? || ' days')
            OR (neste_brann_kontroll IS NULL AND siste_brann_kontroll IS NOT NULL
                AND CASE WHEN COALESCE(brann_kontroll_intervall, 12) < 0 THEN date(siste_brann_kontroll, '+' || ABS(COALESCE(brann_kontroll_intervall, 12)) || ' days') ELSE date(siste_brann_kontroll, '+' || COALESCE(brann_kontroll_intervall, 12) || ' months') END <= date('now', '+' || ? || ' days'))
            OR (neste_brann_kontroll IS NULL AND siste_brann_kontroll IS NULL)))
        )
      ORDER BY navn COLLATE NOCASE
    `;
    return ctx.sqlite.prepare(sql).all(...params) as Kunde[];
  }

  // MVP mode
  const params = [organizationId, dager, dager];
  const sql = `
    SELECT * FROM kunder
    WHERE organization_id = ?
      AND (
        neste_kontroll <= date('now', '+' || ? || ' days')
        OR (neste_kontroll IS NULL AND siste_kontroll IS NOT NULL
            AND CASE WHEN COALESCE(kontroll_intervall_mnd, 12) < 0 THEN date(siste_kontroll, '+' || ABS(COALESCE(kontroll_intervall_mnd, 12)) || ' days') ELSE date(siste_kontroll, '+' || COALESCE(kontroll_intervall_mnd, 12) || ' months') END <= date('now', '+' || ? || ' days'))
        OR (neste_kontroll IS NULL AND siste_kontroll IS NULL AND kontroll_intervall_mnd IS NOT NULL)
      )
    ORDER BY navn COLLATE NOCASE
  `;
  return ctx.sqlite.prepare(sql).all(...params) as Kunde[];
}

// ============ BULK OPERATIONS ============

export async function bulkCompleteKontroll(
  ctx: DatabaseContext,
  kundeIds: number[],
  type: 'el' | 'brann' | 'begge',
  dato: string,
  organizationId: number
): Promise<number> {
  ctx.validateTenantContext(organizationId, 'bulkCompleteKontroll');

  if (!ctx.sqlite) throw new Error('Database not initialized (bulk complete not supported in Supabase yet)');

  if (kundeIds.length === 0) return 0;

  const placeholders = kundeIds.map(() => '?').join(',');
  const fetchSql = `SELECT id, el_kontroll_intervall FROM kunder WHERE id IN (${placeholders}) AND organization_id = ?`;

  const params = [...kundeIds, organizationId];
  const validKunder = ctx.sqlite.prepare(fetchSql).all(...params) as Array<{ id: number; el_kontroll_intervall: number | null }>;

  if (validKunder.length === 0) return 0;

  const intervalMap = new Map<number, number>();
  for (const k of validKunder) {
    intervalMap.set(k.id, k.el_kontroll_intervall || 36);
  }

  const transaction = ctx.sqlite.transaction(() => {
    let updated = 0;

    const updateElStmt = ctx.sqlite!.prepare(`
      UPDATE kunder SET siste_el_kontroll = ?, neste_el_kontroll = ? WHERE id = ?
    `);
    const updateBrannStmt = ctx.sqlite!.prepare(`
      UPDATE kunder SET siste_brann_kontroll = ?, neste_brann_kontroll = ? WHERE id = ?
    `);
    const updateBothStmt = ctx.sqlite!.prepare(`
      UPDATE kunder SET siste_el_kontroll = ?, neste_el_kontroll = ?, siste_brann_kontroll = ?, neste_brann_kontroll = ? WHERE id = ?
    `);

    for (const kunde of validKunder) {
      const elInterval = intervalMap.get(kunde.id) || 36;

      if (type === 'begge') {
        const nextElDate = new Date(dato);
        nextElDate.setMonth(nextElDate.getMonth() + elInterval);
        const nextBrannDate = new Date(dato);
        nextBrannDate.setMonth(nextBrannDate.getMonth() + 12);

        const result = updateBothStmt.run(
          dato,
          nextElDate.toISOString().split('T')[0],
          dato,
          nextBrannDate.toISOString().split('T')[0],
          kunde.id
        );
        if (result.changes > 0) updated++;
      } else if (type === 'el') {
        const nextDate = new Date(dato);
        nextDate.setMonth(nextDate.getMonth() + elInterval);

        const result = updateElStmt.run(dato, nextDate.toISOString().split('T')[0], kunde.id);
        if (result.changes > 0) updated++;
      } else if (type === 'brann') {
        const nextDate = new Date(dato);
        nextDate.setMonth(nextDate.getMonth() + 12);

        const result = updateBrannStmt.run(dato, nextDate.toISOString().split('T')[0], kunde.id);
        if (result.changes > 0) updated++;
      }
    }

    return updated;
  });

  return transaction();
}

/**
 * Mark customers as visited.
 * Requires cross-domain access: getOrganizationServiceTypes for interval lookup.
 */
export async function markVisited(
  ctx: DatabaseContext,
  kundeIds: number[],
  visitedDate: string,
  serviceTypeSlugs: string[],
  organizationId: number,
  getOrganizationServiceTypes: (orgId: number) => Promise<Array<{ slug: string; default_interval_months?: number }>>
): Promise<number> {
  ctx.validateTenantContext(organizationId, 'markVisited');
  if (kundeIds.length === 0) return 0;

  let serviceTypes: Array<{ slug: string; default_interval_months: number }> = [];
  if (serviceTypeSlugs.length > 0) {
    const allTypes = await getOrganizationServiceTypes(organizationId);
    serviceTypes = allTypes
      .filter(st => serviceTypeSlugs.includes(st.slug))
      .map(st => ({ slug: st.slug, default_interval_months: st.default_interval_months || 12 }));
  }

  let updated = 0;

  for (const kundeId of kundeIds) {
    const kunde = await getKundeById(ctx, kundeId, organizationId);
    if (!kunde) continue;

    const updateData: Record<string, unknown> = {
      last_visit_date: visitedDate,
    };

    if (serviceTypes.length > 0) {
      const shortestInterval = Math.min(...serviceTypes.map(st => st.default_interval_months));
      const nextGenericDate = new Date(visitedDate);
      nextGenericDate.setMonth(nextGenericDate.getMonth() + shortestInterval);
      updateData.siste_kontroll = visitedDate;
      updateData.neste_kontroll = nextGenericDate.toISOString().split('T')[0];

      for (const st of serviceTypes) {
        const interval = st.default_interval_months;
        if (st.slug === 'el-kontroll') {
          const nextDate = new Date(visitedDate);
          nextDate.setMonth(nextDate.getMonth() + interval);
          updateData.siste_el_kontroll = visitedDate;
          updateData.neste_el_kontroll = nextDate.toISOString().split('T')[0];
          updateData.el_kontroll_intervall = interval;
        } else if (st.slug === 'brannvarsling') {
          const nextDate = new Date(visitedDate);
          nextDate.setMonth(nextDate.getMonth() + interval);
          updateData.siste_brann_kontroll = visitedDate;
          updateData.neste_brann_kontroll = nextDate.toISOString().split('T')[0];
          updateData.brann_kontroll_intervall = interval;
        }
      }
    }

    const result = await updateKunde(ctx, kundeId, updateData as Partial<Kunde>, organizationId);
    if (result) updated++;
  }

  return updated;
}

// ============ ORGANIZATION CUSTOMER COUNTS ============

export async function countOrganizationKunder(ctx: DatabaseContext, organizationId: number): Promise<number> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { count, error } = await (supabase as any)
      .from('kunder')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    if (error) {
      dbLogger.warn({ error, organizationId }, 'Failed to count kunder in Supabase');
      return 0;
    }

    return count || 0;
  }

  if (!ctx.sqlite) return 0;

  const result = ctx.sqlite.prepare(`
    SELECT COUNT(*) as count FROM kunder WHERE organization_id = ?
  `).get(organizationId) as { count: number };

  return result?.count || 0;
}

export async function getOrganizationLimits(
  ctx: DatabaseContext,
  organizationId: number,
  getOrganizationById: (id: number) => Promise<any>
): Promise<{ max_kunder: number; current_count: number } | null> {
  const org = await getOrganizationById(organizationId);
  if (!org) return null;

  const currentCount = await countOrganizationKunder(ctx, organizationId);

  return {
    max_kunder: org.max_kunder || 200,
    current_count: currentCount,
  };
}

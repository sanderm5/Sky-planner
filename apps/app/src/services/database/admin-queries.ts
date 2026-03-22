/**
 * Admin, organization, stats, reports, features, service types, and patch notes queries.
 * Extracted from DatabaseService for modular organization.
 */

import type { DatabaseContext, Organization, OrganizationServiceType, KlientRecord } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============ ORGANIZATION MANAGEMENT (SUPER ADMIN) ============

export async function getAllOrganizations(ctx: DatabaseContext): Promise<Organization[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getAllOrganizations();
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  return ctx.sqlite.prepare(`
    SELECT * FROM organizations
    ORDER BY navn COLLATE NOCASE
  `).all() as Organization[];
}

/**
 * Get customer count for an organization (for super admin)
 */
export async function getKundeCountForOrganization(ctx: DatabaseContext, organizationId: number): Promise<number> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getKundeCountForOrganization(organizationId);
  }

  if (!ctx.sqlite) return 0;

  const result = ctx.sqlite.prepare(`
    SELECT COUNT(*) as count FROM kunder WHERE organization_id = ?
  `).get(organizationId) as { count: number };

  return result?.count || 0;
}

/**
 * Get user (klient) count for an organization (for super admin)
 */
export async function getBrukerCountForOrganization(ctx: DatabaseContext, organizationId: number): Promise<number> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getBrukerCountForOrganization(organizationId);
  }

  if (!ctx.sqlite) return 0;

  const result = ctx.sqlite.prepare(`
    SELECT COUNT(*) as count FROM klient WHERE organization_id = ? AND aktiv = 1
  `).get(organizationId) as { count: number };

  return result?.count || 0;
}

/**
 * Update organization (for super admin)
 */
export async function updateOrganization(ctx: DatabaseContext, id: number, data: Record<string, unknown>): Promise<Organization | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.updateOrganization(id, data);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }

  if (fields.length === 0) {
    // No fields to update, return current org
    const result = ctx.sqlite.prepare('SELECT * FROM organizations WHERE id = ? AND aktiv = 1').get(id);
    return (result as Organization) || null;
  }

  values.push(id);
  ctx.sqlite.prepare(`
    UPDATE organizations SET ${fields.join(', ')} WHERE id = ?
  `).run(...values);

  const result = ctx.sqlite.prepare('SELECT * FROM organizations WHERE id = ? AND aktiv = 1').get(id);
  return (result as Organization) || null;
}

/**
 * Delete organization and all related data (for super admin)
 * This is a hard delete that permanently removes all data.
 */
export async function deleteOrganization(ctx: DatabaseContext, id: number): Promise<boolean> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    // For Supabase, use a transaction via RPC or delete in order
    const client = ctx.supabase.getClient();

    // Delete in order to respect foreign keys
    // kontaktlogg references kunder
    await client.from('kontaktlogg').delete().eq('organization_id', id);

    // email_innstillinger references kunder
    const { data: kunder } = await client.from('kunder').select('id').eq('organization_id', id);
    if (kunder && kunder.length > 0) {
      const kundeIds = kunder.map((k: { id: number }) => k.id);
      await client.from('email_innstillinger').delete().in('kunde_id', kundeIds);
    }

    // rute_kunder references ruter
    const { data: ruter } = await client.from('ruter').select('id').eq('organization_id', id);
    if (ruter && ruter.length > 0) {
      const ruteIds = ruter.map((r: { id: number }) => r.id);
      await client.from('rute_kunder').delete().in('rute_id', ruteIds);
    }

    // organization_field_options references organization_fields
    const { data: fields } = await client.from('organization_fields').select('id').eq('organization_id', id);
    if (fields && fields.length > 0) {
      const fieldIds = fields.map((f: { id: number }) => f.id);
      await client.from('organization_field_options').delete().in('field_id', fieldIds);
    }

    // Delete main tables
    await client.from('email_varsler').delete().eq('organization_id', id);
    await client.from('avtaler').delete().eq('organization_id', id);
    await client.from('ruter').delete().eq('organization_id', id);
    await client.from('kunder').delete().eq('organization_id', id);
    await client.from('organization_integrations').delete().eq('organization_id', id);
    await client.from('integration_sync_log').delete().eq('organization_id', id);
    await client.from('organization_fields').delete().eq('organization_id', id);
    await client.from('mapping_cache').delete().eq('organization_id', id);
    await client.from('api_keys').delete().eq('organization_id', id);
    await client.from('webhook_deliveries').delete().eq('organization_id', id);
    await client.from('webhook_endpoints').delete().eq('organization_id', id);
    await client.from('login_logg').delete().eq('organization_id', id);
    await client.from('klient').delete().eq('organization_id', id);

    // Finally delete the organization
    const { error } = await client.from('organizations').delete().eq('id', id);

    return !error;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Use transaction for SQLite to ensure atomicity
  const transaction = ctx.sqlite.transaction(() => {
    // Delete kontaktlogg (references kunder)
    ctx.sqlite!.prepare('DELETE FROM kontaktlogg WHERE kunde_id IN (SELECT id FROM kunder WHERE organization_id = ?)').run(id);

    // Delete email_innstillinger (references kunder)
    ctx.sqlite!.prepare('DELETE FROM email_innstillinger WHERE kunde_id IN (SELECT id FROM kunder WHERE organization_id = ?)').run(id);

    // Delete email_varsler
    ctx.sqlite!.prepare('DELETE FROM email_varsler WHERE organization_id = ?').run(id);

    // Delete rute_kunder (references ruter)
    ctx.sqlite!.prepare('DELETE FROM rute_kunder WHERE rute_id IN (SELECT id FROM ruter WHERE organization_id = ?)').run(id);

    // Delete avtaler
    ctx.sqlite!.prepare('DELETE FROM avtaler WHERE organization_id = ?').run(id);

    // Delete ruter
    ctx.sqlite!.prepare('DELETE FROM ruter WHERE organization_id = ?').run(id);

    // Delete kunder
    ctx.sqlite!.prepare('DELETE FROM kunder WHERE organization_id = ?').run(id);

    // Delete organization_field_options (references organization_fields)
    ctx.sqlite!.prepare('DELETE FROM organization_field_options WHERE field_id IN (SELECT id FROM organization_fields WHERE organization_id = ?)').run(id);

    // Delete organization_fields
    ctx.sqlite!.prepare('DELETE FROM organization_fields WHERE organization_id = ?').run(id);

    // Delete organization_integrations
    ctx.sqlite!.prepare('DELETE FROM organization_integrations WHERE organization_id = ?').run(id);

    // Delete integration_sync_log
    ctx.sqlite!.prepare('DELETE FROM integration_sync_log WHERE organization_id = ?').run(id);

    // Delete mapping_cache
    ctx.sqlite!.prepare('DELETE FROM mapping_cache WHERE organization_id = ?').run(id);

    // Delete api_keys
    ctx.sqlite!.prepare('DELETE FROM api_keys WHERE organization_id = ?').run(id);

    // Delete webhook_deliveries
    ctx.sqlite!.prepare('DELETE FROM webhook_deliveries WHERE organization_id = ?').run(id);

    // Delete webhook_endpoints
    ctx.sqlite!.prepare('DELETE FROM webhook_endpoints WHERE organization_id = ?').run(id);

    // Delete login_logg
    ctx.sqlite!.prepare('DELETE FROM login_logg WHERE organization_id = ?').run(id);

    // Delete klient (users)
    ctx.sqlite!.prepare('DELETE FROM klient WHERE organization_id = ?').run(id);

    // Finally delete the organization
    const result = ctx.sqlite!.prepare('DELETE FROM organizations WHERE id = ?').run(id);

    return result.changes > 0;
  });

  return transaction();
}

/**
 * Get all users (klienter) for an organization (for super admin)
 */
export async function getKlienterForOrganization(ctx: DatabaseContext, organizationId: number): Promise<KlientRecord[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getKlienterForOrganization(organizationId);
  }

  if (!ctx.sqlite) return [];

  return ctx.sqlite.prepare(`
    SELECT * FROM klient WHERE organization_id = ?
    ORDER BY navn COLLATE NOCASE
  `).all(organizationId) as KlientRecord[];
}

/**
 * Get global statistics (for super admin dashboard)
 */
export async function getGlobalStatistics(ctx: DatabaseContext): Promise<{
  totalOrganizations: number;
  totalCustomers: number;
  totalUsers: number;
  activeSubscriptions: number;
  organizationsByPlan: Record<string, number>;
}> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const stats = await ctx.supabase.getGlobalStatistics();
    return {
      totalOrganizations: stats.totalOrganizations,
      totalCustomers: stats.totalKunder,
      totalUsers: stats.totalUsers,
      activeSubscriptions: stats.activeSubscriptions,
      organizationsByPlan: stats.organizationsByPlan || {},
    };
  }

  if (!ctx.sqlite) {
    return {
      totalOrganizations: 0,
      totalCustomers: 0,
      totalUsers: 0,
      activeSubscriptions: 0,
      organizationsByPlan: {},
    };
  }

  const orgsCount = ctx.sqlite.prepare('SELECT COUNT(*) as count FROM organizations').get() as { count: number };
  const customersCount = ctx.sqlite.prepare('SELECT COUNT(*) as count FROM kunder').get() as { count: number };
  const usersCount = ctx.sqlite.prepare('SELECT COUNT(*) as count FROM klient WHERE aktiv = 1').get() as { count: number };

  const orgs = ctx.sqlite.prepare('SELECT plan_type, subscription_status FROM organizations').all() as Array<{
    plan_type: string | null;
    subscription_status: string | null;
  }>;

  const organizationsByPlan: Record<string, number> = {};
  let activeSubscriptions = 0;

  for (const org of orgs) {
    const plan = org.plan_type || 'free';
    organizationsByPlan[plan] = (organizationsByPlan[plan] || 0) + 1;
    if (org.subscription_status === 'active' || org.subscription_status === 'trialing') {
      activeSubscriptions++;
    }
  }

  return {
    totalOrganizations: orgsCount?.count || 0,
    totalCustomers: customersCount?.count || 0,
    totalUsers: usersCount?.count || 0,
    activeSubscriptions,
    organizationsByPlan,
  };
}

// ============ GROWTH & ACTIVITY STATISTICS ============

export async function getGrowthStatistics(ctx: DatabaseContext, months: number = 12): Promise<{
  organizations: Array<{ month: string; count: number }>;
  customers: Array<{ month: string; count: number }>;
  users: Array<{ month: string; count: number }>;
}> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    // Supabase implementation
    const client = ctx.supabase.getClient();

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const { data: orgs } = await client
      .from('organizations')
      .select('created_at')
      .gte('created_at', startDate.toISOString());

    const { data: customers } = await client
      .from('kunder')
      .select('opprettet')
      .gte('opprettet', startDate.toISOString());

    const { data: users } = await client
      .from('klient')
      .select('opprettet')
      .gte('opprettet', startDate.toISOString());

    return {
      organizations: aggregateByMonth(orgs || [], 'created_at'),
      customers: aggregateByMonth(customers || [], 'opprettet'),
      users: aggregateByMonth(users || [], 'opprettet'),
    };
  }

  if (!ctx.sqlite) {
    return { organizations: [], customers: [], users: [] };
  }

  // SQLite implementation
  const organizationsQuery = ctx.sqlite.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
    FROM organizations
    WHERE created_at >= date('now', '-${months} months')
    GROUP BY strftime('%Y-%m', created_at)
    ORDER BY month ASC
  `).all() as Array<{ month: string; count: number }>;

  const customersQuery = ctx.sqlite.prepare(`
    SELECT strftime('%Y-%m', opprettet) as month, COUNT(*) as count
    FROM kunder
    WHERE opprettet >= date('now', '-${months} months')
    GROUP BY strftime('%Y-%m', opprettet)
    ORDER BY month ASC
  `).all() as Array<{ month: string; count: number }>;

  const usersQuery = ctx.sqlite.prepare(`
    SELECT strftime('%Y-%m', opprettet) as month, COUNT(*) as count
    FROM klient
    WHERE opprettet >= date('now', '-${months} months')
    GROUP BY strftime('%Y-%m', opprettet)
    ORDER BY month ASC
  `).all() as Array<{ month: string; count: number }>;

  return {
    organizations: organizationsQuery,
    customers: customersQuery,
    users: usersQuery,
  };
}

/**
 * Helper to aggregate records by month
 */
export function aggregateByMonth(
  records: Array<{ [key: string]: string | null }>,
  dateField: string
): Array<{ month: string; count: number }> {
  const counts: Record<string, number> = {};

  for (const record of records) {
    const date = record[dateField];
    if (date) {
      const month = date.substring(0, 7); // YYYY-MM
      counts[month] = (counts[month] || 0) + 1;
    }
  }

  return Object.entries(counts)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Get activity statistics (logins, active users)
 */
export async function getActivityStatistics(ctx: DatabaseContext, days: number = 30): Promise<{
  loginsByDay: Array<{ date: string; successful: number; failed: number }>;
  activeUsers7Days: number;
  activeUsers30Days: number;
  totalLogins: number;
}> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data: logins } = await client
      .from('login_logg')
      .select('tidspunkt, status')
      .gte('tidspunkt', startDate.toISOString());

    const active7Query = client
      .from('klient')
      .select('id')
      .gte('sist_innlogget', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .eq('aktiv', true);
    const { data: active7Data } = await active7Query;

    const active30Query = client
      .from('klient')
      .select('id')
      .gte('sist_innlogget', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .eq('aktiv', true);
    const { data: active30Data } = await active30Query;

    const active7 = active7Data?.length || 0;
    const active30 = active30Data?.length || 0;

    return {
      loginsByDay: aggregateLoginsByDay(logins || []),
      activeUsers7Days: active7 || 0,
      activeUsers30Days: active30 || 0,
      totalLogins: logins?.length || 0,
    };
  }

  if (!ctx.sqlite) {
    return { loginsByDay: [], activeUsers7Days: 0, activeUsers30Days: 0, totalLogins: 0 };
  }

  const loginsByDay = ctx.sqlite.prepare(`
    SELECT
      date(tidspunkt) as date,
      SUM(CASE WHEN status = 'vellykket' THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN status = 'feilet' THEN 1 ELSE 0 END) as failed
    FROM login_logg
    WHERE tidspunkt >= date('now', '-${days} days')
    GROUP BY date(tidspunkt)
    ORDER BY date ASC
  `).all() as Array<{ date: string; successful: number; failed: number }>;

  const active7Result = ctx.sqlite.prepare(`
    SELECT COUNT(*) as count FROM klient
    WHERE sist_innlogget >= datetime('now', '-7 days') AND aktiv = 1
  `).get() as { count: number };

  const active30Result = ctx.sqlite.prepare(`
    SELECT COUNT(*) as count FROM klient
    WHERE sist_innlogget >= datetime('now', '-30 days') AND aktiv = 1
  `).get() as { count: number };

  const totalLoginsResult = ctx.sqlite.prepare(`
    SELECT COUNT(*) as count FROM login_logg
    WHERE tidspunkt >= date('now', '-${days} days')
  `).get() as { count: number };

  return {
    loginsByDay,
    activeUsers7Days: active7Result?.count || 0,
    activeUsers30Days: active30Result?.count || 0,
    totalLogins: totalLoginsResult?.count || 0,
  };
}

/**
 * Helper to aggregate logins by day
 */
export function aggregateLoginsByDay(
  logins: Array<{ tidspunkt: string; status: string }>
): Array<{ date: string; successful: number; failed: number }> {
  const counts: Record<string, { successful: number; failed: number }> = {};

  for (const login of logins) {
    const date = login.tidspunkt.substring(0, 10); // YYYY-MM-DD
    if (!counts[date]) {
      counts[date] = { successful: 0, failed: 0 };
    }
    if (login.status === 'vellykket') {
      counts[date].successful++;
    } else {
      counts[date].failed++;
    }
  }

  return Object.entries(counts)
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ============ REPORTS ============

export async function getReportKunderByStatus(ctx: DatabaseContext, organizationId: number): Promise<{ status: string; count: number }[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client.rpc('report_kunder_by_status', { org_id: organizationId });
    if (error) throw error;
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare(`
    SELECT COALESCE(status, 'aktiv') as status, COUNT(*) as count
    FROM kunder WHERE organization_id = ?
    GROUP BY COALESCE(status, 'aktiv')
    ORDER BY count DESC
  `).all(organizationId) as any[];
}

export async function getReportKunderByKategori(ctx: DatabaseContext, organizationId: number): Promise<{ kategori: string; count: number }[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client.rpc('report_kunder_by_kategori', { org_id: organizationId });
    if (error) throw error;
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare(`
    SELECT COALESCE(kategori, 'Annen') as kategori, COUNT(*) as count
    FROM kunder WHERE organization_id = ?
    GROUP BY COALESCE(kategori, 'Annen')
    ORDER BY count DESC
  `).all(organizationId) as any[];
}

export async function getReportKunderByPoststed(ctx: DatabaseContext, organizationId: number, limit: number = 10): Promise<{ poststed: string; count: number }[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client.rpc('report_kunder_by_poststed', { org_id: organizationId, max_rows: limit });
    if (error) throw error;
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare(`
    SELECT COALESCE(poststed, 'Ukjent') as poststed, COUNT(*) as count
    FROM kunder WHERE organization_id = ?
    GROUP BY COALESCE(poststed, 'Ukjent')
    ORDER BY count DESC
    LIMIT ?
  `).all(organizationId, limit) as any[];
}

export async function getReportAvtalerStats(ctx: DatabaseContext, organizationId: number, months: number = 6): Promise<{ total: number; fullfort: number; planlagt: number; by_month: { month: string; count: number }[] }> {
  if (!ctx.sqlite) throw new Error('Database not initialized');

  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const startStr = startDate.toISOString().slice(0, 10);

  const totals = ctx.sqlite.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'fullført' THEN 1 ELSE 0 END) as fullfort,
      SUM(CASE WHEN status = 'planlagt' THEN 1 ELSE 0 END) as planlagt
    FROM avtaler WHERE organization_id = ? AND dato >= ?
  `).get(organizationId, startStr) as any;

  const byMonth = ctx.sqlite.prepare(`
    SELECT strftime('%Y-%m', dato) as month, COUNT(*) as count
    FROM avtaler WHERE organization_id = ? AND dato >= ?
    GROUP BY strftime('%Y-%m', dato)
    ORDER BY month
  `).all(organizationId, startStr) as any[];

  return {
    total: totals?.total || 0,
    fullfort: totals?.fullfort || 0,
    planlagt: totals?.planlagt || 0,
    by_month: byMonth,
  };
}

export async function getReportKontrollStatus(ctx: DatabaseContext, organizationId: number): Promise<{ overdue: number; upcoming_30: number; upcoming_90: number; ok: number }> {
  if (!ctx.sqlite) throw new Error('Database not initialized');

  const now = new Date();
  // Forfalt = kun når kontrollens måned er passert (første dag i inneværende måned)
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const in30Str = in30.toISOString().slice(0, 10);
  const in90 = new Date();
  in90.setDate(in90.getDate() + 90);
  const in90Str = in90.toISOString().slice(0, 10);

  const result = ctx.sqlite.prepare(`
    SELECT
      SUM(CASE WHEN neste_kontroll < ? THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN neste_kontroll >= ? AND neste_kontroll <= ? THEN 1 ELSE 0 END) as upcoming_30,
      SUM(CASE WHEN neste_kontroll > ? AND neste_kontroll <= ? THEN 1 ELSE 0 END) as upcoming_90,
      SUM(CASE WHEN neste_kontroll > ? OR neste_kontroll IS NULL THEN 1 ELSE 0 END) as ok
    FROM kunder WHERE organization_id = ?
  `).get(firstOfMonth, firstOfMonth, in30Str, in30Str, in90Str, in90Str, organizationId) as any;

  return {
    overdue: result?.overdue || 0,
    upcoming_30: result?.upcoming_30 || 0,
    upcoming_90: result?.upcoming_90 || 0,
    ok: result?.ok || 0,
  };
}

// ============ FEATURE FLAGS ============

export async function getAllFeatureDefinitions(ctx: DatabaseContext): Promise<import('../../types').FeatureDefinition[]> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('feature_definitions')
      .select('*')
      .eq('aktiv', true)
      .order('sort_order');
    if (error) throw new Error(`Failed to fetch features: ${error.message}`);
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare('SELECT * FROM feature_definitions WHERE aktiv = 1 ORDER BY sort_order').all() as import('../../types').FeatureDefinition[];
}

export async function getFeatureDefinition(ctx: DatabaseContext, key: string): Promise<import('../../types').FeatureDefinition | null> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('feature_definitions')
      .select('*')
      .eq('key', key)
      .single();
    if (error || !data) return null;
    return data;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('SELECT * FROM feature_definitions WHERE key = ?').get(key);
  return (result as import('../../types').FeatureDefinition) || null;
}

export async function getOrganizationFeatures(ctx: DatabaseContext, organizationId: number): Promise<import('../../types').OrganizationFeature[]> {
  ctx.validateTenantContext(organizationId, 'getOrganizationFeatures');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('organization_features')
      .select('*')
      .eq('organization_id', organizationId);
    if (error) throw new Error(`Failed to fetch org features: ${error.message}`);
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare('SELECT * FROM organization_features WHERE organization_id = ?').all(organizationId) as import('../../types').OrganizationFeature[];
}

export async function getOrganizationFeature(ctx: DatabaseContext, organizationId: number, featureKey: string): Promise<import('../../types').OrganizationFeature | null> {
  ctx.validateTenantContext(organizationId, 'getOrganizationFeature');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('organization_features')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('feature_key', featureKey)
      .single();
    if (error || !data) return null;
    return data;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare(
    'SELECT * FROM organization_features WHERE organization_id = ? AND feature_key = ?'
  ).get(organizationId, featureKey);
  return (result as import('../../types').OrganizationFeature) || null;
}

export async function getEnabledFeatureKeys(ctx: DatabaseContext, organizationId: number): Promise<string[]> {
  ctx.validateTenantContext(organizationId, 'getEnabledFeatureKeys');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('organization_features')
      .select('feature_key')
      .eq('organization_id', organizationId)
      .eq('enabled', true);
    if (error) throw new Error(`Failed to fetch enabled features: ${error.message}`);
    return (data || []).map((f: { feature_key: string }) => f.feature_key);
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const results = ctx.sqlite.prepare(
    'SELECT feature_key FROM organization_features WHERE organization_id = ? AND enabled = 1'
  ).all(organizationId) as { feature_key: string }[];
  return results.map(r => r.feature_key);
}

export async function enableFeature(ctx: DatabaseContext, organizationId: number, featureKey: string, config?: Record<string, unknown>): Promise<import('../../types').OrganizationFeature> {
  ctx.validateTenantContext(organizationId, 'enableFeature');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('organization_features')
      .upsert({
        organization_id: organizationId,
        feature_key: featureKey,
        enabled: true,
        config: config || {},
        activated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,feature_key' })
      .select()
      .single();
    if (error) throw new Error(`Failed to enable feature: ${error.message}`);
    return data;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  ctx.sqlite.prepare(`
    INSERT INTO organization_features (organization_id, feature_key, enabled, config, activated_at)
    VALUES (?, ?, 1, ?, datetime('now'))
    ON CONFLICT(organization_id, feature_key) DO UPDATE SET enabled = 1, config = ?, activated_at = datetime('now')
  `).run(organizationId, featureKey, JSON.stringify(config || {}), JSON.stringify(config || {}));
  return (await getOrganizationFeature(ctx, organizationId, featureKey))!;
}

export async function disableFeature(ctx: DatabaseContext, organizationId: number, featureKey: string): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'disableFeature');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { error } = await supabase
      .from('organization_features')
      .update({ enabled: false })
      .eq('organization_id', organizationId)
      .eq('feature_key', featureKey);
    if (error) throw new Error(`Failed to disable feature: ${error.message}`);
    return true;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  ctx.sqlite.prepare(
    'UPDATE organization_features SET enabled = 0 WHERE organization_id = ? AND feature_key = ?'
  ).run(organizationId, featureKey);
  return true;
}

export async function updateFeatureConfig(ctx: DatabaseContext, organizationId: number, featureKey: string, config: Record<string, unknown>): Promise<import('../../types').OrganizationFeature | null> {
  ctx.validateTenantContext(organizationId, 'updateFeatureConfig');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('organization_features')
      .update({ config })
      .eq('organization_id', organizationId)
      .eq('feature_key', featureKey)
      .select()
      .single();
    if (error) throw new Error(`Failed to update feature config: ${error.message}`);
    return data;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  ctx.sqlite.prepare(
    'UPDATE organization_features SET config = ? WHERE organization_id = ? AND feature_key = ?'
  ).run(JSON.stringify(config), organizationId, featureKey);
  return getOrganizationFeature(ctx, organizationId, featureKey);
}

export async function getEnabledFeaturesWithConfig(ctx: DatabaseContext, organizationId: number): Promise<{ key: string; config: Record<string, unknown> }[]> {
  ctx.validateTenantContext(organizationId, 'getEnabledFeaturesWithConfig');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    // Get explicitly enabled features
    const { data: orgFeatures } = await client
      .from('organization_features')
      .select('feature_key, config')
      .eq('organization_id', organizationId)
      .eq('enabled', true);
    // Get default-enabled features
    const { data: defaults } = await client
      .from('feature_definitions')
      .select('key')
      .eq('default_enabled', true)
      .eq('aktiv', true);

    const result: { key: string; config: Record<string, unknown> }[] = [];
    const seen = new Set<string>();

    for (const f of orgFeatures || []) {
      result.push({ key: f.feature_key, config: f.config || {} });
      seen.add(f.feature_key);
    }
    for (const d of defaults || []) {
      if (!seen.has(d.key)) {
        result.push({ key: d.key, config: {} });
      }
    }
    return result;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Combine org-specific features + default-enabled features
  const rows = ctx.sqlite.prepare(`
    SELECT DISTINCT COALESCE(of2.feature_key, fd.key) as key, COALESCE(of2.config, '{}') as config
    FROM feature_definitions fd
    LEFT JOIN organization_features of2 ON fd.key = of2.feature_key AND of2.organization_id = ? AND of2.enabled = 1
    WHERE fd.aktiv = 1 AND (of2.enabled = 1 OR fd.default_enabled = 1)
  `).all(organizationId) as Array<{ key: string; config: string }>;

  return rows.map(r => ({ key: r.key, config: JSON.parse(r.config || '{}') }));
}

// ============ PATCH NOTES / CHANGELOG ============

export async function getPatchNotes(ctx: DatabaseContext, limit?: number): Promise<import('../../types').PatchNote[]> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    let query = supabase
      .from('patch_notes')
      .select('*')
      .eq('aktiv', true)
      .order('published_at', { ascending: false });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch patch notes: ${error.message}`);
    return (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []),
    })) as unknown as import('../../types').PatchNote[];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const sql = limit
    ? 'SELECT * FROM patch_notes WHERE aktiv = 1 ORDER BY published_at DESC LIMIT ?'
    : 'SELECT * FROM patch_notes WHERE aktiv = 1 ORDER BY published_at DESC';
  const rows = (limit ? ctx.sqlite.prepare(sql).all(limit) : ctx.sqlite.prepare(sql).all()) as Record<string, unknown>[];
  return rows.map(r => ({ ...r, items: JSON.parse((r.items as string) || '[]'), aktiv: !!r.aktiv })) as unknown as import('../../types').PatchNote[];
}

export async function getPatchNotesSince(ctx: DatabaseContext, sinceId: number): Promise<import('../../types').PatchNote[]> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('patch_notes')
      .select('*')
      .eq('aktiv', true)
      .gt('id', sinceId)
      .order('published_at', { ascending: false });
    if (error) throw new Error(`Failed to fetch patch notes: ${error.message}`);
    return (data || []).map((row: Record<string, unknown>) => ({
      ...row,
      items: typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []),
    })) as unknown as import('../../types').PatchNote[];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const rows = ctx.sqlite.prepare(
    'SELECT * FROM patch_notes WHERE aktiv = 1 AND id > ? ORDER BY published_at DESC'
  ).all(sinceId) as Record<string, unknown>[];
  return rows.map(r => ({ ...r, items: JSON.parse((r.items as string) || '[]'), aktiv: !!r.aktiv })) as unknown as import('../../types').PatchNote[];
}

export async function getLatestPatchNoteId(ctx: DatabaseContext): Promise<number> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('patch_notes')
      .select('id')
      .eq('aktiv', true)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch latest patch note: ${error.message}`);
    return data?.id ?? 0;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const row = ctx.sqlite.prepare(
    'SELECT id FROM patch_notes WHERE aktiv = 1 ORDER BY published_at DESC LIMIT 1'
  ).get() as { id: number } | undefined;
  return row?.id ?? 0;
}

// ============ ORGANIZATION SERVICE TYPES ============

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function getOrganizationServiceTypes(ctx: DatabaseContext, organizationId: number): Promise<OrganizationServiceType[]> {
  ctx.validateTenantContext(organizationId, 'getOrganizationServiceTypes');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('organization_service_types')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('aktiv', true)
      .order('sort_order', { ascending: true });
    if (error) throw new Error(`Failed to fetch service types: ${error.message}`);
    return (data || []) as OrganizationServiceType[];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare(
    'SELECT * FROM organization_service_types WHERE organization_id = ? AND aktiv = 1 ORDER BY sort_order ASC'
  ).all(organizationId) as OrganizationServiceType[];
}

export async function createOrganizationServiceType(
  ctx: DatabaseContext,
  organizationId: number,
  data: { name: string; slug?: string; icon?: string; color?: string; default_interval_months?: number; description?: string; sort_order?: number; source?: string; source_ref?: string }
): Promise<OrganizationServiceType> {
  ctx.validateTenantContext(organizationId, 'createOrganizationServiceType');
  const slug = data.slug || slugify(data.name);

  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data: result, error } = await supabase
      .from('organization_service_types')
      .insert({
        organization_id: organizationId,
        name: data.name,
        slug,
        icon: data.icon || 'fa-wrench',
        color: data.color || '#F97316',
        default_interval_months: data.default_interval_months || 12,
        description: data.description || null,
        sort_order: data.sort_order || 0,
        source: data.source || 'manual',
        source_ref: data.source_ref || null,
      })
      .select()
      .single();
    if (error) throw new Error(`Failed to create service type: ${error.message}`);
    return result as OrganizationServiceType;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const info = ctx.sqlite.prepare(`
    INSERT INTO organization_service_types (organization_id, name, slug, icon, color, default_interval_months, description, sort_order, source, source_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    organizationId, data.name, slug,
    data.icon || 'fa-wrench', data.color || '#F97316',
    data.default_interval_months || 12, data.description || null,
    data.sort_order || 0, data.source || 'manual', data.source_ref || null
  );
  return ctx.sqlite.prepare('SELECT * FROM organization_service_types WHERE id = ?').get(Number(info.lastInsertRowid)) as OrganizationServiceType;
}

export async function updateOrganizationServiceType(
  ctx: DatabaseContext,
  organizationId: number,
  id: number,
  data: Partial<{ name: string; slug: string; icon: string; color: string; default_interval_months: number; description: string; sort_order: number }>
): Promise<OrganizationServiceType | null> {
  ctx.validateTenantContext(organizationId, 'updateOrganizationServiceType');

  // Auto-update slug if name changes and slug not explicitly provided
  if (data.name && !data.slug) {
    data.slug = slugify(data.name);
  }

  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data: result, error } = await supabase
      .from('organization_service_types')
      .update(data)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();
    if (error) throw new Error(`Failed to update service type: ${error.message}`);
    return result as OrganizationServiceType;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const values = Object.values(data);
  ctx.sqlite.prepare(`UPDATE organization_service_types SET ${fields} WHERE id = ? AND organization_id = ?`).run(...values, id, organizationId);
  return ctx.sqlite.prepare('SELECT * FROM organization_service_types WHERE id = ? AND organization_id = ?').get(id, organizationId) as OrganizationServiceType | null;
}

export async function renameCustomerCategory(ctx: DatabaseContext, organizationId: number, oldName: string, newName: string): Promise<number> {
  ctx.validateTenantContext(organizationId, 'renameCustomerCategory');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('kunder')
      .update({ kategori: newName })
      .eq('organization_id', organizationId)
      .eq('kategori', oldName)
      .select('id');
    if (error) throw new Error(`Failed to rename customer category: ${error.message}`);
    return data?.length || 0;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('UPDATE kunder SET kategori = ? WHERE organization_id = ? AND kategori = ?').run(newName, organizationId, oldName);
  return result.changes;
}

export async function deleteOrganizationServiceType(ctx: DatabaseContext, organizationId: number, id: number): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'deleteOrganizationServiceType');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { error } = await supabase
      .from('organization_service_types')
      .update({ aktiv: false })
      .eq('id', id)
      .eq('organization_id', organizationId);
    if (error) throw new Error(`Failed to delete service type: ${error.message}`);
    return true;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  ctx.sqlite.prepare('UPDATE organization_service_types SET aktiv = 0 WHERE id = ? AND organization_id = ?').run(id, organizationId);
  return true;
}

export async function copyTemplateServiceTypes(ctx: DatabaseContext, organizationId: number, templateId: number): Promise<OrganizationServiceType[]> {
  ctx.validateTenantContext(organizationId, 'copyTemplateServiceTypes');
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    // Fetch template service types
    const { data: templates, error: fetchError } = await supabase
      .from('template_service_types')
      .select('*')
      .eq('template_id', templateId)
      .eq('aktiv', true)
      .order('sort_order', { ascending: true });
    if (fetchError) throw new Error(`Failed to fetch template service types: ${fetchError.message}`);
    if (!templates || templates.length === 0) return [];

    // Insert as org service types (ignore conflicts)
    const rows = templates.map((t: Record<string, unknown>) => ({
      organization_id: organizationId,
      name: t.name,
      slug: t.slug,
      icon: t.icon || 'fa-wrench',
      color: t.color || '#F97316',
      default_interval_months: t.default_interval_months || 12,
      description: t.description || null,
      sort_order: t.sort_order || 0,
      source: 'template',
      source_ref: String(t.id),
    }));

    const { data: result, error: insertError } = await supabase
      .from('organization_service_types')
      .upsert(rows, { onConflict: 'organization_id,slug', ignoreDuplicates: true })
      .select();
    if (insertError) throw new Error(`Failed to copy template service types: ${insertError.message}`);
    return (result || []) as OrganizationServiceType[];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const templates = ctx.sqlite.prepare(
    'SELECT * FROM template_service_types WHERE template_id = ? AND aktiv = 1 ORDER BY sort_order ASC'
  ).all(templateId) as any[];
  const results: OrganizationServiceType[] = [];
  for (const t of templates) {
    try {
      ctx.sqlite.prepare(`
        INSERT OR IGNORE INTO organization_service_types (organization_id, name, slug, icon, color, default_interval_months, description, sort_order, source, source_ref)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'template', ?)
      `).run(organizationId, t.name, t.slug, t.icon || 'fa-wrench', t.color || '#F97316', t.default_interval_months || 12, t.description, t.sort_order || 0, String(t.id));
      const row = ctx.sqlite.prepare('SELECT * FROM organization_service_types WHERE organization_id = ? AND slug = ?').get(organizationId, t.slug) as OrganizationServiceType;
      if (row) results.push(row);
    } catch { /* ignore duplicate */ }
  }
  return results;
}

export async function findOrCreateServiceTypeByName(ctx: DatabaseContext, organizationId: number, name: string, source: string = 'manual'): Promise<OrganizationServiceType> {
  ctx.validateTenantContext(organizationId, 'findOrCreateServiceTypeByName');
  const slug = slugify(name);

  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    // Try to find existing
    const { data: existing } = await supabase
      .from('organization_service_types')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('slug', slug)
      .single();
    if (existing) return existing as OrganizationServiceType;

    // Create new
    const { data: created, error } = await supabase
      .from('organization_service_types')
      .insert({
        organization_id: organizationId,
        name,
        slug,
        source,
        source_ref: name,
      })
      .select()
      .single();
    if (error) {
      // Race condition: another request created it
      const { data: retry } = await supabase
        .from('organization_service_types')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('slug', slug)
        .single();
      if (retry) return retry as OrganizationServiceType;
      throw new Error(`Failed to create service type: ${error.message}`);
    }
    return created as OrganizationServiceType;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const existing = ctx.sqlite.prepare(
    'SELECT * FROM organization_service_types WHERE organization_id = ? AND slug = ?'
  ).get(organizationId, slug) as OrganizationServiceType | undefined;
  if (existing) return existing;

  ctx.sqlite.prepare(`
    INSERT INTO organization_service_types (organization_id, name, slug, source, source_ref)
    VALUES (?, ?, ?, ?, ?)
  `).run(organizationId, name, slug, source, name);
  return ctx.sqlite.prepare(
    'SELECT * FROM organization_service_types WHERE organization_id = ? AND slug = ?'
  ).get(organizationId, slug) as OrganizationServiceType;
}

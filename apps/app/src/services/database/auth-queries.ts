/**
 * Authentication database queries.
 * Handles auth lookups, login attempts, account lockout, refresh tokens,
 * token blacklist, sessions, klient/password management.
 */

import { dbLogger } from '../logger';
import type { DatabaseContext, KlientRecord, BrukerRecord, RefreshTokenRecord, Organization } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============ AUTH METHODS ============

export async function getKlientByEpost(ctx: DatabaseContext, epost: string): Promise<KlientRecord | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getKlientByEpost(epost);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite
    .prepare('SELECT * FROM klient WHERE LOWER(epost) = LOWER(?)')
    .get(epost);

  return (result as KlientRecord) || null;
}

export async function getBrukerByEpost(ctx: DatabaseContext, epost: string): Promise<BrukerRecord | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getBrukerByEpost(epost);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  try {
    const result = ctx.sqlite
      .prepare('SELECT * FROM brukere WHERE LOWER(epost) = LOWER(?)')
      .get(epost);
    return (result as BrukerRecord) || null;
  } catch {
    // brukere table might not exist
    return null;
  }
}

export async function getBrukerById(ctx: DatabaseContext, id: number): Promise<BrukerRecord | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getBrukerById(id);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  try {
    const result = ctx.sqlite
      .prepare('SELECT * FROM brukere WHERE id = ?')
      .get(id);
    return (result as BrukerRecord) || null;
  } catch {
    // brukere table might not exist
    return null;
  }
}

export async function updateKlientLastLogin(ctx: DatabaseContext, id: number): Promise<void> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    await ctx.supabase.updateKlientLastLogin(id);
    return;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  ctx.sqlite
    .prepare('UPDATE klient SET sist_innlogget = CURRENT_TIMESTAMP WHERE id = ?')
    .run(id);
}

export async function updateBrukerLastLogin(ctx: DatabaseContext, id: number): Promise<void> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    await ctx.supabase.updateBrukerLastLogin(id);
    return;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  ctx.sqlite
    .prepare('UPDATE brukere SET sist_innlogget = CURRENT_TIMESTAMP WHERE id = ?')
    .run(id);
}

export async function getOrganizationById(ctx: DatabaseContext, id: number): Promise<Organization | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getOrganizationById(id);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite
    .prepare('SELECT * FROM organizations WHERE id = ? AND aktiv = 1')
    .get(id);

  return (result as Organization) || null;
}

export async function getIndustryTemplateById(ctx: DatabaseContext, id: number): Promise<{ id: number; name: string; slug: string; icon?: string; color?: string; description?: string } | null> {
  if (ctx.type === 'supabase') {
    // For Supabase, query directly using the Supabase client
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data, error } = await supabase
        .from('industry_templates')
        .select('id, name, slug, icon, color, description')
        .eq('id', id)
        .single();

      if (error || !data) return null;
      return data;
    } catch {
      return null;
    }
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite
    .prepare('SELECT id, name, slug, icon, color, description FROM industry_templates WHERE id = ? AND aktiv = 1')
    .get(id);

  return (result as { id: number; name: string; slug: string; icon?: string; color?: string; description?: string }) || null;
}

/**
 * Get industry template with all service types, subtypes, and equipment
 * Used for AI column mapping context
 */
export async function getIndustryTemplateWithServiceTypes(ctx: DatabaseContext, id: number): Promise<{
  id: number;
  name: string;
  slug: string;
  description?: string;
  serviceTypes: Array<{
    name: string;
    slug: string;
    description?: string;
    subtypes?: Array<{ name: string; slug: string }>;
    equipment?: Array<{ name: string; slug: string }>;
  }>;
} | null> {
  if (ctx.type === 'supabase') {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Get the template
      const { data: template, error: templateError } = await supabase
        .from('industry_templates')
        .select('id, name, slug, description')
        .eq('id', id)
        .single();

      if (templateError || !template) return null;

      // Get service types
      const { data: serviceTypes } = await supabase
        .from('template_service_types')
        .select('id, name, slug, description')
        .eq('template_id', id)
        .eq('aktiv', true)
        .order('sort_order');

      // Get subtypes and equipment for each service type
      const serviceTypesWithDetails = await Promise.all(
        (serviceTypes || []).map(async (st: { id: number; name: string; slug: string; description?: string }) => {
          const [subtypesResult, equipmentResult] = await Promise.all([
            supabase.from('template_subtypes').select('name, slug').eq('service_type_id', st.id).order('sort_order'),
            supabase.from('template_equipment').select('name, slug').eq('service_type_id', st.id).order('sort_order'),
          ]);

          return {
            name: st.name,
            slug: st.slug,
            description: st.description,
            subtypes: (subtypesResult.data || []) as Array<{ name: string; slug: string }>,
            equipment: (equipmentResult.data || []) as Array<{ name: string; slug: string }>,
          };
        })
      );

      return {
        id: template.id,
        name: template.name,
        slug: template.slug,
        description: template.description,
        serviceTypes: serviceTypesWithDetails,
      };
    } catch (error) {
      dbLogger.error({ error, id }, 'Failed to get industry template with service types');
      return null;
    }
  }

  // SQLite implementation
  if (!ctx.sqlite) throw new Error('Database not initialized');

  const template = ctx.sqlite
    .prepare('SELECT id, name, slug, description FROM industry_templates WHERE id = ? AND aktiv = 1')
    .get(id) as { id: number; name: string; slug: string; description?: string } | undefined;

  if (!template) return null;

  const serviceTypes = ctx.sqlite
    .prepare('SELECT id, name, slug, description FROM template_service_types WHERE template_id = ? AND aktiv = 1 ORDER BY sort_order')
    .all(id) as Array<{ id: number; name: string; slug: string; description?: string }>;

  const serviceTypesWithDetails = serviceTypes.map(st => {
    const subtypes = ctx.sqlite!
      .prepare('SELECT name, slug FROM template_subtypes WHERE service_type_id = ? ORDER BY sort_order')
      .all(st.id) as Array<{ name: string; slug: string }>;

    const equipment = ctx.sqlite!
      .prepare('SELECT name, slug FROM template_equipment WHERE service_type_id = ? ORDER BY sort_order')
      .all(st.id) as Array<{ name: string; slug: string }>;

    return {
      name: st.name,
      slug: st.slug,
      description: st.description,
      subtypes,
      equipment,
    };
  });

  return {
    id: template.id,
    name: template.name,
    slug: template.slug,
    description: template.description,
    serviceTypes: serviceTypesWithDetails,
  };
}

export async function logLoginAttempt(ctx: DatabaseContext, data: {
  epost: string;
  bruker_navn?: string;
  bruker_type?: string;
  status: string;
  ip_adresse: string;
  user_agent: string;
  feil_melding?: string;
}): Promise<void> {
  if (!ctx.sqlite) {
    // For Supabase, log to console for now (could add Supabase logging)
    dbLogger.info({ ...data }, 'Login attempt');
    return;
  }

  ctx.sqlite
    .prepare(`
      INSERT INTO login_logg (epost, bruker_navn, bruker_type, status, ip_adresse, user_agent, feil_melding)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      data.epost,
      data.bruker_navn,
      data.bruker_type,
      data.status,
      data.ip_adresse,
      data.user_agent,
      data.feil_melding
    );
}

// ============ ACCOUNT LOCKOUT METHODS ============

export async function countRecentFailedLogins(ctx: DatabaseContext, epost: string, windowMinutes: number): Promise<number> {
  if (ctx.sqlite) return 0; // SQLite mode doesn't use account lockout
  try {
    const supabase = await ctx.getSupabaseClient();
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('login_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('epost', epost.toLowerCase())
      .eq('success', false)
      .gte('attempted_at', windowStart);
    return count ?? 0;
  } catch {
    return 0; // Fail open - don't block login if lockout check fails
  }
}

export async function recordLoginAttempt(ctx: DatabaseContext, epost: string, ipAddress: string, success: boolean): Promise<void> {
  if (ctx.sqlite) return;
  try {
    const supabase = await ctx.getSupabaseClient();
    await supabase.from('login_attempts').insert({
      epost: epost.toLowerCase(),
      ip_address: ipAddress,
      success,
    });
  } catch {
    dbLogger.warn({ epost: epost.toLowerCase() }, 'Failed to record login attempt');
  }
}

// ============ REFRESH TOKEN METHODS ============

export async function storeRefreshToken(ctx: DatabaseContext, data: {
  tokenHash: string;
  userId: number;
  userType: 'klient' | 'bruker';
  deviceInfo?: string;
  ipAddress?: string;
  expiresAt: Date;
}): Promise<void> {
  if (!ctx.sqlite) {
    dbLogger.warn('Refresh tokens not supported in Supabase yet');
    return;
  }

  ctx.sqlite.prepare(`
    INSERT INTO refresh_tokens (token_hash, user_id, user_type, device_info, ip_address, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    data.tokenHash,
    data.userId,
    data.userType,
    data.deviceInfo,
    data.ipAddress,
    data.expiresAt.toISOString()
  );
}

export async function getRefreshToken(ctx: DatabaseContext, tokenHash: string): Promise<RefreshTokenRecord | null> {
  if (!ctx.sqlite) return null;

  const result = ctx.sqlite.prepare(`
    SELECT * FROM refresh_tokens WHERE token_hash = ?
  `).get(tokenHash);

  return (result as RefreshTokenRecord) || null;
}

export async function revokeRefreshToken(ctx: DatabaseContext, tokenHash: string, replacedBy?: string): Promise<boolean> {
  if (!ctx.sqlite) return false;

  const sql = replacedBy
    ? `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, replaced_by = ? WHERE token_hash = ? AND revoked_at IS NULL`
    : `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL`;

  const result = replacedBy
    ? ctx.sqlite.prepare(sql).run(replacedBy, tokenHash)
    : ctx.sqlite.prepare(sql).run(tokenHash);

  return result.changes > 0;
}

export async function revokeAllUserRefreshTokens(ctx: DatabaseContext, userId: number, userType: 'klient' | 'bruker'): Promise<number> {
  if (!ctx.sqlite) return 0;

  const result = ctx.sqlite.prepare(`
    UPDATE refresh_tokens
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND user_type = ? AND revoked_at IS NULL
  `).run(userId, userType);

  return result.changes;
}

export async function cleanupExpiredRefreshTokens(ctx: DatabaseContext): Promise<number> {
  if (!ctx.sqlite) return 0;

  const result = ctx.sqlite.prepare(`
    DELETE FROM refresh_tokens
    WHERE expires_at < datetime('now')
      OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-7 days'))
  `).run();

  return result.changes;
}

export async function isRefreshTokenRevoked(ctx: DatabaseContext, tokenHash: string): Promise<boolean> {
  if (!ctx.sqlite) return true;

  const result = ctx.sqlite.prepare(`
    SELECT revoked_at, expires_at FROM refresh_tokens WHERE token_hash = ?
  `).get(tokenHash) as { revoked_at: string | null; expires_at: string } | undefined;

  if (!result) return true;
  if (result.revoked_at) return true;
  if (new Date(result.expires_at) < new Date()) return true;

  return false;
}

export async function detectRefreshTokenReuse(ctx: DatabaseContext, tokenHash: string): Promise<boolean> {
  if (!ctx.sqlite) return false;

  // Check if this token was already used (has a replaced_by value or is revoked)
  const result = ctx.sqlite.prepare(`
    SELECT id, replaced_by, revoked_at FROM refresh_tokens WHERE token_hash = ?
  `).get(tokenHash) as { id: number; replaced_by: string | null; revoked_at: string | null } | undefined;

  // If token doesn't exist or has been replaced/revoked, it's potentially reuse
  return result?.replaced_by !== null || result?.revoked_at !== null;
}

export async function getActiveRefreshTokenCount(ctx: DatabaseContext, userId: number, userType: 'klient' | 'bruker'): Promise<number> {
  if (!ctx.sqlite) return 0;

  const result = ctx.sqlite.prepare(`
    SELECT COUNT(*) as count FROM refresh_tokens
    WHERE user_id = ? AND user_type = ? AND revoked_at IS NULL AND expires_at > datetime('now')
  `).get(userId, userType) as { count: number };

  return result?.count || 0;
}

// ============ TOKEN BLACKLIST METHODS ============

export async function addToTokenBlacklist(ctx: DatabaseContext, data: {
  jti: string;
  userId: number;
  userType: 'klient' | 'bruker';
  expiresAt: number;
  reason?: string;
}): Promise<void> {
  if (!ctx.sqlite) {
    dbLogger.warn('Token blacklist not supported in Supabase yet');
    return;
  }

  try {
    ctx.sqlite.prepare(`
      INSERT OR REPLACE INTO token_blacklist (jti, user_id, user_type, expires_at, reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      data.jti,
      data.userId,
      data.userType,
      data.expiresAt,
      data.reason || 'logout'
    );
  } catch (error) {
    dbLogger.error({ error, jti: data.jti }, 'Failed to add token to blacklist');
  }
}

export async function isTokenInBlacklist(ctx: DatabaseContext, jti: string): Promise<boolean> {
  if (!ctx.sqlite) return false;

  try {
    const result = ctx.sqlite.prepare(`
      SELECT 1 FROM token_blacklist WHERE jti = ?
    `).get(jti);

    return !!result;
  } catch {
    return false;
  }
}

export async function cleanupExpiredBlacklistTokens(ctx: DatabaseContext): Promise<number> {
  if (!ctx.sqlite) return 0;

  const now = Math.floor(Date.now() / 1000);

  try {
    const result = ctx.sqlite.prepare(`
      DELETE FROM token_blacklist WHERE expires_at < ?
    `).run(now);

    return result.changes;
  } catch (error) {
    dbLogger.error({ error }, 'Failed to cleanup expired blacklist tokens');
    return 0;
  }
}

export async function getBlacklistStats(ctx: DatabaseContext): Promise<{ total: number; expiredRemoved?: number }> {
  if (!ctx.sqlite) return { total: 0 };

  try {
    const result = ctx.sqlite.prepare(`
      SELECT COUNT(*) as total FROM token_blacklist
    `).get() as { total: number };

    return { total: result?.total || 0 };
  } catch {
    return { total: 0 };
  }
}

// ============ SESSION METHODS ============

export async function createSession(ctx: DatabaseContext, data: {
  userId: number;
  userType: 'klient' | 'bruker';
  jti: string;
  ipAddress?: string;
  userAgent?: string;
  deviceInfo?: string;
  expiresAt: Date;
}): Promise<void> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    await client.from('active_sessions').insert({
      user_id: data.userId,
      user_type: data.userType,
      jti: data.jti,
      ip_address: data.ipAddress,
      user_agent: data.userAgent,
      device_info: data.deviceInfo,
      expires_at: data.expiresAt.toISOString(),
    });
    return;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  ctx.sqlite.prepare(`
    INSERT INTO active_sessions (user_id, user_type, jti, ip_address, user_agent, device_info, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.userId, data.userType, data.jti,
    data.ipAddress, data.userAgent, data.deviceInfo,
    data.expiresAt.toISOString()
  );
}

export async function getSessionsByUser(ctx: DatabaseContext, userId: number, userType: 'klient' | 'bruker'): Promise<Array<{
  id: number;
  jti: string;
  ip_address: string | null;
  user_agent: string | null;
  device_info: string | null;
  last_activity_at: string;
  created_at: string;
  expires_at: string;
}>> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('active_sessions')
      .select('id, jti, ip_address, user_agent, device_info, last_activity_at, created_at, expires_at')
      .eq('user_id', userId)
      .eq('user_type', userType)
      .gt('expires_at', new Date().toISOString())
      .order('last_activity_at', { ascending: false });
    if (error) return [];
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare(`
    SELECT id, jti, ip_address, user_agent, device_info, last_activity_at, created_at, expires_at
    FROM active_sessions
    WHERE user_id = ? AND user_type = ? AND expires_at > datetime('now')
    ORDER BY last_activity_at DESC
  `).all(userId, userType) as Array<{
    id: number; jti: string; ip_address: string | null; user_agent: string | null;
    device_info: string | null; last_activity_at: string; created_at: string; expires_at: string;
  }>;
}

export async function deleteSessionByJti(ctx: DatabaseContext, jti: string): Promise<boolean> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { error } = await client
      .from('active_sessions')
      .delete()
      .eq('jti', jti);
    return !error;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('DELETE FROM active_sessions WHERE jti = ?').run(jti);
  return result.changes > 0;
}

export async function deleteSessionById(ctx: DatabaseContext, id: number, userId: number, userType: 'klient' | 'bruker'): Promise<string | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    // Get the JTI before deleting so we can blacklist the token
    const { data } = await client
      .from('active_sessions')
      .select('jti')
      .eq('id', id)
      .eq('user_id', userId)
      .eq('user_type', userType)
      .single();
    if (!data) return null;
    await client.from('active_sessions').delete().eq('id', id);
    return data.jti;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const row = ctx.sqlite.prepare(
    'SELECT jti FROM active_sessions WHERE id = ? AND user_id = ? AND user_type = ?'
  ).get(id, userId, userType) as { jti: string } | undefined;
  if (!row) return null;
  ctx.sqlite.prepare('DELETE FROM active_sessions WHERE id = ?').run(id);
  return row.jti;
}

export async function updateSessionActivity(ctx: DatabaseContext, jti: string): Promise<void> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    await client
      .from('active_sessions')
      .update({ last_activity_at: new Date().toISOString() })
      .eq('jti', jti);
    return;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  ctx.sqlite.prepare(
    "UPDATE active_sessions SET last_activity_at = datetime('now') WHERE jti = ?"
  ).run(jti);
}

export async function cleanupExpiredSessions(ctx: DatabaseContext): Promise<number> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data } = await client
      .from('active_sessions')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');
    return data?.length || 0;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare(
    "DELETE FROM active_sessions WHERE expires_at < datetime('now')"
  ).run();
  return result.changes;
}

// ============ KLIENT / PASSWORD METHODS ============

/**
 * Get a single klient by ID
 */
export async function getKlientById(ctx: DatabaseContext, klientId: number): Promise<KlientRecord | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('klient')
      .select('*')
      .eq('id', klientId)
      .single();

    if (error) return null;
    return data;
  }

  if (!ctx.sqlite) return null;

  return ctx.sqlite.prepare(`
    SELECT * FROM klient WHERE id = ?
  `).get(klientId) as KlientRecord | null;
}

/**
 * Update a klient (user) record
 */
export async function updateKlient(
  ctx: DatabaseContext,
  klientId: number,
  data: {
    navn?: string;
    epost?: string;
    telefon?: string;
    rolle?: string;
    aktiv?: boolean;
  }
): Promise<KlientRecord | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    // Filter to only columns that exist in the Supabase klient table
    const supabaseFields = ['navn', 'epost', 'telefon', 'aktiv', 'adresse', 'postnummer', 'poststed'];
    const filteredData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (supabaseFields.includes(key) && value !== undefined) {
        filteredData[key] = value;
      }
    }
    if (Object.keys(filteredData).length === 0) {
      return getKlientById(ctx, klientId);
    }
    const { data: updated, error } = await client
      .from('klient')
      .update(filteredData)
      .eq('id', klientId)
      .select()
      .single();

    if (error) throw new Error(`Failed to update klient: ${error.message}`);
    return updated;
  }

  if (!ctx.sqlite) return null;

  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return getKlientById(ctx, klientId);

  values.push(klientId);
  ctx.sqlite.prepare(`
    UPDATE klient SET ${fields.join(', ')} WHERE id = ?
  `).run(...values);

  return getKlientById(ctx, klientId);
}

/**
 * Create password reset token
 */
export async function createPasswordResetToken(ctx: DatabaseContext, data: {
  user_id: number;
  user_type: 'klient' | 'bruker';
  token_hash: string;
  epost: string;
  expires_at: string;
}): Promise<{ id: number }> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data: result, error } = await client
      .from('password_reset_tokens')
      .insert({
        token: data.token_hash,
        user_id: data.user_id,
        user_type: data.user_type,
        epost: data.epost,
        expires_at: data.expires_at,
      })
      .select('id')
      .single();

    if (error) throw new Error(`Failed to create reset token: ${error.message}`);
    return { id: result.id };
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite.prepare(`
    INSERT INTO password_reset_tokens (token, user_id, user_type, epost, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.token_hash, data.user_id, data.user_type, data.epost, data.expires_at);

  return { id: result.lastInsertRowid as number };
}

/**
 * Get login history for an organization
 */
export async function getLoginHistoryForOrganization(
  ctx: DatabaseContext,
  organizationId: number,
  options: { limit?: number; offset?: number; status?: string; epost?: string } = {}
): Promise<{
  logs: Array<{
    id: number;
    epost: string;
    bruker_navn: string | null;
    bruker_type: string | null;
    status: string;
    ip_adresse: string | null;
    user_agent: string | null;
    feil_melding: string | null;
    tidspunkt: string;
  }>;
  total: number;
}> {
  const { limit = 50, offset = 0, status, epost } = options;

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();

    let query = client
      .from('login_logg')
      .select('*')
      .eq('organization_id', organizationId)
      .order('tidspunkt', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (epost) query = query.ilike('epost', `%${epost}%`);

    const { data } = await query;

    // Get total count separately
    let countQuery = client
      .from('login_logg')
      .select('id')
      .eq('organization_id', organizationId);
    if (status) countQuery = countQuery.eq('status', status);
    if (epost) countQuery = countQuery.ilike('epost', `%${epost}%`);
    const { data: countData } = await countQuery;

    return { logs: data || [], total: countData?.length || 0 };
  }

  if (!ctx.sqlite) {
    return { logs: [], total: 0 };
  }

  let whereClause = 'WHERE organization_id = ?';
  const params: unknown[] = [organizationId];

  if (status) {
    whereClause += ' AND status = ?';
    params.push(status);
  }
  if (epost) {
    whereClause += ' AND epost LIKE ?';
    params.push(`%${epost}%`);
  }

  const countResult = ctx.sqlite.prepare(`
    SELECT COUNT(*) as count FROM login_logg ${whereClause}
  `).get(...params) as { count: number };

  const logs = ctx.sqlite.prepare(`
    SELECT * FROM login_logg
    ${whereClause}
    ORDER BY tidspunkt DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Array<{
    id: number;
    epost: string;
    bruker_navn: string | null;
    bruker_type: string | null;
    status: string;
    ip_adresse: string | null;
    user_agent: string | null;
    feil_melding: string | null;
    tidspunkt: string;
  }>;

  return { logs, total: countResult?.count || 0 };
}

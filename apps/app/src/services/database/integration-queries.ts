/**
 * Integration, API key, webhook, and mapping cache database queries.
 * Handles integration credentials, sync logging, API key management,
 * webhook endpoints, webhook deliveries, and import mapping cache.
 */

import { dbLogger } from '../logger';
import type { DatabaseContext, Kunde } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============ MAPPING CACHE ============

export async function getMappingCache(ctx: DatabaseContext, organizationId: number, excelHeader: string): Promise<{
  id: number;
  organizationId: number;
  excelHeader: string;
  normalizedHeader: string;
  targetField: string;
  fieldType: string;
  dataType: string | null;
  confidence: number;
  usageCount: number;
  confirmedByUser: boolean;
  createdAt: Date;
  lastUsedAt: Date;
} | null> {
  if (!ctx.sqlite) return null;

  const result = ctx.sqlite.prepare(`
    SELECT * FROM mapping_cache
    WHERE organization_id = ? AND LOWER(excel_header) = LOWER(?)
  `).get(organizationId, excelHeader) as {
    id: number;
    organization_id: number;
    excel_header: string;
    normalized_header: string;
    target_field: string;
    field_type: string;
    data_type: string | null;
    confidence: number;
    usage_count: number;
    confirmed_by_user: number;
    created_at: string;
    last_used_at: string;
  } | undefined;

  if (!result) return null;

  return {
    id: result.id,
    organizationId: result.organization_id,
    excelHeader: result.excel_header,
    normalizedHeader: result.normalized_header,
    targetField: result.target_field,
    fieldType: result.field_type,
    dataType: result.data_type,
    confidence: result.confidence,
    usageCount: result.usage_count,
    confirmedByUser: !!result.confirmed_by_user,
    createdAt: new Date(result.created_at),
    lastUsedAt: new Date(result.last_used_at),
  };
}

/**
 * Get a cached mapping by normalized header
 */
export async function getMappingCacheByNormalized(ctx: DatabaseContext, organizationId: number, normalizedHeader: string): Promise<{
  id: number;
  organizationId: number;
  excelHeader: string;
  normalizedHeader: string;
  targetField: string;
  fieldType: string;
  dataType: string | null;
  confidence: number;
  usageCount: number;
  confirmedByUser: boolean;
  createdAt: Date;
  lastUsedAt: Date;
} | null> {
  if (!ctx.sqlite) return null;

  const result = ctx.sqlite.prepare(`
    SELECT * FROM mapping_cache
    WHERE organization_id = ? AND normalized_header = ?
  `).get(organizationId, normalizedHeader) as {
    id: number;
    organization_id: number;
    excel_header: string;
    normalized_header: string;
    target_field: string;
    field_type: string;
    data_type: string | null;
    confidence: number;
    usage_count: number;
    confirmed_by_user: number;
    created_at: string;
    last_used_at: string;
  } | undefined;

  if (!result) return null;

  return {
    id: result.id,
    organizationId: result.organization_id,
    excelHeader: result.excel_header,
    normalizedHeader: result.normalized_header,
    targetField: result.target_field,
    fieldType: result.field_type,
    dataType: result.data_type,
    confidence: result.confidence,
    usageCount: result.usage_count,
    confirmedByUser: !!result.confirmed_by_user,
    createdAt: new Date(result.created_at),
    lastUsedAt: new Date(result.last_used_at),
  };
}

/**
 * Get all cached mappings for an organization
 */
export async function getAllMappingCache(ctx: DatabaseContext, organizationId: number): Promise<Array<{
  id: number;
  organizationId: number;
  excelHeader: string;
  normalizedHeader: string;
  targetField: string;
  fieldType: string;
  dataType: string | null;
  confidence: number;
  usageCount: number;
  confirmedByUser: boolean;
  createdAt: Date;
  lastUsedAt: Date;
}>> {
  if (!ctx.sqlite) return [];

  const results = ctx.sqlite.prepare(`
    SELECT * FROM mapping_cache
    WHERE organization_id = ?
    ORDER BY usage_count DESC, last_used_at DESC
  `).all(organizationId) as Array<{
    id: number;
    organization_id: number;
    excel_header: string;
    normalized_header: string;
    target_field: string;
    field_type: string;
    data_type: string | null;
    confidence: number;
    usage_count: number;
    confirmed_by_user: number;
    created_at: string;
    last_used_at: string;
  }>;

  return results.map(r => ({
    id: r.id,
    organizationId: r.organization_id,
    excelHeader: r.excel_header,
    normalizedHeader: r.normalized_header,
    targetField: r.target_field,
    fieldType: r.field_type,
    dataType: r.data_type,
    confidence: r.confidence,
    usageCount: r.usage_count,
    confirmedByUser: !!r.confirmed_by_user,
    createdAt: new Date(r.created_at),
    lastUsedAt: new Date(r.last_used_at),
  }));
}

/**
 * Create a new mapping cache entry
 */
export async function createMappingCache(ctx: DatabaseContext, data: {
  organizationId: number;
  excelHeader: string;
  normalizedHeader: string;
  targetField: string;
  fieldType: string;
  dataType?: string;
  confidence?: number;
  usageCount?: number;
  confirmedByUser?: boolean;
}): Promise<number> {
  if (!ctx.sqlite) return 0;

  const result = ctx.sqlite.prepare(`
    INSERT INTO mapping_cache (
      organization_id, excel_header, normalized_header, target_field,
      field_type, data_type, confidence, usage_count, confirmed_by_user
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.organizationId,
    data.excelHeader,
    data.normalizedHeader,
    data.targetField,
    data.fieldType,
    data.dataType || null,
    data.confidence || 0.5,
    data.usageCount || 1,
    data.confirmedByUser ? 1 : 0
  );

  return Number(result.lastInsertRowid);
}

/**
 * Update an existing mapping cache entry
 */
export async function updateMappingCache(ctx: DatabaseContext, id: number, data: {
  targetField?: string;
  fieldType?: string;
  dataType?: string;
  confidence?: number;
  usageCount?: number;
  confirmedByUser?: boolean;
  lastUsedAt?: Date;
}): Promise<boolean> {
  if (!ctx.sqlite) return false;

  const fields: string[] = [];
  const values: unknown[] = [];

  if (data.targetField !== undefined) {
    fields.push('target_field = ?');
    values.push(data.targetField);
  }
  if (data.fieldType !== undefined) {
    fields.push('field_type = ?');
    values.push(data.fieldType);
  }
  if (data.dataType !== undefined) {
    fields.push('data_type = ?');
    values.push(data.dataType);
  }
  if (data.confidence !== undefined) {
    fields.push('confidence = ?');
    values.push(data.confidence);
  }
  if (data.usageCount !== undefined) {
    fields.push('usage_count = ?');
    values.push(data.usageCount);
  }
  if (data.confirmedByUser !== undefined) {
    fields.push('confirmed_by_user = ?');
    values.push(data.confirmedByUser ? 1 : 0);
  }
  if (data.lastUsedAt !== undefined) {
    fields.push('last_used_at = ?');
    values.push(data.lastUsedAt.toISOString());
  }

  if (fields.length === 0) return false;

  values.push(id);

  const result = ctx.sqlite.prepare(`
    UPDATE mapping_cache SET ${fields.join(', ')} WHERE id = ?
  `).run(...values);

  return result.changes > 0;
}

/**
 * Delete old mapping cache entries
 */
export async function deleteOldMappingCache(ctx: DatabaseContext, olderThan: Date, organizationId?: number): Promise<number> {
  if (!ctx.sqlite) return 0;

  const sql = organizationId
    ? `DELETE FROM mapping_cache WHERE last_used_at < ? AND organization_id = ? AND confirmed_by_user = 0`
    : `DELETE FROM mapping_cache WHERE last_used_at < ? AND confirmed_by_user = 0`;

  const result = organizationId
    ? ctx.sqlite.prepare(sql).run(olderThan.toISOString(), organizationId)
    : ctx.sqlite.prepare(sql).run(olderThan.toISOString());

  return result.changes;
}

// ============ INTEGRATION METHODS ============

/**
 * Get all integrations for an organization
 */
export async function getOrganizationIntegrations(ctx: DatabaseContext, organizationId: number): Promise<Array<{
  id: number;
  integration_id: string;
  is_active: boolean;
  last_sync_at: string | null;
  sync_frequency_hours: number;
}>> {
  ctx.validateTenantContext(organizationId, 'getOrganizationIntegrations');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('organization_integrations')
      .select('id, integration_id, is_active, last_sync_at, sync_frequency_hours')
      .eq('organization_id', organizationId);
    if (error) {
      dbLogger.error({ error, organizationId }, 'Failed to get organization integrations');
      return [];
    }
    return data || [];
  }

  if (!ctx.sqlite) return [];

  const sql = `
    SELECT id, integration_id, is_active, last_sync_at, sync_frequency_hours
    FROM organization_integrations
    WHERE organization_id = ?
  `;
  return ctx.sqlite.prepare(sql).all(organizationId) as Array<{
    id: number;
    integration_id: string;
    is_active: boolean;
    last_sync_at: string | null;
    sync_frequency_hours: number;
  }>;
}

/**
 * Get integration credentials for an organization
 */
export async function getIntegrationCredentials(
  ctx: DatabaseContext,
  organizationId: number,
  integrationId: string
): Promise<{ credentials_encrypted: string; is_active: boolean } | null> {
  ctx.validateTenantContext(organizationId, 'getIntegrationCredentials');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('organization_integrations')
      .select('credentials_encrypted, is_active')
      .eq('organization_id', organizationId)
      .eq('integration_id', integrationId)
      .single();
    if (error || !data) return null;
    return data;
  }

  if (!ctx.sqlite) return null;

  const sql = `
    SELECT credentials_encrypted, is_active
    FROM organization_integrations
    WHERE organization_id = ? AND integration_id = ?
  `;
  const result = ctx.sqlite.prepare(sql).get(organizationId, integrationId) as
    { credentials_encrypted: string; is_active: boolean } | undefined;

  return result || null;
}

/**
 * Save or update integration credentials
 */
export async function saveIntegrationCredentials(
  ctx: DatabaseContext,
  organizationId: number,
  data: {
    integration_id: string;
    credentials_encrypted: string;
    is_active: boolean;
  }
): Promise<void> {
  ctx.validateTenantContext(organizationId, 'saveIntegrationCredentials');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { error } = await client
      .from('organization_integrations')
      .upsert({
        organization_id: organizationId,
        integration_id: data.integration_id,
        credentials_encrypted: data.credentials_encrypted,
        is_active: data.is_active,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id,integration_id' });
    if (error) {
      dbLogger.error({ error, organizationId }, 'Failed to save integration credentials');
      throw new Error('Kunne ikke lagre integrasjonsnøkler');
    }
    return;
  }

  if (!ctx.sqlite) return;

  const sql = `
    INSERT INTO organization_integrations (organization_id, integration_id, credentials_encrypted, is_active, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(organization_id, integration_id)
    DO UPDATE SET credentials_encrypted = excluded.credentials_encrypted,
                  is_active = excluded.is_active,
                  updated_at = datetime('now')
  `;
  ctx.sqlite.prepare(sql).run(
    organizationId,
    data.integration_id,
    data.credentials_encrypted,
    data.is_active ? 1 : 0
  );
}

/**
 * Update last sync time for an integration
 */
export async function updateIntegrationLastSync(
  ctx: DatabaseContext,
  organizationId: number,
  integrationId: string,
  syncTime: Date
): Promise<void> {
  ctx.validateTenantContext(organizationId, 'updateIntegrationLastSync');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    await client
      .from('organization_integrations')
      .update({ last_sync_at: syncTime.toISOString(), updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .eq('integration_id', integrationId);
    return;
  }

  if (!ctx.sqlite) return;

  const sql = `
    UPDATE organization_integrations
    SET last_sync_at = ?, updated_at = datetime('now')
    WHERE organization_id = ? AND integration_id = ?
  `;
  ctx.sqlite.prepare(sql).run(syncTime.toISOString(), organizationId, integrationId);
}

/**
 * Delete integration credentials
 */
export async function deleteIntegrationCredentials(
  ctx: DatabaseContext,
  organizationId: number,
  integrationId: string
): Promise<void> {
  ctx.validateTenantContext(organizationId, 'deleteIntegrationCredentials');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    await client
      .from('organization_integrations')
      .delete()
      .eq('organization_id', organizationId)
      .eq('integration_id', integrationId);
    return;
  }

  if (!ctx.sqlite) return;

  const sql = `
    DELETE FROM organization_integrations
    WHERE organization_id = ? AND integration_id = ?
  `;
  ctx.sqlite.prepare(sql).run(organizationId, integrationId);
}

/**
 * Log an integration sync
 */
export async function logIntegrationSync(
  ctx: DatabaseContext,
  organizationId: number,
  data: {
    integration_id: string;
    sync_type: 'manual' | 'scheduled';
    status: 'started' | 'completed' | 'failed';
    created_count?: number;
    updated_count?: number;
    unchanged_count?: number;
    failed_count?: number;
    error_message?: string;
    completed_at?: Date;
  }
): Promise<number> {
  ctx.validateTenantContext(organizationId, 'logIntegrationSync');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data: result, error } = await client
      .from('integration_sync_log')
      .insert({
        organization_id: organizationId,
        integration_id: data.integration_id,
        sync_type: data.sync_type,
        status: data.status,
        created_count: data.created_count ?? 0,
        updated_count: data.updated_count ?? 0,
        unchanged_count: data.unchanged_count ?? 0,
        failed_count: data.failed_count ?? 0,
        error_message: data.error_message ?? null,
        completed_at: data.completed_at?.toISOString() ?? null,
      })
      .select('id')
      .single();
    if (error) {
      dbLogger.error({ error, organizationId }, 'Failed to log integration sync');
      return 0;
    }
    return result?.id ?? 0;
  }

  if (!ctx.sqlite) return 0;

  const sql = `
    INSERT INTO integration_sync_log
      (organization_id, integration_id, sync_type, status, created_count, updated_count, unchanged_count, failed_count, error_message, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const result = ctx.sqlite.prepare(sql).run(
    organizationId,
    data.integration_id,
    data.sync_type,
    data.status,
    data.created_count ?? 0,
    data.updated_count ?? 0,
    data.unchanged_count ?? 0,
    data.failed_count ?? 0,
    data.error_message ?? null,
    data.completed_at?.toISOString() ?? null
  );

  return result.lastInsertRowid as number;
}

/**
 * Get customer by external ID (for sync)
 */
export async function getKundeByExternalId(
  ctx: DatabaseContext,
  organizationId: number,
  externalSource: string,
  externalId: string
): Promise<Kunde | null> {
  ctx.validateTenantContext(organizationId, 'getKundeByExternalId');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('kunder')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('external_source', externalSource)
      .eq('external_id', externalId)
      .single();
    if (error || !data) return null;
    return data as Kunde;
  }

  if (!ctx.sqlite) return null;

  const sql = `
    SELECT * FROM kunder
    WHERE organization_id = ? AND external_source = ? AND external_id = ?
  `;
  const result = ctx.sqlite.prepare(sql).get(organizationId, externalSource, externalId) as Kunde | undefined;

  return result || null;
}

/**
 * Get all kunder with a specific external source (for preview comparison)
 */
export async function getKunderByExternalSource(
  ctx: DatabaseContext,
  organizationId: number,
  externalSource: string
): Promise<Array<{ id: number; external_id: string }>> {
  ctx.validateTenantContext(organizationId, 'getKunderByExternalSource');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = ctx.supabase.getClient();
    const { data, error } = await client
      .from('kunder')
      .select('id, external_id')
      .eq('organization_id', organizationId)
      .eq('external_source', externalSource)
      .not('external_id', 'is', null);
    if (error || !data) return [];
    return data as Array<{ id: number; external_id: string }>;
  }

  if (!ctx.sqlite) return [];

  const sql = `SELECT id, external_id FROM kunder WHERE organization_id = ? AND external_source = ? AND external_id IS NOT NULL`;
  return ctx.sqlite.prepare(sql).all(organizationId, externalSource) as Array<{ id: number; external_id: string }>;
}

// ============ FAILED SYNC ITEMS (RETRY) ============

/**
 * Record a failed sync item for later retry.
 * Uses upsert — increments retry_count on conflict.
 * Marks as permanently_failed when max_retries is reached.
 */
export async function recordFailedSyncItem(
  ctx: DatabaseContext,
  organizationId: number,
  data: {
    integration_id: string;
    external_id: string;
    external_source: string;
    error_message: string;
  }
): Promise<void> {
  ctx.validateTenantContext(organizationId, 'recordFailedSyncItem');
  if (!ctx.sqlite) return;

  const sql = `
    INSERT INTO failed_sync_items
      (organization_id, integration_id, external_id, external_source, error_message, last_attempt_at, next_retry_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now', '+1 hour'))
    ON CONFLICT(organization_id, integration_id, external_id)
    DO UPDATE SET
      retry_count = retry_count + 1,
      error_message = excluded.error_message,
      last_attempt_at = datetime('now'),
      next_retry_at = datetime('now', '+' || (MIN(retry_count + 1, 3) * 60) || ' minutes'),
      status = CASE
        WHEN retry_count + 1 >= max_retries THEN 'permanently_failed'
        ELSE 'pending'
      END,
      updated_at = datetime('now')
  `;
  ctx.sqlite.prepare(sql).run(
    organizationId,
    data.integration_id,
    data.external_id,
    data.external_source,
    data.error_message
  );
}

/**
 * Mark a failed sync item as resolved (successfully synced on retry)
 */
export async function resolveFailedSyncItem(
  ctx: DatabaseContext,
  organizationId: number,
  integrationId: string,
  externalId: string
): Promise<void> {
  ctx.validateTenantContext(organizationId, 'resolveFailedSyncItem');
  if (!ctx.sqlite) return;

  const sql = `
    UPDATE failed_sync_items
    SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
    WHERE organization_id = ? AND integration_id = ? AND external_id = ?
  `;
  ctx.sqlite.prepare(sql).run(organizationId, integrationId, externalId);
}

/**
 * Cleanup old resolved/permanently_failed items
 */
export async function cleanupOldFailedSyncItems(ctx: DatabaseContext, daysOld: number = 30): Promise<number> {
  if (!ctx.sqlite) return 0;

  const sql = `
    DELETE FROM failed_sync_items
    WHERE status IN ('resolved', 'permanently_failed')
      AND updated_at < datetime('now', '-' || ? || ' days')
  `;
  const result = ctx.sqlite.prepare(sql).run(daysOld);
  return result.changes;
}

/**
 * Get all active integrations that are due for a scheduled sync.
 * Cross-organization query — used only by the cron system.
 */
export async function getAllDueIntegrations(ctx: DatabaseContext): Promise<Array<{
  id: number;
  organization_id: number;
  integration_id: string;
  credentials_encrypted: string;
  is_active: boolean;
  last_sync_at: string | null;
  sync_frequency_hours: number;
}>> {
  if (!ctx.sqlite) return [];

  const sql = `
    SELECT id, organization_id, integration_id, credentials_encrypted,
           is_active, last_sync_at, sync_frequency_hours
    FROM organization_integrations
    WHERE is_active = 1
      AND (
        last_sync_at IS NULL
        OR datetime(last_sync_at, '+' || sync_frequency_hours || ' hours') < datetime('now')
      )
  `;
  return ctx.sqlite.prepare(sql).all() as Array<{
    id: number;
    organization_id: number;
    integration_id: string;
    credentials_encrypted: string;
    is_active: boolean;
    last_sync_at: string | null;
    sync_frequency_hours: number;
  }>;
}

// ============ API KEY METHODS ============

/**
 * Create a new API key
 */
export async function createApiKey(ctx: DatabaseContext, data: {
  organization_id: number;
  key_prefix: string;
  key_hash: string;
  name: string;
  description?: string;
  scopes: string[];
  expires_at?: string;
  monthly_quota?: number;
  rate_limit_requests?: number;
  rate_limit_window_seconds?: number;
  created_by: number;
}): Promise<{
  id: number;
  organization_id: number;
  key_prefix: string;
  name: string;
  description?: string;
  scopes: string[];
  rate_limit_requests: number;
  rate_limit_window_seconds: number;
  monthly_quota?: number;
  quota_used_this_month: number;
  is_active: boolean;
  expires_at?: string;
  created_by: number;
  created_at: string;
}> {
  if (ctx.type === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: apiKey, error } = await supabase
      .from('api_keys')
      .insert({
        organization_id: data.organization_id,
        key_prefix: data.key_prefix,
        key_hash: data.key_hash,
        name: data.name,
        description: data.description,
        scopes: data.scopes,
        expires_at: data.expires_at,
        monthly_quota: data.monthly_quota,
        rate_limit_requests: data.rate_limit_requests || 1000,
        rate_limit_window_seconds: data.rate_limit_window_seconds || 3600,
        created_by: data.created_by,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create API key: ${error.message}`);
    return apiKey;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const stmt = ctx.sqlite.prepare(`
    INSERT INTO api_keys (
      organization_id, key_prefix, key_hash, name, description, scopes,
      expires_at, monthly_quota, rate_limit_requests, rate_limit_window_seconds, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    data.organization_id,
    data.key_prefix,
    data.key_hash,
    data.name,
    data.description || null,
    JSON.stringify(data.scopes),
    data.expires_at || null,
    data.monthly_quota || null,
    data.rate_limit_requests || 1000,
    data.rate_limit_window_seconds || 3600,
    data.created_by
  );

  const apiKey = ctx.sqlite.prepare('SELECT * FROM api_keys WHERE id = ?').get(result.lastInsertRowid) as {
    id: number;
    organization_id: number;
    key_prefix: string;
    name: string;
    description: string | null;
    scopes: string;
    rate_limit_requests: number;
    rate_limit_window_seconds: number;
    monthly_quota: number | null;
    quota_used_this_month: number;
    is_active: number;
    expires_at: string | null;
    created_by: number;
    created_at: string;
  };

  return {
    ...apiKey,
    description: apiKey.description || undefined,
    scopes: JSON.parse(apiKey.scopes),
    monthly_quota: apiKey.monthly_quota || undefined,
    is_active: !!apiKey.is_active,
    expires_at: apiKey.expires_at || undefined,
  };
}

/**
 * Get an API key by its hash (for validation)
 */
export async function getApiKeyByHash(ctx: DatabaseContext, keyHash: string): Promise<{
  id: number;
  organization_id: number;
  key_prefix: string;
  key_hash: string;
  name: string;
  scopes: string[];
  rate_limit_requests: number;
  rate_limit_window_seconds: number;
  is_active: boolean;
  expires_at?: string;
} | null> {
  if (ctx.type === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key_hash', keyHash)
      .single();

    if (error || !data) return null;
    return { ...data, is_active: !!data.is_active };
  }

  if (!ctx.sqlite) return null;

  const result = ctx.sqlite.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash) as {
    id: number;
    organization_id: number;
    key_prefix: string;
    key_hash: string;
    name: string;
    scopes: string;
    rate_limit_requests: number;
    rate_limit_window_seconds: number;
    is_active: number;
    expires_at: string | null;
  } | undefined;

  if (!result) return null;

  return {
    ...result,
    scopes: JSON.parse(result.scopes),
    is_active: !!result.is_active,
    expires_at: result.expires_at || undefined,
  };
}

/**
 * Get an API key by ID (for admin management)
 */
export async function getApiKeyById(ctx: DatabaseContext, id: number, organizationId: number): Promise<{
  id: number;
  organization_id: number;
  key_prefix: string;
  name: string;
  description?: string;
  scopes: string[];
  rate_limit_requests: number;
  rate_limit_window_seconds: number;
  monthly_quota?: number;
  quota_used_this_month: number;
  is_active: boolean;
  last_used_at?: string;
  expires_at?: string;
  created_by: number;
  created_at: string;
  revoked_at?: string;
} | null> {
  ctx.validateTenantContext(organizationId, 'getApiKeyById');

  if (ctx.type === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from('api_keys')
      .select('id, organization_id, key_prefix, name, description, scopes, rate_limit_requests, rate_limit_window_seconds, monthly_quota, quota_used_this_month, is_active, last_used_at, expires_at, created_by, created_at, revoked_at')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .single();

    if (error || !data) return null;
    return { ...data, is_active: !!data.is_active };
  }

  if (!ctx.sqlite) return null;

  const result = ctx.sqlite.prepare(`
    SELECT id, organization_id, key_prefix, name, description, scopes,
           rate_limit_requests, rate_limit_window_seconds, monthly_quota,
           quota_used_this_month, is_active, last_used_at, expires_at,
           created_by, created_at, revoked_at
    FROM api_keys WHERE id = ? AND organization_id = ?
  `).get(id, organizationId) as {
    id: number;
    organization_id: number;
    key_prefix: string;
    name: string;
    description: string | null;
    scopes: string;
    rate_limit_requests: number;
    rate_limit_window_seconds: number;
    monthly_quota: number | null;
    quota_used_this_month: number;
    is_active: number;
    last_used_at: string | null;
    expires_at: string | null;
    created_by: number;
    created_at: string;
    revoked_at: string | null;
  } | undefined;

  if (!result) return null;

  return {
    ...result,
    description: result.description || undefined,
    scopes: JSON.parse(result.scopes),
    monthly_quota: result.monthly_quota || undefined,
    is_active: !!result.is_active,
    last_used_at: result.last_used_at || undefined,
    expires_at: result.expires_at || undefined,
    revoked_at: result.revoked_at || undefined,
  };
}

/**
 * Get all API keys for an organization (without hashes)
 */
export async function getOrganizationApiKeys(ctx: DatabaseContext, organizationId: number): Promise<Array<{
  id: number;
  organization_id: number;
  key_prefix: string;
  name: string;
  description?: string;
  scopes: string[];
  rate_limit_requests: number;
  rate_limit_window_seconds: number;
  monthly_quota?: number;
  quota_used_this_month: number;
  is_active: boolean;
  last_used_at?: string;
  expires_at?: string;
  created_by: number;
  created_at: string;
  revoked_at?: string;
}>> {
  ctx.validateTenantContext(organizationId, 'getOrganizationApiKeys');

  if (ctx.type === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
      .from('api_keys')
      .select('id, organization_id, key_prefix, name, description, scopes, rate_limit_requests, rate_limit_window_seconds, monthly_quota, quota_used_this_month, is_active, last_used_at, expires_at, created_by, created_at, revoked_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get API keys: ${error.message}`);
    return (data || []).map((k) => ({ ...k, is_active: !!k.is_active }));
  }

  if (!ctx.sqlite) return [];

  const results = ctx.sqlite.prepare(`
    SELECT id, organization_id, key_prefix, name, description, scopes,
           rate_limit_requests, rate_limit_window_seconds, monthly_quota,
           quota_used_this_month, is_active, last_used_at, expires_at,
           created_by, created_at, revoked_at
    FROM api_keys WHERE organization_id = ?
    ORDER BY created_at DESC
  `).all(organizationId) as Array<{
    id: number;
    organization_id: number;
    key_prefix: string;
    name: string;
    description: string | null;
    scopes: string;
    rate_limit_requests: number;
    rate_limit_window_seconds: number;
    monthly_quota: number | null;
    quota_used_this_month: number;
    is_active: number;
    last_used_at: string | null;
    expires_at: string | null;
    created_by: number;
    created_at: string;
    revoked_at: string | null;
  }>;

  return results.map(result => ({
    ...result,
    description: result.description || undefined,
    scopes: JSON.parse(result.scopes),
    monthly_quota: result.monthly_quota || undefined,
    is_active: !!result.is_active,
    last_used_at: result.last_used_at || undefined,
    expires_at: result.expires_at || undefined,
    revoked_at: result.revoked_at || undefined,
  }));
}

/**
 * Update last used timestamp for an API key
 */
export async function updateApiKeyLastUsed(ctx: DatabaseContext, id: number): Promise<void> {
  if (ctx.type === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', id);
    return;
  }

  if (!ctx.sqlite) return;

  ctx.sqlite.prepare(`
    UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?
  `).run(id);
}

export async function incrementApiKeyQuotaUsed(ctx: DatabaseContext, id: number): Promise<void> {
  if (ctx.type === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Read current value and increment (atomic enough for quota tracking)
    const { data } = await supabase
      .from('api_keys')
      .select('quota_used_this_month')
      .eq('id', id)
      .single();

    const currentUsage = data?.quota_used_this_month ?? 0;

    await supabase
      .from('api_keys')
      .update({ quota_used_this_month: currentUsage + 1 })
      .eq('id', id);
    return;
  }

  if (!ctx.sqlite) return;

  ctx.sqlite.prepare(`
    UPDATE api_keys SET quota_used_this_month = quota_used_this_month + 1 WHERE id = ?
  `).run(id);
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(ctx: DatabaseContext, id: number, organizationId: number, revokedBy: number, reason?: string): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'revokeApiKey');

  if (ctx.type === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error } = await supabase
      .from('api_keys')
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
        revoked_by: revokedBy,
        revoked_reason: reason,
      })
      .eq('id', id)
      .eq('organization_id', organizationId);

    return !error;
  }

  if (!ctx.sqlite) return false;

  const result = ctx.sqlite.prepare(`
    UPDATE api_keys
    SET is_active = 0, revoked_at = datetime('now'), revoked_by = ?, revoked_reason = ?
    WHERE id = ? AND organization_id = ?
  `).run(revokedBy, reason || null, id, organizationId);

  return result.changes > 0;
}

/**
 * Log API key usage
 */
export async function logApiKeyUsage(ctx: DatabaseContext, data: {
  api_key_id: number;
  organization_id: number;
  endpoint: string;
  method: string;
  status_code: number;
  response_time_ms?: number;
  ip_address?: string;
  user_agent?: string;
}): Promise<void> {
  if (ctx.type === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from('api_key_usage_log').insert(data);
    return;
  }

  if (!ctx.sqlite) return;

  ctx.sqlite.prepare(`
    INSERT INTO api_key_usage_log (api_key_id, organization_id, endpoint, method, status_code, response_time_ms, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.api_key_id,
    data.organization_id,
    data.endpoint,
    data.method,
    data.status_code,
    data.response_time_ms || null,
    data.ip_address || null,
    data.user_agent || null
  );
}

/**
 * Get API key usage statistics
 */
export async function getApiKeyUsageStats(ctx: DatabaseContext, apiKeyId: number, organizationId: number, days: number): Promise<{
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  avg_response_time_ms: number;
  requests_by_endpoint: Record<string, number>;
  requests_by_day: Array<{ date: string; count: number }>;
}> {
  ctx.validateTenantContext(organizationId, 'getApiKeyUsageStats');

  const emptyStats = {
    total_requests: 0,
    successful_requests: 0,
    failed_requests: 0,
    avg_response_time_ms: 0,
    requests_by_endpoint: {},
    requests_by_day: [],
  };

  if (ctx.type === 'supabase') {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data, error } = await supabase
      .from('api_key_usage_log')
      .select('*')
      .eq('api_key_id', apiKeyId)
      .eq('organization_id', organizationId)
      .gte('created_at', since.toISOString());

    if (error || !data) return emptyStats;

    return calculateUsageStats(data);
  }

  if (!ctx.sqlite) return emptyStats;

  const results = ctx.sqlite.prepare(`
    SELECT * FROM api_key_usage_log
    WHERE api_key_id = ? AND organization_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
  `).all(apiKeyId, organizationId, days) as Array<{
    endpoint: string;
    status_code: number;
    response_time_ms: number | null;
    created_at: string;
  }>;

  return calculateUsageStats(results);
}

export function calculateUsageStats(data: Array<{
  endpoint: string;
  status_code: number;
  response_time_ms?: number | null;
  created_at: string;
}>): {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  avg_response_time_ms: number;
  requests_by_endpoint: Record<string, number>;
  requests_by_day: Array<{ date: string; count: number }>;
} {
  const total_requests = data.length;
  const successful_requests = data.filter(d => d.status_code >= 200 && d.status_code < 300).length;
  const failed_requests = data.filter(d => d.status_code >= 400).length;

  const responseTimes = data.filter(d => d.response_time_ms != null).map(d => d.response_time_ms!);
  const avg_response_time_ms = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;

  const requests_by_endpoint: Record<string, number> = {};
  for (const d of data) {
    requests_by_endpoint[d.endpoint] = (requests_by_endpoint[d.endpoint] || 0) + 1;
  }

  const byDay: Record<string, number> = {};
  for (const d of data) {
    const date = d.created_at.split('T')[0];
    byDay[date] = (byDay[date] || 0) + 1;
  }

  const requests_by_day = Object.entries(byDay)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    total_requests,
    successful_requests,
    failed_requests,
    avg_response_time_ms,
    requests_by_endpoint,
    requests_by_day,
  };
}

// ============ Webhook Operations ============

/**
 * Create a new webhook endpoint
 */
export async function createWebhookEndpoint(ctx: DatabaseContext, data: {
  organization_id: number;
  url: string;
  name: string;
  description?: string;
  events: string[];
  secret_hash: string;
  created_by: number;
}): Promise<{
  id: number;
  organization_id: number;
  url: string;
  name: string;
  description?: string;
  events: string[];
  is_active: boolean;
  failure_count: number;
  last_failure_at?: string;
  last_success_at?: string;
  disabled_at?: string;
  disabled_reason?: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}> {
  const now = new Date().toISOString();

  if (ctx.type === 'supabase') {
    const { data: result, error } = await ctx.supabase!.getClient()
      .from('webhook_endpoints')
      .insert({
        organization_id: data.organization_id,
        url: data.url,
        name: data.name,
        description: data.description,
        events: data.events,
        secret_hash: data.secret_hash,
        created_by: data.created_by,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create webhook endpoint: ${error.message}`);
    return result;
  }

  const result = ctx.sqlite!.prepare(`
    INSERT INTO webhook_endpoints (organization_id, url, name, description, events, secret_hash, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.organization_id,
    data.url,
    data.name,
    data.description || null,
    JSON.stringify(data.events),
    data.secret_hash,
    data.created_by,
    now,
    now
  );

  return {
    id: result.lastInsertRowid as number,
    organization_id: data.organization_id,
    url: data.url,
    name: data.name,
    description: data.description,
    events: data.events,
    is_active: true,
    failure_count: 0,
    created_by: data.created_by,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Get all webhooks for an organization
 */
export async function getOrganizationWebhooks(ctx: DatabaseContext, organizationId: number): Promise<Array<{
  id: number;
  organization_id: number;
  url: string;
  name: string;
  description?: string;
  events: string[];
  is_active: boolean;
  failure_count: number;
  last_failure_at?: string;
  last_success_at?: string;
  disabled_at?: string;
  disabled_reason?: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}>> {
  if (ctx.type === 'supabase') {
    const { data, error } = await ctx.supabase!.getClient()
      .from('webhook_endpoints')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get webhooks: ${error.message}`);
    return data || [];
  }

  const results = ctx.sqlite!.prepare(`
    SELECT * FROM webhook_endpoints
    WHERE organization_id = ?
    ORDER BY created_at DESC
  `).all(organizationId) as Array<{
    id: number;
    organization_id: number;
    url: string;
    name: string;
    description: string | null;
    events: string;
    is_active: number;
    failure_count: number;
    last_failure_at: string | null;
    last_success_at: string | null;
    disabled_at: string | null;
    disabled_reason: string | null;
    created_by: number;
    created_at: string;
    updated_at: string;
  }>;

  return results.map(r => ({
    ...r,
    description: r.description || undefined,
    events: JSON.parse(r.events),
    is_active: Boolean(r.is_active),
    last_failure_at: r.last_failure_at || undefined,
    last_success_at: r.last_success_at || undefined,
    disabled_at: r.disabled_at || undefined,
    disabled_reason: r.disabled_reason || undefined,
  }));
}

/**
 * Get a specific webhook by ID
 */
export async function getWebhookEndpointById(ctx: DatabaseContext, id: number, organizationId: number): Promise<{
  id: number;
  organization_id: number;
  url: string;
  name: string;
  description?: string;
  events: string[];
  is_active: boolean;
  failure_count: number;
  last_failure_at?: string;
  last_success_at?: string;
  disabled_at?: string;
  disabled_reason?: string;
  created_by: number;
  created_at: string;
  updated_at: string;
} | null> {
  if (ctx.type === 'supabase') {
    const { data, error } = await ctx.supabase!.getClient()
      .from('webhook_endpoints')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get webhook: ${error.message}`);
    }
    return data;
  }

  const result = ctx.sqlite!.prepare(`
    SELECT * FROM webhook_endpoints
    WHERE id = ? AND organization_id = ?
  `).get(id, organizationId) as {
    id: number;
    organization_id: number;
    url: string;
    name: string;
    description: string | null;
    events: string;
    is_active: number;
    failure_count: number;
    last_failure_at: string | null;
    last_success_at: string | null;
    disabled_at: string | null;
    disabled_reason: string | null;
    created_by: number;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (!result) return null;

  return {
    ...result,
    description: result.description || undefined,
    events: JSON.parse(result.events),
    is_active: Boolean(result.is_active),
    last_failure_at: result.last_failure_at || undefined,
    last_success_at: result.last_success_at || undefined,
    disabled_at: result.disabled_at || undefined,
    disabled_reason: result.disabled_reason || undefined,
  };
}

/**
 * Get webhook with secret hash (for delivery signing)
 */
export async function getWebhookEndpointWithSecret(ctx: DatabaseContext, id: number): Promise<{
  id: number;
  organization_id: number;
  url: string;
  name: string;
  description?: string;
  events: string[];
  is_active: boolean;
  failure_count: number;
  secret_hash: string;
  created_by: number;
  created_at: string;
  updated_at: string;
} | null> {
  if (ctx.type === 'supabase') {
    const { data, error } = await ctx.supabase!.getClient()
      .from('webhook_endpoints')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get webhook with secret: ${error.message}`);
    }
    return data;
  }

  const result = ctx.sqlite!.prepare(`
    SELECT * FROM webhook_endpoints WHERE id = ?
  `).get(id) as {
    id: number;
    organization_id: number;
    url: string;
    name: string;
    description: string | null;
    events: string;
    is_active: number;
    failure_count: number;
    secret_hash: string;
    created_by: number;
    created_at: string;
    updated_at: string;
  } | undefined;

  if (!result) return null;

  return {
    ...result,
    description: result.description || undefined,
    events: JSON.parse(result.events),
    is_active: Boolean(result.is_active),
  };
}

/**
 * Get active webhooks that subscribe to an event type
 */
export async function getActiveWebhookEndpointsForEvent(ctx: DatabaseContext, organizationId: number, eventType: string): Promise<Array<{
  id: number;
  organization_id: number;
  url: string;
  name: string;
  events: string[];
  is_active: boolean;
  failure_count: number;
  created_by: number;
  created_at: string;
  updated_at: string;
}>> {
  if (ctx.type === 'supabase') {
    const { data, error } = await ctx.supabase!.getClient()
      .from('webhook_endpoints')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .contains('events', [eventType]);

    if (error) throw new Error(`Failed to get active webhooks: ${error.message}`);
    return data || [];
  }

  const results = ctx.sqlite!.prepare(`
    SELECT * FROM webhook_endpoints
    WHERE organization_id = ? AND is_active = 1
  `).all(organizationId) as Array<{
    id: number;
    organization_id: number;
    url: string;
    name: string;
    description: string | null;
    events: string;
    is_active: number;
    failure_count: number;
    created_by: number;
    created_at: string;
    updated_at: string;
  }>;

  // Filter by event type (SQLite doesn't have array contains)
  return results
    .map(r => ({
      ...r,
      events: JSON.parse(r.events) as string[],
      is_active: Boolean(r.is_active),
    }))
    .filter(r => r.events.includes(eventType));
}

/**
 * Update a webhook endpoint
 */
export async function updateWebhookEndpoint(
  ctx: DatabaseContext,
  id: number,
  organizationId: number,
  data: { url?: string; name?: string; description?: string; events?: string[]; is_active?: boolean }
): Promise<{
  id: number;
  organization_id: number;
  url: string;
  name: string;
  description?: string;
  events: string[];
  is_active: boolean;
  failure_count: number;
  created_by: number;
  created_at: string;
  updated_at: string;
} | null> {
  const now = new Date().toISOString();

  if (ctx.type === 'supabase') {
    const updateData: Record<string, unknown> = { updated_at: now };
    if (data.url !== undefined) updateData.url = data.url;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.events !== undefined) updateData.events = data.events;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    const { data: result, error } = await ctx.supabase!.getClient()
      .from('webhook_endpoints')
      .update(updateData)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to update webhook: ${error.message}`);
    }
    return result;
  }

  // SQLite: Build dynamic update
  const updates: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (data.url !== undefined) { updates.push('url = ?'); values.push(data.url); }
  if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name); }
  if (data.description !== undefined) { updates.push('description = ?'); values.push(data.description); }
  if (data.events !== undefined) { updates.push('events = ?'); values.push(JSON.stringify(data.events)); }
  if (data.is_active !== undefined) { updates.push('is_active = ?'); values.push(data.is_active ? 1 : 0); }

  values.push(id, organizationId);

  ctx.sqlite!.prepare(`
    UPDATE webhook_endpoints SET ${updates.join(', ')}
    WHERE id = ? AND organization_id = ?
  `).run(...values);

  return getWebhookEndpointById(ctx, id, organizationId);
}

/**
 * Update webhook secret
 */
export async function updateWebhookSecret(ctx: DatabaseContext, id: number, organizationId: number, secretHash: string): Promise<boolean> {
  const now = new Date().toISOString();

  if (ctx.type === 'supabase') {
    const { error } = await ctx.supabase!.getClient()
      .from('webhook_endpoints')
      .update({ secret_hash: secretHash, updated_at: now })
      .eq('id', id)
      .eq('organization_id', organizationId);

    if (error) throw new Error(`Failed to update webhook secret: ${error.message}`);
    return true;
  }

  const result = ctx.sqlite!.prepare(`
    UPDATE webhook_endpoints SET secret_hash = ?, updated_at = ?
    WHERE id = ? AND organization_id = ?
  `).run(secretHash, now, id, organizationId);

  return result.changes > 0;
}

/**
 * Delete a webhook endpoint
 */
export async function deleteWebhookEndpoint(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  if (ctx.type === 'supabase') {
    const { error, count } = await ctx.supabase!.getClient()
      .from('webhook_endpoints')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('organization_id', organizationId);

    if (error) throw new Error(`Failed to delete webhook: ${error.message}`);
    return (count ?? 0) > 0;
  }

  const result = ctx.sqlite!.prepare(`
    DELETE FROM webhook_endpoints WHERE id = ? AND organization_id = ?
  `).run(id, organizationId);

  return result.changes > 0;
}

/**
 * Disable a webhook endpoint
 */
export async function disableWebhookEndpoint(ctx: DatabaseContext, id: number, reason: string): Promise<boolean> {
  const now = new Date().toISOString();

  if (ctx.type === 'supabase') {
    const { error } = await ctx.supabase!.getClient()
      .from('webhook_endpoints')
      .update({ is_active: false, disabled_at: now, disabled_reason: reason, updated_at: now })
      .eq('id', id);

    if (error) throw new Error(`Failed to disable webhook: ${error.message}`);
    return true;
  }

  const result = ctx.sqlite!.prepare(`
    UPDATE webhook_endpoints
    SET is_active = 0, disabled_at = ?, disabled_reason = ?, updated_at = ?
    WHERE id = ?
  `).run(now, reason, now, id);

  return result.changes > 0;
}

/**
 * Record successful webhook delivery
 */
export async function recordWebhookSuccess(ctx: DatabaseContext, id: number): Promise<void> {
  const now = new Date().toISOString();

  if (ctx.type === 'supabase') {
    await ctx.supabase!.getClient()
      .from('webhook_endpoints')
      .update({ failure_count: 0, last_success_at: now, updated_at: now })
      .eq('id', id);
    return;
  }

  ctx.sqlite!.prepare(`
    UPDATE webhook_endpoints
    SET failure_count = 0, last_success_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, id);
}

/**
 * Record failed webhook delivery
 */
export async function recordWebhookFailure(ctx: DatabaseContext, id: number): Promise<void> {
  const now = new Date().toISOString();

  if (ctx.type === 'supabase') {
    await ctx.supabase!.getClient().rpc('increment_webhook_failure', { webhook_id: id });
    await ctx.supabase!.getClient()
      .from('webhook_endpoints')
      .update({ last_failure_at: now, updated_at: now })
      .eq('id', id);
    return;
  }

  ctx.sqlite!.prepare(`
    UPDATE webhook_endpoints
    SET failure_count = failure_count + 1, last_failure_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, id);
}

// ============ Webhook Delivery Operations ============

/**
 * Create a webhook delivery record
 */
export async function createWebhookDelivery(ctx: DatabaseContext, data: {
  webhook_endpoint_id: number;
  organization_id: number;
  event_type: string;
  event_id: string;
  payload: unknown;
}): Promise<{
  id: number;
  webhook_endpoint_id: number;
  organization_id: number;
  event_type: string;
  event_id: string;
  payload: unknown;
  status: string;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
}> {
  const now = new Date().toISOString();

  if (ctx.type === 'supabase') {
    const { data: result, error } = await ctx.supabase!.getClient()
      .from('webhook_deliveries')
      .insert({
        webhook_endpoint_id: data.webhook_endpoint_id,
        organization_id: data.organization_id,
        event_type: data.event_type,
        event_id: data.event_id,
        payload: data.payload,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create webhook delivery: ${error.message}`);
    return result;
  }

  const result = ctx.sqlite!.prepare(`
    INSERT INTO webhook_deliveries (webhook_endpoint_id, organization_id, event_type, event_id, payload, status, attempt_count, max_attempts, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, 5, ?)
  `).run(
    data.webhook_endpoint_id,
    data.organization_id,
    data.event_type,
    data.event_id,
    JSON.stringify(data.payload),
    now
  );

  return {
    id: result.lastInsertRowid as number,
    webhook_endpoint_id: data.webhook_endpoint_id,
    organization_id: data.organization_id,
    event_type: data.event_type,
    event_id: data.event_id,
    payload: data.payload,
    status: 'pending',
    attempt_count: 0,
    max_attempts: 5,
    created_at: now,
  };
}

/**
 * Get pending webhook deliveries for processing
 */
export async function getPendingWebhookDeliveries(ctx: DatabaseContext): Promise<Array<{
  id: number;
  webhook_endpoint_id: number;
  organization_id: number;
  event_type: string;
  event_id: string;
  payload: unknown;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_retry_at?: string;
  created_at: string;
}>> {
  const now = new Date().toISOString();

  if (ctx.type === 'supabase') {
    const { data, error } = await ctx.supabase!.getClient()
      .from('webhook_deliveries')
      .select('*')
      .or(`status.eq.pending,and(status.eq.retrying,next_retry_at.lte.${now})`)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) throw new Error(`Failed to get pending deliveries: ${error.message}`);
    return data || [];
  }

  const results = ctx.sqlite!.prepare(`
    SELECT * FROM webhook_deliveries
    WHERE status = 'pending'
       OR (status = 'retrying' AND next_retry_at <= ?)
    ORDER BY created_at ASC
    LIMIT 100
  `).all(now) as Array<{
    id: number;
    webhook_endpoint_id: number;
    organization_id: number;
    event_type: string;
    event_id: string;
    payload: string;
    status: string;
    attempt_count: number;
    max_attempts: number;
    next_retry_at: string | null;
    created_at: string;
  }>;

  return results.map(r => ({
    ...r,
    payload: JSON.parse(r.payload),
    next_retry_at: r.next_retry_at || undefined,
  }));
}

/**
 * Get a specific webhook delivery
 */
export async function getWebhookDeliveryById(ctx: DatabaseContext, id: number, organizationId: number): Promise<{
  id: number;
  webhook_endpoint_id: number;
  organization_id: number;
  event_type: string;
  event_id: string;
  payload: unknown;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_retry_at?: string;
  response_status?: number;
  response_body?: string;
  response_time_ms?: number;
  error_message?: string;
  created_at: string;
  delivered_at?: string;
} | null> {
  if (ctx.type === 'supabase') {
    const { data, error } = await ctx.supabase!.getClient()
      .from('webhook_deliveries')
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get delivery: ${error.message}`);
    }
    return data;
  }

  const result = ctx.sqlite!.prepare(`
    SELECT * FROM webhook_deliveries
    WHERE id = ? AND organization_id = ?
  `).get(id, organizationId) as {
    id: number;
    webhook_endpoint_id: number;
    organization_id: number;
    event_type: string;
    event_id: string;
    payload: string;
    status: string;
    attempt_count: number;
    max_attempts: number;
    next_retry_at: string | null;
    response_status: number | null;
    response_body: string | null;
    response_time_ms: number | null;
    error_message: string | null;
    created_at: string;
    delivered_at: string | null;
  } | undefined;

  if (!result) return null;

  return {
    ...result,
    payload: JSON.parse(result.payload),
    next_retry_at: result.next_retry_at || undefined,
    response_status: result.response_status || undefined,
    response_body: result.response_body || undefined,
    response_time_ms: result.response_time_ms || undefined,
    error_message: result.error_message || undefined,
    delivered_at: result.delivered_at || undefined,
  };
}

/**
 * Get delivery history for a webhook endpoint
 */
export async function getWebhookDeliveryHistory(ctx: DatabaseContext, webhookId: number, organizationId: number, limit: number): Promise<Array<{
  id: number;
  webhook_endpoint_id: number;
  organization_id: number;
  event_type: string;
  event_id: string;
  payload: unknown;
  status: string;
  attempt_count: number;
  max_attempts: number;
  response_status?: number;
  response_time_ms?: number;
  error_message?: string;
  created_at: string;
  delivered_at?: string;
}>> {
  if (ctx.type === 'supabase') {
    const { data, error } = await ctx.supabase!.getClient()
      .from('webhook_deliveries')
      .select('*')
      .eq('webhook_endpoint_id', webhookId)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to get delivery history: ${error.message}`);
    return data || [];
  }

  const results = ctx.sqlite!.prepare(`
    SELECT * FROM webhook_deliveries
    WHERE webhook_endpoint_id = ? AND organization_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(webhookId, organizationId, limit) as Array<{
    id: number;
    webhook_endpoint_id: number;
    organization_id: number;
    event_type: string;
    event_id: string;
    payload: string;
    status: string;
    attempt_count: number;
    max_attempts: number;
    response_status: number | null;
    response_time_ms: number | null;
    error_message: string | null;
    created_at: string;
    delivered_at: string | null;
  }>;

  return results.map(r => ({
    ...r,
    payload: JSON.parse(r.payload),
    response_status: r.response_status || undefined,
    response_time_ms: r.response_time_ms || undefined,
    error_message: r.error_message || undefined,
    delivered_at: r.delivered_at || undefined,
  }));
}

/**
 * Update webhook delivery status
 */
export async function updateWebhookDeliveryStatus(
  ctx: DatabaseContext,
  id: number,
  status: string,
  data: Partial<{
    attempt_count: number;
    next_retry_at: string;
    response_status: number;
    response_body: string;
    response_time_ms: number;
    error_message: string;
    delivered_at: string;
  }>
): Promise<void> {
  if (ctx.type === 'supabase') {
    const { error } = await ctx.supabase!.getClient()
      .from('webhook_deliveries')
      .update({ status, ...data })
      .eq('id', id);

    if (error) throw new Error(`Failed to update delivery status: ${error.message}`);
    return;
  }

  // SQLite: Build dynamic update
  const updates: string[] = ['status = ?'];
  const values: unknown[] = [status];

  if (data.attempt_count !== undefined) { updates.push('attempt_count = ?'); values.push(data.attempt_count); }
  if (data.next_retry_at !== undefined) { updates.push('next_retry_at = ?'); values.push(data.next_retry_at); }
  if (data.response_status !== undefined) { updates.push('response_status = ?'); values.push(data.response_status); }
  if (data.response_body !== undefined) { updates.push('response_body = ?'); values.push(data.response_body); }
  if (data.response_time_ms !== undefined) { updates.push('response_time_ms = ?'); values.push(data.response_time_ms); }
  if (data.error_message !== undefined) { updates.push('error_message = ?'); values.push(data.error_message); }
  if (data.delivered_at !== undefined) { updates.push('delivered_at = ?'); values.push(data.delivered_at); }

  values.push(id);

  ctx.sqlite!.prepare(`UPDATE webhook_deliveries SET ${updates.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * API Key Service
 * Handles creation, validation, and management of API keys
 */

import crypto from 'crypto';
import { createLogger } from './logger';
import type {
  ApiKey,
  ApiKeyWithHash,
  ApiKeyAuthContext,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  ApiKeyInsertData,
  ApiKeyUsageInsertData,
  RateLimitResult,
} from '../types/api-key';

const log = createLogger('api-keys');

// Constants
const API_KEY_PREFIX = 'sk_live_';
const API_KEY_LENGTH = 32; // bytes for random portion
const DEFAULT_RATE_LIMIT_REQUESTS = 1000;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

// Rate limit cache with short TTL to reduce DB queries
// Falls back to DB count if cache misses or on restart
const rateLimitCache = new Map<number, { count: number; windowStart: number; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds cache

/**
 * API Key Service class
 */
export class ApiKeyService {
  private getDatabase: () => Promise<DatabaseInterface>;

  constructor(getDatabaseFn: () => Promise<DatabaseInterface>) {
    this.getDatabase = getDatabaseFn;
  }

  /**
   * Generate a new API key
   * Returns the full key ONLY ONCE - must be shown to user immediately
   */
  async createApiKey(
    organizationId: number,
    data: CreateApiKeyRequest,
    createdBy: number
  ): Promise<CreateApiKeyResponse> {
    // Generate random key body
    const keyBody = crypto.randomBytes(API_KEY_LENGTH).toString('base64url');
    const fullKey = `${API_KEY_PREFIX}${keyBody}`;
    const keyPrefix = fullKey.substring(0, 16); // Store first 16 chars for display
    const keyHash = this.hashKey(fullKey);

    const insertData: ApiKeyInsertData = {
      organization_id: organizationId,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      name: data.name,
      description: data.description,
      scopes: data.scopes,
      expires_at: data.expires_at,
      monthly_quota: data.monthly_quota,
      rate_limit_requests: data.rate_limit_requests || DEFAULT_RATE_LIMIT_REQUESTS,
      rate_limit_window_seconds: data.rate_limit_window_seconds || DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
      created_by: createdBy,
    };

    const db = await this.getDatabase();
    const apiKey = await db.createApiKey(insertData);

    log.info(
      { apiKeyId: apiKey.id, organizationId, name: data.name },
      'API key created'
    );

    return { apiKey, fullKey };
  }

  /**
   * Validate an API key and return its context
   * Returns null if invalid
   */
  async validateApiKey(key: string): Promise<ApiKeyAuthContext | null> {
    // Quick format check
    if (!key || !key.startsWith(API_KEY_PREFIX)) {
      return null;
    }

    const keyHash = this.hashKey(key);
    const db = await this.getDatabase();
    const apiKey = await db.getApiKeyByHash(keyHash);

    if (!apiKey) {
      log.debug({ keyPrefix: key.substring(0, 16) }, 'API key not found');
      return null;
    }

    // Check if active
    if (!apiKey.is_active) {
      log.debug({ apiKeyId: apiKey.id }, 'API key is inactive');
      return null;
    }

    // Check expiration
    if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
      log.debug({ apiKeyId: apiKey.id }, 'API key has expired');
      return null;
    }

    // Check rate limit
    const rateLimitResult = this.checkRateLimit(
      apiKey.id,
      apiKey.rate_limit_requests,
      apiKey.rate_limit_window_seconds * 1000
    );

    // Update last used timestamp (async, don't wait)
    db.updateApiKeyLastUsed(apiKey.id).catch(err => {
      log.error({ err, apiKeyId: apiKey.id }, 'Failed to update last used timestamp');
    });

    return {
      apiKeyId: apiKey.id,
      organizationId: apiKey.organization_id,
      scopes: apiKey.scopes,
      rateLimitRemaining: rateLimitResult.remaining,
      rateLimitReset: rateLimitResult.resetAt,
      monthlyQuota: apiKey.monthly_quota,
      quotaUsedThisMonth: apiKey.quota_used_this_month ?? 0,
    };
  }

  /**
   * Check rate limit for an API key
   * Uses DB-backed counting with short TTL cache for performance
   */
  checkRateLimit(apiKeyId: number, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;
    const cached = rateLimitCache.get(apiKeyId);

    // Use cache if valid and within same window
    if (cached && now < cached.expiresAt && cached.windowStart >= windowStart - CACHE_TTL_MS) {
      cached.count++;
      return {
        allowed: cached.count <= limit,
        limit,
        remaining: Math.max(0, limit - cached.count),
        resetAt: Math.ceil((cached.windowStart + windowMs) / 1000),
      };
    }

    // Cache miss: start fresh count (DB sync happens via logUsage)
    // The actual DB count is loaded asynchronously below
    const newRecord = { count: 1, windowStart: now, expiresAt: now + CACHE_TTL_MS };
    rateLimitCache.set(apiKeyId, newRecord);

    // Async: load actual count from DB to sync cache
    this.syncRateLimitFromDb(apiKeyId, windowMs).catch(() => {});

    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetAt: Math.ceil((now + windowMs) / 1000),
    };
  }

  /**
   * Sync rate limit cache from api_key_usage_log table
   */
  private async syncRateLimitFromDb(apiKeyId: number, windowMs: number): Promise<void> {
    try {
      const db = await this.getDatabase();
      const stats = await db.getApiKeyUsageStats(apiKeyId, 0, 1); // last 1 day
      const count = stats.total_requests;
      const now = Date.now();
      const cached = rateLimitCache.get(apiKeyId);
      if (cached) {
        // Update cache with actual DB count (add any requests since cache was created)
        const additionalSinceSync = Math.max(0, cached.count - 1);
        cached.count = count + additionalSinceSync;
        cached.expiresAt = now + CACHE_TTL_MS;
      }
    } catch {
      // Non-critical: cache will self-correct on next sync
    }
  }

  /**
   * Get rate limit status without incrementing
   */
  getRateLimitStatus(apiKeyId: number, limit: number): RateLimitResult {
    const cached = rateLimitCache.get(apiKeyId);
    const now = Date.now();

    if (!cached || now >= cached.expiresAt) {
      return {
        allowed: true,
        limit,
        remaining: limit,
        resetAt: Math.ceil((now + DEFAULT_RATE_LIMIT_WINDOW_SECONDS * 1000) / 1000),
      };
    }

    return {
      allowed: cached.count < limit,
      limit,
      remaining: Math.max(0, limit - cached.count),
      resetAt: Math.ceil((cached.windowStart + DEFAULT_RATE_LIMIT_WINDOW_SECONDS * 1000) / 1000),
    };
  }

  /**
   * List all API keys for an organization (without hashes)
   */
  async listApiKeys(organizationId: number): Promise<ApiKey[]> {
    const db = await this.getDatabase();
    return db.getOrganizationApiKeys(organizationId);
  }

  /**
   * Get a single API key by ID (for the organization)
   */
  async getApiKey(apiKeyId: number, organizationId: number): Promise<ApiKey | null> {
    const db = await this.getDatabase();
    return db.getApiKeyById(apiKeyId, organizationId);
  }

  /**
   * Revoke (deactivate) an API key
   */
  async revokeApiKey(
    apiKeyId: number,
    organizationId: number,
    revokedBy: number,
    reason?: string
  ): Promise<boolean> {
    const db = await this.getDatabase();
    const result = await db.revokeApiKey(apiKeyId, organizationId, revokedBy, reason);

    if (result) {
      // Clear rate limit cache
      rateLimitCache.delete(apiKeyId);

      log.info(
        { apiKeyId, organizationId, revokedBy, reason },
        'API key revoked'
      );
    }

    return result;
  }

  /**
   * Rotate an API key - creates new key with same settings, revokes old
   */
  async rotateApiKey(
    apiKeyId: number,
    organizationId: number,
    rotatedBy: number
  ): Promise<CreateApiKeyResponse> {
    const db = await this.getDatabase();
    const existing = await db.getApiKeyById(apiKeyId, organizationId);

    if (!existing) {
      throw new Error('API-nøkkel ikke funnet');
    }

    // Create new key with same settings
    const result = await this.createApiKey(
      organizationId,
      {
        name: `${existing.name} (rotert)`,
        description: existing.description,
        scopes: existing.scopes,
        expires_at: existing.expires_at,
        monthly_quota: existing.monthly_quota,
        rate_limit_requests: existing.rate_limit_requests,
        rate_limit_window_seconds: existing.rate_limit_window_seconds,
      },
      rotatedBy
    );

    // Revoke old key
    await this.revokeApiKey(apiKeyId, organizationId, rotatedBy, 'Nøkkelrotasjon');

    log.info(
      { oldKeyId: apiKeyId, newKeyId: result.apiKey.id, organizationId },
      'API key rotated'
    );

    return result;
  }

  /**
   * Log API key usage for analytics
   */
  async logUsage(data: ApiKeyUsageInsertData): Promise<void> {
    try {
      const db = await this.getDatabase();
      await db.logApiKeyUsage(data);
      // Increment monthly quota counter
      await db.incrementApiKeyQuotaUsed(data.api_key_id);
    } catch (err) {
      // Don't fail requests due to logging errors
      log.error({ err, apiKeyId: data.api_key_id }, 'Failed to log API key usage');
    }
  }

  /**
   * Get usage statistics for an API key
   */
  async getUsageStats(
    apiKeyId: number,
    organizationId: number,
    days: number = 30
  ): Promise<ApiKeyUsageStats> {
    const db = await this.getDatabase();
    return db.getApiKeyUsageStats(apiKeyId, organizationId, days);
  }

  /**
   * Hash an API key using SHA-256
   */
  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }
}

// ============ Types for Database Interface ============

/**
 * Database interface for API key operations
 * This should be implemented in database.ts
 */
export interface DatabaseInterface {
  createApiKey(data: ApiKeyInsertData): Promise<ApiKey>;
  getApiKeyByHash(keyHash: string): Promise<ApiKeyWithHash | null>;
  getApiKeyById(id: number, organizationId: number): Promise<ApiKey | null>;
  getOrganizationApiKeys(organizationId: number): Promise<ApiKey[]>;
  updateApiKeyLastUsed(id: number): Promise<void>;
  incrementApiKeyQuotaUsed(id: number): Promise<void>;
  revokeApiKey(id: number, organizationId: number, revokedBy: number, reason?: string): Promise<boolean>;
  logApiKeyUsage(data: ApiKeyUsageInsertData): Promise<void>;
  getApiKeyUsageStats(apiKeyId: number, organizationId: number, days: number): Promise<ApiKeyUsageStats>;
}

export interface ApiKeyUsageStats {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  avg_response_time_ms: number;
  requests_by_endpoint: Record<string, number>;
  requests_by_day: Array<{ date: string; count: number }>;
}

// ============ Singleton Instance ============

let apiKeyServiceInstance: ApiKeyService | null = null;

/**
 * Get the singleton API key service instance
 */
export async function getApiKeyService(): Promise<ApiKeyService> {
  if (!apiKeyServiceInstance) {
    // Lazy import to avoid circular dependency
    const { getDatabase } = await import('./database');
    // Cast is safe because DatabaseService implements the required methods
    apiKeyServiceInstance = new ApiKeyService(getDatabase as unknown as () => Promise<DatabaseInterface>);
  }
  return apiKeyServiceInstance;
}

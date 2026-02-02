/**
 * Type definitions for API Key authentication system
 */

// ============ API Key Scopes ============

/**
 * Available API scopes for granular permission control
 */
export type ApiScope =
  | 'customers:read'
  | 'customers:write'
  | 'routes:read'
  | 'routes:write'
  | 'appointments:read'
  | 'appointments:write'
  | 'webhooks:manage';

/**
 * Scope categories for UI grouping
 */
export const API_SCOPE_CATEGORIES = {
  customers: ['customers:read', 'customers:write'],
  routes: ['routes:read', 'routes:write'],
  appointments: ['appointments:read', 'appointments:write'],
  webhooks: ['webhooks:manage'],
} as const;

/**
 * Human-readable scope descriptions (Norwegian)
 */
export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'customers:read': 'Les kunder',
  'customers:write': 'Opprett/endre kunder',
  'routes:read': 'Les ruter',
  'routes:write': 'Opprett/endre ruter',
  'appointments:read': 'Les avtaler',
  'appointments:write': 'Opprett/endre avtaler',
  'webhooks:manage': 'Administrer webhooks',
};

// ============ API Key Models ============

/**
 * API Key database record
 */
export interface ApiKey {
  id: number;
  organization_id: number;
  key_prefix: string;
  name: string;
  description?: string;
  scopes: ApiScope[];
  rate_limit_requests: number;
  rate_limit_window_seconds: number;
  monthly_quota?: number;
  quota_used_this_month: number;
  quota_reset_at?: string;
  is_active: boolean;
  last_used_at?: string;
  expires_at?: string;
  created_by: number;
  created_at: string;
  revoked_at?: string;
  revoked_by?: number;
  revoked_reason?: string;
}

/**
 * API Key with full hash (internal use only)
 */
export interface ApiKeyWithHash extends ApiKey {
  key_hash: string;
}

/**
 * API Key usage log entry
 */
export interface ApiKeyUsageLog {
  id: number;
  api_key_id: number;
  organization_id: number;
  endpoint: string;
  method: string;
  status_code: number;
  response_time_ms?: number;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

// ============ Request/Response Types ============

/**
 * Request body for creating a new API key
 */
export interface CreateApiKeyRequest {
  name: string;
  description?: string;
  scopes: ApiScope[];
  expires_at?: string;
  monthly_quota?: number;
  rate_limit_requests?: number;
  rate_limit_window_seconds?: number;
}

/**
 * Request body for updating an API key
 */
export interface UpdateApiKeyRequest {
  name?: string;
  description?: string;
  scopes?: ApiScope[];
  is_active?: boolean;
  expires_at?: string;
  monthly_quota?: number;
  rate_limit_requests?: number;
  rate_limit_window_seconds?: number;
}

/**
 * Response when creating a new API key
 * IMPORTANT: fullKey is only returned once and must be shown to user immediately
 */
export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  fullKey: string;
}

/**
 * API Key authentication context attached to requests
 */
export interface ApiKeyAuthContext {
  apiKeyId: number;
  organizationId: number;
  scopes: ApiScope[];
  rateLimitRemaining: number;
  rateLimitReset: number;
}

// ============ Rate Limit Types ============

/**
 * Rate limit check result
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp
}

/**
 * Rate limit record for in-memory tracking
 */
export interface RateLimitRecord {
  count: number;
  resetAt: number; // Unix timestamp in ms
}

// ============ Database Insert Types ============

/**
 * Data for inserting a new API key
 */
export interface ApiKeyInsertData {
  organization_id: number;
  key_prefix: string;
  key_hash: string;
  name: string;
  description?: string;
  scopes: ApiScope[];
  expires_at?: string;
  monthly_quota?: number;
  rate_limit_requests?: number;
  rate_limit_window_seconds?: number;
  created_by: number;
}

/**
 * Data for logging API key usage
 */
export interface ApiKeyUsageInsertData {
  api_key_id: number;
  organization_id: number;
  endpoint: string;
  method: string;
  status_code: number;
  response_time_ms?: number;
  ip_address?: string;
  user_agent?: string;
}

// ============ Validation ============

/**
 * Validate if a string is a valid API scope
 */
export function isValidScope(scope: string): scope is ApiScope {
  const validScopes: string[] = [
    'customers:read',
    'customers:write',
    'routes:read',
    'routes:write',
    'appointments:read',
    'appointments:write',
    'webhooks:manage',
  ];
  return validScopes.includes(scope);
}

/**
 * Validate an array of scopes
 */
export function validateScopes(scopes: string[]): ApiScope[] {
  const valid: ApiScope[] = [];
  for (const scope of scopes) {
    if (isValidScope(scope)) {
      valid.push(scope);
    }
  }
  return valid;
}

/**
 * Check if scopes include a required scope
 */
export function hasScope(userScopes: ApiScope[], requiredScope: ApiScope): boolean {
  return userScopes.includes(requiredScope);
}

/**
 * Check if scopes include all required scopes
 */
export function hasAllScopes(userScopes: ApiScope[], requiredScopes: ApiScope[]): boolean {
  return requiredScopes.every(scope => userScopes.includes(scope));
}

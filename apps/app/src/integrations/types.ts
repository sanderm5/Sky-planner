/**
 * Integration types for external data source adapters
 * Supports OAuth2, API key, and basic authentication
 */

// ============ Credential Types ============

export type AuthType = 'oauth2' | 'api_key' | 'basic_auth';

export interface IntegrationCredentials {
  type: AuthType;
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

// ============ Field Mapping Types ============

export interface FieldMapping {
  /** Field name in the source system */
  sourceField: string;
  /** Field name in our system (standard or custom) */
  targetField: string;
  /** Optional transform function */
  transform?: (value: unknown) => unknown;
  /** Is this field required? */
  required: boolean;
}

// ============ Integration Configuration ============

export interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: string;
  clientSecret: string;
}

export interface RateLimitConfig {
  /** Max requests per window */
  requests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface IntegrationConfig {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** URL-safe slug */
  slug: string;
  /** Description for UI */
  description: string;
  /** FontAwesome icon class */
  icon: string;
  /** Authentication type */
  authType: AuthType;
  /** OAuth config (if authType is oauth2) */
  oauthConfig?: OAuthConfig;
  /** Base URL for API calls */
  baseUrl: string;
  /** Rate limiting configuration */
  rateLimit: RateLimitConfig;
  /** Default field mappings for this integration */
  defaultFieldMappings: FieldMapping[];
}

// ============ External Data Types ============

export interface ExternalCustomer {
  /** ID in the external system */
  externalId: string;
  /** Raw data from the external system */
  data: Record<string, unknown>;
  /** Optional raw API response for debugging */
  rawResponse?: unknown;
}

// ============ Sync Result Types ============

export interface SyncError {
  externalId: string;
  error: string;
  details?: Record<string, unknown>;
}

export interface SyncResult {
  /** Customers created */
  created: number;
  /** Customers updated */
  updated: number;
  /** Customers unchanged */
  unchanged: number;
  /** Customers that failed to sync */
  failed: number;
  /** Details of failures */
  errors: SyncError[];
  /** Timestamp of sync */
  syncedAt: Date;
}

// ============ Sync Options ============

export interface SyncOptions {
  /** Full sync (ignore last sync time) */
  fullSync?: boolean;
  /** Only sync customers changed since this date */
  since?: Date;
  /** Limit number of customers to sync */
  limit?: number;
}

// ============ Stored Integration Types ============

export interface StoredIntegration {
  id: number;
  organization_id: number;
  integration_id: string;
  credentials_encrypted: string;
  is_active: boolean;
  last_sync_at?: string;
  sync_frequency_hours: number;
  created_at: string;
  updated_at: string;
}

export interface IntegrationSyncLog {
  id: number;
  organization_id: number;
  integration_id: string;
  sync_type: 'manual' | 'scheduled';
  status: 'started' | 'completed' | 'failed';
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  error_message?: string;
  started_at: string;
  completed_at?: string;
}

// ============ Adapter Interface ============

export interface DataSourceAdapter {
  /** Integration configuration */
  readonly config: IntegrationConfig;

  // === Authentication ===

  /**
   * Authenticate with the external service
   * @param credentials Partial credentials (e.g., API key or OAuth code)
   * @returns Full credentials with tokens
   */
  authenticate(credentials: Partial<IntegrationCredentials>): Promise<IntegrationCredentials>;

  /**
   * Refresh expired credentials
   * @param credentials Existing credentials with refresh token
   * @returns New credentials with fresh tokens
   */
  refreshAuth(credentials: IntegrationCredentials): Promise<IntegrationCredentials>;

  /**
   * Validate that credentials are still valid
   * @param credentials Credentials to validate
   * @returns true if valid
   */
  validateCredentials(credentials: IntegrationCredentials): Promise<boolean>;

  // === Data Fetching ===

  /**
   * Fetch customers from the external system
   * @param credentials Valid credentials
   * @param options Fetch options (since, limit, etc.)
   * @returns Array of external customers
   */
  fetchCustomers(
    credentials: IntegrationCredentials,
    options?: { since?: Date; limit?: number; offset?: number }
  ): Promise<ExternalCustomer[]>;

  // === Mapping ===

  /**
   * Get the default field mappings for this integration
   * @returns Array of field mappings
   */
  getFieldMappings(): FieldMapping[];

  /**
   * Map an external customer to our Kunde format
   * @param external External customer data
   * @param customMappings Optional custom mappings to override defaults
   * @returns Partial Kunde object
   */
  mapToKunde(
    external: ExternalCustomer,
    customMappings?: FieldMapping[]
  ): Record<string, unknown>;

  // === Sync ===

  /**
   * Sync customers from external system to our database
   * @param organizationId Organization to sync for
   * @param credentials Valid credentials
   * @param options Sync options
   * @returns Sync result with statistics
   */
  syncCustomers(
    organizationId: number,
    credentials: IntegrationCredentials,
    options?: SyncOptions
  ): Promise<SyncResult>;
}

// ============ Error Types ============

export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly integrationId: string,
    public readonly statusCode?: number,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}

export class AuthenticationError extends IntegrationError {
  constructor(integrationId: string, message: string = 'Authentication failed') {
    super(message, integrationId, 401);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends IntegrationError {
  constructor(
    integrationId: string,
    public readonly retryAfterMs: number
  ) {
    super(`Rate limit exceeded, retry after ${retryAfterMs}ms`, integrationId, 429);
    this.name = 'RateLimitError';
  }
}

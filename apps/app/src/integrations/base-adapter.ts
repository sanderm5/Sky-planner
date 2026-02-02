/**
 * Base adapter class for external data source integrations
 * Provides common functionality like rate limiting, error handling, and sync logic
 */

import { logger } from '../services/logger';
import type {
  DataSourceAdapter,
  IntegrationConfig,
  IntegrationCredentials,
  ExternalCustomer,
  FieldMapping,
  SyncResult,
  SyncOptions,
} from './types';
import { IntegrationError, RateLimitError } from './types';

// Helper function for delays
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Abstract base class for data source adapters
 * Provides common functionality that all adapters need
 */
export abstract class BaseDataSourceAdapter implements DataSourceAdapter {
  abstract readonly config: IntegrationConfig;

  protected readonly adapterLogger = logger.child({ component: 'integration' });

  // Rate limiting state
  private requestCount = 0;
  private windowStart = Date.now();

  /**
   * Make an HTTP request with rate limiting
   */
  protected async rateLimitedFetch<T>(
    url: string,
    options: RequestInit,
    credentials: IntegrationCredentials
  ): Promise<T> {
    await this.waitForRateLimit();

    const headers = new Headers(options.headers);
    headers.set('Authorization', this.getAuthHeader(credentials));
    headers.set('Content-Type', 'application/json');

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle rate limit response
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
      throw new RateLimitError(this.config.id, retryMs);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'No error body');
      throw new IntegrationError(
        `API request failed: ${response.status} ${response.statusText} - ${errorBody}`,
        this.config.id,
        response.status
      );
    }

    return await response.json() as T;
  }

  /**
   * Wait for rate limit window if needed
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.windowStart;

    // Reset window if expired
    if (elapsed >= this.config.rateLimit.windowMs) {
      this.requestCount = 0;
      this.windowStart = now;
    }

    // Wait if we've hit the limit
    if (this.requestCount >= this.config.rateLimit.requests) {
      const waitTime = this.config.rateLimit.windowMs - elapsed;
      this.adapterLogger.debug(
        { integration: this.config.id, waitTime },
        'Rate limit reached, waiting'
      );
      await sleep(waitTime);
      this.requestCount = 0;
      this.windowStart = Date.now();
    }

    this.requestCount++;
  }

  /**
   * Get the Authorization header value for this credential type
   */
  protected getAuthHeader(credentials: IntegrationCredentials): string {
    switch (credentials.type) {
      case 'oauth2':
        return `Bearer ${credentials.accessToken}`;
      case 'api_key':
        return `Token ${credentials.apiKey}`;
      case 'basic_auth':
        const encoded = Buffer.from(
          `${credentials.username}:${credentials.password}`
        ).toString('base64');
        return `Basic ${encoded}`;
      default:
        throw new IntegrationError(
          `Unknown auth type: ${credentials.type}`,
          this.config.id
        );
    }
  }

  /**
   * Get a nested value from an object using dot notation
   * e.g., getNestedValue(obj, 'address.street') returns obj.address.street
   */
  protected getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current, key) => {
      if (current && typeof current === 'object') {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj as unknown);
  }

  /**
   * Default implementation of mapToKunde
   * Uses field mappings to transform external data
   */
  mapToKunde(
    external: ExternalCustomer,
    customMappings?: FieldMapping[]
  ): Record<string, unknown> {
    const mappings = customMappings || this.getFieldMappings();
    const data = external.data;
    const result: Record<string, unknown> = {};

    for (const mapping of mappings) {
      const value = this.getNestedValue(data, mapping.sourceField);

      if (value !== undefined && value !== null && value !== '') {
        const transformed = mapping.transform ? mapping.transform(value) : value;
        result[mapping.targetField] = transformed;
      }
    }

    return result;
  }

  /**
   * Default implementation of syncCustomers
   * Subclasses can override for more specific behavior
   */
  async syncCustomers(
    organizationId: number,
    credentials: IntegrationCredentials,
    options?: SyncOptions
  ): Promise<SyncResult> {
    const result: SyncResult = {
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      errors: [],
      syncedAt: new Date(),
    };

    this.adapterLogger.info(
      { integration: this.config.id, organizationId, options },
      'Starting customer sync'
    );

    try {
      // Fetch customers from external system
      const customers = await this.fetchCustomers(credentials, {
        since: options?.fullSync ? undefined : options?.since,
        limit: options?.limit,
      });

      this.adapterLogger.info(
        { integration: this.config.id, customerCount: customers.length },
        'Fetched customers from external system'
      );

      // Import the database dynamically to avoid circular dependencies
      const { getDatabase } = await import('../services/database');
      const db = await getDatabase();

      for (const external of customers) {
        try {
          const kundeData = this.mapToKunde(external);

          // Check if customer already exists (by external ID)
          const existing = await db.getKundeByExternalId(
            organizationId,
            this.config.slug,
            external.externalId
          );

          if (existing) {
            // Check if data has changed
            const hasChanges = this.hasDataChanged(existing as unknown as Record<string, unknown>, kundeData);

            if (hasChanges) {
              await db.updateKunde(existing.id, {
                ...kundeData,
                last_sync_at: new Date().toISOString(),
              }, organizationId);
              result.updated++;
            } else {
              result.unchanged++;
            }
          } else {
            // Create new customer
            await db.createKunde({
              ...kundeData,
              organization_id: organizationId,
              external_source: this.config.slug,
              external_id: external.externalId,
              last_sync_at: new Date().toISOString(),
            });
            result.created++;
          }
        } catch (error) {
          result.failed++;
          result.errors.push({
            externalId: external.externalId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });

          this.adapterLogger.error(
            { error, externalId: external.externalId },
            'Failed to sync customer'
          );
        }
      }

      this.adapterLogger.info(
        { integration: this.config.id, result },
        'Customer sync completed'
      );
    } catch (error) {
      this.adapterLogger.error(
        { error, integration: this.config.id },
        'Customer sync failed'
      );
      throw error;
    }

    return result;
  }

  /**
   * Check if customer data has changed
   * Compares relevant fields to detect updates
   */
  protected hasDataChanged(
    existing: Record<string, unknown>,
    newData: Record<string, unknown>
  ): boolean {
    const fieldsToCompare = [
      'navn', 'adresse', 'postnummer', 'poststed',
      'telefon', 'epost', 'kontaktperson',
    ];

    for (const field of fieldsToCompare) {
      const existingValue = existing[field];
      const newValue = newData[field];

      // Normalize for comparison
      const existingNorm = existingValue ? String(existingValue).trim() : '';
      const newNorm = newValue ? String(newValue).trim() : '';

      if (existingNorm !== newNorm) {
        return true;
      }
    }

    return false;
  }

  // === Abstract methods that subclasses must implement ===

  abstract authenticate(
    credentials: Partial<IntegrationCredentials>
  ): Promise<IntegrationCredentials>;

  abstract refreshAuth(
    credentials: IntegrationCredentials
  ): Promise<IntegrationCredentials>;

  abstract validateCredentials(
    credentials: IntegrationCredentials
  ): Promise<boolean>;

  abstract fetchCustomers(
    credentials: IntegrationCredentials,
    options?: { since?: Date; limit?: number; offset?: number }
  ): Promise<ExternalCustomer[]>;

  abstract getFieldMappings(): FieldMapping[];
}

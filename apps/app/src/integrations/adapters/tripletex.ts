/**
 * Tripletex API adapter
 * Integrates with the Norwegian accounting system Tripletex
 *
 * Tripletex API documentation: https://developer.tripletex.no/
 *
 * Authentication: Session token based
 * - Uses Consumer Token (API key) + Employee Token to create session
 * - Session tokens expire after 24 hours
 */

import { BaseDataSourceAdapter } from '../base-adapter';
import type {
  IntegrationConfig,
  IntegrationCredentials,
  ExternalCustomer,
  FieldMapping,
  SyncOptions,
  SyncResult,
} from '../types';
import { AuthenticationError } from '../types';
import { getConfig } from '../../config/env';

/** Returns the Tripletex API base URL based on TRIPLETEX_ENV */
export function getTripletexBaseUrl(): string {
  const env = getConfig().TRIPLETEX_ENV;
  return env === 'test'
    ? 'https://api-test.tripletex.tech/v2'
    : 'https://tripletex.no/v2';
}

// Tripletex API response types
interface TripletexAddress {
  addressLine1?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  country?: string;
}

interface TripletexCustomer {
  id: number;
  name: string;
  organizationNumber?: string;
  email?: string;
  phoneNumber?: string;
  phoneNumberMobile?: string;
  physicalAddress?: TripletexAddress;
  postalAddress?: TripletexAddress;
  isCustomer?: boolean;
  isSupplier?: boolean;
}

interface TripletexListResponse<T> {
  fullResultSize: number;
  from: number;
  count: number;
  versionDigest?: string;
  values: T[];
}

interface TripletexProject {
  id: number;
  number: string;
  name: string;
  customer: { id: number } | null;
  isFinished: boolean;
}

interface TripletexSessionResponse {
  value: {
    id: number;
    token: string;
    employeeId: number;
    companyId: number;
    expirationDate: string;
  };
}

export class TripletexAdapter extends BaseDataSourceAdapter {
  readonly config: IntegrationConfig = {
    id: 'tripletex',
    name: 'Tripletex',
    slug: 'tripletex',
    description: 'Norsk regnskapssystem for SMB',
    icon: 'fa-calculator',
    authType: 'basic_auth',
    baseUrl: getTripletexBaseUrl(),
    rateLimit: {
      requests: 100,
      windowMs: 60000, // 100 requests per minute
    },
    defaultFieldMappings: [
      { sourceField: 'name', targetField: 'navn', required: true },
      { sourceField: 'physicalAddress.addressLine1', targetField: 'adresse', required: true },
      { sourceField: 'physicalAddress.postalCode', targetField: 'postnummer', required: false },
      { sourceField: 'physicalAddress.city', targetField: 'poststed', required: false },
      { sourceField: 'phoneNumber', targetField: 'telefon', required: false },
      { sourceField: 'email', targetField: 'epost', required: false },
      { sourceField: 'organizationNumber', targetField: 'org_nummer', required: false },
    ],
  };

  /**
   * Authenticate with Tripletex using Consumer Token and Employee Token
   * Creates a session token that's valid for 24 hours
   */
  async authenticate(
    credentials: Partial<IntegrationCredentials>
  ): Promise<IntegrationCredentials> {
    const consumerToken = credentials.apiKey;
    const employeeToken = credentials.metadata?.employeeToken as string | undefined;

    if (!consumerToken) {
      throw new AuthenticationError(
        this.config.id,
        'Consumer Token (API-nøkkel) er påkrevd'
      );
    }

    if (!employeeToken) {
      throw new AuthenticationError(
        this.config.id,
        'Employee Token er påkrevd'
      );
    }

    try {
      // Calculate expiration date (24 hours from now)
      const expirationDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const expirationDateStr = expirationDate.toISOString().split('T')[0];

      // Create session token
      const url = `${this.config.baseUrl}/token/session/:create?consumerToken=${encodeURIComponent(consumerToken)}&employeeToken=${encodeURIComponent(employeeToken)}&expirationDate=${expirationDateStr}`;

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new AuthenticationError(
          this.config.id,
          `Kunne ikke autentisere med Tripletex: ${response.status} ${errorText}`
        );
      }

      const data = await response.json() as TripletexSessionResponse;

      this.adapterLogger.info(
        {
          integration: this.config.id,
          companyId: data.value.companyId,
          expiresAt: data.value.expirationDate,
        },
        'Tripletex authentication successful'
      );

      return {
        type: 'basic_auth',
        username: '0', // Tripletex uses 0 as username with session token
        password: data.value.token,
        expiresAt: new Date(data.value.expirationDate),
        metadata: {
          consumerToken,
          employeeToken,
          companyId: data.value.companyId,
          employeeId: data.value.employeeId,
          sessionId: data.value.id,
        },
      };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(
        this.config.id,
        `Autentisering feilet: ${error instanceof Error ? error.message : 'Ukjent feil'}`
      );
    }
  }

  /**
   * Refresh expired credentials by creating a new session
   */
  async refreshAuth(
    credentials: IntegrationCredentials
  ): Promise<IntegrationCredentials> {
    // Tripletex doesn't have refresh tokens - create a new session
    return this.authenticate({
      apiKey: credentials.metadata?.consumerToken as string,
      metadata: {
        employeeToken: credentials.metadata?.employeeToken,
      },
    });
  }

  /**
   * Validate that credentials are still valid
   */
  async validateCredentials(
    credentials: IntegrationCredentials
  ): Promise<boolean> {
    try {
      // Check if token is expired
      if (credentials.expiresAt && new Date(credentials.expiresAt) < new Date()) {
        return false;
      }

      // Make a simple API call to verify the token works
      const response = await this.rateLimitedFetch<{ value: unknown }>(
        `${this.config.baseUrl}/company/me`,
        { method: 'GET' },
        credentials
      );

      return !!response.value;
    } catch {
      return false;
    }
  }

  /**
   * Fetch customers from Tripletex
   * Handles pagination automatically
   */
  async fetchCustomers(
    credentials: IntegrationCredentials,
    options?: { since?: Date; limit?: number; offset?: number }
  ): Promise<ExternalCustomer[]> {
    const customers: ExternalCustomer[] = [];
    let from = options?.offset || 0;
    const batchSize = 1000; // Tripletex max per request
    const maxLimit = options?.limit || Infinity;

    while (customers.length < maxLimit) {
      const count = Math.min(batchSize, maxLimit - customers.length);

      const params = new URLSearchParams({
        from: String(from),
        count: String(count),
        isCustomer: 'true', // Only fetch customers, not suppliers
        fields: 'id,name,organizationNumber,email,phoneNumber,phoneNumberMobile,physicalAddress(*),postalAddress(*)',
      });

      // Add filter for changes since date if provided
      if (options?.since) {
        // Tripletex uses changedSince parameter
        params.set('changedSince', options.since.toISOString());
      }

      const response = await this.rateLimitedFetch<TripletexListResponse<TripletexCustomer>>(
        `${this.config.baseUrl}/customer?${params}`,
        { method: 'GET' },
        credentials
      );

      for (const customer of response.values) {
        customers.push({
          externalId: String(customer.id),
          data: customer as unknown as Record<string, unknown>,
          rawResponse: customer,
        });
      }

      this.adapterLogger.debug(
        {
          fetched: response.values.length,
          total: customers.length,
          fullResultSize: response.fullResultSize,
        },
        'Fetched batch of customers from Tripletex'
      );

      // Check if we've fetched all available customers
      if (response.values.length < count || customers.length >= response.fullResultSize) {
        break;
      }

      from += count;
    }

    return customers;
  }

  /**
   * Get the default field mappings for Tripletex
   */
  getFieldMappings(): FieldMapping[] {
    return this.config.defaultFieldMappings;
  }

  /**
   * Override mapToKunde to handle Tripletex-specific field transformations
   */
  override mapToKunde(
    external: ExternalCustomer,
    customMappings?: FieldMapping[]
  ): Record<string, unknown> {
    const customer = external.data as unknown as TripletexCustomer;
    const mappings = customMappings || this.getFieldMappings();
    const result: Record<string, unknown> = {};

    for (const mapping of mappings) {
      let value: unknown;

      // Handle nested fields (e.g., physicalAddress.addressLine1)
      if (mapping.sourceField.includes('.')) {
        value = this.getNestedValue(customer as unknown as Record<string, unknown>, mapping.sourceField);
      } else {
        value = customer[mapping.sourceField as keyof TripletexCustomer];
      }

      if (value !== undefined && value !== null && value !== '') {
        const transformed = mapping.transform ? mapping.transform(value) : value;
        result[mapping.targetField] = transformed;
      }
    }

    // Handle phone number - prefer mobile if main phone is missing
    if (!result.telefon && customer.phoneNumberMobile) {
      result.telefon = customer.phoneNumberMobile;
    }

    // Use postal address if physical address is missing
    if (!result.adresse && customer.postalAddress?.addressLine1) {
      result.adresse = customer.postalAddress.addressLine1;
    }
    if (!result.postnummer && customer.postalAddress?.postalCode) {
      result.postnummer = customer.postalAddress.postalCode;
    }
    if (!result.poststed && customer.postalAddress?.city) {
      result.poststed = customer.postalAddress.city;
    }

    return result;
  }

  /**
   * Fetch all projects from Tripletex.
   * Returns a Map from customer ID to array of project numbers.
   */
  async fetchProjects(
    credentials: IntegrationCredentials
  ): Promise<Map<number, string[]>> {
    const projectsByCustomer = new Map<number, string[]>();
    let from = 0;
    const batchSize = 1000;

    while (true) {
      const params = new URLSearchParams({
        from: String(from),
        count: String(batchSize),
        fields: 'id,number,name,customer(id),isFinished',
      });

      const response = await this.rateLimitedFetch<TripletexListResponse<TripletexProject>>(
        `${this.config.baseUrl}/project?${params}`,
        { method: 'GET' },
        credentials
      );

      for (const project of response.values) {
        if (project.customer?.id && project.number) {
          const existing = projectsByCustomer.get(project.customer.id) || [];
          existing.push(project.number);
          projectsByCustomer.set(project.customer.id, existing);
        }
      }

      this.adapterLogger.debug(
        { fetched: response.values.length, total: projectsByCustomer.size },
        'Fetched batch of projects from Tripletex'
      );

      if (response.values.length < batchSize || (from + batchSize) >= response.fullResultSize) {
        break;
      }
      from += batchSize;
    }

    return projectsByCustomer;
  }

  /**
   * Fetch customers with their project numbers for preview (no import).
   */
  async fetchCustomersWithProjects(
    credentials: IntegrationCredentials
  ): Promise<Array<ExternalCustomer & { projectNumbers: string[] }>> {
    const [customers, projectsByCustomer] = await Promise.all([
      this.fetchCustomers(credentials),
      this.fetchProjects(credentials),
    ]);

    return customers.map(customer => ({
      ...customer,
      projectNumbers: projectsByCustomer.get(Number(customer.externalId)) || [],
    }));
  }

  /**
   * Override syncCustomers to include project numbers and support selection
   */
  override async syncCustomers(
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
      'Starting Tripletex customer sync with project numbers'
    );

    try {
      const [allCustomers, projectsByCustomer] = await Promise.all([
        this.fetchCustomers(credentials, {
          since: options?.fullSync ? undefined : options?.since,
          limit: options?.limit,
        }),
        this.fetchProjects(credentials),
      ]);

      // Filter to selected IDs if provided
      const customers = options?.selectedExternalIds
        ? allCustomers.filter(c => options.selectedExternalIds!.includes(c.externalId))
        : allCustomers;

      this.adapterLogger.info(
        { total: allCustomers.length, selected: customers.length, projects: projectsByCustomer.size },
        'Fetched customers and projects from Tripletex'
      );

      const { getDatabase } = await import('../../services/database');
      const db = await getDatabase();

      for (const external of customers) {
        try {
          const kundeData = this.mapToKunde(external);

          // Inject project numbers
          const projectNums = projectsByCustomer.get(Number(external.externalId)) || [];
          if (projectNums.length > 0) {
            kundeData.prosjektnummer = projectNums.join(', ');
          }

          const existing = await db.getKundeByExternalId(
            organizationId,
            this.config.slug,
            external.externalId
          );

          if (existing) {
            const hasChanges = this.hasDataChanged(
              existing as unknown as Record<string, unknown>,
              kundeData
            );
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
            await db.createKunde({
              ...kundeData,
              organization_id: organizationId,
              external_source: this.config.slug,
              external_id: external.externalId,
              last_sync_at: new Date().toISOString(),
            });
            result.created++;
          }

          try {
            await db.resolveFailedSyncItem(organizationId, this.config.id, external.externalId);
          } catch { /* non-critical */ }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          result.failed++;
          result.errors.push({ externalId: external.externalId, error: errorMessage });

          try {
            await db.recordFailedSyncItem(organizationId, {
              integration_id: this.config.id,
              external_id: external.externalId,
              external_source: this.config.slug,
              error_message: errorMessage,
            });
          } catch (recordError) {
            this.adapterLogger.error(
              { error: recordError, externalId: external.externalId },
              'Failed to record sync failure for retry'
            );
          }

          this.adapterLogger.error(
            { error, externalId: external.externalId },
            'Failed to sync customer'
          );
        }
      }

      this.adapterLogger.info(
        { integration: this.config.id, result },
        'Tripletex customer sync completed'
      );
    } catch (error) {
      this.adapterLogger.error(
        { error, integration: this.config.id },
        'Tripletex customer sync failed'
      );
      throw error;
    }

    return result;
  }

  /**
   * Subscribe to Tripletex webhook events for customer changes
   * @param credentials Valid session credentials
   * @param callbackUrl The URL Tripletex should send events to
   * @param events Event types to subscribe to
   */
  async subscribeToWebhooks(
    credentials: IntegrationCredentials,
    callbackUrl: string,
    events: string[] = ['customer.create', 'customer.update', 'customer.delete']
  ): Promise<number[]> {
    const subscriptionIds: number[] = [];

    for (const event of events) {
      const response = await this.rateLimitedFetch<{ value: { id: number } }>(
        `${this.config.baseUrl}/event/subscription`,
        {
          method: 'POST',
          body: JSON.stringify({
            event,
            targetUrl: callbackUrl,
            fields: '*',
          }),
        },
        credentials
      );

      subscriptionIds.push(response.value.id);

      this.adapterLogger.info(
        { event, subscriptionId: response.value.id, callbackUrl },
        'Subscribed to Tripletex webhook'
      );
    }

    return subscriptionIds;
  }

  /**
   * Unsubscribe from a Tripletex webhook
   * @param credentials Valid session credentials
   * @param subscriptionId The subscription ID to remove
   */
  async unsubscribeFromWebhooks(
    credentials: IntegrationCredentials,
    subscriptionId: number
  ): Promise<void> {
    await this.rateLimitedFetch<void>(
      `${this.config.baseUrl}/event/subscription/${subscriptionId}`,
      { method: 'DELETE' },
      credentials
    );

    this.adapterLogger.info({ subscriptionId }, 'Unsubscribed from Tripletex webhook');
  }
}

// Export a factory function for creating the adapter
export function createTripletexAdapter(): TripletexAdapter {
  return new TripletexAdapter();
}

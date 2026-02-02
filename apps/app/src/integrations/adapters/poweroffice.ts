/**
 * PowerOffice Go API adapter
 * Integrates with the Norwegian cloud accounting system PowerOffice Go
 *
 * PowerOffice Go API documentation: https://api.poweroffice.net/docs/
 *
 * Authentication: OAuth 2.0
 * - Authorization Code Flow for user authorization
 * - Access tokens expire after 1 hour
 * - Refresh tokens are long-lived
 */

import { BaseDataSourceAdapter } from '../base-adapter';
import type {
  IntegrationConfig,
  IntegrationCredentials,
  ExternalCustomer,
  FieldMapping,
} from '../types';
import { AuthenticationError, IntegrationError } from '../types';

// PowerOffice API response types
interface PowerOfficeAddress {
  address1?: string;
  address2?: string;
  address3?: string;
  zipCode?: string;
  city?: string;
  countryCode?: string;
}

interface PowerOfficeContactPerson {
  id?: number;
  firstName?: string;
  lastName?: string;
  emailAddress?: string;
  phoneNumber?: string;
  isPrimary?: boolean;
}

interface PowerOfficeCustomer {
  id: number;
  code?: string;
  name: string;
  legalName?: string;
  organizationNumber?: string;
  vatNumber?: string;
  emailAddress?: string;
  phoneNumber?: string;
  invoiceAddress?: PowerOfficeAddress;
  mailingAddress?: PowerOfficeAddress;
  contactPersons?: PowerOfficeContactPerson[];
  isActive?: boolean;
  createdDate?: string;
  lastChangedDate?: string;
}

interface PowerOfficeListResponse<T> {
  data: T[];
  count: number;
  totalCount: number;
  pageNumber: number;
  pageSize: number;
}

interface PowerOfficeTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

// PowerOffice OAuth configuration
const POWEROFFICE_OAUTH_CONFIG = {
  authUrl: 'https://go.poweroffice.net/OAuth/Authorize',
  tokenUrl: 'https://go.poweroffice.net/OAuth/Token',
  scopes: ['customers:read'],
};

export class PowerOfficeAdapter extends BaseDataSourceAdapter {
  readonly config: IntegrationConfig = {
    id: 'poweroffice',
    name: 'PowerOffice Go',
    slug: 'poweroffice',
    description: 'Norsk skybasert regnskapssystem',
    icon: 'fa-cloud',
    authType: 'oauth2',
    oauthConfig: {
      authUrl: POWEROFFICE_OAUTH_CONFIG.authUrl,
      tokenUrl: POWEROFFICE_OAUTH_CONFIG.tokenUrl,
      scopes: POWEROFFICE_OAUTH_CONFIG.scopes,
      clientId: process.env.POWEROFFICE_CLIENT_ID || '',
      clientSecret: process.env.POWEROFFICE_CLIENT_SECRET || '',
    },
    baseUrl: 'https://api.poweroffice.net',
    rateLimit: {
      requests: 100,
      windowMs: 60000, // 100 requests per minute
    },
    defaultFieldMappings: [
      { sourceField: 'name', targetField: 'navn', required: true },
      { sourceField: 'invoiceAddress.address1', targetField: 'adresse', required: false },
      { sourceField: 'invoiceAddress.zipCode', targetField: 'postnummer', required: false },
      { sourceField: 'invoiceAddress.city', targetField: 'poststed', required: false },
      { sourceField: 'phoneNumber', targetField: 'telefon', required: false },
      { sourceField: 'emailAddress', targetField: 'epost', required: false },
      { sourceField: 'organizationNumber', targetField: 'org_nummer', required: false },
    ],
  };

  /**
   * Get the OAuth authorization URL for user consent
   */
  getAuthorizationUrl(redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.oauthConfig!.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: this.config.oauthConfig!.scopes.join(' '),
      state,
    });

    return `${this.config.oauthConfig!.authUrl}?${params}`;
  }

  /**
   * Authenticate with PowerOffice using OAuth authorization code
   */
  async authenticate(
    credentials: Partial<IntegrationCredentials>
  ): Promise<IntegrationCredentials> {
    const authorizationCode = credentials.metadata?.authorizationCode as string | undefined;
    const redirectUri = credentials.metadata?.redirectUri as string | undefined;

    if (!authorizationCode) {
      throw new AuthenticationError(
        this.config.id,
        'Authorization code er påkrevd'
      );
    }

    if (!redirectUri) {
      throw new AuthenticationError(
        this.config.id,
        'Redirect URI er påkrevd'
      );
    }

    try {
      const response = await fetch(this.config.oauthConfig!.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: authorizationCode,
          redirect_uri: redirectUri,
          client_id: this.config.oauthConfig!.clientId,
          client_secret: this.config.oauthConfig!.clientSecret,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new AuthenticationError(
          this.config.id,
          `Kunne ikke autentisere med PowerOffice: ${response.status} ${errorText}`
        );
      }

      const data = await response.json() as PowerOfficeTokenResponse;

      this.adapterLogger.info(
        { integration: this.config.id },
        'PowerOffice authentication successful'
      );

      return {
        type: 'oauth2',
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        metadata: {
          scope: data.scope,
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
   * Refresh expired credentials using the refresh token
   */
  async refreshAuth(
    credentials: IntegrationCredentials
  ): Promise<IntegrationCredentials> {
    if (!credentials.refreshToken) {
      throw new AuthenticationError(
        this.config.id,
        'Refresh token mangler - ny autentisering påkrevd'
      );
    }

    try {
      const response = await fetch(this.config.oauthConfig!.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken,
          client_id: this.config.oauthConfig!.clientId,
          client_secret: this.config.oauthConfig!.clientSecret,
        }),
      });

      if (!response.ok) {
        throw new AuthenticationError(
          this.config.id,
          'Kunne ikke fornye tilgang - ny autentisering påkrevd'
        );
      }

      const data = await response.json() as PowerOfficeTokenResponse;

      return {
        type: 'oauth2',
        accessToken: data.access_token,
        refreshToken: data.refresh_token || credentials.refreshToken,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        metadata: credentials.metadata,
      };
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(
        this.config.id,
        `Fornyelse av tilgang feilet: ${error instanceof Error ? error.message : 'Ukjent feil'}`
      );
    }
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
      const response = await this.rateLimitedFetch<{ data: unknown }>(
        `${this.config.baseUrl}/v1/customers?pageSize=1`,
        { method: 'GET' },
        credentials
      );

      return !!response.data;
    } catch {
      return false;
    }
  }

  /**
   * Fetch customers from PowerOffice
   * Handles pagination automatically
   */
  async fetchCustomers(
    credentials: IntegrationCredentials,
    options?: { since?: Date; limit?: number; offset?: number }
  ): Promise<ExternalCustomer[]> {
    const customers: ExternalCustomer[] = [];
    let pageNumber = 1;
    const pageSize = 100; // PowerOffice max per page
    const maxLimit = options?.limit || Infinity;

    // Auto-refresh token if expired
    let activeCredentials = credentials;
    if (credentials.expiresAt && new Date(credentials.expiresAt) < new Date()) {
      activeCredentials = await this.refreshAuth(credentials);
    }

    while (customers.length < maxLimit) {
      const params = new URLSearchParams({
        pageNumber: String(pageNumber),
        pageSize: String(Math.min(pageSize, maxLimit - customers.length)),
        isActive: 'true',
      });

      // Add filter for changes since date if provided
      if (options?.since) {
        params.set('lastChangedDateTimeOffsetGreaterThan', options.since.toISOString());
      }

      try {
        const response = await this.rateLimitedFetch<PowerOfficeListResponse<PowerOfficeCustomer>>(
          `${this.config.baseUrl}/v1/customers?${params}`,
          { method: 'GET' },
          activeCredentials
        );

        for (const customer of response.data) {
          customers.push({
            externalId: String(customer.id),
            data: customer as unknown as Record<string, unknown>,
            rawResponse: customer,
          });
        }

        this.adapterLogger.debug(
          {
            fetched: response.data.length,
            total: customers.length,
            totalCount: response.totalCount,
            page: pageNumber,
          },
          'Fetched batch of customers from PowerOffice'
        );

        // Check if we've fetched all available customers
        if (response.data.length < pageSize || customers.length >= response.totalCount) {
          break;
        }

        pageNumber++;
      } catch (error) {
        if (error instanceof IntegrationError && error.statusCode === 401) {
          // Try refreshing the token once
          activeCredentials = await this.refreshAuth(activeCredentials);
          continue; // Retry the same page
        }
        throw error;
      }
    }

    return customers;
  }

  /**
   * Get the default field mappings for PowerOffice
   */
  getFieldMappings(): FieldMapping[] {
    return this.config.defaultFieldMappings;
  }

  /**
   * Override mapToKunde to handle PowerOffice-specific field transformations
   */
  override mapToKunde(
    external: ExternalCustomer,
    customMappings?: FieldMapping[]
  ): Record<string, unknown> {
    const customer = external.data as unknown as PowerOfficeCustomer;
    const mappings = customMappings || this.getFieldMappings();
    const result: Record<string, unknown> = {};

    for (const mapping of mappings) {
      let value: unknown;

      // Handle nested fields (e.g., invoiceAddress.address1)
      if (mapping.sourceField.includes('.')) {
        value = this.getNestedValue(customer as unknown as Record<string, unknown>, mapping.sourceField);
      } else {
        value = customer[mapping.sourceField as keyof PowerOfficeCustomer];
      }

      if (value !== undefined && value !== null && value !== '') {
        const transformed = mapping.transform ? mapping.transform(value) : value;
        result[mapping.targetField] = transformed;
      }
    }

    // Use mailing address if invoice address is missing
    if (!result.adresse && customer.mailingAddress?.address1) {
      result.adresse = customer.mailingAddress.address1;
    }
    if (!result.postnummer && customer.mailingAddress?.zipCode) {
      result.postnummer = customer.mailingAddress.zipCode;
    }
    if (!result.poststed && customer.mailingAddress?.city) {
      result.poststed = customer.mailingAddress.city;
    }

    // Get primary contact person info
    const primaryContact = customer.contactPersons?.find(c => c.isPrimary) || customer.contactPersons?.[0];
    if (primaryContact) {
      if (!result.epost && primaryContact.emailAddress) {
        result.epost = primaryContact.emailAddress;
      }
      if (!result.telefon && primaryContact.phoneNumber) {
        result.telefon = primaryContact.phoneNumber;
      }
      // Set contact person name
      const contactName = [primaryContact.firstName, primaryContact.lastName]
        .filter(Boolean)
        .join(' ');
      if (contactName) {
        result.kontaktperson = contactName;
      }
    }

    return result;
  }
}

// Export a factory function for creating the adapter
export function createPowerOfficeAdapter(): PowerOfficeAdapter {
  return new PowerOfficeAdapter();
}

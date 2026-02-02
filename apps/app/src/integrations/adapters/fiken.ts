/**
 * Fiken API adapter
 * Integrates with the Norwegian cloud accounting system Fiken
 *
 * Fiken API documentation: https://api.fiken.no/api/v2/docs/
 *
 * Authentication: Bearer Token (API key)
 * - API keys are generated in Fiken settings
 * - Tokens do not expire but can be revoked
 */

import { BaseDataSourceAdapter } from '../base-adapter';
import type {
  IntegrationConfig,
  IntegrationCredentials,
  ExternalCustomer,
  FieldMapping,
} from '../types';
import { AuthenticationError, IntegrationError } from '../types';

// Fiken API response types
interface FikenAddress {
  streetAddress?: string;
  streetAddressLine2?: string;
  city?: string;
  postCode?: string;
  country?: string;
}

interface FikenContactPerson {
  name?: string;
  email?: string;
  phoneNumber?: string;
}

interface FikenContact {
  contactId: number;
  name: string;
  organizationNumber?: string;
  email?: string;
  phoneNumber?: string;
  memberNumber?: number;
  customer?: boolean;
  supplier?: boolean;
  inactive?: boolean;
  address?: FikenAddress;
  contactPersons?: FikenContactPerson[];
  createdDate?: string;
  lastModifiedDate?: string;
}

interface FikenCompany {
  name: string;
  slug: string;
  organizationNumber?: string;
  createdDate?: string;
}

interface FikenListResponse<T> {
  items: T[];
  count: number;
  total: number;
  page: number;
  pageSize: number;
}

export class FikenAdapter extends BaseDataSourceAdapter {
  readonly config: IntegrationConfig = {
    id: 'fiken',
    name: 'Fiken',
    slug: 'fiken',
    description: 'Gratis regnskapsprogram for SMB',
    icon: 'fa-receipt',
    authType: 'api_key',
    baseUrl: 'https://api.fiken.no/api/v2',
    rateLimit: {
      requests: 120,
      windowMs: 60000, // 120 requests per minute
    },
    defaultFieldMappings: [
      { sourceField: 'name', targetField: 'navn', required: true },
      { sourceField: 'address.streetAddress', targetField: 'adresse', required: false },
      { sourceField: 'address.postCode', targetField: 'postnummer', required: false },
      { sourceField: 'address.city', targetField: 'poststed', required: false },
      { sourceField: 'phoneNumber', targetField: 'telefon', required: false },
      { sourceField: 'email', targetField: 'epost', required: false },
      { sourceField: 'organizationNumber', targetField: 'org_nummer', required: false },
    ],
  };

  /**
   * Override getAuthHeader for Fiken's Bearer token format
   */
  protected override getAuthHeader(credentials: IntegrationCredentials): string {
    if (credentials.type === 'api_key' && credentials.apiKey) {
      return `Bearer ${credentials.apiKey}`;
    }
    return super.getAuthHeader(credentials);
  }

  /**
   * Authenticate with Fiken using API key
   * Also fetches available companies and stores the first one
   */
  async authenticate(
    credentials: Partial<IntegrationCredentials>
  ): Promise<IntegrationCredentials> {
    const apiKey = credentials.apiKey;

    if (!apiKey) {
      throw new AuthenticationError(
        this.config.id,
        'API-nøkkel er påkrevd'
      );
    }

    try {
      // Verify the API key by fetching companies
      const response = await fetch(`${this.config.baseUrl}/companies`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new AuthenticationError(
            this.config.id,
            'Ugyldig API-nøkkel'
          );
        }
        const errorText = await response.text().catch(() => '');
        throw new AuthenticationError(
          this.config.id,
          `Kunne ikke autentisere med Fiken: ${response.status} ${errorText}`
        );
      }

      const companies = await response.json() as FikenCompany[];

      if (!companies || companies.length === 0) {
        throw new AuthenticationError(
          this.config.id,
          'Ingen selskaper funnet for denne API-nøkkelen'
        );
      }

      // Use the specified company or the first one
      const companySlug = credentials.metadata?.companySlug as string || companies[0].slug;
      const selectedCompany = companies.find(c => c.slug === companySlug) || companies[0];

      this.adapterLogger.info(
        {
          integration: this.config.id,
          company: selectedCompany.name,
          companySlug: selectedCompany.slug,
          availableCompanies: companies.length,
        },
        'Fiken authentication successful'
      );

      return {
        type: 'api_key',
        apiKey,
        metadata: {
          companySlug: selectedCompany.slug,
          companyName: selectedCompany.name,
          organizationNumber: selectedCompany.organizationNumber,
          availableCompanies: companies.map(c => ({ slug: c.slug, name: c.name })),
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
   * Refresh auth - API keys don't expire, so just validate
   */
  async refreshAuth(
    credentials: IntegrationCredentials
  ): Promise<IntegrationCredentials> {
    // API keys don't expire - just validate they're still working
    const isValid = await this.validateCredentials(credentials);
    if (!isValid) {
      throw new AuthenticationError(
        this.config.id,
        'API-nøkkel er ikke lenger gyldig'
      );
    }
    return credentials;
  }

  /**
   * Validate that credentials are still valid
   */
  async validateCredentials(
    credentials: IntegrationCredentials
  ): Promise<boolean> {
    try {
      const companySlug = credentials.metadata?.companySlug as string;
      if (!companySlug) {
        return false;
      }

      // Make a simple API call to verify the token works
      const response = await this.rateLimitedFetch<FikenListResponse<FikenContact>>(
        `${this.config.baseUrl}/companies/${companySlug}/contacts?pageSize=1`,
        { method: 'GET' },
        credentials
      );

      return response.items !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Fetch customers from Fiken
   * Handles pagination automatically
   */
  async fetchCustomers(
    credentials: IntegrationCredentials,
    options?: { since?: Date; limit?: number; offset?: number }
  ): Promise<ExternalCustomer[]> {
    const companySlug = credentials.metadata?.companySlug as string;
    if (!companySlug) {
      throw new IntegrationError(
        'Company slug mangler - autentiser på nytt',
        this.config.id
      );
    }

    const customers: ExternalCustomer[] = [];
    let page = 0;
    const pageSize = 100; // Fiken's recommended page size
    const maxLimit = options?.limit || Infinity;

    while (customers.length < maxLimit) {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(Math.min(pageSize, maxLimit - customers.length)),
        customer: 'true', // Only fetch customers (not suppliers)
      });

      // Add filter for changes since date if provided
      if (options?.since) {
        params.set('lastModifiedFrom', options.since.toISOString().split('T')[0]);
      }

      const response = await this.rateLimitedFetch<FikenListResponse<FikenContact>>(
        `${this.config.baseUrl}/companies/${companySlug}/contacts?${params}`,
        { method: 'GET' },
        credentials
      );

      // Filter out inactive contacts
      const activeContacts = response.items.filter(c => !c.inactive);

      for (const contact of activeContacts) {
        customers.push({
          externalId: String(contact.contactId),
          data: contact as unknown as Record<string, unknown>,
          rawResponse: contact,
        });
      }

      this.adapterLogger.debug(
        {
          fetched: activeContacts.length,
          total: customers.length,
          totalCount: response.total,
          page,
        },
        'Fetched batch of customers from Fiken'
      );

      // Check if we've fetched all available customers
      if (response.items.length < pageSize || customers.length >= response.total) {
        break;
      }

      page++;
    }

    return customers;
  }

  /**
   * Get the default field mappings for Fiken
   */
  getFieldMappings(): FieldMapping[] {
    return this.config.defaultFieldMappings;
  }

  /**
   * Override mapToKunde to handle Fiken-specific field transformations
   */
  override mapToKunde(
    external: ExternalCustomer,
    customMappings?: FieldMapping[]
  ): Record<string, unknown> {
    const contact = external.data as unknown as FikenContact;
    const mappings = customMappings || this.getFieldMappings();
    const result: Record<string, unknown> = {};

    for (const mapping of mappings) {
      let value: unknown;

      // Handle nested fields (e.g., address.streetAddress)
      if (mapping.sourceField.includes('.')) {
        value = this.getNestedValue(contact as unknown as Record<string, unknown>, mapping.sourceField);
      } else {
        value = contact[mapping.sourceField as keyof FikenContact];
      }

      if (value !== undefined && value !== null && value !== '') {
        const transformed = mapping.transform ? mapping.transform(value) : value;
        result[mapping.targetField] = transformed;
      }
    }

    // Handle address line 2 if present
    if (contact.address?.streetAddressLine2 && result.adresse) {
      result.adresse = `${result.adresse}, ${contact.address.streetAddressLine2}`;
    }

    // Get primary contact person info
    const primaryContact = contact.contactPersons?.[0];
    if (primaryContact) {
      if (!result.epost && primaryContact.email) {
        result.epost = primaryContact.email;
      }
      if (!result.telefon && primaryContact.phoneNumber) {
        result.telefon = primaryContact.phoneNumber;
      }
      if (primaryContact.name) {
        result.kontaktperson = primaryContact.name;
      }
    }

    // Use member number as customer number if available
    if (contact.memberNumber) {
      result.kundenummer = String(contact.memberNumber);
    }

    return result;
  }
}

// Export a factory function for creating the adapter
export function createFikenAdapter(): FikenAdapter {
  return new FikenAdapter();
}

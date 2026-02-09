/**
 * Integration routes for external data source connections
 * Manages OAuth flows, credentials, and sync operations
 */

import { Router, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { apiLogger } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { requireFeature } from '../middleware/features';
import { getDatabase } from '../services/database';
import { getIntegrationRegistry } from '../integrations/registry';
import { encryptCredentials, decryptCredentials, isCredentialsExpired } from '../integrations/encryption';
import { createTripletexAdapter, TripletexAdapter } from '../integrations/adapters/tripletex';
import { createPowerOfficeAdapter, PowerOfficeAdapter } from '../integrations/adapters/poweroffice';
import { createFikenAdapter } from '../integrations/adapters/fiken';
import type { AuthenticatedRequest } from '../types';

const router: Router = Router();

// Register available adapters
const registry = getIntegrationRegistry();
registry.register(createTripletexAdapter());
registry.register(createPowerOfficeAdapter());
registry.register(createFikenAdapter());

/**
 * GET /api/integrations
 * List all available integrations and their connection status
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const db = await getDatabase();
    const integrations = registry.getAll();

    // Get stored credentials status for this organization
    const storedIntegrations = await db.getOrganizationIntegrations(req.organizationId!);

    const result = integrations.map(adapter => {
      const stored = storedIntegrations.find(s => s.integration_id === adapter.config.id);

      return {
        id: adapter.config.id,
        name: adapter.config.name,
        description: adapter.config.description,
        icon: adapter.config.icon,
        authType: adapter.config.authType,
        isConnected: stored?.is_active ?? false,
        lastSyncAt: stored?.last_sync_at ?? null,
        syncFrequencyHours: stored?.sync_frequency_hours ?? 24,
      };
    });

    res.json({
      success: true,
      data: result,
      requestId: req.requestId,
    });
  })
);

/**
 * GET /api/integrations/:id
 * Get details for a specific integration
 */
router.get(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const adapter = registry.get(id);

    if (!adapter) {
      throw Errors.notFound('Integrasjon');
    }

    const db = await getDatabase();
    const storedIntegrations = await db.getOrganizationIntegrations(req.organizationId!);
    const stored = storedIntegrations.find(s => s.integration_id === id);

    res.json({
      success: true,
      data: {
        id: adapter.config.id,
        name: adapter.config.name,
        description: adapter.config.description,
        icon: adapter.config.icon,
        authType: adapter.config.authType,
        isConnected: stored?.is_active ?? false,
        lastSyncAt: stored?.last_sync_at ?? null,
        fieldMappings: adapter.getFieldMappings(),
      },
      requestId: req.requestId,
    });
  })
);

/**
 * GET /api/integrations/:id/oauth/authorize
 * Get the OAuth authorization URL for integrations that use OAuth2
 */
router.get(
  '/:id/oauth/authorize',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { redirectUri } = req.query;

    const adapter = registry.get(id);
    if (!adapter) {
      throw Errors.notFound('Integrasjon');
    }

    if (adapter.config.authType !== 'oauth2') {
      throw Errors.badRequest('Denne integrasjonen bruker ikke OAuth2');
    }

    if (!redirectUri || typeof redirectUri !== 'string') {
      throw Errors.badRequest('redirectUri er påkrevd');
    }

    // Generate state for CSRF protection
    const state = Buffer.from(JSON.stringify({
      organizationId: req.organizationId,
      integrationId: id,
      timestamp: Date.now(),
    })).toString('base64url');

    // Get the authorization URL from the adapter
    let authUrl: string;
    if (adapter instanceof PowerOfficeAdapter) {
      authUrl = adapter.getAuthorizationUrl(redirectUri, state);
    } else {
      // Generic OAuth2 URL builder for other adapters
      const oauthConfig = adapter.config.oauthConfig!;
      const params = new URLSearchParams({
        client_id: oauthConfig.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: oauthConfig.scopes.join(' '),
        state,
      });
      authUrl = `${oauthConfig.authUrl}?${params}`;
    }

    res.json({
      success: true,
      data: {
        authorizationUrl: authUrl,
        state,
      },
      requestId: req.requestId,
    });
  })
);

/**
 * POST /api/integrations/:id/connect
 * Connect to an integration (authenticate and store credentials)
 */
router.post(
  '/:id/connect',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const adapter = registry.get(id);

    if (!adapter) {
      throw Errors.notFound('Integrasjon');
    }

    apiLogger.info(
      { integration: id, organizationId: req.organizationId },
      'Connecting to integration'
    );

    try {
      // Authenticate with the external service
      const credentials = await adapter.authenticate(req.body);

      // Encrypt and store credentials
      const encrypted = await encryptCredentials(credentials);
      const db = await getDatabase();

      await db.saveIntegrationCredentials(req.organizationId!, {
        integration_id: id,
        credentials_encrypted: encrypted,
        is_active: true,
      });

      apiLogger.info(
        { integration: id, organizationId: req.organizationId },
        'Successfully connected to integration'
      );

      res.json({
        success: true,
        message: `Koblet til ${adapter.config.name}`,
        requestId: req.requestId,
      });
    } catch (error) {
      apiLogger.error(
        { error, integration: id, organizationId: req.organizationId },
        'Failed to connect to integration'
      );

      throw Errors.badRequest(
        `Kunne ikke koble til ${adapter.config.name}: ${error instanceof Error ? error.message : 'Ukjent feil'}`
      );
    }
  })
);

/**
 * POST /api/integrations/:id/sync
 * Trigger a manual sync for an integration
 */
router.post(
  '/:id/sync',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { fullSync = false, selectedExternalIds, importOptions } = req.body;

    const adapter = registry.get(id);
    if (!adapter) {
      throw Errors.notFound('Integrasjon');
    }

    const db = await getDatabase();
    const stored = await db.getIntegrationCredentials(req.organizationId!, id);

    if (!stored || !stored.is_active) {
      throw Errors.badRequest('Integrasjon er ikke tilkoblet');
    }

    // Decrypt credentials
    let credentials = await decryptCredentials(stored.credentials_encrypted);

    // Refresh if expired
    if (isCredentialsExpired(credentials)) {
      apiLogger.info({ integration: id }, 'Refreshing expired credentials');

      try {
        credentials = await adapter.refreshAuth(credentials);

        // Store refreshed credentials
        const encrypted = await encryptCredentials(credentials);
        await db.saveIntegrationCredentials(req.organizationId!, {
          integration_id: id,
          credentials_encrypted: encrypted,
          is_active: true,
        });
      } catch (error) {
        apiLogger.error({ error, integration: id }, 'Failed to refresh credentials');
        throw Errors.unauthorized('Autentisering utløpt. Koble til på nytt.');
      }
    }

    // Log sync start
    const logId = await db.logIntegrationSync(req.organizationId!, {
      integration_id: id,
      sync_type: 'manual',
      status: 'started',
    });

    apiLogger.info(
      { integration: id, organizationId: req.organizationId, fullSync, logId },
      'Starting integration sync'
    );

    try {
      // Run the sync
      const result = await adapter.syncCustomers(req.organizationId!, credentials, {
        fullSync,
        selectedExternalIds,
        importOptions,
      });

      // Update sync time
      await db.updateIntegrationLastSync(req.organizationId!, id, new Date());

      // Log completion
      await db.logIntegrationSync(req.organizationId!, {
        integration_id: id,
        sync_type: 'manual',
        status: 'completed',
        created_count: result.created,
        updated_count: result.updated,
        unchanged_count: result.unchanged,
        failed_count: result.failed,
        completed_at: result.syncedAt,
      });

      apiLogger.info(
        { integration: id, result },
        'Integration sync completed'
      );

      res.json({
        success: true,
        data: {
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          failed: result.failed,
          errors: result.errors.slice(0, 10), // Limit errors in response
          syncedAt: result.syncedAt,
        },
        requestId: req.requestId,
      });
    } catch (error) {
      // Log failure
      await db.logIntegrationSync(req.organizationId!, {
        integration_id: id,
        sync_type: 'manual',
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        completed_at: new Date(),
      });

      apiLogger.error(
        { error, integration: id },
        'Integration sync failed'
      );

      throw Errors.internal(
        `Synkronisering feilet: ${error instanceof Error ? error.message : 'Ukjent feil'}`
      );
    }
  })
);

/**
 * POST /api/integrations/:id/preview
 * Fetch customers from integration for preview/selection (without importing)
 */
router.post(
  '/:id/preview',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const adapter = registry.get(id);
    if (!adapter) {
      throw Errors.notFound('Integrasjon');
    }

    const db = await getDatabase();
    const stored = await db.getIntegrationCredentials(req.organizationId!, id);

    if (!stored || !stored.is_active) {
      throw Errors.badRequest('Integrasjon er ikke tilkoblet');
    }

    // Decrypt & refresh credentials
    let credentials = await decryptCredentials(stored.credentials_encrypted);
    if (isCredentialsExpired(credentials)) {
      credentials = await adapter.refreshAuth(credentials);
      const encrypted = await encryptCredentials(credentials);
      await db.saveIntegrationCredentials(req.organizationId!, {
        integration_id: id,
        credentials_encrypted: encrypted,
        is_active: true,
      });
    }

    // Fetch customers (with projects for Tripletex)
    let previewCustomers: Array<{ externalId: string; projectNumbers: string[]; data: Record<string, unknown>; rawResponse?: unknown }>;

    try {
      if (adapter instanceof TripletexAdapter) {
        const customersWithProjects = await (adapter as TripletexAdapter).fetchCustomersWithProjects(credentials);
        previewCustomers = customersWithProjects;
      } else {
        const customers = await adapter.fetchCustomers(credentials);
        previewCustomers = customers.map(c => ({ ...c, projectNumbers: [] as string[] }));
      }
    } catch (fetchError) {
      apiLogger.error(
        { error: fetchError instanceof Error ? fetchError.message : fetchError, stack: fetchError instanceof Error ? fetchError.stack : undefined, integration: id },
        'Failed to fetch customers for preview'
      );
      throw fetchError;
    }

    // Check which are already imported
    const existingKunder = await db.getKunderByExternalSource(
      req.organizationId!,
      adapter.config.slug
    );
    const existingExternalIds = new Set(existingKunder.map(k => k.external_id));

    // Map to preview format with all available fields
    const previewData = previewCustomers.map(customer => {
      const mapped = adapter.mapToKunde(customer as any);
      const raw = customer.data as Record<string, any>;

      // Extract Tripletex categories
      const categories: string[] = [];
      if (raw.category1?.name) categories.push(raw.category1.name);
      if (raw.category2?.name) categories.push(raw.category2.name);
      if (raw.category3?.name) categories.push(raw.category3.name);

      return {
        externalId: customer.externalId,
        navn: mapped.navn || '',
        adresse: mapped.adresse || '',
        postnummer: mapped.postnummer || '',
        poststed: mapped.poststed || '',
        telefon: mapped.telefon || '',
        epost: mapped.epost || '',
        prosjektnummer: customer.projectNumbers.join(', '),
        // Extra fields
        kundenummer: raw.customerNumber ? String(raw.customerNumber) : '',
        beskrivelse: raw.description || '',
        orgNummer: raw.organizationNumber || '',
        fakturaEpost: raw.invoiceEmail || '',
        kategorier: categories,
        isInactive: raw.isInactive || false,
        alreadyImported: existingExternalIds.has(customer.externalId),
      };
    });

    apiLogger.info(
      { integration: id, totalCustomers: previewData.length, alreadyImported: previewData.filter(c => c.alreadyImported).length },
      'Integration preview fetched'
    );

    res.json({
      success: true,
      data: {
        customers: previewData,
        totalCount: previewData.length,
        alreadyImportedCount: previewData.filter(c => c.alreadyImported).length,
      },
      requestId: req.requestId,
    });
  })
);

/**
 * DELETE /api/integrations/:id/disconnect
 * Disconnect from an integration
 */
router.delete(
  '/:id/disconnect',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const adapter = registry.get(id);
    if (!adapter) {
      throw Errors.notFound('Integrasjon');
    }

    const db = await getDatabase();
    await db.deleteIntegrationCredentials(req.organizationId!, id);

    apiLogger.info(
      { integration: id, organizationId: req.organizationId },
      'Disconnected from integration'
    );

    res.json({
      success: true,
      message: `Frakoblet ${adapter.config.name}`,
      requestId: req.requestId,
    });
  })
);

/**
 * GET /api/integrations/:id/status
 * Check connection status and validate credentials
 */
router.get(
  '/:id/status',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;

    const adapter = registry.get(id);
    if (!adapter) {
      throw Errors.notFound('Integrasjon');
    }

    const db = await getDatabase();
    const stored = await db.getIntegrationCredentials(req.organizationId!, id);

    if (!stored || !stored.is_active) {
      res.json({
        success: true,
        data: {
          connected: false,
          valid: false,
          message: 'Ikke tilkoblet',
        },
        requestId: req.requestId,
      });
      return;
    }

    try {
      const credentials = await decryptCredentials(stored.credentials_encrypted);
      const isValid = await adapter.validateCredentials(credentials);
      const isExpired = isCredentialsExpired(credentials);

      res.json({
        success: true,
        data: {
          connected: true,
          valid: isValid && !isExpired,
          expired: isExpired,
          message: isValid
            ? (isExpired ? 'Autentisering utløper snart' : 'Tilkoblet og gyldig')
            : 'Autentisering ugyldig',
        },
        requestId: req.requestId,
      });
    } catch (error) {
      res.json({
        success: true,
        data: {
          connected: true,
          valid: false,
          message: 'Kunne ikke validere tilkobling',
        },
        requestId: req.requestId,
      });
    }
  })
);

/**
 * POST /api/integrations/tripletex/webhooks/subscribe
 * Subscribe to real-time webhook events from Tripletex
 */
router.post(
  '/tripletex/webhooks/subscribe',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const db = await getDatabase();
    const stored = await db.getIntegrationCredentials(req.organizationId!, 'tripletex');

    if (!stored || !stored.is_active) {
      throw Errors.badRequest('Tripletex-integrasjon er ikke tilkoblet');
    }

    const adapter = registry.get('tripletex');
    if (!adapter || !(adapter instanceof TripletexAdapter)) {
      throw Errors.badRequest('Tripletex-adapter ikke tilgjengelig');
    }

    let credentials = await decryptCredentials(stored.credentials_encrypted);

    if (isCredentialsExpired(credentials)) {
      credentials = await adapter.refreshAuth(credentials);
      const encrypted = await encryptCredentials(credentials);
      await db.saveIntegrationCredentials(req.organizationId!, {
        integration_id: 'tripletex',
        credentials_encrypted: encrypted,
        is_active: true,
      });
    }

    // Build the callback URL
    const baseUrl = req.headers['x-forwarded-host']
      ? `https://${req.headers['x-forwarded-host']}`
      : `${req.protocol}://${req.get('host')}`;
    const callbackUrl = `${baseUrl}/api/integration-webhooks/tripletex/${req.organizationId}`;

    // Subscribe to Tripletex events
    const subscriptionIds = await adapter.subscribeToWebhooks(credentials, callbackUrl);

    // Generate and store a webhook verification token in credentials metadata
    const webhookToken = randomBytes(32).toString('hex');
    credentials.metadata = {
      ...credentials.metadata,
      webhookToken,
      webhookCallbackUrl: callbackUrl,
      webhookSubscriptionIds: subscriptionIds,
    };
    const encrypted = await encryptCredentials(credentials);
    await db.saveIntegrationCredentials(req.organizationId!, {
      integration_id: 'tripletex',
      credentials_encrypted: encrypted,
      is_active: true,
    });

    apiLogger.info(
      { organizationId: req.organizationId, callbackUrl, subscriptionIds },
      'Tripletex webhook subscription created'
    );

    res.json({
      success: true,
      message: 'Abonnert på Tripletex-hendelser',
      data: { callbackUrl, subscriptionIds },
      requestId: req.requestId,
    });
  })
);

/**
 * GET /api/integrations/tripletex/project-categories
 * Fetch available project categories from Tripletex
 */
router.get(
  '/tripletex/project-categories',
  requireTenantAuth,
  requireFeature('tripletex_projects'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const db = await getDatabase();
    const stored = await db.getIntegrationCredentials(req.organizationId!, 'tripletex');

    if (!stored || !stored.is_active) {
      throw Errors.badRequest('Tripletex-integrasjon er ikke tilkoblet');
    }

    const adapter = registry.get('tripletex');
    if (!adapter || !(adapter instanceof TripletexAdapter)) {
      throw Errors.badRequest('Tripletex-adapter ikke tilgjengelig');
    }

    let credentials = await decryptCredentials(stored.credentials_encrypted);

    if (isCredentialsExpired(credentials)) {
      credentials = await adapter.refreshAuth(credentials);
      const encrypted = await encryptCredentials(credentials);
      await db.saveIntegrationCredentials(req.organizationId!, {
        integration_id: 'tripletex',
        credentials_encrypted: encrypted,
        is_active: true,
      });
    }

    const categories = await adapter.fetchProjectCategories(credentials);

    res.json({
      success: true,
      data: categories,
      requestId: req.requestId,
    });
  })
);

/**
 * POST /api/integrations/tripletex/create-project
 * Create a project in Tripletex for a specific customer
 */
router.post(
  '/tripletex/create-project',
  requireTenantAuth,
  requireFeature('tripletex_projects'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { kunde_id, project_name, category_id, description } = req.body;

    if (!kunde_id || typeof kunde_id !== 'number') {
      throw Errors.badRequest('kunde_id er påkrevd');
    }

    const db = await getDatabase();

    // Get the kunde to find their Tripletex external_id
    const kunde = await db.getKundeById(kunde_id, req.organizationId!);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    if (kunde.external_source !== 'tripletex' || !kunde.external_id) {
      throw Errors.badRequest('Kunden er ikke koblet til Tripletex. Synkroniser kunden fra Tripletex først.');
    }

    const tripletexCustomerId = Number(kunde.external_id);

    // Get Tripletex credentials
    const stored = await db.getIntegrationCredentials(req.organizationId!, 'tripletex');
    if (!stored || !stored.is_active) {
      throw Errors.badRequest('Tripletex-integrasjon er ikke tilkoblet');
    }

    const adapter = registry.get('tripletex');
    if (!adapter || !(adapter instanceof TripletexAdapter)) {
      throw Errors.badRequest('Tripletex-adapter ikke tilgjengelig');
    }

    let credentials = await decryptCredentials(stored.credentials_encrypted);

    if (isCredentialsExpired(credentials)) {
      credentials = await adapter.refreshAuth(credentials);
      const encrypted = await encryptCredentials(credentials);
      await db.saveIntegrationCredentials(req.organizationId!, {
        integration_id: 'tripletex',
        credentials_encrypted: encrypted,
        is_active: true,
      });
    }

    // Build project name from kunde name if not provided
    const name = project_name || kunde.navn;

    // Create the project in Tripletex
    const project = await adapter.createProject(credentials, {
      name,
      customerId: tripletexCustomerId,
      projectCategoryId: category_id ? Number(category_id) : undefined,
      description,
    });

    // Update the kunde's prosjektnummer field
    const existingProjects = kunde.prosjektnummer ? kunde.prosjektnummer.split(', ') : [];
    existingProjects.push(project.number);
    const updatedProsjektnummer = existingProjects.join(', ');

    await db.updateKunde(kunde_id, {
      prosjektnummer: updatedProsjektnummer,
    }, req.organizationId!);

    apiLogger.info(
      {
        organizationId: req.organizationId,
        kundeId: kunde_id,
        tripletexCustomerId,
        projectId: project.id,
        projectNumber: project.number,
      },
      'Created Tripletex project from map context menu'
    );

    res.json({
      success: true,
      data: {
        projectId: project.id,
        projectNumber: project.number,
        projectName: project.name,
      },
      message: `Prosjekt ${project.number} opprettet i Tripletex`,
      requestId: req.requestId,
    });
  })
);

/**
 * POST /api/integrations/tripletex/push-customer
 * Create or update a customer in Tripletex from Sky Planner
 */
router.post(
  '/tripletex/push-customer',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { kunde_id } = req.body;

    if (!kunde_id || typeof kunde_id !== 'number') {
      throw Errors.badRequest('kunde_id er påkrevd');
    }

    const db = await getDatabase();

    const kunde = await db.getKundeById(kunde_id, req.organizationId!);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    // Get Tripletex credentials
    const stored = await db.getIntegrationCredentials(req.organizationId!, 'tripletex');
    if (!stored || !stored.is_active) {
      throw Errors.badRequest('Tripletex-integrasjon er ikke tilkoblet');
    }

    const adapter = registry.get('tripletex');
    if (!adapter || !(adapter instanceof TripletexAdapter)) {
      throw Errors.badRequest('Tripletex-adapter ikke tilgjengelig');
    }

    let credentials = await decryptCredentials(stored.credentials_encrypted);

    if (isCredentialsExpired(credentials)) {
      credentials = await adapter.refreshAuth(credentials);
      const encrypted = await encryptCredentials(credentials);
      await db.saveIntegrationCredentials(req.organizationId!, {
        integration_id: 'tripletex',
        credentials_encrypted: encrypted,
        is_active: true,
      });
    }

    const kundeData = {
      navn: kunde.navn,
      adresse: kunde.adresse,
      postnummer: kunde.postnummer,
      poststed: kunde.poststed,
      telefon: kunde.telefon,
      epost: kunde.epost,
      org_nummer: kunde.org_nummer,
      faktura_epost: kunde.faktura_epost,
    };

    let result: { id: number; name: string; customerNumber?: number };
    let action: 'created' | 'updated';

    if (kunde.external_source === 'tripletex' && kunde.external_id) {
      // Customer already linked to Tripletex → update
      result = await adapter.updateCustomer(credentials, Number(kunde.external_id), kundeData);
      action = 'updated';
    } else {
      // New customer → create in Tripletex
      result = await adapter.createCustomer(credentials, kundeData);
      action = 'created';

      // Link the kunde to Tripletex
      await db.updateKunde(kunde_id, {
        external_source: 'tripletex',
        external_id: String(result.id),
        kundenummer: result.customerNumber ? String(result.customerNumber) : undefined,
        last_sync_at: new Date().toISOString(),
      } as Record<string, unknown>, req.organizationId!);
    }

    apiLogger.info(
      {
        organizationId: req.organizationId,
        kundeId: kunde_id,
        tripletexId: result.id,
        action,
      },
      `Customer ${action} in Tripletex`
    );

    res.json({
      success: true,
      data: {
        tripletexId: result.id,
        customerNumber: result.customerNumber,
        action,
      },
      message: action === 'created'
        ? `Kunde opprettet i Tripletex (ID: ${result.id})`
        : `Kunde oppdatert i Tripletex`,
      requestId: req.requestId,
    });
  })
);

export default router;

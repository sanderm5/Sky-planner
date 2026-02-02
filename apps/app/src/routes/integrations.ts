/**
 * Integration routes for external data source connections
 * Manages OAuth flows, credentials, and sync operations
 */

import { Router, Response } from 'express';
import { apiLogger } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { getDatabase } from '../services/database';
import { getIntegrationRegistry } from '../integrations/registry';
import { encryptCredentials, decryptCredentials, isCredentialsExpired } from '../integrations/encryption';
import { createTripletexAdapter } from '../integrations/adapters/tripletex';
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
    const { fullSync = false } = req.body;

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

export default router;

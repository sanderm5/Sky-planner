/**
 * Incoming webhook endpoints for external integrations
 * Receives events FROM integration providers (e.g., Tripletex)
 * These endpoints are unauthenticated (no JWT) but verified via provider-specific mechanisms
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../services/logger';
import { getDatabase } from '../services/database';
import { getIntegrationRegistry } from '../integrations/registry';
import { decryptCredentials, encryptCredentials, isCredentialsExpired } from '../integrations/encryption';
import { getWebhookService } from '../services/webhooks';

const router: Router = Router();
const logger = createLogger('integration-webhooks');

/**
 * POST /api/integration-webhooks/tripletex/:organizationId
 * Receives webhook events from Tripletex
 *
 * Tripletex webhook payload:
 * {
 *   "subscriptionId": 123,
 *   "event": "customer.create",
 *   "id": 456,
 *   "value": { ... }
 * }
 */
router.post('/tripletex/:organizationId', async (req: Request, res: Response) => {
  const organizationId = parseInt(req.params.organizationId, 10);

  if (isNaN(organizationId) || organizationId <= 0) {
    logger.warn({ organizationId: req.params.organizationId }, 'Invalid organization ID in Tripletex webhook');
    res.status(400).json({ error: 'Invalid organization ID' });
    return;
  }

  const payload = req.body;

  logger.info(
    { organizationId, event: payload?.event, resourceId: payload?.id },
    'Received Tripletex webhook'
  );

  // Verify this organization has an active Tripletex integration
  const db = await getDatabase();
  const stored = await db.getIntegrationCredentials(organizationId, 'tripletex');

  if (!stored || !stored.is_active) {
    logger.warn({ organizationId }, 'Received Tripletex webhook for organization without active integration');
    // Return 200 to prevent Tripletex from retrying
    res.status(200).json({ received: true, processed: false });
    return;
  }

  // Verify webhook token if stored in credentials metadata
  try {
    const credentials = await decryptCredentials(stored.credentials_encrypted);
    const storedWebhookToken = credentials.metadata?.webhookToken as string | undefined;
    const providedToken = req.headers['x-tripletex-webhook-token'] as string | undefined;

    if (storedWebhookToken && providedToken !== storedWebhookToken) {
      logger.warn({ organizationId }, 'Tripletex webhook token mismatch');
      res.status(401).json({ error: 'Invalid webhook token' });
      return;
    }
  } catch (error) {
    logger.error({ error, organizationId }, 'Failed to verify Tripletex webhook');
    res.status(200).json({ received: true, processed: false });
    return;
  }

  // Process the event
  try {
    const event = payload?.event as string;
    const resourceId = payload?.id;
    const resourceData = payload?.value as Record<string, unknown> | undefined;

    if (!event || !resourceId) {
      logger.warn({ payload }, 'Invalid Tripletex webhook payload');
      res.status(200).json({ received: true, processed: false });
      return;
    }

    switch (event) {
      case 'customer.create':
      case 'customer.update': {
        await processTripletexCustomerUpsert(organizationId, String(resourceId), resourceData, stored);
        break;
      }
      case 'customer.delete': {
        await processTripletexCustomerDelete(organizationId, String(resourceId));
        break;
      }
      default: {
        logger.info({ event }, 'Unhandled Tripletex webhook event type');
      }
    }

    res.status(200).json({ received: true, processed: true });
  } catch (error) {
    logger.error(
      { error, organizationId, event: payload?.event },
      'Failed to process Tripletex webhook'
    );
    // Return 200 to acknowledge receipt (avoid infinite retries from Tripletex)
    res.status(200).json({ received: true, processed: false, error: 'Processing failed' });
  }
});

/**
 * Process a customer create/update event from Tripletex
 */
async function processTripletexCustomerUpsert(
  organizationId: number,
  externalId: string,
  resourceData: Record<string, unknown> | undefined,
  stored: { credentials_encrypted: string; is_active: boolean }
): Promise<void> {
  const db = await getDatabase();
  const registry = getIntegrationRegistry();
  const adapter = registry.get('tripletex');

  if (!adapter) {
    logger.error('Tripletex adapter not found in registry');
    return;
  }

  let customerData: Record<string, unknown> | null = resourceData ?? null;

  // If the webhook didn't include the full resource, fetch it from the API
  if (!customerData) {
    try {
      let credentials = await decryptCredentials(stored.credentials_encrypted);

      if (isCredentialsExpired(credentials)) {
        credentials = await adapter.refreshAuth(credentials);
        const encrypted = await encryptCredentials(credentials);
        await db.saveIntegrationCredentials(organizationId, {
          integration_id: 'tripletex',
          credentials_encrypted: encrypted,
          is_active: true,
        });
      }

      // Build auth header for direct API call
      const authHeader = credentials.type === 'basic_auth'
        ? `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`
        : `Bearer ${credentials.accessToken}`;

      const response = await fetch(
        `https://tripletex.no/v2/customer/${externalId}?fields=id,name,organizationNumber,email,phoneNumber,phoneNumberMobile,physicalAddress(*),postalAddress(*)`,
        {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        logger.error({ status: response.status, externalId }, 'Failed to fetch customer from Tripletex');
        return;
      }

      const data = await response.json() as { value: Record<string, unknown> };
      customerData = data.value;
    } catch (error) {
      logger.error({ error, externalId }, 'Failed to fetch customer data from Tripletex API');
      return;
    }
  }

  // Map and upsert
  const externalCustomer = { externalId, data: customerData };
  const kundeData = adapter.mapToKunde(externalCustomer);
  const existing = await db.getKundeByExternalId(organizationId, 'tripletex', externalId);

  if (existing) {
    await db.updateKunde(existing.id, {
      ...kundeData,
      last_sync_at: new Date().toISOString(),
    }, organizationId);

    logger.info({ externalId, kundeId: existing.id }, 'Customer updated via Tripletex webhook');

    try {
      const webhookService = await getWebhookService();
      await webhookService.triggerCustomerUpdated(organizationId, {
        id: existing.id,
        navn: (kundeData.navn as string) || existing.navn,
        adresse: (kundeData.adresse as string) || existing.adresse,
      });
    } catch { /* non-critical */ }
  } else {
    const created = await db.createKunde({
      ...kundeData,
      organization_id: organizationId,
      external_source: 'tripletex',
      external_id: externalId,
      last_sync_at: new Date().toISOString(),
    });

    logger.info({ externalId, kundeId: (created as any)?.id }, 'Customer created via Tripletex webhook');

    try {
      const webhookService = await getWebhookService();
      await webhookService.triggerCustomerCreated(organizationId, {
        id: (created as any)?.id ?? 0,
        navn: (kundeData.navn as string) || '',
        adresse: (kundeData.adresse as string) || '',
      });
    } catch { /* non-critical */ }
  }
}

/**
 * Process a customer delete event from Tripletex
 * Uses soft-delete approach (adds note) to prevent accidental data loss
 */
async function processTripletexCustomerDelete(
  organizationId: number,
  externalId: string
): Promise<void> {
  const db = await getDatabase();
  const existing = await db.getKundeByExternalId(organizationId, 'tripletex', externalId);

  if (!existing) {
    logger.info({ externalId }, 'Customer not found for Tripletex delete event, ignoring');
    return;
  }

  // Soft-delete: add note instead of hard-deleting
  const existingNotes = (existing as any).notater || '';
  await db.updateKunde(existing.id, {
    notater: `${existingNotes}\n[Auto] Slettet fra Tripletex ${new Date().toISOString()}`.trim(),
  }, organizationId);

  logger.info({ externalId, kundeId: existing.id }, 'Customer marked as deleted via Tripletex webhook');

  try {
    const webhookService = await getWebhookService();
    await webhookService.triggerCustomerDeleted(organizationId, {
      id: existing.id,
      navn: existing.navn,
      adresse: existing.adresse,
    });
  } catch { /* non-critical */ }
}

export default router;

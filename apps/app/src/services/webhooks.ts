/**
 * Webhook Service
 * Handles webhook triggering, delivery, and retry logic
 */

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import { createLogger } from './logger';
import type {
  WebhookEndpoint,
  WebhookDelivery,
  WebhookPayload,
  WebhookEventType,
  WebhookDeliveryInsertData,
  CustomerEventData,
  RouteEventData,
  SyncEventData,
} from '../types/webhook';

const log = createLogger('webhooks');

// Constants
const SIGNATURE_ALGORITHM = 'sha256';
const MAX_FAILURES_BEFORE_DISABLE = 10;
const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600, 7200]; // 1min, 5min, 15min, 1hr, 2hr
const DELIVERY_TIMEOUT_MS = 30000; // 30 seconds

// Private/internal IP ranges (RFC 1918, loopback, link-local, metadata)
const PRIVATE_IP_RANGES = [
  /^127\./,                    // Loopback
  /^10\./,                     // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./,               // Class C private
  /^169\.254\./,               // Link-local
  /^0\./,                      // Current network
  /^::1$/,                     // IPv6 loopback
  /^fc00:/i,                   // IPv6 unique local
  /^fe80:/i,                   // IPv6 link-local
];

/**
 * Check if an IP address is private/internal
 */
function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((range) => range.test(ip));
}

/**
 * Validate that a webhook URL does not point to internal/private services (SSRF protection)
 */
async function validateWebhookUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Ugyldig webhook-URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook-URL må bruke HTTPS');
  }

  // Resolve hostname and check all IPs
  const hostname = parsed.hostname;

  // Block IP-address hostnames directly
  if (/^[\d.]+$/.test(hostname) || hostname.startsWith('[')) {
    if (isPrivateIp(hostname.replaceAll(/[[\]]/g, ''))) {
      throw new Error('Webhook-URL kan ikke peke til interne adresser');
    }
  }

  // DNS lookup to check resolved IPs
  try {
    const [addresses, addresses6] = await Promise.all([
      dns.resolve4(hostname).catch(() => [] as string[]),
      dns.resolve6(hostname).catch(() => [] as string[]),
    ]);
    const allAddresses = [...addresses, ...addresses6];

    if (allAddresses.length === 0) {
      throw new Error('Kunne ikke verifisere webhook-URL (DNS-oppslag feilet)');
    }

    for (const addr of allAddresses) {
      if (isPrivateIp(addr)) {
        throw new Error('Webhook-URL kan ikke peke til interne adresser');
      }
    }
  } catch (error) {
    if (error instanceof Error && (error.message.includes('interne adresser') || error.message.includes('DNS-oppslag'))) {
      throw error;
    }
    log.warn({ hostname }, 'DNS resolution failed for webhook URL');
    throw new Error('Kunne ikke verifisere webhook-URL (DNS-oppslag feilet)');
  }
}

/**
 * Webhook Service class
 */
export class WebhookService {
  private readonly getDatabase: () => Promise<WebhookDatabaseInterface>;

  constructor(getDatabaseFn: () => Promise<WebhookDatabaseInterface>) {
    this.getDatabase = getDatabaseFn;
  }

  // ============ Webhook Endpoint Management ============

  /**
   * Create a new webhook endpoint
   * Returns the webhook and the secret (shown only once)
   */
  async createWebhook(
    organizationId: number,
    data: { url: string; name: string; description?: string; events: WebhookEventType[] },
    createdBy: number
  ): Promise<{ webhook: WebhookEndpoint; secret: string }> {
    // SSRF protection: validate URL does not point to internal services
    await validateWebhookUrl(data.url);

    // Generate secret for HMAC signing
    const secret = `whsec_${crypto.randomBytes(32).toString('base64url')}`;
    const secretHash = this.hashSecret(secret);

    const db = await this.getDatabase();
    const webhook = await db.createWebhookEndpoint({
      organization_id: organizationId,
      url: data.url,
      name: data.name,
      description: data.description,
      events: data.events,
      secret_hash: secretHash,
      created_by: createdBy,
    });

    log.info(
      { webhookId: webhook.id, organizationId, name: data.name, events: data.events },
      'Webhook endpoint created'
    );

    return { webhook, secret };
  }

  /**
   * List all webhooks for an organization
   */
  async listWebhooks(organizationId: number): Promise<WebhookEndpoint[]> {
    const db = await this.getDatabase();
    return db.getOrganizationWebhooks(organizationId);
  }

  /**
   * Get a specific webhook
   */
  async getWebhook(webhookId: number, organizationId: number): Promise<WebhookEndpoint | null> {
    const db = await this.getDatabase();
    return db.getWebhookEndpointById(webhookId, organizationId);
  }

  /**
   * Update a webhook endpoint
   */
  async updateWebhook(
    webhookId: number,
    organizationId: number,
    data: { url?: string; name?: string; description?: string; events?: WebhookEventType[]; is_active?: boolean }
  ): Promise<WebhookEndpoint | null> {
    const db = await this.getDatabase();
    return db.updateWebhookEndpoint(webhookId, organizationId, data);
  }

  /**
   * Delete a webhook endpoint
   */
  async deleteWebhook(webhookId: number, organizationId: number): Promise<boolean> {
    const db = await this.getDatabase();
    const result = await db.deleteWebhookEndpoint(webhookId, organizationId);

    if (result) {
      log.info({ webhookId, organizationId }, 'Webhook endpoint deleted');
    }

    return result;
  }

  /**
   * Rotate webhook secret
   */
  async rotateSecret(
    webhookId: number,
    organizationId: number
  ): Promise<{ webhook: WebhookEndpoint; secret: string } | null> {
    const db = await this.getDatabase();
    const existing = await db.getWebhookEndpointById(webhookId, organizationId);

    if (!existing) return null;

    const secret = `whsec_${crypto.randomBytes(32).toString('base64url')}`;
    const secretHash = this.hashSecret(secret);

    await db.updateWebhookSecret(webhookId, organizationId, secretHash);

    log.info({ webhookId, organizationId }, 'Webhook secret rotated');

    return { webhook: existing, secret };
  }

  // ============ Event Triggering ============

  /**
   * Trigger a webhook event for an organization
   */
  async triggerEvent<T>(
    organizationId: number,
    eventType: WebhookEventType,
    data: T
  ): Promise<void> {
    const db = await this.getDatabase();
    const endpoints = await db.getActiveWebhookEndpointsForEvent(organizationId, eventType);

    if (endpoints.length === 0) {
      log.debug({ organizationId, eventType }, 'No active webhooks for event');
      return;
    }

    const eventId = `evt_${crypto.randomUUID()}`;
    const payload: WebhookPayload<T> = {
      id: eventId,
      type: eventType,
      created_at: new Date().toISOString(),
      organization_id: organizationId,
      data,
    };

    // Queue deliveries for each endpoint
    for (const endpoint of endpoints) {
      await db.createWebhookDelivery({
        webhook_endpoint_id: endpoint.id,
        organization_id: organizationId,
        event_type: eventType,
        event_id: eventId,
        payload: payload as WebhookPayload,
      });
    }

    log.info(
      { organizationId, eventType, eventId, endpointCount: endpoints.length },
      'Webhook event triggered'
    );

    // Process deliveries asynchronously
    this.processDeliveries().catch(err => {
      log.error({ err }, 'Failed to process webhook deliveries');
    });
  }

  // ============ Convenience Methods for Common Events ============

  /**
   * Trigger customer.created event
   */
  async triggerCustomerCreated(organizationId: number, customer: CustomerEventData['customer']): Promise<void> {
    await this.triggerEvent<CustomerEventData>(organizationId, 'customer.created', { customer });
  }

  /**
   * Trigger customer.updated event
   */
  async triggerCustomerUpdated(
    organizationId: number,
    customer: CustomerEventData['customer'],
    changes?: CustomerEventData['changes']
  ): Promise<void> {
    await this.triggerEvent<CustomerEventData>(organizationId, 'customer.updated', { customer, changes });
  }

  /**
   * Trigger customer.deleted event
   */
  async triggerCustomerDeleted(organizationId: number, customer: CustomerEventData['customer']): Promise<void> {
    await this.triggerEvent<CustomerEventData>(organizationId, 'customer.deleted', { customer });
  }

  /**
   * Trigger route.completed event
   */
  async triggerRouteCompleted(organizationId: number, route: RouteEventData['route'], customerCount: number): Promise<void> {
    await this.triggerEvent<RouteEventData>(organizationId, 'route.completed', { route, customer_count: customerCount });
  }

  /**
   * Trigger sync.completed event
   */
  async triggerSyncCompleted(organizationId: number, syncData: SyncEventData): Promise<void> {
    await this.triggerEvent<SyncEventData>(organizationId, 'sync.completed', syncData);
  }

  /**
   * Trigger sync.failed event
   */
  async triggerSyncFailed(organizationId: number, syncData: SyncEventData): Promise<void> {
    await this.triggerEvent<SyncEventData>(organizationId, 'sync.failed', syncData);
  }

  // ============ Delivery Processing ============

  /**
   * Process pending webhook deliveries
   */
  async processDeliveries(): Promise<void> {
    const db = await this.getDatabase();
    const deliveries = await db.getPendingWebhookDeliveries();

    for (const delivery of deliveries) {
      await this.attemptDelivery(delivery);
    }
  }

  /**
   * Attempt to deliver a single webhook
   */
  private async attemptDelivery(delivery: WebhookDelivery): Promise<void> {
    const db = await this.getDatabase();
    const endpoint = await db.getWebhookEndpointWithSecret(delivery.webhook_endpoint_id);

    if (!endpoint || !endpoint.is_active) {
      await db.updateWebhookDeliveryStatus(delivery.id, 'failed', {
        error_message: 'Webhook endpoint inactive or not found',
      });
      return;
    }

    // SSRF protection: validate URL before delivery
    try {
      await validateWebhookUrl(endpoint.url);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'SSRF validation failed';
      await db.updateWebhookDeliveryStatus(delivery.id, 'failed', { error_message: errorMsg });
      log.warn({ webhookId: endpoint.id, url: endpoint.url }, 'Webhook delivery blocked by SSRF check');
      return;
    }

    const payloadString = JSON.stringify(delivery.payload);
    const signature = this.signPayload(payloadString, endpoint.secret_hash);

    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `${SIGNATURE_ALGORITHM}=${signature}`,
          'X-Webhook-Event': delivery.event_type,
          'X-Webhook-ID': delivery.event_id,
          'X-Webhook-Timestamp': new Date().toISOString(),
          'User-Agent': 'SkyPlanner-Webhooks/1.0',
        },
        body: payloadString,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseTime = Date.now() - startTime;
      const responseBody = await response.text().catch(() => '');

      if (response.ok) {
        await db.updateWebhookDeliveryStatus(delivery.id, 'delivered', {
          response_status: response.status,
          response_body: responseBody.substring(0, 1000), // Limit stored response
          response_time_ms: responseTime,
          delivered_at: new Date().toISOString(),
        });

        await db.recordWebhookSuccess(endpoint.id);

        log.debug(
          { deliveryId: delivery.id, webhookId: endpoint.id, responseTime },
          'Webhook delivered successfully'
        );
      } else {
        await this.handleDeliveryFailure(delivery, endpoint, response.status, responseTime, responseBody);
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.handleDeliveryFailure(delivery, endpoint, null, responseTime, undefined, errorMessage);
    }
  }

  /**
   * Handle delivery failure - schedule retry or mark as failed
   */
  private async handleDeliveryFailure(
    delivery: WebhookDelivery,
    endpoint: WebhookEndpoint,
    statusCode: number | null,
    responseTime: number,
    responseBody?: string,
    errorMessage?: string
  ): Promise<void> {
    const db = await this.getDatabase();
    const newAttemptCount = delivery.attempt_count + 1;

    if (newAttemptCount >= delivery.max_attempts) {
      // Max retries exceeded - mark as failed
      await db.updateWebhookDeliveryStatus(delivery.id, 'failed', {
        attempt_count: newAttemptCount,
        response_status: statusCode ?? undefined,
        response_body: responseBody?.substring(0, 1000),
        response_time_ms: responseTime,
        error_message: errorMessage || `Max retries exceeded (status: ${statusCode})`,
      });

      log.warn(
        { deliveryId: delivery.id, webhookId: endpoint.id, attemptCount: newAttemptCount },
        'Webhook delivery failed after max retries'
      );
    } else {
      // Schedule retry with exponential backoff
      const delaySeconds = RETRY_DELAYS_SECONDS[Math.min(newAttemptCount - 1, RETRY_DELAYS_SECONDS.length - 1)];
      const nextRetry = new Date(Date.now() + delaySeconds * 1000);

      await db.updateWebhookDeliveryStatus(delivery.id, 'retrying', {
        attempt_count: newAttemptCount,
        next_retry_at: nextRetry.toISOString(),
        response_status: statusCode ?? undefined,
        response_body: responseBody?.substring(0, 1000),
        response_time_ms: responseTime,
        error_message: errorMessage,
      });

      log.debug(
        { deliveryId: delivery.id, webhookId: endpoint.id, attemptCount: newAttemptCount, nextRetry },
        'Webhook delivery scheduled for retry'
      );
    }

    // Track endpoint failures
    await db.recordWebhookFailure(endpoint.id);

    // Auto-disable after too many consecutive failures
    const updatedEndpoint = await db.getWebhookEndpointById(endpoint.id, endpoint.organization_id);
    if (updatedEndpoint && updatedEndpoint.failure_count >= MAX_FAILURES_BEFORE_DISABLE) {
      await db.disableWebhookEndpoint(endpoint.id, 'Auto-deaktivert etter gjentatte feil');
      log.warn({ webhookId: endpoint.id }, 'Webhook endpoint auto-disabled due to repeated failures');
    }
  }

  // ============ Delivery History ============

  /**
   * Get delivery history for a webhook endpoint
   */
  async getDeliveryHistory(
    webhookId: number,
    organizationId: number,
    limit: number = 50
  ): Promise<WebhookDelivery[]> {
    const db = await this.getDatabase();
    return db.getWebhookDeliveryHistory(webhookId, organizationId, limit);
  }

  /**
   * Retry a failed delivery
   */
  async retryDelivery(deliveryId: number, organizationId: number): Promise<boolean> {
    const db = await this.getDatabase();
    const delivery = await db.getWebhookDeliveryById(deliveryId, organizationId);

    if (!delivery || delivery.status === 'delivered') {
      return false;
    }

    // Reset for retry
    await db.updateWebhookDeliveryStatus(delivery.id, 'pending', {
      attempt_count: 0,
      next_retry_at: undefined,
      error_message: undefined,
    });

    // Process immediately
    this.processDeliveries().catch(err => {
      log.error({ err }, 'Failed to process retry delivery');
    });

    return true;
  }

  // ============ Signature Helpers ============

  /**
   * Sign a payload with HMAC-SHA256
   */
  private signPayload(payload: string, secretHash: string): string {
    return crypto
      .createHmac(SIGNATURE_ALGORITHM, secretHash)
      .update(payload, 'utf8')
      .digest('hex');
  }

  /**
   * Hash a secret for storage
   */
  private hashSecret(secret: string): string {
    return crypto.createHash('sha256').update(secret).digest('hex');
  }

  /**
   * Verify a webhook signature (for documentation/testing)
   */
  static verifySignature(payload: string, signature: string, secret: string): boolean {
    const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
    const expectedSig = crypto
      .createHmac(SIGNATURE_ALGORITHM, secretHash)
      .update(payload, 'utf8')
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSig)
      );
    } catch {
      return false;
    }
  }
}

// ============ Database Interface ============

export interface WebhookDatabaseInterface {
  createWebhookEndpoint(data: {
    organization_id: number;
    url: string;
    name: string;
    description?: string;
    events: WebhookEventType[];
    secret_hash: string;
    created_by: number;
  }): Promise<WebhookEndpoint>;

  getOrganizationWebhooks(organizationId: number): Promise<WebhookEndpoint[]>;
  getWebhookEndpointById(id: number, organizationId: number): Promise<WebhookEndpoint | null>;
  getWebhookEndpointWithSecret(id: number): Promise<(WebhookEndpoint & { secret_hash: string }) | null>;
  getActiveWebhookEndpointsForEvent(organizationId: number, eventType: WebhookEventType): Promise<WebhookEndpoint[]>;

  updateWebhookEndpoint(
    id: number,
    organizationId: number,
    data: { url?: string; name?: string; description?: string; events?: WebhookEventType[]; is_active?: boolean }
  ): Promise<WebhookEndpoint | null>;

  updateWebhookSecret(id: number, organizationId: number, secretHash: string): Promise<boolean>;
  deleteWebhookEndpoint(id: number, organizationId: number): Promise<boolean>;
  disableWebhookEndpoint(id: number, reason: string): Promise<boolean>;
  recordWebhookSuccess(id: number): Promise<void>;
  recordWebhookFailure(id: number): Promise<void>;

  createWebhookDelivery(data: WebhookDeliveryInsertData): Promise<WebhookDelivery>;
  getPendingWebhookDeliveries(): Promise<WebhookDelivery[]>;
  getWebhookDeliveryById(id: number, organizationId: number): Promise<WebhookDelivery | null>;
  getWebhookDeliveryHistory(webhookId: number, organizationId: number, limit: number): Promise<WebhookDelivery[]>;

  updateWebhookDeliveryStatus(
    id: number,
    status: WebhookDelivery['status'],
    data: Partial<{
      attempt_count: number;
      next_retry_at: string;
      response_status: number;
      response_body: string;
      response_time_ms: number;
      error_message: string;
      delivered_at: string;
    }>
  ): Promise<void>;
}

// ============ Singleton Instance ============

let webhookServiceInstance: WebhookService | null = null;

/**
 * Get the singleton webhook service instance
 */
export async function getWebhookService(): Promise<WebhookService> {
  if (!webhookServiceInstance) {
    const { getDatabase } = await import('./database');
    webhookServiceInstance = new WebhookService(getDatabase as unknown as () => Promise<WebhookDatabaseInterface>);
  }
  return webhookServiceInstance;
}

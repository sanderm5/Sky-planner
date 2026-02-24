/**
 * Type definitions for Webhook system
 */

// ============ Webhook Event Types ============

/**
 * Available webhook event types
 */
export type WebhookEventType =
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'route.created'
  | 'route.completed'
  | 'appointment.created'
  | 'appointment.completed'
  | 'sync.completed'
  | 'sync.failed';

/**
 * Human-readable event descriptions (Norwegian)
 */
export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  'customer.created': 'Kunde opprettet',
  'customer.updated': 'Kunde oppdatert',
  'customer.deleted': 'Kunde slettet',
  'route.created': 'Rute opprettet',
  'route.completed': 'Rute fullført',
  'appointment.created': 'Avtale opprettet',
  'appointment.completed': 'Avtale fullført',
  'sync.completed': 'Synkronisering fullført',
  'sync.failed': 'Synkronisering feilet',
};

/**
 * Event categories for UI grouping
 */
export const WEBHOOK_EVENT_CATEGORIES = {
  customers: ['customer.created', 'customer.updated', 'customer.deleted'],
  routes: ['route.created', 'route.completed'],
  appointments: ['appointment.created', 'appointment.completed'],
  integrations: ['sync.completed', 'sync.failed'],
} as const;

// ============ Webhook Endpoint Models ============

/**
 * Webhook endpoint database record
 */
export interface WebhookEndpoint {
  id: number;
  organization_id: number;
  url: string;
  name: string;
  description?: string;
  events: WebhookEventType[];
  is_active: boolean;
  failure_count: number;
  last_failure_at?: string;
  last_success_at?: string;
  disabled_at?: string;
  disabled_reason?: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

/**
 * Webhook endpoint with secret (internal use only)
 */
export interface WebhookEndpointWithSecret extends WebhookEndpoint {
  secret_hash: string;
}

/**
 * Delivery status for webhook attempts
 */
export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'retrying';

/**
 * Webhook delivery record
 */
export interface WebhookDelivery {
  id: number;
  webhook_endpoint_id: number;
  organization_id: number;
  event_type: WebhookEventType;
  event_id: string;
  payload: WebhookPayload;
  status: WebhookDeliveryStatus;
  attempt_count: number;
  max_attempts: number;
  next_retry_at?: string;
  response_status?: number;
  response_body?: string;
  response_time_ms?: number;
  error_message?: string;
  created_at: string;
  delivered_at?: string;
}

// ============ Webhook Payload Types ============

/**
 * Base webhook payload structure
 */
export interface WebhookPayload<T = unknown> {
  id: string;
  type: WebhookEventType;
  created_at: string;
  organization_id: number;
  data: T;
}

/**
 * Customer event data
 */
export interface CustomerEventData {
  customer: {
    id: number;
    navn: string;
    adresse: string;
    postnummer?: string;
    poststed?: string;
    telefon?: string;
    epost?: string;
  };
  changes?: Record<string, { old: unknown; new: unknown }>;
}

/**
 * Route event data
 */
export interface RouteEventData {
  route: {
    id: number;
    navn: string;
    planlagt_dato?: string;
    total_distanse?: number;
    total_tid?: number;
  };
  customer_count?: number;
}

/**
 * Sync event data
 */
export interface SyncEventData {
  integration_id: string;
  integration_name: string;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  synced_at: string;
  error_message?: string;
}

// ============ Request/Response Types ============

/**
 * Request body for creating a webhook endpoint
 */
export interface CreateWebhookRequest {
  url: string;
  name: string;
  description?: string;
  events: WebhookEventType[];
}

/**
 * Request body for updating a webhook endpoint
 */
export interface UpdateWebhookRequest {
  url?: string;
  name?: string;
  description?: string;
  events?: WebhookEventType[];
  is_active?: boolean;
}

/**
 * Response when creating a webhook endpoint
 * IMPORTANT: secret is only returned once and must be stored by the client
 */
export interface CreateWebhookResponse {
  webhook: WebhookEndpoint;
  secret: string;
}

// ============ Database Insert Types ============

/**
 * Data for inserting a new webhook endpoint
 */
export interface WebhookEndpointInsertData {
  organization_id: number;
  url: string;
  name: string;
  description?: string;
  events: WebhookEventType[];
  secret_hash: string;
  created_by: number;
}

/**
 * Data for inserting a webhook delivery
 */
export interface WebhookDeliveryInsertData {
  webhook_endpoint_id: number;
  organization_id: number;
  event_type: WebhookEventType;
  event_id: string;
  payload: WebhookPayload;
}

// ============ Validation ============

const VALID_EVENT_TYPES: WebhookEventType[] = [
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'route.created',
  'route.completed',
  'appointment.created',
  'appointment.completed',
  'sync.completed',
  'sync.failed',
];

/**
 * Validate if a string is a valid webhook event type
 */
export function isValidEventType(event: string): event is WebhookEventType {
  return VALID_EVENT_TYPES.includes(event as WebhookEventType);
}

/**
 * Validate an array of event types
 */
export function validateEventTypes(events: string[]): WebhookEventType[] {
  return events.filter(isValidEventType) as WebhookEventType[];
}

/**
 * Validate a webhook URL
 * Requires HTTPS and blocks private/internal IP ranges (SSRF protection)
 */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost and loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
      return false;
    }

    // Block private/reserved IPv4 ranges
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      if (a === 10) return false;                         // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return false;  // 172.16.0.0/12
      if (a === 192 && b === 168) return false;            // 192.168.0.0/16
      if (a === 169 && b === 254) return false;            // 169.254.0.0/16 (link-local / cloud metadata)
      if (a === 0) return false;                           // 0.0.0.0/8
      if (a === 255) return false;                         // broadcast
    }

    // Block .local and .internal domains
    if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

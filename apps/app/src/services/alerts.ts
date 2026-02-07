/**
 * Alerting Service
 * Sends notifications for critical events via webhooks (Slack, Discord, etc.)
 */

import { createLogger } from './logger';

const logger = createLogger('alerts');

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface AlertPayload {
  title: string;
  message: string;
  severity: AlertSeverity;
  source: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

interface WebhookConfig {
  url: string;
  type: 'slack' | 'discord' | 'generic';
}

/**
 * Format alert for Slack webhook
 */
function formatSlackPayload(alert: AlertPayload): Record<string, unknown> {
  const severityColors: Record<AlertSeverity, string> = {
    info: '#36a64f',
    warning: '#ffcc00',
    error: '#ff6600',
    critical: '#ff0000',
  };

  const severityEmoji: Record<AlertSeverity, string> = {
    info: ':information_source:',
    warning: ':warning:',
    error: ':x:',
    critical: ':rotating_light:',
  };

  return {
    attachments: [
      {
        color: severityColors[alert.severity],
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${severityEmoji[alert.severity]} ${alert.title}`,
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: alert.message,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `*Source:* ${alert.source} | *Severity:* ${alert.severity.toUpperCase()} | *Time:* ${alert.timestamp || new Date().toISOString()}`,
              },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Format alert for Discord webhook
 */
function formatDiscordPayload(alert: AlertPayload): Record<string, unknown> {
  const severityColors: Record<AlertSeverity, number> = {
    info: 0x36a64f,
    warning: 0xffcc00,
    error: 0xff6600,
    critical: 0xff0000,
  };

  return {
    embeds: [
      {
        title: alert.title,
        description: alert.message,
        color: severityColors[alert.severity],
        fields: [
          { name: 'Source', value: alert.source, inline: true },
          { name: 'Severity', value: alert.severity.toUpperCase(), inline: true },
        ],
        timestamp: alert.timestamp || new Date().toISOString(),
        footer: {
          text: 'Sky Planner Alerts',
        },
      },
    ],
  };
}

/**
 * Format alert for generic webhook
 */
function formatGenericPayload(alert: AlertPayload): Record<string, unknown> {
  return {
    ...alert,
    timestamp: alert.timestamp || new Date().toISOString(),
  };
}

/**
 * Send alert to a webhook
 */
async function sendWebhookAlert(config: WebhookConfig, alert: AlertPayload): Promise<boolean> {
  let payload: Record<string, unknown>;

  switch (config.type) {
    case 'slack':
      payload = formatSlackPayload(alert);
      break;
    case 'discord':
      payload = formatDiscordPayload(alert);
      break;
    default:
      payload = formatGenericPayload(alert);
  }

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.error({ status: response.status, type: config.type }, 'Webhook alert failed');
      return false;
    }

    return true;
  } catch (error) {
    logger.error({ error, type: config.type }, 'Failed to send webhook alert');
    return false;
  }
}

/**
 * Get configured alert webhooks from environment
 */
function getAlertWebhooks(): WebhookConfig[] {
  const webhooks: WebhookConfig[] = [];

  const slackUrl = process.env.ALERT_SLACK_WEBHOOK;
  if (slackUrl) {
    webhooks.push({ url: slackUrl, type: 'slack' });
  }

  const discordUrl = process.env.ALERT_DISCORD_WEBHOOK;
  if (discordUrl) {
    webhooks.push({ url: discordUrl, type: 'discord' });
  }

  const genericUrl = process.env.ALERT_WEBHOOK_URL;
  if (genericUrl) {
    webhooks.push({ url: genericUrl, type: 'generic' });
  }

  return webhooks;
}

/**
 * Send alert to all configured channels
 */
export async function sendAlert(alert: AlertPayload): Promise<void> {
  const webhooks = getAlertWebhooks();

  if (webhooks.length === 0) {
    logger.debug({ alert }, 'No alert webhooks configured');
    return;
  }

  const alertWithTimestamp = {
    ...alert,
    timestamp: alert.timestamp || new Date().toISOString(),
  };

  logger.info({ title: alert.title, severity: alert.severity }, 'Sending alert');

  const results = await Promise.allSettled(
    webhooks.map((webhook) => sendWebhookAlert(webhook, alertWithTimestamp))
  );

  const failures = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value));
  if (failures.length > 0) {
    logger.warn({ failureCount: failures.length, totalWebhooks: webhooks.length }, 'Some alerts failed to send');
  }
}

// ============ Convenience alert functions ============

/**
 * Alert for security events
 */
export async function alertSecurityEvent(
  title: string,
  message: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await sendAlert({
    title,
    message,
    severity: 'critical',
    source: 'security',
    metadata,
  });
}

/**
 * Alert for payment failures
 */
export async function alertPaymentFailure(
  organizationId: number,
  customerEmail: string,
  error: string
): Promise<void> {
  await sendAlert({
    title: 'Payment Failed',
    message: `Payment failed for organization ${organizationId} (${customerEmail}): ${error}`,
    severity: 'error',
    source: 'billing',
    metadata: { organizationId, customerEmail },
  });
}

/**
 * Alert for system errors
 */
export async function alertSystemError(
  component: string,
  error: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await sendAlert({
    title: `System Error: ${component}`,
    message: error,
    severity: 'error',
    source: component,
    metadata,
  });
}

/**
 * Alert for database issues
 */
export async function alertDatabaseIssue(
  issue: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await sendAlert({
    title: 'Database Issue',
    message: issue,
    severity: 'critical',
    source: 'database',
    metadata,
  });
}

/**
 * Alert for high resource usage
 */
export async function alertHighResourceUsage(
  resource: 'memory' | 'cpu' | 'disk',
  percentage: number,
  threshold: number
): Promise<void> {
  await sendAlert({
    title: `High ${resource.charAt(0).toUpperCase() + resource.slice(1)} Usage`,
    message: `${resource} usage at ${percentage.toFixed(1)}% (threshold: ${threshold}%)`,
    severity: percentage > 95 ? 'critical' : 'warning',
    source: 'monitoring',
    metadata: { resource, percentage, threshold },
  });
}

/**
 * Alert for rate limiting events (potential attack)
 */
export async function alertRateLimitExceeded(
  ip: string,
  endpoint: string,
  count: number
): Promise<void> {
  await sendAlert({
    title: 'Rate Limit Exceeded',
    message: `IP ${ip} exceeded rate limit on ${endpoint} (${count} attempts)`,
    severity: 'warning',
    source: 'security',
    metadata: { ip, endpoint, count },
  });
}

/**
 * Alert for failed login attempts (potential brute force)
 */
export async function alertBruteForceAttempt(
  ip: string,
  email: string,
  attemptCount: number
): Promise<void> {
  if (attemptCount >= 10) {
    await sendAlert({
      title: 'Potential Brute Force Attack',
      message: `${attemptCount} failed login attempts from IP ${ip} for email ${email}`,
      severity: 'warning',
      source: 'security',
      metadata: { ip, email, attemptCount },
    });
  }
}

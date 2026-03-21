/**
 * Cron Watchdog Service
 * Self-healing cron job scheduler with automatic retry and alerting.
 *
 * Instead of relying on external cron triggers, this runs jobs internally
 * with built-in retry logic, health tracking, and failure alerts.
 */

import cron from 'node-cron';
import { createLogger } from './logger';
import { sendAlert } from './alerts';

const logger = createLogger('cron-watchdog');

interface CronJobConfig {
  name: string;
  schedule: string; // cron expression
  handler: () => Promise<void>;
  maxRetries?: number;
  retryDelayMs?: number;
  alertOnFailure?: boolean;
}

interface CronJobState {
  name: string;
  lastRun: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  totalRuns: number;
  totalFailures: number;
  isRunning: boolean;
}

const jobStates = new Map<string, CronJobState>();
const scheduledTasks: cron.ScheduledTask[] = [];

/**
 * Register and schedule a cron job with self-healing capabilities.
 */
export function registerCronJob(config: CronJobConfig): void {
  const maxRetries = config.maxRetries ?? 2;
  const retryDelayMs = config.retryDelayMs ?? 30_000;
  const alertOnFailure = config.alertOnFailure ?? true;

  const state: CronJobState = {
    name: config.name,
    lastRun: null,
    lastSuccess: null,
    lastError: null,
    consecutiveFailures: 0,
    totalRuns: 0,
    totalFailures: 0,
    isRunning: false,
  };
  jobStates.set(config.name, state);

  const task = cron.schedule(config.schedule, async () => {
    if (state.isRunning) {
      logger.warn({ job: config.name }, 'Cron job still running, skipping this execution');
      return;
    }

    state.isRunning = true;
    state.totalRuns++;
    state.lastRun = new Date().toISOString();

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
      try {
        if (attempt > 0) {
          logger.info({ job: config.name, attempt: attempt + 1, maxRetries: maxRetries + 1 }, 'Retrying cron job');
        }

        await config.handler();

        // Success
        state.lastSuccess = new Date().toISOString();
        state.consecutiveFailures = 0;
        state.lastError = null;
        state.isRunning = false;

        if (attempt > 0) {
          logger.info({ job: config.name, attempt: attempt + 1 }, 'Cron job succeeded after retry');
        }

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;

        if (attempt <= maxRetries) {
          logger.warn(
            { job: config.name, attempt, error: lastError.message },
            'Cron job failed, will retry'
          );
          await sleep(retryDelayMs);
        }
      }
    }

    // All retries exhausted
    state.consecutiveFailures++;
    state.totalFailures++;
    state.lastError = lastError?.message ?? 'Unknown error';
    state.isRunning = false;

    logger.error(
      { job: config.name, consecutiveFailures: state.consecutiveFailures, error: state.lastError },
      'Cron job failed after all retries'
    );

    if (alertOnFailure) {
      sendAlert({
        title: `Cron-jobb feilet: ${config.name}`,
        message: `${config.name} har feilet ${state.consecutiveFailures} gang(er) på rad. Siste feil: ${state.lastError}. Totalt ${state.totalFailures}/${state.totalRuns} kjøringer feilet.`,
        severity: state.consecutiveFailures >= 3 ? 'critical' : 'error',
        source: 'cron-watchdog',
        metadata: {
          job: config.name,
          consecutiveFailures: state.consecutiveFailures,
          totalFailures: state.totalFailures,
          totalRuns: state.totalRuns,
          lastError: state.lastError,
        },
      }).catch(() => {});
    }
  });

  scheduledTasks.push(task);
  logger.info({ job: config.name, schedule: config.schedule }, 'Cron job registered');
}

/**
 * Get status of all registered cron jobs.
 */
export function getCronJobStatus(): CronJobState[] {
  return Array.from(jobStates.values());
}

/**
 * Stop all scheduled cron jobs (for graceful shutdown).
 */
export function stopAllCronJobs(): void {
  for (const task of scheduledTasks) {
    task.stop();
  }
  logger.info({ count: scheduledTasks.length }, 'All cron jobs stopped');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ Built-in cron jobs ============

/**
 * Initialize all internal cron jobs.
 * Call this after the database and services are ready.
 */
export function initCronJobs(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    logger.info('Cron jobs deaktivert i development');
    return;
  }

  // Token cleanup - every 6 hours
  registerCronJob({
    name: 'Token-opprydding',
    schedule: '0 */6 * * *',
    handler: async () => {
      const { cleanupExpiredTokens } = await import('./token-blacklist');
      const cleaned = await cleanupExpiredTokens();
      logger.info({ cleaned }, 'Token-opprydding fullført');
    },
  });

  // Full cleanup - daily at 03:00
  registerCronJob({
    name: 'Daglig opprydding',
    schedule: '0 3 * * *',
    handler: async () => {
      const { getDatabase } = await import('./database');
      const db = await getDatabase();

      // Cleanup failed sync items older than 30 days
      try {
        await db.cleanupOldFailedSyncItems(30);
      } catch {
        // Table might not exist
      }

      // Cleanup audit logs
      try {
        if ('executeRaw' in db) {
          await (db as any).executeRaw('SELECT cleanup_old_audit_logs()');
        }
      } catch {
        // Function might not exist
      }

      logger.info('Daglig opprydding fullført');
    },
  });

  // GDPR deletion processing - daily at 04:00
  registerCronJob({
    name: 'GDPR kontosdeling',
    schedule: '0 4 * * *',
    handler: async () => {
      const { getDatabase } = await import('./database');
      const db = await getDatabase();
      const supabase = 'supabase' in db ? (db as any).supabase : null;
      if (!supabase) return;

      const { data: pending } = await supabase
        .from('account_deletion_requests')
        .select('id, organization_id')
        .eq('status', 'pending')
        .lte('scheduled_deletion_at', new Date().toISOString());

      if (!pending?.length) return;

      let processed = 0;
      for (const deletion of pending) {
        try {
          const { error } = await supabase.rpc('permanently_delete_organization', {
            p_organization_id: deletion.organization_id,
          });
          if (!error) {
            await supabase
              .from('account_deletion_requests')
              .update({ status: 'completed', completed_at: new Date().toISOString() })
              .eq('id', deletion.id);
            processed++;
          }
        } catch (err) {
          logger.error({ organizationId: deletion.organization_id, error: err }, 'Kontosletting feilet');
        }
      }

      logger.info({ processed, total: pending.length }, 'GDPR kontosdeling fullført');
    },
    alertOnFailure: true,
  });

  // Integration sync - every 2 hours
  registerCronJob({
    name: 'Integrasjonssynk',
    schedule: '0 */2 * * *',
    handler: async () => {
      const { getDatabase } = await import('./database');
      const { getIntegrationRegistry } = await import('../integrations/registry');
      const { decryptCredentials, encryptCredentials, isCredentialsExpired } = await import('../integrations/encryption');

      const db = await getDatabase();
      const registry = getIntegrationRegistry();
      const dueIntegrations = await db.getAllDueIntegrations();

      if (dueIntegrations.length === 0) return;

      let synced = 0;
      let failed = 0;

      for (const integration of dueIntegrations) {
        try {
          const adapter = registry.get(integration.integration_id);
          if (!adapter) continue;

          let credentials = await decryptCredentials(integration.credentials_encrypted);
          if (isCredentialsExpired(credentials)) {
            credentials = await adapter.refreshAuth(credentials);
            const encrypted = await encryptCredentials(credentials);
            await db.saveIntegrationCredentials(integration.organization_id, {
              integration_id: integration.integration_id,
              credentials_encrypted: encrypted,
              is_active: true,
            });
          }

          await adapter.syncCustomers(integration.organization_id, credentials, { fullSync: false });
          await db.updateIntegrationLastSync(integration.organization_id, integration.integration_id, new Date());
          synced++;
        } catch (err) {
          failed++;
          logger.error({ integrationId: integration.integration_id, error: err }, 'Integrasjonssynk feilet');

          try {
            await db.logIntegrationSync(integration.organization_id, {
              integration_id: integration.integration_id,
              sync_type: 'scheduled',
              status: 'failed',
              error_message: err instanceof Error ? err.message : 'Unknown error',
              completed_at: new Date(),
            });
          } catch {
            // Non-critical
          }
        }
      }

      logger.info({ synced, failed, total: dueIntegrations.length }, 'Integrasjonssynk fullført');
    },
    maxRetries: 1,
    retryDelayMs: 60_000,
  });

  logger.info('Alle cron-jobber registrert');
}

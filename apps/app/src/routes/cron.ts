/**
 * Cron Routes
 * Endpoints for scheduled maintenance tasks
 * Protected by CRON_SECRET environment variable
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createLogger } from '../services/logger';
import { cleanupExpiredTokens } from '../services/token-blacklist';
import { getDatabase } from '../services/database';
import { timingSafeEqual } from 'crypto';
import { getIntegrationRegistry } from '../integrations/registry';
import { decryptCredentials, encryptCredentials, isCredentialsExpired } from '../integrations/encryption';
import { getWebhookService } from '../services/webhooks';

const router: Router = Router();
const logger = createLogger('cron');

/**
 * Middleware to verify cron secret
 * Protects cron endpoints from unauthorized access
 */
function verifyCronSecret(req: Request, res: Response, next: NextFunction): void {
  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = req.headers['x-cron-secret'] as string || req.query.secret as string;

  if (!cronSecret) {
    logger.warn('CRON_SECRET not configured');
    res.status(500).json({ error: 'Cron not configured' });
    return;
  }

  if (!providedSecret) {
    logger.warn('Missing cron secret in request');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Timing-safe comparison to prevent timing attacks
  const secretBuffer = Buffer.from(cronSecret);
  const providedBuffer = Buffer.from(providedSecret);

  if (secretBuffer.length !== providedBuffer.length || !timingSafeEqual(secretBuffer, providedBuffer)) {
    logger.warn('Invalid cron secret provided');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

/**
 * POST /api/cron/cleanup-tokens
 * Cleans up expired JWT blacklist tokens and password reset tokens
 */
router.post('/cleanup-tokens', verifyCronSecret, async (_req: Request, res: Response) => {
  const startTime = Date.now();
  const results: Record<string, number | string> = {};

  try {
    // Cleanup JWT blacklist
    const jwtCleaned = await cleanupExpiredTokens();
    results.jwt_blacklist_cleaned = jwtCleaned;
    logger.info({ cleaned: jwtCleaned }, 'JWT blacklist cleanup completed');

    // Cleanup password reset tokens
    try {
      const db = await getDatabase();
      if ('deleteExpiredPasswordResetTokens' in db) {
        const passwordTokensCleaned = await (db as any).deleteExpiredPasswordResetTokens();
        results.password_tokens_cleaned = passwordTokensCleaned;
        logger.info({ cleaned: passwordTokensCleaned }, 'Password reset tokens cleanup completed');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup password reset tokens');
      results.password_tokens_error = 'Failed to cleanup';
    }

    // Cleanup old audit logs (via database function)
    try {
      const db = await getDatabase();
      if ('executeRaw' in db) {
        await (db as any).executeRaw('SELECT cleanup_old_audit_logs()');
        results.audit_logs_cleaned = 'completed';
      }
    } catch (error) {
      // Function might not exist yet
      logger.debug({ error }, 'Audit log cleanup skipped (function may not exist)');
    }

    const duration = Date.now() - startTime;
    logger.info({ duration, results }, 'Token cleanup cron completed');

    res.json({
      success: true,
      duration_ms: duration,
      results,
    });
  } catch (error) {
    logger.error({ error }, 'Token cleanup cron failed');
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
    });
  }
});

/**
 * POST /api/cron/cleanup-all
 * Runs all cleanup tasks
 */
router.post('/cleanup-all', verifyCronSecret, async (_req: Request, res: Response) => {
  const startTime = Date.now();
  const results: Record<string, unknown> = {};

  try {
    // 1. Cleanup JWT blacklist
    const jwtCleaned = await cleanupExpiredTokens();
    results.jwt_blacklist = { cleaned: jwtCleaned };

    // 2. Cleanup password reset tokens
    try {
      const db = await getDatabase();
      if ('deleteExpiredPasswordResetTokens' in db) {
        const count = await (db as any).deleteExpiredPasswordResetTokens();
        results.password_tokens = { cleaned: count };
      }
    } catch (error) {
      results.password_tokens = { error: 'Failed' };
    }

    // 3. Cleanup expired tokens via database function
    try {
      const db = await getDatabase();
      if ('executeRaw' in db) {
        await (db as any).executeRaw('SELECT cleanup_expired_tokens()');
        results.db_tokens = { status: 'completed' };
      }
    } catch {
      results.db_tokens = { status: 'skipped' };
    }

    // 4. Cleanup old audit logs
    try {
      const db = await getDatabase();
      if ('executeRaw' in db) {
        await (db as any).executeRaw('SELECT cleanup_old_audit_logs()');
        results.audit_logs = { status: 'completed' };
      }
    } catch {
      results.audit_logs = { status: 'skipped' };
    }

    // 5. Cleanup old resolved/permanently_failed sync items
    try {
      const db = await getDatabase();
      const cleaned = await db.cleanupOldFailedSyncItems(30);
      results.failed_sync_items = { cleaned };
    } catch {
      results.failed_sync_items = { status: 'skipped' };
    }

    const duration = Date.now() - startTime;
    logger.info({ duration, results }, 'Full cleanup cron completed');

    res.json({
      success: true,
      duration_ms: duration,
      results,
    });
  } catch (error) {
    logger.error({ error }, 'Full cleanup cron failed');
    res.status(500).json({
      success: false,
      error: 'Cleanup failed',
    });
  }
});

/**
 * POST /api/cron/process-deletions
 * Process pending account deletions that have passed their grace period
 */
router.post('/process-deletions', verifyCronSecret, async (_req: Request, res: Response) => {
  const startTime = Date.now();
  const results: { processed: number; failed: number; details: unknown[] } = {
    processed: 0,
    failed: 0,
    details: [],
  };

  try {
    const db = await getDatabase();
    const supabase = 'supabase' in db ? (db as any).supabase : null;

    if (!supabase) {
      res.status(500).json({ error: 'Database not configured for deletions' });
      return;
    }

    // Get pending deletions past their scheduled date
    const { data: pendingDeletions, error: fetchError } = await supabase
      .from('account_deletion_requests')
      .select('*, organizations(navn, stripe_customer_id)')
      .eq('status', 'pending')
      .lte('scheduled_deletion_at', new Date().toISOString());

    if (fetchError) {
      logger.error({ error: fetchError }, 'Failed to fetch pending deletions');
      res.status(500).json({ error: 'Failed to fetch pending deletions' });
      return;
    }

    if (!pendingDeletions || pendingDeletions.length === 0) {
      logger.info('No pending deletions to process');
      res.json({ success: true, message: 'No pending deletions', duration_ms: Date.now() - startTime });
      return;
    }

    logger.info({ count: pendingDeletions.length }, 'Processing pending deletions');

    for (const deletion of pendingDeletions) {
      try {
        // Call the permanent delete function
        const { error: deleteError } = await supabase.rpc('permanently_delete_organization', {
          p_organization_id: deletion.organization_id,
        });

        if (deleteError) {
          logger.error(
            { organizationId: deletion.organization_id, error: deleteError },
            'Failed to permanently delete organization'
          );
          results.failed++;
          results.details.push({
            organizationId: deletion.organization_id,
            status: 'failed',
            error: deleteError.message,
          });
          continue;
        }

        // Mark deletion request as completed
        await supabase
          .from('account_deletion_requests')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', deletion.id);

        // Note: Email sending would need to happen before deletion
        // since user data is removed. Consider storing email in deletion request.

        results.processed++;
        results.details.push({
          organizationId: deletion.organization_id,
          organizationName: deletion.organizations?.navn,
          status: 'completed',
        });

        logger.info(
          { organizationId: deletion.organization_id },
          'Organization permanently deleted'
        );
      } catch (error) {
        logger.error(
          { organizationId: deletion.organization_id, error },
          'Exception during deletion'
        );
        results.failed++;
        results.details.push({
          organizationId: deletion.organization_id,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const duration = Date.now() - startTime;
    logger.info({ duration, results }, 'Deletion processing completed');

    res.json({
      success: true,
      duration_ms: duration,
      results,
    });
  } catch (error) {
    logger.error({ error }, 'Deletion processing cron failed');
    res.status(500).json({
      success: false,
      error: 'Processing failed',
    });
  }
});

/**
 * POST /api/cron/sync-integrations
 * Automatically sync all active integrations that are due based on sync_frequency_hours
 */
router.post('/sync-integrations', verifyCronSecret, async (_req: Request, res: Response) => {
  const startTime = Date.now();
  const results: Array<{
    organizationId: number;
    integrationId: string;
    status: 'completed' | 'failed' | 'skipped';
    created?: number;
    updated?: number;
    failed?: number;
    error?: string;
  }> = [];

  try {
    const db = await getDatabase();
    const registry = getIntegrationRegistry();
    const dueIntegrations = await db.getAllDueIntegrations();

    logger.info({ count: dueIntegrations.length }, 'Found integrations due for sync');

    if (dueIntegrations.length === 0) {
      res.json({
        success: true,
        message: 'No integrations due for sync',
        duration_ms: Date.now() - startTime,
        results: [],
      });
      return;
    }

    for (const integration of dueIntegrations) {
      try {
        const adapter = registry.get(integration.integration_id);
        if (!adapter) {
          logger.warn({ integrationId: integration.integration_id }, 'No adapter found, skipping');
          results.push({
            organizationId: integration.organization_id,
            integrationId: integration.integration_id,
            status: 'skipped',
            error: 'Adapter not found',
          });
          continue;
        }

        // Decrypt and refresh credentials if needed
        let credentials = await decryptCredentials(integration.credentials_encrypted);

        if (isCredentialsExpired(credentials)) {
          logger.info(
            { integrationId: integration.integration_id, organizationId: integration.organization_id },
            'Refreshing expired credentials for scheduled sync'
          );
          try {
            credentials = await adapter.refreshAuth(credentials);
            const encrypted = await encryptCredentials(credentials);
            await db.saveIntegrationCredentials(integration.organization_id, {
              integration_id: integration.integration_id,
              credentials_encrypted: encrypted,
              is_active: true,
            });
          } catch (refreshError) {
            logger.error({ error: refreshError, integrationId: integration.integration_id }, 'Credential refresh failed');
            results.push({
              organizationId: integration.organization_id,
              integrationId: integration.integration_id,
              status: 'failed',
              error: 'Credential refresh failed',
            });
            continue;
          }
        }

        // Log sync start
        await db.logIntegrationSync(integration.organization_id, {
          integration_id: integration.integration_id,
          sync_type: 'scheduled',
          status: 'started',
        });

        // Execute sync
        const syncResult = await adapter.syncCustomers(integration.organization_id, credentials, {
          fullSync: false,
        });

        // Update last sync time
        await db.updateIntegrationLastSync(
          integration.organization_id,
          integration.integration_id,
          new Date()
        );

        // Log completion
        await db.logIntegrationSync(integration.organization_id, {
          integration_id: integration.integration_id,
          sync_type: 'scheduled',
          status: 'completed',
          created_count: syncResult.created,
          updated_count: syncResult.updated,
          unchanged_count: syncResult.unchanged,
          failed_count: syncResult.failed,
          completed_at: syncResult.syncedAt,
        });

        // Trigger outgoing webhook
        try {
          const webhookService = await getWebhookService();
          await webhookService.triggerSyncCompleted(integration.organization_id, {
            integration_id: integration.integration_id,
            integration_name: adapter.config.name,
            created: syncResult.created,
            updated: syncResult.updated,
            unchanged: syncResult.unchanged,
            failed: syncResult.failed,
            synced_at: syncResult.syncedAt.toISOString(),
          });
        } catch (webhookError) {
          logger.error({ error: webhookError }, 'Failed to trigger sync.completed webhook');
        }

        results.push({
          organizationId: integration.organization_id,
          integrationId: integration.integration_id,
          status: 'completed',
          created: syncResult.created,
          updated: syncResult.updated,
          failed: syncResult.failed,
        });

        logger.info(
          { integrationId: integration.integration_id, organizationId: integration.organization_id, syncResult },
          'Scheduled sync completed'
        );
      } catch (error) {
        logger.error(
          { error, integrationId: integration.integration_id, organizationId: integration.organization_id },
          'Scheduled sync failed for integration'
        );

        try {
          const db2 = await getDatabase();
          await db2.logIntegrationSync(integration.organization_id, {
            integration_id: integration.integration_id,
            sync_type: 'scheduled',
            status: 'failed',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            completed_at: new Date(),
          });

          const webhookService = await getWebhookService();
          const adapter = registry.get(integration.integration_id);
          await webhookService.triggerSyncFailed(integration.organization_id, {
            integration_id: integration.integration_id,
            integration_name: adapter?.config.name ?? integration.integration_id,
            created: 0,
            updated: 0,
            unchanged: 0,
            failed: 0,
            synced_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : 'Unknown error',
          });
        } catch (logError) {
          logger.error({ error: logError }, 'Failed to log sync failure');
        }

        results.push({
          organizationId: integration.organization_id,
          integrationId: integration.integration_id,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const duration = Date.now() - startTime;
    const completed = results.filter(r => r.status === 'completed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const skipped = results.filter(r => r.status === 'skipped').length;

    logger.info({ duration, completed, failed, skipped, total: dueIntegrations.length }, 'Integration sync cron completed');

    res.json({
      success: true,
      duration_ms: duration,
      summary: { completed, failed, skipped, total: dueIntegrations.length },
      results,
    });
  } catch (error) {
    logger.error({ error }, 'Integration sync cron failed');
    res.status(500).json({
      success: false,
      error: 'Sync cron failed',
    });
  }
});

/**
 * GET /api/cron/health
 * Health check for cron monitoring
 */
router.get('/health', verifyCronSecret, (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

export default router;

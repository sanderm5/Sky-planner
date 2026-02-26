/**
 * Maintenance Routes
 * In-memory toggle for maintenance mode with two levels:
 * - "banner": Users can still work, but see a warning banner
 * - "full": All access blocked with maintenance page
 * Protected by CRON_SECRET environment variable
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createLogger } from '../services/logger';
import { timingSafeEqual, createHash } from 'crypto';

const router: Router = Router();
const logger = createLogger('maintenance');

// In-memory maintenance state (instant toggle, no redeploy needed)
let maintenanceEnabled = false;
let maintenanceMode: 'banner' | 'full' = 'full';
let maintenanceMessage = 'Vi utfører vedlikehold. Prøv igjen om noen minutter.';
let maintenanceStartedAt: string | null = null;

// Exported getters for middleware
export function isMaintenanceEnabled(): boolean {
  return maintenanceEnabled;
}

export function getMaintenanceMode(): 'banner' | 'full' {
  return maintenanceMode;
}

export function getMaintenanceMessage(): string {
  return maintenanceMessage;
}

/**
 * Verify CRON_SECRET (same pattern as cron.ts)
 */
function verifyCronSecret(req: Request, res: Response, next: NextFunction): void {
  const cronSecret = process.env.CRON_SECRET;
  const providedSecret = req.headers['x-cron-secret'] as string;

  if (!cronSecret) {
    logger.warn('CRON_SECRET not configured');
    res.status(500).json({ error: 'Cron not configured' });
    return;
  }

  if (!providedSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const secretHash = createHash('sha256').update(cronSecret).digest();
  const providedHash = createHash('sha256').update(providedSecret).digest();

  if (!timingSafeEqual(secretHash, providedHash)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

/**
 * POST /api/maintenance/toggle
 * Toggle maintenance mode on/off
 * Body: { enabled: boolean, mode?: "banner" | "full", message?: string }
 */
router.post('/toggle', verifyCronSecret, (req: Request, res: Response) => {
  const { enabled, mode, message } = req.body;

  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }

  maintenanceEnabled = enabled;

  if (enabled) {
    if (mode === 'banner' || mode === 'full') {
      maintenanceMode = mode;
    }
    if (typeof message === 'string' && message.trim()) {
      maintenanceMessage = message.trim();
    }
    maintenanceStartedAt = new Date().toISOString();
    logger.info({ mode: maintenanceMode, message: maintenanceMessage }, 'Maintenance mode ENABLED');
  } else {
    maintenanceStartedAt = null;
    logger.info('Maintenance mode DISABLED');
  }

  res.json({
    success: true,
    maintenance: maintenanceEnabled,
    mode: maintenanceEnabled ? maintenanceMode : null,
    message: maintenanceMessage,
    startedAt: maintenanceStartedAt,
  });
});

/**
 * GET /api/maintenance/status
 * Public endpoint — no auth needed
 * Used by: frontend polling, service worker, Next.js middleware
 */
router.get('/status', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    maintenance: maintenanceEnabled,
    mode: maintenanceEnabled ? maintenanceMode : null,
    message: maintenanceEnabled ? maintenanceMessage : '',
    startedAt: maintenanceStartedAt,
  });
});

export default router;

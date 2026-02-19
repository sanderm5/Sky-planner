/**
 * Email routes
 * Email settings, history, and notification management
 */

import { Router, Request, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { getConfig } from '../config/env';
import type { AuthenticatedRequest, EmailInnstilling, EmailVarsel, ApiResponse, Kunde } from '../types';

const router: Router = Router();

// Database service interface (will be injected)
interface EmailDbService {
  getEmailInnstillinger(kundeId: number): Promise<EmailInnstilling | null>;
  updateEmailInnstillinger(kundeId: number, data: Partial<EmailInnstilling>): Promise<void>;
  getEmailHistorikk(organizationId: number, kundeId?: number | null, limit?: number): Promise<EmailVarsel[]>;
  getEmailStats(organizationId: number): Promise<{ pending: number; sent: number; failed: number }>;
  getUpcomingEmails(organizationId: number, daysAhead: number): Promise<(Kunde & { dager_til_kontroll: number })[]>;
  getKundeById(id: number, organizationId: number): Promise<Kunde | null>;
}

// Email service interface (will be injected)
interface EmailServiceInterface {
  isEmailConfigured(): boolean;
  sendTestEmail(epost: string, message: string): Promise<{ success: boolean; error?: string; messageId?: string }>;
  checkAndSendReminders(): Promise<{ checked: number; sent: number; failed: number }>;
  sendEmail(to: string, subject: string, message: string): Promise<{ success: boolean; error?: string; messageId?: string }>;
  generateReminderEmail(kunde: Kunde, daysUntil: number, companyName: string, isOverdue: boolean): { subject: string; message: string };
}

let dbService: EmailDbService;
let emailService: EmailServiceInterface | null = null;

/**
 * Initialize email routes with database and email services
 */
export function initEmailRoutes(
  databaseService: EmailDbService,
  emailSvc?: EmailServiceInterface
): Router {
  dbService = databaseService;
  emailService = emailSvc || null;
  return router;
}

/**
 * GET /api/email/status
 * Get email configuration status
 */
router.get(
  '/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const config = getConfig();
    const emailConfigured = emailService?.isEmailConfigured() ?? false;

    const response: ApiResponse = {
      success: true,
      data: {
        enabled: config.EMAIL_NOTIFICATIONS_ENABLED,
        emailConfigured,
        firstReminderDays: Number.parseInt(process.env.EMAIL_FIRST_REMINDER_DAYS || '30'),
        reminderAfterDays: Number.parseInt(process.env.EMAIL_REMINDER_AFTER_DAYS || '7'),
      },
    };

    res.json(response);
  })
);

/**
 * GET /api/email/stats
 * Get email statistics (pending, sent, failed)
 */
router.get(
  '/stats',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const stats = await dbService.getEmailStats(req.organizationId!);

    const response: ApiResponse = {
      success: true,
      data: stats,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/email/upcoming
 * Get customers with upcoming controls (within first reminder days)
 */
router.get(
  '/upcoming',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const firstReminderDays = Number.parseInt(process.env.EMAIL_FIRST_REMINDER_DAYS || '30');
    const upcoming = await dbService.getUpcomingEmails(req.organizationId!, firstReminderDays);

    const response: ApiResponse = {
      success: true,
      data: upcoming,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/email/historikk
 * Get all email history
 */
router.get(
  '/historikk',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const limit = Number.parseInt(req.query.limit as string) || 100;
    const historikk = await dbService.getEmailHistorikk(req.organizationId!, null, limit);

    const response: ApiResponse<EmailVarsel[]> = {
      success: true,
      data: historikk,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/email/historikk/:kundeId
 * Get email history for specific customer
 */
router.get(
  '/historikk/:kundeId',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    if (Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    const historikk = await dbService.getEmailHistorikk(req.organizationId!, kundeId, 50);

    const response: ApiResponse<EmailVarsel[]> = {
      success: true,
      data: historikk,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/email/innstillinger/:kundeId
 * Get email settings for specific customer
 */
router.get(
  '/innstillinger/:kundeId',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    if (Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    // Verifiser at kunden tilhører denne organisasjonen
    const kunde = await dbService.getKundeById(kundeId, req.organizationId!);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    let settings = await dbService.getEmailInnstillinger(kundeId);

    // Return defaults if no settings exist
    if (!settings) {
      settings = {
        kunde_id: kundeId,
        email_aktiv: true,
        forste_varsel_dager: Number.parseInt(process.env.EMAIL_FIRST_REMINDER_DAYS || '30'),
        paaminnelse_etter_dager: Number.parseInt(process.env.EMAIL_REMINDER_AFTER_DAYS || '7'),
      };
    }

    const response: ApiResponse<EmailInnstilling> = {
      success: true,
      data: settings,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * PUT /api/email/innstillinger/:kundeId
 * Update email settings for specific customer
 */
router.put(
  '/innstillinger/:kundeId',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = Number.parseInt(req.params.kundeId);
    if (Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig kunde-ID');
    }

    const { email_aktiv, forste_varsel_dager, paaminnelse_etter_dager } = req.body;

    await dbService.updateEmailInnstillinger(kundeId, {
      email_aktiv: email_aktiv !== undefined ? Boolean(email_aktiv) : undefined,
      forste_varsel_dager: forste_varsel_dager || 30,
      paaminnelse_etter_dager: paaminnelse_etter_dager || 7,
    });

    logAudit(apiLogger, 'UPDATE', req.user!.userId, 'email_innstillinger', kundeId);

    const response: ApiResponse = {
      success: true,
      data: { message: 'Innstillinger oppdatert' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/email/test
 * Send test email
 */
router.post(
  '/test',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!emailService) {
      throw Errors.badRequest('E-posttjeneste ikke konfigurert');
    }

    const { epost, melding } = req.body;

    if (!epost) {
      throw Errors.badRequest('E-postadresse er påkrevd');
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost)) {
      throw Errors.badRequest('Ugyldig e-postformat');
    }

    const companyName = process.env.COMPANY_NAME || 'El-Kontroll';
    const testMessage = melding || `Test-melding fra ${companyName}.\n\nE-postvarsling fungerer!`;

    const result = await emailService.sendTestEmail(epost, testMessage);

    logAudit(apiLogger, 'SEND_TEST_EMAIL', req.user!.userId, 'email', undefined, { to: epost });

    const response: ApiResponse = {
      success: result.success,
      data: result,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/email/send-varsler
 * Manually trigger email reminder check
 */
router.post(
  '/send-varsler',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!emailService) {
      throw Errors.badRequest('E-posttjeneste ikke konfigurert');
    }

    const result = await emailService.checkAndSendReminders();

    logAudit(apiLogger, 'TRIGGER_REMINDERS', req.user!.userId, 'email', undefined, result);

    const response: ApiResponse = {
      success: true,
      data: result,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/email/send-reminder
 * Send manual reminder to specific customer
 */
router.post(
  '/send-reminder',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!emailService) {
      throw Errors.badRequest('E-posttjeneste ikke konfigurert');
    }

    const { kundeId } = req.body;

    if (!kundeId) {
      throw Errors.badRequest('Kunde-ID er påkrevd');
    }

    const kunde = await dbService.getKundeById(Number.parseInt(kundeId), req.organizationId!);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    if (!kunde.epost) {
      throw Errors.badRequest('Kunden har ingen e-postadresse');
    }

    // Calculate days until control
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextControl = new Date(kunde.neste_el_kontroll || kunde.neste_brann_kontroll || kunde.neste_kontroll || today);
    const daysUntil = Math.ceil((nextControl.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const isOverdue = daysUntil < 0;

    const companyName = process.env.COMPANY_NAME || 'Kontrollsystem';
    const { subject, message } = emailService.generateReminderEmail(kunde, daysUntil, companyName, isOverdue);

    const result = await emailService.sendEmail(kunde.epost, subject, message);

    if (result.success) {
      logAudit(apiLogger, 'SEND_REMINDER', req.user!.userId, 'email', kundeId, {
        to: kunde.epost,
        daysUntil,
      });
    }

    const response: ApiResponse = {
      success: result.success,
      data: result.success
        ? { message: `Påminnelse sendt til ${kunde.epost}` }
        : { error: result.error || 'Kunne ikke sende e-post' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/email/test-reminder
 * Send test reminder email with mock customer data
 */
router.post(
  '/test-reminder',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    if (!emailService) {
      throw Errors.badRequest('E-posttjeneste ikke konfigurert');
    }

    const { epost, kundeNavn, dagerTilKontroll, kategori, adresse, postnummer, poststed, telefon, kundeEpost } = req.body;

    if (!epost || !kundeNavn) {
      throw Errors.badRequest('E-postadresse og kundenavn er påkrevd');
    }

    const companyName = process.env.COMPANY_NAME || 'Kontrollsystem';
    const daysUntil = dagerTilKontroll !== undefined ? Number.parseInt(dagerTilKontroll) : 10;

    const mockCustomer = {
      id: 0,
      navn: kundeNavn,
      adresse: adresse || 'Testveien 123',
      postnummer: postnummer || '9311',
      poststed: poststed || 'Brøstadbotn',
      telefon: telefon || '123 45 678',
      epost: kundeEpost || 'kunde@example.com',
      kategori: kategori || 'El-Kontroll',
      el_kontroll_intervall: 36,
      brann_kontroll_intervall: 12,
      kontroll_intervall_mnd: 12,
    } as Kunde;

    const { subject, message } = emailService.generateReminderEmail(mockCustomer, daysUntil, companyName, false);
    const result = await emailService.sendEmail(epost, subject, message);

    logAudit(apiLogger, 'SEND_TEST_REMINDER', req.user!.userId, 'email', undefined, { to: epost });

    const response: ApiResponse = {
      success: result.success,
      data: {
        success: result.success,
        subject,
        message,
        messageId: result.messageId,
        error: result.error,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/cron/email-varsler
 * Cron endpoint for automated email reminders (Vercel Cron)
 */
router.get(
  '/cron/email-varsler',
  asyncHandler(async (req: Request, res: Response) => {
    // Verify Vercel Cron secret
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      throw Errors.internal('CRON_SECRET not configured');
    }

    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${cronSecret}`) {
      throw Errors.unauthorized();
    }

    if (!emailService) {
      throw Errors.badRequest('E-posttjeneste ikke konfigurert');
    }

    const result = await emailService.checkAndSendReminders();

    const response: ApiResponse = {
      success: true,
      data: {
        ...result,
        timestamp: new Date().toISOString(),
      },
    };

    res.json(response);
  })
);

export default router;

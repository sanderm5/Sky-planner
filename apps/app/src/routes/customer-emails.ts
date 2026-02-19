/**
 * Customer Emails routes
 * Send emails to customers using configurable templates
 * Feature: email_templates
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireTenantAuth } from '../middleware/auth';
import { requireFeature } from '../middleware/features';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, Kunde, ApiResponse } from '../types';

// Inline email sending via Resend API (avoids cross-package import)
async function sendEmailViaResend(
  to: string, subject: string, html: string, fromEmail: string, fromName: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const resendApiKey = process.env.RESEND_API_KEY || '';
  if (!resendApiKey) {
    return { success: false, error: 'E-post er ikke konfigurert (RESEND_API_KEY mangler)' };
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to, subject, html }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { success: false, error: (err as { message?: string }).message || 'Kunne ikke sende e-post' };
    }
    const data = await response.json() as { id: string };
    return { success: true, messageId: data.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Ukjent feil' };
  }
}

// Simple base email wrapper
function wrapInEmailTemplate(bodyHtml: string, orgName: string): string {
  return `<!DOCTYPE html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>body{margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}
a{color:#667eea}</style></head>
<body style="margin:0;padding:0;background:#f4f4f5">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f4f4f5"><tr><td align="center" style="padding:40px 20px">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
<tr><td style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:24px 40px;border-radius:12px 12px 0 0;text-align:center">
<h1 style="margin:0;color:#fff;font-size:24px;font-weight:700">${orgName}</h1></td></tr>
<tr><td style="background:#fff;padding:32px 40px;border-radius:0 0 12px 12px;font-size:15px;line-height:1.6;color:#333">${bodyHtml}</td></tr>
<tr><td style="padding:24px 40px;text-align:center"><p style="margin:0;color:#a1a1aa;font-size:12px">&copy; ${new Date().getFullYear()} ${orgName}</p></td></tr>
</table></td></tr></table></body></html>`;
}

const router: Router = Router();

// HTML-escape to prevent XSS in email content
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Template variable substitution (HTML-escaped for safety)
function substituteVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(variables[key] ?? ''));
}

// Available template variables
const TEMPLATE_VARIABLES = [
  'kunde_navn', 'kunde_adresse', 'kontaktperson', 'kunde_epost', 'kunde_telefon',
  'neste_kontroll', 'siste_kontroll', 'org_navn', 'emne', 'melding',
] as const;

interface CustomerEmailTemplate {
  id: number;
  organization_id: number | null;
  name: string;
  subject_template: string;
  body_template: string;
  category: string;
  is_system: boolean;
  aktiv: boolean;
  sort_order: number;
}

interface CustomerEmailSent {
  id: number;
  organization_id: number;
  kunde_id: number;
  template_id: number | null;
  to_email: string;
  subject: string;
  body_html: string;
  status: string;
  error_message: string | null;
  sent_by: number | null;
  sent_at: string;
}

// Database service interface
interface CustomerEmailDbService {
  getKundeById(id: number, organizationId?: number): Promise<Kunde | null>;
  getOrganizationById(id: number): Promise<{ id: number; navn: string } | null>;
  getEmailTemplates(organizationId: number): Promise<CustomerEmailTemplate[]>;
  getEmailTemplateById(id: number, organizationId: number): Promise<CustomerEmailTemplate | null>;
  createEmailTemplate(data: Omit<CustomerEmailTemplate, 'id'>): Promise<CustomerEmailTemplate>;
  updateEmailTemplate(id: number, data: Partial<CustomerEmailTemplate>, organizationId: number): Promise<CustomerEmailTemplate | null>;
  deleteEmailTemplate(id: number, organizationId: number): Promise<boolean>;
  logSentEmail(data: Omit<CustomerEmailSent, 'id'>): Promise<CustomerEmailSent>;
  getSentEmails(organizationId: number, kundeId?: number, limit?: number): Promise<CustomerEmailSent[]>;
  // Kontaktlogg integration
  createKontaktlogg(data: { kunde_id: number; type: string; notat: string; opprettet_av: string; organization_id: number }): Promise<{ id: number }>;
  // Lifecycle update
  updateKunde(id: number, data: Partial<Kunde>, organizationId?: number): Promise<Kunde | null>;
}

let dbService: CustomerEmailDbService;

/**
 * Initialize customer email routes with database service
 */
export function initCustomerEmailRoutes(databaseService: CustomerEmailDbService): Router {
  dbService = databaseService;
  return router;
}

// All routes require email_templates feature
router.use(requireTenantAuth, requireFeature('email_templates'));

// ========================================
// TEMPLATE CRUD
// ========================================

/**
 * GET /api/customer-emails/templates
 * Get all templates (system + org-specific)
 */
router.get(
  '/templates',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const templates = await dbService.getEmailTemplates(req.organizationId!);

    const response: ApiResponse<CustomerEmailTemplate[]> = {
      success: true,
      data: templates,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/customer-emails/templates
 * Create a new template for this organization
 */
router.post(
  '/templates',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { name, subject_template, body_template, category } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      throw Errors.badRequest('Navn er påkrevd (minimum 2 tegn)');
    }
    if (!subject_template || typeof subject_template !== 'string') {
      throw Errors.badRequest('Emne-mal er påkrevd');
    }
    if (!body_template || typeof body_template !== 'string') {
      throw Errors.badRequest('Innholds-mal er påkrevd');
    }

    const validCategories = ['forespørsel', 'bekreftelse', 'påminnelse', 'generell'];
    const cat = category || 'generell';
    if (!validCategories.includes(cat)) {
      throw Errors.badRequest(`Kategori må være en av: ${validCategories.join(', ')}`);
    }

    const template = await dbService.createEmailTemplate({
      organization_id: req.organizationId!,
      name: name.trim(),
      subject_template,
      body_template,
      category: cat,
      is_system: false,
      aktiv: true,
      sort_order: 100,
    });

    logAudit(apiLogger, 'CREATE', req.user!.userId, 'customer_email_template', template.id, {
      name: template.name,
    });

    const response: ApiResponse<CustomerEmailTemplate> = {
      success: true,
      data: template,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/customer-emails/templates/:id
 * Update a template (only org-owned, not system templates)
 */
router.put(
  '/templates/:id',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig mal-ID');
    }

    const existing = await dbService.getEmailTemplateById(id, req.organizationId!);
    if (!existing) {
      throw Errors.notFound('E-postmal');
    }

    if (existing.is_system) {
      throw Errors.badRequest('Systemmaler kan ikke endres');
    }

    const { name, subject_template, body_template, category, aktiv } = req.body;
    const updated = await dbService.updateEmailTemplate(id, {
      name, subject_template, body_template, category, aktiv,
    }, req.organizationId!);

    if (!updated) {
      throw Errors.notFound('E-postmal');
    }

    logAudit(apiLogger, 'UPDATE', req.user!.userId, 'customer_email_template', id);

    const response: ApiResponse<CustomerEmailTemplate> = {
      success: true,
      data: updated,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/customer-emails/templates/:id
 * Delete a template (only org-owned, not system templates)
 */
router.delete(
  '/templates/:id',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const id = Number.parseInt(req.params.id);
    if (Number.isNaN(id)) {
      throw Errors.badRequest('Ugyldig mal-ID');
    }

    const existing = await dbService.getEmailTemplateById(id, req.organizationId!);
    if (!existing) {
      throw Errors.notFound('E-postmal');
    }

    if (existing.is_system) {
      throw Errors.badRequest('Systemmaler kan ikke slettes');
    }

    await dbService.deleteEmailTemplate(id, req.organizationId!);

    logAudit(apiLogger, 'DELETE', req.user!.userId, 'customer_email_template', id);

    const response: ApiResponse = {
      success: true,
      data: { message: 'E-postmal slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ========================================
// SEND EMAIL
// ========================================

/**
 * POST /api/customer-emails/preview
 * Preview an email with variable substitution (without sending)
 */
router.post(
  '/preview',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { template_id, kunde_id, custom_variables } = req.body;

    if (!template_id || !kunde_id) {
      throw Errors.badRequest('template_id og kunde_id er påkrevd');
    }

    const template = await dbService.getEmailTemplateById(template_id, req.organizationId!);
    if (!template) {
      throw Errors.notFound('E-postmal');
    }

    const kunde = await dbService.getKundeById(kunde_id, req.organizationId);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    const org = await dbService.getOrganizationById(req.organizationId!);

    // Auto-populated values override custom_variables to prevent injection
    const variables: Record<string, string> = {
      ...custom_variables,
      kunde_navn: kunde.navn || '',
      kunde_adresse: [kunde.adresse, kunde.postnummer, kunde.poststed].filter(Boolean).join(', '),
      kontaktperson: kunde.kontaktperson || kunde.navn || '',
      kunde_epost: kunde.epost || '',
      kunde_telefon: kunde.telefon || '',
      neste_kontroll: kunde.neste_kontroll || kunde.neste_el_kontroll || '',
      siste_kontroll: kunde.siste_kontroll || kunde.siste_el_kontroll || '',
      org_navn: org?.navn || '',
    };

    const subject = substituteVariables(template.subject_template, variables);
    const bodyContent = substituteVariables(template.body_template, variables);
    const html = wrapInEmailTemplate(bodyContent, org?.navn || 'Sky Planner');

    const response: ApiResponse = {
      success: true,
      data: { subject, html, variables },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/customer-emails/send
 * Send an email to a customer using a template
 */
router.post(
  '/send',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { template_id, kunde_id, custom_variables } = req.body;

    if (!template_id || !kunde_id) {
      throw Errors.badRequest('template_id og kunde_id er påkrevd');
    }

    const template = await dbService.getEmailTemplateById(template_id, req.organizationId!);
    if (!template) {
      throw Errors.notFound('E-postmal');
    }

    const kunde = await dbService.getKundeById(kunde_id, req.organizationId);
    if (!kunde) {
      throw Errors.notFound('Kunde');
    }

    if (!kunde.epost) {
      throw Errors.badRequest('Kunden har ingen e-postadresse');
    }

    const org = await dbService.getOrganizationById(req.organizationId!);

    // Build variables - auto-populated values override custom_variables to prevent injection
    const variables: Record<string, string> = {
      ...custom_variables,
      kunde_navn: kunde.navn || '',
      kunde_adresse: [kunde.adresse, kunde.postnummer, kunde.poststed].filter(Boolean).join(', '),
      kontaktperson: kunde.kontaktperson || kunde.navn || '',
      kunde_epost: kunde.epost || '',
      kunde_telefon: kunde.telefon || '',
      neste_kontroll: kunde.neste_kontroll || kunde.neste_el_kontroll || '',
      siste_kontroll: kunde.siste_kontroll || kunde.siste_el_kontroll || '',
      org_navn: org?.navn || '',
    };

    const subject = substituteVariables(template.subject_template, variables);
    const bodyContent = substituteVariables(template.body_template, variables);
    const html = wrapInEmailTemplate(bodyContent, org?.navn || 'Sky Planner');

    // Send via Resend
    const fromEmail = process.env.EMAIL_FROM || 'noreply@skyplanner.no';
    const fromName = org?.navn || 'Sky Planner';

    const result = await sendEmailViaResend(kunde.epost, subject, html, fromEmail, fromName);

    // Log to customer_emails_sent
    const sentRecord = await dbService.logSentEmail({
      organization_id: req.organizationId!,
      kunde_id: kunde.id,
      template_id: template.id,
      to_email: kunde.epost,
      subject,
      body_html: html,
      status: result.success ? 'sent' : 'failed',
      error_message: result.error || null,
      sent_by: req.user!.userId,
      sent_at: new Date().toISOString(),
    });

    // Log to kontaktlogg
    if (result.success) {
      await dbService.createKontaktlogg({
        kunde_id: kunde.id,
        type: 'E-post',
        notat: `E-post sendt: "${subject}" (mal: ${template.name})`,
        opprettet_av: req.user?.epost || '',
        organization_id: req.organizationId!,
      });

      // Update lifecycle stage if inquiry template
      if (template.category === 'forespørsel') {
        await dbService.updateKunde(kunde.id, {
          lifecycle_stage: 'forespørsel_sendt',
          inquiry_sent_date: new Date().toISOString().split('T')[0],
        }, req.organizationId);
      }
    }

    logAudit(apiLogger, 'SEND_EMAIL', req.user!.userId, 'customer_email', sentRecord.id, {
      kunde_id: kunde.id,
      template_id: template.id,
      status: result.success ? 'sent' : 'failed',
    });

    if (!result.success) {
      apiLogger.error({ error: result.error, kundeId: kunde.id, templateId: template.id }, 'Failed to send customer email');
      throw Errors.internal('Kunne ikke sende e-post. Prøv igjen senere.');
    }

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'E-post sendt',
        messageId: result.messageId,
        sentRecord,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ========================================
// EMAIL HISTORY
// ========================================

/**
 * GET /api/customer-emails/history
 * Get sent email history for organization
 */
router.get(
  '/history',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const kundeId = req.query.kunde_id ? Number.parseInt(req.query.kunde_id as string) : undefined;
    const limit = req.query.limit ? Number.parseInt(req.query.limit as string) : 50;

    const emails = await dbService.getSentEmails(req.organizationId!, kundeId, limit);

    const response: ApiResponse<CustomerEmailSent[]> = {
      success: true,
      data: emails,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/customer-emails/variables
 * Get available template variables
 */
router.get(
  '/variables',
  asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const variables = TEMPLATE_VARIABLES.map(v => ({
      key: v,
      placeholder: `{{${v}}}`,
      description: getVariableDescription(v),
    }));

    const response: ApiResponse = {
      success: true,
      data: variables,
    };

    res.json(response);
  })
);

function getVariableDescription(key: string): string {
  const descriptions: Record<string, string> = {
    kunde_navn: 'Kundens navn',
    kunde_adresse: 'Kundens fulle adresse',
    kontaktperson: 'Kontaktpersonens navn',
    kunde_epost: 'Kundens e-postadresse',
    kunde_telefon: 'Kundens telefonnummer',
    neste_kontroll: 'Dato for neste kontroll',
    siste_kontroll: 'Dato for siste kontroll',
    org_navn: 'Organisasjonens navn',
    emne: 'Egendefinert emne (for generell mal)',
    melding: 'Egendefinert melding (for generell mal)',
  };
  return descriptions[key] || key;
}

export default router;

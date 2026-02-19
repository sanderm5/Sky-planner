/**
 * Super Admin routes
 * Allows Efffekt staff to access and manage all organizations' data
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
import { requireSuperAdmin } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { getDatabase } from '../services/database';
import { validateKunde } from '../utils/validation';
import { geocodeCustomerData } from '../services/geocoding';
import { getCookieConfig, buildSetCookieHeader } from '@skyplanner/auth';
import { getConfig } from '../config/env';
import type { AuthenticatedRequest, ApiResponse, Kunde, CreateKundeRequest } from '../types';

const router: Router = Router();

// All routes require super admin access
router.use(requireSuperAdmin);

// ========================================
// ORGANIZATIONS
// ========================================

/**
 * GET /api/super-admin/organizations
 * List all organizations with stats
 */
router.get(
  '/organizations',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const db = await getDatabase();
    const page = Math.max(Number.parseInt(req.query.page as string, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit as string, 10) || 50, 1), 200);
    const offset = (page - 1) * limit;

    // Get all organizations with customer and user counts
    const organizations = await db.getAllOrganizations();
    const total = organizations.length;

    // Paginate before enriching to avoid N+1 on all orgs
    const paginatedOrgs = organizations.slice(offset, offset + limit);

    // Enrich with stats
    const enrichedOrgs = await Promise.all(
      paginatedOrgs.map(async (org) => {
        const kundeCount = await db.getKundeCountForOrganization(org.id);
        const brukerCount = await db.getBrukerCountForOrganization(org.id);

        return {
          ...org,
          stats: {
            kundeCount,
            brukerCount,
            maxKunder: org.max_kunder || 100,
            maxBrukere: org.max_brukere || 5,
          },
        };
      })
    );

    const response: ApiResponse = {
      success: true,
      data: {
        organizations: enrichedOrgs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/super-admin/organizations/:id
 * Get single organization details
 */
router.get(
  '/organizations/:id',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    if (Number.isNaN(orgId)) {
      throw Errors.badRequest('Ugyldig organisasjons-ID');
    }

    const db = await getDatabase();
    const org = await db.getOrganizationById(orgId);

    if (!org) {
      throw Errors.notFound('Organisasjon');
    }

    // Get stats
    const kundeCount = await db.getKundeCountForOrganization(orgId);
    const brukerCount = await db.getBrukerCountForOrganization(orgId);

    const response: ApiResponse = {
      success: true,
      data: {
        ...org,
        stats: {
          kundeCount,
          brukerCount,
          maxKunder: org.max_kunder || 100,
          maxBrukere: org.max_brukere || 5,
        },
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * PUT /api/super-admin/organizations/:id
 * Update organization settings
 */
router.put(
  '/organizations/:id',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    if (Number.isNaN(orgId)) {
      throw Errors.badRequest('Ugyldig organisasjons-ID');
    }

    const db = await getDatabase();

    // Verify org exists
    const existingOrg = await db.getOrganizationById(orgId);
    if (!existingOrg) {
      throw Errors.notFound('Organisasjon');
    }

    // Update allowed fields
    const allowedFields = [
      'navn',
      'plan_type',
      'max_kunder',
      'max_brukere',
      'subscription_status',
    ];

    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      throw Errors.badRequest('Ingen gyldige felt å oppdatere');
    }

    const updatedOrg = await db.updateOrganization(orgId, updateData);

    logAudit(apiLogger, 'SUPER_ADMIN_UPDATE_ORG', req.user!.userId, 'organization', orgId, {
      fields: Object.keys(updateData),
    });

    const response: ApiResponse = {
      success: true,
      data: updatedOrg,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/super-admin/organizations/:id
 * Delete an organization and all related data
 */
router.delete(
  '/organizations/:id',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    if (Number.isNaN(orgId)) {
      throw Errors.badRequest('Ugyldig organisasjons-ID');
    }

    const db = await getDatabase();

    // Verify org exists
    const existingOrg = await db.getOrganizationById(orgId);
    if (!existingOrg) {
      throw Errors.notFound('Organisasjon');
    }

    // Get counts before deletion for audit
    const kundeCount = await db.getKundeCountForOrganization(orgId);
    const brukerCount = await db.getBrukerCountForOrganization(orgId);

    // Delete the organization and all related data
    await db.deleteOrganization(orgId);

    logAudit(apiLogger, 'SUPER_ADMIN_DELETE_ORG', req.user!.userId, 'organization', orgId, {
      organizationName: existingOrg.navn,
      organizationSlug: existingOrg.slug,
      kundeCount,
      brukerCount,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Organisasjon slettet',
        organizationId: orgId,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ========================================
// CUSTOMERS (KUNDER) FOR ORGANIZATION
// ========================================

/**
 * GET /api/super-admin/organizations/:id/kunder
 * Get all customers for an organization
 */
router.get(
  '/organizations/:id/kunder',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    if (Number.isNaN(orgId)) {
      throw Errors.badRequest('Ugyldig organisasjons-ID');
    }

    const db = await getDatabase();

    // Verify org exists
    const org = await db.getOrganizationById(orgId);
    if (!org) {
      throw Errors.notFound('Organisasjon');
    }

    // Get pagination params
    const limit = Math.min(Number.parseInt(req.query.limit as string) || 100, 500);
    const offset = Number.parseInt(req.query.offset as string) || 0;
    const search = req.query.search as string | undefined;

    const result = await db.getAllKunderPaginated(orgId, { limit, offset, search });

    const response: ApiResponse = {
      success: true,
      data: result,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/super-admin/organizations/:id/kunder
 * Create a customer for an organization
 */
router.post(
  '/organizations/:id/kunder',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    if (Number.isNaN(orgId)) {
      throw Errors.badRequest('Ugyldig organisasjons-ID');
    }

    const db = await getDatabase();

    // Verify org exists
    const org = await db.getOrganizationById(orgId);
    if (!org) {
      throw Errors.notFound('Organisasjon');
    }

    // Validate input
    const validationErrors = validateKunde(req.body);
    if (validationErrors) {
      throw Errors.validationError(validationErrors);
    }

    // Prepare kunde data
    const kundeData: CreateKundeRequest & { organization_id: number } = {
      ...req.body,
      organization_id: orgId,
      kategori: req.body.kategori || 'El-Kontroll',
    };

    // Geocode address
    const geocodedData = await geocodeCustomerData(kundeData);

    const kunde = await db.createKunde(geocodedData);

    logAudit(apiLogger, 'SUPER_ADMIN_CREATE_KUNDE', req.user!.userId, 'kunde', kunde.id, {
      organizationId: orgId,
      navn: kunde.navn,
    });

    const response: ApiResponse<Kunde> = {
      success: true,
      data: kunde,
      requestId: req.requestId,
    };

    res.status(201).json(response);
  })
);

/**
 * PUT /api/super-admin/organizations/:id/kunder/:kundeId
 * Update a customer
 */
router.put(
  '/organizations/:id/kunder/:kundeId',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    const kundeId = Number.parseInt(req.params.kundeId);

    if (Number.isNaN(orgId) || Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig ID');
    }

    const db = await getDatabase();

    // Verify org exists
    const org = await db.getOrganizationById(orgId);
    if (!org) {
      throw Errors.notFound('Organisasjon');
    }

    // Verify kunde exists and belongs to org
    const existingKunde = await db.getKundeById(kundeId, orgId);
    if (!existingKunde) {
      throw Errors.notFound('Kunde');
    }

    // Validate input
    const validationErrors = validateKunde(req.body);
    if (validationErrors) {
      throw Errors.validationError(validationErrors);
    }

    const kunde = await db.updateKunde(kundeId, req.body, orgId);

    logAudit(apiLogger, 'SUPER_ADMIN_UPDATE_KUNDE', req.user!.userId, 'kunde', kundeId, {
      organizationId: orgId,
      fields: Object.keys(req.body),
    });

    const response: ApiResponse<Kunde> = {
      success: true,
      data: kunde!,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * DELETE /api/super-admin/organizations/:id/kunder/:kundeId
 * Delete a customer
 */
router.delete(
  '/organizations/:id/kunder/:kundeId',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    const kundeId = Number.parseInt(req.params.kundeId);

    if (Number.isNaN(orgId) || Number.isNaN(kundeId)) {
      throw Errors.badRequest('Ugyldig ID');
    }

    const db = await getDatabase();

    // Verify kunde exists and belongs to org
    const existingKunde = await db.getKundeById(kundeId, orgId);
    if (!existingKunde) {
      throw Errors.notFound('Kunde');
    }

    await db.deleteKunde(kundeId, orgId);

    logAudit(apiLogger, 'SUPER_ADMIN_DELETE_KUNDE', req.user!.userId, 'kunde', kundeId, {
      organizationId: orgId,
      navn: existingKunde.navn,
    });

    const response: ApiResponse = {
      success: true,
      data: { message: 'Kunde slettet' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ========================================
// USERS (BRUKERE/KLIENTER) FOR ORGANIZATION
// ========================================

/**
 * GET /api/super-admin/organizations/:id/brukere
 * Get all users (klienter) for an organization
 */
router.get(
  '/organizations/:id/brukere',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    if (Number.isNaN(orgId)) {
      throw Errors.badRequest('Ugyldig organisasjons-ID');
    }

    const db = await getDatabase();

    // Verify org exists
    const org = await db.getOrganizationById(orgId);
    if (!org) {
      throw Errors.notFound('Organisasjon');
    }

    const users = await db.getKlienterForOrganization(orgId);

    // Remove sensitive data
    const sanitizedUsers = users.map((user) => ({
      id: user.id,
      navn: user.navn,
      epost: user.epost,
      telefon: user.telefon,
      rolle: user.rolle,
      aktiv: user.aktiv,
      sist_innlogget: user.sist_innlogget,
      opprettet: user.opprettet,
    }));

    const response: ApiResponse = {
      success: true,
      data: sanitizedUsers,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * PUT /api/super-admin/organizations/:id/brukere/:brukerId
 * Update a user (klient) - role, active status, etc.
 */
router.put(
  '/organizations/:id/brukere/:brukerId',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    const brukerId = Number.parseInt(req.params.brukerId);

    if (Number.isNaN(orgId) || Number.isNaN(brukerId)) {
      throw Errors.badRequest('Ugyldig ID');
    }

    const db = await getDatabase();

    // Verify org exists
    const org = await db.getOrganizationById(orgId);
    if (!org) {
      throw Errors.notFound('Organisasjon');
    }

    // Verify user exists and belongs to org
    const existingUser = await db.getKlientById(brukerId);
    if (!existingUser || existingUser.organization_id !== orgId) {
      throw Errors.notFound('Bruker');
    }

    // Only allow updating specific fields
    const allowedFields = ['navn', 'epost', 'telefon', 'rolle', 'aktiv'];
    const updateData: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      throw Errors.badRequest('Ingen gyldige felt å oppdatere');
    }

    const updatedUser = await db.updateKlient(brukerId, updateData);

    logAudit(apiLogger, 'SUPER_ADMIN_UPDATE_USER', req.user!.userId, 'klient', brukerId, {
      organizationId: orgId,
      fields: Object.keys(updateData),
    });

    const response: ApiResponse = {
      success: true,
      data: {
        id: updatedUser?.id,
        navn: updatedUser?.navn,
        epost: updatedUser?.epost,
        telefon: updatedUser?.telefon,
        rolle: updatedUser?.rolle,
        aktiv: updatedUser?.aktiv,
        sist_innlogget: updatedUser?.sist_innlogget,
        opprettet: updatedUser?.opprettet,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/super-admin/organizations/:id/brukere/:brukerId/reset-password
 * Send password reset email to a user
 */
router.post(
  '/organizations/:id/brukere/:brukerId/reset-password',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    const brukerId = Number.parseInt(req.params.brukerId);

    if (Number.isNaN(orgId) || Number.isNaN(brukerId)) {
      throw Errors.badRequest('Ugyldig ID');
    }

    const db = await getDatabase();

    // Verify org exists
    const org = await db.getOrganizationById(orgId);
    if (!org) {
      throw Errors.notFound('Organisasjon');
    }

    // Verify user exists and belongs to org
    const user = await db.getKlientById(brukerId);
    if (!user || user.organization_id !== orgId) {
      throw Errors.notFound('Bruker');
    }

    // Generate reset token
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

    // Store token in database
    await db.createPasswordResetToken({
      user_id: brukerId,
      user_type: 'klient',
      token_hash: tokenHash,
      epost: user.epost,
      expires_at: expiresAt,
    });

    // Log reset URL (email service not implemented yet)
    const resetUrl = `${process.env.PUBLIC_WEB_URL || 'https://skyplanner.no'}/auth/tilbakestill-passord?token=${token}`;
    apiLogger.info({ userId: brukerId, epost: user.epost, resetUrl }, 'Password reset token created');

    logAudit(apiLogger, 'SUPER_ADMIN_RESET_PASSWORD', req.user!.userId, 'klient', brukerId, {
      organizationId: orgId,
      epost: user.epost,
    });

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'E-post med tilbakestillingslenke er sendt',
        epost: user.epost,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/super-admin/organizations/:id/login-history
 * Get login history for an organization
 */
router.get(
  '/organizations/:id/login-history',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    if (Number.isNaN(orgId)) {
      throw Errors.badRequest('Ugyldig organisasjons-ID');
    }

    const db = await getDatabase();

    // Verify org exists
    const org = await db.getOrganizationById(orgId);
    if (!org) {
      throw Errors.notFound('Organisasjon');
    }

    const limit = Math.min(Number.parseInt(req.query.limit as string) || 50, 200);
    const offset = Number.parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string | undefined;
    const epost = req.query.epost as string | undefined;

    const result = await db.getLoginHistoryForOrganization(orgId, {
      limit,
      offset,
      status,
      epost,
    });

    const response: ApiResponse = {
      success: true,
      data: result,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ========================================
// GLOBAL STATISTICS
// ========================================

/**
 * GET /api/super-admin/statistics
 * Get global statistics across all organizations
 */
router.get(
  '/statistics',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const db = await getDatabase();

    const stats = await db.getGlobalStatistics();

    const response: ApiResponse = {
      success: true,
      data: stats,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/super-admin/statistics/growth
 * Get growth statistics over time (organizations, customers, users per month)
 */
router.get(
  '/statistics/growth',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const db = await getDatabase();
    const months = Math.min(Number.parseInt(req.query.months as string) || 12, 24);

    const growthStats = await db.getGrowthStatistics(months);

    const response: ApiResponse = {
      success: true,
      data: growthStats,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/super-admin/statistics/activity
 * Get activity statistics (logins, active users)
 */
router.get(
  '/statistics/activity',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const db = await getDatabase();
    const days = Math.min(Number.parseInt(req.query.days as string) || 30, 90);

    const activityStats = await db.getActivityStatistics(days);

    const response: ApiResponse = {
      success: true,
      data: activityStats,
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ========================================
// IMPERSONATION
// ========================================

/**
 * POST /api/super-admin/impersonate/:orgId
 * Generate a token to impersonate an organization
 */
router.post(
  '/impersonate/:orgId',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.orgId);
    if (Number.isNaN(orgId)) {
      throw Errors.badRequest('Ugyldig organisasjons-ID');
    }

    const db = await getDatabase();
    const org = await db.getOrganizationById(orgId);

    if (!org) {
      throw Errors.notFound('Organisasjon');
    }

    // Import generateToken from auth middleware
    const { generateToken } = await import('../middleware/auth');

    // Generate impersonation token with shorter expiry
    const impersonationToken = generateToken(
      {
        userId: req.user!.userId,
        epost: req.user!.epost,
        organizationId: orgId,
        organizationSlug: org.slug,
        type: 'bruker',
        subscriptionStatus: org.subscription_status as 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete',
        subscriptionPlan: org.plan_type as 'free' | 'standard' | 'premium' | 'enterprise',
        isImpersonating: true,
        originalUserId: req.user!.userId,
      },
      '4h' // Shorter duration for security
    );

    logAudit(apiLogger, 'SUPER_ADMIN_IMPERSONATE', req.user!.userId, 'organization', orgId, {
      organizationName: org.navn,
      organizationSlug: org.slug,
    });

    // Set httpOnly auth cookie with impersonation token
    const isProduction = getConfig().NODE_ENV === 'production';
    const cookieConfig = getCookieConfig(isProduction);
    const cookieHeader = buildSetCookieHeader(impersonationToken, cookieConfig.options);
    res.setHeader('Set-Cookie', cookieHeader);

    const response: ApiResponse = {
      success: true,
      data: {
        token: impersonationToken,
        organization: {
          id: org.id,
          navn: org.navn,
          slug: org.slug,
          logoUrl: org.logo_url,
          primaryColor: org.primary_color,
        },
        redirectUrl: '/',
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/super-admin/stop-impersonation
 * Stop impersonating and return to admin mode
 */
router.post(
  '/stop-impersonation',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { generateToken } = await import('../middleware/auth');

    // Generate a fresh admin token without organization context
    const adminToken = generateToken(
      {
        userId: req.user!.userId,
        epost: req.user!.epost,
        type: 'bruker',
      },
      '24h'
    );

    logAudit(apiLogger, 'SUPER_ADMIN_STOP_IMPERSONATE', req.user!.userId, 'user', req.user!.userId);

    // Set httpOnly auth cookie with admin token
    const isProduction = getConfig().NODE_ENV === 'production';
    const cookieConfig = getCookieConfig(isProduction);
    const cookieHeader = buildSetCookieHeader(adminToken, cookieConfig.options);
    res.setHeader('Set-Cookie', cookieHeader);

    const response: ApiResponse = {
      success: true,
      data: {
        token: adminToken,
        redirectUrl: '/admin',
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ========================================
// BILLING / STRIPE
// ========================================

// Initialize Stripe lazily
let stripeClient: import('stripe').default | null = null;

async function getStripe() {
  if (!stripeClient) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw Errors.internal('Stripe ikke konfigurert');
    }
    const Stripe = (await import('stripe')).default;
    stripeClient = new Stripe(stripeKey);
  }
  return stripeClient;
}

/**
 * GET /api/super-admin/organizations/:id/billing
 * Get billing/subscription info for an organization
 */
router.get(
  '/organizations/:id/billing',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    if (Number.isNaN(orgId)) {
      throw Errors.badRequest('Ugyldig organisasjons-ID');
    }

    const db = await getDatabase();
    const org = await db.getOrganizationById(orgId);

    if (!org) {
      throw Errors.notFound('Organisasjon');
    }

    // If no Stripe customer, return basic info
    if (!org.stripe_customer_id) {
      const response: ApiResponse = {
        success: true,
        data: {
          hasStripe: false,
          plan_type: org.plan_type || 'free',
          subscription_status: org.subscription_status || 'inactive',
          trial_ends_at: org.trial_ends_at,
          current_period_end: org.current_period_end,
        },
        requestId: req.requestId,
      };
      res.json(response);
      return;
    }

    try {
      const stripe = await getStripe();

      // Get customer info
      const customer = await stripe.customers.retrieve(org.stripe_customer_id);

      // Get active subscriptions
      const subscriptions = await stripe.subscriptions.list({
        customer: org.stripe_customer_id,
        limit: 1,
      });

      const subscription = subscriptions.data[0];

      const response: ApiResponse = {
        success: true,
        data: {
          hasStripe: true,
          customer: {
            id: customer.id,
            email: (customer as import('stripe').Stripe.Customer).email,
            name: (customer as import('stripe').Stripe.Customer).name,
            created: (customer as import('stripe').Stripe.Customer).created,
          },
          subscription: subscription ? {
            id: subscription.id,
            status: subscription.status,
            plan: subscription.items.data[0]?.price?.nickname || org.plan_type,
            amount: subscription.items.data[0]?.price?.unit_amount,
            currency: subscription.items.data[0]?.price?.currency,
            interval: subscription.items.data[0]?.price?.recurring?.interval,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
            cancel_at_period_end: subscription.cancel_at_period_end,
          } : null,
          plan_type: org.plan_type || 'free',
          subscription_status: org.subscription_status || 'inactive',
        },
        requestId: req.requestId,
      };

      res.json(response);
    } catch (error) {
      apiLogger.error({ error, orgId }, 'Failed to fetch Stripe data');
      // Return basic info if Stripe fails
      const response: ApiResponse = {
        success: true,
        data: {
          hasStripe: true,
          stripeError: true,
          plan_type: org.plan_type || 'free',
          subscription_status: org.subscription_status || 'inactive',
          trial_ends_at: org.trial_ends_at,
          current_period_end: org.current_period_end,
        },
        requestId: req.requestId,
      };
      res.json(response);
    }
  })
);

/**
 * GET /api/super-admin/organizations/:id/invoices
 * Get invoice history for an organization
 */
router.get(
  '/organizations/:id/invoices',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = Number.parseInt(req.params.id);
    if (Number.isNaN(orgId)) {
      throw Errors.badRequest('Ugyldig organisasjons-ID');
    }

    const db = await getDatabase();
    const org = await db.getOrganizationById(orgId);

    if (!org) {
      throw Errors.notFound('Organisasjon');
    }

    if (!org.stripe_customer_id) {
      const response: ApiResponse = {
        success: true,
        data: { invoices: [], hasStripe: false },
        requestId: req.requestId,
      };
      res.json(response);
      return;
    }

    try {
      const stripe = await getStripe();
      const limit = Math.min(Number.parseInt(req.query.limit as string) || 10, 50);

      const invoices = await stripe.invoices.list({
        customer: org.stripe_customer_id,
        limit,
      });

      const formattedInvoices = invoices.data.map(inv => ({
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amount: inv.amount_paid || inv.amount_due,
        currency: inv.currency,
        created: new Date(inv.created * 1000).toISOString(),
        period_start: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
        period_end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
        hosted_invoice_url: inv.hosted_invoice_url,
        invoice_pdf: inv.invoice_pdf,
      }));

      const response: ApiResponse = {
        success: true,
        data: { invoices: formattedInvoices, hasStripe: true },
        requestId: req.requestId,
      };

      res.json(response);
    } catch (error) {
      apiLogger.error({ error, orgId }, 'Failed to fetch invoices');
      throw Errors.internal('Kunne ikke hente fakturaer');
    }
  })
);

/**
 * GET /api/super-admin/billing/overview
 * Get global billing overview (MRR, plan distribution, etc.)
 */
router.get(
  '/billing/overview',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const db = await getDatabase();

    // Calculate MRR from organization data
    const organizations = await db.getAllOrganizations();

    // Plan prices (approximate - should match Stripe)
    const planPrices: Record<string, number> = {
      free: 0,
      standard: 499,
      premium: 999,
      enterprise: 2499,
    };

    let mrr = 0;
    const planCounts: Record<string, number> = { free: 0, standard: 0, premium: 0, enterprise: 0 };
    let activeCount = 0;
    let trialingCount = 0;
    let canceledCount = 0;

    for (const org of organizations) {
      const plan = org.plan_type || 'free';
      planCounts[plan] = (planCounts[plan] || 0) + 1;

      if (org.subscription_status === 'active') {
        mrr += planPrices[plan] || 0;
        activeCount++;
      } else if (org.subscription_status === 'trialing') {
        trialingCount++;
      } else if (org.subscription_status === 'canceled') {
        canceledCount++;
      }
    }

    const response: ApiResponse = {
      success: true,
      data: {
        mrr,
        mrrFormatted: `${mrr.toLocaleString('nb-NO')} kr`,
        planCounts,
        statusCounts: {
          active: activeCount,
          trialing: trialingCount,
          canceled: canceledCount,
          total: organizations.length,
        },
        churnRate: organizations.length > 0
          ? Math.round((canceledCount / organizations.length) * 100)
          : 0,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

// ========================================
// SENTRY OVERVÅKING
// ========================================

/**
 * GET /api/super-admin/sentry/status
 * Check if Sentry API is configured
 */
router.get(
  '/sentry/status',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { isSentryApiConfigured } = await import('../services/sentry-api');

    const response: ApiResponse = {
      success: true,
      data: { configured: isSentryApiConfigured() },
      requestId: req.requestId,
    };
    res.json(response);
  })
);

/**
 * GET /api/super-admin/sentry/overview
 * Get aggregated monitoring overview
 */
router.get(
  '/sentry/overview',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { isSentryApiConfigured, getSentryOverview } = await import('../services/sentry-api');

    if (!isSentryApiConfigured()) {
      throw Errors.badRequest('Sentry API ikke konfigurert');
    }

    const overview = await getSentryOverview();

    const response: ApiResponse = {
      success: true,
      data: overview,
      requestId: req.requestId,
    };
    res.json(response);
  })
);

/**
 * GET /api/super-admin/sentry/issues
 * Get paginated list of Sentry issues
 */
router.get(
  '/sentry/issues',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { isSentryApiConfigured, getUnresolvedIssues } = await import('../services/sentry-api');

    if (!isSentryApiConfigured()) {
      throw Errors.badRequest('Sentry API ikke konfigurert');
    }

    const sort = (req.query.sort as string) || 'priority';
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit as string, 10) || 25, 1), 100);

    const issues = await getUnresolvedIssues({ sort, limit });

    const response: ApiResponse = {
      success: true,
      data: { issues },
      requestId: req.requestId,
    };
    res.json(response);
  })
);

/**
 * GET /api/super-admin/sentry/issues/:issueId
 * Get details for a single Sentry issue
 */
router.get(
  '/sentry/issues/:issueId',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { isSentryApiConfigured, getIssueDetails } = await import('../services/sentry-api');

    if (!isSentryApiConfigured()) {
      throw Errors.badRequest('Sentry API ikke konfigurert');
    }

    const { issueId } = req.params;
    if (!/^\d+$/.test(issueId)) {
      throw Errors.badRequest('Ugyldig issue-ID');
    }

    const issue = await getIssueDetails(issueId);

    const response: ApiResponse = {
      success: true,
      data: issue,
      requestId: req.requestId,
    };
    res.json(response);
  })
);

export default router;

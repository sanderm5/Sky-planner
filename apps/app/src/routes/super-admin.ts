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

    // Get all organizations with customer and user counts
    const organizations = await db.getAllOrganizations();

    // Enrich with stats
    const enrichedOrgs = await Promise.all(
      organizations.map(async (org) => {
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
      data: enrichedOrgs,
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

export default router;

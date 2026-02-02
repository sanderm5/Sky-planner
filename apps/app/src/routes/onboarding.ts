/**
 * Onboarding routes
 * Handles the multi-step onboarding flow for new organizations
 */

import { Router, Response } from 'express';
import { apiLogger, logAudit } from '../services/logger';
// Note: requireTenantAuth is applied at route-level in server.ts
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, ApiResponse, OnboardingStage } from '../types';

const router: Router = Router();

// Valid onboarding stages in order
const ONBOARDING_STAGES: OnboardingStage[] = [
  'not_started',
  'industry_selected',
  'company_info',
  'map_settings',
  'data_import',
  'completed'
];

// Database service interface
interface OnboardingDbService {
  getOnboardingStatus(organizationId: number): Promise<{
    stage: string;
    completed: boolean;
    industry_template_id: number | null;
  } | null>;
  updateOnboardingStage(
    organizationId: number,
    stage: string,
    additionalData?: Record<string, unknown>
  ): Promise<boolean>;
  completeOnboarding(organizationId: number): Promise<boolean>;
  getOrganizationById(organizationId: number): Promise<Record<string, unknown> | null>;
}

let dbService: OnboardingDbService;

/**
 * Initialize onboarding routes with database service
 */
export function initOnboardingRoutes(databaseService: OnboardingDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/onboarding/status
 * Get current onboarding status for the organization
 * Note: requireTenantAuth is applied at route-level in server.ts
 */
router.get(
  '/status',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    let status;
    try {
      status = await dbService.getOnboardingStatus(req.organizationId!);
    } catch (error) {
      apiLogger.error({ error, organizationId: req.organizationId }, 'Failed to get onboarding status');
      throw Errors.internal('Kunne ikke hente onboarding-status');
    }

    if (!status) {
      throw Errors.notFound('Organisasjon ikke funnet');
    }

    const currentIndex = ONBOARDING_STAGES.indexOf(status.stage as OnboardingStage);
    const nextStage = currentIndex < ONBOARDING_STAGES.length - 1
      ? ONBOARDING_STAGES[currentIndex + 1]
      : null;

    const response: ApiResponse<{
      stage: string;
      completed: boolean;
      nextStage: string | null;
      progress: number;
      industry_template_id: number | null;
    }> = {
      success: true,
      data: {
        stage: status.stage,
        completed: status.completed,
        nextStage,
        progress: Math.round((currentIndex / Math.max(ONBOARDING_STAGES.length - 1, 1)) * 100),
        industry_template_id: status.industry_template_id,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/onboarding/step
 * Complete an onboarding step and move to the next
 * Note: requireTenantAuth is applied at route-level in server.ts
 */
router.post(
  '/step',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { step, data } = req.body;

    if (!step || !ONBOARDING_STAGES.includes(step)) {
      throw Errors.badRequest('Ugyldig onboarding-steg');
    }

    // Get current status with error handling
    let currentStatus;
    try {
      currentStatus = await dbService.getOnboardingStatus(req.organizationId!);
    } catch (error) {
      apiLogger.error({ error, organizationId: req.organizationId }, 'Failed to get onboarding status');
      throw Errors.internal('Kunne ikke hente onboarding-status');
    }

    if (!currentStatus) {
      throw Errors.notFound('Organisasjon ikke funnet');
    }

    // Prepare update data based on step
    const updateData: Record<string, unknown> = {};

    switch (step) {
      case 'industry_selected':
        if (data?.industry_template_id) {
          updateData.industry_template_id = data.industry_template_id;
        }
        break;

      case 'company_info':
        if (data?.company_address) updateData.company_address = data.company_address;
        if (data?.company_postnummer) updateData.company_postnummer = data.company_postnummer;
        if (data?.company_poststed) updateData.company_poststed = data.company_poststed;
        if (data?.route_start_lat) updateData.route_start_lat = data.route_start_lat;
        if (data?.route_start_lng) updateData.route_start_lng = data.route_start_lng;
        break;

      case 'map_settings':
        if (data?.map_center_lat) updateData.map_center_lat = data.map_center_lat;
        if (data?.map_center_lng) updateData.map_center_lng = data.map_center_lng;
        if (data?.map_zoom) updateData.map_zoom = data.map_zoom;
        break;

      case 'data_import':
        // Data import step - user can import customers or skip
        // No specific data to store, just tracks progress
        if (data?.imported_count) {
          // Optional: track how many customers were imported
          apiLogger.info({
            organizationId: req.organizationId,
            importedCount: data.imported_count
          }, 'Customers imported during onboarding');
        }
        break;

      case 'completed':
        updateData.onboarding_completed = true;
        break;
    }

    // Update the onboarding stage with error handling
    let success;
    try {
      success = await dbService.updateOnboardingStage(
        req.organizationId!,
        step,
        updateData
      );
    } catch (error) {
      apiLogger.error({ error, organizationId: req.organizationId, step, updateData }, 'Failed to update onboarding stage');
      throw Errors.internal('Kunne ikke oppdatere onboarding-status');
    }

    if (!success) {
      apiLogger.warn({ organizationId: req.organizationId, step }, 'Onboarding stage update returned false');
      throw Errors.internal('Kunne ikke oppdatere onboarding-status');
    }

    logAudit(apiLogger, 'ONBOARDING_STEP', req.user!.userId, 'organization', req.organizationId!, {
      step,
      data: Object.keys(data || {}),
    });

    const currentIndex = ONBOARDING_STAGES.indexOf(step);
    const nextStage = currentIndex < ONBOARDING_STAGES.length - 1
      ? ONBOARDING_STAGES[currentIndex + 1]
      : null;

    const response: ApiResponse<{
      stage: string;
      completed: boolean;
      nextStage: string | null;
      progress: number;
    }> = {
      success: true,
      data: {
        stage: step,
        completed: step === 'completed',
        nextStage,
        progress: Math.round((currentIndex / Math.max(ONBOARDING_STAGES.length - 1, 1)) * 100),
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/onboarding/skip
 * Skip the onboarding process entirely
 * Note: requireTenantAuth is applied at route-level in server.ts
 */
router.post(
  '/skip',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const success = await dbService.completeOnboarding(req.organizationId!);

    if (!success) {
      throw Errors.internal('Kunne ikke hoppe over onboarding');
    }

    logAudit(apiLogger, 'ONBOARDING_SKIP', req.user!.userId, 'organization', req.organizationId!);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Onboarding hoppet over' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/onboarding/reset
 * Reset onboarding to start (admin only, for testing)
 * Note: requireTenantAuth is applied at route-level in server.ts
 */
router.post(
  '/reset',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Only allow reset in development or for admins
    if (process.env.NODE_ENV === 'production' && req.user?.type !== 'bruker') {
      throw Errors.forbidden('Kun tilgjengelig for administratorer');
    }

    const success = await dbService.updateOnboardingStage(
      req.organizationId!,
      'not_started',
      { onboarding_completed: false }
    );

    if (!success) {
      throw Errors.internal('Kunne ikke tilbakestille onboarding');
    }

    logAudit(apiLogger, 'ONBOARDING_RESET', req.user!.userId, 'organization', req.organizationId!);

    const response: ApiResponse<{ message: string }> = {
      success: true,
      data: { message: 'Onboarding tilbakestilt' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

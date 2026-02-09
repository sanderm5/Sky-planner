/**
 * Feature module routes
 * Manage feature flags per organization
 */

import { Router, Response } from 'express';
import { requireTenantAuth, requireRole } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import type { AuthenticatedRequest, ApiResponse, FeatureDefinition, OrganizationFeature, FeatureWithStatus } from '../types';

const router: Router = Router();

// Database service interface
interface FeaturesDbService {
  getAllFeatureDefinitions(): Promise<FeatureDefinition[]>;
  getFeatureDefinition(key: string): Promise<FeatureDefinition | null>;
  getOrganizationFeatures(organizationId: number): Promise<OrganizationFeature[]>;
  getOrganizationFeature(organizationId: number, featureKey: string): Promise<OrganizationFeature | null>;
  getEnabledFeatureKeys(organizationId: number): Promise<string[]>;
  enableFeature(organizationId: number, featureKey: string, config?: Record<string, unknown>): Promise<OrganizationFeature>;
  disableFeature(organizationId: number, featureKey: string): Promise<boolean>;
  updateFeatureConfig(organizationId: number, featureKey: string, config: Record<string, unknown>): Promise<OrganizationFeature | null>;
}

let dbService: FeaturesDbService;

export function initFeaturesRoutes(databaseService: FeaturesDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/features
 * Get all available features with status for current organization
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const allFeatures = await dbService.getAllFeatureDefinitions();
    const orgFeatures = await dbService.getOrganizationFeatures(req.organizationId!);

    const orgFeatureMap = new Map(orgFeatures.map(f => [f.feature_key, f]));

    const featuresWithStatus: FeatureWithStatus[] = allFeatures
      .filter(f => f.aktiv)
      .map(f => {
        const orgF = orgFeatureMap.get(f.key);
        return {
          ...f,
          enabled: orgF?.enabled ?? false,
          config: orgF?.config ?? {},
        };
      });

    const response: ApiResponse<FeatureWithStatus[]> = {
      success: true,
      data: featuresWithStatus,
    };

    res.json(response);
  })
);

/**
 * POST /api/features/:key/enable
 * Enable a feature for the current organization (admin only)
 */
router.post(
  '/:key/enable',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { key } = req.params;
    const { config } = req.body;

    const featureDef = await dbService.getFeatureDefinition(key);
    if (!featureDef || !featureDef.aktiv) {
      throw Errors.notFound(`Funksjon '${key}' finnes ikke`);
    }

    // Check dependencies
    if (featureDef.dependencies && featureDef.dependencies.length > 0) {
      const enabledKeys = await dbService.getEnabledFeatureKeys(req.organizationId!);
      const missingDeps = featureDef.dependencies.filter(dep => !enabledKeys.includes(dep));
      if (missingDeps.length > 0) {
        const missingNames = [];
        for (const dep of missingDeps) {
          const depDef = await dbService.getFeatureDefinition(dep);
          missingNames.push(depDef?.name || dep);
        }
        throw Errors.badRequest(`Aktiver følgende først: ${missingNames.join(', ')}`);
      }
    }

    const orgFeature = await dbService.enableFeature(req.organizationId!, key, config);

    const response: ApiResponse<OrganizationFeature> = {
      success: true,
      data: orgFeature,
    };

    res.status(200).json(response);
  })
);

/**
 * POST /api/features/:key/disable
 * Disable a feature for the current organization (admin only)
 */
router.post(
  '/:key/disable',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { key } = req.params;

    const featureDef = await dbService.getFeatureDefinition(key);
    if (!featureDef) {
      throw Errors.notFound(`Funksjon '${key}' finnes ikke`);
    }

    // Check if other enabled features depend on this one
    const allFeatures = await dbService.getAllFeatureDefinitions();
    const enabledKeys = await dbService.getEnabledFeatureKeys(req.organizationId!);
    const dependents = allFeatures
      .filter(f => f.dependencies?.includes(key) && enabledKeys.includes(f.key))
      .map(f => f.name);

    if (dependents.length > 0) {
      throw Errors.badRequest(`Kan ikke deaktivere: brukes av ${dependents.join(', ')}`);
    }

    await dbService.disableFeature(req.organizationId!, key);

    const response: ApiResponse = {
      success: true,
    };

    res.status(200).json(response);
  })
);

/**
 * PUT /api/features/:key/config
 * Update feature configuration for the current organization (admin only)
 */
router.put(
  '/:key/config',
  requireRole('admin'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { key } = req.params;
    const { config } = req.body;

    if (!config || typeof config !== 'object') {
      throw Errors.badRequest('config er påkrevd og må være et objekt');
    }

    const orgFeature = await dbService.getOrganizationFeature(req.organizationId!, key);
    if (!orgFeature?.enabled) {
      throw Errors.badRequest(`Funksjonen '${key}' er ikke aktivert`);
    }

    const updated = await dbService.updateFeatureConfig(req.organizationId!, key, config);

    const response: ApiResponse<OrganizationFeature | null> = {
      success: true,
      data: updated,
    };

    res.json(response);
  })
);

export default router;

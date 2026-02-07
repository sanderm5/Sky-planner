/**
 * Config routes
 * Application configuration and route planning endpoints
 */

import { Router, Request, Response } from 'express';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { getConfig } from '../config/env';
import type { AppConfig, ApiResponse, Organization, JWTPayload, AuthenticatedRequest, IndustryTemplate } from '../types';
import jwt from 'jsonwebtoken';

const router: Router = Router();

// Database service interface (will be injected)
interface ConfigDbService {
  getOrganizationById(id: number): Promise<Organization | null>;
  getIndustryTemplateById?(id: number): Promise<IndustryTemplate | null>;
}

let dbService: ConfigDbService;

/**
 * Initialize config routes with database service
 */
export function initConfigRoutes(databaseService: ConfigDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/config
 * Get application configuration (with optional tenant-specific branding)
 */
router.get(
  '/config',
  asyncHandler(async (req: Request, res: Response) => {
    const envConfig = getConfig();
    let organization: Organization | null = null;
    let industry: IndustryTemplate | null = null;

    // Try to get organization context from auth header (optional)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, envConfig.JWT_SECRET) as JWTPayload;
        if (decoded.organizationId) {
          organization = await dbService.getOrganizationById(decoded.organizationId);

          // Fetch industry template if organization has one
          if (organization?.industry_template_id && dbService.getIndustryTemplateById) {
            industry = await dbService.getIndustryTemplateById(organization.industry_template_id);
          }
        }
      } catch {
        // Token invalid or expired - continue without organization context
      }
    }

    // Build config with optional organization overrides
    const currentYear = new Date().getFullYear();
    const appConfig: AppConfig & { industry?: { id: number; name: string; slug: string; icon?: string; color?: string }; onboardingCompleted?: boolean; appMode?: 'mvp' | 'full' } = {
      appName: organization?.brand_title || process.env.APP_NAME || process.env.COMPANY_NAME || 'Kontrollsystem',
      appYear: parseInt(process.env.APP_YEAR || '', 10) || currentYear,
      developerName: process.env.DEVELOPER_NAME || 'Efffekt AS',
      primaryColor: organization?.primary_color || '#10b981',
      logoUrl: organization?.logo_url || undefined,
      mapCenterLat: organization?.map_center_lat || envConfig.MAP_CENTER_LAT,
      mapCenterLng: organization?.map_center_lng || envConfig.MAP_CENTER_LNG,
      mapZoom: envConfig.MAP_ZOOM,
      orsApiKeyConfigured: Boolean(envConfig.ORS_API_KEY),
      routeStartLat: envConfig.ROUTE_START_LAT,
      routeStartLng: envConfig.ROUTE_START_LNG,
      enableRoutePlanning: envConfig.ENABLE_ROUTE_PLANNING,
      emailNotificationsEnabled: envConfig.EMAIL_NOTIFICATIONS_ENABLED,
      organizationName: organization?.navn,
      companyName: organization?.navn || process.env.COMPANY_NAME,
      companySubtitle: organization?.brand_subtitle || process.env.COMPANY_SUBTITLE || 'Kontrollsystem',
      webUrl: envConfig.WEB_URL || undefined,
      // Include industry information
      industry: industry ? {
        id: industry.id,
        name: industry.name,
        slug: industry.slug,
        icon: industry.icon,
        color: industry.color,
      } : undefined,
      onboardingCompleted: organization?.onboarding_completed ?? false,
      appMode: organization?.app_mode ?? 'mvp',
    };

    const response: ApiResponse<typeof appConfig> = {
      success: true,
      data: appConfig,
    };

    res.json(response);
  })
);

/**
 * POST /api/routes/optimize
 * Proxy to OpenRouteService optimization API
 */
router.post(
  '/routes/optimize',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const config = getConfig();

    if (!config.ENABLE_ROUTE_PLANNING) {
      throw Errors.badRequest('Ruteplanlegging er ikke aktivert');
    }

    if (!config.ORS_API_KEY) {
      throw Errors.badRequest('OpenRouteService API-nøkkel er ikke konfigurert');
    }

    const { jobs, vehicles } = req.body;

    if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
      throw Errors.badRequest('jobs er påkrevd og må være en liste');
    }

    if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) {
      throw Errors.badRequest('vehicles er påkrevd og må være en liste');
    }

    try {
      const response = await fetch('https://api.openrouteservice.org/optimization', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': config.ORS_API_KEY,
        },
        body: JSON.stringify({ jobs, vehicles }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ORS API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      const apiResponse: ApiResponse = {
        success: true,
        data,
      };

      res.json(apiResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ukjent feil ved ruteoptimalisering';
      throw Errors.internal(message);
    }
  })
);

/**
 * POST /api/routes/directions
 * Proxy to OpenRouteService directions API
 */
router.post(
  '/routes/directions',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const config = getConfig();

    if (!config.ENABLE_ROUTE_PLANNING) {
      throw Errors.badRequest('Ruteplanlegging er ikke aktivert');
    }

    if (!config.ORS_API_KEY) {
      throw Errors.badRequest('OpenRouteService API-nøkkel er ikke konfigurert');
    }

    const { coordinates, profile = 'driving-car' } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
      throw Errors.badRequest('coordinates er påkrevd og må ha minst 2 punkter');
    }

    // Validate coordinates format
    for (const coord of coordinates) {
      if (!Array.isArray(coord) || coord.length !== 2 || typeof coord[0] !== 'number' || typeof coord[1] !== 'number') {
        throw Errors.badRequest('Hver koordinat må være [lng, lat]');
      }
    }

    const validProfiles = ['driving-car', 'driving-hgv', 'cycling-regular', 'foot-walking'];
    if (!validProfiles.includes(profile)) {
      throw Errors.badRequest(`Ugyldig profil. Gyldige verdier: ${validProfiles.join(', ')}`);
    }

    try {
      const response = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': config.ORS_API_KEY,
        },
        body: JSON.stringify({ coordinates }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ORS API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      const apiResponse: ApiResponse = {
        success: true,
        data,
      };

      res.json(apiResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ukjent feil ved ruteberegning';
      throw Errors.internal(message);
    }
  })
);

/**
 * GET /api/omrader
 * Get list of areas (poststeder) with customer counts
 */
router.get(
  '/omrader',
  asyncHandler(async (_req: Request, res: Response) => {
    // This endpoint doesn't require auth - just returns public area info
    // Will be implemented in database service

    const response: ApiResponse = {
      success: true,
      data: [], // Will be populated from database
    };

    res.json(response);
  })
);

export default router;

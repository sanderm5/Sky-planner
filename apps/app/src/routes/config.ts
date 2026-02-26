/**
 * Config routes
 * Application configuration and route planning endpoints
 */

import { Router, Request, Response } from 'express';
import { requireTenantAuth, extractToken } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { getConfig } from '../config/env';
import type { AppConfig, ApiResponse, Organization, JWTPayload, AuthenticatedRequest, IndustryTemplate, OrganizationServiceType } from '../types';
import jwt from 'jsonwebtoken';

const router: Router = Router();

// Database service interface (will be injected)
interface ConfigDbService {
  getOrganizationById(id: number): Promise<Organization | null>;
  updateOrganization(id: number, data: Partial<Organization>): Promise<Organization | null>;
  getIndustryTemplateById?(id: number): Promise<IndustryTemplate | null>;
  getEnabledFeatureKeys?(organizationId: number): Promise<string[]>;
  getEnabledFeaturesWithConfig?(organizationId: number): Promise<{ key: string; config: Record<string, unknown> }[]>;
  getOrganizationServiceTypes?(organizationId: number): Promise<OrganizationServiceType[]>;
  getSubcatGroupsByOrganization?(organizationId: number): Promise<{ id: number; organization_id: number; navn: string; sort_order: number; created_at: string }[]>;
  getSubcategoriesByGroupIds?(groupIds: number[]): Promise<{ id: number; group_id: number; navn: string; sort_order: number; created_at: string }[]>;
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

    // Try to get organization context from auth (Bearer token or SSO cookie)
    const token = extractToken(req as AuthenticatedRequest);
    if (token) {
      try {
        const decoded = jwt.verify(token, envConfig.JWT_SECRET, { algorithms: ['HS256'] }) as JWTPayload;
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

    // Fetch enabled features for this organization
    // All features are default-enabled — fallback list used when table doesn't exist yet
    const ALL_FEATURES = [
      'hover_tooltip', 'context_menu', 'lifecycle_colors', 'tripletex_projects',
      'field_work', 'email_templates', 'ekk_integration', 'outlook_sync',
    ];
    let enabledFeatures: string[] = ALL_FEATURES;
    let featureConfigs: Record<string, Record<string, unknown>> = {};
    if (organization && dbService.getEnabledFeaturesWithConfig) {
      try {
        const featuresWithConfig = await dbService.getEnabledFeaturesWithConfig(organization.id);
        if (featuresWithConfig.length > 0) {
          enabledFeatures = featuresWithConfig.map(f => f.key);
          for (const f of featuresWithConfig) {
            if (f.config && Object.keys(f.config).length > 0) {
              featureConfigs[f.key] = f.config;
            }
          }
        }
      } catch {
        // Features table may not exist yet - use ALL_FEATURES fallback
      }
    }

    // Fetch organization service types
    let serviceTypes: Array<{ id: number; name: string; slug: string; icon: string; color: string; defaultInterval: number; description?: string }> = [];
    if (organization && dbService.getOrganizationServiceTypes) {
      try {
        const orgServiceTypes = await dbService.getOrganizationServiceTypes(organization.id);
        serviceTypes = orgServiceTypes.map(st => ({
          id: st.id,
          name: st.name,
          slug: st.slug,
          icon: st.icon,
          color: st.color,
          defaultInterval: st.default_interval_months,
          description: st.description || undefined,
        }));
      } catch {
        // Table may not exist yet - continue without service types
      }
    }

    // Fetch subcategory groups (organization-level, not per service type)
    let subcategoryGroups: Array<{ id: number; navn: string; subcategories: Array<{ id: number; navn: string }> }> = [];
    if (organization && dbService.getSubcatGroupsByOrganization && dbService.getSubcategoriesByGroupIds) {
      try {
        const groups = await dbService.getSubcatGroupsByOrganization(organization.id);
        const groupIds = groups.map(g => g.id);
        const subcats = groupIds.length > 0 ? await dbService.getSubcategoriesByGroupIds(groupIds) : [];
        subcategoryGroups = groups.map(g => ({
          id: g.id,
          navn: g.navn,
          subcategories: subcats.filter(s => s.group_id === g.id).map(s => ({ id: s.id, navn: s.navn })),
        }));
      } catch {
        // Table may not exist yet
      }
    }

    // Build config with optional organization overrides
    const currentYear = new Date().getFullYear();
    const appConfig: AppConfig & { industry?: { id: number; name: string; slug: string; icon?: string; color?: string }; onboardingCompleted?: boolean; appMode?: 'mvp' | 'full' } = {
      appName: organization?.brand_title || process.env.APP_NAME || process.env.COMPANY_NAME || 'Kontrollsystem',
      appYear: Number.parseInt(process.env.APP_YEAR || '', 10) || currentYear,
      developerName: process.env.DEVELOPER_NAME || 'Efffekt AS',
      primaryColor: organization?.primary_color || '#10b981',
      logoUrl: organization?.logo_url || undefined,
      mapCenterLat: organization?.map_center_lat || envConfig.MAP_CENTER_LAT,
      mapCenterLng: organization?.map_center_lng || envConfig.MAP_CENTER_LNG,
      mapZoom: envConfig.MAP_ZOOM,
      mapboxAccessToken: envConfig.MAPBOX_ACCESS_TOKEN || undefined,
      orsApiKeyConfigured: Boolean(envConfig.ORS_API_KEY),
      routeStartLat: organization ? (organization.route_start_lat || undefined) : envConfig.ROUTE_START_LAT,
      routeStartLng: organization ? (organization.route_start_lng || undefined) : envConfig.ROUTE_START_LNG,
      routeStartAddress: organization ? (organization.route_start_address || undefined) : envConfig.ROUTE_START_ADDRESS,
      enableRoutePlanning: envConfig.ENABLE_ROUTE_PLANNING,
      emailNotificationsEnabled: envConfig.EMAIL_NOTIFICATIONS_ENABLED,
      organizationName: organization?.navn,
      companyName: organization?.navn || process.env.COMPANY_NAME,
      companySubtitle: organization?.brand_subtitle || process.env.COMPANY_SUBTITLE || 'Kontrollsystem',
      webUrl: envConfig.WEB_URL || undefined,
      enabledFeatures,
      featureConfigs: Object.keys(featureConfigs).length > 0 ? featureConfigs : undefined,
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
      datoModus: (organization?.dato_modus ?? 'full_date') as 'full_date' | 'month_year',
      serviceTypes: serviceTypes.length > 0 ? serviceTypes : undefined,
      subcategoryGroups: subcategoryGroups.length > 0 ? subcategoryGroups : undefined,
    };

    const response: ApiResponse<typeof appConfig> = {
      success: true,
      data: appConfig,
    };

    res.json(response);
  })
);

/**
 * PUT /api/organization/address
 * Update company address and route start coordinates
 */
router.put(
  '/organization/address',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = req.organizationId;
    if (!orgId) {
      throw Errors.unauthorized('Ingen organisasjon funnet');
    }

    const { company_address, company_postnummer, company_poststed, route_start_lat, route_start_lng } = req.body;

    // Validate lat/lng ranges if provided
    if (route_start_lat !== undefined && route_start_lat !== null) {
      const lat = Number(route_start_lat);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        throw Errors.badRequest('Ugyldig breddegrad (må være mellom -90 og 90)');
      }
    }
    if (route_start_lng !== undefined && route_start_lng !== null) {
      const lng = Number(route_start_lng);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        throw Errors.badRequest('Ugyldig lengdegrad (må være mellom -180 og 180)');
      }
    }

    // Validate postnummer format if provided
    if (company_postnummer !== undefined && company_postnummer !== null && company_postnummer !== '') {
      if (!/^\d{4}$/.test(company_postnummer)) {
        throw Errors.badRequest('Postnummer må være 4 siffer');
      }
    }

    const updateData: Record<string, unknown> = {};
    // Use existing DB columns: route_start_address (street), firma_adresse (full address with postal)
    if (company_address !== undefined) {
      updateData.route_start_address = company_address || null;
      // Build full address for firma_adresse
      const parts = [company_address, company_postnummer, company_poststed].filter(Boolean);
      updateData.firma_adresse = parts.length > 0 ? parts.join(', ') : null;
    }
    if (route_start_lat !== undefined) updateData.route_start_lat = route_start_lat || null;
    if (route_start_lng !== undefined) updateData.route_start_lng = route_start_lng || null;

    if (Object.keys(updateData).length === 0) {
      throw Errors.badRequest('Ingen felter å oppdatere');
    }

    await dbService.updateOrganization(orgId, updateData);

    const response: ApiResponse = {
      success: true,
      data: { message: 'Firmaadresse oppdatert' },
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
 * GET /api/routes/isochrone
 * Proxy to Mapbox Isochrone API - calculate reachable areas within given time
 */
router.get(
  '/routes/isochrone',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const config = getConfig();

    if (!config.MAPBOX_ACCESS_TOKEN) {
      throw Errors.badRequest('Mapbox access token er ikke konfigurert');
    }

    const { lng, lat, minutes, profile = 'driving' } = req.query;

    const lngNum = parseFloat(lng as string);
    const latNum = parseFloat(lat as string);
    if (isNaN(lngNum) || isNaN(latNum)) {
      throw Errors.badRequest('Ugyldige koordinater (lng og lat er påkrevd)');
    }

    // Validate contour minutes (max 4 contours per Mapbox limits)
    const minutesStr = (minutes as string) || '15,30,45';
    const minutesArr = minutesStr.split(',').map(Number);
    if (minutesArr.some(isNaN) || minutesArr.length > 4 || minutesArr.length === 0) {
      throw Errors.badRequest('Ugyldig contours_minutes (maks 4 verdier)');
    }

    const validProfiles = ['driving', 'walking', 'cycling'];
    if (!validProfiles.includes(profile as string)) {
      throw Errors.badRequest('Ugyldig profil');
    }

    try {
      const url = `https://api.mapbox.com/isochrone/v1/mapbox/${profile}/${lngNum},${latNum}?contours_minutes=${minutesStr}&polygons=true&denoise=1&generalize=500&access_token=${config.MAPBOX_ACCESS_TOKEN}`;

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mapbox Isochrone API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      const apiResponse: ApiResponse = {
        success: true,
        data,
      };

      res.json(apiResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ukjent feil ved isochrone-beregning';
      throw Errors.internal(message);
    }
  })
);

/**
 * POST /api/routes/matrix
 * Proxy to Mapbox Matrix API - calculate travel times between multiple points
 */
router.post(
  '/routes/matrix',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const config = getConfig();

    if (!config.MAPBOX_ACCESS_TOKEN) {
      throw Errors.badRequest('Mapbox access token er ikke konfigurert');
    }

    const { coordinates, profile = 'driving', sources, destinations, depart_at } = req.body;

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 25) {
      throw Errors.badRequest('coordinates er påkrevd (2-25 punkter)');
    }

    // Validate coordinates format
    for (const coord of coordinates) {
      if (!Array.isArray(coord) || coord.length !== 2 || typeof coord[0] !== 'number' || typeof coord[1] !== 'number') {
        throw Errors.badRequest('Hver koordinat må være [lng, lat]');
      }
    }

    const validProfiles = ['driving', 'walking', 'cycling'];
    if (!validProfiles.includes(profile)) {
      throw Errors.badRequest(`Ugyldig profil. Gyldige verdier: ${validProfiles.join(', ')}`);
    }

    try {
      const coordStr = coordinates.map((c: number[]) => `${c[0]},${c[1]}`).join(';');
      let url = `https://api.mapbox.com/directions-matrix/v1/mapbox/${profile}/${coordStr}?annotations=duration,distance&access_token=${config.MAPBOX_ACCESS_TOKEN}`;

      if (sources !== undefined) url += `&sources=${sources}`;
      if (destinations !== undefined) url += `&destinations=${destinations}`;
      if (depart_at) url += `&depart_at=${depart_at}`;

      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mapbox Matrix API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      const apiResponse: ApiResponse = {
        success: true,
        data,
      };

      res.json(apiResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ukjent feil ved matrise-beregning';
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

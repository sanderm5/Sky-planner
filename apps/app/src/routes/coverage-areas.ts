/**
 * Coverage Areas (Dekningsområder) routes
 * CRUD for organization coverage zones + polygon generation
 */

import { Router, Response } from 'express';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { getConfig } from '../config/env';
import type { AuthenticatedRequest, ApiResponse, CoverageArea } from '../types';

const router: Router = Router();

// Database service interface
interface CoverageAreasDbService {
  getCoverageAreas(organizationId: number): Promise<CoverageArea[]>;
  getCoverageAreaById(id: number, organizationId: number): Promise<CoverageArea | null>;
  createCoverageArea(organizationId: number, data: Partial<CoverageArea>): Promise<CoverageArea>;
  updateCoverageArea(id: number, organizationId: number, data: Partial<CoverageArea>): Promise<CoverageArea | null>;
  deleteCoverageArea(id: number, organizationId: number): Promise<boolean>;
}

let dbService: CoverageAreasDbService;

export function initCoverageAreaRoutes(databaseService: CoverageAreasDbService): Router {
  dbService = databaseService;
  return router;
}

/**
 * Generate a circle polygon as GeoJSON (no API call needed)
 */
function generateCirclePolygon(
  centerLat: number,
  centerLng: number,
  radiusKm: number,
  points = 64
): Record<string, unknown> {
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = radiusKm * Math.cos(angle);
    const dy = radiusKm * Math.sin(angle);
    const lat = centerLat + dy / 111.32;
    const lng = centerLng + dx / (111.32 * Math.cos((centerLat * Math.PI) / 180));
    coords.push([lng, lat]);
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: { radiusKm },
      },
    ],
  };
}

/**
 * Point-in-polygon check using ray casting algorithm
 * ring is array of [lng, lat] pairs (GeoJSON order)
 */
function pointInPolygon(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Check if a point is inside any polygon in a GeoJSON structure
 */
function pointInGeoJSON(
  lat: number,
  lng: number,
  geojson: Record<string, unknown>
): boolean {
  const features = (geojson as { features?: Record<string, unknown>[] }).features || [geojson];
  for (const feature of features) {
    const geometry = feature.geometry as { type: string; coordinates: unknown } | undefined;
    if (!geometry) continue;
    if (geometry.type === 'Polygon') {
      const ring = (geometry.coordinates as number[][][])[0];
      if (pointInPolygon(lat, lng, ring)) return true;
    } else if (geometry.type === 'MultiPolygon') {
      for (const poly of geometry.coordinates as number[][][][]) {
        if (pointInPolygon(lat, lng, poly[0])) return true;
      }
    }
  }
  return false;
}

/**
 * GET /api/coverage-areas
 * List all coverage areas for the authenticated organization
 */
router.get(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = req.organizationId!;
    const areas = await dbService.getCoverageAreas(orgId);

    const response: ApiResponse = { success: true, data: areas };
    res.json(response);
  })
);

/**
 * POST /api/coverage-areas
 * Create a new coverage area with polygon generation
 */
router.post(
  '/',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = req.organizationId!;
    const {
      navn,
      coverage_type,
      coverage_value,
      coverage_days,
      coverage_hours,
      origin_lat,
      origin_lng,
      fill_color,
      fill_opacity,
      line_color,
      zone_priority,
    } = req.body;

    // Validate coverage_type
    if (!coverage_type || !['isochrone', 'radius'].includes(coverage_type)) {
      throw Errors.badRequest("coverage_type må være 'isochrone' eller 'radius'");
    }

    // Calculate coverage_value
    let value: number;
    if (coverage_type === 'isochrone') {
      // Accept days + hours, convert to minutes for storage
      const days = coverage_days !== undefined ? parseInt(coverage_days, 10) : 0;
      const hours = coverage_hours !== undefined ? parseInt(coverage_hours, 10) : 0;
      if (coverage_value !== undefined) {
        // Legacy: direct minutes value
        value = parseFloat(coverage_value);
      } else {
        value = (days * 24 * 60) + (hours * 60);
      }
      if (isNaN(value) || value <= 0) {
        throw Errors.badRequest('Kjøretid må være minst 1 time');
      }
      if (days < 0 || days > 14) {
        throw Errors.badRequest('Maks 14 dager kjøretid');
      }
      if (hours < 0 || hours > 23) {
        throw Errors.badRequest('Timer må være mellom 0 og 23');
      }
      if (value > 20160) {
        throw Errors.badRequest('Maks 14 dager total kjøretid');
      }
    } else {
      value = parseFloat(coverage_value);
      if (isNaN(value) || value <= 0) {
        throw Errors.badRequest('Radius må være et positivt tall');
      }
      if (value > 2000) {
        throw Errors.badRequest('Radius må være mellom 1 og 2000 km');
      }
    }

    // Validate origin coordinates
    const lat = origin_lat !== undefined ? parseFloat(origin_lat) : undefined;
    const lng = origin_lng !== undefined ? parseFloat(origin_lng) : undefined;
    if (lat !== undefined && (isNaN(lat) || lat < -90 || lat > 90)) {
      throw Errors.badRequest('Ugyldig latitude (-90 til 90)');
    }
    if (lng !== undefined && (isNaN(lng) || lng < -180 || lng > 180)) {
      throw Errors.badRequest('Ugyldig longitude (-180 til 180)');
    }

    // Generate polygon
    let polygonGeojson: Record<string, unknown> | null = null;
    const originLat = lat;
    const originLng = lng;

    if (originLat !== undefined && originLng !== undefined) {
      if (coverage_type === 'radius') {
        polygonGeojson = generateCirclePolygon(originLat, originLng, value);
      } else {
        // Isochrone: call Mapbox API
        const config = getConfig();
        if (config.MAPBOX_ACCESS_TOKEN) {
          try {
            const url = `https://api.mapbox.com/isochrone/v1/mapbox/driving/${originLng},${originLat}?contours_minutes=${value}&polygons=true&denoise=1&generalize=500&access_token=${config.MAPBOX_ACCESS_TOKEN}`;
            const mapboxRes = await fetch(url);
            if (mapboxRes.ok) {
              polygonGeojson = (await mapboxRes.json()) as Record<string, unknown>;
            }
          } catch {
            // Mapbox failed, save without polygon — user can refresh later
          }
        }
      }
    }

    const created = await dbService.createCoverageArea(orgId, {
      navn: navn || 'Hovedområde',
      coverage_type,
      coverage_value: value,
      origin_lat: originLat,
      origin_lng: originLng,
      polygon_geojson: polygonGeojson,
      fill_color: fill_color || '#2563eb',
      fill_opacity: fill_opacity !== undefined ? parseFloat(fill_opacity) : 0.1,
      line_color: line_color || '#2563eb',
      zone_priority: zone_priority !== undefined ? parseInt(zone_priority, 10) : 0,
    });

    const response: ApiResponse = { success: true, data: created };
    res.status(201).json(response);
  })
);

/**
 * PUT /api/coverage-areas/:id
 * Update a coverage area
 */
router.put(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = req.organizationId!;
    const areaId = parseInt(req.params.id, 10);
    if (isNaN(areaId)) throw Errors.badRequest('Ugyldig id');

    const existing = await dbService.getCoverageAreaById(areaId, orgId);
    if (!existing) throw Errors.notFound('Dekningsområde ikke funnet');

    const updateData: Partial<CoverageArea> = {};

    if (req.body.navn !== undefined) updateData.navn = String(req.body.navn).slice(0, 100);
    if (req.body.coverage_type !== undefined) {
      if (!['isochrone', 'radius'].includes(req.body.coverage_type)) {
        throw Errors.badRequest("coverage_type må være 'isochrone' eller 'radius'");
      }
      updateData.coverage_type = req.body.coverage_type;
    }
    if (req.body.coverage_value !== undefined) {
      const val = parseFloat(req.body.coverage_value);
      if (isNaN(val) || val <= 0) throw Errors.badRequest('Ugyldig coverage_value');
      updateData.coverage_value = val;
    }
    if (req.body.origin_lat !== undefined) updateData.origin_lat = parseFloat(req.body.origin_lat);
    if (req.body.origin_lng !== undefined) updateData.origin_lng = parseFloat(req.body.origin_lng);
    if (req.body.fill_color !== undefined) updateData.fill_color = String(req.body.fill_color);
    if (req.body.fill_opacity !== undefined) updateData.fill_opacity = parseFloat(req.body.fill_opacity);
    if (req.body.line_color !== undefined) updateData.line_color = String(req.body.line_color);
    if (req.body.zone_priority !== undefined) updateData.zone_priority = parseInt(req.body.zone_priority, 10);
    if (req.body.aktiv !== undefined) updateData.aktiv = Boolean(req.body.aktiv);

    const updated = await dbService.updateCoverageArea(areaId, orgId, updateData);
    if (!updated) throw Errors.internal('Kunne ikke oppdatere dekningsområde');

    const response: ApiResponse = { success: true, data: updated };
    res.json(response);
  })
);

/**
 * DELETE /api/coverage-areas/:id
 * Delete a coverage area
 */
router.delete(
  '/:id',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = req.organizationId!;
    const areaId = parseInt(req.params.id, 10);
    if (isNaN(areaId)) throw Errors.badRequest('Ugyldig id');

    const deleted = await dbService.deleteCoverageArea(areaId, orgId);
    if (!deleted) throw Errors.notFound('Dekningsområde ikke funnet');

    const response: ApiResponse = { success: true };
    res.json(response);
  })
);

/**
 * POST /api/coverage-areas/:id/refresh-polygon
 * Refresh the cached polygon for a coverage area
 */
router.post(
  '/:id/refresh-polygon',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = req.organizationId!;
    const areaId = parseInt(req.params.id, 10);
    if (isNaN(areaId)) throw Errors.badRequest('Ugyldig id');

    const area = await dbService.getCoverageAreaById(areaId, orgId);
    if (!area) throw Errors.notFound('Dekningsområde ikke funnet');

    const originLat = area.origin_lat;
    const originLng = area.origin_lng;
    if (!originLat || !originLng) {
      throw Errors.badRequest('Dekningsområdet mangler koordinater');
    }

    let polygonGeojson: Record<string, unknown> | null = null;

    if (area.coverage_type === 'radius') {
      polygonGeojson = generateCirclePolygon(originLat, originLng, area.coverage_value);
    } else {
      const config = getConfig();
      if (!config.MAPBOX_ACCESS_TOKEN) {
        throw Errors.badRequest('Mapbox access token er ikke konfigurert');
      }
      const url = `https://api.mapbox.com/isochrone/v1/mapbox/driving/${originLng},${originLat}?contours_minutes=${area.coverage_value}&polygons=true&denoise=1&generalize=500&access_token=${config.MAPBOX_ACCESS_TOKEN}`;
      const mapboxRes = await fetch(url);
      if (!mapboxRes.ok) {
        const errorText = await mapboxRes.text();
        throw Errors.internal(`Mapbox Isochrone feilet: ${mapboxRes.status} - ${errorText}`);
      }
      polygonGeojson = (await mapboxRes.json()) as Record<string, unknown>;
    }

    const updated = await dbService.updateCoverageArea(areaId, orgId, {
      polygon_geojson: polygonGeojson,
    });

    const response: ApiResponse = { success: true, data: updated };
    res.json(response);
  })
);

/**
 * POST /api/coverage-areas/check
 * Check if coordinates are within coverage areas
 */
router.post(
  '/check',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const orgId = req.organizationId!;
    const { coordinates } = req.body;

    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      throw Errors.badRequest('coordinates må være en liste med {lat, lng}');
    }
    if (coordinates.length > 1000) {
      throw Errors.badRequest('Maks 1000 koordinater per sjekk');
    }

    const areas = await dbService.getCoverageAreas(orgId);
    const activeAreas = areas.filter(a => a.aktiv && a.polygon_geojson);

    const results = coordinates.map(
      (coord: { lat: number; lng: number }) => {
        const zones: { id: number; navn: string; inside: boolean }[] = [];
        for (const area of activeAreas) {
          const inside = pointInGeoJSON(
            coord.lat,
            coord.lng,
            area.polygon_geojson as Record<string, unknown>
          );
          zones.push({ id: area.id, navn: area.navn, inside });
        }
        return { lat: coord.lat, lng: coord.lng, zones };
      }
    );

    const response: ApiResponse = { success: true, data: { results } };
    res.json(response);
  })
);

export default router;

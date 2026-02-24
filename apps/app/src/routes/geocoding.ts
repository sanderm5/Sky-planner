/**
 * Geocoding routes
 * Proxy endpoints for Mapbox Geocoding API with Kartverket/Nominatim fallback
 */

import { Router, Response } from 'express';
import { requireTenantAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { getConfig } from '../config/env';
import { reverseGeocode, geocodeBatch } from '../services/geocoding';
import type { AuthenticatedRequest, ApiResponse } from '../types';

const router: Router = Router();

// Simple in-memory cache for geocoding results
const geocodeCache = new Map<string, { result: unknown; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 10000;

function getCached(key: string): unknown | null {
  const entry = geocodeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    geocodeCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(key: string, result: unknown): void {
  if (geocodeCache.size >= MAX_CACHE_SIZE) {
    const firstKey = geocodeCache.keys().next().value;
    if (firstKey) geocodeCache.delete(firstKey);
  }
  geocodeCache.set(key, { result, timestamp: Date.now() });
}

/**
 * POST /api/geocode/forward
 * Forward geocoding: address text → coordinates + suggestions
 */
router.post(
  '/forward',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { query, limit = 5, proximity } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      throw Errors.badRequest('query er påkrevd (minst 2 tegn)');
    }

    const cacheKey = `fwd:${query.trim().toLowerCase()}:${limit}`;
    const cached = getCached(cacheKey);
    if (cached) {
      const response: ApiResponse = { success: true, data: cached };
      res.json(response);
      return;
    }

    const config = getConfig();
    const suggestions: Array<{
      adresse: string;
      postnummer: string;
      poststed: string;
      lat: number;
      lng: number;
      kommune?: string;
      quality: string;
      source: string;
    }> = [];

    // Try Kartverket first (fast, free, excellent for Norwegian addresses)
    try {
      const kartverketUrl = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(query.trim())}&treffPerSide=${Math.min(limit, 10)}`;
      const kvRes = await fetch(kartverketUrl);
      if (kvRes.ok) {
        const kvData = await kvRes.json() as { adresser?: Array<{ representasjonspunkt?: { lat: number; lon: number }; adressetekst?: string; postnummer?: string; poststed?: string; kommunenavn?: string }> };
        if (kvData.adresser && kvData.adresser.length > 0) {
          for (const addr of kvData.adresser) {
            if (addr.representasjonspunkt) {
              suggestions.push({
                adresse: addr.adressetekst || '',
                postnummer: addr.postnummer || '',
                poststed: addr.poststed || '',
                lat: addr.representasjonspunkt.lat,
                lng: addr.representasjonspunkt.lon,
                kommune: addr.kommunenavn || '',
                quality: 'exact',
                source: 'kartverket',
              });
            }
          }
        }
      }
    } catch {
      // Kartverket failed, continue to fallback
    }

    // Fallback to Mapbox if Kartverket returned no results
    if (suggestions.length === 0 && config.MAPBOX_ACCESS_TOKEN) {
      try {
        let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query.trim())}.json?access_token=${config.MAPBOX_ACCESS_TOKEN}&country=no&language=no&limit=${Math.min(limit, 10)}&types=address,poi`;
        if (proximity && Array.isArray(proximity) && proximity.length === 2) {
          url += `&proximity=${proximity[0]},${proximity[1]}`;
        }

        const mapboxRes = await fetch(url);
        if (mapboxRes.ok) {
          const data = await mapboxRes.json() as { features?: Array<{ center: [number, number]; address?: string; text?: string; place_name?: string; relevance: number; context?: Array<{ id: string; text: string }> }> };
          if (data.features && data.features.length > 0) {
            for (const feature of data.features) {
              const [lng, lat] = feature.center;
              // Extract address components from context
              let postnummer = '';
              let poststed = '';
              let kommune = '';
              if (feature.context) {
                for (const ctx of feature.context) {
                  if (ctx.id?.startsWith('postcode')) postnummer = ctx.text || '';
                  if (ctx.id?.startsWith('place')) poststed = ctx.text || '';
                  if (ctx.id?.startsWith('district') || ctx.id?.startsWith('locality')) {
                    if (!kommune) kommune = ctx.text || '';
                  }
                }
              }
              // Build full address: street name + house number
              // Mapbox: text = street name, address = house number
              const streetName = feature.text || '';
              const houseNumber = feature.address || '';
              const fullAddress = houseNumber ? `${streetName} ${houseNumber}` : streetName;
              suggestions.push({
                adresse: fullAddress || feature.place_name || '',
                postnummer,
                poststed,
                lat,
                lng,
                kommune,
                quality: feature.relevance >= 0.9 ? 'exact' : feature.relevance >= 0.7 ? 'street' : 'area',
                source: 'mapbox',
              });
            }
          }
        }
      } catch {
        // Mapbox failed too
      }
    }

    const result = { suggestions };
    setCache(cacheKey, result);

    const response: ApiResponse = { success: true, data: result };
    res.json(response);
  })
);

/**
 * POST /api/geocode/reverse
 * Reverse geocoding: coordinates → address
 */
router.post(
  '/reverse',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { lat, lng } = req.body;

    if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
      throw Errors.badRequest('Ugyldige koordinater (lat og lng er påkrevd som tall)');
    }

    const cacheKey = `rev:${lat.toFixed(5)}:${lng.toFixed(5)}`;
    const cached = getCached(cacheKey);
    if (cached) {
      const response: ApiResponse = { success: true, data: cached };
      res.json(response);
      return;
    }

    const result = await reverseGeocode(lat, lng);

    if (result) {
      setCache(cacheKey, result);
    }

    const response: ApiResponse = { success: true, data: result };
    res.json(response);
  })
);

/**
 * POST /api/geocode/batch
 * Batch geocoding for import: multiple addresses → coordinates
 */
router.post(
  '/batch',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw Errors.badRequest('items er påkrevd og må være en liste');
    }

    if (items.length > 500) {
      throw Errors.badRequest('Maks 500 elementer per batch');
    }

    const results = await geocodeBatch(
      items.map((item: { id?: number; adresse?: string; postnummer?: string; poststed?: string }) => ({
        id: item.id,
        adresse: item.adresse,
        postnummer: item.postnummer,
        poststed: item.poststed,
      })),
      { rateLimitMs: 200 }
    );

    // Convert Map to serializable object
    const serialized: Record<string, unknown> = {};
    let geocoded = 0;
    let failed = 0;
    for (const [id, result] of results) {
      if (id !== undefined) {
        serialized[String(id)] = result;
        if (result) geocoded++;
        else failed++;
      }
    }

    const response: ApiResponse = {
      success: true,
      data: { results: serialized, geocoded, failed, total: items.length },
    };
    res.json(response);
  })
);

export default router;

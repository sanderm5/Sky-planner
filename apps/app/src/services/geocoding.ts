/**
 * Geocoding Service
 * Converts addresses to coordinates using Kartverket API (primary) and Nominatim (fallback)
 * Used for automatic geocoding during customer import
 */

import { logger } from './logger';
import { getConfig } from '../config/env';

// ============ Types ============

export interface GeocodingResult {
  lat: number;
  lng: number;
  source: 'mapbox' | 'kartverket' | 'kartverket-poststed' | 'nominatim' | 'nominatim-poststed';
  quality: 'exact' | 'street' | 'area';
  matchedAddress?: string;
}

export interface ReverseGeocodingResult {
  address: string;
  postnummer: string;
  poststed: string;
  kommune?: string;
  source: 'mapbox' | 'nominatim';
}

export interface GeocodingOptions {
  /** Skip geocoding if customer already has coordinates */
  skipIfHasCoordinates?: boolean;
  /** Rate limit delay in ms between requests (default: 100) */
  rateLimitMs?: number;
}

// API Response types
interface KartverketResponse {
  adresser?: Array<{
    representasjonspunkt?: { lat: number; lon: number };
    adressetekst?: string;
    poststed?: string;
  }>;
}

interface NominatimResponse extends Array<{
  lat: string;
  lon: string;
  display_name?: string;
}> {}

// ============ Constants ============

const KARTVERKET_API = 'https://ws.geonorge.no/adresser/v1/sok';
const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_RATE_LIMIT_MS = 100;
const GEOCODING_TIMEOUT_MS = 10000; // 10 seconds

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = GEOCODING_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// ============ Main Functions ============

/**
 * Geocode an address to coordinates
 * Tries Kartverket first (Norwegian addresses), then falls back to Nominatim
 */
export async function geocodeAddress(
  adresse: string | undefined | null,
  postnummer: string | undefined | null,
  poststed: string | undefined | null
): Promise<GeocodingResult | null> {
  // Need at least address or poststed
  if (!adresse && !poststed) {
    return null;
  }

  // Try Kartverket first (fast, free, excellent for Norwegian addresses)
  const kartverketResult = await tryKartverket(adresse, postnummer, poststed);
  if (kartverketResult) {
    return kartverketResult;
  }

  // Fallback to Mapbox (better for ambiguous or international queries)
  const mapboxResult = await tryMapbox(adresse, postnummer, poststed);
  if (mapboxResult) {
    return mapboxResult;
  }

  // Try Kartverket with just poststed
  if (poststed) {
    const kartverketPoststedResult = await tryKartverketPoststed(poststed);
    if (kartverketPoststedResult) {
      return kartverketPoststedResult;
    }
  }

  // Fallback to Nominatim
  const nominatimResult = await tryNominatim(adresse, postnummer, poststed);
  if (nominatimResult) {
    return nominatimResult;
  }

  // Last resort: Nominatim with just poststed
  if (poststed) {
    const nominatimPoststedResult = await tryNominatimPoststed(poststed);
    if (nominatimPoststedResult) {
      return nominatimPoststedResult;
    }
  }

  return null;
}

/**
 * Geocode multiple customers in batch
 * Returns a map of customer ID to geocoding result
 */
export async function geocodeBatch(
  customers: Array<{
    id?: number;
    adresse?: string | null;
    postnummer?: string | null;
    poststed?: string | null;
    lat?: number | null;
    lng?: number | null;
  }>,
  options: GeocodingOptions = {}
): Promise<Map<number | undefined, GeocodingResult | null>> {
  const results = new Map<number | undefined, GeocodingResult | null>();
  const rateLimitMs = options.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;

  for (const customer of customers) {
    // Skip if already has coordinates
    if (options.skipIfHasCoordinates && customer.lat && customer.lng) {
      results.set(customer.id, null);
      continue;
    }

    const result = await geocodeAddress(
      customer.adresse,
      customer.postnummer,
      customer.poststed
    );

    results.set(customer.id, result);

    // Rate limiting
    if (rateLimitMs > 0) {
      await sleep(rateLimitMs);
    }
  }

  return results;
}

/**
 * Geocode a single customer and return updated data
 * Useful for inline geocoding during import
 */
export async function geocodeCustomerData<T extends {
  adresse?: string | null;
  postnummer?: string | null;
  poststed?: string | null;
  lat?: number | null;
  lng?: number | null;
}>(customerData: T): Promise<T> {
  // Skip if already has coordinates
  if (customerData.lat && customerData.lng) {
    return customerData;
  }

  const result = await geocodeAddress(
    customerData.adresse,
    customerData.postnummer,
    customerData.poststed
  );

  if (result) {
    return {
      ...customerData,
      lat: result.lat,
      lng: result.lng,
    };
  }

  return customerData;
}

// ============ API Helpers ============

async function tryMapbox(
  adresse: string | undefined | null,
  postnummer: string | undefined | null,
  poststed: string | undefined | null
): Promise<GeocodingResult | null> {
  const config = getConfig();
  if (!config.MAPBOX_ACCESS_TOKEN) return null;

  try {
    const searchText = [adresse, postnummer, poststed].filter(Boolean).join(' ');
    if (!searchText.trim()) return null;

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchText)}.json?access_token=${config.MAPBOX_ACCESS_TOKEN}&country=no&language=no&limit=1&types=address`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      logger.debug({ status: response.status }, 'Mapbox Geocoding API error');
      return null;
    }

    const data = await response.json() as { features?: Array<{ center: [number, number]; relevance: number; place_name?: string }> };

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      const [lng, lat] = feature.center;
      const quality = feature.relevance >= 0.9 ? 'exact' : feature.relevance >= 0.7 ? 'street' : 'area';

      return {
        lat,
        lng,
        source: 'mapbox',
        quality,
        matchedAddress: feature.place_name,
      };
    }

    return null;
  } catch (error) {
    logger.debug({ error }, 'Mapbox geocoding failed');
    return null;
  }
}

/**
 * Reverse geocode coordinates to address using Mapbox
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodingResult | null> {
  const config = getConfig();

  // Try Mapbox first
  if (config.MAPBOX_ACCESS_TOKEN) {
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${config.MAPBOX_ACCESS_TOKEN}&country=no&language=no&types=address&limit=1`;
      const response = await fetchWithTimeout(url);

      if (response.ok) {
        const data = await response.json() as { features?: Array<{ text?: string; place_name?: string; context?: Array<{ id: string; text: string }> }> };

        if (data.features && data.features.length > 0) {
          const feature = data.features[0];
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

          return {
            address: feature.text || feature.place_name || '',
            postnummer,
            poststed,
            kommune,
            source: 'mapbox',
          };
        }
      }
    } catch (error) {
      logger.debug({ error }, 'Mapbox reverse geocoding failed');
    }
  }

  // Fallback to Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'SkyPlanner/1.0 (contact@skyplanner.no)' },
    });

    if (response.ok) {
      const data = await response.json() as {
        address?: {
          road?: string;
          house_number?: string;
          postcode?: string;
          city?: string;
          town?: string;
          village?: string;
          municipality?: string;
        };
        display_name?: string;
      };

      if (data.address) {
        const road = data.address.road || '';
        const houseNumber = data.address.house_number || '';
        const address = houseNumber ? `${road} ${houseNumber}` : road;

        return {
          address,
          postnummer: data.address.postcode || '',
          poststed: data.address.city || data.address.town || data.address.village || '',
          kommune: data.address.municipality || '',
          source: 'nominatim',
        };
      }
    }
  } catch (error) {
    logger.debug({ error }, 'Nominatim reverse geocoding failed');
  }

  return null;
}

async function tryKartverket(
  adresse: string | undefined | null,
  postnummer: string | undefined | null,
  poststed: string | undefined | null
): Promise<GeocodingResult | null> {
  try {
    const searchText = [adresse, postnummer, poststed].filter(Boolean).join(' ');
    if (!searchText.trim()) return null;

    const url = `${KARTVERKET_API}?sok=${encodeURIComponent(searchText)}&treffPerSide=1`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      logger.debug({ status: response.status }, 'Kartverket API error');
      return null;
    }

    const data = await response.json() as KartverketResponse;

    if (data.adresser && data.adresser.length > 0) {
      const result = data.adresser[0];
      if (result.representasjonspunkt) {
        return {
          lat: result.representasjonspunkt.lat,
          lng: result.representasjonspunkt.lon,
          source: 'kartverket',
          quality: 'exact',
          matchedAddress: result.adressetekst,
        };
      }
    }

    return null;
  } catch (error) {
    logger.debug({ error }, 'Kartverket geocoding failed');
    return null;
  }
}

async function tryKartverketPoststed(poststed: string): Promise<GeocodingResult | null> {
  try {
    const url = `${KARTVERKET_API}?sok=${encodeURIComponent(poststed)}&treffPerSide=1`;
    const response = await fetchWithTimeout(url);

    if (!response.ok) return null;

    const data = await response.json() as KartverketResponse;

    if (data.adresser && data.adresser.length > 0) {
      const result = data.adresser[0];
      if (result.representasjonspunkt) {
        return {
          lat: result.representasjonspunkt.lat,
          lng: result.representasjonspunkt.lon,
          source: 'kartverket-poststed',
          quality: 'area',
          matchedAddress: result.poststed || poststed,
        };
      }
    }

    return null;
  } catch (error) {
    logger.debug({ error }, 'Kartverket poststed geocoding failed');
    return null;
  }
}

async function tryNominatim(
  adresse: string | undefined | null,
  postnummer: string | undefined | null,
  poststed: string | undefined | null
): Promise<GeocodingResult | null> {
  try {
    const fullAddress = [adresse, postnummer, poststed, 'Norway']
      .filter(Boolean)
      .join(', ');

    if (!fullAddress.trim() || fullAddress === 'Norway') return null;

    const url = `${NOMINATIM_API}?format=json&q=${encodeURIComponent(fullAddress)}&limit=1`;
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'SkyPlanner/1.0 (contact@skyplanner.no)' },
    });

    if (!response.ok) return null;

    const data = await response.json() as NominatimResponse;

    if (data && data.length > 0) {
      const lat = Number.parseFloat(data[0].lat);
      const lng = Number.parseFloat(data[0].lon);

      // Validate coordinates are valid numbers
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        logger.warn({ rawLat: data[0].lat, rawLon: data[0].lon }, 'Invalid coordinates from Nominatim');
        return null;
      }

      return {
        lat,
        lng,
        source: 'nominatim',
        quality: 'street',
        matchedAddress: data[0].display_name,
      };
    }

    return null;
  } catch (error) {
    logger.debug({ error }, 'Nominatim geocoding failed');
    return null;
  }
}

async function tryNominatimPoststed(poststed: string): Promise<GeocodingResult | null> {
  try {
    const url = `${NOMINATIM_API}?format=json&q=${encodeURIComponent(poststed + ', Norway')}&limit=1`;
    const response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'SkyPlanner/1.0 (contact@skyplanner.no)' },
    });

    if (!response.ok) return null;

    const data = await response.json() as NominatimResponse;

    if (data && data.length > 0) {
      const lat = Number.parseFloat(data[0].lat);
      const lng = Number.parseFloat(data[0].lon);

      // Validate coordinates are valid numbers
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        logger.warn({ rawLat: data[0].lat, rawLon: data[0].lon }, 'Invalid coordinates from Nominatim poststed');
        return null;
      }

      return {
        lat,
        lng,
        source: 'nominatim-poststed',
        quality: 'area',
        matchedAddress: data[0].display_name,
      };
    }

    return null;
  } catch (error) {
    logger.debug({ error }, 'Nominatim poststed geocoding failed');
    return null;
  }
}

// ============ Utilities ============

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if coordinates are valid (not null/undefined and within reasonable bounds)
 */
export function hasValidCoordinates(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return false;
  }
  // Check for valid Norwegian coordinates (roughly)
  // Norway: lat 57-72, lng 4-32
  return lat >= 55 && lat <= 75 && lng >= 2 && lng <= 35;
}

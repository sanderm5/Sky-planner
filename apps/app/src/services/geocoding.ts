/**
 * Geocoding Service
 * Converts addresses to coordinates using Kartverket API (primary) and Nominatim (fallback)
 * Used for automatic geocoding during customer import
 */

import { logger } from './logger';

// ============ Types ============

export interface GeocodingResult {
  lat: number;
  lng: number;
  source: 'kartverket' | 'kartverket-poststed' | 'nominatim' | 'nominatim-poststed';
  quality: 'exact' | 'street' | 'area';
  matchedAddress?: string;
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

  // Try Kartverket with full address first
  const kartverketResult = await tryKartverket(adresse, postnummer, poststed);
  if (kartverketResult) {
    return kartverketResult;
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

async function tryKartverket(
  adresse: string | undefined | null,
  postnummer: string | undefined | null,
  poststed: string | undefined | null
): Promise<GeocodingResult | null> {
  try {
    const searchText = [adresse, postnummer, poststed].filter(Boolean).join(' ');
    if (!searchText.trim()) return null;

    const url = `${KARTVERKET_API}?sok=${encodeURIComponent(searchText)}&treffPerSide=1`;
    const response = await fetch(url);

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
    const response = await fetch(url);

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
    const response = await fetch(url, {
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
    const response = await fetch(url, {
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

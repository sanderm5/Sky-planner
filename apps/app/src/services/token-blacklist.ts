/**
 * Token Blacklist Service
 * Tracks revoked JWT tokens to prevent use after logout
 *
 * Implementation: Database-backed with in-memory cache for performance
 * - Writes to database for persistence across server restarts
 * - Uses in-memory cache for fast lookups
 * - Cache is populated from database on first access
 */

import { createLogger } from './logger';
import { getDatabase } from './database';

const logger = createLogger('token-blacklist');

// In-memory cache for fast lookups
// Key: token JTI (JWT ID), Value: expiration timestamp
const cache = new Map<string, number>();

// Track if cache has been initialized from database
let cacheInitialized = false;

// Cleanup interval (every hour for database, cache cleaned on access)
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Initialize cache from database
 * Called on first access to ensure blacklisted tokens survive restarts
 */
async function initializeCacheFromDatabase(): Promise<void> {
  if (cacheInitialized) return;

  try {
    // Verify database is accessible
    await getDatabase();
    // Tokens will be checked against DB if not in cache
    cacheInitialized = true;
    logger.info('Token blacklist cache initialized');
  } catch (error) {
    logger.error({ error }, 'Failed to initialize token blacklist cache');
    cacheInitialized = true; // Prevent retry loops
  }
}

/**
 * Add a token to the blacklist
 * @param tokenId - The JWT ID (jti) or a hash of the token
 * @param expiresAt - When the token expires (Unix timestamp in seconds)
 * @param userId - Optional user ID for audit purposes
 * @param userType - Optional user type ('klient' or 'bruker')
 * @param reason - Optional reason for blacklisting (default: 'logout')
 */
export async function blacklistToken(
  tokenId: string,
  expiresAt: number,
  userId?: number,
  userType?: 'klient' | 'bruker',
  reason?: string
): Promise<void> {
  // Add to cache immediately for fast subsequent checks
  cache.set(tokenId, expiresAt);
  logger.debug({ tokenId, expiresAt }, 'Token added to cache');

  // Persist to database for durability
  try {
    const db = await getDatabase();
    await db.addToTokenBlacklist({
      jti: tokenId,
      userId: userId || 0,
      userType: userType || 'klient',
      expiresAt,
      reason,
    });
    logger.debug({ tokenId }, 'Token persisted to database blacklist');
  } catch (error) {
    logger.error({ error, tokenId }, 'Failed to persist token to database blacklist');
    // Token is still in cache, so it will be blocked for this server instance
  }
}

/**
 * Check if a token is blacklisted
 * First checks cache, then database if not found
 * @param tokenId - The JWT ID (jti) or hash to check
 * @returns true if the token is blacklisted
 */
export async function isTokenBlacklisted(tokenId: string): Promise<boolean> {
  // Initialize cache on first access
  if (!cacheInitialized) {
    await initializeCacheFromDatabase();
  }

  // Check cache first (fast path)
  if (cache.has(tokenId)) {
    return true;
  }

  // Check database (slow path, but catches tokens from before restart)
  try {
    const db = await getDatabase();
    const inDb = await db.isTokenInBlacklist(tokenId);

    if (inDb) {
      // Add to cache for future fast lookups
      // Use a default expiry of 24 hours from now if we don't know the actual expiry
      const defaultExpiry = Math.floor(Date.now() / 1000) + 86400;
      cache.set(tokenId, defaultExpiry);
      logger.debug({ tokenId }, 'Token found in database blacklist, added to cache');
    }

    return inDb;
  } catch (error) {
    logger.error({ error, tokenId }, 'Failed to check database blacklist');
    // If database check fails, return false (allow the token)
    // This is a trade-off: we prioritize availability over security in edge cases
    return false;
  }
}

/**
 * Synchronous check for backwards compatibility with existing auth middleware
 * Only checks cache - use isTokenBlacklisted for full check
 * @param tokenId - The JWT ID (jti) or hash to check
 * @returns true if the token is in the cache
 */
export function isTokenBlacklistedSync(tokenId: string): boolean {
  return cache.has(tokenId);
}

/**
 * Remove expired tokens from cache and database
 * Called periodically to prevent memory/storage growth
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  let cacheRemoved = 0;

  // Clean cache
  for (const [tokenId, expiresAt] of cache.entries()) {
    if (expiresAt < now) {
      cache.delete(tokenId);
      cacheRemoved++;
    }
  }

  // Clean database
  let dbRemoved = 0;
  try {
    const db = await getDatabase();
    dbRemoved = await db.cleanupExpiredBlacklistTokens();
  } catch (error) {
    logger.error({ error }, 'Failed to cleanup database blacklist');
  }

  if (cacheRemoved > 0 || dbRemoved > 0) {
    logger.info(
      { cacheRemoved, dbRemoved, cacheSize: cache.size },
      'Cleaned up expired blacklisted tokens'
    );
  }

  return cacheRemoved + dbRemoved;
}

/**
 * Get the current size of the cache
 */
export function getBlacklistSize(): number {
  return cache.size;
}

/**
 * Get blacklist statistics
 */
export async function getBlacklistStats(): Promise<{ cacheSize: number; dbTotal: number }> {
  let dbTotal = 0;
  try {
    const db = await getDatabase();
    const stats = await db.getBlacklistStats();
    dbTotal = stats.total;
  } catch {
    // Ignore errors
  }

  return {
    cacheSize: cache.size,
    dbTotal,
  };
}

/**
 * Clear all blacklisted tokens (for testing only)
 */
export function clearBlacklist(): void {
  cache.clear();
  logger.warn('Blacklist cache cleared');
}

// Cleanup interval management
let cleanupIntervalId: NodeJS.Timeout | null = null;

export function startCleanupInterval(): void {
  if (cleanupIntervalId) return;

  cleanupIntervalId = setInterval(() => {
    cleanupExpiredTokens().catch((error) => {
      logger.error({ error }, 'Cleanup interval failed');
    });
  }, CLEANUP_INTERVAL_MS);

  // Don't prevent process exit
  cleanupIntervalId.unref();

  logger.info('Token blacklist cleanup interval started (hourly)');
}

export function stopCleanupInterval(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    logger.info('Token blacklist cleanup interval stopped');
  }
}

// Auto-start cleanup on module load
startCleanupInterval();

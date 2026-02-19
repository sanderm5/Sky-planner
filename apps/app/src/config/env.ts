/**
 * Environment configuration with validation
 * Ensures required variables are set before startup
 */

import crypto from 'node:crypto';
import { logger } from '../services/logger';
import type { EnvConfig } from '../types';

// Required environment variables in production
const REQUIRED_IN_PRODUCTION = [
  'JWT_SECRET',
  'DATABASE_TYPE',
  'CRON_SECRET',
] as const;

// Required for Supabase
const REQUIRED_FOR_SUPABASE = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
] as const;

// Required for email notifications
const REQUIRED_FOR_EMAIL = [
  'EMAIL_HOST',
  'EMAIL_PORT',
  'EMAIL_USER',
  'EMAIL_PASS',
] as const;

function getEnvString(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    return '';
  }
  return value;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    logger.warn({ key, value }, `Invalid number for ${key}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

export function validateEnvironment(): EnvConfig {
  const isProduction = process.env.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required production variables
  if (isProduction) {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!process.env[key]) {
        errors.push(`${key} må være satt i produksjon`);
      }
    }
  }

  // Determine database type - default to supabase if credentials are available
  let databaseType = getEnvString('DATABASE_TYPE', '') as 'sqlite' | 'supabase' | '';

  // Auto-detect: if Supabase credentials exist, use supabase
  const hasSupabaseCredentials = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY;

  if (!databaseType) {
    // No explicit type set - auto-detect
    databaseType = hasSupabaseCredentials ? 'supabase' : 'sqlite';
    logger.info(`DATABASE_TYPE not set, auto-detected: ${databaseType}`);
  }

  // If sqlite is requested but we're in production, force supabase
  if (databaseType === 'sqlite' && isProduction) {
    if (hasSupabaseCredentials) {
      logger.warn('SQLite not supported in production, switching to Supabase');
      databaseType = 'supabase';
    } else {
      errors.push('SQLite støttes ikke i produksjon. Sett DATABASE_TYPE=supabase og legg til Supabase-credentials.');
    }
  }

  // Check Supabase requirements
  if (databaseType === 'supabase') {
    for (const key of REQUIRED_FOR_SUPABASE) {
      if (!process.env[key]) {
        errors.push(`${key} må være satt for Supabase`);
      }
    }
  }

  // Check backup requirements in production
  if (isProduction && databaseType === 'supabase') {
    if (!process.env.SUPABASE_SERVICE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      warnings.push('SUPABASE_SERVICE_KEY mangler — backup vil feile');
    }
    if (!process.env.BACKUP_ENCRYPTION_KEY) {
      warnings.push('BACKUP_ENCRYPTION_KEY mangler — automatisk backup er deaktivert');
    }
  }

  // Check email requirements if enabled
  const emailEnabled = getEnvBoolean('EMAIL_NOTIFICATIONS_ENABLED', false);
  if (emailEnabled) {
    for (const key of REQUIRED_FOR_EMAIL) {
      if (!process.env[key]) {
        warnings.push(`${key} anbefales for e-postvarsler`);
      }
    }
  }

  // Check JWT secret strength in production
  const jwtSecret = getEnvString('JWT_SECRET', '');
  if (isProduction && jwtSecret && jwtSecret.length < 64) {
    errors.push('JWT_SECRET må være minst 64 tegn i produksjon (HMAC-SHA256)');
  }

  // Check encryption salt in production
  if (isProduction && !process.env.ENCRYPTION_SALT) {
    errors.push('ENCRYPTION_SALT er påkrevd i produksjon');
  }

  // Log warnings
  for (const warning of warnings) {
    logger.warn(warning);
  }

  // Exit on errors in production
  if (errors.length > 0) {
    for (const error of errors) {
      logger.error(error);
    }
    if (isProduction) {
      logger.fatal('Kan ikke starte i produksjon med manglende konfigurasjon');
      process.exit(1);
    }
  }

  // Build validated config
  const config: EnvConfig = {
    PORT: getEnvNumber('PORT', 3000),
    HOST: getEnvString('HOST', '0.0.0.0'),
    NODE_ENV: (process.env.NODE_ENV || 'development') as EnvConfig['NODE_ENV'],
    DATABASE_TYPE: databaseType as 'sqlite' | 'supabase',
    // In development, generate a random secret if not provided
    // In production, throw error if not set (defense-in-depth)
    JWT_SECRET: (() => {
      if (jwtSecret) return jwtSecret;
      if (isProduction) {
        throw new Error('JWT_SECRET must be set in production');
      }
      return `dev-${crypto.randomBytes(32).toString('hex')}`;
    })(),

    // Supabase
    SUPABASE_URL: getEnvString('SUPABASE_URL'),
    SUPABASE_ANON_KEY: getEnvString('SUPABASE_ANON_KEY'),

    // Map
    MAP_CENTER_LAT: getEnvNumber('MAP_CENTER_LAT', 65.5),
    MAP_CENTER_LNG: getEnvNumber('MAP_CENTER_LNG', 12.0),
    MAP_ZOOM: getEnvNumber('MAP_ZOOM', 5),

    // Route planning
    ORS_API_KEY: getEnvString('ORS_API_KEY'),
    ENABLE_ROUTE_PLANNING: getEnvBoolean('ENABLE_ROUTE_PLANNING', true),
    ROUTE_START_LAT: process.env.ROUTE_START_LAT
      ? getEnvNumber('ROUTE_START_LAT', 69.06888)
      : undefined,
    ROUTE_START_LNG: process.env.ROUTE_START_LNG
      ? getEnvNumber('ROUTE_START_LNG', 17.65274)
      : undefined,

    // Email
    EMAIL_NOTIFICATIONS_ENABLED: emailEnabled,
    EMAIL_HOST: getEnvString('EMAIL_HOST'),
    EMAIL_PORT: getEnvNumber('EMAIL_PORT', 587),
    EMAIL_USER: getEnvString('EMAIL_USER'),
    EMAIL_PASS: getEnvString('EMAIL_PASS'),
    KLIENT_EPOST: getEnvString('KLIENT_EPOST'),

    // Web URL (marketing site / dashboard)
    WEB_URL: getEnvString('WEB_URL', 'https://skyplanner.no'),

    // Subscription
    SUBSCRIPTION_GRACE_PERIOD_DAYS: getEnvNumber('SUBSCRIPTION_GRACE_PERIOD_DAYS', 3),

    // AI Import
    AI_IMPORT_ENABLED: getEnvBoolean('AI_IMPORT_ENABLED', false),
    AI_API_KEY: getEnvString('AI_API_KEY') || getEnvString('ANTHROPIC_API_KEY'),
    AI_MODEL: getEnvString('AI_MODEL', 'claude-3-5-haiku-latest'),
    AI_TIMEOUT_MS: getEnvNumber('AI_TIMEOUT_MS', 10000),

    // Re-import Features (konservative defaults - begge av som default)
    REIMPORT_UPDATE_ENABLED: getEnvBoolean('REIMPORT_UPDATE_ENABLED', false),
    DELETION_DETECTION_ENABLED: getEnvBoolean('DELETION_DETECTION_ENABLED', false),

    // Tripletex environment (test uses api.tripletex.io, production uses tripletex.no)
    TRIPLETEX_ENV: (getEnvString('TRIPLETEX_ENV', 'production') as 'test' | 'production'),

    // Mapbox
    MAPBOX_ACCESS_TOKEN: getEnvString('MAPBOX_ACCESS_TOKEN'),

    // Encryption - require in production, fallback for dev
    ENCRYPTION_SALT: (() => {
      const salt = getEnvString('ENCRYPTION_SALT');
      if (salt) return salt;
      if (isProduction) {
        throw new Error('ENCRYPTION_SALT must be set in production');
      }
      return `dev-salt-${crypto.randomBytes(16).toString('hex')}`;
    })(),

    // Dedicated key for integration credential encryption (separate from JWT_SECRET)
    INTEGRATION_ENCRYPTION_KEY: (() => {
      const key = getEnvString('INTEGRATION_ENCRYPTION_KEY');
      if (key) return key;
      if (isProduction) {
        throw new Error('INTEGRATION_ENCRYPTION_KEY must be set in production (separate from JWT_SECRET)');
      }
      return `dev-${crypto.randomBytes(32).toString('hex')}`;
    })(),
  };

  logger.info({
    nodeEnv: config.NODE_ENV,
    databaseType: config.DATABASE_TYPE,
    port: config.PORT,
    emailEnabled: config.EMAIL_NOTIFICATIONS_ENABLED,
    routePlanningEnabled: config.ENABLE_ROUTE_PLANNING,
    aiImportEnabled: config.AI_IMPORT_ENABLED,
  }, 'Miljøkonfigurasjon lastet');

  return config;
}

// Singleton config instance
let _config: EnvConfig | null = null;

export function getConfig(): EnvConfig {
  if (!_config) {
    _config = validateEnvironment();
  }
  return _config;
}

export default getConfig;

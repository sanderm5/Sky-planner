/**
 * Sentry error monitoring service
 * Initializes Sentry for Express error tracking
 */

import * as Sentry from '@sentry/node';
import { logger } from './logger';

const SENTRY_DSN = process.env.SENTRY_DSN;

export function initSentry(): void {
  if (!SENTRY_DSN) {
    logger.info('Sentry DSN not configured, error monitoring disabled');
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    release: `skyplanner-app@${process.env.npm_package_version || '2.0.0'}`,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    beforeSend(event) {
      // Strip sensitive data from request bodies
      if (event.request?.data) {
        const data = event.request.data as Record<string, unknown>;
        const sensitiveKeys = ['passord', 'password', 'token', 'secret', 'api_key', 'apiKey'];
        for (const key of sensitiveKeys) {
          if (key in data) {
            data[key] = '[FILTERED]';
          }
        }
      }
      return event;
    },
  });

  logger.info({ environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV }, 'Sentry initialized');
}

export { Sentry };

/**
 * Structured logging service using Pino
 * Provides consistent JSON logging with request correlation
 */

import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

// Configure pino logger
export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      hostname: bindings.hostname,
      env: process.env.NODE_ENV || 'development',
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty print in development
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
});

// Child logger factory for request context
export function createRequestLogger(requestId: string, organizationId?: number) {
  return logger.child({
    requestId,
    organizationId,
  });
}

// Create a named child logger for a specific context/module
export function createLogger(context: string) {
  return logger.child({ context });
}

// Specialized loggers for different contexts
export const authLogger = logger.child({ context: 'auth' });
export const dbLogger = logger.child({ context: 'database' });
export const emailLogger = logger.child({ context: 'email' });
export const apiLogger = logger.child({ context: 'api' });

// Log level helpers
export function logError(
  log: pino.Logger,
  error: Error | unknown,
  message: string,
  extra?: Record<string, unknown>
) {
  if (error instanceof Error) {
    log.error(
      {
        err: {
          message: error.message,
          name: error.name,
          stack: isProduction ? undefined : error.stack,
        },
        ...extra,
      },
      message
    );
  } else {
    log.error({ err: error, ...extra }, message);
  }
}

export function logRequest(
  log: pino.Logger,
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  extra?: Record<string, unknown>
) {
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  log[level](
    {
      http: {
        method,
        path,
        statusCode,
        durationMs,
      },
      ...extra,
    },
    `${method} ${path} ${statusCode} ${durationMs}ms`
  );
}

export function logAudit(
  log: pino.Logger,
  action: string,
  userId: number,
  resourceType: string,
  resourceId?: number,
  details?: Record<string, unknown>
) {
  log.info(
    {
      audit: {
        action,
        userId,
        resourceType,
        resourceId,
        timestamp: new Date().toISOString(),
      },
      ...details,
    },
    `AUDIT: ${action} on ${resourceType}${resourceId ? ` #${resourceId}` : ''}`
  );
}

export default logger;

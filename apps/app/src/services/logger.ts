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

// ============ Re-import Audit Logging ============

export interface ReimportAuditDetails {
  fileName: string;
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  updateEnabled: boolean;
  notInImportCount?: number; // Kun informativt, ingen sletting
}

export function logReimportAudit(
  log: pino.Logger,
  userId: number,
  organizationId: number,
  details: ReimportAuditDetails
) {
  log.info(
    {
      audit: {
        action: 'REIMPORT_KUNDER',
        userId,
        organizationId,
        resourceType: 'kunder',
        timestamp: new Date().toISOString(),
      },
      reimport: details,
    },
    `AUDIT: Re-import - ${details.created} nye, ${details.updated} oppdatert, ${details.skipped} hoppet over`
  );
}

// ============ Database-backed Security Audit Log ============

export interface SecurityAuditEvent {
  organizationId?: number;
  userId?: number;
  userType?: 'klient' | 'bruker';
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Write a security event to the security_audit_log table.
 * Non-blocking — failures are logged but don't propagate.
 */
export async function logSecurityEvent(event: SecurityAuditEvent): Promise<void> {
  try {
    // Lazy import to avoid circular dependency
    const { getDatabase } = await import('./database');
    const db = await getDatabase();
    const supabase = (db as any).supabase ?? (db as any).client;

    if (!supabase?.from) {
      logger.debug('No supabase client for security audit logging');
      return;
    }

    await supabase.from('security_audit_log').insert({
      organization_id: event.organizationId ?? null,
      user_id: event.userId ?? null,
      user_type: event.userType ?? null,
      action: event.action,
      resource_type: event.resourceType ?? null,
      resource_id: event.resourceId ?? null,
      details: event.details ?? null,
      ip_address: event.ipAddress ?? null,
      user_agent: event.userAgent ?? null,
    });
  } catch (err) {
    // Never fail the request due to audit logging
    logger.error({ err, action: event.action }, 'Failed to write security audit log');
  }
}

export default logger;

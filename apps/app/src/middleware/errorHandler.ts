/**
 * Global error handling middleware
 * Standardizes error responses and logging
 */

import { Request, Response, NextFunction } from 'express';
import { logger, logError } from '../services/logger';
import type { AuthenticatedRequest, ApiError, ApiResponse } from '../types';

// Custom error class for API errors
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

// Common error factory functions
export const Errors = {
  notFound: (resource: string) =>
    new AppError(404, 'NOT_FOUND', `${resource} ikke funnet`),

  unauthorized: (message = 'Ikke autorisert') =>
    new AppError(401, 'UNAUTHORIZED', message),

  forbidden: (message = 'Ingen tilgang') =>
    new AppError(403, 'FORBIDDEN', message),

  badRequest: (message: string, details?: Record<string, unknown>) =>
    new AppError(400, 'BAD_REQUEST', message, details),

  validationError: (errors: Array<{ field: string; message: string }>) =>
    new AppError(400, 'VALIDATION_ERROR', 'Valideringsfeil', { errors }),

  conflict: (message: string) =>
    new AppError(409, 'CONFLICT', message),

  tooManyRequests: (message = 'For mange forespørsler') =>
    new AppError(429, 'TOO_MANY_REQUESTS', message),

  internal: (message = 'Intern serverfeil') =>
    new AppError(500, 'INTERNAL_ERROR', message),

  quotaExceeded: (resource: string, limit: number) =>
    new AppError(403, 'QUOTA_EXCEEDED', `Kvote overskredet for ${resource}. Maks: ${limit}`),

  subscriptionInactive: (
    status: string,
    message: string,
    redirectUrl: string
  ) =>
    new AppError(403, 'SUBSCRIPTION_INACTIVE', message, { status, redirectUrl }),
};

// Global error handler middleware
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const authReq = req as AuthenticatedRequest;
  const requestId = authReq.requestId || 'unknown';
  const isProduction = process.env.NODE_ENV === 'production';

  // Determine status code and error details
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'Intern serverfeil';
  let details: Record<string, unknown> | undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.code;
    message = err.message;
    details = err.details;
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = 'INVALID_TOKEN';
    message = 'Ugyldig token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'TOKEN_EXPIRED';
    message = 'Token utløpt';
  } else if (err.name === 'SyntaxError' && 'body' in err) {
    statusCode = 400;
    errorCode = 'INVALID_JSON';
    message = 'Ugyldig JSON i forespørsel';
  }

  // Log error
  logError(logger, err, `Error handling request ${req.method} ${req.path}`, {
    requestId,
    statusCode,
    errorCode,
    userId: authReq.user?.userId,
    organizationId: authReq.organizationId,
  });

  // Build error response
  const errorResponse: ApiResponse = {
    success: false,
    error: {
      code: errorCode,
      message,
      requestId,
      // Only include details if not in production or if it's validation errors
      details: !isProduction || errorCode === 'VALIDATION_ERROR' ? details : undefined,
    } as ApiError,
    requestId,
  };

  // Don't leak stack traces in production
  if (!isProduction && !(err instanceof AppError)) {
    errorResponse.error!.details = {
      ...errorResponse.error?.details,
      stack: err.stack,
    };
  }

  res.status(statusCode).json(errorResponse);
}

// 404 handler for unknown routes
export function notFoundHandler(req: Request, res: Response) {
  const authReq = req as AuthenticatedRequest;
  const requestId = authReq.requestId || 'unknown';

  const response: ApiResponse = {
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Endepunkt ikke funnet: ${req.method} ${req.path}`,
      requestId,
    },
    requestId,
  };

  res.status(404).json(response);
}

// Async handler wrapper to catch promise rejections
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: T, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

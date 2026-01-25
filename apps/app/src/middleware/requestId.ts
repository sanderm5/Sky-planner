/**
 * Request ID middleware
 * Adds unique request ID for tracing across logs
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createRequestLogger } from '../services/logger';
import type { AuthenticatedRequest } from '../types';

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();

  // Add to request object
  (req as AuthenticatedRequest).requestId = requestId;

  // Add to response headers
  res.setHeader('X-Request-ID', requestId);

  // Create request-scoped logger
  const authReq = req as AuthenticatedRequest;
  const logger = createRequestLogger(requestId, authReq.organizationId);

  // Attach logger to request for use in route handlers
  (req as AuthenticatedRequest & { log: typeof logger }).log = logger;

  next();
}

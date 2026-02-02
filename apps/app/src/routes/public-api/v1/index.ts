/**
 * Public API v1 Router
 * Aggregates all v1 public API endpoints
 */

import { Router } from 'express';
import customersRouter, { initPublicCustomersRoutes } from './customers';

const router: Router = Router();

// Re-export initialization function
export { initPublicCustomersRoutes };

// Mount customer routes
router.use('/customers', customersRouter);

// Health check for API v1
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: 'v1',
    timestamp: new Date().toISOString(),
  });
});

export default router;

/**
 * Sky Planner Server
 * Main entry point for the application
 */

import 'dotenv/config';
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { logger, logRequest } from './services/logger';
import { getConfig } from './config/env';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requireActiveSubscription, checkSubscriptionWarning } from './middleware/subscription';
import { requireTenantAuth } from './middleware/auth';
import { getDatabase, registerShutdownHandlers } from './services/database';
import authRoutes, { initAuthRoutes } from './routes/auth';
import kunderRoutes, { initKunderRoutes } from './routes/kunder';
import ruterRoutes, { initRuterRoutes } from './routes/ruter';
import avtalerRoutes, { initAvtalerRoutes } from './routes/avtaler';
import kontaktloggRoutes, { initKontaktloggRoutes } from './routes/kontaktlogg';
import emailRoutes, { initEmailRoutes } from './routes/email';
import configRoutes, { initConfigRoutes } from './routes/config';
import industriesRoutes, { initIndustryRoutes } from './routes/industries';
import teamMembersRoutes, { initTeamMembersRoutes } from './routes/team-members';
import onboardingRoutes, { initOnboardingRoutes } from './routes/onboarding';
import integrationsRoutes from './routes/integrations';
import superAdminRoutes from './routes/super-admin';
import importRoutes, { initImportRoutes } from './routes/import';
import { createImportDbService } from './services/import/database';
import apiKeysRoutes from './routes/api-keys';
import publicApiV1Routes, { initPublicCustomersRoutes } from './routes/public-api/v1';
import webhooksRoutes from './routes/webhooks';
import docsRoutes from './routes/docs';
import cronRoutes from './routes/cron';
import integrationWebhooksRoutes from './routes/integration-webhooks';
import exportRoutes, { initExportRoutes } from './routes/export';
import { csrfTokenMiddleware, csrfProtection, getCsrfTokenHandler } from './middleware/csrf';
import type { AuthenticatedRequest } from './types';

// Validate environment and get config
const config = getConfig();

// Initialize database and routes
async function initializeApp() {
  const db = await getDatabase();

  // Initialize routes with database service
  initAuthRoutes(db as Parameters<typeof initAuthRoutes>[0]);
  initKunderRoutes(db as Parameters<typeof initKunderRoutes>[0]);
  initRuterRoutes(db as Parameters<typeof initRuterRoutes>[0]);
  initAvtalerRoutes(db as Parameters<typeof initAvtalerRoutes>[0]);
  initKontaktloggRoutes(db as Parameters<typeof initKontaktloggRoutes>[0]);
  initEmailRoutes(db as Parameters<typeof initEmailRoutes>[0]);
  initConfigRoutes(db as Parameters<typeof initConfigRoutes>[0]);
  initIndustryRoutes(db as any);
  initTeamMembersRoutes(db as Parameters<typeof initTeamMembersRoutes>[0]);
  initOnboardingRoutes(db as Parameters<typeof initOnboardingRoutes>[0]);

  // Initialize import routes with dedicated import database service
  const importDbService = createImportDbService();
  initImportRoutes(importDbService);

  // Initialize public API routes
  initPublicCustomersRoutes(db as Parameters<typeof initPublicCustomersRoutes>[0]);

  // Initialize export routes
  initExportRoutes(db as Parameters<typeof initExportRoutes>[0]);

  return db;
}

// Create Express app
const app: Express = express();

// Trust proxy (for ngrok, Heroku, Vercel, etc.)
app.set('trust proxy', 1);

// ===== SECURITY MIDDLEWARE =====

// Helmet for security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://unpkg.com',
          'https://cdnjs.cloudflare.com',
          'https://api.mapbox.com',
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://unpkg.com',
          'https://cdnjs.cloudflare.com',
          'https://api.mapbox.com',
          'https://fonts.googleapis.com',
        ],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc: [
          "'self'",
          'https://api.openrouteservice.org',
          'https://*.supabase.co',
          'https://ws.geonorge.no',
          'https://nominatim.openstreetmap.org',
          'https://api.mapbox.com',
          'https://*.tiles.mapbox.com',
          'https://events.mapbox.com',
          'https://unpkg.com',
          'wss://localhost:*',
          'ws://localhost:*',
        ],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
        workerSrc: ["'self'", 'blob:'],
      },
    },
    // HSTS: Enforce HTTPS for 1 year, include subdomains, preload-ready
    hsts: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },
  })
);

// CORS - sikker konfigurasjon
// I produksjon: Krever eksplisitt ALLOWED_ORIGINS, eller fallback til skyplanner.no domener
// I development: Kun localhost-origins tillates for å forhindre CSRF via exposed dev-miljø
const SAFE_DEFAULT_ORIGINS = ['https://skyplanner.no', 'https://app.skyplanner.no', 'https://www.skyplanner.no'];
const DEV_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:4321', 'http://127.0.0.1:3000', 'http://127.0.0.1:4321'];
app.use(
  cors({
    origin: config.NODE_ENV === 'production'
      ? process.env.ALLOWED_ORIGINS?.split(',') || SAFE_DEFAULT_ORIGINS
      : DEV_ALLOWED_ORIGINS,
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Cookie parsing (required for CSRF)
app.use(cookieParser());

// CSRF token generation (ensures token is always available)
app.use(csrfTokenMiddleware);

// CSRF protection for state-changing API requests
app.use('/api', csrfProtection());

// Content-Type validation for API routes
// Reject requests with body that don't have proper Content-Type header
app.use('/api', (req, res, next): void => {
  // Only check for methods that typically have a body
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'];
    // Allow requests with JSON or form-urlencoded content, or no body
    if (req.body && Object.keys(req.body).length > 0) {
      if (!contentType || (!contentType.includes('application/json') && !contentType.includes('application/x-www-form-urlencoded'))) {
        res.status(415).json({
          success: false,
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Content-Type må være application/json eller application/x-www-form-urlencoded',
          },
        });
        return;
      }
    }
  }
  next();
});

// Request ID middleware (adds unique ID to each request)
app.use(requestIdMiddleware);

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const authReq = req as AuthenticatedRequest;

    logRequest(
      logger,
      req.method,
      req.path,
      res.statusCode,
      duration,
      {
        requestId: authReq.requestId,
        userId: authReq.user?.userId,
        organizationId: authReq.organizationId,
      }
    );
  });

  next();
});

// Rate limiting - skip for localhost in development
const isDevelopment = process.env.NODE_ENV !== 'production';
const isLocalhost = (req: express.Request) => {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 1000 : 100, // Higher limit in development
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'For mange forespørsler' } },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isDevelopment && isLocalhost(req), // Skip localhost in dev
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 100 : 10, // Higher limit in development
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'For mange innloggingsforsøk' } },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failed attempts
  skip: (req) => isDevelopment && isLocalhost(req), // Skip localhost in dev
});

// Rate limiter for sensitive actions (password reset, 2FA)
const sensitiveActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 50 : 5, // Very strict in production
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'For mange forsøk. Prøv igjen senere.' } },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isDevelopment && isLocalhost(req),
});

// Apply rate limiters
app.use('/api/', apiLimiter);
app.use('/api/klient/login', loginLimiter);
app.use('/api/bruker/login', loginLimiter);
app.use('/api/klient/reset-passord', sensitiveActionLimiter);
app.use('/api/bruker/reset-passord', sensitiveActionLimiter);
app.use('/api/klient/2fa', sensitiveActionLimiter);
app.use('/api/bruker/2fa', sensitiveActionLimiter);

// ===== STATIC FILES =====
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// ===== API ROUTES =====
app.use('/api/klient', authRoutes);

// ===== SUBSCRIPTION-PROTECTED ROUTES =====
// These routes require an active subscription (trial, paid, or grace period)
// Auth is checked first, then subscription status
app.use('/api/kunder', requireTenantAuth, requireActiveSubscription, checkSubscriptionWarning, kunderRoutes);
app.use('/api/ruter', requireTenantAuth, requireActiveSubscription, checkSubscriptionWarning, ruterRoutes);
app.use('/api/avtaler', requireTenantAuth, requireActiveSubscription, checkSubscriptionWarning, avtalerRoutes);
app.use('/api/team-members', requireTenantAuth, requireActiveSubscription, checkSubscriptionWarning, teamMembersRoutes);
app.use('/api/onboarding', requireTenantAuth, onboardingRoutes);

// ===== OTHER API ROUTES =====
app.use('/api', kontaktloggRoutes);  // Routes include /kunder/:id/kontaktlogg and /kontaktlogg/:id
app.use('/api/email', emailRoutes);
app.use('/api', configRoutes);  // Routes include /config and /routes/*
app.use('/api/industries', industriesRoutes);
app.use('/api/integrations', requireTenantAuth, requireActiveSubscription, integrationsRoutes);

// Import routes (Excel import with staging)
app.use('/api/import', requireTenantAuth, requireActiveSubscription, importRoutes);

// Export routes (data export for GDPR compliance)
app.use('/api/export', requireTenantAuth, requireActiveSubscription, exportRoutes);

// Super admin routes (no tenant auth - super admin can access all orgs)
app.use('/api/super-admin', superAdminRoutes);

// API key management routes (admin only)
app.use('/api/api-keys', apiKeysRoutes);

// Webhook management routes (supports both API key and JWT auth)
app.use('/api/webhooks', webhooksRoutes);

// Public API v1 (supports both API key and JWT auth)
app.use('/api/v1', publicApiV1Routes);

// API Documentation (public)
app.use('/api/docs', docsRoutes);

// Cron endpoints (protected by CRON_SECRET)
app.use('/api/cron', cronRoutes);

// Incoming integration webhooks (from Tripletex, etc. - verified by provider, no JWT)
app.use('/api/integration-webhooks', integrationWebhooksRoutes);

// Health check endpoint (basic - for load balancers)
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      environment: config.NODE_ENV,
    },
  });
});

// Detailed health check (for monitoring systems)
app.get('/api/health/detailed', async (_req, res) => {
  const startTime = Date.now();
  const checks: Record<string, { status: 'healthy' | 'unhealthy' | 'degraded'; latency_ms?: number; error?: string }> = {};
  let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

  // Database check
  try {
    const dbStart = Date.now();
    const db = await getDatabase();
    // Try a simple query to verify connectivity
    if ('supabase' in db && (db as any).supabase) {
      const { error } = await (db as any).supabase.from('organizations').select('id').limit(1);
      if (error) throw error;
    }
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart };
  } catch (error) {
    checks.database = {
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Database connection failed',
    };
    overallStatus = 'unhealthy';
  }

  // Memory check
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
  const memoryPercentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  if (memoryPercentage > 90) {
    checks.memory = { status: 'unhealthy', error: `High memory usage: ${memoryPercentage.toFixed(1)}%` };
    overallStatus = 'unhealthy';
  } else if (memoryPercentage > 75) {
    checks.memory = { status: 'degraded', error: `Elevated memory usage: ${memoryPercentage.toFixed(1)}%` };
    if (overallStatus === 'healthy') overallStatus = 'degraded';
  } else {
    checks.memory = { status: 'healthy' };
  }

  // Uptime check
  const uptimeSeconds = Math.floor(process.uptime());
  checks.uptime = { status: 'healthy' };

  const totalLatency = Date.now() - startTime;

  res.status(overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503).json({
    success: overallStatus !== 'unhealthy',
    data: {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: '2.0.0',
      environment: config.NODE_ENV,
      uptime_seconds: uptimeSeconds,
      memory: {
        heap_used_mb: heapUsedMB,
        heap_total_mb: heapTotalMB,
        percentage: Math.round(memoryPercentage),
      },
      checks,
      total_latency_ms: totalLatency,
    },
  });
});

// CSRF token endpoint (for clients that need to fetch the token explicitly)
app.get('/api/csrf-token', getCsrfTokenHandler);

// ===== ADMIN PANEL ROUTE =====
// Serve admin.html - auth is handled client-side by admin.js
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicPath, 'admin.html'));
});

// ===== SPA FALLBACK =====
app.get('*', (req, res) => {
  // Don't serve index.html for API routes
  if (req.path.startsWith('/api/')) {
    return notFoundHandler(req, res);
  }
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ===== ERROR HANDLING =====
app.use(notFoundHandler);
app.use(errorHandler);

// ===== START SERVER =====
const PORT = config.PORT;

// Initialize and start
initializeApp()
  .then(() => {
    // Register graceful shutdown handlers for database cleanup
    registerShutdownHandlers();

    app.listen(PORT, config.HOST, () => {
      logger.info({
        host: config.HOST,
        port: PORT,
        environment: config.NODE_ENV,
        database: config.DATABASE_TYPE,
      }, `Server startet på ${config.HOST}:${PORT}`);
    });
  })
  .catch((error) => {
    logger.fatal({ error }, 'Failed to initialize application');
    process.exit(1);
  });

export default app;

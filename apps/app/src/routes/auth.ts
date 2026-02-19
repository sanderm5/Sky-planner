/**
 * Authentication routes
 * Handles login, logout, and session management
 */

import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authLogger, logAudit, logSecurityEvent } from '../services/logger';
import { generateToken, extractToken, getTokenId, requireAuth } from '../middleware/auth';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { validateLoginRequest } from '../utils/validation';
import { getConfig } from '../config/env';
import { blacklistToken, isTokenBlacklisted } from '../services/token-blacklist';
import { getCookieConfig, buildSetCookieHeader, buildClearCookieHeader } from '@skyplanner/auth';
import type { AuthenticatedRequest, JWTPayload, ApiResponse } from '../types';

const router: Router = Router();

// Session durations
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const REMEMBER_ME_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Dummy hash for timing attack prevention
// This hash is compared against when user doesn't exist to ensure consistent response time
const DUMMY_PASSWORD_HASH = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.Og6Dqw.V0SrleW';

// Database service interface (will be injected)
interface DatabaseService {
  getKlientByEpost(epost: string): Promise<KlientRecord | null>;
  getBrukerByEpost(epost: string): Promise<BrukerRecord | null>;
  updateKlientLastLogin(id: number): Promise<void>;
  updateBrukerLastLogin(id: number): Promise<void>;
  getOrganizationById(id: number): Promise<OrganizationRecord | null>;
  logLoginAttempt(data: LoginAttemptData): Promise<void>;
  getAllKunder(organizationId: number): Promise<KundeRecord[]>;
  createSession(data: {
    userId: number;
    userType: 'klient' | 'bruker';
    jti: string;
    ipAddress?: string;
    userAgent?: string;
    deviceInfo?: string;
    expiresAt: Date;
  }): Promise<void>;
  deleteSessionByJti(jti: string): Promise<boolean>;
  countRecentFailedLogins?(epost: string, windowMinutes: number): Promise<number>;
  recordLoginAttempt?(epost: string, ipAddress: string, success: boolean): Promise<void>;
}

interface KundeRecord {
  id: number;
  navn: string;
  adresse?: string;
  poststed?: string;
  kategori?: string;
  neste_el_kontroll?: string;
  neste_brann_kontroll?: string;
  neste_kontroll?: string;
}

interface KlientRecord {
  id: number;
  navn: string;
  epost: string;
  passord_hash: string;
  telefon?: string;
  adresse?: string;
  postnummer?: string;
  poststed?: string;
  rolle?: string;
  organization_id?: number;
  aktiv: boolean;
}

interface BrukerRecord {
  id: number;
  navn: string;
  epost: string;
  passord_hash: string;
  rolle?: string;
  organization_id?: number;
  aktiv: boolean;
  is_super_admin?: boolean;
}

interface OrganizationRecord {
  id: number;
  navn: string;
  slug: string;
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  brand_title?: string;
  brand_subtitle?: string;
  onboarding_completed?: boolean;
  industry_template_id?: number | null;
  plan_type?: 'free' | 'standard' | 'premium' | 'enterprise';
  subscription_status?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
  trial_ends_at?: string;
  current_period_end?: string;
  app_mode?: 'mvp' | 'full';
}

interface LoginAttemptData {
  epost: string;
  bruker_navn?: string;
  bruker_type?: string;
  status: 'vellykket' | 'feilet';
  ip_adresse: string;
  user_agent: string;
  feil_melding?: string;
}

// Email service interface
interface EmailService {
  isEmailConfigured(): boolean;
  sendEmail(to: string, subject: string, html: string): Promise<void>;
}

/**
 * Parse user-agent string into a human-readable device description
 */
function parseDeviceInfo(ua: string): string {
  if (!ua) return 'Ukjent enhet';
  let browser = 'Ukjent nettleser';
  if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';

  let os = 'Ukjent OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS X') || ua.includes('Macintosh')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  return `${browser} på ${os}`;
}

// Dependencies (injected when routes are mounted)
let dbService: DatabaseService;
let emailService: EmailService | null = null;

/**
 * Initialize auth routes with dependencies
 */
export function initAuthRoutes(
  databaseService: DatabaseService,
  email?: EmailService
): Router {
  dbService = databaseService;
  emailService = email || null;
  return router;
}

/**
 * POST /api/klient/login
 * Authenticates a user and returns a JWT token
 */
router.post(
  '/login',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { epost, passord, rememberMe } = req.body;

    // Validate input
    const validationErrors = validateLoginRequest(epost, passord);
    if (validationErrors) {
      throw Errors.validationError(validationErrors);
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'Ukjent';
    const userAgent = req.headers['user-agent'] || 'Ukjent';

    // Account-level lockout check (prevents distributed brute-force from multiple IPs)
    if (dbService.countRecentFailedLogins) {
      const ACCOUNT_LOCKOUT_MAX = 10;
      const ACCOUNT_LOCKOUT_WINDOW = 30; // minutes
      const recentFailures = await dbService.countRecentFailedLogins(epost, ACCOUNT_LOCKOUT_WINDOW);
      if (recentFailures >= ACCOUNT_LOCKOUT_MAX) {
        logSecurityEvent({ action: 'account_locked', details: { epost, recentFailures }, ipAddress: ip, userAgent });
        throw Errors.tooManyRequests(`Kontoen er midlertidig låst. Prøv igjen om ${ACCOUNT_LOCKOUT_WINDOW} minutter.`);
      }
    }

    // Check klient table first
    let user: KlientRecord | BrukerRecord | null = await dbService.getKlientByEpost(epost);
    let userType: 'klient' | 'bruker' = 'klient';

    // If not found, check brukere (admin) table
    if (!user) {
      try {
        user = await dbService.getBrukerByEpost(epost);
        if (user) userType = 'bruker';
      } catch {
        // brukere table might not exist, ignore
        authLogger.debug('brukere table check failed (might not exist)');
      }
    }

    // Always run bcrypt.compare to prevent timing attacks
    // If user doesn't exist, compare against dummy hash to ensure consistent response time
    const hashToCompare = user?.passord_hash || DUMMY_PASSWORD_HASH;
    const passwordMatch = await bcrypt.compare(passord, hashToCompare);

    if (!user) {
      // Log failed attempt
      await dbService.logLoginAttempt({
        epost,
        status: 'feilet',
        ip_adresse: ip,
        user_agent: userAgent,
        feil_melding: 'Bruker ikke funnet',
      });
      logSecurityEvent({ action: 'login_failed', details: { epost, reason: 'user_not_found' }, ipAddress: ip, userAgent });
      dbService.recordLoginAttempt?.(epost, ip, false).catch(() => {});
      throw Errors.unauthorized('Feil e-post eller passord');
    }

    if (!passwordMatch) {
      await dbService.logLoginAttempt({
        epost,
        bruker_navn: user.navn,
        bruker_type: userType,
        status: 'feilet',
        ip_adresse: ip,
        user_agent: userAgent,
        feil_melding: 'Feil passord',
      });
      logSecurityEvent({ action: 'login_failed', userId: user.id, userType, organizationId: user.organization_id, details: { reason: 'wrong_password' }, ipAddress: ip, userAgent });
      dbService.recordLoginAttempt?.(epost, ip, false).catch(() => {});
      throw Errors.unauthorized('Feil e-post eller passord');
    }

    // Check if user is deactivated
    if (!user.aktiv) {
      await dbService.logLoginAttempt({
        epost,
        bruker_navn: user.navn,
        bruker_type: userType,
        status: 'feilet',
        ip_adresse: ip,
        user_agent: userAgent,
        feil_melding: 'Bruker deaktivert',
      });
      throw Errors.forbidden('Brukeren din er deaktivert. Kontakt administrator for å reaktivere kontoen.');
    }

    // Update last login
    if (userType === 'klient') {
      await dbService.updateKlientLastLogin(user.id);
    } else {
      await dbService.updateBrukerLastLogin(user.id);
    }

    // Fetch organization data
    let organization: OrganizationRecord | null = null;
    if (user.organization_id) {
      organization = await dbService.getOrganizationById(user.organization_id);
    }

    // Generate JWT token
    const sessionDuration = rememberMe ? '30d' : '24h';
    const tokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: user.id,
      epost: user.epost,
      organizationId: user.organization_id,
      organizationSlug: organization?.slug,
      type: userType,
      subscriptionStatus: organization?.subscription_status,
      subscriptionPlan: organization?.plan_type,
      trialEndsAt: organization?.trial_ends_at,
      currentPeriodEnd: organization?.current_period_end,
    };
    const token = generateToken(tokenPayload, sessionDuration);

    // Calculate expiry timestamp
    const expiresAt = Date.now() + (rememberMe ? REMEMBER_ME_DURATION_MS : SESSION_DURATION_MS);

    // Log successful login
    await dbService.logLoginAttempt({
      epost,
      bruker_navn: user.navn,
      bruker_type: userType,
      status: 'vellykket',
      ip_adresse: ip,
      user_agent: userAgent,
    });
    dbService.recordLoginAttempt?.(epost, ip, true).catch(() => {});

    // Track active session (await to ensure session exists before token is used)
    const decoded = jwt.decode(token) as JWTPayload;
    if (decoded?.jti) {
      const deviceInfo = parseDeviceInfo(userAgent);
      try {
        await dbService.createSession({
          userId: user.id,
          userType,
          jti: decoded.jti,
          ipAddress: ip,
          userAgent,
          deviceInfo,
          expiresAt: new Date(expiresAt),
        });
      } catch (err) {
        authLogger.error({ err }, 'Failed to create session record');
        // Alert operations - session management may be degraded
        import('../services/alerts').then(({ sendAlert }) =>
          sendAlert({
            title: 'Session tracking failure',
            message: `Failed to create session record for user ${user.id}. Active session management may be incomplete.`,
            severity: 'warning',
            source: 'auth',
          }).catch(() => {})
        ).catch(() => {});
      }
    }

    // Audit log
    logAudit(authLogger, 'LOGIN', user.id, 'user', user.id, {
      userType,
      organizationId: user.organization_id,
    });
    logSecurityEvent({ action: 'login_success', userId: user.id, userType, organizationId: user.organization_id, ipAddress: ip, userAgent });

    // Send login notification email (async, don't wait)
    sendLoginNotification(user, userType, ip, userAgent)
      .catch(err => authLogger.error({ err }, 'Failed to send login notification'));

    // Build response
    const response: ApiResponse = {
      success: true,
      data: {
        token,
        expiresAt,
        klient: {
          id: user.id,
          navn: user.navn,
          epost: user.epost,
          telefon: (user as KlientRecord).telefon,
          adresse: (user as KlientRecord).adresse,
          postnummer: (user as KlientRecord).postnummer,
          poststed: (user as KlientRecord).poststed,
          rolle: userType === 'bruker' ? 'admin' : (user.rolle || 'klient'),
          type: userType,
          organizationId: user.organization_id || null,
          organizationSlug: organization?.slug || null,
          organizationName: organization?.navn || null,
        },
        organization: organization
          ? {
              id: organization.id,
              navn: organization.navn,
              slug: organization.slug,
              logoUrl: organization.logo_url,
              primaryColor: organization.primary_color,
              secondaryColor: organization.secondary_color,
              brandTitle: organization.brand_title,
              brandSubtitle: organization.brand_subtitle,
              onboardingCompleted: organization.onboarding_completed ?? false,
              industryTemplateId: organization.industry_template_id ?? null,
              appMode: organization.app_mode ?? 'mvp',
              subscriptionStatus: organization.subscription_status ?? null,
              trialEndsAt: organization.trial_ends_at ?? null,
              planType: organization.plan_type ?? null,
            }
          : null,
      },
      requestId: req.requestId,
    };

    // Set httpOnly auth cookie (secure alternative to localStorage)
    const isProduction = getConfig().NODE_ENV === 'production';
    const cookieConfig = getCookieConfig(isProduction);
    const cookieHeader = buildSetCookieHeader(token, cookieConfig.options);
    res.setHeader('Set-Cookie', cookieHeader);

    res.json(response);
  })
);

/**
 * GET /api/klient/dashboard
 * Returns dashboard data for the authenticated user
 */
router.get(
  '/dashboard',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const user = req.user!;

    // Get klient info if user is a klient
    let klient: KlientRecord | null = null;
    if (user.type === 'klient') {
      klient = await dbService.getKlientByEpost(user.epost);
    }

    // Get all customers for the organization
    let kunder: KundeRecord[] = [];
    if (user.organizationId) {
      kunder = await dbService.getAllKunder(user.organizationId);
    }

    // Helper to get Norwegian date (without time)
    const getNorwegianToday = (): Date => {
      const now = new Date();
      const norwayTime = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Oslo' }));
      norwayTime.setHours(0, 0, 0, 0);
      return norwayTime;
    };

    // Helper to parse date string as local date
    const parseLocalDate = (dateStr: string | undefined): Date | null => {
      if (!dateStr) return null;
      const [y, m, d] = dateStr.split('-').map(Number);
      return new Date(y, m - 1, d);
    };

    // Helper to get next control date (check all date fields)
    const getNextControlDate = (k: KundeRecord): Date | null => {
      const dates = [k.neste_el_kontroll, k.neste_brann_kontroll, k.neste_kontroll]
        .filter(Boolean)
        .map(d => parseLocalDate(d))
        .filter((d): d is Date => d !== null);
      if (dates.length === 0) return null;
      return new Date(Math.min(...dates.map(d => d.getTime())));
    };

    const today = getNorwegianToday();
    const currentMonthValue = today.getFullYear() * 12 + today.getMonth();

    // Calculate forfalt (overdue) - kun når kontrollens måned er passert
    const forfalt = kunder.filter(k => {
      const nextDate = getNextControlDate(k);
      if (!nextDate) return false;
      const controlMonthValue = nextDate.getFullYear() * 12 + nextDate.getMonth();
      return controlMonthValue < currentMonthValue;
    });

    // Calculate upcoming controls (within 30 days)
    const kommendeKontroller = kunder.filter(k => {
      const nextDate = getNextControlDate(k);
      if (!nextDate) return false;
      const daysUntil = Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return daysUntil >= 0 && daysUntil <= 30;
    });

    // Check if user is admin
    const isAdmin = user.type === 'bruker' || klient?.rolle === 'admin';

    const response: ApiResponse = {
      success: true,
      data: {
        klient: {
          id: user.userId,
          navn: klient?.navn || user.epost,
          epost: klient?.epost || user.epost,
          telefon: klient?.telefon,
          adresse: klient?.adresse,
          postnummer: klient?.postnummer,
          poststed: klient?.poststed,
          rolle: isAdmin ? 'admin' : (klient?.rolle || 'klient'),
          type: user.type,
        },
        sessionExpiresAt: user.exp ? user.exp * 1000 : undefined,
        stats: {
          totaltKunder: kunder.length,
          forfalt: forfalt.length,
          kommendeKontroller: kommendeKontroller.length,
        },
        kommendeKontroller: kommendeKontroller.slice(0, 10).map(k => ({
          id: k.id,
          navn: k.navn,
          adresse: k.adresse,
          poststed: k.poststed,
          kategori: k.kategori,
          neste_kontroll: k.neste_el_kontroll || k.neste_brann_kontroll || k.neste_kontroll,
        })),
        forfalt: forfalt.slice(0, 5).map(k => ({
          id: k.id,
          navn: k.navn,
          adresse: k.adresse,
          poststed: k.poststed,
          kategori: k.kategori,
          neste_kontroll: k.neste_el_kontroll || k.neste_brann_kontroll || k.neste_kontroll,
        })),
        historikk: [], // TODO: Add kontroll_historikk when table exists
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/klient/logout
 * Invalidates the current session by blacklisting the token
 */
router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Add token to blacklist to prevent reuse
    const tokenId = getTokenId(req.user!);
    const expiresAt = req.user!.exp || Math.floor(Date.now() / 1000) + 86400; // Default 24h

    await blacklistToken(tokenId, expiresAt, req.user!.userId, req.user!.type, 'logout');
    dbService.deleteSessionByJti(tokenId)
      .catch(err => authLogger.error({ err }, 'Failed to delete session record'));
    logAudit(authLogger, 'LOGOUT', req.user!.userId, 'user', req.user!.userId);
    logSecurityEvent({ action: 'logout', userId: req.user!.userId, userType: req.user!.type, organizationId: req.user!.organizationId });

    // Clear httpOnly auth cookie
    const isProduction = getConfig().NODE_ENV === 'production';
    res.setHeader('Set-Cookie', buildClearCookieHeader(isProduction));

    const response: ApiResponse = {
      success: true,
      data: { message: 'Logget ut' },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/klient/verify
 * Verifies the current token is valid (from header or SSO cookie)
 * Returns a fresh token for localStorage if valid
 */
router.get(
  '/verify',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const config = getConfig();
    const token = extractToken(req);

    if (!token) {
      res.json({
        success: true,
        data: { valid: false },
        requestId: req.requestId,
      });
      return;
    }

    try {
      const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as JWTPayload;

      // Check if token has been blacklisted (logout)
      const tokenId = getTokenId(decoded);
      const blacklisted = await isTokenBlacklisted(tokenId);
      if (blacklisted) {
        res.json({
          success: true,
          data: { valid: false, reason: 'token_revoked' },
          requestId: req.requestId,
        });
        return;
      }

      // Fetch fresh user data
      let user: KlientRecord | BrukerRecord | null = null;
      if (decoded.type === 'klient') {
        user = await dbService.getKlientByEpost(decoded.epost);
      } else {
        user = await dbService.getBrukerByEpost(decoded.epost);
      }

      if (!user || !user.aktiv) {
        res.json({
          success: true,
          data: { valid: false, reason: 'inactive' },
          requestId: req.requestId,
        });
        return;
      }

      // Fetch organization data
      let organization: OrganizationRecord | null = null;
      if (decoded.organizationId) {
        organization = await dbService.getOrganizationById(decoded.organizationId);
      }

      // Generate a fresh token for localStorage (for subsequent API calls)
      const freshToken = generateToken({
        userId: decoded.userId,
        epost: decoded.epost,
        organizationId: decoded.organizationId,
        organizationSlug: decoded.organizationSlug,
        type: decoded.type,
        subscriptionStatus: organization?.subscription_status,
        subscriptionPlan: organization?.plan_type,
        trialEndsAt: organization?.trial_ends_at,
        currentPeriodEnd: organization?.current_period_end,
      }, '24h');

      // Check if user is super admin (only for bruker type)
      const brukerRecord = user as BrukerRecord;
      authLogger.debug({
        userId: user.id,
        userType: decoded.type,
        is_super_admin_raw: brukerRecord.is_super_admin,
        is_super_admin_type: typeof brukerRecord.is_super_admin,
      }, 'Verify: checking super admin status');
      const isSuperAdmin = decoded.type === 'bruker' && brukerRecord.is_super_admin === true;

      res.json({
        success: true,
        data: {
          valid: true,
          token: freshToken,
          user: {
            id: user.id,
            navn: user.navn,
            epost: user.epost,
            type: decoded.type,
            organizationId: decoded.organizationId,
            organizationSlug: decoded.organizationSlug,
            isSuperAdmin,
          },
          organization: organization
            ? {
                id: organization.id,
                navn: organization.navn,
                slug: organization.slug,
                logoUrl: organization.logo_url,
                primaryColor: organization.primary_color,
                secondaryColor: organization.secondary_color,
                brandTitle: organization.brand_title,
                brandSubtitle: organization.brand_subtitle,
                onboardingCompleted: organization.onboarding_completed ?? false,
                industryTemplateId: organization.industry_template_id ?? null,
                appMode: organization.app_mode ?? 'mvp',
                subscriptionStatus: organization.subscription_status ?? null,
                trialEndsAt: organization.trial_ends_at ?? null,
                planType: organization.plan_type ?? null,
              }
            : null,
        },
        requestId: req.requestId,
      });
    } catch {
      res.json({
        success: true,
        data: { valid: false, reason: 'invalid_token' },
        requestId: req.requestId,
      });
    }
  })
);

/**
 * Helper: Send login notification email
 */
async function sendLoginNotification(
  user: KlientRecord | BrukerRecord,
  userType: string,
  ip: string,
  userAgent: string
): Promise<void> {
  const config = getConfig();
  const notifyEmail = process.env.LOGIN_NOTIFY_EMAIL || config.EMAIL_USER;

  if (!notifyEmail || !emailService?.isEmailConfigured()) {
    return;
  }

  try {
    const now = new Date().toLocaleString('nb-NO', { timeZone: 'Europe/Oslo' });
    const subject = `Innlogging: ${user.navn} (${userType})`;
    const message = `
      <h2>Ny innlogging på TREkontroll</h2>
      <p><strong>Bruker:</strong> ${user.navn}</p>
      <p><strong>E-post:</strong> ${user.epost}</p>
      <p><strong>Type:</strong> ${userType}</p>
      <p><strong>Tidspunkt:</strong> ${now}</p>
      <p><strong>IP-adresse:</strong> ${ip}</p>
      <p><strong>Enhet:</strong> ${userAgent ? userAgent.substring(0, 100) : 'Ukjent'}</p>
    `;

    await emailService.sendEmail(notifyEmail, subject, message);
  } catch (error) {
    authLogger.warn({ error }, 'Login notification email failed');
  }
}

export default router;

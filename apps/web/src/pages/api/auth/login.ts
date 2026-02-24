import type { APIRoute } from 'astro';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import type { JWTPayload } from '@skyplanner/auth';

// Whitelist for tillatte redirect-URLer (kun interne paths)
const ALLOWED_REDIRECTS = new Set(['/dashboard', '/settings', '/fakturaer', '/abonnement', '/brukere', '/organisasjon']);

// Dummy hash for timing attack prevention
// This hash is compared against when user doesn't exist to ensure consistent response time
const DUMMY_PASSWORD_HASH = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.Og6Dqw.V0SrleW';

/**
 * Validates redirect URL to prevent open redirect attacks
 * Only allows exact matches from whitelist or paths starting with whitelist entries followed by /
 */
function isValidRedirect(requestedPath: string): boolean {
  if (!requestedPath || typeof requestedPath !== 'string') {
    return false;
  }

  // Normalize the path - remove any protocol/host attempts
  const normalized = requestedPath.replace(/^https?:\/\/[^/]+/, '');

  // Must start with /
  if (!normalized.startsWith('/')) {
    return false;
  }

  // Block path traversal attempts
  if (normalized.includes('..') || normalized.includes('//')) {
    return false;
  }

  // Check exact match first
  if (ALLOWED_REDIRECTS.has(normalized)) {
    return true;
  }

  // Check if path starts with allowed prefix followed by / or query string
  for (const allowed of ALLOWED_REDIRECTS) {
    if (normalized.startsWith(allowed + '/') || normalized.startsWith(allowed + '?')) {
      return true;
    }
  }

  return false;
}

// Rate limiting for login attempts with exponential backoff - in-memory store
// For production, consider using Redis for distributed rate limiting
interface LoginAttemptRecord {
  count: number;
  lockoutUntil: number;
  firstAttempt: number;
}

const loginAttempts = new Map<string, LoginAttemptRecord>();

// Exponential lockout durations in milliseconds
// After each failed attempt, the lockout period increases
const LOCKOUT_DURATIONS = [
  0,                    // 1st attempt: no lockout
  0,                    // 2nd attempt: no lockout
  60 * 1000,            // 3rd attempt: 1 minute
  5 * 60 * 1000,        // 4th attempt: 5 minutes
  15 * 60 * 1000,       // 5th attempt: 15 minutes
  60 * 60 * 1000,       // 6th attempt: 1 hour
  24 * 60 * 60 * 1000,  // 7th+ attempt: 24 hours
];

// Window after which failed attempts are forgotten (24 hours)
const ATTEMPT_RESET_WINDOW = 24 * 60 * 60 * 1000;

/**
 * Get lockout duration based on attempt count (exponential backoff)
 */
function getLockoutDuration(attemptCount: number): number {
  if (attemptCount <= 0) return 0;
  const index = Math.min(attemptCount - 1, LOCKOUT_DURATIONS.length - 1);
  return LOCKOUT_DURATIONS[index];
}

/**
 * Check if IP is rate limited for login attempts
 */
function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfter?: number; attemptCount?: number } {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  // Cleanup old entries periodically (1% chance per request)
  if (Math.random() < 0.01) {
    for (const [key, value] of loginAttempts.entries()) {
      // Remove records older than reset window with no active lockout
      if (now - value.firstAttempt > ATTEMPT_RESET_WINDOW && now >= value.lockoutUntil) {
        loginAttempts.delete(key);
      }
    }
  }

  if (!record) {
    return { allowed: true, attemptCount: 0 };
  }

  // Reset if attempt window has passed
  if (now - record.firstAttempt > ATTEMPT_RESET_WINDOW) {
    loginAttempts.delete(ip);
    return { allowed: true, attemptCount: 0 };
  }

  // Check if still in lockout
  if (now < record.lockoutUntil) {
    const retryAfter = Math.ceil((record.lockoutUntil - now) / 1000);
    return { allowed: false, retryAfter, attemptCount: record.count };
  }

  return { allowed: true, attemptCount: record.count };
}

/**
 * Record a failed login attempt and apply exponential backoff
 */
function recordFailedLogin(ip: string): { lockoutDuration: number; attemptCount: number } {
  const now = Date.now();
  let record = loginAttempts.get(ip);

  if (!record) {
    record = { count: 1, lockoutUntil: 0, firstAttempt: now };
    loginAttempts.set(ip, record);
  } else {
    record.count++;
  }

  // Calculate lockout duration based on attempt count
  const lockoutDuration = getLockoutDuration(record.count);

  if (lockoutDuration > 0) {
    record.lockoutUntil = now + lockoutDuration;
  }

  return { lockoutDuration, attemptCount: record.count };
}

/**
 * Clear login attempts on successful login
 */
function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

/**
 * Format lockout duration for user-friendly message
 */
function formatLockoutMessage(retryAfter: number): string {
  const minutes = Math.ceil(retryAfter / 60);
  const hours = Math.ceil(retryAfter / 3600);

  if (retryAfter < 60) {
    return `${retryAfter} sekund${retryAfter === 1 ? '' : 'er'}`;
  } else if (retryAfter < 3600) {
    return `${minutes} minutt${minutes === 1 ? '' : 'er'}`;
  } else {
    return `${hours} time${hours === 1 ? '' : 'r'}`;
  }
}

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

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Get client IP for rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'unknown';

  // Check rate limit with exponential backoff
  const rateLimit = checkLoginRateLimit(ip);
  if (!rateLimit.allowed) {
    const lockoutMessage = formatLockoutMessage(rateLimit.retryAfter || 60);
    return new Response(
      JSON.stringify({
        error: `For mange innloggingsforsøk. Prøv igjen om ${lockoutMessage}.`,
        attemptCount: rateLimit.attemptCount,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.retryAfter || 60),
        },
      }
    );
  }

  // Validate environment at request time (not module load)
  const JWT_SECRET = import.meta.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.error('JWT_SECRET not configured');
    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Innlogging er midlertidig utilgjengelig' } }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const isProduction = import.meta.env.PROD;

  // Initialize database client
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

  try {
    const body = await request.json();
    const { epost, passord } = body;

    if (!epost || !passord) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'E-post og passord er påkrevd' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Account-level lockout check (prevents distributed brute-force from multiple IPs)
    const supabaseForLockout = db.getSupabaseClient();
    const ACCOUNT_LOCKOUT_MAX_ATTEMPTS = 10;
    const ACCOUNT_LOCKOUT_WINDOW_MINUTES = 30;
    const lockoutWindowStart = new Date(Date.now() - ACCOUNT_LOCKOUT_WINDOW_MINUTES * 60 * 1000).toISOString();

    const { count: recentFailures } = await supabaseForLockout
      .from('login_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('epost', epost.toLowerCase())
      .eq('success', false)
      .gte('attempted_at', lockoutWindowStart);

    if (recentFailures && recentFailures >= ACCOUNT_LOCKOUT_MAX_ATTEMPTS) {
      return new Response(
        JSON.stringify({
          error: `For mange innloggingsforsøk. Prøv igjen senere, eller bruk «Glemt passord» for å tilbakestille.`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(ACCOUNT_LOCKOUT_WINDOW_MINUTES * 60),
          },
        }
      );
    }

    // Check klient table first, then brukere table
    let user: { id: number; navn: string; epost: string; passord_hash: string; aktiv: boolean; organization_id?: number } | null = null;
    let userType: 'klient' | 'bruker' = 'klient';

    const klient = await db.getKlientByEmail(epost.toLowerCase());
    if (klient) {
      user = klient;
      userType = 'klient';
    } else {
      // Check brukere table
      const bruker = await db.getBrukerByEmail(epost.toLowerCase());
      if (bruker) {
        user = bruker;
        userType = 'bruker';
      }
    }

    // Always run bcrypt.compare to prevent timing attacks
    // If user doesn't exist, compare against dummy hash to ensure consistent response time
    const hashToCompare = user?.passord_hash || DUMMY_PASSWORD_HASH;
    const passwordValid = await bcrypt.compare(passord, hashToCompare);

    if (!user) {
      recordFailedLogin(ip);
      // Record failed attempt in DB for account-level lockout
      supabaseForLockout.from('login_attempts').insert({
        epost: epost.toLowerCase(), ip_address: ip, success: false,
      }).then(() => {}, () => {});
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Feil e-post eller passord' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!user.aktiv) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Kontoen er deaktivert' } }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!passwordValid) {
      recordFailedLogin(ip);
      // Record failed attempt in DB for account-level lockout
      supabaseForLockout.from('login_attempts').insert({
        epost: epost.toLowerCase(), ip_address: ip, success: false,
      }).then(() => {}, () => {});
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Feil e-post eller passord' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Login successful - clear rate limit counter and record success
    clearLoginAttempts(ip);
    supabaseForLockout.from('login_attempts').insert({
      epost: epost.toLowerCase(), ip_address: ip, success: true,
    }).then(() => {}, () => {});

    // Check if user has 2FA enabled
    const supabase = db.getSupabaseClient();
    const tableName = userType === 'klient' ? 'klient' : 'brukere';
    const { data: totpData } = await supabase
      .from(tableName)
      .select('totp_enabled')
      .eq('id', user.id)
      .single();

    if (totpData?.totp_enabled) {
      // 2FA is enabled — create pending session instead of JWT
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

      await supabase.from('totp_pending_sessions').insert({
        user_id: user.id,
        user_type: userType,
        session_token_hash: sessionTokenHash,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
        ip_address: ip,
      });

      return new Response(
        JSON.stringify({
          requires2FA: true,
          sessionToken,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    let organization = null;
    if (user.organization_id) {
      organization = await db.getOrganizationById(user.organization_id);
    }

    const tokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: user.id,
      epost: user.epost,
      type: userType,
      organizationId: organization?.id,
      organizationSlug: organization?.slug,
      subscriptionStatus: organization?.subscription_status,
      subscriptionPlan: organization?.plan_type,
      trialEndsAt: organization?.trial_ends_at,
      currentPeriodEnd: organization?.current_period_end,
    };

    const token = auth.signToken(tokenPayload, JWT_SECRET, { expiresIn: '24h' });
    const cookieConfig = auth.getCookieConfig(isProduction);
    const cookieHeader = auth.buildSetCookieHeader(token, cookieConfig.options);

    // Track active session
    const decoded = auth.decodeToken(token);
    if (decoded?.jti) {
      const userAgent = request.headers.get('user-agent') || '';
      await supabase.from('active_sessions').insert({
        user_id: user.id,
        user_type: userType,
        jti: decoded.jti,
        ip_address: ip,
        user_agent: userAgent,
        device_info: parseDeviceInfo(userAgent),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Valider redirect-parameter mot whitelist for å forhindre open redirect
    const requestedRedirect = body.redirect || '/dashboard';
    const redirectTo = isValidRedirect(requestedRedirect) ? requestedRedirect : '/dashboard';

    return new Response(
      JSON.stringify({
        success: true,
        user: { id: user.id, navn: user.navn, epost: user.epost },
        organization: organization ? {
          id: organization.id,
          navn: organization.navn,
          slug: organization.slug,
        } : null,
        redirectUrl: redirectTo,
        appUrl: import.meta.env.PUBLIC_APP_URL || 'https://app.skyplanner.no',
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': cookieHeader,
        },
      }
    );
  } catch (error) {
    // Log sanitized error - avoid exposing user credentials or internal details
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Login error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Innlogging feilet' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

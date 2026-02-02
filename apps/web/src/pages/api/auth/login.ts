import type { APIRoute } from 'astro';
import bcrypt from 'bcryptjs';
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

// Rate limiting for login attempts - in-memory store
const loginAttempts = new Map<string, { count: number; lockoutUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW = 15 * 60 * 1000; // 15 minutes

function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  // Cleanup old entries periodically
  if (Math.random() < 0.01) {
    for (const [key, value] of loginAttempts.entries()) {
      if (now > value.lockoutUntil && value.count === 0) {
        loginAttempts.delete(key);
      }
    }
  }

  if (!record) {
    return { allowed: true };
  }

  // Check if still in lockout
  if (now < record.lockoutUntil) {
    const retryAfter = Math.ceil((record.lockoutUntil - now) / 1000);
    return { allowed: false, retryAfter };
  }

  // Reset if lockout has expired
  if (now >= record.lockoutUntil && record.count >= MAX_ATTEMPTS) {
    record.count = 0;
    record.lockoutUntil = 0;
  }

  return { allowed: true };
}

function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record) {
    loginAttempts.set(ip, { count: 1, lockoutUntil: 0 });
    return;
  }

  record.count++;

  // Trigger lockout if max attempts reached
  if (record.count >= MAX_ATTEMPTS) {
    record.lockoutUntil = now + LOCKOUT_DURATION;
  }
}

function clearLoginAttempts(ip: string): void {
  loginAttempts.delete(ip);
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Get client IP for rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'unknown';

  // Check rate limit
  const rateLimit = checkLoginRateLimit(ip);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: `For mange innloggingsforsøk. Prøv igjen om ${Math.max(1, Math.ceil((rateLimit.retryAfter || 0) / 60))} minutt${Math.ceil((rateLimit.retryAfter || 0) / 60) === 1 ? '' : 'er'}.`,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.retryAfter || 900),
        },
      }
    );
  }

  // Validate environment at request time (not module load)
  const JWT_SECRET = import.meta.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.error('JWT_SECRET not configured');
    return new Response(
      JSON.stringify({ error: 'Innlogging er midlertidig utilgjengelig' }),
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
        JSON.stringify({ error: 'E-post og passord er påkrevd' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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
      return new Response(
        JSON.stringify({ error: 'Feil e-post eller passord' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!user.aktiv) {
      return new Response(
        JSON.stringify({ error: 'Kontoen er deaktivert' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!passwordValid) {
      recordFailedLogin(ip);
      return new Response(
        JSON.stringify({ error: 'Feil e-post eller passord' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Login successful - clear rate limit counter
    clearLoginAttempts(ip);

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
    };

    const token = auth.signToken(tokenPayload, JWT_SECRET, { expiresIn: '24h' });
    const cookieConfig = auth.getCookieConfig(isProduction);
    const cookieHeader = auth.buildSetCookieHeader(token, cookieConfig.options);

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
      JSON.stringify({ error: 'Innlogging feilet' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

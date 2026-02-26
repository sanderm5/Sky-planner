import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import * as auth from '@skyplanner/auth';
import * as db from '@skyplanner/database';
import type { JWTPayload } from '@skyplanner/auth';
import { initDb } from './db';

export interface AuthResult {
  user: {
    id: number;
    navn: string;
    epost: string;
    aktiv: boolean;
  };
  organization: {
    id: number;
    navn: string;
    slug: string;
    plan_type: string;
    max_kunder: number;
    max_brukere: number;
    subscription_status?: string;
    stripe_customer_id?: string;
    stripe_subscription_id?: string;
    current_period_end?: string;
    trial_ends_at?: string;
    logo_url?: string;
    primary_color?: string;
    app_mode?: string;
    dato_modus?: string;
  };
  payload: JWTPayload;
  isAdmin: boolean;
}

/**
 * Check if a token's JTI has been blacklisted (logged out)
 */
async function isTokenBlacklisted(jti: string): Promise<boolean> {
  if (!jti) return false;

  try {
    const supabase = db.getSupabaseClient();
    const { data, error } = await supabase
      .from('token_blacklist')
      .select('id')
      .eq('jti', jti)
      .limit(1);

    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.warn('token_blacklist table does not exist yet — skipping check');
        return false;
      }
      console.error('Token blacklist check failed:', error.message);
      return true;
    }

    return (data?.length ?? 0) > 0;
  } catch {
    return true;
  }
}

/**
 * Build AuthResult from JWT payload
 */
async function buildAuthResult(payload: JWTPayload): Promise<AuthResult | null> {
  if (!payload.organizationId) return null;

  let user: { id: number; navn: string; epost: string; aktiv: boolean; rolle?: string } | null = null;
  let isAdmin = false;

  if (payload.type === 'bruker') {
    user = await db.getBrukerById(payload.userId);
    isAdmin = true; // brukere are always admin
  } else {
    user = await db.getKlientById(payload.userId);
    isAdmin = (user as any)?.rolle === 'admin';
  }

  const organization = await db.getOrganizationById(payload.organizationId);

  if (!user || !user.aktiv || !organization) {
    return null;
  }

  return {
    user: {
      id: user.id,
      navn: user.navn,
      epost: user.epost,
      aktiv: user.aktiv,
    },
    organization: {
      id: organization.id,
      navn: organization.navn,
      slug: organization.slug,
      plan_type: organization.plan_type,
      max_kunder: organization.max_kunder,
      max_brukere: organization.max_brukere,
      subscription_status: organization.subscription_status,
      stripe_customer_id: organization.stripe_customer_id,
      stripe_subscription_id: organization.stripe_subscription_id,
      current_period_end: organization.current_period_end,
      trial_ends_at: organization.trial_ends_at,
      logo_url: organization.logo_url,
      primary_color: organization.primary_color,
      app_mode: organization.app_mode,
      dato_modus: (organization as any).dato_modus,
    },
    payload,
    isAdmin,
  };
}

/**
 * Server-side auth for Next.js pages (Server Components).
 * Wrapped in React.cache() so multiple calls within the same request
 * are deduplicated — layout + page both call this, but DB is hit only once.
 */
export const requireAuth = cache(async (): Promise<AuthResult> => {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.error('JWT_SECRET not configured');
    redirect('/auth/login?error=config_error');
  }

  initDb();

  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const token = auth.extractTokenFromCookies(cookieHeader);

  if (!token) {
    redirect('/auth/login');
  }

  const result = auth.verifyToken(token, JWT_SECRET);
  if (!result.success || !result.payload) {
    redirect('/auth/login?error=session_expired');
  }

  const payload = result.payload;

  if (!payload.jti) {
    redirect('/auth/login?error=invalid_token');
  }

  if (await isTokenBlacklisted(payload.jti)) {
    redirect('/auth/login?error=session_expired');
  }

  if (!payload.organizationId) {
    redirect('/auth/login?error=no_organization');
  }

  const authResult = await buildAuthResult(payload);
  if (!authResult) {
    redirect('/auth/login?error=account_inactive');
  }

  return authResult;
});

/**
 * API route auth - extracts user and organization from request
 * Returns AuthResult on success, or error Response on failure
 * NOTE: Not cached because API routes don't share React request scope
 */
export async function requireApiAuth(
  request: Request
): Promise<AuthResult | Response> {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.error('JWT_SECRET not configured');
    return new Response(
      JSON.stringify({ error: 'Tjenesten er midlertidig utilgjengelig' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  initDb();

  const cookieHeader = request.headers.get('cookie') || '';
  const token = auth.extractTokenFromCookies(cookieHeader);

  if (!token) {
    return new Response(
      JSON.stringify({ error: 'Ikke autentisert' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const result = auth.verifyToken(token, JWT_SECRET);
  if (!result.success || !result.payload) {
    return new Response(
      JSON.stringify({ error: 'Ugyldig eller utløpt sesjon' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const payload = result.payload;

  if (!payload.jti) {
    return new Response(
      JSON.stringify({ error: 'Ugyldig token-format' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (await isTokenBlacklisted(payload.jti)) {
    return new Response(
      JSON.stringify({ error: 'Sesjonen er ugyldiggjort' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!payload.organizationId) {
    return new Response(
      JSON.stringify({ error: 'Ingen organisasjon tilknyttet' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const authResult = await buildAuthResult(payload);
  if (!authResult) {
    return new Response(
      JSON.stringify({ error: 'Konto er deaktivert eller organisasjon ikke funnet' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return authResult;
}

/**
 * API route auth that requires admin role.
 */
export async function requireAdminApiAuth(
  request: Request
): Promise<AuthResult | Response> {
  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  if (!authResult.isAdmin) {
    return new Response(
      JSON.stringify({ error: 'Krever admin-tilgang' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return authResult;
}

/**
 * Check if auth result is a Response (error)
 */
export function isAuthError(result: AuthResult | Response): result is Response {
  return result instanceof Response;
}

import type { AstroGlobal } from 'astro';
import * as auth from '@skyplanner/auth';
import * as db from '@skyplanner/database';
import type { JWTPayload } from '@skyplanner/auth';

// Lazy initialization - validated at request time, not module load
function getJwtSecret(): string | null {
  return import.meta.env.JWT_SECRET || null;
}

function initializeDatabase() {
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });
}

/**
 * Check if a token's JTI has been blacklisted (logged out)
 * Queries the token_blacklist table in Supabase directly
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
      // If table doesn't exist yet, treat as not blacklisted (fail-open)
      // This avoids blocking all logins when the table hasn't been created
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        console.warn('token_blacklist table does not exist yet — skipping check');
        return false;
      }
      console.error('Token blacklist check failed:', error.message);
      // Fail-closed for other errors: treat as blacklisted if we can't verify
      return true;
    }

    return (data?.length ?? 0) > 0;
  } catch {
    // Fail-closed: if we can't check, assume blacklisted for security
    return true;
  }
}

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
}

/**
 * Server-side auth for Astro pages
 * Returns AuthResult on success, or Response (redirect) on failure
 */
export async function requireAuth(
  Astro: AstroGlobal
): Promise<AuthResult | Response> {
  const JWT_SECRET = getJwtSecret();
  if (!JWT_SECRET) {
    console.error('JWT_SECRET not configured');
    return Astro.redirect('/auth/login?error=config_error');
  }

  initializeDatabase();

  const cookieHeader = Astro.request.headers.get('cookie') || '';
  const token = auth.extractTokenFromCookies(cookieHeader);

  if (!token) {
    return Astro.redirect('/auth/login?redirect=' + encodeURIComponent(Astro.url.pathname));
  }

  const result = auth.verifyToken(token, JWT_SECRET);
  if (!result.success || !result.payload) {
    return Astro.redirect('/auth/login?error=session_expired');
  }

  const payload = result.payload;

  // Check if token has been blacklisted (logged out)
  if (payload.jti && await isTokenBlacklisted(payload.jti)) {
    return Astro.redirect('/auth/login?error=session_expired');
  }

  if (!payload.organizationId) {
    return Astro.redirect('/auth/login?error=no_organization');
  }

  // Fetch user based on type (klient or bruker)
  let user: { id: number; navn: string; epost: string; aktiv: boolean } | null = null;

  if (payload.type === 'bruker') {
    user = await db.getBrukerById(payload.userId);
  } else {
    user = await db.getKlientById(payload.userId);
  }

  const organization = await db.getOrganizationById(payload.organizationId);

  if (!user || !user.aktiv) {
    return Astro.redirect('/auth/login?error=account_inactive');
  }

  if (!organization) {
    return Astro.redirect('/auth/login?error=organization_not_found');
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
  };
}

/**
 * API route auth - extracts user and organization from request
 * Returns AuthResult on success, or error Response on failure
 */
export async function requireApiAuth(
  request: Request
): Promise<AuthResult | Response> {
  const JWT_SECRET = getJwtSecret();
  if (!JWT_SECRET) {
    console.error('JWT_SECRET not configured');
    return new Response(
      JSON.stringify({ error: 'Tjenesten er midlertidig utilgjengelig' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  initializeDatabase();

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

  // Check if token has been blacklisted (logged out)
  if (payload.jti && await isTokenBlacklisted(payload.jti)) {
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

  // Fetch user based on type (klient or bruker)
  let user: { id: number; navn: string; epost: string; aktiv: boolean } | null = null;

  if (payload.type === 'bruker') {
    user = await db.getBrukerById(payload.userId);
  } else {
    user = await db.getKlientById(payload.userId);
  }

  const organization = await db.getOrganizationById(payload.organizationId);

  if (!user || !user.aktiv) {
    return new Response(
      JSON.stringify({ error: 'Konto er deaktivert' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!organization) {
    return new Response(
      JSON.stringify({ error: 'Organisasjon ikke funnet' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
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
  };
}

/**
 * API route auth that requires admin role.
 * Returns AuthResult on success, or error Response on failure.
 */
export async function requireAdminApiAuth(
  request: Request
): Promise<AuthResult | Response> {
  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  // Check klient rolle
  const klient = await db.getKlientById(authResult.user.id);
  if (!klient || klient.rolle !== 'admin') {
    return new Response(
      JSON.stringify({ error: 'Krever admin-tilgang' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return authResult;
}

/**
 * Check if auth result is a Response (redirect/error)
 */
export function isAuthError(result: AuthResult | Response): result is Response {
  return result instanceof Response;
}

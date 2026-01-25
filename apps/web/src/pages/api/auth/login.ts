import type { APIRoute } from 'astro';
import bcrypt from 'bcryptjs';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import type { JWTPayload } from '@skyplanner/auth';

// Whitelist for tillatte redirect-URLer (kun interne paths)
const ALLOWED_REDIRECTS = ['/dashboard', '/settings', '/fakturaer', '/abonnement', '/brukere', '/organisasjon'];

export const POST: APIRoute = async ({ request }) => {
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

    if (!user) {
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

    const passwordValid = await bcrypt.compare(passord, user.passord_hash);
    if (!passwordValid) {
      return new Response(
        JSON.stringify({ error: 'Feil e-post eller passord' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
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
    };

    const token = auth.signToken(tokenPayload, JWT_SECRET, { expiresIn: '24h' });
    const cookieConfig = auth.getCookieConfig(isProduction);
    const cookieHeader = auth.buildSetCookieHeader(token, cookieConfig.options);

    // Valider redirect-parameter mot whitelist for å forhindre open redirect
    const requestedRedirect = body.redirect || '/dashboard';
    const redirectTo = ALLOWED_REDIRECTS.some(allowed => requestedRedirect.startsWith(allowed))
      ? requestedRedirect
      : '/dashboard';

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
    console.error('Login error:', error);
    return new Response(
      JSON.stringify({ error: 'Innlogging feilet' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

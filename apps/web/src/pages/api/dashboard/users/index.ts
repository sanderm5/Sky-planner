import type { APIRoute } from 'astro';
import bcrypt from 'bcryptjs';
import * as db from '@skyplanner/database';
import { validatePassword } from '@skyplanner/auth';
import { requireApiAuth, requireAdminApiAuth, isAuthError } from '../../../../middleware/auth';

// Initialize Supabase client
db.getSupabaseClient({
  supabaseUrl: import.meta.env.SUPABASE_URL,
  supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
});

// GET - List all users in organization
export const GET: APIRoute = async ({ request }) => {
  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization } = authResult;

  try {
    const users = await db.getKlienterByOrganization(organization.id);

    // Remove sensitive data
    const safeUsers = users.map(user => ({
      id: user.id,
      navn: user.navn,
      epost: user.epost,
      telefon: user.telefon,
      aktiv: user.aktiv,
      opprettet: user.opprettet,
      rolle: user.rolle || 'leser',
    }));

    return new Response(
      JSON.stringify({
        success: true,
        users: safeUsers,
        limit: organization.max_brukere,
        count: users.filter(u => u.aktiv).length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching users:', error);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Kunne ikke hente brukere' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// POST - Create new user (admin only)
export const POST: APIRoute = async ({ request }) => {
  const authResult = await requireAdminApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization } = authResult;

  try {
    const body = await request.json();
    const { navn, epost, passord, telefon, rolle } = body;

    // Validation
    if (!navn || !epost || !passord) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Navn, e-post og passord er påkrevd' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const passwordResult = validatePassword(passord, {
      minLength: 10,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: true,
      checkCommonPasswords: true,
      userContext: { email: epost, name: navn },
    });
    if (!passwordResult.valid) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: passwordResult.errors[0] } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check email format (robust validation)
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    const isValidEmail = emailRegex.test(epost) &&
      epost.length <= 254 &&
      epost.split('@')[0].length <= 64 &&
      (epost.split('@')[1]?.split('.').pop()?.length ?? 0) >= 2;

    if (!isValidEmail) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig e-postformat' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check user limit
    const existingUsers = await db.getKlienterByOrganization(organization.id);
    const activeCount = existingUsers.filter(u => u.aktiv).length;

    if (activeCount >= organization.max_brukere) {
      return new Response(
        JSON.stringify({
          error: `Brukergrensen er nådd (${organization.max_brukere} brukere). Oppgrader abonnementet for å legge til flere brukere.`,
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if email already exists
    const existingUser = await db.getKlientByEmail(epost.toLowerCase());
    if (existingUser) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'E-postadressen er allerede registrert' } }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Hash password
    const passordHash = await bcrypt.hash(passord, 12);

    // Validate rolle if provided (defaults to 'leser' in DB)
    const validRoles = ['admin', 'redigerer', 'leser'];
    const userRolle = rolle && validRoles.includes(rolle) ? rolle : undefined;

    // Create user
    const newUser = await db.createKlient({
      navn,
      epost: epost.toLowerCase(),
      passord_hash: passordHash,
      telefon: telefon || null,
      aktiv: true,
      organization_id: organization.id,
      ...(userRolle && { rolle: userRolle }),
    });

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: newUser.id,
          navn: newUser.navn,
          epost: newUser.epost,
          telefon: newUser.telefon,
          aktiv: newUser.aktiv,
          opprettet: newUser.opprettet,
          rolle: newUser.rolle || 'leser',
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error creating user:', error);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Kunne ikke opprette bruker' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

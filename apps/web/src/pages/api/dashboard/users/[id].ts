import type { APIRoute } from 'astro';
import bcrypt from 'bcryptjs';
import * as db from '@skyplanner/database';
import { requireAdminApiAuth, isAuthError } from '../../../../middleware/auth';

// Initialize Supabase client
db.getSupabaseClient({
  supabaseUrl: import.meta.env.SUPABASE_URL,
  supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
});

// PUT - Update user (admin only)
export const PUT: APIRoute = async ({ request, params }) => {
  const authResult = await requireAdminApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization, user: currentUser } = authResult;
  const userId = parseInt(params.id || '', 10);

  if (isNaN(userId)) {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig bruker-ID' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Check if user belongs to organization
    const targetUser = await db.getKlientById(userId);
    if (!targetUser || targetUser.organization_id !== organization.id) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Bruker ikke funnet' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { navn, epost, passord, telefon, aktiv, rolle } = body;

    // Build update object
    const updateData: Record<string, unknown> = {};

    if (navn !== undefined) {
      if (!navn.trim()) {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Navn kan ikke være tomt' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updateData.navn = navn;
    }

    if (epost !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(epost)) {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig e-postformat' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Check if email already exists (for another user)
      const existingUser = await db.getKlientByEmail(epost.toLowerCase());
      if (existingUser && existingUser.id !== userId) {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'ERROR', message: 'E-postadressen er allerede i bruk' } }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updateData.epost = epost.toLowerCase();
    }

    if (telefon !== undefined) {
      updateData.telefon = telefon || null;
    }

    if (aktiv !== undefined) {
      // Prevent deactivating yourself
      if (userId === currentUser.id && !aktiv) {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Du kan ikke deaktivere din egen konto' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // If activating, check user limit
      if (aktiv && !targetUser.aktiv) {
        const existingUsers = await db.getKlienterByOrganization(organization.id);
        const activeCount = existingUsers.filter(u => u.aktiv).length;

        if (activeCount >= organization.max_brukere) {
          return new Response(
            JSON.stringify({
              error: `Brukergrensen er nådd (${organization.max_brukere} brukere). Oppgrader abonnementet for å aktivere flere brukere.`,
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      updateData.aktiv = aktiv;
    }

    if (rolle !== undefined) {
      const validRoles = ['admin', 'redigerer', 'leser'];
      if (!validRoles.includes(rolle)) {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig rolle. Gyldige roller: admin, redigerer, leser' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Prevent demoting yourself if you're the last admin
      if (userId === currentUser.id && rolle !== 'admin' && targetUser.rolle === 'admin') {
        const orgUsers = await db.getKlienterByOrganization(organization.id);
        const adminCount = orgUsers.filter(u => u.aktiv && u.rolle === 'admin').length;
        if (adminCount <= 1) {
          return new Response(
            JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Kan ikke endre rolle. Du er den eneste administratoren.' } }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      updateData.rolle = rolle;
    }

    if (passord !== undefined) {
      if (passord.length < 8) {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Passord må være minst 8 tegn' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updateData.passord_hash = await bcrypt.hash(passord, 12);
    }

    if (Object.keys(updateData).length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ingen felter å oppdatere' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update user
    const updatedUser = await db.updateKlient(userId, updateData);

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: updatedUser.id,
          navn: updatedUser.navn,
          epost: updatedUser.epost,
          telefon: updatedUser.telefon,
          aktiv: updatedUser.aktiv,
          opprettet: updatedUser.opprettet,
          rolle: updatedUser.rolle || 'leser',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error updating user:', error);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Kunne ikke oppdatere bruker' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// DELETE - Deactivate user (admin only, soft delete)
export const DELETE: APIRoute = async ({ request, params }) => {
  const authResult = await requireAdminApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization, user: currentUser } = authResult;
  const userId = parseInt(params.id || '', 10);

  if (isNaN(userId)) {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig bruker-ID' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Prevent deleting yourself
  if (userId === currentUser.id) {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Du kan ikke slette din egen konto' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Check if user belongs to organization
    const targetUser = await db.getKlientById(userId);
    if (!targetUser || targetUser.organization_id !== organization.id) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Bruker ikke funnet' } }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Soft delete - deactivate user
    await db.updateKlient(userId, { aktiv: false });

    return new Response(
      JSON.stringify({ success: true, message: 'Bruker deaktivert' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error deleting user:', error);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Kunne ikke deaktivere bruker' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

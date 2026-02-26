import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import * as db from '@skyplanner/database';
import { validatePassword } from '@skyplanner/auth';
import { requireAdminApiAuth, isAuthError } from '@/lib/auth';
import { initDb } from '@/lib/db';

// PUT - Update user (admin only)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  initDb();

  const authResult = await requireAdminApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization, user: currentUser } = authResult;
  const { id } = await params;
  const userId = parseInt(id || '', 10);

  if (isNaN(userId)) {
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Ugyldig bruker-ID' } },
      { status: 400 }
    );
  }

  try {
    // Check if user belongs to organization
    const targetUser = await db.getKlientById(userId);
    if (!targetUser || targetUser.organization_id !== organization.id) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Bruker ikke funnet' } },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { navn, epost, passord, telefon, aktiv, rolle } = body;

    // Build update object
    const updateData: Record<string, unknown> = {};

    if (navn !== undefined) {
      if (!navn.trim()) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Navn kan ikke være tomt' } },
          { status: 400 }
        );
      }
      updateData.navn = navn;
    }

    if (epost !== undefined) {
      const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      if (!epost || epost.length > 254 || !emailRegex.test(epost)) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Ugyldig e-postformat' } },
          { status: 400 }
        );
      }

      // Check if email already exists (for another user)
      const existingUser = await db.getKlientByEmail(epost.toLowerCase());
      if (existingUser && existingUser.id !== userId) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'E-postadressen er allerede i bruk' } },
          { status: 409 }
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
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Du kan ikke deaktivere din egen konto' } },
          { status: 400 }
        );
      }

      // If activating, check user limit
      if (aktiv && !targetUser.aktiv) {
        const existingUsers = await db.getKlienterByOrganization(organization.id);
        const activeCount = existingUsers.filter(u => u.aktiv).length;

        if (activeCount >= organization.max_brukere) {
          return Response.json(
            {
              error: `Brukergrensen er nådd (${organization.max_brukere} brukere). Oppgrader abonnementet for å aktivere flere brukere.`,
            },
            { status: 403 }
          );
        }
      }

      updateData.aktiv = aktiv;
    }

    if (rolle !== undefined) {
      const validRoles = ['admin', 'redigerer', 'leser'];
      if (!validRoles.includes(rolle)) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Ugyldig rolle. Gyldige roller: admin, redigerer, leser' } },
          { status: 400 }
        );
      }

      // Prevent demoting yourself if you're the last admin
      if (userId === currentUser.id && rolle !== 'admin' && targetUser.rolle === 'admin') {
        const orgUsers = await db.getKlienterByOrganization(organization.id);
        const adminCount = orgUsers.filter(u => u.aktiv && u.rolle === 'admin').length;
        if (adminCount <= 1) {
          return Response.json(
            { success: false, error: { code: 'ERROR', message: 'Kan ikke endre rolle. Du er den eneste administratoren.' } },
            { status: 400 }
          );
        }
      }

      updateData.rolle = rolle;
    }

    if (passord !== undefined) {
      const passwordResult = validatePassword(passord, {
        minLength: 10,
        requireUppercase: true,
        requireLowercase: true,
        requireNumber: true,
        requireSpecial: true,
        checkCommonPasswords: true,
        userContext: epost ? { email: epost } : undefined,
      });
      if (!passwordResult.valid) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: passwordResult.errors[0] || 'Passordet er for svakt' } },
          { status: 400 }
        );
      }
      updateData.passord_hash = await bcrypt.hash(passord, 12);
    }

    if (Object.keys(updateData).length === 0) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Ingen felter å oppdatere' } },
        { status: 400 }
      );
    }

    // Update user
    const updatedUser = await db.updateKlient(userId, updateData);

    return Response.json({
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
    }, { status: 200 });
  } catch (error) {
    console.error('Error updating user:', error);
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Kunne ikke oppdatere bruker' } },
      { status: 500 }
    );
  }
}

// DELETE - Deactivate user (admin only, soft delete)
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  initDb();

  const authResult = await requireAdminApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization, user: currentUser } = authResult;
  const { id } = await params;
  const userId = parseInt(id || '', 10);

  if (isNaN(userId)) {
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Ugyldig bruker-ID' } },
      { status: 400 }
    );
  }

  // Prevent deleting yourself
  if (userId === currentUser.id) {
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Du kan ikke slette din egen konto' } },
      { status: 400 }
    );
  }

  try {
    // Check if user belongs to organization
    const targetUser = await db.getKlientById(userId);
    if (!targetUser || targetUser.organization_id !== organization.id) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Bruker ikke funnet' } },
        { status: 404 }
      );
    }

    // Soft delete - deactivate user
    await db.updateKlient(userId, { aktiv: false });

    return Response.json(
      { success: true, message: 'Bruker deaktivert' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting user:', error);
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Kunne ikke deaktivere bruker' } },
      { status: 500 }
    );
  }
}

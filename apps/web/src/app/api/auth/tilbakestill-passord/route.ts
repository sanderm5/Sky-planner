import { NextRequest } from 'next/server';
import * as db from '@skyplanner/database';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { validatePassword as validatePasswordStrength } from '@skyplanner/auth';
import { initDb } from '@/lib/db';

const BCRYPT_ROUNDS = 12;

/**
 * Validates password strength using @skyplanner/auth
 * Enhanced security with common password checking
 */
function validatePassword(password: string): { isValid: boolean; errors: string[] } {
  const result = validatePasswordStrength(password, {
    minLength: 10, // Økt fra 8 til 10 tegn
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
    checkCommonPasswords: true,
  });

  return {
    isValid: result.valid,
    errors: result.errors,
  };
}

export async function POST(request: NextRequest) {
  try {
    initDb();

    const body = await request.json();
    const { token, passord } = body;

    if (!token || !passord) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Token og passord er påkrevd' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate password strength
    const passwordValidation = validatePassword(passord);
    if (!passwordValidation.isValid) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: passwordValidation.errors.join('. ') } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Hash the token to look it up in database
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Get valid token
    const resetToken = await db.getValidPasswordResetToken(tokenHash);

    if (!resetToken) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig eller utløpt lenke. Vennligst be om en ny tilbakestillingslenke.' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(passord, BCRYPT_ROUNDS);

    // Update password based on user type
    if (resetToken.user_type === 'klient') {
      await db.updateKlientPassword(resetToken.user_id, hashedPassword);
    } else {
      // For bruker, we need a similar function - let's use the Supabase client directly
      const client = db.getSupabaseClient();
      const { error } = await client
        .from('brukere')
        .update({ passord_hash: hashedPassword })
        .eq('id', resetToken.user_id);

      if (error) {
        throw new Error(`Failed to update password: ${error.message}`);
      }
    }

    // Mark token as used
    await db.markPasswordResetTokenUsed(resetToken.id);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Passordet ditt er oppdatert. Du kan nå logge inn med det nye passordet.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    // Log sanitized error - avoid exposing user data or internal details
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Password reset error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Noe gikk galt. Prøv igjen senere.' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';

// Initialize Supabase client
db.getSupabaseClient({
  supabaseUrl: import.meta.env.SUPABASE_URL,
  supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
});

const BCRYPT_ROUNDS = 12;

/**
 * Validates password strength
 */
function validatePassword(password: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Passord må være minst 8 tegn');
  }
  if (!/[A-ZÆØÅ]/.test(password)) {
    errors.push('Passord må inneholde minst én stor bokstav');
  }
  if (!/[a-zæøå]/.test(password)) {
    errors.push('Passord må inneholde minst én liten bokstav');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Passord må inneholde minst ett tall');
  }
  // Require at least one special character for stronger passwords
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
    errors.push('Passord må inneholde minst ett spesialtegn (!@#$%^&* osv.)');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { token, passord } = body;

    if (!token || !passord) {
      return new Response(
        JSON.stringify({ error: 'Token og passord er påkrevd' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate password strength
    const passwordValidation = validatePassword(passord);
    if (!passwordValidation.isValid) {
      return new Response(
        JSON.stringify({ error: passwordValidation.errors.join('. ') }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Hash the token to look it up in database
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Get valid token
    const resetToken = await db.getValidPasswordResetToken(tokenHash);

    if (!resetToken) {
      return new Response(
        JSON.stringify({ error: 'Ugyldig eller utløpt lenke. Vennligst be om en ny tilbakestillingslenke.' }),
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
        .from('bruker')
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
      JSON.stringify({ error: 'Noe gikk galt. Prøv igjen senere.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

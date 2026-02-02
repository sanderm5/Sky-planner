import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';
import { createHash, randomBytes } from 'crypto';

// Initialize Supabase client with Astro environment variables
db.getSupabaseClient({
  supabaseUrl: import.meta.env.SUPABASE_URL,
  supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
});

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const BASE_URL = import.meta.env.PUBLIC_BASE_URL || 'http://localhost:3001';
const FROM_EMAIL = import.meta.env.FROM_EMAIL || 'noreply@skyplanner.no';

// Rate limiting - in-memory store (use Redis in production)
const resetAttempts = new Map<string, { count: number; lastAttempt: number }>();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 3;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = resetAttempts.get(ip);

  if (!attempts) {
    resetAttempts.set(ip, { count: 1, lastAttempt: now });
    return false;
  }

  // Reset if window has passed (use >= to include exact boundary)
  if (now - attempts.lastAttempt >= RATE_LIMIT_WINDOW) {
    resetAttempts.set(ip, { count: 1, lastAttempt: now });
    return false;
  }

  // Check if over limit
  if (attempts.count >= MAX_ATTEMPTS) {
    return true;
  }

  // Increment counter
  attempts.count++;
  attempts.lastAttempt = now;
  return false;
}

/**
 * Sends password reset email via Resend
 */
async function sendPasswordResetEmail(email: string, resetUrl: string, userName: string): Promise<boolean> {
  if (!RESEND_API_KEY) {
    // Development fallback - log to console
    console.log('=== PASSWORD RESET EMAIL (Dev Mode) ===');
    console.log(`To: ${email}`);
    console.log(`Name: ${userName}`);
    console.log(`Reset URL: ${resetUrl}`);
    console.log('=======================================');
    return true;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject: 'Tilbakestill passordet ditt - Sky Planner',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Sky Planner</h1>
            </div>
            <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;">
              <h2 style="color: #1f2937; margin-top: 0;">Hei ${userName}!</h2>
              <p>Vi mottok en forespørsel om å tilbakestille passordet ditt.</p>
              <p>Klikk på knappen nedenfor for å opprette et nytt passord:</p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
                  Tilbakestill passord
                </a>
              </div>
              <p style="color: #6b7280; font-size: 14px;">Denne lenken utløper om 30 minutter.</p>
              <p style="color: #6b7280; font-size: 14px;">Hvis du ikke ba om dette, kan du ignorere denne e-posten. Passordet ditt forblir uendret.</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
              <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                Denne e-posten ble sendt fra Sky Planner.<br>
                Hvis du har spørsmål, kontakt oss på support@skyplanner.no
              </p>
            </div>
          </body>
          </html>
        `,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to send email via Resend:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return false;
  }
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  try {
    // Get client IP for rate limiting
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'unknown';

    // Check rate limit
    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: 'For mange forespørsler. Vennligst vent 15 minutter.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { epost } = body;

    if (!epost) {
      return new Response(
        JSON.stringify({ error: 'E-post er påkrevd' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    if (!emailRegex.test(epost)) {
      return new Response(
        JSON.stringify({ error: 'Ugyldig e-postformat' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if user exists (but don't reveal this to the client)
    const klient = await db.getKlientByEmail(epost.toLowerCase());
    const bruker = klient ? null : await db.getBrukerByEmail(epost.toLowerCase());
    const user = klient || bruker;
    const userType = klient ? 'klient' : 'bruker';

    if (user) {
      // Generate secure random token
      const token = randomBytes(32).toString('hex');

      // Hash the token before storing (so DB leak doesn't expose tokens)
      const tokenHash = createHash('sha256').update(token).digest('hex');

      // Token expires in 30 minutes
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      // Store the token
      await db.createPasswordResetToken({
        user_id: user.id,
        user_type: userType as 'klient' | 'bruker',
        token_hash: tokenHash,
        expires_at: expiresAt,
      });

      // Build reset URL with raw token (user needs this, we store the hash)
      const resetUrl = `${BASE_URL}/auth/tilbakestill-passord?token=${token}`;

      // Send email
      await sendPasswordResetEmail(epost, resetUrl, user.navn || 'bruker');
    }

    // Always return success to prevent email enumeration attacks
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Hvis e-postadressen er registrert, vil du motta en e-post med instruksjoner.'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Password reset error:', error);
    return new Response(
      JSON.stringify({ error: 'Noe gikk galt. Prøv igjen senere.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';

/**
 * POST /api/dashboard/2fa/verify
 * Verify TOTP code and enable 2FA
 */
export const POST: APIRoute = async ({ request, cookies }): Promise<Response> => {
  // Initialize database
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

  // Verify authentication
  const token = cookies.get('auth_token')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Ikke autentisert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const JWT_SECRET = import.meta.env.JWT_SECRET;
  const ENCRYPTION_KEY = import.meta.env.ENCRYPTION_KEY;

  if (!JWT_SECRET || !ENCRYPTION_KEY) {
    return new Response(JSON.stringify({ error: 'Server-konfigurasjonsfeil' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = auth.verifyToken(token, JWT_SECRET);
  if (!result.success || !result.payload) {
    return new Response(JSON.stringify({ error: 'Ugyldig token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = result.payload;

  try {
    const body = await request.json();
    const { code } = body;

    if (!code || code.length !== 6) {
      return new Response(JSON.stringify({ error: 'Ugyldig kode. Koden m\u00e5 v\u00e6re 6 siffer.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get user with TOTP secret
    const client = db.getSupabaseClient();
    const { data: klient, error: fetchError } = await client
      .from('klienter')
      .select('id, epost, totp_secret_encrypted, totp_enabled')
      .eq('id', payload.userId)
      .single();

    if (fetchError || !klient) {
      return new Response(JSON.stringify({ error: 'Bruker ikke funnet' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (klient.totp_enabled) {
      return new Response(JSON.stringify({ error: '2FA er allerede aktivert' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!klient.totp_secret_encrypted) {
      return new Response(
        JSON.stringify({ error: 'Start 2FA-oppsett f\u00f8rst ved \u00e5 kalle /api/dashboard/2fa/setup' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt the secret
    const secret = auth.decryptTOTPSecret(klient.totp_secret_encrypted, ENCRYPTION_KEY);

    // Verify the TOTP code
    if (!auth.verifyTOTP(secret, code)) {
      // Log failed verification
      await client.from('totp_audit_log').insert({
        user_id: payload.userId,
        user_type: 'klient',
        action: 'verification_failed',
        metadata: { reason: 'invalid_code_during_setup' },
      });

      return new Response(JSON.stringify({ error: 'Feil kode. Pr\u00f8v igjen.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Enable 2FA
    await client
      .from('klienter')
      .update({
        totp_enabled: true,
        totp_verified_at: new Date().toISOString(),
      })
      .eq('id', payload.userId);

    // Log successful setup
    await client.from('totp_audit_log').insert({
      user_id: payload.userId,
      user_type: 'klient',
      action: 'setup_completed',
      metadata: {},
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: '2FA er n\u00e5 aktivert for kontoen din',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('2FA verify error:', error instanceof Error ? error.message : 'Unknown');
    return new Response(JSON.stringify({ error: 'Verifisering feilet' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import bcrypt from 'bcryptjs';

/**
 * POST /api/dashboard/2fa/disable
 * Disable 2FA (requires password confirmation)
 */
export const POST: APIRoute = async ({ request, cookies }): Promise<Response> => {
  // Initialize database
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

  // Verify authentication
  const token = cookies.get('skyplanner_session')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Ikke autentisert' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const JWT_SECRET = import.meta.env.JWT_SECRET;
  if (!JWT_SECRET) {
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
    const { password, code } = body;

    // Require either password or TOTP code for security
    if (!password && !code) {
      return new Response(
        JSON.stringify({ error: 'Passord eller 2FA-kode er p\u00e5krevd for \u00e5 deaktivere 2FA' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get user with 2FA status using direct query
    const client = db.getSupabaseClient();
    const { data: klient, error: fetchError } = await client
      .from('klient')
      .select('id, passord_hash, totp_enabled, totp_secret_encrypted')
      .eq('id', payload.userId)
      .single();

    if (fetchError || !klient) {
      return new Response(JSON.stringify({ error: 'Bruker ikke funnet' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!klient.totp_enabled) {
      return new Response(JSON.stringify({ error: '2FA er ikke aktivert' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify password if provided
    if (password) {
      const passwordValid = await bcrypt.compare(password, klient.passord_hash);
      if (!passwordValid) {
        return new Response(JSON.stringify({ error: 'Feil passord' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Verify TOTP code if provided (and password was not)
    if (code && !password) {
      const ENCRYPTION_KEY = import.meta.env.ENCRYPTION_KEY;
      const ENCRYPTION_SALT = import.meta.env.ENCRYPTION_SALT;
      if (!ENCRYPTION_KEY || !ENCRYPTION_SALT) {
        return new Response(JSON.stringify({ error: 'Server-konfigurasjonsfeil' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!klient.totp_secret_encrypted) {
        return new Response(JSON.stringify({ error: '2FA-konfigurasjon ikke funnet' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const secret = auth.decryptTOTPSecret(klient.totp_secret_encrypted, ENCRYPTION_KEY, ENCRYPTION_SALT);
      if (!auth.verifyTOTP(secret, code)) {
        return new Response(JSON.stringify({ error: 'Feil 2FA-kode' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Disable 2FA
    await client
      .from('klient')
      .update({
        totp_enabled: false,
        totp_secret_encrypted: null,
        totp_verified_at: null,
        backup_codes_hash: null,
        totp_recovery_codes_used: 0,
      })
      .eq('id', payload.userId);

    // Log the action
    await client.from('totp_audit_log').insert({
      user_id: payload.userId,
      user_type: 'klient',
      action: 'disabled',
      metadata: { method: password ? 'password' : 'totp_code' },
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: '2FA er n\u00e5 deaktivert for kontoen din',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('2FA disable error:', error instanceof Error ? error.message : 'Unknown');
    return new Response(JSON.stringify({ error: 'Deaktivering feilet' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

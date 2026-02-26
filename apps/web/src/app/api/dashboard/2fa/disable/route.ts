import { NextRequest } from 'next/server';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import bcrypt from 'bcryptjs';
import { initDb } from '@/lib/db';

/**
 * POST /api/dashboard/2fa/disable
 * Disable 2FA (requires password confirmation)
 */
export async function POST(request: NextRequest) {
  initDb();

  // Verify authentication
  const cookieHeader = request.headers.get('cookie') || '';
  const token = auth.extractTokenFromCookies(cookieHeader);
  if (!token) {
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Ikke autentisert' } },
      { status: 401 }
    );
  }

  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Server-konfigurasjonsfeil' } },
      { status: 500 }
    );
  }

  const result = auth.verifyToken(token, JWT_SECRET);
  if (!result.success || !result.payload) {
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Ugyldig token' } },
      { status: 401 }
    );
  }

  const payload = result.payload;

  try {
    const body = await request.json();
    const { password, code } = body;

    // Require either password or TOTP code for security
    if (!password && !code) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Passord eller 2FA-kode er p\u00e5krevd for \u00e5 deaktivere 2FA' } },
        { status: 400 }
      );
    }

    // Get user with 2FA status using direct query
    const client = db.getSupabaseClient();
    const { data: klient, error: fetchError } = await client
      .from('klient')
      .select('id, passord_hash, totp_enabled, totp_secret_encrypted, totp_last_used_step')
      .eq('id', payload.userId)
      .single();

    if (fetchError || !klient) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Bruker ikke funnet' } },
        { status: 404 }
      );
    }

    if (!klient.totp_enabled) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: '2FA er ikke aktivert' } },
        { status: 400 }
      );
    }

    // Verify password if provided
    if (password) {
      const passwordValid = await bcrypt.compare(password, klient.passord_hash);
      if (!passwordValid) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Feil passord' } },
          { status: 401 }
        );
      }
    }

    // Verify TOTP code if provided (and password was not)
    if (code && !password) {
      const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
      const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT;
      if (!ENCRYPTION_KEY || !ENCRYPTION_SALT) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Server-konfigurasjonsfeil' } },
          { status: 500 }
        );
      }

      if (!klient.totp_secret_encrypted) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: '2FA-konfigurasjon ikke funnet' } },
          { status: 400 }
        );
      }

      const secret = auth.decryptTOTPSecret(klient.totp_secret_encrypted, ENCRYPTION_KEY, ENCRYPTION_SALT);
      const matchedStep = auth.verifyTOTPWithCounter(secret, code);
      if (matchedStep === null) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Feil 2FA-kode' } },
          { status: 401 }
        );
      }

      // Replay prevention: reject if this step was already used
      if (klient.totp_last_used_step != null && matchedStep <= klient.totp_last_used_step) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Denne koden er allerede brukt. Vent på en ny kode.' } },
          { status: 401 }
        );
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

    return Response.json({
      success: true,
      message: '2FA er n\u00e5 deaktivert for kontoen din',
    }, { status: 200 });
  } catch (error) {
    console.error('2FA disable error:', error instanceof Error ? error.message : 'Unknown');
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Deaktivering feilet' } },
      { status: 500 }
    );
  }
}

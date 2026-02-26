import { NextRequest } from 'next/server';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import { initDb } from '@/lib/db';

/**
 * POST /api/dashboard/2fa/verify
 * Verify TOTP code and enable 2FA
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
  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
  const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT;

  if (!JWT_SECRET || !ENCRYPTION_KEY || !ENCRYPTION_SALT) {
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
    const { code } = body;

    if (!code || code.length !== 6) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Ugyldig kode. Koden m\u00e5 v\u00e6re 6 siffer.' } },
        { status: 400 }
      );
    }

    // Get user with TOTP secret
    const client = db.getSupabaseClient();
    const { data: klient, error: fetchError } = await client
      .from('klient')
      .select('id, epost, totp_secret_encrypted, totp_enabled')
      .eq('id', payload.userId)
      .single();

    if (fetchError || !klient) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Bruker ikke funnet' } },
        { status: 404 }
      );
    }

    if (klient.totp_enabled) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: '2FA er allerede aktivert' } },
        { status: 400 }
      );
    }

    if (!klient.totp_secret_encrypted) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Start 2FA-oppsett f\u00f8rst ved \u00e5 kalle /api/dashboard/2fa/setup' } },
        { status: 400 }
      );
    }

    // Decrypt the secret
    const secret = auth.decryptTOTPSecret(klient.totp_secret_encrypted, ENCRYPTION_KEY, ENCRYPTION_SALT);

    // Verify the TOTP code
    if (!auth.verifyTOTP(secret, code)) {
      // Log failed verification
      await client.from('totp_audit_log').insert({
        user_id: payload.userId,
        user_type: 'klient',
        action: 'verification_failed',
        metadata: { reason: 'invalid_code_during_setup' },
      });

      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Feil kode. Pr\u00f8v igjen.' } },
        { status: 401 }
      );
    }

    // Enable 2FA
    await client
      .from('klient')
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

    return Response.json({
      success: true,
      message: '2FA er n\u00e5 aktivert for kontoen din',
    }, { status: 200 });
  } catch (error) {
    console.error('2FA verify error:', error instanceof Error ? error.message : 'Unknown');
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Verifisering feilet' } },
      { status: 500 }
    );
  }
}

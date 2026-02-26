import { NextRequest } from 'next/server';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import QRCode from 'qrcode';
import { requireApiAuth, isAuthError } from '@/lib/auth';
import { initDb } from '@/lib/db';

/**
 * POST /api/dashboard/2fa/setup
 * Initialize 2FA setup - generates secret and returns QR code URI
 */
export async function POST(request: NextRequest) {
  initDb();

  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
  const ENCRYPTION_SALT = process.env.ENCRYPTION_SALT;

  if (!ENCRYPTION_KEY || !ENCRYPTION_SALT) {
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Server-konfigurasjonsfeil' } },
      { status: 500 }
    );
  }

  const payload = authResult.payload;

  try {
    // Get user with 2FA status using direct query
    const client = db.getSupabaseClient();
    const { data: klient, error: fetchError } = await client
      .from('klient')
      .select('id, epost, totp_enabled')
      .eq('id', payload.userId)
      .single();

    if (fetchError || !klient) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Bruker ikke funnet' } },
        { status: 404 }
      );
    }

    // Check if 2FA is already enabled
    if (klient.totp_enabled) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: '2FA er allerede aktivert. Deaktiver først for å sette opp på nytt.' } },
        { status: 400 }
      );
    }

    // Generate new TOTP secret
    const secret = auth.generateTOTPSecret();
    const uri = auth.generateTOTPUri(secret, klient.epost);
    const backupCodes = auth.generateBackupCodes();

    // Encrypt the secret before storing
    const encryptedSecret = auth.encryptTOTPSecret(secret, ENCRYPTION_KEY, ENCRYPTION_SALT);

    // Hash backup codes for storage with HMAC using ENCRYPTION_SALT as key
    const hashedBackupCodes = backupCodes.map((code) => auth.hashBackupCode(code, ENCRYPTION_SALT));
    await client
      .from('klient')
      .update({
        totp_secret_encrypted: encryptedSecret,
        backup_codes_hash: hashedBackupCodes,
      })
      .eq('id', payload.userId);

    // Log the setup initiation
    await client.from('totp_audit_log').insert({
      user_id: payload.userId,
      user_type: 'klient',
      action: 'setup_initiated',
      ip_address: null,
      metadata: {},
    });

    // Generate QR code as data URL server-side
    const qrDataUrl = await QRCode.toDataURL(uri, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    return Response.json({
      success: true,
      data: {
        secret,
        uri,
        qrDataUrl,
        backupCodes,
      },
    }, { status: 200 });
  } catch (error) {
    console.error('2FA setup error:', error instanceof Error ? error.message : 'Unknown');
    return Response.json(
      { success: false, error: { code: 'ERROR', message: '2FA-oppsett feilet' } },
      { status: 500 }
    );
  }
}

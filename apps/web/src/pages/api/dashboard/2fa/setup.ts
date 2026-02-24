import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import QRCode from 'qrcode';

/**
 * POST /api/dashboard/2fa/setup
 * Initialize 2FA setup - generates secret and returns QR code URI
 */
export const POST: APIRoute = async ({ cookies }): Promise<Response> => {
  // Initialize database
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

  // Verify authentication
  const token = cookies.get('skyplanner_session')?.value;
  if (!token) {
    return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ikke autentisert' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const JWT_SECRET = import.meta.env.JWT_SECRET;
  const ENCRYPTION_KEY = import.meta.env.ENCRYPTION_KEY;
  const ENCRYPTION_SALT = import.meta.env.ENCRYPTION_SALT;

  if (!JWT_SECRET || !ENCRYPTION_KEY || !ENCRYPTION_SALT) {
    return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Server-konfigurasjonsfeil' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = auth.verifyToken(token, JWT_SECRET);
  if (!result.success || !result.payload) {
    return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig token' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = result.payload;

  try {
    // Get user with 2FA status using direct query
    const client = db.getSupabaseClient();
    const { data: klient, error: fetchError } = await client
      .from('klient')
      .select('id, epost, totp_enabled')
      .eq('id', payload.userId)
      .single();

    if (fetchError || !klient) {
      return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Bruker ikke funnet' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if 2FA is already enabled
    if (klient.totp_enabled) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: '2FA er allerede aktivert. Deaktiver først for å sette opp på nytt.' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
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

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          secret,
          uri,
          qrDataUrl,
          backupCodes,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('2FA setup error:', error instanceof Error ? error.message : 'Unknown');
    return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: '2FA-oppsett feilet' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

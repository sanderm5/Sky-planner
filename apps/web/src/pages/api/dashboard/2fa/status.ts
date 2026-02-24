import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';

/**
 * GET /api/dashboard/2fa/status
 * Get current 2FA status
 */
export const GET: APIRoute = async ({ cookies }): Promise<Response> => {
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
  if (!JWT_SECRET) {
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
    const client = db.getSupabaseClient();
    const { data: klient, error } = await client
      .from('klient')
      .select('totp_enabled, totp_verified_at, totp_recovery_codes_used, backup_codes_hash')
      .eq('id', payload.userId)
      .single();

    if (error || !klient) {
      return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Bruker ikke funnet' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Calculate remaining backup codes
    const totalBackupCodes = klient.backup_codes_hash?.length || 0;
    const usedBackupCodes = klient.totp_recovery_codes_used || 0;
    const remainingBackupCodes = Math.max(0, totalBackupCodes - usedBackupCodes);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          enabled: klient.totp_enabled || false,
          enabledAt: klient.totp_verified_at,
          backupCodesRemaining: klient.totp_enabled ? remainingBackupCodes : null,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('2FA status error:', error instanceof Error ? error.message : 'Unknown');
    return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Kunne ikke hente status' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

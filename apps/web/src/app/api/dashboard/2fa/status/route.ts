import { NextRequest } from 'next/server';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import { initDb } from '@/lib/db';

/**
 * GET /api/dashboard/2fa/status
 * Get current 2FA status
 */
export async function GET(request: NextRequest) {
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
    const client = db.getSupabaseClient();
    const { data: klient, error } = await client
      .from('klient')
      .select('totp_enabled, totp_verified_at, totp_recovery_codes_used, backup_codes_hash')
      .eq('id', payload.userId)
      .single();

    if (error || !klient) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Bruker ikke funnet' } },
        { status: 404 }
      );
    }

    // Calculate remaining backup codes
    const totalBackupCodes = klient.backup_codes_hash?.length || 0;
    const usedBackupCodes = klient.totp_recovery_codes_used || 0;
    const remainingBackupCodes = Math.max(0, totalBackupCodes - usedBackupCodes);

    return Response.json({
      success: true,
      data: {
        enabled: klient.totp_enabled || false,
        enabledAt: klient.totp_verified_at,
        backupCodesRemaining: klient.totp_enabled ? remainingBackupCodes : null,
      },
    }, { status: 200 });
  } catch (error) {
    console.error('2FA status error:', error instanceof Error ? error.message : 'Unknown');
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Kunne ikke hente status' } },
      { status: 500 }
    );
  }
}

import { NextRequest } from 'next/server';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import { initDb } from '@/lib/db';

/**
 * GET /api/dashboard/sessions/list
 * List all active sessions for the current user
 */
export async function GET(request: NextRequest) {
  initDb();

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
    const { data: sessions, error } = await client
      .from('active_sessions')
      .select('id, jti, ip_address, user_agent, device_info, last_activity_at, created_at, expires_at')
      .eq('user_id', payload.userId)
      .eq('user_type', payload.type || 'klient')
      .gt('expires_at', new Date().toISOString())
      .order('last_activity_at', { ascending: false });

    if (error) {
      console.error('Sessions list error:', error.message);
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Kunne ikke hente sesjoner' } },
        { status: 500 }
      );
    }

    // Get current session JTI to mark it
    const currentJti = payload.jti || null;

    return Response.json({
      success: true,
      data: {
        sessions: (sessions || []).map(s => ({
          ...s,
          is_current: s.jti === currentJti,
        })),
      },
    }, { status: 200 });
  } catch (error) {
    console.error('Sessions list error:', error instanceof Error ? error.message : 'Unknown');
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Kunne ikke hente sesjoner' } },
      { status: 500 }
    );
  }
}

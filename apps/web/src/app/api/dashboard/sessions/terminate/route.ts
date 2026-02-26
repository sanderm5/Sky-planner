import { NextRequest } from 'next/server';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import { initDb } from '@/lib/db';

/**
 * POST /api/dashboard/sessions/terminate
 * Terminate a specific session (blacklist token + delete record)
 */
export async function POST(request: NextRequest) {
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
    const body = await request.json();
    const sessionId = body.sessionId;
    if (!sessionId || typeof sessionId !== 'number') {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Ugyldig sesjons-ID' } },
        { status: 400 }
      );
    }

    const client = db.getSupabaseClient();

    // Get the session to find JTI (only user's own sessions)
    const { data: session, error: fetchError } = await client
      .from('active_sessions')
      .select('jti')
      .eq('id', sessionId)
      .eq('user_id', payload.userId)
      .eq('user_type', payload.type || 'klient')
      .single();

    if (fetchError || !session) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Sesjon ikke funnet' } },
        { status: 404 }
      );
    }

    // Prevent terminating current session (use logout instead)
    const currentJti = payload.jti || null;
    if (session.jti === currentJti) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Bruk logg ut for å avslutte nåværende sesjon' } },
        { status: 400 }
      );
    }

    // Blacklist the token so it can't be reused
    const { error: blacklistError } = await client
      .from('token_blacklist')
      .insert({
        jti: session.jti,
        user_id: payload.userId,
        user_type: payload.type || 'klient',
        reason: 'session_terminated',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

    if (blacklistError) {
      console.error('Token blacklist error:', blacklistError.message);
    }

    // Delete the session record
    await client
      .from('active_sessions')
      .delete()
      .eq('id', sessionId);

    return Response.json({
      success: true,
      data: { message: 'Sesjonen ble avsluttet' },
    }, { status: 200 });
  } catch (error) {
    console.error('Session terminate error:', error instanceof Error ? error.message : 'Unknown');
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Kunne ikke avslutte sesjonen' } },
      { status: 500 }
    );
  }
}

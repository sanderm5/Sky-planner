import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';

/**
 * POST /api/dashboard/sessions/terminate
 * Terminate a specific session (blacklist token + delete record)
 */
export const POST: APIRoute = async ({ cookies, request }): Promise<Response> => {
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

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
    const sessionId = body.sessionId;
    if (!sessionId || typeof sessionId !== 'number') {
      return new Response(JSON.stringify({ error: 'Ugyldig sesjons-ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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
      return new Response(JSON.stringify({ error: 'Sesjon ikke funnet' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Prevent terminating current session (use logout instead)
    const currentJti = payload.jti || null;
    if (session.jti === currentJti) {
      return new Response(JSON.stringify({ error: 'Bruk logg ut for å avslutte nåværende sesjon' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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

    return new Response(
      JSON.stringify({
        success: true,
        data: { message: 'Sesjonen ble avsluttet' },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Session terminate error:', error instanceof Error ? error.message : 'Unknown');
    return new Response(JSON.stringify({ error: 'Kunne ikke avslutte sesjonen' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

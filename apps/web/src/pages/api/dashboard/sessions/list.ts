import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';

/**
 * GET /api/dashboard/sessions/list
 * List all active sessions for the current user
 */
export const GET: APIRoute = async ({ cookies }): Promise<Response> => {
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
      return new Response(JSON.stringify({ error: 'Kunne ikke hente sesjoner' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get current session JTI to mark it
    const currentJti = payload.jti || null;

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          sessions: (sessions || []).map(s => ({
            ...s,
            is_current: s.jti === currentJti,
          })),
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Sessions list error:', error instanceof Error ? error.message : 'Unknown');
    return new Response(JSON.stringify({ error: 'Kunne ikke hente sesjoner' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

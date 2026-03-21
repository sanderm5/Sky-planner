import { NextRequest } from 'next/server';
import * as auth from '@skyplanner/auth';
import * as db from '@skyplanner/database';
import { initDb } from '@/lib/db';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Blacklist the current JWT token so it can't be reused after logout.
 * Uses decodeToken (no verification) since the token may be near-expiry.
 */
async function blacklistCurrentToken(cookieHeader: string): Promise<void> {
  try {
    const token = auth.extractTokenFromCookies(cookieHeader);
    if (!token) return;

    const payload = auth.decodeToken(token);
    if (!payload?.jti) return;

    initDb();
    const client = db.getSupabaseClient();

    // Blacklist token so it can't be reused
    await client.from('token_blacklist').insert({
      jti: payload.jti,
      user_id: payload.userId,
      user_type: payload.type || 'klient',
      reason: 'logout',
      expires_at: new Date(
        (payload.exp || Math.floor(Date.now() / 1000) + 86400) * 1000
      ).toISOString(),
    });

    // Clean up session record
    await client
      .from('active_sessions')
      .delete()
      .eq('jti', payload.jti);
  } catch (err) {
    // Don't block logout if blacklisting fails
    console.error('Token blacklist on logout failed:', err instanceof Error ? err.message : 'Unknown');
  }
}

export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get('cookie') || '';
  await blacklistCurrentToken(cookieHeader);

  const clearCookieHeader = auth.buildClearCookieHeader(isProduction);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/auth/login',
      'Set-Cookie': clearCookieHeader,
    },
  });
}

export async function POST(request: NextRequest) {
  const cookieHeader = request.headers.get('cookie') || '';
  await blacklistCurrentToken(cookieHeader);

  const clearCookieHeader = auth.buildClearCookieHeader(isProduction);

  return new Response(
    JSON.stringify({ success: true, message: 'Logget ut' }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': clearCookieHeader,
      },
    }
  );
}

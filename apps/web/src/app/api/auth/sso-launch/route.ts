import { NextRequest } from 'next/server';
import crypto from 'crypto';
import * as db from '@skyplanner/database';
import { requireApiAuth, isAuthError } from '@/lib/auth';
import { initDb } from '@/lib/db';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.skyplanner.no';

/**
 * GET /api/auth/sso-launch
 * Generates a one-time SSO token and delivers it via auto-submit POST form.
 * Using POST form instead of query-string redirect prevents the token from
 * leaking in browser history, server access logs, and Referer headers.
 */
export async function GET(request: NextRequest) {
  initDb();

  // CSRF: Verify request originates from our own site (not an external <img> or link)
  const referer = request.headers.get('referer');
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  if (referer) {
    try {
      const refererHost = new URL(referer).host;
      if (host && refererHost !== host) {
        return Response.redirect(new URL('/dashboard?error=invalid_request', request.url));
      }
    } catch {
      // Invalid referer URL — block
      return Response.redirect(new URL('/dashboard?error=invalid_request', request.url));
    }
  } else if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (host && originHost !== host) {
        return Response.redirect(new URL('/dashboard?error=invalid_request', request.url));
      }
    } catch {
      return Response.redirect(new URL('/dashboard?error=invalid_request', request.url));
    }
  }

  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) {
    return Response.redirect(new URL('/auth/login', request.url));
  }

  try {
    const ssoToken = crypto.randomBytes(32).toString('hex');
    const ssoTokenHash = crypto.createHash('sha256').update(ssoToken).digest('hex');

    // IP binding: hash the client IP so the token can only be redeemed from the same IP
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex');

    const supabase = db.getSupabaseClient();

    // Store hashed token in DB with short expiry (30 seconds) and IP binding
    const tokenData: Record<string, unknown> = {
      token_hash: ssoTokenHash,
      user_id: authResult.user.id,
      user_type: authResult.payload.type,
      organization_id: authResult.organization.id,
      expires_at: new Date(Date.now() + 30 * 1000).toISOString(),
      ip_hash: ipHash,
    };

    let insertResult = await supabase.from('sso_tokens').insert(tokenData);

    // Fallback: if ip_hash column doesn't exist yet, retry without it
    if (insertResult.error?.message?.includes('ip_hash')) {
      delete tokenData.ip_hash;
      insertResult = await supabase.from('sso_tokens').insert(tokenData);
    }

    if (insertResult.error) {
      throw new Error(`Failed to create SSO token: ${insertResult.error.message}`);
    }

    // Return auto-submit POST form instead of 302 redirect
    // This prevents the token from appearing in URL, browser history, and server logs
    const actionUrl = `${APP_URL}/api/klient/sso`;
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <title>Omdirigerer...</title>
</head>
<body>
  <noscript>
    <p>JavaScript er deaktivert. Klikk knappen for å fortsette.</p>
    <form method="POST" action="${escapeHtml(actionUrl)}">
      <input type="hidden" name="token" value="${escapeHtml(ssoToken)}">
      <button type="submit">Fortsett til applikasjonen</button>
    </form>
  </noscript>
  <form id="sso-form" method="POST" action="${escapeHtml(actionUrl)}">
    <input type="hidden" name="token" value="${escapeHtml(ssoToken)}">
  </form>
  <script>document.getElementById('sso-form').submit();</script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('SSO launch error:', error instanceof Error ? error.message : 'Unknown');
    return Response.redirect(new URL('/dashboard?error=sso_failed', request.url));
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

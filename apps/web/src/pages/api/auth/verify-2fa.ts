import type { APIRoute } from 'astro';
import crypto from 'crypto';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import type { JWTPayload } from '@skyplanner/auth';

/**
 * POST /api/auth/verify-2fa
 * Verify TOTP code during login flow
 */
function parseDeviceInfo(ua: string): string {
  if (!ua) return 'Ukjent enhet';
  let browser = 'Ukjent nettleser';
  if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';

  let os = 'Ukjent OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS X') || ua.includes('Macintosh')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  return `${browser} på ${os}`;
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const JWT_SECRET = import.meta.env.JWT_SECRET;
  const ENCRYPTION_KEY = import.meta.env.ENCRYPTION_KEY;
  const ENCRYPTION_SALT = import.meta.env.ENCRYPTION_SALT;

  if (!JWT_SECRET || !ENCRYPTION_KEY || !ENCRYPTION_SALT) {
    return new Response(
      JSON.stringify({ error: 'Server-konfigurasjonsfeil' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const isProduction = import.meta.env.PROD;

  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

  try {
    const body = await request.json();
    const { sessionToken, code } = body;

    if (!sessionToken || !code) {
      return new Response(
        JSON.stringify({ error: 'Session-token og kode er påkrevd' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Hash the session token to look up in DB
    const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

    const supabase = db.getSupabaseClient();

    // Find pending session
    const { data: session, error: sessionError } = await supabase
      .from('totp_pending_sessions')
      .select('*')
      .eq('session_token_hash', sessionTokenHash)
      .single();

    if (sessionError || !session) {
      return new Response(
        JSON.stringify({ error: 'Ugyldig eller utløpt sesjon. Logg inn på nytt.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check expiration
    if (new Date(session.expires_at) < new Date()) {
      await supabase.from('totp_pending_sessions').delete().eq('id', session.id);
      return new Response(
        JSON.stringify({ error: 'Sesjonen har utløpt. Logg inn på nytt.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Rate limiting: max 5 attempts per session
    const MAX_ATTEMPTS = 5;
    const currentAttempts = session.attempts ?? 0;
    if (currentAttempts >= MAX_ATTEMPTS) {
      await supabase.from('totp_pending_sessions').delete().eq('id', session.id);
      return new Response(
        JSON.stringify({ error: 'For mange forsøk. Logg inn på nytt.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '300' } }
      );
    }

    // Increment attempt counter
    await supabase
      .from('totp_pending_sessions')
      .update({ attempts: currentAttempts + 1 })
      .eq('id', session.id);

    // Get user with TOTP data
    const tableName = session.user_type === 'klient' ? 'klient' : 'brukere';
    const { data: user, error: userError } = await supabase
      .from(tableName)
      .select('id, navn, epost, organization_id, totp_secret_encrypted, backup_codes_hash, totp_recovery_codes_used, totp_last_used_step')
      .eq('id', session.user_id)
      .single();

    if (userError || !user || !user.totp_secret_encrypted) {
      return new Response(
        JSON.stringify({ error: 'Bruker ikke funnet' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const codeStr = String(code).trim();
    let verified = false;
    let usedBackupCode = false;

    // Try TOTP code first (6 digits) with replay prevention
    if (/^\d{6}$/.test(codeStr)) {
      const secret = auth.decryptTOTPSecret(user.totp_secret_encrypted, ENCRYPTION_KEY, ENCRYPTION_SALT);
      const matchedStep = auth.verifyTOTPWithCounter(secret, codeStr);
      if (matchedStep !== null) {
        // Reject replay: same code (or earlier) already used
        if (user.totp_last_used_step && matchedStep <= user.totp_last_used_step) {
          verified = false;
        } else {
          verified = true;
          // Record the used step to prevent replay
          await supabase
            .from(tableName)
            .update({ totp_last_used_step: matchedStep })
            .eq('id', user.id);
        }
      }
    }

    // Try backup code if TOTP failed (format: XXXX-XXXX or 8 chars)
    if (!verified && user.backup_codes_hash) {
      const backupIndex = auth.verifyBackupCode(codeStr, user.backup_codes_hash);
      if (backupIndex >= 0) {
        verified = true;
        usedBackupCode = true;

        // Remove used backup code
        const updatedCodes = [...user.backup_codes_hash];
        updatedCodes.splice(backupIndex, 1);
        await supabase
          .from(tableName)
          .update({
            backup_codes_hash: updatedCodes,
            totp_recovery_codes_used: (user.totp_recovery_codes_used || 0) + 1,
          })
          .eq('id', user.id);
      }
    }

    if (!verified) {
      // Log failed attempt
      await supabase.from('totp_audit_log').insert({
        user_id: session.user_id,
        user_type: session.user_type,
        action: 'verification_failed',
        ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || null,
        metadata: { context: 'login' },
      });

      return new Response(
        JSON.stringify({ error: 'Feil kode. Prøv igjen.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 2FA verified — delete pending session
    await supabase.from('totp_pending_sessions').delete().eq('id', session.id);

    // Log successful verification
    await supabase.from('totp_audit_log').insert({
      user_id: session.user_id,
      user_type: session.user_type,
      action: usedBackupCode ? 'backup_code_used' : 'verification_success',
      ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || null,
      metadata: { context: 'login' },
    });

    // Get organization for JWT payload
    let organization = null;
    if (user.organization_id) {
      organization = await db.getOrganizationById(user.organization_id);
    }

    // Create full JWT token
    const tokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId: user.id,
      epost: user.epost,
      type: session.user_type as 'klient' | 'bruker',
      organizationId: organization?.id,
      organizationSlug: organization?.slug,
      subscriptionStatus: organization?.subscription_status,
      subscriptionPlan: organization?.plan_type,
    };

    const token = auth.signToken(tokenPayload, JWT_SECRET, { expiresIn: '24h' });
    const cookieConfig = auth.getCookieConfig(isProduction);
    const cookieHeader = auth.buildSetCookieHeader(token, cookieConfig.options);

    // Track active session
    const decoded = auth.decodeToken(token);
    if (decoded?.jti) {
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || clientAddress || 'unknown';
      const userAgent = request.headers.get('user-agent') || '';
      supabase.from('active_sessions').insert({
        user_id: user.id,
        user_type: session.user_type,
        jti: decoded.jti,
        ip_address: ip,
        user_agent: userAgent,
        device_info: parseDeviceInfo(userAgent),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: { id: user.id, navn: user.navn, epost: user.epost },
        organization: organization ? {
          id: organization.id,
          navn: organization.navn,
          slug: organization.slug,
        } : null,
        redirectUrl: '/dashboard',
        appUrl: import.meta.env.PUBLIC_APP_URL || 'https://app.skyplanner.no',
        usedBackupCode,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': cookieHeader,
        },
      }
    );
  } catch (error) {
    console.error('2FA verify error:', error instanceof Error ? error.message : 'Unknown');
    return new Response(
      JSON.stringify({ error: 'Verifisering feilet' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

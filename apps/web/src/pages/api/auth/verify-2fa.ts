import type { APIRoute } from 'astro';
import crypto from 'crypto';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import type { JWTPayload } from '@skyplanner/auth';

/**
 * POST /api/auth/verify-2fa
 * Verify TOTP code during login flow
 */
export const POST: APIRoute = async ({ request, clientAddress }) => {
  const JWT_SECRET = import.meta.env.JWT_SECRET;
  const ENCRYPTION_KEY = import.meta.env.ENCRYPTION_KEY;

  if (!JWT_SECRET || !ENCRYPTION_KEY) {
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
      // Clean up expired session
      await supabase.from('totp_pending_sessions').delete().eq('id', session.id);
      return new Response(
        JSON.stringify({ error: 'Sesjonen har utløpt. Logg inn på nytt.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get user with TOTP data
    const tableName = session.user_type === 'klient' ? 'klient' : 'brukere';
    const { data: user, error: userError } = await supabase
      .from(tableName)
      .select('id, navn, epost, organization_id, totp_secret_encrypted, backup_codes_hash, totp_recovery_codes_used')
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

    // Try TOTP code first (6 digits)
    if (/^\d{6}$/.test(codeStr)) {
      const secret = auth.decryptTOTPSecret(user.totp_secret_encrypted, ENCRYPTION_KEY);
      verified = auth.verifyTOTP(secret, codeStr);
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

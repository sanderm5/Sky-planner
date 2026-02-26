import { NextRequest } from 'next/server';
import * as db from '@skyplanner/database';
import { createHash } from 'node:crypto';
import { initDb } from '@/lib/db';

/**
 * GET /api/auth/verify-email?token=xxx
 * Verifies a user's email address
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/auth/verify-email?error=missing_token',
      },
    });
  }

  try {
    initDb();

    // Hash the token to look it up
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Try to find and verify in klient table first
    const client = db.getSupabaseClient();

    // Check klient table
    const { data: klient, error: klientError } = await client
      .from('klient')
      .select('id, email_verified, verification_expires_at')
      .eq('verification_token_hash', tokenHash)
      .maybeSingle();

    if (klient && !klientError) {
      // Check if token is expired
      if (klient.verification_expires_at && new Date(klient.verification_expires_at) < new Date()) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/auth/verify-email?error=expired',
          },
        });
      }

      // Check if already verified
      if (klient.email_verified) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/auth/verify-email?status=already_verified',
          },
        });
      }

      // Verify the email
      const { error: updateError } = await client
        .from('klient')
        .update({
          email_verified: true,
          verification_token_hash: null,
          verification_expires_at: null,
        })
        .eq('id', klient.id);

      if (updateError) {
        console.error('Failed to verify klient email:', updateError);
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/auth/verify-email?error=verification_failed',
          },
        });
      }

      return new Response(null, {
        status: 302,
        headers: {
          Location: '/auth/verify-email?status=success',
        },
      });
    }

    // Check brukere table
    const { data: bruker, error: brukerError } = await client
      .from('brukere')
      .select('id, email_verified, verification_expires_at')
      .eq('verification_token_hash', tokenHash)
      .maybeSingle();

    if (bruker && !brukerError) {
      // Check if token is expired
      if (bruker.verification_expires_at && new Date(bruker.verification_expires_at) < new Date()) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/auth/verify-email?error=expired',
          },
        });
      }

      // Check if already verified
      if (bruker.email_verified) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/auth/verify-email?status=already_verified',
          },
        });
      }

      // Verify the email
      const { error: updateError } = await client
        .from('brukere')
        .update({
          email_verified: true,
          verification_token_hash: null,
          verification_expires_at: null,
        })
        .eq('id', bruker.id);

      if (updateError) {
        console.error('Failed to verify bruker email:', updateError);
        return new Response(null, {
          status: 302,
          headers: {
            Location: '/auth/verify-email?error=verification_failed',
          },
        });
      }

      return new Response(null, {
        status: 302,
        headers: {
          Location: '/auth/verify-email?status=success',
        },
      });
    }

    // Token not found
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/auth/verify-email?error=invalid_token',
      },
    });
  } catch (error) {
    console.error('Email verification error:', error);
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/auth/verify-email?error=server_error',
      },
    });
  }
}

/**
 * POST /api/auth/verify-email
 * Resends verification email
 */
export async function POST(request: NextRequest) {
  try {
    initDb();

    const body = await request.json();
    const { epost } = body;

    if (!epost) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'E-post er påkrevd' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // This endpoint would resend verification email
    // For now, return success to prevent email enumeration
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Hvis e-postadressen er registrert, vil du motta en ny verifiserings-e-post.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Resend verification error:', error);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Noe gikk galt' } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

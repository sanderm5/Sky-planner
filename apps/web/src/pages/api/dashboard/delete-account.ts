import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';
import * as auth from '@skyplanner/auth';
import Stripe from 'stripe';

// Grace period in days
const GRACE_PERIOD_DAYS = 30;

// Account deletion scheduled email data type
interface AccountDeletionScheduledData {
  userName: string;
  scheduledDate: string;
  gracePeriodDays: number;
  cancelUrl: string;
  exportUrl: string;
}

type AuthResult =
  | { success: false; error: Response }
  | { success: true; payload: auth.JWTPayload };

/**
 * Helper to verify auth and return payload or error response
 */
function verifyAuth(cookies: { get: (name: string) => { value: string } | undefined }): AuthResult {
  const token = cookies.get('skyplanner_session')?.value;
  if (!token) {
    return {
      success: false,
      error: new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ikke autentisert' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  const JWT_SECRET = import.meta.env.JWT_SECRET;
  if (!JWT_SECRET) {
    return {
      success: false,
      error: new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Server-konfigurasjonsfeil' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  const result = auth.verifyToken(token, JWT_SECRET);
  if (!result.success || !result.payload) {
    return {
      success: false,
      error: new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig token' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  if (!result.payload.organizationId) {
    return {
      success: false,
      error: new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ingen organisasjon tilknyttet' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }

  return { success: true, payload: result.payload };
}

/**
 * POST /api/dashboard/delete-account
 * Request account deletion with 30-day grace period
 */
export const POST: APIRoute = async ({ request, cookies }): Promise<Response> => {
  // Initialize database
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

  const authResult = verifyAuth(cookies);
  if (!authResult.success) {
    return authResult.error;
  }
  const payload = authResult.payload;

  try {
    const body = await request.json();
    const { reason, confirmPassword } = body;

    // Verify password for security
    if (!confirmPassword) {
      return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Passord er påkrevd for å slette kontoen' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get the user and verify password
    const klient = await db.getKlientById(payload.userId);
    if (!klient) {
      return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Bruker ikke funnet' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify password using bcrypt
    const bcrypt = await import('bcryptjs');
    const passwordValid = await bcrypt.compare(confirmPassword, klient.passord_hash);
    if (!passwordValid) {
      return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Feil passord' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get the organization
    const organization = await db.getOrganizationById(payload.organizationId!);
    if (!organization) {
      return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Organisasjon ikke funnet' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for existing pending deletion request
    const client = db.getSupabaseClient();
    const { data: existingRequest } = await client
      .from('account_deletion_requests')
      .select('*')
      .eq('organization_id', payload.organizationId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingRequest) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'PENDING_DELETION_EXISTS', message: 'Det finnes allerede en ventende sletteforespørsel' },
          scheduledDeletionAt: existingRequest.scheduled_deletion_at,
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Calculate scheduled deletion date
    const now = new Date();
    const scheduledDeletionAt = new Date(now);
    scheduledDeletionAt.setDate(scheduledDeletionAt.getDate() + GRACE_PERIOD_DAYS);

    // Cancel Stripe subscription if exists
    let stripeCancellationId: string | null = null;
    if (organization.stripe_subscription_id && import.meta.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY, {
          apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
        });

        // Cancel at period end to allow reactivation during grace period
        const subscription = await stripe.subscriptions.update(organization.stripe_subscription_id, {
          cancel_at_period_end: true,
          metadata: {
            cancellation_reason: 'account_deletion_request',
            organization_id: String(payload.organizationId),
          },
        });

        stripeCancellationId = subscription.id;
      } catch (stripeError) {
        console.error('Stripe cancellation error:', stripeError instanceof Error ? stripeError.message : 'Unknown');
        // Continue with deletion request even if Stripe fails
      }
    }

    // Create deletion request
    const { data: deletionRequest, error: insertError } = await client
      .from('account_deletion_requests')
      .insert({
        organization_id: payload.organizationId,
        requested_by: payload.userId,
        scheduled_deletion_at: scheduledDeletionAt.toISOString(),
        reason: reason || null,
        stripe_cancellation_id: stripeCancellationId,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Failed to create deletion request:', insertError.message);
      return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Kunne ikke opprette sletteforespørsel' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Mark organization as pending deletion
    await client
      .from('organizations')
      .update({
        deletion_requested_at: now.toISOString(),
        deletion_requested_by: payload.userId,
        updated_at: now.toISOString(),
      })
      .eq('id', payload.organizationId);

    // Send confirmation email
    if (import.meta.env.RESEND_API_KEY && klient.epost) {
      try {
        const { createEmailSender } = await import('@skyplanner/email');
        const emailSender = createEmailSender({
          resendApiKey: import.meta.env.RESEND_API_KEY,
          fromEmail: import.meta.env.FROM_EMAIL || 'noreply@skyplanner.no',
          fromName: 'Sky Planner',
        });

        const emailData: AccountDeletionScheduledData = {
          userName: klient.navn || 'kunde',
          scheduledDate: scheduledDeletionAt.toLocaleDateString('nb-NO'),
          gracePeriodDays: GRACE_PERIOD_DAYS,
          cancelUrl: `${import.meta.env.PUBLIC_BASE_URL || 'https://skyplanner.no'}/dashboard/innstillinger/personvern`,
          exportUrl: `${import.meta.env.PUBLIC_APP_URL || 'https://app.skyplanner.no'}/api/export/all`,
        };

        await emailSender.sendAccountDeletionScheduled(klient.epost, emailData);
      } catch (emailError) {
        console.error('Failed to send deletion confirmation email:', emailError instanceof Error ? emailError.message : 'Unknown');
        // Continue even if email fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Kontosletting er planlagt. Data vil bli slettet ${scheduledDeletionAt.toLocaleDateString('nb-NO')}.`,
        scheduledDeletionAt: scheduledDeletionAt.toISOString(),
        gracePeriodDays: GRACE_PERIOD_DAYS,
        requestId: deletionRequest.id,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Delete account error:', error instanceof Error ? error.message : 'Unknown');
    return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Sletting feilet' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/**
 * DELETE /api/dashboard/delete-account
 * Cancel a pending deletion request
 */
export const DELETE: APIRoute = async ({ cookies }): Promise<Response> => {
  // Initialize database
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

  const authResult = verifyAuth(cookies);
  if (!authResult.success) {
    return authResult.error;
  }
  const payload = authResult.payload;

  try {
    const client = db.getSupabaseClient();

    // Find pending deletion request
    const { data: deletionRequest } = await client
      .from('account_deletion_requests')
      .select('*')
      .eq('organization_id', payload.organizationId)
      .eq('status', 'pending')
      .maybeSingle();

    if (!deletionRequest) {
      return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ingen ventende sletteforespørsel funnet' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Cancel the request
    const now = new Date();
    await client
      .from('account_deletion_requests')
      .update({
        status: 'cancelled',
        cancelled_at: now.toISOString(),
        cancelled_by: payload.userId,
        updated_at: now.toISOString(),
      })
      .eq('id', deletionRequest.id);

    // Remove pending deletion flags from organization
    await client
      .from('organizations')
      .update({
        deletion_requested_at: null,
        deletion_requested_by: null,
        updated_at: now.toISOString(),
      })
      .eq('id', payload.organizationId);

    // Reactivate Stripe subscription if it was cancelled
    if (deletionRequest.stripe_cancellation_id && import.meta.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = new Stripe(import.meta.env.STRIPE_SECRET_KEY, {
          apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
        });

        await stripe.subscriptions.update(deletionRequest.stripe_cancellation_id, {
          cancel_at_period_end: false,
        });
      } catch (stripeError) {
        console.error('Stripe reactivation error:', stripeError instanceof Error ? stripeError.message : 'Unknown');
        // Continue even if Stripe reactivation fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Sletteforespørselen er kansellert. Kontoen din er gjenopprettet.',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Cancel deletion error:', error instanceof Error ? error.message : 'Unknown');
    return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Kansellering feilet' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

/**
 * GET /api/dashboard/delete-account
 * Get deletion request status
 */
export const GET: APIRoute = async ({ cookies }): Promise<Response> => {
  // Initialize database
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

  const authResult = verifyAuth(cookies);
  if (!authResult.success) {
    return authResult.error;
  }
  const payload = authResult.payload;

  try {
    const client = db.getSupabaseClient();

    // Get pending deletion request
    const { data: deletionRequest } = await client
      .from('account_deletion_requests')
      .select('*')
      .eq('organization_id', payload.organizationId)
      .eq('status', 'pending')
      .maybeSingle();

    if (!deletionRequest) {
      return new Response(
        JSON.stringify({
          hasPendingDeletion: false,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const scheduledDate = new Date(deletionRequest.scheduled_deletion_at);
    const now = new Date();
    const daysRemaining = Math.ceil((scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return new Response(
      JSON.stringify({
        hasPendingDeletion: true,
        scheduledDeletionAt: deletionRequest.scheduled_deletion_at,
        requestedAt: deletionRequest.requested_at,
        daysRemaining: Math.max(0, daysRemaining),
        reason: deletionRequest.reason,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Get deletion status error:', error instanceof Error ? error.message : 'Unknown');
    return new Response(JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Kunne ikke hente status' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

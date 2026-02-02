import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import * as db from '@skyplanner/database';

// Valid subscription statuses that match our database schema
type ValidSubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';

/**
 * Maps Stripe subscription status to our internal status
 */
function mapSubscriptionStatus(stripeStatus: Stripe.Subscription.Status): ValidSubscriptionStatus {
  const statusMap: Record<Stripe.Subscription.Status, ValidSubscriptionStatus> = {
    active: 'active',
    trialing: 'trialing',
    past_due: 'past_due',
    canceled: 'canceled',
    incomplete: 'incomplete',
    incomplete_expired: 'canceled',
    unpaid: 'past_due',
    paused: 'canceled',
  };
  return statusMap[stripeStatus] || 'incomplete';
}

export const POST: APIRoute = async ({ request }) => {
  // Validate environment at request time (not module load)
  const STRIPE_SECRET_KEY = import.meta.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = import.meta.env.STRIPE_WEBHOOK_SECRET;

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.warn('Stripe webhook not configured');
    return new Response('Webhook not configured', { status: 503 });
  }

  // Initialize database client
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
  });

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return new Response('Missing signature', { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // Log only error type, not full error which may contain sensitive webhook data
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('Webhook signature verification failed:', errorMessage);
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    // Check if event was already processed (idempotency)
    const client = db.getSupabaseClient();
    const { data: existingEvent } = await client
      .from('subscription_events')
      .select('id')
      .eq('stripe_event_id', event.id)
      .maybeSingle();

    if (existingEvent) {
      // Event already processed, return success
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get organization_id from Stripe customer for logging
    const eventObject = event.data.object as { customer?: string };
    let organizationId = 0;
    if (eventObject.customer) {
      const org = await db.getOrganizationByStripeCustomer(eventObject.customer);
      if (org) {
        organizationId = org.id;
      }
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        await db.updateSubscriptionByStripeCustomer(customerId, {
          subscription_status: mapSubscriptionStatus(subscription.status),
          stripe_subscription_id: subscription.id,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          trial_ends_at: subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toISOString()
            : undefined,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        await db.updateSubscriptionByStripeCustomer(customerId, {
          subscription_status: 'canceled',
        });
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        if (invoice.billing_reason === 'subscription_create') {
          await db.updateSubscriptionByStripeCustomer(customerId, {
            subscription_status: 'active',
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        await db.updateSubscriptionByStripeCustomer(customerId, {
          subscription_status: 'past_due',
        });
        break;
      }
    }

    // Log the event (organizationId already determined above for idempotency check)
    await db.logSubscriptionEvent({
      organization_id: organizationId,
      stripe_event_id: event.id,
      event_type: event.type,
      data: event.data.object as Record<string, unknown>,
    });

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    // Log sanitized error - avoid exposing sensitive webhook/customer data
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Webhook handler error:', errorMessage);
    return new Response('Webhook handler failed', { status: 500 });
  }
};

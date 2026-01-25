import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import * as db from '@skyplanner/database';

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
    apiVersion: '2023-10-16',
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
    console.error('Webhook signature verification failed:', err);
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        await db.updateSubscriptionByStripeCustomer(customerId, {
          subscription_status: subscription.status as any,
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

    // Hent organization_id fra Stripe customer for korrekt logging
    let organizationId = 0;
    const eventObject = event.data.object as { customer?: string };
    if (eventObject.customer) {
      const org = await db.getOrganizationByStripeCustomer(eventObject.customer);
      if (org) {
        organizationId = org.id;
      }
    }

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
    console.error('Webhook handler error:', error);
    return new Response('Webhook handler failed', { status: 500 });
  }
};

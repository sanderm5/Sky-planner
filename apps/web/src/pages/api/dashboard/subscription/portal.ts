import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { requireApiAuth, isAuthError } from '../../../../middleware/auth';

// POST - Create Stripe Customer Portal session
export const POST: APIRoute = async ({ request }) => {
  const STRIPE_SECRET_KEY = import.meta.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    console.warn('Stripe not configured - portal unavailable');
    return new Response(
      JSON.stringify({ error: 'Abonnementstjenesten er midlertidig utilgjengelig' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
  });

  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization } = authResult;

  if (!organization.stripe_customer_id) {
    return new Response(
      JSON.stringify({ error: 'Ingen Stripe-kunde tilknyttet organisasjonen' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const returnUrl = `${import.meta.env.PUBLIC_BASE_URL || 'http://localhost:3001'}/dashboard/abonnement`;

    const session = await stripe.billingPortal.sessions.create({
      customer: organization.stripe_customer_id,
      return_url: returnUrl,
    });

    return new Response(
      JSON.stringify({
        success: true,
        url: session.url,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Stripe portal error:', error);
    return new Response(
      JSON.stringify({ error: 'Kunne ikke opprette Stripe-portal' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

import { NextRequest } from 'next/server';

// POST - Handle Stripe webhook events
export async function POST(_request: NextRequest) {
  // TEMPORARILY DISABLED - manual invoicing via Fiken
  // Remove this block and restore full handler from git history to re-enable Stripe webhooks
  // When re-enabling: implement stripe.webhooks.constructEvent() with signature verification
  return new Response(
    JSON.stringify({ received: true, status: 'disabled' }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

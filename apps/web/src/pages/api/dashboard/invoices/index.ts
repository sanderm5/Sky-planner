import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { requireApiAuth, isAuthError } from '../../../../middleware/auth';

// GET - List invoices from Stripe
export const GET: APIRoute = async ({ request }) => {
  const STRIPE_SECRET_KEY = import.meta.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    console.warn('Stripe not configured - invoices unavailable');
    return new Response(
      JSON.stringify({ error: 'Fakturatjenesten er midlertidig utilgjengelig' }),
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
      JSON.stringify({
        success: true,
        invoices: [],
        message: 'Ingen faktureringshistorikk',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const invoices = await stripe.invoices.list({
      customer: organization.stripe_customer_id,
      limit: 24,
    });

    const formattedInvoices = invoices.data.map(invoice => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      amount: invoice.total,
      currency: invoice.currency,
      created: invoice.created,
      period_start: invoice.period_start,
      period_end: invoice.period_end,
      hosted_invoice_url: invoice.hosted_invoice_url,
      invoice_pdf: invoice.invoice_pdf,
      description: invoice.description || invoice.lines?.data?.[0]?.description || 'Abonnement',
    }));

    return new Response(
      JSON.stringify({
        success: true,
        invoices: formattedInvoices,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Stripe invoices error:', error);
    return new Response(
      JSON.stringify({ error: 'Kunne ikke hente fakturaer' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

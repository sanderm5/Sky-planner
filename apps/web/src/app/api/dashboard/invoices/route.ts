import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { requireApiAuth, isAuthError } from '@/lib/auth';
import { initDb } from '@/lib/db';

// GET - List invoices from Stripe
export async function GET(request: NextRequest) {
  initDb();

  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!STRIPE_SECRET_KEY) {
    console.warn('Stripe not configured - invoices unavailable');
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Fakturatjenesten er midlertidig utilgjengelig' } },
      { status: 503 }
    );
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
  });

  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization } = authResult;

  if (!organization.stripe_customer_id) {
    return Response.json({
      success: true,
      invoices: [],
      message: 'Ingen faktureringshistorikk',
    }, { status: 200 });
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

    return Response.json({
      success: true,
      invoices: formattedInvoices,
    }, { status: 200 });
  } catch (error) {
    console.error('Stripe invoices error:', error);
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Kunne ikke hente fakturaer' } },
      { status: 500 }
    );
  }
}

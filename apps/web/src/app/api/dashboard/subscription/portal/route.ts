import { NextRequest } from 'next/server';

// POST - Create Stripe Customer Portal session
export async function POST(_request: NextRequest) {
  // TEMPORARILY DISABLED - manual invoicing via Fiken
  // Remove this block to re-enable Stripe portal
  return Response.json({
    success: false,
    error: { code: 'PORTAL_DISABLED', message: 'Selvbetjent fakturering er ikke tilgjengelig. Kontakt oss på support@skyplanner.no for fakturaer og abonnementsendringer.' },
  }, { status: 503 });
}

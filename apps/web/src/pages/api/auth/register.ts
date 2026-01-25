import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import bcrypt from 'bcryptjs';
import * as db from '@skyplanner/database';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Passordvalidering med kompleksitetskrav
interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Passord må være minst 8 tegn');
  }

  if (!/[A-ZÆØÅ]/.test(password)) {
    errors.push('Passord må inneholde minst én stor bokstav');
  }

  if (!/[a-zæøå]/.test(password)) {
    errors.push('Passord må inneholde minst én liten bokstav');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Passord må inneholde minst ett tall');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[å]/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
}

export const POST: APIRoute = async ({ request }) => {
  // Validate environment at request time (not module load)
  const STRIPE_SECRET_KEY = import.meta.env.STRIPE_SECRET_KEY;
  const STRIPE_PRICE_STANDARD = import.meta.env.STRIPE_PRICE_STANDARD;
  const STRIPE_PRICE_PREMIUM = import.meta.env.STRIPE_PRICE_PREMIUM;

  if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_STANDARD || !STRIPE_PRICE_PREMIUM) {
    console.warn('Stripe not configured - registration disabled');
    return new Response(
      JSON.stringify({ error: 'Registrering er midlertidig utilgjengelig' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Initialize database client
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
  });

  const PRICE_IDS = {
    standard: STRIPE_PRICE_STANDARD,
    premium: STRIPE_PRICE_PREMIUM,
  };

  try {
    const body = await request.json();
    const { navn, epost, passord, firma, plan } = body;

    if (!navn || !epost || !passord || !firma) {
      return new Response(
        JSON.stringify({ error: 'Alle felt er påkrevd' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!isValidEmail(epost)) {
      return new Response(
        JSON.stringify({ error: 'Ugyldig e-postadresse' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const passwordValidation = validatePassword(passord);
    if (!passwordValidation.isValid) {
      return new Response(
        JSON.stringify({ error: passwordValidation.errors.join('. ') }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const emailExists = await db.isEmailRegistered(epost.toLowerCase());
    if (emailExists) {
      return new Response(
        JSON.stringify({ error: 'E-postadressen er allerede registrert' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const selectedPlan = plan === 'premium' ? 'premium' : 'standard';
    const priceId = PRICE_IDS[selectedPlan];

    if (!priceId) {
      return new Response(
        JSON.stringify({ error: 'Ugyldig abonnementsplan' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const passwordHash = await bcrypt.hash(passord, 12);
    const slug = generateSlug(firma);

    const stripeCustomer = await stripe.customers.create({
      email: epost.toLowerCase(),
      name: navn,
      metadata: { company: firma },
    });

    const organization = await db.createOrganization({
      navn: firma,
      slug: slug,
      aktiv: true,
      plan_type: selectedPlan,
      max_kunder: selectedPlan === 'premium' ? 500 : 200,
      max_brukere: selectedPlan === 'premium' ? 10 : 5,
      stripe_customer_id: stripeCustomer.id,
      subscription_status: 'incomplete',
    });

    await db.createKlient({
      navn: navn,
      epost: epost.toLowerCase(),
      passord_hash: passwordHash,
      aktiv: true,
      organization_id: organization.id,
    });

    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomer.id,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      subscription_data: {
        trial_period_days: 14,
        metadata: { organizationId: organization.id.toString() },
      },
      success_url: `${import.meta.env.PUBLIC_BASE_URL || 'https://skyplanner.no'}/auth/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${import.meta.env.PUBLIC_BASE_URL || 'https://skyplanner.no'}/auth/registrer`,
      metadata: { organizationId: organization.id.toString() },
    });

    await db.updateOrganization(organization.id, {
      stripe_subscription_id: session.id,
    });

    return new Response(
      JSON.stringify({
        success: true,
        checkoutUrl: session.url,
        organizationId: organization.id,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return new Response(
      JSON.stringify({ error: 'Registrering feilet' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

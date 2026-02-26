import { NextRequest } from 'next/server';
// import Stripe from 'stripe'; // TEMPORARILY DISABLED - manual invoicing via Fiken
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import * as db from '@skyplanner/database';
import { createClient } from '@supabase/supabase-js';
import { validatePassword as validatePasswordStrength } from '@skyplanner/auth';
import { initDb } from '@/lib/db';

/**
 * Timing-safe string comparison to prevent timing attacks
 * Returns true if strings are equal, false otherwise
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Pad to same length to prevent length-based timing attacks
  const aBuffer = Buffer.from(a.padEnd(Math.max(a.length, b.length), '\0'));
  const bBuffer = Buffer.from(b.padEnd(Math.max(a.length, b.length), '\0'));

  // Use timingSafeEqual for constant-time comparison
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

// Rate limiting - in-memory store (resets on server restart)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutter
const MAX_REQUESTS_PER_WINDOW = 5; // Maks 5 forsøk per 15 min

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  // Rydd opp gamle entries (hver 100. request)
  if (Math.random() < 0.01) {
    for (const [key, value] of rateLimitStore.entries()) {
      if (now > value.resetTime) {
        rateLimitStore.delete(key);
      }
    }
  }

  if (!record || now > record.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    return { allowed: false, retryAfter };
  }

  record.count++;
  return { allowed: true };
}

/**
 * Validates email format using a more robust regex
 * Based on RFC 5322 but simplified for practical use
 */
function isValidEmail(email: string): boolean {
  // More robust email validation:
  // - Local part: letters, numbers, and common special chars
  // - Domain: letters, numbers, hyphens, with proper TLD (min 2 chars)
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  if (!emailRegex.test(email)) return false;

  // Additional checks
  if (email.length > 254) return false; // Max email length per RFC
  const [localPart, domain] = email.split('@');
  if (localPart.length > 64) return false; // Max local part length
  if (!domain || domain.split('.').pop()!.length < 2) return false; // TLD must be at least 2 chars

  return true;
}

// Passordvalidering - bruker @skyplanner/auth med forbedret sikkerhet
function validatePassword(password: string, email?: string, navn?: string): { isValid: boolean; errors: string[] } {
  const result = validatePasswordStrength(password, {
    minLength: 10, // Økt fra 8 til 10 tegn
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecial: true,
    checkCommonPasswords: true,
    userContext: email || navn ? { email, name: navn } : undefined,
  });

  return {
    isValid: result.valid,
    errors: result.errors,
  };
}

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[å]/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
  // Add random suffix to avoid unique constraint violations
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${suffix}`;
}

export async function POST(request: NextRequest) {
  // Rate limiting basert på IP
  const clientIP = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  const rateLimit = checkRateLimit(clientIP);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: `For mange forsøk. Prøv igjen om ${rateLimit.retryAfter} sekunder.`
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.retryAfter)
        }
      }
    );
  }

  // Validate environment at request time (not module load)
  // Stripe env vars temporarily disabled - manual invoicing via Fiken
  // const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  // const STRIPE_PRICE_STANDARD = process.env.STRIPE_PRICE_STANDARD;
  // const STRIPE_PRICE_PREMIUM = process.env.STRIPE_PRICE_PREMIUM;
  // const STRIPE_PRICE_STANDARD_YEARLY = process.env.STRIPE_PRICE_STANDARD_YEARLY;
  // const STRIPE_PRICE_PREMIUM_YEARLY = process.env.STRIPE_PRICE_PREMIUM_YEARLY;
  const ENTERPRISE_SECRET = process.env.ENTERPRISE_SECRET;

  // Initialize database client
  initDb();

  try {
    const body = await request.json();
    const { navn, epost, passord, firma, plan, enterpriseCode, industryId } = body;
    // billingInterval not used - Stripe temporarily disabled

    if (!navn || !epost || !passord || !firma) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Alle felt er påkrevd' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Industry is optional for MVP mode - skip validation if not provided
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY!
    );

    // Only validate industry if one was selected
    if (industryId) {
      const { data: industry, error: industryError } = await supabase
        .from('industry_templates')
        .select('id')
        .eq('id', industryId)
        .eq('aktiv', true)
        .single();

      if (industryError || !industry) {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig bransje valgt' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (!isValidEmail(epost)) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig e-postadresse' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const passwordValidation = validatePassword(passord, epost, navn);
    if (!passwordValidation.isValid) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: passwordValidation.errors.join('. ') } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const emailExists = await db.isEmailRegistered(epost.toLowerCase());
    if (emailExists) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'E-postadressen er allerede registrert' } }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const passwordHash = await bcrypt.hash(passord, 12);
    const slug = generateSlug(firma);

    // Enterprise registration (no Stripe required)
    if (plan === 'enterprise') {
      // Use timing-safe comparison to prevent timing attacks on enterprise code
      if (!ENTERPRISE_SECRET || !enterpriseCode || !timingSafeCompare(enterpriseCode, ENTERPRISE_SECRET)) {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig enterprise-kode' } }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Transaksjon: opprett organisasjon og bruker atomisk
      let organization: Awaited<ReturnType<typeof db.createOrganization>> | null = null;
      try {
        organization = await db.createOrganization({
          navn: firma,
          slug: slug,
          aktiv: true,
          plan_type: 'enterprise',
          max_kunder: 10000,
          max_brukere: 100,
          stripe_customer_id: undefined,
          subscription_status: 'active',
          industry_template_id: industryId || null, // Optional for MVP
          onboarding_completed: true,
          app_mode: 'mvp', // Default to MVP mode for new organizations
        });

        await db.createKlient({
          navn: navn,
          epost: epost.toLowerCase(),
          passord_hash: passwordHash,
          aktiv: true,
          organization_id: organization.id,
          rolle: 'admin',
        });
      } catch (error) {
        // Rollback: slett organisasjonen hvis brukeropprettelse feilet
        if (organization) {
          try {
            await supabase.from('organizations').delete().eq('id', organization.id);
          } catch {
            console.error('Failed to rollback organization:', organization.id);
          }
        }
        throw error;
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://skyplannerapp-production.up.railway.app';

      return new Response(
        JSON.stringify({
          success: true,
          redirectUrl: appUrl,
          organizationId: organization.id,
          message: 'Enterprise-konto opprettet',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Standard/Premium registration with trial period (no Stripe required)
    // Stripe payment is temporarily disabled - manual invoicing via Fiken
    const selectedPlan = plan === 'premium' ? 'premium' : 'standard';
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    // Transaksjon: opprett organisasjon og bruker atomisk
    let organization: Awaited<ReturnType<typeof db.createOrganization>> | null = null;
    try {
      organization = await db.createOrganization({
        navn: firma,
        slug: slug,
        aktiv: true,
        plan_type: selectedPlan,
        max_kunder: selectedPlan === 'premium' ? 500 : 200,
        max_brukere: selectedPlan === 'premium' ? 10 : 5,
        stripe_customer_id: undefined,
        subscription_status: 'trialing',
        trial_ends_at: trialEndsAt,
        industry_template_id: industryId || null, // Optional for MVP
        onboarding_completed: true,
        app_mode: 'mvp', // Default to MVP mode for new organizations
      });

      await db.createKlient({
        navn: navn,
        epost: epost.toLowerCase(),
        passord_hash: passwordHash,
        aktiv: true,
        organization_id: organization.id,
        rolle: 'admin',
      });
    } catch (error) {
      // Rollback: slett organisasjonen hvis brukeropprettelse feilet
      if (organization) {
        try {
          await supabase.from('organizations').delete().eq('id', organization.id);
        } catch (rollbackError) {
          console.error('Failed to rollback organization:', organization.id, rollbackError);
        }
      }
      throw error;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://skyplannerapp-production.up.railway.app';

    return new Response(
      JSON.stringify({
        success: true,
        redirectUrl: appUrl,
        organizationId: organization.id,
        message: 'Konto opprettet med 14 dagers prøveperiode',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

    /* STRIPE INTEGRATION - TEMPORARILY DISABLED
     * Re-enable when switching from manual Fiken invoicing to Stripe payments
     *
    if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_STANDARD || !STRIPE_PRICE_PREMIUM) {
      console.warn('Stripe not configured - registration disabled');
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Registrering er midlertidig utilgjengelig' } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
    });

    const PRICE_IDS = {
      standard: {
        monthly: STRIPE_PRICE_STANDARD,
        yearly: STRIPE_PRICE_STANDARD_YEARLY || STRIPE_PRICE_STANDARD,
      },
      premium: {
        monthly: STRIPE_PRICE_PREMIUM,
        yearly: STRIPE_PRICE_PREMIUM_YEARLY || STRIPE_PRICE_PREMIUM,
      },
    };

    const priceId = PRICE_IDS[selectedPlan][interval];

    if (!priceId) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'ERROR', message: 'Ugyldig abonnementsplan' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const stripeCustomer = await stripe.customers.create({
      email: epost.toLowerCase(),
      name: navn,
      metadata: {
        company: firma,
        billingInterval: interval,
      },
      tax: {
        validate_location: 'deferred',
      },
    });

    organization = await db.createOrganization({
      navn: firma,
      slug: slug,
      aktiv: true,
      plan_type: selectedPlan,
      max_kunder: selectedPlan === 'premium' ? 500 : 200,
      max_brukere: selectedPlan === 'premium' ? 10 : 5,
      stripe_customer_id: stripeCustomer.id,
      subscription_status: 'incomplete',
      industry_template_id: industryId,
      onboarding_completed: true,
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
        metadata: {
          organizationId: organization.id.toString(),
          billingInterval: interval,
        },
      },
      automatic_tax: { enabled: true },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://skyplanner.no'}/auth/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://skyplanner.no'}/auth/registrer`,
      metadata: {
        organizationId: organization.id.toString(),
        billingInterval: interval,
      },
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
    */
  } catch (error) {
    // Log error details for debugging (no user data)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('Registration error:', errorMessage);
    if (errorStack) console.error('Stack:', errorStack);

    // Return specific message if it's a known database error
    let userMessage = 'Registrering feilet';
    if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
      userMessage = 'En organisasjon med dette navnet finnes allerede. Prøv et annet bedriftsnavn.';
    } else if (errorMessage.includes('Failed to create')) {
      userMessage = errorMessage.replace('Failed to create organization: ', '').replace('Failed to create klient: ', '');
    }

    return new Response(
      JSON.stringify({ success: false, error: { code: 'ERROR', message: userMessage } }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

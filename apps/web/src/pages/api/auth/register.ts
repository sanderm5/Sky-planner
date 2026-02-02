import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import * as db from '@skyplanner/database';
import { createClient } from '@supabase/supabase-js';

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

  // Require at least one special character for stronger passwords
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(password)) {
    errors.push('Passord må inneholde minst ett spesialtegn (!@#$%^&* osv.)');
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
  const STRIPE_SECRET_KEY = import.meta.env.STRIPE_SECRET_KEY;
  const STRIPE_PRICE_STANDARD = import.meta.env.STRIPE_PRICE_STANDARD;
  const STRIPE_PRICE_PREMIUM = import.meta.env.STRIPE_PRICE_PREMIUM;
  const ENTERPRISE_SECRET = import.meta.env.ENTERPRISE_SECRET;

  // Initialize database client
  db.getSupabaseClient({
    supabaseUrl: import.meta.env.SUPABASE_URL,
    supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
  });

  try {
    const body = await request.json();
    const { navn, epost, passord, firma, plan, enterpriseCode, industryId } = body;

    if (!navn || !epost || !passord || !firma) {
      return new Response(
        JSON.stringify({ error: 'Alle felt er påkrevd' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!industryId) {
      return new Response(
        JSON.stringify({ error: 'Velg en bransje' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate that the industry exists
    const supabase = createClient(
      import.meta.env.SUPABASE_URL,
      import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY
    );
    const { data: industry, error: industryError } = await supabase
      .from('industry_templates')
      .select('id')
      .eq('id', industryId)
      .eq('aktiv', true)
      .single();

    if (industryError || !industry) {
      return new Response(
        JSON.stringify({ error: 'Ugyldig bransje valgt' }),
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

    const passwordHash = await bcrypt.hash(passord, 12);
    const slug = generateSlug(firma);

    // Enterprise registration (no Stripe required)
    if (plan === 'enterprise') {
      // Use timing-safe comparison to prevent timing attacks on enterprise code
      if (!ENTERPRISE_SECRET || !enterpriseCode || !timingSafeCompare(enterpriseCode, ENTERPRISE_SECRET)) {
        return new Response(
          JSON.stringify({ error: 'Ugyldig enterprise-kode' }),
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

      const appUrl = import.meta.env.PUBLIC_APP_URL || 'http://localhost:3000';

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

    // Standard/Premium registration requires Stripe
    if (!STRIPE_SECRET_KEY || !STRIPE_PRICE_STANDARD || !STRIPE_PRICE_PREMIUM) {
      console.warn('Stripe not configured - registration disabled');
      return new Response(
        JSON.stringify({ error: 'Registrering er midlertidig utilgjengelig' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
    });

    const PRICE_IDS = {
      standard: STRIPE_PRICE_STANDARD,
      premium: STRIPE_PRICE_PREMIUM,
    };

    const selectedPlan = plan === 'premium' ? 'premium' : 'standard';
    const priceId = PRICE_IDS[selectedPlan];

    if (!priceId) {
      return new Response(
        JSON.stringify({ error: 'Ugyldig abonnementsplan' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const stripeCustomer = await stripe.customers.create({
      email: epost.toLowerCase(),
      name: navn,
      metadata: { company: firma },
    });

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
    } catch (error) {
      // Rollback: slett organisasjonen og Stripe-kunden hvis noe feilet
      const rollbackErrors: string[] = [];

      if (organization) {
        try {
          await supabase.from('organizations').delete().eq('id', organization.id);
        } catch (rollbackError) {
          const errorMsg = `ORPHANED_ORGANIZATION: id=${organization.id}, name=${firma}`;
          console.error(errorMsg, rollbackError);
          rollbackErrors.push(errorMsg);
        }
      }

      try {
        await stripe.customers.del(stripeCustomer.id);
      } catch (rollbackError) {
        // Log with enough info to manually clean up orphaned Stripe customers
        const errorMsg = `ORPHANED_STRIPE_CUSTOMER: customerId=${stripeCustomer.id}, email=${epost}, name=${firma}`;
        console.error(errorMsg, rollbackError);
        rollbackErrors.push(errorMsg);
      }

      // If we have orphaned resources, log them all together for easier monitoring
      if (rollbackErrors.length > 0) {
        console.error('REGISTRATION_ROLLBACK_FAILED: Manual cleanup required', {
          errors: rollbackErrors,
          originalError: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        });
      }

      throw error;
    }

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
    // Log sanitized error - avoid exposing user data or internal details
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Registration error:', errorMessage);
    return new Response(
      JSON.stringify({ error: 'Registrering feilet' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

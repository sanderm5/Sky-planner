import { NextRequest } from 'next/server';
import * as db from '@skyplanner/database';
import { initDb } from '@/lib/db';

// Rate limiting - in-memory store
const contactAttempts = new Map<string, { count: number; lastAttempt: number }>();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_ATTEMPTS = 5;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = contactAttempts.get(ip);

  // Cleanup old entries periodically
  if (Math.random() < 0.01) {
    for (const [key, value] of contactAttempts.entries()) {
      if (now - value.lastAttempt > RATE_LIMIT_WINDOW) {
        contactAttempts.delete(key);
      }
    }
  }

  if (!attempts) {
    contactAttempts.set(ip, { count: 1, lastAttempt: now });
    return false;
  }

  if (now - attempts.lastAttempt > RATE_LIMIT_WINDOW) {
    contactAttempts.set(ip, { count: 1, lastAttempt: now });
    return false;
  }

  if (attempts.count >= MAX_ATTEMPTS) {
    return true;
  }

  attempts.count++;
  attempts.lastAttempt = now;
  return false;
}

// Input validation constants
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 30;
const MAX_COMPANY_LENGTH = 100;
const MAX_SUBJECT_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 5000;

// Email validation regex
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// Phone validation regex (allows common formats)
const PHONE_REGEX = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/;

export async function POST(request: NextRequest) {
  try {
    // Initialize database client
    initDb();

    // Rate limiting
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: 'For mange henvendelser. Vennligst vent en time før du prøver igjen.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { navn, epost, telefon, bedrift, emne, melding } = body;

    // Required fields validation
    if (!navn || !epost || !emne || !melding) {
      return new Response(
        JSON.stringify({ error: 'Vennligst fyll ut alle påkrevde felt' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Type validation
    if (typeof navn !== 'string' || typeof epost !== 'string' ||
        typeof emne !== 'string' || typeof melding !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Ugyldig dataformat' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Length validations
    if (navn.length > MAX_NAME_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Navn kan ikke være lengre enn ${MAX_NAME_LENGTH} tegn` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (epost.length > MAX_EMAIL_LENGTH) {
      return new Response(
        JSON.stringify({ error: `E-post kan ikke være lengre enn ${MAX_EMAIL_LENGTH} tegn` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (emne.length > MAX_SUBJECT_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Emne kan ikke være lengre enn ${MAX_SUBJECT_LENGTH} tegn` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (melding.length > MAX_MESSAGE_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Melding kan ikke være lengre enn ${MAX_MESSAGE_LENGTH} tegn` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Email format validation
    if (!EMAIL_REGEX.test(epost)) {
      return new Response(
        JSON.stringify({ error: 'Ugyldig e-postformat' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Optional field validations
    if (telefon) {
      if (typeof telefon !== 'string' || telefon.length > MAX_PHONE_LENGTH) {
        return new Response(
          JSON.stringify({ error: `Telefonnummer kan ikke være lengre enn ${MAX_PHONE_LENGTH} tegn` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (!PHONE_REGEX.test(telefon)) {
        return new Response(
          JSON.stringify({ error: 'Ugyldig telefonnummer-format' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    if (bedrift) {
      if (typeof bedrift !== 'string' || bedrift.length > MAX_COMPANY_LENGTH) {
        return new Response(
          JSON.stringify({ error: `Bedriftsnavn kan ikke være lengre enn ${MAX_COMPANY_LENGTH} tegn` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Sanitize inputs (trim whitespace)
    const sanitizedData = {
      name: navn.trim(),
      email: epost.trim().toLowerCase(),
      phone: telefon?.trim() || undefined,
      company: bedrift?.trim() || undefined,
      message: `[${emne.trim()}] ${melding.trim()}`,
    };

    // Save to database
    await db.createContactSubmission(sanitizedData);

    return new Response(
      JSON.stringify({ success: true, message: 'Takk for din henvendelse!' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Contact form error:', error);
    return new Response(
      JSON.stringify({ error: 'Kunne ikke sende melding' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

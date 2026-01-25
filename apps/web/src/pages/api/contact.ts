import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';

// Initialize Supabase client
db.getSupabaseClient({
  supabaseUrl: import.meta.env.SUPABASE_URL,
  supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
});

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { navn, epost, telefon, bedrift, emne, melding } = body;

    if (!navn || !epost || !emne || !melding) {
      return new Response(
        JSON.stringify({ error: 'Vennligst fyll ut alle påkrevde felt' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Save to database
    await db.createContactSubmission({
      name: navn,
      email: epost,
      phone: telefon || undefined,
      company: bedrift || undefined,
      message: `[${emne}] ${melding}`,
    });

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
};

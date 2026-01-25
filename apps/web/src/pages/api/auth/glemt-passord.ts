import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';

// Initialize Supabase client with Astro environment variables
db.getSupabaseClient({
  supabaseUrl: import.meta.env.SUPABASE_URL,
  supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
});

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { epost } = body;

    if (!epost) {
      return new Response(
        JSON.stringify({ error: 'E-post er påkrevd' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if user exists (but don't reveal this to the client)
    const klient = await db.getKlientByEmail(epost.toLowerCase());
    const bruker = klient ? null : await db.getBrukerByEmail(epost.toLowerCase());
    const user = klient || bruker;

    if (user) {
      // TODO: Implement actual password reset email
      // For now, log the request for demo purposes
      console.log(`Password reset requested for: ${epost}`);

      // In a real implementation, you would:
      // 1. Generate a secure reset token
      // 2. Store it in the database with an expiry
      // 3. Send an email with a link like /auth/tilbakestill-passord?token=xxx
    }

    // Always return success to prevent email enumeration attacks
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Hvis e-postadressen er registrert, vil du motta en e-post med instruksjoner.'
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Password reset error:', error);
    return new Response(
      JSON.stringify({ error: 'Noe gikk galt. Prøv igjen senere.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

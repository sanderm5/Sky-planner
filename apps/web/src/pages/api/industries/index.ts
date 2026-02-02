import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

// Create Supabase client
function getSupabase() {
  const supabaseUrl = import.meta.env.SUPABASE_URL;
  const supabaseKey = import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY;
  return createClient(supabaseUrl, supabaseKey);
}

export interface IndustryTemplate {
  id: number;
  name: string;
  slug: string;
  icon: string;
  color: string;
  description: string;
  sort_order: number;
}

/**
 * GET /api/industries
 * Returns all active industry templates
 */
export const GET: APIRoute = async () => {
  try {
    const supabase = getSupabase();

    const { data: industries, error } = await supabase
      .from('industry_templates')
      .select('id, name, slug, icon, color, description, sort_order')
      .eq('aktiv', true)
      .order('sort_order');

    if (error) {
      console.error('Error fetching industries:', error);
      return new Response(
        JSON.stringify({ error: 'Kunne ikke hente bransjer' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        industries: industries || [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Industries API error:', error);
    return new Response(
      JSON.stringify({ error: 'Serverfeil ved henting av bransjer' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

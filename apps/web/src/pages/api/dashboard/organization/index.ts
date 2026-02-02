import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';
import { requireApiAuth, isAuthError } from '../../../../middleware/auth';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
db.getSupabaseClient({
  supabaseUrl: import.meta.env.SUPABASE_URL,
  supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
});

// GET - Get organization details
export const GET: APIRoute = async ({ request }) => {
  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization } = authResult;

  return new Response(
    JSON.stringify({
      success: true,
      organization: {
        id: organization.id,
        navn: organization.navn,
        slug: organization.slug,
        plan_type: organization.plan_type,
        max_kunder: organization.max_kunder,
        max_brukere: organization.max_brukere,
        logo_url: organization.logo_url,
        primary_color: organization.primary_color,
        subscription_status: organization.subscription_status,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
};

// PUT - Update organization
export const PUT: APIRoute = async ({ request }) => {
  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization } = authResult;

  try {
    const body = await request.json();
    const { navn, logo_url, primary_color, industry_template_id } = body;

    // Build update object
    const updateData: Record<string, unknown> = {};

    // Validate and add industry_template_id if provided
    if (industry_template_id !== undefined) {
      const supabase = createClient(
        import.meta.env.SUPABASE_URL,
        import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY
      );
      const { data: industry, error: industryError } = await supabase
        .from('industry_templates')
        .select('id')
        .eq('id', industry_template_id)
        .eq('aktiv', true)
        .single();

      if (industryError || !industry) {
        return new Response(
          JSON.stringify({ error: 'Ugyldig bransje valgt' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updateData.industry_template_id = industry_template_id;
    }

    if (navn !== undefined) {
      if (!navn.trim()) {
        return new Response(
          JSON.stringify({ error: 'Organisasjonsnavn kan ikke være tomt' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (navn.length > 100) {
        return new Response(
          JSON.stringify({ error: 'Organisasjonsnavn kan ikke være lengre enn 100 tegn' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updateData.navn = navn.trim();
    }

    if (logo_url !== undefined) {
      if (logo_url) {
        // Validate URL format and security
        try {
          const url = new URL(logo_url);

          // Only allow HTTPS in production
          if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            throw new Error('Kun HTTP/HTTPS-URLer er tillatt');
          }

          // Block data URIs (potential XSS)
          if (logo_url.startsWith('data:')) {
            throw new Error('Data-URLer er ikke tillatt');
          }

          // Validate path doesn't contain path traversal
          if (url.pathname.includes('..')) {
            throw new Error('Ugyldig URL-path');
          }

          // Validate file extension for images
          const validExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'];
          const pathLower = url.pathname.toLowerCase();
          const hasValidExtension = validExtensions.some(ext => pathLower.endsWith(ext));

          // Allow Supabase storage URLs without extension check
          const isSupabaseUrl = url.hostname.includes('supabase.co');

          if (!hasValidExtension && !isSupabaseUrl) {
            throw new Error('Logo må være en bildefil (PNG, JPG, WebP, SVG eller GIF)');
          }

          // Max URL length
          if (logo_url.length > 2048) {
            throw new Error('URL er for lang (maks 2048 tegn)');
          }
        } catch (error) {
          return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Ugyldig logo-URL' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
      updateData.logo_url = logo_url || null;
    }

    if (primary_color !== undefined) {
      // Validate hex color (or null to clear)
      if (primary_color && !primary_color.match(/^#[0-9A-Fa-f]{6}$/)) {
        return new Response(
          JSON.stringify({ error: 'Ugyldig fargeformat. Bruk hex-format (#RRGGBB)' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      updateData.primary_color = primary_color || null;
    }

    if (Object.keys(updateData).length === 0) {
      return new Response(
        JSON.stringify({ error: 'Ingen felter å oppdatere' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update organization
    const updatedOrg = await db.updateOrganization(organization.id, updateData);

    return new Response(
      JSON.stringify({
        success: true,
        organization: {
          id: updatedOrg.id,
          navn: updatedOrg.navn,
          slug: updatedOrg.slug,
          plan_type: updatedOrg.plan_type,
          max_kunder: updatedOrg.max_kunder,
          max_brukere: updatedOrg.max_brukere,
          logo_url: updatedOrg.logo_url,
          primary_color: updatedOrg.primary_color,
          subscription_status: updatedOrg.subscription_status,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error updating organization:', error);
    return new Response(
      JSON.stringify({ error: 'Kunne ikke oppdatere organisasjon' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

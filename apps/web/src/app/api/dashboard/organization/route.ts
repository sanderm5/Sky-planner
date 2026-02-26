import { NextRequest } from 'next/server';
import * as db from '@skyplanner/database';
import { requireApiAuth, requireAdminApiAuth, isAuthError } from '@/lib/auth';
import { initDb } from '@/lib/db';
import { createClient } from '@supabase/supabase-js';

// GET - Get organization details
export async function GET(request: NextRequest) {
  initDb();

  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization } = authResult;

  return Response.json({
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
  }, { status: 200 });
}

// PUT - Update organization (admin only)
export async function PUT(request: NextRequest) {
  initDb();

  const authResult = await requireAdminApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization } = authResult;

  try {
    const body = await request.json();
    const { navn, logo_url, primary_color, industry_template_id, dato_modus, company_address, company_postnummer, company_poststed, route_start_lat, route_start_lng } = body;

    // Build update object
    const updateData: Record<string, unknown> = {};

    // Validate and add industry_template_id if provided
    if (industry_template_id !== undefined) {
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY!
      );
      const { data: industry, error: industryError } = await supabase
        .from('industry_templates')
        .select('id')
        .eq('id', industry_template_id)
        .eq('aktiv', true)
        .single();

      if (industryError || !industry) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Ugyldig bransje valgt' } },
          { status: 400 }
        );
      }
      updateData.industry_template_id = industry_template_id;
    }

    if (navn !== undefined) {
      if (!navn.trim()) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Organisasjonsnavn kan ikke være tomt' } },
          { status: 400 }
        );
      }
      if (navn.length > 100) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Organisasjonsnavn kan ikke være lengre enn 100 tegn' } },
          { status: 400 }
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
          return Response.json(
            { success: false, error: { code: 'ERROR', message: error instanceof Error ? error.message : 'Ugyldig logo-URL' } },
            { status: 400 }
          );
        }
      }
      updateData.logo_url = logo_url || null;
    }

    if (dato_modus !== undefined) {
      if (!['full_date', 'month_year'].includes(dato_modus)) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Ugyldig datoformat-modus' } },
          { status: 400 }
        );
      }
      updateData.dato_modus = dato_modus;
    }

    if (primary_color !== undefined) {
      // Validate hex color (or null to clear)
      if (primary_color && !primary_color.match(/^#[0-9A-Fa-f]{6}$/)) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Ugyldig fargeformat. Bruk hex-format (#RRGGBB)' } },
          { status: 400 }
        );
      }
      updateData.primary_color = primary_color || null;
    }

    // Company address fields
    if (company_address !== undefined) {
      if (company_address && company_address.length > 200) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Adresse kan ikke være lengre enn 200 tegn' } },
          { status: 400 }
        );
      }
      updateData.company_address = company_address?.trim() || null;
    }

    if (company_postnummer !== undefined) {
      if (company_postnummer && company_postnummer.length > 10) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Postnummer kan ikke være lengre enn 10 tegn' } },
          { status: 400 }
        );
      }
      updateData.company_postnummer = company_postnummer?.trim() || null;
    }

    if (company_poststed !== undefined) {
      if (company_poststed && company_poststed.length > 100) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Poststed kan ikke være lengre enn 100 tegn' } },
          { status: 400 }
        );
      }
      updateData.company_poststed = company_poststed?.trim() || null;
    }

    if (route_start_lat !== undefined) {
      if (route_start_lat !== null && (typeof route_start_lat !== 'number' || route_start_lat < -90 || route_start_lat > 90)) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Ugyldig breddegrad (latitude). Må være mellom -90 og 90.' } },
          { status: 400 }
        );
      }
      updateData.route_start_lat = route_start_lat;
    }

    if (route_start_lng !== undefined) {
      if (route_start_lng !== null && (typeof route_start_lng !== 'number' || route_start_lng < -180 || route_start_lng > 180)) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Ugyldig lengdegrad (longitude). Må være mellom -180 og 180.' } },
          { status: 400 }
        );
      }
      updateData.route_start_lng = route_start_lng;
    }

    if (Object.keys(updateData).length === 0) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Ingen felter å oppdatere' } },
        { status: 400 }
      );
    }

    // Update organization
    const updatedOrg = await db.updateOrganization(organization.id, updateData);

    return Response.json({
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
    }, { status: 200 });
  } catch (error) {
    console.error('Error updating organization:', error);
    const message = error instanceof Error ? error.message : 'Kunne ikke oppdatere organisasjon';
    return Response.json(
      { success: false, error: { code: 'ERROR', message: message } },
      { status: 500 }
    );
  }
}

import type { APIRoute } from 'astro';
import * as db from '@skyplanner/database';
import { requireApiAuth, isAuthError } from '../../../../middleware/auth';

// Initialize Supabase client
db.getSupabaseClient({
  supabaseUrl: import.meta.env.SUPABASE_URL,
  supabaseKey: import.meta.env.SUPABASE_SERVICE_KEY || import.meta.env.SUPABASE_ANON_KEY,
});

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

// POST - Upload logo to Supabase Storage
export const POST: APIRoute = async ({ request }) => {
  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization } = authResult;

  try {
    const formData = await request.formData();
    const file = formData.get('logo') as File | null;

    if (!file) {
      return new Response(
        JSON.stringify({ error: 'Ingen fil lastet opp' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return new Response(
        JSON.stringify({ error: 'Ugyldig filtype. Kun PNG, JPG, SVG og WebP er tillatt.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({ error: 'Filen er for stor. Maks 2MB.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Delete old logo from Supabase Storage if it exists
    if (organization.logo_url) {
      const oldPath = db.extractStoragePathFromUrl(organization.logo_url);
      if (oldPath) {
        try {
          await db.deleteLogo(oldPath);
        } catch {
          // Ignore deletion errors
        }
      }
    }

    // Upload new logo to Supabase Storage
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await db.uploadLogo(
      organization.id,
      buffer,
      file.name,
      file.type
    );

    // Update organization with new Supabase Storage URL
    const updatedOrg = await db.updateOrganization(organization.id, {
      logo_url: result.url,
    });

    return new Response(
      JSON.stringify({
        success: true,
        logo_url: result.url,
        organization: {
          id: updatedOrg.id,
          navn: updatedOrg.navn,
          logo_url: updatedOrg.logo_url,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Logo upload error:', error);
    return new Response(
      JSON.stringify({ error: 'Kunne ikke laste opp logo' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// DELETE - Remove logo from Supabase Storage
export const DELETE: APIRoute = async ({ request }) => {
  const authResult = await requireApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization } = authResult;

  try {
    // Delete file from Supabase Storage
    if (organization.logo_url) {
      const storagePath = db.extractStoragePathFromUrl(organization.logo_url);
      if (storagePath) {
        try {
          await db.deleteLogo(storagePath);
        } catch {
          // Ignore if file doesn't exist
        }
      }
    }

    // Clear logo URL in database
    await db.updateOrganization(organization.id, {
      logo_url: undefined,
    });

    return new Response(
      JSON.stringify({ success: true, message: 'Logo fjernet' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Logo delete error:', error);
    return new Response(
      JSON.stringify({ error: 'Kunne ikke fjerne logo' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

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

// Magic bytes for file type detection
const MAGIC_BYTES: Record<string, number[][]> = {
  'image/png': [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  'image/jpeg': [[0xFF, 0xD8, 0xFF]],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF header (WebP starts with RIFF)
  'image/gif': [[0x47, 0x49, 0x46, 0x38]], // GIF87a or GIF89a
};

/**
 * Validates file content by checking magic bytes
 * Returns the detected MIME type or null if invalid
 */
function detectFileType(buffer: Buffer): string | null {
  for (const [mimeType, signatures] of Object.entries(MAGIC_BYTES)) {
    for (const signature of signatures) {
      if (buffer.length >= signature.length) {
        const match = signature.every((byte, index) => buffer[index] === byte);
        if (match) {
          // Additional check for WebP: must have WEBP identifier at offset 8
          if (mimeType === 'image/webp') {
            const webpSignature = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
            const isWebP = buffer.length >= 12 &&
              webpSignature.every((byte, index) => buffer[8 + index] === byte);
            if (!isWebP) continue;
          }
          return mimeType;
        }
      }
    }
  }
  return null;
}

/**
 * Validates SVG content for potentially malicious elements
 * More comprehensive check against XSS vectors
 */
function validateSvgContent(content: string): { valid: boolean; error?: string } {
  // Decode common HTML entities that could be used to bypass checks
  const decodedContent = content
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");

  const lowerContent = decodedContent.toLowerCase();

  // Check for script tags (including variations with whitespace/newlines)
  if (/<\s*script/i.test(decodedContent)) {
    return { valid: false, error: 'SVG inneholder script-tags som ikke er tillatt' };
  }

  // Check for event handlers (onclick, onload, onerror, etc.)
  // More comprehensive pattern that handles whitespace and newlines
  const eventHandlerPattern = /\bon\w+\s*=/i;
  if (eventHandlerPattern.test(decodedContent)) {
    return { valid: false, error: 'SVG inneholder hendelseshåndterere som ikke er tillatt' };
  }

  // Check for javascript:, vbscript:, and data: URLs in any attribute
  const dangerousUrlPattern = /(?:javascript|vbscript|data\s*:(?!image\/))/i;
  if (dangerousUrlPattern.test(decodedContent)) {
    return { valid: false, error: 'SVG inneholder farlige URLer som ikke er tillatt' };
  }

  // Check for <foreignObject> which can embed HTML
  if (/<\s*foreignobject/i.test(decodedContent)) {
    return { valid: false, error: 'SVG inneholder foreignObject som ikke er tillatt' };
  }

  // Check for <iframe>, <embed>, <object> tags
  if (/<\s*(iframe|embed|object)/i.test(decodedContent)) {
    return { valid: false, error: 'SVG inneholder innebygde elementer som ikke er tillatt' };
  }

  // Check for XML external entity injection (XXE)
  if (/<!ENTITY/i.test(decodedContent) || /<!DOCTYPE[^>]*\[/i.test(decodedContent)) {
    return { valid: false, error: 'SVG inneholder XML-entiteter som ikke er tillatt' };
  }

  // Check for XML stylesheet processing instructions
  if (/<\?xml-stylesheet/i.test(decodedContent)) {
    return { valid: false, error: 'SVG inneholder XML-stylesheets som ikke er tillatt' };
  }

  // Check for external references (xlink:href, href to external URLs)
  if (/(?:xlink:)?href\s*=\s*["']https?:/i.test(decodedContent)) {
    return { valid: false, error: 'SVG inneholder eksterne referanser som ikke er tillatt' };
  }

  // Check for set/animate elements that could modify attributes to dangerous values
  if (/<\s*(set|animate)[^>]*(?:attributename\s*=\s*["']on|to\s*=\s*["']javascript)/i.test(decodedContent)) {
    return { valid: false, error: 'SVG inneholder farlige animasjonselementer' };
  }

  // Check for base64 encoded content that might hide malicious code
  // Allow data:image/* but block other base64 data URIs
  if (/data:[^;,]*;base64,[^"']*(?:PHNjcmlwdA|amF2YXNjcmlwdA)/i.test(decodedContent)) {
    return { valid: false, error: 'SVG inneholder mistenkelig base64-kodet innhold' };
  }

  return { valid: true };
}

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

    // Validate claimed MIME type
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

    // Read file content for validation
    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate actual file content (magic bytes) for non-SVG files
    if (file.type !== 'image/svg+xml') {
      const detectedType = detectFileType(buffer);
      if (!detectedType) {
        return new Response(
          JSON.stringify({ error: 'Filinnholdet matcher ikke den angitte filtypen' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // Verify detected type matches claimed type (allow JPEG for both image/jpeg)
      const normalizedClaimed = file.type === 'image/jpeg' ? 'image/jpeg' : file.type;
      if (detectedType !== normalizedClaimed) {
        return new Response(
          JSON.stringify({ error: 'Filinnholdet matcher ikke den angitte filtypen' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // Validate SVG content for security
      const svgContent = buffer.toString('utf-8');
      const svgValidation = validateSvgContent(svgContent);
      if (!svgValidation.valid) {
        return new Response(
          JSON.stringify({ error: svgValidation.error }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Logo upload error:', errorMessage);
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Logo delete error:', errorMessage);
    return new Response(
      JSON.stringify({ error: 'Kunne ikke fjerne logo' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

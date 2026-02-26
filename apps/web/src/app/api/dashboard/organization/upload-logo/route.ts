import { NextRequest } from 'next/server';
import * as db from '@skyplanner/database';
import { requireAdminApiAuth, isAuthError } from '@/lib/auth';
import { initDb } from '@/lib/db';

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

// Whitelist-based SVG sanitization — only allow safe elements and attributes
const SAFE_SVG_ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textpath', 'defs', 'use', 'symbol', 'clippath', 'mask',
  'lineargradient', 'radialgradient', 'stop', 'pattern', 'image', 'title', 'desc',
  'metadata', 'marker',
]);

const SAFE_SVG_ATTRIBUTES = new Set([
  // Core
  'id', 'class', 'style', 'transform', 'viewbox', 'xmlns', 'xmlns:xlink', 'version',
  // Presentation
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'clip-rule', 'opacity',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
  'text-decoration', 'dominant-baseline', 'alignment-baseline', 'letter-spacing',
  // Geometry
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
  'd', 'points', 'dx', 'dy', 'rotate', 'pathlength',
  // References (internal only — validated separately)
  'href', 'xlink:href', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end',
  // Gradient/pattern
  'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform',
  'spreadmethod', 'fx', 'fy', 'patternunits', 'patterntransform', 'patterncontentunits',
  // Other
  'preserveaspectratio', 'overflow', 'display', 'visibility',
]);

/**
 * Whitelist-based SVG sanitizer.
 * Strips all elements/attributes not on the whitelist, blocks dangerous URIs and event handlers.
 */
function validateSvgContent(content: string): { valid: boolean; error?: string } {
  // Block XXE / DOCTYPE with entity definitions
  if (/<!ENTITY/i.test(content) || /<!DOCTYPE[^>]*\[/i.test(content)) {
    return { valid: false, error: 'SVG inneholder XML-entiteter som ikke er tillatt' };
  }

  // Block processing instructions
  if (/<\?xml-stylesheet/i.test(content)) {
    return { valid: false, error: 'SVG inneholder XML-stylesheets som ikke er tillatt' };
  }

  // Decode entities to catch obfuscation before element/attribute checks
  const decoded = content
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));

  // Extract all element names and verify against whitelist
  const elementPattern = /<\/?([a-z][a-z0-9-]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = elementPattern.exec(decoded)) !== null) {
    const tagName = match[1].toLowerCase();
    if (!SAFE_SVG_ELEMENTS.has(tagName)) {
      return { valid: false, error: `SVG inneholder ikke-tillatt element: <${tagName}>` };
    }
  }

  // Block ALL event handler attributes (on*)
  if (/\bon[a-z]+\s*=/i.test(decoded)) {
    return { valid: false, error: 'SVG inneholder hendelseshåndterere som ikke er tillatt' };
  }

  // Block dangerous URI schemes in any attribute value
  if (/(?:javascript|vbscript|data\s*:(?!image\/(png|jpeg|jpg|gif|webp|svg\+xml)))/i.test(decoded)) {
    return { valid: false, error: 'SVG inneholder farlige URLer som ikke er tillatt' };
  }

  // Block href/xlink:href pointing to external URLs (only allow internal #references)
  const hrefPattern = /(?:xlink:)?href\s*=\s*["']([^"']*)/gi;
  let hrefMatch: RegExpExecArray | null;
  while ((hrefMatch = hrefPattern.exec(decoded)) !== null) {
    const hrefValue = hrefMatch[1].trim();
    if (hrefValue && !hrefValue.startsWith('#') && !hrefValue.startsWith('data:image/')) {
      return { valid: false, error: 'SVG inneholder eksterne referanser som ikke er tillatt' };
    }
  }

  // Verify all attributes against whitelist
  // Match attributes inside tags: <tagname attr1="val" attr2="val">
  const tagPattern = /<([a-z][a-z0-9-]*)\s+([^>]*?)\/?\s*>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(decoded)) !== null) {
    const attrString = tagMatch[2];
    const attrPattern = /([a-z][a-z0-9-:]*)\s*=/gi;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrPattern.exec(attrString)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      if (!SAFE_SVG_ATTRIBUTES.has(attrName)) {
        return { valid: false, error: `SVG inneholder ikke-tillatt attributt: ${attrName}` };
      }
    }
  }

  // Block base64-encoded script/javascript in any remaining content
  if (/(?:PHNjcmlwdA|amF2YXNjcmlwdA)/i.test(content)) {
    return { valid: false, error: 'SVG inneholder mistenkelig base64-kodet innhold' };
  }

  return { valid: true };
}

// POST - Upload logo to Supabase Storage (admin only)
export async function POST(request: NextRequest) {
  initDb();

  const authResult = await requireAdminApiAuth(request);
  if (isAuthError(authResult)) return authResult;

  const { organization } = authResult;

  try {
    const formData = await request.formData();
    const file = formData.get('logo') as File | null;

    if (!file) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Ingen fil lastet opp' } },
        { status: 400 }
      );
    }

    // Validate claimed MIME type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Ugyldig filtype. Kun PNG, JPG, SVG og WebP er tillatt.' } },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return Response.json(
        { success: false, error: { code: 'ERROR', message: 'Filen er for stor. Maks 2MB.' } },
        { status: 400 }
      );
    }

    // Read file content for validation
    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate actual file content (magic bytes) for non-SVG files
    if (file.type !== 'image/svg+xml') {
      const detectedType = detectFileType(buffer);
      if (!detectedType) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Filinnholdet matcher ikke den angitte filtypen' } },
          { status: 400 }
        );
      }
      // Verify detected type matches claimed type (allow JPEG for both image/jpeg)
      const normalizedClaimed = file.type === 'image/jpeg' ? 'image/jpeg' : file.type;
      if (detectedType !== normalizedClaimed) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: 'Filinnholdet matcher ikke den angitte filtypen' } },
          { status: 400 }
        );
      }
    } else {
      // Validate SVG content for security
      const svgContent = buffer.toString('utf-8');
      const svgValidation = validateSvgContent(svgContent);
      if (!svgValidation.valid) {
        return Response.json(
          { success: false, error: { code: 'ERROR', message: svgValidation.error } },
          { status: 400 }
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

    return Response.json({
      success: true,
      logo_url: result.url,
      organization: {
        id: updatedOrg.id,
        navn: updatedOrg.navn,
        logo_url: updatedOrg.logo_url,
      },
    }, { status: 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Logo upload error:', errorMessage);
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Kunne ikke laste opp logo' } },
      { status: 500 }
    );
  }
}

// DELETE - Remove logo from Supabase Storage (admin only)
export async function DELETE(request: NextRequest) {
  initDb();

  const authResult = await requireAdminApiAuth(request);
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

    return Response.json(
      { success: true, message: 'Logo fjernet' },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Logo delete error:', errorMessage);
    return Response.json(
      { success: false, error: { code: 'ERROR', message: 'Kunne ikke fjerne logo' } },
      { status: 500 }
    );
  }
}

/**
 * Supabase Storage utilities for file uploads
 * Handles logo uploads for organizations
 */
import { getSupabaseClient } from './client';
export const LOGOS_BUCKET = 'logos';
/**
 * Uploads a logo to Supabase Storage
 * @param organizationId - The organization's ID
 * @param file - The file buffer to upload
 * @param fileName - Original filename (used for extension)
 * @param contentType - MIME type of the file
 * @returns Object containing public URL and storage path
 */
export async function uploadLogo(organizationId, file, fileName, contentType) {
    const client = getSupabaseClient();
    // Extract extension from filename
    const ext = fileName.split('.').pop()?.toLowerCase() || 'png';
    const storagePath = `org-${organizationId}/${Date.now()}.${ext}`;
    const { error } = await client.storage
        .from(LOGOS_BUCKET)
        .upload(storagePath, file, {
        contentType,
        upsert: true,
    });
    if (error) {
        throw new Error(`Failed to upload logo: ${error.message}`);
    }
    const { data } = client.storage.from(LOGOS_BUCKET).getPublicUrl(storagePath);
    return {
        url: data.publicUrl,
        path: storagePath,
    };
}
/**
 * Deletes a logo from Supabase Storage
 * @param path - The storage path of the logo to delete
 */
export async function deleteLogo(path) {
    const client = getSupabaseClient();
    const { error } = await client.storage.from(LOGOS_BUCKET).remove([path]);
    if (error) {
        throw new Error(`Failed to delete logo: ${error.message}`);
    }
}
/**
 * Extracts the storage path from a Supabase public URL
 * @param url - Full public URL from Supabase Storage
 * @returns Storage path or null if not a valid Supabase URL
 */
export function extractStoragePathFromUrl(url) {
    if (!url)
        return null;
    // Match Supabase storage URL pattern
    const match = url.match(/\/storage\/v1\/object\/public\/logos\/(.+)$/);
    return match ? match[1] : null;
}
//# sourceMappingURL=storage.js.map
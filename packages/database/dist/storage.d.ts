/**
 * Supabase Storage utilities for file uploads
 * Handles logo uploads for organizations
 */
export declare const LOGOS_BUCKET = "logos";
export interface UploadResult {
    url: string;
    path: string;
}
/**
 * Uploads a logo to Supabase Storage
 * @param organizationId - The organization's ID
 * @param file - The file buffer to upload
 * @param fileName - Original filename (used for extension)
 * @param contentType - MIME type of the file
 * @returns Object containing public URL and storage path
 */
export declare function uploadLogo(organizationId: number, file: Buffer, fileName: string, contentType: string): Promise<UploadResult>;
/**
 * Deletes a logo from Supabase Storage
 * @param path - The storage path of the logo to delete
 */
export declare function deleteLogo(path: string): Promise<void>;
/**
 * Extracts the storage path from a Supabase public URL
 * @param url - Full public URL from Supabase Storage
 * @returns Storage path or null if not a valid Supabase URL
 */
export declare function extractStoragePathFromUrl(url: string): string | null;
//# sourceMappingURL=storage.d.ts.map
/**
 * Supabase client factory
 * Creates a configured Supabase client for El-Kontroll platform
 */
import { SupabaseClient } from '@supabase/supabase-js';
export interface DatabaseConfig {
    supabaseUrl: string;
    supabaseKey: string;
}
/**
 * Creates or returns a cached Supabase client
 * Uses singleton pattern to avoid creating multiple clients
 */
export declare function getSupabaseClient(config?: DatabaseConfig): SupabaseClient;
/**
 * Creates a fresh Supabase client (bypasses cache)
 * Useful for testing or when you need isolated clients
 */
export declare function createSupabaseClient(config: DatabaseConfig): SupabaseClient;
/**
 * Clears the cached client
 * Useful for testing or when credentials change
 */
export declare function clearClientCache(): void;
export type { SupabaseClient };
//# sourceMappingURL=client.d.ts.map
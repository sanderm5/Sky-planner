/**
 * Supabase client factory
 * Creates a configured Supabase client for El-Kontroll platform
 */
import { createClient } from '@supabase/supabase-js';
let cachedClient = null;
let cachedConfig = null;
/**
 * Creates or returns a cached Supabase client
 * Uses singleton pattern to avoid creating multiple clients
 */
export function getSupabaseClient(config) {
    // If config provided and different from cached, create new client
    if (config && (!cachedConfig ||
        config.supabaseUrl !== cachedConfig.supabaseUrl ||
        config.supabaseKey !== cachedConfig.supabaseKey)) {
        cachedClient = createClient(config.supabaseUrl, config.supabaseKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
        cachedConfig = config;
    }
    // If no client exists, try to create from environment
    if (!cachedClient) {
        const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_KEY ||
            process.env.SUPABASE_SERVICE_ROLE_KEY ||
            process.env.SUPABASE_ANON_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!url || !key) {
            throw new Error('Supabase URL and key must be provided via config or environment variables');
        }
        cachedClient = createClient(url, key, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
        cachedConfig = { supabaseUrl: url, supabaseKey: key };
    }
    return cachedClient;
}
/**
 * Creates a fresh Supabase client (bypasses cache)
 * Useful for testing or when you need isolated clients
 */
export function createSupabaseClient(config) {
    return createClient(config.supabaseUrl, config.supabaseKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}
/**
 * Clears the cached client
 * Useful for testing or when credentials change
 */
export function clearClientCache() {
    cachedClient = null;
    cachedConfig = null;
}
//# sourceMappingURL=client.js.map
import * as db from '@skyplanner/database';

let initialized = false;

export function initDb() {
  if (initialized) return;

  db.getSupabaseClient({
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY!,
  });

  initialized = true;
}

/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SUPABASE_URL: string;
  readonly SUPABASE_ANON_KEY: string;
  readonly SUPABASE_SERVICE_KEY: string;
  readonly JWT_SECRET: string;
  readonly STRIPE_SECRET_KEY: string;
  readonly STRIPE_WEBHOOK_SECRET: string;
  readonly STRIPE_PRICE_STANDARD: string;
  readonly STRIPE_PRICE_PREMIUM: string;
  readonly PUBLIC_BASE_URL: string;
  readonly PUBLIC_APP_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

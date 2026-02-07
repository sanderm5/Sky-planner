/**
 * Shared database types for El-Kontroll platform
 */

// ============ Organization & Subscription ============

export type AppMode = 'mvp' | 'full';

export interface Organization {
  id: number;
  navn: string;
  slug: string;
  aktiv: boolean;
  plan_type: 'free' | 'standard' | 'premium' | 'enterprise';
  max_kunder: number;
  max_brukere: number;
  brand_title?: string;
  brand_subtitle?: string;
  primary_color?: string;
  logo_url?: string;
  map_center_lat?: number;
  map_center_lng?: number;

  // Industry/onboarding
  industry_template_id?: number;
  onboarding_completed?: boolean;

  // App mode: 'mvp' = enkel versjon, 'full' = komplett (TRE Allservice)
  app_mode?: AppMode;

  // Stripe integration
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  subscription_status?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
  trial_ends_at?: string;
  current_period_end?: string;

  opprettet?: string;
}

export interface SubscriptionEvent {
  id: number;
  organization_id: number;
  stripe_event_id: string;
  event_type: string;
  data: Record<string, unknown>;
  processed_at?: string;
}

export interface OnboardingProgress {
  id: number;
  organization_id: number;
  steps_completed: string[];
  completed_at?: string;
  created_at?: string;
}

// ============ Auth Models ============

export interface Klient {
  id: number;
  navn: string;
  epost: string;
  passord_hash: string;
  telefon?: string;
  aktiv: boolean;
  organization_id?: number;
  opprettet?: string;
}

export interface Bruker {
  id: number;
  navn: string;
  epost: string;
  passord_hash: string;
  rolle: 'admin' | 'bruker';
  aktiv: boolean;
  organization_id?: number;
  sist_innlogget?: string;
  opprettet?: string;
}

// ============ Customer Models ============

export interface Kunde {
  id: number;
  navn: string;
  adresse: string;
  postnummer?: string;
  poststed?: string;
  telefon?: string;
  epost?: string;
  lat?: number;
  lng?: number;
  kategori?: string;
  el_type?: string;
  brann_system?: string;
  brann_driftstype?: string;
  siste_el_kontroll?: string;
  neste_el_kontroll?: string;
  el_kontroll_intervall?: number;
  siste_brann_kontroll?: string;
  neste_brann_kontroll?: string;
  brann_kontroll_intervall?: number;
  notater?: string;
  opprettet?: string;
  organization_id?: number;
}

// ============ Marketing Content ============

export interface BlogPost {
  id: number;
  slug: string;
  title: string;
  excerpt?: string;
  content: string;
  author?: string;
  published_at?: string;
  featured_image?: string;
  tags?: string[];
  status: 'draft' | 'published';
  created_at?: string;
  updated_at?: string;
}

export interface CustomerStory {
  id: number;
  company_name: string;
  contact_name?: string;
  industry?: string;
  quote: string;
  full_story?: string;
  logo_url?: string;
  featured: boolean;
  published: boolean;
  created_at?: string;
}

export interface ContactSubmission {
  id: number;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  message: string;
  status: 'new' | 'contacted' | 'closed';
  created_at?: string;
}

// ============ Insert/Update Types ============

export type InsertOrganization = Omit<Organization, 'id' | 'opprettet'>;
export type UpdateOrganization = Partial<InsertOrganization>;

export type InsertKlient = Omit<Klient, 'id' | 'opprettet'>;
export type UpdateKlient = Partial<InsertKlient>;

export type InsertKunde = Omit<Kunde, 'id' | 'opprettet'>;
export type UpdateKunde = Partial<InsertKunde>;

export type InsertBlogPost = Omit<BlogPost, 'id' | 'created_at' | 'updated_at'>;
export type UpdateBlogPost = Partial<InsertBlogPost>;

export type InsertContactSubmission = Omit<ContactSubmission, 'id' | 'created_at' | 'status'>;

// ============ Password Reset ============

export interface PasswordResetToken {
  id: number;
  user_id: number;
  user_type: 'klient' | 'bruker';
  token_hash: string;
  expires_at: string;
  used_at?: string;
  created_at?: string;
}

export type InsertPasswordResetToken = Omit<PasswordResetToken, 'id' | 'created_at' | 'used_at'>;

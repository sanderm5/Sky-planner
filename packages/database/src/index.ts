/**
 * @skyplanner/database
 * Shared database utilities for Sky Planner platform
 *
 * Provides Supabase client and query functions for:
 * - Organizations and subscriptions
 * - Authentication (klienter/brukere)
 * - Marketing content (blog, customer stories)
 */

// Client
export {
  getSupabaseClient,
  createSupabaseClient,
  clearClientCache,
  type DatabaseConfig,
  type SupabaseClient,
} from './client';

// Types
export type {
  Organization,
  SubscriptionEvent,
  OnboardingProgress,
  Klient,
  Bruker,
  Kunde,
  BlogPost,
  CustomerStory,
  ContactSubmission,
  InsertOrganization,
  UpdateOrganization,
  InsertKlient,
  UpdateKlient,
  InsertKunde,
  UpdateKunde,
  InsertBlogPost,
  UpdateBlogPost,
  InsertContactSubmission,
} from './types';

// Organization queries
export {
  createOrganization,
  getOrganizationById,
  getOrganizationBySlug,
  getOrganizationByStripeCustomer,
  updateOrganization,
  updateSubscriptionByStripeCustomer,
  hasActiveSubscription,
  logSubscriptionEvent,
  getOnboardingProgress,
  updateOnboardingProgress,
} from './organizations';

// Klient queries
export {
  createKlient,
  getKlientByEmail,
  getKlientById,
  updateKlient,
  updateKlientPassword,
  isEmailRegistered,
  getKlienterByOrganization,
} from './klienter';

// Bruker queries
export {
  getBrukerByEmail,
  getBrukerById,
} from './brukere';

// Storage utilities
export {
  uploadLogo,
  deleteLogo,
  extractStoragePathFromUrl,
  LOGOS_BUCKET,
  type UploadResult,
} from './storage';

// Contact submissions
export {
  createContactSubmission,
  getContactSubmissions,
  updateContactSubmissionStatus,
} from './contact';

/**
 * @skyplanner/database
 * Shared database utilities for Sky Planner platform
 *
 * Provides Supabase client and query functions for:
 * - Organizations and subscriptions
 * - Authentication (klienter/brukere)
 * - Marketing content (blog, customer stories)
 */
export { getSupabaseClient, createSupabaseClient, clearClientCache, type DatabaseConfig, type SupabaseClient, } from './client';
export type { Organization, SubscriptionEvent, OnboardingProgress, Klient, Bruker, Kunde, BlogPost, CustomerStory, ContactSubmission, PasswordResetToken, InsertOrganization, UpdateOrganization, InsertKlient, UpdateKlient, InsertKunde, UpdateKunde, InsertBlogPost, UpdateBlogPost, InsertContactSubmission, InsertPasswordResetToken, } from './types';
export { createOrganization, getOrganizationById, getOrganizationBySlug, getOrganizationByStripeCustomer, updateOrganization, updateSubscriptionByStripeCustomer, hasActiveSubscription, logSubscriptionEvent, getOnboardingProgress, updateOnboardingProgress, } from './organizations';
export { createKlient, getKlientByEmail, getKlientById, updateKlient, updateKlientPassword, isEmailRegistered, getKlienterByOrganization, createPasswordResetToken, getValidPasswordResetToken, markPasswordResetTokenUsed, deleteExpiredPasswordResetTokens, getKundeCountByOrganization, } from './klienter';
export { getBrukerByEmail, getBrukerById, } from './brukere';
export { uploadLogo, deleteLogo, extractStoragePathFromUrl, LOGOS_BUCKET, type UploadResult, } from './storage';
export { createContactSubmission, getContactSubmissions, updateContactSubmissionStatus, } from './contact';
//# sourceMappingURL=index.d.ts.map
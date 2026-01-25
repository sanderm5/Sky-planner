/**
 * Organization database operations
 * Handles organizations and subscription management
 */
import type { Organization, InsertOrganization, UpdateOrganization, SubscriptionEvent, OnboardingProgress } from './types';
/**
 * Creates a new organization
 */
export declare function createOrganization(data: InsertOrganization): Promise<Organization>;
/**
 * Gets an organization by ID
 */
export declare function getOrganizationById(id: number): Promise<Organization | null>;
/**
 * Gets an organization by slug
 */
export declare function getOrganizationBySlug(slug: string): Promise<Organization | null>;
/**
 * Gets an organization by Stripe customer ID
 */
export declare function getOrganizationByStripeCustomer(stripeCustomerId: string): Promise<Organization | null>;
/**
 * Updates an organization
 */
export declare function updateOrganization(id: number, data: UpdateOrganization): Promise<Organization>;
/**
 * Updates subscription status by Stripe customer ID
 */
export declare function updateSubscriptionByStripeCustomer(stripeCustomerId: string, data: {
    subscription_status?: Organization['subscription_status'];
    stripe_subscription_id?: string;
    current_period_end?: string;
    trial_ends_at?: string;
    plan_type?: Organization['plan_type'];
}): Promise<Organization | null>;
/**
 * Checks if an organization has an active subscription
 */
export declare function hasActiveSubscription(organizationId: number): Promise<boolean>;
/**
 * Logs a Stripe event for debugging and auditing
 */
export declare function logSubscriptionEvent(event: Omit<SubscriptionEvent, 'id' | 'processed_at'>): Promise<SubscriptionEvent>;
/**
 * Gets onboarding progress for an organization
 */
export declare function getOnboardingProgress(organizationId: number): Promise<OnboardingProgress | null>;
/**
 * Updates onboarding progress
 */
export declare function updateOnboardingProgress(organizationId: number, step: string): Promise<OnboardingProgress>;
//# sourceMappingURL=organizations.d.ts.map
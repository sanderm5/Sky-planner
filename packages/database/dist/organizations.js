/**
 * Organization database operations
 * Handles organizations and subscription management
 */
import { getSupabaseClient } from './client';
/**
 * Creates a new organization
 */
export async function createOrganization(data) {
    const client = getSupabaseClient();
    const { data: org, error } = await client
        .from('organizations')
        .insert(data)
        .select()
        .single();
    if (error)
        throw new Error(`Failed to create organization: ${error.message}`);
    return org;
}
/**
 * Gets an organization by ID
 */
export async function getOrganizationById(id) {
    const client = getSupabaseClient();
    const { data, error } = await client
        .from('organizations')
        .select('*')
        .eq('id', id)
        .single();
    if (error) {
        if (error.code === 'PGRST116')
            return null;
        throw new Error(`Failed to get organization: ${error.message}`);
    }
    return data;
}
/**
 * Gets an organization by slug
 */
export async function getOrganizationBySlug(slug) {
    const client = getSupabaseClient();
    const { data, error } = await client
        .from('organizations')
        .select('*')
        .eq('slug', slug)
        .single();
    if (error) {
        if (error.code === 'PGRST116')
            return null;
        throw new Error(`Failed to get organization: ${error.message}`);
    }
    return data;
}
/**
 * Gets an organization by Stripe customer ID
 */
export async function getOrganizationByStripeCustomer(stripeCustomerId) {
    const client = getSupabaseClient();
    const { data, error } = await client
        .from('organizations')
        .select('*')
        .eq('stripe_customer_id', stripeCustomerId)
        .single();
    if (error) {
        if (error.code === 'PGRST116')
            return null;
        throw new Error(`Failed to get organization: ${error.message}`);
    }
    return data;
}
/**
 * Updates an organization
 */
export async function updateOrganization(id, data) {
    const client = getSupabaseClient();
    const { data: org, error } = await client
        .from('organizations')
        .update(data)
        .eq('id', id)
        .select()
        .single();
    if (error)
        throw new Error(`Failed to update organization: ${error.message}`);
    return org;
}
/**
 * Updates subscription status by Stripe customer ID
 */
export async function updateSubscriptionByStripeCustomer(stripeCustomerId, data) {
    const client = getSupabaseClient();
    const { data: org, error } = await client
        .from('organizations')
        .update(data)
        .eq('stripe_customer_id', stripeCustomerId)
        .select()
        .single();
    if (error) {
        if (error.code === 'PGRST116')
            return null;
        throw new Error(`Failed to update subscription: ${error.message}`);
    }
    return org;
}
/**
 * Checks if an organization has an active subscription
 */
export async function hasActiveSubscription(organizationId) {
    const org = await getOrganizationById(organizationId);
    if (!org)
        return false;
    const activeStatuses = ['active', 'trialing'];
    return activeStatuses.includes(org.subscription_status || '');
}
/**
 * Logs a Stripe event for debugging and auditing
 */
export async function logSubscriptionEvent(event) {
    const client = getSupabaseClient();
    const { data, error } = await client
        .from('subscription_events')
        .insert(event)
        .select()
        .single();
    if (error)
        throw new Error(`Failed to log subscription event: ${error.message}`);
    return data;
}
/**
 * Gets onboarding progress for an organization
 */
export async function getOnboardingProgress(organizationId) {
    const client = getSupabaseClient();
    const { data, error } = await client
        .from('onboarding_progress')
        .select('*')
        .eq('organization_id', organizationId)
        .single();
    if (error) {
        if (error.code === 'PGRST116')
            return null;
        throw new Error(`Failed to get onboarding progress: ${error.message}`);
    }
    return data;
}
/**
 * Updates onboarding progress
 */
export async function updateOnboardingProgress(organizationId, step) {
    const client = getSupabaseClient();
    // Get current progress
    const current = await getOnboardingProgress(organizationId);
    if (current) {
        // Add step if not already completed
        const steps = current.steps_completed || [];
        if (!steps.includes(step)) {
            steps.push(step);
        }
        const { data, error } = await client
            .from('onboarding_progress')
            .update({ steps_completed: steps })
            .eq('organization_id', organizationId)
            .select()
            .single();
        if (error)
            throw new Error(`Failed to update onboarding: ${error.message}`);
        return data;
    }
    else {
        // Create new progress record
        const { data, error } = await client
            .from('onboarding_progress')
            .insert({
            organization_id: organizationId,
            steps_completed: [step],
        })
            .select()
            .single();
        if (error)
            throw new Error(`Failed to create onboarding: ${error.message}`);
        return data;
    }
}
//# sourceMappingURL=organizations.js.map
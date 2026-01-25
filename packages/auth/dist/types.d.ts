/**
 * Shared authentication types for El-Kontroll platform
 */
export interface JWTPayload {
    userId: number;
    epost: string;
    organizationId?: number;
    organizationSlug?: string;
    type: 'klient' | 'bruker';
    subscriptionStatus?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
    subscriptionPlan?: 'free' | 'standard' | 'premium' | 'enterprise';
    trialEndsAt?: string;
    currentPeriodEnd?: string;
    iat?: number;
    exp?: number;
}
export interface CookieOptions {
    name: string;
    options: {
        domain?: string;
        path: string;
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'strict' | 'lax' | 'none';
        maxAge: number;
    };
}
export interface TokenOptions {
    expiresIn?: string | number;
}
export interface VerifyResult {
    success: boolean;
    payload?: JWTPayload;
    error?: 'expired' | 'invalid' | 'malformed';
}
//# sourceMappingURL=types.d.ts.map
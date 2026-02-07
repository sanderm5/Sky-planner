/**
 * Password Validation Module
 * Enforces strong password requirements for security
 */
export interface PasswordValidationResult {
    valid: boolean;
    errors: string[];
    strength: 'weak' | 'fair' | 'good' | 'strong';
    score: number;
}
export interface PasswordValidationOptions {
    minLength?: number;
    requireUppercase?: boolean;
    requireLowercase?: boolean;
    requireNumber?: boolean;
    requireSpecial?: boolean;
    checkCommonPasswords?: boolean;
    userContext?: {
        email?: string;
        name?: string;
    };
}
/**
 * Validate password against security requirements
 */
export declare function validatePassword(password: string, options?: PasswordValidationOptions): PasswordValidationResult;
/**
 * Quick check if password meets minimum requirements
 * Returns true if valid, throws error with message if not
 */
export declare function assertValidPassword(password: string, options?: PasswordValidationOptions): void;
/**
 * Get a human-readable password strength label
 */
export declare function getPasswordStrengthLabel(strength: 'weak' | 'fair' | 'good' | 'strong'): string;
//# sourceMappingURL=password-validation.d.ts.map
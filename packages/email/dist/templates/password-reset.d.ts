/**
 * Password reset email template
 * Sent when a user requests a password reset
 */
export interface PasswordResetData {
    userName: string;
    resetUrl: string;
    expiresInMinutes?: number;
}
export declare function passwordResetEmail(data: PasswordResetData): {
    subject: string;
    html: string;
};
//# sourceMappingURL=password-reset.d.ts.map
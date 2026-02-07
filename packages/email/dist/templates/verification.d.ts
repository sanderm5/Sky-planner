/**
 * Email verification template
 */
export interface EmailVerificationData {
    userName: string;
    verificationUrl: string;
    expiresInMinutes?: number;
}
export declare function emailVerificationEmail(data: EmailVerificationData): {
    subject: string;
    html: string;
};
//# sourceMappingURL=verification.d.ts.map
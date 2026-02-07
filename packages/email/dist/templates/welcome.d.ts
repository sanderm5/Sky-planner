/**
 * Welcome email template
 * Sent after successful registration
 */
export interface WelcomeEmailData {
    userName: string;
    organizationName: string;
    loginUrl: string;
    trialDays?: number;
}
export declare function welcomeEmail(data: WelcomeEmailData): {
    subject: string;
    html: string;
};
//# sourceMappingURL=welcome.d.ts.map
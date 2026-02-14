/**
 * @skyplanner/email
 * Email templates and sending utilities for Sky Planner
 */
export { baseTemplate, emailButton, infoBox } from './templates/base';
export { welcomeEmail, type WelcomeEmailData, } from './templates/welcome';
export { subscriptionActivatedEmail, trialEndingEmail, paymentFailedEmail, subscriptionCanceledEmail, type SubscriptionActivatedData, type TrialEndingData, type PaymentFailedData, type SubscriptionCanceledData, } from './templates/subscription';
export { emailVerificationEmail, type EmailVerificationData, } from './templates/verification';
export { accountDeletionScheduledTemplate, accountDeletionCompletedTemplate, accountDeletionCancelledTemplate, type AccountDeletionScheduledData, type AccountDeletionCompletedData, type AccountDeletionCancelledData, } from './templates/account-deletion';
export { passwordResetEmail, type PasswordResetData, } from './templates/password-reset';
export { teamInvitationEmail, type TeamInvitationData, } from './templates/team-invitation';
export interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
    from?: string;
    replyTo?: string;
}
export interface EmailConfig {
    resendApiKey: string;
    fromEmail: string;
    fromName?: string;
}
/**
 * Send an email using Resend API
 */
export declare function sendEmail(options: SendEmailOptions, config: EmailConfig): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
}>;
/**
 * Create a pre-configured email sender
 */
export declare function createEmailSender(config: EmailConfig): {
    send: (options: Omit<SendEmailOptions, "from">) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    sendWelcome: (to: string, data: import("./templates/welcome").WelcomeEmailData) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    sendVerification: (to: string, data: import("./templates/verification").EmailVerificationData) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    sendSubscriptionActivated: (to: string, data: import("./templates/subscription").SubscriptionActivatedData) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    sendTrialEnding: (to: string, data: import("./templates/subscription").TrialEndingData) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    sendPaymentFailed: (to: string, data: import("./templates/subscription").PaymentFailedData) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    sendSubscriptionCanceled: (to: string, data: import("./templates/subscription").SubscriptionCanceledData) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    sendAccountDeletionScheduled: (to: string, data: import("./templates/account-deletion").AccountDeletionScheduledData) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    sendAccountDeletionCompleted: (to: string, data: import("./templates/account-deletion").AccountDeletionCompletedData) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    sendAccountDeletionCancelled: (to: string, data: import("./templates/account-deletion").AccountDeletionCancelledData) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    sendPasswordReset: (to: string, data: import("./templates/password-reset").PasswordResetData) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    sendTeamInvitation: (to: string, data: import("./templates/team-invitation").TeamInvitationData) => Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
};
//# sourceMappingURL=index.d.ts.map
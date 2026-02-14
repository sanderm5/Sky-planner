/**
 * @skyplanner/email
 * Email templates and sending utilities for Sky Planner
 */
// Template exports
export { baseTemplate, emailButton, infoBox } from './templates/base';
export { welcomeEmail, } from './templates/welcome';
export { subscriptionActivatedEmail, trialEndingEmail, paymentFailedEmail, subscriptionCanceledEmail, } from './templates/subscription';
export { emailVerificationEmail, } from './templates/verification';
export { accountDeletionScheduledTemplate, accountDeletionCompletedTemplate, accountDeletionCancelledTemplate, } from './templates/account-deletion';
export { passwordResetEmail, } from './templates/password-reset';
export { teamInvitationEmail, } from './templates/team-invitation';
/**
 * Send an email using Resend API
 */
export async function sendEmail(options, config) {
    const { to, subject, html, from, replyTo } = options;
    const { resendApiKey, fromEmail, fromName } = config;
    if (!resendApiKey) {
        console.warn('[Email] RESEND_API_KEY not configured, email not sent:', { to, subject });
        return { success: false, error: 'Email not configured' };
    }
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${resendApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: from || (fromName ? `${fromName} <${fromEmail}>` : fromEmail),
                to,
                subject,
                html,
                reply_to: replyTo,
            }),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('[Email] Failed to send email:', errorData);
            return {
                success: false,
                error: errorData.message || 'Failed to send email',
            };
        }
        const data = await response.json();
        return { success: true, messageId: data.id };
    }
    catch (error) {
        console.error('[Email] Error sending email:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
/**
 * Create a pre-configured email sender
 */
export function createEmailSender(config) {
    return {
        send: (options) => sendEmail(options, config),
        sendWelcome: async (to, data) => {
            const { subject, html } = (await import('./templates/welcome')).welcomeEmail(data);
            return sendEmail({ to, subject, html }, config);
        },
        sendVerification: async (to, data) => {
            const { subject, html } = (await import('./templates/verification')).emailVerificationEmail(data);
            return sendEmail({ to, subject, html }, config);
        },
        sendSubscriptionActivated: async (to, data) => {
            const { subject, html } = (await import('./templates/subscription')).subscriptionActivatedEmail(data);
            return sendEmail({ to, subject, html }, config);
        },
        sendTrialEnding: async (to, data) => {
            const { subject, html } = (await import('./templates/subscription')).trialEndingEmail(data);
            return sendEmail({ to, subject, html }, config);
        },
        sendPaymentFailed: async (to, data) => {
            const { subject, html } = (await import('./templates/subscription')).paymentFailedEmail(data);
            return sendEmail({ to, subject, html }, config);
        },
        sendSubscriptionCanceled: async (to, data) => {
            const { subject, html } = (await import('./templates/subscription')).subscriptionCanceledEmail(data);
            return sendEmail({ to, subject, html }, config);
        },
        sendAccountDeletionScheduled: async (to, data) => {
            const html = (await import('./templates/account-deletion')).accountDeletionScheduledTemplate(data);
            return sendEmail({ to, subject: 'Kontosletting planlagt - Sky Planner', html }, config);
        },
        sendAccountDeletionCompleted: async (to, data) => {
            const html = (await import('./templates/account-deletion')).accountDeletionCompletedTemplate(data);
            return sendEmail({ to, subject: 'Din konto er slettet - Sky Planner', html }, config);
        },
        sendAccountDeletionCancelled: async (to, data) => {
            const html = (await import('./templates/account-deletion')).accountDeletionCancelledTemplate(data);
            return sendEmail({ to, subject: 'Kontosletting kansellert - Sky Planner', html }, config);
        },
        sendPasswordReset: async (to, data) => {
            const { subject, html } = (await import('./templates/password-reset')).passwordResetEmail(data);
            return sendEmail({ to, subject, html }, config);
        },
        sendTeamInvitation: async (to, data) => {
            const { subject, html } = (await import('./templates/team-invitation')).teamInvitationEmail(data);
            return sendEmail({ to, subject, html }, config);
        },
    };
}
//# sourceMappingURL=index.js.map
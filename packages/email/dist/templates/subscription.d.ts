/**
 * Subscription-related email templates
 */
export interface SubscriptionActivatedData {
    userName: string;
    planName: string;
    price: string;
    billingCycle: 'monthly' | 'yearly';
    dashboardUrl: string;
}
export declare function subscriptionActivatedEmail(data: SubscriptionActivatedData): {
    subject: string;
    html: string;
};
export interface TrialEndingData {
    userName: string;
    daysRemaining: number;
    upgradeUrl: string;
}
export declare function trialEndingEmail(data: TrialEndingData): {
    subject: string;
    html: string;
};
export interface PaymentFailedData {
    userName: string;
    planName: string;
    updatePaymentUrl: string;
    gracePeriodDays: number;
}
export declare function paymentFailedEmail(data: PaymentFailedData): {
    subject: string;
    html: string;
};
export interface SubscriptionCanceledData {
    userName: string;
    endDate: string;
    reactivateUrl: string;
}
export declare function subscriptionCanceledEmail(data: SubscriptionCanceledData): {
    subject: string;
    html: string;
};
//# sourceMappingURL=subscription.d.ts.map
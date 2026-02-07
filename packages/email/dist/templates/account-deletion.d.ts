export interface AccountDeletionScheduledData {
    userName: string;
    scheduledDate: string;
    gracePeriodDays: number;
    cancelUrl: string;
    exportUrl: string;
}
export declare function accountDeletionScheduledTemplate(data: AccountDeletionScheduledData): string;
export interface AccountDeletionCompletedData {
    userName: string;
}
export declare function accountDeletionCompletedTemplate(data: AccountDeletionCompletedData): string;
export interface AccountDeletionCancelledData {
    userName: string;
    dashboardUrl: string;
}
export declare function accountDeletionCancelledTemplate(data: AccountDeletionCancelledData): string;
//# sourceMappingURL=account-deletion.d.ts.map
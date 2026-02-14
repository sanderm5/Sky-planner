/**
 * Team invitation email template
 * Sent when an admin invites a new team member
 */
export interface TeamInvitationData {
    inviteeName: string;
    inviterName: string;
    organizationName: string;
    loginUrl: string;
    tempPassword?: string;
}
export declare function teamInvitationEmail(data: TeamInvitationData): {
    subject: string;
    html: string;
};
//# sourceMappingURL=team-invitation.d.ts.map
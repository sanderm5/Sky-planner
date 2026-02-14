/**
 * Team invitation email template
 * Sent when an admin invites a new team member
 */
import { baseTemplate, emailButton, infoBox } from './base';
export function teamInvitationEmail(data) {
    const { inviteeName, inviterName, organizationName, loginUrl, tempPassword } = data;
    const passwordSection = tempPassword
        ? `
${infoBox(`Ditt midlertidige passord: <strong>${tempPassword}</strong><br>Du bør endre passordet etter første innlogging.`, 'warning')}
`
        : '';
    const content = `
<h2 style="margin: 0 0 20px 0; color: #18181b; font-size: 24px; font-weight: 600;">
  Du er invitert til Sky Planner
</h2>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Hei ${inviteeName},
</p>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  ${inviterName} har lagt deg til som teammedlem i <strong>${organizationName}</strong> på Sky Planner.
</p>

${passwordSection}

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Logg inn for å komme i gang:
</p>

${emailButton('Logg inn på Sky Planner', loginUrl)}

<p style="margin: 20px 0 0 0; color: #71717a; font-size: 14px; line-height: 1.5;">
  Har du spørsmål? Kontakt ${inviterName} eller svar på denne e-posten.
</p>
`.trim();
    return {
        subject: `Du er invitert til ${organizationName} på Sky Planner`,
        html: baseTemplate(content, {
            previewText: `${inviterName} har invitert deg til ${organizationName} på Sky Planner.`,
        }),
    };
}
//# sourceMappingURL=team-invitation.js.map
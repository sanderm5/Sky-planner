/**
 * Email verification template
 */
import { baseTemplate, emailButton, infoBox, escapeHtmlEmail } from './base';
export function emailVerificationEmail(data) {
    const { userName, verificationUrl, expiresInMinutes = 60 } = data;
    const content = `
<h2 style="margin: 0 0 20px 0; color: #18181b; font-size: 24px; font-weight: 600;">
  Bekreft e-postadressen din
</h2>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Hei ${escapeHtmlEmail(userName)},
</p>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Takk for at du registrerte deg på Sky Planner! Vennligst bekreft e-postadressen din ved å klikke på knappen nedenfor.
</p>

${emailButton('Bekreft e-postadresse', verificationUrl)}

${infoBox(`Denne lenken utløper om ${expiresInMinutes} minutter.`, 'info')}

<p style="margin: 20px 0 0 0; color: #71717a; font-size: 14px; line-height: 1.5;">
  Hvis du ikke opprettet en konto på Sky Planner, kan du ignorere denne e-posten.
</p>
`.trim();
    return {
        subject: 'Bekreft e-postadressen din - Sky Planner',
        html: baseTemplate(content, {
            previewText: 'Vennligst bekreft e-postadressen din for å fullføre registreringen.',
        }),
    };
}
//# sourceMappingURL=verification.js.map
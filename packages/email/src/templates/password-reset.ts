/**
 * Password reset email template
 * Sent when a user requests a password reset
 */

import { baseTemplate, emailButton, infoBox } from './base';

export interface PasswordResetData {
  userName: string;
  resetUrl: string;
  expiresInMinutes?: number;
}

export function passwordResetEmail(data: PasswordResetData): { subject: string; html: string } {
  const { userName, resetUrl, expiresInMinutes = 60 } = data;

  const content = `
<h2 style="margin: 0 0 20px 0; color: #18181b; font-size: 24px; font-weight: 600;">
  Tilbakestill passord
</h2>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Hei ${userName},
</p>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Vi mottok en forespørsel om å tilbakestille passordet ditt for Sky Planner.
  Klikk på knappen under for å velge et nytt passord.
</p>

${emailButton('Tilbakestill passord', resetUrl)}

${infoBox(`Denne lenken utløper om ${expiresInMinutes} minutter. Hvis du ikke ba om å tilbakestille passordet, kan du trygt ignorere denne e-posten.`, 'warning')}

<p style="margin: 20px 0 0 0; color: #71717a; font-size: 14px; line-height: 1.5;">
  Hvis knappen ikke fungerer, kopier og lim inn denne lenken i nettleseren:
</p>
<p style="margin: 4px 0 0 0; color: #71717a; font-size: 12px; line-height: 1.5; word-break: break-all;">
  ${resetUrl}
</p>
`.trim();

  return {
    subject: 'Tilbakestill passord - Sky Planner',
    html: baseTemplate(content, {
      previewText: 'Du har bedt om å tilbakestille passordet ditt for Sky Planner.',
    }),
  };
}

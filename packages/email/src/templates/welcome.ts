/**
 * Welcome email template
 * Sent after successful registration
 */

import { baseTemplate, emailButton, infoBox, escapeHtmlEmail } from './base';

export interface WelcomeEmailData {
  userName: string;
  organizationName: string;
  loginUrl: string;
  trialDays?: number;
}

export function welcomeEmail(data: WelcomeEmailData): { subject: string; html: string } {
  const { userName, organizationName, loginUrl, trialDays = 14 } = data;

  const content = `
<h2 style="margin: 0 0 20px 0; color: #18181b; font-size: 24px; font-weight: 600;">
  Velkommen til Sky Planner, ${escapeHtmlEmail(userName)}!
</h2>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Takk for at du valgte Sky Planner for <strong>${escapeHtmlEmail(organizationName)}</strong>.
  Vi er glade for å ha deg med!
</p>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Du har nå ${trialDays} dagers gratis prøveperiode med full tilgang til alle funksjoner.
</p>

${infoBox(`Din prøveperiode varer i ${trialDays} dager. Du kan når som helst oppgradere til et betalt abonnement.`, 'info')}

<p style="margin: 20px 0 0 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  <strong>Kom i gang:</strong>
</p>

<ul style="margin: 10px 0 20px 0; padding-left: 20px; color: #3f3f46; font-size: 16px; line-height: 1.8;">
  <li>Importer kundene dine fra Excel eller CSV</li>
  <li>Se kundene dine på kartet</li>
  <li>Planlegg optimale serviceruter</li>
  <li>Hold oversikt over kommende kontroller</li>
</ul>

${emailButton('Logg inn på Sky Planner', loginUrl)}

<p style="margin: 20px 0 0 0; color: #71717a; font-size: 14px; line-height: 1.5;">
  Har du spørsmål? Svar på denne e-posten, så hjelper vi deg gjerne.
</p>
`.trim();

  return {
    subject: `Velkommen til Sky Planner, ${escapeHtmlEmail(userName)}!`,
    html: baseTemplate(content, {
      previewText: `Takk for at du valgte Sky Planner. Du har ${trialDays} dagers gratis prøveperiode.`,
    }),
  };
}

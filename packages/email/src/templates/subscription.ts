/**
 * Subscription-related email templates
 */

import { baseTemplate, emailButton, infoBox } from './base';

// ============ Subscription Activated ============

export interface SubscriptionActivatedData {
  userName: string;
  planName: string;
  price: string;
  billingCycle: 'monthly' | 'yearly';
  dashboardUrl: string;
}

export function subscriptionActivatedEmail(data: SubscriptionActivatedData): { subject: string; html: string } {
  const { userName, planName, price, billingCycle, dashboardUrl } = data;
  const cycleText = billingCycle === 'yearly' ? 'årlig' : 'månedlig';

  const content = `
<h2 style="margin: 0 0 20px 0; color: #18181b; font-size: 24px; font-weight: 600;">
  Abonnementet ditt er aktivert!
</h2>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Hei ${userName},
</p>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Takk for betalingen! Ditt <strong>${planName}</strong>-abonnement er nå aktivert.
</p>

${infoBox(`<strong>Plan:</strong> ${planName}<br><strong>Pris:</strong> ${price} (${cycleText})`, 'success')}

<p style="margin: 20px 0 0 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Du har nå full tilgang til alle funksjoner i din plan. Vi sender deg en faktura på e-post.
</p>

${emailButton('Gå til dashboardet', dashboardUrl)}

<p style="margin: 20px 0 0 0; color: #71717a; font-size: 14px; line-height: 1.5;">
  Du kan når som helst administrere abonnementet ditt fra innstillingene.
</p>
`.trim();

  return {
    subject: 'Abonnementet ditt er aktivert - Sky Planner',
    html: baseTemplate(content, {
      previewText: `Ditt ${planName}-abonnement er nå aktivert.`,
    }),
  };
}

// ============ Trial Ending ============

export interface TrialEndingData {
  userName: string;
  daysRemaining: number;
  upgradeUrl: string;
}

export function trialEndingEmail(data: TrialEndingData): { subject: string; html: string } {
  const { userName, daysRemaining, upgradeUrl } = data;

  const content = `
<h2 style="margin: 0 0 20px 0; color: #18181b; font-size: 24px; font-weight: 600;">
  Prøveperioden din utløper snart
</h2>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Hei ${userName},
</p>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Vi vil bare minne deg på at prøveperioden din utløper om <strong>${daysRemaining} ${daysRemaining === 1 ? 'dag' : 'dager'}</strong>.
</p>

${infoBox('Oppgrader nå for å beholde tilgangen til alle funksjonene dine og dataene du har lagt inn.', 'warning')}

<p style="margin: 20px 0 0 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Etter prøveperioden vil kontoen din bli begrenset. Dataene dine lagres trygt, og du kan gjenopprette full tilgang ved å oppgradere.
</p>

${emailButton('Oppgrader nå', upgradeUrl)}

<p style="margin: 20px 0 0 0; color: #71717a; font-size: 14px; line-height: 1.5;">
  Har du spørsmål om prisene våre? Svar på denne e-posten, så hjelper vi deg.
</p>
`.trim();

  return {
    subject: `Prøveperioden din utløper om ${daysRemaining} ${daysRemaining === 1 ? 'dag' : 'dager'} - Sky Planner`,
    html: baseTemplate(content, {
      previewText: `Din gratis prøveperiode utløper snart. Oppgrader for å beholde tilgangen.`,
    }),
  };
}

// ============ Payment Failed ============

export interface PaymentFailedData {
  userName: string;
  planName: string;
  updatePaymentUrl: string;
  gracePeriodDays: number;
}

export function paymentFailedEmail(data: PaymentFailedData): { subject: string; html: string } {
  const { userName, planName, updatePaymentUrl, gracePeriodDays } = data;

  const content = `
<h2 style="margin: 0 0 20px 0; color: #18181b; font-size: 24px; font-weight: 600;">
  Betalingen feilet
</h2>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Hei ${userName},
</p>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Vi kunne dessverre ikke belaste betalingsmetoden din for ${planName}-abonnementet.
</p>

${infoBox(`Du har ${gracePeriodDays} dager på å oppdatere betalingsinformasjonen din før kontoen blir begrenset.`, 'warning')}

<p style="margin: 20px 0 0 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Dette kan skyldes:
</p>

<ul style="margin: 10px 0 20px 0; padding-left: 20px; color: #3f3f46; font-size: 16px; line-height: 1.8;">
  <li>Utløpt kort</li>
  <li>Utilstrekkelig dekning</li>
  <li>Kortsperre fra banken</li>
</ul>

${emailButton('Oppdater betalingsmetode', updatePaymentUrl)}

<p style="margin: 20px 0 0 0; color: #71717a; font-size: 14px; line-height: 1.5;">
  Trenger du hjelp? Svar på denne e-posten, så hjelper vi deg.
</p>
`.trim();

  return {
    subject: 'Viktig: Betalingen feilet - Sky Planner',
    html: baseTemplate(content, {
      previewText: 'Vi kunne ikke belaste betalingsmetoden din. Oppdater betalingsinformasjonen for å beholde tilgangen.',
    }),
  };
}

// ============ Subscription Canceled ============

export interface SubscriptionCanceledData {
  userName: string;
  endDate: string;
  reactivateUrl: string;
}

export function subscriptionCanceledEmail(data: SubscriptionCanceledData): { subject: string; html: string } {
  const { userName, endDate, reactivateUrl } = data;

  const content = `
<h2 style="margin: 0 0 20px 0; color: #18181b; font-size: 24px; font-weight: 600;">
  Abonnementet ditt er avsluttet
</h2>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Hei ${userName},
</p>

<p style="margin: 0 0 16px 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Vi bekrefter at abonnementet ditt er avsluttet. Du vil ha tilgang frem til <strong>${endDate}</strong>.
</p>

${infoBox('Dataene dine lagres trygt i 30 dager etter at abonnementet avsluttes.', 'info')}

<p style="margin: 20px 0 0 0; color: #3f3f46; font-size: 16px; line-height: 1.6;">
  Vi håper du har hatt nytte av Sky Planner. Hvis du ombestemmer deg, kan du når som helst reaktivere abonnementet.
</p>

${emailButton('Reaktiver abonnementet', reactivateUrl)}

<p style="margin: 20px 0 0 0; color: #71717a; font-size: 14px; line-height: 1.5;">
  Vi setter pris på tilbakemeldinger. Svar gjerne på denne e-posten og fortell oss hvorfor du avsluttet.
</p>
`.trim();

  return {
    subject: 'Abonnementet ditt er avsluttet - Sky Planner',
    html: baseTemplate(content, {
      previewText: `Abonnementet ditt er avsluttet. Du har tilgang frem til ${endDate}.`,
    }),
  };
}

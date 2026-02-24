import { baseTemplate, escapeHtmlEmail } from './base';
export function accountDeletionScheduledTemplate(data) {
    const content = `
    <p>Hei ${escapeHtmlEmail(data.userName)},</p>

    <p>Vi har mottatt din forespørsel om å slette kontoen din hos Sky Planner.</p>

    <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 24px 0;">
      <p style="margin: 0; color: #92400e; font-weight: 600;">Viktig informasjon om slettingen:</p>
      <ul style="color: #92400e; margin: 12px 0 0 0; padding-left: 20px;">
        <li>Kontoen din vil bli permanent slettet <strong>${escapeHtmlEmail(data.scheduledDate)}</strong></li>
        <li>Du har ${data.gracePeriodDays} dager på å angre</li>
        <li>Alle data vil bli slettet og kan ikke gjenopprettes</li>
      </ul>
    </div>

    <p>Før kontoen slettes anbefaler vi at du:</p>
    <ul>
      <li>Laster ned en kopi av alle dine data</li>
      <li>Avslutter eventuelle integrasjoner</li>
      <li>Informerer eventuelle medarbeidere</li>
    </ul>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${data.exportUrl.startsWith('https://') ? escapeHtmlEmail(data.exportUrl) : '#'}" style="display: inline-block; background-color: #667eea; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; margin-right: 12px;">
        Last ned data
      </a>
    </div>

    <p>Hvis du har ombestemt deg og ønsker å beholde kontoen, kan du kansellere slettingen når som helst før ${escapeHtmlEmail(data.scheduledDate)}:</p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${data.cancelUrl.startsWith('https://') ? escapeHtmlEmail(data.cancelUrl) : '#'}" style="display: inline-block; background-color: #10b981; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">
        Kanseller sletting
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      Hvis du ikke har bedt om å slette kontoen din, vennligst kontakt oss umiddelbart på
      <a href="mailto:support@skyplanner.no" style="color: #667eea;">support@skyplanner.no</a>.
    </p>
  `;
    return baseTemplate(content, {
        previewText: `Din konto vil bli slettet ${escapeHtmlEmail(data.scheduledDate)}`,
    });
}
export function accountDeletionCompletedTemplate(data) {
    const content = `
    <p>Hei ${escapeHtmlEmail(data.userName)},</p>

    <p>Kontoen din hos Sky Planner er nå permanent slettet.</p>

    <p>Følgende data er fjernet:</p>
    <ul>
      <li>Alle kundedata</li>
      <li>Ruter og avtaler</li>
      <li>Brukerkontoer</li>
      <li>Integrasjoner og API-nøkler</li>
      <li>Betalingsinformasjon</li>
    </ul>

    <p>Vi setter pris på at du har vært kunde hos oss. Hvis du noen gang ønsker å bruke Sky Planner igjen, er du velkommen tilbake!</p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="https://skyplanner.no" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">
        Besøk Sky Planner
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      Har du spørsmål? Kontakt oss på
      <a href="mailto:support@skyplanner.no" style="color: #667eea;">support@skyplanner.no</a>.
    </p>
  `;
    return baseTemplate(content, {
        previewText: 'Din Sky Planner-konto er nå slettet',
    });
}
export function accountDeletionCancelledTemplate(data) {
    const content = `
    <p>Hei ${escapeHtmlEmail(data.userName)},</p>

    <p>Slettingen av kontoen din hos Sky Planner er nå kansellert.</p>

    <div style="background-color: #d1fae5; border: 1px solid #10b981; border-radius: 8px; padding: 16px; margin: 24px 0;">
      <p style="margin: 0; color: #065f46; font-weight: 600;">Kontoen din er gjenopprettet!</p>
      <p style="margin: 8px 0 0 0; color: #065f46;">
        All data er intakt og du kan fortsette å bruke Sky Planner som vanlig.
      </p>
    </div>

    <p>Hvis abonnementet ditt ble satt på pause under sletteprosessen, er det nå reaktivert.</p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${data.dashboardUrl.startsWith('https://') ? escapeHtmlEmail(data.dashboardUrl) : '#'}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600;">
        Gå til dashbordet
      </a>
    </div>

    <p style="color: #6b7280; font-size: 14px;">
      Har du spørsmål? Kontakt oss på
      <a href="mailto:support@skyplanner.no" style="color: #667eea;">support@skyplanner.no</a>.
    </p>
  `;
    return baseTemplate(content, {
        previewText: 'Din kontosletting er kansellert',
    });
}
//# sourceMappingURL=account-deletion.js.map
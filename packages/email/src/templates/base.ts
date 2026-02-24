/**
 * Base email template with Sky Planner branding
 */

/**
 * Escape user-controlled text for safe HTML rendering in email templates.
 * Must be used for all user-provided data (names, org names, etc.).
 */
export function escapeHtmlEmail(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface BaseTemplateOptions {
  previewText?: string;
}

/**
 * Wraps email content in base template with Sky Planner branding
 */
export function baseTemplate(content: string, options: BaseTemplateOptions = {}): string {
  const { previewText } = options;

  return `
<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Sky Planner</title>
  ${previewText ? `<!--[if !mso]><!--><meta name="x-apple-disable-message-reformatting"><!--<![endif]-->` : ''}
  <style>
    /* Reset styles */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; }

    /* Remove spacing around tables in Outlook */
    table { border-collapse: collapse !important; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; }

    /* iOS blue links */
    a[x-apple-data-detectors] {
      color: inherit !important;
      text-decoration: none !important;
      font-size: inherit !important;
      font-family: inherit !important;
      font-weight: inherit !important;
      line-height: inherit !important;
    }

    /* Gmail blue links */
    u + #body a {
      color: inherit;
      text-decoration: none;
      font-size: inherit;
      font-family: inherit;
      font-weight: inherit;
      line-height: inherit;
    }

    /* Samsung Mail blue links */
    #MessageViewBody a {
      color: inherit;
      text-decoration: none;
      font-size: inherit;
      font-family: inherit;
      font-weight: inherit;
      line-height: inherit;
    }
  </style>
</head>
<body id="body" style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  ${previewText ? `<div style="display: none; max-height: 0px; overflow: hidden;">${escapeHtmlEmail(previewText)}</div>` : ''}

  <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px 40px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">
                Sky Planner
              </h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="background-color: #ffffff; padding: 40px; border-radius: 0 0 12px 12px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; text-align: center;">
              <p style="margin: 0 0 10px 0; color: #71717a; font-size: 14px;">
                Denne e-posten ble sendt fra Sky Planner.
              </p>
              <p style="margin: 0; color: #a1a1aa; font-size: 12px;">
                &copy; ${new Date().getFullYear()} Efffekt AS. Alle rettigheter reservert.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}

/**
 * Create a styled button for emails
 */
export function emailButton(text: string, href: string, color = '#667eea'): string {
  // Validate href is a safe URL (only allow https)
  const safeHref = href.startsWith('https://') ? escapeHtmlEmail(href) : '#';
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin: 30px auto;">
  <tr>
    <td style="border-radius: 8px; background-color: ${color};">
      <a href="${safeHref}" target="_blank" style="display: inline-block; padding: 14px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
        ${escapeHtmlEmail(text)}
      </a>
    </td>
  </tr>
</table>
`.trim();
}

/**
 * Create a styled info box
 */
export function infoBox(content: string, type: 'info' | 'warning' | 'success' = 'info'): string {
  const colors = {
    info: { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af' },
    warning: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
    success: { bg: '#f0fdf4', border: '#22c55e', text: '#166534' },
  };
  const style = colors[type];

  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; margin: 20px 0;">
  <tr>
    <td style="background-color: ${style.bg}; border-left: 4px solid ${style.border}; padding: 16px 20px; border-radius: 4px;">
      <p style="margin: 0; color: ${style.text}; font-size: 14px; line-height: 1.5;">
        ${content}
      </p>
    </td>
  </tr>
</table>
`.trim();
}

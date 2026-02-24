/**
 * Base email template with Sky Planner branding
 */
/**
 * Escape user-controlled text for safe HTML rendering in email templates.
 * Must be used for all user-provided data (names, org names, etc.).
 */
export declare function escapeHtmlEmail(text: string): string;
export interface BaseTemplateOptions {
    previewText?: string;
}
/**
 * Wraps email content in base template with Sky Planner branding
 */
export declare function baseTemplate(content: string, options?: BaseTemplateOptions): string;
/**
 * Create a styled button for emails
 */
export declare function emailButton(text: string, href: string, color?: string): string;
/**
 * Create a styled info box
 */
export declare function infoBox(content: string, type?: 'info' | 'warning' | 'success'): string;
//# sourceMappingURL=base.d.ts.map
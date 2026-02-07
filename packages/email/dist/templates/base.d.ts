/**
 * Base email template with Sky Planner branding
 */
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
/**
 * Contact submission database operations
 * Used for storing contact form submissions from the marketing website
 */
import type { ContactSubmission, InsertContactSubmission } from './types';
/**
 * Creates a new contact submission
 */
export declare function createContactSubmission(data: InsertContactSubmission): Promise<ContactSubmission>;
/**
 * Gets all contact submissions
 */
export declare function getContactSubmissions(): Promise<ContactSubmission[]>;
/**
 * Updates contact submission status
 */
export declare function updateContactSubmissionStatus(id: number, status: 'new' | 'contacted' | 'closed'): Promise<ContactSubmission>;
//# sourceMappingURL=contact.d.ts.map
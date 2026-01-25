/**
 * Contact submission database operations
 * Used for storing contact form submissions from the marketing website
 */

import { getSupabaseClient } from './client';
import type { ContactSubmission, InsertContactSubmission } from './types';

/**
 * Creates a new contact submission
 */
export async function createContactSubmission(
  data: InsertContactSubmission
): Promise<ContactSubmission> {
  const client = getSupabaseClient();

  const { data: submission, error } = await client
    .from('contact_submissions')
    .insert({
      ...data,
      status: 'new',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create contact submission: ${error.message}`);
  return submission;
}

/**
 * Gets all contact submissions
 */
export async function getContactSubmissions(): Promise<ContactSubmission[]> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('contact_submissions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to get contact submissions: ${error.message}`);
  return data || [];
}

/**
 * Updates contact submission status
 */
export async function updateContactSubmissionStatus(
  id: number,
  status: 'new' | 'contacted' | 'closed'
): Promise<ContactSubmission> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('contact_submissions')
    .update({ status })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update contact submission: ${error.message}`);
  return data;
}

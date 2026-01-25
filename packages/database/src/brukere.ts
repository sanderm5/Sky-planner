/**
 * Bruker (admin/team member) database operations
 * Used for authentication of internal users
 */

import { getSupabaseClient } from './client';
import type { Bruker } from './types';

/**
 * Gets a bruker by email
 */
export async function getBrukerByEmail(epost: string): Promise<Bruker | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('brukere')
    .select('*')
    .eq('epost', epost.toLowerCase())
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get bruker: ${error.message}`);
  }
  return data;
}

/**
 * Gets a bruker by ID
 */
export async function getBrukerById(id: number): Promise<Bruker | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('brukere')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get bruker: ${error.message}`);
  }
  return data;
}

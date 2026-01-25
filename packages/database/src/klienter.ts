/**
 * Klient (account owner) database operations
 * Used for authentication and registration
 */

import { getSupabaseClient } from './client';
import type { Klient, InsertKlient, UpdateKlient } from './types';

/**
 * Creates a new klient (account owner)
 */
export async function createKlient(data: InsertKlient): Promise<Klient> {
  const client = getSupabaseClient();

  const { data: klient, error } = await client
    .from('klient')
    .insert(data)
    .select()
    .single();

  if (error) throw new Error(`Failed to create klient: ${error.message}`);
  return klient;
}

/**
 * Gets a klient by email
 */
export async function getKlientByEmail(epost: string): Promise<Klient | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('klient')
    .select('*')
    .eq('epost', epost.toLowerCase())
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get klient: ${error.message}`);
  }
  return data;
}

/**
 * Gets a klient by ID
 */
export async function getKlientById(id: number): Promise<Klient | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('klient')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get klient: ${error.message}`);
  }
  return data;
}

/**
 * Updates a klient
 */
export async function updateKlient(
  id: number,
  data: UpdateKlient
): Promise<Klient> {
  const client = getSupabaseClient();

  const { data: klient, error } = await client
    .from('klient')
    .update(data)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update klient: ${error.message}`);
  return klient;
}

/**
 * Updates password for a klient
 */
export async function updateKlientPassword(
  id: number,
  hashedPassword: string
): Promise<void> {
  const client = getSupabaseClient();

  const { error } = await client
    .from('klient')
    .update({ passord_hash: hashedPassword })
    .eq('id', id);

  if (error) throw new Error(`Failed to update password: ${error.message}`);
}

/**
 * Checks if an email is already registered
 */
export async function isEmailRegistered(epost: string): Promise<boolean> {
  const klient = await getKlientByEmail(epost);
  return klient !== null;
}

/**
 * Gets all klienter for an organization
 */
export async function getKlienterByOrganization(
  organizationId: number
): Promise<Klient[]> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('klient')
    .select('*')
    .eq('organization_id', organizationId)
    .order('navn');

  if (error) throw new Error(`Failed to get klienter: ${error.message}`);
  return data || [];
}

/**
 * Klient (account owner) database operations
 * Used for authentication and registration
 */

import { getSupabaseClient } from './client';
import type { Klient, InsertKlient, UpdateKlient, PasswordResetToken, InsertPasswordResetToken } from './types';

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

// ============ Password Reset Functions ============

/**
 * Creates a password reset token
 */
export async function createPasswordResetToken(
  data: InsertPasswordResetToken
): Promise<PasswordResetToken> {
  const client = getSupabaseClient();

  // First, invalidate any existing tokens for this user
  await client
    .from('password_reset_tokens')
    .delete()
    .eq('user_id', data.user_id)
    .eq('user_type', data.user_type);

  const { data: token, error } = await client
    .from('password_reset_tokens')
    .insert(data)
    .select()
    .single();

  if (error) throw new Error(`Failed to create password reset token: ${error.message}`);
  return token;
}

/**
 * Gets a valid (not expired, not used) password reset token by hash
 */
export async function getValidPasswordResetToken(
  tokenHash: string
): Promise<PasswordResetToken | null> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('password_reset_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get password reset token: ${error.message}`);
  }
  return data;
}

/**
 * Marks a password reset token as used
 */
export async function markPasswordResetTokenUsed(tokenId: number): Promise<void> {
  const client = getSupabaseClient();

  const { error } = await client
    .from('password_reset_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenId);

  if (error) throw new Error(`Failed to mark token as used: ${error.message}`);
}

/**
 * Deletes expired password reset tokens (cleanup)
 */
export async function deleteExpiredPasswordResetTokens(): Promise<number> {
  const client = getSupabaseClient();

  const { data, error } = await client
    .from('password_reset_tokens')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) throw new Error(`Failed to delete expired tokens: ${error.message}`);
  return data?.length || 0;
}

// ============ Kunde Count Functions ============

/**
 * Gets the count of kunder (customers) for an organization
 */
export async function getKundeCountByOrganization(
  organizationId: number
): Promise<number> {
  const client = getSupabaseClient();

  const { count, error } = await client
    .from('kunder')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId);

  if (error) throw new Error(`Failed to get kunde count: ${error.message}`);
  return count || 0;
}

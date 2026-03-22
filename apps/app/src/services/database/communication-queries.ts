/**
 * Communication database queries.
 * Handles email templates, email settings/history, chat conversations/messages,
 * EKK reports, and Outlook sync entries.
 */

import type { DatabaseContext, Kunde, Kontaktlogg, EmailInnstilling, EmailVarsel } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ============ EMAIL TEMPLATES ============

export async function getEmailTemplates(ctx: DatabaseContext, organizationId: number): Promise<Array<{
  id: number; organization_id: number | null; name: string; subject_template: string;
  body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
}>> {
  ctx.validateTenantContext(organizationId, 'getEmailTemplates');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data, error } = await client
      .from('customer_email_templates')
      .select('*')
      .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
      .eq('aktiv', true)
      .order('sort_order');
    if (error) throw error;
    return data || [];
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  return ctx.sqlite.prepare(
    'SELECT * FROM customer_email_templates WHERE (organization_id IS NULL OR organization_id = ?) AND aktiv = 1 ORDER BY sort_order'
  ).all(organizationId) as Array<{
    id: number; organization_id: number | null; name: string; subject_template: string;
    body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
  }>;
}

export async function getEmailTemplateById(ctx: DatabaseContext, id: number, organizationId: number): Promise<{
  id: number; organization_id: number | null; name: string; subject_template: string;
  body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
} | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data, error } = await client
      .from('customer_email_templates')
      .select('*')
      .eq('id', id)
      .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
      .single();
    if (error) return null;
    return data;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  return (ctx.sqlite.prepare(
    'SELECT * FROM customer_email_templates WHERE id = ? AND (organization_id IS NULL OR organization_id = ?)'
  ).get(id, organizationId) as { id: number; organization_id: number | null; name: string; subject_template: string; body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number } | undefined) || null;
}

export async function createEmailTemplate(ctx: DatabaseContext, data: {
  organization_id: number; name: string; subject_template: string;
  body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
}): Promise<{
  id: number; organization_id: number | null; name: string; subject_template: string;
  body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
}> {
  ctx.validateTenantContext(data.organization_id, 'createEmailTemplate');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data: result, error } = await client
      .from('customer_email_templates')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return result;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite.prepare(`
    INSERT INTO customer_email_templates (organization_id, name, subject_template, body_template, category, is_system, aktiv, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.organization_id, data.name, data.subject_template, data.body_template,
    data.category, data.is_system ? 1 : 0, data.aktiv ? 1 : 0, data.sort_order
  );

  return { id: Number(result.lastInsertRowid), ...data, organization_id: data.organization_id };
}

export async function updateEmailTemplate(ctx: DatabaseContext, id: number, data: Partial<{
  name: string; subject_template: string; body_template: string; category: string; aktiv: boolean;
}>, organizationId: number): Promise<{
  id: number; organization_id: number | null; name: string; subject_template: string;
  body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
} | null> {
  ctx.validateTenantContext(organizationId, 'updateEmailTemplate');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data: result, error } = await client
      .from('customer_email_templates')
      .update(data)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select()
      .single();
    if (error) return null;
    return result;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(key === 'aktiv' ? (val ? 1 : 0) : val);
    }
  }
  if (fields.length === 0) return getEmailTemplateById(ctx, id, organizationId);

  values.push(id, organizationId);
  ctx.sqlite.prepare(
    `UPDATE customer_email_templates SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`
  ).run(...values);

  return getEmailTemplateById(ctx, id, organizationId);
}

export async function deleteEmailTemplate(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'deleteEmailTemplate');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { error } = await client
      .from('customer_email_templates')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId)
      .eq('is_system', false);
    return !error;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite.prepare(
    'DELETE FROM customer_email_templates WHERE id = ? AND organization_id = ? AND is_system = 0'
  ).run(id, organizationId);
  return result.changes > 0;
}

export async function logSentEmail(ctx: DatabaseContext, data: {
  organization_id: number; kunde_id: number; template_id: number | null;
  to_email: string; subject: string; body_html: string; status: string;
  error_message: string | null; sent_by: number | null; sent_at: string;
}): Promise<{
  id: number; organization_id: number; kunde_id: number; template_id: number | null;
  to_email: string; subject: string; body_html: string; status: string;
  error_message: string | null; sent_by: number | null; sent_at: string;
}> {
  ctx.validateTenantContext(data.organization_id, 'logSentEmail');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data: result, error } = await client
      .from('customer_emails_sent')
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return result;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite.prepare(`
    INSERT INTO customer_emails_sent (organization_id, kunde_id, template_id, to_email, subject, body_html, status, error_message, sent_by, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.organization_id, data.kunde_id, data.template_id, data.to_email,
    data.subject, data.body_html, data.status, data.error_message, data.sent_by, data.sent_at
  );

  return { id: Number(result.lastInsertRowid), ...data };
}

export async function getSentEmails(ctx: DatabaseContext, organizationId: number, kundeId?: number, limit = 50): Promise<Array<{
  id: number; organization_id: number; kunde_id: number; template_id: number | null;
  to_email: string; subject: string; body_html: string; status: string;
  error_message: string | null; sent_by: number | null; sent_at: string;
}>> {
  ctx.validateTenantContext(organizationId, 'getSentEmails');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    let query = client
      .from('customer_emails_sent')
      .select('*')
      .eq('organization_id', organizationId)
      .order('sent_at', { ascending: false })
      .limit(limit);
    if (kundeId) {
      query = query.eq('kunde_id', kundeId);
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const params: unknown[] = [organizationId];
  let sql = 'SELECT * FROM customer_emails_sent WHERE organization_id = ?';
  if (kundeId) {
    sql += ' AND kunde_id = ?';
    params.push(kundeId);
  }
  sql += ' ORDER BY sent_at DESC LIMIT ?';
  params.push(limit);

  return ctx.sqlite.prepare(sql).all(...params) as Array<{
    id: number; organization_id: number; kunde_id: number; template_id: number | null;
    to_email: string; subject: string; body_html: string; status: string;
    error_message: string | null; sent_by: number | null; sent_at: string;
  }>;
}

// ============ EMAIL SETTINGS & HISTORY ============

export async function getEmailInnstillinger(ctx: DatabaseContext, kundeId: number): Promise<EmailInnstilling | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getEmailInnstillinger(kundeId);
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite.prepare('SELECT * FROM email_innstillinger WHERE kunde_id = ?').get(kundeId);
  return (result as EmailInnstilling) || null;
}

export async function updateEmailInnstillinger(ctx: DatabaseContext, kundeId: number, data: Partial<EmailInnstilling>): Promise<void> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.updateEmailInnstillinger(kundeId, data);
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');

  const existing = ctx.sqlite.prepare('SELECT id FROM email_innstillinger WHERE kunde_id = ?').get(kundeId);

  if (existing) {
    ctx.sqlite.prepare(`
      UPDATE email_innstillinger
      SET email_aktiv = ?, forste_varsel_dager = ?, paaminnelse_etter_dager = ?
      WHERE kunde_id = ?
    `).run(
      data.email_aktiv !== undefined ? (data.email_aktiv ? 1 : 0) : 1,
      data.forste_varsel_dager || 30,
      data.paaminnelse_etter_dager || 7,
      kundeId
    );
  } else {
    ctx.sqlite.prepare(`
      INSERT INTO email_innstillinger (kunde_id, email_aktiv, forste_varsel_dager, paaminnelse_etter_dager)
      VALUES (?, ?, ?, ?)
    `).run(
      kundeId,
      data.email_aktiv !== undefined ? (data.email_aktiv ? 1 : 0) : 1,
      data.forste_varsel_dager || 30,
      data.paaminnelse_etter_dager || 7
    );
  }
}

export async function getEmailHistorikk(ctx: DatabaseContext, organizationId: number, kundeId?: number | null, limit = 100): Promise<EmailVarsel[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getEmailHistorikk(organizationId, kundeId, limit);
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Sikkerhet: Alltid filtrer på organization_id for å forhindre data-lekkasje
  if (kundeId) {
    return ctx.sqlite.prepare(`
      SELECT ev.* FROM email_varsler ev
      JOIN kunder k ON ev.kunde_id = k.id
      WHERE ev.kunde_id = ? AND k.organization_id = ?
      ORDER BY ev.opprettet DESC LIMIT ?
    `).all(kundeId, organizationId, limit) as EmailVarsel[];
  }

  return ctx.sqlite.prepare(`
    SELECT ev.* FROM email_varsler ev
    JOIN kunder k ON ev.kunde_id = k.id
    WHERE k.organization_id = ?
    ORDER BY ev.opprettet DESC LIMIT ?
  `).all(organizationId, limit) as EmailVarsel[];
}

export async function getEmailStats(ctx: DatabaseContext, organizationId: number): Promise<{ pending: number; sent: number; failed: number }> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getEmailStats(organizationId);
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Sikkerhet: Kun tell e-poster for denne organisasjonen
  const stats = ctx.sqlite.prepare(`
    SELECT
      SUM(CASE WHEN ev.status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN ev.status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN ev.status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM email_varsler ev
    JOIN kunder k ON ev.kunde_id = k.id
    WHERE k.organization_id = ?
  `).get(organizationId) as { pending: number | null; sent: number | null; failed: number | null } | undefined;

  return {
    pending: stats?.pending || 0,
    sent: stats?.sent || 0,
    failed: stats?.failed || 0,
  };
}

export async function getUpcomingEmails(ctx: DatabaseContext, organizationId: number, daysAhead: number): Promise<(Kunde & { dager_til_kontroll: number })[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getUpcomingEmails(organizationId, daysAhead);
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Sikkerhet: Kun hent kunder for denne organisasjonen
  return ctx.sqlite.prepare(`
    SELECT k.*,
      CAST(julianday(COALESCE(k.neste_el_kontroll, k.neste_brann_kontroll, k.neste_kontroll)) - julianday('now') AS INTEGER) as dager_til_kontroll
    FROM kunder k
    WHERE k.organization_id = ?
      AND k.epost IS NOT NULL
      AND k.epost != ''
      AND (
        (k.neste_el_kontroll IS NOT NULL AND k.neste_el_kontroll <= date('now', '+' || ? || ' days'))
        OR (k.neste_brann_kontroll IS NOT NULL AND k.neste_brann_kontroll <= date('now', '+' || ? || ' days'))
        OR (k.neste_kontroll IS NOT NULL AND k.neste_kontroll <= date('now', '+' || ? || ' days'))
      )
    ORDER BY dager_til_kontroll ASC
  `).all(organizationId, daysAhead, daysAhead, daysAhead) as (Kunde & { dager_til_kontroll: number })[];
}

// ============ EKK REPORTS ============

export async function getEkkReports(ctx: DatabaseContext, organizationId: number, kundeId?: number): Promise<Array<Record<string, unknown>>> {
  ctx.validateTenantContext(organizationId, 'getEkkReports');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    let query = client.from('ekk_reports').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false });
    if (kundeId) query = query.eq('kunde_id', kundeId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');
  const params: unknown[] = [organizationId];
  let sql = 'SELECT * FROM ekk_reports WHERE organization_id = ?';
  if (kundeId) { sql += ' AND kunde_id = ?'; params.push(kundeId); }
  sql += ' ORDER BY created_at DESC';
  return ctx.sqlite.prepare(sql).all(...params) as Array<Record<string, unknown>>;
}

export async function getEkkReportById(ctx: DatabaseContext, id: number, organizationId: number): Promise<Record<string, unknown> | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data, error } = await client.from('ekk_reports').select('*').eq('id', id).eq('organization_id', organizationId).single();
    if (error) return null;
    return data;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return (ctx.sqlite.prepare('SELECT * FROM ekk_reports WHERE id = ? AND organization_id = ?').get(id, organizationId) as Record<string, unknown> | undefined) || null;
}

export async function createEkkReport(ctx: DatabaseContext, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  ctx.validateTenantContext(data.organization_id as number, 'createEkkReport');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data: result, error } = await client.from('ekk_reports').insert(data).select().single();
    if (error) throw error;
    return result;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');

  const result = ctx.sqlite.prepare(`
    INSERT INTO ekk_reports (organization_id, kunde_id, report_type, status, notes, checklist_data, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.organization_id, data.kunde_id, data.report_type || 'elkontroll',
    data.status || 'utkast', data.notes || null,
    JSON.stringify(data.checklist_data || {}), data.created_by || null
  );
  return { id: Number(result.lastInsertRowid), ...data };
}

export async function updateEkkReport(ctx: DatabaseContext, id: number, data: Record<string, unknown>, organizationId: number): Promise<Record<string, unknown> | null> {
  ctx.validateTenantContext(organizationId, 'updateEkkReport');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data: result, error } = await client.from('ekk_reports').update(data).eq('id', id).eq('organization_id', organizationId).select().single();
    if (error) return null;
    return result;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(key === 'checklist_data' ? JSON.stringify(val) : val);
    }
  }
  if (fields.length === 0) return getEkkReportById(ctx, id, organizationId);
  values.push(id, organizationId);
  ctx.sqlite.prepare(`UPDATE ekk_reports SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`).run(...values);
  return getEkkReportById(ctx, id, organizationId);
}

export async function deleteEkkReport(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'deleteEkkReport');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { error } = await client.from('ekk_reports').delete().eq('id', id).eq('organization_id', organizationId);
    return !error;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  const result = ctx.sqlite.prepare('DELETE FROM ekk_reports WHERE id = ? AND organization_id = ?').run(id, organizationId);
  return result.changes > 0;
}

// ============ OUTLOOK SYNC ============

export async function getOutlookSyncEntries(ctx: DatabaseContext, organizationId: number): Promise<Array<Record<string, unknown>>> {
  ctx.validateTenantContext(organizationId, 'getOutlookSyncEntries');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data, error } = await client.from('outlook_sync_log').select('*').eq('organization_id', organizationId);
    if (error) throw error;
    return data || [];
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return ctx.sqlite.prepare('SELECT * FROM outlook_sync_log WHERE organization_id = ?').all(organizationId) as Array<Record<string, unknown>>;
}

export async function getOutlookSyncEntry(ctx: DatabaseContext, organizationId: number, kundeId: number): Promise<Record<string, unknown> | null> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data, error } = await client.from('outlook_sync_log').select('*').eq('organization_id', organizationId).eq('kunde_id', kundeId).single();
    if (error) return null;
    return data;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');
  return (ctx.sqlite.prepare('SELECT * FROM outlook_sync_log WHERE organization_id = ? AND kunde_id = ?').get(organizationId, kundeId) as Record<string, unknown> | undefined) || null;
}

export async function upsertOutlookSyncEntry(ctx: DatabaseContext, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  ctx.validateTenantContext(data.organization_id as number, 'upsertOutlookSyncEntry');

  if (ctx.type === 'supabase' && ctx.supabase) {
    const client = await ctx.getSupabaseClient();
    const { data: result, error } = await client.from('outlook_sync_log')
      .upsert(data, { onConflict: 'organization_id,kunde_id' }).select().single();
    if (error) throw error;
    return result;
  }
  if (!ctx.sqlite) throw new Error('Database not initialized');

  const existing = ctx.sqlite.prepare(
    'SELECT id FROM outlook_sync_log WHERE organization_id = ? AND kunde_id = ?'
  ).get(data.organization_id, data.kunde_id) as { id: number } | undefined;

  if (existing) {
    ctx.sqlite.prepare(`
      UPDATE outlook_sync_log SET outlook_contact_id = ?, last_synced_at = ?, sync_status = ?, error_message = ?
      WHERE id = ?
    `).run(data.outlook_contact_id, data.last_synced_at, data.sync_status, data.error_message, existing.id);
    return { id: existing.id, ...data };
  }

  const result = ctx.sqlite.prepare(`
    INSERT INTO outlook_sync_log (organization_id, kunde_id, outlook_contact_id, last_synced_at, sync_status, error_message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(data.organization_id, data.kunde_id, data.outlook_contact_id, data.last_synced_at, data.sync_status, data.error_message);
  return { id: Number(result.lastInsertRowid), ...data };
}

// ============ CHAT ============

export async function getOrCreateOrgConversation(ctx: DatabaseContext, organizationId: number): Promise<{ id: number }> {
  ctx.validateTenantContext(organizationId, 'getOrCreateOrgConversation');

  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    // Try to find existing org conversation
    const { data: existing } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('type', 'org')
      .maybeSingle();
    if (existing) return { id: existing.id };

    // Create new org conversation
    const { data, error } = await supabase
      .from('chat_conversations')
      .insert({ organization_id: organizationId, type: 'org' })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create org conversation: ${error.message}`);
    return { id: data.id };
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');
  const existing = ctx.sqlite.prepare(
    'SELECT id FROM chat_conversations WHERE organization_id = ? AND type = ?'
  ).get(organizationId, 'org') as { id: number } | undefined;
  if (existing) return existing;

  const result = ctx.sqlite.prepare(
    'INSERT INTO chat_conversations (organization_id, type) VALUES (?, ?)'
  ).run(organizationId, 'org');
  return { id: Number(result.lastInsertRowid) };
}

export async function getOrCreateDmConversation(ctx: DatabaseContext, organizationId: number, userIds: [number, number]): Promise<{ id: number }> {
  ctx.validateTenantContext(organizationId, 'getOrCreateDmConversation');
  const sorted = [...userIds].sort((a, b) => a - b);

  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    // Find existing DM between these two users in this org
    const { data: conversations } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('type', 'dm');

    if (conversations && conversations.length > 0) {
      for (const conv of conversations) {
        const { data: participants } = await supabase
          .from('chat_participants')
          .select('user_id')
          .eq('conversation_id', conv.id)
          .order('user_id', { ascending: true });
        const pIds = (participants || []).map((p: { user_id: number }) => p.user_id);
        if (pIds.length === 2 && pIds[0] === sorted[0] && pIds[1] === sorted[1]) {
          return { id: conv.id };
        }
      }
    }

    // Create new DM conversation
    const { data: newConv, error } = await supabase
      .from('chat_conversations')
      .insert({ organization_id: organizationId, type: 'dm' })
      .select('id')
      .single();
    if (error) throw new Error(`Failed to create DM conversation: ${error.message}`);

    // Add participants
    await supabase.from('chat_participants').insert([
      { conversation_id: newConv.id, user_id: sorted[0] },
      { conversation_id: newConv.id, user_id: sorted[1] },
    ]);
    return { id: newConv.id };
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');
  // Find existing DM
  const dmConversations = ctx.sqlite.prepare(
    'SELECT id FROM chat_conversations WHERE organization_id = ? AND type = ?'
  ).all(organizationId, 'dm') as { id: number }[];

  for (const conv of dmConversations) {
    const participants = ctx.sqlite.prepare(
      'SELECT user_id FROM chat_participants WHERE conversation_id = ? ORDER BY user_id ASC'
    ).all(conv.id) as { user_id: number }[];
    const pIds = participants.map(p => p.user_id);
    if (pIds.length === 2 && pIds[0] === sorted[0] && pIds[1] === sorted[1]) {
      return { id: conv.id };
    }
  }

  // Create new DM
  const result = ctx.sqlite.prepare(
    'INSERT INTO chat_conversations (organization_id, type) VALUES (?, ?)'
  ).run(organizationId, 'dm');
  const convId = Number(result.lastInsertRowid);
  ctx.sqlite.prepare('INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, sorted[0]);
  ctx.sqlite.prepare('INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, sorted[1]);
  return { id: convId };
}

export async function getChatConversationsForUser(ctx: DatabaseContext, organizationId: number, userId: number): Promise<import('../../types').ChatConversation[]> {
  ctx.validateTenantContext(organizationId, 'getChatConversationsForUser');

  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();

    // Get org conversation
    const { data: orgConvs } = await supabase
      .from('chat_conversations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('type', 'org');

    // Get DM conversations the user participates in
    const { data: dmParticipations } = await supabase
      .from('chat_participants')
      .select('conversation_id')
      .eq('user_id', userId);

    const dmConvIds = (dmParticipations || []).map((p: { conversation_id: number }) => p.conversation_id);
    let dmConvs: import('../../types').ChatConversation[] = [];
    if (dmConvIds.length > 0) {
      const { data } = await supabase
        .from('chat_conversations')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('type', 'dm')
        .in('id', dmConvIds);
      dmConvs = (data || []) as import('../../types').ChatConversation[];
    }

    const allConvs = [...(orgConvs || []), ...dmConvs];

    // Enrich all conversations in parallel (avoid N+1 sequential queries)
    const result: import('../../types').ChatConversation[] = [];
    const enrichments = await Promise.all(allConvs.map(async (conv) => {
      // Run all queries for this conversation in parallel
      const [lastMsgRes, readStatusRes, dmPartsRes] = await Promise.all([
        // Last message
        supabase
          .from('chat_messages')
          .select('*')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        // Read status
        supabase
          .from('chat_read_status')
          .select('last_read_message_id')
          .eq('user_id', userId)
          .eq('conversation_id', conv.id)
          .maybeSingle(),
        // DM participant (only needed for DMs but query is cheap)
        conv.type === 'dm'
          ? supabase
              .from('chat_participants')
              .select('user_id')
              .eq('conversation_id', conv.id)
              .neq('user_id', userId)
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const lastMsg = lastMsgRes.data;
      const lastReadId = readStatusRes.data?.last_read_message_id ?? 0;

      // Unread count (depends on lastReadId)
      const { count: unreadCount } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .gt('id', lastReadId)
        .neq('sender_id', userId);

      // Participant name for DMs
      let participantName: string | undefined;
      let participantId: number | undefined;
      if (conv.type === 'dm' && dmPartsRes.data) {
        participantId = dmPartsRes.data.user_id;
        const { data: user } = await supabase
          .from('klient')
          .select('navn')
          .eq('id', dmPartsRes.data.user_id)
          .maybeSingle();
        participantName = user?.navn;
      }

      return {
        ...conv,
        last_message: lastMsg || undefined,
        unread_count: unreadCount ?? 0,
        participant_name: participantName,
        participant_id: participantId,
      };
    }));

    result.push(...enrichments);

    // Sort: org first, then by last message time descending
    result.sort((a, b) => {
      if (a.type === 'org' && b.type !== 'org') return -1;
      if (a.type !== 'org' && b.type === 'org') return 1;
      const aTime = a.last_message?.created_at || a.created_at;
      const bTime = b.last_message?.created_at || b.created_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    return result;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Get org conversations
  const orgConvs = ctx.sqlite.prepare(
    'SELECT * FROM chat_conversations WHERE organization_id = ? AND type = ?'
  ).all(organizationId, 'org') as import('../../types').ChatConversation[];

  // Get DM conversations
  const dmConvIds = ctx.sqlite.prepare(
    'SELECT conversation_id FROM chat_participants WHERE user_id = ?'
  ).all(userId) as { conversation_id: number }[];
  const dmConvs: import('../../types').ChatConversation[] = [];
  for (const { conversation_id } of dmConvIds) {
    const conv = ctx.sqlite.prepare(
      'SELECT * FROM chat_conversations WHERE id = ? AND organization_id = ? AND type = ?'
    ).get(conversation_id, organizationId, 'dm') as import('../../types').ChatConversation | undefined;
    if (conv) dmConvs.push(conv);
  }

  const allConvs = [...orgConvs, ...dmConvs];
  const result: import('../../types').ChatConversation[] = [];

  for (const conv of allConvs) {
    const lastMsg = ctx.sqlite.prepare(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(conv.id) as import('../../types').ChatMessage | undefined;

    const readStatus = ctx.sqlite.prepare(
      'SELECT last_read_message_id FROM chat_read_status WHERE user_id = ? AND conversation_id = ?'
    ).get(userId, conv.id) as { last_read_message_id: number } | undefined;
    const lastReadId = readStatus?.last_read_message_id ?? 0;

    const unreadRow = ctx.sqlite.prepare(
      'SELECT COUNT(*) as count FROM chat_messages WHERE conversation_id = ? AND id > ? AND sender_id != ?'
    ).get(conv.id, lastReadId, userId) as { count: number };

    let participantName: string | undefined;
    let participantId: number | undefined;
    if (conv.type === 'dm') {
      const other = ctx.sqlite.prepare(
        'SELECT user_id FROM chat_participants WHERE conversation_id = ? AND user_id != ?'
      ).get(conv.id, userId) as { user_id: number } | undefined;
      if (other) {
        participantId = other.user_id;
        const user = ctx.sqlite.prepare('SELECT navn FROM klient WHERE id = ?').get(other.user_id) as { navn: string } | undefined;
        participantName = user?.navn;
      }
    }

    result.push({
      ...conv,
      last_message: lastMsg,
      unread_count: unreadRow.count,
      participant_name: participantName,
      participant_id: participantId,
    });
  }

  result.sort((a, b) => {
    if (a.type === 'org' && b.type !== 'org') return -1;
    if (a.type !== 'org' && b.type === 'org') return 1;
    const aTime = a.last_message?.created_at || a.created_at;
    const bTime = b.last_message?.created_at || b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  return result;
}

export async function getChatMessages(ctx: DatabaseContext, conversationId: number, organizationId: number, limit: number = 50, before?: number): Promise<import('../../types').ChatMessage[]> {
  ctx.validateTenantContext(organizationId, 'getChatMessages');

  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();

    // Verify conversation belongs to this org
    const { data: conv } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (!conv) throw new Error('Conversation not found');

    let query = supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('id', { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt('id', before);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch messages: ${error.message}`);
    return (data || []).reverse() as import('../../types').ChatMessage[];
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Verify conversation belongs to this org
  const conv = ctx.sqlite.prepare(
    'SELECT id FROM chat_conversations WHERE id = ? AND organization_id = ?'
  ).get(conversationId, organizationId);
  if (!conv) throw new Error('Conversation not found');

  const beforeClause = before ? 'AND id < ?' : '';
  const params = before ? [conversationId, before, limit] : [conversationId, limit];

  const messages = ctx.sqlite.prepare(
    `SELECT * FROM chat_messages WHERE conversation_id = ? ${beforeClause} ORDER BY id DESC LIMIT ?`
  ).all(...params) as import('../../types').ChatMessage[];

  return messages.reverse();
}

export async function createChatMessage(
  ctx: DatabaseContext,
  conversationId: number,
  organizationId: number,
  senderId: number,
  senderName: string,
  content: string
): Promise<import('../../types').ChatMessage> {
  ctx.validateTenantContext(organizationId, 'createChatMessage');

  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();

    // Verify conversation belongs to this org
    const { data: conv } = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (!conv) throw new Error('Conversation not found');

    const { data, error } = await supabase
      .from('chat_messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        sender_name: senderName,
        content,
      })
      .select()
      .single();
    if (error) throw new Error(`Failed to create message: ${error.message}`);
    return data as import('../../types').ChatMessage;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');
  const conv = ctx.sqlite.prepare(
    'SELECT id FROM chat_conversations WHERE id = ? AND organization_id = ?'
  ).get(conversationId, organizationId);
  if (!conv) throw new Error('Conversation not found');

  const now = new Date().toISOString();
  const result = ctx.sqlite.prepare(
    'INSERT INTO chat_messages (conversation_id, sender_id, sender_name, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(conversationId, senderId, senderName, content, now);

  return {
    id: Number(result.lastInsertRowid),
    conversation_id: conversationId,
    sender_id: senderId,
    sender_name: senderName,
    content,
    created_at: now,
  };
}

export async function markChatAsRead(ctx: DatabaseContext, userId: number, conversationId: number, messageId: number): Promise<void> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    await supabase
      .from('chat_read_status')
      .upsert(
        {
          user_id: userId,
          conversation_id: conversationId,
          last_read_message_id: messageId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,conversation_id' }
      );
    return;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');
  ctx.sqlite.prepare(`
    INSERT INTO chat_read_status (user_id, conversation_id, last_read_message_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, conversation_id) DO UPDATE SET
      last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id),
      updated_at = excluded.updated_at
  `).run(userId, conversationId, messageId, new Date().toISOString());
}

export async function getChatUnreadCounts(ctx: DatabaseContext, userId: number, organizationId: number): Promise<{ conversationId: number; count: number }[]> {
  ctx.validateTenantContext(organizationId, 'getChatUnreadCounts');

  if (ctx.type === 'supabase') {
    // Get all conversations for this org that user participates in
    const conversations = await getChatConversationsForUser(ctx, organizationId, userId);
    return conversations.map(c => ({
      conversationId: c.id,
      count: c.unread_count ?? 0,
    }));
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Get org conversations
  const orgConvs = ctx.sqlite.prepare(
    'SELECT id FROM chat_conversations WHERE organization_id = ? AND type = ?'
  ).all(organizationId, 'org') as { id: number }[];

  // Get DM conversations
  const dmParts = ctx.sqlite.prepare(
    `SELECT cp.conversation_id FROM chat_participants cp
     JOIN chat_conversations cc ON cc.id = cp.conversation_id
     WHERE cp.user_id = ? AND cc.organization_id = ? AND cc.type = 'dm'`
  ).all(userId, organizationId) as { conversation_id: number }[];

  const allConvIds = [...orgConvs.map(c => c.id), ...dmParts.map(p => p.conversation_id)];
  const result: { conversationId: number; count: number }[] = [];

  for (const convId of allConvIds) {
    const readStatus = ctx.sqlite.prepare(
      'SELECT last_read_message_id FROM chat_read_status WHERE user_id = ? AND conversation_id = ?'
    ).get(userId, convId) as { last_read_message_id: number } | undefined;
    const lastReadId = readStatus?.last_read_message_id ?? 0;
    const row = ctx.sqlite.prepare(
      'SELECT COUNT(*) as count FROM chat_messages WHERE conversation_id = ? AND id > ? AND sender_id != ?'
    ).get(convId, lastReadId, userId) as { count: number };
    if (row.count > 0) {
      result.push({ conversationId: convId, count: row.count });
    }
  }

  return result;
}

export async function getChatConversationById(ctx: DatabaseContext, conversationId: number, organizationId: number): Promise<import('../../types').ChatConversation | null> {
  ctx.validateTenantContext(organizationId, 'getChatConversationById');

  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data, error } = await supabase
      .from('chat_conversations')
      .select('*')
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw new Error(`Failed to fetch conversation: ${error.message}`);
    return data as import('../../types').ChatConversation | null;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');
  return (ctx.sqlite.prepare(
    'SELECT * FROM chat_conversations WHERE id = ? AND organization_id = ?'
  ).get(conversationId, organizationId) as import('../../types').ChatConversation | undefined) || null;
}

export async function getChatConversationParticipants(ctx: DatabaseContext, conversationId: number): Promise<number[]> {
  if (ctx.type === 'supabase') {
    const supabase = await ctx.getSupabaseClient();
    const { data } = await supabase
      .from('chat_participants')
      .select('user_id')
      .eq('conversation_id', conversationId);
    return (data || []).map((p: { user_id: number }) => p.user_id);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');
  const rows = ctx.sqlite.prepare(
    'SELECT user_id FROM chat_participants WHERE conversation_id = ?'
  ).all(conversationId) as { user_id: number }[];
  return rows.map(r => r.user_id);
}

export async function getChatTotalUnread(ctx: DatabaseContext, userId: number, organizationId: number): Promise<number> {
  ctx.validateTenantContext(organizationId, 'getChatTotalUnread');
  const counts = await getChatUnreadCounts(ctx, userId, organizationId);
  return counts.reduce((sum, c) => sum + c.count, 0);
}

// ============ KONTAKTLOGG ============

export async function getKontaktloggByKunde(ctx: DatabaseContext, kundeId: number, organizationId: number): Promise<Kontaktlogg[]> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.getKontaktloggByKunde(kundeId, organizationId);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  // Sikkerhet: Alltid filtrer på organization_id for å forhindre data-lekkasje
  return ctx.sqlite.prepare(`
    SELECT * FROM kontaktlogg
    WHERE kunde_id = ? AND organization_id = ?
    ORDER BY dato DESC
  `).all(kundeId, organizationId) as Kontaktlogg[];
}

export async function createKontaktlogg(ctx: DatabaseContext, data: Partial<Kontaktlogg> & { kunde_id: number; organization_id: number }): Promise<Kontaktlogg> {
  if (ctx.type === 'supabase' && ctx.supabase) {
    return ctx.supabase.createKontaktlogg(data);
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const stmt = ctx.sqlite.prepare(`
    INSERT INTO kontaktlogg (kunde_id, dato, type, notat, opprettet_av, organization_id)
    VALUES (?, datetime('now'), ?, ?, ?, ?)
  `);

  const result = stmt.run(
    data.kunde_id,
    data.type || 'Telefonsamtale',
    data.notat,
    data.opprettet_av,
    data.organization_id
  );

  const kontakt = ctx.sqlite.prepare('SELECT * FROM kontaktlogg WHERE id = ?').get(result.lastInsertRowid);
  return kontakt as Kontaktlogg;
}

export async function deleteKontaktlogg(ctx: DatabaseContext, id: number, organizationId: number): Promise<boolean> {
  ctx.validateTenantContext(organizationId, 'deleteKontaktlogg');

  if (ctx.type === 'supabase' && ctx.supabase) {
    await ctx.supabase.deleteKontaktlogg(id);
    return true;
  }

  if (!ctx.sqlite) throw new Error('Database not initialized');

  const sql = 'DELETE FROM kontaktlogg WHERE id = ? AND organization_id = ?';
  const result = ctx.sqlite.prepare(sql).run(id, organizationId);

  return result.changes > 0;
}

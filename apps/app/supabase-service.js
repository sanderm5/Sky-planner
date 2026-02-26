/**
 * Supabase Database Service
 * Provides database operations using Supabase as backend
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
// Use service key for server-side operations to bypass RLS policies
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;

function getClient() {
  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

// ===== KUNDER =====

async function getAllKunder() {
  const { data, error } = await getClient()
    .from('kunder')
    .select('*')
    .order('poststed')
    .order('navn')
    .range(0, 9999); // Explicitly request all rows (Supabase default limit workaround)

  if (error) throw error;
  return data;
}

async function getKundeById(id) {
  const { data, error } = await getClient()
    .from('kunder')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function createKunde(kunde) {
  // Build insert object, excluding undefined/null fields
  const insertData = {
    navn: kunde.navn,
    adresse: kunde.adresse,
    postnummer: kunde.postnummer,
    poststed: kunde.poststed,
    telefon: kunde.telefon,
    epost: kunde.epost,
    lat: kunde.lat,
    lng: kunde.lng,
    siste_kontroll: kunde.siste_kontroll,
    neste_kontroll: kunde.neste_kontroll,
    kontroll_intervall_mnd: kunde.kontroll_intervall_mnd || 12,
    notater: kunde.notater,
    kategori: kunde.kategori || 'El-Kontroll',
    el_type: kunde.el_type,
    brann_system: kunde.brann_system,
    // Separate kontroll-felt for El-Kontroll
    siste_el_kontroll: kunde.siste_el_kontroll,
    neste_el_kontroll: kunde.neste_el_kontroll,
    el_kontroll_intervall: kunde.el_kontroll_intervall || 36,
    // Separate kontroll-felt for Brannvarsling
    siste_brann_kontroll: kunde.siste_brann_kontroll,
    neste_brann_kontroll: kunde.neste_brann_kontroll,
    brann_kontroll_intervall: kunde.brann_kontroll_intervall || 12,
    // Driftskategori
    brann_driftstype: kunde.brann_driftstype,
    // Organization (multi-tenant support)
    organization_id: kunde.organization_id,
    // Integration sync fields
    external_source: kunde.external_source,
    external_id: kunde.external_id,
    last_sync_at: kunde.last_sync_at,
    prosjektnummer: kunde.prosjektnummer,
    kundenummer: kunde.kundenummer,
    faktura_epost: kunde.faktura_epost,
    org_nummer: kunde.org_nummer,
    estimert_tid: kunde.estimert_tid,
  };

  const { data, error } = await getClient()
    .from('kunder')
    .insert(insertData)
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateKunde(id, kunde, organizationId) {
  let query = getClient()
    .from('kunder')
    .update({
      navn: kunde.navn,
      adresse: kunde.adresse,
      postnummer: kunde.postnummer,
      poststed: kunde.poststed,
      telefon: kunde.telefon,
      epost: kunde.epost,
      lat: kunde.lat,
      lng: kunde.lng,
      siste_kontroll: kunde.siste_kontroll,
      neste_kontroll: kunde.neste_kontroll,
      kontroll_intervall_mnd: kunde.kontroll_intervall_mnd || 12,
      notater: kunde.notater,
      kategori: kunde.kategori,
      el_type: kunde.el_type,
      brann_system: kunde.brann_system,
      // Separate kontroll-felt for El-Kontroll
      siste_el_kontroll: kunde.siste_el_kontroll,
      neste_el_kontroll: kunde.neste_el_kontroll,
      el_kontroll_intervall: kunde.el_kontroll_intervall || 36,
      // Separate kontroll-felt for Brannvarsling
      siste_brann_kontroll: kunde.siste_brann_kontroll,
      neste_brann_kontroll: kunde.neste_brann_kontroll,
      brann_kontroll_intervall: kunde.brann_kontroll_intervall || 12,
      // Driftskategori
      brann_driftstype: kunde.brann_driftstype,
      // Integration sync fields
      external_source: kunde.external_source,
      external_id: kunde.external_id,
      last_sync_at: kunde.last_sync_at,
      prosjektnummer: kunde.prosjektnummer,
      kundenummer: kunde.kundenummer,
      faktura_epost: kunde.faktura_epost,
      org_nummer: kunde.org_nummer,
      estimert_tid: kunde.estimert_tid,
    })
    .eq('id', id);

  // SECURITY: Always filter by organization_id to prevent cross-tenant modification
  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { data, error } = await query.select().single();

  if (error) throw error;
  return data;
}

async function deleteKunde(id, organizationId) {
  // Delete related records to prevent orphans
  await getClient()
    .from('kontaktlogg')
    .delete()
    .eq('kunde_id', id);

  await getClient()
    .from('kontaktpersoner')
    .delete()
    .eq('kunde_id', id);

  await getClient()
    .from('kunde_tags')
    .delete()
    .eq('kunde_id', id);

  await getClient()
    .from('email_innstillinger')
    .delete()
    .eq('kunde_id', id);

  await getClient()
    .from('email_historikk')
    .delete()
    .eq('kunde_id', id);

  // Finally delete the customer
  // SECURITY: Always filter by organization_id to prevent cross-tenant deletion
  let query = getClient()
    .from('kunder')
    .delete()
    .eq('id', id);

  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { error } = await query;

  if (error) throw error;
  return { success: true };
}

async function getKunderByOmrade(omrade, organizationId) {
  // Sanitize input to prevent PostgREST filter injection
  // Remove special characters that could be used for injection
  const sanitizedOmrade = String(omrade)
    .replace(/[%_*(),.]/g, '') // Remove wildcard and filter special chars
    .replace(/\s+/g, ' ')       // Normalize whitespace
    .trim()
    .slice(0, 100);             // Limit length

  if (!sanitizedOmrade) {
    return [];
  }

  let query = getClient()
    .from('kunder')
    .select('*')
    .or(`poststed.ilike.%${sanitizedOmrade}%,adresse.ilike.%${sanitizedOmrade}%`);

  // SECURITY: Always filter by organization_id to prevent cross-tenant data access
  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data;
}

async function getKontrollVarsler(dagerFrem = 30, organizationId = null) {
  // Validate dagerFrem to prevent abuse - max 365 days
  const validDager = Math.max(1, Math.min(365, Number.parseInt(dagerFrem) || 30));

  const today = new Date().toISOString().split('T')[0];
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + validDager);
  const futureDateStr = futureDate.toISOString().split('T')[0];

  let query = getClient()
    .from('kunder')
    .select('*')
    .or(`neste_kontroll.lte.${futureDateStr},neste_kontroll.is.null`)
    .order('neste_kontroll', { ascending: true, nullsFirst: false });

  // SECURITY: Always filter by organization_id to prevent cross-tenant data access
  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { data, error } = await query;

  if (error) throw error;
  return data;
}

async function getOmrader(organizationId = null) {
  let query = getClient()
    .from('kunder')
    .select('poststed, postnummer')
    .not('poststed', 'is', null)
    .not('poststed', 'eq', '');

  // Add tenant filter if organizationId is provided
  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { data, error } = await query;

  if (error) throw error;

  // Group and count
  const grouped = {};
  data.forEach(k => {
    if (!grouped[k.poststed]) {
      grouped[k.poststed] = { poststed: k.poststed, postnummer: k.postnummer, antall: 0 };
    }
    grouped[k.poststed].antall++;
  });

  return Object.values(grouped).sort((a, b) => a.poststed.localeCompare(b.poststed));
}

async function bulkImportKunder(kunder) {
  const { data, error } = await getClient()
    .from('kunder')
    .insert(kunder.map(k => ({
      navn: k.navn,
      adresse: k.adresse,
      postnummer: k.postnummer || null,
      poststed: k.poststed || null,
      telefon: k.telefon || null,
      epost: k.epost || null,
      lat: k.lat || null,
      lng: k.lng || null,
      siste_kontroll: k.siste_kontroll || null,
      neste_kontroll: k.neste_kontroll || null,
      kontroll_intervall_mnd: k.kontroll_intervall_mnd || 12,
      notater: k.notater || null,
      kategori: k.kategori || 'El-Kontroll',
      el_type: k.el_type || null,
      brann_system: k.brann_system || null,
      brann_driftstype: k.brann_driftstype || null,
      siste_el_kontroll: k.siste_el_kontroll || null,
      neste_el_kontroll: k.neste_el_kontroll || null,
      el_kontroll_intervall: k.el_kontroll_intervall || 36,
      siste_brann_kontroll: k.siste_brann_kontroll || null,
      neste_brann_kontroll: k.neste_brann_kontroll || null,
      brann_kontroll_intervall: k.brann_kontroll_intervall || 12,
      organization_id: k.organization_id,
      external_source: k.external_source || null,
      external_id: k.external_id || null,
      prosjektnummer: k.prosjektnummer || null,
      kundenummer: k.kundenummer || null,
      faktura_epost: k.faktura_epost || null
    })))
    .select();

  if (error) throw error;
  return { imported: data.length, errors: [], total: kunder.length };
}

// ===== RUTER =====

async function getAllRuter(organizationId) {
  let query = getClient()
    .from('ruter')
    .select('*');

  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { data: ruter, error } = await query
    .order('planlagt_dato', { ascending: false })
    .order('opprettet', { ascending: false });

  if (error) throw error;

  if (!ruter || ruter.length === 0) return ruter;

  // Get customer counts for all routes in one query
  const ruteIds = ruter.map(r => r.id);
  const { data: ruteCounts, error: countError } = await getClient()
    .from('rute_kunder')
    .select('rute_id')
    .in('rute_id', ruteIds);

  if (countError) {
    console.error('Error fetching rute counts:', countError);
    // Fall back to 0 for all routes
    ruter.forEach(rute => rute.antall_kunder = 0);
    return ruter;
  }

  // Count occurrences per rute_id
  const countMap = {};
  (ruteCounts || []).forEach(rc => {
    countMap[rc.rute_id] = (countMap[rc.rute_id] || 0) + 1;
  });

  // Assign counts to each route
  ruter.forEach(rute => {
    rute.antall_kunder = countMap[rute.id] || 0;
  });

  return ruter;
}

async function getRuteById(id) {
  const { data: rute, error: ruteError } = await getClient()
    .from('ruter')
    .select('*')
    .eq('id', id)
    .single();

  if (ruteError) throw ruteError;

  const { data: ruteKunder, error: kunderError } = await getClient()
    .from('rute_kunder')
    .select('kunde_id, rekkefolge')
    .eq('rute_id', id)
    .order('rekkefolge');

  if (kunderError) throw kunderError;

  // Get full customer data
  const kundeIds = ruteKunder.map(rk => rk.kunde_id);
  if (kundeIds.length > 0) {
    const { data: kunder, error: kundeError } = await getClient()
      .from('kunder')
      .select('*')
      .in('id', kundeIds);

    if (kundeError) throw kundeError;

    // Add rekkefolge to each customer
    rute.kunder = kundeIds.map(id => {
      const kunde = kunder.find(k => k.id === id);
      const rk = ruteKunder.find(r => r.kunde_id === id);
      return { ...kunde, rekkefolge: rk.rekkefolge };
    });
  } else {
    rute.kunder = [];
  }

  return rute;
}

async function createRute(ruteData) {
  const { kunde_ids, ...rute } = ruteData;

  const { data: newRute, error: ruteError } = await getClient()
    .from('ruter')
    .insert({
      navn: rute.navn,
      beskrivelse: rute.beskrivelse,
      planlagt_dato: rute.planlagt_dato,
      total_distanse: rute.total_distanse,
      total_tid: rute.total_tid,
      status: 'planlagt'
    })
    .select()
    .single();

  if (ruteError) throw ruteError;

  // Add customers to route
  if (kunde_ids && kunde_ids.length > 0) {
    const ruteKunder = kunde_ids.map((kundeId, index) => ({
      rute_id: newRute.id,
      kunde_id: kundeId,
      rekkefolge: index + 1
    }));

    const { error: rkError } = await getClient()
      .from('rute_kunder')
      .insert(ruteKunder);

    if (rkError) throw rkError;
  }

  return newRute;
}

async function updateRute(id, ruteData) {
  const { kunde_ids, ...rute } = ruteData;

  const { data: updatedRute, error: ruteError } = await getClient()
    .from('ruter')
    .update({
      navn: rute.navn,
      beskrivelse: rute.beskrivelse,
      planlagt_dato: rute.planlagt_dato,
      status: rute.status || 'planlagt',
      total_distanse: rute.total_distanse,
      total_tid: rute.total_tid
    })
    .eq('id', id)
    .select()
    .single();

  if (ruteError) throw ruteError;

  // Update customers if provided
  if (kunde_ids) {
    // Delete existing
    await getClient().from('rute_kunder').delete().eq('rute_id', id);

    // Insert new
    if (kunde_ids.length > 0) {
      const ruteKunder = kunde_ids.map((kundeId, index) => ({
        rute_id: id,
        kunde_id: kundeId,
        rekkefolge: index + 1
      }));

      const { error: rkError } = await getClient()
        .from('rute_kunder')
        .insert(ruteKunder);

      if (rkError) throw rkError;
    }
  }

  return updatedRute;
}

async function deleteRute(id) {
  await getClient().from('rute_kunder').delete().eq('rute_id', id);
  const { error } = await getClient().from('ruter').delete().eq('id', id);
  if (error) throw error;
  return { success: true };
}

async function completeRute(id, dato) {
  const completionDate = dato || new Date().toISOString().split('T')[0];

  // Get customers in route
  const { data: ruteKunder, error: rkError } = await getClient()
    .from('rute_kunder')
    .select('kunde_id')
    .eq('rute_id', id);

  if (rkError) throw rkError;

  // Get customer details for interval
  const kundeIds = ruteKunder.map(rk => rk.kunde_id);
  const { data: kunder, error: kError } = await getClient()
    .from('kunder')
    .select('id, kontroll_intervall_mnd')
    .in('id', kundeIds);

  if (kError) throw kError;

  // Update each customer
  for (const kunde of kunder) {
    const intervalMonths = kunde.kontroll_intervall_mnd || 12;
    const nextDate = new Date(completionDate);
    nextDate.setMonth(nextDate.getMonth() + intervalMonths);

    await getClient()
      .from('kunder')
      .update({
        siste_kontroll: completionDate,
        neste_kontroll: nextDate.toISOString().split('T')[0]
      })
      .eq('id', kunde.id);
  }

  // Mark route as complete
  await getClient()
    .from('ruter')
    .update({ status: 'fullført' })
    .eq('id', id);

  return { success: true, oppdaterte_kunder: kunder.length };
}

// ===== EMAIL SETTINGS =====

async function getEmailInnstillinger(kundeId) {
  const { data, error } = await getClient()
    .from('email_innstillinger')
    .select('*')
    .eq('kunde_id', kundeId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  if (!data) {
    return {
      kunde_id: parseInt(kundeId),
      email_aktiv: true,
      forste_varsel_dager: parseInt(process.env.EMAIL_FIRST_REMINDER_DAYS) || 30,
      paaminnelse_etter_dager: parseInt(process.env.EMAIL_REMINDER_AFTER_DAYS) || 7
    };
  }

  return data;
}

async function updateEmailInnstillinger(kundeId, settings) {
  const { data: existing } = await getClient()
    .from('email_innstillinger')
    .select('id')
    .eq('kunde_id', kundeId)
    .single();

  if (existing) {
    await getClient()
      .from('email_innstillinger')
      .update({
        email_aktiv: settings.email_aktiv,
        forste_varsel_dager: settings.forste_varsel_dager || 30,
        paaminnelse_etter_dager: settings.paaminnelse_etter_dager || 7
      })
      .eq('kunde_id', kundeId);
  } else {
    await getClient()
      .from('email_innstillinger')
      .insert({
        kunde_id: kundeId,
        email_aktiv: settings.email_aktiv,
        forste_varsel_dager: settings.forste_varsel_dager || 30,
        paaminnelse_etter_dager: settings.paaminnelse_etter_dager || 7
      });
  }

  return { success: true };
}

async function getEmailHistorikk(organizationId, kundeId = null, limit = 50) {
  // Sikkerhet: Alltid filtrer på organization_id via kunder-tabellen
  let query = getClient()
    .from('email_varsler')
    .select('*, kunder!inner(organization_id)')
    .eq('kunder.organization_id', organizationId)
    .order('opprettet', { ascending: false })
    .limit(limit);

  if (kundeId) {
    query = query.eq('kunde_id', kundeId);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Fjern kunder-relasjon fra resultat
  return (data || []).map(({ kunder, ...rest }) => rest);
}

async function getEmailStats(organizationId) {
  // Sikkerhet: Kun tell e-poster for denne organisasjonen
  const { data, error } = await getClient()
    .from('email_varsler')
    .select('status, kunder!inner(organization_id)')
    .eq('kunder.organization_id', organizationId);

  if (error) throw error;

  const stats = { pending: 0, sent: 0, failed: 0 };
  (data || []).forEach(row => {
    if (row.status === 'pending') stats.pending++;
    else if (row.status === 'sent') stats.sent++;
    else if (row.status === 'failed') stats.failed++;
  });

  return stats;
}

async function getUpcomingEmails(organizationId, firstReminderDays) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + firstReminderDays);
  const futureDateStr = futureDate.toISOString().split('T')[0];

  const pastDate = new Date();
  pastDate.setDate(pastDate.getDate() - 7);
  const pastDateStr = pastDate.toISOString().split('T')[0];

  // Sikkerhet: Kun hent kunder for denne organisasjonen
  const { data: kunder, error: kError } = await getClient()
    .from('kunder')
    .select('id, navn, epost, neste_kontroll')
    .eq('organization_id', organizationId)
    .not('neste_kontroll', 'is', null)
    .not('epost', 'is', null)
    .neq('epost', '')
    .lte('neste_kontroll', futureDateStr)
    .gte('neste_kontroll', pastDateStr)
    .order('neste_kontroll')
    .limit(20);

  if (kError) throw kError;

  // Get email settings
  const kundeIds = kunder.map(k => k.id);
  const { data: settings } = await getClient()
    .from('email_innstillinger')
    .select('kunde_id, email_aktiv, forste_varsel_dager')
    .in('kunde_id', kundeIds);

  const settingsMap = {};
  (settings || []).forEach(s => { settingsMap[s.kunde_id] = s; });

  const today = new Date();
  return kunder
    .filter(k => {
      const s = settingsMap[k.id];
      return !s || s.email_aktiv !== false;
    })
    .map(k => {
      const s = settingsMap[k.id] || {};
      const daysUntil = Math.ceil((new Date(k.neste_kontroll) - today) / (1000 * 60 * 60 * 24));
      return {
        ...k,
        email_aktiv: s.email_aktiv !== false,
        forste_varsel_dager: s.forste_varsel_dager || firstReminderDays,
        days_until: daysUntil
      };
    });
}

async function insertEmailVarsel(varsel) {
  const { data, error } = await getClient()
    .from('email_varsler')
    .insert(varsel)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ===== KLIENT (Portal Login) =====

async function getKlientByEpost(epost) {
  const { data, error } = await getClient()
    .from('klient')
    .select('*')
    .ilike('epost', epost)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function getAllKlienter() {
  const { data, error } = await getClient()
    .from('klient')
    .select('*')
    .eq('aktiv', true);

  if (error) throw error;
  return data || [];
}

async function getKlientById(id) {
  const { data, error } = await getClient()
    .from('klient')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function createKlient(klient) {
  const { data, error } = await getClient()
    .from('klient')
    .insert({
      navn: klient.navn,
      epost: klient.epost,
      passord_hash: klient.passord_hash,
      telefon: klient.telefon || null
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateKlientLastLogin(id) {
  const { error } = await getClient()
    .from('klient')
    .update({ sist_innlogget: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

// ===== BRUKERE (Admin Login) =====

async function getBrukerByEpost(epost) {
  const { data, error } = await getClient()
    .from('brukere')
    .select('*')
    .ilike('epost', epost)
    .eq('aktiv', true)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function updateBrukerLastLogin(id) {
  const { error } = await getClient()
    .from('brukere')
    .update({ sist_innlogget: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;
}

async function getBrukerById(id) {
  const { data, error } = await getClient()
    .from('brukere')
    .select('*')
    .eq('id', id)
    .eq('aktiv', true)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// ===== REFRESH TOKENS =====

async function storeRefreshToken(tokenHash, userId, userType, deviceInfo, ipAddress, expiresAt) {
  const { data, error } = await getClient()
    .from('refresh_tokens')
    .insert({
      token_hash: tokenHash,
      user_id: userId,
      user_type: userType,
      device_info: deviceInfo,
      ip_address: ipAddress,
      expires_at: expiresAt
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getRefreshTokenRecord(tokenHash) {
  const { data, error } = await getClient()
    .from('refresh_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .single();

  if (error && error.code !== 'PGRST116') return null;
  return data;
}

async function revokeRefreshToken(tokenHash, replacedBy = null) {
  const updateData = {
    revoked_at: new Date().toISOString()
  };

  if (replacedBy) {
    updateData.replaced_by = replacedBy;
  }

  const { data, error } = await getClient()
    .from('refresh_tokens')
    .update(updateData)
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .select();

  if (error) throw error;
  return data && data.length > 0;
}

async function revokeAllUserRefreshTokens(userId, userType) {
  const { data, error } = await getClient()
    .from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('user_type', userType)
    .is('revoked_at', null)
    .select();

  if (error) throw error;
  return data ? data.length : 0;
}

// ===== AVTALER =====

async function getAllAvtaler() {
  const { data, error } = await getClient()
    .from('avtaler')
    .select(`
      *,
      kunder (id, navn, adresse, postnummer, poststed, telefon, kategori)
    `)
    .order('dato', { ascending: true })
    .order('klokkeslett', { ascending: true });

  if (error) throw error;
  return data;
}

async function getAvtalerByDateRange(startDate, endDate) {
  const { data, error } = await getClient()
    .from('avtaler')
    .select(`
      *,
      kunder (id, navn, adresse, postnummer, poststed, telefon, kategori)
    `)
    .gte('dato', startDate)
    .lte('dato', endDate)
    .order('dato', { ascending: true })
    .order('klokkeslett', { ascending: true });

  if (error) throw error;
  return data;
}

async function getAvtaleById(id) {
  const { data, error } = await getClient()
    .from('avtaler')
    .select(`
      *,
      kunder (id, navn, adresse, postnummer, poststed, telefon, kategori)
    `)
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function createAvtale(avtale) {
  const { data, error } = await getClient()
    .from('avtaler')
    .insert({
      kunde_id: avtale.kunde_id,
      dato: avtale.dato,
      klokkeslett: avtale.klokkeslett || null,
      type: avtale.type || 'El-Kontroll',
      beskrivelse: avtale.beskrivelse || null,
      status: avtale.status || 'planlagt',
      opprettet_av: avtale.opprettet_av || null,
      organization_id: avtale.organization_id || null,
      er_gjentakelse: avtale.er_gjentakelse || false,
      gjentakelse_regel: avtale.gjentakelse_regel || null,
      gjentakelse_slutt: avtale.gjentakelse_slutt || null,
      original_avtale_id: avtale.original_avtale_id || null
    })
    .select(`
      *,
      kunder (id, navn, adresse, postnummer, poststed, telefon, kategori)
    `)
    .single();

  if (error) throw error;
  return data;
}

async function updateAvtale(id, avtale) {
  const updateData = {};
  if (avtale.kunde_id !== undefined) updateData.kunde_id = avtale.kunde_id;
  if (avtale.dato !== undefined) updateData.dato = avtale.dato;
  if (avtale.klokkeslett !== undefined) updateData.klokkeslett = avtale.klokkeslett;
  if (avtale.type !== undefined) updateData.type = avtale.type;
  if (avtale.beskrivelse !== undefined) updateData.beskrivelse = avtale.beskrivelse;
  if (avtale.status !== undefined) updateData.status = avtale.status;
  updateData.updated_at = new Date().toISOString();

  const { data, error } = await getClient()
    .from('avtaler')
    .update(updateData)
    .eq('id', id)
    .select(`
      *,
      kunder (id, navn, adresse, postnummer, poststed, telefon, kategori)
    `)
    .single();

  if (error) throw error;
  return data;
}

async function deleteAvtale(id) {
  const { error } = await getClient()
    .from('avtaler')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}

async function deleteAvtaleSeries(parentId, organizationId) {
  // Delete all instances linked to this parent
  const { data: instances } = await getClient()
    .from('avtaler')
    .select('id')
    .eq('original_avtale_id', parentId)
    .eq('organization_id', organizationId);

  let count = 0;
  if (instances) {
    const { error: instErr } = await getClient()
      .from('avtaler')
      .delete()
      .eq('original_avtale_id', parentId)
      .eq('organization_id', organizationId);
    if (instErr) throw instErr;
    count += instances.length;
  }

  // Delete the parent
  const { error: parentErr } = await getClient()
    .from('avtaler')
    .delete()
    .eq('id', parentId)
    .eq('organization_id', organizationId);
  if (parentErr) throw parentErr;
  count++;

  return count;
}

async function deleteAvtalerByRuteId(ruteId, organizationId) {
  const { data, error } = await getClient()
    .from('avtaler')
    .delete()
    .eq('rute_id', ruteId)
    .eq('organization_id', organizationId)
    .select('id');

  if (error) throw error;
  return data?.length || 0;
}

async function completeAvtale(id, completionData) {
  // Get the avtale
  const avtale = await getAvtaleById(id);
  if (!avtale) throw new Error('Avtale ikke funnet');

  // Mark avtale as completed
  await updateAvtale(id, { status: 'fullført' });

  // Update customer's kontroll dates if needed
  if (avtale.kunde_id && completionData.updateKunde) {
    const completionDate = avtale.dato;
    const { data: kunde } = await getClient()
      .from('kunder')
      .select('kontroll_intervall_mnd, kategori')
      .eq('id', avtale.kunde_id)
      .single();

    if (kunde) {
      const intervalMonths = kunde.kontroll_intervall_mnd || 12;
      const nextDate = new Date(completionDate);
      nextDate.setMonth(nextDate.getMonth() + intervalMonths);

      const updateFields = {};
      if (avtale.type === 'El-Kontroll' || kunde.kategori === 'El-Kontroll') {
        updateFields.siste_el_kontroll = completionDate;
        updateFields.neste_el_kontroll = nextDate.toISOString().split('T')[0];
      } else if (avtale.type === 'Brannvarsling' || kunde.kategori === 'Brannvarsling') {
        updateFields.siste_brann_kontroll = completionDate;
        updateFields.neste_brann_kontroll = nextDate.toISOString().split('T')[0];
      }

      if (Object.keys(updateFields).length > 0) {
        await getClient()
          .from('kunder')
          .update(updateFields)
          .eq('id', avtale.kunde_id);
      }
    }
  }

  return { success: true };
}

// ==================== KONTAKTLOGG ====================

async function getKontaktloggByKunde(kundeId, organizationId) {
  // Sikkerhet: Alltid filtrer på organization_id for å forhindre data-lekkasje
  const { data, error } = await getClient()
    .from('kontaktlogg')
    .select('*')
    .eq('kunde_id', kundeId)
    .eq('organization_id', organizationId)
    .order('dato', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function createKontaktlogg(kontakt) {
  const { data, error } = await getClient()
    .from('kontaktlogg')
    .insert([{
      kunde_id: kontakt.kunde_id,
      dato: kontakt.dato || new Date().toISOString(),
      type: kontakt.type || 'Telefonsamtale',
      notat: kontakt.notat,
      opprettet_av: kontakt.opprettet_av
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function deleteKontaktlogg(id) {
  const { error } = await getClient()
    .from('kontaktlogg')
    .delete()
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}

// ===== LOGIN LOGG =====

async function logLogin(epost, brukerNavn, brukerType, status, ipAdresse, userAgent, feilMelding = null) {
  const { error } = await getClient()
    .from('login_logg')
    .insert({
      epost,
      bruker_navn: brukerNavn,
      bruker_type: brukerType,
      status,
      ip_adresse: ipAdresse,
      user_agent: userAgent,
      feil_melding: feilMelding
    });

  if (error) throw error;
}

async function getLoginLogg(limit = 100, offset = 0) {
  const { data, error } = await getClient()
    .from('login_logg')
    .select('*')
    .order('tidspunkt', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return data;
}

async function getLoginLoggCount() {
  const { count, error } = await getClient()
    .from('login_logg')
    .select('*', { count: 'exact', head: true });

  if (error) throw error;
  return count;
}

async function getLoginStats() {
  const { data, error } = await getClient()
    .from('login_logg')
    .select('status, tidspunkt');

  if (error) throw error;

  const now = new Date();
  const last24h = new Date(now - 24 * 60 * 60 * 1000);
  const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

  let total = 0, vellykket = 0, feilet = 0, siste24t = 0, siste7d = 0;

  (data || []).forEach(row => {
    total++;
    if (row.status === 'vellykket') vellykket++;
    if (row.status === 'feilet') feilet++;

    const tid = new Date(row.tidspunkt);
    if (tid >= last24h) siste24t++;
    if (tid >= last7d) siste7d++;
  });

  return { total, vellykket, feilet, siste24t, siste7d };
}

// Log email reminder (for manual reminders)
async function logEmailReminder(kundeId, daysUntil, status) {
  try {
    const { data, error } = await getClient()
      .from('email_varsler')
      .insert({
        kunde_id: kundeId,
        type: 'påminnelse',
        status: status,
        opprettet: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Error logging email reminder:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Error in logEmailReminder:', err);
    return null;
  }
}

// ===== ORGANIZATIONS (Multi-tenancy) =====

async function getOrganizationById(id) {
  const { data, error } = await getClient()
    .from('organizations')
    .select('*')
    .eq('id', id)
    .eq('aktiv', true)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function getOrganizationBySlug(slug) {
  const { data, error } = await getClient()
    .from('organizations')
    .select('*')
    .eq('slug', slug)
    .eq('aktiv', true)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function getAllOrganizations() {
  const { data, error } = await getClient()
    .from('organizations')
    .select('*')
    .eq('aktiv', true)
    .order('navn');

  if (error) throw error;
  return data;
}

/**
 * Get customer count for a specific organization (for super admin)
 */
async function getKundeCountForOrganization(organizationId) {
  const { count, error } = await getClient()
    .from('kunder')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId);

  if (error) throw error;
  return count || 0;
}

/**
 * Get user (bruker/klient) count for a specific organization (for super admin)
 */
async function getBrukerCountForOrganization(organizationId) {
  const { count, error } = await getClient()
    .from('klient')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('aktiv', true);

  if (error) throw error;
  return count || 0;
}

/**
 * Get all users (klienter) for an organization (for super admin)
 */
async function getKlienterForOrganization(organizationId) {
  const { data, error } = await getClient()
    .from('klient')
    .select('*')
    .eq('organization_id', organizationId)
    .order('navn', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get global statistics across all organizations (for super admin)
 */
async function getGlobalStatistics() {
  // Get total organizations
  const { count: totalOrganizations, error: orgError } = await getClient()
    .from('organizations')
    .select('*', { count: 'exact', head: true })
    .eq('aktiv', true);

  if (orgError) throw orgError;

  // Get total customers
  const { count: totalKunder, error: kundeError } = await getClient()
    .from('kunder')
    .select('*', { count: 'exact', head: true });

  if (kundeError) throw kundeError;

  // Get total users (klienter)
  const { count: totalUsers, error: userError } = await getClient()
    .from('klient')
    .select('*', { count: 'exact', head: true })
    .eq('aktiv', true);

  if (userError) throw userError;

  // Get active subscriptions
  const { count: activeSubscriptions, error: subError } = await getClient()
    .from('organizations')
    .select('*', { count: 'exact', head: true })
    .eq('aktiv', true)
    .in('subscription_status', ['active', 'trialing']);

  if (subError) throw subError;

  // Get plan distribution
  const { data: planOrgs, error: planError } = await getClient()
    .from('organizations')
    .select('plan_type, subscription_status')
    .eq('aktiv', true);

  if (planError) throw planError;

  const organizationsByPlan = {};
  for (const org of (planOrgs || [])) {
    const plan = org.plan_type || 'free';
    organizationsByPlan[plan] = (organizationsByPlan[plan] || 0) + 1;
  }

  return {
    totalOrganizations: totalOrganizations || 0,
    totalKunder: totalKunder || 0,
    totalUsers: totalUsers || 0,
    activeSubscriptions: activeSubscriptions || 0,
    organizationsByPlan,
  };
}

async function createOrganization(org) {
  const { data, error } = await getClient()
    .from('organizations')
    .insert({
      navn: org.navn,
      slug: org.slug,
      logo_url: org.logo_url,
      primary_color: org.primary_color || '#F97316',
      secondary_color: org.secondary_color || '#1E293B',
      brand_title: org.brand_title,
      brand_subtitle: org.brand_subtitle,
      firma_adresse: org.firma_adresse,
      firma_telefon: org.firma_telefon,
      firma_epost: org.firma_epost,
      firma_orgnr: org.firma_orgnr,
      map_center_lat: org.map_center_lat,
      map_center_lng: org.map_center_lng,
      map_zoom: org.map_zoom,
      route_start_lat: org.route_start_lat,
      route_start_lng: org.route_start_lng,
      route_start_address: org.route_start_address,
      plan_type: org.plan_type || 'standard',
      max_kunder: org.max_kunder || 200,
      max_brukere: org.max_brukere || 5
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function updateOrganization(id, org) {
  // Build update object dynamically — only include fields that were provided
  const allowedFields = [
    'navn', 'logo_url', 'primary_color', 'secondary_color',
    'brand_title', 'brand_subtitle',
    'firma_adresse', 'firma_telefon', 'firma_epost', 'firma_orgnr',
    'map_center_lat', 'map_center_lng', 'map_zoom',
    'route_start_lat', 'route_start_lng', 'route_start_address',
    'firma_adresse',
    'plan_type', 'max_kunder', 'max_brukere'
  ];

  const updateData = { updated_at: new Date().toISOString() };
  for (const field of allowedFields) {
    if (field in org) {
      updateData[field] = org[field];
    }
  }

  const { data, error } = await getClient()
    .from('organizations')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ===== TENANT-FILTERED QUERIES =====

async function getAllKunderByTenant(organizationId) {
  const { data, error } = await getClient()
    .from('kunder')
    .select('*')
    .eq('organization_id', organizationId)
    .order('poststed')
    .order('navn')
    .range(0, 9999);

  if (error) throw error;
  return data;
}

async function getKundeByIdAndTenant(id, organizationId) {
  const { data, error } = await getClient()
    .from('kunder')
    .select('*')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function getRuterByTenant(organizationId) {
  const { data, error } = await getClient()
    .from('ruter')
    .select('*')
    .eq('organization_id', organizationId)
    .order('opprettet', { ascending: false });

  if (error) throw error;
  return data;
}

async function getAvtalerByTenant(organizationId, startDate, endDate) {
  let query = getClient()
    .from('avtaler')
    .select(`
      *,
      kunder (
        id, navn, adresse, postnummer, poststed, telefon, kategori
      )
    `)
    .eq('organization_id', organizationId);

  if (startDate && endDate) {
    query = query.gte('dato', startDate).lte('dato', endDate);
  }

  const { data, error } = await query.order('dato').order('klokkeslett');

  if (error) throw error;
  return data;
}

// ===== INDUSTRY TEMPLATES (Multi-Industry Support) =====

async function getAllIndustryTemplates() {
  const { data, error } = await getClient()
    .from('industry_templates')
    .select('*')
    .eq('aktiv', true)
    .order('sort_order');

  if (error) throw error;
  return data;
}

async function getIndustryTemplateById(id) {
  const { data, error } = await getClient()
    .from('industry_templates')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function getIndustryTemplateBySlug(slug) {
  const { data, error } = await getClient()
    .from('industry_templates')
    .select('*')
    .eq('slug', slug)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function getServiceTypesByTemplate(templateId) {
  const { data, error } = await getClient()
    .from('template_service_types')
    .select(`
      *,
      template_subtypes (
        id, name, slug, default_interval_months, sort_order, aktiv
      ),
      template_equipment (
        id, name, slug, sort_order, aktiv
      )
    `)
    .eq('template_id', templateId)
    .eq('aktiv', true)
    .order('sort_order');

  if (error) throw error;
  return data;
}

async function getIntervalsByTemplate(templateId) {
  const { data, error } = await getClient()
    .from('template_intervals')
    .select('*')
    .eq('template_id', templateId)
    .order('months');

  if (error) throw error;
  return data;
}

async function getFullIndustryConfig(templateIdOrSlug) {
  // Get template (by ID or slug)
  let template;
  if (typeof templateIdOrSlug === 'number') {
    template = await getIndustryTemplateById(templateIdOrSlug);
  } else {
    template = await getIndustryTemplateBySlug(templateIdOrSlug);
  }

  if (!template) return null;

  // Get service types with subtypes and equipment
  const serviceTypes = await getServiceTypesByTemplate(template.id);

  // Get intervals
  const intervals = await getIntervalsByTemplate(template.id);

  return {
    ...template,
    serviceTypes: serviceTypes.map(st => ({
      id: st.id,
      name: st.name,
      slug: st.slug,
      icon: st.icon,
      color: st.color,
      defaultInterval: st.default_interval_months,
      description: st.description,
      subtypes: (st.template_subtypes || [])
        .filter(sub => sub.aktiv)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(sub => ({
          id: sub.id,
          name: sub.name,
          slug: sub.slug,
          defaultInterval: sub.default_interval_months
        })),
      equipmentTypes: (st.template_equipment || [])
        .filter(eq => eq.aktiv)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(eq => ({
          id: eq.id,
          name: eq.name,
          slug: eq.slug
        }))
    })),
    intervals: intervals.map(i => ({
      months: i.months,
      label: i.label,
      isDefault: i.is_default
    }))
  };
}

// ===== CUSTOMER SERVICES =====

async function getCustomerServices(kundeId) {
  const { data, error } = await getClient()
    .from('customer_services')
    .select(`
      *,
      template_service_types (
        id, name, slug, icon, color
      ),
      template_subtypes (
        id, name, slug
      ),
      template_equipment (
        id, name, slug
      )
    `)
    .eq('kunde_id', kundeId)
    .eq('aktiv', true);

  if (error) throw error;
  return data;
}

async function upsertCustomerService(kundeId, serviceTypeId, serviceData) {
  const { data, error } = await getClient()
    .from('customer_services')
    .upsert({
      kunde_id: kundeId,
      service_type_id: serviceTypeId,
      subtype_id: serviceData.subtypeId || null,
      equipment_type_id: serviceData.equipmentTypeId || null,
      siste_kontroll: serviceData.sisteKontroll || null,
      neste_kontroll: serviceData.nesteKontroll || null,
      intervall_months: serviceData.intervallMonths || null,
      notater: serviceData.notater || null,
      aktiv: true
    }, {
      onConflict: 'kunde_id,service_type_id'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function deleteCustomerService(kundeId, serviceTypeId) {
  const { error } = await getClient()
    .from('customer_services')
    .delete()
    .eq('kunde_id', kundeId)
    .eq('service_type_id', serviceTypeId);

  if (error) throw error;
  return true;
}

async function getCustomerServicesWithUpcoming(days = 30, organizationId = null) {
  // Get all customer services with upcoming controls
  let query = getClient()
    .from('customer_services')
    .select(`
      *,
      kunder (
        id, navn, adresse, postnummer, poststed, telefon, epost, lat, lng, organization_id
      ),
      template_service_types (
        id, name, slug, icon, color
      )
    `)
    .eq('aktiv', true)
    .not('neste_kontroll', 'is', null)
    .lte('neste_kontroll', new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    .order('neste_kontroll');

  const { data, error } = await query;

  if (error) throw error;

  // Filter by organization if specified
  if (organizationId) {
    return data.filter(cs => cs.kunder?.organization_id === organizationId);
  }

  return data;
}

// ===== DYNAMIC CUSTOMER SERVICES - NEW METHODS =====

/**
 * Get all customers with their dynamic services attached
 */
async function getAllKunderWithServices(organizationId = null) {
  let query = getClient()
    .from('kunder')
    .select('*')
    .order('poststed')
    .order('navn')
    .range(0, 9999);

  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { data: kunder, error: kunderError } = await query;
  if (kunderError) throw kunderError;

  if (!kunder || kunder.length === 0) return kunder;

  // Get all customer services with joined data (FK now points to organization_service_types)
  const kundeIds = kunder.map(k => k.id);
  const { data: services, error: servicesError } = await getClient()
    .from('customer_services')
    .select(`
      *,
      organization_service_types (
        id, name, slug, icon, color, default_interval_months
      )
    `)
    .in('kunde_id', kundeIds)
    .eq('aktiv', true);

  if (servicesError) throw servicesError;

  // Group services by kunde_id
  const servicesByKunde = {};
  (services || []).forEach(s => {
    if (!servicesByKunde[s.kunde_id]) {
      servicesByKunde[s.kunde_id] = [];
    }
    servicesByKunde[s.kunde_id].push({
      id: s.id,
      service_type_id: s.service_type_id,
      subtype_id: s.subtype_id,
      equipment_type_id: s.equipment_type_id,
      siste_kontroll: s.siste_kontroll,
      neste_kontroll: s.neste_kontroll,
      intervall_months: s.intervall_months,
      driftstype: s.driftstype,
      notater: s.notater,
      service_type_name: s.organization_service_types?.name,
      service_type_slug: s.organization_service_types?.slug,
      service_type_icon: s.organization_service_types?.icon,
      service_type_color: s.organization_service_types?.color,
      subtype_name: null,
      subtype_slug: null,
      equipment_name: null,
      equipment_slug: null
    });
  });

  // Attach services to each kunde
  kunder.forEach(k => {
    k.services = servicesByKunde[k.id] || [];
  });

  return kunder;
}

/**
 * Get a single customer with their dynamic services
 */
async function getKundeByIdWithServices(id, organizationId = null) {
  let query = getClient()
    .from('kunder')
    .select('*')
    .eq('id', id);

  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { data: kunde, error: kundeError } = await query.single();
  if (kundeError && kundeError.code !== 'PGRST116') throw kundeError;
  if (!kunde) return null;

  // Get customer services
  // FK now points to organization_service_types after migration 049
  const { data: services, error: servicesError } = await getClient()
    .from('customer_services')
    .select(`
      *,
      organization_service_types (
        id, name, slug, icon, color, default_interval_months
      )
    `)
    .eq('kunde_id', id)
    .eq('aktiv', true);

  if (servicesError) throw servicesError;

  kunde.services = (services || []).map(s => ({
    id: s.id,
    service_type_id: s.service_type_id,
    subtype_id: s.subtype_id,
    equipment_type_id: s.equipment_type_id,
    siste_kontroll: s.siste_kontroll,
    neste_kontroll: s.neste_kontroll,
    intervall_months: s.intervall_months,
    driftstype: s.driftstype,
    notater: s.notater,
    service_type_name: s.organization_service_types?.name,
    service_type_slug: s.organization_service_types?.slug,
    service_type_icon: s.organization_service_types?.icon,
    service_type_color: s.organization_service_types?.color,
    subtype_name: null,
    subtype_slug: null,
    equipment_name: null,
    equipment_slug: null
  }));

  return kunde;
}

/**
 * Get control warnings using dynamic customer_services table
 */
async function getKontrollVarslerDynamic(dagerFrem = 30, organizationId = null) {
  const validDager = Math.max(1, Math.min(365, Number.parseInt(dagerFrem) || 30));
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + validDager);
  const futureDateStr = futureDate.toISOString().split('T')[0];

  // Get customer services with upcoming controls
  let query = getClient()
    .from('customer_services')
    .select(`
      *,
      kunder (
        id, navn, adresse, postnummer, poststed, telefon, epost, lat, lng,
        kategori, el_type, brann_system, brann_driftstype, notater, organization_id
      ),
      template_service_types (
        id, name, slug, icon, color
      )
    `)
    .eq('aktiv', true)
    .or(`neste_kontroll.lte.${futureDateStr},neste_kontroll.is.null`)
    .order('neste_kontroll', { ascending: true, nullsFirst: false });

  const { data, error } = await query;
  if (error) throw error;

  // Filter by organization if specified
  let filtered = data;
  if (organizationId) {
    filtered = data.filter(cs => cs.kunder?.organization_id === organizationId);
  }

  // Transform to expected format
  return filtered.map(cs => ({
    // Customer data
    id: cs.kunder?.id,
    navn: cs.kunder?.navn,
    adresse: cs.kunder?.adresse,
    postnummer: cs.kunder?.postnummer,
    poststed: cs.kunder?.poststed,
    telefon: cs.kunder?.telefon,
    epost: cs.kunder?.epost,
    lat: cs.kunder?.lat,
    lng: cs.kunder?.lng,
    notater: cs.kunder?.notater,
    // Service data
    service_id: cs.id,
    service_type_id: cs.service_type_id,
    service_type_name: cs.template_service_types?.name,
    service_type_slug: cs.template_service_types?.slug,
    service_type_icon: cs.template_service_types?.icon,
    service_type_color: cs.template_service_types?.color,
    siste_kontroll: cs.siste_kontroll,
    neste_kontroll: cs.neste_kontroll,
    intervall_months: cs.intervall_months,
    driftstype: cs.driftstype,
    // Legacy fields for backward compatibility
    kategori: cs.kunder?.kategori,
    el_type: cs.kunder?.el_type,
    brann_system: cs.kunder?.brann_system,
    brann_driftstype: cs.kunder?.brann_driftstype
  }));
}

/**
 * Mark a specific service as complete for a customer
 */
async function completeCustomerService(kundeId, serviceTypeId, completionDate) {
  const dato = completionDate || new Date().toISOString().split('T')[0];

  // Get the current service to find the interval
  const { data: service, error: serviceError } = await getClient()
    .from('customer_services')
    .select(`
      *,
      template_service_types (
        default_interval_months
      )
    `)
    .eq('kunde_id', kundeId)
    .eq('service_type_id', serviceTypeId)
    .single();

  if (serviceError && serviceError.code !== 'PGRST116') throw serviceError;

  const intervalMonths = service?.intervall_months ||
                          service?.template_service_types?.default_interval_months ||
                          12;

  const nextDate = new Date(dato);
  nextDate.setMonth(nextDate.getMonth() + intervalMonths);
  const nextDateStr = nextDate.toISOString().split('T')[0];

  // Update the service
  const { data, error } = await getClient()
    .from('customer_services')
    .update({
      siste_kontroll: dato,
      neste_kontroll: nextDateStr
    })
    .eq('kunde_id', kundeId)
    .eq('service_type_id', serviceTypeId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Bulk complete services for multiple customers
 */
async function bulkCompleteServices(customerIds, serviceTypeSlug, completionDate) {
  const dato = completionDate || new Date().toISOString().split('T')[0];

  // Get the service type by slug
  const { data: serviceType, error: stError } = await getClient()
    .from('template_service_types')
    .select('id, default_interval_months')
    .eq('slug', serviceTypeSlug)
    .single();

  if (stError && stError.code !== 'PGRST116') throw stError;
  if (!serviceType) throw new Error(`Service type not found: ${serviceTypeSlug}`);

  let updatedCount = 0;

  for (const kundeId of customerIds) {
    // Get the current service
    const { data: service } = await getClient()
      .from('customer_services')
      .select('intervall_months')
      .eq('kunde_id', kundeId)
      .eq('service_type_id', serviceType.id)
      .single();

    const intervalMonths = service?.intervall_months || serviceType.default_interval_months || 12;
    const nextDate = new Date(dato);
    nextDate.setMonth(nextDate.getMonth() + intervalMonths);
    const nextDateStr = nextDate.toISOString().split('T')[0];

    // Update the service
    const { error } = await getClient()
      .from('customer_services')
      .update({
        siste_kontroll: dato,
        neste_kontroll: nextDateStr
      })
      .eq('kunde_id', kundeId)
      .eq('service_type_id', serviceType.id);

    if (!error) updatedCount++;
  }

  return { success: true, updatedCount };
}

/**
 * Get a service type by slug
 */
async function getServiceTypeBySlug(slug) {
  const { data, error } = await getClient()
    .from('template_service_types')
    .select(`
      *,
      template_subtypes (
        id, name, slug, default_interval_months, sort_order, aktiv
      ),
      template_equipment (
        id, name, slug, sort_order, aktiv
      )
    `)
    .eq('slug', slug)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/**
 * Get all service types (optionally filtered by template)
 */
async function getAllServiceTypes(templateId = null) {
  let query = getClient()
    .from('template_service_types')
    .select(`
      *,
      template_subtypes (
        id, name, slug, default_interval_months, sort_order, aktiv
      ),
      template_equipment (
        id, name, slug, sort_order, aktiv
      )
    `)
    .eq('aktiv', true)
    .order('sort_order');

  if (templateId) {
    query = query.eq('template_id', templateId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Create customer services for a new or updated customer
 */
async function createOrUpdateCustomerServices(kundeId, servicesData) {
  // Use upsert (ON CONFLICT on unique(kunde_id, service_type_id)) — single DB call instead of N×(SELECT+UPDATE/INSERT)
  const rows = servicesData.map(s => ({
    kunde_id: kundeId,
    service_type_id: s.service_type_id,
    siste_kontroll: s.siste_kontroll || null,
    neste_kontroll: s.neste_kontroll || null,
    intervall_months: s.intervall_months || null,
    notater: s.notater || null,
    aktiv: true
  }));

  const { data, error } = await getClient()
    .from('customer_services')
    .upsert(rows, { onConflict: 'kunde_id,service_type_id' })
    .select();

  if (error) throw new Error(`Failed to upsert customer services (kunde_id=${kundeId}): ${error.message}`);
  return data || [];
}

/**
 * Deactivate customer services that are no longer selected
 */
async function deactivateCustomerServices(kundeId, activeServiceTypeIds) {
  // Empty array = no changes requested, preserve existing services
  if (!activeServiceTypeIds || activeServiceTypeIds.length === 0) {
    return;
  }

  // Deactivate services not in the active list
  const { error } = await getClient()
    .from('customer_services')
    .update({ aktiv: false })
    .eq('kunde_id', kundeId)
    .not('service_type_id', 'in', `(${activeServiceTypeIds.join(',')})`);

  if (error) throw error;
}

// ===== ONBOARDING =====

async function getOnboardingStatus(organizationId) {
  const { data, error } = await getClient()
    .from('organizations')
    .select('onboarding_stage, onboarding_completed, industry_template_id')
    .eq('id', organizationId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;

  return {
    stage: data.onboarding_stage || 'not_started',
    completed: !!data.onboarding_completed,
    industry_template_id: data.industry_template_id
  };
}

async function updateOnboardingStage(organizationId, stage, additionalData = {}) {
  const updateFields = {
    onboarding_stage: stage
  };

  if (additionalData.onboarding_completed !== undefined) {
    updateFields.onboarding_completed = additionalData.onboarding_completed;
  }
  if (additionalData.industry_template_id !== undefined) {
    updateFields.industry_template_id = additionalData.industry_template_id;
  }
  if (additionalData.company_address !== undefined) {
    updateFields.company_address = additionalData.company_address;
  }
  if (additionalData.company_postnummer !== undefined) {
    updateFields.company_postnummer = additionalData.company_postnummer;
  }
  if (additionalData.company_poststed !== undefined) {
    updateFields.company_poststed = additionalData.company_poststed;
  }
  if (additionalData.map_center_lat !== undefined) {
    updateFields.map_center_lat = additionalData.map_center_lat;
  }
  if (additionalData.map_center_lng !== undefined) {
    updateFields.map_center_lng = additionalData.map_center_lng;
  }
  if (additionalData.map_zoom !== undefined) {
    updateFields.map_zoom = additionalData.map_zoom;
  }
  if (additionalData.route_start_lat !== undefined) {
    updateFields.route_start_lat = additionalData.route_start_lat;
  }
  if (additionalData.route_start_lng !== undefined) {
    updateFields.route_start_lng = additionalData.route_start_lng;
  }

  const { data, error } = await getClient()
    .from('organizations')
    .update(updateFields)
    .eq('id', organizationId)
    .select();

  if (error) throw error;
  return data && data.length > 0;
}

async function completeOnboarding(organizationId) {
  // Directly update onboarding_completed without onboarding_stage (column may not exist)
  const { data, error } = await getClient()
    .from('organizations')
    .update({ onboarding_completed: true })
    .eq('id', organizationId)
    .select();

  if (error) throw error;
  return data && data.length > 0;
}

export {
  getClient,
  // Kunder
  getAllKunder,
  getKundeById,
  createKunde,
  updateKunde,
  deleteKunde,
  getKunderByOmrade,
  getKontrollVarsler,
  getOmrader,
  bulkImportKunder,
  // Kunder with dynamic services
  getAllKunderWithServices,
  getKundeByIdWithServices,
  getKontrollVarslerDynamic,
  // Ruter
  getAllRuter,
  getRuteById,
  createRute,
  updateRute,
  deleteRute,
  completeRute,
  // Email
  getEmailInnstillinger,
  updateEmailInnstillinger,
  getEmailHistorikk,
  getEmailStats,
  getUpcomingEmails,
  insertEmailVarsel,
  logEmailReminder,
  // Klient
  getKlientByEpost,
  getKlientById,
  getAllKlienter,
  createKlient,
  updateKlientLastLogin,
  // Brukere (admin)
  getBrukerByEpost,
  getBrukerById,
  updateBrukerLastLogin,
  // Refresh Tokens
  storeRefreshToken,
  getRefreshTokenRecord,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  // Avtaler
  getAllAvtaler,
  getAvtalerByDateRange,
  getAvtaleById,
  createAvtale,
  updateAvtale,
  deleteAvtale,
  deleteAvtaleSeries,
  deleteAvtalerByRuteId,
  completeAvtale,
  // Kontaktlogg
  getKontaktloggByKunde,
  createKontaktlogg,
  deleteKontaktlogg,
  // Login logg
  logLogin,
  getLoginLogg,
  getLoginLoggCount,
  getLoginStats,
  // Organizations (Multi-tenancy)
  getOrganizationById,
  getOrganizationBySlug,
  getAllOrganizations,
  getKundeCountForOrganization,
  getBrukerCountForOrganization,
  getKlienterForOrganization,
  getGlobalStatistics,
  createOrganization,
  updateOrganization,
  // Tenant-filtered queries
  getAllKunderByTenant,
  getKundeByIdAndTenant,
  getRuterByTenant,
  getAvtalerByTenant,
  // Industry Templates (Multi-Industry)
  getAllIndustryTemplates,
  getIndustryTemplateById,
  getIndustryTemplateBySlug,
  getServiceTypesByTemplate,
  getIntervalsByTemplate,
  getFullIndustryConfig,
  // Customer Services (basic)
  getCustomerServices,
  upsertCustomerService,
  deleteCustomerService,
  getCustomerServicesWithUpcoming,
  // Customer Services (dynamic system)
  completeCustomerService,
  bulkCompleteServices,
  getServiceTypeBySlug,
  getAllServiceTypes,
  createOrUpdateCustomerServices,
  deactivateCustomerServices,
  // Onboarding
  getOnboardingStatus,
  updateOnboardingStage,
  completeOnboarding
};

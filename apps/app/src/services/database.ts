/**
 * Database service abstraction
 * Supports both SQLite and Supabase backends
 *
 * Method implementations are organized in domain-specific files under ./database/:
 *   - customer-queries.ts      — Customer CRUD, services, search, bulk operations
 *   - auth-queries.ts          — Authentication, tokens, sessions, users
 *   - route-calendar-queries.ts — Routes, visits, calendar events
 *   - integration-queries.ts   — Integrations, API keys, webhooks, mapping cache
 *   - admin-queries.ts         — Organizations, stats, reports, features, service types
 *   - communication-queries.ts — Email, chat, EKK, Outlook
 *   - org-setup-queries.ts     — Team, onboarding, subcategories, coverage areas
 */

import { dbLogger } from './logger';
import { getConfig } from '../config/env';
import type { Kunde, Organization, Rute, Avtale, Kontaktlogg, EmailInnstilling, EmailVarsel, OrganizationServiceType } from '../types';
import type { DatabaseContext } from './database/types';
import * as customerQueries from './database/customer-queries';
import * as authQueries from './database/auth-queries';
import * as routeCalendarQueries from './database/route-calendar-queries';
import * as integrationQueries from './database/integration-queries';
import * as adminQueries from './database/admin-queries';
import * as communicationQueries from './database/communication-queries';
import * as orgSetupQueries from './database/org-setup-queries';
import * as ukeplanNotaterQueries from './database/ukeplan-notater-queries';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Database types
type DatabaseType = 'sqlite' | 'supabase';

// SQLite database type (better-sqlite3)
type SqliteDatabase = {
  prepare(sql: string): {
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  close(): void;
};

// Supabase client type for direct queries
interface SupabaseClient {
  from(table: string): {
    select(columns?: string, options?: Record<string, any>): any;
    insert(data: any): any;
    upsert(data: any, options?: Record<string, any>): any;
    update(data: any): any;
    delete(options?: { count?: string }): any;
  };
  rpc(fn: string, params?: any): Promise<any>;
}

// Supabase service interface
interface SupabaseService {
  getClient(): SupabaseClient;
  getAllKunder(): Promise<Kunde[]>;
  getAllKunderByTenant(organizationId: number): Promise<Kunde[]>;
  getKundeById(id: number): Promise<Kunde | null>;
  getKundeByIdAndTenant(id: number, organizationId: number): Promise<Kunde | null>;
  createKunde(data: Partial<Kunde>): Promise<Kunde>;
  updateKunde(id: number, data: Partial<Kunde>, organizationId?: number): Promise<Kunde | null>;
  deleteKunde(id: number, organizationId?: number): Promise<boolean>;
  getKontrollVarsler(dager: number, organizationId?: number): Promise<Kunde[]>;
  getKunderByOmrade(omrade: string, organizationId?: number): Promise<Kunde[]>;

  getKlientByEpost(epost: string): Promise<KlientRecord | null>;
  getBrukerByEpost(epost: string): Promise<BrukerRecord | null>;
  getBrukerById(id: number): Promise<BrukerRecord | null>;
  updateKlientLastLogin(id: number): Promise<void>;
  updateBrukerLastLogin(id: number): Promise<void>;
  getOrganizationById(id: number): Promise<Organization | null>;

  // Organization management (super admin)
  getAllOrganizations(): Promise<Organization[]>;
  getKundeCountForOrganization(organizationId: number): Promise<number>;
  getBrukerCountForOrganization(organizationId: number): Promise<number>;
  getKlienterForOrganization(organizationId: number): Promise<KlientRecord[]>;
  updateOrganization(id: number, data: Partial<Organization>): Promise<Organization | null>;
  getGlobalStatistics(): Promise<{ totalOrganizations: number; totalKunder: number; totalUsers: number; activeSubscriptions: number; organizationsByPlan?: Record<string, number> }>;

  // Avtaler methods
  getAllAvtaler(): Promise<unknown[]>;
  getAvtalerByTenant(organizationId: number, start?: string, end?: string): Promise<unknown[]>;
  getAvtaleById(id: number): Promise<Record<string, unknown> | null>;
  createAvtale(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateAvtale(id: number, data: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  deleteAvtale(id: number): Promise<unknown>;
  deleteAvtaleSeries(parentId: number, organizationId: number): Promise<number>;
  deleteAvtalerByRuteId(ruteId: number, organizationId: number): Promise<number>;
  completeAvtale(id: number, completionData: Record<string, unknown>): Promise<unknown>;

  // Onboarding methods
  getOnboardingStatus(organizationId: number): Promise<{
    stage: string;
    completed: boolean;
    industry_template_id: number | null;
  } | null>;
  updateOnboardingStage(organizationId: number, stage: string, additionalData?: Record<string, unknown>): Promise<boolean>;
  completeOnboarding(organizationId: number): Promise<boolean>;

  // Customer services (dynamic per-service-type dates)
  getAllKunderWithServices(organizationId: number): Promise<Kunde[]>;
  getKundeByIdWithServices(id: number, organizationId: number): Promise<Kunde | null>;
  createOrUpdateCustomerServices(kundeId: number, servicesData: Array<{
    service_type_id: number;
    siste_kontroll?: string | null;
    neste_kontroll?: string | null;
    intervall_months?: number | null;
    subtype_id?: number | null;
    equipment_type_id?: number | null;
    driftstype?: string | null;
    notater?: string | null;
  }>): Promise<unknown[]>;
  deactivateCustomerServices(kundeId: number, activeServiceTypeIds: number[]): Promise<void>;

  // Ruter (routes)
  getAllRuter(organizationId: number): Promise<(Rute & { antall_kunder: number })[]>;
  getRuteById(id: number): Promise<(Rute & { kunder?: (Kunde & { rekkefolge: number })[] }) | null>;
  createRute(data: Partial<Rute> & { kunde_ids?: number[] }): Promise<Rute>;
  updateRute(id: number, data: Partial<Rute> & { kunde_ids?: number[] }): Promise<Rute | null>;
  deleteRute(id: number): Promise<{ success: boolean }>;
  completeRute(id: number, dato: string): Promise<{ success: boolean; oppdaterte_kunder: number }>;

  // Kontaktlogg
  getKontaktloggByKunde(kundeId: number, organizationId: number): Promise<Kontaktlogg[]>;
  createKontaktlogg(data: Partial<Kontaktlogg> & { kunde_id: number; organization_id?: number }): Promise<Kontaktlogg>;
  deleteKontaktlogg(id: number): Promise<{ success: boolean }>;

  // Email
  getEmailInnstillinger(kundeId: number): Promise<EmailInnstilling | null>;
  updateEmailInnstillinger(kundeId: number, data: Partial<EmailInnstilling>): Promise<void>;
  getEmailHistorikk(organizationId: number, kundeId?: number | null, limit?: number): Promise<EmailVarsel[]>;
  getEmailStats(organizationId: number): Promise<{ pending: number; sent: number; failed: number }>;
  getUpcomingEmails(organizationId: number, daysAhead: number): Promise<(Kunde & { dager_til_kontroll: number })[]>;
}

interface KlientRecord {
  id: number;
  navn: string;
  epost: string;
  passord_hash: string;
  telefon?: string;
  adresse?: string;
  postnummer?: string;
  poststed?: string;
  rolle?: string;
  organization_id?: number;
  aktiv: boolean;
  sist_innlogget?: string;
  opprettet?: string;
}

interface BrukerRecord {
  id: number;
  navn: string;
  epost: string;
  passord_hash: string;
  rolle?: string;
  organization_id?: number;
  aktiv: boolean;
  is_super_admin?: boolean;
}

interface RefreshTokenRecord {
  id: number;
  token_hash: string;
  user_id: number;
  user_type: 'klient' | 'bruker';
  device_info?: string;
  ip_address?: string;
  expires_at: string;
  created_at: string;
  revoked_at?: string;
  replaced_by?: string;
}

// Database service singleton
class DatabaseService implements DatabaseContext {
  type: DatabaseType;
  sqlite: SqliteDatabase | null = null;
  supabase: SupabaseService | null = null;

  constructor() {
    const config = getConfig();
    this.type = config.DATABASE_TYPE;

    dbLogger.info({ type: this.type }, 'Initializing database service');
  }

  /**
   * Validate that organizationId is provided and valid for tenant-scoped operations.
   * This prevents unauthorized cross-tenant data access.
   * @throws Error if organizationId is missing or invalid
   */
  validateTenantContext(organizationId: number | undefined, operation: string): asserts organizationId is number {
    if (organizationId === undefined || organizationId === null) {
      dbLogger.error({ operation }, 'SECURITY: Tenant context missing - operation blocked');
      throw new Error(`Organization ID is required for ${operation}`);
    }
    if (typeof organizationId !== 'number' || organizationId <= 0 || !Number.isInteger(organizationId)) {
      dbLogger.error({ operation, organizationId }, 'SECURITY: Invalid organization ID - operation blocked');
      throw new Error(`Invalid organization ID for ${operation}`);
    }
  }

  /**
   * Initialize the database connection
   */
  async init(): Promise<void> {
    if (this.type === 'supabase') {
      // Dynamic import for Supabase service (JS module without types)
      const supabaseModule = await import('../../supabase-service.js') as unknown as SupabaseService;
      this.supabase = supabaseModule;
      dbLogger.info('Supabase service loaded');
    } else {
      // Dynamic import for SQLite
      const Database = (await import('better-sqlite3')).default;
      const dbPath = process.env.DATABASE_PATH || './kunder.db';
      this.sqlite = new Database(dbPath) as unknown as SqliteDatabase;
      dbLogger.info({ path: dbPath }, 'SQLite database loaded');

      // Initialize tables
      this.initSqliteTables();
    }
  }

  /**
   * Initialize SQLite tables
   */
  private initSqliteTables(): void {
    if (!this.sqlite) return;

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kunder (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        navn TEXT NOT NULL,
        adresse TEXT NOT NULL,
        postnummer TEXT,
        poststed TEXT,
        telefon TEXT,
        epost TEXT,
        lat REAL,
        lng REAL,
        siste_kontroll DATE,
        neste_kontroll DATE,
        kontroll_intervall_mnd INTEGER DEFAULT 12,
        notater TEXT,
        kategori TEXT,
        el_type TEXT,
        brann_system TEXT,
        brann_driftstype TEXT,
        siste_el_kontroll DATE,
        neste_el_kontroll DATE,
        el_kontroll_intervall INTEGER DEFAULT 36,
        siste_brann_kontroll DATE,
        neste_brann_kontroll DATE,
        brann_kontroll_intervall INTEGER DEFAULT 12,
        organization_id INTEGER,
        opprettet DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS klient (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        navn TEXT NOT NULL,
        epost TEXT NOT NULL UNIQUE,
        passord_hash TEXT NOT NULL,
        telefon TEXT,
        adresse TEXT,
        postnummer TEXT,
        poststed TEXT,
        rolle TEXT DEFAULT 'klient',
        organization_id INTEGER,
        aktiv INTEGER DEFAULT 1,
        sist_innlogget DATETIME,
        opprettet DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS login_logg (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        epost TEXT NOT NULL,
        bruker_navn TEXT,
        bruker_type TEXT,
        status TEXT NOT NULL,
        ip_adresse TEXT,
        user_agent TEXT,
        feil_melding TEXT,
        tidspunkt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        navn TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        logo_url TEXT,
        primary_color TEXT,
        secondary_color TEXT,
        brand_title TEXT,
        brand_subtitle TEXT,
        plan_type TEXT DEFAULT 'standard',
        max_kunder INTEGER DEFAULT 200,
        max_brukere INTEGER DEFAULT 5,
        aktiv INTEGER DEFAULT 1,
        onboarding_stage TEXT DEFAULT 'not_started',
        onboarding_completed INTEGER DEFAULT 0,
        industry_template_id INTEGER,
        map_center_lat REAL,
        map_center_lng REAL,
        map_zoom INTEGER DEFAULT 10,
        route_start_lat REAL,
        route_start_lng REAL,
        company_address TEXT,
        company_postnummer TEXT,
        company_poststed TEXT,
        opprettet DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: Add new columns to existing organizations table
    try {
      this.sqlite.exec(`ALTER TABLE organizations ADD COLUMN onboarding_stage TEXT DEFAULT 'not_started'`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE organizations ADD COLUMN onboarding_completed INTEGER DEFAULT 0`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE organizations ADD COLUMN industry_template_id INTEGER`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE organizations ADD COLUMN map_zoom INTEGER DEFAULT 10`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE organizations ADD COLUMN route_start_lat REAL`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE organizations ADD COLUMN route_start_lng REAL`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE organizations ADD COLUMN company_address TEXT`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE organizations ADD COLUMN company_postnummer TEXT`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE organizations ADD COLUMN company_poststed TEXT`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE organizations ADD COLUMN app_mode TEXT DEFAULT 'mvp'`);
    } catch { /* Column may already exist */ }

    // Ruter tables
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ruter (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        navn TEXT NOT NULL,
        beskrivelse TEXT,
        planlagt_dato DATE,
        total_distanse REAL,
        total_tid INTEGER,
        status TEXT DEFAULT 'planlagt',
        organization_id INTEGER,
        opprettet DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS rute_kunder (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rute_id INTEGER NOT NULL,
        kunde_id INTEGER NOT NULL,
        rekkefolge INTEGER,
        organization_id INTEGER,
        FOREIGN KEY (rute_id) REFERENCES ruter(id) ON DELETE CASCADE,
        FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE
      )
    `);

    // Avtaler table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS avtaler (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kunde_id INTEGER,
        dato DATE NOT NULL,
        klokkeslett TEXT,
        type TEXT,
        beskrivelse TEXT,
        status TEXT DEFAULT 'planlagt',
        opprettet_av TEXT,
        organization_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE
      )
    `);

    // Kontaktlogg table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kontaktlogg (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kunde_id INTEGER NOT NULL,
        dato DATETIME DEFAULT CURRENT_TIMESTAMP,
        type TEXT DEFAULT 'Telefonsamtale',
        notat TEXT,
        opprettet_av TEXT,
        organization_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE
      )
    `);

    // Email tables
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS email_innstillinger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kunde_id INTEGER UNIQUE NOT NULL,
        email_aktiv INTEGER DEFAULT 1,
        forste_varsel_dager INTEGER DEFAULT 30,
        paaminnelse_etter_dager INTEGER DEFAULT 7,
        FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS email_varsler (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kunde_id INTEGER,
        epost TEXT,
        emne TEXT,
        melding TEXT,
        type TEXT,
        status TEXT DEFAULT 'pending',
        sendt_dato DATETIME,
        feil_melding TEXT,
        opprettet DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE
      )
    `);

    // Refresh tokens table for JWT refresh token flow
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        user_type TEXT NOT NULL,
        device_info TEXT,
        ip_address TEXT,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME,
        replaced_by TEXT
      )
    `);

    // Create index for faster token lookups
    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash)
    `);

    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, user_type)
    `);

    // Token blacklist table for persisted logout tokens
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS token_blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jti TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        user_type TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reason TEXT DEFAULT 'logout'
      )
    `);

    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_token_blacklist_jti ON token_blacklist(jti)
    `);

    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at)
    `);

    // Organization fields tables (for dynamic custom fields)
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS organization_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL,
        field_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        field_type TEXT DEFAULT 'text',
        is_filterable INTEGER DEFAULT 0,
        is_required INTEGER DEFAULT 0,
        is_visible INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, field_name)
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS organization_field_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        field_id INTEGER NOT NULL REFERENCES organization_fields(id) ON DELETE CASCADE,
        value TEXT NOT NULL,
        display_name TEXT,
        color TEXT,
        icon TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(field_id, value)
      )
    `);

    // Mapping cache table for Excel import column mapping
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS mapping_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL,
        excel_header TEXT NOT NULL,
        normalized_header TEXT NOT NULL,
        target_field TEXT NOT NULL,
        field_type TEXT DEFAULT 'standard',
        data_type TEXT,
        confidence REAL DEFAULT 0.5,
        usage_count INTEGER DEFAULT 1,
        confirmed_by_user INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, excel_header)
      )
    `);

    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_mapping_cache_org ON mapping_cache(organization_id);
      CREATE INDEX IF NOT EXISTS idx_mapping_cache_normalized ON mapping_cache(organization_id, normalized_header);
    `);

    // Add custom_data column to kunder table if it doesn't exist
    try {
      this.sqlite.exec(`ALTER TABLE kunder ADD COLUMN custom_data TEXT DEFAULT '{}'`);
    } catch { /* Column may already exist */ }

    // Add kontaktperson column to kunder table if it doesn't exist
    try {
      this.sqlite.exec(`ALTER TABLE kunder ADD COLUMN kontaktperson TEXT`);
    } catch { /* Column may already exist */ }

    // Add sync columns for Excel import re-import functionality
    try {
      this.sqlite.exec(`ALTER TABLE kunder ADD COLUMN external_id TEXT`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE kunder ADD COLUMN import_hash TEXT`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE kunder ADD COLUMN last_import_at DATETIME`);
    } catch { /* Column may already exist */ }

    // Performance indexes for multi-tenant queries
    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_kunder_org_id ON kunder(organization_id);
      CREATE INDEX IF NOT EXISTS idx_kunder_org_kategori ON kunder(organization_id, kategori);
      CREATE INDEX IF NOT EXISTS idx_kunder_org_poststed ON kunder(organization_id, poststed);
      CREATE INDEX IF NOT EXISTS idx_kunder_org_el_kontroll ON kunder(organization_id, neste_el_kontroll);
      CREATE INDEX IF NOT EXISTS idx_kunder_org_brann_kontroll ON kunder(organization_id, neste_brann_kontroll);
      CREATE INDEX IF NOT EXISTS idx_kunder_org_external_id ON kunder(organization_id, external_id);
      CREATE INDEX IF NOT EXISTS idx_kunder_org_navn_adresse ON kunder(organization_id, navn, adresse);
      CREATE INDEX IF NOT EXISTS idx_email_varsler_kunde ON email_varsler(kunde_id, type, status);
      CREATE INDEX IF NOT EXISTS idx_email_varsler_status ON email_varsler(status);
      CREATE INDEX IF NOT EXISTS idx_kontaktlogg_kunde_org ON kontaktlogg(kunde_id, organization_id);
      CREATE INDEX IF NOT EXISTS idx_ruter_org_id ON ruter(organization_id);
      CREATE INDEX IF NOT EXISTS idx_rute_kunder_rute ON rute_kunder(rute_id);
      CREATE INDEX IF NOT EXISTS idx_avtaler_org_id ON avtaler(organization_id);
      CREATE INDEX IF NOT EXISTS idx_avtaler_org_dato ON avtaler(organization_id, dato);
      CREATE INDEX IF NOT EXISTS idx_org_slug ON organizations(slug);
      CREATE INDEX IF NOT EXISTS idx_org_fields_org ON organization_fields(organization_id);
      CREATE INDEX IF NOT EXISTS idx_org_field_options_field ON organization_field_options(field_id);
    `);

    // Tag groups table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tag_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL,
        navn TEXT NOT NULL,
        farge TEXT NOT NULL DEFAULT '#3b82f6',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, navn),
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);

    // Subcategory tables (replaces old tags/kunde_tags)
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS service_type_subcat_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL,
        navn TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, navn),
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS service_type_subcategories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        navn TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_id, navn),
        FOREIGN KEY (group_id) REFERENCES service_type_subcat_groups(id) ON DELETE CASCADE
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kunde_subcategories (
        kunde_id INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        subcategory_id INTEGER NOT NULL,
        PRIMARY KEY (kunde_id, group_id),
        FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES service_type_subcat_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (subcategory_id) REFERENCES service_type_subcategories(id) ON DELETE CASCADE
      )
    `);

    // Kontaktpersoner table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kontaktpersoner (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kunde_id INTEGER NOT NULL,
        organization_id INTEGER NOT NULL,
        navn TEXT NOT NULL,
        rolle TEXT,
        telefon TEXT,
        epost TEXT,
        er_primaer INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);

    // Recurrence columns for avtaler (added if not present)
    try {
      this.sqlite.exec('ALTER TABLE avtaler ADD COLUMN er_gjentakelse INTEGER DEFAULT 0');
    } catch { /* column already exists */ }
    try {
      this.sqlite.exec('ALTER TABLE avtaler ADD COLUMN gjentakelse_regel TEXT');
    } catch { /* column already exists */ }
    try {
      this.sqlite.exec('ALTER TABLE avtaler ADD COLUMN gjentakelse_slutt TEXT');
    } catch { /* column already exists */ }
    try {
      this.sqlite.exec('ALTER TABLE avtaler ADD COLUMN original_avtale_id INTEGER REFERENCES avtaler(id) ON DELETE SET NULL');
    } catch { /* column already exists */ }

    // Status column for kunder
    try {
      this.sqlite.exec("ALTER TABLE kunder ADD COLUMN status TEXT DEFAULT 'aktiv'");
    } catch { /* column already exists */ }

    // Integration tables for external data sources
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS organization_integrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL,
        integration_id TEXT NOT NULL,
        credentials_encrypted TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        last_sync_at DATETIME,
        sync_frequency_hours INTEGER DEFAULT 24,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, integration_id),
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS integration_sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL,
        integration_id TEXT NOT NULL,
        sync_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_count INTEGER DEFAULT 0,
        updated_count INTEGER DEFAULT 0,
        unchanged_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        error_message TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);

    // Add external_source column to kunder for tracking where customers came from
    try {
      this.sqlite.exec(`ALTER TABLE kunder ADD COLUMN external_source TEXT`);
    } catch { /* Column may already exist */ }
    try {
      this.sqlite.exec(`ALTER TABLE kunder ADD COLUMN last_sync_at DATETIME`);
    } catch { /* Column may already exist */ }

    // Failed sync items for retry mechanism
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS failed_sync_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL,
        integration_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        external_source TEXT NOT NULL,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        status TEXT DEFAULT 'pending',
        last_attempt_at DATETIME,
        next_retry_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, integration_id, external_id),
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);

    // Active sessions table for session management
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS active_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        user_type TEXT NOT NULL CHECK (user_type IN ('klient', 'bruker')),
        jti TEXT NOT NULL UNIQUE,
        ip_address TEXT,
        user_agent TEXT,
        device_info TEXT,
        last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      )
    `);

    // Indexes for integration tables
    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_org_integrations_org ON organization_integrations(organization_id);
      CREATE INDEX IF NOT EXISTS idx_org_integrations_active ON organization_integrations(organization_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_sync_log_org ON integration_sync_log(organization_id, integration_id);
      CREATE INDEX IF NOT EXISTS idx_kunder_external_source ON kunder(organization_id, external_source, external_id);
      CREATE INDEX IF NOT EXISTS idx_failed_sync_org ON failed_sync_items(organization_id, integration_id);
      CREATE INDEX IF NOT EXISTS idx_failed_sync_status ON failed_sync_items(status, next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id, user_type);
      CREATE INDEX IF NOT EXISTS idx_active_sessions_jti ON active_sessions(jti);
      CREATE INDEX IF NOT EXISTS idx_active_sessions_expires ON active_sessions(expires_at);
    `);

    // Feature module tables
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS feature_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        default_enabled INTEGER DEFAULT 0,
        dependencies TEXT,
        config_schema TEXT,
        aktiv INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS organization_features (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL,
        feature_key TEXT NOT NULL,
        enabled INTEGER DEFAULT 0,
        config TEXT DEFAULT '{}',
        activated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, feature_key),
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (feature_key) REFERENCES feature_definitions(key) ON DELETE CASCADE
      )
    `);

    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_org_features_org ON organization_features(organization_id);
      CREATE INDEX IF NOT EXISTS idx_org_features_enabled ON organization_features(organization_id, feature_key);
    `);

    // Seed default features if empty
    const featureCount = this.sqlite.prepare('SELECT COUNT(*) as count FROM feature_definitions').get() as { count: number };
    if (featureCount.count === 0) {
      this.sqlite.exec(`
        INSERT INTO feature_definitions (key, name, description, category, default_enabled, sort_order) VALUES
          ('hover_tooltip', 'Hover-tooltip', 'Vis kundeinfo ved hover/trykk', 'kart', 1, 10),
          ('context_menu', 'Kontekstmeny', 'Hoyreklikk-meny på kartmarkorer', 'kart', 0, 20),
          ('lifecycle_colors', 'Livssyklus-fargekoding', 'Fargekoding basert på kundestatus', 'kart', 0, 30),
          ('tripletex_projects', 'Tripletex-prosjekter', 'Prosjekter i Tripletex fra kartet', 'integrasjon', 0, 40),
          ('field_work', 'Feltarbeid-modus', 'Ruter med kundebesok og materiell', 'feltarbeid', 0, 50),
          ('email_templates', 'E-postmaler', 'Send e-post med konfigurerbare maler', 'kommunikasjon', 0, 60)
      `);
    }

    dbLogger.info('SQLite tables initialized');
  }

  // ============ KUNDER METHODS (delegated to database/customer-queries.ts) ============

  async getAllKunder(organizationId: number): Promise<Kunde[]> {
    return customerQueries.getAllKunder(this, organizationId);
  }

  async getAllKunderPaginated(
    organizationId: number,
    options: { limit?: number; offset?: number; search?: string; kategori?: string; status?: string } = {}
  ): Promise<{ data: Kunde[]; total: number; limit: number; offset: number }> {
    return customerQueries.getAllKunderPaginated(this, organizationId, options);
  }

  async getKundeById(id: number, organizationId: number): Promise<Kunde | null> {
    return customerQueries.getKundeById(this, id, organizationId);
  }

  async createKunde(data: Partial<Kunde> & { custom_data?: string }): Promise<Kunde> {
    return customerQueries.createKunde(this, data);
  }

  async updateKunde(id: number, data: Partial<Kunde>, organizationId: number): Promise<Kunde | null> {
    return customerQueries.updateKunde(this, id, data, organizationId);
  }

  async deleteKunde(id: number, organizationId: number): Promise<boolean> {
    return customerQueries.deleteKunde(this, id, organizationId);
  }

  async saveCustomerServices(
    kundeId: number,
    services: Array<{
      service_type_id: number;
      service_type_slug?: string;
      siste_kontroll?: string | null;
      neste_kontroll?: string | null;
      intervall_months?: number | null;
    }>,
    organizationId: number
  ): Promise<void> {
    return customerQueries.saveCustomerServices(this, kundeId, services, organizationId);
  }

  async getKunderByOmrade(omrade: string, organizationId: number): Promise<Kunde[]> {
    return customerQueries.getKunderByOmrade(this, omrade, organizationId);
  }

  async getKontrollVarsler(dager: number, organizationId: number): Promise<Kunde[]> {
    return customerQueries.getKontrollVarsler(this, dager, organizationId, (id) => this.getOrganizationById(id));
  }

  async bulkCompleteKontroll(
    kundeIds: number[],
    type: 'el' | 'brann' | 'begge',
    dato: string,
    organizationId: number
  ): Promise<number> {
    return customerQueries.bulkCompleteKontroll(this, kundeIds, type, dato, organizationId);
  }

  async markVisited(
    kundeIds: number[],
    visitedDate: string,
    serviceTypeSlugs: string[],
    organizationId: number
  ): Promise<number> {
    return customerQueries.markVisited(this, kundeIds, visitedDate, serviceTypeSlugs, organizationId, (orgId) => this.getOrganizationServiceTypes(orgId));
  }


  // ============ AUTH METHODS (delegated to database/auth-queries.ts) ============

  async getKlientByEpost(epost: string): Promise<KlientRecord | null> {
    return authQueries.getKlientByEpost(this, epost);
  }

  async getBrukerByEpost(epost: string): Promise<BrukerRecord | null> {
    return authQueries.getBrukerByEpost(this, epost);
  }

  async getBrukerById(id: number): Promise<BrukerRecord | null> {
    return authQueries.getBrukerById(this, id);
  }

  async updateKlientLastLogin(id: number): Promise<void> {
    return authQueries.updateKlientLastLogin(this, id);
  }

  async updateBrukerLastLogin(id: number): Promise<void> {
    return authQueries.updateBrukerLastLogin(this, id);
  }

  async getOrganizationById(id: number): Promise<Organization | null> {
    return authQueries.getOrganizationById(this, id);
  }

  async getIndustryTemplateById(id: number): Promise<{ id: number; name: string; slug: string; icon?: string; color?: string; description?: string } | null> {
    return authQueries.getIndustryTemplateById(this, id);
  }

  /**
   * Get industry template with all service types, subtypes, and equipment
   * Used for AI column mapping context
   */
  async getIndustryTemplateWithServiceTypes(id: number): Promise<{
    id: number;
    name: string;
    slug: string;
    description?: string;
    serviceTypes: Array<{
      name: string;
      slug: string;
      description?: string;
      subtypes?: Array<{ name: string; slug: string }>;
      equipment?: Array<{ name: string; slug: string }>;
    }>;
  } | null> {
    return authQueries.getIndustryTemplateWithServiceTypes(this, id);
  }

  async logLoginAttempt(data: {
    epost: string;
    bruker_navn?: string;
    bruker_type?: string;
    status: string;
    ip_adresse: string;
    user_agent: string;
    feil_melding?: string;
  }): Promise<void> {
    return authQueries.logLoginAttempt(this, data);
  }

  // ============ ACCOUNT LOCKOUT METHODS ============

  async countRecentFailedLogins(epost: string, windowMinutes: number): Promise<number> {
    return authQueries.countRecentFailedLogins(this, epost, windowMinutes);
  }

  async recordLoginAttempt(epost: string, ipAddress: string, success: boolean): Promise<void> {
    return authQueries.recordLoginAttempt(this, epost, ipAddress, success);
  }

  // ============ REFRESH TOKEN METHODS ============

  async storeRefreshToken(data: {
    tokenHash: string;
    userId: number;
    userType: 'klient' | 'bruker';
    deviceInfo?: string;
    ipAddress?: string;
    expiresAt: Date;
  }): Promise<void> {
    return authQueries.storeRefreshToken(this, data);
  }

  async getRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return authQueries.getRefreshToken(this, tokenHash);
  }

  async revokeRefreshToken(tokenHash: string, replacedBy?: string): Promise<boolean> {
    return authQueries.revokeRefreshToken(this, tokenHash, replacedBy);
  }

  async revokeAllUserRefreshTokens(userId: number, userType: 'klient' | 'bruker'): Promise<number> {
    return authQueries.revokeAllUserRefreshTokens(this, userId, userType);
  }

  async cleanupExpiredRefreshTokens(): Promise<number> {
    return authQueries.cleanupExpiredRefreshTokens(this);
  }

  async isRefreshTokenRevoked(tokenHash: string): Promise<boolean> {
    return authQueries.isRefreshTokenRevoked(this, tokenHash);
  }

  async detectRefreshTokenReuse(tokenHash: string): Promise<boolean> {
    return authQueries.detectRefreshTokenReuse(this, tokenHash);
  }

  async getActiveRefreshTokenCount(userId: number, userType: 'klient' | 'bruker'): Promise<number> {
    return authQueries.getActiveRefreshTokenCount(this, userId, userType);
  }

  // ============ TOKEN BLACKLIST METHODS ============

  async addToTokenBlacklist(data: {
    jti: string;
    userId: number;
    userType: 'klient' | 'bruker';
    expiresAt: number;
    reason?: string;
  }): Promise<void> {
    return authQueries.addToTokenBlacklist(this, data);
  }

  async isTokenInBlacklist(jti: string): Promise<boolean> {
    return authQueries.isTokenInBlacklist(this, jti);
  }

  async cleanupExpiredBlacklistTokens(): Promise<number> {
    return authQueries.cleanupExpiredBlacklistTokens(this);
  }

  async getBlacklistStats(): Promise<{ total: number; expiredRemoved?: number }> {
    return authQueries.getBlacklistStats(this);
  }

  // ============ ORGANIZATION LIMITS ============

  /**
   * Counts customers for an organization efficiently using COUNT(*)
   * PERFORMANCE: Uses COUNT(*) instead of loading all records
   */
  async countOrganizationKunder(organizationId: number): Promise<number> {
    return customerQueries.countOrganizationKunder(this, organizationId);
  }

  async getOrganizationLimits(organizationId: number): Promise<{ max_kunder: number; current_count: number } | null> {
    return customerQueries.getOrganizationLimits(this, organizationId, (id) => this.getOrganizationById(id));
  }

  async countOrganizationUsers(organizationId: number): Promise<number> {
    return orgSetupQueries.countOrganizationUsers(this, organizationId);
  }

  async getOrganizationUserLimits(organizationId: number): Promise<{ max_brukere: number; current_count: number } | null> {
    return orgSetupQueries.getOrganizationUserLimits(this, organizationId, (id) => this.getOrganizationById(id));
  }

  // ============ TEAM MEMBER METHODS (delegated to database/org-setup-queries.ts) ============

  async getTeamMembers(organizationId: number): Promise<KlientRecord[]> {
    return orgSetupQueries.getTeamMembers(this, organizationId);
  }

  async createTeamMember(data: {
    navn: string;
    epost: string;
    passord_hash: string;
    telefon?: string;
    rolle?: string;
    organization_id: number;
  }): Promise<KlientRecord> {
    return orgSetupQueries.createTeamMember(this, data);
  }

  async updateTeamMember(
    id: number,
    organizationId: number,
    data: { navn?: string; telefon?: string; rolle?: string; aktiv?: boolean }
  ): Promise<KlientRecord | null> {
    return orgSetupQueries.updateTeamMember(this, id, organizationId, data);
  }

  async deleteTeamMember(id: number, organizationId: number): Promise<boolean> {
    return orgSetupQueries.deleteTeamMember(this, id, organizationId);
  }

  async getTeamMemberByEpost(epost: string, organizationId: number): Promise<KlientRecord | null> {
    return orgSetupQueries.getTeamMemberByEpost(this, epost, organizationId);
  }

  // ============ ORGANIZATION FIELDS METHODS (delegated to database/org-setup-queries.ts) ============

  /**
   * Create multiple organization fields in bulk
   * Used during Excel import to create custom fields automatically
   */
  async createOrganizationFieldsBulk(
    organizationId: number,
    fields: Array<{
      field_name: string;
      display_name: string;
      field_type: string;
      is_filterable: boolean;
      is_visible: boolean;
      options?: string[];
    }>
  ): Promise<{ created: number; fieldIds: number[] }> {
    return orgSetupQueries.createOrganizationFieldsBulk(this, organizationId, fields);
  }

  // ============ ONBOARDING METHODS (delegated to database/org-setup-queries.ts) ============

  async getOnboardingStatus(organizationId: number): Promise<{
    stage: string;
    completed: boolean;
    industry_template_id: number | null;
  } | null> {
    return orgSetupQueries.getOnboardingStatus(this, organizationId);
  }

  async updateOnboardingStage(
    organizationId: number,
    stage: string,
    additionalData?: Partial<{
      onboarding_completed: boolean;
      industry_template_id: number;
      company_address: string;
      company_postnummer: string;
      company_poststed: string;
      map_center_lat: number;
      map_center_lng: number;
      map_zoom: number;
      route_start_lat: number;
      route_start_lng: number;
    }>
  ): Promise<boolean> {
    return orgSetupQueries.updateOnboardingStage(this, organizationId, stage, additionalData);
  }

  async completeOnboarding(organizationId: number): Promise<boolean> {
    return orgSetupQueries.completeOnboarding(this, organizationId);
  }

  // ============ RUTER METHODS (delegated to database/route-calendar-queries.ts) ============

  /**
   * Get all routes for an organization.
   * SECURITY: organizationId is required to prevent cross-tenant data access.
   */
  async getAllRuter(organizationId: number): Promise<(Rute & { antall_kunder: number })[]> {
    return routeCalendarQueries.getAllRuter(this, organizationId);
  }

  /**
   * Get a route assigned to a specific user for a given date.
   * Used by the "Today's Work" view for technicians.
   */
  async getRouteForUserByDate(userId: number, date: string, organizationId: number): Promise<Rute | null> {
    return routeCalendarQueries.getRouteForUserByDate(this, userId, date, organizationId);
  }

  /**
   * Get all routes for an organization on a given date, with technician info and execution status.
   * Used by the team overview endpoint.
   */
  async getRoutesForDateByOrg(date: string, organizationId: number): Promise<routeCalendarQueries.RouteWithStatus[]> {
    return routeCalendarQueries.getRoutesForDateByOrg(this, date, organizationId);
  }

  /**
   * Get all active team members for an organization.
   */
  async getActiveTeamMembersForOrg(organizationId: number): Promise<Array<{ id: number; navn: string }>> {
    return routeCalendarQueries.getActiveTeamMembersForOrg(this, organizationId);
  }

  /**
   * Get a route by ID.
   * SECURITY: organizationId is required to prevent cross-tenant data access.
   */
  async getRuteById(id: number, organizationId: number): Promise<Rute | null> {
    return routeCalendarQueries.getRuteById(this, id, organizationId);
  }

  async createRute(data: Partial<Rute> & { kunde_ids?: number[] }): Promise<Rute> {
    return routeCalendarQueries.createRute(this, data);
  }

  /**
   * Update a route.
   * SECURITY: organizationId is required to prevent cross-tenant data modification.
   */
  async updateRute(id: number, data: Partial<Rute>, organizationId: number): Promise<Rute | null> {
    return routeCalendarQueries.updateRute(this, id, data, organizationId);
  }

  /**
   * Delete a route.
   * SECURITY: organizationId is required to prevent cross-tenant data deletion.
   */
  async deleteRute(id: number, organizationId: number): Promise<boolean> {
    return routeCalendarQueries.deleteRute(this, id, organizationId);
  }

  async getRuteKunder(ruteId: number): Promise<(Kunde & { rekkefolge: number })[]> {
    return routeCalendarQueries.getRuteKunder(this, ruteId);
  }

  /**
   * Set customers for a route.
   * SECURITY: organizationId is required to prevent cross-tenant data modification.
   */
  async setRuteKunder(ruteId: number, kundeIds: number[], organizationId: number): Promise<void> {
    return routeCalendarQueries.setRuteKunder(this, ruteId, kundeIds, organizationId);
  }

  /**
   * Mark a route as complete.
   * SECURITY: organizationId is required to prevent cross-tenant data modification.
   */
  async completeRute(
    id: number,
    dato: string,
    kontrollType: 'el' | 'brann' | 'both',
    organizationId: number
  ): Promise<{ success: boolean; oppdaterte_kunder: number }> {
    return routeCalendarQueries.completeRute(this, id, dato, kontrollType, organizationId);
  }

  // ============ FIELD WORK VISIT METHODS (delegated to database/route-calendar-queries.ts) ============

  async createVisitRecords(ruteId: number, kundeIds: number[], organizationId: number): Promise<void> {
    return routeCalendarQueries.createVisitRecords(this, ruteId, kundeIds, organizationId);
  }

  async upsertVisitRecord(
    ruteId: number,
    kundeId: number,
    organizationId: number,
    data: { visited_at: string; completed: boolean; comment?: string; materials_used?: string[]; equipment_registered?: string[]; todos?: string[] }
  ): Promise<{ id: number }> {
    return routeCalendarQueries.upsertVisitRecord(this, ruteId, kundeId, organizationId, data);
  }

  async getVisitRecords(ruteId: number, organizationId: number): Promise<Array<{
    id: number; kunde_id: number; visited_at?: string; completed: boolean;
    comment?: string; materials_used?: string[]; equipment_registered?: string[]; todos?: string[];
  }>> {
    return routeCalendarQueries.getVisitRecords(this, ruteId, organizationId);
  }

  // ============ CUSTOMER EMAIL TEMPLATES (delegated to database/communication-queries.ts) ============

  async getEmailTemplates(organizationId: number): Promise<Array<{
    id: number; organization_id: number | null; name: string; subject_template: string;
    body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
  }>> {
    return communicationQueries.getEmailTemplates(this, organizationId);
  }

  async getEmailTemplateById(id: number, organizationId: number): Promise<{
    id: number; organization_id: number | null; name: string; subject_template: string;
    body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
  } | null> {
    return communicationQueries.getEmailTemplateById(this, id, organizationId);
  }

  async createEmailTemplate(data: {
    organization_id: number; name: string; subject_template: string;
    body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
  }): Promise<{
    id: number; organization_id: number | null; name: string; subject_template: string;
    body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
  }> {
    return communicationQueries.createEmailTemplate(this, data);
  }

  async updateEmailTemplate(id: number, data: Partial<{
    name: string; subject_template: string; body_template: string; category: string; aktiv: boolean;
  }>, organizationId: number): Promise<{
    id: number; organization_id: number | null; name: string; subject_template: string;
    body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
  } | null> {
    return communicationQueries.updateEmailTemplate(this, id, data, organizationId);
  }

  async deleteEmailTemplate(id: number, organizationId: number): Promise<boolean> {
    return communicationQueries.deleteEmailTemplate(this, id, organizationId);
  }

  async logSentEmail(data: {
    organization_id: number; kunde_id: number; template_id: number | null;
    to_email: string; subject: string; body_html: string; status: string;
    error_message: string | null; sent_by: number | null; sent_at: string;
  }): Promise<{
    id: number; organization_id: number; kunde_id: number; template_id: number | null;
    to_email: string; subject: string; body_html: string; status: string;
    error_message: string | null; sent_by: number | null; sent_at: string;
  }> {
    return communicationQueries.logSentEmail(this, data);
  }

  async getSentEmails(organizationId: number, kundeId?: number, limit = 50): Promise<Array<{
    id: number; organization_id: number; kunde_id: number; template_id: number | null;
    to_email: string; subject: string; body_html: string; status: string;
    error_message: string | null; sent_by: number | null; sent_at: string;
  }>> {
    return communicationQueries.getSentEmails(this, organizationId, kundeId, limit);
  }

  async getEnabledFeaturesWithConfig(organizationId: number): Promise<{ key: string; config: Record<string, unknown> }[]> {
    return adminQueries.getEnabledFeaturesWithConfig(this, organizationId);
  }

  // ============ EKK REPORTS (delegated to database/communication-queries.ts) ============

  async getEkkReports(organizationId: number, kundeId?: number): Promise<Array<Record<string, unknown>>> {
    return communicationQueries.getEkkReports(this, organizationId, kundeId);
  }

  async getEkkReportById(id: number, organizationId: number): Promise<Record<string, unknown> | null> {
    return communicationQueries.getEkkReportById(this, id, organizationId);
  }

  async createEkkReport(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return communicationQueries.createEkkReport(this, data);
  }

  async updateEkkReport(id: number, data: Record<string, unknown>, organizationId: number): Promise<Record<string, unknown> | null> {
    return communicationQueries.updateEkkReport(this, id, data, organizationId);
  }

  async deleteEkkReport(id: number, organizationId: number): Promise<boolean> {
    return communicationQueries.deleteEkkReport(this, id, organizationId);
  }

  // ============ OUTLOOK SYNC (delegated to database/communication-queries.ts) ============

  async getOutlookSyncEntries(organizationId: number): Promise<Array<Record<string, unknown>>> {
    return communicationQueries.getOutlookSyncEntries(this, organizationId);
  }

  async getOutlookSyncEntry(organizationId: number, kundeId: number): Promise<Record<string, unknown> | null> {
    return communicationQueries.getOutlookSyncEntry(this, organizationId, kundeId);
  }

  async upsertOutlookSyncEntry(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return communicationQueries.upsertOutlookSyncEntry(this, data);
  }

  // ============ AVTALER METHODS (delegated to database/route-calendar-queries.ts) ============

  async getAllAvtaler(organizationId: number, start?: string, end?: string): Promise<(Avtale & { kunde_navn?: string })[]> {
    return routeCalendarQueries.getAllAvtaler(this, organizationId, start, end);
  }

  async getAvtaleById(id: number, organizationId: number): Promise<(Avtale & { kunde_navn?: string }) | null> {
    return routeCalendarQueries.getAvtaleById(this, id, organizationId);
  }

  async createAvtale(data: Partial<Avtale> & { organization_id: number }): Promise<Avtale & { kunde_navn?: string }> {
    return routeCalendarQueries.createAvtale(this, data);
  }

  async deleteAvtalerByRuteId(ruteId: number, organizationId: number): Promise<number> {
    return routeCalendarQueries.deleteAvtalerByRuteId(this, ruteId, organizationId);
  }

  async updateAvtale(id: number, data: Partial<Avtale>, organizationId: number): Promise<(Avtale & { kunde_navn?: string }) | null> {
    return routeCalendarQueries.updateAvtale(this, id, data, organizationId);
  }

  async deleteAvtale(id: number, organizationId: number): Promise<boolean> {
    return routeCalendarQueries.deleteAvtale(this, id, organizationId);
  }

  async completeAvtale(id: number, organizationId: number): Promise<boolean> {
    return routeCalendarQueries.completeAvtale(this, id, organizationId);
  }

  async deleteAvtaleSeries(parentId: number, organizationId: number): Promise<number> {
    return routeCalendarQueries.deleteAvtaleSeries(this, parentId, organizationId);
  }

  // ============ KONTAKTLOGG METHODS (delegated to database/communication-queries.ts) ============

  async getKontaktloggByKunde(kundeId: number, organizationId: number): Promise<Kontaktlogg[]> {
    return communicationQueries.getKontaktloggByKunde(this, kundeId, organizationId);
  }

  async createKontaktlogg(data: Partial<Kontaktlogg> & { kunde_id: number; organization_id: number }): Promise<Kontaktlogg> {
    return communicationQueries.createKontaktlogg(this, data);
  }

  async deleteKontaktlogg(id: number, organizationId: number): Promise<boolean> {
    return communicationQueries.deleteKontaktlogg(this, id, organizationId);
  }

  // ============ EMAIL METHODS (delegated to database/communication-queries.ts) ============

  async getEmailInnstillinger(kundeId: number): Promise<EmailInnstilling | null> {
    return communicationQueries.getEmailInnstillinger(this, kundeId);
  }

  async updateEmailInnstillinger(kundeId: number, data: Partial<EmailInnstilling>): Promise<void> {
    return communicationQueries.updateEmailInnstillinger(this, kundeId, data);
  }

  async getEmailHistorikk(organizationId: number, kundeId?: number | null, limit = 100): Promise<EmailVarsel[]> {
    return communicationQueries.getEmailHistorikk(this, organizationId, kundeId, limit);
  }

  async getEmailStats(organizationId: number): Promise<{ pending: number; sent: number; failed: number }> {
    return communicationQueries.getEmailStats(this, organizationId);
  }

  async getUpcomingEmails(organizationId: number, daysAhead: number): Promise<(Kunde & { dager_til_kontroll: number })[]> {
    return communicationQueries.getUpcomingEmails(this, organizationId, daysAhead);
  }

  // ============ MAPPING CACHE METHODS (delegated to database/integration-queries.ts) ============

  /**
   * Get a cached mapping by exact header match
   */
  async getMappingCache(organizationId: number, excelHeader: string): Promise<{
    id: number;
    organizationId: number;
    excelHeader: string;
    normalizedHeader: string;
    targetField: string;
    fieldType: string;
    dataType: string | null;
    confidence: number;
    usageCount: number;
    confirmedByUser: boolean;
    createdAt: Date;
    lastUsedAt: Date;
  } | null> {
    return integrationQueries.getMappingCache(this, organizationId, excelHeader);
  }

  /**
   * Get a cached mapping by normalized header
   */
  async getMappingCacheByNormalized(organizationId: number, normalizedHeader: string): Promise<{
    id: number;
    organizationId: number;
    excelHeader: string;
    normalizedHeader: string;
    targetField: string;
    fieldType: string;
    dataType: string | null;
    confidence: number;
    usageCount: number;
    confirmedByUser: boolean;
    createdAt: Date;
    lastUsedAt: Date;
  } | null> {
    return integrationQueries.getMappingCacheByNormalized(this, organizationId, normalizedHeader);
  }

  /**
   * Get all cached mappings for an organization
   */
  async getAllMappingCache(organizationId: number): Promise<Array<{
    id: number;
    organizationId: number;
    excelHeader: string;
    normalizedHeader: string;
    targetField: string;
    fieldType: string;
    dataType: string | null;
    confidence: number;
    usageCount: number;
    confirmedByUser: boolean;
    createdAt: Date;
    lastUsedAt: Date;
  }>> {
    return integrationQueries.getAllMappingCache(this, organizationId);
  }

  /**
   * Create a new mapping cache entry
   */
  async createMappingCache(data: {
    organizationId: number;
    excelHeader: string;
    normalizedHeader: string;
    targetField: string;
    fieldType: string;
    dataType?: string;
    confidence?: number;
    usageCount?: number;
    confirmedByUser?: boolean;
  }): Promise<number> {
    return integrationQueries.createMappingCache(this, data);
  }

  /**
   * Update an existing mapping cache entry
   */
  async updateMappingCache(id: number, data: {
    targetField?: string;
    fieldType?: string;
    dataType?: string;
    confidence?: number;
    usageCount?: number;
    confirmedByUser?: boolean;
    lastUsedAt?: Date;
  }): Promise<boolean> {
    return integrationQueries.updateMappingCache(this, id, data);
  }

  /**
   * Delete old mapping cache entries
   */
  async deleteOldMappingCache(olderThan: Date, organizationId?: number): Promise<number> {
    return integrationQueries.deleteOldMappingCache(this, olderThan, organizationId);
  }

  // ============ INTEGRATION METHODS (delegated to database/integration-queries.ts) ============

  /**
   * Get all integrations for an organization
   */
  async getOrganizationIntegrations(organizationId: number): Promise<Array<{
    id: number;
    integration_id: string;
    is_active: boolean;
    last_sync_at: string | null;
    sync_frequency_hours: number;
  }>> {
    return integrationQueries.getOrganizationIntegrations(this, organizationId);
  }

  /**
   * Get integration credentials for an organization
   */
  async getIntegrationCredentials(
    organizationId: number,
    integrationId: string
  ): Promise<{ credentials_encrypted: string; is_active: boolean } | null> {
    return integrationQueries.getIntegrationCredentials(this, organizationId, integrationId);
  }

  /**
   * Save or update integration credentials
   */
  async saveIntegrationCredentials(
    organizationId: number,
    data: {
      integration_id: string;
      credentials_encrypted: string;
      is_active: boolean;
    }
  ): Promise<void> {
    return integrationQueries.saveIntegrationCredentials(this, organizationId, data);
  }

  /**
   * Update last sync time for an integration
   */
  async updateIntegrationLastSync(
    organizationId: number,
    integrationId: string,
    syncTime: Date
  ): Promise<void> {
    return integrationQueries.updateIntegrationLastSync(this, organizationId, integrationId, syncTime);
  }

  /**
   * Delete integration credentials
   */
  async deleteIntegrationCredentials(
    organizationId: number,
    integrationId: string
  ): Promise<void> {
    return integrationQueries.deleteIntegrationCredentials(this, organizationId, integrationId);
  }

  /**
   * Log an integration sync
   */
  async logIntegrationSync(
    organizationId: number,
    data: {
      integration_id: string;
      sync_type: 'manual' | 'scheduled';
      status: 'started' | 'completed' | 'failed';
      created_count?: number;
      updated_count?: number;
      unchanged_count?: number;
      failed_count?: number;
      error_message?: string;
      completed_at?: Date;
    }
  ): Promise<number> {
    return integrationQueries.logIntegrationSync(this, organizationId, data);
  }

  /**
   * Get customer by external ID (for sync)
   */
  async getKundeByExternalId(
    organizationId: number,
    externalSource: string,
    externalId: string
  ): Promise<Kunde | null> {
    return integrationQueries.getKundeByExternalId(this, organizationId, externalSource, externalId);
  }

  /**
   * Get all kunder with a specific external source (for preview comparison)
   */
  async getKunderByExternalSource(
    organizationId: number,
    externalSource: string
  ): Promise<Array<{ id: number; external_id: string }>> {
    return integrationQueries.getKunderByExternalSource(this, organizationId, externalSource);
  }

  // ============ FAILED SYNC ITEMS (RETRY) (delegated to database/integration-queries.ts) ============

  /**
   * Record a failed sync item for later retry.
   */
  async recordFailedSyncItem(
    organizationId: number,
    data: {
      integration_id: string;
      external_id: string;
      external_source: string;
      error_message: string;
    }
  ): Promise<void> {
    return integrationQueries.recordFailedSyncItem(this, organizationId, data);
  }

  /**
   * Mark a failed sync item as resolved (successfully synced on retry)
   */
  async resolveFailedSyncItem(
    organizationId: number,
    integrationId: string,
    externalId: string
  ): Promise<void> {
    return integrationQueries.resolveFailedSyncItem(this, organizationId, integrationId, externalId);
  }

  /**
   * Cleanup old resolved/permanently_failed items
   */
  async cleanupOldFailedSyncItems(daysOld: number = 30): Promise<number> {
    return integrationQueries.cleanupOldFailedSyncItems(this, daysOld);
  }

  /**
   * Get all active integrations that are due for a scheduled sync.
   * Cross-organization query — used only by the cron system.
   */
  async getAllDueIntegrations(): Promise<Array<{
    id: number;
    organization_id: number;
    integration_id: string;
    credentials_encrypted: string;
    is_active: boolean;
    last_sync_at: string | null;
    sync_frequency_hours: number;
  }>> {
    return integrationQueries.getAllDueIntegrations(this);
  }

  // ============ SUPER ADMIN METHODS (delegated to database/admin-queries.ts) ============

  /**
   * Get all organizations (for super admin)
   */
  async getAllOrganizations(): Promise<Organization[]> {
    return adminQueries.getAllOrganizations(this);
  }

  /**
   * Get customer count for an organization (for super admin)
   */
  async getKundeCountForOrganization(organizationId: number): Promise<number> {
    return adminQueries.getKundeCountForOrganization(this, organizationId);
  }

  /**
   * Get user (klient) count for an organization (for super admin)
   */
  async getBrukerCountForOrganization(organizationId: number): Promise<number> {
    return adminQueries.getBrukerCountForOrganization(this, organizationId);
  }

  /**
   * Update organization (for super admin)
   */
  async updateOrganization(id: number, data: Record<string, unknown>): Promise<Organization | null> {
    return adminQueries.updateOrganization(this, id, data);
  }

  /**
   * Delete organization and all related data (for super admin)
   */
  async deleteOrganization(id: number): Promise<boolean> {
    return adminQueries.deleteOrganization(this, id);
  }

  /**
   * Get all users (klienter) for an organization (for super admin)
   */
  async getKlienterForOrganization(organizationId: number): Promise<KlientRecord[]> {
    return adminQueries.getKlienterForOrganization(this, organizationId);
  }

  /**
   * Get global statistics (for super admin dashboard)
   */
  async getGlobalStatistics(): Promise<{
    totalOrganizations: number;
    totalCustomers: number;
    totalUsers: number;
    activeSubscriptions: number;
    organizationsByPlan: Record<string, number>;
  }> {
    return adminQueries.getGlobalStatistics(this);
  }

  // ============ API KEY METHODS (delegated to database/integration-queries.ts) ============

  /**
   * Create a new API key
   */
  async createApiKey(data: {
    organization_id: number;
    key_prefix: string;
    key_hash: string;
    name: string;
    description?: string;
    scopes: string[];
    expires_at?: string;
    monthly_quota?: number;
    rate_limit_requests?: number;
    rate_limit_window_seconds?: number;
    created_by: number;
  }): Promise<{
    id: number;
    organization_id: number;
    key_prefix: string;
    name: string;
    description?: string;
    scopes: string[];
    rate_limit_requests: number;
    rate_limit_window_seconds: number;
    monthly_quota?: number;
    quota_used_this_month: number;
    is_active: boolean;
    expires_at?: string;
    created_by: number;
    created_at: string;
  }> {
    return integrationQueries.createApiKey(this, data);
  }

  /**
   * Get an API key by its hash (for validation)
   */
  async getApiKeyByHash(keyHash: string): Promise<{
    id: number;
    organization_id: number;
    key_prefix: string;
    key_hash: string;
    name: string;
    scopes: string[];
    rate_limit_requests: number;
    rate_limit_window_seconds: number;
    is_active: boolean;
    expires_at?: string;
  } | null> {
    return integrationQueries.getApiKeyByHash(this, keyHash);
  }

  /**
   * Get an API key by ID (for admin management)
   */
  async getApiKeyById(id: number, organizationId: number): Promise<{
    id: number;
    organization_id: number;
    key_prefix: string;
    name: string;
    description?: string;
    scopes: string[];
    rate_limit_requests: number;
    rate_limit_window_seconds: number;
    monthly_quota?: number;
    quota_used_this_month: number;
    is_active: boolean;
    last_used_at?: string;
    expires_at?: string;
    created_by: number;
    created_at: string;
    revoked_at?: string;
  } | null> {
    return integrationQueries.getApiKeyById(this, id, organizationId);
  }

  /**
   * Get all API keys for an organization (without hashes)
   */
  async getOrganizationApiKeys(organizationId: number): Promise<Array<{
    id: number;
    organization_id: number;
    key_prefix: string;
    name: string;
    description?: string;
    scopes: string[];
    rate_limit_requests: number;
    rate_limit_window_seconds: number;
    monthly_quota?: number;
    quota_used_this_month: number;
    is_active: boolean;
    last_used_at?: string;
    expires_at?: string;
    created_by: number;
    created_at: string;
    revoked_at?: string;
  }>> {
    return integrationQueries.getOrganizationApiKeys(this, organizationId);
  }

  /**
   * Update last used timestamp for an API key
   */
  async updateApiKeyLastUsed(id: number): Promise<void> {
    return integrationQueries.updateApiKeyLastUsed(this, id);
  }

  async incrementApiKeyQuotaUsed(id: number): Promise<void> {
    return integrationQueries.incrementApiKeyQuotaUsed(this, id);
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(id: number, organizationId: number, revokedBy: number, reason?: string): Promise<boolean> {
    return integrationQueries.revokeApiKey(this, id, organizationId, revokedBy, reason);
  }

  /**
   * Log API key usage
   */
  async logApiKeyUsage(data: {
    api_key_id: number;
    organization_id: number;
    endpoint: string;
    method: string;
    status_code: number;
    response_time_ms?: number;
    ip_address?: string;
    user_agent?: string;
  }): Promise<void> {
    return integrationQueries.logApiKeyUsage(this, data);
  }

  /**
   * Get API key usage statistics
   */
  async getApiKeyUsageStats(apiKeyId: number, organizationId: number, days: number): Promise<{
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    avg_response_time_ms: number;
    requests_by_endpoint: Record<string, number>;
    requests_by_day: Array<{ date: string; count: number }>;
  }> {
    return integrationQueries.getApiKeyUsageStats(this, apiKeyId, organizationId, days);
  }

  // ============ Webhook Operations (delegated to database/integration-queries.ts) ============

  /**
   * Create a new webhook endpoint
   */
  async createWebhookEndpoint(data: {
    organization_id: number;
    url: string;
    name: string;
    description?: string;
    events: string[];
    secret_hash: string;
    created_by: number;
  }): Promise<{
    id: number;
    organization_id: number;
    url: string;
    name: string;
    description?: string;
    events: string[];
    is_active: boolean;
    failure_count: number;
    last_failure_at?: string;
    last_success_at?: string;
    disabled_at?: string;
    disabled_reason?: string;
    created_by: number;
    created_at: string;
    updated_at: string;
  }> {
    return integrationQueries.createWebhookEndpoint(this, data);
  }

  /**
   * Get all webhooks for an organization
   */
  async getOrganizationWebhooks(organizationId: number): Promise<Array<{
    id: number;
    organization_id: number;
    url: string;
    name: string;
    description?: string;
    events: string[];
    is_active: boolean;
    failure_count: number;
    last_failure_at?: string;
    last_success_at?: string;
    disabled_at?: string;
    disabled_reason?: string;
    created_by: number;
    created_at: string;
    updated_at: string;
  }>> {
    return integrationQueries.getOrganizationWebhooks(this, organizationId);
  }

  /**
   * Get a specific webhook by ID
   */
  async getWebhookEndpointById(id: number, organizationId: number): Promise<{
    id: number;
    organization_id: number;
    url: string;
    name: string;
    description?: string;
    events: string[];
    is_active: boolean;
    failure_count: number;
    last_failure_at?: string;
    last_success_at?: string;
    disabled_at?: string;
    disabled_reason?: string;
    created_by: number;
    created_at: string;
    updated_at: string;
  } | null> {
    return integrationQueries.getWebhookEndpointById(this, id, organizationId);
  }

  /**
   * Get webhook with secret hash (for delivery signing)
   */
  async getWebhookEndpointWithSecret(id: number): Promise<{
    id: number;
    organization_id: number;
    url: string;
    name: string;
    description?: string;
    events: string[];
    is_active: boolean;
    failure_count: number;
    secret_hash: string;
    created_by: number;
    created_at: string;
    updated_at: string;
  } | null> {
    return integrationQueries.getWebhookEndpointWithSecret(this, id);
  }

  /**
   * Get active webhooks that subscribe to an event type
   */
  async getActiveWebhookEndpointsForEvent(organizationId: number, eventType: string): Promise<Array<{
    id: number;
    organization_id: number;
    url: string;
    name: string;
    events: string[];
    is_active: boolean;
    failure_count: number;
    created_by: number;
    created_at: string;
    updated_at: string;
  }>> {
    return integrationQueries.getActiveWebhookEndpointsForEvent(this, organizationId, eventType);
  }

  /**
   * Update a webhook endpoint
   */
  async updateWebhookEndpoint(
    id: number,
    organizationId: number,
    data: { url?: string; name?: string; description?: string; events?: string[]; is_active?: boolean }
  ): Promise<{
    id: number;
    organization_id: number;
    url: string;
    name: string;
    description?: string;
    events: string[];
    is_active: boolean;
    failure_count: number;
    created_by: number;
    created_at: string;
    updated_at: string;
  } | null> {
    return integrationQueries.updateWebhookEndpoint(this, id, organizationId, data);
  }

  /**
   * Update webhook secret
   */
  async updateWebhookSecret(id: number, organizationId: number, secretHash: string): Promise<boolean> {
    return integrationQueries.updateWebhookSecret(this, id, organizationId, secretHash);
  }

  /**
   * Delete a webhook endpoint
   */
  async deleteWebhookEndpoint(id: number, organizationId: number): Promise<boolean> {
    return integrationQueries.deleteWebhookEndpoint(this, id, organizationId);
  }

  /**
   * Disable a webhook endpoint
   */
  async disableWebhookEndpoint(id: number, reason: string): Promise<boolean> {
    return integrationQueries.disableWebhookEndpoint(this, id, reason);
  }

  /**
   * Record successful webhook delivery
   */
  async recordWebhookSuccess(id: number): Promise<void> {
    return integrationQueries.recordWebhookSuccess(this, id);
  }

  /**
   * Record failed webhook delivery
   */
  async recordWebhookFailure(id: number): Promise<void> {
    return integrationQueries.recordWebhookFailure(this, id);
  }

  // ============ Webhook Delivery Operations (delegated to database/integration-queries.ts) ============

  /**
   * Create a webhook delivery record
   */
  async createWebhookDelivery(data: {
    webhook_endpoint_id: number;
    organization_id: number;
    event_type: string;
    event_id: string;
    payload: unknown;
  }): Promise<{
    id: number;
    webhook_endpoint_id: number;
    organization_id: number;
    event_type: string;
    event_id: string;
    payload: unknown;
    status: string;
    attempt_count: number;
    max_attempts: number;
    created_at: string;
  }> {
    return integrationQueries.createWebhookDelivery(this, data);
  }

  /**
   * Get pending webhook deliveries for processing
   */
  async getPendingWebhookDeliveries(): Promise<Array<{
    id: number;
    webhook_endpoint_id: number;
    organization_id: number;
    event_type: string;
    event_id: string;
    payload: unknown;
    status: string;
    attempt_count: number;
    max_attempts: number;
    next_retry_at?: string;
    created_at: string;
  }>> {
    return integrationQueries.getPendingWebhookDeliveries(this);
  }

  /**
   * Get a specific webhook delivery
   */
  async getWebhookDeliveryById(id: number, organizationId: number): Promise<{
    id: number;
    webhook_endpoint_id: number;
    organization_id: number;
    event_type: string;
    event_id: string;
    payload: unknown;
    status: string;
    attempt_count: number;
    max_attempts: number;
    next_retry_at?: string;
    response_status?: number;
    response_body?: string;
    response_time_ms?: number;
    error_message?: string;
    created_at: string;
    delivered_at?: string;
  } | null> {
    return integrationQueries.getWebhookDeliveryById(this, id, organizationId);
  }

  /**
   * Get delivery history for a webhook endpoint
   */
  async getWebhookDeliveryHistory(webhookId: number, organizationId: number, limit: number): Promise<Array<{
    id: number;
    webhook_endpoint_id: number;
    organization_id: number;
    event_type: string;
    event_id: string;
    payload: unknown;
    status: string;
    attempt_count: number;
    max_attempts: number;
    response_status?: number;
    response_time_ms?: number;
    error_message?: string;
    created_at: string;
    delivered_at?: string;
  }>> {
    return integrationQueries.getWebhookDeliveryHistory(this, webhookId, organizationId, limit);
  }

  /**
   * Update webhook delivery status
   */
  async updateWebhookDeliveryStatus(
    id: number,
    status: string,
    data: Partial<{
      attempt_count: number;
      next_retry_at: string;
      response_status: number;
      response_body: string;
      response_time_ms: number;
      error_message: string;
      delivered_at: string;
    }>
  ): Promise<void> {
    return integrationQueries.updateWebhookDeliveryStatus(this, id, status, data);
  }

  // ============ SUPER ADMIN - GROWTH STATISTICS (delegated to database/admin-queries.ts) ============

  /**
   * Get growth statistics over time (for super admin dashboard)
   */
  async getGrowthStatistics(months: number = 12): Promise<{
    organizations: Array<{ month: string; count: number }>;
    customers: Array<{ month: string; count: number }>;
    users: Array<{ month: string; count: number }>;
  }> {
    return adminQueries.getGrowthStatistics(this, months);
  }

  /**
   * Get activity statistics (logins, active users)
   */
  async getActivityStatistics(days: number = 30): Promise<{
    loginsByDay: Array<{ date: string; successful: number; failed: number }>;
    activeUsers7Days: number;
    activeUsers30Days: number;
    totalLogins: number;
  }> {
    return adminQueries.getActivityStatistics(this, days);
  }

  // ============ SUPER ADMIN - USER MANAGEMENT (delegated to database/auth-queries.ts) ============

  /**
   * Get login history for an organization
   */
  async getLoginHistoryForOrganization(
    organizationId: number,
    options: { limit?: number; offset?: number; status?: string; epost?: string } = {}
  ): Promise<{
    logs: Array<{
      id: number;
      epost: string;
      bruker_navn: string | null;
      bruker_type: string | null;
      status: string;
      ip_adresse: string | null;
      user_agent: string | null;
      feil_melding: string | null;
      tidspunkt: string;
    }>;
    total: number;
  }> {
    return authQueries.getLoginHistoryForOrganization(this, organizationId, options);
  }

  /**
   * Update a klient (user) record
   */
  async updateKlient(
    klientId: number,
    data: {
      navn?: string;
      epost?: string;
      telefon?: string;
      rolle?: string;
      aktiv?: boolean;
    }
  ): Promise<KlientRecord | null> {
    return authQueries.updateKlient(this, klientId, data);
  }

  /**
   * Get a single klient by ID
   */
  async getKlientById(klientId: number): Promise<KlientRecord | null> {
    return authQueries.getKlientById(this, klientId);
  }

  /**
   * Create password reset token
   */
  async createPasswordResetToken(data: {
    user_id: number;
    user_type: 'klient' | 'bruker';
    token_hash: string;
    epost: string;
    expires_at: string;
  }): Promise<{ id: number }> {
    return authQueries.createPasswordResetToken(this, data);
  }

  /**
   * Close database connection
   * Should be called during graceful shutdown
   */
  close(): void {
    if (this.sqlite) {
      try {
        // better-sqlite3 close method
        this.sqlite.close();
        dbLogger.info('SQLite database connection closed');
      } catch (error) {
        dbLogger.error({ error }, 'Error closing SQLite database');
      }
      this.sqlite = null;
    }
    // Supabase client doesn't need explicit cleanup
    this.supabase = null;
  }

  // ============ Reports (delegated to database/admin-queries.ts) ============

  async getReportKunderByStatus(organizationId: number): Promise<{ status: string; count: number }[]> {
    return adminQueries.getReportKunderByStatus(this, organizationId);
  }

  async getReportKunderByKategori(organizationId: number): Promise<{ kategori: string; count: number }[]> {
    return adminQueries.getReportKunderByKategori(this, organizationId);
  }

  async getReportKunderByPoststed(organizationId: number, limit: number = 10): Promise<{ poststed: string; count: number }[]> {
    return adminQueries.getReportKunderByPoststed(this, organizationId, limit);
  }

  async getReportAvtalerStats(organizationId: number, months: number = 6): Promise<{ total: number; fullfort: number; planlagt: number; by_month: { month: string; count: number }[] }> {
    return adminQueries.getReportAvtalerStats(this, organizationId, months);
  }

  async getReportKontrollStatus(organizationId: number): Promise<{ overdue: number; upcoming_30: number; upcoming_90: number; ok: number }> {
    return adminQueries.getReportKontrollStatus(this, organizationId);
  }

  // ============ Subcategory Groups (delegated to database/org-setup-queries.ts) ============

  async getSubcatGroupsByOrganization(organizationId: number): Promise<{ id: number; organization_id: number; navn: string; sort_order: number; created_at: string }[]> {
    return orgSetupQueries.getSubcatGroupsByOrganization(this, organizationId);
  }

  async createSubcatGroup(organizationId: number, navn: string, sortOrder?: number): Promise<any> {
    return orgSetupQueries.createSubcatGroup(this, organizationId, navn, sortOrder);
  }

  async updateSubcatGroup(groupId: number, navn: string): Promise<any | null> {
    return orgSetupQueries.updateSubcatGroup(this, groupId, navn);
  }

  async deleteSubcatGroup(groupId: number): Promise<boolean> {
    return orgSetupQueries.deleteSubcatGroup(this, groupId);
  }

  // ============ Subcategories (delegated to database/org-setup-queries.ts) ============

  async getSubcategoriesByGroupIds(groupIds: number[]): Promise<{ id: number; group_id: number; navn: string; sort_order: number; created_at: string }[]> {
    return orgSetupQueries.getSubcategoriesByGroupIds(this, groupIds);
  }

  async createSubcategory(groupId: number, navn: string, sortOrder?: number): Promise<any> {
    return orgSetupQueries.createSubcategory(this, groupId, navn, sortOrder);
  }

  async updateSubcategory(id: number, navn: string): Promise<any | null> {
    return orgSetupQueries.updateSubcategory(this, id, navn);
  }

  async deleteSubcategory(id: number): Promise<boolean> {
    return orgSetupQueries.deleteSubcategory(this, id);
  }

  // ============ Kunde Subcategories (delegated to database/org-setup-queries.ts) ============

  async getKundeSubcategories(kundeId: number): Promise<{ kunde_id: number; group_id: number; subcategory_id: number }[]> {
    return orgSetupQueries.getKundeSubcategories(this, kundeId);
  }

  async setKundeSubcategories(kundeId: number, assignments: { group_id: number; subcategory_id: number }[]): Promise<boolean> {
    return orgSetupQueries.setKundeSubcategories(this, kundeId, assignments);
  }

  async getAllKundeSubcategoryAssignments(organizationId: number): Promise<{ kunde_id: number; group_id: number; subcategory_id: number }[]> {
    return orgSetupQueries.getAllKundeSubcategoryAssignments(this, organizationId);
  }

  // ============ Contact Persons (delegated to database/org-setup-queries.ts) ============

  async getKontaktpersonerByKunde(kundeId: number, organizationId: number): Promise<any[]> {
    return orgSetupQueries.getKontaktpersonerByKunde(this, kundeId, organizationId);
  }

  async createKontaktperson(data: {
    kunde_id: number;
    organization_id: number;
    navn: string;
    rolle?: string;
    telefon?: string;
    epost?: string;
    er_primaer?: boolean;
  }): Promise<any> {
    return orgSetupQueries.createKontaktperson(this, data);
  }

  async updateKontaktperson(id: number, organizationId: number, data: Record<string, any>): Promise<any | null> {
    return orgSetupQueries.updateKontaktperson(this, id, organizationId, data);
  }

  async deleteKontaktperson(id: number, organizationId: number): Promise<boolean> {
    return orgSetupQueries.deleteKontaktperson(this, id, organizationId);
  }

  // ============ ACTIVE SESSIONS METHODS (delegated to database/auth-queries.ts) ============

  async createSession(data: {
    userId: number;
    userType: 'klient' | 'bruker';
    jti: string;
    ipAddress?: string;
    userAgent?: string;
    deviceInfo?: string;
    expiresAt: Date;
  }): Promise<void> {
    return authQueries.createSession(this, data);
  }

  async getSessionsByUser(userId: number, userType: 'klient' | 'bruker'): Promise<Array<{
    id: number;
    jti: string;
    ip_address: string | null;
    user_agent: string | null;
    device_info: string | null;
    last_activity_at: string;
    created_at: string;
    expires_at: string;
  }>> {
    return authQueries.getSessionsByUser(this, userId, userType);
  }

  async deleteSessionByJti(jti: string): Promise<boolean> {
    return authQueries.deleteSessionByJti(this, jti);
  }

  async deleteSessionById(id: number, userId: number, userType: 'klient' | 'bruker'): Promise<string | null> {
    return authQueries.deleteSessionById(this, id, userId, userType);
  }

  async updateSessionActivity(jti: string): Promise<void> {
    return authQueries.updateSessionActivity(this, jti);
  }

  async cleanupExpiredSessions(): Promise<number> {
    return authQueries.cleanupExpiredSessions(this);
  }

  // ============ FEATURE MODULE METHODS (delegated to database/admin-queries.ts) ============

  private _supabaseClient: SupabaseClient | null = null;

  async getSupabaseClient(): Promise<SupabaseClient> {
    if (this._supabaseClient) return this._supabaseClient;
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    this._supabaseClient = createClient(supabaseUrl, supabaseKey) as unknown as SupabaseClient;
    return this._supabaseClient;
  }

  async getAllFeatureDefinitions(): Promise<import('../types').FeatureDefinition[]> {
    return adminQueries.getAllFeatureDefinitions(this);
  }

  async getFeatureDefinition(key: string): Promise<import('../types').FeatureDefinition | null> {
    return adminQueries.getFeatureDefinition(this, key);
  }

  async getOrganizationFeatures(organizationId: number): Promise<import('../types').OrganizationFeature[]> {
    return adminQueries.getOrganizationFeatures(this, organizationId);
  }

  async getOrganizationFeature(organizationId: number, featureKey: string): Promise<import('../types').OrganizationFeature | null> {
    return adminQueries.getOrganizationFeature(this, organizationId, featureKey);
  }

  async getEnabledFeatureKeys(organizationId: number): Promise<string[]> {
    return adminQueries.getEnabledFeatureKeys(this, organizationId);
  }

  async enableFeature(organizationId: number, featureKey: string, config?: Record<string, unknown>): Promise<import('../types').OrganizationFeature> {
    return adminQueries.enableFeature(this, organizationId, featureKey, config);
  }

  async disableFeature(organizationId: number, featureKey: string): Promise<boolean> {
    return adminQueries.disableFeature(this, organizationId, featureKey);
  }

  async updateFeatureConfig(organizationId: number, featureKey: string, config: Record<string, unknown>): Promise<import('../types').OrganizationFeature | null> {
    return adminQueries.updateFeatureConfig(this, organizationId, featureKey, config);
  }

  // ============ Patch Notes / Changelog (delegated to database/admin-queries.ts) ============

  async getPatchNotes(limit?: number): Promise<import('../types').PatchNote[]> {
    return adminQueries.getPatchNotes(this, limit);
  }

  async getPatchNotesSince(sinceId: number): Promise<import('../types').PatchNote[]> {
    return adminQueries.getPatchNotesSince(this, sinceId);
  }

  async getLatestPatchNoteId(): Promise<number> {
    return adminQueries.getLatestPatchNoteId(this);
  }

  // ============ Organization Service Types (delegated to database/admin-queries.ts) ============

  async getOrganizationServiceTypes(organizationId: number): Promise<OrganizationServiceType[]> {
    return adminQueries.getOrganizationServiceTypes(this, organizationId);
  }

  async createOrganizationServiceType(
    organizationId: number,
    data: { name: string; slug?: string; icon?: string; color?: string; default_interval_months?: number; description?: string; sort_order?: number; source?: string; source_ref?: string }
  ): Promise<OrganizationServiceType> {
    return adminQueries.createOrganizationServiceType(this, organizationId, data);
  }

  async updateOrganizationServiceType(
    organizationId: number,
    id: number,
    data: Partial<{ name: string; slug: string; icon: string; color: string; default_interval_months: number; description: string; sort_order: number }>
  ): Promise<OrganizationServiceType | null> {
    return adminQueries.updateOrganizationServiceType(this, organizationId, id, data);
  }

  async renameCustomerCategory(organizationId: number, oldName: string, newName: string): Promise<number> {
    return adminQueries.renameCustomerCategory(this, organizationId, oldName, newName);
  }

  async deleteOrganizationServiceType(organizationId: number, id: number): Promise<boolean> {
    return adminQueries.deleteOrganizationServiceType(this, organizationId, id);
  }

  async copyTemplateServiceTypes(organizationId: number, templateId: number): Promise<OrganizationServiceType[]> {
    return adminQueries.copyTemplateServiceTypes(this, organizationId, templateId);
  }

  async findOrCreateServiceTypeByName(organizationId: number, name: string, source: string = 'manual'): Promise<OrganizationServiceType> {
    return adminQueries.findOrCreateServiceTypeByName(this, organizationId, name, source);
  }

  // ============ Chat / Messaging (delegated to database/communication-queries.ts) ============

  async getOrCreateOrgConversation(organizationId: number): Promise<{ id: number }> {
    return communicationQueries.getOrCreateOrgConversation(this, organizationId);
  }

  async getOrCreateDmConversation(organizationId: number, userIds: [number, number]): Promise<{ id: number }> {
    return communicationQueries.getOrCreateDmConversation(this, organizationId, userIds);
  }

  async getChatConversationsForUser(organizationId: number, userId: number): Promise<import('../types').ChatConversation[]> {
    return communicationQueries.getChatConversationsForUser(this, organizationId, userId);
  }

  async getChatMessages(conversationId: number, organizationId: number, limit: number = 50, before?: number): Promise<import('../types').ChatMessage[]> {
    return communicationQueries.getChatMessages(this, conversationId, organizationId, limit, before);
  }

  async createChatMessage(
    conversationId: number,
    organizationId: number,
    senderId: number,
    senderName: string,
    content: string
  ): Promise<import('../types').ChatMessage> {
    return communicationQueries.createChatMessage(this, conversationId, organizationId, senderId, senderName, content);
  }

  async markChatAsRead(userId: number, conversationId: number, messageId: number): Promise<void> {
    return communicationQueries.markChatAsRead(this, userId, conversationId, messageId);
  }

  async getChatUnreadCounts(userId: number, organizationId: number): Promise<{ conversationId: number; count: number }[]> {
    return communicationQueries.getChatUnreadCounts(this, userId, organizationId);
  }

  async getChatConversationById(conversationId: number, organizationId: number): Promise<import('../types').ChatConversation | null> {
    return communicationQueries.getChatConversationById(this, conversationId, organizationId);
  }

  async getChatConversationParticipants(conversationId: number): Promise<number[]> {
    return communicationQueries.getChatConversationParticipants(this, conversationId);
  }

  async getChatTotalUnread(userId: number, organizationId: number): Promise<number> {
    return communicationQueries.getChatTotalUnread(this, userId, organizationId);
  }

  // ============ Coverage Areas (delegated to database/org-setup-queries.ts) ============

  async getCoverageAreas(organizationId: number): Promise<import('../types').CoverageArea[]> {
    return orgSetupQueries.getCoverageAreas(this, organizationId);
  }

  async getCoverageAreaById(id: number, organizationId: number): Promise<import('../types').CoverageArea | null> {
    return orgSetupQueries.getCoverageAreaById(this, id, organizationId);
  }

  async createCoverageArea(organizationId: number, data: Partial<import('../types').CoverageArea>): Promise<import('../types').CoverageArea> {
    return orgSetupQueries.createCoverageArea(this, organizationId, data);
  }

  async updateCoverageArea(id: number, organizationId: number, data: Partial<import('../types').CoverageArea>): Promise<import('../types').CoverageArea | null> {
    return orgSetupQueries.updateCoverageArea(this, id, organizationId, data);
  }

  async deleteCoverageArea(id: number, organizationId: number): Promise<boolean> {
    return orgSetupQueries.deleteCoverageArea(this, id, organizationId);
  }

  // ============ UKEPLAN NOTATER (delegated to database/ukeplan-notater-queries.ts) ============

  async getUkeplanNotater(organizationId: number, ukeStart: string): Promise<ukeplanNotaterQueries.UkeplanNotat[]> {
    return ukeplanNotaterQueries.getUkeplanNotater(this, organizationId, ukeStart);
  }

  async createUkeplanNotat(data: { organization_id: number; kunde_id: number; uke_start: string; notat: string; opprettet_av?: string; type?: string; tilordnet?: string; maldag?: string; overfort_fra?: number }): Promise<ukeplanNotaterQueries.UkeplanNotat> {
    return ukeplanNotaterQueries.createUkeplanNotat(this, data);
  }

  async updateUkeplanNotat(id: number, organizationId: number, data: { notat?: string; fullfort?: boolean; type?: string; tilordnet?: string | null; maldag?: string | null }): Promise<ukeplanNotaterQueries.UkeplanNotat | null> {
    return ukeplanNotaterQueries.updateUkeplanNotat(this, id, organizationId, data);
  }

  async deleteUkeplanNotat(id: number, organizationId: number): Promise<boolean> {
    return ukeplanNotaterQueries.deleteUkeplanNotat(this, id, organizationId);
  }

  async getOverforteNotater(organizationId: number, currentUkeStart: string): Promise<ukeplanNotaterQueries.UkeplanNotat[]> {
    return ukeplanNotaterQueries.getOverforteNotater(this, organizationId, currentUkeStart);
  }
}

// Singleton instance
let instance: DatabaseService | null = null;

export async function getDatabase(): Promise<DatabaseService> {
  if (!instance) {
    instance = new DatabaseService();
    await instance.init();
  }
  return instance;
}

/**
 * Close database connection and cleanup singleton
 * Call this during graceful shutdown
 */
export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
    dbLogger.info('Database service closed');
  }
}

// Graceful shutdown handling
let shutdownHandlersRegistered = false;

export function registerShutdownHandlers(): void {
  if (shutdownHandlersRegistered) return;
  shutdownHandlersRegistered = true;

  const gracefulShutdown = (signal: string) => {
    dbLogger.info({ signal }, 'Received shutdown signal, closing database...');
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught exceptions - close database before exit
  process.on('uncaughtException', (error) => {
    dbLogger.fatal({ error }, 'Uncaught exception, closing database...');
    closeDatabase();
    process.exit(1);
  });
}

export default DatabaseService;

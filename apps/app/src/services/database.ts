/**
 * Database service abstraction
 * Supports both SQLite and Supabase backends
 */

import { dbLogger } from './logger';
import { getConfig } from '../config/env';
import type { Kunde, Organization, Rute, Avtale, Kontaktlogg, EmailInnstilling, EmailVarsel, OrganizationServiceType } from '../types';

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
    select(columns?: string): any;
    insert(data: any): any;
    upsert(data: any, options?: { onConflict?: string }): any;
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
  getGlobalStatistics(): Promise<{ totalOrganizations: number; totalKunder: number; totalUsers: number; activeSubscriptions: number }>;

  // Onboarding methods
  getOnboardingStatus(organizationId: number): Promise<{
    stage: string;
    completed: boolean;
    industry_template_id: number | null;
  } | null>;
  updateOnboardingStage(organizationId: number, stage: string, additionalData?: Record<string, unknown>): Promise<boolean>;
  completeOnboarding(organizationId: number): Promise<boolean>;
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
class DatabaseService {
  private type: DatabaseType;
  private sqlite: SqliteDatabase | null = null;
  private supabase: SupabaseService | null = null;

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
  private validateTenantContext(organizationId: number | undefined, operation: string): asserts organizationId is number {
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

    // Tags tables
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id INTEGER NOT NULL,
        navn TEXT NOT NULL,
        farge TEXT NOT NULL DEFAULT '#3b82f6',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, navn),
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kunde_tags (
        kunde_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (kunde_id, tag_id),
        FOREIGN KEY (kunde_id) REFERENCES kunder(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
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

  // ============ KUNDER METHODS ============

  /**
   * Get all customers for an organization.
   * SECURITY: organizationId is required to prevent cross-tenant data access.
   */
  async getAllKunder(organizationId: number): Promise<Kunde[]> {
    this.validateTenantContext(organizationId, 'getAllKunder');

    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getAllKunderByTenant(organizationId);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const sql = 'SELECT * FROM kunder WHERE organization_id = ? ORDER BY navn COLLATE NOCASE';
    return this.sqlite.prepare(sql).all(organizationId) as Kunde[];
  }

  /**
   * Get customers with pagination support
   * Returns { data, total, limit, offset } for paginated responses
   */
  async getAllKunderPaginated(
    organizationId: number,
    options: { limit?: number; offset?: number; search?: string; kategori?: string; status?: string } = {}
  ): Promise<{ data: Kunde[]; total: number; limit: number; offset: number }> {
    const { limit = 100, offset = 0, search, kategori, status } = options;

    if (!this.sqlite) throw new Error('Database not initialized');

    // Build WHERE conditions
    const conditions: string[] = ['organization_id = ?'];
    const params: (string | number)[] = [organizationId];

    if (search) {
      conditions.push('(navn LIKE ? OR adresse LIKE ? OR poststed LIKE ?)');
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    if (kategori) {
      conditions.push('kategori = ?');
      params.push(kategori);
    }

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countSql = `SELECT COUNT(*) as total FROM kunder WHERE ${whereClause}`;
    const countResult = this.sqlite.prepare(countSql).get(...params) as { total: number };
    const total = countResult.total;

    // Get paginated data
    const dataSql = `
      SELECT * FROM kunder
      WHERE ${whereClause}
      ORDER BY navn COLLATE NOCASE
      LIMIT ? OFFSET ?
    `;
    const data = this.sqlite.prepare(dataSql).all(...params, limit, offset) as Kunde[];

    return { data, total, limit, offset };
  }

  /**
   * Get a customer by ID within an organization.
   * SECURITY: organizationId is required to prevent cross-tenant data access.
   */
  async getKundeById(id: number, organizationId: number): Promise<Kunde | null> {
    this.validateTenantContext(organizationId, 'getKundeById');

    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getKundeByIdAndTenant(id, organizationId);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const sql = 'SELECT * FROM kunder WHERE id = ? AND organization_id = ?';
    const result = this.sqlite.prepare(sql).get(id, organizationId);

    return (result as Kunde) || null;
  }

  async createKunde(data: Partial<Kunde> & { custom_data?: string }): Promise<Kunde> {
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.createKunde(data);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const stmt = this.sqlite.prepare(`
      INSERT INTO kunder (
        navn, adresse, postnummer, poststed, telefon, epost, lat, lng, notater, kategori,
        siste_el_kontroll, neste_el_kontroll, el_kontroll_intervall,
        siste_brann_kontroll, neste_brann_kontroll, brann_kontroll_intervall,
        el_type, brann_system, brann_driftstype, organization_id, kontaktperson, custom_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.navn,
      data.adresse,
      data.postnummer,
      data.poststed,
      data.telefon,
      data.epost,
      data.lat,
      data.lng,
      data.notater,
      data.kategori || 'El-Kontroll',
      data.siste_el_kontroll,
      data.neste_el_kontroll,
      data.el_kontroll_intervall || 36,
      data.siste_brann_kontroll,
      data.neste_brann_kontroll,
      data.brann_kontroll_intervall || 12,
      data.el_type,
      data.brann_system,
      data.brann_driftstype,
      data.organization_id,
      data.kontaktperson || null,
      data.custom_data || '{}'
    );

    return { ...data, id: Number(result.lastInsertRowid) } as Kunde;
  }

  /**
   * Update a customer within an organization.
   * SECURITY: organizationId is required to prevent cross-tenant data modification.
   */
  async updateKunde(id: number, data: Partial<Kunde>, organizationId: number): Promise<Kunde | null> {
    this.validateTenantContext(organizationId, 'updateKunde');

    // First check if kunde exists in this organization
    const existing = await this.getKundeById(id, organizationId);
    if (!existing) return null;

    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.updateKunde(id, data, organizationId);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    // Build dynamic UPDATE query
    const fields: string[] = [];
    const values: unknown[] = [];

    const updateableFields = [
      'navn', 'adresse', 'postnummer', 'poststed', 'telefon', 'epost',
      'lat', 'lng', 'notater', 'kategori', 'el_type', 'brann_system', 'brann_driftstype',
      'siste_el_kontroll', 'neste_el_kontroll', 'el_kontroll_intervall',
      'siste_brann_kontroll', 'neste_brann_kontroll', 'brann_kontroll_intervall',
      'siste_kontroll', 'neste_kontroll', 'kontroll_intervall_mnd',
      'prosjektnummer', 'kundenummer', 'faktura_epost',
      'external_source', 'external_id', 'last_sync_at',
      'lifecycle_stage', 'inquiry_sent_date', 'last_visit_date', 'job_confirmed_type',
    ];

    for (const field of updateableFields) {
      if (field in data) {
        fields.push(`${field} = ?`);
        values.push((data as Record<string, unknown>)[field]);
      }
    }

    if (fields.length === 0) {
      return existing;
    }

    values.push(id, organizationId);

    const sql = `UPDATE kunder SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`;
    this.sqlite.prepare(sql).run(...values);

    return this.getKundeById(id, organizationId);
  }

  /**
   * Delete a customer within an organization.
   * SECURITY: organizationId is required to prevent cross-tenant data deletion.
   */
  async deleteKunde(id: number, organizationId: number): Promise<boolean> {
    this.validateTenantContext(organizationId, 'deleteKunde');

    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.deleteKunde(id, organizationId);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const sql = 'DELETE FROM kunder WHERE id = ? AND organization_id = ?';
    const result = this.sqlite.prepare(sql).run(id, organizationId);

    return result.changes > 0;
  }

  /**
   * Get customers by area within an organization.
   * SECURITY: organizationId is required to prevent cross-tenant data access.
   */
  async getKunderByOmrade(omrade: string, organizationId: number): Promise<Kunde[]> {
    this.validateTenantContext(organizationId, 'getKunderByOmrade');

    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getKunderByOmrade(omrade, organizationId);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const sql = 'SELECT * FROM kunder WHERE organization_id = ? AND (poststed LIKE ? OR adresse LIKE ?) ORDER BY navn COLLATE NOCASE';
    const pattern = `%${omrade}%`;
    return this.sqlite.prepare(sql).all(organizationId, pattern, pattern) as Kunde[];
  }

  /**
   * Get customers with upcoming control deadlines.
   * SECURITY: organizationId is required to prevent cross-tenant data access.
   */
  async getKontrollVarsler(dager: number, organizationId: number): Promise<Kunde[]> {
    this.validateTenantContext(organizationId, 'getKontrollVarsler');

    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getKontrollVarsler(dager, organizationId);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    // Check app_mode for this organization
    const org = await this.getOrganizationById(organizationId);
    const appMode = org?.app_mode ?? 'mvp';

    if (appMode === 'full') {
      // Full mode: filter by El-Kontroll/Brannvarsling categories
      const params = [organizationId, dager, dager, dager, dager];
      const sql = `
        SELECT * FROM kunder
        WHERE organization_id = ? AND kategori IN ('El-Kontroll', 'Brannvarsling', 'El-Kontroll + Brannvarsling')
          AND (
            (kategori IN ('El-Kontroll', 'El-Kontroll + Brannvarsling') AND
              (neste_el_kontroll <= date('now', '+' || ? || ' days')
              OR (neste_el_kontroll IS NULL AND siste_el_kontroll IS NOT NULL
                  AND date(siste_el_kontroll, '+' || COALESCE(el_kontroll_intervall, 36) || ' months') <= date('now', '+' || ? || ' days'))
              OR (neste_el_kontroll IS NULL AND siste_el_kontroll IS NULL)))
            OR (kategori IN ('Brannvarsling', 'El-Kontroll + Brannvarsling') AND
              (neste_brann_kontroll <= date('now', '+' || ? || ' days')
              OR (neste_brann_kontroll IS NULL AND siste_brann_kontroll IS NOT NULL
                  AND date(siste_brann_kontroll, '+' || COALESCE(brann_kontroll_intervall, 12) || ' months') <= date('now', '+' || ? || ' days'))
              OR (neste_brann_kontroll IS NULL AND siste_brann_kontroll IS NULL)))
          )
        ORDER BY navn COLLATE NOCASE
      `;
      return this.sqlite.prepare(sql).all(...params) as Kunde[];
    }

    // MVP mode: use generic kontroll dates (no category filter)
    const params = [organizationId, dager, dager];
    const sql = `
      SELECT * FROM kunder
      WHERE organization_id = ?
        AND (
          neste_kontroll <= date('now', '+' || ? || ' days')
          OR (neste_kontroll IS NULL AND siste_kontroll IS NOT NULL
              AND date(siste_kontroll, '+' || COALESCE(kontroll_intervall_mnd, 12) || ' months') <= date('now', '+' || ? || ' days'))
          OR (neste_kontroll IS NULL AND siste_kontroll IS NULL AND kontroll_intervall_mnd IS NOT NULL)
        )
      ORDER BY navn COLLATE NOCASE
    `;
    return this.sqlite.prepare(sql).all(...params) as Kunde[];
  }

  /**
   * Bulk complete control for multiple customers.
   * SECURITY: organizationId is required to prevent cross-tenant data modification.
   */
  async bulkCompleteKontroll(
    kundeIds: number[],
    type: 'el' | 'brann' | 'begge',
    dato: string,
    organizationId: number
  ): Promise<number> {
    this.validateTenantContext(organizationId, 'bulkCompleteKontroll');

    if (!this.sqlite) throw new Error('Database not initialized (bulk complete not supported in Supabase yet)');

    if (kundeIds.length === 0) return 0;

    // OPTIMIZED: Batch fetch all customers in ONE query to verify ownership and get intervals
    const placeholders = kundeIds.map(() => '?').join(',');
    const fetchSql = `SELECT id, el_kontroll_intervall FROM kunder WHERE id IN (${placeholders}) AND organization_id = ?`;

    const params = [...kundeIds, organizationId];
    const validKunder = this.sqlite.prepare(fetchSql).all(...params) as Array<{ id: number; el_kontroll_intervall: number | null }>;

    if (validKunder.length === 0) return 0;

    // Build a map of id -> interval for quick lookup
    const intervalMap = new Map<number, number>();
    for (const k of validKunder) {
      intervalMap.set(k.id, k.el_kontroll_intervall || 36);
    }

    // OPTIMIZED: Use transaction for all updates
    const transaction = this.sqlite.transaction(() => {
      let updated = 0;

      // Prepare statements outside the loop
      const updateElStmt = this.sqlite!.prepare(`
        UPDATE kunder SET siste_el_kontroll = ?, neste_el_kontroll = ? WHERE id = ?
      `);
      const updateBrannStmt = this.sqlite!.prepare(`
        UPDATE kunder SET siste_brann_kontroll = ?, neste_brann_kontroll = ? WHERE id = ?
      `);
      const updateBothStmt = this.sqlite!.prepare(`
        UPDATE kunder SET siste_el_kontroll = ?, neste_el_kontroll = ?, siste_brann_kontroll = ?, neste_brann_kontroll = ? WHERE id = ?
      `);

      for (const kunde of validKunder) {
        const elInterval = intervalMap.get(kunde.id) || 36;

        if (type === 'begge') {
          // Calculate both next dates
          const nextElDate = new Date(dato);
          nextElDate.setMonth(nextElDate.getMonth() + elInterval);
          const nextBrannDate = new Date(dato);
          nextBrannDate.setMonth(nextBrannDate.getMonth() + 12);

          const result = updateBothStmt.run(
            dato,
            nextElDate.toISOString().split('T')[0],
            dato,
            nextBrannDate.toISOString().split('T')[0],
            kunde.id
          );
          if (result.changes > 0) updated++;
        } else if (type === 'el') {
          const nextDate = new Date(dato);
          nextDate.setMonth(nextDate.getMonth() + elInterval);

          const result = updateElStmt.run(dato, nextDate.toISOString().split('T')[0], kunde.id);
          if (result.changes > 0) updated++;
        } else if (type === 'brann') {
          const nextDate = new Date(dato);
          nextDate.setMonth(nextDate.getMonth() + 12);

          const result = updateBrannStmt.run(dato, nextDate.toISOString().split('T')[0], kunde.id);
          if (result.changes > 0) updated++;
        }
      }

      return updated;
    });

    return transaction();
  }

  /**
   * Mark customers as visited, with optional kontroll date update.
   * Always updates last_visit_date.
   * Accepts dynamic service_type_slugs from organization_service_types.
   * Maps known slugs to legacy kontroll columns, and always updates generic siste/neste_kontroll.
   * Works with both Supabase and SQLite.
   */
  async markVisited(
    kundeIds: number[],
    visitedDate: string,
    serviceTypeSlugs: string[],
    organizationId: number
  ): Promise<number> {
    this.validateTenantContext(organizationId, 'markVisited');
    if (kundeIds.length === 0) return 0;

    // Look up intervals from organization service types
    let serviceTypes: Array<{ slug: string; default_interval_months: number }> = [];
    if (serviceTypeSlugs.length > 0) {
      const allTypes = await this.getOrganizationServiceTypes(organizationId);
      serviceTypes = allTypes
        .filter(st => serviceTypeSlugs.includes(st.slug))
        .map(st => ({ slug: st.slug, default_interval_months: st.default_interval_months || 12 }));
    }

    let updated = 0;

    for (const kundeId of kundeIds) {
      const kunde = await this.getKundeById(kundeId, organizationId);
      if (!kunde) continue;

      const updateData: Record<string, unknown> = {
        last_visit_date: visitedDate,
      };

      if (serviceTypes.length > 0) {
        // Always update generic kontroll columns with the shortest interval
        const shortestInterval = Math.min(...serviceTypes.map(st => st.default_interval_months));
        const nextGenericDate = new Date(visitedDate);
        nextGenericDate.setMonth(nextGenericDate.getMonth() + shortestInterval);
        updateData.siste_kontroll = visitedDate;
        updateData.neste_kontroll = nextGenericDate.toISOString().split('T')[0];

        // Map known slugs to legacy columns for backward compatibility
        // Service type interval is the source of truth (admin-configured)
        for (const st of serviceTypes) {
          const interval = st.default_interval_months;
          if (st.slug === 'el-kontroll') {
            const nextDate = new Date(visitedDate);
            nextDate.setMonth(nextDate.getMonth() + interval);
            updateData.siste_el_kontroll = visitedDate;
            updateData.neste_el_kontroll = nextDate.toISOString().split('T')[0];
            updateData.el_kontroll_intervall = interval;
          } else if (st.slug === 'brannvarsling') {
            const nextDate = new Date(visitedDate);
            nextDate.setMonth(nextDate.getMonth() + interval);
            updateData.siste_brann_kontroll = visitedDate;
            updateData.neste_brann_kontroll = nextDate.toISOString().split('T')[0];
            updateData.brann_kontroll_intervall = interval;
          }
        }
      }

      const result = await this.updateKunde(kundeId, updateData as Partial<Kunde>, organizationId);
      if (result) updated++;
    }

    return updated;
  }

  // ============ AUTH METHODS ============

  async getKlientByEpost(epost: string): Promise<KlientRecord | null> {
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getKlientByEpost(epost);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const result = this.sqlite
      .prepare('SELECT * FROM klient WHERE LOWER(epost) = LOWER(?)')
      .get(epost);

    return (result as KlientRecord) || null;
  }

  async getBrukerByEpost(epost: string): Promise<BrukerRecord | null> {
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getBrukerByEpost(epost);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    try {
      const result = this.sqlite
        .prepare('SELECT * FROM brukere WHERE LOWER(epost) = LOWER(?)')
        .get(epost);
      return (result as BrukerRecord) || null;
    } catch {
      // brukere table might not exist
      return null;
    }
  }

  async getBrukerById(id: number): Promise<BrukerRecord | null> {
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getBrukerById(id);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    try {
      const result = this.sqlite
        .prepare('SELECT * FROM brukere WHERE id = ?')
        .get(id);
      return (result as BrukerRecord) || null;
    } catch {
      // brukere table might not exist
      return null;
    }
  }

  async updateKlientLastLogin(id: number): Promise<void> {
    if (this.type === 'supabase' && this.supabase) {
      await this.supabase.updateKlientLastLogin(id);
      return;
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    this.sqlite
      .prepare('UPDATE klient SET sist_innlogget = CURRENT_TIMESTAMP WHERE id = ?')
      .run(id);
  }

  async updateBrukerLastLogin(id: number): Promise<void> {
    if (this.type === 'supabase' && this.supabase) {
      await this.supabase.updateBrukerLastLogin(id);
      return;
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    this.sqlite
      .prepare('UPDATE brukere SET sist_innlogget = CURRENT_TIMESTAMP WHERE id = ?')
      .run(id);
  }

  async getOrganizationById(id: number): Promise<Organization | null> {
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getOrganizationById(id);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const result = this.sqlite
      .prepare('SELECT * FROM organizations WHERE id = ? AND aktiv = 1')
      .get(id);

    return (result as Organization) || null;
  }

  async getIndustryTemplateById(id: number): Promise<{ id: number; name: string; slug: string; icon?: string; color?: string; description?: string } | null> {
    if (this.type === 'supabase') {
      // For Supabase, query directly using the Supabase client
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        const { data, error } = await supabase
          .from('industry_templates')
          .select('id, name, slug, icon, color, description')
          .eq('id', id)
          .single();

        if (error || !data) return null;
        return data;
      } catch {
        return null;
      }
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const result = this.sqlite
      .prepare('SELECT id, name, slug, icon, color, description FROM industry_templates WHERE id = ? AND aktiv = 1')
      .get(id);

    return (result as { id: number; name: string; slug: string; icon?: string; color?: string; description?: string }) || null;
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
    if (this.type === 'supabase') {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        // Get the template
        const { data: template, error: templateError } = await supabase
          .from('industry_templates')
          .select('id, name, slug, description')
          .eq('id', id)
          .single();

        if (templateError || !template) return null;

        // Get service types
        const { data: serviceTypes } = await supabase
          .from('template_service_types')
          .select('id, name, slug, description')
          .eq('template_id', id)
          .eq('aktiv', true)
          .order('sort_order');

        // Get subtypes and equipment for each service type
        const serviceTypesWithDetails = await Promise.all(
          (serviceTypes || []).map(async (st: { id: number; name: string; slug: string; description?: string }) => {
            const [subtypesResult, equipmentResult] = await Promise.all([
              supabase.from('template_subtypes').select('name, slug').eq('service_type_id', st.id).order('sort_order'),
              supabase.from('template_equipment').select('name, slug').eq('service_type_id', st.id).order('sort_order'),
            ]);

            return {
              name: st.name,
              slug: st.slug,
              description: st.description,
              subtypes: (subtypesResult.data || []) as Array<{ name: string; slug: string }>,
              equipment: (equipmentResult.data || []) as Array<{ name: string; slug: string }>,
            };
          })
        );

        return {
          id: template.id,
          name: template.name,
          slug: template.slug,
          description: template.description,
          serviceTypes: serviceTypesWithDetails,
        };
      } catch (error) {
        dbLogger.error({ error, id }, 'Failed to get industry template with service types');
        return null;
      }
    }

    // SQLite implementation
    if (!this.sqlite) throw new Error('Database not initialized');

    const template = this.sqlite
      .prepare('SELECT id, name, slug, description FROM industry_templates WHERE id = ? AND aktiv = 1')
      .get(id) as { id: number; name: string; slug: string; description?: string } | undefined;

    if (!template) return null;

    const serviceTypes = this.sqlite
      .prepare('SELECT id, name, slug, description FROM template_service_types WHERE template_id = ? AND aktiv = 1 ORDER BY sort_order')
      .all(id) as Array<{ id: number; name: string; slug: string; description?: string }>;

    const serviceTypesWithDetails = serviceTypes.map(st => {
      const subtypes = this.sqlite!
        .prepare('SELECT name, slug FROM template_subtypes WHERE service_type_id = ? ORDER BY sort_order')
        .all(st.id) as Array<{ name: string; slug: string }>;

      const equipment = this.sqlite!
        .prepare('SELECT name, slug FROM template_equipment WHERE service_type_id = ? ORDER BY sort_order')
        .all(st.id) as Array<{ name: string; slug: string }>;

      return {
        name: st.name,
        slug: st.slug,
        description: st.description,
        subtypes,
        equipment,
      };
    });

    return {
      id: template.id,
      name: template.name,
      slug: template.slug,
      description: template.description,
      serviceTypes: serviceTypesWithDetails,
    };
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
    if (!this.sqlite) {
      // For Supabase, log to console for now (could add Supabase logging)
      dbLogger.info({ ...data }, 'Login attempt');
      return;
    }

    this.sqlite
      .prepare(`
        INSERT INTO login_logg (epost, bruker_navn, bruker_type, status, ip_adresse, user_agent, feil_melding)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        data.epost,
        data.bruker_navn,
        data.bruker_type,
        data.status,
        data.ip_adresse,
        data.user_agent,
        data.feil_melding
      );
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
    if (!this.sqlite) {
      dbLogger.warn('Refresh tokens not supported in Supabase yet');
      return;
    }

    this.sqlite.prepare(`
      INSERT INTO refresh_tokens (token_hash, user_id, user_type, device_info, ip_address, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      data.tokenHash,
      data.userId,
      data.userType,
      data.deviceInfo,
      data.ipAddress,
      data.expiresAt.toISOString()
    );
  }

  async getRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
    if (!this.sqlite) return null;

    const result = this.sqlite.prepare(`
      SELECT * FROM refresh_tokens WHERE token_hash = ?
    `).get(tokenHash);

    return (result as RefreshTokenRecord) || null;
  }

  async revokeRefreshToken(tokenHash: string, replacedBy?: string): Promise<boolean> {
    if (!this.sqlite) return false;

    const sql = replacedBy
      ? `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, replaced_by = ? WHERE token_hash = ? AND revoked_at IS NULL`
      : `UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL`;

    const result = replacedBy
      ? this.sqlite.prepare(sql).run(replacedBy, tokenHash)
      : this.sqlite.prepare(sql).run(tokenHash);

    return result.changes > 0;
  }

  async revokeAllUserRefreshTokens(userId: number, userType: 'klient' | 'bruker'): Promise<number> {
    if (!this.sqlite) return 0;

    const result = this.sqlite.prepare(`
      UPDATE refresh_tokens
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND user_type = ? AND revoked_at IS NULL
    `).run(userId, userType);

    return result.changes;
  }

  async cleanupExpiredRefreshTokens(): Promise<number> {
    if (!this.sqlite) return 0;

    const result = this.sqlite.prepare(`
      DELETE FROM refresh_tokens
      WHERE expires_at < datetime('now')
        OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-7 days'))
    `).run();

    return result.changes;
  }

  async isRefreshTokenRevoked(tokenHash: string): Promise<boolean> {
    if (!this.sqlite) return true;

    const result = this.sqlite.prepare(`
      SELECT revoked_at, expires_at FROM refresh_tokens WHERE token_hash = ?
    `).get(tokenHash) as { revoked_at: string | null; expires_at: string } | undefined;

    if (!result) return true;
    if (result.revoked_at) return true;
    if (new Date(result.expires_at) < new Date()) return true;

    return false;
  }

  async detectRefreshTokenReuse(tokenHash: string): Promise<boolean> {
    if (!this.sqlite) return false;

    // Check if this token was already used (has a replaced_by value or is revoked)
    const result = this.sqlite.prepare(`
      SELECT id, replaced_by, revoked_at FROM refresh_tokens WHERE token_hash = ?
    `).get(tokenHash) as { id: number; replaced_by: string | null; revoked_at: string | null } | undefined;

    // If token doesn't exist or has been replaced/revoked, it's potentially reuse
    return result?.replaced_by !== null || result?.revoked_at !== null;
  }

  async getActiveRefreshTokenCount(userId: number, userType: 'klient' | 'bruker'): Promise<number> {
    if (!this.sqlite) return 0;

    const result = this.sqlite.prepare(`
      SELECT COUNT(*) as count FROM refresh_tokens
      WHERE user_id = ? AND user_type = ? AND revoked_at IS NULL AND expires_at > datetime('now')
    `).get(userId, userType) as { count: number };

    return result?.count || 0;
  }

  // ============ TOKEN BLACKLIST METHODS ============

  async addToTokenBlacklist(data: {
    jti: string;
    userId: number;
    userType: 'klient' | 'bruker';
    expiresAt: number;
    reason?: string;
  }): Promise<void> {
    if (!this.sqlite) {
      dbLogger.warn('Token blacklist not supported in Supabase yet');
      return;
    }

    try {
      this.sqlite.prepare(`
        INSERT OR REPLACE INTO token_blacklist (jti, user_id, user_type, expires_at, reason)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        data.jti,
        data.userId,
        data.userType,
        data.expiresAt,
        data.reason || 'logout'
      );
    } catch (error) {
      dbLogger.error({ error, jti: data.jti }, 'Failed to add token to blacklist');
    }
  }

  async isTokenInBlacklist(jti: string): Promise<boolean> {
    if (!this.sqlite) return false;

    try {
      const result = this.sqlite.prepare(`
        SELECT 1 FROM token_blacklist WHERE jti = ?
      `).get(jti);

      return !!result;
    } catch {
      return false;
    }
  }

  async cleanupExpiredBlacklistTokens(): Promise<number> {
    if (!this.sqlite) return 0;

    const now = Math.floor(Date.now() / 1000);

    try {
      const result = this.sqlite.prepare(`
        DELETE FROM token_blacklist WHERE expires_at < ?
      `).run(now);

      return result.changes;
    } catch (error) {
      dbLogger.error({ error }, 'Failed to cleanup expired blacklist tokens');
      return 0;
    }
  }

  async getBlacklistStats(): Promise<{ total: number; expiredRemoved?: number }> {
    if (!this.sqlite) return { total: 0 };

    try {
      const result = this.sqlite.prepare(`
        SELECT COUNT(*) as total FROM token_blacklist
      `).get() as { total: number };

      return { total: result?.total || 0 };
    } catch {
      return { total: 0 };
    }
  }

  // ============ ORGANIZATION LIMITS ============

  /**
   * Counts customers for an organization efficiently using COUNT(*)
   * PERFORMANCE: Uses COUNT(*) instead of loading all records
   */
  async countOrganizationKunder(organizationId: number): Promise<number> {
    if (this.type === 'supabase') {
      // Direct Supabase count query
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { count, error } = await supabase
        .from('kunder')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId);

      if (error) {
        dbLogger.warn({ error, organizationId }, 'Failed to count kunder in Supabase');
        return 0;
      }

      return count || 0;
    }

    if (!this.sqlite) return 0;

    const result = this.sqlite.prepare(`
      SELECT COUNT(*) as count FROM kunder WHERE organization_id = ?
    `).get(organizationId) as { count: number };

    return result?.count || 0;
  }

  async getOrganizationLimits(organizationId: number): Promise<{ max_kunder: number; current_count: number } | null> {
    const org = await this.getOrganizationById(organizationId);
    if (!org) return null;

    // PERFORMANCE: Use COUNT(*) instead of loading all customers
    const currentCount = await this.countOrganizationKunder(organizationId);

    return {
      max_kunder: org.max_kunder || 200,
      current_count: currentCount,
    };
  }

  async countOrganizationUsers(organizationId: number): Promise<number> {
    if (!this.sqlite) return 0;

    const result = this.sqlite.prepare(`
      SELECT COUNT(*) as count FROM klient
      WHERE organization_id = ? AND aktiv = 1
    `).get(organizationId) as { count: number };

    return result?.count || 0;
  }

  async getOrganizationUserLimits(organizationId: number): Promise<{ max_brukere: number; current_count: number } | null> {
    const org = await this.getOrganizationById(organizationId);
    if (!org) return null;

    const currentCount = await this.countOrganizationUsers(organizationId);

    return {
      max_brukere: org.max_brukere || 5,
      current_count: currentCount,
    };
  }

  // ============ TEAM MEMBER METHODS ============

  async getTeamMembers(organizationId: number): Promise<KlientRecord[]> {
    if (!this.sqlite) throw new Error('Database not initialized');

    return this.sqlite.prepare(`
      SELECT id, navn, epost, telefon, rolle, aktiv, sist_innlogget, opprettet
      FROM klient
      WHERE organization_id = ?
      ORDER BY navn COLLATE NOCASE
    `).all(organizationId) as KlientRecord[];
  }

  async createTeamMember(data: {
    navn: string;
    epost: string;
    passord_hash: string;
    telefon?: string;
    rolle?: string;
    organization_id: number;
  }): Promise<KlientRecord> {
    if (!this.sqlite) throw new Error('Database not initialized');

    const stmt = this.sqlite.prepare(`
      INSERT INTO klient (navn, epost, passord_hash, telefon, rolle, organization_id, aktiv)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);

    const result = stmt.run(
      data.navn,
      data.epost,
      data.passord_hash,
      data.telefon || null,
      data.rolle || 'medlem',
      data.organization_id
    );

    const member = this.sqlite.prepare('SELECT * FROM klient WHERE id = ?').get(result.lastInsertRowid);
    return member as KlientRecord;
  }

  async updateTeamMember(
    id: number,
    organizationId: number,
    data: { navn?: string; telefon?: string; rolle?: string; aktiv?: boolean }
  ): Promise<KlientRecord | null> {
    if (!this.sqlite) throw new Error('Database not initialized');

    // Verify member belongs to organization
    const existing = this.sqlite.prepare(`
      SELECT * FROM klient WHERE id = ? AND organization_id = ?
    `).get(id, organizationId) as KlientRecord | undefined;

    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.navn !== undefined) {
      fields.push('navn = ?');
      values.push(data.navn);
    }
    if (data.telefon !== undefined) {
      fields.push('telefon = ?');
      values.push(data.telefon);
    }
    if (data.rolle !== undefined) {
      fields.push('rolle = ?');
      values.push(data.rolle);
    }
    if (data.aktiv !== undefined) {
      fields.push('aktiv = ?');
      values.push(data.aktiv ? 1 : 0);
    }

    if (fields.length === 0) return existing;

    values.push(id, organizationId);
    this.sqlite.prepare(`
      UPDATE klient SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?
    `).run(...values);

    return this.sqlite.prepare('SELECT * FROM klient WHERE id = ?').get(id) as KlientRecord;
  }

  async deleteTeamMember(id: number, organizationId: number): Promise<boolean> {
    if (!this.sqlite) throw new Error('Database not initialized');

    const result = this.sqlite.prepare(`
      DELETE FROM klient WHERE id = ? AND organization_id = ?
    `).run(id, organizationId);

    return result.changes > 0;
  }

  async getTeamMemberByEpost(epost: string, organizationId: number): Promise<KlientRecord | null> {
    if (!this.sqlite) return null;

    const result = this.sqlite.prepare(`
      SELECT * FROM klient WHERE LOWER(epost) = LOWER(?) AND organization_id = ?
    `).get(epost, organizationId);

    return (result as KlientRecord) || null;
  }

  // ============ ORGANIZATION FIELDS METHODS ============

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
    if (this.type === 'supabase') {
      // Supabase implementation
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        const fieldIds: number[] = [];
        let created = 0;

        for (const field of fields) {
          // Insert field (upsert to avoid duplicates)
          const { data: fieldData, error: fieldError } = await supabase
            .from('organization_fields')
            .upsert({
              organization_id: organizationId,
              field_name: field.field_name,
              display_name: field.display_name,
              field_type: field.field_type,
              is_filterable: field.is_filterable ? 1 : 0,
              is_visible: field.is_visible ? 1 : 0,
              sort_order: 0
            }, { onConflict: 'organization_id,field_name' })
            .select('id')
            .single();

          if (fieldError) {
            dbLogger.warn({ error: fieldError, field: field.field_name }, 'Failed to create organization field');
            continue;
          }

          if (fieldData) {
            fieldIds.push(fieldData.id);
            created++;

            // Create options for select fields
            if (field.field_type === 'select' && field.options && field.options.length > 0) {
              const optionsToInsert = field.options.map((value, index) => ({
                field_id: fieldData.id,
                value: value,
                display_name: value,
                sort_order: index
              }));

              await supabase
                .from('organization_field_options')
                .upsert(optionsToInsert, { onConflict: 'field_id,value' });
            }
          }
        }

        return { created, fieldIds };
      } catch (error) {
        dbLogger.error({ error }, 'Failed to create organization fields in Supabase');
        return { created: 0, fieldIds: [] };
      }
    }

    // SQLite implementation
    if (!this.sqlite) throw new Error('Database not initialized');

    const fieldIds: number[] = [];
    let created = 0;

    // Prepare statements
    const insertFieldStmt = this.sqlite.prepare(`
      INSERT OR IGNORE INTO organization_fields
        (organization_id, field_name, display_name, field_type, is_filterable, is_visible, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const getFieldIdStmt = this.sqlite.prepare(`
      SELECT id FROM organization_fields WHERE organization_id = ? AND field_name = ?
    `);

    const insertOptionStmt = this.sqlite.prepare(`
      INSERT OR IGNORE INTO organization_field_options (field_id, value, display_name, sort_order)
      VALUES (?, ?, ?, ?)
    `);

    const transaction = this.sqlite.transaction(() => {
      for (const field of fields) {
        // Insert or ignore field
        insertFieldStmt.run(
          organizationId,
          field.field_name,
          field.display_name,
          field.field_type,
          field.is_filterable ? 1 : 0,
          field.is_visible ? 1 : 0,
          0
        );

        // Get the field ID
        const fieldRecord = getFieldIdStmt.get(organizationId, field.field_name) as { id: number } | undefined;
        if (fieldRecord) {
          fieldIds.push(fieldRecord.id);
          created++;

          // Create options for select fields
          if (field.field_type === 'select' && field.options && field.options.length > 0) {
            field.options.forEach((value, index) => {
              insertOptionStmt.run(fieldRecord.id, value, value, index);
            });
          }
        }
      }
    });

    transaction();

    dbLogger.info({ organizationId, created, total: fields.length }, 'Organization fields created');
    return { created, fieldIds };
  }

  // ============ ONBOARDING METHODS ============

  async getOnboardingStatus(organizationId: number): Promise<{
    stage: string;
    completed: boolean;
    industry_template_id: number | null;
  } | null> {
    // Use Supabase if configured
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getOnboardingStatus(organizationId);
    }

    if (!this.sqlite) return null;

    const result = this.sqlite.prepare(`
      SELECT onboarding_stage, onboarding_completed, industry_template_id
      FROM organizations WHERE id = ?
    `).get(organizationId) as {
      onboarding_stage: string;
      onboarding_completed: number;
      industry_template_id: number | null;
    } | undefined;

    if (!result) return null;

    return {
      stage: result.onboarding_stage || 'not_started',
      completed: !!result.onboarding_completed,
      industry_template_id: result.industry_template_id,
    };
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
    // Use Supabase if configured
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.updateOnboardingStage(organizationId, stage, additionalData);
    }

    if (!this.sqlite) return false;

    const fields: string[] = ['onboarding_stage = ?'];
    const values: unknown[] = [stage];

    if (additionalData) {
      if (additionalData.onboarding_completed !== undefined) {
        fields.push('onboarding_completed = ?');
        values.push(additionalData.onboarding_completed ? 1 : 0);
      }
      if (additionalData.industry_template_id !== undefined) {
        fields.push('industry_template_id = ?');
        values.push(additionalData.industry_template_id);
      }
      if (additionalData.company_address !== undefined) {
        fields.push('company_address = ?');
        values.push(additionalData.company_address);
      }
      if (additionalData.company_postnummer !== undefined) {
        fields.push('company_postnummer = ?');
        values.push(additionalData.company_postnummer);
      }
      if (additionalData.company_poststed !== undefined) {
        fields.push('company_poststed = ?');
        values.push(additionalData.company_poststed);
      }
      if (additionalData.map_center_lat !== undefined) {
        fields.push('map_center_lat = ?');
        values.push(additionalData.map_center_lat);
      }
      if (additionalData.map_center_lng !== undefined) {
        fields.push('map_center_lng = ?');
        values.push(additionalData.map_center_lng);
      }
      if (additionalData.map_zoom !== undefined) {
        fields.push('map_zoom = ?');
        values.push(additionalData.map_zoom);
      }
      if (additionalData.route_start_lat !== undefined) {
        fields.push('route_start_lat = ?');
        values.push(additionalData.route_start_lat);
      }
      if (additionalData.route_start_lng !== undefined) {
        fields.push('route_start_lng = ?');
        values.push(additionalData.route_start_lng);
      }
    }

    values.push(organizationId);

    try {
      const result = this.sqlite.prepare(`
        UPDATE organizations SET ${fields.join(', ')} WHERE id = ?
      `).run(...values);

      return result.changes > 0;
    } catch (error) {
      dbLogger.error({ error, organizationId, stage }, 'Failed to update onboarding stage');
      return false;
    }
  }

  async completeOnboarding(organizationId: number): Promise<boolean> {
    // Use Supabase if configured
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.completeOnboarding(organizationId);
    }
    return this.updateOnboardingStage(organizationId, 'completed', { onboarding_completed: true });
  }

  // ============ RUTER METHODS ============

  /**
   * Get all routes for an organization.
   * SECURITY: organizationId is required to prevent cross-tenant data access.
   */
  async getAllRuter(organizationId: number): Promise<(Rute & { antall_kunder: number })[]> {
    this.validateTenantContext(organizationId, 'getAllRuter');

    if (!this.sqlite) throw new Error('Database not initialized');

    const sql = `SELECT r.*, (SELECT COUNT(*) FROM rute_kunder WHERE rute_id = r.id) as antall_kunder
         FROM ruter r WHERE r.organization_id = ?
         ORDER BY r.planlagt_dato DESC, r.opprettet DESC`;

    return this.sqlite.prepare(sql).all(organizationId) as (Rute & { antall_kunder: number })[];
  }

  /**
   * Get a route assigned to a specific user for a given date.
   * Used by the "Today's Work" view for technicians.
   */
  async getRouteForUserByDate(userId: number, date: string, organizationId: number): Promise<Rute | null> {
    this.validateTenantContext(organizationId, 'getRouteForUserByDate');

    if (!this.sqlite) throw new Error('Database not initialized');

    const sql = `SELECT * FROM ruter
      WHERE assigned_to = ? AND planned_date = ? AND organization_id = ?
      LIMIT 1`;

    const result = this.sqlite.prepare(sql).get(userId, date, organizationId);
    return (result as Rute) || null;
  }

  /**
   * Get a route by ID.
   * SECURITY: organizationId is required to prevent cross-tenant data access.
   */
  async getRuteById(id: number, organizationId: number): Promise<Rute | null> {
    this.validateTenantContext(organizationId, 'getRuteById');

    if (!this.sqlite) throw new Error('Database not initialized');

    const sql = 'SELECT * FROM ruter WHERE id = ? AND organization_id = ?';
    const result = this.sqlite.prepare(sql).get(id, organizationId);

    return (result as Rute) || null;
  }

  async createRute(data: Partial<Rute> & { kunde_ids?: number[] }): Promise<Rute> {
    if (!this.sqlite) throw new Error('Database not initialized');

    const stmt = this.sqlite.prepare(`
      INSERT INTO ruter (navn, beskrivelse, planlagt_dato, total_distanse, total_tid, organization_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.navn,
      data.beskrivelse,
      data.planlagt_dato,
      data.total_distanse,
      data.total_tid,
      data.organization_id
    );

    return { ...data, id: Number(result.lastInsertRowid), status: 'planlagt' } as Rute;
  }

  /**
   * Update a route.
   * SECURITY: organizationId is required to prevent cross-tenant data modification.
   */
  async updateRute(id: number, data: Partial<Rute>, organizationId: number): Promise<Rute | null> {
    this.validateTenantContext(organizationId, 'updateRute');

    const existing = await this.getRuteById(id, organizationId);
    if (!existing) return null;

    if (!this.sqlite) throw new Error('Database not initialized');

    const fields: string[] = [];
    const values: unknown[] = [];

    const updateableFields = ['navn', 'beskrivelse', 'planlagt_dato', 'status', 'total_distanse', 'total_tid', 'execution_started_at', 'execution_ended_at', 'current_stop_index'];

    for (const field of updateableFields) {
      if (field in data) {
        fields.push(`${field} = ?`);
        values.push((data as Record<string, unknown>)[field]);
      }
    }

    if (fields.length === 0) return existing;

    values.push(id);
    const sql = `UPDATE ruter SET ${fields.join(', ')} WHERE id = ?`;
    this.sqlite.prepare(sql).run(...values);

    return this.getRuteById(id, organizationId);
  }

  /**
   * Delete a route.
   * SECURITY: organizationId is required to prevent cross-tenant data deletion.
   */
  async deleteRute(id: number, organizationId: number): Promise<boolean> {
    this.validateTenantContext(organizationId, 'deleteRute');

    if (!this.sqlite) throw new Error('Database not initialized');

    // Verify ownership first
    const existing = await this.getRuteById(id, organizationId);
    if (!existing) return false;

    // Delete rute_kunder first (cascade might not work in all SQLite versions)
    this.sqlite.prepare('DELETE FROM rute_kunder WHERE rute_id = ?').run(id);

    const sql = 'DELETE FROM ruter WHERE id = ? AND organization_id = ?';
    const result = this.sqlite.prepare(sql).run(id, organizationId);

    return result.changes > 0;
  }

  async getRuteKunder(ruteId: number): Promise<(Kunde & { rekkefolge: number })[]> {
    if (!this.sqlite) throw new Error('Database not initialized');

    return this.sqlite.prepare(`
      SELECT k.*, rk.rekkefolge
      FROM rute_kunder rk
      JOIN kunder k ON k.id = rk.kunde_id
      WHERE rk.rute_id = ?
      ORDER BY rk.rekkefolge
    `).all(ruteId) as (Kunde & { rekkefolge: number })[];
  }

  /**
   * Set customers for a route.
   * SECURITY: organizationId is required to prevent cross-tenant data modification.
   */
  async setRuteKunder(ruteId: number, kundeIds: number[], organizationId: number): Promise<void> {
    this.validateTenantContext(organizationId, 'setRuteKunder');

    if (!this.sqlite) throw new Error('Database not initialized');

    // Verify route ownership first
    const rute = await this.getRuteById(ruteId, organizationId);
    if (!rute) throw new Error('Route not found or access denied');

    // Clear existing
    this.sqlite.prepare('DELETE FROM rute_kunder WHERE rute_id = ?').run(ruteId);

    // Insert new
    const insertStmt = this.sqlite.prepare(`
      INSERT INTO rute_kunder (rute_id, kunde_id, rekkefolge, organization_id)
      VALUES (?, ?, ?, ?)
    `);

    kundeIds.forEach((kundeId, index) => {
      insertStmt.run(ruteId, kundeId, index + 1, organizationId);
    });
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
    this.validateTenantContext(organizationId, 'completeRute');

    const rute = await this.getRuteById(id, organizationId);
    if (!rute) return { success: false, oppdaterte_kunder: 0 };

    if (!this.sqlite) throw new Error('Database not initialized');

    const kunder = await this.getRuteKunder(id);

    const updateStmt = this.sqlite.prepare(`
      UPDATE kunder SET
        last_visit_date = ?,
        siste_el_kontroll = CASE WHEN ? IN ('el', 'both') THEN ? ELSE siste_el_kontroll END,
        neste_el_kontroll = CASE WHEN ? IN ('el', 'both') THEN date(?, '+' || COALESCE(el_kontroll_intervall, 36) || ' months') ELSE neste_el_kontroll END,
        siste_brann_kontroll = CASE WHEN ? IN ('brann', 'both') THEN ? ELSE siste_brann_kontroll END,
        neste_brann_kontroll = CASE WHEN ? IN ('brann', 'both') THEN date(?, '+' || COALESCE(brann_kontroll_intervall, 12) || ' months') ELSE neste_brann_kontroll END,
        siste_kontroll = ?,
        neste_kontroll = date(?, '+' || COALESCE(kontroll_intervall_mnd, 12) || ' months')
      WHERE id = ?
    `);

    for (const kunde of kunder) {
      updateStmt.run(
        dato,
        kontrollType, dato,
        kontrollType, dato,
        kontrollType, dato,
        kontrollType, dato,
        dato,
        dato,
        kunde.id
      );
    }

    this.sqlite.prepare('UPDATE ruter SET status = ? WHERE id = ?').run('fullført', id);

    return { success: true, oppdaterte_kunder: kunder.length };
  }

  // ============ FIELD WORK VISIT METHODS ============

  async createVisitRecords(ruteId: number, kundeIds: number[], organizationId: number): Promise<void> {
    this.validateTenantContext(organizationId, 'createVisitRecords');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      // Delete old visit records first to reset state
      await client.from('rute_kunde_visits')
        .delete()
        .eq('rute_id', ruteId)
        .eq('organization_id', organizationId);
      const records = kundeIds.map(kundeId => ({
        rute_id: ruteId,
        kunde_id: kundeId,
        organization_id: organizationId,
        completed: false,
      }));
      await client.from('rute_kunde_visits').insert(records);
      return;
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    // Delete old visit records first to reset state
    this.sqlite.prepare(
      'DELETE FROM rute_kunde_visits WHERE rute_id = ? AND organization_id = ?'
    ).run(ruteId, organizationId);

    const stmt = this.sqlite.prepare(
      'INSERT INTO rute_kunde_visits (rute_id, kunde_id, organization_id, completed) VALUES (?, ?, ?, 0)'
    );
    for (const kundeId of kundeIds) {
      stmt.run(ruteId, kundeId, organizationId);
    }
  }

  async upsertVisitRecord(
    ruteId: number,
    kundeId: number,
    organizationId: number,
    data: { visited_at: string; completed: boolean; comment?: string; materials_used?: string[]; equipment_registered?: string[]; todos?: string[] }
  ): Promise<{ id: number }> {
    this.validateTenantContext(organizationId, 'upsertVisitRecord');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data: result, error } = await client
        .from('rute_kunde_visits')
        .upsert({
          rute_id: ruteId,
          kunde_id: kundeId,
          organization_id: organizationId,
          ...data,
        }, { onConflict: 'rute_id,kunde_id' })
        .select('id')
        .single();
      if (error) throw error;
      return { id: result.id };
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    // Try to update existing record
    const existing = this.sqlite.prepare(
      'SELECT id FROM rute_kunde_visits WHERE rute_id = ? AND kunde_id = ?'
    ).get(ruteId, kundeId) as { id: number } | undefined;

    if (existing) {
      this.sqlite.prepare(`
        UPDATE rute_kunde_visits SET
          visited_at = ?, completed = ?, comment = ?,
          materials_used = ?, equipment_registered = ?, todos = ?
        WHERE id = ?
      `).run(
        data.visited_at, data.completed ? 1 : 0, data.comment || null,
        data.materials_used ? JSON.stringify(data.materials_used) : null,
        data.equipment_registered ? JSON.stringify(data.equipment_registered) : null,
        data.todos ? JSON.stringify(data.todos) : null,
        existing.id
      );
      return { id: existing.id };
    }

    const result = this.sqlite.prepare(`
      INSERT INTO rute_kunde_visits (rute_id, kunde_id, organization_id, visited_at, completed, comment, materials_used, equipment_registered, todos)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ruteId, kundeId, organizationId,
      data.visited_at, data.completed ? 1 : 0, data.comment || null,
      data.materials_used ? JSON.stringify(data.materials_used) : null,
      data.equipment_registered ? JSON.stringify(data.equipment_registered) : null,
      data.todos ? JSON.stringify(data.todos) : null,
    );

    return { id: Number(result.lastInsertRowid) };
  }

  async getVisitRecords(ruteId: number, organizationId: number): Promise<Array<{
    id: number; kunde_id: number; visited_at?: string; completed: boolean;
    comment?: string; materials_used?: string[]; equipment_registered?: string[]; todos?: string[];
  }>> {
    this.validateTenantContext(organizationId, 'getVisitRecords');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data, error } = await client
        .from('rute_kunde_visits')
        .select('*')
        .eq('rute_id', ruteId)
        .eq('organization_id', organizationId);
      if (error) throw error;
      return data || [];
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const rows = this.sqlite.prepare(
      'SELECT * FROM rute_kunde_visits WHERE rute_id = ? AND organization_id = ?'
    ).all(ruteId, organizationId) as Array<Record<string, unknown>>;

    return rows.map(row => ({
      id: row.id as number,
      kunde_id: row.kunde_id as number,
      visited_at: row.visited_at as string | undefined,
      completed: Boolean(row.completed),
      comment: row.comment as string | undefined,
      materials_used: row.materials_used ? JSON.parse(row.materials_used as string) : undefined,
      equipment_registered: row.equipment_registered ? JSON.parse(row.equipment_registered as string) : undefined,
      todos: row.todos ? JSON.parse(row.todos as string) : undefined,
    }));
  }

  // ============ CUSTOMER EMAIL TEMPLATES ============

  async getEmailTemplates(organizationId: number): Promise<Array<{
    id: number; organization_id: number | null; name: string; subject_template: string;
    body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
  }>> {
    this.validateTenantContext(organizationId, 'getEmailTemplates');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data, error } = await client
        .from('customer_email_templates')
        .select('*')
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .eq('aktiv', true)
        .order('sort_order');
      if (error) throw error;
      return data || [];
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    return this.sqlite.prepare(
      'SELECT * FROM customer_email_templates WHERE (organization_id IS NULL OR organization_id = ?) AND aktiv = 1 ORDER BY sort_order'
    ).all(organizationId) as Array<{
      id: number; organization_id: number | null; name: string; subject_template: string;
      body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
    }>;
  }

  async getEmailTemplateById(id: number, organizationId: number): Promise<{
    id: number; organization_id: number | null; name: string; subject_template: string;
    body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
  } | null> {
    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data, error } = await client
        .from('customer_email_templates')
        .select('*')
        .eq('id', id)
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .single();
      if (error) return null;
      return data;
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    return (this.sqlite.prepare(
      'SELECT * FROM customer_email_templates WHERE id = ? AND (organization_id IS NULL OR organization_id = ?)'
    ).get(id, organizationId) as { id: number; organization_id: number | null; name: string; subject_template: string; body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number } | undefined) || null;
  }

  async createEmailTemplate(data: {
    organization_id: number; name: string; subject_template: string;
    body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
  }): Promise<{
    id: number; organization_id: number | null; name: string; subject_template: string;
    body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
  }> {
    this.validateTenantContext(data.organization_id, 'createEmailTemplate');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data: result, error } = await client
        .from('customer_email_templates')
        .insert(data)
        .select()
        .single();
      if (error) throw error;
      return result;
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const result = this.sqlite.prepare(`
      INSERT INTO customer_email_templates (organization_id, name, subject_template, body_template, category, is_system, aktiv, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.organization_id, data.name, data.subject_template, data.body_template,
      data.category, data.is_system ? 1 : 0, data.aktiv ? 1 : 0, data.sort_order
    );

    return { id: Number(result.lastInsertRowid), ...data, organization_id: data.organization_id };
  }

  async updateEmailTemplate(id: number, data: Partial<{
    name: string; subject_template: string; body_template: string; category: string; aktiv: boolean;
  }>, organizationId: number): Promise<{
    id: number; organization_id: number | null; name: string; subject_template: string;
    body_template: string; category: string; is_system: boolean; aktiv: boolean; sort_order: number;
  } | null> {
    this.validateTenantContext(organizationId, 'updateEmailTemplate');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
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

    if (!this.sqlite) throw new Error('Database not initialized');

    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        fields.push(`${key} = ?`);
        values.push(key === 'aktiv' ? (val ? 1 : 0) : val);
      }
    }
    if (fields.length === 0) return this.getEmailTemplateById(id, organizationId);

    values.push(id, organizationId);
    this.sqlite.prepare(
      `UPDATE customer_email_templates SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`
    ).run(...values);

    return this.getEmailTemplateById(id, organizationId);
  }

  async deleteEmailTemplate(id: number, organizationId: number): Promise<boolean> {
    this.validateTenantContext(organizationId, 'deleteEmailTemplate');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { error } = await client
        .from('customer_email_templates')
        .delete()
        .eq('id', id)
        .eq('organization_id', organizationId)
        .eq('is_system', false);
      return !error;
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const result = this.sqlite.prepare(
      'DELETE FROM customer_email_templates WHERE id = ? AND organization_id = ? AND is_system = 0'
    ).run(id, organizationId);
    return result.changes > 0;
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
    this.validateTenantContext(data.organization_id, 'logSentEmail');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data: result, error } = await client
        .from('customer_emails_sent')
        .insert(data)
        .select()
        .single();
      if (error) throw error;
      return result;
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const result = this.sqlite.prepare(`
      INSERT INTO customer_emails_sent (organization_id, kunde_id, template_id, to_email, subject, body_html, status, error_message, sent_by, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.organization_id, data.kunde_id, data.template_id, data.to_email,
      data.subject, data.body_html, data.status, data.error_message, data.sent_by, data.sent_at
    );

    return { id: Number(result.lastInsertRowid), ...data };
  }

  async getSentEmails(organizationId: number, kundeId?: number, limit = 50): Promise<Array<{
    id: number; organization_id: number; kunde_id: number; template_id: number | null;
    to_email: string; subject: string; body_html: string; status: string;
    error_message: string | null; sent_by: number | null; sent_at: string;
  }>> {
    this.validateTenantContext(organizationId, 'getSentEmails');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
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

    if (!this.sqlite) throw new Error('Database not initialized');

    const params: unknown[] = [organizationId];
    let sql = 'SELECT * FROM customer_emails_sent WHERE organization_id = ?';
    if (kundeId) {
      sql += ' AND kunde_id = ?';
      params.push(kundeId);
    }
    sql += ' ORDER BY sent_at DESC LIMIT ?';
    params.push(limit);

    return this.sqlite.prepare(sql).all(...params) as Array<{
      id: number; organization_id: number; kunde_id: number; template_id: number | null;
      to_email: string; subject: string; body_html: string; status: string;
      error_message: string | null; sent_by: number | null; sent_at: string;
    }>;
  }

  async getEnabledFeaturesWithConfig(organizationId: number): Promise<{ key: string; config: Record<string, unknown> }[]> {
    this.validateTenantContext(organizationId, 'getEnabledFeaturesWithConfig');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      // Get explicitly enabled features
      const { data: orgFeatures } = await client
        .from('organization_features')
        .select('feature_key, config')
        .eq('organization_id', organizationId)
        .eq('enabled', true);
      // Get default-enabled features
      const { data: defaults } = await client
        .from('feature_definitions')
        .select('key')
        .eq('default_enabled', true)
        .eq('aktiv', true);

      const result: { key: string; config: Record<string, unknown> }[] = [];
      const seen = new Set<string>();

      for (const f of orgFeatures || []) {
        result.push({ key: f.feature_key, config: f.config || {} });
        seen.add(f.feature_key);
      }
      for (const d of defaults || []) {
        if (!seen.has(d.key)) {
          result.push({ key: d.key, config: {} });
        }
      }
      return result;
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    // Combine org-specific features + default-enabled features
    const rows = this.sqlite.prepare(`
      SELECT DISTINCT COALESCE(of2.feature_key, fd.key) as key, COALESCE(of2.config, '{}') as config
      FROM feature_definitions fd
      LEFT JOIN organization_features of2 ON fd.key = of2.feature_key AND of2.organization_id = ? AND of2.enabled = 1
      WHERE fd.aktiv = 1 AND (of2.enabled = 1 OR fd.default_enabled = 1)
    `).all(organizationId) as Array<{ key: string; config: string }>;

    return rows.map(r => ({ key: r.key, config: JSON.parse(r.config || '{}') }));
  }

  // ============ EKK REPORTS ============

  async getEkkReports(organizationId: number, kundeId?: number): Promise<Array<Record<string, unknown>>> {
    this.validateTenantContext(organizationId, 'getEkkReports');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      let query = client.from('ekk_reports').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false });
      if (kundeId) query = query.eq('kunde_id', kundeId);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }

    if (!this.sqlite) throw new Error('Database not initialized');
    const params: unknown[] = [organizationId];
    let sql = 'SELECT * FROM ekk_reports WHERE organization_id = ?';
    if (kundeId) { sql += ' AND kunde_id = ?'; params.push(kundeId); }
    sql += ' ORDER BY created_at DESC';
    return this.sqlite.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  }

  async getEkkReportById(id: number, organizationId: number): Promise<Record<string, unknown> | null> {
    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data, error } = await client.from('ekk_reports').select('*').eq('id', id).eq('organization_id', organizationId).single();
      if (error) return null;
      return data;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return (this.sqlite.prepare('SELECT * FROM ekk_reports WHERE id = ? AND organization_id = ?').get(id, organizationId) as Record<string, unknown> | undefined) || null;
  }

  async createEkkReport(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.validateTenantContext(data.organization_id as number, 'createEkkReport');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data: result, error } = await client.from('ekk_reports').insert(data).select().single();
      if (error) throw error;
      return result;
    }
    if (!this.sqlite) throw new Error('Database not initialized');

    const result = this.sqlite.prepare(`
      INSERT INTO ekk_reports (organization_id, kunde_id, report_type, status, notes, checklist_data, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.organization_id, data.kunde_id, data.report_type || 'elkontroll',
      data.status || 'utkast', data.notes || null,
      JSON.stringify(data.checklist_data || {}), data.created_by || null
    );
    return { id: Number(result.lastInsertRowid), ...data };
  }

  async updateEkkReport(id: number, data: Record<string, unknown>, organizationId: number): Promise<Record<string, unknown> | null> {
    this.validateTenantContext(organizationId, 'updateEkkReport');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data: result, error } = await client.from('ekk_reports').update(data).eq('id', id).eq('organization_id', organizationId).select().single();
      if (error) return null;
      return result;
    }
    if (!this.sqlite) throw new Error('Database not initialized');

    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        fields.push(`${key} = ?`);
        values.push(key === 'checklist_data' ? JSON.stringify(val) : val);
      }
    }
    if (fields.length === 0) return this.getEkkReportById(id, organizationId);
    values.push(id, organizationId);
    this.sqlite.prepare(`UPDATE ekk_reports SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`).run(...values);
    return this.getEkkReportById(id, organizationId);
  }

  async deleteEkkReport(id: number, organizationId: number): Promise<boolean> {
    this.validateTenantContext(organizationId, 'deleteEkkReport');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { error } = await client.from('ekk_reports').delete().eq('id', id).eq('organization_id', organizationId);
      return !error;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const result = this.sqlite.prepare('DELETE FROM ekk_reports WHERE id = ? AND organization_id = ?').run(id, organizationId);
    return result.changes > 0;
  }

  // ============ OUTLOOK SYNC ============

  async getOutlookSyncEntries(organizationId: number): Promise<Array<Record<string, unknown>>> {
    this.validateTenantContext(organizationId, 'getOutlookSyncEntries');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data, error } = await client.from('outlook_sync_log').select('*').eq('organization_id', organizationId);
      if (error) throw error;
      return data || [];
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return this.sqlite.prepare('SELECT * FROM outlook_sync_log WHERE organization_id = ?').all(organizationId) as Array<Record<string, unknown>>;
  }

  async getOutlookSyncEntry(organizationId: number, kundeId: number): Promise<Record<string, unknown> | null> {
    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data, error } = await client.from('outlook_sync_log').select('*').eq('organization_id', organizationId).eq('kunde_id', kundeId).single();
      if (error) return null;
      return data;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return (this.sqlite.prepare('SELECT * FROM outlook_sync_log WHERE organization_id = ? AND kunde_id = ?').get(organizationId, kundeId) as Record<string, unknown> | undefined) || null;
  }

  async upsertOutlookSyncEntry(data: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.validateTenantContext(data.organization_id as number, 'upsertOutlookSyncEntry');

    if (this.type === 'supabase' && this.supabase) {
      const client = await this.getSupabaseClient();
      const { data: result, error } = await client.from('outlook_sync_log')
        .upsert(data, { onConflict: 'organization_id,kunde_id' }).select().single();
      if (error) throw error;
      return result;
    }
    if (!this.sqlite) throw new Error('Database not initialized');

    const existing = this.sqlite.prepare(
      'SELECT id FROM outlook_sync_log WHERE organization_id = ? AND kunde_id = ?'
    ).get(data.organization_id, data.kunde_id) as { id: number } | undefined;

    if (existing) {
      this.sqlite.prepare(`
        UPDATE outlook_sync_log SET outlook_contact_id = ?, last_synced_at = ?, sync_status = ?, error_message = ?
        WHERE id = ?
      `).run(data.outlook_contact_id, data.last_synced_at, data.sync_status, data.error_message, existing.id);
      return { id: existing.id, ...data };
    }

    const result = this.sqlite.prepare(`
      INSERT INTO outlook_sync_log (organization_id, kunde_id, outlook_contact_id, last_synced_at, sync_status, error_message)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(data.organization_id, data.kunde_id, data.outlook_contact_id, data.last_synced_at, data.sync_status, data.error_message);
    return { id: Number(result.lastInsertRowid), ...data };
  }

  // ============ AVTALER METHODS ============

  async getAllAvtaler(organizationId: number, start?: string, end?: string): Promise<(Avtale & { kunde_navn?: string })[]> {
    this.validateTenantContext(organizationId, 'getAllAvtaler');

    if (!this.sqlite) throw new Error('Database not initialized');

    let sql = `
      SELECT a.*, k.navn as kunde_navn, k.adresse, k.postnummer, k.poststed, k.telefon, k.kategori
      FROM avtaler a
      LEFT JOIN kunder k ON a.kunde_id = k.id
      WHERE a.organization_id = ?
    `;
    const params: unknown[] = [organizationId];

    if (start) {
      sql += ' AND a.dato >= ?';
      params.push(start);
    }
    if (end) {
      sql += ' AND a.dato <= ?';
      params.push(end);
    }

    sql += ' ORDER BY a.dato, a.klokkeslett';

    return this.sqlite.prepare(sql).all(...params) as (Avtale & { kunde_navn?: string })[];
  }

  async getAvtaleById(id: number, organizationId: number): Promise<(Avtale & { kunde_navn?: string }) | null> {
    this.validateTenantContext(organizationId, 'getAvtaleById');

    if (!this.sqlite) throw new Error('Database not initialized');

    const sql = `SELECT a.*, k.navn as kunde_navn, k.adresse, k.postnummer, k.poststed, k.telefon, k.kategori
       FROM avtaler a LEFT JOIN kunder k ON a.kunde_id = k.id
       WHERE a.id = ? AND a.organization_id = ?`;

    const result = this.sqlite.prepare(sql).get(id, organizationId);

    return (result as (Avtale & { kunde_navn?: string })) || null;
  }

  async createAvtale(data: Partial<Avtale> & { organization_id: number }): Promise<Avtale & { kunde_navn?: string }> {
    this.validateTenantContext(data.organization_id, 'createAvtale');

    if (!this.sqlite) throw new Error('Database not initialized');

    const stmt = this.sqlite.prepare(`
      INSERT INTO avtaler (kunde_id, dato, klokkeslett, type, beskrivelse, status, opprettet_av, organization_id,
        er_gjentakelse, gjentakelse_regel, gjentakelse_slutt, original_avtale_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.kunde_id,
      data.dato,
      data.klokkeslett,
      data.type || 'El-Kontroll',
      data.beskrivelse,
      data.status || 'planlagt',
      data.opprettet_av,
      data.organization_id,
      data.er_gjentakelse ? 1 : 0,
      data.gjentakelse_regel || null,
      data.gjentakelse_slutt || null,
      data.original_avtale_id || null
    );

    const avtale = await this.getAvtaleById(Number(result.lastInsertRowid), data.organization_id);
    return avtale!;
  }

  async updateAvtale(id: number, data: Partial<Avtale>, organizationId: number): Promise<(Avtale & { kunde_navn?: string }) | null> {
    this.validateTenantContext(organizationId, 'updateAvtale');

    const existing = await this.getAvtaleById(id, organizationId);
    if (!existing) return null;

    if (!this.sqlite) throw new Error('Database not initialized');

    const fields: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const values: unknown[] = [];

    const updateableFields = ['kunde_id', 'dato', 'klokkeslett', 'type', 'beskrivelse', 'status', 'er_gjentakelse', 'gjentakelse_regel', 'gjentakelse_slutt'];

    for (const field of updateableFields) {
      if (field in data) {
        fields.push(`${field} = ?`);
        values.push((data as Record<string, unknown>)[field]);
      }
    }

    values.push(id, organizationId);
    const sql = `UPDATE avtaler SET ${fields.join(', ')} WHERE id = ? AND organization_id = ?`;
    this.sqlite.prepare(sql).run(...values);

    return this.getAvtaleById(id, organizationId);
  }

  async deleteAvtale(id: number, organizationId: number): Promise<boolean> {
    this.validateTenantContext(organizationId, 'deleteAvtale');

    if (!this.sqlite) throw new Error('Database not initialized');

    const sql = 'DELETE FROM avtaler WHERE id = ? AND organization_id = ?';
    const result = this.sqlite.prepare(sql).run(id, organizationId);

    return result.changes > 0;
  }

  async completeAvtale(id: number, organizationId: number): Promise<boolean> {
    this.validateTenantContext(organizationId, 'completeAvtale');

    if (!this.sqlite) throw new Error('Database not initialized');

    const sql = `UPDATE avtaler SET status = 'fullført', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND organization_id = ?`;
    const result = this.sqlite.prepare(sql).run(id, organizationId);

    return result.changes > 0;
  }

  async deleteAvtaleSeries(parentId: number, organizationId: number): Promise<number> {
    this.validateTenantContext(organizationId, 'deleteAvtaleSeries');

    if (!this.sqlite) throw new Error('Database not initialized');

    // Delete all instances linked to this parent, plus the parent itself
    const resultInstances = this.sqlite.prepare(
      'DELETE FROM avtaler WHERE original_avtale_id = ? AND organization_id = ?'
    ).run(parentId, organizationId);

    const resultParent = this.sqlite.prepare(
      'DELETE FROM avtaler WHERE id = ? AND organization_id = ?'
    ).run(parentId, organizationId);

    return resultInstances.changes + resultParent.changes;
  }

  // ============ KONTAKTLOGG METHODS ============

  async getKontaktloggByKunde(kundeId: number, organizationId: number): Promise<Kontaktlogg[]> {
    if (!this.sqlite) throw new Error('Database not initialized');

    // Sikkerhet: Alltid filtrer på organization_id for å forhindre data-lekkasje
    return this.sqlite.prepare(`
      SELECT * FROM kontaktlogg
      WHERE kunde_id = ? AND organization_id = ?
      ORDER BY dato DESC
    `).all(kundeId, organizationId) as Kontaktlogg[];
  }

  async createKontaktlogg(data: Partial<Kontaktlogg> & { kunde_id: number; organization_id: number }): Promise<Kontaktlogg> {
    if (!this.sqlite) throw new Error('Database not initialized');

    const stmt = this.sqlite.prepare(`
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

    const kontakt = this.sqlite.prepare('SELECT * FROM kontaktlogg WHERE id = ?').get(result.lastInsertRowid);
    return kontakt as Kontaktlogg;
  }

  async deleteKontaktlogg(id: number, organizationId: number): Promise<boolean> {
    this.validateTenantContext(organizationId, 'deleteKontaktlogg');

    if (!this.sqlite) throw new Error('Database not initialized');

    const sql = 'DELETE FROM kontaktlogg WHERE id = ? AND organization_id = ?';
    const result = this.sqlite.prepare(sql).run(id, organizationId);

    return result.changes > 0;
  }

  // ============ EMAIL METHODS ============

  async getEmailInnstillinger(kundeId: number): Promise<EmailInnstilling | null> {
    if (!this.sqlite) throw new Error('Database not initialized');

    const result = this.sqlite.prepare('SELECT * FROM email_innstillinger WHERE kunde_id = ?').get(kundeId);
    return (result as EmailInnstilling) || null;
  }

  async updateEmailInnstillinger(kundeId: number, data: Partial<EmailInnstilling>): Promise<void> {
    if (!this.sqlite) throw new Error('Database not initialized');

    const existing = this.sqlite.prepare('SELECT id FROM email_innstillinger WHERE kunde_id = ?').get(kundeId);

    if (existing) {
      this.sqlite.prepare(`
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
      this.sqlite.prepare(`
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

  async getEmailHistorikk(organizationId: number, kundeId?: number | null, limit = 100): Promise<EmailVarsel[]> {
    if (!this.sqlite) throw new Error('Database not initialized');

    // Sikkerhet: Alltid filtrer på organization_id for å forhindre data-lekkasje
    if (kundeId) {
      return this.sqlite.prepare(`
        SELECT ev.* FROM email_varsler ev
        JOIN kunder k ON ev.kunde_id = k.id
        WHERE ev.kunde_id = ? AND k.organization_id = ?
        ORDER BY ev.opprettet DESC LIMIT ?
      `).all(kundeId, organizationId, limit) as EmailVarsel[];
    }

    return this.sqlite.prepare(`
      SELECT ev.* FROM email_varsler ev
      JOIN kunder k ON ev.kunde_id = k.id
      WHERE k.organization_id = ?
      ORDER BY ev.opprettet DESC LIMIT ?
    `).all(organizationId, limit) as EmailVarsel[];
  }

  async getEmailStats(organizationId: number): Promise<{ pending: number; sent: number; failed: number }> {
    if (!this.sqlite) throw new Error('Database not initialized');

    // Sikkerhet: Kun tell e-poster for denne organisasjonen
    const stats = this.sqlite.prepare(`
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

  async getUpcomingEmails(organizationId: number, daysAhead: number): Promise<(Kunde & { dager_til_kontroll: number })[]> {
    if (!this.sqlite) throw new Error('Database not initialized');

    // Sikkerhet: Kun hent kunder for denne organisasjonen
    return this.sqlite.prepare(`
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

  // ============ MAPPING CACHE METHODS ============

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
    if (!this.sqlite) return null;

    const result = this.sqlite.prepare(`
      SELECT * FROM mapping_cache
      WHERE organization_id = ? AND LOWER(excel_header) = LOWER(?)
    `).get(organizationId, excelHeader) as {
      id: number;
      organization_id: number;
      excel_header: string;
      normalized_header: string;
      target_field: string;
      field_type: string;
      data_type: string | null;
      confidence: number;
      usage_count: number;
      confirmed_by_user: number;
      created_at: string;
      last_used_at: string;
    } | undefined;

    if (!result) return null;

    return {
      id: result.id,
      organizationId: result.organization_id,
      excelHeader: result.excel_header,
      normalizedHeader: result.normalized_header,
      targetField: result.target_field,
      fieldType: result.field_type,
      dataType: result.data_type,
      confidence: result.confidence,
      usageCount: result.usage_count,
      confirmedByUser: !!result.confirmed_by_user,
      createdAt: new Date(result.created_at),
      lastUsedAt: new Date(result.last_used_at),
    };
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
    if (!this.sqlite) return null;

    const result = this.sqlite.prepare(`
      SELECT * FROM mapping_cache
      WHERE organization_id = ? AND normalized_header = ?
    `).get(organizationId, normalizedHeader) as {
      id: number;
      organization_id: number;
      excel_header: string;
      normalized_header: string;
      target_field: string;
      field_type: string;
      data_type: string | null;
      confidence: number;
      usage_count: number;
      confirmed_by_user: number;
      created_at: string;
      last_used_at: string;
    } | undefined;

    if (!result) return null;

    return {
      id: result.id,
      organizationId: result.organization_id,
      excelHeader: result.excel_header,
      normalizedHeader: result.normalized_header,
      targetField: result.target_field,
      fieldType: result.field_type,
      dataType: result.data_type,
      confidence: result.confidence,
      usageCount: result.usage_count,
      confirmedByUser: !!result.confirmed_by_user,
      createdAt: new Date(result.created_at),
      lastUsedAt: new Date(result.last_used_at),
    };
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
    if (!this.sqlite) return [];

    const results = this.sqlite.prepare(`
      SELECT * FROM mapping_cache
      WHERE organization_id = ?
      ORDER BY usage_count DESC, last_used_at DESC
    `).all(organizationId) as Array<{
      id: number;
      organization_id: number;
      excel_header: string;
      normalized_header: string;
      target_field: string;
      field_type: string;
      data_type: string | null;
      confidence: number;
      usage_count: number;
      confirmed_by_user: number;
      created_at: string;
      last_used_at: string;
    }>;

    return results.map(r => ({
      id: r.id,
      organizationId: r.organization_id,
      excelHeader: r.excel_header,
      normalizedHeader: r.normalized_header,
      targetField: r.target_field,
      fieldType: r.field_type,
      dataType: r.data_type,
      confidence: r.confidence,
      usageCount: r.usage_count,
      confirmedByUser: !!r.confirmed_by_user,
      createdAt: new Date(r.created_at),
      lastUsedAt: new Date(r.last_used_at),
    }));
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
    if (!this.sqlite) return 0;

    const result = this.sqlite.prepare(`
      INSERT INTO mapping_cache (
        organization_id, excel_header, normalized_header, target_field,
        field_type, data_type, confidence, usage_count, confirmed_by_user
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.organizationId,
      data.excelHeader,
      data.normalizedHeader,
      data.targetField,
      data.fieldType,
      data.dataType || null,
      data.confidence || 0.5,
      data.usageCount || 1,
      data.confirmedByUser ? 1 : 0
    );

    return Number(result.lastInsertRowid);
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
    if (!this.sqlite) return false;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.targetField !== undefined) {
      fields.push('target_field = ?');
      values.push(data.targetField);
    }
    if (data.fieldType !== undefined) {
      fields.push('field_type = ?');
      values.push(data.fieldType);
    }
    if (data.dataType !== undefined) {
      fields.push('data_type = ?');
      values.push(data.dataType);
    }
    if (data.confidence !== undefined) {
      fields.push('confidence = ?');
      values.push(data.confidence);
    }
    if (data.usageCount !== undefined) {
      fields.push('usage_count = ?');
      values.push(data.usageCount);
    }
    if (data.confirmedByUser !== undefined) {
      fields.push('confirmed_by_user = ?');
      values.push(data.confirmedByUser ? 1 : 0);
    }
    if (data.lastUsedAt !== undefined) {
      fields.push('last_used_at = ?');
      values.push(data.lastUsedAt.toISOString());
    }

    if (fields.length === 0) return false;

    values.push(id);

    const result = this.sqlite.prepare(`
      UPDATE mapping_cache SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return result.changes > 0;
  }

  /**
   * Delete old mapping cache entries
   */
  async deleteOldMappingCache(olderThan: Date, organizationId?: number): Promise<number> {
    if (!this.sqlite) return 0;

    const sql = organizationId
      ? `DELETE FROM mapping_cache WHERE last_used_at < ? AND organization_id = ? AND confirmed_by_user = 0`
      : `DELETE FROM mapping_cache WHERE last_used_at < ? AND confirmed_by_user = 0`;

    const result = organizationId
      ? this.sqlite.prepare(sql).run(olderThan.toISOString(), organizationId)
      : this.sqlite.prepare(sql).run(olderThan.toISOString());

    return result.changes;
  }

  // ============ INTEGRATION METHODS ============

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
    this.validateTenantContext(organizationId, 'getOrganizationIntegrations');

    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client
        .from('organization_integrations')
        .select('id, integration_id, is_active, last_sync_at, sync_frequency_hours')
        .eq('organization_id', organizationId);
      if (error) {
        dbLogger.error({ error, organizationId }, 'Failed to get organization integrations');
        return [];
      }
      return data || [];
    }

    if (!this.sqlite) return [];

    const sql = `
      SELECT id, integration_id, is_active, last_sync_at, sync_frequency_hours
      FROM organization_integrations
      WHERE organization_id = ?
    `;
    return this.sqlite.prepare(sql).all(organizationId) as Array<{
      id: number;
      integration_id: string;
      is_active: boolean;
      last_sync_at: string | null;
      sync_frequency_hours: number;
    }>;
  }

  /**
   * Get integration credentials for an organization
   */
  async getIntegrationCredentials(
    organizationId: number,
    integrationId: string
  ): Promise<{ credentials_encrypted: string; is_active: boolean } | null> {
    this.validateTenantContext(organizationId, 'getIntegrationCredentials');

    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client
        .from('organization_integrations')
        .select('credentials_encrypted, is_active')
        .eq('organization_id', organizationId)
        .eq('integration_id', integrationId)
        .single();
      if (error || !data) return null;
      return data;
    }

    if (!this.sqlite) return null;

    const sql = `
      SELECT credentials_encrypted, is_active
      FROM organization_integrations
      WHERE organization_id = ? AND integration_id = ?
    `;
    const result = this.sqlite.prepare(sql).get(organizationId, integrationId) as
      { credentials_encrypted: string; is_active: boolean } | undefined;

    return result || null;
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
    this.validateTenantContext(organizationId, 'saveIntegrationCredentials');

    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { error } = await client
        .from('organization_integrations')
        .upsert({
          organization_id: organizationId,
          integration_id: data.integration_id,
          credentials_encrypted: data.credentials_encrypted,
          is_active: data.is_active,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,integration_id' });
      if (error) {
        dbLogger.error({ error, organizationId }, 'Failed to save integration credentials');
        throw new Error('Kunne ikke lagre integrasjonsnøkler');
      }
      return;
    }

    if (!this.sqlite) return;

    const sql = `
      INSERT INTO organization_integrations (organization_id, integration_id, credentials_encrypted, is_active, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(organization_id, integration_id)
      DO UPDATE SET credentials_encrypted = excluded.credentials_encrypted,
                    is_active = excluded.is_active,
                    updated_at = datetime('now')
    `;
    this.sqlite.prepare(sql).run(
      organizationId,
      data.integration_id,
      data.credentials_encrypted,
      data.is_active ? 1 : 0
    );
  }

  /**
   * Update last sync time for an integration
   */
  async updateIntegrationLastSync(
    organizationId: number,
    integrationId: string,
    syncTime: Date
  ): Promise<void> {
    this.validateTenantContext(organizationId, 'updateIntegrationLastSync');

    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      await client
        .from('organization_integrations')
        .update({ last_sync_at: syncTime.toISOString(), updated_at: new Date().toISOString() })
        .eq('organization_id', organizationId)
        .eq('integration_id', integrationId);
      return;
    }

    if (!this.sqlite) return;

    const sql = `
      UPDATE organization_integrations
      SET last_sync_at = ?, updated_at = datetime('now')
      WHERE organization_id = ? AND integration_id = ?
    `;
    this.sqlite.prepare(sql).run(syncTime.toISOString(), organizationId, integrationId);
  }

  /**
   * Delete integration credentials
   */
  async deleteIntegrationCredentials(
    organizationId: number,
    integrationId: string
  ): Promise<void> {
    this.validateTenantContext(organizationId, 'deleteIntegrationCredentials');

    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      await client
        .from('organization_integrations')
        .delete()
        .eq('organization_id', organizationId)
        .eq('integration_id', integrationId);
      return;
    }

    if (!this.sqlite) return;

    const sql = `
      DELETE FROM organization_integrations
      WHERE organization_id = ? AND integration_id = ?
    `;
    this.sqlite.prepare(sql).run(organizationId, integrationId);
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
    this.validateTenantContext(organizationId, 'logIntegrationSync');

    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data: result, error } = await client
        .from('integration_sync_log')
        .insert({
          organization_id: organizationId,
          integration_id: data.integration_id,
          sync_type: data.sync_type,
          status: data.status,
          created_count: data.created_count ?? 0,
          updated_count: data.updated_count ?? 0,
          unchanged_count: data.unchanged_count ?? 0,
          failed_count: data.failed_count ?? 0,
          error_message: data.error_message ?? null,
          completed_at: data.completed_at?.toISOString() ?? null,
        })
        .select('id')
        .single();
      if (error) {
        dbLogger.error({ error, organizationId }, 'Failed to log integration sync');
        return 0;
      }
      return result?.id ?? 0;
    }

    if (!this.sqlite) return 0;

    const sql = `
      INSERT INTO integration_sync_log
        (organization_id, integration_id, sync_type, status, created_count, updated_count, unchanged_count, failed_count, error_message, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const result = this.sqlite.prepare(sql).run(
      organizationId,
      data.integration_id,
      data.sync_type,
      data.status,
      data.created_count ?? 0,
      data.updated_count ?? 0,
      data.unchanged_count ?? 0,
      data.failed_count ?? 0,
      data.error_message ?? null,
      data.completed_at?.toISOString() ?? null
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Get customer by external ID (for sync)
   */
  async getKundeByExternalId(
    organizationId: number,
    externalSource: string,
    externalId: string
  ): Promise<Kunde | null> {
    this.validateTenantContext(organizationId, 'getKundeByExternalId');

    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client
        .from('kunder')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('external_source', externalSource)
        .eq('external_id', externalId)
        .single();
      if (error || !data) return null;
      return data as Kunde;
    }

    if (!this.sqlite) return null;

    const sql = `
      SELECT * FROM kunder
      WHERE organization_id = ? AND external_source = ? AND external_id = ?
    `;
    const result = this.sqlite.prepare(sql).get(organizationId, externalSource, externalId) as Kunde | undefined;

    return result || null;
  }

  /**
   * Get all kunder with a specific external source (for preview comparison)
   */
  async getKunderByExternalSource(
    organizationId: number,
    externalSource: string
  ): Promise<Array<{ id: number; external_id: string }>> {
    this.validateTenantContext(organizationId, 'getKunderByExternalSource');

    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client
        .from('kunder')
        .select('id, external_id')
        .eq('organization_id', organizationId)
        .eq('external_source', externalSource)
        .not('external_id', 'is', null);
      if (error || !data) return [];
      return data as Array<{ id: number; external_id: string }>;
    }

    if (!this.sqlite) return [];

    const sql = `SELECT id, external_id FROM kunder WHERE organization_id = ? AND external_source = ? AND external_id IS NOT NULL`;
    return this.sqlite.prepare(sql).all(organizationId, externalSource) as Array<{ id: number; external_id: string }>;
  }

  // ============ FAILED SYNC ITEMS (RETRY) ============

  /**
   * Record a failed sync item for later retry.
   * Uses upsert — increments retry_count on conflict.
   * Marks as permanently_failed when max_retries is reached.
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
    this.validateTenantContext(organizationId, 'recordFailedSyncItem');
    if (!this.sqlite) return;

    const sql = `
      INSERT INTO failed_sync_items
        (organization_id, integration_id, external_id, external_source, error_message, last_attempt_at, next_retry_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now', '+1 hour'))
      ON CONFLICT(organization_id, integration_id, external_id)
      DO UPDATE SET
        retry_count = retry_count + 1,
        error_message = excluded.error_message,
        last_attempt_at = datetime('now'),
        next_retry_at = datetime('now', '+' || (MIN(retry_count + 1, 3) * 60) || ' minutes'),
        status = CASE
          WHEN retry_count + 1 >= max_retries THEN 'permanently_failed'
          ELSE 'pending'
        END,
        updated_at = datetime('now')
    `;
    this.sqlite.prepare(sql).run(
      organizationId,
      data.integration_id,
      data.external_id,
      data.external_source,
      data.error_message
    );
  }

  /**
   * Mark a failed sync item as resolved (successfully synced on retry)
   */
  async resolveFailedSyncItem(
    organizationId: number,
    integrationId: string,
    externalId: string
  ): Promise<void> {
    this.validateTenantContext(organizationId, 'resolveFailedSyncItem');
    if (!this.sqlite) return;

    const sql = `
      UPDATE failed_sync_items
      SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
      WHERE organization_id = ? AND integration_id = ? AND external_id = ?
    `;
    this.sqlite.prepare(sql).run(organizationId, integrationId, externalId);
  }

  /**
   * Cleanup old resolved/permanently_failed items
   */
  async cleanupOldFailedSyncItems(daysOld: number = 30): Promise<number> {
    if (!this.sqlite) return 0;

    const sql = `
      DELETE FROM failed_sync_items
      WHERE status IN ('resolved', 'permanently_failed')
        AND updated_at < datetime('now', '-' || ? || ' days')
    `;
    const result = this.sqlite.prepare(sql).run(daysOld);
    return result.changes;
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
    if (!this.sqlite) return [];

    const sql = `
      SELECT id, organization_id, integration_id, credentials_encrypted,
             is_active, last_sync_at, sync_frequency_hours
      FROM organization_integrations
      WHERE is_active = 1
        AND (
          last_sync_at IS NULL
          OR datetime(last_sync_at, '+' || sync_frequency_hours || ' hours') < datetime('now')
        )
    `;
    return this.sqlite.prepare(sql).all() as Array<{
      id: number;
      organization_id: number;
      integration_id: string;
      credentials_encrypted: string;
      is_active: boolean;
      last_sync_at: string | null;
      sync_frequency_hours: number;
    }>;
  }

  // ============ SUPER ADMIN METHODS ============
  // Note: These methods are SQLite-only for now

  /**
   * Get all organizations (for super admin)
   */
  async getAllOrganizations(): Promise<Organization[]> {
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getAllOrganizations();
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    return this.sqlite.prepare(`
      SELECT * FROM organizations
      ORDER BY navn COLLATE NOCASE
    `).all() as Organization[];
  }

  /**
   * Get customer count for an organization (for super admin)
   */
  async getKundeCountForOrganization(organizationId: number): Promise<number> {
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getKundeCountForOrganization(organizationId);
    }

    if (!this.sqlite) return 0;

    const result = this.sqlite.prepare(`
      SELECT COUNT(*) as count FROM kunder WHERE organization_id = ?
    `).get(organizationId) as { count: number };

    return result?.count || 0;
  }

  /**
   * Get user (klient) count for an organization (for super admin)
   */
  async getBrukerCountForOrganization(organizationId: number): Promise<number> {
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getBrukerCountForOrganization(organizationId);
    }

    if (!this.sqlite) return 0;

    const result = this.sqlite.prepare(`
      SELECT COUNT(*) as count FROM klient WHERE organization_id = ? AND aktiv = 1
    `).get(organizationId) as { count: number };

    return result?.count || 0;
  }

  /**
   * Update organization (for super admin)
   */
  async updateOrganization(id: number, data: Record<string, unknown>): Promise<Organization | null> {
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.updateOrganization(id, data);
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(data)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }

    if (fields.length === 0) return this.getOrganizationById(id);

    values.push(id);
    this.sqlite.prepare(`
      UPDATE organizations SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return this.getOrganizationById(id);
  }

  /**
   * Delete organization and all related data (for super admin)
   * This is a hard delete that permanently removes all data.
   */
  async deleteOrganization(id: number): Promise<boolean> {
    if (this.type === 'supabase' && this.supabase) {
      // For Supabase, use a transaction via RPC or delete in order
      const client = this.supabase.getClient();

      // Delete in order to respect foreign keys
      // kontaktlogg references kunder
      await client.from('kontaktlogg').delete().eq('organization_id', id);

      // email_innstillinger references kunder
      const { data: kunder } = await client.from('kunder').select('id').eq('organization_id', id);
      if (kunder && kunder.length > 0) {
        const kundeIds = kunder.map((k: { id: number }) => k.id);
        await client.from('email_innstillinger').delete().in('kunde_id', kundeIds);
      }

      // rute_kunder references ruter
      const { data: ruter } = await client.from('ruter').select('id').eq('organization_id', id);
      if (ruter && ruter.length > 0) {
        const ruteIds = ruter.map((r: { id: number }) => r.id);
        await client.from('rute_kunder').delete().in('rute_id', ruteIds);
      }

      // organization_field_options references organization_fields
      const { data: fields } = await client.from('organization_fields').select('id').eq('organization_id', id);
      if (fields && fields.length > 0) {
        const fieldIds = fields.map((f: { id: number }) => f.id);
        await client.from('organization_field_options').delete().in('field_id', fieldIds);
      }

      // Delete main tables
      await client.from('email_varsler').delete().eq('organization_id', id);
      await client.from('avtaler').delete().eq('organization_id', id);
      await client.from('ruter').delete().eq('organization_id', id);
      await client.from('kunder').delete().eq('organization_id', id);
      await client.from('organization_integrations').delete().eq('organization_id', id);
      await client.from('integration_sync_log').delete().eq('organization_id', id);
      await client.from('organization_fields').delete().eq('organization_id', id);
      await client.from('mapping_cache').delete().eq('organization_id', id);
      await client.from('api_keys').delete().eq('organization_id', id);
      await client.from('webhook_deliveries').delete().eq('organization_id', id);
      await client.from('webhook_endpoints').delete().eq('organization_id', id);
      await client.from('login_logg').delete().eq('organization_id', id);
      await client.from('klient').delete().eq('organization_id', id);

      // Finally delete the organization
      const { error } = await client.from('organizations').delete().eq('id', id);

      return !error;
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    // Use transaction for SQLite to ensure atomicity
    const transaction = this.sqlite.transaction(() => {
      // Delete kontaktlogg (references kunder)
      this.sqlite!.prepare('DELETE FROM kontaktlogg WHERE kunde_id IN (SELECT id FROM kunder WHERE organization_id = ?)').run(id);

      // Delete email_innstillinger (references kunder)
      this.sqlite!.prepare('DELETE FROM email_innstillinger WHERE kunde_id IN (SELECT id FROM kunder WHERE organization_id = ?)').run(id);

      // Delete email_varsler
      this.sqlite!.prepare('DELETE FROM email_varsler WHERE organization_id = ?').run(id);

      // Delete rute_kunder (references ruter)
      this.sqlite!.prepare('DELETE FROM rute_kunder WHERE rute_id IN (SELECT id FROM ruter WHERE organization_id = ?)').run(id);

      // Delete avtaler
      this.sqlite!.prepare('DELETE FROM avtaler WHERE organization_id = ?').run(id);

      // Delete ruter
      this.sqlite!.prepare('DELETE FROM ruter WHERE organization_id = ?').run(id);

      // Delete kunder
      this.sqlite!.prepare('DELETE FROM kunder WHERE organization_id = ?').run(id);

      // Delete organization_field_options (references organization_fields)
      this.sqlite!.prepare('DELETE FROM organization_field_options WHERE field_id IN (SELECT id FROM organization_fields WHERE organization_id = ?)').run(id);

      // Delete organization_fields
      this.sqlite!.prepare('DELETE FROM organization_fields WHERE organization_id = ?').run(id);

      // Delete organization_integrations
      this.sqlite!.prepare('DELETE FROM organization_integrations WHERE organization_id = ?').run(id);

      // Delete integration_sync_log
      this.sqlite!.prepare('DELETE FROM integration_sync_log WHERE organization_id = ?').run(id);

      // Delete mapping_cache
      this.sqlite!.prepare('DELETE FROM mapping_cache WHERE organization_id = ?').run(id);

      // Delete api_keys
      this.sqlite!.prepare('DELETE FROM api_keys WHERE organization_id = ?').run(id);

      // Delete webhook_deliveries
      this.sqlite!.prepare('DELETE FROM webhook_deliveries WHERE organization_id = ?').run(id);

      // Delete webhook_endpoints
      this.sqlite!.prepare('DELETE FROM webhook_endpoints WHERE organization_id = ?').run(id);

      // Delete login_logg
      this.sqlite!.prepare('DELETE FROM login_logg WHERE organization_id = ?').run(id);

      // Delete klient (users)
      this.sqlite!.prepare('DELETE FROM klient WHERE organization_id = ?').run(id);

      // Finally delete the organization
      const result = this.sqlite!.prepare('DELETE FROM organizations WHERE id = ?').run(id);

      return result.changes > 0;
    });

    return transaction();
  }

  /**
   * Get all users (klienter) for an organization (for super admin)
   */
  async getKlienterForOrganization(organizationId: number): Promise<KlientRecord[]> {
    if (this.type === 'supabase' && this.supabase) {
      return this.supabase.getKlienterForOrganization(organizationId);
    }

    if (!this.sqlite) return [];

    return this.sqlite.prepare(`
      SELECT * FROM klient WHERE organization_id = ?
      ORDER BY navn COLLATE NOCASE
    `).all(organizationId) as KlientRecord[];
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
    if (this.type === 'supabase' && this.supabase) {
      const stats = await this.supabase.getGlobalStatistics();
      return {
        totalOrganizations: stats.totalOrganizations,
        totalCustomers: stats.totalKunder,
        totalUsers: stats.totalUsers,
        activeSubscriptions: stats.activeSubscriptions,
        organizationsByPlan: {}, // TODO: implement if needed
      };
    }

    if (!this.sqlite) {
      return {
        totalOrganizations: 0,
        totalCustomers: 0,
        totalUsers: 0,
        activeSubscriptions: 0,
        organizationsByPlan: {},
      };
    }

    const orgsCount = this.sqlite.prepare('SELECT COUNT(*) as count FROM organizations').get() as { count: number };
    const customersCount = this.sqlite.prepare('SELECT COUNT(*) as count FROM kunder').get() as { count: number };
    const usersCount = this.sqlite.prepare('SELECT COUNT(*) as count FROM klient WHERE aktiv = 1').get() as { count: number };

    const orgs = this.sqlite.prepare('SELECT plan_type, subscription_status FROM organizations').all() as Array<{
      plan_type: string | null;
      subscription_status: string | null;
    }>;

    const organizationsByPlan: Record<string, number> = {};
    let activeSubscriptions = 0;

    for (const org of orgs) {
      const plan = org.plan_type || 'free';
      organizationsByPlan[plan] = (organizationsByPlan[plan] || 0) + 1;
      if (org.subscription_status === 'active' || org.subscription_status === 'trialing') {
        activeSubscriptions++;
      }
    }

    return {
      totalOrganizations: orgsCount?.count || 0,
      totalCustomers: customersCount?.count || 0,
      totalUsers: usersCount?.count || 0,
      activeSubscriptions,
      organizationsByPlan,
    };
  }

  // ============ API KEY METHODS ============

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
    if (this.type === 'supabase') {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: apiKey, error } = await supabase
        .from('api_keys')
        .insert({
          organization_id: data.organization_id,
          key_prefix: data.key_prefix,
          key_hash: data.key_hash,
          name: data.name,
          description: data.description,
          scopes: data.scopes,
          expires_at: data.expires_at,
          monthly_quota: data.monthly_quota,
          rate_limit_requests: data.rate_limit_requests || 1000,
          rate_limit_window_seconds: data.rate_limit_window_seconds || 3600,
          created_by: data.created_by,
        })
        .select()
        .single();

      if (error) throw new Error(`Failed to create API key: ${error.message}`);
      return apiKey;
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const stmt = this.sqlite.prepare(`
      INSERT INTO api_keys (
        organization_id, key_prefix, key_hash, name, description, scopes,
        expires_at, monthly_quota, rate_limit_requests, rate_limit_window_seconds, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      data.organization_id,
      data.key_prefix,
      data.key_hash,
      data.name,
      data.description || null,
      JSON.stringify(data.scopes),
      data.expires_at || null,
      data.monthly_quota || null,
      data.rate_limit_requests || 1000,
      data.rate_limit_window_seconds || 3600,
      data.created_by
    );

    const apiKey = this.sqlite.prepare('SELECT * FROM api_keys WHERE id = ?').get(result.lastInsertRowid) as {
      id: number;
      organization_id: number;
      key_prefix: string;
      name: string;
      description: string | null;
      scopes: string;
      rate_limit_requests: number;
      rate_limit_window_seconds: number;
      monthly_quota: number | null;
      quota_used_this_month: number;
      is_active: number;
      expires_at: string | null;
      created_by: number;
      created_at: string;
    };

    return {
      ...apiKey,
      description: apiKey.description || undefined,
      scopes: JSON.parse(apiKey.scopes),
      monthly_quota: apiKey.monthly_quota || undefined,
      is_active: !!apiKey.is_active,
      expires_at: apiKey.expires_at || undefined,
    };
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
    if (this.type === 'supabase') {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data, error } = await supabase
        .from('api_keys')
        .select('*')
        .eq('key_hash', keyHash)
        .single();

      if (error || !data) return null;
      return { ...data, is_active: !!data.is_active };
    }

    if (!this.sqlite) return null;

    const result = this.sqlite.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash) as {
      id: number;
      organization_id: number;
      key_prefix: string;
      key_hash: string;
      name: string;
      scopes: string;
      rate_limit_requests: number;
      rate_limit_window_seconds: number;
      is_active: number;
      expires_at: string | null;
    } | undefined;

    if (!result) return null;

    return {
      ...result,
      scopes: JSON.parse(result.scopes),
      is_active: !!result.is_active,
      expires_at: result.expires_at || undefined,
    };
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
    this.validateTenantContext(organizationId, 'getApiKeyById');

    if (this.type === 'supabase') {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data, error } = await supabase
        .from('api_keys')
        .select('id, organization_id, key_prefix, name, description, scopes, rate_limit_requests, rate_limit_window_seconds, monthly_quota, quota_used_this_month, is_active, last_used_at, expires_at, created_by, created_at, revoked_at')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .single();

      if (error || !data) return null;
      return { ...data, is_active: !!data.is_active };
    }

    if (!this.sqlite) return null;

    const result = this.sqlite.prepare(`
      SELECT id, organization_id, key_prefix, name, description, scopes,
             rate_limit_requests, rate_limit_window_seconds, monthly_quota,
             quota_used_this_month, is_active, last_used_at, expires_at,
             created_by, created_at, revoked_at
      FROM api_keys WHERE id = ? AND organization_id = ?
    `).get(id, organizationId) as {
      id: number;
      organization_id: number;
      key_prefix: string;
      name: string;
      description: string | null;
      scopes: string;
      rate_limit_requests: number;
      rate_limit_window_seconds: number;
      monthly_quota: number | null;
      quota_used_this_month: number;
      is_active: number;
      last_used_at: string | null;
      expires_at: string | null;
      created_by: number;
      created_at: string;
      revoked_at: string | null;
    } | undefined;

    if (!result) return null;

    return {
      ...result,
      description: result.description || undefined,
      scopes: JSON.parse(result.scopes),
      monthly_quota: result.monthly_quota || undefined,
      is_active: !!result.is_active,
      last_used_at: result.last_used_at || undefined,
      expires_at: result.expires_at || undefined,
      revoked_at: result.revoked_at || undefined,
    };
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
    this.validateTenantContext(organizationId, 'getOrganizationApiKeys');

    if (this.type === 'supabase') {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data, error } = await supabase
        .from('api_keys')
        .select('id, organization_id, key_prefix, name, description, scopes, rate_limit_requests, rate_limit_window_seconds, monthly_quota, quota_used_this_month, is_active, last_used_at, expires_at, created_by, created_at, revoked_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) throw new Error(`Failed to get API keys: ${error.message}`);
      return (data || []).map(k => ({ ...k, is_active: !!k.is_active }));
    }

    if (!this.sqlite) return [];

    const results = this.sqlite.prepare(`
      SELECT id, organization_id, key_prefix, name, description, scopes,
             rate_limit_requests, rate_limit_window_seconds, monthly_quota,
             quota_used_this_month, is_active, last_used_at, expires_at,
             created_by, created_at, revoked_at
      FROM api_keys WHERE organization_id = ?
      ORDER BY created_at DESC
    `).all(organizationId) as Array<{
      id: number;
      organization_id: number;
      key_prefix: string;
      name: string;
      description: string | null;
      scopes: string;
      rate_limit_requests: number;
      rate_limit_window_seconds: number;
      monthly_quota: number | null;
      quota_used_this_month: number;
      is_active: number;
      last_used_at: string | null;
      expires_at: string | null;
      created_by: number;
      created_at: string;
      revoked_at: string | null;
    }>;

    return results.map(result => ({
      ...result,
      description: result.description || undefined,
      scopes: JSON.parse(result.scopes),
      monthly_quota: result.monthly_quota || undefined,
      is_active: !!result.is_active,
      last_used_at: result.last_used_at || undefined,
      expires_at: result.expires_at || undefined,
      revoked_at: result.revoked_at || undefined,
    }));
  }

  /**
   * Update last used timestamp for an API key
   */
  async updateApiKeyLastUsed(id: number): Promise<void> {
    if (this.type === 'supabase') {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      await supabase
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', id);
      return;
    }

    if (!this.sqlite) return;

    this.sqlite.prepare(`
      UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?
    `).run(id);
  }

  async incrementApiKeyQuotaUsed(id: number): Promise<void> {
    if (this.type === 'supabase') {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Read current value and increment (atomic enough for quota tracking)
      const { data } = await supabase
        .from('api_keys')
        .select('quota_used_this_month')
        .eq('id', id)
        .single();

      const currentUsage = data?.quota_used_this_month ?? 0;

      await supabase
        .from('api_keys')
        .update({ quota_used_this_month: currentUsage + 1 })
        .eq('id', id);
      return;
    }

    if (!this.sqlite) return;

    this.sqlite.prepare(`
      UPDATE api_keys SET quota_used_this_month = quota_used_this_month + 1 WHERE id = ?
    `).run(id);
  }

  /**
   * Revoke an API key
   */
  async revokeApiKey(id: number, organizationId: number, revokedBy: number, reason?: string): Promise<boolean> {
    this.validateTenantContext(organizationId, 'revokeApiKey');

    if (this.type === 'supabase') {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabase
        .from('api_keys')
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
          revoked_by: revokedBy,
          revoked_reason: reason,
        })
        .eq('id', id)
        .eq('organization_id', organizationId);

      return !error;
    }

    if (!this.sqlite) return false;

    const result = this.sqlite.prepare(`
      UPDATE api_keys
      SET is_active = 0, revoked_at = datetime('now'), revoked_by = ?, revoked_reason = ?
      WHERE id = ? AND organization_id = ?
    `).run(revokedBy, reason || null, id, organizationId);

    return result.changes > 0;
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
    if (this.type === 'supabase') {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      await supabase.from('api_key_usage_log').insert(data);
      return;
    }

    if (!this.sqlite) return;

    this.sqlite.prepare(`
      INSERT INTO api_key_usage_log (api_key_id, organization_id, endpoint, method, status_code, response_time_ms, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.api_key_id,
      data.organization_id,
      data.endpoint,
      data.method,
      data.status_code,
      data.response_time_ms || null,
      data.ip_address || null,
      data.user_agent || null
    );
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
    this.validateTenantContext(organizationId, 'getApiKeyUsageStats');

    const emptyStats = {
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      avg_response_time_ms: 0,
      requests_by_endpoint: {},
      requests_by_day: [],
    };

    if (this.type === 'supabase') {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.SUPABASE_URL || '';
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
      const supabase = createClient(supabaseUrl, supabaseKey);

      const since = new Date();
      since.setDate(since.getDate() - days);

      const { data, error } = await supabase
        .from('api_key_usage_log')
        .select('*')
        .eq('api_key_id', apiKeyId)
        .eq('organization_id', organizationId)
        .gte('created_at', since.toISOString());

      if (error || !data) return emptyStats;

      return this.calculateUsageStats(data);
    }

    if (!this.sqlite) return emptyStats;

    const results = this.sqlite.prepare(`
      SELECT * FROM api_key_usage_log
      WHERE api_key_id = ? AND organization_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
    `).all(apiKeyId, organizationId, days) as Array<{
      endpoint: string;
      status_code: number;
      response_time_ms: number | null;
      created_at: string;
    }>;

    return this.calculateUsageStats(results);
  }

  private calculateUsageStats(data: Array<{
    endpoint: string;
    status_code: number;
    response_time_ms?: number | null;
    created_at: string;
  }>): {
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    avg_response_time_ms: number;
    requests_by_endpoint: Record<string, number>;
    requests_by_day: Array<{ date: string; count: number }>;
  } {
    const total_requests = data.length;
    const successful_requests = data.filter(d => d.status_code >= 200 && d.status_code < 300).length;
    const failed_requests = data.filter(d => d.status_code >= 400).length;

    const responseTimes = data.filter(d => d.response_time_ms != null).map(d => d.response_time_ms!);
    const avg_response_time_ms = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;

    const requests_by_endpoint: Record<string, number> = {};
    for (const d of data) {
      requests_by_endpoint[d.endpoint] = (requests_by_endpoint[d.endpoint] || 0) + 1;
    }

    const byDay: Record<string, number> = {};
    for (const d of data) {
      const date = d.created_at.split('T')[0];
      byDay[date] = (byDay[date] || 0) + 1;
    }

    const requests_by_day = Object.entries(byDay)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      total_requests,
      successful_requests,
      failed_requests,
      avg_response_time_ms,
      requests_by_endpoint,
      requests_by_day,
    };
  }

  // ============ Webhook Operations ============

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
    const now = new Date().toISOString();

    if (this.type === 'supabase') {
      const { data: result, error } = await this.supabase!.getClient()
        .from('webhook_endpoints')
        .insert({
          organization_id: data.organization_id,
          url: data.url,
          name: data.name,
          description: data.description,
          events: data.events,
          secret_hash: data.secret_hash,
          created_by: data.created_by,
        })
        .select()
        .single();

      if (error) throw new Error(`Failed to create webhook endpoint: ${error.message}`);
      return result;
    }

    const result = this.sqlite!.prepare(`
      INSERT INTO webhook_endpoints (organization_id, url, name, description, events, secret_hash, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.organization_id,
      data.url,
      data.name,
      data.description || null,
      JSON.stringify(data.events),
      data.secret_hash,
      data.created_by,
      now,
      now
    );

    return {
      id: result.lastInsertRowid as number,
      organization_id: data.organization_id,
      url: data.url,
      name: data.name,
      description: data.description,
      events: data.events,
      is_active: true,
      failure_count: 0,
      created_by: data.created_by,
      created_at: now,
      updated_at: now,
    };
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
    if (this.type === 'supabase') {
      const { data, error } = await this.supabase!.getClient()
        .from('webhook_endpoints')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (error) throw new Error(`Failed to get webhooks: ${error.message}`);
      return data || [];
    }

    const results = this.sqlite!.prepare(`
      SELECT * FROM webhook_endpoints
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).all(organizationId) as Array<{
      id: number;
      organization_id: number;
      url: string;
      name: string;
      description: string | null;
      events: string;
      is_active: number;
      failure_count: number;
      last_failure_at: string | null;
      last_success_at: string | null;
      disabled_at: string | null;
      disabled_reason: string | null;
      created_by: number;
      created_at: string;
      updated_at: string;
    }>;

    return results.map(r => ({
      ...r,
      description: r.description || undefined,
      events: JSON.parse(r.events),
      is_active: Boolean(r.is_active),
      last_failure_at: r.last_failure_at || undefined,
      last_success_at: r.last_success_at || undefined,
      disabled_at: r.disabled_at || undefined,
      disabled_reason: r.disabled_reason || undefined,
    }));
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
    if (this.type === 'supabase') {
      const { data, error } = await this.supabase!.getClient()
        .from('webhook_endpoints')
        .select('*')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw new Error(`Failed to get webhook: ${error.message}`);
      }
      return data;
    }

    const result = this.sqlite!.prepare(`
      SELECT * FROM webhook_endpoints
      WHERE id = ? AND organization_id = ?
    `).get(id, organizationId) as {
      id: number;
      organization_id: number;
      url: string;
      name: string;
      description: string | null;
      events: string;
      is_active: number;
      failure_count: number;
      last_failure_at: string | null;
      last_success_at: string | null;
      disabled_at: string | null;
      disabled_reason: string | null;
      created_by: number;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!result) return null;

    return {
      ...result,
      description: result.description || undefined,
      events: JSON.parse(result.events),
      is_active: Boolean(result.is_active),
      last_failure_at: result.last_failure_at || undefined,
      last_success_at: result.last_success_at || undefined,
      disabled_at: result.disabled_at || undefined,
      disabled_reason: result.disabled_reason || undefined,
    };
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
    if (this.type === 'supabase') {
      const { data, error } = await this.supabase!.getClient()
        .from('webhook_endpoints')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw new Error(`Failed to get webhook with secret: ${error.message}`);
      }
      return data;
    }

    const result = this.sqlite!.prepare(`
      SELECT * FROM webhook_endpoints WHERE id = ?
    `).get(id) as {
      id: number;
      organization_id: number;
      url: string;
      name: string;
      description: string | null;
      events: string;
      is_active: number;
      failure_count: number;
      secret_hash: string;
      created_by: number;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!result) return null;

    return {
      ...result,
      description: result.description || undefined,
      events: JSON.parse(result.events),
      is_active: Boolean(result.is_active),
    };
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
    if (this.type === 'supabase') {
      const { data, error } = await this.supabase!.getClient()
        .from('webhook_endpoints')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .contains('events', [eventType]);

      if (error) throw new Error(`Failed to get active webhooks: ${error.message}`);
      return data || [];
    }

    const results = this.sqlite!.prepare(`
      SELECT * FROM webhook_endpoints
      WHERE organization_id = ? AND is_active = 1
    `).all(organizationId) as Array<{
      id: number;
      organization_id: number;
      url: string;
      name: string;
      description: string | null;
      events: string;
      is_active: number;
      failure_count: number;
      created_by: number;
      created_at: string;
      updated_at: string;
    }>;

    // Filter by event type (SQLite doesn't have array contains)
    return results
      .map(r => ({
        ...r,
        events: JSON.parse(r.events) as string[],
        is_active: Boolean(r.is_active),
      }))
      .filter(r => r.events.includes(eventType));
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
    const now = new Date().toISOString();

    if (this.type === 'supabase') {
      const updateData: Record<string, unknown> = { updated_at: now };
      if (data.url !== undefined) updateData.url = data.url;
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.events !== undefined) updateData.events = data.events;
      if (data.is_active !== undefined) updateData.is_active = data.is_active;

      const { data: result, error } = await this.supabase!.getClient()
        .from('webhook_endpoints')
        .update(updateData)
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw new Error(`Failed to update webhook: ${error.message}`);
      }
      return result;
    }

    // SQLite: Build dynamic update
    const updates: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (data.url !== undefined) { updates.push('url = ?'); values.push(data.url); }
    if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name); }
    if (data.description !== undefined) { updates.push('description = ?'); values.push(data.description); }
    if (data.events !== undefined) { updates.push('events = ?'); values.push(JSON.stringify(data.events)); }
    if (data.is_active !== undefined) { updates.push('is_active = ?'); values.push(data.is_active ? 1 : 0); }

    values.push(id, organizationId);

    this.sqlite!.prepare(`
      UPDATE webhook_endpoints SET ${updates.join(', ')}
      WHERE id = ? AND organization_id = ?
    `).run(...values);

    return this.getWebhookEndpointById(id, organizationId);
  }

  /**
   * Update webhook secret
   */
  async updateWebhookSecret(id: number, organizationId: number, secretHash: string): Promise<boolean> {
    const now = new Date().toISOString();

    if (this.type === 'supabase') {
      const { error } = await this.supabase!.getClient()
        .from('webhook_endpoints')
        .update({ secret_hash: secretHash, updated_at: now })
        .eq('id', id)
        .eq('organization_id', organizationId);

      if (error) throw new Error(`Failed to update webhook secret: ${error.message}`);
      return true;
    }

    const result = this.sqlite!.prepare(`
      UPDATE webhook_endpoints SET secret_hash = ?, updated_at = ?
      WHERE id = ? AND organization_id = ?
    `).run(secretHash, now, id, organizationId);

    return result.changes > 0;
  }

  /**
   * Delete a webhook endpoint
   */
  async deleteWebhookEndpoint(id: number, organizationId: number): Promise<boolean> {
    if (this.type === 'supabase') {
      const { error, count } = await this.supabase!.getClient()
        .from('webhook_endpoints')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('organization_id', organizationId);

      if (error) throw new Error(`Failed to delete webhook: ${error.message}`);
      return (count ?? 0) > 0;
    }

    const result = this.sqlite!.prepare(`
      DELETE FROM webhook_endpoints WHERE id = ? AND organization_id = ?
    `).run(id, organizationId);

    return result.changes > 0;
  }

  /**
   * Disable a webhook endpoint
   */
  async disableWebhookEndpoint(id: number, reason: string): Promise<boolean> {
    const now = new Date().toISOString();

    if (this.type === 'supabase') {
      const { error } = await this.supabase!.getClient()
        .from('webhook_endpoints')
        .update({ is_active: false, disabled_at: now, disabled_reason: reason, updated_at: now })
        .eq('id', id);

      if (error) throw new Error(`Failed to disable webhook: ${error.message}`);
      return true;
    }

    const result = this.sqlite!.prepare(`
      UPDATE webhook_endpoints
      SET is_active = 0, disabled_at = ?, disabled_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(now, reason, now, id);

    return result.changes > 0;
  }

  /**
   * Record successful webhook delivery
   */
  async recordWebhookSuccess(id: number): Promise<void> {
    const now = new Date().toISOString();

    if (this.type === 'supabase') {
      await this.supabase!.getClient()
        .from('webhook_endpoints')
        .update({ failure_count: 0, last_success_at: now, updated_at: now })
        .eq('id', id);
      return;
    }

    this.sqlite!.prepare(`
      UPDATE webhook_endpoints
      SET failure_count = 0, last_success_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id);
  }

  /**
   * Record failed webhook delivery
   */
  async recordWebhookFailure(id: number): Promise<void> {
    const now = new Date().toISOString();

    if (this.type === 'supabase') {
      await this.supabase!.getClient().rpc('increment_webhook_failure', { webhook_id: id });
      await this.supabase!.getClient()
        .from('webhook_endpoints')
        .update({ last_failure_at: now, updated_at: now })
        .eq('id', id);
      return;
    }

    this.sqlite!.prepare(`
      UPDATE webhook_endpoints
      SET failure_count = failure_count + 1, last_failure_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id);
  }

  // ============ Webhook Delivery Operations ============

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
    const now = new Date().toISOString();

    if (this.type === 'supabase') {
      const { data: result, error } = await this.supabase!.getClient()
        .from('webhook_deliveries')
        .insert({
          webhook_endpoint_id: data.webhook_endpoint_id,
          organization_id: data.organization_id,
          event_type: data.event_type,
          event_id: data.event_id,
          payload: data.payload,
        })
        .select()
        .single();

      if (error) throw new Error(`Failed to create webhook delivery: ${error.message}`);
      return result;
    }

    const result = this.sqlite!.prepare(`
      INSERT INTO webhook_deliveries (webhook_endpoint_id, organization_id, event_type, event_id, payload, status, attempt_count, max_attempts, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 0, 5, ?)
    `).run(
      data.webhook_endpoint_id,
      data.organization_id,
      data.event_type,
      data.event_id,
      JSON.stringify(data.payload),
      now
    );

    return {
      id: result.lastInsertRowid as number,
      webhook_endpoint_id: data.webhook_endpoint_id,
      organization_id: data.organization_id,
      event_type: data.event_type,
      event_id: data.event_id,
      payload: data.payload,
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      created_at: now,
    };
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
    const now = new Date().toISOString();

    if (this.type === 'supabase') {
      const { data, error } = await this.supabase!.getClient()
        .from('webhook_deliveries')
        .select('*')
        .or(`status.eq.pending,and(status.eq.retrying,next_retry_at.lte.${now})`)
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) throw new Error(`Failed to get pending deliveries: ${error.message}`);
      return data || [];
    }

    const results = this.sqlite!.prepare(`
      SELECT * FROM webhook_deliveries
      WHERE status = 'pending'
         OR (status = 'retrying' AND next_retry_at <= ?)
      ORDER BY created_at ASC
      LIMIT 100
    `).all(now) as Array<{
      id: number;
      webhook_endpoint_id: number;
      organization_id: number;
      event_type: string;
      event_id: string;
      payload: string;
      status: string;
      attempt_count: number;
      max_attempts: number;
      next_retry_at: string | null;
      created_at: string;
    }>;

    return results.map(r => ({
      ...r,
      payload: JSON.parse(r.payload),
      next_retry_at: r.next_retry_at || undefined,
    }));
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
    if (this.type === 'supabase') {
      const { data, error } = await this.supabase!.getClient()
        .from('webhook_deliveries')
        .select('*')
        .eq('id', id)
        .eq('organization_id', organizationId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw new Error(`Failed to get delivery: ${error.message}`);
      }
      return data;
    }

    const result = this.sqlite!.prepare(`
      SELECT * FROM webhook_deliveries
      WHERE id = ? AND organization_id = ?
    `).get(id, organizationId) as {
      id: number;
      webhook_endpoint_id: number;
      organization_id: number;
      event_type: string;
      event_id: string;
      payload: string;
      status: string;
      attempt_count: number;
      max_attempts: number;
      next_retry_at: string | null;
      response_status: number | null;
      response_body: string | null;
      response_time_ms: number | null;
      error_message: string | null;
      created_at: string;
      delivered_at: string | null;
    } | undefined;

    if (!result) return null;

    return {
      ...result,
      payload: JSON.parse(result.payload),
      next_retry_at: result.next_retry_at || undefined,
      response_status: result.response_status || undefined,
      response_body: result.response_body || undefined,
      response_time_ms: result.response_time_ms || undefined,
      error_message: result.error_message || undefined,
      delivered_at: result.delivered_at || undefined,
    };
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
    if (this.type === 'supabase') {
      const { data, error } = await this.supabase!.getClient()
        .from('webhook_deliveries')
        .select('*')
        .eq('webhook_endpoint_id', webhookId)
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw new Error(`Failed to get delivery history: ${error.message}`);
      return data || [];
    }

    const results = this.sqlite!.prepare(`
      SELECT * FROM webhook_deliveries
      WHERE webhook_endpoint_id = ? AND organization_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(webhookId, organizationId, limit) as Array<{
      id: number;
      webhook_endpoint_id: number;
      organization_id: number;
      event_type: string;
      event_id: string;
      payload: string;
      status: string;
      attempt_count: number;
      max_attempts: number;
      response_status: number | null;
      response_time_ms: number | null;
      error_message: string | null;
      created_at: string;
      delivered_at: string | null;
    }>;

    return results.map(r => ({
      ...r,
      payload: JSON.parse(r.payload),
      response_status: r.response_status || undefined,
      response_time_ms: r.response_time_ms || undefined,
      error_message: r.error_message || undefined,
      delivered_at: r.delivered_at || undefined,
    }));
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
    if (this.type === 'supabase') {
      const { error } = await this.supabase!.getClient()
        .from('webhook_deliveries')
        .update({ status, ...data })
        .eq('id', id);

      if (error) throw new Error(`Failed to update delivery status: ${error.message}`);
      return;
    }

    // SQLite: Build dynamic update
    const updates: string[] = ['status = ?'];
    const values: unknown[] = [status];

    if (data.attempt_count !== undefined) { updates.push('attempt_count = ?'); values.push(data.attempt_count); }
    if (data.next_retry_at !== undefined) { updates.push('next_retry_at = ?'); values.push(data.next_retry_at); }
    if (data.response_status !== undefined) { updates.push('response_status = ?'); values.push(data.response_status); }
    if (data.response_body !== undefined) { updates.push('response_body = ?'); values.push(data.response_body); }
    if (data.response_time_ms !== undefined) { updates.push('response_time_ms = ?'); values.push(data.response_time_ms); }
    if (data.error_message !== undefined) { updates.push('error_message = ?'); values.push(data.error_message); }
    if (data.delivered_at !== undefined) { updates.push('delivered_at = ?'); values.push(data.delivered_at); }

    values.push(id);

    this.sqlite!.prepare(`UPDATE webhook_deliveries SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  // ============ SUPER ADMIN - GROWTH STATISTICS ============

  /**
   * Get growth statistics over time (for super admin dashboard)
   * Returns monthly counts for organizations, customers, and users
   */
  async getGrowthStatistics(months: number = 12): Promise<{
    organizations: Array<{ month: string; count: number }>;
    customers: Array<{ month: string; count: number }>;
    users: Array<{ month: string; count: number }>;
  }> {
    if (this.type === 'supabase' && this.supabase) {
      // Supabase implementation
      const client = this.supabase.getClient();

      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);

      const { data: orgs } = await client
        .from('organizations')
        .select('created_at')
        .gte('created_at', startDate.toISOString());

      const { data: customers } = await client
        .from('kunder')
        .select('opprettet')
        .gte('opprettet', startDate.toISOString());

      const { data: users } = await client
        .from('klient')
        .select('opprettet')
        .gte('opprettet', startDate.toISOString());

      return {
        organizations: this.aggregateByMonth(orgs || [], 'created_at'),
        customers: this.aggregateByMonth(customers || [], 'opprettet'),
        users: this.aggregateByMonth(users || [], 'opprettet'),
      };
    }

    if (!this.sqlite) {
      return { organizations: [], customers: [], users: [] };
    }

    // SQLite implementation
    const organizationsQuery = this.sqlite.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
      FROM organizations
      WHERE created_at >= date('now', '-${months} months')
      GROUP BY strftime('%Y-%m', created_at)
      ORDER BY month ASC
    `).all() as Array<{ month: string; count: number }>;

    const customersQuery = this.sqlite.prepare(`
      SELECT strftime('%Y-%m', opprettet) as month, COUNT(*) as count
      FROM kunder
      WHERE opprettet >= date('now', '-${months} months')
      GROUP BY strftime('%Y-%m', opprettet)
      ORDER BY month ASC
    `).all() as Array<{ month: string; count: number }>;

    const usersQuery = this.sqlite.prepare(`
      SELECT strftime('%Y-%m', opprettet) as month, COUNT(*) as count
      FROM klient
      WHERE opprettet >= date('now', '-${months} months')
      GROUP BY strftime('%Y-%m', opprettet)
      ORDER BY month ASC
    `).all() as Array<{ month: string; count: number }>;

    return {
      organizations: organizationsQuery,
      customers: customersQuery,
      users: usersQuery,
    };
  }

  /**
   * Helper to aggregate records by month
   */
  private aggregateByMonth(
    records: Array<{ [key: string]: string | null }>,
    dateField: string
  ): Array<{ month: string; count: number }> {
    const counts: Record<string, number> = {};

    for (const record of records) {
      const date = record[dateField];
      if (date) {
        const month = date.substring(0, 7); // YYYY-MM
        counts[month] = (counts[month] || 0) + 1;
      }
    }

    return Object.entries(counts)
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));
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
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data: logins } = await client
        .from('login_logg')
        .select('tidspunkt, status')
        .gte('tidspunkt', startDate.toISOString());

      const active7Query = client
        .from('klient')
        .select('id')
        .gte('sist_innlogget', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .eq('aktiv', true);
      const { data: active7Data } = await active7Query;

      const active30Query = client
        .from('klient')
        .select('id')
        .gte('sist_innlogget', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .eq('aktiv', true);
      const { data: active30Data } = await active30Query;

      const active7 = active7Data?.length || 0;
      const active30 = active30Data?.length || 0;

      return {
        loginsByDay: this.aggregateLoginsByDay(logins || []),
        activeUsers7Days: active7 || 0,
        activeUsers30Days: active30 || 0,
        totalLogins: logins?.length || 0,
      };
    }

    if (!this.sqlite) {
      return { loginsByDay: [], activeUsers7Days: 0, activeUsers30Days: 0, totalLogins: 0 };
    }

    const loginsByDay = this.sqlite.prepare(`
      SELECT
        date(tidspunkt) as date,
        SUM(CASE WHEN status = 'vellykket' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'feilet' THEN 1 ELSE 0 END) as failed
      FROM login_logg
      WHERE tidspunkt >= date('now', '-${days} days')
      GROUP BY date(tidspunkt)
      ORDER BY date ASC
    `).all() as Array<{ date: string; successful: number; failed: number }>;

    const active7Result = this.sqlite.prepare(`
      SELECT COUNT(*) as count FROM klient
      WHERE sist_innlogget >= datetime('now', '-7 days') AND aktiv = 1
    `).get() as { count: number };

    const active30Result = this.sqlite.prepare(`
      SELECT COUNT(*) as count FROM klient
      WHERE sist_innlogget >= datetime('now', '-30 days') AND aktiv = 1
    `).get() as { count: number };

    const totalLoginsResult = this.sqlite.prepare(`
      SELECT COUNT(*) as count FROM login_logg
      WHERE tidspunkt >= date('now', '-${days} days')
    `).get() as { count: number };

    return {
      loginsByDay,
      activeUsers7Days: active7Result?.count || 0,
      activeUsers30Days: active30Result?.count || 0,
      totalLogins: totalLoginsResult?.count || 0,
    };
  }

  /**
   * Helper to aggregate logins by day
   */
  private aggregateLoginsByDay(
    logins: Array<{ tidspunkt: string; status: string }>
  ): Array<{ date: string; successful: number; failed: number }> {
    const counts: Record<string, { successful: number; failed: number }> = {};

    for (const login of logins) {
      const date = login.tidspunkt.substring(0, 10); // YYYY-MM-DD
      if (!counts[date]) {
        counts[date] = { successful: 0, failed: 0 };
      }
      if (login.status === 'vellykket') {
        counts[date].successful++;
      } else {
        counts[date].failed++;
      }
    }

    return Object.entries(counts)
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ============ SUPER ADMIN - USER MANAGEMENT ============

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
    const { limit = 50, offset = 0, status, epost } = options;

    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();

      let query = client
        .from('login_logg')
        .select('*')
        .eq('organization_id', organizationId)
        .order('tidspunkt', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) query = query.eq('status', status);
      if (epost) query = query.ilike('epost', `%${epost}%`);

      const { data } = await query;

      // Get total count separately
      let countQuery = client
        .from('login_logg')
        .select('id')
        .eq('organization_id', organizationId);
      if (status) countQuery = countQuery.eq('status', status);
      if (epost) countQuery = countQuery.ilike('epost', `%${epost}%`);
      const { data: countData } = await countQuery;

      return { logs: data || [], total: countData?.length || 0 };
    }

    if (!this.sqlite) {
      return { logs: [], total: 0 };
    }

    let whereClause = 'WHERE organization_id = ?';
    const params: unknown[] = [organizationId];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    if (epost) {
      whereClause += ' AND epost LIKE ?';
      params.push(`%${epost}%`);
    }

    const countResult = this.sqlite.prepare(`
      SELECT COUNT(*) as count FROM login_logg ${whereClause}
    `).get(...params) as { count: number };

    const logs = this.sqlite.prepare(`
      SELECT * FROM login_logg
      ${whereClause}
      ORDER BY tidspunkt DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Array<{
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

    return { logs, total: countResult?.count || 0 };
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
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      // Filter to only columns that exist in the Supabase klient table
      const supabaseFields = ['navn', 'epost', 'telefon', 'aktiv', 'adresse', 'postnummer', 'poststed'];
      const filteredData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (supabaseFields.includes(key) && value !== undefined) {
          filteredData[key] = value;
        }
      }
      if (Object.keys(filteredData).length === 0) {
        return this.getKlientById(klientId);
      }
      const { data: updated, error } = await client
        .from('klient')
        .update(filteredData)
        .eq('id', klientId)
        .select()
        .single();

      if (error) throw new Error(`Failed to update klient: ${error.message}`);
      return updated;
    }

    if (!this.sqlite) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (fields.length === 0) return this.getKlientById(klientId);

    values.push(klientId);
    this.sqlite.prepare(`
      UPDATE klient SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return this.getKlientById(klientId);
  }

  /**
   * Get a single klient by ID
   */
  async getKlientById(klientId: number): Promise<KlientRecord | null> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client
        .from('klient')
        .select('*')
        .eq('id', klientId)
        .single();

      if (error) return null;
      return data;
    }

    if (!this.sqlite) return null;

    return this.sqlite.prepare(`
      SELECT * FROM klient WHERE id = ?
    `).get(klientId) as KlientRecord | null;
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
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data: result, error } = await client
        .from('password_reset_tokens')
        .insert({
          token: data.token_hash,
          user_id: data.user_id,
          user_type: data.user_type,
          epost: data.epost,
          expires_at: data.expires_at,
        })
        .select('id')
        .single();

      if (error) throw new Error(`Failed to create reset token: ${error.message}`);
      return { id: result.id };
    }

    if (!this.sqlite) throw new Error('Database not initialized');

    const result = this.sqlite.prepare(`
      INSERT INTO password_reset_tokens (token, user_id, user_type, epost, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(data.token_hash, data.user_id, data.user_type, data.epost, data.expires_at);

    return { id: result.lastInsertRowid as number };
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

  // ============ Reports ============

  async getReportKunderByStatus(organizationId: number): Promise<{ status: string; count: number }[]> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client.rpc('report_kunder_by_status', { org_id: organizationId });
      if (error) throw error;
      return data || [];
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return this.sqlite.prepare(`
      SELECT COALESCE(status, 'aktiv') as status, COUNT(*) as count
      FROM kunder WHERE organization_id = ?
      GROUP BY COALESCE(status, 'aktiv')
      ORDER BY count DESC
    `).all(organizationId) as any[];
  }

  async getReportKunderByKategori(organizationId: number): Promise<{ kategori: string; count: number }[]> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client.rpc('report_kunder_by_kategori', { org_id: organizationId });
      if (error) throw error;
      return data || [];
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return this.sqlite.prepare(`
      SELECT COALESCE(kategori, 'Annen') as kategori, COUNT(*) as count
      FROM kunder WHERE organization_id = ?
      GROUP BY COALESCE(kategori, 'Annen')
      ORDER BY count DESC
    `).all(organizationId) as any[];
  }

  async getReportKunderByPoststed(organizationId: number, limit: number = 10): Promise<{ poststed: string; count: number }[]> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client.rpc('report_kunder_by_poststed', { org_id: organizationId, max_rows: limit });
      if (error) throw error;
      return data || [];
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return this.sqlite.prepare(`
      SELECT COALESCE(poststed, 'Ukjent') as poststed, COUNT(*) as count
      FROM kunder WHERE organization_id = ?
      GROUP BY COALESCE(poststed, 'Ukjent')
      ORDER BY count DESC
      LIMIT ?
    `).all(organizationId, limit) as any[];
  }

  async getReportAvtalerStats(organizationId: number, months: number = 6): Promise<{ total: number; fullfort: number; planlagt: number; by_month: { month: string; count: number }[] }> {
    if (!this.sqlite) throw new Error('Database not initialized');

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    const startStr = startDate.toISOString().slice(0, 10);

    const totals = this.sqlite.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'fullført' THEN 1 ELSE 0 END) as fullfort,
        SUM(CASE WHEN status = 'planlagt' THEN 1 ELSE 0 END) as planlagt
      FROM avtaler WHERE organization_id = ? AND dato >= ?
    `).get(organizationId, startStr) as any;

    const byMonth = this.sqlite.prepare(`
      SELECT strftime('%Y-%m', dato) as month, COUNT(*) as count
      FROM avtaler WHERE organization_id = ? AND dato >= ?
      GROUP BY strftime('%Y-%m', dato)
      ORDER BY month
    `).all(organizationId, startStr) as any[];

    return {
      total: totals?.total || 0,
      fullfort: totals?.fullfort || 0,
      planlagt: totals?.planlagt || 0,
      by_month: byMonth,
    };
  }

  async getReportKontrollStatus(organizationId: number): Promise<{ overdue: number; upcoming_30: number; upcoming_90: number; ok: number }> {
    if (!this.sqlite) throw new Error('Database not initialized');

    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    const in30Str = in30.toISOString().slice(0, 10);
    const in90 = new Date();
    in90.setDate(in90.getDate() + 90);
    const in90Str = in90.toISOString().slice(0, 10);

    const result = this.sqlite.prepare(`
      SELECT
        SUM(CASE WHEN neste_kontroll < ? THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN neste_kontroll >= ? AND neste_kontroll <= ? THEN 1 ELSE 0 END) as upcoming_30,
        SUM(CASE WHEN neste_kontroll > ? AND neste_kontroll <= ? THEN 1 ELSE 0 END) as upcoming_90,
        SUM(CASE WHEN neste_kontroll > ? OR neste_kontroll IS NULL THEN 1 ELSE 0 END) as ok
      FROM kunder WHERE organization_id = ?
    `).get(today, today, in30Str, in30Str, in90Str, in90Str, organizationId) as any;

    return {
      overdue: result?.overdue || 0,
      upcoming_30: result?.upcoming_30 || 0,
      upcoming_90: result?.upcoming_90 || 0,
      ok: result?.ok || 0,
    };
  }

  // ============ Tags ============

  async getTagsByOrganization(organizationId: number): Promise<{ id: number; organization_id: number; navn: string; farge: string; created_at: string }[]> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client
        .from('tags')
        .select('*')
        .eq('organization_id', organizationId)
        .order('navn');
      if (error) throw error;
      return data || [];
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return this.sqlite.prepare('SELECT * FROM tags WHERE organization_id = ? ORDER BY navn').all(organizationId) as any[];
  }

  async createTag(data: { organization_id: number; navn: string; farge: string }): Promise<any> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data: result, error } = await client
        .from('tags')
        .insert(data)
        .select()
        .single();
      if (error) throw error;
      return result;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const result = this.sqlite.prepare('INSERT INTO tags (organization_id, navn, farge) VALUES (?, ?, ?)').run(data.organization_id, data.navn, data.farge);
    return this.sqlite.prepare('SELECT * FROM tags WHERE id = ?').get(result.lastInsertRowid);
  }

  async updateTag(id: number, organizationId: number, data: { navn?: string; farge?: string }): Promise<any | null> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data: result, error } = await client
        .from('tags')
        .update(data)
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select()
        .single();
      if (error) return null;
      return result;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const fields = Object.keys(data).filter(k => (data as Record<string, unknown>)[k] !== undefined);
    if (fields.length === 0) return null;
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => (data as Record<string, unknown>)[f]);
    const result = this.sqlite.prepare(`UPDATE tags SET ${setClause} WHERE id = ? AND organization_id = ?`).run(...values, id, organizationId);
    if (result.changes === 0) return null;
    return this.sqlite.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  }

  async deleteTag(id: number, organizationId: number): Promise<boolean> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { error } = await client
        .from('tags')
        .delete()
        .eq('id', id)
        .eq('organization_id', organizationId);
      return !error;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const result = this.sqlite.prepare('DELETE FROM tags WHERE id = ? AND organization_id = ?').run(id, organizationId);
    return result.changes > 0;
  }

  async getTagsForKunde(kundeId: number, organizationId: number): Promise<any[]> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client
        .from('kunde_tags')
        .select('tag_id, tags(id, organization_id, navn, farge, created_at)')
        .eq('kunde_id', kundeId);
      if (error) throw error;
      return (data || []).map((row: any) => row.tags).filter(Boolean);
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return this.sqlite.prepare(`
      SELECT t.* FROM tags t
      INNER JOIN kunde_tags kt ON kt.tag_id = t.id
      WHERE kt.kunde_id = ? AND t.organization_id = ?
      ORDER BY t.navn
    `).all(kundeId, organizationId) as any[];
  }

  async addTagToKunde(kundeId: number, tagId: number): Promise<boolean> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { error } = await client
        .from('kunde_tags')
        .insert({ kunde_id: kundeId, tag_id: tagId });
      // Ignore duplicate key errors (already tagged)
      if (error && error.code === '23505') return true;
      return !error;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    try {
      this.sqlite.prepare('INSERT OR IGNORE INTO kunde_tags (kunde_id, tag_id) VALUES (?, ?)').run(kundeId, tagId);
      return true;
    } catch {
      return false;
    }
  }

  async removeTagFromKunde(kundeId: number, tagId: number): Promise<boolean> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { error } = await client
        .from('kunde_tags')
        .delete()
        .eq('kunde_id', kundeId)
        .eq('tag_id', tagId);
      return !error;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const result = this.sqlite.prepare('DELETE FROM kunde_tags WHERE kunde_id = ? AND tag_id = ?').run(kundeId, tagId);
    return result.changes > 0;
  }

  // ============ Contact Persons (Kontaktpersoner) ============

  async getKontaktpersonerByKunde(kundeId: number, organizationId: number): Promise<any[]> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client
        .from('kontaktpersoner')
        .select('*')
        .eq('kunde_id', kundeId)
        .eq('organization_id', organizationId)
        .order('er_primaer', { ascending: false })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return this.sqlite.prepare(
      'SELECT * FROM kontaktpersoner WHERE kunde_id = ? AND organization_id = ? ORDER BY er_primaer DESC, created_at ASC'
    ).all(kundeId, organizationId);
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
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data: result, error } = await client
        .from('kontaktpersoner')
        .insert({
          kunde_id: data.kunde_id,
          organization_id: data.organization_id,
          navn: data.navn,
          rolle: data.rolle || null,
          telefon: data.telefon || null,
          epost: data.epost || null,
          er_primaer: data.er_primaer ?? false,
        })
        .select()
        .single();
      if (error) throw error;
      return result;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const stmt = this.sqlite.prepare(`
      INSERT INTO kontaktpersoner (kunde_id, organization_id, navn, rolle, telefon, epost, er_primaer)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.kunde_id, data.organization_id, data.navn,
      data.rolle || null, data.telefon || null, data.epost || null,
      data.er_primaer ? 1 : 0
    );
    return this.sqlite.prepare('SELECT * FROM kontaktpersoner WHERE id = ?').get(result.lastInsertRowid);
  }

  async updateKontaktperson(id: number, organizationId: number, data: Record<string, any>): Promise<any | null> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data: result, error } = await client
        .from('kontaktpersoner')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select()
        .single();
      if (error) return null;
      return result;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const fields = Object.keys(data).filter(k => data[k] !== undefined);
    if (fields.length === 0) return null;
    fields.push('updated_at');
    const setClause = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => f === 'updated_at' ? new Date().toISOString() : data[f]);
    const stmt = this.sqlite.prepare(`UPDATE kontaktpersoner SET ${setClause} WHERE id = ? AND organization_id = ?`);
    const result = stmt.run(...values, id, organizationId);
    if (result.changes === 0) return null;
    return this.sqlite.prepare('SELECT * FROM kontaktpersoner WHERE id = ?').get(id);
  }

  async deleteKontaktperson(id: number, organizationId: number): Promise<boolean> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { error } = await client
        .from('kontaktpersoner')
        .delete()
        .eq('id', id)
        .eq('organization_id', organizationId);
      return !error;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const result = this.sqlite.prepare('DELETE FROM kontaktpersoner WHERE id = ? AND organization_id = ?').run(id, organizationId);
    return result.changes > 0;
  }

  // ============ ACTIVE SESSIONS METHODS ============

  async createSession(data: {
    userId: number;
    userType: 'klient' | 'bruker';
    jti: string;
    ipAddress?: string;
    userAgent?: string;
    deviceInfo?: string;
    expiresAt: Date;
  }): Promise<void> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      await client.from('active_sessions').insert({
        user_id: data.userId,
        user_type: data.userType,
        jti: data.jti,
        ip_address: data.ipAddress,
        user_agent: data.userAgent,
        device_info: data.deviceInfo,
        expires_at: data.expiresAt.toISOString(),
      });
      return;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    this.sqlite.prepare(`
      INSERT INTO active_sessions (user_id, user_type, jti, ip_address, user_agent, device_info, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.userId, data.userType, data.jti,
      data.ipAddress, data.userAgent, data.deviceInfo,
      data.expiresAt.toISOString()
    );
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
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data, error } = await client
        .from('active_sessions')
        .select('id, jti, ip_address, user_agent, device_info, last_activity_at, created_at, expires_at')
        .eq('user_id', userId)
        .eq('user_type', userType)
        .gt('expires_at', new Date().toISOString())
        .order('last_activity_at', { ascending: false });
      if (error) return [];
      return data || [];
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return this.sqlite.prepare(`
      SELECT id, jti, ip_address, user_agent, device_info, last_activity_at, created_at, expires_at
      FROM active_sessions
      WHERE user_id = ? AND user_type = ? AND expires_at > datetime('now')
      ORDER BY last_activity_at DESC
    `).all(userId, userType) as Array<{
      id: number; jti: string; ip_address: string | null; user_agent: string | null;
      device_info: string | null; last_activity_at: string; created_at: string; expires_at: string;
    }>;
  }

  async deleteSessionByJti(jti: string): Promise<boolean> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { error } = await client
        .from('active_sessions')
        .delete()
        .eq('jti', jti);
      return !error;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const result = this.sqlite.prepare('DELETE FROM active_sessions WHERE jti = ?').run(jti);
    return result.changes > 0;
  }

  async deleteSessionById(id: number, userId: number, userType: 'klient' | 'bruker'): Promise<string | null> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      // Get the JTI before deleting so we can blacklist the token
      const { data } = await client
        .from('active_sessions')
        .select('jti')
        .eq('id', id)
        .eq('user_id', userId)
        .eq('user_type', userType)
        .single();
      if (!data) return null;
      await client.from('active_sessions').delete().eq('id', id);
      return data.jti;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const row = this.sqlite.prepare(
      'SELECT jti FROM active_sessions WHERE id = ? AND user_id = ? AND user_type = ?'
    ).get(id, userId, userType) as { jti: string } | undefined;
    if (!row) return null;
    this.sqlite.prepare('DELETE FROM active_sessions WHERE id = ?').run(id);
    return row.jti;
  }

  async updateSessionActivity(jti: string): Promise<void> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      await client
        .from('active_sessions')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('jti', jti);
      return;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    this.sqlite.prepare(
      "UPDATE active_sessions SET last_activity_at = datetime('now') WHERE jti = ?"
    ).run(jti);
  }

  async cleanupExpiredSessions(): Promise<number> {
    if (this.type === 'supabase' && this.supabase) {
      const client = this.supabase.getClient();
      const { data } = await client
        .from('active_sessions')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select('id');
      return data?.length || 0;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const result = this.sqlite.prepare(
      "DELETE FROM active_sessions WHERE expires_at < datetime('now')"
    ).run();
    return result.changes;
  }

  // ============ FEATURE MODULE METHODS ============

  private async getSupabaseClient() {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    return createClient(supabaseUrl, supabaseKey);
  }

  async getAllFeatureDefinitions(): Promise<import('../types').FeatureDefinition[]> {
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { data, error } = await supabase
        .from('feature_definitions')
        .select('*')
        .eq('aktiv', true)
        .order('sort_order');
      if (error) throw new Error(`Failed to fetch features: ${error.message}`);
      return data || [];
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return this.sqlite.prepare('SELECT * FROM feature_definitions WHERE aktiv = 1 ORDER BY sort_order').all() as import('../types').FeatureDefinition[];
  }

  async getFeatureDefinition(key: string): Promise<import('../types').FeatureDefinition | null> {
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { data, error } = await supabase
        .from('feature_definitions')
        .select('*')
        .eq('key', key)
        .single();
      if (error || !data) return null;
      return data;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const result = this.sqlite.prepare('SELECT * FROM feature_definitions WHERE key = ?').get(key);
    return (result as import('../types').FeatureDefinition) || null;
  }

  async getOrganizationFeatures(organizationId: number): Promise<import('../types').OrganizationFeature[]> {
    this.validateTenantContext(organizationId, 'getOrganizationFeatures');
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { data, error } = await supabase
        .from('organization_features')
        .select('*')
        .eq('organization_id', organizationId);
      if (error) throw new Error(`Failed to fetch org features: ${error.message}`);
      return data || [];
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return this.sqlite.prepare('SELECT * FROM organization_features WHERE organization_id = ?').all(organizationId) as import('../types').OrganizationFeature[];
  }

  async getOrganizationFeature(organizationId: number, featureKey: string): Promise<import('../types').OrganizationFeature | null> {
    this.validateTenantContext(organizationId, 'getOrganizationFeature');
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { data, error } = await supabase
        .from('organization_features')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('feature_key', featureKey)
        .single();
      if (error || !data) return null;
      return data;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const result = this.sqlite.prepare(
      'SELECT * FROM organization_features WHERE organization_id = ? AND feature_key = ?'
    ).get(organizationId, featureKey);
    return (result as import('../types').OrganizationFeature) || null;
  }

  async getEnabledFeatureKeys(organizationId: number): Promise<string[]> {
    this.validateTenantContext(organizationId, 'getEnabledFeatureKeys');
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { data, error } = await supabase
        .from('organization_features')
        .select('feature_key')
        .eq('organization_id', organizationId)
        .eq('enabled', true);
      if (error) throw new Error(`Failed to fetch enabled features: ${error.message}`);
      return (data || []).map((f: { feature_key: string }) => f.feature_key);
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const results = this.sqlite.prepare(
      'SELECT feature_key FROM organization_features WHERE organization_id = ? AND enabled = 1'
    ).all(organizationId) as { feature_key: string }[];
    return results.map(r => r.feature_key);
  }

  async enableFeature(organizationId: number, featureKey: string, config?: Record<string, unknown>): Promise<import('../types').OrganizationFeature> {
    this.validateTenantContext(organizationId, 'enableFeature');
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { data, error } = await supabase
        .from('organization_features')
        .upsert({
          organization_id: organizationId,
          feature_key: featureKey,
          enabled: true,
          config: config || {},
          activated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,feature_key' })
        .select()
        .single();
      if (error) throw new Error(`Failed to enable feature: ${error.message}`);
      return data;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    this.sqlite.prepare(`
      INSERT INTO organization_features (organization_id, feature_key, enabled, config, activated_at)
      VALUES (?, ?, 1, ?, datetime('now'))
      ON CONFLICT(organization_id, feature_key) DO UPDATE SET enabled = 1, config = ?, activated_at = datetime('now')
    `).run(organizationId, featureKey, JSON.stringify(config || {}), JSON.stringify(config || {}));
    return (await this.getOrganizationFeature(organizationId, featureKey))!;
  }

  async disableFeature(organizationId: number, featureKey: string): Promise<boolean> {
    this.validateTenantContext(organizationId, 'disableFeature');
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { error } = await supabase
        .from('organization_features')
        .update({ enabled: false })
        .eq('organization_id', organizationId)
        .eq('feature_key', featureKey);
      if (error) throw new Error(`Failed to disable feature: ${error.message}`);
      return true;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    this.sqlite.prepare(
      'UPDATE organization_features SET enabled = 0 WHERE organization_id = ? AND feature_key = ?'
    ).run(organizationId, featureKey);
    return true;
  }

  async updateFeatureConfig(organizationId: number, featureKey: string, config: Record<string, unknown>): Promise<import('../types').OrganizationFeature | null> {
    this.validateTenantContext(organizationId, 'updateFeatureConfig');
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { data, error } = await supabase
        .from('organization_features')
        .update({ config })
        .eq('organization_id', organizationId)
        .eq('feature_key', featureKey)
        .select()
        .single();
      if (error) throw new Error(`Failed to update feature config: ${error.message}`);
      return data;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    this.sqlite.prepare(
      'UPDATE organization_features SET config = ? WHERE organization_id = ? AND feature_key = ?'
    ).run(JSON.stringify(config), organizationId, featureKey);
    return this.getOrganizationFeature(organizationId, featureKey);
  }

  // ============ Organization Service Types ============

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async getOrganizationServiceTypes(organizationId: number): Promise<OrganizationServiceType[]> {
    this.validateTenantContext(organizationId, 'getOrganizationServiceTypes');
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { data, error } = await supabase
        .from('organization_service_types')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('aktiv', true)
        .order('sort_order', { ascending: true });
      if (error) throw new Error(`Failed to fetch service types: ${error.message}`);
      return (data || []) as OrganizationServiceType[];
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    return this.sqlite.prepare(
      'SELECT * FROM organization_service_types WHERE organization_id = ? AND aktiv = 1 ORDER BY sort_order ASC'
    ).all(organizationId) as OrganizationServiceType[];
  }

  async createOrganizationServiceType(
    organizationId: number,
    data: { name: string; slug?: string; icon?: string; color?: string; default_interval_months?: number; description?: string; sort_order?: number; source?: string; source_ref?: string }
  ): Promise<OrganizationServiceType> {
    this.validateTenantContext(organizationId, 'createOrganizationServiceType');
    const slug = data.slug || this.slugify(data.name);

    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { data: result, error } = await supabase
        .from('organization_service_types')
        .insert({
          organization_id: organizationId,
          name: data.name,
          slug,
          icon: data.icon || 'fa-wrench',
          color: data.color || '#F97316',
          default_interval_months: data.default_interval_months || 12,
          description: data.description || null,
          sort_order: data.sort_order || 0,
          source: data.source || 'manual',
          source_ref: data.source_ref || null,
        })
        .select()
        .single();
      if (error) throw new Error(`Failed to create service type: ${error.message}`);
      return result as OrganizationServiceType;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const info = this.sqlite.prepare(`
      INSERT INTO organization_service_types (organization_id, name, slug, icon, color, default_interval_months, description, sort_order, source, source_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      organizationId, data.name, slug,
      data.icon || 'fa-wrench', data.color || '#F97316',
      data.default_interval_months || 12, data.description || null,
      data.sort_order || 0, data.source || 'manual', data.source_ref || null
    );
    return this.sqlite.prepare('SELECT * FROM organization_service_types WHERE id = ?').get(Number(info.lastInsertRowid)) as OrganizationServiceType;
  }

  async updateOrganizationServiceType(
    organizationId: number,
    id: number,
    data: Partial<{ name: string; slug: string; icon: string; color: string; default_interval_months: number; description: string; sort_order: number }>
  ): Promise<OrganizationServiceType | null> {
    this.validateTenantContext(organizationId, 'updateOrganizationServiceType');

    // Auto-update slug if name changes and slug not explicitly provided
    if (data.name && !data.slug) {
      data.slug = this.slugify(data.name);
    }

    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { data: result, error } = await supabase
        .from('organization_service_types')
        .update(data)
        .eq('id', id)
        .eq('organization_id', organizationId)
        .select()
        .single();
      if (error) throw new Error(`Failed to update service type: ${error.message}`);
      return result as OrganizationServiceType;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
    const values = Object.values(data);
    this.sqlite.prepare(`UPDATE organization_service_types SET ${fields} WHERE id = ? AND organization_id = ?`).run(...values, id, organizationId);
    return this.sqlite.prepare('SELECT * FROM organization_service_types WHERE id = ? AND organization_id = ?').get(id, organizationId) as OrganizationServiceType | null;
  }

  async renameCustomerCategory(organizationId: number, oldName: string, newName: string): Promise<number> {
    this.validateTenantContext(organizationId, 'renameCustomerCategory');
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { data, error } = await supabase
        .from('kunder')
        .update({ kategori: newName })
        .eq('organization_id', organizationId)
        .eq('kategori', oldName)
        .select('id');
      if (error) throw new Error(`Failed to rename customer category: ${error.message}`);
      return data?.length || 0;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const result = this.sqlite.prepare('UPDATE kunder SET kategori = ? WHERE organization_id = ? AND kategori = ?').run(newName, organizationId, oldName);
    return result.changes;
  }

  async deleteOrganizationServiceType(organizationId: number, id: number): Promise<boolean> {
    this.validateTenantContext(organizationId, 'deleteOrganizationServiceType');
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      const { error } = await supabase
        .from('organization_service_types')
        .update({ aktiv: false })
        .eq('id', id)
        .eq('organization_id', organizationId);
      if (error) throw new Error(`Failed to delete service type: ${error.message}`);
      return true;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    this.sqlite.prepare('UPDATE organization_service_types SET aktiv = 0 WHERE id = ? AND organization_id = ?').run(id, organizationId);
    return true;
  }

  async copyTemplateServiceTypes(organizationId: number, templateId: number): Promise<OrganizationServiceType[]> {
    this.validateTenantContext(organizationId, 'copyTemplateServiceTypes');
    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      // Fetch template service types
      const { data: templates, error: fetchError } = await supabase
        .from('template_service_types')
        .select('*')
        .eq('template_id', templateId)
        .eq('aktiv', true)
        .order('sort_order', { ascending: true });
      if (fetchError) throw new Error(`Failed to fetch template service types: ${fetchError.message}`);
      if (!templates || templates.length === 0) return [];

      // Insert as org service types (ignore conflicts)
      const rows = templates.map((t: any) => ({
        organization_id: organizationId,
        name: t.name,
        slug: t.slug,
        icon: t.icon || 'fa-wrench',
        color: t.color || '#F97316',
        default_interval_months: t.default_interval_months || 12,
        description: t.description || null,
        sort_order: t.sort_order || 0,
        source: 'template',
        source_ref: String(t.id),
      }));

      const { data: result, error: insertError } = await supabase
        .from('organization_service_types')
        .upsert(rows, { onConflict: 'organization_id,slug', ignoreDuplicates: true })
        .select();
      if (insertError) throw new Error(`Failed to copy template service types: ${insertError.message}`);
      return (result || []) as OrganizationServiceType[];
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const templates = this.sqlite.prepare(
      'SELECT * FROM template_service_types WHERE template_id = ? AND aktiv = 1 ORDER BY sort_order ASC'
    ).all(templateId) as any[];
    const results: OrganizationServiceType[] = [];
    for (const t of templates) {
      try {
        this.sqlite.prepare(`
          INSERT OR IGNORE INTO organization_service_types (organization_id, name, slug, icon, color, default_interval_months, description, sort_order, source, source_ref)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'template', ?)
        `).run(organizationId, t.name, t.slug, t.icon || 'fa-wrench', t.color || '#F97316', t.default_interval_months || 12, t.description, t.sort_order || 0, String(t.id));
        const row = this.sqlite.prepare('SELECT * FROM organization_service_types WHERE organization_id = ? AND slug = ?').get(organizationId, t.slug) as OrganizationServiceType;
        if (row) results.push(row);
      } catch { /* ignore duplicate */ }
    }
    return results;
  }

  async findOrCreateServiceTypeByName(organizationId: number, name: string, source: string = 'manual'): Promise<OrganizationServiceType> {
    this.validateTenantContext(organizationId, 'findOrCreateServiceTypeByName');
    const slug = this.slugify(name);

    if (this.type === 'supabase') {
      const supabase = await this.getSupabaseClient();
      // Try to find existing
      const { data: existing } = await supabase
        .from('organization_service_types')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('slug', slug)
        .single();
      if (existing) return existing as OrganizationServiceType;

      // Create new
      const { data: created, error } = await supabase
        .from('organization_service_types')
        .insert({
          organization_id: organizationId,
          name,
          slug,
          source,
          source_ref: name,
        })
        .select()
        .single();
      if (error) {
        // Race condition: another request created it
        const { data: retry } = await supabase
          .from('organization_service_types')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('slug', slug)
          .single();
        if (retry) return retry as OrganizationServiceType;
        throw new Error(`Failed to create service type: ${error.message}`);
      }
      return created as OrganizationServiceType;
    }
    if (!this.sqlite) throw new Error('Database not initialized');
    const existing = this.sqlite.prepare(
      'SELECT * FROM organization_service_types WHERE organization_id = ? AND slug = ?'
    ).get(organizationId, slug) as OrganizationServiceType | undefined;
    if (existing) return existing;

    this.sqlite.prepare(`
      INSERT INTO organization_service_types (organization_id, name, slug, source, source_ref)
      VALUES (?, ?, ?, ?, ?)
    `).run(organizationId, name, slug, source, name);
    return this.sqlite.prepare(
      'SELECT * FROM organization_service_types WHERE organization_id = ? AND slug = ?'
    ).get(organizationId, slug) as OrganizationServiceType;
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

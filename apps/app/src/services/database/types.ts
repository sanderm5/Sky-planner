/**
 * Shared types for database domain modules.
 * These types allow domain-specific query files to access the database
 * without depending on the full DatabaseService class.
 */

import type { Kunde, Organization, Rute, Avtale, Kontaktlogg, EmailInnstilling, EmailVarsel, OrganizationServiceType } from '../../types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Re-export domain types for convenience
export type { Kunde, Organization, Rute, Avtale, Kontaktlogg, EmailInnstilling, EmailVarsel, OrganizationServiceType };

// Database backend type
export type DatabaseType = 'sqlite' | 'supabase';

// SQLite database type (better-sqlite3)
export type SqliteDatabase = {
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
export interface SupabaseClient {
  from(table: string): {
    select(columns?: string, options?: Record<string, any>): any;
    insert(data: any): any;
    upsert(data: any, options?: Record<string, any>): any;
    update(data: any): any;
    delete(options?: { count?: string }): any;
  };
  rpc(fn: string, params?: any): Promise<any>;
}

// Supabase service interface (legacy JS module)
export interface SupabaseService {
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

  // Customer services
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

  // Ruter
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

export interface KlientRecord {
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

export interface BrukerRecord {
  id: number;
  navn: string;
  epost: string;
  passord_hash: string;
  rolle?: string;
  organization_id?: number;
  aktiv: boolean;
  is_super_admin?: boolean;
}

export interface RefreshTokenRecord {
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

/**
 * Context object passed to domain query functions.
 * Provides access to the database backends and shared utilities.
 */
export interface DatabaseContext {
  type: DatabaseType;
  sqlite: SqliteDatabase | null;
  supabase: SupabaseService | null;
  validateTenantContext(organizationId: number | undefined, operation: string): asserts organizationId is number;
  getSupabaseClient(): Promise<SupabaseClient>;
}

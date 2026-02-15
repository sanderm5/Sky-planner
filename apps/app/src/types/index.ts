/**
 * Type definitions for Sky Planner SaaS application
 * Updated for dynamic service types (no hardcoded Sky Planner/Brannvarsling)
 */

// ============ Dynamic Service Type System ============

export interface ServiceType {
  id: number;
  template_id: number;
  name: string;
  slug: string;
  icon?: string;
  color?: string;
  default_interval_months: number;
  description?: string;
  sort_order: number;
  aktiv: boolean;
  subtypes?: ServiceSubtype[];
  equipmentTypes?: ServiceEquipment[];
}

export interface ServiceSubtype {
  id: number;
  service_type_id: number;
  name: string;
  slug: string;
  default_interval_months?: number;
  description?: string;
  sort_order: number;
  aktiv: boolean;
}

export interface ServiceEquipment {
  id: number;
  service_type_id: number;
  name: string;
  slug: string;
  description?: string;
  sort_order: number;
  aktiv: boolean;
}

export interface CustomerService {
  id: number;
  kunde_id: number;
  service_type_id: number;
  subtype_id?: number;
  equipment_type_id?: number;
  siste_kontroll?: string;
  neste_kontroll?: string;
  intervall_months?: number;
  driftstype?: string;
  notater?: string;
  aktiv: boolean;
  created_at?: string;

  // Joined fields from service type
  service_type_name?: string;
  service_type_slug?: string;
  service_type_icon?: string;
  service_type_color?: string;
  subtype_name?: string;
  subtype_slug?: string;
  equipment_name?: string;
  equipment_slug?: string;
}

export interface IndustryTemplate {
  id: number;
  name: string;
  slug: string;
  icon?: string;
  color?: string;
  description?: string;
  aktiv: boolean;
  sort_order: number;
  serviceTypes?: ServiceType[];
  intervals?: TemplateInterval[];
}

export interface TemplateInterval {
  id: number;
  template_id: number;
  months: number;
  label?: string;
  is_default: boolean;
}

// ============ Organization Service Types ============

export interface OrganizationServiceType {
  id: number;
  organization_id: number;
  name: string;
  slug: string;
  icon: string;
  color: string;
  default_interval_months: number;
  description?: string;
  sort_order: number;
  aktiv: boolean;
  source: 'template' | 'manual' | 'tripletex';
  source_ref?: string;
  created_at?: string;
}

// ============ Database Models ============

export interface Kunde {
  id: number;
  navn: string;
  adresse: string;
  postnummer?: string;
  poststed?: string;
  telefon?: string;
  epost?: string;
  lat?: number;
  lng?: number;

  // Dynamic services array (new system)
  services?: CustomerService[];

  // Legacy category and type fields (for backward compatibility)
  kategori?: string; // Dynamic - e.g., 'Sky Planner', 'Brannvarsling', or combined
  el_type?: string;
  brann_system?: string;
  brann_driftstype?: string;

  // Legacy Sky Planner dates (kept for backward compatibility)
  siste_el_kontroll?: string;
  neste_el_kontroll?: string;
  el_kontroll_intervall?: number;

  // Legacy Brannvarsling dates (kept for backward compatibility)
  siste_brann_kontroll?: string;
  neste_brann_kontroll?: string;
  brann_kontroll_intervall?: number;

  // Legacy generic fields (backwards compatibility)
  siste_kontroll?: string;
  neste_kontroll?: string;
  kontroll_intervall_mnd?: number;

  notater?: string;
  opprettet?: string;
  organization_id?: number;
  kontaktperson?: string;
  custom_data?: string; // JSON string for dynamic custom fields

  // External integration fields
  external_source?: string; // Integration ID (e.g., 'tripletex')
  external_id?: string;     // ID in the external system
  last_sync_at?: string;    // Last sync timestamp
  import_hash?: string;     // Hash for detecting changes
  last_import_at?: string;  // Last import timestamp
  prosjektnummer?: string;  // Project number(s) from accounting system
  kundenummer?: string;     // Customer number from accounting system
  faktura_epost?: string;   // Invoice email from accounting system
  org_nummer?: string;      // Organization number

  // Lifecycle tracking
  lifecycle_stage?: string;
  inquiry_sent_date?: string;
  last_visit_date?: string;
  job_confirmed_type?: string;
}

export interface Rute {
  id: number;
  navn: string;
  beskrivelse?: string;
  planlagt_dato?: string;
  total_distanse?: number; // km
  total_tid?: number; // minutes
  status: 'planlagt' | 'fullført';
  opprettet?: string;
  organization_id?: number;
  // Field work execution
  execution_started_at?: string;
  execution_ended_at?: string;
  current_stop_index?: number;
  // Route assignment
  assigned_to?: number | null;
  planned_date?: string;
}

export interface RuteKunde {
  id?: number;
  rute_id: number;
  kunde_id: number;
  rekkefolge: number;
  organization_id?: number;
}

export interface Kontaktlogg {
  id: number;
  kunde_id: number;
  dato: string;
  type: 'Telefonsamtale' | 'SMS' | 'E-post' | 'Besøk' | 'Annet';
  notat?: string;
  opprettet_av?: string;
  created_at?: string;
}

export interface Avtale {
  id: number;
  kunde_id?: number;
  dato: string;
  klokkeslett?: string;
  type: 'Sky Planner' | 'Brannvarsling';
  beskrivelse?: string;
  status: 'planlagt' | 'fullført';
  opprettet_av?: string;
  created_at?: string;
  organization_id?: number;
  er_gjentakelse?: boolean;
  gjentakelse_regel?: string;
  gjentakelse_slutt?: string;
  original_avtale_id?: number;
}

export interface EmailVarsel {
  id: number;
  kunde_id: number;
  epost: string;
  emne: string;
  melding: string;
  type: 'first_reminder' | 'second_reminder' | 'overdue';
  status: 'pending' | 'sent' | 'failed';
  sendt_dato?: string;
  feil_melding?: string;
  opprettet?: string;
}

export interface EmailInnstilling {
  kunde_id: number;
  email_aktiv: boolean;
  forste_varsel_dager: number;
  paaminnelse_etter_dager: number;
}

export interface LoginLogg {
  id: number;
  epost: string;
  bruker_navn?: string;
  bruker_type?: 'klient' | 'bruker';
  status: 'success' | 'failed';
  ip_adresse?: string;
  user_agent?: string;
  feil_melding?: string;
  tidspunkt?: string;
}

// ============ Auth Models ============

export interface Klient {
  id: number;
  navn: string;
  epost: string;
  passord: string; // hashed
  telefon?: string;
  aktiv: boolean;
  organization_id?: number;
  opprettet?: string;
}

export interface Bruker {
  id: number;
  navn: string;
  epost: string;
  passord: string; // hashed
  rolle: 'admin' | 'user';
  aktiv: boolean;
  opprettet?: string;
}

export type OnboardingStage = 'not_started' | 'industry_selected' | 'company_info' | 'map_settings' | 'data_import' | 'completed';

export type AppMode = 'mvp' | 'full';

// ============ Feature Module System ============

export type FeatureCategory = 'kart' | 'integrasjon' | 'feltarbeid' | 'kommunikasjon';

export type PlanType = 'free' | 'standard' | 'premium' | 'enterprise';

export interface FeatureDefinition {
  id: number;
  key: string;
  name: string;
  description?: string;
  category?: FeatureCategory;
  default_enabled: boolean;
  dependencies?: string[];
  config_schema?: Record<string, unknown>;
  aktiv: boolean;
  sort_order: number;
}

export interface OrganizationFeature {
  id: number;
  organization_id: number;
  feature_key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  activated_at?: string;
}

export interface FeatureWithStatus extends FeatureDefinition {
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface Organization {
  id: number;
  navn: string;
  slug: string;
  aktiv: boolean;
  plan_type: 'free' | 'standard' | 'premium' | 'enterprise';
  max_kunder: number;
  max_brukere: number;
  brand_title?: string;
  brand_subtitle?: string;
  primary_color?: string;
  logo_url?: string;
  map_center_lat?: number;
  map_center_lng?: number;
  map_zoom?: number;
  route_start_lat?: number;
  route_start_lng?: number;
  company_address?: string;
  company_postnummer?: string;
  company_poststed?: string;
  industry_template_id?: number | null;
  onboarding_completed?: boolean;
  onboarding_stage?: OnboardingStage;
  subscription_status?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
  trial_ends_at?: string;
  current_period_end?: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  app_mode?: AppMode; // 'mvp' = enkel versjon, 'full' = komplett (TRE Allservice)
  dato_modus?: 'full_date' | 'month_year'; // 'full_date' = standard, 'month_year' = kun måned+år
  opprettet?: string;
}

// ============ API Types ============

export interface JWTPayload {
  userId: number;
  epost: string;
  organizationId?: number;
  organizationSlug?: string;
  type: 'klient' | 'bruker';
  subscriptionStatus?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
  subscriptionPlan?: 'free' | 'standard' | 'premium' | 'enterprise';
  trialEndsAt?: string;
  currentPeriodEnd?: string;
  jti?: string; // JWT ID for token blacklisting
  iat?: number;
  exp?: number;
  // Impersonation fields (super-admin only)
  isImpersonating?: boolean;
  originalUserId?: number;
}

export interface ApiError {
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  requestId?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============ Request Types ============

export interface CreateKundeRequest {
  navn: string;
  adresse: string;
  postnummer?: string;
  poststed?: string;
  telefon?: string;
  epost?: string;
  lat?: number;
  lng?: number;
  kategori?: Kunde['kategori'];
  el_type?: Kunde['el_type'];
  brann_system?: string;
  brann_driftstype?: string;
  driftskategori?: string;
  siste_kontroll?: string;
  neste_kontroll?: string;
  siste_el_kontroll?: string;
  neste_el_kontroll?: string;
  siste_brann_kontroll?: string;
  neste_brann_kontroll?: string;
  kontroll_intervall_mnd?: number;
  el_kontroll_intervall?: number;
  brann_kontroll_intervall?: number;
  notater?: string;
  kontaktperson?: string;
  custom_data?: string;
}

export interface UpdateKundeRequest extends Partial<CreateKundeRequest> {
  siste_el_kontroll?: string;
  neste_el_kontroll?: string;
  siste_brann_kontroll?: string;
  neste_brann_kontroll?: string;
}

export interface BulkCompleteRequest {
  kunde_ids: number[];
  type: 'el' | 'brann' | 'begge';
  dato: string;
}

export interface CreateRuteRequest {
  navn: string;
  beskrivelse?: string;
  planlagt_dato?: string;
  kunde_ids: number[];
  total_distanse?: number;
  total_tid?: number;
}

export interface CreateAvtaleRequest {
  kunde_id?: number;
  dato: string;
  klokkeslett?: string;
  type?: 'Sky Planner' | 'Brannvarsling';
  beskrivelse?: string;
  gjentakelse_regel?: string;
  gjentakelse_slutt?: string;
}

export interface CreateKontaktloggRequest {
  type: Kontaktlogg['type'];
  notat?: string;
}

export interface LoginRequest {
  epost: string;
  passord: string;
  remember?: boolean;
}

// ============ Config Types ============

export interface AppConfig {
  appName: string;
  appYear: number;
  developerName: string;
  primaryColor: string;
  logoUrl?: string;
  mapCenterLat: number;
  mapCenterLng: number;
  mapZoom: number;
  orsApiKeyConfigured: boolean;
  routeStartLat?: number;
  routeStartLng?: number;
  enableRoutePlanning: boolean;
  emailNotificationsEnabled: boolean;
  organizationName?: string;
  companyName?: string;
  companySubtitle?: string;
  webUrl?: string;
  enabledFeatures?: string[];
  featureConfigs?: Record<string, Record<string, unknown>>;
  industry?: {
    id: number;
    name: string;
    slug: string;
    icon?: string;
    color?: string;
  };
  onboardingCompleted?: boolean;
  appMode?: 'mvp' | 'full';
  datoModus?: 'full_date' | 'month_year';
  serviceTypes?: Array<{
    id: number;
    name: string;
    slug: string;
    icon: string;
    color: string;
    defaultInterval: number;
    description?: string;
  }>;
  mapboxAccessToken?: string;
}

export interface EnvConfig {
  PORT: number;
  HOST: string;
  NODE_ENV: 'development' | 'production' | 'test';
  DATABASE_TYPE: 'sqlite' | 'supabase';
  JWT_SECRET: string;

  // Supabase
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;

  // Map
  MAP_CENTER_LAT: number;
  MAP_CENTER_LNG: number;
  MAP_ZOOM: number;

  // Route planning
  ORS_API_KEY?: string;
  ENABLE_ROUTE_PLANNING: boolean;
  ROUTE_START_LAT?: number;
  ROUTE_START_LNG?: number;

  // Email
  EMAIL_NOTIFICATIONS_ENABLED: boolean;
  EMAIL_HOST?: string;
  EMAIL_PORT?: number;
  EMAIL_USER?: string;
  EMAIL_PASS?: string;
  KLIENT_EPOST?: string;

  // Web URL (marketing site / dashboard)
  WEB_URL?: string;

  // Subscription
  SUBSCRIPTION_GRACE_PERIOD_DAYS: number;

  // AI Import (optional)
  AI_IMPORT_ENABLED?: boolean;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  AI_TIMEOUT_MS?: number;

  // Re-import Features (konservative defaults - begge av som default)
  REIMPORT_UPDATE_ENABLED?: boolean;
  DELETION_DETECTION_ENABLED?: boolean;

  // Encryption
  ENCRYPTION_SALT: string;

  // Tripletex
  TRIPLETEX_ENV: 'test' | 'production';

  // Mapbox
  MAPBOX_ACCESS_TOKEN?: string;
}

// ============ Express Extensions ============

import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
  organizationId?: number;
  requestId?: string;
  isSuperAdmin?: boolean;
}

// ============ Validation Types ============

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult = ValidationError[] | null;

// ============ AI Import Types ============

export interface AIColumnMapping {
  excelHeader: string;
  targetField: string | null;
  confidence: number;
  reasoning: string;
}

export interface AIColumnMappingResult {
  mappings: AIColumnMapping[];
  modelUsed: string;
  processingTimeMs: number;
  fallbackUsed: boolean;
}

export interface ImportMappingInfo {
  header: string;
  mappedTo: string | null;
  confidence: number;
  source: 'deterministic' | 'ai' | 'data-analysis';
  reasoning?: string;
  validationIssues?: string[];
}

export interface ImportPreviewResult {
  success: boolean;
  sessionId: string;
  data: {
    fileName: string;
    totalRows: number;
    totalColumns: number;
    preview: Record<string, unknown>[];
    stats: {
      valid: number;
      invalid: number;
      recognizedColumns: number;
      newColumns: number;
    };
    recognizedColumns: Array<{
      header: string;
      mappedTo: string;
      displayName: string;
      confidence?: number;
      source?: 'deterministic' | 'ai' | 'data-analysis';
    }>;
    newFields: Array<{
      header: string;
      fieldName: string;
      displayName: string;
      type: string;
      typeDisplay: string;
      optionsCount?: number;
    }>;
    autoMapping: {
      standardFields: Record<string, string>;
      customFields: Record<string, string>;
    };
    // AI-specific info
    aiEnabled: boolean;
    aiModelUsed?: string;
    overallConfidence: number;
    lowConfidenceMappings?: ImportMappingInfo[];
  };
}

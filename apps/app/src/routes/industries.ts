/**
 * Industry routes
 * Handles industry templates, service types, and onboarding
 */

import { Router, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { asyncHandler, Errors } from '../middleware/errorHandler';
import { requireTenantAuth } from '../middleware/auth';
import type { AuthenticatedRequest, ApiResponse } from '../types';

const router: Router = Router();

// Create Supabase client for direct queries
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Database service interface (will be injected)
interface DatabaseService {
  getAllIndustryTemplates(): Promise<IndustryTemplate[]>;
  getIndustryTemplateBySlug(slug: string): Promise<IndustryTemplateWithDetails | null>;
  getIndustryTemplateById(id: number): Promise<IndustryTemplateWithDetails | null>;
  getOrganizationById(id: number): Promise<OrganizationRecord | null>;
  updateOrganizationIndustry(organizationId: number, industryTemplateId: number): Promise<void>;
  getServiceTypesByTemplateId(templateId: number): Promise<ServiceType[]>;
  getSubtypesByServiceTypeId(serviceTypeId: number): Promise<Subtype[]>;
  getEquipmentByServiceTypeId(serviceTypeId: number): Promise<Equipment[]>;
  getIntervalsByTemplateId(templateId: number): Promise<Interval[]>;
}

interface IndustryTemplate {
  id: number;
  name: string;
  slug: string;
  icon: string;
  color: string;
  description: string;
  aktiv: boolean;
  sort_order: number;
}

interface IndustryTemplateWithDetails extends IndustryTemplate {
  serviceTypes: ServiceTypeWithDetails[];
  intervals: Interval[];
}

interface ServiceType {
  id: number;
  template_id: number;
  name: string;
  slug: string;
  icon: string;
  color: string;
  default_interval_months: number;
  description: string;
  sort_order: number;
  aktiv: boolean;
}

interface ServiceTypeWithDetails extends ServiceType {
  subtypes: Subtype[];
  equipment: Equipment[];
}

interface Subtype {
  id: number;
  service_type_id: number;
  name: string;
  slug: string;
  default_interval_months: number;
  sort_order: number;
}

interface Equipment {
  id: number;
  service_type_id: number;
  name: string;
  slug: string;
  sort_order: number;
}

interface Interval {
  id: number;
  template_id: number;
  months: number;
  label: string;
  is_default: boolean;
}

interface OrganizationRecord {
  id: number;
  navn: string;
  slug: string;
  industry_template_id: number | null;
  onboarding_completed: boolean;
}

// Dependencies (injected when routes are mounted)
let dbService: DatabaseService;

/**
 * Initialize industry routes with dependencies
 */
export function initIndustryRoutes(databaseService: DatabaseService): Router {
  dbService = databaseService;
  return router;
}

/**
 * GET /api/industries
 * Returns all active industry templates
 */
router.get(
  '/',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    // Query Supabase directly for industry templates
    const { data: industries, error } = await supabase
      .from('industry_templates')
      .select('*')
      .eq('aktiv', true)
      .order('sort_order');

    if (error) {
      throw Errors.internal('Kunne ikke hente bransjer: ' + error.message);
    }

    const response: ApiResponse = {
      success: true,
      data: (industries || []).map(industry => ({
        id: industry.id,
        name: industry.name,
        slug: industry.slug,
        icon: industry.icon,
        color: industry.color,
        description: industry.description,
        sortOrder: industry.sort_order,
      })),
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/industries/:slug
 * Returns a specific industry template with all service types, subtypes, and equipment
 */
router.get(
  '/:slug',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { slug } = req.params;

    // Get industry template using Supabase directly
    const { data: industry, error: industryError } = await supabase
      .from('industry_templates')
      .select('*')
      .eq('slug', slug)
      .single();

    if (industryError || !industry) {
      throw Errors.notFound('Bransje ikke funnet');
    }

    // Get all service types for this template
    const { data: serviceTypes, error: stError } = await supabase
      .from('template_service_types')
      .select('*')
      .eq('template_id', industry.id)
      .eq('aktiv', true)
      .order('sort_order');

    if (stError) {
      throw Errors.internal('Kunne ikke hente tjenesttyper: ' + stError.message);
    }

    // Get subtypes and equipment for each service type
    const serviceTypesWithDetails = await Promise.all(
      (serviceTypes || []).map(async (st: any) => {
        const [subtypesResult, equipmentResult] = await Promise.all([
          supabase.from('template_subtypes').select('*').eq('service_type_id', st.id).order('sort_order'),
          supabase.from('template_equipment').select('*').eq('service_type_id', st.id).order('sort_order'),
        ]);
        return {
          ...st,
          subtypes: subtypesResult.data || [],
          equipment: equipmentResult.data || [],
        };
      })
    );

    // Get intervals
    const { data: intervals } = await supabase
      .from('template_intervals')
      .select('*')
      .eq('template_id', industry.id)
      .order('months');

    const response: ApiResponse = {
      success: true,
      data: {
        id: industry.id,
        name: industry.name,
        slug: industry.slug,
        icon: industry.icon,
        color: industry.color,
        description: industry.description,
        serviceTypes: serviceTypesWithDetails.map((st: any) => ({
          id: st.id,
          name: st.name,
          slug: st.slug,
          icon: st.icon,
          color: st.color,
          defaultInterval: st.default_interval_months,
          description: st.description,
          sortOrder: st.sort_order,
          subtypes: (st.subtypes || []).map((sub: any) => ({
            id: sub.id,
            name: sub.name,
            slug: sub.slug,
            defaultInterval: sub.default_interval_months,
          })),
          equipment: (st.equipment || []).map((eq: any) => ({
            id: eq.id,
            name: eq.name,
            slug: eq.slug,
          })),
        })),
        intervals: (intervals || []).map((i: any) => ({
          months: i.months,
          label: i.label,
          isDefault: i.is_default,
        })),
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * POST /api/industries/select
 * Selects an industry for the current organization (onboarding)
 * Requires authentication
 */
router.post(
  '/select',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { industrySlug, industryId } = req.body;

    if (!industrySlug && !industryId) {
      throw Errors.validationError([{ field: 'industry', message: 'Bransje må velges' }]);
    }

    // Get user's organization
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw Errors.forbidden('Bruker må tilhøre en organisasjon');
    }

    // Find the industry template using Supabase directly
    let industryQuery = supabase.from('industry_templates').select('*');
    if (industrySlug) {
      industryQuery = industryQuery.eq('slug', industrySlug);
    } else if (industryId) {
      industryQuery = industryQuery.eq('id', industryId);
    }
    const { data: industryData, error: industryError } = await industryQuery.single();

    if (industryError || !industryData) {
      throw Errors.notFound('Bransje ikke funnet');
    }

    const industry = industryData;

    // Update organization with selected industry using Supabase directly
    const { error: updateError } = await supabase
      .from('organizations')
      .update({
        industry_template_id: industry.id,
        onboarding_completed: true
      })
      .eq('id', organizationId);

    if (updateError) {
      throw Errors.internal('Kunne ikke oppdatere organisasjon: ' + updateError.message);
    }

    // Copy template service types to organization for customization
    try {
      const { data: templateTypes } = await supabase
        .from('template_service_types')
        .select('*')
        .eq('template_id', industry.id)
        .eq('aktiv', true)
        .order('sort_order', { ascending: true });

      if (templateTypes && templateTypes.length > 0) {
        const rows = templateTypes.map((t: any) => ({
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
        await supabase
          .from('organization_service_types')
          .upsert(rows, { onConflict: 'organization_id,slug', ignoreDuplicates: true });
      }
    } catch {
      // Table may not exist yet - continue without copying service types
    }

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Bransje valgt',
        industry: {
          id: industry.id,
          name: industry.name,
          slug: industry.slug,
          icon: industry.icon,
          color: industry.color,
        },
        organization: {
          id: organizationId,
          onboardingCompleted: true,
          industryTemplateId: industry.id,
        },
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

/**
 * GET /api/industries/onboarding/status
 * Returns the onboarding status for the current organization
 * Requires authentication
 */
router.get(
  '/onboarding/status',
  requireTenantAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      // No organization, needs onboarding
      const response: ApiResponse = {
        success: true,
        data: {
          onboardingCompleted: false,
          industrySelected: false,
          industry: null,
        },
        requestId: req.requestId,
      };
      res.json(response);
      return;
    }

    const organization = await dbService.getOrganizationById(organizationId);

    if (!organization) {
      throw Errors.notFound('Organisasjon ikke funnet');
    }

    let industry = null;
    if (organization.industry_template_id) {
      industry = await dbService.getIndustryTemplateById(organization.industry_template_id);
    }

    const response: ApiResponse = {
      success: true,
      data: {
        onboardingCompleted: organization.onboarding_completed,
        industrySelected: !!organization.industry_template_id,
        industry: industry
          ? {
              id: industry.id,
              name: industry.name,
              slug: industry.slug,
              icon: industry.icon,
              color: industry.color,
            }
          : null,
      },
      requestId: req.requestId,
    };

    res.json(response);
  })
);

export default router;

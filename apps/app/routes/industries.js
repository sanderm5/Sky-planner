/**
 * Industry routes
 * Handles industry templates, service types, and onboarding
 */

const express = require('express');
const jwt = require('jsonwebtoken');

/**
 * Create industry routes with injected dependencies
 * @param {Object} deps - Dependencies
 * @param {Object} deps.db - SQLite database instance
 * @param {Object} deps.supabaseService - Supabase service
 * @param {boolean} deps.useSupabase - Whether to use Supabase
 * @param {string} deps.jwtSecret - JWT secret for token verification
 */
function createIndustriesRoutes({ db, supabaseService, useSupabase, jwtSecret }) {
  const router = express.Router();

  // Use injected jwtSecret for consistent token verification
  const JWT_SECRET = jwtSecret;

  // Auth middleware for protected routes
  function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Autentisering påkrevd' });
    }

    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({ success: false, error: 'Ugyldig token' });
    }
  }

  /**
   * GET /api/industries
   * Returns all active industry templates
   */
  router.get('/', async (req, res) => {
    try {
      let industries;

      if (useSupabase) {
        industries = await supabaseService.getAllIndustryTemplates() || [];
      } else {
        industries = db.prepare(`
          SELECT * FROM industry_templates
          WHERE aktiv = 1
          ORDER BY sort_order
        `).all();
      }

      res.json({
        success: true,
        data: industries.map(industry => ({
          id: industry.id,
          name: industry.name,
          slug: industry.slug,
          icon: industry.icon,
          color: industry.color,
          description: industry.description,
          sortOrder: industry.sort_order
        }))
      });
    } catch (error) {
      console.error('Error fetching industries:', error);
      res.status(500).json({ success: false, error: 'Kunne ikke hente bransjer' });
    }
  });

  /**
   * GET /api/industries/:slug
   * Returns a specific industry template with all service types
   */
  router.get('/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      let industry, serviceTypes, intervals;

      if (useSupabase) {
        // Use the full config helper from supabase-service
        const config = await supabaseService.getFullIndustryConfig(slug);
        if (!config) {
          return res.status(404).json({ success: false, error: 'Bransje ikke funnet' });
        }

        // Return formatted response
        return res.json({
          success: true,
          data: {
            id: config.id,
            name: config.name,
            slug: config.slug,
            icon: config.icon,
            color: config.color,
            description: config.description,
            serviceTypes: config.serviceTypes || [],
            intervals: config.intervals || []
          }
        });
      } else {
        // SQLite
        industry = db.prepare(`
          SELECT * FROM industry_templates WHERE slug = ?
        `).get(slug);

        if (!industry) {
          return res.status(404).json({ success: false, error: 'Bransje ikke funnet' });
        }

        serviceTypes = db.prepare(`
          SELECT * FROM template_service_types
          WHERE template_id = ?
          ORDER BY sort_order
        `).all(industry.id);

        intervals = db.prepare(`
          SELECT * FROM template_intervals
          WHERE template_id = ?
          ORDER BY months
        `).all(industry.id);

        // Get subtypes and equipment for each service type
        for (const st of serviceTypes) {
          st.subtypes = db.prepare(`
            SELECT * FROM template_subtypes
            WHERE service_type_id = ?
            ORDER BY sort_order
          `).all(st.id);

          st.equipment = db.prepare(`
            SELECT * FROM template_equipment
            WHERE service_type_id = ?
            ORDER BY sort_order
          `).all(st.id);
        }
      }

      res.json({
        success: true,
        data: {
          id: industry.id,
          name: industry.name,
          slug: industry.slug,
          icon: industry.icon,
          color: industry.color,
          description: industry.description,
          serviceTypes: serviceTypes.map(st => ({
            id: st.id,
            name: st.name,
            slug: st.slug,
            icon: st.icon,
            color: st.color,
            defaultInterval: st.default_interval_months,
            description: st.description,
            sortOrder: st.sort_order,
            subtypes: (st.subtypes || []).map(sub => ({
              id: sub.id,
              name: sub.name,
              slug: sub.slug,
              defaultInterval: sub.default_interval_months
            })),
            equipment: (st.equipment || []).map(eq => ({
              id: eq.id,
              name: eq.name,
              slug: eq.slug
            }))
          })),
          intervals: intervals.map(i => ({
            months: i.months,
            label: i.label,
            isDefault: !!i.is_default
          }))
        }
      });
    } catch (error) {
      console.error('Error fetching industry:', error);
      res.status(500).json({ success: false, error: 'Kunne ikke hente bransje' });
    }
  });

  /**
   * POST /api/industries/select
   * Selects an industry for the current organization (onboarding)
   */
  router.post('/select', requireAuth, async (req, res) => {
    try {
      const { industrySlug, industryId } = req.body;
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.status(403).json({ success: false, error: 'Bruker må tilhøre en organisasjon' });
      }

      if (!industrySlug && !industryId) {
        return res.status(400).json({ success: false, error: 'Bransje må velges' });
      }

      let industry;

      if (useSupabase) {
        // Get industry template
        industry = industrySlug
          ? await supabaseService.getIndustryTemplateBySlug(industrySlug)
          : await supabaseService.getIndustryTemplateById(industryId);

        if (!industry) {
          return res.status(404).json({ success: false, error: 'Bransje ikke funnet' });
        }

        // Update organization with industry (don't overwrite brand_title or brand_subtitle - keep org settings)
        const { error: updateError } = await supabaseService.getClient()
          .from('organizations')
          .update({
            industry_template_id: industry.id,
            onboarding_completed: true
          })
          .eq('id', organizationId);

        if (updateError) throw updateError;
      } else {
        // SQLite
        industry = industrySlug
          ? db.prepare('SELECT * FROM industry_templates WHERE slug = ?').get(industrySlug)
          : db.prepare('SELECT * FROM industry_templates WHERE id = ?').get(industryId);

        if (!industry) {
          return res.status(404).json({ success: false, error: 'Bransje ikke funnet' });
        }

        // Update organization with industry (don't overwrite brand_title or brand_subtitle - keep org settings)
        db.prepare(`
          UPDATE organizations
          SET industry_template_id = ?, onboarding_completed = 1
          WHERE id = ?
        `).run(industry.id, organizationId);
      }

      res.json({
        success: true,
        data: {
          message: 'Bransje valgt',
          industry: {
            id: industry.id,
            name: industry.name,
            slug: industry.slug,
            icon: industry.icon,
            color: industry.color
          },
          organization: {
            id: organizationId,
            onboardingCompleted: true,
            industryTemplateId: industry.id
          }
        }
      });
    } catch (error) {
      console.error('Error selecting industry:', error);
      res.status(500).json({ success: false, error: 'Kunne ikke velge bransje' });
    }
  });

  /**
   * GET /api/industries/onboarding/status
   * Returns onboarding status for the current organization
   */
  router.get('/onboarding/status', requireAuth, async (req, res) => {
    try {
      const organizationId = req.user?.organizationId;

      if (!organizationId) {
        return res.json({
          success: true,
          data: {
            onboardingCompleted: false,
            industrySelected: false,
            industry: null
          }
        });
      }

      let organization, industry;

      if (useSupabase) {
        organization = await supabaseService.getOrganizationById(organizationId);

        if (organization?.industry_template_id) {
          industry = await supabaseService.getIndustryTemplateById(organization.industry_template_id);
        }
      } else {
        organization = db.prepare('SELECT * FROM organizations WHERE id = ?').get(organizationId);

        if (organization?.industry_template_id) {
          industry = db.prepare('SELECT * FROM industry_templates WHERE id = ?').get(organization.industry_template_id);
        }
      }

      res.json({
        success: true,
        data: {
          onboardingCompleted: !!organization?.onboarding_completed,
          industrySelected: !!organization?.industry_template_id,
          industry: industry ? {
            id: industry.id,
            name: industry.name,
            slug: industry.slug,
            icon: industry.icon,
            color: industry.color
          } : null
        }
      });
    } catch (error) {
      console.error('Error fetching onboarding status:', error);
      res.status(500).json({ success: false, error: 'Kunne ikke hente onboarding-status' });
    }
  });

  return router;
}

module.exports = createIndustriesRoutes;

/**
 * Feature module middleware
 * Checks if a feature is enabled for the requesting organization
 */

import { Response, NextFunction } from 'express';
import { Errors } from './errorHandler';
import { authLogger } from '../services/logger';
import type { AuthenticatedRequest } from '../types';

/**
 * Middleware that requires a specific feature to be enabled for the organization.
 * Must be used after requireTenantAuth (needs organizationId on request).
 *
 * Usage:
 *   router.post('/some-endpoint', requireTenantAuth, requireFeature('tripletex_projects'), handler)
 */
export function requireFeature(featureKey: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.organizationId) {
      return next(Errors.unauthorized('Mangler organisasjonskontekst'));
    }

    try {
      const { getDatabase } = await import('../services/database');
      const db = await getDatabase();

      // Check feature definition exists and is active
      const featureDef = await db.getFeatureDefinition(featureKey);
      if (!featureDef || !featureDef.aktiv) {
        return next(Errors.notFound(`Funksjon '${featureKey}' finnes ikke`));
      }

      // Check if feature is enabled for this organization
      const orgFeature = await db.getOrganizationFeature(req.organizationId, featureKey);
      if (!orgFeature?.enabled) {
        authLogger.debug({
          userId: req.user?.userId,
          organizationId: req.organizationId,
          feature: featureKey,
        }, 'Feature not enabled for organization');
        return next(Errors.forbidden(`Funksjonen '${featureDef.name}' er ikke aktivert for din organisasjon`));
      }

      // Check dependencies
      if (featureDef.dependencies && featureDef.dependencies.length > 0) {
        const enabledFeatures = await db.getEnabledFeatureKeys(req.organizationId);
        const missingDeps = featureDef.dependencies.filter(dep => !enabledFeatures.includes(dep));
        if (missingDeps.length > 0) {
          return next(Errors.forbidden(`Funksjonen krever at følgende er aktivert: ${missingDeps.join(', ')}`));
        }
      }

      next();
    } catch (error) {
      authLogger.error({ error, feature: featureKey }, 'Failed to check feature access');
      return next(Errors.internal('Kunne ikke verifisere funksjonstilgang'));
    }
  };
}

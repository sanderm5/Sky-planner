/**
 * Subscription validation middleware
 * Checks if the user has an active subscription before allowing access
 */

import { Response, NextFunction } from 'express';
import { authLogger } from '../services/logger';
import { Errors } from './errorHandler';
import { getConfig } from '../config/env';
import type { AuthenticatedRequest } from '../types';

type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';

interface SubscriptionCheckResult {
  isActive: boolean;
  reason?: 'trial_expired' | 'canceled' | 'payment_failed' | 'incomplete' | 'grace_period_exceeded';
  message: string;
  isInGracePeriod?: boolean;
}

/**
 * Check if subscription is active based on status and dates
 */
export function checkSubscriptionStatus(
  status: SubscriptionStatus | undefined,
  trialEndsAt: string | undefined,
  currentPeriodEnd: string | undefined
): SubscriptionCheckResult {
  const config = getConfig();
  const now = new Date();
  const gracePeriodDays = config.SUBSCRIPTION_GRACE_PERIOD_DAYS;

  // No status means no subscription data - default to allowing (for legacy/migration)
  if (!status) {
    authLogger.warn('No subscription status found - allowing access (legacy/migration)');
    return {
      isActive: true,
      message: 'Ingen abonnementsstatus funnet',
    };
  }

  switch (status) {
    case 'active':
      return {
        isActive: true,
        message: 'Aktivt abonnement',
      };

    case 'trialing': {
      // Check if trial has expired
      if (trialEndsAt) {
        const trialEnd = new Date(trialEndsAt);
        if (now > trialEnd) {
          return {
            isActive: false,
            reason: 'trial_expired',
            message: 'Prøveperioden din har utløpt. Oppgrader til et abonnement for å fortsette.',
          };
        }
      }
      return {
        isActive: true,
        message: 'I prøveperiode',
      };
    }

    case 'past_due': {
      // Allow grace period after payment failure
      if (currentPeriodEnd) {
        const periodEnd = new Date(currentPeriodEnd);
        const graceEnd = new Date(periodEnd);
        graceEnd.setDate(graceEnd.getDate() + gracePeriodDays);

        if (now <= graceEnd) {
          return {
            isActive: true,
            isInGracePeriod: true,
            message: `Betalingen din har feilet. Oppdater betalingsmetode innen ${gracePeriodDays} dager.`,
          };
        }
      }
      return {
        isActive: false,
        reason: 'grace_period_exceeded',
        message: 'Betalingen din har feilet og fristen for å oppdatere betalingsmetode er utløpt.',
      };
    }

    case 'canceled':
      return {
        isActive: false,
        reason: 'canceled',
        message: 'Abonnementet ditt er kansellert. Reaktiver for å få tilgang.',
      };

    case 'incomplete':
      return {
        isActive: false,
        reason: 'incomplete',
        message: 'Abonnementet ditt er ikke fullført. Fullfør registreringen for å få tilgang.',
      };

    default:
      return {
        isActive: false,
        reason: 'incomplete',
        message: 'Ukjent abonnementsstatus.',
      };
  }
}

/**
 * Middleware that requires an active subscription
 * Must be used after requireTenantAuth
 */
export function requireActiveSubscription(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const config = getConfig();
  const user = req.user;

  if (!user) {
    return next(Errors.unauthorized('Ikke autentisert'));
  }

  // Super admins impersonating bypass subscription checks
  if (user.isImpersonating) {
    return next();
  }

  const result = checkSubscriptionStatus(
    user.subscriptionStatus as SubscriptionStatus | undefined,
    user.trialEndsAt,
    user.currentPeriodEnd
  );

  // Log grace period warnings
  if (result.isInGracePeriod) {
    authLogger.warn({
      userId: user.userId,
      organizationId: user.organizationId,
      status: user.subscriptionStatus,
    }, 'User in subscription grace period');
  }

  if (!result.isActive) {
    authLogger.warn({
      userId: user.userId,
      organizationId: user.organizationId,
      status: user.subscriptionStatus,
      reason: result.reason,
    }, 'Subscription check failed');

    const redirectUrl = `${config.WEB_URL}/dashboard/abonnement`;
    return next(
      Errors.subscriptionInactive(user.subscriptionStatus || 'unknown', result.message, redirectUrl)
    );
  }

  next();
}

/**
 * Optional middleware that adds subscription warning to response
 * Does not block requests, but adds warning header for frontend
 */
export function checkSubscriptionWarning(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const user = req.user;

  if (!user) {
    return next();
  }

  const result = checkSubscriptionStatus(
    user.subscriptionStatus as SubscriptionStatus | undefined,
    user.trialEndsAt,
    user.currentPeriodEnd
  );

  // Add warning header only for grace period (payment issues)
  // Trial users already see the countdown timer, no need for intrusive banner
  if (result.isInGracePeriod) {
    res.setHeader('X-Subscription-Warning', result.message);
  }

  next();
}

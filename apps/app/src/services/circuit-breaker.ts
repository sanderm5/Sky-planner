/**
 * Circuit Breaker Service
 * Prevents cascading failures when external services are down.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is down, requests fail fast without calling the service
 * - HALF_OPEN: Testing if service is back, allows one request through
 */

import { createLogger } from './logger';
import { sendAlert } from './alerts';

const logger = createLogger('circuit-breaker');

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Name of the service (for logging/alerts) */
  name: string;
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms before attempting to close the circuit (default: 60000 = 1 min) */
  resetTimeoutMs?: number;
  /** Time window in ms for counting failures (default: 120000 = 2 min) */
  failureWindowMs?: number;
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureTime: number;
  lastStateChange: number;
  consecutiveSuccesses: number;
  totalFailures: number;
  totalSuccesses: number;
  lastError?: string;
}

class CircuitBreaker {
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly failureWindowMs: number;
  private breaker: CircuitBreakerState;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
    this.failureWindowMs = options.failureWindowMs ?? 120_000;
    this.breaker = {
      state: 'CLOSED',
      failures: 0,
      lastFailureTime: 0,
      lastStateChange: Date.now(),
      consecutiveSuccesses: 0,
      totalFailures: 0,
      totalSuccesses: 0,
    };
  }

  get state(): CircuitState {
    return this.breaker.state;
  }

  get stats() {
    const isProduction = process.env.NODE_ENV === 'production';
    return {
      name: this.name,
      state: this.breaker.state,
      failures: this.breaker.failures,
      totalFailures: this.breaker.totalFailures,
      totalSuccesses: this.breaker.totalSuccesses,
      lastError: isProduction ? (this.breaker.lastError ? 'Error occurred' : undefined) : this.breaker.lastError,
      lastStateChange: new Date(this.breaker.lastStateChange).toISOString(),
    };
  }

  /**
   * Execute a function with circuit breaker protection.
   * If the circuit is open, throws immediately without calling fn.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.breaker.state === 'OPEN') {
      // Check if enough time has passed to try again
      if (Date.now() - this.breaker.lastFailureTime >= this.resetTimeoutMs) {
        this.transition('HALF_OPEN');
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Execute with a fallback value returned when circuit is open.
   */
  async executeWithFallback<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await this.execute(fn);
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        logger.debug({ service: this.name }, 'Circuit open, using fallback');
        return fallback;
      }
      throw error;
    }
  }

  private onSuccess(): void {
    this.breaker.totalSuccesses++;
    this.breaker.consecutiveSuccesses++;

    if (this.breaker.state === 'HALF_OPEN') {
      // Service recovered
      this.transition('CLOSED');
      this.breaker.failures = 0;
      logger.info({ service: this.name }, 'Circuit breaker closed — service recovered');
      sendAlert({
        title: `Tjeneste gjenopprettet: ${this.name}`,
        message: `${this.name} er tilgjengelig igjen etter nedetid.`,
        severity: 'info',
        source: 'circuit-breaker',
        metadata: { service: this.name },
      }).catch(() => {});
    }
  }

  private onFailure(error: unknown): void {
    const now = Date.now();
    this.breaker.totalFailures++;
    this.breaker.consecutiveSuccesses = 0;
    this.breaker.lastError = error instanceof Error ? error.message : String(error);

    // Reset failure count if outside the failure window
    if (now - this.breaker.lastFailureTime > this.failureWindowMs) {
      this.breaker.failures = 0;
    }

    this.breaker.failures++;
    this.breaker.lastFailureTime = now;

    if (this.breaker.state === 'HALF_OPEN') {
      // Still failing, re-open
      this.transition('OPEN');
      logger.warn({ service: this.name, error: this.breaker.lastError }, 'Circuit breaker re-opened — service still down');
    } else if (this.breaker.failures >= this.failureThreshold) {
      this.transition('OPEN');
      logger.error({ service: this.name, failures: this.breaker.failures, error: this.breaker.lastError }, 'Circuit breaker opened — service down');
      sendAlert({
        title: `Tjeneste nede: ${this.name}`,
        message: `${this.name} har feilet ${this.breaker.failures} ganger. Circuit breaker åpnet — forespørsler feiler umiddelbart til tjenesten er tilgjengelig igjen. Siste feil: ${this.breaker.lastError}`,
        severity: 'error',
        source: 'circuit-breaker',
        metadata: { service: this.name, failures: this.breaker.failures, lastError: this.breaker.lastError },
      }).catch(() => {});
    }
  }

  private transition(newState: CircuitState): void {
    this.breaker.state = newState;
    this.breaker.lastStateChange = Date.now();
  }
}

/**
 * Error thrown when the circuit is open (service is down).
 */
export class CircuitOpenError extends Error {
  constructor(public readonly serviceName: string) {
    super(`Tjeneste utilgjengelig: ${serviceName} (circuit breaker åpen)`);
    this.name = 'CircuitOpenError';
  }
}

// ============ Registry of circuit breakers ============

const breakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker for a service.
 */
export function getCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const existing = breakers.get(options.name);
  if (existing) return existing;

  const cb = new CircuitBreaker(options);
  breakers.set(options.name, cb);
  return cb;
}

/**
 * Get status of all circuit breakers.
 */
export function getAllCircuitBreakerStats() {
  const stats: Record<string, CircuitBreaker['stats']> = {};
  for (const [name, cb] of breakers) {
    stats[name] = cb.stats;
  }
  return stats;
}

// ============ Pre-configured breakers for known services ============

export const breakers_config = {
  kartverket: { name: 'Kartverket', failureThreshold: 5, resetTimeoutMs: 60_000 },
  ors: { name: 'OpenRouteService', failureThreshold: 3, resetTimeoutMs: 120_000 },
  mapbox: { name: 'Mapbox', failureThreshold: 5, resetTimeoutMs: 60_000 },
  nominatim: { name: 'Nominatim', failureThreshold: 5, resetTimeoutMs: 60_000 },
  tripletex: { name: 'Tripletex', failureThreshold: 3, resetTimeoutMs: 300_000 },
  fiken: { name: 'Fiken', failureThreshold: 3, resetTimeoutMs: 300_000 },
  poweroffice: { name: 'PowerOffice', failureThreshold: 3, resetTimeoutMs: 300_000 },
} as const;

export function getKartverketBreaker() { return getCircuitBreaker(breakers_config.kartverket); }
export function getOrsBreaker() { return getCircuitBreaker(breakers_config.ors); }
export function getMapboxBreaker() { return getCircuitBreaker(breakers_config.mapbox); }
export function getNominatimBreaker() { return getCircuitBreaker(breakers_config.nominatim); }

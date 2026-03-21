/**
 * Startup Self-Check Service
 * Validates configuration and external service connectivity on boot.
 * Logs warnings for non-critical issues, exits on critical failures.
 */

import { createLogger } from './logger';
import { sendAlert } from './alerts';

const logger = createLogger('startup-check');

interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message?: string;
  latency_ms?: number;
}

/**
 * Run all startup checks. Logs results and sends alert if issues found.
 */
export async function runStartupChecks(): Promise<void> {
  const results: CheckResult[] = [];
  const startTime = Date.now();

  logger.info('Kjører oppstartssjekker...');

  // 1. Check required env vars
  results.push(checkEnvVar('JWT_SECRET', true, 64));
  results.push(checkEnvVar('CRON_SECRET', true));
  results.push(checkEnvVar('ENCRYPTION_SALT', true, 32));

  // 2. Check optional but important env vars
  results.push(checkEnvVar('ORS_API_KEY', false));
  results.push(checkEnvVar('MAPBOX_ACCESS_TOKEN', false));
  results.push(checkEnvVar('BACKUP_ENCRYPTION_KEY', false));
  results.push(checkEnvVar('ALERT_SLACK_WEBHOOK', false));

  // 3. Check database connectivity
  results.push(await checkDatabase());

  // 4. Check external services (non-blocking, parallel)
  const externalChecks = await Promise.allSettled([
    checkExternalService('Kartverket', 'https://ws.geonorge.no/adresser/v1/sok?sok=test&treffPerSide=1'),
    checkExternalService('OpenRouteService', 'https://api.openrouteservice.org/health'),
    checkExternalService('Nominatim', 'https://nominatim.openstreetmap.org/status'),
  ]);

  for (const result of externalChecks) {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    }
  }

  // Summarize
  const errors = results.filter(r => r.status === 'error');
  const warnings = results.filter(r => r.status === 'warning');
  const ok = results.filter(r => r.status === 'ok');

  const duration = Date.now() - startTime;

  logger.info(
    { ok: ok.length, warnings: warnings.length, errors: errors.length, duration },
    `Oppstartssjekker fullført: ${ok.length} OK, ${warnings.length} advarsler, ${errors.length} feil`
  );

  for (const warn of warnings) {
    logger.warn({ check: warn.name }, `Advarsel: ${warn.message}`);
  }

  for (const err of errors) {
    logger.error({ check: err.name }, `Feil: ${err.message}`);
  }

  // Send alert if there are warnings or errors in production
  if ((warnings.length > 0 || errors.length > 0) && process.env.NODE_ENV === 'production') {
    const issueList = [...errors, ...warnings]
      .map(r => `- [${r.status.toUpperCase()}] ${r.name}: ${r.message}`)
      .join('\n');

    sendAlert({
      title: 'Oppstartssjekker fant problemer',
      message: `Serveren startet med ${errors.length} feil og ${warnings.length} advarsler:\n${issueList}`,
      severity: errors.length > 0 ? 'error' : 'warning',
      source: 'startup-check',
      metadata: {
        errors: errors.length,
        warnings: warnings.length,
        ok: ok.length,
        duration,
      },
    }).catch(() => {});
  }

  // Exit on critical failures in production (missing auth config or database down)
  if (errors.length > 0 && process.env.NODE_ENV === 'production') {
    const hasCritical = errors.some(e =>
      e.name.includes('JWT_SECRET') || e.name === 'Database'
    );
    if (hasCritical) {
      logger.fatal('Kritisk oppstartsfeil — avslutter prosessen');
      process.exit(1);
    }
  }
}

function checkEnvVar(name: string, required: boolean, minLength?: number): CheckResult {
  const value = process.env[name];
  const isProduction = process.env.NODE_ENV === 'production';

  if (!value) {
    if (required && isProduction) {
      return { name: `ENV: ${name}`, status: 'error', message: `${name} mangler (påkrevd i produksjon)` };
    }
    return { name: `ENV: ${name}`, status: 'warning', message: `${name} er ikke satt` };
  }

  if (minLength && value.length < minLength && isProduction) {
    return { name: `ENV: ${name}`, status: 'error', message: `${name} er for kort (${value.length} < ${minLength} tegn)` };
  }

  return { name: `ENV: ${name}`, status: 'ok' };
}

async function checkDatabase(): Promise<CheckResult> {
  try {
    const start = Date.now();
    const { getDatabase } = await import('./database');
    const db = await getDatabase();

    if ('supabase' in db && (db as any).supabase) {
      // supabase-service.js exposes helper functions, not the raw client
      // Use getClient() to get the actual Supabase client for health checks
      const client = (db as any).supabase.getClient?.() ?? (db as any).supabase;
      if (typeof client.from === 'function') {
        const { error } = await client.from('organizations').select('id').limit(1);
        if (error) throw error;
      }
    }

    return { name: 'Database', status: 'ok', latency_ms: Date.now() - start };
  } catch (error) {
    return {
      name: 'Database',
      status: 'error',
      message: `Databasetilkobling feilet: ${error instanceof Error ? error.message : 'ukjent feil'}`,
    };
  }
}

async function checkExternalService(name: string, url: string): Promise<CheckResult> {
  try {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SkyPlanner/1.0 (startup-check)' },
    }).finally(() => clearTimeout(timer));

    const latency = Date.now() - start;

    if (response.ok) {
      return { name, status: 'ok', latency_ms: latency };
    }

    return {
      name,
      status: 'warning',
      message: `${name} returnerte status ${response.status}`,
      latency_ms: latency,
    };
  } catch (error) {
    return {
      name,
      status: 'warning',
      message: `${name} er utilgjengelig: ${error instanceof Error ? error.message : 'timeout'}`,
    };
  }
}

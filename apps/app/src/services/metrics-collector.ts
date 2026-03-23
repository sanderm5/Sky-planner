/**
 * Metrics Collector Service
 * Collects and aggregates system metrics in-memory with rolling time windows.
 * Provides accurate averages, percentiles, and counts for the monitoring dashboard.
 */

interface RequestMetric {
  timestamp: number;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

interface DbLatencyMetric {
  timestamp: number;
  latencyMs: number;
}

interface MemorySnapshot {
  timestamp: number;
  heapUsedMb: number;
  heapTotalMb: number;
  rssMb: number;
}

interface ServiceEvent {
  timestamp: number;
  service: 'email' | 'webhook' | 'geocoding' | 'route_optimization';
  success: boolean;
  detail?: string;
  durationMs?: number;
}

interface FrontendError {
  timestamp: number;
  message: string;
  source?: string;
  line?: number;
  col?: number;
  userAgent?: string;
  url?: string;
}

// Rolling window: keep last 15 minutes of data
const WINDOW_MS = 15 * 60 * 1000;
// Memory snapshots every 30 seconds, keep last 15 minutes
const MEMORY_INTERVAL_MS = 30_000;

const requestMetrics: RequestMetric[] = [];
const dbLatencyMetrics: DbLatencyMetric[] = [];
const memorySnapshots: MemorySnapshot[] = [];
const serviceEvents: ServiceEvent[] = [];
const frontendErrors: FrontendError[] = [];

let memoryInterval: ReturnType<typeof setInterval> | null = null;
let serverStartTime: number = Date.now();

/**
 * Record a completed HTTP request.
 * Call this from the request logging middleware.
 */
export function recordRequest(method: string, path: string, statusCode: number, durationMs: number): void {
  requestMetrics.push({
    timestamp: Date.now(),
    method,
    path,
    statusCode,
    durationMs,
  });
  pruneOldEntries();
}

/**
 * Record a database latency measurement.
 */
export function recordDbLatency(latencyMs: number): void {
  dbLatencyMetrics.push({
    timestamp: Date.now(),
    latencyMs,
  });
  // Keep max 100 DB latency entries
  if (dbLatencyMetrics.length > 100) {
    dbLatencyMetrics.splice(0, dbLatencyMetrics.length - 100);
  }
}

/**
 * Record a service call (email, webhook, geocoding, route optimization).
 */
export function recordServiceEvent(service: ServiceEvent['service'], success: boolean, detail?: string, durationMs?: number): void {
  serviceEvents.push({ timestamp: Date.now(), service, success, detail, durationMs });
  if (serviceEvents.length > 500) serviceEvents.splice(0, serviceEvents.length - 500);
}

/**
 * Record a frontend JavaScript error (reported from browser).
 */
export function recordFrontendError(error: Omit<FrontendError, 'timestamp'>): void {
  frontendErrors.push({ timestamp: Date.now(), ...error });
  if (frontendErrors.length > 100) frontendErrors.splice(0, frontendErrors.length - 100);
}

/**
 * Get aggregated service metrics for the monitoring dashboard.
 */
export function getServiceMetrics() {
  const cutoff = Date.now() - WINDOW_MS;
  const recent = serviceEvents.filter(e => e.timestamp > cutoff);

  const byService = (svc: ServiceEvent['service']) => {
    const events = recent.filter(e => e.service === svc);
    const successes = events.filter(e => e.success).length;
    const failures = events.filter(e => !e.success);
    return {
      total: events.length,
      successes,
      failures: failures.length,
      failure_rate: events.length > 0 ? Math.round((failures.length / events.length) * 10000) / 100 : 0,
      recent_failures: failures.slice(-5).map(f => ({
        detail: f.detail?.substring(0, 150),
        time: new Date(f.timestamp).toISOString(),
      })),
    };
  };

  return {
    email: byService('email'),
    webhook: byService('webhook'),
    geocoding: byService('geocoding'),
    route_optimization: byService('route_optimization'),
  };
}

/**
 * Get recent frontend errors.
 */
export function getFrontendErrors() {
  const cutoff = Date.now() - WINDOW_MS;
  const recent = frontendErrors.filter(e => e.timestamp > cutoff);

  // Group by message
  const grouped = new Map<string, { count: number; lastSeen: number; source?: string; line?: number }>();
  for (const err of recent) {
    const key = err.message.substring(0, 100);
    const existing = grouped.get(key);
    if (existing) {
      existing.count++;
      existing.lastSeen = Math.max(existing.lastSeen, err.timestamp);
    } else {
      grouped.set(key, { count: 1, lastSeen: err.timestamp, source: err.source, line: err.line });
    }
  }

  return {
    total_15m: recent.length,
    unique_errors: grouped.size,
    errors: Array.from(grouped.entries())
      .map(([message, data]) => ({ message, ...data, lastSeen: new Date(data.lastSeen).toISOString() }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

/**
 * Start collecting memory snapshots at regular intervals.
 */
export function startMetricsCollection(): void {
  serverStartTime = Date.now();

  // Register process-level error handlers
  registerProcessHandlers();

  // Register global hook for cross-package service tracking (e.g., @skyplanner/email)
  (globalThis as any).__recordServiceEvent = recordServiceEvent;

  // Take initial snapshot
  takeMemorySnapshot();

  // Schedule periodic snapshots
  if (memoryInterval) clearInterval(memoryInterval);
  memoryInterval = setInterval(takeMemorySnapshot, MEMORY_INTERVAL_MS);
}

/**
 * Stop metrics collection (for graceful shutdown).
 */
export function stopMetricsCollection(): void {
  if (memoryInterval) {
    clearInterval(memoryInterval);
    memoryInterval = null;
  }
}

/**
 * Get aggregated metrics for the monitoring dashboard.
 */
export function getAggregatedMetrics() {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  // Filter to current window
  const recentRequests = requestMetrics.filter(r => r.timestamp > cutoff);
  const recentDb = dbLatencyMetrics.filter(d => d.timestamp > cutoff);

  // Request metrics
  const totalRequests = recentRequests.length;
  const windowSeconds = Math.min(WINDOW_MS, now - serverStartTime) / 1000;
  const requestsPerSecond = windowSeconds > 0 ? Math.round((totalRequests / windowSeconds) * 100) / 100 : 0;

  // Response time stats
  const durations = recentRequests.map(r => r.durationMs).sort((a, b) => a - b);
  const avgResponseMs = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  const p95ResponseMs = durations.length > 0
    ? durations[Math.floor(durations.length * 0.95)]
    : 0;
  const p99ResponseMs = durations.length > 0
    ? durations[Math.floor(durations.length * 0.99)]
    : 0;
  const maxResponseMs = durations.length > 0
    ? durations[durations.length - 1]
    : 0;

  // Status code breakdown
  const statusCodes = {
    '2xx': recentRequests.filter(r => r.statusCode >= 200 && r.statusCode < 300).length,
    '3xx': recentRequests.filter(r => r.statusCode >= 300 && r.statusCode < 400).length,
    '4xx': recentRequests.filter(r => r.statusCode >= 400 && r.statusCode < 500).length,
    '5xx': recentRequests.filter(r => r.statusCode >= 500).length,
  };
  const errorRate = totalRequests > 0
    ? Math.round((statusCodes['5xx'] / totalRequests) * 10000) / 100
    : 0;

  // Slowest endpoints (top 5)
  const endpointStats = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  for (const r of recentRequests) {
    // Normalize paths: remove IDs to group endpoints
    const normalized = r.path.replace(/\/\d+/g, '/:id');
    const key = `${r.method} ${normalized}`;
    const stat = endpointStats.get(key) || { count: 0, totalMs: 0, maxMs: 0 };
    stat.count++;
    stat.totalMs += r.durationMs;
    stat.maxMs = Math.max(stat.maxMs, r.durationMs);
    endpointStats.set(key, stat);
  }
  const slowestEndpoints = Array.from(endpointStats.entries())
    .map(([endpoint, stat]) => ({
      endpoint,
      count: stat.count,
      avgMs: Math.round(stat.totalMs / stat.count),
      maxMs: stat.maxMs,
    }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 5);

  // Database latency stats
  const dbLatencies = recentDb.map(d => d.latencyMs).sort((a, b) => a - b);
  const dbAvgMs = dbLatencies.length > 0
    ? Math.round(dbLatencies.reduce((a, b) => a + b, 0) / dbLatencies.length)
    : 0;
  const dbP95Ms = dbLatencies.length > 0
    ? dbLatencies[Math.floor(dbLatencies.length * 0.95)]
    : 0;
  const dbMaxMs = dbLatencies.length > 0
    ? dbLatencies[dbLatencies.length - 1]
    : 0;
  const dbSamples = dbLatencies.length;

  // Memory trend (last 15 min of snapshots)
  const recentMemory = memorySnapshots.filter(m => m.timestamp > cutoff);
  const currentMemory = recentMemory.length > 0
    ? recentMemory[recentMemory.length - 1]
    : null;
  const peakMemory = recentMemory.length > 0
    ? Math.max(...recentMemory.map(m => m.heapUsedMb))
    : 0;
  const avgMemory = recentMemory.length > 0
    ? Math.round(recentMemory.reduce((a, m) => a + m.heapUsedMb, 0) / recentMemory.length)
    : 0;

  return {
    requests: {
      total_15m: totalRequests,
      per_second: requestsPerSecond,
      avg_response_ms: avgResponseMs,
      p95_response_ms: p95ResponseMs,
      p99_response_ms: p99ResponseMs,
      max_response_ms: maxResponseMs,
      status_codes: statusCodes,
      error_rate_percent: errorRate,
      slowest_endpoints: slowestEndpoints,
    },
    database_latency: {
      avg_ms: dbAvgMs,
      p95_ms: dbP95Ms,
      max_ms: dbMaxMs,
      samples: dbSamples,
    },
    memory_trend: {
      current: currentMemory ? {
        heap_used_mb: currentMemory.heapUsedMb,
        heap_total_mb: currentMemory.heapTotalMb,
        rss_mb: currentMemory.rssMb,
      } : null,
      peak_heap_mb: peakMemory,
      avg_heap_mb: avgMemory,
      snapshots_count: recentMemory.length,
    },
    window_seconds: Math.round(windowSeconds),
  };
}

function takeMemorySnapshot(): void {
  const mem = process.memoryUsage();
  memorySnapshots.push({
    timestamp: Date.now(),
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    rssMb: Math.round(mem.rss / 1024 / 1024),
  });
  // Keep max 30 snapshots (15 min at 30s intervals)
  if (memorySnapshots.length > 30) {
    memorySnapshots.splice(0, memorySnapshots.length - 30);
  }
}

// ============ Unhandled Error Tracking ============

interface UnhandledError {
  timestamp: number;
  type: 'unhandledRejection' | 'uncaughtException' | 'warning';
  message: string;
  stack?: string;
}

const unhandledErrors: UnhandledError[] = [];
let processHandlersRegistered = false;

/**
 * Register process-level error handlers to catch unhandled rejections and warnings.
 */
function registerProcessHandlers(): void {
  if (processHandlersRegistered) return;
  processHandlersRegistered = true;

  process.on('unhandledRejection', (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    unhandledErrors.push({
      timestamp: Date.now(),
      type: 'unhandledRejection',
      message,
      stack,
    });
    // Keep max 50 entries
    if (unhandledErrors.length > 50) unhandledErrors.shift();
  });

  process.on('warning', (warning: Error) => {
    unhandledErrors.push({
      timestamp: Date.now(),
      type: 'warning',
      message: warning.message,
      stack: warning.stack,
    });
    if (unhandledErrors.length > 50) unhandledErrors.shift();
  });
}

// ============ Issue Detection Engine ============

export interface DetectedIssue {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  detail: string;
  metric?: string;
}

interface ExternalContext {
  circuitBreakers?: Record<string, { name: string; state: string; totalFailures: number }>;
  cronJobs?: Array<{ name: string; consecutiveFailures: number; lastSuccess: string | null; lastRun: string | null; isRunning: boolean }>;
  security?: { failed_logins_24h: number; locked_accounts: number };
  dataIntegrity?: { customers_without_coords: number; orphaned_tags: number };
}

/**
 * Analyze all collected metrics and detect potential issues.
 * Accepts optional external context for circuit breakers and cron jobs.
 * Returns a list of actionable insights sorted by severity.
 */
export function detectIssues(ctx?: ExternalContext): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  const recentRequests = requestMetrics.filter(r => r.timestamp > cutoff);
  const recentMemory = memorySnapshots.filter(m => m.timestamp > cutoff);
  const recentDb = dbLatencyMetrics.filter(d => d.timestamp > cutoff);

  // --- 1. Error rate spike ---
  if (recentRequests.length >= 10) {
    const fiveXx = recentRequests.filter(r => r.statusCode >= 500).length;
    const errorRate = fiveXx / recentRequests.length;
    if (errorRate > 0.1) {
      issues.push({
        severity: 'critical',
        category: 'errors',
        title: 'Høy feilrate',
        detail: `${(errorRate * 100).toFixed(1)}% av forespørslene returnerer 5xx (${fiveXx} av ${recentRequests.length})`,
        metric: `${(errorRate * 100).toFixed(1)}%`,
      });
    } else if (errorRate > 0.02) {
      issues.push({
        severity: 'warning',
        category: 'errors',
        title: 'Forhøyet feilrate',
        detail: `${(errorRate * 100).toFixed(1)}% av forespørslene returnerer 5xx`,
        metric: `${(errorRate * 100).toFixed(1)}%`,
      });
    }
  }

  // --- 2. Repeated 5xx on same endpoint ---
  const errorsByEndpoint = new Map<string, number>();
  for (const r of recentRequests) {
    if (r.statusCode >= 500) {
      const key = `${r.method} ${r.path.replace(/\/\d+/g, '/:id')}`;
      errorsByEndpoint.set(key, (errorsByEndpoint.get(key) || 0) + 1);
    }
  }
  for (const [endpoint, count] of errorsByEndpoint) {
    if (count >= 5) {
      issues.push({
        severity: 'critical',
        category: 'errors',
        title: `Gjentatte feil: ${endpoint}`,
        detail: `${count} serverfeil på dette endepunktet siste 15 min`,
        metric: `${count}x`,
      });
    } else if (count >= 3) {
      issues.push({
        severity: 'warning',
        category: 'errors',
        title: `Feil på endepunkt: ${endpoint}`,
        detail: `${count} serverfeil siste 15 min`,
        metric: `${count}x`,
      });
    }
  }

  // --- 3. Repeated 404s (broken routes/links) ---
  const notFoundByPath = new Map<string, number>();
  for (const r of recentRequests) {
    if (r.statusCode === 404) {
      const key = r.path.replace(/\/\d+/g, '/:id');
      notFoundByPath.set(key, (notFoundByPath.get(key) || 0) + 1);
    }
  }
  for (const [path, count] of notFoundByPath) {
    if (count >= 10) {
      issues.push({
        severity: 'warning',
        category: 'routes',
        title: `Gjentatte 404: ${path}`,
        detail: `${count} not-found forespørsler — mulig ødelagt lenke eller feil API-kall`,
        metric: `${count}x`,
      });
    }
  }

  // --- 4. Memory leak detection (consistent upward trend) ---
  if (recentMemory.length >= 5) {
    const first3 = recentMemory.slice(0, 3);
    const last3 = recentMemory.slice(-3);
    const avgFirst = first3.reduce((a, m) => a + m.heapUsedMb, 0) / first3.length;
    const avgLast = last3.reduce((a, m) => a + m.heapUsedMb, 0) / last3.length;
    const growth = avgLast - avgFirst;
    const growthPercent = avgFirst > 0 ? (growth / avgFirst) * 100 : 0;

    if (growth > 100 && growthPercent > 30) {
      issues.push({
        severity: 'critical',
        category: 'memory',
        title: 'Mulig minnelekkasje',
        detail: `Heap har vokst ${Math.round(growth)} MB (+${Math.round(growthPercent)}%) siste 15 min: ${Math.round(avgFirst)} MB → ${Math.round(avgLast)} MB`,
        metric: `+${Math.round(growth)} MB`,
      });
    } else if (growth > 50 && growthPercent > 20) {
      issues.push({
        severity: 'warning',
        category: 'memory',
        title: 'Minnebruk øker jevnt',
        detail: `Heap har vokst ${Math.round(growth)} MB (+${Math.round(growthPercent)}%) siste 15 min`,
        metric: `+${Math.round(growth)} MB`,
      });
    }

    // High absolute memory
    const currentHeap = recentMemory[recentMemory.length - 1].heapUsedMb;
    if (currentHeap > 1024) {
      issues.push({
        severity: 'critical',
        category: 'memory',
        title: 'Svært høy minnebruk',
        detail: `Heap bruker ${currentHeap} MB — risiko for OOM-krasj`,
        metric: `${currentHeap} MB`,
      });
    } else if (currentHeap > 512) {
      issues.push({
        severity: 'warning',
        category: 'memory',
        title: 'Høy minnebruk',
        detail: `Heap bruker ${currentHeap} MB`,
        metric: `${currentHeap} MB`,
      });
    }
  }

  // --- 5. Slow endpoints ---
  // Use higher thresholds in development (cloud DB latency from local machine)
  const isProduction = process.env.NODE_ENV === 'production';
  const slowEndpointThreshold = isProduction ? 2000 : 5000;

  const endpointStats = new Map<string, { totalMs: number; count: number; maxMs: number }>();
  for (const r of recentRequests) {
    const key = `${r.method} ${r.path.replace(/\/\d+/g, '/:id')}`;
    const stat = endpointStats.get(key) || { totalMs: 0, count: 0, maxMs: 0 };
    stat.totalMs += r.durationMs;
    stat.count++;
    stat.maxMs = Math.max(stat.maxMs, r.durationMs);
    endpointStats.set(key, stat);
  }
  for (const [endpoint, stat] of endpointStats) {
    const avgMs = stat.totalMs / stat.count;
    if (avgMs > slowEndpointThreshold && stat.count >= 3) {
      issues.push({
        severity: 'warning',
        category: 'performance',
        title: `Tregt endepunkt: ${endpoint}`,
        detail: `Gj.snitt ${Math.round(avgMs)} ms, maks ${stat.maxMs} ms over ${stat.count} kall`,
        metric: `${Math.round(avgMs)} ms`,
      });
    }
  }

  // --- 6. Database latency issues ---
  // Higher thresholds in dev (local → cloud Supabase adds ~150-200ms per roundtrip)
  const dbCriticalMs = isProduction ? 500 : 1500;
  const dbWarningMs = isProduction ? 200 : 800;
  if (recentDb.length >= 3) {
    const avgLatency = recentDb.reduce((a, d) => a + d.latencyMs, 0) / recentDb.length;
    const maxLatency = Math.max(...recentDb.map(d => d.latencyMs));
    if (avgLatency > dbCriticalMs) {
      issues.push({
        severity: 'critical',
        category: 'database',
        title: 'Database svarer tregt',
        detail: `Gj.snitt latency ${Math.round(avgLatency)} ms, maks ${maxLatency} ms`,
        metric: `${Math.round(avgLatency)} ms`,
      });
    } else if (avgLatency > dbWarningMs) {
      issues.push({
        severity: 'warning',
        category: 'database',
        title: 'Forhøyet database-latency',
        detail: `Gj.snitt ${Math.round(avgLatency)} ms (maks ${maxLatency} ms)`,
        metric: `${Math.round(avgLatency)} ms`,
      });
    }
  }

  // --- 7. Unhandled rejections ---
  const recentUnhandled = unhandledErrors.filter(e => e.timestamp > cutoff);
  if (recentUnhandled.length > 0) {
    const rejections = recentUnhandled.filter(e => e.type === 'unhandledRejection');
    const warnings = recentUnhandled.filter(e => e.type === 'warning');

    if (rejections.length > 0) {
      issues.push({
        severity: 'critical',
        category: 'errors',
        title: `${rejections.length} uhåndterte promise-avvisninger`,
        detail: `Siste: ${rejections[rejections.length - 1].message.substring(0, 120)}`,
        metric: `${rejections.length}x`,
      });
    }
    if (warnings.length > 0) {
      issues.push({
        severity: 'info',
        category: 'errors',
        title: `${warnings.length} Node.js-advarsler`,
        detail: `Siste: ${warnings[warnings.length - 1].message.substring(0, 120)}`,
        metric: `${warnings.length}x`,
      });
    }
  }

  // --- 8. High 401 rate (potential auth issues) ---
  if (recentRequests.length >= 20) {
    const unauthorizedCount = recentRequests.filter(r => r.statusCode === 401).length;
    const authRate = unauthorizedCount / recentRequests.length;
    if (authRate > 0.3 && unauthorizedCount >= 10) {
      issues.push({
        severity: 'warning',
        category: 'security',
        title: 'Mange 401-feil',
        detail: `${unauthorizedCount} uautoriserte forespørsler (${(authRate * 100).toFixed(0)}%) — mulig autentiseringsproblem eller angrep`,
        metric: `${unauthorizedCount}x`,
      });
    }
  }

  // --- 9. Circuit breaker issues ---
  if (ctx?.circuitBreakers) {
    for (const cb of Object.values(ctx.circuitBreakers)) {
      if (cb.state === 'OPEN') {
        issues.push({
          severity: 'critical',
          category: 'services',
          title: `Tjeneste nede: ${cb.name}`,
          detail: `Circuit breaker er åpen — alle forespørsler feiler umiddelbart. Totalt ${cb.totalFailures} feil.`,
          metric: 'OPEN',
        });
      } else if (cb.state === 'HALF_OPEN') {
        issues.push({
          severity: 'warning',
          category: 'services',
          title: `Tjeneste ustabil: ${cb.name}`,
          detail: `Tester om tjenesten er tilgjengelig igjen`,
          metric: 'HALF_OPEN',
        });
      }
    }
  }

  // --- 10. Cron job issues ---
  if (ctx?.cronJobs) {
    for (const job of ctx.cronJobs) {
      if (job.consecutiveFailures >= 3) {
        issues.push({
          severity: 'critical',
          category: 'cron',
          title: `Cron-jobb feilet: ${job.name}`,
          detail: `${job.consecutiveFailures} feil på rad. Siste suksess: ${job.lastSuccess || 'aldri'}`,
          metric: `${job.consecutiveFailures}x`,
        });
      } else if (job.consecutiveFailures >= 1) {
        issues.push({
          severity: 'warning',
          category: 'cron',
          title: `Cron-jobb ustabil: ${job.name}`,
          detail: `${job.consecutiveFailures} feil på rad`,
          metric: `${job.consecutiveFailures}x`,
        });
      }
    }
  }

  // --- 11. Security concerns ---
  if (ctx?.security) {
    if (ctx.security.locked_accounts > 0) {
      issues.push({
        severity: 'warning',
        category: 'security',
        title: `${ctx.security.locked_accounts} låste kontoer`,
        detail: 'Kontoer er låst pga. gjentatte feilede innlogginger',
        metric: `${ctx.security.locked_accounts}`,
      });
    }
    if (ctx.security.failed_logins_24h > 50) {
      issues.push({
        severity: 'critical',
        category: 'security',
        title: 'Mulig brute-force angrep',
        detail: `${ctx.security.failed_logins_24h} feilede innlogginger siste 24 timer`,
        metric: `${ctx.security.failed_logins_24h}x`,
      });
    } else if (ctx.security.failed_logins_24h > 20) {
      issues.push({
        severity: 'warning',
        category: 'security',
        title: 'Mange feilede innlogginger',
        detail: `${ctx.security.failed_logins_24h} feilede forsøk siste 24 timer`,
        metric: `${ctx.security.failed_logins_24h}x`,
      });
    }
  }

  // --- 12. Data integrity ---
  if (ctx?.dataIntegrity) {
    if (ctx.dataIntegrity.customers_without_coords > 50) {
      issues.push({
        severity: 'warning',
        category: 'data',
        title: `${ctx.dataIntegrity.customers_without_coords} kunder uten koordinater`,
        detail: 'Disse kundene vises ikke på kartet. Kjør geokoding for å fikse.',
        metric: `${ctx.dataIntegrity.customers_without_coords}`,
      });
    }
  }

  // --- 13. Service health (email, webhook, geocoding, route optimization) ---
  const svcMetrics = getServiceMetrics();
  for (const [name, data] of Object.entries(svcMetrics) as [string, ReturnType<typeof getServiceMetrics>['email']][]) {
    const labels: Record<string, string> = {
      email: 'E-postsending',
      webhook: 'Webhook-levering',
      geocoding: 'Geokoding',
      route_optimization: 'Ruteoptimalisering',
    };
    if (data.total >= 3 && data.failure_rate > 50) {
      issues.push({
        severity: 'critical',
        category: 'services',
        title: `${labels[name] || name} feiler`,
        detail: `${data.failures} av ${data.total} kall feilet (${data.failure_rate}%)${data.recent_failures[0]?.detail ? '. Siste: ' + data.recent_failures[0].detail : ''}`,
        metric: `${data.failure_rate}%`,
      });
    } else if (data.total >= 2 && data.failure_rate > 20) {
      issues.push({
        severity: 'warning',
        category: 'services',
        title: `${labels[name] || name} ustabil`,
        detail: `${data.failures} av ${data.total} kall feilet (${data.failure_rate}%)`,
        metric: `${data.failure_rate}%`,
      });
    }
  }

  // --- 13. Frontend errors ---
  const feErrors = getFrontendErrors();
  if (feErrors.total_15m > 10) {
    issues.push({
      severity: 'critical',
      category: 'frontend',
      title: `${feErrors.total_15m} JavaScript-feil fra nettlesere`,
      detail: `${feErrors.unique_errors} unike feil. Hyppigste: ${feErrors.errors[0]?.message || 'ukjent'}`,
      metric: `${feErrors.total_15m}x`,
    });
  } else if (feErrors.total_15m > 0) {
    issues.push({
      severity: 'warning',
      category: 'frontend',
      title: `${feErrors.total_15m} JavaScript-feil fra nettlesere`,
      detail: feErrors.errors[0]?.message || 'Ukjent feil',
      metric: `${feErrors.total_15m}x`,
    });
  }

  // Sort by severity (critical first)
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return issues;
}

const MAX_METRICS_SIZE = 1000;

function pruneOldEntries(): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (requestMetrics.length > 0 && requestMetrics[0].timestamp < cutoff) {
    requestMetrics.shift();
  }
  // Hard cap to prevent unbounded growth under high traffic
  if (requestMetrics.length > MAX_METRICS_SIZE) {
    requestMetrics.splice(0, requestMetrics.length - MAX_METRICS_SIZE);
  }
  if (serviceEvents.length > MAX_METRICS_SIZE) {
    serviceEvents.splice(0, serviceEvents.length - MAX_METRICS_SIZE);
  }
  if (memorySnapshots.length > MAX_METRICS_SIZE) {
    memorySnapshots.splice(0, memorySnapshots.length - MAX_METRICS_SIZE);
  }
}

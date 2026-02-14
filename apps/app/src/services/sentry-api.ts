/**
 * Sentry API client for admin dashboard monitoring
 * Proxies requests to Sentry Web API with in-memory caching
 */

import { logger } from './logger';

const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
const SENTRY_ORG = process.env.SENTRY_ORG_SLUG;
const SENTRY_PROJECT = process.env.SENTRY_PROJECT_SLUG;
const SENTRY_BASE_URL = 'https://sentry.io/api/0';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_DEFAULT = 60_000; // 60 seconds
const CACHE_TTL_STATS = 120_000; // 2 minutes

export function isSentryApiConfigured(): boolean {
  return !!(SENTRY_AUTH_TOKEN && SENTRY_ORG && SENTRY_PROJECT);
}

async function sentryFetch<T>(path: string, cacheTtl = CACHE_TTL_DEFAULT): Promise<T> {
  const cached = cache.get(path) as CacheEntry<T> | undefined;
  if (cached && Date.now() - cached.timestamp < cacheTtl) {
    return cached.data;
  }

  const url = `${SENTRY_BASE_URL}${path}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
    },
  });

  if (!response.ok) {
    logger.error({ status: response.status, path }, 'Sentry API request failed');
    throw new Error(`Sentry API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as T;
  cache.set(path, { data, timestamp: Date.now() });
  return data;
}

interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  level: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  shortId: string;
  permalink: string;
  status: string;
  isRegression: boolean;
  metadata: {
    type?: string;
    value?: string;
  };
}

// Sentry stats API returns [[timestamp, count], ...]
type SentryStatsTuple = [number, number];

export async function getUnresolvedIssues(options?: {
  sort?: string;
  limit?: number;
}): Promise<SentryIssue[]> {
  const sort = options?.sort || 'priority';
  const limit = Math.min(options?.limit || 25, 100);
  const path = `/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/issues/?query=is:unresolved&statsPeriod=24h&sort=${sort}&limit=${limit}`;
  return sentryFetch<SentryIssue[]>(path);
}

export async function getIssueDetails(issueId: string): Promise<SentryIssue> {
  const path = `/issues/${issueId}/`;
  return sentryFetch<SentryIssue>(path, 30_000);
}

export async function getProjectStats(): Promise<SentryStatsTuple[]> {
  const path = `/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/stats/?stat=received&resolution=1h&since=${Math.floor((Date.now() - 86400000) / 1000)}`;
  return sentryFetch<SentryStatsTuple[]>(path, CACHE_TTL_STATS);
}

export interface SentryOverview {
  unresolvedCount: number;
  criticalCount: number;
  errorCount: number;
  warningCount: number;
  eventsToday: number;
  eventsTrend: Array<{ timestamp: number; count: number }>;
  issues: SentryIssue[];
}

export async function getSentryOverview(): Promise<SentryOverview> {
  const [issues, stats] = await Promise.all([
    getUnresolvedIssues({ sort: 'priority', limit: 25 }),
    getProjectStats().catch(() => [] as SentryStatsTuple[]),
  ]);

  let criticalCount = 0;
  let errorCount = 0;
  let warningCount = 0;

  for (const issue of issues) {
    if (issue.level === 'fatal') criticalCount++;
    else if (issue.level === 'error') errorCount++;
    else if (issue.level === 'warning') warningCount++;
  }

  // Parse stats into trend data
  const eventsTrend: Array<{ timestamp: number; count: number }> = [];
  let eventsToday = 0;

  for (const point of stats) {
    if (Array.isArray(point) && point.length >= 2) {
      eventsTrend.push({ timestamp: point[0], count: point[1] });
      eventsToday += point[1];
    }
  }

  return {
    unresolvedCount: issues.length,
    criticalCount,
    errorCount,
    warningCount,
    eventsToday,
    eventsTrend,
    issues,
  };
}

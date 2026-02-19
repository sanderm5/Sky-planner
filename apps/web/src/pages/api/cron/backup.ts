/**
 * Vercel Cron trigger for database backup
 * Calls the Railway backend's backup endpoint on a schedule.
 * This ensures backups run even if Railway's in-process cron is inactive (e.g. sleep mode).
 *
 * Vercel cron config: see vercel.json
 */
import type { APIRoute } from 'astro';

const APP_API_URL = import.meta.env.APP_API_URL || (import.meta.env.PROD ? 'https://skyplannerapp-production.up.railway.app' : 'http://localhost:3000');

export const GET: APIRoute = async ({ request }) => {
  // Verify the request is from Vercel cron (check Authorization header)
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const response = await fetch(`${APP_API_URL}/api/cron/backup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': cronSecret,
      },
    });

    const data = await response.text();

    return new Response(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Backup cron trigger failed:', error);
    return new Response(JSON.stringify({
      error: 'Failed to trigger backup',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

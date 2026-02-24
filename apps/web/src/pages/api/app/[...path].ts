/**
 * API Proxy - Forwards requests to the app backend
 * This solves CORS issues and allows cookie-based auth to work
 */
import type { APIRoute } from 'astro';

const APP_API_URL = import.meta.env.APP_API_URL || (import.meta.env.PROD ? 'https://skyplannerapp-production.up.railway.app' : 'http://localhost:3000');

/** Validate that a string looks like an IPv4 or IPv6 address */
function isValidIP(ip: string): boolean {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv4.test(ip) || ipv6.test(ip);
}

export const ALL: APIRoute = async ({ request, params }) => {
  const path = params.path || '';

  // Path traversal protection: reject paths containing '..' or null bytes
  if (path.includes('..') || path.includes('\0')) {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'BAD_REQUEST', message: 'Ugyldig path' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const targetUrl = `${APP_API_URL}/api/${path}`;

  // Get the original URL's query string
  const url = new URL(request.url);
  const queryString = url.search;

  // Forward the request to the app backend
  try {
    const headers = new Headers();

    // Forward relevant headers
    const cookie = request.headers.get('cookie');
    if (cookie) {
      headers.set('cookie', cookie);
    }

    const contentType = request.headers.get('content-type');
    if (contentType) {
      headers.set('content-type', contentType);
    }

    const authorization = request.headers.get('authorization');
    if (authorization) {
      headers.set('authorization', authorization);
    }

    const csrfToken = request.headers.get('x-csrf-token');
    if (csrfToken) {
      headers.set('x-csrf-token', csrfToken);
    }

    // Forward client IP for accurate rate limiting
    // Use x-real-ip (set by Vercel) to avoid spoofed x-forwarded-for from clients
    // Validate IP format before forwarding to prevent header injection
    const realIP = request.headers.get('x-real-ip');
    if (realIP && isValidIP(realIP.trim())) {
      headers.set('x-forwarded-for', realIP.trim());
    } else {
      // Fallback: use x-forwarded-for but only the first IP (closest to Vercel)
      const forwardedFor = request.headers.get('x-forwarded-for');
      if (forwardedFor) {
        const firstIP = forwardedFor.split(',')[0]?.trim();
        if (firstIP && isValidIP(firstIP)) {
          headers.set('x-forwarded-for', firstIP);
        }
      }
    }

    // Build request options
    const options: RequestInit = {
      method: request.method,
      headers,
    };

    // Forward body for non-GET requests
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const body = await request.text();
      if (body) {
        options.body = body;
      }
    }

    // Add timeout to prevent indefinite hangs (Vercel serverless has 25-60s limit)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response: globalThis.Response;
    try {
      response = await fetch(`${targetUrl}${queryString}`, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    // Forward response headers
    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      // Skip headers that shouldn't be forwarded
      if (!['transfer-encoding', 'connection', 'content-encoding', 'content-length'].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    // Check Content-Length before reading body to prevent OOM on Vercel (128MB limit)
    const contentLength = response.headers.get('content-length');
    const MAX_RESPONSE_SIZE = 50 * 1024 * 1024; // 50MB
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'RESPONSE_TOO_LARGE', message: 'Backend-respons er for stor' }
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const responseBody = await response.text();

    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    console.error('Proxy error:', isTimeout ? 'Request timed out after 30s' : error);
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: isTimeout ? 'PROXY_TIMEOUT' : 'PROXY_ERROR',
          message: isTimeout ? 'Backend svarte ikke innen tidsfristen' : 'Kunne ikke koble til backend'
        }
      }),
      {
        status: isTimeout ? 504 : 502,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

// Export individual methods for Astro to recognize
export const GET = ALL;
export const POST = ALL;
export const PUT = ALL;
export const PATCH = ALL;
export const DELETE = ALL;

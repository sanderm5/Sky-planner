/**
 * API Proxy - Forwards requests to the app backend
 * This solves CORS issues and allows cookie-based auth to work
 */
import type { APIRoute } from 'astro';

const APP_API_URL = import.meta.env.APP_API_URL || (import.meta.env.PROD ? 'https://skyplannerapp-production.up.railway.app' : 'http://localhost:3000');

export const ALL: APIRoute = async ({ request, params }) => {
  const path = params.path || '';
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

    const response = await fetch(`${targetUrl}${queryString}`, options);

    // Forward response headers
    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      // Skip headers that shouldn't be forwarded
      if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    const responseBody = await response.text();

    return new Response(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'PROXY_ERROR',
          message: 'Kunne ikke koble til backend'
        }
      }),
      {
        status: 502,
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

import { defineMiddleware } from 'astro:middleware';

/**
 * Generate a cryptographically random CSRF token
 */
function generateCsrfToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

// Paths exempt from CSRF validation (incoming webhooks, initial auth, proxied API calls)
const CSRF_EXEMPT_PATHS = [
  '/api/webhooks/',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-2fa',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/app/', // Proxied to backend which has its own CSRF protection
];

/**
 * Astro middleware that adds security headers and CSRF protection
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url } = context;
  const method = request.method.toUpperCase();
  const pathname = url.pathname;

  // CSRF protection for state-changing requests on API routes
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && pathname.startsWith('/api/')) {
    const isExempt = CSRF_EXEMPT_PATHS.some((path) => pathname.startsWith(path));

    if (!isExempt) {
      const cookieHeader = request.headers.get('cookie') || '';
      const csrfCookie = cookieHeader
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('__csrf='));
      const csrfCookieValue = csrfCookie?.split('=')[1] || '';
      const csrfHeader = request.headers.get('X-CSRF-Token') || '';

      if (!csrfCookieValue || !csrfHeader || !timingSafeEqual(csrfCookieValue, csrfHeader)) {
        return new Response(JSON.stringify({ error: 'Ugyldig CSRF-token' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  const response = await next();

  // Add security headers
  const headers = new Headers(response.headers);

  // Set CSRF cookie on page requests (not API responses)
  if (method === 'GET' && !pathname.startsWith('/api/')) {
    const existingCookie = request.headers.get('cookie') || '';
    const hasCsrf = existingCookie.includes('__csrf=');
    if (!hasCsrf) {
      const token = generateCsrfToken();
      const isProduction = import.meta.env.PROD;
      const cookieParts = [
        `__csrf=${token}`,
        'Path=/',
        'SameSite=Strict',
        'Max-Age=86400',
      ];
      if (isProduction) cookieParts.push('Secure');
      headers.append('Set-Cookie', cookieParts.join('; '));
    }
  }

  // Prevent clickjacking
  headers.set('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  headers.set('X-Content-Type-Options', 'nosniff');

  // Enable XSS filter (legacy, but still useful for older browsers)
  headers.set('X-XSS-Protection', '1; mode=block');

  // Control referrer information
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy (formerly Feature-Policy)
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

  // Content Security Policy
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "connect-src 'self' https://api.stripe.com https://*.supabase.co",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ];
  headers.set('Content-Security-Policy', cspDirectives.join('; '));

  // HSTS - only in production
  if (import.meta.env.PROD) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});

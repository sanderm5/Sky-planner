import { NextRequest, NextResponse } from 'next/server';

// === Maintenance mode check (cached, fail-open) ===
const APP_API_URL = process.env.APP_API_URL || (process.env.NODE_ENV === 'production' ? 'https://skyplannerapp-production.up.railway.app' : 'http://localhost:3000');

let maintenanceCache: { active: boolean; mode: string | null; message: string; checkedAt: number } | null = null;
const MAINTENANCE_CACHE_TTL = 10_000; // 10 seconds

async function getMaintenanceStatus(): Promise<{ active: boolean; mode: string | null; message: string }> {
  if (maintenanceCache && Date.now() - maintenanceCache.checkedAt < MAINTENANCE_CACHE_TTL) {
    return { active: maintenanceCache.active, mode: maintenanceCache.mode, message: maintenanceCache.message };
  }
  try {
    const res = await fetch(`${APP_API_URL}/api/maintenance/status`, {
      signal: AbortSignal.timeout(2000),
    });
    const data = await res.json();
    maintenanceCache = { active: data.maintenance, mode: data.mode || null, message: data.message || '', checkedAt: Date.now() };
    return { active: data.maintenance, mode: data.mode, message: data.message };
  } catch {
    // Backend unreachable — fail open (don't show maintenance page)
    return { active: false, mode: null, message: '' };
  }
}

function getMaintenanceHtml(message: string): string {
  const escapedMessage = message.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sky Planner — Vedlikehold</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0A0E16;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .container{text-align:center;padding:2rem;max-width:480px}
    .logo{width:64px;height:64px;margin:0 auto 1.5rem}
    h1{font-size:1.5rem;font-weight:600;margin-bottom:0.75rem;color:#fff}
    .message{color:#94a3b8;font-size:1rem;line-height:1.6;margin-bottom:2rem}
    .spinner{width:32px;height:32px;border:3px solid rgba(99,102,241,0.2);border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1rem}
    @keyframes spin{to{transform:rotate(360deg)}}
    .auto-refresh{color:#64748b;font-size:0.8rem}
  </style>
</head>
<body>
  <div class="container">
    <svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64">
      <defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#6366f1"/><stop offset="100%" style="stop-color:#a855f7"/></linearGradient></defs>
      <rect width="32" height="32" rx="8" fill="url(#grad)"/>
      <rect x="5" y="18" width="5" height="10" rx="1" fill="white" opacity="0.5"/>
      <rect x="13" y="12" width="5" height="16" rx="1" fill="white" opacity="0.75"/>
      <rect x="21" y="6" width="5" height="22" rx="1" fill="white"/>
      <path d="M6 16L15 9L24 4" stroke="white" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 3"/>
    </svg>
    <h1>Vedlikehold pågår</h1>
    <p class="message">${escapedMessage}</p>
    <div class="spinner"></div>
    <p class="auto-refresh">Siden sjekker automatisk om vi er tilbake...</p>
  </div>
  <script>
    setInterval(function(){
      fetch('/api/app/maintenance/status')
        .then(function(r){return r.json()})
        .then(function(d){if(!d.maintenance||d.mode!=='full')window.location.reload()})
        .catch(function(){});
    },30000);
  </script>
</body>
</html>`;
}

/**
 * Generate a cryptographically random CSRF token
 */
function generateCsrfToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Pads both strings to a fixed length to avoid leaking length information.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  // Pad to fixed length (CSRF tokens are 64 hex chars, use 128 for safety)
  const FIXED_LEN = 128;
  const bufA = new Uint8Array(FIXED_LEN);
  const bufB = new Uint8Array(FIXED_LEN);
  const rawA = encoder.encode(a);
  const rawB = encoder.encode(b);
  bufA.set(rawA.subarray(0, FIXED_LEN));
  bufB.set(rawB.subarray(0, FIXED_LEN));
  let result = rawA.length ^ rawB.length; // Include length in comparison
  for (let i = 0; i < FIXED_LEN; i++) {
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

export async function middleware(request: NextRequest) {
  const method = request.method.toUpperCase();
  const pathname = request.nextUrl.pathname;

  // Maintenance mode check (before CSRF, only for page navigations)
  if (method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/_next/')) {
    const maintenance = await getMaintenanceStatus();
    if (maintenance.active && maintenance.mode === 'full') {
      return new NextResponse(getMaintenanceHtml(maintenance.message), {
        status: 503,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Maintenance': 'true',
        },
      });
    }
  }

  // CSRF protection for state-changing requests on API routes
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && pathname.startsWith('/api/')) {
    const isExempt = CSRF_EXEMPT_PATHS.some((path) => pathname.startsWith(path));

    if (!isExempt) {
      // Origin/Referer validation as additional CSRF protection layer
      const origin = request.headers.get('origin');
      const referer = request.headers.get('referer');
      const host = request.headers.get('host');
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            return new NextResponse(JSON.stringify({ error: 'Ugyldig opprinnelse' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        } catch {
          return new NextResponse(JSON.stringify({ error: 'Ugyldig opprinnelse' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } else if (!origin && referer && host) {
        try {
          const refererHost = new URL(referer).host;
          if (refererHost !== host) {
            return new NextResponse(JSON.stringify({ error: 'Ugyldig opprinnelse' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        } catch {
          // Invalid referer — allow request (some browsers strip referer)
        }
      }

      // Double-submit cookie CSRF validation
      const cookieHeader = request.headers.get('cookie') || '';
      const csrfCookie = cookieHeader
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith('__csrf='));
      const csrfCookieValue = csrfCookie?.split('=')[1] || '';
      const csrfHeader = request.headers.get('X-CSRF-Token') || '';

      if (!csrfCookieValue || !csrfHeader || !timingSafeEqual(csrfCookieValue, csrfHeader)) {
        return new NextResponse(JSON.stringify({ error: 'Ugyldig CSRF-token' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  const response = NextResponse.next();

  // Set CSRF cookie on page requests (not API responses)
  if (method === 'GET' && !pathname.startsWith('/api/')) {
    const existingCookie = request.headers.get('cookie') || '';
    const hasCsrf = existingCookie.includes('__csrf=');
    if (!hasCsrf) {
      const token = generateCsrfToken();
      const isProduction = process.env.NODE_ENV === 'production';
      const cookieParts = [
        `__csrf=${token}`,
        'Path=/',
        'SameSite=Strict',
        'Max-Age=86400',
      ];
      if (isProduction) cookieParts.push('Secure');
      response.headers.append('Set-Cookie', cookieParts.join('; '));
    }
  }

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Enable XSS filter (legacy, but still useful for older browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Control referrer information
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy (formerly Feature-Policy)
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');

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
  response.headers.set('Content-Security-Policy', cspDirectives.join('; '));

  // HSTS - only in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.svg|images|screenshots|uploads|robots\\.txt).*)'],
};

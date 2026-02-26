/**
 * Maintenance Middleware
 * Intercepts requests based on maintenance mode:
 * - "banner": passes through, adds headers for frontend banner
 * - "full": blocks all access with maintenance page/503
 */

import { Request, Response, NextFunction } from 'express';
import { isMaintenanceEnabled, getMaintenanceMode, getMaintenanceMessage } from '../routes/maintenance';

// Paths that always pass through even in full maintenance mode
const ALWAYS_PASS = [
  '/api/maintenance',
  '/api/health',
];

function shouldPassThrough(path: string): boolean {
  return ALWAYS_PASS.some(p => path.startsWith(p));
}

export function maintenanceMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isMaintenanceEnabled()) {
    next();
    return;
  }

  const mode = getMaintenanceMode();
  const message = getMaintenanceMessage();

  // Banner mode: let everything through, add headers
  if (mode === 'banner') {
    res.setHeader('X-Maintenance', 'banner');
    res.setHeader('X-Maintenance-Message', encodeURIComponent(message));
    next();
    return;
  }

  // Full mode: block everything except maintenance/health endpoints
  if (shouldPassThrough(req.path)) {
    next();
    return;
  }

  // API requests: return 503 JSON
  if (req.path.startsWith('/api/')) {
    res.status(503).setHeader('X-Maintenance', 'true');
    res.json({
      success: false,
      error: {
        code: 'MAINTENANCE',
        message,
      },
    });
    return;
  }

  // Navigation/HTML requests: return maintenance page
  res.status(503);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Maintenance', 'true');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getMaintenanceHtml(message));
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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0A0E16;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 2rem;
      max-width: 480px;
    }
    .logo {
      width: 64px;
      height: 64px;
      margin: 0 auto 1.5rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
      color: #fff;
    }
    .message {
      color: #94a3b8;
      font-size: 1rem;
      line-height: 1.6;
      margin-bottom: 2rem;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(99, 102, 241, 0.2);
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .auto-refresh {
      color: #64748b;
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#6366f1"/>
          <stop offset="100%" style="stop-color:#a855f7"/>
        </linearGradient>
      </defs>
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
    (function() {
      var interval = setInterval(function() {
        fetch('/api/maintenance/status')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (!data.maintenance || data.mode !== 'full') {
              clearInterval(interval);
              window.location.reload();
            }
          })
          .catch(function() {});
      }, 30000);
    })();
  </script>
</body>
</html>`;
}

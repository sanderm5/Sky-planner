/**
 * API Documentation Routes
 * Serves OpenAPI/Swagger documentation
 */

import { Router, Response, Request } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router: Router = Router();

// Path to OpenAPI spec
const openApiPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');

// Cache parsed spec
let cachedSpec: object | null = null;

/**
 * Load and parse the OpenAPI spec
 */
function loadOpenApiSpec(): object {
  if (cachedSpec && process.env.NODE_ENV === 'production') {
    return cachedSpec;
  }

  const specContent = fs.readFileSync(openApiPath, 'utf8');
  cachedSpec = yaml.load(specContent) as object;
  return cachedSpec;
}

/**
 * GET /api/docs
 * Serve Swagger UI
 */
router.get('/', (req: Request, res: Response) => {
  const html = `
<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SkyPlanner API Dokumentasjon</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <link rel="icon" type="image/png" href="/favicon.png">
  <style>
    html {
      box-sizing: border-box;
      overflow-y: scroll;
    }
    *,
    *:before,
    *:after {
      box-sizing: inherit;
    }
    body {
      margin: 0;
      background: #fafafa;
    }
    .swagger-ui .topbar {
      display: none;
    }
    .swagger-ui .info {
      margin: 30px 0;
    }
    .swagger-ui .info .title {
      color: #3b4151;
    }
    .swagger-ui .scheme-container {
      background: #fff;
      box-shadow: 0 1px 2px 0 rgba(0,0,0,.15);
      padding: 20px;
    }
    .header-bar {
      background: #1e3a5f;
      padding: 15px 30px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header-bar h1 {
      color: white;
      margin: 0;
      font-size: 1.5rem;
      font-family: sans-serif;
    }
    .header-bar a {
      color: #8bb8e8;
      text-decoration: none;
      font-family: sans-serif;
    }
    .header-bar a:hover {
      color: white;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <h1>SkyPlanner API</h1>
    <div>
      <a href="/api/docs/openapi.json" target="_blank">JSON</a>
      &nbsp;|&nbsp;
      <a href="/api/docs/openapi.yaml" target="_blank">YAML</a>
      &nbsp;|&nbsp;
      <a href="https://skyplanner.no" target="_blank">skyplanner.no</a>
    </div>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "/api/docs/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        tryItOutEnabled: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        defaultModelsExpandDepth: 0,
        defaultModelExpandDepth: 2,
        docExpansion: "list",
        syntaxHighlight: {
          activate: true,
          theme: "monokai"
        }
      });
    };
  </script>
</body>
</html>
  `;

  res.type('html').send(html);
});

/**
 * GET /api/docs/openapi.json
 * Serve OpenAPI spec as JSON
 */
router.get('/openapi.json', (req: Request, res: Response) => {
  try {
    const spec = loadOpenApiSpec();
    res.json(spec);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'SPEC_LOAD_ERROR',
        message: 'Kunne ikke laste API-spesifikasjon',
      },
    });
  }
});

/**
 * GET /api/docs/openapi.yaml
 * Serve OpenAPI spec as YAML
 */
router.get('/openapi.yaml', (req: Request, res: Response) => {
  try {
    const specContent = fs.readFileSync(openApiPath, 'utf8');
    res.type('text/yaml').send(specContent);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'SPEC_LOAD_ERROR',
        message: 'Kunne ikke laste API-spesifikasjon',
      },
    });
  }
});

/**
 * GET /api/docs/webhook-signature
 * Documentation for webhook signature verification
 */
router.get('/webhook-signature', (req: Request, res: Response) => {
  const html = `
<!DOCTYPE html>
<html lang="no">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Webhook Signatur Verifisering - SkyPlanner</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 { color: #1e3a5f; }
    h2 { color: #2c5282; margin-top: 40px; }
    pre {
      background: #f5f5f5;
      padding: 20px;
      border-radius: 8px;
      overflow-x: auto;
    }
    code {
      background: #e8e8e8;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Fira Code', monospace;
    }
    pre code {
      background: none;
      padding: 0;
    }
    .header-info {
      background: #e8f4f8;
      padding: 15px 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .warning {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px 20px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <h1>Webhook Signatur Verifisering</h1>

  <p>
    Alle webhook-leveranser fra SkyPlanner inkluderer en HMAC-SHA256 signatur i
    <code>X-Webhook-Signature</code> headeren. Du bør alltid verifisere denne
    signaturen for å sikre at webhook-en kommer fra SkyPlanner.
  </p>

  <div class="header-info">
    <strong>Webhook Headers:</strong>
    <ul>
      <li><code>X-Webhook-Signature</code> - HMAC-SHA256 signatur</li>
      <li><code>X-Webhook-Event</code> - Event-type (f.eks. customer.created)</li>
      <li><code>X-Webhook-ID</code> - Unik event-ID for idempotency</li>
      <li><code>X-Webhook-Timestamp</code> - Tidspunkt for sending</li>
    </ul>
  </div>

  <h2>Signaturformat</h2>
  <p>Signaturen har formatet <code>sha256=&lt;hex-encoded-signature&gt;</code></p>

  <h2>Node.js Eksempel</h2>
  <pre><code>const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  // Hash the secret (SkyPlanner hashes the secret before using it)
  const secretHash = crypto
    .createHash('sha256')
    .update(secret)
    .digest('hex');

  // Calculate expected signature
  const expectedSignature = crypto
    .createHmac('sha256', secretHash)
    .update(payload, 'utf8')
    .digest('hex');

  // Extract signature from header (remove 'sha256=' prefix)
  const providedSignature = signature.replace('sha256=', '');

  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedSignature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// Express middleware example
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = req.body.toString();

  if (!verifyWebhookSignature(payload, signature, process.env.WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(payload);
  console.log('Received webhook:', event.type, event.id);

  // Handle the event...

  res.status(200).send('OK');
});</code></pre>

  <h2>Python Eksempel</h2>
  <pre><code>import hmac
import hashlib

def verify_webhook_signature(payload: str, signature: str, secret: str) -> bool:
    # Hash the secret
    secret_hash = hashlib.sha256(secret.encode()).hexdigest()

    # Calculate expected signature
    expected = hmac.new(
        secret_hash.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()

    # Extract signature from header
    provided = signature.replace('sha256=', '')

    # Use constant-time comparison
    return hmac.compare_digest(expected, provided)</code></pre>

  <div class="warning">
    <strong>Viktig:</strong> Bruk alltid timing-safe sammenligning for signaturverifisering
    for å unngå timing-angrep.
  </div>

  <h2>Test Signaturverifisering</h2>
  <p>
    Du kan teste signaturverifiseringen via API-et:
  </p>
  <pre><code>POST /api/webhooks/test
Content-Type: application/json

{
  "payload": {"type": "test"},
  "signature": "sha256=abc123...",
  "secret": "whsec_your_secret"
}</code></pre>

  <p>
    <a href="/api/docs">Tilbake til API-dokumentasjon</a>
  </p>
</body>
</html>
  `;

  res.type('html').send(html);
});

export default router;

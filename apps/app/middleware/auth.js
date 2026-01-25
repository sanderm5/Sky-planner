const jwt = require('jsonwebtoken');

// Logger utility
const Logger = {
  isDev: () => process.env.NODE_ENV !== 'production',
  warn: function(...args) {
    if (this.isDev()) console.warn('[WARN]', ...args);
  }
};

// JWT secret from environment - REQUIRED in all environments
const JWT_SECRET = process.env.JWT_SECRET;

// Get JWT secret - throws if not configured
const getJwtSecret = () => {
  if (!JWT_SECRET) {
    throw new Error(
      'JWT_SECRET environment variable is required. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
    );
  }
  return JWT_SECRET;
};

const jwtSecret = getJwtSecret();

/**
 * Basic auth middleware - checks for valid JWT token
 * Allows public paths through without auth
 */
function requireAuth(req, res, next) {
  // Skip auth if disabled (for development only)
  if (process.env.REQUIRE_AUTH === 'false') {
    return next();
  }

  // Allow login and config endpoints without auth
  const publicPaths = [
    '/klient/login',
    '/klient/logout',
    '/config',
    '/auth/request-reset',
    '/auth/verify-token',
    '/auth/reset-password',
    '/auth/refresh',
    '/cron/email-varsler'
  ];
  if (publicPaths.includes(req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Ikke innlogget', requireLogin: true });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.userSession = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesjonen har utløpt', requireLogin: true });
    }
    return res.status(401).json({ error: 'Ugyldig sesjon', requireLogin: true });
  }
}

/**
 * Client auth middleware - verifies JWT and extracts organization context
 */
function requireKlientAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Mangler autorisasjon' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.klientSession = decoded;
    req.klientEpost = decoded.epost;
    req.klientToken = token;
    // Multi-tenancy: Extract organization context from JWT
    req.organizationId = decoded.organizationId || null;
    req.organizationSlug = decoded.organizationSlug || null;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Sesjonen har utløpt' });
    }
    return res.status(401).json({ error: 'Ugyldig token' });
  }
}

/**
 * Tenant auth middleware - requires valid organization context
 */
function requireTenantAuth(req, res, next) {
  requireKlientAuth(req, res, () => {
    if (!req.organizationId) {
      return res.status(401).json({ error: 'Mangler organisasjonskontekst' });
    }
    next();
  });
}

/**
 * Sign a JWT token
 */
function signToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, jwtSecret, { expiresIn });
}

/**
 * Verify a JWT token
 */
function verifyToken(token) {
  return jwt.verify(token, jwtSecret);
}

module.exports = {
  requireAuth,
  requireKlientAuth,
  requireTenantAuth,
  signToken,
  verifyToken
};

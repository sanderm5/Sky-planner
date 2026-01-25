/**
 * Route modules index
 * Exports factory functions for all route modules
 */

const createKunderRoutes = require('./kunder');
const createRuterRoutes = require('./ruter');
const createAvtalerRoutes = require('./avtaler');
const createIndustriesRoutes = require('./industries');
const createFieldsRoutes = require('./fields');

/**
 * Initialize all routes with dependencies
 * @param {Object} deps - Shared dependencies
 * @param {Object} deps.db - SQLite database instance
 * @param {Object} deps.supabaseService - Supabase service
 * @param {boolean} deps.useSupabase - Whether to use Supabase
 * @param {string} deps.jwtSecret - JWT secret for token verification
 * @returns {Object} Object with all initialized routers
 */
function initializeRoutes(deps) {
  return {
    kunder: createKunderRoutes(deps),
    ruter: createRuterRoutes(deps),
    avtaler: createAvtalerRoutes(deps),
    industries: createIndustriesRoutes(deps),
    fields: createFieldsRoutes(deps)
  };
}

module.exports = {
  createKunderRoutes,
  createRuterRoutes,
  createAvtalerRoutes,
  createIndustriesRoutes,
  createFieldsRoutes,
  initializeRoutes
};

/**
 * Integration module exports
 */

// Types
export * from './types';

// Base adapter
export { BaseDataSourceAdapter } from './base-adapter';

// Registry
export {
  IntegrationRegistry,
  getIntegrationRegistry,
  resetIntegrationRegistry,
} from './registry';

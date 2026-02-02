/**
 * Integration registry for managing data source adapters
 * Provides a central place to register and look up adapters
 */

import type { DataSourceAdapter, IntegrationConfig } from './types';
import { logger } from '../services/logger';

const registryLogger = logger.child({ component: 'integration-registry' });

/**
 * Registry for managing integration adapters
 */
export class IntegrationRegistry {
  private adapters = new Map<string, DataSourceAdapter>();

  /**
   * Register an adapter
   * @param adapter The adapter to register
   */
  register(adapter: DataSourceAdapter): void {
    if (this.adapters.has(adapter.config.id)) {
      registryLogger.warn(
        { integrationId: adapter.config.id },
        'Overwriting existing adapter'
      );
    }

    this.adapters.set(adapter.config.id, adapter);

    registryLogger.info(
      { integrationId: adapter.config.id, name: adapter.config.name },
      'Registered integration adapter'
    );
  }

  /**
   * Get an adapter by ID
   * @param id Integration ID
   * @returns The adapter or undefined if not found
   */
  get(id: string): DataSourceAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Get all registered adapters
   * @returns Array of all adapters
   */
  getAll(): DataSourceAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get all integration configs (for listing in UI)
   * @returns Array of integration configs
   */
  getAllConfigs(): IntegrationConfig[] {
    return this.getAll().map(adapter => adapter.config);
  }

  /**
   * Check if an adapter is registered
   * @param id Integration ID
   * @returns true if registered
   */
  has(id: string): boolean {
    return this.adapters.has(id);
  }

  /**
   * Unregister an adapter
   * @param id Integration ID
   * @returns true if adapter was removed
   */
  unregister(id: string): boolean {
    const removed = this.adapters.delete(id);

    if (removed) {
      registryLogger.info({ integrationId: id }, 'Unregistered integration adapter');
    }

    return removed;
  }

  /**
   * Get the count of registered adapters
   */
  get size(): number {
    return this.adapters.size;
  }
}

// Global registry instance
let globalRegistry: IntegrationRegistry | null = null;

/**
 * Get the global integration registry
 * Creates it if it doesn't exist
 */
export function getIntegrationRegistry(): IntegrationRegistry {
  if (!globalRegistry) {
    globalRegistry = new IntegrationRegistry();
  }
  return globalRegistry;
}

/**
 * Reset the global registry (mainly for testing)
 */
export function resetIntegrationRegistry(): void {
  globalRegistry = null;
}

/**
 * Engine Initialization
 *
 * Initialize the engine by registering catalog elements.
 * Call this once at application startup.
 */

import { registerCatalogElements } from '@/lib/catalog'

let initialized = false

/**
 * Initialize the engine with catalog elements
 */
export function initializeEngine(): void {
  if (initialized) {
    console.warn('[Engine] Already initialized')
    return
  }

  console.log('[Engine] Initializing...')

  // Register all catalog elements (structural, items, etc.)
  registerCatalogElements()

  initialized = true
  console.log('[Engine] ✓ Initialization complete')
}

/**
 * Check if engine is initialized
 */
export function isEngineInitialized(): boolean {
  return initialized
}

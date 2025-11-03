/**
 * Bounds System
 *
 * Computes bounding boxes for entities with TransformGrid components.
 * Uses element definitions to determine the appropriate bounds computation strategy.
 */

import type { Bounds, ElementTag, TransformGrid } from '../components'
import { BOUNDS, ELEMENT, TRANSFORM_GRID } from '../components'
import type { World } from '../core'
import { getDefinition } from '../registry'

// ============================================================================
// BOUNDS SYSTEM
// ============================================================================

/**
 * Run the bounds system on all entities
 */
export function runBoundsSystem(world: World): void {
  // Query all entities with TransformGrid and Element components
  const entities = world.query(TRANSFORM_GRID, ELEMENT)

  for (const entityId of entities) {
    computeBoundsForEntity(entityId, world)
  }
}

/**
 * Compute bounds for a single entity
 */
export function computeBoundsForEntity(entityId: string, world: World): Bounds | null {
  const element = world.getComponent<ElementTag>(entityId, ELEMENT)
  if (!element) return null

  // Get the element definition
  const definition = getDefinition(element.kind)
  if (!definition?.computeBounds) {
    // No bounds computation defined
    return null
  }

  // Compute bounds using the definition's strategy
  const bounds = definition.computeBounds(entityId, world) as Bounds | null

  if (bounds) {
    // Store bounds component
    world.setComponent(entityId, BOUNDS, bounds)
  }

  return bounds
}

/**
 * Get bounds for an entity (computes if not present)
 */
export function getBounds(entityId: string, world: World): Bounds | null {
  // Check if bounds already computed
  const bounds = world.getComponent<Bounds>(entityId, BOUNDS)

  if (bounds) {
    return bounds
  }

  // Compute bounds on-demand
  return computeBoundsForEntity(entityId, world)
}

/**
 * Clear all bounds (useful when you want to recompute everything)
 */
export function clearBounds(world: World): void {
  const store = world.getComponentStore<Bounds>(BOUNDS)
  if (store) {
    store.clear()
  }
}

/**
 * Recompute bounds for specific entities
 */
export function recomputeBounds(world: World, entityIds: string[]): void {
  for (const entityId of entityIds) {
    computeBoundsForEntity(entityId, world)
  }
}

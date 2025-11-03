/**
 * Footprint System
 *
 * Computes 2D footprints for entities.
 * Handles special cases like mitered wall polygons.
 */

import type { ElementTag, Footprint } from '../components'
import { ELEMENT, FOOTPRINT, TRANSFORM_GRID } from '../components'
import type { World } from '../core'
import { getDefinition } from '../registry'

// ============================================================================
// FOOTPRINT SYSTEM
// ============================================================================

/**
 * Run the footprint system on all entities
 */
export function runFootprintSystem(world: World): void {
  // Query all entities with TransformGrid and Element components
  const entities = world.query(TRANSFORM_GRID, ELEMENT)

  for (const entityId of entities) {
    computeFootprintForEntity(entityId, world)
  }
}

/**
 * Compute footprint for a single entity
 */
export function computeFootprintForEntity(entityId: string, world: World): Footprint | null {
  const element = world.getComponent<ElementTag>(entityId, ELEMENT)
  if (!element) return null

  // Get the element definition
  const definition = getDefinition(element.kind)
  if (!definition?.computeFootprint) {
    // No footprint computation defined
    return null
  }

  // Compute footprint using the definition's strategy
  const footprint = definition.computeFootprint(entityId, world) as Footprint | null

  if (footprint) {
    // Store footprint component
    world.setComponent(entityId, FOOTPRINT, footprint)
  }

  return footprint
}

/**
 * Get footprint for an entity (computes if not present)
 */
export function getFootprint(entityId: string, world: World): Footprint | null {
  // Check if footprint already computed
  const footprint = world.getComponent<Footprint>(entityId, FOOTPRINT)

  if (footprint) {
    return footprint
  }

  // Compute footprint on-demand
  return computeFootprintForEntity(entityId, world)
}

/**
 * Clear all footprints
 */
export function clearFootprints(world: World): void {
  const store = world.getComponentStore<Footprint>(FOOTPRINT)
  if (store) {
    store.clear()
  }
}

/**
 * Recompute footprints for specific entities
 */
export function recomputeFootprints(world: World, entityIds: string[]): void {
  for (const entityId of entityIds) {
    computeFootprintForEntity(entityId, world)
  }
}

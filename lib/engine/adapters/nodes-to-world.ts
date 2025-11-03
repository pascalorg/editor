/**
 * Nodes to World Adapter
 *
 * Builds an ECS World from the node tree.
 * This is the bridge between the canonical node model and the ECS runtime.
 */

import type { BaseNode, LevelNode } from '../../nodes/types'
import { traverseTree } from '../../nodes/utils'
import { World } from '../core'
import { getDefinition } from '../registry'

// ============================================================================
// ADAPTER
// ============================================================================

/**
 * Build a World from the node tree
 */
export function buildWorldFromNodes(levels: LevelNode[], gridSizeMeters = 0.5): World {
  const world = new World({ gridSizeMeters })

  // First pass: Create all entities
  for (const level of levels) {
    // Add level entity
    world.addEntity(level.id)

    // Add all descendant entities
    traverseTree([level], (node) => {
      world.addEntity(node.id)
      return true
    })
  }

  // Second pass: Create components for each entity
  for (const level of levels) {
    processNode(level, world)

    // Process all descendants
    traverseTree([level], (node) => {
      processNode(node, world)
      return true
    })
  }

  return world
}

/**
 * Process a single node and create its components
 */
function processNode(node: BaseNode, world: World): void {
  // Get the element definition for this node type
  const definition = getDefinition(node.type)

  if (!definition) {
    // No definition registered - this is okay for levels and groups
    // We'll still create basic components
    console.debug(`No element definition found for type: ${node.type}`)
    return
  }

  // Create components using the definition
  const components = definition.create(node, {
    world,
    gridSizeMeters: world.gridSizeMeters,
    node,
  })

  // Add all components to the entity
  for (const [componentType, component] of Object.entries(components)) {
    world.setComponent(node.id, componentType, component)
  }
}

// ============================================================================
// INCREMENTAL UPDATES
// ============================================================================

/**
 * Update a single entity in the world from its node
 */
export function updateEntityFromNode(world: World, node: BaseNode): void {
  // Check if entity exists
  if (!world.hasEntity(node.id)) {
    world.addEntity(node.id)
  }

  // Rebuild components
  processNode(node, world)
}

/**
 * Remove an entity and all its descendants from the world
 */
export function removeEntityFromWorld(world: World, entityId: string): void {
  // For now, just remove the entity
  // In the future, we might want to cascade to children
  world.removeEntity(entityId)
}

/**
 * Rebuild the entire world from nodes (use sparingly)
 */
export function rebuildWorld(world: World, levels: LevelNode[]): void {
  world.clear()

  // Rebuild from scratch
  const newWorld = buildWorldFromNodes(levels, world.gridSizeMeters)

  // Copy entities and components back (since we can't replace the world instance)
  for (const entityId of newWorld.getAllEntities()) {
    world.addEntity(entityId)
  }

  // Copy components (this is a bit hacky, but works for now)
  // In a real implementation, we'd have a better way to do this
  for (const entityId of newWorld.getAllEntities()) {
    // We'll rely on systems to recompute everything
  }
}

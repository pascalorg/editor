import { WALL_HEIGHT } from '@/components/editor'
import { SLAB_THICKNESS } from '@/components/nodes/slab/slab-renderer'
import type { AnyNode, NodeTypeMap } from '@/lib/scenegraph/schema/index'
import type { NodeProcessor, NodeProcessResult } from './types'

// Minimum level height (in meters)
const MIN_LEVEL_HEIGHT = WALL_HEIGHT

/**
 * Gets the height of a node based on its type
 */
// TODO: Should be generified to support custom heights per node type
function getNodeHeight(node: AnyNode): number {
  switch (node.type) {
    case 'wall':
    case 'column':
      return WALL_HEIGHT
    case 'slab':
      return SLAB_THICKNESS
    case 'door':
      return 2.0 // Standard door height
    case 'window':
      return 1.22 // Standard window height
    case 'roof':
      return 2.5 // Roof thickness
    default:
      return 0
  }
}

/**
 * Recursively calculates the maximum height among a node and all its descendants
 */
function getMaxHeightRecursive(node: AnyNode): number {
  // Get this node's height + elevation
  const nodeHeight = getNodeHeight(node)
  const nodeElevation = (node as any).elevation || 0
  let maxHeight = nodeHeight + nodeElevation

  // Recursively check all children
  // AnyNode union doesn't guarantee children property structure identically across all types in a simple way without narrowing
  // But for calculation purposes we can iterate if it exists
  if ('children' in node && Array.isArray(node.children)) {
    // @ts-expect-error - we know children are AnyNode[] if they exist, but schema types might be strict
    for (const child of node.children) {
      const childMaxHeight = getMaxHeightRecursive(child)
      if (childMaxHeight > maxHeight) {
        maxHeight = childMaxHeight
      }
    }
  }

  return maxHeight
}

/**
 * LevelHeightProcessor calculates the height of each level
 * based on the maximum height of all nodes in that level (including nested children).
 *
 * The height represents how tall the level is internally (its content height).
 * This is different from elevation, which is calculated separately based on
 * the cumulative heights of previous levels.
 */
export class LevelHeightProcessor implements NodeProcessor {
  nodeTypes = ['level']

  process(nodes: AnyNode[]): NodeProcessResult[] {
    const results: NodeProcessResult[] = []

    // Process each level
    nodes.forEach((node) => {
      if (node.type !== 'level') return

      const level = node as NodeTypeMap['level']

      // Calculate the maximum height among all descendant nodes (recursively)
      let maxHeight = 0

      level.children.forEach((child) => {
        const childMaxHeight = getMaxHeightRecursive(child as AnyNode)
        if (childMaxHeight > maxHeight) {
          maxHeight = childMaxHeight
        }
      })

      // Use minimum level height if no children or all children have zero height
      const levelHeight = Math.max(maxHeight, MIN_LEVEL_HEIGHT)

      results.push({
        nodeId: level.id,
        updates: {
          height: levelHeight,
        },
      })
    })

    return results
  }
}

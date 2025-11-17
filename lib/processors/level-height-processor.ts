import { WALL_HEIGHT } from '@/components/editor'
import { SLAB_THICKNESS } from '@/components/nodes/slab/slab-renderer'
import type { BaseNode, LevelNode } from '../nodes/types'
import type { NodeProcessor, NodeProcessResult } from './types'

// Minimum level height (in meters)
const MIN_LEVEL_HEIGHT = 2.5

/**
 * Gets the height of a node based on its type
 */
// TODO: Should be generified to support custom heights per node type
function getNodeHeight(node: BaseNode): number {
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
      return 0.3 // Roof thickness
    default:
      return 0
  }
}

/**
 * LevelHeightProcessor calculates the height of each level
 * based on the maximum height of all nodes in that level.
 *
 * The height represents how tall the level is internally (its content height).
 * This is different from elevation, which is calculated separately based on
 * the cumulative heights of previous levels.
 */
export class LevelHeightProcessor implements NodeProcessor {
  nodeTypes = ['level']

  process(nodes: BaseNode[]): NodeProcessResult[] {
    const results: NodeProcessResult[] = []

    // Process each level
    nodes.forEach((node) => {
      if (node.type !== 'level') return

      const level = node as LevelNode

      // Calculate the maximum height among all child nodes
      let maxHeight = 0

      level.children.forEach((child) => {
        const childHeight = getNodeHeight(child)
        const childElevation = (child as any).elevation || 0
        const totalHeight = childHeight + childElevation

        if (totalHeight > maxHeight) {
          maxHeight = totalHeight
        }
      })

      // Use minimum level height if no children or all children have zero height
      const levelHeight = maxHeight > 0 ? maxHeight : MIN_LEVEL_HEIGHT

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

import { SLAB_THICKNESS, WALL_HEIGHT } from '../constants'
import type { SceneGraph } from '../scenegraph'
import type { AnyNode, SceneNodeId } from '../scenegraph/schema/index'
import type { NodeProcessor, NodeProcessResult } from './types'

export class VerticalStackingProcessor implements NodeProcessor {
  nodeTypes = ['wall', 'column', 'slab', 'item', 'stair', 'ceiling']

  process(nodes: AnyNode[], graph: SceneGraph): NodeProcessResult[] {
    const results: NodeProcessResult[] = []

    // Check if there's a slab in the affected nodes
    const hasSlab = nodes.some((node) => node.type === 'slab')

    nodes.forEach((node) => {
      // Skip slab nodes themselves
      if (node.type === 'slab') {
        return
      }

      // Skip nodes whose parent chain includes a node with elevation
      // (e.g., items attached to walls or ceilings)
      // These nodes are positioned relative to their parent
      if (this.hasElevatedParent(node, graph)) {
        return
      }

      if (this.supportsVerticalStacking(node)) {
        let elevation: number

        if (node.type === 'ceiling') {
          // Ceiling is positioned at the top of the walls
          elevation = hasSlab ? SLAB_THICKNESS + WALL_HEIGHT : WALL_HEIGHT
        } else {
          // Walls, columns, items, stairs are positioned at the bottom
          elevation = hasSlab ? SLAB_THICKNESS : 0
        }

        results.push({
          nodeId: node.id,
          updates: {
            elevation,
          },
        })
      }
    })

    return results
  }

  /**
   * Check if any ancestor in the parent chain has elevation applied
   * Recursively checks up the parent chain until reaching level/building/root
   */
  private hasElevatedParent(node: AnyNode, graph: SceneGraph): boolean {
    if (!('parentId' in node && node.parentId)) {
      return false
    }

    const parent = graph.getNodeById(node.parentId as SceneNodeId)?.data()
    if (!parent) {
      return false
    }

    // If parent is one of the types that gets elevation, return true
    if (this.nodeTypes.includes(parent.type)) {
      return true
    }

    // Recursively check the parent's parent
    return this.hasElevatedParent(parent, graph)
  }

  private supportsVerticalStacking(node: AnyNode): boolean {
    return this.nodeTypes.includes(node.type)
  }
}

import { SLAB_THICKNESS } from '@/components/nodes/slab/slab-renderer'
import { WALL_HEIGHT } from '@/components/editor'
import type { AnyNode } from '@/lib/scenegraph/schema/index'
import type { NodeProcessor, NodeProcessResult } from './types'

export class VerticalStackingProcessor implements NodeProcessor {
  nodeTypes = ['wall', 'column', 'slab', 'item', 'stair', 'ceiling']

  process(nodes: AnyNode[]): NodeProcessResult[] {
    const results: NodeProcessResult[] = []

    // Check if there's a slab in the affected nodes
    const hasSlab = nodes.some((node) => node.type === 'slab')

    nodes.forEach((node) => {
      // Skip slab nodes themselves
      if (node.type === 'slab') {
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

  private supportsVerticalStacking(node: AnyNode): boolean {
    return this.nodeTypes.includes(node.type)
  }
}

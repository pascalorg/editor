import { SLAB_THICKNESS } from '@/components/nodes/slab/slab-renderer'
import type { AnyNode } from '@/lib/scenegraph/schema/index'
import type { NodeProcessor, NodeProcessResult } from './types'

export class VerticalStackingProcessor implements NodeProcessor {
  nodeTypes = ['wall', 'column', 'slab', 'item', 'stair']

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
        results.push({
          nodeId: node.id,
          updates: {
            // If there's a slab, walls/columns/items should be elevated by slab thickness
            // Otherwise they're at ground level (0)
            elevation: hasSlab ? SLAB_THICKNESS : 0,
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

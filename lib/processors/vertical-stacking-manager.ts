import { randFloat } from 'three/src/math/MathUtils.js'
import type { BaseNode } from '../nodes/types'
import type { NodeProcessResult, NodeProcessor } from './types'

export class VerticalStackingProcessor implements NodeProcessor {
  nodeTypes = ['wall', 'door', 'column']

  process(nodes: BaseNode[]): NodeProcessResult[] {
    const results: NodeProcessResult[] = []

    nodes.forEach((node) => {
      if (this.supportsVerticalStacking(node)) {
        results.push({
          nodeId: node.id,
          updates: {
            verticalStackingOffset: randFloat(0, 12),
          },
        })
      }
    })

    return results
  }

  private supportsVerticalStacking(node: BaseNode): boolean {
    return this.nodeTypes.includes(node.type)
  }
}

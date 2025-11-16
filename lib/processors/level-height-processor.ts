import { SLAB_THICKNESS } from '@/components/nodes/slab/slab-renderer'
import type { BaseNode } from '../nodes/types'
import type { NodeProcessor, NodeProcessResult } from './types'

export class LevelHeightProcessor implements NodeProcessor {
  nodeTypes = []

  process(nodes: BaseNode[]): NodeProcessResult[] {
    const results: NodeProcessResult[] = []

    return results
  }
}

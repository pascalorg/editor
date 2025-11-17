import type { AnyNode, BaseNode } from '../nodes/types'

/**
 * Computed properties to be applied to a node
 */
export type ComputedProperties = Partial<AnyNode>

/**
 * Result of processing a node
 */
export interface NodeProcessResult {
  nodeId: string
  updates: ComputedProperties
}

export interface NodeProcessor {
  /**
   * Process nodes and return computed properties for each
   * Returns an array of node updates to apply
   */
  process: (nodes: BaseNode[]) => NodeProcessResult[]
  nodeTypes: string[] // Filter for node types this processor applies to
}

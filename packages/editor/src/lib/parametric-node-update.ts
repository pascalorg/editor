import {
  type AnyNode,
  type AnyNodeId,
  nodeRegistry,
  type ParametricDescriptor,
  useScene,
} from '@pascal-app/core'

/** A field edit with what its kind's parametrics derive and reconcile from it, as updates. */
export function parametricNodeUpdates(
  nodeId: AnyNodeId,
  requestedPatch: Partial<AnyNode>,
): { id: AnyNodeId; data: Partial<AnyNode> }[] {
  const nodes = useScene.getState().nodes
  const node = nodes[nodeId]
  if (!node) return []

  const parametrics = nodeRegistry.get(node.type)?.parametrics as
    | ParametricDescriptor<AnyNode>
    | undefined
  let patch = requestedPatch as Record<string, unknown>
  if (parametrics?.derive) {
    const next = { ...node, ...patch } as AnyNode
    patch = {
      ...patch,
      ...parametrics.derive(next, patch as Partial<AnyNode>, node),
    }
  }

  const updates: { id: AnyNodeId; data: Partial<AnyNode> }[] = [
    { id: nodeId, data: patch as Partial<AnyNode> },
  ]
  if (parametrics?.reconcile) {
    const next = { ...node, ...patch } as AnyNode
    updates.push(...parametrics.reconcile(node, next, { ...nodes, [nodeId]: next }))
  }
  return updates
}

export function commitParametricNodeFields(
  nodeId: AnyNodeId,
  requestedPatch: Partial<AnyNode>,
): void {
  const updates = parametricNodeUpdates(nodeId, requestedPatch)
  if (updates.length) useScene.getState().updateNodes(updates)
}

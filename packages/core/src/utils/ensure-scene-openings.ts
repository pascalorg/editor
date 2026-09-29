import type { AnyNode, AnyNodeId } from '../schema'
import { syncStairRises } from '../systems/stair/stair-rise-query'

export function ensureSceneOpenings(sourceNodes: Record<string, unknown>) {
  let nodes = sourceNodes as Record<string, AnyNode>
  const patches = new Map<AnyNodeId, Partial<AnyNode>>()
  const kinds = new Set(Object.values(nodes).map((node) => node.type))
  const steps = kinds.has('stair') ? [syncStairRises] : []
  let pending = true
  while (pending) {
    pending = false
    for (const derive of steps) {
      const updates = derive(nodes)
      if (!updates.length) continue
      pending = true
      nodes = { ...nodes }
      for (const { id, data } of updates) {
        nodes[id] = { ...nodes[id], ...data } as AnyNode
        patches.set(id, { ...patches.get(id), ...data } as Partial<AnyNode>)
      }
    }
  }

  return {
    nodes,
    changed: nodes !== sourceNodes,
    updates: [...patches].map(([id, data]) => ({ id, data })),
  }
}

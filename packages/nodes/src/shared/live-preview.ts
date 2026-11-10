import { type AnyNode, type AnyNodeId, useLiveNodeOverrides, useScene } from '@pascal-app/core'

type NodeUpdate = { id: AnyNodeId; data: Partial<AnyNode> }

/**
 * A handle drag's transient preview through `useLiveNodeOverrides`: each frame
 * replaces the previous one, so a node the current frame no longer moves (a
 * detached or zero-delta follower) shows its committed state again.
 */
export function createLivePreview() {
  const previewed = new Set<AnyNodeId>()
  const drop = (id: AnyNodeId) => {
    useLiveNodeOverrides.getState().clear(id)
    if (useScene.getState().nodes[id]) useScene.getState().markDirty(id)
    previewed.delete(id)
  }
  return {
    publish(updates: NodeUpdate[]) {
      const scene = useScene.getState()
      const entries = updates
        .filter((update) => scene.nodes[update.id])
        .map((update) => [update.id, update.data as Record<string, unknown>] as const)
      const next = new Set(entries.map(([id]) => id))
      for (const id of [...previewed]) if (!next.has(id)) drop(id)
      useLiveNodeOverrides.getState().setMany(entries)
      for (const [id] of entries) {
        previewed.add(id)
        scene.markDirty(id)
      }
    },
    clear() {
      for (const id of [...previewed]) drop(id)
    },
  }
}

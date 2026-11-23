import { type AnyNode, type AnyNodeId, useScene } from '@pascal-app/core'

type NodeUpdate = { id: AnyNodeId; data: Partial<AnyNode> }

/**
 * Frames for a drag that previews by writing the scene. A follower an earlier
 * frame moved and this one leaves out (held Alt detached it, or the drag came
 * back to a zero delta, which connectivity leaves unwritten) goes back to its
 * drag-start fields, so neither the preview nor a commit read back from the
 * scene keeps it where an old frame put it.
 */
export function createFollowerFrames(
  startNodes: Readonly<Record<string, AnyNode>>,
  movedId: AnyNodeId,
): (updates: NodeUpdate[]) => NodeUpdate[] {
  const written = new Map<AnyNodeId, Set<string>>()
  return (updates) => {
    const included = new Set(updates.map((update) => update.id))
    const restores: NodeUpdate[] = []
    for (const [id, keys] of written) {
      if (included.has(id)) continue
      written.delete(id)
      const start = startNodes[id] as unknown as Record<string, unknown> | undefined
      if (!start || !useScene.getState().nodes[id]) continue
      restores.push({
        id,
        data: Object.fromEntries([...keys].map((key) => [key, start[key]])) as Partial<AnyNode>,
      })
    }
    for (const update of updates) {
      if (update.id === movedId) continue
      const keys = written.get(update.id) ?? new Set<string>()
      for (const key of Object.keys(update.data)) keys.add(key)
      written.set(update.id, keys)
    }
    return [...updates, ...restores]
  }
}

const listeners = new Set<(nodeId: string) => void>()

/** The node batch listens here; kept apart from `system.tsx` so renderers can import it. */
export function subscribeBatchReleases(listener: (nodeId: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * A renderer whose meshes start or stop moving inside a frame (a procedural
 * motion) reports it here: the node draws itself, then rejoins once quiet.
 */
export function releaseFromBatch(nodeId: string): void {
  for (const listener of listeners) listener(nodeId)
}

// New kind-specific modules belong in nodes; viewer must not depend on nodes.
// This extracts the existing viewer-owned WallSystem rebuild signal.
// Dirty marks disappear before later systems run. Keep the batch drain and
// cutout subscribers independent, including deferred neighbour rebuilds.
const rebuiltWalls = new Set<string>()
const listeners = new Set<(wallId: string) => void>()

export function notifyWallRebuilt(wallId: string): void {
  rebuiltWalls.add(wallId)
  for (const listener of listeners) listener(wallId)
}

export function subscribeWallRebuilds(listener: (wallId: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Moves every rebuild notice collected so far into `into`. */
export function drainRebuiltWalls(into: Set<string>): void {
  for (const wallId of rebuiltWalls) into.add(wallId)
  rebuiltWalls.clear()
}

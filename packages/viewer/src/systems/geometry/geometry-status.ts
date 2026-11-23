import { type AnyNodeId, useScene } from '@pascal-app/core'
import { create } from 'zustand'

export type GeometryFailure = 'build-failed' | 'invalid-geometry'

/** Geometry failures describe the current rendering, never saved building data. */
export const useGeometryStatus = create<{ failures: ReadonlyMap<AnyNodeId, GeometryFailure> }>(
  () => ({
    failures: new Map(),
  }),
)

export function setGeometryFailure(id: AnyNodeId, message: GeometryFailure | null) {
  const current = useGeometryStatus.getState().failures
  if ((current.get(id) ?? null) === message) return
  const failures = new Map(current)
  if (message) failures.set(id, message)
  else failures.delete(id)
  useGeometryStatus.setState({ failures })
}

useScene.subscribe((scene, previous) => {
  const failures = useGeometryStatus.getState().failures
  for (const id of failures.keys()) {
    if (scene.hydrationId !== previous.hydrationId || !scene.nodes[id]) setGeometryFailure(id, null)
  }
})

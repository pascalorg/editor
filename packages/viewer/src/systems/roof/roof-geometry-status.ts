import { type AnyNodeId, useScene } from '@pascal-app/core'
import { create } from 'zustand'

/** Geometry failures describe the current rendering, never saved building data. */
export const useRoofGeometryStatus = create<{ failures: ReadonlyMap<AnyNodeId, string> }>(() => ({
  failures: new Map(),
}))

export function setRoofGeometryFailure(id: AnyNodeId, message: string | null) {
  const current = useRoofGeometryStatus.getState().failures
  if ((current.get(id) ?? null) === message) return
  const failures = new Map(current)
  if (message) failures.set(id, message)
  else failures.delete(id)
  useRoofGeometryStatus.setState({ failures })
}

useScene.subscribe((scene, previous) => {
  const failures = useRoofGeometryStatus.getState().failures
  for (const id of failures.keys()) {
    if (scene.hydrationId !== previous.hydrationId || !scene.nodes[id])
      setRoofGeometryFailure(id, null)
  }
})

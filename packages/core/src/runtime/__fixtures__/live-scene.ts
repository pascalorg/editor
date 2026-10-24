import { spatialGridManager } from '../../hooks/spatial-grid/spatial-grid-manager'
import { initSpatialGridSync } from '../../hooks/spatial-grid/spatial-grid-sync'
import { initSpaceDetectionSync } from '../../lib/space-detection'
import type { SceneSnapshot } from '../../store/history-control'
import useScene, { clearSceneHistory, getSceneDocument } from '../../store/use-scene'
import { initializeElevatorOpeningSync } from '../../systems/elevator/elevator-opening-system'
import { initializeRoofElevationSync } from '../../systems/roof/roof-elevation-system'
import { initializeStairOpeningSync } from '../../systems/stair/stair-opening-system'
import { loadCanonicalSnapshot } from '../scene-runtime'

/** The editor's document systems, as a mounted editor runs them (without a renderer). */
function mountDocumentSystems(): () => void {
  let spaces = {}
  const editor = {
    getState: () => ({
      spaces,
      setSpaces: (next: object) => {
        spaces = next
      },
    }),
  }
  const stops = [
    initSpatialGridSync(),
    initSpaceDetectionSync(useScene, editor),
    initializeStairOpeningSync(),
    initializeElevatorOpeningSync(),
    initializeRoofElevationSync(),
  ]
  return () => {
    for (const stop of stops.reverse()) stop()
  }
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

let unmount: (() => void) | null = null

/**
 * Opens `snapshot` in the editor's store with its document systems mounted, lets their load-time
 * normalisation settle, and returns the document they leave: the canonical snapshot of a scene as
 * the editor holds it. History starts empty there.
 */
export async function openLiveScene(snapshot: SceneSnapshot): Promise<SceneSnapshot> {
  closeLiveScene()
  loadCanonicalSnapshot(useScene, snapshot)
  clearSceneHistory()
  unmount = mountDocumentSystems()
  await settle()
  clearSceneHistory()
  return getSceneDocument()
}

export function closeLiveScene(): void {
  unmount?.()
  unmount = null
  spatialGridManager.clear()
}

export function snapshotOf(graph: { nodes: Record<string, unknown>; rootNodeIds: string[] }) {
  return {
    nodes: graph.nodes,
    rootNodeIds: graph.rootNodeIds,
    collections: {},
    materials: {},
    installedPlugins: [],
  } as unknown as SceneSnapshot
}

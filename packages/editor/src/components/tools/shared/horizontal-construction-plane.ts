import {
  type AnyNodeId,
  GROUND_SUPPORT_ID,
  type GridEvent,
  sceneRegistry,
  terrainSupportLift,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Vector3 } from 'three'
import { publishPlacementSurface } from '../../../lib/active-placement-surface'
import type { PointerSupportSurface } from './pointer-support-cap'

const SURFACE_UP = new Vector3(0, 1, 0)
const worldScratch = new Vector3()
const localScratch = new Vector3()
const surfacePointScratch = new Vector3()

export type HorizontalConstructionPlane = {
  /** Building-local Y used by the cursor and draft preview. */
  localY: number
  /** World Y used by the shared placement grid. */
  worldY: number
  /** Level-local base elevation used when the node is committed. */
  elevation: number | null
  /** Support source selected at the first click. */
  supportSlabId: string | null
  /** Optional scene node from which this frozen plane was derived. */
  sourceNodeId: AnyNodeId | null
}

export function resolveEventConstructionPlane(
  event: GridEvent,
  pointed: PointerSupportSurface | null,
): HorizontalConstructionPlane {
  if (pointed) {
    return {
      localY: pointed.localPoint?.[1] ?? event.localPosition[1],
      worldY: pointed.worldY,
      elevation: pointed.elevation,
      supportSlabId: pointed.supportSlabId,
      sourceNodeId: pointed.sourceNodeId,
    }
  }

  let elevation: number | null = null
  const levelId = useViewer.getState().selection.levelId
  const levelMesh = levelId ? sceneRegistry.nodes.get(levelId as AnyNodeId) : undefined
  if (levelMesh) {
    localScratch.set(event.position[0], event.position[1], event.position[2])
    levelMesh.worldToLocal(localScratch)
    elevation = localScratch.y
  }

  return {
    localY: event.localPosition[1],
    worldY: event.position[1],
    elevation,
    supportSlabId: null,
    sourceNodeId: null,
  }
}

export function resolveLevelConstructionPlane(): HorizontalConstructionPlane | null {
  const { buildingId, levelId } = useViewer.getState().selection
  if (!levelId) return null

  const levelMesh = sceneRegistry.nodes.get(levelId as AnyNodeId)
  worldScratch.set(0, 0, 0)
  if (levelMesh) levelMesh.localToWorld(worldScratch)

  const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : undefined
  localScratch.copy(worldScratch)
  if (buildingMesh) buildingMesh.worldToLocal(localScratch)

  return {
    localY: localScratch.y,
    worldY: worldScratch.y,
    elevation: 0,
    supportSlabId: null,
    sourceNodeId: null,
  }
}

export function resampleTerrainConstructionPlane(
  plane: HorizontalConstructionPlane,
  point: readonly [number, number],
): HorizontalConstructionPlane {
  if (plane.supportSlabId !== GROUND_SUPPORT_ID || plane.sourceNodeId) return plane

  const levelId = useViewer.getState().selection.levelId
  if (!levelId) return plane
  const elevation = terrainSupportLift(useScene.getState().nodes, levelId, point[0], point[1])
  if (elevation == null) return plane

  const levelMesh = sceneRegistry.nodes.get(levelId as AnyNodeId)
  worldScratch.set(point[0], elevation, point[1])
  if (levelMesh) levelMesh.localToWorld(worldScratch)

  const buildingId = useViewer.getState().selection.buildingId
  const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : undefined
  localScratch.copy(worldScratch)
  if (buildingMesh) buildingMesh.worldToLocal(localScratch)

  return {
    localY: localScratch.y,
    worldY: worldScratch.y,
    elevation,
    supportSlabId: GROUND_SUPPORT_ID,
    sourceNodeId: null,
  }
}

export function publishHorizontalConstructionPlane(
  event: GridEvent,
  plane: HorizontalConstructionPlane,
): void {
  publishPlacementSurface(
    surfacePointScratch.set(event.position[0], plane.worldY, event.position[2]),
    SURFACE_UP,
    'fixed-plane',
  )
}

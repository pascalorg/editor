import {
  type AnyNode,
  type EventSuffix,
  emitter,
  type GridEvent,
  movingFootprintAnchors,
  type NodeEvent,
  resolveAlignment,
  sceneRegistry,
  snapPointToGrid,
} from '@pascal-app/core'
import { Vector3 } from 'three'

export const FLOOR_PLACEMENT_ALIGNMENT_THRESHOLD_M = 0.08

export const FLOOR_PLACEMENT_CLICK_TRIGGER_KINDS = [
  'shelf',
  'item',
  'slab',
  'ceiling',
  'wall',
  'fence',
  'column',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
] as const

export type FloorPlacementClickTriggerEvent = GridEvent | NodeEvent<AnyNode>

type FloorPlacementAlignmentArgs = {
  node: AnyNode
  rawX: number
  rawZ: number
  gridStep: number
  candidates: Parameters<typeof resolveAlignment>[0]['candidates']
  showAlignment?: boolean
  applyAlignmentSnap?: boolean
  bypassGrid?: boolean
  rotationY?: number
}

const worldVector = new Vector3()

export function getLevelLocalSnappedPosition(
  levelId: string,
  event: FloorPlacementClickTriggerEvent,
  gridStep: number,
  bypassGrid = false,
): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) {
    const rawPoint = 'node' in event ? event.position : event.localPosition
    const [sx, sz] = bypassGrid
      ? [rawPoint[0], rawPoint[2]]
      : snapPointToGrid([rawPoint[0], rawPoint[2]], gridStep)
    return [sx, 0, sz]
  }

  worldVector.set(event.position[0], event.position[1], event.position[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVector)
  const [sx, sz] = bypassGrid
    ? [worldVector.x, worldVector.z]
    : snapPointToGrid([worldVector.x, worldVector.z], gridStep)
  return [sx, 0, sz]
}

export function resolveAlignedFloorPlacement({
  node,
  rawX,
  rawZ,
  gridStep,
  candidates,
  showAlignment = true,
  applyAlignmentSnap = true,
  bypassGrid = false,
  rotationY = 0,
}: FloorPlacementAlignmentArgs) {
  const [sx, sz] = bypassGrid ? [rawX, rawZ] : snapPointToGrid([rawX, rawZ], gridStep)
  let ax = sx
  let az = sz

  const result =
    showAlignment && candidates.length > 0
      ? resolveAlignment({
          moving: movingFootprintAnchors(node, sx, sz, rotationY),
          candidates,
          threshold: FLOOR_PLACEMENT_ALIGNMENT_THRESHOLD_M,
        })
      : null

  if (result?.snap && applyAlignmentSnap) {
    ax += result.snap.dx
    az += result.snap.dz
  }

  return {
    position: [ax, 0, az] as [number, number, number],
    guides: result?.guides ?? [],
  }
}

export function stopPlacementCommitPropagation(event: FloorPlacementClickTriggerEvent) {
  const native = (event as { nativeEvent?: unknown }).nativeEvent
  const nativeStopPropagation = (native as { stopPropagation?: () => void } | undefined)
    ?.stopPropagation
  if (typeof nativeStopPropagation === 'function') {
    nativeStopPropagation.call(native)
  }
  const direct = (event as { stopPropagation?: () => void }).stopPropagation
  if (typeof direct === 'function') direct.call(event)
}

export function subscribeFloorPlacementClicks(
  onClick: (event: FloorPlacementClickTriggerEvent) => void,
) {
  emitter.on('grid:click', onClick)
  type SuffixedKey<K extends string> = `${K}:${EventSuffix}`
  type ClickKey = SuffixedKey<(typeof FLOOR_PLACEMENT_CLICK_TRIGGER_KINDS)[number]>
  for (const kind of FLOOR_PLACEMENT_CLICK_TRIGGER_KINDS) {
    const key = `${kind}:click` as ClickKey
    emitter.on(key, onClick as never)
  }

  return () => {
    emitter.off('grid:click', onClick)
    for (const kind of FLOOR_PLACEMENT_CLICK_TRIGGER_KINDS) {
      const key = `${kind}:click` as ClickKey
      emitter.off(key, onClick as never)
    }
  }
}

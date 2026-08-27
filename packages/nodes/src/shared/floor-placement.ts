import {
  type AnyNode,
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

export type FloorPlacementClickTriggerEvent = GridEvent | NodeEvent<AnyNode>

export function isForcePlacementEvent(event: FloorPlacementClickTriggerEvent): boolean {
  return event.nativeEvent?.altKey === true
}

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
  if (!bypassGrid) {
    const [sx, sz] = snapPointToGrid([worldVector.x, worldVector.z], gridStep)
    worldVector.x = sx
    worldVector.z = sz
  }
  levelObject.worldToLocal(worldVector)
  return [worldVector.x, 0, worldVector.z]
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

// Node-surface clicks (wall/slab/…) are synthesized on pointerup; the
// browser's real `click` fires right after and would re-trigger the same
// placement through the canvas-level `grid:click` listener, which R3F
// stopPropagation cannot reach. Eat that one follow-up click.
function swallowFollowUpBrowserClick() {
  if (typeof window === 'undefined') return
  const swallow = (e: Event) => {
    e.stopPropagation()
    e.preventDefault()
  }
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 300)
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
  if ('node' in event) swallowFollowUpBrowserClick()
}

export function subscribeFloorPlacementClicks(
  onClick: (event: FloorPlacementClickTriggerEvent) => void,
) {
  emitter.on('grid:click', onClick)
  emitter.on('node:click', onClick)

  return () => {
    emitter.off('grid:click', onClick)
    emitter.off('node:click', onClick)
  }
}

export function subscribeFloorPlacementDoubleClicks(
  onDoubleClick: (event: FloorPlacementClickTriggerEvent) => void,
) {
  emitter.on('grid:double-click', onDoubleClick)
  emitter.on('node:double-click', onDoubleClick)

  return () => {
    emitter.off('grid:double-click', onDoubleClick)
    emitter.off('node:double-click', onDoubleClick)
  }
}

'use client'

import {
  type AnyNodeId,
  getStoredLevelHeight,
  type Point,
  type SlabNode,
  sceneRegistry,
  upperFloorHeightControl,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useRef, useState } from 'react'
import { type Group, Plane, Vector2, Vector3 } from 'three'
import {
  beginFootprintHeightPreview,
  footprintHeightMinimum,
  footprintHeightValue,
  THICK_FLOOR_HINT,
  thickFloorAdvice,
} from '../../lib/floor-footprints'
import { formatLinearMeasurement } from '../../lib/measurements'
import { runRoomHandleDrag } from '../../lib/room-handle-drag'
import useEditor, { isGridSnapActive } from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import { ElevationArrows, outlineCentroid, useHandleScale } from './room-handles'

export const FOOTPRINT_HEIGHT_DRAG_LABEL = 'footprint-height'

const PILL =
  'pointer-events-none flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur'
const NOTICE =
  'pointer-events-none max-w-72 rounded-full border border-border/60 bg-background/95 px-3 py-1 text-center text-muted-foreground text-xs shadow-md backdrop-blur-md'

/** The selected footprint floor (base plate), when it is the one selection in select mode. */
function useSelectedFootprint(): SlabNode | null {
  const selectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : null,
  )
  const enabled = useEditor((s) => s.mode === 'select')
  const idle = useInteractionScope(
    (s) =>
      s.scope.kind === 'idle' ||
      (s.scope.kind === 'handle-drag' && s.scope.handle === FOOTPRINT_HEIGHT_DRAG_LABEL),
  )
  const plate = useScene((s) => {
    const node = selectedId ? s.nodes[selectedId as AnyNodeId] : undefined
    return node?.type === 'slab' && node.plateRole === 'base' ? node : null
  })
  return enabled && idle ? plate : null
}

/**
 * A selected footprint floor's one control in 3D: the rooms' arrow–cube–arrow
 * at the middle of the footprint, dragging its height above the ground. The
 * building follows live; the release lands as one undo step. Refused heights
 * (core's conflict, e.g. an upper floor over another footprint) show beside it.
 */
export function FootprintHeightHandle() {
  const plate = useSelectedFootprint()
  const root = useRef<Group>(null)
  useFrame(() => {
    const level = plate?.parentId ? sceneRegistry.nodes.get(plate.parentId) : null
    if (!root.current) return
    root.current.visible = !!level
    if (level) {
      level.updateWorldMatrix(true, false)
      root.current.matrix.copy(level.matrixWorld)
    }
  })
  if (!plate) return null
  return (
    <group matrixAutoUpdate={false} ref={root}>
      <FootprintHeightArrows plate={plate} />
    </group>
  )
}

function FootprintHeightArrows({ plate }: { plate: SlabNode }) {
  const { camera, raycaster, gl } = useThree()
  const zoom = useHandleScale()
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const [hover, setHover] = useState(false)
  const [dragValue, setDragValue] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const upper = useScene((s) => upperFloorHeightControl(s.nodes, plate) !== null)
  const anchor: Point = outlineCentroid([plate.polygon as Point[], ...(plate.holes as Point[][])])
  const elevation = plate.elevation

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    suppressBoxSelectForPointer(event)
    const levelId = plate.parentId
    const level = levelId ? sceneRegistry.nodes.get(levelId) : null
    if (!(levelId && level)) return
    level.updateWorldMatrix(true, false)
    const toLocal = level.matrixWorld.clone().invert()
    const world = new Vector3(anchor[0], elevation, anchor[1]).applyMatrix4(level.matrixWorld)
    const normal = camera.getWorldPosition(new Vector3()).sub(world).setY(0)
    if (normal.lengthSq() === 0) return
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), world)
    const localY = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      raycaster.setFromCamera(
        new Vector2(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      )
      const hit = raycaster.ray.intersectPlane(plane, new Vector3())
      return hit ? hit.applyMatrix4(toLocal).y : null
    }
    const startY = localY(event.nativeEvent.clientX, event.nativeEvent.clientY)
    if (startY === null) return
    const nodes = () => useScene.getState().nodes
    // Heights are read against the plate as the drag found it (the preview moves it).
    const startNodes = nodes()
    const start = footprintHeightValue(startNodes, plate)
    const min = footprintHeightMinimum(startNodes, plate)
    const levelNode = nodes()[levelId as AnyNodeId]
    const max = levelNode?.type === 'level' ? getStoredLevelHeight(levelNode) - 0.5 : 3
    const step = isGridSnapActive() ? 0.05 : 0.01
    let value = start
    const preview = beginFootprintHeightPreview(plate.id)
    setNotice(null)
    setDragValue(start)
    runRoomHandleDrag({
      label: FOOTPRINT_HEIGHT_DRAG_LABEL,
      nodeId: plate.id,
      levelId,
      requires: [plate.id],
      sample: (x, y) => {
        const pointerY = localY(x, y)
        if (pointerY === null) return null
        const raw = start + pointerY - startY
        return Math.max(min, Math.min(max, Math.round(raw / step) * step))
      },
      onValue: (next) => {
        if (Math.abs(next - value) < 1e-6) return
        // Live: the building follows, outside history until the release.
        const refused = preview.preview(next)
        setNotice(refused)
        setHint(thickFloorAdvice(startNodes, plate, next) ? THICK_FLOOR_HINT : null)
        if (!refused) value = next
        setDragValue(next)
      },
      onCommit: () => {
        setNotice(preview.commit(value))
        setDragValue(null)
        setHint(null)
      },
      onCancel: () => {
        preview.cancel()
        setDragValue(null)
        setHint(null)
      },
    })
  }

  const shown = dragValue ?? null
  return (
    <group>
      <ElevationArrows
        anchor={[anchor[0], elevation, anchor[1]]}
        hover={hover || shown !== null}
        onHoverChange={setHover}
        onPointerDown={onPointerDown}
        zoom={zoom}
      />
      {(shown !== null || notice || hint) && (
        <Html
          center
          position={[anchor[0], elevation + 0.75 * zoom, anchor[1]]}
          zIndexRange={[25, 0]}
        >
          <div className="flex flex-col items-center gap-1" data-footprint-height-pill>
            {shown !== null && (
              <div className={PILL}>
                <span className="font-medium text-foreground">
                  {upper ? 'Floor top' : 'Foundation'}
                </span>
                <span className="text-muted-foreground">
                  {formatLinearMeasurement(shown, unit, metricNotation)}
                </span>
              </div>
            )}
            {(notice ?? hint) && (
              <div className={NOTICE} data-footprint-height-notice role="status">
                {notice ?? hint}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

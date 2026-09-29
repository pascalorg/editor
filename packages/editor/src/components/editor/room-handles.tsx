'use client'

import {
  clampRoomFloorHandle,
  type Point,
  roomDrawnFloor,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry,
  type Camera,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  OrthographicCamera,
  Path,
  Plane,
  type Raycaster,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../lib/constants'
import {
  clearStructuralElevationGuide,
  publishStructuralElevationGuide,
  resolveStructuralElevationSnap,
} from '../../lib/elevation-guides'
import { formatLinearMeasurement, MEASUREMENT_ACTIVE_COLOR } from '../../lib/measurements'
import { commitRoomFloorElevation, roomFloorBase } from '../../lib/room-construction-commands'
import {
  type MezzanineEdgeHandle,
  mezzanineEdgeHandles,
  mezzanineElevationBounds,
  ownFloorElevationBounds,
  ROOM_ELEVATION_DRAG_LABEL,
  type RoomHandleDrag,
  roomFloorElevation,
  roomPushHandles,
  runMezzanineEdgeDrag,
  runRoomHandleDrag,
  useRoomHandleDrag,
} from '../../lib/room-handle-drag'
import type { RoomDimension } from '../../lib/room-push-dimensions'
import type { RoomSelectionRecord } from '../../lib/room-selection'
import useEditor, { isGridSnapActive, isMagneticSnapActive } from '../../store/use-editor'
import { suppressBoxSelectForPointer } from '../tools/select/box-select-state'
import { ARROW_COLOR, ARROW_SCALE, HandleArrow } from './handles/handle-arrow'
import { resolveResizeSnapValue } from './handles/resize-snap'
import { formatMeasurement } from './measurement-pill'
import { WallPushArrow } from './wall-push-arrow'

const PILL =
  'pointer-events-none flex items-center gap-2 whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur'

const noRaycast = () => {}

/** Plan-space centroid of the room's reference outline (the elevation handle's spot). */
export function outlineCentroid(rings: Point[][]): Point {
  const outer = rings[0] ?? []
  let a = 0,
    x = 0,
    z = 0
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i]!,
      q = outer[(i + 1) % outer.length]!
    const c = p[0] * q[1] - q[0] * p[1]
    a += c
    x += (p[0] + q[0]) * c
    z += (p[1] + q[1]) * c
  }
  if (Math.abs(a) < 1e-9)
    return outer.length
      ? [
          outer.reduce((s, p) => s + p[0], 0) / outer.length,
          outer.reduce((s, p) => s + p[1], 0) / outer.length,
        ]
      : [0, 0]
  return [x / (3 * a), z / (3 * a)]
}

type DragPlumbing = {
  camera: Camera
  raycaster: Raycaster
  dom: HTMLCanvasElement
  levelId: string
}

function pointerRay({ camera, raycaster, dom }: DragPlumbing, clientX: number, clientY: number) {
  const rect = dom.getBoundingClientRect()
  raycaster.setFromCamera(
    new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    ),
    camera,
  )
  return raycaster.ray
}

export function useHandleScale() {
  const { camera } = useThree()
  return camera instanceof OrthographicCamera ? 1 / camera.zoom : 1
}

function ElevationHandle({
  room,
  anchor,
  elevation,
}: {
  room: RoomSelectionRecord
  anchor: Point
  elevation: number
}) {
  const [hover, setHover] = useState(false)
  const { camera, raycaster, gl } = useThree()
  const zoom = useHandleScale()
  const levelId = room.key.levelId
  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    suppressBoxSelectForPointer(event)
    const level = sceneRegistry.nodes.get(levelId)
    if (!level) return
    level.updateWorldMatrix(true, false)
    const toLocal = level.matrixWorld.clone().invert()
    const world = new Vector3(anchor[0], elevation, anchor[1]).applyMatrix4(level.matrixWorld)
    const normal = camera.getWorldPosition(new Vector3()).sub(world).setY(0)
    if (normal.lengthSq() === 0) return
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), world)
    const plumbing = { camera, raycaster, dom: gl.domElement, levelId }
    const localY = (clientX: number, clientY: number) => {
      const hit = pointerRay(plumbing, clientX, clientY).intersectPlane(plane, new Vector3())
      return hit ? hit.applyMatrix4(toLocal).y : null
    }
    const startY = localY(event.nativeEvent.clientX, event.nativeEvent.clientY)
    if (startY === null) return
    const source = { nodeId: room.zoneId, levelId, anchor }
    const outline = [room.polygon as Point[], ...(room.holes as Point[][])]
    let value = elevation
    const publish = (next: number) =>
      useRoomHandleDrag.setState({
        drag: {
          kind: 'elevation',
          zoneId: room.zoneId,
          levelId,
          anchor,
          outline,
          from: elevation,
          value: next,
        },
      })
    publish(value)
    runRoomHandleDrag({
      label: ROOM_ELEVATION_DRAG_LABEL,
      nodeId: room.zoneId,
      zoneId: room.zoneId,
      levelId,
      requires: [room.zoneId],
      sample: (x, y) => {
        const pointerY = localY(x, y)
        if (pointerY === null) return null
        const nodes = useScene.getState().nodes
        const snapped = resolveResizeSnapValue({
          rawValue: elevation + pointerY - startY,
          gridSnapEnabled: true,
          gridSnapActive: isGridSnapActive(),
          gridSnapStep: Math.min(useEditor.getState().gridSnapStep, 0.05),
          magneticSnapActive: isMagneticSnapActive(),
          magneticSnap: (next) => resolveStructuralElevationSnap(source, next, nodes),
        })
        // A mezzanine stays inside the heights core accepts for it; a room on
        // its own floor, inside its plate's Floor height range.
        const bounds =
          mezzanineElevationBounds(nodes, room.zoneId) ??
          ownFloorElevationBounds(nodes, room.zoneId)
        return bounds
          ? Math.min(bounds.max, Math.max(bounds.min, snapped))
          : clampRoomFloorHandle(nodes, room.zoneId, snapped)
      },
      onValue: (next) => {
        value = next
        publishStructuralElevationGuide(source, next, useScene.getState().nodes)
        publish(next)
      },
      onCommit: () => {
        clearStructuralElevationGuide(room.zoneId)
        if (Math.abs(value - elevation) <= 1e-6) return
        const { unit, metricNotation } = useViewer.getState()
        commitRoomFloorElevation(room.zoneId, value, (meters) =>
          formatLinearMeasurement(meters, unit, metricNotation),
        )
      },
      onCancel: () => clearStructuralElevationGuide(room.zoneId),
    })
  }
  return (
    <ElevationArrows
      anchor={[anchor[0], elevation, anchor[1]]}
      hover={hover}
      onHoverChange={setHover}
      onPointerDown={onPointerDown}
      zoom={zoom}
    />
  )
}

/**
 * Centre-to-centre distance (m, before zoom) from the floor cube to each
 * chevron: the cube's half size (0.08) + a chevron's half length along its
 * axis (0.14 at ARROW_SCALE) + a clear gap wide enough to stay open when a
 * camera looking down foreshortens the vertical, so arrow / gap / cube / gap /
 * arrow never touch.
 */
const ELEVATION_ARROW_GAP = 0.4
// The flat chevron tipped to point along ±Y: the duct riser pair's rotation.
const UP_TILT: [number, number, number] = [0, Math.PI / 2, Math.PI / 2]
const DOWN_TILT: [number, number, number] = [0, Math.PI / 2, -Math.PI / 2]

/**
 * The floor's elevation handle: a cube between an up and a down chevron (the
 * two-way look of the riser handles). The three share one hover and any of
 * them starts the same vertical drag. The chevrons turn to face the camera so
 * the plates never go edge-on.
 */
export function ElevationArrows({
  anchor,
  hover,
  zoom,
  onHoverChange,
  onPointerDown,
}: {
  anchor: [number, number, number]
  hover: boolean
  zoom: number
  onHoverChange: (hover: boolean) => void
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void
}) {
  const group = useRef<Group>(null)
  const { camera } = useThree()
  const cameraPosition = useMemo(() => new Vector3(), [])
  useFrame(() => {
    const root = group.current
    if (!root) return
    const local = root.parent
      ? root.parent.worldToLocal(camera.getWorldPosition(cameraPosition))
      : camera.getWorldPosition(cameraPosition)
    root.rotation.y = Math.atan2(local.x - anchor[0], local.z - anchor[2])
  })
  // Moving between the cube and a chevron must not drop the shared hover.
  const hovered = useRef(new Set<string>())
  const hoverPart = (part: string) => (next: boolean) => {
    if (next) hovered.current.add(part)
    else hovered.current.delete(part)
    onHoverChange(hovered.current.size > 0)
  }
  const gap = ELEVATION_ARROW_GAP * zoom
  const baseScale = zoom * ARROW_SCALE
  return (
    <group position={anchor} ref={group}>
      <HandleArrow
        cursor="ns-resize"
        hover={hover}
        onHoverChange={hoverPart('cube')}
        onPointerDown={onPointerDown}
        placement={{ position: [0, 0, 0], baseScale: zoom }}
        shape="tracker"
      />
      {[
        { key: 'up', y: gap, tilt: UP_TILT },
        { key: 'down', y: -gap, tilt: DOWN_TILT },
      ].map((arrow) => (
        <HandleArrow
          cursor="ns-resize"
          hover={hover}
          indicatorRotation={arrow.tilt}
          key={arrow.key}
          onHoverChange={hoverPart(arrow.key)}
          onPointerDown={onPointerDown}
          placement={{ position: [0, arrow.y, 0], baseScale }}
          shape="chevron"
          thin
        />
      ))}
    </group>
  )
}

/**
 * A selected room's 3D handles: the floor elevation tracker at its centroid
 * and one push/pull arrow outside every boundary wall. Rendered in the level
 * frame by `RoomControls3D`, only while nothing else is in progress.
 */
export function RoomHandles3D({ room }: { room: RoomSelectionRecord }) {
  const nodes = useScene((s) => s.nodes)
  const elevation = roomFloorElevation(nodes, room.zoneId)
  // A drawn-slab floor's height is the slab's: the room has no height to drag.
  const drawnFloor = roomDrawnFloor(nodes, room.zoneId) !== null
  const anchor = useMemo(
    () => outlineCentroid([room.polygon as Point[], ...(room.holes as Point[][])]),
    [room.polygon, room.holes],
  )
  const handles = useMemo(() => roomPushHandles(nodes, room.spans), [nodes, room.spans])
  // A mezzanine has no walls: its plate edges carry the push arrows instead.
  const edges = useMemo(
    () => (room.mezzanine ? mezzanineEdgeHandles(nodes, room.zoneId) : []),
    [nodes, room.mezzanine, room.zoneId],
  )
  return (
    <group>
      {!drawnFloor && <ElevationHandle anchor={anchor} elevation={elevation} room={room} />}
      {edges.map((handle) => (
        <MezzanineEdgeArrow
          handle={handle}
          key={handle.key}
          levelId={room.key.levelId}
          zoneId={room.zoneId}
        />
      ))}
      {handles.map((handle) => (
        <WallPushArrow
          handle={handle}
          key={handle.key}
          levelId={room.key.levelId}
          zoneId={room.zoneId}
        />
      ))}
    </group>
  )
}

/** The drag in flight: the value pill, and for elevation the floor at its new height. */
type MezzanineEdgeDrag = Extract<RoomHandleDrag, { kind: 'mezzanine-edge' }>

const edgeFill = (color: string) =>
  new MeshBasicNodeMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    opacity: 0.25,
    side: DoubleSide,
    transparent: true,
  })
const mezzanineEdgeValidFill = edgeFill(ARROW_COLOR)
const mezzanineEdgeRefusedFill = edgeFill('#ef4444')

/** The mezzanine outline an edge push would leave, at plate height, red with its label when refused. */
function MezzanineEdgeDragPreview({ drag }: { drag: MezzanineEdgeDrag }) {
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const geometry = useMemo(() => {
    if (drag.outline.length < 3) return null
    const shape = new Shape(drag.outline.map(([x, z]) => new Vector2(x, z)))
    return new ShapeGeometry(shape).rotateX(Math.PI / 2)
  }, [drag.outline])
  useEffect(() => () => geometry?.dispose(), [geometry])
  const at: Point = [
    drag.anchor[0] + drag.outward[0] * drag.distance,
    drag.anchor[1] + drag.outward[1] * drag.distance,
  ]
  const magnitude = formatMeasurement(Math.abs(drag.distance), unit, metricNotation)
  const signed = `${drag.distance > 0 ? '+' : drag.distance < 0 ? '−' : ''}${magnitude}`
  return (
    <group>
      <RoomDimensionLines3D dimensions={drag.dimensions} />
      {geometry && (
        <mesh
          geometry={geometry}
          layers={EDITOR_LAYER}
          material={drag.message ? mezzanineEdgeRefusedFill : mezzanineEdgeValidFill}
          position-y={drag.elevation + 0.02}
          raycast={noRaycast}
          renderOrder={100}
        />
      )}
      <Html center position={[at[0], drag.elevation + 0.45, at[1]]} zIndexRange={[25, 0]}>
        <div className={PILL}>
          {drag.message ? (
            <span className="font-medium text-red-500">{drag.message}</span>
          ) : (
            <span className="font-medium text-foreground">{signed}</span>
          )}
        </div>
      </Html>
    </group>
  )
}

const dimensionLine = new LineBasicNodeMaterial({
  color: MEASUREMENT_ACTIVE_COLOR,
  depthTest: false,
  depthWrite: false,
})
/** Half length (m) of the cross tick closing each end of a room dimension. */
const DIMENSION_TICK = 0.1
const DIMENSION_LABEL_OUTLINE = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]
  .map(([x, y]) => `${x}px ${y}px 0 ${MEASUREMENT_ACTIVE_COLOR}`)
  .join(', ')

/**
 * A push's live room widths: one measurement-tool line per dimension, just
 * above its room's floor and drawn over the walls, closed by cross ticks, with
 * the measurement's outlined label — apart from the moved-distance pill.
 */
function RoomDimensionLines3D({ dimensions }: { dimensions: RoomDimension[] }) {
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const geometry = useMemo(() => {
    if (!dimensions.length) return null
    const positions: number[] = []
    for (const { from, to, elevation: y } of dimensions) {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1
      const tx = (-(to[1] - from[1]) / length) * DIMENSION_TICK
      const tz = ((to[0] - from[0]) / length) * DIMENSION_TICK
      positions.push(from[0], y, from[1], to[0], y, to[1])
      for (const [x, z] of [from, to]) positions.push(x - tx, y, z - tz, x + tx, y, z + tz)
    }
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))
  }, [dimensions])
  useEffect(() => () => geometry?.dispose(), [geometry])
  if (!geometry) return null
  return (
    <group>
      <lineSegments
        frustumCulled={false}
        geometry={geometry}
        layers={EDITOR_LAYER}
        material={dimensionLine}
        raycast={noRaycast}
        renderOrder={1001}
      />
      {dimensions.map((dimension) => (
        <Html
          center
          key={dimension.key}
          position={[
            (dimension.from[0] + dimension.to[0]) / 2,
            dimension.elevation,
            (dimension.from[1] + dimension.to[1]) / 2,
          ]}
          style={{ pointerEvents: 'none' }}
          zIndexRange={[20, 0]}
        >
          <div
            className="-translate-y-3 whitespace-nowrap font-medium text-base text-white"
            data-room-dimension-3d
            style={{ textShadow: DIMENSION_LABEL_OUTLINE }}
          >
            {formatMeasurement(dimension.distance, unit, metricNotation)}
          </div>
        </Html>
      ))}
    </group>
  )
}

/** A mezzanine edge's push arrow: the room push arrow's look, driving `setZoneEdges`. */
function MezzanineEdgeArrow({
  handle,
  zoneId,
  levelId,
}: {
  handle: MezzanineEdgeHandle
  zoneId: string
  levelId: string
}) {
  const [hover, setHover] = useState(false)
  const { camera, raycaster, gl } = useThree()
  const zoom = useHandleScale()
  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    suppressBoxSelectForPointer(event)
    const level = sceneRegistry.nodes.get(levelId)
    if (!level) return
    level.updateWorldMatrix(true, false)
    const toLocal = level.matrixWorld.clone().invert()
    const origin = new Vector3(handle.position[0], handle.height, handle.position[1]).applyMatrix4(
      level.matrixWorld,
    )
    const up = new Vector3(0, 1, 0).transformDirection(level.matrixWorld)
    const plane = new Plane().setFromNormalAndCoplanarPoint(up, origin)
    const plumbing = { camera, raycaster, dom: gl.domElement, levelId }
    const along = (clientX: number, clientY: number) => {
      const hit = pointerRay(plumbing, clientX, clientY).intersectPlane(plane, new Vector3())
      if (!hit) return null
      const local = hit.applyMatrix4(toLocal)
      return (
        (local.x - handle.position[0]) * handle.outward[0] +
        (local.z - handle.position[1]) * handle.outward[1]
      )
    }
    const from = along(event.nativeEvent.clientX, event.nativeEvent.clientY)
    if (from === null) return
    runMezzanineEdgeDrag({ handle, zoneId, levelId, from, along })
  }
  return (
    <HandleArrow
      cursor="grab"
      hover={hover}
      onHoverChange={setHover}
      onPointerDown={onPointerDown}
      placement={{
        position: [handle.position[0], handle.height, handle.position[1]],
        rotation: [0, Math.atan2(-handle.outward[1], handle.outward[0]), 0],
        baseScale: zoom * ARROW_SCALE,
      }}
      shape="chevron"
      thin
    />
  )
}

export function RoomHandleDragPreview3D() {
  const drag = useRoomHandleDrag((s) => s.drag)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const elevation = drag?.kind === 'elevation' ? drag : null
  const geometry = useMemo(() => {
    if (!elevation) return null
    const [outer, ...holes] = elevation.outline
    if (!outer?.length) return null
    const ring = <T extends Shape | Path>(target: T, points: Point[]) => {
      for (const [i, [x, z]] of points.entries()) {
        if (i) target.lineTo(x, z)
        else target.moveTo(x, z)
      }
      target.closePath()
      return target
    }
    const shape = ring(new Shape(), outer)
    shape.holes = holes.map((points) => ring(new Path(), points))
    const [ax, az] = elevation.anchor
    return {
      floor: new ShapeGeometry(shape).rotateX(Math.PI / 2),
      leader: new BufferGeometry().setAttribute(
        'position',
        new Float32BufferAttribute([ax, elevation.from, az, ax, elevation.value, az], 3),
      ),
    }
  }, [elevation])
  const materials = useMemo(
    () => ({
      line: new LineBasicNodeMaterial({ color: ARROW_COLOR, depthTest: false, depthWrite: false }),
      fill: new MeshBasicNodeMaterial({
        color: ARROW_COLOR,
        depthTest: false,
        depthWrite: false,
        opacity: 0.2,
        side: DoubleSide,
        transparent: true,
      }),
    }),
    [],
  )
  useEffect(
    () => () => {
      geometry?.floor.dispose()
      geometry?.leader.dispose()
    },
    [geometry],
  )
  useEffect(
    () => () => {
      materials.line.dispose()
      materials.fill.dispose()
    },
    [materials],
  )
  if (!drag) return null
  if (drag.kind === 'mezzanine-edge') return <MezzanineEdgeDragPreview drag={drag} />
  if (drag.kind === 'elevation') {
    const [ax, az] = drag.anchor
    return (
      <group>
        {geometry && (
          <>
            <mesh
              geometry={geometry.floor}
              layers={EDITOR_LAYER}
              material={materials.fill}
              position-y={drag.value + 0.01}
              raycast={noRaycast}
              renderOrder={100}
            />
            <lineSegments
              geometry={geometry.leader}
              layers={EDITOR_LAYER}
              material={materials.line}
              raycast={noRaycast}
              renderOrder={1001}
            />
          </>
        )}
        <HandleArrow
          cursor="ns-resize"
          hover
          onHoverChange={() => {}}
          onPointerDown={() => {}}
          placement={{ position: [ax, drag.value, az], baseScale: 1 }}
          shape="tracker"
        />
        <Html center position={[ax, drag.value + 0.35, az]} zIndexRange={[25, 0]}>
          <div className={PILL}>
            <span className="font-medium text-foreground">Floor</span>
            <span className="text-muted-foreground">
              {formatMeasurement(
                drag.value - roomFloorBase(useScene.getState().nodes, drag.zoneId),
                unit,
                metricNotation,
              )}
            </span>
          </div>
        </Html>
      </group>
    )
  }
  const at: Point = [
    drag.anchor[0] + drag.outward[0] * drag.distance,
    drag.anchor[1] + drag.outward[1] * drag.distance,
  ]
  const magnitude = formatMeasurement(Math.abs(drag.distance), unit, metricNotation)
  const signed = `${drag.distance > 0 ? '+' : drag.distance < 0 ? '−' : ''}${magnitude}`
  return (
    <group>
      <RoomDimensionLines3D dimensions={drag.dimensions} />
      {drag.ghosts.map((ghost, index) => {
        const length = Math.hypot(ghost.end[0] - ghost.start[0], ghost.end[1] - ghost.start[1])
        if (length < 1e-3) return null
        return (
          <mesh
            key={index}
            layers={EDITOR_LAYER}
            material={materials.fill}
            position={[
              (ghost.start[0] + ghost.end[0]) / 2,
              drag.base + ghost.height / 2,
              (ghost.start[1] + ghost.end[1]) / 2,
            ]}
            raycast={noRaycast}
            renderOrder={99}
            rotation={[
              0,
              -Math.atan2(ghost.end[1] - ghost.start[1], ghost.end[0] - ghost.start[0]),
              0,
            ]}
          >
            <boxGeometry args={[length, ghost.height, ghost.thickness]} />
          </mesh>
        )
      })}
      <Html center position={[at[0], drag.height + 0.45, at[1]]} zIndexRange={[25, 0]}>
        <div className={PILL}>
          {drag.message ? (
            <span className="font-medium text-red-500">{drag.message}</span>
          ) : (
            <span className="font-medium text-foreground">{signed}</span>
          )}
        </div>
      </Html>
    </group>
  )
}

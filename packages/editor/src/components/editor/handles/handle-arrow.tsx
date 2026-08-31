'use client'

import { type Cursor, emitter } from '@pascal-app/core'
import type { ThreeEvent } from '@react-three/fiber'
import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  type Group,
  type Intersection,
  Mesh,
  type Raycaster,
  Shape,
  TorusGeometry,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'
import useEditor from '../../../store/use-editor'

// While a press-drag move is in flight (`placementDragMode`), the move tool
// owns the pointer and the handle rig rides the moving node — so a handle hit
// area would sit under the cursor and starve the tool's surface raycast
// (`wall:move` for openings, `grid:move` for free movers), freezing the drag.
// Make every handle hit area inert for the duration; the indicator mesh still
// renders (it's already NO_RAYCAST + depthTest off) so the grip stays visible.
function hitAreaRaycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
  if (useEditor.getState().placementDragMode) return
  Mesh.prototype.raycast.call(this, raycaster, intersects)
}

export const ARROW_SCALE = 0.65
export const ARROW_COLOR = '#8381ed'
export const ARROW_HOVER_COLOR = '#a5b4fc'
export const NO_RAYCAST = () => null
export const HIT_AREA_MARGIN = 0.035

const HIT_AREA_RENDER_ORDER = 1011
const HIT_AREA_THICKNESS = 0.08
const CHEVRON_MIN_X = -0.2
const CHEVRON_MAX_X = 0.22
const CHEVRON_HALF_WIDTH = 0.12
const CHEVRON_NOTCH_X = -0.04
const CHEVRON_SHAFT_HALF_WIDTH = 0.035
const CHEVRON_DEPTH = 0.08
const CHEVRON_BEVEL_THICKNESS = 0.035
const CHEVRON_BEVEL_SIZE = 0.03
const CHEVRON_BEVEL_SEGMENTS = 10
// Slimmer extrude profile matching the legacy wall side handles
// (`wall-move-side-handles.tsx`) — opt-in via the `thin` prop so the chunkier
// default is preserved for every other handle that uses the shared chevron.
const CHEVRON_THIN_DEPTH = 0.045
const CHEVRON_THIN_BEVEL_THICKNESS = 0.018
const CHEVRON_THIN_BEVEL_SIZE = 0.02
const CHEVRON_THIN_BEVEL_SEGMENTS = 8
const MOVE_CROSS_HALF_LENGTH = 0.36
const MOVE_CROSS_SHAFT_HALF_WIDTH = 0.03
const MOVE_CROSS_HEAD_HALF_WIDTH = 0.12
const MOVE_CROSS_HEAD_INSET = 0.2
const MOVE_CROSS_DEPTH = 0.06
const MOVE_CROSS_BEVEL_THICKNESS = 0.018
const MOVE_CROSS_BEVEL_SIZE = 0.012
const MOVE_CROSS_BEVEL_SEGMENTS = 6
const ROTATE_HANDLE_RADIUS = 0.2
const ROTATE_HANDLE_HALF_SWEEP = Math.PI / 3
const ROTATE_RIBBON_HALF_WIDTH = 0.02
const ROTATE_HEAD_HALF_WIDTH = 0.045
const TRACKER_CUBE_SIZE = 0.16
export const CORNER_HEX_RADIUS = 0.11

export type HandleArrowShape = 'chevron' | 'cross' | 'curved-arrow' | 'tracker' | 'corner-picker'
export type HandleArrowInputShape = HandleArrowShape | 'arrow' | 'move-cross'

export type HandleArrowPlacement = {
  position: readonly [number, number, number]
  rotation?: readonly [number, number, number]
  baseScale: number
}

type PointerHandler = (event: ThreeEvent<PointerEvent>) => void

export type HandleArrowProps = {
  shape: HandleArrowInputShape
  placement: HandleArrowPlacement
  hover: boolean
  cursor: Cursor
  onHoverChange: (hovered: boolean) => void
  onPointerDown: PointerHandler
  activeCursor?: Cursor
  children?: ReactNode
  hoverScale?: number
  indicatorRotation?: readonly [number, number, number]
  onPointerEnter?: PointerHandler
  onPointerLeave?: PointerHandler
  // Extrude the slimmer wall-handle chevron profile (chevron shape only).
  thin?: boolean
  // Render the corner-picker disc as a smooth circle instead of a hexagon.
  round?: boolean
}

function normalizeHandleArrowShape(shape: HandleArrowInputShape, cursor: Cursor): HandleArrowShape {
  if (shape === 'arrow') return 'chevron'
  if (shape === 'move-cross') return 'cross'
  if (shape === 'chevron' && cursor === 'move') return 'cross'
  return shape
}

// Two-headed curved-arrow silhouette for whole-node rotation handles
// (today: the elevator's corner rotate gizmo). Symmetric arc centred on
// +X with sweeps to +/-halfSweep, arrowhead wings + tangentially-extended
// tips at each end. Drawn in 2D then extruded and rotated to lie in the
// XZ plane - same final-orientation contract as the chevron, so the
// outer rotation Y and inner-rotation chain in the renderer are reused
// unchanged.
export function createRotateArrowHandleGeometry() {
  const R = 0.2
  const ribbonHalfWidth = 0.02
  const halfSweep = Math.PI / 3
  const headHalfWidth = 0.045
  const headOvershoot = 0.075
  const rIn = R - ribbonHalfWidth
  const rOut = R + ribbonHalfWidth
  const a1 = halfSweep
  const a2 = -halfSweep

  const tip1: [number, number] = [
    R * Math.cos(a1) - headOvershoot * Math.sin(a1),
    R * Math.sin(a1) + headOvershoot * Math.cos(a1),
  ]
  const tip2: [number, number] = [
    R * Math.cos(a2) + headOvershoot * Math.sin(a2),
    R * Math.sin(a2) - headOvershoot * Math.cos(a2),
  ]
  const innerWing1: [number, number] = [
    (rIn - headHalfWidth) * Math.cos(a1),
    (rIn - headHalfWidth) * Math.sin(a1),
  ]
  const outerWing1: [number, number] = [
    (rOut + headHalfWidth) * Math.cos(a1),
    (rOut + headHalfWidth) * Math.sin(a1),
  ]
  const innerWing2: [number, number] = [
    (rIn - headHalfWidth) * Math.cos(a2),
    (rIn - headHalfWidth) * Math.sin(a2),
  ]
  const outerWing2: [number, number] = [
    (rOut + headHalfWidth) * Math.cos(a2),
    (rOut + headHalfWidth) * Math.sin(a2),
  ]
  const innerCorner1: [number, number] = [rIn * Math.cos(a1), rIn * Math.sin(a1)]
  const outerCorner1: [number, number] = [rOut * Math.cos(a1), rOut * Math.sin(a1)]
  const innerCorner2: [number, number] = [rIn * Math.cos(a2), rIn * Math.sin(a2)]
  const outerCorner2: [number, number] = [rOut * Math.cos(a2), rOut * Math.sin(a2)]

  const shape = new Shape()
  shape.moveTo(innerCorner1[0], innerCorner1[1])
  shape.lineTo(innerWing1[0], innerWing1[1])
  shape.lineTo(tip1[0], tip1[1])
  shape.lineTo(outerWing1[0], outerWing1[1])
  shape.lineTo(outerCorner1[0], outerCorner1[1])
  shape.absarc(0, 0, rOut, a1, a2, true)
  shape.lineTo(outerWing2[0], outerWing2[1])
  shape.lineTo(tip2[0], tip2[1])
  shape.lineTo(innerWing2[0], innerWing2[1])
  shape.lineTo(innerCorner2[0], innerCorner2[1])
  shape.absarc(0, 0, rIn, a2, a1, false)
  shape.closePath()

  const geometry = new ExtrudeGeometry(shape, {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.012,
    bevelOffset: 0,
    bevelSegments: 6,
    curveSegments: 24,
    steps: 1,
  })
  geometry.translate(0, 0, -0.03)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

// Reused chevron+shaft silhouette. The chevron points along +X by default;
// callers rotate it around Y for Z-axis handles and into a vertical frame for
// Y-axis handles. `thin` extrudes the slimmer wall-handle profile.
export function createArrowHandleGeometry(thin = false) {
  const depth = thin ? CHEVRON_THIN_DEPTH : CHEVRON_DEPTH
  const shape = new Shape()
  shape.moveTo(CHEVRON_MAX_X, 0)
  shape.lineTo(CHEVRON_NOTCH_X, CHEVRON_HALF_WIDTH)
  shape.lineTo(CHEVRON_NOTCH_X, CHEVRON_SHAFT_HALF_WIDTH)
  shape.lineTo(CHEVRON_MIN_X, CHEVRON_SHAFT_HALF_WIDTH)
  shape.lineTo(CHEVRON_MIN_X, -CHEVRON_SHAFT_HALF_WIDTH)
  shape.lineTo(CHEVRON_NOTCH_X, -CHEVRON_SHAFT_HALF_WIDTH)
  shape.lineTo(CHEVRON_NOTCH_X, -CHEVRON_HALF_WIDTH)
  shape.lineTo(CHEVRON_MAX_X, 0)
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: thin ? CHEVRON_THIN_BEVEL_THICKNESS : CHEVRON_BEVEL_THICKNESS,
    bevelSize: thin ? CHEVRON_THIN_BEVEL_SIZE : CHEVRON_BEVEL_SIZE,
    bevelOffset: 0,
    bevelSegments: thin ? CHEVRON_THIN_BEVEL_SEGMENTS : CHEVRON_BEVEL_SEGMENTS,
    curveSegments: 16,
    steps: 1,
  })
  geometry.translate(0, 0, -depth / 2)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function createDoubleArrowShape(): Shape {
  const shape = new Shape()
  shape.moveTo(MOVE_CROSS_HALF_LENGTH, 0)
  shape.lineTo(MOVE_CROSS_HEAD_INSET, MOVE_CROSS_HEAD_HALF_WIDTH)
  shape.lineTo(MOVE_CROSS_HEAD_INSET, MOVE_CROSS_SHAFT_HALF_WIDTH)
  shape.lineTo(-MOVE_CROSS_HEAD_INSET, MOVE_CROSS_SHAFT_HALF_WIDTH)
  shape.lineTo(-MOVE_CROSS_HEAD_INSET, MOVE_CROSS_HEAD_HALF_WIDTH)
  shape.lineTo(-MOVE_CROSS_HALF_LENGTH, 0)
  shape.lineTo(-MOVE_CROSS_HEAD_INSET, -MOVE_CROSS_HEAD_HALF_WIDTH)
  shape.lineTo(-MOVE_CROSS_HEAD_INSET, -MOVE_CROSS_SHAFT_HALF_WIDTH)
  shape.lineTo(MOVE_CROSS_HEAD_INSET, -MOVE_CROSS_SHAFT_HALF_WIDTH)
  shape.lineTo(MOVE_CROSS_HEAD_INSET, -MOVE_CROSS_HEAD_HALF_WIDTH)
  shape.closePath()
  return shape
}

export function createMoveCrossHandleGeometry() {
  const shape = createDoubleArrowShape()
  const extrudeOpts = {
    depth: MOVE_CROSS_DEPTH,
    bevelEnabled: true,
    bevelThickness: MOVE_CROSS_BEVEL_THICKNESS,
    bevelSize: MOVE_CROSS_BEVEL_SIZE,
    bevelOffset: 0,
    bevelSegments: MOVE_CROSS_BEVEL_SEGMENTS,
    curveSegments: 8,
    steps: 1,
  }
  const armX = new ExtrudeGeometry(shape, extrudeOpts)
  armX.translate(0, 0, -MOVE_CROSS_DEPTH / 2)
  armX.rotateX(-Math.PI / 2)
  const armZ = armX.clone()
  armZ.rotateY(Math.PI / 2)
  const merged = mergeGeometries([armX, armZ], false)
  if (!merged) {
    armZ.dispose()
    armX.computeVertexNormals()
    armX.computeBoundingSphere()
    return armX
  }
  armX.dispose()
  armZ.dispose()
  merged.computeVertexNormals()
  merged.computeBoundingSphere()
  return merged
}

export function createArrowHitAreaGeometry() {
  const length = CHEVRON_MAX_X - CHEVRON_MIN_X + HIT_AREA_MARGIN * 2
  const centerX = (CHEVRON_MIN_X + CHEVRON_MAX_X) / 2
  const geometry = new CylinderGeometry(
    CHEVRON_HALF_WIDTH + HIT_AREA_MARGIN,
    CHEVRON_HALF_WIDTH + HIT_AREA_MARGIN,
    length,
    16,
  )
  geometry.rotateZ(-Math.PI / 2)
  geometry.translate(centerX, 0, 0)
  geometry.computeBoundingSphere()
  return geometry
}

// The move cross is a plus, not a disk. A disk-shaped hit area fills the four
// corner gaps between the arms, so a neighbouring node sitting next to the
// selected node (a lamp by a door, a slab beside a wall) gets swallowed by the
// invisible grip and can't be picked. Wrap the visible arms instead: two flat
// arm boxes (length/width + margin) merged into a plus, leaving the corners
// empty so co-located neighbours stay selectable while the grip stays grabbable.
function createMoveCrossHitAreaGeometry() {
  const armLength = (MOVE_CROSS_HALF_LENGTH + HIT_AREA_MARGIN) * 2
  const armWidth = (MOVE_CROSS_HEAD_HALF_WIDTH + HIT_AREA_MARGIN) * 2
  const armX = new BoxGeometry(armLength, HIT_AREA_THICKNESS, armWidth)
  const armZ = new BoxGeometry(armWidth, HIT_AREA_THICKNESS, armLength)
  const merged = mergeGeometries([armX, armZ], false)
  if (!merged) {
    armZ.dispose()
    armX.computeBoundingSphere()
    return armX
  }
  armX.dispose()
  armZ.dispose()
  merged.computeBoundingSphere()
  return merged
}

export function createRotateArrowHitAreaGeometry() {
  const halfSweep = ROTATE_HANDLE_HALF_SWEEP + HIT_AREA_MARGIN / ROTATE_HANDLE_RADIUS
  const geometry = new TorusGeometry(
    ROTATE_HANDLE_RADIUS,
    ROTATE_RIBBON_HALF_WIDTH + ROTATE_HEAD_HALF_WIDTH + HIT_AREA_MARGIN,
    10,
    64,
    halfSweep * 2,
  )
  geometry.rotateZ(-halfSweep)
  geometry.rotateX(-Math.PI / 2)
  geometry.computeBoundingSphere()
  return geometry
}

function createTrackerHitAreaGeometry() {
  const size = TRACKER_CUBE_SIZE + HIT_AREA_MARGIN * 2
  const geometry = new BoxGeometry(size, size, size)
  geometry.computeBoundingSphere()
  return geometry
}

export function createEndpointHitAreaGeometry(radius: number) {
  const geometry = new CylinderGeometry(
    radius + HIT_AREA_MARGIN,
    radius + HIT_AREA_MARGIN,
    HIT_AREA_THICKNESS,
    24,
  )
  geometry.rotateX(Math.PI / 2)
  geometry.computeBoundingSphere()
  return geometry
}

// Hexagon (6 segments) by default; a smooth circle (32 segments) when `round`.
const CORNER_DISC_SEGMENTS = 6
const CORNER_DISC_ROUND_SEGMENTS = 32

function createHandleArrowGeometry(shape: HandleArrowShape, thin = false, round = false) {
  if (shape === 'chevron') return createArrowHandleGeometry(thin)
  if (shape === 'cross') return createMoveCrossHandleGeometry()
  if (shape === 'curved-arrow') return createRotateArrowHandleGeometry()
  if (shape === 'tracker') {
    const geometry = new BoxGeometry(TRACKER_CUBE_SIZE, TRACKER_CUBE_SIZE, TRACKER_CUBE_SIZE)
    geometry.computeBoundingSphere()
    return geometry
  }
  const geometry = new CircleGeometry(
    CORNER_HEX_RADIUS,
    round ? CORNER_DISC_ROUND_SEGMENTS : CORNER_DISC_SEGMENTS,
  )
  geometry.computeBoundingSphere()
  return geometry
}

function createHandleArrowHitGeometry(shape: HandleArrowShape, round = false) {
  if (shape === 'chevron') return createArrowHitAreaGeometry()
  if (shape === 'cross') return createMoveCrossHitAreaGeometry()
  if (shape === 'curved-arrow') return createRotateArrowHitAreaGeometry()
  if (shape === 'tracker') return createTrackerHitAreaGeometry()
  const geometry = new CircleGeometry(
    CORNER_HEX_RADIUS,
    round ? CORNER_DISC_ROUND_SEGMENTS : CORNER_DISC_SEGMENTS,
  )
  geometry.computeBoundingSphere()
  return geometry
}

let sharedHitAreaMaterial: MeshBasicNodeMaterial | null = null
let sharedHitAreaMaterialRefs = 0

function createInvisibleHitAreaMaterial() {
  return new MeshBasicNodeMaterial({
    color: new Color('#ffffff'),
    colorWrite: false,
    depthTest: false,
    depthWrite: false,
    opacity: 0,
    side: DoubleSide,
    transparent: true,
  })
}

export function useInvisibleHitAreaMaterial(): MeshBasicNodeMaterial {
  const materialRef = useRef<MeshBasicNodeMaterial | null>(null)
  if (!materialRef.current) {
    sharedHitAreaMaterial ??= createInvisibleHitAreaMaterial()
    materialRef.current = sharedHitAreaMaterial
  }
  useEffect(() => {
    sharedHitAreaMaterialRefs += 1
    return () => {
      sharedHitAreaMaterialRefs -= 1
      if (sharedHitAreaMaterialRefs <= 0 && sharedHitAreaMaterial) {
        sharedHitAreaMaterial.dispose()
        sharedHitAreaMaterial = null
        sharedHitAreaMaterialRefs = 0
      }
    }
  }, [])
  return materialRef.current
}

export function InvisibleHandleHitArea({
  geometry,
  material,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  scale,
}: {
  geometry: BufferGeometry
  material: MeshBasicNodeMaterial
  onPointerDown: PointerHandler
  onPointerEnter: PointerHandler
  onPointerLeave: PointerHandler
  scale: number
}) {
  return (
    <mesh
      frustumCulled={false}
      geometry={geometry}
      layers={EDITOR_LAYER}
      material={material}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      raycast={hitAreaRaycast}
      renderOrder={HIT_AREA_RENDER_ORDER}
      scale={scale}
    />
  )
}

export function useArrowMaterial(): MeshBasicNodeMaterial {
  return useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        side: DoubleSide,
        // `depthTest: false` keeps the chevron drawing on top of any
        // geometry under it; `depthWrite: true` puts the chevron's depth
        // into the scenePass buffer so the ink-edge shader's depth
        // Laplacian fires on its silhouette from every angle. Without
        // depthWrite, only the normal-discontinuity branch can detect
        // the chevron, and that signal collapses when the arrow's faces
        // happen to align with whatever sits behind them in screen space
        // - which is why the lines used to drop out depending on the view.
        depthTest: false,
        depthWrite: true,
        transparent: true,
        opacity: 1,
      }),
    [],
  )
}

function useHandleArrowMaterial(shape: HandleArrowShape): MeshBasicNodeMaterial {
  return useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: new Color(ARROW_COLOR),
        side: DoubleSide,
        transparent: true,
        opacity: shape === 'corner-picker' ? 0.95 : 1,
        depthTest: false,
        depthWrite: shape !== 'corner-picker',
      }),
    [shape],
  )
}

function indicatorRenderOrder(shape: HandleArrowShape) {
  return shape === 'tracker' || shape === 'corner-picker' ? 1003 : 1010
}

export function HandleArrow({
  shape,
  placement,
  hover,
  cursor,
  activeCursor,
  children,
  hoverScale = 1.12,
  indicatorRotation,
  onHoverChange,
  onPointerDown,
  onPointerEnter,
  onPointerLeave,
  thin = false,
  round = false,
}: HandleArrowProps) {
  const visualShape = normalizeHandleArrowShape(shape, cursor)
  const geometry = useMemo(
    () => createHandleArrowGeometry(visualShape, thin, round),
    [visualShape, thin, round],
  )
  const hitGeometry = useMemo(
    () => createHandleArrowHitGeometry(visualShape, round),
    [visualShape, round],
  )
  const indicatorMaterial = useHandleArrowMaterial(visualShape)
  const hitMaterial = useInvisibleHitAreaMaterial()
  const rootRef = useRef<Group>(null)
  const rotation: [number, number, number] = placement.rotation
    ? [placement.rotation[0], placement.rotation[1], placement.rotation[2]]
    : [0, 0, 0]
  const localRotation: [number, number, number] = indicatorRotation
    ? [indicatorRotation[0], indicatorRotation[1], indicatorRotation[2]]
    : [0, 0, 0]
  const scale = (hover ? hoverScale : 1) * placement.baseScale
  const hitScale = visualShape === 'corner-picker' ? scale : placement.baseScale

  useEffect(() => {
    indicatorMaterial.color.set(hover ? ARROW_HOVER_COLOR : ARROW_COLOR)
  }, [indicatorMaterial, hover])
  useEffect(() => {
    const hideForCapture = () => {
      if (rootRef.current) rootRef.current.visible = false
    }
    const restoreAfterCapture = () => {
      if (rootRef.current) rootRef.current.visible = true
    }
    emitter.on('thumbnail:before-capture', hideForCapture)
    emitter.on('thumbnail:after-capture', restoreAfterCapture)
    return () => {
      emitter.off('thumbnail:before-capture', hideForCapture)
      emitter.off('thumbnail:after-capture', restoreAfterCapture)
    }
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => hitGeometry.dispose(), [hitGeometry])
  useEffect(() => () => indicatorMaterial.dispose(), [indicatorMaterial])

  const handleEnter: PointerHandler = (event) => {
    event.stopPropagation()
    onHoverChange(true)
    if (!activeCursor || document.body.style.cursor !== activeCursor) {
      document.body.style.cursor = cursor
    }
    onPointerEnter?.(event)
  }
  const handleLeave: PointerHandler = (event) => {
    event.stopPropagation()
    onHoverChange(false)
    if (document.body.style.cursor === cursor) {
      document.body.style.cursor = ''
    }
    onPointerLeave?.(event)
  }

  return (
    <group position={placement.position} ref={rootRef} rotation={rotation}>
      {children}
      <group rotation={localRotation}>
        <InvisibleHandleHitArea
          geometry={hitGeometry}
          material={hitMaterial}
          onPointerDown={onPointerDown}
          onPointerEnter={handleEnter}
          onPointerLeave={handleLeave}
          scale={hitScale}
        />
        <mesh
          frustumCulled={false}
          geometry={geometry}
          material={indicatorMaterial}
          raycast={NO_RAYCAST}
          renderOrder={indicatorRenderOrder(visualShape)}
          scale={scale}
        />
      </group>
    </group>
  )
}

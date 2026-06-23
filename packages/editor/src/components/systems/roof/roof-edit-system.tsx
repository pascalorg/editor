import {
  type AnyNode,
  type AnyNodeId,
  type Cursor,
  getActiveRoofHeight,
  getEffectiveNode,
  getRoofSegmentVisibleTopBounds,
  MIN_ROOF_SEGMENT_TRIM_SPAN,
  normalizeRoofSegmentTrim,
  type RoofNode,
  type RoofSegmentNode,
  type RoofSegmentTrim,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { EDITOR_LAYER } from '../../../lib/constants'
import useEditor from '../../../store/use-editor'
import { ARROW_SCALE, HandleArrow } from '../../editor/handles/handle-arrow'
import { swallowNextClick } from '../../editor/handles/use-handle-drag'

// Empty placeholder geometry used when we reveal segments-wrapper for
// accessory editing. The roof's CSG-merged shell is the only thing
// that should render the roof surface in this mode — the per-segment
// CSG geometry (if any was left over from a prior edit) would visually
// double the cut shape, so we strip each segment mesh back to nothing.
// `RoofSystem` rebuilds CSG on demand if the user later selects a
// segment, so destroying the cached geometry here only costs one
// recomputation per segment when the user actually wants it back.
function makeEmptySegmentGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  // Three zero-vertices (one degenerate, invisible triangle), not an empty
  // attribute: in accessory-reveal mode the segments-wrapper is shown, so these
  // meshes are drawn. An empty position (count 0) leaves WebGPU vertex buffer
  // slot 0 unbound and the draw is rejected, poisoning the command encoder.
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(9), 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  g.setAttribute('uv2', new THREE.Float32BufferAttribute(new Float32Array(6), 2))
  // Match the four material slots the roof-segment renderer's material
  // array expects (0=top, 1=side, 2=interior, 3=shingle). Without these
  // groups, mesh.material is a single-material lookup that mismatches
  // the array — same crash mode the BoxGeometry workaround in
  // `roof-system.tsx:144` guards against.
  g.addGroup(0, 0, 0)
  g.addGroup(0, 0, 1)
  g.addGroup(0, 0, 2)
  g.addGroup(0, 0, 3)
  return g
}

type RoofTrimSide =
  | 'left'
  | 'right'
  | 'front'
  | 'back'
  | 'frontLeft'
  | 'frontRight'
  | 'backLeft'
  | 'backRight'
  | 'frontLeftX'
  | 'frontLeftZ'
  | 'frontRightX'
  | 'frontRightZ'
  | 'backLeftX'
  | 'backLeftZ'
  | 'backRightX'
  | 'backRightZ'

type DiagonalTrimSide = 'frontLeft' | 'frontRight' | 'backLeft' | 'backRight'
type DiagonalTrimAxisSide = Exclude<
  RoofTrimSide,
  'left' | 'right' | 'front' | 'back' | DiagonalTrimSide
>
type DiagonalTrimAxisKey = DiagonalTrimAxisSide

const TRIM_PLANE_COLOR = '#93c5fd'
const TRIM_PLANE_OPACITY = 0.18
const TRIM_PLANE_HOVER_OPACITY = 0.34
const TRIM_BORDER_COLOR = '#2563eb'
const TRIM_EDGE_OFFSET = 0.012
const TRIM_PLANE_RENDER_ORDER = 1001
const TRIM_EDGE_RENDER_ORDER = 1002

const TRIM_UNIT_PLANE_GEOMETRY = new THREE.PlaneGeometry(1, 1)
const TRIM_UNIT_EDGE_GEOMETRY = new THREE.BufferGeometry()
TRIM_UNIT_EDGE_GEOMETRY.setAttribute(
  'position',
  new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0], 3),
)
TRIM_UNIT_EDGE_GEOMETRY.computeBoundingSphere()

const trimPlaneMaterial = new MeshBasicNodeMaterial({
  color: TRIM_PLANE_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: TRIM_PLANE_OPACITY,
  side: THREE.DoubleSide,
  transparent: true,
})
const trimPlaneHoverMaterial = new MeshBasicNodeMaterial({
  color: TRIM_PLANE_COLOR,
  depthTest: false,
  depthWrite: false,
  opacity: TRIM_PLANE_HOVER_OPACITY,
  side: THREE.DoubleSide,
  transparent: true,
})
const trimBorderMaterial = new LineBasicNodeMaterial({
  color: TRIM_BORDER_COLOR,
  depthTest: false,
  depthWrite: false,
})

const _dragNdc = new THREE.Vector2()
const _dragRaycaster = new THREE.Raycaster()
const _dragPlaneHit = new THREE.Vector3()
const _dragLocalPoint = new THREE.Vector3()
const _dragInverseMatrix = new THREE.Matrix4()

function trimEquals(a: RoofSegmentTrim, b: RoofSegmentTrim): boolean {
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.front === b.front &&
    a.back === b.back &&
    a.frontLeft === b.frontLeft &&
    a.frontRight === b.frontRight &&
    a.backLeft === b.backLeft &&
    a.backRight === b.backRight &&
    a.frontLeftX === b.frontLeftX &&
    a.frontLeftZ === b.frontLeftZ &&
    a.frontRightX === b.frontRightX &&
    a.frontRightZ === b.frontRightZ &&
    a.backLeftX === b.backLeftX &&
    a.backLeftZ === b.backLeftZ &&
    a.backRightX === b.backRightX &&
    a.backRightZ === b.backRightZ
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isDiagonalTrimSide(side: RoofTrimSide): side is DiagonalTrimSide {
  return (
    side === 'frontLeft' || side === 'frontRight' || side === 'backLeft' || side === 'backRight'
  )
}

function getDiagonalAxisKeys(side: DiagonalTrimSide): [DiagonalTrimAxisKey, DiagonalTrimAxisKey] {
  switch (side) {
    case 'frontLeft':
      return ['frontLeftX', 'frontLeftZ']
    case 'frontRight':
      return ['frontRightX', 'frontRightZ']
    case 'backLeft':
      return ['backLeftX', 'backLeftZ']
    case 'backRight':
      return ['backRightX', 'backRightZ']
  }
}

function getDiagonalAxisCorner(side: DiagonalTrimAxisSide): DiagonalTrimSide {
  if (side === 'frontLeftX' || side === 'frontLeftZ') return 'frontLeft'
  if (side === 'frontRightX' || side === 'frontRightZ') return 'frontRight'
  if (side === 'backLeftX' || side === 'backLeftZ') return 'backLeft'
  return 'backRight'
}

function getOppositeDiagonalAxis(side: DiagonalTrimAxisKey): DiagonalTrimAxisKey {
  switch (side) {
    case 'frontLeftX':
      return 'frontRightX'
    case 'frontRightX':
      return 'frontLeftX'
    case 'backLeftX':
      return 'backRightX'
    case 'backRightX':
      return 'backLeftX'
    case 'frontLeftZ':
      return 'backLeftZ'
    case 'backLeftZ':
      return 'frontLeftZ'
    case 'frontRightZ':
      return 'backRightZ'
    case 'backRightZ':
      return 'frontRightZ'
  }
}

function getMaxDiagonalAxisTrim(
  segment: RoofSegmentNode,
  trim: RoofSegmentTrim,
  axis: DiagonalTrimAxisKey,
): number {
  const keptWidth = Math.max(0, segment.width - trim.left - trim.right)
  const keptDepth = Math.max(0, segment.depth - trim.front - trim.back)
  const opposite = trim[getOppositeDiagonalAxis(axis)]
  const span = axis.endsWith('X') ? keptWidth : keptDepth
  return Math.max(0, span - MIN_ROOF_SEGMENT_TRIM_SPAN - opposite)
}

function getStarterDiagonalTrim(segment: RoofSegmentNode, trim: RoofSegmentTrim): number {
  const keptWidth = Math.max(0, segment.width - trim.left - trim.right)
  const keptDepth = Math.max(0, segment.depth - trim.front - trim.back)
  const maxDiagonalTrim = Math.max(0, Math.min(keptWidth, keptDepth) - MIN_ROOF_SEGMENT_TRIM_SPAN)
  return Math.min(maxDiagonalTrim, Math.max(0.75, maxDiagonalTrim * 0.2))
}

function patchTrimSide(
  segment: RoofSegmentNode,
  baseTrim: RoofSegmentTrim,
  side: RoofTrimSide,
  rawValue: number,
): RoofSegmentTrim {
  const next = { ...baseTrim }
  if (side === 'left' || side === 'right') {
    const opposite = side === 'left' ? baseTrim.right : baseTrim.left
    const max = Math.max(0, segment.width - MIN_ROOF_SEGMENT_TRIM_SPAN - opposite)
    next[side] = clamp(rawValue, 0, max)
  } else {
    if (isDiagonalTrimSide(side)) {
      const [xAxis, zAxis] = getDiagonalAxisKeys(side)
      next[xAxis] = clamp(rawValue, 0, getMaxDiagonalAxisTrim(segment, baseTrim, xAxis))
      next[zAxis] = clamp(rawValue, 0, getMaxDiagonalAxisTrim(segment, baseTrim, zAxis))
      next[side] = Math.min(next[xAxis], next[zAxis])
      return normalizeRoofSegmentTrim({ width: segment.width, depth: segment.depth, trim: next })
    }

    if (side.endsWith('X') || side.endsWith('Z')) {
      const axis = side as DiagonalTrimAxisKey
      const corner = getDiagonalAxisCorner(axis)
      const [xAxis, zAxis] = getDiagonalAxisKeys(corner)
      const otherAxis = axis === xAxis ? zAxis : xAxis
      const starter = getStarterDiagonalTrim(segment, baseTrim)
      next[axis] = clamp(rawValue, 0, getMaxDiagonalAxisTrim(segment, baseTrim, axis))
      if (next[otherAxis] <= 0 && next[corner] <= 0) {
        next[otherAxis] = Math.min(starter, getMaxDiagonalAxisTrim(segment, baseTrim, otherAxis))
      }
      next[corner] = Math.min(next[xAxis], next[zAxis])
      return normalizeRoofSegmentTrim({ width: segment.width, depth: segment.depth, trim: next })
    }

    const opposite = side === 'front' ? baseTrim.back : baseTrim.front
    const max = Math.max(0, segment.depth - MIN_ROOF_SEGMENT_TRIM_SPAN - opposite)
    next[side] = clamp(rawValue, 0, max)
  }

  return normalizeRoofSegmentTrim({ width: segment.width, depth: segment.depth, trim: next })
}

function getTrimValueFromLocalPoint(
  segment: RoofSegmentNode,
  baseTrim: RoofSegmentTrim,
  side: RoofTrimSide,
  localPoint: THREE.Vector3,
): number {
  const leftX = -segment.width / 2 + baseTrim.left
  const rightX = segment.width / 2 - baseTrim.right
  const frontZ = segment.depth / 2 - baseTrim.front
  const backZ = -segment.depth / 2 + baseTrim.back

  switch (side) {
    case 'left':
      return localPoint.x + segment.width / 2
    case 'right':
      return segment.width / 2 - localPoint.x
    case 'front':
      return segment.depth / 2 - localPoint.z
    case 'back':
      return localPoint.z + segment.depth / 2
    case 'frontLeft':
      return localPoint.x - leftX + (frontZ - localPoint.z)
    case 'frontRight':
      return rightX - localPoint.x + (frontZ - localPoint.z)
    case 'backLeft':
      return localPoint.x - leftX + (localPoint.z - backZ)
    case 'backRight':
      return rightX - localPoint.x + (localPoint.z - backZ)
    case 'frontLeftX':
      return localPoint.x - leftX
    case 'frontLeftZ':
      return frontZ - localPoint.z
    case 'frontRightX':
      return rightX - localPoint.x
    case 'frontRightZ':
      return frontZ - localPoint.z
    case 'backLeftX':
      return localPoint.x - leftX
    case 'backLeftZ':
      return localPoint.z - backZ
    case 'backRightX':
      return rightX - localPoint.x
    case 'backRightZ':
      return localPoint.z - backZ
  }
}

function getTrimLabel(side: RoofTrimSide): string {
  switch (side) {
    case 'left':
      return 'trim left'
    case 'right':
      return 'trim right'
    case 'front':
      return 'trim front'
    case 'back':
      return 'trim back'
    case 'frontLeft':
      return 'trim front left diagonal'
    case 'frontRight':
      return 'trim front right diagonal'
    case 'backLeft':
      return 'trim back left diagonal'
    case 'backRight':
      return 'trim back right diagonal'
    case 'frontLeftX':
      return 'trim front left diagonal width'
    case 'frontLeftZ':
      return 'trim front left diagonal depth'
    case 'frontRightX':
      return 'trim front right diagonal width'
    case 'frontRightZ':
      return 'trim front right diagonal depth'
    case 'backLeftX':
      return 'trim back left diagonal width'
    case 'backLeftZ':
      return 'trim back left diagonal depth'
    case 'backRightX':
      return 'trim back right diagonal width'
    case 'backRightZ':
      return 'trim back right diagonal depth'
  }
}

function getTrimCursor(side: RoofTrimSide): string {
  switch (side) {
    case 'left':
    case 'right':
      return 'ew-resize'
    case 'front':
    case 'back':
      return 'ns-resize'
    case 'frontLeft':
    case 'backRight':
      return 'nwse-resize'
    case 'frontRight':
    case 'backLeft':
      return 'nesw-resize'
    case 'frontLeftX':
    case 'frontRightX':
    case 'backLeftX':
    case 'backRightX':
      return 'ew-resize'
    case 'frontLeftZ':
    case 'frontRightZ':
    case 'backLeftZ':
    case 'backRightZ':
      return 'ns-resize'
  }
}

function getTrimHandleCursor(side: RoofTrimSide): Cursor {
  switch (side) {
    case 'left':
    case 'right':
    case 'frontLeftX':
    case 'frontRightX':
    case 'backLeftX':
    case 'backRightX':
      return 'ew-resize'
    case 'front':
    case 'back':
    case 'frontLeftZ':
    case 'frontRightZ':
    case 'backLeftZ':
    case 'backRightZ':
      return 'ns-resize'
    case 'frontLeft':
    case 'frontRight':
    case 'backLeft':
    case 'backRight':
      return 'move'
  }
}

function shouldShowTrimPlanes(metadata: unknown): boolean {
  return !(
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>).showTrimPlanes === false
  )
}

function commitSegmentTrim(segment: RoofSegmentNode, trim: RoofSegmentTrim) {
  const scene = useScene.getState()
  scene.applyNodeChanges({
    update: [{ id: segment.id as AnyNodeId, data: { trim } as Partial<AnyNode> }],
  })
}

function RoofTrimHandles() {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const selectedId = selectedIds.length === 1 ? (selectedIds[0] as AnyNodeId) : null
  const segment = useScene((s) => {
    if (!selectedId) return null
    const node = s.nodes[selectedId]
    return node?.type === 'roof-segment' ? (node as RoofSegmentNode) : null
  })
  const readOnly = useScene((s) => s.readOnly)
  const liveOverrideKey = useLiveNodeOverrides((s) =>
    segment ? JSON.stringify(s.overrides.get(segment.id) ?? null) : null,
  )
  const [hoveredSide, setHoveredSide] = useState<RoofTrimSide | null>(null)
  const groupRef = useRef<THREE.Group>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const { camera, gl } = useThree()
  const zoom = camera instanceof THREE.OrthographicCamera ? 1 / camera.zoom : 1
  const handleBaseScale = zoom * ARROW_SCALE

  useEffect(() => () => dragCleanupRef.current?.(), [])

  const liveSegment = useMemo(() => {
    if (!segment) return null
    void liveOverrideKey
    return getEffectiveNode(segment)
  }, [segment, liveOverrideKey])

  useFrame(() => {
    if (!liveSegment || !groupRef.current) return
    const source = sceneRegistry.nodes.get(liveSegment.id)
    if (!source) return
    source.updateWorldMatrix(true, false)
    groupRef.current.matrix.copy(source.matrixWorld)
    groupRef.current.matrixAutoUpdate = false
  })

  const showTrimPlanes = shouldShowTrimPlanes(liveSegment?.metadata)

  if (readOnly || !segment || !liveSegment || !showTrimPlanes) return null

  const trim = normalizeRoofSegmentTrim(liveSegment)
  const activeRh = getActiveRoofHeight(liveSegment)
  const handleY = Math.max(0.45, liveSegment.wallHeight + activeRh + 0.45)
  const keptWidth = Math.max(0.01, liveSegment.width - trim.left - trim.right)
  const keptDepth = Math.max(0.01, liveSegment.depth - trim.front - trim.back)
  const leftX = -liveSegment.width / 2 + trim.left
  const rightX = liveSegment.width / 2 - trim.right
  const frontZ = liveSegment.depth / 2 - trim.front
  const backZ = -liveSegment.depth / 2 + trim.back
  const visibleBounds = getRoofSegmentVisibleTopBounds(liveSegment)
  const visibleCenterX = (visibleBounds.minX + visibleBounds.maxX) / 2
  const visibleCenterZ = (visibleBounds.minZ + visibleBounds.maxZ) / 2
  const visibleWidth = Math.max(0.01, visibleBounds.maxX - visibleBounds.minX)
  const visibleDepth = Math.max(0.01, visibleBounds.maxZ - visibleBounds.minZ)
  const visualLeftX = trim.left > 0 ? leftX : visibleBounds.minX
  const visualRightX = trim.right > 0 ? rightX : visibleBounds.maxX
  const visualFrontZ = trim.front > 0 ? frontZ : visibleBounds.maxZ
  const visualBackZ = trim.back > 0 ? backZ : visibleBounds.minZ
  const maxDiagonalTrim = Math.max(0, Math.min(keptWidth, keptDepth) - MIN_ROOF_SEGMENT_TRIM_SPAN)
  const starterDiagonalTrim = Math.min(maxDiagonalTrim, Math.max(0.75, maxDiagonalTrim * 0.2))

  const startDrag = (side: RoofTrimSide, event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    const source = sceneRegistry.nodes.get(segment.id)
    if (!source) return

    source.updateWorldMatrix(true, false)
    const startMatrix = source.matrixWorld.clone()
    _dragInverseMatrix.copy(startMatrix).invert()
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -event.point.y)
    const baseSegment = getEffectiveNode(segment)
    const baseTrim = normalizeRoofSegmentTrim(baseSegment)
    const segmentId = segment.id as AnyNodeId
    let pendingTrim = baseTrim

    document.body.style.cursor = getTrimCursor(side)
    useEditor.getState().setActiveHandleDrag({ nodeId: segmentId, label: getTrimLabel(side) })
    useViewer.getState().setInputDragging(true)
    useScene.temporal.getState().pause()

    const updateFromPointer = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      _dragNdc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      )
      _dragRaycaster.setFromCamera(_dragNdc, camera)
      if (!_dragRaycaster.ray.intersectPlane(dragPlane, _dragPlaneHit)) return
      _dragLocalPoint.copy(_dragPlaneHit).applyMatrix4(_dragInverseMatrix)
      const rawValue = getTrimValueFromLocalPoint(baseSegment, baseTrim, side, _dragLocalPoint)
      pendingTrim = patchTrimSide(baseSegment, baseTrim, side, rawValue)
      useLiveNodeOverrides.getState().set(segmentId, { trim: pendingTrim })
      useScene.getState().markDirty(segmentId)
    }

    updateFromPointer(event.clientX, event.clientY)

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      if (
        document.body.style.cursor === 'ew-resize' ||
        document.body.style.cursor === 'ns-resize' ||
        document.body.style.cursor === 'nwse-resize' ||
        document.body.style.cursor === 'nesw-resize'
      ) {
        document.body.style.cursor = ''
      }
      useScene.temporal.getState().resume()
      useEditor.getState().setActiveHandleDrag(null)
      useViewer.getState().setInputDragging(false)
      dragCleanupRef.current = null
    }

    const onMove = (moveEvent: PointerEvent) => {
      updateFromPointer(moveEvent.clientX, moveEvent.clientY)
    }

    const onUp = () => {
      swallowNextClick()
      if (!trimEquals(pendingTrim, baseTrim)) {
        commitSegmentTrim(baseSegment, pendingTrim)
      }
      useLiveNodeOverrides.getState().clear(segmentId)
      useScene.getState().markDirty(segmentId)
      cleanup()
    }

    const onCancel = () => {
      useLiveNodeOverrides.getState().clear(segmentId)
      useScene.getState().markDirty(segmentId)
      cleanup()
    }

    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const renderTrimPlane = (
    side: RoofTrimSide,
    position: [number, number, number],
    args: [number, number],
    rotation: [number, number, number] = [0, 0, 0],
    handles: readonly { side: RoofTrimSide; offsetX: number }[] = [{ side, offsetX: 0 }],
  ) => {
    const [planeWidth, planeHeight] = args
    const isHovered = handles.some((handle) => handle.side === hoveredSide)

    return (
      <group
        key={side}
        layers={EDITOR_LAYER}
        position={position}
        rotation={rotation}
        renderOrder={TRIM_PLANE_RENDER_ORDER}
      >
        <mesh
          geometry={TRIM_UNIT_PLANE_GEOMETRY}
          material={isHovered ? trimPlaneHoverMaterial : trimPlaneMaterial}
          raycast={() => null}
          renderOrder={TRIM_PLANE_RENDER_ORDER}
          scale={[planeWidth, planeHeight, 1]}
        />

        <lineSegments
          geometry={TRIM_UNIT_EDGE_GEOMETRY}
          material={trimBorderMaterial}
          position={[0, 0, TRIM_EDGE_OFFSET]}
          raycast={() => null}
          renderOrder={TRIM_EDGE_RENDER_ORDER}
          scale={[planeWidth, planeHeight, 1]}
        />

        {handles.map((handle) => (
          <HandleArrow
            activeCursor={getTrimHandleCursor(handle.side)}
            cursor={getTrimHandleCursor(handle.side)}
            hover={hoveredSide === handle.side}
            key={handle.side}
            onHoverChange={(hovered) => {
              setHoveredSide((current) => {
                if (hovered) return handle.side
                return current === handle.side ? null : current
              })
            }}
            onPointerDown={(event) => startDrag(handle.side, event)}
            onPointerEnter={(event) => {
              event.stopPropagation()
              document.body.style.cursor = getTrimCursor(handle.side)
            }}
            onPointerLeave={() => {
              if (!dragCleanupRef.current) document.body.style.cursor = ''
            }}
            placement={{
              position: [handle.offsetX, 0, 0],
              baseScale: handleBaseScale,
            }}
            shape="tracker"
          />
        ))}
      </group>
    )
  }

  const renderDiagonalTrimPlane = (side: DiagonalTrimSide, xAmount: number, zAmount: number) => {
    if (maxDiagonalTrim <= 0) {
      return null
    }

    const displayX = xAmount > 0 ? xAmount : starterDiagonalTrim
    const displayZ = zAmount > 0 ? zAmount : starterDiagonalTrim
    if (!(displayX > 0 && displayZ > 0)) return null

    let start: [number, number]
    let end: [number, number]
    let xOffset = 0
    let zOffset = 0
    const [xSide, zSide] = getDiagonalAxisKeys(side)
    switch (side) {
      case 'frontLeft':
        start = [visualLeftX + displayX, visualFrontZ]
        end = [visualLeftX, visualFrontZ - displayZ]
        xOffset = -1
        zOffset = 1
        break
      case 'frontRight':
        start = [visualRightX, visualFrontZ - displayZ]
        end = [visualRightX - displayX, visualFrontZ]
        zOffset = -1
        xOffset = 1
        break
      case 'backLeft':
        start = [visualLeftX, visualBackZ + displayZ]
        end = [visualLeftX + displayX, visualBackZ]
        zOffset = -1
        xOffset = 1
        break
      case 'backRight':
        start = [visualRightX - displayX, visualBackZ]
        end = [visualRightX, visualBackZ + displayZ]
        xOffset = -1
        zOffset = 1
        break
      default:
        return null
    }

    const dx = end[0] - start[0]
    const dz = end[1] - start[1]
    const width = Math.hypot(dx, dz)
    const yaw = Math.atan2(-dz, dx)
    return renderTrimPlane(
      side,
      [(start[0] + end[0]) / 2, handleY / 2, (start[1] + end[1]) / 2],
      [width, handleY],
      [0, yaw, 0],
      [
        { side, offsetX: 0 },
        { side: xSide, offsetX: (width / 2) * xOffset },
        { side: zSide, offsetX: (width / 2) * zOffset },
      ],
    )
  }

  return (
    <group ref={groupRef}>
      {renderTrimPlane(
        'left',
        [visualLeftX, handleY / 2, visibleCenterZ],
        [visibleDepth, handleY],
        [0, Math.PI / 2, 0],
      )}
      {renderTrimPlane(
        'right',
        [visualRightX, handleY / 2, visibleCenterZ],
        [visibleDepth, handleY],
        [0, Math.PI / 2, 0],
      )}
      {renderTrimPlane(
        'front',
        [visibleCenterX, handleY / 2, visualFrontZ],
        [visibleWidth, handleY],
      )}
      {renderTrimPlane('back', [visibleCenterX, handleY / 2, visualBackZ], [visibleWidth, handleY])}
      {renderDiagonalTrimPlane('frontLeft', trim.frontLeftX, trim.frontLeftZ)}
      {renderDiagonalTrimPlane('frontRight', trim.frontRightX, trim.frontRightZ)}
      {renderDiagonalTrimPlane('backLeft', trim.backLeftX, trim.backLeftZ)}
      {renderDiagonalTrimPlane('backRight', trim.backRightX, trim.backRightZ)}
    </group>
  )
}

/**
 * Imperatively toggles the Three.js visibility of roof objects based on the
 * editor selection — without causing React re-renders in RoofRenderer.
 *
 * Full edit-mode (segment selected):
 *   - merged-roof mesh is hidden
 *   - segments-wrapper group is shown (individual segments visible for editing)
 *   - all children are marked dirty so RoofSystem rebuilds their geometry
 *
 * Accessory-reveal mode (a dormer/chimney/etc. hosted on a segment is selected):
 *   - merged-roof mesh stays visible (we don't want the appearance to jump)
 *   - segments-wrapper group is shown ANYWAY so anything portaled into a
 *     segment's registered mesh (e.g. dormer in-world handle arrows that
 *     don't use `portal: 'grandparent'`) is no longer inheriting the
 *     wrapper's hidden flag
 *   - segment placeholder geometry is empty, so revealing the wrapper has
 *     no visible cost beyond letting the handle arrows render
 *
 * When deselected: merged-roof shown, segments-wrapper hidden.
 */
export const RoofEditSystem = () => {
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const prevActiveRoofIds = useRef(new Set<string>())
  const prevRevealRoofIds = useRef(new Set<string>())

  useEffect(() => {
    const nodes = useScene.getState().nodes

    // Roofs where a segment itself is selected -> full edit mode (hide
    // merged, show wrapper).
    const activeRoofIds = new Set<string>()
    // Roofs where an accessory (dormer/chimney/etc.) is selected -> only
    // reveal the wrapper so handle portals into the segment mesh become
    // visible. Merged stays on.
    const revealRoofIds = new Set<string>()

    for (const id of selectedIds) {
      const node = nodes[id as AnyNodeId]
      if (!node) continue
      if (node.type === 'roof-segment' && node.parentId) {
        activeRoofIds.add(node.parentId)
        continue
      }
      // Walk up one level: if the parent is a roof-segment, this is a
      // hosted accessory and we want to reveal its grandparent roof's
      // wrapper. Two-step lookup keeps it scoped to roof children
      // without enumerating all accessory kinds.
      if (!node.parentId) continue
      const parent = nodes[node.parentId as AnyNodeId]
      if (parent?.type === 'roof-segment' && parent.parentId) {
        revealRoofIds.add(parent.parentId)
      }
    }

    // Union of roofs that need ANY state change this tick.
    const roofIdsToUpdate = new Set([
      ...activeRoofIds,
      ...revealRoofIds,
      ...prevActiveRoofIds.current,
      ...prevRevealRoofIds.current,
    ])

    for (const roofId of roofIdsToUpdate) {
      const group = sceneRegistry.nodes.get(roofId)
      if (!group) continue

      const mergedMesh = group.getObjectByName('merged-roof')
      const segmentsWrapper = group.getObjectByName('segments-wrapper')
      const isActive = activeRoofIds.has(roofId)
      const isReveal = revealRoofIds.has(roofId)

      if (mergedMesh) mergedMesh.visible = !isActive
      if (segmentsWrapper) segmentsWrapper.visible = isActive || isReveal

      const roofNode = nodes[roofId as AnyNodeId] as RoofNode | undefined
      if (roofNode?.children?.length) {
        const wasActive = prevActiveRoofIds.current.has(roofId)
        const wasReveal = prevRevealRoofIds.current.has(roofId)
        if (isActive !== wasActive) {
          // Entering / exiting full edit mode: rebuild segment / merged
          // geometries. Accessory-reveal doesn't need this — segments
          // keep their placeholder; only their visibility flips.
          const { markDirty } = useScene.getState()
          for (const childId of roofNode.children) {
            markDirty(childId as AnyNodeId)
          }
        }
        // Entering reveal mode (and NOT also full-edit, which already
        // owns its own rebuild path): strip each segment mesh back to
        // an empty placeholder so the wrapper-now-visible doesn't
        // re-show stale CSG geometry from a previous segment edit.
        // Without this, the host segment's CSG cut renders ON TOP of
        // the merged-roof, doubling the dormer's cut shape and
        // bleeding the host wall material through the dormer body.
        if (isReveal && !isActive && !wasReveal && segmentsWrapper) {
          for (const child of segmentsWrapper.children) {
            const mesh = child as THREE.Mesh
            if (!mesh.isMesh) continue
            mesh.geometry?.dispose()
            mesh.geometry = makeEmptySegmentGeometry()
          }
        }
      }
    }

    prevActiveRoofIds.current = activeRoofIds
    prevRevealRoofIds.current = revealRoofIds
  }, [selectedIds])

  return <RoofTrimHandles />
}

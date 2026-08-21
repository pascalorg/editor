'use client'

import {
  type BlockFace,
  type BlockNode,
  type BlockTopology,
  emitter,
  sceneRegistry,
  useLiveNodeOverrides,
} from '@pascal-app/core'
import {
  cn,
  EDITOR_LAYER,
  getFloatingMenuScale,
  isAngleSnapActive,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  meshEditScope,
  NodeActionMenu,
  type SelectionAffordanceProps,
  swallowNextClick,
  triggerSFX,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, type ThreeEvent, useFrame, useThree } from '@react-three/fiber'
import {
  ArrowUpFromLine,
  Check,
  ChevronDown,
  CircleDot,
  Ellipsis,
  Eye,
  EyeOff,
  Move3D,
  Rotate3D,
  Rows3,
  Scaling,
  ScanLine,
  Square,
  Trash2,
  X as XIcon,
} from 'lucide-react'
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  BufferGeometry,
  type Camera,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  LineSegments,
  type Material,
  Mesh,
  type Object3D,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import {
  applyBlockCommand,
  type BlockCommand,
  type BlockSelection,
  blockFaceCentroid,
  blockFaceNormal,
  blockLoopCutSegments,
} from './commands'
import useBlockEditSession from './edit-session'
import { triangulateBlockFace } from './geometry'
import { blockGeometrySnapThreshold, resolveBlockGeometrySnap } from './geometry-snap'
import { BLOCK_WHEEL_OPTIONS, consumeBlockGestureWheel } from './gesture-wheel'
import { type BlockSfxAction, blockSfx } from './interaction-sfx'
import {
  type BlockLastOperation,
  recordCommittedBlockOperation,
  repeatCommittedBlockOperation,
  replaceCommittedBlockOperation,
} from './last-operation'
import { resolveLoopCutPointerAction, resolveLoopCutSlideFactor } from './loop-cut-interaction'
import { BLOCK_BODY_SLOT_ID, unpaintedBlockMaterialSlotIds } from './material-slots'
import {
  type BlockExtrudeAxis,
  type BlockModalFaceOperation,
  blockModalFaceOperationStatus,
} from './modal-face-operation'
import { beginBlockModalSession } from './modal-session'
import {
  type BlockActiveTransform,
  type BlockAxisVisualState,
  type BlockModalFeedbackMode,
  type BlockTransformAxis,
  type BlockTransformConstraint,
  type BlockTransformOperation,
  type BlockTransformPlane,
  blockAccumulatePrecisionPointer,
  blockAxisDelta,
  blockAxisVisualState,
  blockConstrainTranslationDelta,
  blockModalTransformStatus,
  blockNumericDeltaForConstraint,
  blockPlaneVisualState,
  blockPointerDistanceForAxis,
  blockPrecisionSnapStep,
  blockRotationPointerAngle,
  blockScaleFactorsForConstraint,
  blockTransformConstraintFromKey,
  blockTransformDisplayValue,
  blockTransformNumericInputFromKey,
  blockTransformNumericValue,
} from './modal-transform'
import {
  lockedRotationAngleFromHits,
  signedAngleAroundAxis,
  unwrapRotationDelta,
} from './rotation-drag'
import {
  blockLocalPointToClient as localPointToClient,
  type BlockPoint as Point,
  blockSelectionCentroid as selectionCentroid,
} from './selection-geometry'
import {
  type BlockSelectionState,
  blockSelectionChanged,
  clearBlockSelection,
  convertBlockSelection,
  invertBlockSelection,
  selectAllBlockComponents,
  selectBlockComponent,
} from './selection-model'
import {
  blockBevelWidthFromDrag,
  blockComponentStatus,
  blockGizmoDimensions,
  blockOperationAvailability,
  blockScaleFactorFromDrag,
  blockScaleFactors,
  blockToolbarOffset,
  formatBlockSelectionStatus,
} from './toolbar-state'
import { useBlockFaceOperation } from './use-block-face-operation'

type ComponentMode = BlockSelection['mode']
type Axis = BlockTransformAxis
type PlaneAxes = BlockTransformPlane
type TransformOperation = BlockTransformOperation
type ActiveTransform = BlockActiveTransform
type TransformTool = 'transform' | 'loop-cut' | 'bevel'
type TopologyOperator = 'extrude' | 'inset' | 'merge' | 'dissolve' | 'delete'
type ToolbarPanel = 'operations' | 'selection' | null

const AXIS_VECTORS: Record<Axis, Point> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}
const AXIS_COLORS: Record<Axis, string> = {
  x: '#ff2060',
  y: '#20df80',
  z: '#2080ff',
}
const PIVOT_HOVERED_COLOR = '#ffff40'
const GIZMO_RENDER_ORDER = 1300
const GIZMO_HIT_RENDER_ORDER = GIZMO_RENDER_ORDER + 1
const PLANE_NORMAL: Record<PlaneAxes, Axis> = {
  xy: 'z',
  xz: 'y',
  yz: 'x',
}
const COMPONENT_ACTIVE_COLOR = '#ff9a24'
const COMPONENT_SELECTED_COLOR = '#ff6d00'
const COMPONENT_HOVER_COLOR = '#ffb020'
const COMPONENT_IDLE_COLOR = '#737982'
const DEFAULT_BEVEL_SEGMENTS = 6
const ROTATION_SNAP_ANGLE_DEGREES = 15
const EMPTY_COMPONENT_IDS: string[] = []

const FLOATING_PANEL_CLASS =
  'pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-xl backdrop-blur-md'
const TOOLBAR_POPOVER_CLASS =
  'absolute top-[calc(100%+10px)] left-1/2 z-50 w-72 -translate-x-1/2 rounded-xl border border-border/50 bg-background/98 p-2 shadow-elevation-4 backdrop-blur-xl'
const OPERATION_INPUT_CLASS =
  'h-6 w-12 rounded-md border border-border/50 bg-accent/25 px-1 text-right font-mono text-[10px] text-foreground tabular-nums outline-none hover:border-border/80 focus:border-ring disabled:opacity-35'

const playBlockSfx = (action: BlockSfxAction) => triggerSFX(blockSfx(action))

function isAxisConstraint(constraint: BlockTransformConstraint): constraint is Axis {
  return constraint === 'x' || constraint === 'y' || constraint === 'z'
}

function isPlaneConstraint(constraint: BlockTransformConstraint): constraint is PlaneAxes {
  return constraint === 'xy' || constraint === 'xz' || constraint === 'yz'
}

function preferredFace(topology: BlockTopology): BlockFace | null {
  return (
    topology.faces
      .map((face) => ({
        face,
        normal: blockFaceNormal(topology, face),
        centroid: blockFaceCentroid(topology, face),
      }))
      .filter((entry) => entry.normal && entry.centroid)
      .sort((a, b) => b.normal![1] - a.normal![1] || b.centroid![1] - a.centroid![1])[0]?.face ??
    null
  )
}

function topologyVertexMap(topology: BlockTopology): Map<string, Point> {
  return new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
}

function topologyExtent(topology: BlockTopology): number {
  const axes = [0, 1, 2] as const
  return Math.max(
    0.5,
    ...axes.map((axis) => {
      const values = topology.vertices.map((vertex) => vertex.position[axis])
      return Math.max(...values) - Math.min(...values)
    }),
  )
}

function closestAxisParameterToRay(
  axisOrigin: Vector3,
  axisDirection: Vector3,
  ray: Raycaster['ray'],
): number {
  const originToRay = axisOrigin.clone().sub(ray.origin)
  const b = axisDirection.dot(ray.direction)
  const d = axisDirection.dot(originToRay)
  const e = ray.direction.dot(originToRay)
  const denominator = 1 - b * b
  if (Math.abs(denominator) < 1e-6) return -d
  const axisParameter = (b * e - d) / denominator
  return e + b * axisParameter < 0 ? -d : axisParameter
}

function geometrySnapThreshold(
  camera: Camera,
  worldPoint: Vector3,
  target: Object3D,
  canvas: HTMLCanvasElement,
  extent: number,
): number {
  target.updateWorldMatrix(true, false)
  const screenThreshold = blockGeometrySnapThreshold(
    camera,
    worldPoint,
    canvas.getBoundingClientRect().height,
    target.getWorldScale(new Vector3()),
  )
  return Math.min(extent * 0.15, Math.max(0.02, screenThreshold))
}

function VertexHandle({
  id,
  position,
  radius,
  selected,
  active,
  xray,
  onSelect,
}: {
  id: string
  position: Point
  radius: number
  selected: boolean
  active: boolean
  xray: boolean
  onSelect: (id: string, additive: boolean, event: ThreeEvent<MouseEvent>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const visibleGeometry = useMemo(() => new SphereGeometry(radius, 16, 12), [radius])
  const hitGeometry = useMemo(() => new SphereGeometry(radius * 4.2, 12, 8), [radius])
  const visibleMaterial = useMemo(
    () => new MeshBasicNodeMaterial({ depthTest: !xray, depthWrite: false }),
    [xray],
  )
  const hitMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  useEffect(() => {
    visibleMaterial.color.set(
      active
        ? COMPONENT_ACTIVE_COLOR
        : selected
          ? COMPONENT_SELECTED_COLOR
          : hovered
            ? COMPONENT_HOVER_COLOR
            : COMPONENT_IDLE_COLOR,
    )
  }, [active, hovered, selected, visibleMaterial])
  useEffect(
    () => () => {
      visibleGeometry.dispose()
      hitGeometry.dispose()
      visibleMaterial.dispose()
      hitMaterial.dispose()
    },
    [hitGeometry, hitMaterial, visibleGeometry, visibleMaterial],
  )

  return (
    <group position={position}>
      <mesh
        frustumCulled={false}
        geometry={visibleGeometry}
        layers={EDITOR_LAYER}
        material={visibleMaterial}
        raycast={() => {}}
        renderOrder={1200}
      />
      <mesh
        frustumCulled={false}
        geometry={hitGeometry}
        layers={EDITOR_LAYER}
        material={hitMaterial}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(id, event.nativeEvent.shiftKey, event)
        }}
        onPointerEnter={(event) => {
          event.stopPropagation()
          setHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerLeave={() => {
          setHovered(false)
          if (document.body.style.cursor === 'pointer') document.body.style.cursor = ''
        }}
        renderOrder={1201}
      />
    </group>
  )
}

function EdgeHandle({
  id,
  start,
  end,
  radius,
  selected,
  active,
  xray,
  onSelect,
  onPointerDown,
}: {
  id: string
  start: Point
  end: Point
  radius: number
  selected: boolean
  active: boolean
  xray: boolean
  onSelect: (id: string, additive: boolean, event: ThreeEvent<MouseEvent>) => void
  onPointerDown?: (id: string, event: ThreeEvent<PointerEvent>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const hoverCursor = onPointerDown ? 'ew-resize' : 'pointer'
  const placement = useMemo(() => {
    const a = new Vector3(...start)
    const b = new Vector3(...end)
    const direction = b.clone().sub(a)
    const length = direction.length()
    return {
      length,
      position: a.add(b).multiplyScalar(0.5),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()),
    }
  }, [end, start])
  const visibleGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([...start, ...end], 3))
    return geometry
  }, [end, start])
  const hitGeometry = useMemo(
    () => new CylinderGeometry(radius * 3.2, radius * 3.2, placement.length, 8),
    [placement.length, radius],
  )
  const emphasisGeometry = useMemo(
    () => new CylinderGeometry(radius * 1.35, radius * 1.35, placement.length, 12),
    [placement.length, radius],
  )
  const visibleMaterial = useMemo(
    () =>
      new LineBasicNodeMaterial({
        transparent: true,
        depthTest: !xray,
        depthWrite: false,
      }),
    [xray],
  )
  const hitMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  const emphasisMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        transparent: true,
        depthTest: !xray,
        depthWrite: false,
      }),
    [xray],
  )
  useEffect(() => {
    const color = active
      ? COMPONENT_ACTIVE_COLOR
      : selected
        ? COMPONENT_SELECTED_COLOR
        : hovered
          ? COMPONENT_HOVER_COLOR
          : COMPONENT_IDLE_COLOR
    visibleMaterial.color.set(color)
    visibleMaterial.opacity = active || selected || hovered ? 1 : 0.65
    emphasisMaterial.color.set(color)
    emphasisMaterial.opacity = active ? 1 : selected ? 0.96 : hovered ? 0.82 : 0
  }, [active, emphasisMaterial, hovered, selected, visibleMaterial])
  const visibleLine = useMemo(() => {
    const line = new LineSegments(visibleGeometry, visibleMaterial)
    line.frustumCulled = false
    line.layers.set(EDITOR_LAYER)
    line.raycast = () => {}
    line.renderOrder = 1200
    return line
  }, [visibleGeometry, visibleMaterial])
  useEffect(
    () => () => {
      visibleGeometry.dispose()
      hitGeometry.dispose()
      emphasisGeometry.dispose()
      visibleMaterial.dispose()
      hitMaterial.dispose()
      emphasisMaterial.dispose()
    },
    [
      emphasisGeometry,
      emphasisMaterial,
      hitGeometry,
      hitMaterial,
      visibleGeometry,
      visibleMaterial,
    ],
  )

  return (
    <>
      <primitive object={visibleLine} />
      <group position={placement.position} quaternion={placement.quaternion}>
        <mesh
          frustumCulled={false}
          geometry={emphasisGeometry}
          layers={EDITOR_LAYER}
          material={emphasisMaterial}
          raycast={() => {}}
          renderOrder={1202}
          visible={active || selected || hovered}
        />
        <mesh
          frustumCulled={false}
          geometry={hitGeometry}
          layers={EDITOR_LAYER}
          material={hitMaterial}
          onClick={(event) => {
            event.stopPropagation()
            if (onPointerDown) return
            onSelect(id, event.nativeEvent.shiftKey, event)
          }}
          onPointerDown={
            onPointerDown
              ? (event) => {
                  event.stopPropagation()
                  event.nativeEvent.stopImmediatePropagation()
                  swallowNextClick()
                  onPointerDown(id, event)
                }
              : undefined
          }
          onPointerEnter={(event) => {
            event.stopPropagation()
            setHovered(true)
            document.body.style.cursor = hoverCursor
          }}
          onPointerLeave={() => {
            setHovered(false)
            if (document.body.style.cursor === hoverCursor) document.body.style.cursor = ''
          }}
          renderOrder={1201}
        />
      </group>
    </>
  )
}

function FaceHandle({
  face,
  topology,
  selected,
  active,
  xray,
  interactive = true,
  onSelect,
}: {
  face: BlockFace
  topology: BlockTopology
  selected: boolean
  active: boolean
  xray: boolean
  interactive?: boolean
  onSelect: (id: string, additive: boolean, event: ThreeEvent<MouseEvent>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const geometries = useMemo(() => {
    const triangulated = triangulateBlockFace(topology, face)
    if (!triangulated) return null
    const fill = new BufferGeometry()
    fill.setAttribute(
      'position',
      new Float32BufferAttribute(
        triangulated.triangles.flatMap((triangle) => triangle.flat()),
        3,
      ),
    )
    const vertexById = topologyVertexMap(topology)
    const outlinePositions: number[] = []
    for (let index = 0; index < face.vertexIds.length; index += 1) {
      const start = vertexById.get(face.vertexIds[index]!)
      const end = vertexById.get(face.vertexIds[(index + 1) % face.vertexIds.length]!)
      if (start && end) outlinePositions.push(...start, ...end)
    }
    const outline = new BufferGeometry()
    outline.setAttribute('position', new Float32BufferAttribute(outlinePositions, 3))
    return { fill, outline }
  }, [face, topology])
  const fillMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        transparent: true,
        depthTest: !xray,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        side: DoubleSide,
      }),
    [xray],
  )
  const outlineMaterial = useMemo(
    () =>
      new LineBasicNodeMaterial({
        transparent: true,
        depthTest: !xray,
        depthWrite: false,
      }),
    [xray],
  )
  useEffect(() => {
    fillMaterial.color.set(
      active
        ? COMPONENT_ACTIVE_COLOR
        : selected
          ? COMPONENT_SELECTED_COLOR
          : hovered
            ? COMPONENT_HOVER_COLOR
            : COMPONENT_IDLE_COLOR,
    )
    fillMaterial.opacity = active ? 0.46 : selected ? 0.38 : hovered ? 0.18 : 0.001
    outlineMaterial.color.set(
      active
        ? COMPONENT_ACTIVE_COLOR
        : selected
          ? COMPONENT_SELECTED_COLOR
          : hovered
            ? COMPONENT_HOVER_COLOR
            : COMPONENT_IDLE_COLOR,
    )
    outlineMaterial.opacity = active || selected ? 1 : hovered ? 0.9 : 0.28
  }, [active, fillMaterial, hovered, outlineMaterial, selected])
  const outline = useMemo(() => {
    if (!geometries) return null
    const line = new LineSegments(geometries.outline, outlineMaterial)
    line.layers.set(EDITOR_LAYER)
    line.raycast = () => {}
    line.renderOrder = 1201
    return line
  }, [geometries, outlineMaterial])
  useEffect(
    () => () => {
      geometries?.fill.dispose()
      geometries?.outline.dispose()
      fillMaterial.dispose()
      outlineMaterial.dispose()
    },
    [fillMaterial, geometries, outlineMaterial],
  )
  if (!geometries) return null

  return (
    <group>
      <mesh
        frustumCulled={false}
        geometry={geometries.fill}
        layers={EDITOR_LAYER}
        material={fillMaterial}
        onClick={
          interactive
            ? (event) => {
                event.stopPropagation()
                onSelect(face.id, event.nativeEvent.shiftKey, event)
              }
            : undefined
        }
        onPointerEnter={
          interactive
            ? (event) => {
                event.stopPropagation()
                setHovered(true)
                document.body.style.cursor = 'pointer'
              }
            : undefined
        }
        onPointerLeave={
          interactive
            ? () => {
                setHovered(false)
                if (document.body.style.cursor === 'pointer') document.body.style.cursor = ''
              }
            : undefined
        }
        raycast={interactive ? undefined : () => {}}
        renderOrder={1200}
      />
      {outline ? <primitive object={outline} /> : null}
    </group>
  )
}

function AxisTransformHandle({
  axis,
  length,
  radius,
  moveState,
  scaleState,
  disabled,
  onMovePointerDown,
  onScalePointerDown,
}: {
  axis: Axis
  length: number
  radius: number
  moveState: BlockAxisVisualState
  scaleState: BlockAxisVisualState
  disabled: boolean
  onMovePointerDown: (axis: Axis, event: ThreeEvent<PointerEvent>) => void
  onScalePointerDown: (axis: Axis, event: ThreeEvent<PointerEvent>) => void
}) {
  const [hovered, setHovered] = useState<TransformOperation | null>(null)
  const shaftGeometry = useMemo(
    () => new CylinderGeometry(radius * 0.35, radius * 0.35, length * 0.8, 10),
    [length, radius],
  )
  const arrowGeometry = useMemo(
    () => new ConeGeometry(radius * 1.6, length * 0.2, 24),
    [length, radius],
  )
  const moveHitGeometry = useMemo(
    () => new CylinderGeometry(radius * 4.5, radius * 4.5, length, 8),
    [length, radius],
  )
  const scaleGeometry = useMemo(() => new SphereGeometry(radius * 1.3, 12, 12), [radius])
  const scaleHitGeometry = useMemo(() => new SphereGeometry(radius * 4.2, 12, 8), [radius])
  const moveMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  const scaleMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  const hitMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: AXIS_COLORS[axis],
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    [axis],
  )
  useEffect(() => {
    moveMaterial.color.set(
      hovered === 'translate' && moveState !== 'faded' ? PIVOT_HOVERED_COLOR : AXIS_COLORS[axis],
    )
    moveMaterial.opacity = moveState === 'faded' ? 0.14 : 1
    scaleMaterial.color.set(
      hovered === 'scale' && scaleState !== 'faded' ? PIVOT_HOVERED_COLOR : AXIS_COLORS[axis],
    )
    scaleMaterial.opacity = scaleState === 'faded' ? 0.14 : 1
  }, [axis, hovered, moveMaterial, moveState, scaleMaterial, scaleState])
  useEffect(
    () => () => {
      shaftGeometry.dispose()
      arrowGeometry.dispose()
      moveHitGeometry.dispose()
      scaleGeometry.dispose()
      scaleHitGeometry.dispose()
      moveMaterial.dispose()
      scaleMaterial.dispose()
      hitMaterial.dispose()
    },
    [
      arrowGeometry,
      hitMaterial,
      moveHitGeometry,
      moveMaterial,
      scaleGeometry,
      scaleHitGeometry,
      scaleMaterial,
      shaftGeometry,
    ],
  )
  const rotation: Point =
    axis === 'x' ? [0, 0, -Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0]
  const scalePosition = length * 1.2

  return (
    <group rotation={rotation}>
      <mesh
        geometry={shaftGeometry}
        layers={EDITOR_LAYER}
        material={moveMaterial}
        position={[0, length * 0.4, 0]}
        raycast={() => {}}
        renderOrder={GIZMO_RENDER_ORDER}
      />
      <mesh
        geometry={arrowGeometry}
        layers={EDITOR_LAYER}
        material={moveMaterial}
        position={[0, length * 0.9, 0]}
        raycast={() => {}}
        renderOrder={GIZMO_RENDER_ORDER}
      />
      <mesh
        geometry={moveHitGeometry}
        layers={EDITOR_LAYER}
        material={hitMaterial}
        onPointerDown={(event) => {
          if (disabled) return
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          swallowNextClick()
          onMovePointerDown(axis, event)
        }}
        onPointerEnter={(event) => {
          if (disabled) return
          event.stopPropagation()
          setHovered('translate')
          document.body.style.cursor = 'grab'
        }}
        onPointerLeave={() => {
          setHovered(null)
          if (document.body.style.cursor === 'grab') document.body.style.cursor = ''
        }}
        position={[0, length * 0.5, 0]}
        renderOrder={GIZMO_HIT_RENDER_ORDER}
      />
      <mesh
        geometry={scaleGeometry}
        layers={EDITOR_LAYER}
        material={scaleMaterial}
        position={[0, scalePosition, 0]}
        raycast={() => {}}
        renderOrder={GIZMO_RENDER_ORDER}
      />
      <mesh
        geometry={scaleHitGeometry}
        layers={EDITOR_LAYER}
        material={hitMaterial}
        onPointerDown={(event) => {
          if (disabled) return
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          swallowNextClick()
          onScalePointerDown(axis, event)
        }}
        onPointerEnter={(event) => {
          if (disabled) return
          event.stopPropagation()
          setHovered('scale')
          document.body.style.cursor = 'grab'
        }}
        onPointerLeave={() => {
          setHovered(null)
          if (document.body.style.cursor === 'grab') document.body.style.cursor = ''
        }}
        position={[0, scalePosition, 0]}
        renderOrder={GIZMO_HIT_RENDER_ORDER}
      />
    </group>
  )
}

function PlaneMoveHandle({
  plane,
  offset,
  size,
  state,
  disabled,
  onPointerDown,
}: {
  plane: PlaneAxes
  offset: number
  size: number
  state: BlockAxisVisualState
  disabled: boolean
  onPointerDown: (constraint: Axis | PlaneAxes, event: ThreeEvent<PointerEvent>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const geometry = useMemo(() => new PlaneGeometry(size, size), [size])
  const hitGeometry = useMemo(() => new PlaneGeometry(size * 1.45, size * 1.45), [size])
  const normalAxis = PLANE_NORMAL[plane]
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: AXIS_COLORS[normalAxis],
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        transparent: true,
        opacity: 1,
      }),
    [normalAxis],
  )
  const hitMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: '#ffffff',
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        transparent: true,
        opacity: 0,
      }),
    [],
  )
  useEffect(() => {
    material.color.set(hovered && state !== 'faded' ? PIVOT_HOVERED_COLOR : AXIS_COLORS[normalAxis])
    material.opacity = state === 'faded' ? 0.1 : 1
  }, [hovered, material, normalAxis, state])
  useEffect(
    () => () => {
      geometry.dispose()
      hitGeometry.dispose()
      material.dispose()
      hitMaterial.dispose()
    },
    [geometry, hitGeometry, hitMaterial, material],
  )
  const position: Point =
    plane === 'xy'
      ? [offset, offset, 0]
      : plane === 'xz'
        ? [offset, 0, offset]
        : [0, offset, offset]
  const rotation: Point =
    plane === 'xz' ? [-Math.PI / 2, 0, 0] : plane === 'yz' ? [0, Math.PI / 2, 0] : [0, 0, 0]

  return (
    <group position={position} rotation={rotation}>
      <mesh
        geometry={geometry}
        layers={EDITOR_LAYER}
        material={material}
        raycast={() => {}}
        renderOrder={GIZMO_RENDER_ORDER}
      />
      <mesh
        geometry={hitGeometry}
        layers={EDITOR_LAYER}
        material={hitMaterial}
        onPointerDown={(event) => {
          if (disabled) return
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          swallowNextClick()
          onPointerDown(plane, event)
        }}
        onPointerEnter={(event) => {
          if (disabled) return
          event.stopPropagation()
          setHovered(true)
          document.body.style.cursor = 'move'
        }}
        onPointerLeave={() => {
          setHovered(false)
          if (document.body.style.cursor === 'move') document.body.style.cursor = ''
        }}
        renderOrder={GIZMO_HIT_RENDER_ORDER}
      />
    </group>
  )
}

function RotationHandle({
  axis,
  radius,
  tube,
  state,
  disabled,
  onPointerDown,
}: {
  axis: Axis
  radius: number
  tube: number
  state: BlockAxisVisualState
  disabled: boolean
  onPointerDown: (axis: Axis, event: ThreeEvent<PointerEvent>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const ringGeometry = useMemo(
    () => new TorusGeometry(radius, tube * 0.35, 8, 32, Math.PI / 2),
    [radius, tube],
  )
  const hitGeometry = useMemo(
    () => new TorusGeometry(radius, tube * 4.5, 8, 32, Math.PI / 2),
    [radius, tube],
  )
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  const hitMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: AXIS_COLORS[axis],
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    [axis],
  )
  useEffect(() => {
    material.color.set(hovered && state !== 'faded' ? PIVOT_HOVERED_COLOR : AXIS_COLORS[axis])
    material.opacity = state === 'faded' ? 0.14 : 1
  }, [axis, hovered, material, state])
  useEffect(
    () => () => {
      ringGeometry.dispose()
      hitGeometry.dispose()
      material.dispose()
      hitMaterial.dispose()
    },
    [hitGeometry, hitMaterial, material, ringGeometry],
  )
  const rotation: Point =
    axis === 'x' ? [0, -Math.PI / 2, 0] : axis === 'y' ? [Math.PI / 2, 0, 0] : [0, 0, 0]

  return (
    <group rotation={rotation}>
      <mesh
        geometry={ringGeometry}
        layers={EDITOR_LAYER}
        material={material}
        raycast={() => {}}
        renderOrder={GIZMO_RENDER_ORDER}
      />
      <mesh
        geometry={hitGeometry}
        layers={EDITOR_LAYER}
        material={hitMaterial}
        onPointerDown={(event) => {
          if (disabled) return
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          swallowNextClick()
          onPointerDown(axis, event)
        }}
        onPointerEnter={(event) => {
          if (disabled) return
          event.stopPropagation()
          setHovered(true)
          document.body.style.cursor = 'grab'
        }}
        onPointerLeave={() => {
          setHovered(false)
          if (document.body.style.cursor === 'grab') document.body.style.cursor = ''
        }}
        renderOrder={GIZMO_HIT_RENDER_ORDER}
      />
    </group>
  )
}

function LoopCutTarget({
  edgeId,
  start,
  end,
  radius,
  onHover,
  onPointerDown,
}: {
  edgeId: string
  start: Point
  end: Point
  radius: number
  onHover: (edgeId: string | null) => void
  onPointerDown: (edgeId: string, event: ThreeEvent<PointerEvent>) => void
}) {
  const placement = useMemo(() => {
    const from = new Vector3(...start)
    const to = new Vector3(...end)
    const direction = to.clone().sub(from)
    return {
      length: direction.length(),
      position: from.add(to).multiplyScalar(0.5),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize()),
    }
  }, [end, start])
  const geometry = useMemo(
    () => new CylinderGeometry(radius, radius, placement.length, 8),
    [placement.length, radius],
  )
  const material = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
      if (document.body.style.cursor === 'crosshair') document.body.style.cursor = ''
    },
    [geometry, material],
  )

  return (
    <group position={placement.position} quaternion={placement.quaternion}>
      <mesh
        geometry={geometry}
        layers={EDITOR_LAYER}
        material={material}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          swallowNextClick()
          onPointerDown(edgeId, event)
        }}
        onPointerEnter={(event) => {
          event.stopPropagation()
          onHover(edgeId)
          document.body.style.cursor = 'crosshair'
        }}
        onPointerLeave={() => {
          onHover(null)
          if (document.body.style.cursor === 'crosshair') document.body.style.cursor = ''
        }}
        renderOrder={1221}
      />
    </group>
  )
}

function LoopCutPreview({ segments }: { segments: [Point, Point][] }) {
  const geometry = useMemo(() => {
    const next = new BufferGeometry()
    next.setAttribute(
      'position',
      new Float32BufferAttribute(
        segments.flatMap(([from, to]) => [...from, ...to]),
        3,
      ),
    )
    return next
  }, [segments])
  const material = useMemo(
    () =>
      new LineBasicNodeMaterial({
        color: '#facc15',
        depthTest: false,
        depthWrite: false,
      }),
    [],
  )
  const line = useMemo(() => {
    const next = new LineSegments(geometry, material)
    next.frustumCulled = false
    next.layers.set(EDITOR_LAYER)
    next.raycast = () => {}
    next.renderOrder = 1220
    return next
  }, [geometry, material])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )
  return <primitive object={line} />
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  destructive = false,
  sound = 'tool-select',
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  destructive?: boolean
  sound?: BlockSfxAction | false
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <span className="group relative inline-flex">
      <button
        aria-label={label}
        className={cn(
          'flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors',
          active && 'bg-accent text-foreground hover:bg-accent/80',
          !active && !destructive && 'hover:bg-accent hover:text-foreground',
          destructive && 'hover:bg-destructive/10 hover:text-destructive',
          'disabled:cursor-not-allowed disabled:opacity-35',
        )}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          if (!onClick) return
          if (sound) playBlockSfx(sound)
          onClick()
        }}
        type="button"
      >
        {children}
      </button>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 font-medium text-[11px] text-background opacity-0 shadow-elevation-3 transition-opacity delay-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}

function ToolbarMenuItem({
  label,
  shortcut,
  active = false,
  disabled = false,
  destructive = false,
  sound = 'tool-select',
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  destructive?: boolean
  sound?: BlockSfxAction | false
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      aria-pressed={active || undefined}
      className={cn(
        'flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs transition-colors',
        active
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
        destructive && 'hover:bg-destructive/10 hover:text-destructive',
        'disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
      )}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        if (sound) playBlockSfx(sound)
        onClick()
      }}
      type="button"
    >
      {children}
      <span>{label}</span>
      {shortcut ? (
        <kbd className="ml-auto font-mono text-[10px] text-muted-foreground/70">{shortcut}</kbd>
      ) : null}
    </button>
  )
}

function ToolbarOperationItem({
  label,
  shortcut,
  active = false,
  disabled = false,
  controls,
  onClick,
  children,
}: {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  controls?: ReactNode
  onClick: () => void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex h-8 items-center rounded-md transition-colors',
        active ? 'bg-accent' : 'hover:bg-accent/70',
        disabled && 'opacity-35',
      )}
    >
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[11px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          onClick()
        }}
        type="button"
      >
        {children}
        <span className="whitespace-nowrap">{label}</span>
        {shortcut ? (
          <kbd className="ml-auto font-mono text-[9px] text-muted-foreground/70">{shortcut}</kbd>
        ) : null}
      </button>
      {controls ? <div className="flex shrink-0 items-center gap-1 pr-1">{controls}</div> : null}
    </div>
  )
}

function ToolbarPanelFrame({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div aria-label={label} className={cn(TOOLBAR_POPOVER_CLASS, className)} role="dialog">
      {children}
    </div>
  )
}

function LastOperationControls({
  operation,
  onChange,
}: {
  operation: BlockLastOperation
  onChange: (command: BlockCommand) => void
}) {
  const command = operation.command
  const input = (
    label: string,
    value: number,
    update: (value: number) => BlockCommand,
    options: { min?: number; max?: number; step?: number } = {},
  ) => (
    <label
      className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground"
      key={label}
    >
      <span>{label}</span>
      <input
        aria-label={label}
        className={cn(OPERATION_INPUT_CLASS, 'w-20')}
        max={options.max}
        min={options.min}
        onChange={(event) => onChange(update(Number(event.target.value)))}
        step={options.step ?? 0.01}
        type="number"
        value={Math.round(value * 1000) / 1000}
      />
    </label>
  )

  switch (command.type) {
    case 'translate-components':
      return (
        <div className="space-y-1">
          {(['X', 'Y', 'Z'] as const).map((axis, index) =>
            input(`${axis} distance`, command.delta[index]!, (value) => ({
              ...command,
              delta: command.delta.map((current, currentIndex) =>
                currentIndex === index ? value : current,
              ) as Point,
            })),
          )}
        </div>
      )
    case 'rotate-components':
      return input(
        'Angle',
        (command.angle * 180) / Math.PI,
        (value) => ({ ...command, angle: (value * Math.PI) / 180 }),
        { step: 1 },
      )
    case 'scale-components':
      return (
        <div className="space-y-1">
          {(['X', 'Y', 'Z'] as const).map((axis, index) =>
            input(`${axis} scale`, command.factors[index]!, (value) => ({
              ...command,
              factors: command.factors.map((current, currentIndex) =>
                currentIndex === index ? value : current,
              ) as Point,
            })),
          )}
        </div>
      )
    case 'extrude-faces':
      return input('Distance', command.distance, (distance) => ({ ...command, distance }))
    case 'inset-faces':
      return input('Amount', command.amount, (amount) => ({ ...command, amount }), {
        min: 0,
        max: 0.95,
      })
    case 'bevel-edges':
      return (
        <div className="space-y-1">
          {input('Width', command.width, (width) => ({ ...command, width }), { min: 0 })}
          {input(
            'Segments',
            command.segments,
            (segments) => ({ ...command, segments: Math.min(12, Math.max(1, segments)) }),
            { min: 1, max: 12, step: 1 },
          )}
        </div>
      )
    case 'loop-cut':
      return (
        <div className="space-y-1">
          {input('Position', command.factor, (factor) => ({ ...command, factor }), {
            min: 0.02,
            max: 0.98,
          })}
          {input(
            'Cuts',
            command.cuts ?? 1,
            (cuts) => ({ ...command, cuts: Math.min(32, Math.max(1, cuts)) }),
            { min: 1, max: 32, step: 1 },
          )}
        </div>
      )
    default:
      return null
  }
}

function LastOperationPanel({
  operation,
  onChange,
  onClose,
  onRepeat,
}: {
  operation: BlockLastOperation
  onChange: (command: BlockCommand) => void
  onClose: () => void
  onRepeat: () => void
}) {
  return (
    <div
      aria-label={`Adjust ${operation.label}`}
      className="pointer-events-auto absolute bottom-16 left-4 w-64 max-w-[calc(100%-2rem)] rounded-xl border border-border/50 bg-background/98 p-2 shadow-elevation-4 backdrop-blur-xl"
      onContextMenu={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      role="dialog"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="font-medium text-xs">{operation.label}</div>
          <div className="text-[10px] text-muted-foreground">Adjust Last Operation · F9</div>
        </div>
        <button
          aria-label="Close last operation panel"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <LastOperationControls onChange={onChange} operation={operation} />
      <button
        className="mt-2 flex h-7 w-full items-center justify-between rounded-md bg-accent/50 px-2 text-[11px] text-foreground hover:bg-accent"
        onClick={onRepeat}
        type="button"
      >
        <span>Repeat {operation.label}</span>
        <kbd className="font-mono text-[9px] text-muted-foreground">Shift+R</kbd>
      </button>
    </div>
  )
}

function BlockEditor({
  historyApi,
  node,
  readOnly,
  sceneApi,
  target,
  mirrorTarget,
}: {
  historyApi: SelectionAffordanceProps['historyApi']
  node: BlockNode
  readOnly: boolean
  sceneApi: SelectionAffordanceProps['sceneApi']
  target: Object3D
  mirrorTarget: boolean
}) {
  const { camera, gl } = useThree()
  const outerRef = useRef<Group>(null)
  const menuScaleRef = useRef<HTMLDivElement>(null)
  const menuWorldPositionRef = useRef(new Vector3())
  const editing = useInteractionScope(
    (state) => state.scope.kind === 'mesh-editing' && state.scope.nodeId === node.id,
  )
  const mode = useBlockEditSession((state) =>
    state.nodeId === node.id ? state.selection.mode : 'face',
  )
  const selectedIds = useBlockEditSession((state) =>
    state.nodeId === node.id ? state.selection.ids : EMPTY_COMPONENT_IDS,
  )
  const activeId = useBlockEditSession((state) =>
    state.nodeId === node.id ? state.selection.activeId : null,
  )
  const lastOperation = useBlockEditSession((state) =>
    state.nodeId === node.id ? state.lastOperation : null,
  )
  const [transformTool, setTransformTool] = useState<TransformTool>('transform')
  const [xray, setXray] = useState(false)
  const [previewTopology, setPreviewTopology] = useState<BlockTopology | null>(null)
  const [activeTransform, setActiveTransform] = useState<ActiveTransform | null>(null)
  const [transformNumericInput, setTransformNumericInput] = useState('')
  const [modalFeedbackMode, setModalFeedbackMode] = useState<BlockModalFeedbackMode>('free')
  const [activeFaceOperation, setActiveFaceOperation] = useState<BlockModalFaceOperation | null>(
    null,
  )
  const [faceOperationAxis, setFaceOperationAxis] = useState<BlockExtrudeAxis>('normal')
  const [faceOperationValue, setFaceOperationValue] = useState('')
  const [loopCutSegments, setLoopCutSegments] = useState<[Point, Point][] | null>(null)
  const [loopCutEdgeId, setLoopCutEdgeId] = useState<string | null>(null)
  const [loopCutSliding, setLoopCutSliding] = useState(false)
  const [loopCutCount, setLoopCutCount] = useState(1)
  const [loopCutFactor, setLoopCutFactor] = useState(0.5)
  const [bevelSegments, setBevelSegments] = useState(DEFAULT_BEVEL_SEGMENTS)
  const [bevelWidth, setBevelWidth] = useState(0)
  const [lastOperationPanelOpen, setLastOperationPanelOpen] = useState(false)
  const [toolbarPanel, setToolbarPanel] = useState<ToolbarPanel>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelDragRef = useRef<(() => void) | null>(null)
  const lastPointerClientRef = useRef<Vector2 | null>(null)
  const operationServices = useMemo(
    () => ({ historyApi, readOnly, sceneApi }),
    [historyApi, readOnly, sceneApi],
  )
  const displayTopology = previewTopology ?? node.topology
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selection = useMemo<BlockSelection>(() => ({ mode, ids: selectedIds }), [mode, selectedIds])
  const extent = topologyExtent(displayTopology)
  const componentRadius = Math.min(0.055, Math.max(0.022, extent * 0.011))
  const gizmoOrigin = selectionCentroid(displayTopology, selection)
  const gizmoDimensions = blockGizmoDimensions(extent)
  const gizmoLength = gizmoDimensions.length
  const gizmoRadius = gizmoDimensions.radius
  const rotationGizmoRadius = gizmoDimensions.rotationRadius
  const planeHandleSize = gizmoDimensions.planeHandleSize
  const planeHandleOffset = gizmoDimensions.planeHandleOffset
  const vertexById = useMemo(() => topologyVertexMap(displayTopology), [displayTopology])
  const menuAnchor = useMemo<Point>(() => {
    const xs = displayTopology.vertices.map((vertex) => vertex.position[0])
    const ys = displayTopology.vertices.map((vertex) => vertex.position[1])
    const zs = displayTopology.vertices.map((vertex) => vertex.position[2])
    return [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      Math.max(...ys) + blockToolbarOffset(extent, gizmoLength),
      (Math.min(...zs) + Math.max(...zs)) / 2,
    ]
  }, [displayTopology, extent, gizmoLength])

  useFrame((state) => {
    const outer = outerRef.current
    if (!outer) return
    if (mirrorTarget) {
      outer.position.copy(target.position)
      outer.quaternion.copy(target.quaternion)
      outer.scale.copy(target.scale)
    }
    if (menuScaleRef.current) {
      const menuWorldPosition = menuWorldPositionRef.current.set(...menuAnchor)
      outer.localToWorld(menuWorldPosition)
      menuScaleRef.current.style.transform = `scale(${getFloatingMenuScale(
        state.camera,
        menuWorldPosition,
      )})`
    }
  })

  const ownsEditSession = useCallback(() => {
    const scope = useInteractionScope.getState().scope
    return scope.kind === 'mesh-editing' && scope.nodeId === node.id
  }, [node.id])

  const endOwnedScope = useCallback(() => {
    useInteractionScope
      .getState()
      .endIf((scope) => scope.kind === 'mesh-editing' && scope.nodeId === node.id)
  }, [node.id])

  const exitEditMode = useCallback(() => {
    cancelDragRef.current?.()
    cancelDragRef.current = null
    useLiveNodeOverrides.getState().clear(node.id)
    sceneApi.markDirty(node.id)
    endOwnedScope()
    useBlockEditSession.getState().end(node.id)
    setPreviewTopology(null)
    setTransformTool('transform')
    setActiveTransform(null)
    setTransformNumericInput('')
    setModalFeedbackMode('free')
    setActiveFaceOperation(null)
    setFaceOperationValue('')
    setLoopCutSegments(null)
    setLoopCutEdgeId(null)
    setLoopCutSliding(false)
    setToolbarPanel(null)
    setError(null)
    playBlockSfx('finish')
  }, [endOwnedScope, node.id, sceneApi.markDirty])

  useEffect(
    () => () => {
      cancelDragRef.current?.()
      useLiveNodeOverrides.getState().clear(node.id)
      sceneApi.markDirty(node.id)
      endOwnedScope()
      useBlockEditSession.getState().end(node.id)
      if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
    },
    [endOwnedScope, node.id, sceneApi.markDirty],
  )

  useEffect(() => {
    if (editing) return
    cancelDragRef.current?.()
    cancelDragRef.current = null
    useLiveNodeOverrides.getState().clear(node.id)
    sceneApi.markDirty(node.id)
    setPreviewTopology(null)
    setToolbarPanel(null)
    setLoopCutSegments(null)
    setLoopCutEdgeId(null)
    setLoopCutSliding(false)
    setActiveTransform(null)
    setTransformNumericInput('')
    setModalFeedbackMode('free')
    setActiveFaceOperation(null)
    setFaceOperationValue('')
    useBlockEditSession.getState().end(node.id)
  }, [editing, node.id, sceneApi.markDirty])

  useEffect(() => {
    if (!editing) return
    const unpaintedSlotIds = new Set(
      unpaintedBlockMaterialSlotIds(node.topology, node.slots, node.slotNames),
    )
    if (unpaintedSlotIds.size === 0) return

    const restores: Array<{ mesh: Mesh; material: Material | Material[] }> = []
    const ownedMaterials: Material[] = []
    target.traverse((child) => {
      if (!(child instanceof Mesh)) return
      const slotIds = Array.isArray(child.userData.slotIds)
        ? (child.userData.slotIds as string[])
        : []
      if (!slotIds.some((slotId) => unpaintedSlotIds.has(slotId))) return
      const previousMaterial = child.material
      const sourceMaterials = Array.isArray(previousMaterial)
        ? previousMaterial
        : [previousMaterial]
      const nextMaterials = sourceMaterials.map((material, index) => {
        const slotId = slotIds[index]
        if (!(slotId && slotId !== BLOCK_BODY_SLOT_ID && unpaintedSlotIds.has(slotId))) {
          return material
        }
        const tinted = material.clone()
        if ('color' in tinted && tinted.color instanceof Color) tinted.color.set('#7768d8')
        ownedMaterials.push(tinted)
        return tinted
      })
      restores.push({ mesh: child, material: previousMaterial })
      child.material = Array.isArray(previousMaterial) ? nextMaterials : nextMaterials[0]!
    })

    return () => {
      for (const restore of restores) restore.mesh.material = restore.material
      for (const material of ownedMaterials) material.dispose()
    }
  }, [editing, node.slotNames, node.slots, node.topology, target])

  useEffect(() => {
    if (!editing) return
    const onToolCancel = () => {
      markToolCancelConsumed()
      if (toolbarPanel) {
        setToolbarPanel(null)
        playBlockSfx('cancel')
      } else if (cancelDragRef.current) cancelDragRef.current()
      else if (transformTool === 'loop-cut') {
        setTransformTool('transform')
        setLoopCutEdgeId(null)
        setLoopCutSegments(null)
        setError(null)
        playBlockSfx('cancel')
      } else exitEditMode()
    }
    emitter.on('tool:cancel', onToolCancel)
    return () => emitter.off('tool:cancel', onToolCancel)
  }, [editing, exitEditMode, toolbarPanel, transformTool])

  useEffect(() => {
    if (!(editing && toolbarPanel)) return
    const closePanel = (event: PointerEvent) => {
      const targetElement = event.target
      if (targetElement instanceof Node && menuScaleRef.current?.contains(targetElement)) return
      setToolbarPanel(null)
    }
    window.addEventListener('pointerdown', closePanel, true)
    return () => window.removeEventListener('pointerdown', closePanel, true)
  }, [editing, toolbarPanel])

  useEffect(() => {
    if (!editing) return
    const trackPointer = (event: PointerEvent) => {
      lastPointerClientRef.current = new Vector2(event.clientX, event.clientY)
    }
    window.addEventListener('pointermove', trackPointer, true)
    return () => window.removeEventListener('pointermove', trackPointer, true)
  }, [editing])

  useEffect(() => {
    if (!editing) return
    const onGridClick = () => {
      const scope = useInteractionScope.getState().scope
      if (scope.kind !== 'mesh-editing' || scope.nodeId !== node.id || cancelDragRef.current) return
      const session = useBlockEditSession.getState()
      const next = { mode, ids: [], activeId: null }
      if (!blockSelectionChanged(session.selection, next)) return
      session.setSelection(node.id, next)
      setError(null)
      playBlockSfx('component-select')
    }
    emitter.on('grid:click', onGridClick)
    return () => emitter.off('grid:click', onGridClick)
  }, [editing, mode, node.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null
      if (
        element?.tagName === 'INPUT' ||
        element?.tagName === 'TEXTAREA' ||
        element?.isContentEditable
      )
        return
      if (event.key === 'Tab') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (cancelDragRef.current) return
        if (editing) {
          exitEditMode()
        } else if (useInteractionScope.getState().scope.kind === 'idle') {
          const face = preferredFace(node.topology)
          useBlockEditSession.getState().begin(node.id, {
            mode: 'face',
            ids: face ? [face.id] : [],
            activeId: face?.id ?? null,
          })
          setTransformTool('transform')
          setToolbarPanel(null)
          setError(null)
          useInteractionScope.getState().begin(meshEditScope(node.id))
          triggerSFX('sfx:item-pick')
        }
        return
      }
      if (!editing) return
      const nextMode =
        event.key === '1'
          ? 'vertex'
          : event.key === '2'
            ? 'edge'
            : event.key === '3'
              ? 'face'
              : null
      if (!nextMode || cancelDragRef.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const converted = convertBlockSelection(
        node.topology,
        {
          mode,
          ids: selectedIds,
          activeId,
        },
        nextMode,
      )
      useBlockEditSession.getState().setSelection(node.id, converted)
      setError(null)
      playBlockSfx('tool-select')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeId, editing, exitEditMode, mode, node.id, node.topology, selectedIds])

  useEffect(() => {
    useBlockEditSession.getState().reconcileSelection(node.id, node.topology)
  }, [node.id, node.topology])

  const enterEditMode = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const face = preferredFace(node.topology)
    useBlockEditSession.getState().begin(node.id, {
      mode: 'face',
      ids: face ? [face.id] : [],
      activeId: face?.id ?? null,
    })
    setTransformTool('transform')
    setToolbarPanel(null)
    setError(null)
    useInteractionScope.getState().begin(meshEditScope(node.id))
    triggerSFX('sfx:item-pick')
  }

  const componentIsVisible = useCallback(
    (id: string, event: ThreeEvent<MouseEvent>) => {
      if (xray) return true
      target.updateWorldMatrix(true, true)
      const raycaster = new Raycaster()
      raycaster.ray.copy(event.ray)
      const nearestSurface = raycaster.intersectObject(target, true)[0]
      if (!nearestSurface) return true
      let worldPoint: Vector3 | null = null
      if (mode === 'vertex') {
        const vertex = displayTopology.vertices.find((entry) => entry.id === id)
        if (vertex) worldPoint = target.localToWorld(new Vector3(...vertex.position))
      } else if (mode === 'edge') {
        const edge = displayTopology.edges.find((entry) => entry.id === id)
        const vertices = topologyVertexMap(displayTopology)
        const start = edge ? vertices.get(edge.vertexIds[0]) : null
        const end = edge ? vertices.get(edge.vertexIds[1]) : null
        if (start && end) {
          const worldStart = target.localToWorld(new Vector3(...start))
          const worldEnd = target.localToWorld(new Vector3(...end))
          worldPoint = new Vector3()
          event.ray.distanceSqToSegment(worldStart, worldEnd, undefined, worldPoint)
        }
      } else {
        worldPoint = event.point.clone()
      }
      if (!worldPoint) return false
      const scale = target.getWorldScale(new Vector3())
      const tolerance = componentRadius * Math.max(scale.x, scale.y, scale.z) * 1.5
      return event.ray.origin.distanceTo(worldPoint) <= nearestSurface.distance + tolerance
    },
    [componentRadius, displayTopology, mode, target, xray],
  )

  const selectComponent = useCallback(
    (id: string, additive: boolean, event: ThreeEvent<MouseEvent>) => {
      if (!componentIsVisible(id, event)) return
      const next = selectBlockComponent({ mode, ids: selectedIds, activeId }, id, additive)
      if (!blockSelectionChanged({ mode, ids: selectedIds, activeId }, next)) return
      useBlockEditSession.getState().setSelection(node.id, next)
      setError(null)
      playBlockSfx('component-select')
    },
    [activeId, componentIsVisible, mode, node.id, selectedIds],
  )

  const switchMode = (nextMode: ComponentMode) => {
    if (cancelDragRef.current) return
    const converted = convertBlockSelection(
      displayTopology,
      { mode, ids: selectedIds, activeId },
      nextMode,
    )
    useBlockEditSession.getState().setSelection(node.id, converted)
    setToolbarPanel(null)
    setError(null)
  }

  const makeRay = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      const pointer = new Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      const raycaster = new Raycaster()
      raycaster.setFromCamera(pointer, camera)
      return raycaster.ray
    },
    [camera, gl.domElement],
  )

  const commitAdjustableOperation = useCallback(
    (baseTopology: BlockTopology, command: BlockCommand, label: string) => {
      const result = applyBlockCommand(baseTopology, command)
      if (!result.ok) {
        setError(result.error)
        return false
      }
      sceneApi.update(node.id, { topology: result.topology })
      const session = useBlockEditSession.getState()
      session.setSelection(node.id, {
        ...result.selection,
        activeId: result.selection.ids.at(-1) ?? null,
      })
      session.setLastOperation(
        node.id,
        recordCommittedBlockOperation(
          operationServices,
          node.id,
          label,
          baseTopology,
          command,
          result,
        ),
      )
      setLastOperationPanelOpen(true)
      setError(null)
      return true
    },
    [node.id, operationServices, sceneApi],
  )

  const beginKeyboardTransformModal = useCallback(
    (operation: 'translate' | 'rotate') => {
      if (!ownsEditSession() || selectedIds.length === 0 || cancelDragRef.current) return false
      const origin = selectionCentroid(displayTopology, selection)
      if (!origin) return false
      const pivotClient = localPointToClient(origin, target, camera, gl.domElement)
      if (!pivotClient) return false

      target.updateWorldMatrix(true, false)
      const originLocal = new Vector3(...origin)
      const worldOrigin = target.localToWorld(originLocal.clone())
      const startPointer =
        lastPointerClientRef.current?.clone() ?? pivotClient.clone().add(new Vector2(80, 0))
      const startRay = makeRay(startPointer.x, startPointer.y)
      const viewAxisWorld = camera.getWorldDirection(new Vector3()).normalize()
      const viewPlane = new Plane().setFromNormalAndCoplanarPoint(viewAxisWorld, worldOrigin)
      const startPlaneHit = startRay.intersectPlane(viewPlane, new Vector3()) ?? worldOrigin.clone()
      const targetWorldQuaternion = target.getWorldQuaternion(new Quaternion())
      const freeRotationAxis = viewAxisWorld
        .clone()
        .applyQuaternion(targetWorldQuaternion.clone().invert())
        .normalize()
      const baseTopology = displayTopology
      const baseSelection = selection
      let activeConstraint: Axis | PlaneAxes | null = null
      let latestTopology: BlockTopology | null = null
      let latestCommand: BlockCommand | null = null
      let latestMagnitude = 0
      let previousWrappedAngle = 0
      let accumulatedAngle = 0
      let lockedRotationInitialHit: Vector3 | null = null
      let lockedRotationPlane: Plane | null = null
      let lockedRotationWorldAxis: Vector3 | null = null
      let lockedTranslationInitialHit: Vector3 | null = null
      let lockedTranslationPlane: Plane | null = null
      let lastClientX = startPointer.x
      let lastClientY = startPointer.y
      let lastAltKey = false
      let lastShiftKey = false
      let effectivePointer = { x: startPointer.x, y: startPointer.y }
      let previousRawPointer = { x: startPointer.x, y: startPointer.y }
      let lastSnapValue: string | number | null = null
      let typedInput = ''

      const worldAxisFor = (axis: Axis) =>
        target
          .localToWorld(originLocal.clone().add(new Vector3(...AXIS_VECTORS[axis])))
          .sub(worldOrigin)
          .normalize()

      const updatePreview = (
        clientX: number,
        clientY: number,
        altKey: boolean,
        precision: boolean,
      ) => {
        lastClientX = clientX
        lastClientY = clientY
        lastAltKey = altKey
        lastShiftKey = precision
        const ray = makeRay(clientX, clientY)
        const numericValue = blockTransformNumericValue(typedInput, operation)
        let command: BlockCommand
        let snapValue: string | number

        if (operation === 'translate') {
          let delta: Point
          if (activeConstraint && isAxisConstraint(activeConstraint)) {
            const worldAxis = worldAxisFor(activeConstraint)
            const startParameter = closestAxisParameterToRay(worldOrigin, worldAxis, startRay)
            const currentParameter = closestAxisParameterToRay(worldOrigin, worldAxis, ray)
            const localPoint = target.worldToLocal(
              worldOrigin.clone().addScaledVector(worldAxis, currentParameter - startParameter),
            )
            const axisIndex = activeConstraint === 'x' ? 0 : activeConstraint === 'y' ? 1 : 2
            delta = blockAxisDelta(
              activeConstraint,
              blockPointerDistanceForAxis(
                activeConstraint,
                localPoint.getComponent(axisIndex) - origin[axisIndex],
              ),
            )
          } else if (
            activeConstraint &&
            isPlaneConstraint(activeConstraint) &&
            lockedTranslationInitialHit &&
            lockedTranslationPlane
          ) {
            const currentHit = ray.intersectPlane(lockedTranslationPlane, new Vector3())
            if (!currentHit) return
            const localPoint = target.worldToLocal(
              worldOrigin.clone().add(currentHit.sub(lockedTranslationInitialHit)),
            )
            delta = blockConstrainTranslationDelta(
              [localPoint.x - origin[0], localPoint.y - origin[1], localPoint.z - origin[2]],
              activeConstraint,
            )
          } else {
            const currentHit = ray.intersectPlane(viewPlane, new Vector3())
            if (!currentHit) return
            const localPoint = target.worldToLocal(
              worldOrigin.clone().add(currentHit.clone().sub(startPlaneHit)),
            )
            delta = [localPoint.x - origin[0], localPoint.y - origin[1], localPoint.z - origin[2]]
          }
          if (numericValue !== null) {
            delta = blockNumericDeltaForConstraint(activeConstraint ?? 'free', delta, numericValue)
          }
          const snapping = numericValue === null && isGridSnapActive() && !altKey
          if (snapping) {
            const step = blockPrecisionSnapStep(useEditor.getState().gridSnapStep, precision)
            if (step > 0) delta = delta.map((value) => Math.round(value / step) * step) as Point
          }
          const geometrySnap =
            numericValue === null && isMagneticSnapActive() && !altKey
              ? resolveBlockGeometrySnap(
                  baseTopology,
                  baseSelection,
                  delta,
                  activeConstraint ?? 'free',
                  geometrySnapThreshold(camera, worldOrigin, target, gl.domElement, extent),
                )
              : null
          if (geometrySnap) delta = geometrySnap.delta
          latestMagnitude = Math.hypot(...delta)
          const signedDistance =
            activeConstraint && isAxisConstraint(activeConstraint)
              ? delta[activeConstraint === 'x' ? 0 : activeConstraint === 'y' ? 1 : 2]
              : latestMagnitude
          setTransformNumericInput(
            typedInput || blockTransformDisplayValue('translate', signedDistance),
          )
          setModalFeedbackMode(
            typedInput
              ? 'exact'
              : geometrySnap
                ? 'geometry'
                : precision
                  ? 'precision'
                  : snapping
                    ? 'grid'
                    : 'free',
          )
          snapValue = geometrySnap
            ? `${geometrySnap.kind}:${geometrySnap.targetId}`
            : delta.join(':')
          if ((snapping || geometrySnap) && latestMagnitude > 1e-6 && snapValue !== lastSnapValue) {
            playBlockSfx('move-step')
          }
          command = { type: 'translate-components', selection: baseSelection, delta }
        } else {
          let wrappedAngle: number
          if (
            activeConstraint?.length === 1 &&
            lockedRotationInitialHit &&
            lockedRotationPlane &&
            lockedRotationWorldAxis
          ) {
            const currentHit = ray.intersectPlane(lockedRotationPlane, new Vector3())
            if (!currentHit) return
            const lockedAngle = lockedRotationAngleFromHits(
              worldOrigin,
              lockedRotationInitialHit,
              currentHit,
              lockedRotationWorldAxis,
            )
            if (lockedAngle === null) {
              if (currentHit.distanceToSquared(worldOrigin) > 1e-6) {
                lockedRotationInitialHit = currentHit.clone()
              }
              wrappedAngle = 0
            } else {
              wrappedAngle = lockedAngle
            }
          } else {
            wrappedAngle = blockRotationPointerAngle(
              pivotClient,
              startPointer,
              new Vector2(clientX, clientY),
            )
          }
          accumulatedAngle += unwrapRotationDelta(previousWrappedAngle, wrappedAngle)
          previousWrappedAngle = wrappedAngle
          let angle = accumulatedAngle
          if (numericValue !== null) angle = numericValue
          const snapping = numericValue === null && isAngleSnapActive() && !altKey
          if (snapping) {
            const step =
              (blockPrecisionSnapStep(ROTATION_SNAP_ANGLE_DEGREES, precision) * Math.PI) / 180
            angle = Math.round(angle / step) * step
          }
          latestMagnitude = Math.abs(angle)
          setTransformNumericInput(typedInput || blockTransformDisplayValue('rotate', angle))
          setModalFeedbackMode(
            typedInput ? 'exact' : precision ? 'precision' : snapping ? 'angle' : 'free',
          )
          snapValue = angle
          if (snapping && latestMagnitude > 1e-6 && snapValue !== lastSnapValue) {
            playBlockSfx('rotate-step')
          }
          command = {
            type: 'rotate-components',
            selection: baseSelection,
            pivot: origin,
            axis:
              activeConstraint && isAxisConstraint(activeConstraint)
                ? AXIS_VECTORS[activeConstraint]
                : (freeRotationAxis.toArray() as Point),
            angle,
          }
        }

        lastSnapValue = snapValue
        const result = applyBlockCommand(baseTopology, command)
        if (!result.ok) {
          setError(result.error)
          return
        }
        latestTopology = result.topology
        latestCommand = command
        setPreviewTopology(result.topology)
        useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
        sceneApi.markDirty(node.id)
        setError(null)
      }

      const complete = (commit: boolean) => {
        useLiveNodeOverrides.getState().clear(node.id)
        sceneApi.markDirty(node.id)
        setPreviewTopology(null)
        setActiveTransform(null)
        setTransformNumericInput('')
        setModalFeedbackMode('free')
        if (commit && latestTopology && latestCommand && latestMagnitude > 1e-6) {
          commitAdjustableOperation(
            baseTopology,
            latestCommand,
            operation === 'translate' ? 'Move' : 'Rotate',
          )
          playBlockSfx('finish')
        } else if (!commit) {
          playBlockSfx('cancel')
        }
        if (ownsEditSession()) useInteractionScope.getState().begin(meshEditScope(node.id))
        swallowNextClick()
      }

      const onMove = (pointerEvent: PointerEvent) => {
        lastPointerClientRef.current = new Vector2(pointerEvent.clientX, pointerEvent.clientY)
        effectivePointer = blockAccumulatePrecisionPointer(
          effectivePointer,
          previousRawPointer,
          pointerEvent,
          pointerEvent.shiftKey,
        )
        previousRawPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY }
        updatePreview(
          effectivePointer.x,
          effectivePointer.y,
          pointerEvent.altKey,
          pointerEvent.shiftKey,
        )
      }
      const onPointerDown = (pointerEvent: PointerEvent, finish: (commit: boolean) => void) => {
        if (pointerEvent.button !== 0 && pointerEvent.button !== 2) return
        pointerEvent.preventDefault()
        pointerEvent.stopImmediatePropagation()
        finish(pointerEvent.button === 0)
      }
      const onKeyDown = (keyboardEvent: KeyboardEvent, finish: (commit: boolean) => void) => {
        const element = keyboardEvent.target as HTMLElement | null
        if (
          element?.tagName === 'INPUT' ||
          element?.tagName === 'TEXTAREA' ||
          element?.isContentEditable
        )
          return
        const constraint = blockTransformConstraintFromKey(
          keyboardEvent.key,
          operation === 'translate' && keyboardEvent.shiftKey,
        )
        if (constraint) {
          keyboardEvent.preventDefault()
          keyboardEvent.stopImmediatePropagation()
          activeConstraint = constraint
          if (operation === 'rotate') {
            const axis = constraint as Axis
            lockedRotationWorldAxis = worldAxisFor(axis)
            lockedRotationPlane = new Plane().setFromNormalAndCoplanarPoint(
              lockedRotationWorldAxis,
              worldOrigin,
            )
            lockedRotationInitialHit = makeRay(lastClientX, lastClientY).intersectPlane(
              lockedRotationPlane,
              new Vector3(),
            )
            previousWrappedAngle = 0
            accumulatedAngle = 0
          } else if (isPlaneConstraint(constraint)) {
            const normalAxis = PLANE_NORMAL[constraint]
            lockedTranslationPlane = new Plane().setFromNormalAndCoplanarPoint(
              worldAxisFor(normalAxis),
              worldOrigin,
            )
            lockedTranslationInitialHit = startRay.intersectPlane(
              lockedTranslationPlane,
              new Vector3(),
            )
          } else {
            lockedTranslationPlane = null
            lockedTranslationInitialHit = null
          }
          setActiveTransform({ operation, constraint })
          lastSnapValue = null
          updatePreview(lastClientX, lastClientY, lastAltKey, lastShiftKey)
        } else {
          const nextInput = blockTransformNumericInputFromKey(typedInput, keyboardEvent.key)
          if (nextInput !== null) {
            keyboardEvent.preventDefault()
            keyboardEvent.stopImmediatePropagation()
            typedInput = nextInput
            setTransformNumericInput(nextInput)
            lastSnapValue = null
            updatePreview(lastClientX, lastClientY, lastAltKey, lastShiftKey)
          } else if (keyboardEvent.key === 'Enter') {
            keyboardEvent.preventDefault()
            keyboardEvent.stopImmediatePropagation()
            finish(true)
          } else if (keyboardEvent.key === 'Escape') {
            keyboardEvent.preventDefault()
            keyboardEvent.stopImmediatePropagation()
            finish(false)
          }
        }
      }
      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', operation))
      playBlockSfx('drag-start')
      setTransformTool('transform')
      setToolbarPanel(null)
      setActiveTransform({ operation, constraint: 'free' })
      setTransformNumericInput('')
      setModalFeedbackMode('free')
      setError(null)
      beginBlockModalSession({
        cancelRef: cancelDragRef,
        cursor: operation === 'translate' ? 'move' : 'crosshair',
        onFinish: complete,
        onKeyDown,
        onPointerDown,
        onPointerMove: onMove,
      })
      return true
    },
    [
      camera,
      commitAdjustableOperation,
      displayTopology,
      extent,
      gl.domElement,
      makeRay,
      node.id,
      ownsEditSession,
      selectedIds.length,
      selection,
      target,
      sceneApi.markDirty,
    ],
  )

  const beginTranslationDrag = useCallback(
    (constraint: Axis | PlaneAxes, event: ThreeEvent<PointerEvent>) => {
      if (!ownsEditSession() || selectedIds.length === 0 || cancelDragRef.current) return
      const origin = selectionCentroid(displayTopology, selection)
      if (!origin) return
      target.updateWorldMatrix(true, false)
      const originLocal = new Vector3(...origin)
      const worldOrigin = target.localToWorld(originLocal.clone())
      const normalAxis = isPlaneConstraint(constraint) ? PLANE_NORMAL[constraint] : constraint
      const localAxis = new Vector3(...AXIS_VECTORS[normalAxis])
      const worldAxis = target
        .localToWorld(originLocal.clone().add(localAxis))
        .sub(worldOrigin)
        .normalize()
      const dragPlane = isPlaneConstraint(constraint)
        ? new Plane().setFromNormalAndCoplanarPoint(worldAxis, worldOrigin)
        : null
      const initialPlaneHit = dragPlane ? event.ray.intersectPlane(dragPlane, new Vector3()) : null
      if (dragPlane && !initialPlaneHit) return
      const initialParameter = isAxisConstraint(constraint)
        ? closestAxisParameterToRay(worldOrigin, worldAxis, event.ray)
        : 0
      const axisIndex = normalAxis === 'x' ? 0 : normalAxis === 'y' ? 1 : 2
      const baseTopology = displayTopology
      const baseSelection = selection
      const previousInputDragging = useViewer.getState().inputDragging
      const previousCursor = document.body.style.cursor
      let latestTopology: BlockTopology | null = null
      let latestDelta: Point = [0, 0, 0]
      let lastSnapDelta: string | null = null
      let finished = false
      let effectivePointer = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }
      let previousRawPointer = { ...effectivePointer }

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'translate'))
      playBlockSfx('drag-start')
      useViewer.getState().setInputDragging(true)
      setActiveTransform({ operation: 'translate', constraint })
      setTransformNumericInput('0')
      setModalFeedbackMode('free')
      document.body.style.cursor = 'grabbing'

      const onMove = (pointerEvent: PointerEvent) => {
        effectivePointer = blockAccumulatePrecisionPointer(
          effectivePointer,
          previousRawPointer,
          pointerEvent,
          pointerEvent.shiftKey,
        )
        previousRawPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY }
        const ray = makeRay(effectivePointer.x, effectivePointer.y)
        let delta: Point
        if (dragPlane && initialPlaneHit) {
          const currentHit = ray.intersectPlane(dragPlane, new Vector3())
          if (!currentHit) return
          const localPoint = target.worldToLocal(
            worldOrigin.clone().add(currentHit.sub(initialPlaneHit)),
          )
          delta = [localPoint.x - origin[0], localPoint.y - origin[1], localPoint.z - origin[2]]
          delta[axisIndex] = 0
        } else {
          delta = [0, 0, 0]
          const parameter = closestAxisParameterToRay(worldOrigin, worldAxis, ray)
          const worldPoint = worldOrigin
            .clone()
            .addScaledVector(worldAxis, parameter - initialParameter)
          const localPoint = target.worldToLocal(worldPoint)
          delta[axisIndex] = blockPointerDistanceForAxis(
            normalAxis,
            localPoint.getComponent(axisIndex) - originLocal.getComponent(axisIndex),
          )
        }
        const snapping = isGridSnapActive() && !pointerEvent.altKey
        if (snapping) {
          const step = blockPrecisionSnapStep(
            useEditor.getState().gridSnapStep,
            pointerEvent.shiftKey,
          )
          if (step > 0) {
            delta = delta.map((value) => Math.round(value / step) * step) as Point
          }
        }
        const geometrySnap =
          isMagneticSnapActive() && !pointerEvent.altKey
            ? resolveBlockGeometrySnap(
                baseTopology,
                baseSelection,
                delta,
                constraint,
                geometrySnapThreshold(camera, worldOrigin, target, gl.domElement, extent),
              )
            : null
        if (geometrySnap) delta.splice(0, 3, ...geometrySnap.delta)
        const snapDelta = delta.join(':')
        const magnitude = Math.hypot(...delta)
        setTransformNumericInput(
          blockTransformDisplayValue(
            'translate',
            isAxisConstraint(constraint) ? delta[axisIndex] : Math.hypot(...delta),
          ),
        )
        setModalFeedbackMode(
          geometrySnap
            ? 'geometry'
            : pointerEvent.shiftKey
              ? 'precision'
              : snapping
                ? 'grid'
                : 'free',
        )
        const activeSnap = geometrySnap
          ? `${geometrySnap.kind}:${geometrySnap.targetId}`
          : snapDelta
        if ((snapping || geometrySnap) && magnitude > 1e-6 && activeSnap !== lastSnapDelta) {
          lastSnapDelta = activeSnap
          playBlockSfx('move-step')
        } else if (!(snapping || geometrySnap)) {
          lastSnapDelta = null
        }
        const result = applyBlockCommand(baseTopology, {
          type: 'translate-components',
          selection: baseSelection,
          delta,
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        latestDelta = delta
        latestTopology = result.topology
        setPreviewTopology(result.topology)
        useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
        sceneApi.markDirty(node.id)
      }

      const finish = (commit: boolean) => {
        if (finished) return
        finished = true
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerCancel)
        window.removeEventListener('blur', onPointerCancel)
        cancelDragRef.current = null
        useLiveNodeOverrides.getState().clear(node.id)
        sceneApi.markDirty(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        document.body.style.cursor = previousCursor
        setPreviewTopology(null)
        setActiveTransform(null)
        setTransformNumericInput('')
        setModalFeedbackMode('free')
        if (commit && latestTopology && Math.hypot(...latestDelta) > 1e-6) {
          commitAdjustableOperation(
            baseTopology,
            { type: 'translate-components', selection: baseSelection, delta: latestDelta },
            'Move',
          )
          playBlockSfx('finish')
        } else if (!commit) {
          playBlockSfx('cancel')
        }
        if (ownsEditSession()) {
          useInteractionScope.getState().begin(meshEditScope(node.id))
        }
        swallowNextClick()
      }
      const onPointerUp = () => finish(true)
      const onPointerCancel = () => finish(false)
      cancelDragRef.current = onPointerCancel
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onPointerUp, { once: true })
      window.addEventListener('pointercancel', onPointerCancel, { once: true })
      window.addEventListener('blur', onPointerCancel, { once: true })
    },
    [
      camera,
      commitAdjustableOperation,
      displayTopology,
      extent,
      gl.domElement,
      makeRay,
      node.id,
      ownsEditSession,
      selectedIds.length,
      selection,
      target,
      sceneApi.markDirty,
    ],
  )

  const beginRotationDrag = useCallback(
    (axis: Axis, event: ThreeEvent<PointerEvent>) => {
      if (!ownsEditSession() || selectedIds.length === 0 || cancelDragRef.current) return
      const origin = selectionCentroid(displayTopology, selection)
      if (!origin) return
      target.updateWorldMatrix(true, false)
      const originLocal = new Vector3(...origin)
      const worldOrigin = target.localToWorld(originLocal.clone())
      const localAxis = new Vector3(...AXIS_VECTORS[axis])
      const worldAxis = target
        .localToWorld(originLocal.clone().add(localAxis))
        .sub(worldOrigin)
        .normalize()
      const initialVector = event.point
        .clone()
        .sub(worldOrigin)
        .projectOnPlane(worldAxis)
        .normalize()
      if (initialVector.lengthSq() < 1e-6) return
      const rotationPlane = new Plane().setFromNormalAndCoplanarPoint(worldAxis, worldOrigin)
      const baseTopology = displayTopology
      const baseSelection = selection
      const previousInputDragging = useViewer.getState().inputDragging
      const previousCursor = document.body.style.cursor
      let previousWrappedAngle = 0
      let accumulatedAngle = 0
      let latestAngle = 0
      let lastSnapAngle: number | null = null
      let latestTopology: BlockTopology | null = null
      let finished = false
      let effectivePointer = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }
      let previousRawPointer = { ...effectivePointer }

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'rotate'))
      playBlockSfx('drag-start')
      useViewer.getState().setInputDragging(true)
      setActiveTransform({ operation: 'rotate', constraint: axis })
      setTransformNumericInput('0')
      setModalFeedbackMode('free')
      document.body.style.cursor = 'grabbing'

      const onMove = (pointerEvent: PointerEvent) => {
        effectivePointer = blockAccumulatePrecisionPointer(
          effectivePointer,
          previousRawPointer,
          pointerEvent,
          pointerEvent.shiftKey,
        )
        previousRawPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY }
        const hit = makeRay(effectivePointer.x, effectivePointer.y).intersectPlane(
          rotationPlane,
          new Vector3(),
        )
        if (!hit) return
        const currentVector = hit.sub(worldOrigin).projectOnPlane(worldAxis)
        if (currentVector.lengthSq() < 1e-6) return
        currentVector.normalize()
        const wrappedAngle = signedAngleAroundAxis(initialVector, currentVector, worldAxis)
        accumulatedAngle += unwrapRotationDelta(previousWrappedAngle, wrappedAngle)
        previousWrappedAngle = wrappedAngle
        let angle = accumulatedAngle
        const snapping = !pointerEvent.altKey && isAngleSnapActive()
        if (snapping) {
          const step =
            (blockPrecisionSnapStep(ROTATION_SNAP_ANGLE_DEGREES, pointerEvent.shiftKey) * Math.PI) /
            180
          angle = Math.round(angle / step) * step
        }
        if (snapping && Math.abs(angle) > 1e-6 && angle !== lastSnapAngle) {
          lastSnapAngle = angle
          playBlockSfx('rotate-step')
        } else if (!snapping) {
          lastSnapAngle = null
        }
        setTransformNumericInput(blockTransformDisplayValue('rotate', angle))
        setModalFeedbackMode(pointerEvent.shiftKey ? 'precision' : snapping ? 'angle' : 'free')
        const result = applyBlockCommand(baseTopology, {
          type: 'rotate-components',
          selection: baseSelection,
          pivot: origin,
          axis: AXIS_VECTORS[axis],
          angle,
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        latestAngle = angle
        latestTopology = result.topology
        setPreviewTopology(result.topology)
        useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
        sceneApi.markDirty(node.id)
      }

      const finish = (commit: boolean) => {
        if (finished) return
        finished = true
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerCancel)
        window.removeEventListener('blur', onPointerCancel)
        cancelDragRef.current = null
        useLiveNodeOverrides.getState().clear(node.id)
        sceneApi.markDirty(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        document.body.style.cursor = previousCursor
        setPreviewTopology(null)
        setActiveTransform(null)
        setTransformNumericInput('')
        setModalFeedbackMode('free')
        if (commit && latestTopology && Math.abs(latestAngle) > 1e-6) {
          commitAdjustableOperation(
            baseTopology,
            {
              type: 'rotate-components',
              selection: baseSelection,
              pivot: origin,
              axis: AXIS_VECTORS[axis],
              angle: latestAngle,
            },
            'Rotate',
          )
          playBlockSfx('finish')
        } else if (!commit) {
          playBlockSfx('cancel')
        }
        if (ownsEditSession()) {
          useInteractionScope.getState().begin(meshEditScope(node.id))
        }
        swallowNextClick()
      }
      const onPointerUp = () => finish(true)
      const onPointerCancel = () => finish(false)
      cancelDragRef.current = onPointerCancel
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onPointerUp, { once: true })
      window.addEventListener('pointercancel', onPointerCancel, { once: true })
      window.addEventListener('blur', onPointerCancel, { once: true })
    },
    [
      commitAdjustableOperation,
      displayTopology,
      makeRay,
      node.id,
      ownsEditSession,
      selectedIds.length,
      selection,
      target,
      sceneApi.markDirty,
    ],
  )

  const beginScaleDrag = useCallback(
    (axis: Axis, event: ThreeEvent<PointerEvent>) => {
      if (!ownsEditSession() || selectedIds.length === 0 || cancelDragRef.current) return
      const origin = selectionCentroid(displayTopology, selection)
      if (!origin) return
      target.updateWorldMatrix(true, false)
      const originLocal = new Vector3(...origin)
      const worldOrigin = target.localToWorld(originLocal.clone())
      const localAxis = new Vector3(...AXIS_VECTORS[axis])
      const worldAxis = target
        .localToWorld(originLocal.clone().add(localAxis))
        .sub(worldOrigin)
        .normalize()
      const initialParameter = closestAxisParameterToRay(worldOrigin, worldAxis, event.ray)
      const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
      const baseTopology = displayTopology
      const baseSelection = selection
      const previousInputDragging = useViewer.getState().inputDragging
      const previousCursor = document.body.style.cursor
      let latestFactor = 1
      let lastSnapFactor: number | null = null
      let latestTopology: BlockTopology | null = null
      let finished = false
      let effectivePointer = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }
      let previousRawPointer = { ...effectivePointer }

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'scale'))
      playBlockSfx('drag-start')
      useViewer.getState().setInputDragging(true)
      setActiveTransform({ operation: 'scale', constraint: axis })
      setTransformNumericInput('1')
      setModalFeedbackMode('free')
      document.body.style.cursor = 'grabbing'

      const onMove = (pointerEvent: PointerEvent) => {
        effectivePointer = blockAccumulatePrecisionPointer(
          effectivePointer,
          previousRawPointer,
          pointerEvent,
          pointerEvent.shiftKey,
        )
        previousRawPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY }
        const parameter = closestAxisParameterToRay(
          worldOrigin,
          worldAxis,
          makeRay(effectivePointer.x, effectivePointer.y),
        )
        const worldPoint = worldOrigin
          .clone()
          .addScaledVector(worldAxis, parameter - initialParameter)
        const localPoint = target.worldToLocal(worldPoint)
        const distance = localPoint.getComponent(axisIndex) - originLocal.getComponent(axisIndex)
        const snapStep =
          !pointerEvent.altKey && isGridSnapActive()
            ? blockPrecisionSnapStep(useEditor.getState().gridSnapStep, pointerEvent.shiftKey)
            : 0
        const factor = blockScaleFactorFromDrag(distance, gizmoLength, snapStep)
        setTransformNumericInput(blockTransformDisplayValue('scale', factor))
        setModalFeedbackMode(pointerEvent.shiftKey ? 'precision' : snapStep > 0 ? 'grid' : 'free')
        if (snapStep > 0 && Math.abs(factor - 1) > 1e-6 && factor !== lastSnapFactor) {
          lastSnapFactor = factor
          playBlockSfx('resize-step')
        } else if (snapStep === 0) {
          lastSnapFactor = null
        }
        const result = applyBlockCommand(baseTopology, {
          type: 'scale-components',
          selection: baseSelection,
          pivot: origin,
          factors: blockScaleFactors(axis, factor),
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        latestFactor = factor
        latestTopology = result.topology
        setPreviewTopology(result.topology)
        useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
        sceneApi.markDirty(node.id)
        setError(null)
      }

      const finish = (commit: boolean) => {
        if (finished) return
        finished = true
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerCancel)
        window.removeEventListener('blur', onPointerCancel)
        cancelDragRef.current = null
        useLiveNodeOverrides.getState().clear(node.id)
        sceneApi.markDirty(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        document.body.style.cursor = previousCursor
        setPreviewTopology(null)
        setActiveTransform(null)
        setTransformNumericInput('')
        setModalFeedbackMode('free')
        if (commit && latestTopology && Math.abs(latestFactor - 1) > 1e-6) {
          commitAdjustableOperation(
            baseTopology,
            {
              type: 'scale-components',
              selection: baseSelection,
              pivot: origin,
              factors: blockScaleFactors(axis, latestFactor),
            },
            'Scale',
          )
          playBlockSfx('finish')
        } else if (!commit) {
          playBlockSfx('cancel')
        }
        if (ownsEditSession()) {
          useInteractionScope.getState().begin(meshEditScope(node.id))
        }
        swallowNextClick()
      }
      const onPointerUp = () => finish(true)
      const onPointerCancel = () => finish(false)
      cancelDragRef.current = onPointerCancel
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onPointerUp, { once: true })
      window.addEventListener('pointercancel', onPointerCancel, { once: true })
      window.addEventListener('blur', onPointerCancel, { once: true })
    },
    [
      displayTopology,
      commitAdjustableOperation,
      gizmoLength,
      makeRay,
      node.id,
      ownsEditSession,
      selectedIds.length,
      selection,
      target,
      sceneApi.markDirty,
    ],
  )

  const beginUniformScaleModal = useCallback(() => {
    if (!ownsEditSession() || selectedIds.length === 0 || cancelDragRef.current) return false
    const origin = selectionCentroid(displayTopology, selection)
    if (!origin) return false
    const pivotClient = localPointToClient(origin, target, camera, gl.domElement)
    if (!pivotClient) return false

    const fallbackDistance = Math.max(80, gizmoLength * 96)
    const startPointer =
      lastPointerClientRef.current?.clone() ??
      pivotClient.clone().add(new Vector2(fallbackDistance, 0))
    const initialDistance = Math.max(24, pivotClient.distanceTo(startPointer))
    const baseTopology = displayTopology
    const baseSelection = selection
    let latestFactor = 1
    let lastSnapFactor: number | null = null
    let latestTopology: BlockTopology | null = null
    let activeConstraint: BlockTransformConstraint = 'uniform'
    let typedInput = ''
    let lastClientX = startPointer.x
    let lastClientY = startPointer.y
    let lastAltKey = false
    let lastShiftKey = false
    let effectivePointer = { x: startPointer.x, y: startPointer.y }
    let previousRawPointer = { ...effectivePointer }

    const updatePreview = (
      clientX: number,
      clientY: number,
      altKey: boolean,
      precision: boolean,
    ) => {
      lastClientX = clientX
      lastClientY = clientY
      lastAltKey = altKey
      lastShiftKey = precision
      const pointer = new Vector2(clientX, clientY)
      const distance = pointer.distanceTo(pivotClient) - initialDistance
      const numericValue = blockTransformNumericValue(typedInput, 'scale')
      const snapStep =
        numericValue === null && !altKey && isGridSnapActive()
          ? blockPrecisionSnapStep(useEditor.getState().gridSnapStep, precision)
          : 0
      const factor = numericValue ?? blockScaleFactorFromDrag(distance, initialDistance, snapStep)
      if (snapStep > 0 && Math.abs(factor - 1) > 1e-6 && factor !== lastSnapFactor) {
        lastSnapFactor = factor
        playBlockSfx('resize-step')
      } else if (snapStep === 0) {
        lastSnapFactor = null
      }
      const result = applyBlockCommand(baseTopology, {
        type: 'scale-components',
        selection: baseSelection,
        pivot: origin,
        factors: blockScaleFactorsForConstraint(activeConstraint, factor),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      latestFactor = factor
      setTransformNumericInput(typedInput || blockTransformDisplayValue('scale', factor))
      setModalFeedbackMode(
        typedInput ? 'exact' : precision ? 'precision' : snapStep > 0 ? 'grid' : 'free',
      )
      latestTopology = result.topology
      setPreviewTopology(result.topology)
      useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
      sceneApi.markDirty(node.id)
      setError(null)
    }

    const complete = (commit: boolean) => {
      useLiveNodeOverrides.getState().clear(node.id)
      sceneApi.markDirty(node.id)
      setPreviewTopology(null)
      setActiveTransform(null)
      setTransformNumericInput('')
      setModalFeedbackMode('free')
      if (commit && latestTopology && Math.abs(latestFactor - 1) > 1e-6) {
        commitAdjustableOperation(
          baseTopology,
          {
            type: 'scale-components',
            selection: baseSelection,
            pivot: origin,
            factors: blockScaleFactorsForConstraint(activeConstraint, latestFactor),
          },
          'Scale',
        )
        playBlockSfx('finish')
      } else if (!commit) {
        playBlockSfx('cancel')
      }
      if (ownsEditSession()) {
        useInteractionScope.getState().begin(meshEditScope(node.id))
      }
      swallowNextClick()
    }

    const onMove = (pointerEvent: PointerEvent) => {
      lastPointerClientRef.current = new Vector2(pointerEvent.clientX, pointerEvent.clientY)
      effectivePointer = blockAccumulatePrecisionPointer(
        effectivePointer,
        previousRawPointer,
        pointerEvent,
        pointerEvent.shiftKey,
      )
      previousRawPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY }
      updatePreview(
        effectivePointer.x,
        effectivePointer.y,
        pointerEvent.altKey,
        pointerEvent.shiftKey,
      )
    }
    const onPointerDown = (pointerEvent: PointerEvent, finish: (commit: boolean) => void) => {
      pointerEvent.preventDefault()
      pointerEvent.stopImmediatePropagation()
      finish(pointerEvent.button !== 2)
    }
    const onKeyDown = (keyboardEvent: KeyboardEvent, finish: (commit: boolean) => void) => {
      const element = keyboardEvent.target as HTMLElement | null
      if (
        element?.tagName === 'INPUT' ||
        element?.tagName === 'TEXTAREA' ||
        element?.isContentEditable
      )
        return
      const nextInput = blockTransformNumericInputFromKey(typedInput, keyboardEvent.key)
      const constraint = blockTransformConstraintFromKey(keyboardEvent.key, keyboardEvent.shiftKey)
      if (constraint) {
        keyboardEvent.preventDefault()
        keyboardEvent.stopImmediatePropagation()
        activeConstraint = constraint
        setActiveTransform({ operation: 'scale', constraint })
        lastSnapFactor = null
        updatePreview(lastClientX, lastClientY, lastAltKey, lastShiftKey)
      } else if (nextInput !== null) {
        keyboardEvent.preventDefault()
        keyboardEvent.stopImmediatePropagation()
        typedInput = nextInput
        setTransformNumericInput(nextInput)
        lastSnapFactor = null
        updatePreview(lastClientX, lastClientY, lastAltKey, lastShiftKey)
      } else if (keyboardEvent.key === 'Enter') {
        keyboardEvent.preventDefault()
        keyboardEvent.stopImmediatePropagation()
        finish(true)
      } else if (keyboardEvent.key === 'Escape') {
        keyboardEvent.preventDefault()
        keyboardEvent.stopImmediatePropagation()
        finish(false)
      }
    }
    useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'scale'))
    playBlockSfx('drag-start')
    setTransformTool('transform')
    setToolbarPanel(null)
    setActiveTransform({ operation: 'scale', constraint: 'uniform' })
    setTransformNumericInput('')
    setModalFeedbackMode('free')
    setError(null)
    beginBlockModalSession({
      cancelRef: cancelDragRef,
      cursor: 'nwse-resize',
      onFinish: complete,
      onKeyDown,
      onPointerDown,
      onPointerMove: onMove,
    })
    return true
  }, [
    camera,
    commitAdjustableOperation,
    displayTopology,
    gizmoLength,
    gl.domElement,
    node.id,
    ownsEditSession,
    selectedIds.length,
    selection,
    target,
    sceneApi.markDirty,
  ])

  const beginBevelDrag = useCallback(
    (edgeId: string, event: ThreeEvent<PointerEvent>) => {
      if (event.nativeEvent.button !== 0 || !ownsEditSession() || cancelDragRef.current) return
      if (!displayTopology.edges.some((edge) => edge.id === edgeId)) return
      const edgeIds = mode === 'edge' && selectedIds.includes(edgeId) ? [...selectedIds] : [edgeId]
      const baseTopology = displayTopology
      const startClientX = event.nativeEvent.clientX
      const startClientY = event.nativeEvent.clientY
      const viewportHeight = gl.domElement.clientHeight
      const previousInputDragging = useViewer.getState().inputDragging
      const previousCursor = document.body.style.cursor
      let activeSegments = bevelSegments
      let latestWidth = 0
      let lastWidthStep = 0
      let latestTopology: BlockTopology | null = null
      let latestSelection: BlockSelection | null = null
      let finished = false
      let effectivePointer = { x: startClientX, y: startClientY }
      let previousRawPointer = { ...effectivePointer }

      useBlockEditSession.getState().setSelection(node.id, {
        mode: 'edge',
        ids: edgeIds,
        activeId: edgeId,
      })
      setToolbarPanel(null)
      setError(null)
      setBevelWidth(0)
      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'bevel'))
      playBlockSfx('operation-start')
      useViewer.getState().setInputDragging(true)
      document.body.style.cursor = 'ew-resize'

      const updatePreview = (width: number, segments = activeSegments) => {
        if (width <= 1e-6) return false
        const result = applyBlockCommand(baseTopology, {
          type: 'bevel-edges',
          edgeIds,
          width,
          segments,
          profile: 0.5,
          clampOverlap: true,
        })
        if (!result.ok) {
          setError(result.error)
          return false
        }
        activeSegments = segments
        latestWidth = width
        setBevelWidth(width)
        latestTopology = result.topology
        latestSelection = result.selection
        setPreviewTopology(result.topology)
        useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
        sceneApi.markDirty(node.id)
        setError(null)
        return true
      }

      const onMove = (pointerEvent: PointerEvent) => {
        effectivePointer = blockAccumulatePrecisionPointer(
          effectivePointer,
          previousRawPointer,
          pointerEvent,
          pointerEvent.shiftKey,
        )
        previousRawPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY }
        const deltaX = effectivePointer.x - startClientX
        const deltaY = effectivePointer.y - startClientY
        if (Math.hypot(deltaX, deltaY) < 2) return
        const width = blockBevelWidthFromDrag(deltaX, deltaY, extent, viewportHeight)
        const widthStep = Math.floor(width / Math.max(0.01, extent * 0.025))
        if (widthStep > 0 && widthStep !== lastWidthStep) {
          lastWidthStep = widthStep
          playBlockSfx('resize-step')
        }
        updatePreview(width, activeSegments)
      }

      const onWheel = (wheelEvent: WheelEvent) => {
        const direction = consumeBlockGestureWheel(wheelEvent)
        if (direction === 0) return
        const segments = Math.min(12, Math.max(1, activeSegments + direction))
        if (segments === activeSegments) return
        activeSegments = segments
        setBevelSegments(segments)
        playBlockSfx('resize-step')
        if (latestWidth > 0) updatePreview(latestWidth, segments)
      }

      const finish = (commit: boolean) => {
        if (finished) return
        finished = true
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('wheel', onWheel, BLOCK_WHEEL_OPTIONS)
        window.removeEventListener('pointercancel', onPointerCancel)
        window.removeEventListener('blur', onPointerCancel)
        cancelDragRef.current = null
        useLiveNodeOverrides.getState().clear(node.id)
        sceneApi.markDirty(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        document.body.style.cursor = previousCursor
        setPreviewTopology(null)
        if (commit && latestTopology && latestSelection && latestWidth > 1e-6) {
          commitAdjustableOperation(
            baseTopology,
            {
              type: 'bevel-edges',
              edgeIds,
              width: latestWidth,
              segments: activeSegments,
              profile: 0.5,
              clampOverlap: true,
            },
            'Bevel',
          )
          playBlockSfx('operation-commit')
        } else if (!commit) {
          playBlockSfx('cancel')
        }
        if (ownsEditSession()) {
          useInteractionScope.getState().begin(meshEditScope(node.id))
        }
        swallowNextClick()
      }
      const onPointerUp = () => finish(true)
      const onPointerCancel = () => finish(false)
      cancelDragRef.current = onPointerCancel
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onPointerUp, { once: true })
      window.addEventListener('wheel', onWheel, BLOCK_WHEEL_OPTIONS)
      window.addEventListener('pointercancel', onPointerCancel, { once: true })
      window.addEventListener('blur', onPointerCancel, { once: true })
    },
    [
      bevelSegments,
      commitAdjustableOperation,
      displayTopology,
      extent,
      gl.domElement,
      mode,
      node.id,
      ownsEditSession,
      selectedIds,
      sceneApi.markDirty,
    ],
  )

  const previewLoopCut = useCallback((edgeId: string | null) => {
    if (cancelDragRef.current) return
    setLoopCutEdgeId(edgeId)
  }, [])

  useEffect(() => {
    if (!(editing && transformTool === 'loop-cut') || loopCutSliding) return
    if (!loopCutEdgeId) {
      setLoopCutSegments(null)
      setError(null)
      return
    }
    const segments = blockLoopCutSegments(node.topology, loopCutEdgeId, 0.5, loopCutCount)
    setLoopCutSegments(segments)
    setLoopCutFactor(0.5)
    setError(segments ? null : 'Loop cut requires a connected ring of quad faces')
  }, [editing, loopCutCount, loopCutEdgeId, loopCutSliding, node.topology, transformTool])

  useEffect(() => {
    if (transformTool === 'loop-cut' || loopCutSliding) return
    setLoopCutEdgeId(null)
    setLoopCutSegments(null)
    setLoopCutFactor(0.5)
  }, [loopCutSliding, transformTool])

  useEffect(() => {
    if (!(editing && transformTool === 'loop-cut' && !loopCutSliding)) return
    const onWheel = (event: WheelEvent) => {
      const direction = consumeBlockGestureWheel(event)
      if (direction === 0) return
      setLoopCutCount((current) => {
        const next = Math.min(32, Math.max(1, current + direction))
        if (next !== current) playBlockSfx('resize-step')
        return next
      })
    }
    const onPointerDown = (event: PointerEvent) => {
      if (resolveLoopCutPointerAction('choosing-ring', event.button) !== 'cancel') return
      event.preventDefault()
      event.stopImmediatePropagation()
      setTransformTool('transform')
      setLoopCutEdgeId(null)
      setLoopCutSegments(null)
      setError(null)
      playBlockSfx('cancel')
      swallowNextClick()
    }
    window.addEventListener('wheel', onWheel, BLOCK_WHEEL_OPTIONS)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('wheel', onWheel, BLOCK_WHEEL_OPTIONS)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [editing, loopCutSliding, transformTool])

  const beginLoopCutSlide = useCallback(
    (edgeId: string, event: ThreeEvent<PointerEvent>) => {
      if (
        resolveLoopCutPointerAction('choosing-ring', event.nativeEvent.button) !== 'begin-slide' ||
        !ownsEditSession() ||
        cancelDragRef.current
      )
        return
      const edge = node.topology.edges.find((entry) => entry.id === edgeId)
      const vertices = topologyVertexMap(node.topology)
      const start = edge ? vertices.get(edge.vertexIds[0]) : null
      const end = edge ? vertices.get(edge.vertexIds[1]) : null
      if (!(edge && start && end)) return
      target.updateWorldMatrix(true, false)
      const worldStart = target.localToWorld(new Vector3(...start))
      const worldEnd = target.localToWorld(new Vector3(...end))
      const worldDirection = worldEnd.clone().sub(worldStart)
      const worldLength = worldDirection.length()
      if (worldLength < 1e-6) return
      const worldAxis = worldDirection.normalize()
      const initialParameter = closestAxisParameterToRay(worldStart, worldAxis, event.ray)
      const baseTopology = node.topology
      const previousInputDragging = useViewer.getState().inputDragging
      const previousCursor = document.body.style.cursor
      let latestTopology: BlockTopology | null = null
      let latestSelection: BlockSelection | null = null
      let latestFactor = 0.5
      const activeCuts = loopCutCount
      let lastSnapFactor: number | null = null
      let finished = false
      let confirmationAttached = false
      let effectivePointer = { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY }
      let previousRawPointer = { ...effectivePointer }

      const updatePreview = (factor: number) => {
        const effectiveFactor = resolveLoopCutSlideFactor(activeCuts, factor)
        const result = applyBlockCommand(baseTopology, {
          type: 'loop-cut',
          edgeId,
          factor: effectiveFactor,
          cuts: activeCuts,
        })
        const segments = blockLoopCutSegments(baseTopology, edgeId, effectiveFactor, activeCuts)
        if (!result.ok || !segments) {
          setError(result.ok ? 'Could not preview loop cut' : result.error)
          return false
        }
        latestFactor = effectiveFactor
        latestTopology = result.topology
        latestSelection = result.selection
        setPreviewTopology(result.topology)
        setLoopCutSegments(segments)
        setLoopCutFactor(effectiveFactor)
        useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
        sceneApi.markDirty(node.id)
        setError(null)
        return true
      }
      if (!updatePreview(0.5)) return

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'loop-cut'))
      playBlockSfx('operation-start')
      useViewer.getState().setInputDragging(true)
      setLoopCutSliding(true)
      document.body.style.cursor = 'ew-resize'

      const onMove = (pointerEvent: PointerEvent) => {
        if (activeCuts > 1) return
        effectivePointer = blockAccumulatePrecisionPointer(
          effectivePointer,
          previousRawPointer,
          pointerEvent,
          pointerEvent.shiftKey,
        )
        previousRawPointer = { x: pointerEvent.clientX, y: pointerEvent.clientY }
        const parameter = closestAxisParameterToRay(
          worldStart,
          worldAxis,
          makeRay(effectivePointer.x, effectivePointer.y),
        )
        let factor = Math.min(
          0.98,
          Math.max(0.02, 0.5 + (parameter - initialParameter) / worldLength),
        )
        const snapping = isGridSnapActive() && !pointerEvent.altKey
        if (snapping) {
          const step = blockPrecisionSnapStep(
            useEditor.getState().gridSnapStep,
            pointerEvent.shiftKey,
          )
          if (step > 0)
            factor = Math.min(
              0.98,
              Math.max(0.02, (Math.round((factor * worldLength) / step) * step) / worldLength),
            )
        }
        if (snapping && factor !== lastSnapFactor) {
          lastSnapFactor = factor
          playBlockSfx('move-step')
        } else if (!snapping) {
          lastSnapFactor = null
        }
        updatePreview(factor)
      }

      const finish = (outcome: 'commit-current' | 'commit-centered' | 'cancel') => {
        if (finished) return
        if (outcome === 'commit-centered' && !updatePreview(0.5)) outcome = 'cancel'
        finished = true
        window.removeEventListener('pointermove', onMove)
        if (confirmationAttached) window.removeEventListener('pointerdown', onConfirm, true)
        window.removeEventListener('contextmenu', onContextMenu, true)
        window.removeEventListener('pointercancel', onPointerCancel)
        window.removeEventListener('blur', onPointerCancel)
        cancelDragRef.current = null
        useLiveNodeOverrides.getState().clear(node.id)
        sceneApi.markDirty(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        document.body.style.cursor = previousCursor
        setPreviewTopology(null)
        setLoopCutSegments(null)
        setLoopCutEdgeId(null)
        setLoopCutSliding(false)
        if (outcome !== 'cancel' && latestTopology && latestSelection && latestFactor > 0) {
          commitAdjustableOperation(
            baseTopology,
            {
              type: 'loop-cut',
              edgeId,
              factor: latestFactor,
              cuts: activeCuts,
            },
            'Loop Cut',
          )
          playBlockSfx('operation-commit')
        } else if (outcome === 'cancel') {
          playBlockSfx('cancel')
        }
        if (ownsEditSession()) {
          useInteractionScope.getState().begin(meshEditScope(node.id))
        }
        swallowNextClick()
      }
      const onConfirm = (pointerEvent: PointerEvent) => {
        const action = resolveLoopCutPointerAction('sliding', pointerEvent.button)
        if (action !== 'commit-current' && action !== 'commit-centered') return
        pointerEvent.preventDefault()
        pointerEvent.stopImmediatePropagation()
        finish(action)
      }
      const onContextMenu = (contextEvent: MouseEvent) => {
        contextEvent.preventDefault()
        contextEvent.stopImmediatePropagation()
      }
      const onPointerCancel = () => finish('cancel')
      cancelDragRef.current = onPointerCancel
      window.addEventListener('pointermove', onMove)
      window.addEventListener('contextmenu', onContextMenu, true)
      window.addEventListener('pointercancel', onPointerCancel, { once: true })
      window.addEventListener('blur', onPointerCancel, { once: true })
      queueMicrotask(() => {
        if (finished) return
        confirmationAttached = true
        window.addEventListener('pointerdown', onConfirm, true)
      })
    },
    [
      commitAdjustableOperation,
      loopCutCount,
      makeRay,
      node.id,
      node.topology,
      ownsEditSession,
      target,
      sceneApi.markDirty,
    ],
  )

  const beginFaceOperationModal = useBlockFaceOperation({
    camera,
    cancelRef: cancelDragRef,
    canvas: gl.domElement,
    closeToolbar: () => setToolbarPanel(null),
    commit: commitAdjustableOperation,
    displayTopology,
    extent,
    lastPointerClientRef,
    mode,
    nodeId: node.id,
    ownsEditSession,
    playSfx: playBlockSfx,
    sceneApi,
    selectedIds,
    selection,
    setActiveFaceOperation,
    setError,
    setFaceOperationAxis,
    setFaceOperationValue,
    setModalFeedbackMode,
    setPreviewTopology,
    setTransformNumericInput,
    target,
  })
  const commitCommand = (command: BlockCommand, operator: TopologyOperator) => {
    if (cancelDragRef.current) return
    useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', operator))
    const result = applyBlockCommand(node.topology, command)
    if (!result.ok) {
      useInteractionScope.getState().begin(meshEditScope(node.id))
      setError(result.error)
      return
    }
    sceneApi.update(node.id, { topology: result.topology })
    const session = useBlockEditSession.getState()
    session.setSelection(node.id, {
      ...result.selection,
      activeId: result.selection.ids.at(-1) ?? null,
    })
    session.setLastOperation(node.id, null)
    setLastOperationPanelOpen(false)
    setToolbarPanel(null)
    setError(null)
    if (ownsEditSession()) useInteractionScope.getState().begin(meshEditScope(node.id))
    playBlockSfx(operator === 'delete' ? 'delete' : 'operation-commit')
  }

  const extrudeSelectedFace = () => beginFaceOperationModal('extrude')

  const insetSelectedFace = () => beginFaceOperationModal('inset')

  const deleteSelection = () => {
    if (selectedIds.length === 0) return
    commitCommand({ type: 'delete-components', selection }, 'delete')
  }

  const mergeSelection = () => {
    if (mode !== 'vertex' || selectedIds.length < 2) return
    commitCommand({ type: 'merge-vertices', vertexIds: selectedIds }, 'merge')
  }

  const dissolveSelection = () => {
    if (mode === 'edge' && selectedIds.length > 0) {
      commitCommand({ type: 'dissolve-edges', edgeIds: selectedIds }, 'dissolve')
    } else if (mode === 'face' && selectedIds.length > 1) {
      commitCommand({ type: 'dissolve-faces', faceIds: selectedIds }, 'dissolve')
    }
  }

  const adjustLastOperation = (command: BlockCommand) => {
    if (!lastOperation || cancelDragRef.current) return
    const replacement = replaceCommittedBlockOperation(operationServices, lastOperation, command)
    if (!replacement.ok) {
      setError(replacement.error)
      setLastOperationPanelOpen(false)
      return
    }
    const session = useBlockEditSession.getState()
    session.setLastOperation(node.id, replacement.operation)
    session.setSelection(node.id, {
      ...replacement.operation.resultSelection,
      activeId: replacement.operation.resultSelection.ids.at(-1) ?? null,
    })
    setError(null)
    playBlockSfx('resize-step')
  }

  const repeatLastOperation = () => {
    if (!lastOperation || cancelDragRef.current) return
    const repeated = repeatCommittedBlockOperation(operationServices, lastOperation, {
      mode,
      ids: selectedIds,
      activeId,
    })
    if (!repeated.ok) {
      setError(repeated.error)
      return
    }
    const session = useBlockEditSession.getState()
    session.setLastOperation(node.id, repeated.operation)
    session.setSelection(node.id, {
      ...repeated.operation.resultSelection,
      activeId: repeated.operation.resultSelection.ids.at(-1) ?? null,
    })
    setLastOperationPanelOpen(true)
    setError(null)
    playBlockSfx('operation-commit')
  }

  const updateSelection = (next: BlockSelectionState) => {
    if (!blockSelectionChanged({ mode, ids: selectedIds, activeId }, next)) return
    useBlockEditSession.getState().setSelection(node.id, next)
    setError(null)
    playBlockSfx('component-select')
  }

  const selectAll = () =>
    updateSelection(selectAllBlockComponents(displayTopology, { mode, ids: selectedIds, activeId }))
  const invertSelection = () =>
    updateSelection(invertBlockSelection(displayTopology, { mode, ids: selectedIds, activeId }))
  const clearSelection = () =>
    updateSelection(clearBlockSelection({ mode, ids: selectedIds, activeId }))

  const keyboardActionsRef = useRef({
    beginKeyboardTransformModal,
    beginUniformScaleModal,
    canBevel: mode === 'edge',
    clearSelection,
    deleteSelection,
    dissolveSelection,
    extrudeSelectedFace,
    hasSelection: selectedIds.length > 0,
    hasLastOperation: Boolean(lastOperation),
    insetSelectedFace,
    invertSelection,
    mergeSelection,
    selectAll,
    repeatLastOperation,
    showLastOperation: () => setLastOperationPanelOpen(true),
  })
  keyboardActionsRef.current = {
    beginKeyboardTransformModal,
    beginUniformScaleModal,
    canBevel: mode === 'edge',
    clearSelection,
    deleteSelection,
    dissolveSelection,
    extrudeSelectedFace,
    hasSelection: selectedIds.length > 0,
    hasLastOperation: Boolean(lastOperation),
    insetSelectedFace,
    invertSelection,
    mergeSelection,
    selectAll,
    repeatLastOperation,
    showLastOperation: () => setLastOperationPanelOpen(true),
  }

  useEffect(() => {
    if (!editing) return
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null
      if (
        element?.tagName === 'INPUT' ||
        element?.tagName === 'TEXTAREA' ||
        element?.isContentEditable ||
        cancelDragRef.current
      )
        return
      const key = event.key.toLowerCase()
      const actions = keyboardActionsRef.current
      let handled = true
      if (event.key === 'F9') {
        if (actions.hasLastOperation) actions.showLastOperation()
        else handled = false
      } else if (key === 'b' && (event.ctrlKey || event.metaKey)) {
        if (actions.canBevel) {
          playBlockSfx('tool-select')
          setBevelSegments(DEFAULT_BEVEL_SEGMENTS)
          setTransformTool('bevel')
          setToolbarPanel(null)
        }
      } else if (key === 'a') {
        if (event.altKey) actions.clearSelection()
        else actions.selectAll()
      } else if (key === 'i' && (event.ctrlKey || event.metaKey)) {
        actions.invertSelection()
      } else if (key === 'g') {
        if (actions.hasSelection) actions.beginKeyboardTransformModal('translate')
      } else if (key === 'e') {
        actions.extrudeSelectedFace()
      } else if (key === 'i') {
        actions.insetSelectedFace()
      } else if (key === 'r' && event.shiftKey) {
        if (actions.hasLastOperation) actions.repeatLastOperation()
        else handled = false
      } else if (key === 'r') {
        if (event.ctrlKey || event.metaKey) {
          playBlockSfx('tool-select')
          setTransformTool('loop-cut')
          setToolbarPanel(null)
        } else if (actions.hasSelection) {
          actions.beginKeyboardTransformModal('rotate')
        }
      } else if (key === 's') {
        if (actions.hasSelection) {
          if (!actions.beginUniformScaleModal()) {
            playBlockSfx('tool-select')
            setTransformTool('transform')
          }
        }
      } else if (key === 'm') {
        actions.mergeSelection()
      } else if (key === 'd') {
        actions.dissolveSelection()
      } else if (event.key === 'Delete' || key === 'x') {
        actions.deleteSelection()
      } else {
        handled = false
      }
      if (!handled) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [editing])

  const moveNode = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    useEditor.getState().setMovingNode(node)
    useViewer.getState().setSelection({ selectedIds: [] })
    triggerSFX('sfx:item-pick')
  }
  const deleteNode = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    useViewer.getState().setSelection({ selectedIds: [] })
    sceneApi.delete(node.id)
    playBlockSfx('delete')
  }

  const selectionStatus = formatBlockSelectionStatus(mode, selectedIds.length)
  const operationAvailability = blockOperationAvailability(mode, selectedIds.length)
  const loopCutActive = transformTool === 'loop-cut'
  const bevelActive = transformTool === 'bevel'
  const gizmoTransform: BlockActiveTransform | null =
    activeTransform ??
    (activeFaceOperation && faceOperationAxis !== 'normal'
      ? { operation: 'translate', constraint: faceOperationAxis }
      : null)
  const gizmoDisabled = Boolean(activeTransform || activeFaceOperation)
  const componentStatus = activeFaceOperation
    ? blockModalFaceOperationStatus(
        activeFaceOperation,
        faceOperationValue || '0',
        modalFeedbackMode,
        faceOperationAxis,
      )
    : activeTransform
      ? blockModalTransformStatus(activeTransform, transformNumericInput, modalFeedbackMode)
      : blockComponentStatus({
          mode,
          selectedCount: selectedIds.length,
          tool: transformTool,
          loopCutCount,
          loopCutFactor,
          bevelSegments,
          bevelWidth,
        })

  return (
    <group ref={outerRef}>
      {editing ? (
        <>
          {mode === 'vertex'
            ? displayTopology.vertices.map((vertex) => (
                <VertexHandle
                  active={activeId === vertex.id}
                  id={vertex.id}
                  key={vertex.id}
                  onSelect={selectComponent}
                  position={vertex.position}
                  radius={componentRadius}
                  selected={selectedSet.has(vertex.id)}
                  xray={xray}
                />
              ))
            : null}
          {mode === 'edge'
            ? displayTopology.edges.map((edge) => {
                const start = vertexById.get(edge.vertexIds[0])
                const end = vertexById.get(edge.vertexIds[1])
                return start && end ? (
                  <EdgeHandle
                    active={activeId === edge.id}
                    end={end}
                    id={edge.id}
                    key={edge.id}
                    onPointerDown={transformTool === 'bevel' ? beginBevelDrag : undefined}
                    onSelect={selectComponent}
                    radius={componentRadius * 0.42}
                    selected={selectedSet.has(edge.id)}
                    start={start}
                    xray={xray}
                  />
                ) : null
              })
            : null}
          {mode === 'face'
            ? displayTopology.faces.map((face) => {
                const center = blockFaceCentroid(displayTopology, face)
                return (
                  <group key={face.id}>
                    <FaceHandle
                      active={activeId === face.id}
                      face={face}
                      interactive={!xray}
                      onSelect={selectComponent}
                      selected={selectedSet.has(face.id)}
                      topology={displayTopology}
                      xray={xray}
                    />
                    {xray && center ? (
                      <VertexHandle
                        active={activeId === face.id}
                        id={face.id}
                        onSelect={selectComponent}
                        position={center}
                        radius={componentRadius * 0.72}
                        selected={selectedSet.has(face.id)}
                        xray
                      />
                    ) : null}
                  </group>
                )
              })
            : null}
          {gizmoOrigin && transformTool === 'transform' ? (
            <group position={gizmoOrigin}>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <AxisTransformHandle
                  axis={axis}
                  disabled={gizmoDisabled}
                  key={axis}
                  length={gizmoLength}
                  moveState={blockAxisVisualState(gizmoTransform, 'translate', axis)}
                  onMovePointerDown={beginTranslationDrag}
                  onScalePointerDown={beginScaleDrag}
                  radius={gizmoRadius}
                  scaleState={blockAxisVisualState(gizmoTransform, 'scale', axis)}
                />
              ))}
              {(Object.keys(PLANE_NORMAL) as PlaneAxes[]).map((plane) => (
                <PlaneMoveHandle
                  disabled={gizmoDisabled}
                  key={plane}
                  offset={planeHandleOffset}
                  onPointerDown={beginTranslationDrag}
                  plane={plane}
                  size={planeHandleSize}
                  state={blockPlaneVisualState(gizmoTransform, plane)}
                />
              ))}
              {(['x', 'y', 'z'] as const).map((axis) => (
                <RotationHandle
                  axis={axis}
                  disabled={gizmoDisabled}
                  key={`rotate-${axis}`}
                  onPointerDown={beginRotationDrag}
                  radius={rotationGizmoRadius}
                  state={blockAxisVisualState(gizmoTransform, 'rotate', axis)}
                  tube={gizmoRadius}
                />
              ))}
            </group>
          ) : null}
          {transformTool === 'loop-cut' && !loopCutSliding
            ? displayTopology.edges.map((edge) => {
                const start = vertexById.get(edge.vertexIds[0])
                const end = vertexById.get(edge.vertexIds[1])
                return start && end ? (
                  <LoopCutTarget
                    edgeId={edge.id}
                    end={end}
                    key={edge.id}
                    onHover={previewLoopCut}
                    onPointerDown={beginLoopCutSlide}
                    radius={componentRadius * 3.2}
                    start={start}
                  />
                ) : null
              })
            : null}
          {loopCutSegments ? <LoopCutPreview segments={loopCutSegments} /> : null}
        </>
      ) : null}

      <Html
        center
        position={menuAnchor}
        style={{ pointerEvents: 'auto', touchAction: 'none', userSelect: 'none' }}
        zIndexRange={[70, 0]}
      >
        <div
          className="flex flex-col items-center gap-1"
          onContextMenu={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          ref={menuScaleRef}
          style={{ transformOrigin: 'center center' }}
        >
          {editing ? (
            <div className={cn(FLOATING_PANEL_CLASS, 'relative')}>
              <ToolbarButton
                active={transformTool === 'transform'}
                disabled={Boolean(selectedIds.length === 0 || cancelDragRef.current)}
                label="Transform selected components (G / R / S)"
                onClick={() => setTransformTool('transform')}
              >
                <Move3D className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton
                active={mode === 'vertex'}
                disabled={Boolean(cancelDragRef.current)}
                label="Vertex select (1)"
                onClick={() => switchMode('vertex')}
              >
                <CircleDot className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton
                active={mode === 'edge'}
                disabled={Boolean(cancelDragRef.current)}
                label="Edge select (2)"
                onClick={() => switchMode('edge')}
              >
                <ScanLine className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton
                active={mode === 'face'}
                disabled={Boolean(cancelDragRef.current)}
                label="Face select (3)"
                onClick={() => switchMode('face')}
              >
                <Square className="h-4 w-4" />
              </ToolbarButton>
              <span className="min-w-14 whitespace-nowrap px-1.5 text-center font-mono text-[10px] text-foreground tracking-[0.08em]">
                {selectionStatus}
              </span>

              <div className="relative">
                <button
                  aria-expanded={toolbarPanel === 'operations'}
                  aria-haspopup="dialog"
                  className={cn(
                    'flex h-7 min-w-24 items-center justify-center gap-1.5 rounded-md px-2 text-xs transition-colors disabled:opacity-35',
                    toolbarPanel === 'operations'
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  onClick={(event) => {
                    event.stopPropagation()
                    playBlockSfx('tool-select')
                    setToolbarPanel((current) => (current === 'operations' ? null : 'operations'))
                  }}
                  type="button"
                >
                  {loopCutActive ? <Rows3 className="h-4 w-4" /> : null}
                  {bevelActive ? <Scaling className="h-4 w-4" /> : null}
                  <span>{loopCutActive ? 'LOOP CUT' : bevelActive ? 'BEVEL' : 'Operations'}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {toolbarPanel === 'operations' ? (
                  <ToolbarPanelFrame label="Mesh operations" className="w-80 p-1.5">
                    <div className="space-y-0.5">
                      <ToolbarOperationItem
                        disabled={selectedIds.length === 0}
                        label="Move selection"
                        onClick={() => beginKeyboardTransformModal('translate')}
                        shortcut="G"
                      >
                        <Move3D className="h-4 w-4" />
                      </ToolbarOperationItem>
                      <ToolbarOperationItem
                        disabled={selectedIds.length === 0}
                        label="Rotate selection"
                        onClick={() => beginKeyboardTransformModal('rotate')}
                        shortcut="R"
                      >
                        <Rotate3D className="h-4 w-4" />
                      </ToolbarOperationItem>
                      <ToolbarOperationItem
                        disabled={!operationAvailability.extrude}
                        label="Extrude selected faces"
                        onClick={extrudeSelectedFace}
                        shortcut="E"
                      >
                        <ArrowUpFromLine className="h-4 w-4" />
                      </ToolbarOperationItem>
                      <ToolbarOperationItem
                        disabled={!operationAvailability.inset}
                        label="Inset selected faces"
                        onClick={insetSelectedFace}
                        shortcut="I"
                      >
                        <Square className="h-4 w-4" />
                      </ToolbarOperationItem>
                      <ToolbarOperationItem
                        active={loopCutActive}
                        controls={
                          <input
                            aria-label="Loop cut count"
                            className={OPERATION_INPUT_CLASS}
                            max="32"
                            min="1"
                            onChange={(event) =>
                              setLoopCutCount(
                                Math.min(32, Math.max(1, Number(event.target.value) || 1)),
                              )
                            }
                            step="1"
                            type="number"
                            value={loopCutCount}
                          />
                        }
                        label="Loop Cut and Slide"
                        onClick={() => {
                          playBlockSfx('tool-select')
                          setTransformTool('loop-cut')
                          setToolbarPanel(null)
                        }}
                        shortcut="Ctrl+R"
                      >
                        <Rows3 className="h-4 w-4" />
                      </ToolbarOperationItem>
                      <ToolbarOperationItem
                        disabled={!operationAvailability.merge}
                        label="Merge vertices"
                        onClick={mergeSelection}
                        shortcut="M"
                      >
                        <CircleDot className="h-4 w-4" />
                      </ToolbarOperationItem>
                      <ToolbarOperationItem
                        disabled={!operationAvailability.dissolve}
                        label="Dissolve selection"
                        onClick={dissolveSelection}
                        shortcut="D"
                      >
                        <ScanLine className="h-4 w-4" />
                      </ToolbarOperationItem>
                      <ToolbarOperationItem
                        active={bevelActive}
                        disabled={!operationAvailability.bevel}
                        label="Bevel selected edges"
                        onClick={() => {
                          playBlockSfx('tool-select')
                          setBevelSegments(DEFAULT_BEVEL_SEGMENTS)
                          setTransformTool('bevel')
                          setToolbarPanel(null)
                        }}
                        shortcut="Ctrl+B"
                      >
                        <Scaling className="h-4 w-4" />
                      </ToolbarOperationItem>
                    </div>
                  </ToolbarPanelFrame>
                ) : null}
              </div>

              {lastOperation ? (
                <ToolbarButton
                  active={lastOperationPanelOpen}
                  label={`Adjust ${lastOperation.label} (F9)`}
                  onClick={() => setLastOperationPanelOpen((open) => !open)}
                >
                  <Rotate3D className="h-4 w-4" />
                </ToolbarButton>
              ) : null}

              <ToolbarButton label="Finish edit mode (Tab)" onClick={exitEditMode} sound={false}>
                <Check className="h-4 w-4" />
              </ToolbarButton>

              <div className="relative">
                <ToolbarButton
                  active={toolbarPanel === 'selection'}
                  label="Selection and more"
                  onClick={() =>
                    setToolbarPanel((current) => (current === 'selection' ? null : 'selection'))
                  }
                >
                  <Ellipsis className="h-4 w-4" />
                </ToolbarButton>
                {toolbarPanel === 'selection' ? (
                  <ToolbarPanelFrame
                    label="Selection actions"
                    className="right-0 left-auto w-60 translate-x-0"
                  >
                    <div className="space-y-1">
                      <ToolbarMenuItem
                        label="Select all"
                        onClick={selectAll}
                        shortcut="A"
                        sound={false}
                      >
                        <CircleDot className="h-4 w-4" />
                      </ToolbarMenuItem>
                      <ToolbarMenuItem
                        label="Invert selection"
                        onClick={invertSelection}
                        shortcut="Ctrl+I"
                        sound={false}
                      >
                        <ScanLine className="h-4 w-4" />
                      </ToolbarMenuItem>
                      <ToolbarMenuItem
                        disabled={selectedIds.length === 0}
                        label="Clear selection"
                        onClick={clearSelection}
                        shortcut="Alt+A"
                        sound={false}
                      >
                        <XIcon className="h-4 w-4" />
                      </ToolbarMenuItem>
                      <ToolbarMenuItem
                        active={xray}
                        label="X-ray selection"
                        onClick={() => setXray((value) => !value)}
                      >
                        {xray ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </ToolbarMenuItem>
                      <div className="my-1 h-px bg-border/50" />
                      <ToolbarMenuItem
                        destructive
                        disabled={selectedIds.length === 0}
                        label="Delete components"
                        onClick={deleteSelection}
                        shortcut="X"
                        sound={false}
                      >
                        <Trash2 className="h-4 w-4" />
                      </ToolbarMenuItem>
                    </div>
                  </ToolbarPanelFrame>
                ) : null}
              </div>
            </div>
          ) : (
            <NodeActionMenu onDelete={deleteNode} onEditMesh={enterEditMode} onMove={moveNode} />
          )}
          {editing && (error || componentStatus) ? (
            <div
              className={cn(
                'whitespace-nowrap rounded-full border border-border/50 bg-background/90 px-3 py-1 font-medium text-[10px] shadow-sm backdrop-blur-md',
                error ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {error ?? componentStatus}
            </div>
          ) : null}
        </div>
      </Html>
      {editing && lastOperation && lastOperationPanelOpen ? (
        <Html
          calculatePosition={(_object, _camera, size) => [size.width / 2, size.height / 2]}
          fullscreen
          style={{ pointerEvents: 'none' }}
          zIndexRange={[80, 0]}
        >
          <LastOperationPanel
            onChange={adjustLastOperation}
            onClose={() => setLastOperationPanelOpen(false)}
            onRepeat={repeatLastOperation}
            operation={lastOperation}
          />
        </Html>
      ) : null}
    </group>
  )
}

const BlockSelectionAffordance = ({
  historyApi,
  node,
  readOnly,
  sceneApi,
}: SelectionAffordanceProps) => {
  const blockNode = node.type === 'block' ? node : null
  const [target, setTarget] = useState<Object3D | null>(null)
  const nodeId = blockNode?.id ?? null
  const scopeAllowsAffordance = useInteractionScope(
    (state) =>
      state.scope.kind === 'idle' ||
      (state.scope.kind === 'mesh-editing' && state.scope.nodeId === nodeId),
  )

  useEffect(() => {
    if (!nodeId) {
      setTarget(null)
      return
    }
    let frameId = 0
    const resolve = () => {
      const next = sceneRegistry.nodes.get(nodeId) ?? null
      setTarget((current) => (current === next ? current : next))
      if (!next) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => window.cancelAnimationFrame(frameId)
  }, [nodeId])

  if (!blockNode || !target || !scopeAllowsAffordance) return null
  const mount = target.parent ?? target
  return createPortal(
    <BlockEditor
      historyApi={historyApi}
      mirrorTarget={mount !== target}
      node={blockNode}
      readOnly={readOnly}
      sceneApi={sceneApi}
      target={target}
    />,
    mount,
    undefined,
  )
}

export default BlockSelectionAffordance

'use client'

import {
  type AnyNodeId,
  type BlockFace,
  type BlockNode,
  type BlockTopology,
  emitter,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  cn,
  EDITOR_LAYER,
  getFloatingMenuScale,
  isAngleSnapActive,
  isGridSnapActive,
  markToolCancelConsumed,
  meshEditScope,
  NodeActionMenu,
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
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  LineSegments,
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
  blockSelectionVertexIds,
} from './commands'
import useBlockEditSession from './edit-session'
import { triangulateBlockFace } from './geometry'
import { BLOCK_WHEEL_OPTIONS, consumeBlockGestureWheel } from './gesture-wheel'
import { type BlockSfxAction, blockSfx } from './interaction-sfx'
import { resolveLoopCutPointerAction, resolveLoopCutSlideFactor } from './loop-cut-interaction'
import { signedAngleAroundAxis, unwrapRotationDelta } from './rotation-drag'
import {
  type BlockSelectionState,
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

type ComponentMode = BlockSelection['mode']
type Point = [number, number, number]
type Axis = 'x' | 'y' | 'z'
type PlaneAxes = 'xy' | 'xz' | 'yz'
type TransformOperation = 'translate' | 'rotate' | 'scale'
type ActiveTransform = {
  operation: TransformOperation
  constraint: Axis | 'uniform'
}
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

function selectionCentroid(topology: BlockTopology, selection: BlockSelection): Point | null {
  const ids = blockSelectionVertexIds(topology, selection)
  const positions = topology.vertices
    .filter((vertex) => ids.has(vertex.id))
    .map((vertex) => vertex.position)
  if (positions.length === 0) return null
  const total = positions.reduce<Point>(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]],
    [0, 0, 0],
  )
  return [total[0] / positions.length, total[1] / positions.length, total[2] / positions.length]
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

function localPointToClient(
  point: Point,
  target: Object3D,
  camera: Camera,
  canvas: HTMLCanvasElement,
): Vector2 | null {
  target.updateWorldMatrix(true, false)
  const projected = target.localToWorld(new Vector3(...point)).project(camera)
  if (![projected.x, projected.y, projected.z].every(Number.isFinite)) return null
  const rect = canvas.getBoundingClientRect()
  return new Vector2(
    rect.left + ((projected.x + 1) / 2) * rect.width,
    rect.top + ((1 - projected.y) / 2) * rect.height,
  )
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
  moveActive,
  scaleActive,
  onMovePointerDown,
  onScalePointerDown,
}: {
  axis: Axis
  length: number
  radius: number
  moveActive: boolean
  scaleActive: boolean
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
      moveActive || hovered === 'translate' ? PIVOT_HOVERED_COLOR : AXIS_COLORS[axis],
    )
    scaleMaterial.color.set(
      scaleActive || hovered === 'scale' ? PIVOT_HOVERED_COLOR : AXIS_COLORS[axis],
    )
  }, [axis, hovered, moveActive, moveMaterial, scaleActive, scaleMaterial])
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
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          swallowNextClick()
          onMovePointerDown(axis, event)
        }}
        onPointerEnter={(event) => {
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
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          swallowNextClick()
          onScalePointerDown(axis, event)
        }}
        onPointerEnter={(event) => {
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
  active,
  onPointerDown,
}: {
  plane: PlaneAxes
  offset: number
  size: number
  active: boolean
  onPointerDown: (axis: Axis, event: ThreeEvent<PointerEvent>) => void
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
    material.color.set(active || hovered ? PIVOT_HOVERED_COLOR : AXIS_COLORS[normalAxis])
  }, [active, hovered, material, normalAxis])
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
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          swallowNextClick()
          onPointerDown(normalAxis, event)
        }}
        onPointerEnter={(event) => {
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
  active,
  onPointerDown,
}: {
  axis: Axis
  radius: number
  tube: number
  active: boolean
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
    material.color.set(active || hovered ? PIVOT_HOVERED_COLOR : AXIS_COLORS[axis])
  }, [active, axis, hovered, material])
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
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          swallowNextClick()
          onPointerDown(axis, event)
        }}
        onPointerEnter={(event) => {
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

function BlockEditor({
  node,
  target,
  mirrorTarget,
}: {
  node: BlockNode
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
  const [transformTool, setTransformTool] = useState<TransformTool>('transform')
  const [xray, setXray] = useState(false)
  const [previewTopology, setPreviewTopology] = useState<BlockTopology | null>(null)
  const [activeTransform, setActiveTransform] = useState<ActiveTransform | null>(null)
  const [loopCutSegments, setLoopCutSegments] = useState<[Point, Point][] | null>(null)
  const [loopCutEdgeId, setLoopCutEdgeId] = useState<string | null>(null)
  const [loopCutSliding, setLoopCutSliding] = useState(false)
  const [loopCutCount, setLoopCutCount] = useState(1)
  const [loopCutFactor, setLoopCutFactor] = useState(0.5)
  const [extrudeDistance, setExtrudeDistance] = useState('0.25')
  const [insetAmount, setInsetAmount] = useState('0.15')
  const [bevelSegments, setBevelSegments] = useState(DEFAULT_BEVEL_SEGMENTS)
  const [toolbarPanel, setToolbarPanel] = useState<ToolbarPanel>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelDragRef = useRef<(() => void) | null>(null)
  const lastPointerClientRef = useRef<Vector2 | null>(null)
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
    useScene.getState().markDirty(node.id)
    endOwnedScope()
    useBlockEditSession.getState().end(node.id)
    setPreviewTopology(null)
    setTransformTool('transform')
    setActiveTransform(null)
    setLoopCutSegments(null)
    setLoopCutEdgeId(null)
    setLoopCutSliding(false)
    setToolbarPanel(null)
    setError(null)
    playBlockSfx('finish')
  }, [endOwnedScope, node.id])

  useEffect(
    () => () => {
      cancelDragRef.current?.()
      useLiveNodeOverrides.getState().clear(node.id)
      useScene.getState().markDirty(node.id)
      endOwnedScope()
      useBlockEditSession.getState().end(node.id)
      if (document.body.style.cursor === 'grabbing') document.body.style.cursor = ''
    },
    [endOwnedScope, node.id],
  )

  useEffect(() => {
    if (editing) return
    cancelDragRef.current?.()
    cancelDragRef.current = null
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.getState().markDirty(node.id)
    setPreviewTopology(null)
    setToolbarPanel(null)
    setLoopCutSegments(null)
    setLoopCutEdgeId(null)
    setLoopCutSliding(false)
    setActiveTransform(null)
    useBlockEditSession.getState().end(node.id)
  }, [editing, node.id])

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
      useBlockEditSession.getState().setSelection(node.id, { mode, ids: [], activeId: null })
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

  const beginTranslationDrag = useCallback(
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
      let latestTopology: BlockTopology | null = null
      let latestDelta: Point = [0, 0, 0]
      let lastSnapDelta: string | null = null
      let finished = false

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'translate'))
      playBlockSfx('drag-start')
      useViewer.getState().setInputDragging(true)
      setActiveTransform({ operation: 'translate', constraint: axis })
      document.body.style.cursor = 'grabbing'

      const onMove = (pointerEvent: PointerEvent) => {
        const ray = makeRay(pointerEvent.clientX, pointerEvent.clientY)
        const delta: Point = [0, 0, 0]
        const parameter = closestAxisParameterToRay(worldOrigin, worldAxis, ray)
        const worldPoint = worldOrigin
          .clone()
          .addScaledVector(worldAxis, parameter - initialParameter)
        const localPoint = target.worldToLocal(worldPoint)
        delta[axisIndex] = localPoint.getComponent(axisIndex) - originLocal.getComponent(axisIndex)
        const snapping = isGridSnapActive() && !pointerEvent.altKey
        if (snapping) {
          const step = useEditor.getState().gridSnapStep
          if (step > 0) {
            delta[axisIndex] = Math.round(delta[axisIndex] / step) * step
          }
        }
        const snapDelta = delta.join(':')
        const magnitude = Math.hypot(...delta)
        if (snapping && magnitude > 1e-6 && snapDelta !== lastSnapDelta) {
          lastSnapDelta = snapDelta
          playBlockSfx('move-step')
        } else if (!snapping) {
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
        useScene.getState().markDirty(node.id)
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
        useScene.getState().markDirty(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        document.body.style.cursor = previousCursor
        setPreviewTopology(null)
        setActiveTransform(null)
        if (commit && latestTopology && Math.hypot(...latestDelta) > 1e-6) {
          useScene.getState().updateNode(node.id, { topology: latestTopology })
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
    [displayTopology, makeRay, node.id, ownsEditSession, selectedIds.length, selection, target],
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

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'rotate'))
      playBlockSfx('drag-start')
      useViewer.getState().setInputDragging(true)
      setActiveTransform({ operation: 'rotate', constraint: axis })
      document.body.style.cursor = 'grabbing'

      const onMove = (pointerEvent: PointerEvent) => {
        const hit = makeRay(pointerEvent.clientX, pointerEvent.clientY).intersectPlane(
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
          const step = (ROTATION_SNAP_ANGLE_DEGREES * Math.PI) / 180
          angle = Math.round(angle / step) * step
        }
        if (snapping && Math.abs(angle) > 1e-6 && angle !== lastSnapAngle) {
          lastSnapAngle = angle
          playBlockSfx('rotate-step')
        } else if (!snapping) {
          lastSnapAngle = null
        }
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
        useScene.getState().markDirty(node.id)
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
        useScene.getState().markDirty(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        document.body.style.cursor = previousCursor
        setPreviewTopology(null)
        setActiveTransform(null)
        if (commit && latestTopology && Math.abs(latestAngle) > 1e-6) {
          useScene.getState().updateNode(node.id, { topology: latestTopology })
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
    [displayTopology, makeRay, node.id, ownsEditSession, selectedIds.length, selection, target],
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

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'scale'))
      playBlockSfx('drag-start')
      useViewer.getState().setInputDragging(true)
      setActiveTransform({ operation: 'scale', constraint: axis })
      document.body.style.cursor = 'grabbing'

      const onMove = (pointerEvent: PointerEvent) => {
        const parameter = closestAxisParameterToRay(
          worldOrigin,
          worldAxis,
          makeRay(pointerEvent.clientX, pointerEvent.clientY),
        )
        const worldPoint = worldOrigin
          .clone()
          .addScaledVector(worldAxis, parameter - initialParameter)
        const localPoint = target.worldToLocal(worldPoint)
        const distance = localPoint.getComponent(axisIndex) - originLocal.getComponent(axisIndex)
        const snapStep =
          !pointerEvent.altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
        const factor = blockScaleFactorFromDrag(distance, gizmoLength, snapStep)
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
        useScene.getState().markDirty(node.id)
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
        useScene.getState().markDirty(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        document.body.style.cursor = previousCursor
        setPreviewTopology(null)
        setActiveTransform(null)
        if (commit && latestTopology && Math.abs(latestFactor - 1) > 1e-6) {
          useScene.getState().updateNode(node.id, { topology: latestTopology })
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
      gizmoLength,
      makeRay,
      node.id,
      ownsEditSession,
      selectedIds.length,
      selection,
      target,
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
    const previousInputDragging = useViewer.getState().inputDragging
    const previousCursor = document.body.style.cursor
    let latestFactor = 1
    let lastSnapFactor: number | null = null
    let latestTopology: BlockTopology | null = null
    let finished = false

    const updatePreview = (clientX: number, clientY: number, altKey: boolean) => {
      const pointer = new Vector2(clientX, clientY)
      const distance = pointer.distanceTo(pivotClient) - initialDistance
      const snapStep = !altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const factor = blockScaleFactorFromDrag(distance, initialDistance, snapStep)
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
        factors: blockScaleFactors('uniform', factor),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      latestFactor = factor
      latestTopology = result.topology
      setPreviewTopology(result.topology)
      useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
      useScene.getState().markDirty(node.id)
      setError(null)
    }

    const finish = (commit: boolean) => {
      if (finished) return
      finished = true
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('contextmenu', onContextMenu, true)
      window.removeEventListener('blur', onCancel)
      cancelDragRef.current = null
      useLiveNodeOverrides.getState().clear(node.id)
      useScene.getState().markDirty(node.id)
      useViewer.getState().setInputDragging(previousInputDragging)
      document.body.style.cursor = previousCursor
      setPreviewTopology(null)
      setActiveTransform(null)
      if (commit && latestTopology && Math.abs(latestFactor - 1) > 1e-6) {
        useScene.getState().updateNode(node.id, { topology: latestTopology })
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
      updatePreview(pointerEvent.clientX, pointerEvent.clientY, pointerEvent.altKey)
    }
    const onPointerDown = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault()
      pointerEvent.stopImmediatePropagation()
      if (pointerEvent.button === 2) {
        window.addEventListener(
          'contextmenu',
          (event) => {
            event.preventDefault()
            event.stopImmediatePropagation()
          },
          { capture: true, once: true },
        )
      }
      finish(pointerEvent.button !== 2)
    }
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      const element = keyboardEvent.target as HTMLElement | null
      if (
        element?.tagName === 'INPUT' ||
        element?.tagName === 'TEXTAREA' ||
        element?.isContentEditable
      )
        return
      if (keyboardEvent.key === 'Enter') {
        keyboardEvent.preventDefault()
        keyboardEvent.stopImmediatePropagation()
        finish(true)
      } else if (keyboardEvent.key === 'Escape') {
        keyboardEvent.preventDefault()
        keyboardEvent.stopImmediatePropagation()
        finish(false)
      }
    }
    const onContextMenu = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const onCancel = () => finish(false)

    useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'scale'))
    playBlockSfx('drag-start')
    useViewer.getState().setInputDragging(true)
    setTransformTool('transform')
    setToolbarPanel(null)
    setActiveTransform({ operation: 'scale', constraint: 'uniform' })
    setError(null)
    document.body.style.cursor = 'nwse-resize'
    cancelDragRef.current = onCancel
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('contextmenu', onContextMenu, true)
    window.addEventListener('blur', onCancel, { once: true })
    return true
  }, [
    camera,
    displayTopology,
    gizmoLength,
    gl.domElement,
    node.id,
    ownsEditSession,
    selectedIds.length,
    selection,
    target,
  ])

  const beginBevelDrag = useCallback(
    (edgeId: string, event: ThreeEvent<PointerEvent>) => {
      if (event.nativeEvent.button !== 0 || !ownsEditSession() || cancelDragRef.current) return
      if (!displayTopology.edges.some((edge) => edge.id === edgeId)) return
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

      useBlockEditSession.getState().setSelection(node.id, {
        mode: 'edge',
        ids: [edgeId],
        activeId: edgeId,
      })
      setToolbarPanel(null)
      setError(null)
      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'bevel'))
      playBlockSfx('operation-start')
      useViewer.getState().setInputDragging(true)
      document.body.style.cursor = 'ew-resize'

      const updatePreview = (width: number, segments = activeSegments) => {
        if (width <= 1e-6) return false
        const result = applyBlockCommand(baseTopology, {
          type: 'bevel-edge',
          edgeId,
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
        latestTopology = result.topology
        latestSelection = result.selection
        setPreviewTopology(result.topology)
        useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
        useScene.getState().markDirty(node.id)
        setError(null)
        return true
      }

      const onMove = (pointerEvent: PointerEvent) => {
        const deltaX = pointerEvent.clientX - startClientX
        const deltaY = pointerEvent.clientY - startClientY
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
        useScene.getState().markDirty(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        document.body.style.cursor = previousCursor
        setPreviewTopology(null)
        if (commit && latestTopology && latestSelection && latestWidth > 1e-6) {
          useScene.getState().updateNode(node.id, { topology: latestTopology })
          useBlockEditSession.getState().setSelection(node.id, {
            ...latestSelection,
            activeId: latestSelection.ids.at(-1) ?? null,
          })
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
    [bevelSegments, displayTopology, extent, gl.domElement, node.id, ownsEditSession],
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
        useScene.getState().markDirty(node.id)
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
        const parameter = closestAxisParameterToRay(
          worldStart,
          worldAxis,
          makeRay(pointerEvent.clientX, pointerEvent.clientY),
        )
        let factor = Math.min(
          0.98,
          Math.max(0.02, 0.5 + (parameter - initialParameter) / worldLength),
        )
        const snapping = isGridSnapActive() && !pointerEvent.altKey
        if (snapping) {
          const step = useEditor.getState().gridSnapStep
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
        useScene.getState().markDirty(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        document.body.style.cursor = previousCursor
        setPreviewTopology(null)
        setLoopCutSegments(null)
        setLoopCutEdgeId(null)
        setLoopCutSliding(false)
        if (outcome !== 'cancel' && latestTopology && latestSelection && latestFactor > 0) {
          useScene.getState().updateNode(node.id, { topology: latestTopology })
          useBlockEditSession.getState().setSelection(node.id, {
            ...latestSelection,
            activeId: latestSelection.ids.at(-1) ?? null,
          })
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
    [loopCutCount, makeRay, node.id, node.topology, ownsEditSession, target],
  )

  const commitCommand = (command: BlockCommand, operator: TopologyOperator) => {
    if (cancelDragRef.current) return
    useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', operator))
    const result = applyBlockCommand(node.topology, command)
    if (!result.ok) {
      useInteractionScope.getState().begin(meshEditScope(node.id))
      setError(result.error)
      return
    }
    useScene.getState().updateNode(node.id, { topology: result.topology })
    useBlockEditSession.getState().setSelection(node.id, {
      ...result.selection,
      activeId: result.selection.ids.at(-1) ?? null,
    })
    setToolbarPanel(null)
    setError(null)
    if (ownsEditSession()) useInteractionScope.getState().begin(meshEditScope(node.id))
    playBlockSfx(operator === 'delete' ? 'delete' : 'operation-commit')
  }

  const extrudeSelectedFace = () => {
    if (mode !== 'face' || selectedIds.length !== 1) return
    commitCommand(
      { type: 'extrude-face', faceId: selectedIds[0]!, distance: Number(extrudeDistance) },
      'extrude',
    )
  }

  const insetSelectedFace = () => {
    if (mode !== 'face' || selectedIds.length !== 1) return
    commitCommand(
      {
        type: 'inset-face',
        faceId: selectedIds[0]!,
        amount: Number(insetAmount),
        depth: 0,
      },
      'inset',
    )
  }

  const deleteSelection = () => {
    if (selectedIds.length === 0) return
    commitCommand({ type: 'delete-components', selection }, 'delete')
  }

  const mergeSelection = () => {
    if (mode !== 'vertex' || selectedIds.length < 2) return
    commitCommand({ type: 'merge-vertices', vertexIds: selectedIds }, 'merge')
  }

  const dissolveSelection = () => {
    if (mode !== 'edge' || selectedIds.length !== 1) return
    commitCommand({ type: 'dissolve-edge', edgeId: selectedIds[0]! }, 'dissolve')
  }

  const updateSelection = (next: BlockSelectionState) => {
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
    beginUniformScaleModal,
    canBevel: mode === 'edge',
    clearSelection,
    deleteSelection,
    dissolveSelection,
    extrudeSelectedFace,
    hasSelection: selectedIds.length > 0,
    insetSelectedFace,
    invertSelection,
    mergeSelection,
    selectAll,
  })
  keyboardActionsRef.current = {
    beginUniformScaleModal,
    canBevel: mode === 'edge',
    clearSelection,
    deleteSelection,
    dissolveSelection,
    extrudeSelectedFace,
    hasSelection: selectedIds.length > 0,
    insetSelectedFace,
    invertSelection,
    mergeSelection,
    selectAll,
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
      if (key === 'b' && (event.ctrlKey || event.metaKey)) {
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
        if (actions.hasSelection) {
          playBlockSfx('tool-select')
          setTransformTool('transform')
        }
      } else if (key === 'e') {
        actions.extrudeSelectedFace()
      } else if (key === 'i') {
        actions.insetSelectedFace()
      } else if (key === 'r') {
        if (event.ctrlKey || event.metaKey) {
          playBlockSfx('tool-select')
          setTransformTool('loop-cut')
          setToolbarPanel(null)
        } else if (actions.hasSelection) {
          playBlockSfx('tool-select')
          setTransformTool('transform')
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
      } else if (event.key === 'Delete' || event.key === 'Backspace' || key === 'x') {
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
    useScene.getState().deleteNode(node.id)
    playBlockSfx('delete')
  }

  const selectionStatus = formatBlockSelectionStatus(mode, selectedIds.length)
  const operationAvailability = blockOperationAvailability(mode, selectedIds.length)
  const loopCutActive = transformTool === 'loop-cut'
  const bevelActive = transformTool === 'bevel'
  const componentStatus = blockComponentStatus({
    mode,
    selectedCount: selectedIds.length,
    tool: transformTool,
    loopCutCount,
    loopCutFactor,
    bevelSegments,
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
                  key={axis}
                  length={gizmoLength}
                  moveActive={
                    activeTransform?.operation === 'translate' &&
                    activeTransform.constraint === axis
                  }
                  onMovePointerDown={beginTranslationDrag}
                  onScalePointerDown={beginScaleDrag}
                  radius={gizmoRadius}
                  scaleActive={
                    activeTransform?.operation === 'scale' && activeTransform.constraint === axis
                  }
                />
              ))}
              {(Object.keys(PLANE_NORMAL) as PlaneAxes[]).map((plane) => (
                <PlaneMoveHandle
                  active={
                    activeTransform?.operation === 'translate' &&
                    activeTransform.constraint === PLANE_NORMAL[plane]
                  }
                  key={plane}
                  offset={planeHandleOffset}
                  onPointerDown={beginTranslationDrag}
                  plane={plane}
                  size={planeHandleSize}
                />
              ))}
              {(['x', 'y', 'z'] as const).map((axis) => (
                <RotationHandle
                  active={
                    activeTransform?.operation === 'rotate' && activeTransform.constraint === axis
                  }
                  axis={axis}
                  key={`rotate-${axis}`}
                  onPointerDown={beginRotationDrag}
                  radius={rotationGizmoRadius}
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
                        controls={
                          <input
                            aria-label="Extrude distance"
                            className={OPERATION_INPUT_CLASS}
                            disabled={!operationAvailability.extrude}
                            onChange={(event) => setExtrudeDistance(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter') return
                              event.preventDefault()
                              extrudeSelectedFace()
                            }}
                            step="0.05"
                            type="number"
                            value={extrudeDistance}
                          />
                        }
                        disabled={!operationAvailability.extrude}
                        label="Extrude face"
                        onClick={extrudeSelectedFace}
                        shortcut="E"
                      >
                        <ArrowUpFromLine className="h-4 w-4" />
                      </ToolbarOperationItem>
                      <ToolbarOperationItem
                        controls={
                          <input
                            aria-label="Inset ratio"
                            className={OPERATION_INPUT_CLASS}
                            disabled={!operationAvailability.inset}
                            max="0.95"
                            min="0.01"
                            onChange={(event) => setInsetAmount(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter') return
                              event.preventDefault()
                              insetSelectedFace()
                            }}
                            step="0.05"
                            type="number"
                            value={insetAmount}
                          />
                        }
                        disabled={!operationAvailability.inset}
                        label="Inset face"
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
                        label="Dissolve edge"
                        onClick={dissolveSelection}
                        shortcut="D"
                      >
                        <ScanLine className="h-4 w-4" />
                      </ToolbarOperationItem>
                      <ToolbarOperationItem
                        active={bevelActive}
                        disabled={!operationAvailability.bevel}
                        label="Bevel edge"
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
    </group>
  )
}

const BlockSelectionAffordance = () => {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const node = useScene((state) => {
    if (selectedIds.length !== 1) return null
    const selected = state.nodes[selectedIds[0] as AnyNodeId]
    return selected?.type === 'block' ? (selected as BlockNode) : null
  })
  const [target, setTarget] = useState<Object3D | null>(null)
  const nodeId = node?.id ?? null
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
      const next = sceneRegistry.nodes.get(nodeId as AnyNodeId) ?? null
      setTarget((current) => (current === next ? current : next))
      if (!next) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => window.cancelAnimationFrame(frameId)
  }, [nodeId])

  if (!node || !target || !scopeAllowsAffordance) return null
  const mount = target.parent ?? target
  return createPortal(
    <BlockEditor mirrorTarget={mount !== target} node={node} target={target} />,
    mount,
    undefined,
  )
}

export default BlockSelectionAffordance

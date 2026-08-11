'use client'

import {
  type AnyNodeId,
  type CustomMeshFace,
  type CustomMeshNode,
  type CustomMeshTopology,
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
  MousePointer2,
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
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  LineSegments,
  type Object3D,
  Plane,
  Quaternion,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import {
  applyCustomMeshCommand,
  type CustomMeshCommand,
  type CustomMeshSelection,
  customMeshFaceCentroid,
  customMeshFaceNormal,
  customMeshLoopCutSegments,
  customMeshSelectionVertexIds,
} from './commands'
import { triangulateCustomMeshFace } from './geometry'
import { CUSTOM_MESH_WHEEL_OPTIONS, consumeCustomMeshGestureWheel } from './gesture-wheel'
import { type CustomMeshSfxAction, customMeshSfx } from './interaction-sfx'
import { signedAngleAroundAxis, unwrapRotationDelta } from './rotation-drag'
import {
  type CustomMeshSelectionState,
  clearCustomMeshSelection,
  convertCustomMeshSelection,
  invertCustomMeshSelection,
  selectAllCustomMeshComponents,
  selectCustomMeshComponent,
} from './selection-model'
import {
  customMeshBevelWidthFromDrag,
  customMeshOperationAvailability,
  customMeshScaleFactorFromDrag,
  customMeshScaleFactors,
  formatCustomMeshSelectionStatus,
} from './toolbar-state'

type ComponentMode = CustomMeshSelection['mode']
type Point = [number, number, number]
type Axis = 'x' | 'y' | 'z'
type TransformTool = 'select' | 'move' | 'rotate' | 'scale' | 'loop-cut' | 'bevel'
type ModalOperator = 'extrude' | 'inset' | 'merge' | 'dissolve' | 'delete'
type ToolbarPanel = 'operations' | 'selection' | null
type ModalDraft = {
  topology: CustomMeshTopology
  selection: CustomMeshSelection
  operator: ModalOperator
}

const AXIS_VECTORS: Record<Axis, Point> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
}
const AXIS_COLORS: Record<Axis, string> = {
  x: '#ef4444',
  y: '#22c55e',
  z: '#3b82f6',
}
const COMPONENT_ACTIVE_COLOR = '#ff9a24'
const COMPONENT_SELECTED_COLOR = '#ff6d00'
const COMPONENT_HOVER_COLOR = '#ffb020'
const COMPONENT_IDLE_COLOR = '#737982'
const DEFAULT_BEVEL_SEGMENTS = 6
const ROTATION_SNAP_ANGLE_DEGREES = 15

const FLOATING_PANEL_CLASS =
  'corner-smooth pointer-events-auto flex rounded-[18px] border border-border/45 bg-background/96 p-1.5 shadow-elevation-4 backdrop-blur-xl'
const TOOLBAR_POPOVER_CLASS =
  'absolute top-[calc(100%+10px)] left-1/2 z-50 w-72 -translate-x-1/2 rounded-xl border border-border/50 bg-background/98 p-2 shadow-elevation-4 backdrop-blur-xl'
const OPERATION_INPUT_CLASS =
  'h-7 w-14 rounded-md border border-border/50 bg-accent/25 px-1.5 text-right font-mono text-[10px] text-foreground tabular-nums outline-none hover:border-border/80 focus:border-ring disabled:opacity-35'

const playCustomMeshSfx = (action: CustomMeshSfxAction) => triggerSFX(customMeshSfx(action))

function preferredFace(topology: CustomMeshTopology): CustomMeshFace | null {
  return (
    topology.faces
      .map((face) => ({
        face,
        normal: customMeshFaceNormal(topology, face),
        centroid: customMeshFaceCentroid(topology, face),
      }))
      .filter((entry) => entry.normal && entry.centroid)
      .sort((a, b) => b.normal![1] - a.normal![1] || b.centroid![1] - a.centroid![1])[0]?.face ??
    null
  )
}

function topologyVertexMap(topology: CustomMeshTopology): Map<string, Point> {
  return new Map(topology.vertices.map((vertex) => [vertex.id, vertex.position]))
}

function selectionCentroid(
  topology: CustomMeshTopology,
  selection: CustomMeshSelection,
): Point | null {
  const ids = customMeshSelectionVertexIds(topology, selection)
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

function topologyExtent(topology: CustomMeshTopology): number {
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
  face: CustomMeshFace
  topology: CustomMeshTopology
  selected: boolean
  active: boolean
  xray: boolean
  interactive?: boolean
  onSelect: (id: string, additive: boolean, event: ThreeEvent<MouseEvent>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const geometries = useMemo(() => {
    const triangulated = triangulateCustomMeshFace(topology, face)
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

function AxisHandle({
  axis,
  length,
  radius,
  active,
  appearance = 'move',
  onPointerDown,
}: {
  axis: Axis
  length: number
  radius: number
  active: boolean
  appearance?: 'move' | 'scale'
  onPointerDown: (axis: Axis, event: ThreeEvent<PointerEvent>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const shaftGeometry = useMemo(
    () => new CylinderGeometry(radius, radius, length * 0.72, 10),
    [length, radius],
  )
  const tipGeometry = useMemo(
    () =>
      appearance === 'scale'
        ? new BoxGeometry(radius * 4.5, radius * 4.5, radius * 4.5)
        : new ConeGeometry(radius * 2.5, length * 0.28, 12),
    [appearance, length, radius],
  )
  const hitGeometry = useMemo(
    () => new CylinderGeometry(radius * 4.5, radius * 4.5, length, 8),
    [length, radius],
  )
  const material = useMemo(
    () => new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false }),
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
    material.color.set(active || hovered ? '#fef3c7' : AXIS_COLORS[axis])
  }, [active, axis, hovered, material])
  useEffect(
    () => () => {
      shaftGeometry.dispose()
      tipGeometry.dispose()
      hitGeometry.dispose()
      material.dispose()
      hitMaterial.dispose()
    },
    [hitGeometry, hitMaterial, material, shaftGeometry, tipGeometry],
  )
  const rotation: Point =
    axis === 'x' ? [0, 0, -Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0]

  return (
    <group rotation={rotation}>
      <mesh
        geometry={shaftGeometry}
        layers={EDITOR_LAYER}
        material={material}
        position={[0, length * 0.36, 0]}
        raycast={() => {}}
        renderOrder={1210}
      />
      <mesh
        geometry={tipGeometry}
        layers={EDITOR_LAYER}
        material={material}
        position={[0, length * 0.86, 0]}
        raycast={() => {}}
        renderOrder={1210}
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
        position={[0, length * 0.5, 0]}
        renderOrder={1211}
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
  const ringGeometry = useMemo(() => new TorusGeometry(radius, tube, 8, 64), [radius, tube])
  const hitGeometry = useMemo(() => new TorusGeometry(radius, tube * 4.5, 8, 64), [radius, tube])
  const arrowGeometry = useMemo(() => new ConeGeometry(tube * 2.8, tube * 7, 12), [tube])
  const material = useMemo(
    () => new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false }),
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
    material.color.set(active || hovered ? '#fef3c7' : AXIS_COLORS[axis])
  }, [active, axis, hovered, material])
  useEffect(
    () => () => {
      ringGeometry.dispose()
      hitGeometry.dispose()
      arrowGeometry.dispose()
      material.dispose()
      hitMaterial.dispose()
    },
    [arrowGeometry, hitGeometry, hitMaterial, material, ringGeometry],
  )
  const rotation: Point =
    axis === 'x' ? [0, Math.PI / 2, 0] : axis === 'y' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]

  return (
    <group rotation={rotation}>
      <mesh
        geometry={ringGeometry}
        layers={EDITOR_LAYER}
        material={material}
        raycast={() => {}}
        renderOrder={1210}
      />
      <mesh
        geometry={arrowGeometry}
        layers={EDITOR_LAYER}
        material={material}
        position={[radius, 0, 0]}
        raycast={() => {}}
        renderOrder={1210}
      />
      <mesh
        geometry={arrowGeometry}
        layers={EDITOR_LAYER}
        material={material}
        position={[-radius, 0, 0]}
        raycast={() => {}}
        renderOrder={1210}
        rotation={[0, 0, Math.PI]}
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
        renderOrder={1211}
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
  sound?: CustomMeshSfxAction | false
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <span className="group relative inline-flex">
      <button
        aria-label={label}
        className={cn(
          'flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-muted-foreground transition-colors',
          active && 'bg-accent text-foreground ring-1 ring-border/60 ring-inset hover:bg-accent/80',
          !active &&
            !destructive &&
            'hover:bg-accent/80 hover:text-foreground dark:hover:bg-white/8',
          destructive && 'hover:bg-destructive/10 hover:text-destructive',
          'disabled:cursor-not-allowed disabled:opacity-35',
        )}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          if (!onClick) return
          if (sound) playCustomMeshSfx(sound)
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
  sound?: CustomMeshSfxAction | false
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
        if (sound) playCustomMeshSfx(sound)
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
        'flex h-9 items-center rounded-lg transition-colors',
        active ? 'bg-accent' : 'hover:bg-accent/70',
        disabled && 'opacity-35',
      )}
    >
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-2.5 text-left text-muted-foreground text-xs hover:text-foreground disabled:cursor-not-allowed"
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
          <kbd className="ml-auto font-mono text-[10px] text-muted-foreground/70">{shortcut}</kbd>
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

function CustomMeshEditor({
  node,
  target,
  mirrorTarget,
}: {
  node: CustomMeshNode
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
  const [mode, setMode] = useState<ComponentMode>('face')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [transformTool, setTransformTool] = useState<TransformTool>('select')
  const [xray, setXray] = useState(false)
  const [previewTopology, setPreviewTopology] = useState<CustomMeshTopology | null>(null)
  const [dragAxis, setDragAxis] = useState<Axis | null>(null)
  const [loopCutSegments, setLoopCutSegments] = useState<[Point, Point][] | null>(null)
  const [loopCutCount, setLoopCutCount] = useState(1)
  const [loopCutFactor, setLoopCutFactor] = useState(0.5)
  const [extrudeDistance, setExtrudeDistance] = useState('0.25')
  const [insetAmount, setInsetAmount] = useState('0.15')
  const [bevelSegments, setBevelSegments] = useState(DEFAULT_BEVEL_SEGMENTS)
  const [modalDraft, setModalDraft] = useState<ModalDraft | null>(null)
  const [toolbarPanel, setToolbarPanel] = useState<ToolbarPanel>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelDragRef = useRef<(() => void) | null>(null)
  const modalDraftRef = useRef<ModalDraft | null>(null)
  const displayTopology = previewTopology ?? node.topology
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selection = useMemo<CustomMeshSelection>(
    () => ({ mode, ids: selectedIds }),
    [mode, selectedIds],
  )
  const extent = topologyExtent(displayTopology)
  const componentRadius = Math.min(0.055, Math.max(0.022, extent * 0.011))
  const gizmoOrigin = selectionCentroid(displayTopology, selection)
  const gizmoLength = Math.min(0.72, Math.max(0.26, extent * 0.18))
  const gizmoRadius = Math.min(0.026, Math.max(0.009, extent * 0.006))
  const rotationGizmoRadius = Math.min(1, Math.max(0.45, extent * 0.28))
  const vertexById = useMemo(() => topologyVertexMap(displayTopology), [displayTopology])
  const menuAnchor = useMemo<Point>(() => {
    const xs = displayTopology.vertices.map((vertex) => vertex.position[0])
    const ys = displayTopology.vertices.map((vertex) => vertex.position[1])
    const zs = displayTopology.vertices.map((vertex) => vertex.position[2])
    return [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      Math.max(...ys) + Math.min(1.4, Math.max(0.9, extent * 0.25)),
      (Math.min(...zs) + Math.max(...zs)) / 2,
    ]
  }, [displayTopology, extent])

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

  modalDraftRef.current = modalDraft

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
    setPreviewTopology(null)
    setModalDraft(null)
    setSelectedIds([])
    setActiveId(null)
    setTransformTool('select')
    setDragAxis(null)
    setLoopCutSegments(null)
    setToolbarPanel(null)
    setError(null)
    playCustomMeshSfx('finish')
  }, [endOwnedScope, node.id])

  const cancelModalDraft = useCallback(() => {
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.getState().markDirty(node.id)
    setPreviewTopology(null)
    setModalDraft(null)
    setToolbarPanel(null)
    setError(null)
    if (ownsEditSession()) useInteractionScope.getState().begin(meshEditScope(node.id))
    playCustomMeshSfx('cancel')
  }, [node.id, ownsEditSession])

  const confirmModalDraft = useCallback(() => {
    const draft = modalDraftRef.current
    if (!draft) return
    useLiveNodeOverrides.getState().clear(node.id)
    useScene.getState().markDirty(node.id)
    useScene.getState().updateNode(node.id, { topology: draft.topology })
    setPreviewTopology(null)
    setModalDraft(null)
    setMode(draft.selection.mode)
    setSelectedIds(draft.selection.ids)
    setActiveId(draft.selection.ids.at(-1) ?? null)
    setError(null)
    if (ownsEditSession()) useInteractionScope.getState().begin(meshEditScope(node.id))
    playCustomMeshSfx(draft.operator === 'delete' ? 'delete' : 'operation-commit')
  }, [node.id, ownsEditSession])

  useEffect(
    () => () => {
      cancelDragRef.current?.()
      useLiveNodeOverrides.getState().clear(node.id)
      useScene.getState().markDirty(node.id)
      endOwnedScope()
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
    setModalDraft(null)
    setToolbarPanel(null)
    setLoopCutSegments(null)
    setDragAxis(null)
  }, [editing, node.id])

  useEffect(() => {
    if (!editing) return
    const onToolCancel = () => {
      markToolCancelConsumed()
      if (toolbarPanel) {
        setToolbarPanel(null)
        playCustomMeshSfx('cancel')
      } else if (cancelDragRef.current) cancelDragRef.current()
      else if (modalDraftRef.current) cancelModalDraft()
      else exitEditMode()
    }
    emitter.on('tool:cancel', onToolCancel)
    return () => emitter.off('tool:cancel', onToolCancel)
  }, [cancelModalDraft, editing, exitEditMode, toolbarPanel])

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
    const onGridClick = () => {
      const scope = useInteractionScope.getState().scope
      if (
        scope.kind !== 'mesh-editing' ||
        scope.nodeId !== node.id ||
        cancelDragRef.current ||
        modalDraftRef.current
      )
        return
      setSelectedIds([])
      setActiveId(null)
      setError(null)
      playCustomMeshSfx('component-select')
    }
    emitter.on('grid:click', onGridClick)
    return () => emitter.off('grid:click', onGridClick)
  }, [editing, node.id])

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
        if (cancelDragRef.current || modalDraftRef.current) return
        if (editing) {
          exitEditMode()
        } else if (useInteractionScope.getState().scope.kind === 'idle') {
          const face = preferredFace(node.topology)
          setMode('face')
          setSelectedIds(face ? [face.id] : [])
          setActiveId(face?.id ?? null)
          setTransformTool('select')
          setToolbarPanel(null)
          setError(null)
          useInteractionScope.getState().begin(meshEditScope(node.id))
          triggerSFX('sfx:item-pick')
        }
        return
      }
      if (!editing) return
      if (event.key === 'Enter' && modalDraftRef.current) {
        event.preventDefault()
        event.stopImmediatePropagation()
        confirmModalDraft()
        return
      }
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
      const converted = convertCustomMeshSelection(
        node.topology,
        {
          mode,
          ids: selectedIds,
          activeId,
        },
        nextMode,
      )
      setMode(converted.mode)
      setSelectedIds(converted.ids)
      setActiveId(converted.activeId)
      setError(null)
      playCustomMeshSfx('tool-select')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    activeId,
    confirmModalDraft,
    editing,
    exitEditMode,
    mode,
    node.id,
    node.topology,
    selectedIds,
  ])

  useEffect(() => {
    const validIds = new Set(
      mode === 'vertex'
        ? node.topology.vertices.map((vertex) => vertex.id)
        : mode === 'edge'
          ? node.topology.edges.map((edge) => edge.id)
          : node.topology.faces.map((face) => face.id),
    )
    setSelectedIds((current) => current.filter((id) => validIds.has(id)))
    setActiveId((current) => (current && validIds.has(current) ? current : null))
  }, [mode, node.topology])

  const enterEditMode = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const face = preferredFace(node.topology)
    setMode('face')
    setSelectedIds(face ? [face.id] : [])
    setActiveId(face?.id ?? null)
    setTransformTool('select')
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
      if (modalDraftRef.current) return
      if (!componentIsVisible(id, event)) return
      const next = selectCustomMeshComponent({ mode, ids: selectedIds, activeId }, id, additive)
      setSelectedIds(next.ids)
      setActiveId(next.activeId)
      setError(null)
      playCustomMeshSfx('component-select')
    },
    [activeId, componentIsVisible, mode, selectedIds],
  )

  const switchMode = (nextMode: ComponentMode) => {
    if (cancelDragRef.current || modalDraftRef.current) return
    const converted = convertCustomMeshSelection(
      displayTopology,
      { mode, ids: selectedIds, activeId },
      nextMode,
    )
    setMode(converted.mode)
    setSelectedIds(converted.ids)
    setActiveId(converted.activeId)
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

  const beginAxisDrag = useCallback(
    (axis: Axis, event: ThreeEvent<PointerEvent>) => {
      if (!ownsEditSession() || selectedIds.length === 0 || cancelDragRef.current) return
      const origin = selectionCentroid(displayTopology, selection)
      if (!origin) return
      target.updateWorldMatrix(true, false)
      const originLocal = new Vector3(...origin)
      const worldOrigin = target.localToWorld(originLocal.clone())
      const localAxis = new Vector3(...AXIS_VECTORS[axis])
      const worldTip = target.localToWorld(originLocal.clone().add(localAxis))
      const worldAxis = worldTip.sub(worldOrigin).normalize()
      const initialParameter = closestAxisParameterToRay(worldOrigin, worldAxis, event.ray)
      const baseTopology = displayTopology
      const baseSelection = selection
      const previousInputDragging = useViewer.getState().inputDragging
      const previousCursor = document.body.style.cursor
      let latestTopology: CustomMeshTopology | null = null
      let latestDistance = 0
      let lastSnapDistance: number | null = null
      let finished = false

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'translate'))
      playCustomMeshSfx('drag-start')
      useViewer.getState().setInputDragging(true)
      setDragAxis(axis)
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
        const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
        let distance = localPoint.getComponent(axisIndex) - originLocal.getComponent(axisIndex)
        const snapping = isGridSnapActive() && !pointerEvent.altKey
        if (snapping) {
          const step = useEditor.getState().gridSnapStep
          if (step > 0) distance = Math.round(distance / step) * step
        }
        if (snapping && Math.abs(distance) > 1e-6 && distance !== lastSnapDistance) {
          lastSnapDistance = distance
          playCustomMeshSfx('move-step')
        } else if (!snapping) {
          lastSnapDistance = null
        }
        const delta: Point = [0, 0, 0]
        delta[axisIndex] = distance
        const result = applyCustomMeshCommand(baseTopology, {
          type: 'translate-components',
          selection: baseSelection,
          delta,
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        latestDistance = distance
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
        setDragAxis(null)
        if (commit && latestTopology && Math.abs(latestDistance) > 1e-6) {
          useScene.getState().updateNode(node.id, { topology: latestTopology })
          playCustomMeshSfx('finish')
        } else if (!commit) {
          playCustomMeshSfx('cancel')
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
      let latestTopology: CustomMeshTopology | null = null
      let finished = false

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'rotate'))
      playCustomMeshSfx('drag-start')
      useViewer.getState().setInputDragging(true)
      setDragAxis(axis)
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
          playCustomMeshSfx('rotate-step')
        } else if (!snapping) {
          lastSnapAngle = null
        }
        const result = applyCustomMeshCommand(baseTopology, {
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
        setDragAxis(null)
        if (commit && latestTopology && Math.abs(latestAngle) > 1e-6) {
          useScene.getState().updateNode(node.id, { topology: latestTopology })
          playCustomMeshSfx('finish')
        } else if (!commit) {
          playCustomMeshSfx('cancel')
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
      let latestTopology: CustomMeshTopology | null = null
      let finished = false

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'scale'))
      playCustomMeshSfx('drag-start')
      useViewer.getState().setInputDragging(true)
      setDragAxis(axis)
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
        const snapStep = !pointerEvent.altKey && isGridSnapActive() ? 0.1 : 0
        const factor = customMeshScaleFactorFromDrag(distance, gizmoLength, snapStep)
        if (snapStep > 0 && Math.abs(factor - 1) > 1e-6 && factor !== lastSnapFactor) {
          lastSnapFactor = factor
          playCustomMeshSfx('resize-step')
        } else if (snapStep === 0) {
          lastSnapFactor = null
        }
        const result = applyCustomMeshCommand(baseTopology, {
          type: 'scale-components',
          selection: baseSelection,
          pivot: origin,
          factors: customMeshScaleFactors(axis, factor),
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
        setDragAxis(null)
        if (commit && latestTopology && Math.abs(latestFactor - 1) > 1e-6) {
          useScene.getState().updateNode(node.id, { topology: latestTopology })
          playCustomMeshSfx('finish')
        } else if (!commit) {
          playCustomMeshSfx('cancel')
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
      let latestTopology: CustomMeshTopology | null = null
      let latestSelection: CustomMeshSelection | null = null
      let finished = false

      setMode('edge')
      setSelectedIds([edgeId])
      setActiveId(edgeId)
      setToolbarPanel(null)
      setError(null)
      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'bevel'))
      playCustomMeshSfx('operation-start')
      useViewer.getState().setInputDragging(true)
      document.body.style.cursor = 'ew-resize'

      const updatePreview = (width: number, segments = activeSegments) => {
        if (width <= 1e-6) return false
        const result = applyCustomMeshCommand(baseTopology, {
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
        const width = customMeshBevelWidthFromDrag(deltaX, deltaY, extent, viewportHeight)
        const widthStep = Math.floor(width / Math.max(0.01, extent * 0.025))
        if (widthStep > 0 && widthStep !== lastWidthStep) {
          lastWidthStep = widthStep
          playCustomMeshSfx('resize-step')
        }
        updatePreview(width, activeSegments)
      }

      const onWheel = (wheelEvent: WheelEvent) => {
        const direction = consumeCustomMeshGestureWheel(wheelEvent)
        if (direction === 0) return
        const segments = Math.min(12, Math.max(1, activeSegments + direction))
        if (segments === activeSegments) return
        activeSegments = segments
        setBevelSegments(segments)
        playCustomMeshSfx('resize-step')
        if (latestWidth > 0) updatePreview(latestWidth, segments)
      }

      const finish = (commit: boolean) => {
        if (finished) return
        finished = true
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('wheel', onWheel, CUSTOM_MESH_WHEEL_OPTIONS)
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
          setMode(latestSelection.mode)
          setSelectedIds(latestSelection.ids)
          setActiveId(latestSelection.ids.at(-1) ?? null)
          playCustomMeshSfx('operation-commit')
        } else if (!commit) {
          playCustomMeshSfx('cancel')
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
      window.addEventListener('wheel', onWheel, CUSTOM_MESH_WHEEL_OPTIONS)
      window.addEventListener('pointercancel', onPointerCancel, { once: true })
      window.addEventListener('blur', onPointerCancel, { once: true })
    },
    [bevelSegments, displayTopology, extent, gl.domElement, node.id, ownsEditSession],
  )

  const previewLoopCut = useCallback(
    (edgeId: string | null) => {
      if (cancelDragRef.current) return
      if (!edgeId) {
        setLoopCutSegments(null)
        setError(null)
        return
      }
      const segments = customMeshLoopCutSegments(displayTopology, edgeId, 0.5, loopCutCount)
      setLoopCutSegments(segments)
      setError(segments ? null : 'Loop cut requires a connected ring of quad faces')
    },
    [displayTopology, loopCutCount],
  )

  const beginLoopCutDrag = useCallback(
    (edgeId: string, event: ThreeEvent<PointerEvent>) => {
      if (event.nativeEvent.button !== 0 || !ownsEditSession() || cancelDragRef.current) return
      const edge = displayTopology.edges.find((entry) => entry.id === edgeId)
      const vertices = topologyVertexMap(displayTopology)
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
      const baseTopology = displayTopology
      const previousInputDragging = useViewer.getState().inputDragging
      const previousCursor = document.body.style.cursor
      let latestTopology: CustomMeshTopology | null = null
      let latestSelection: CustomMeshSelection | null = null
      let latestFactor = 0.5
      let activeCuts = loopCutCount
      let lastSnapFactor: number | null = null
      let firstStageConfirmed = false
      let finished = false

      const updatePreview = (factor: number, cuts = activeCuts) => {
        const result = applyCustomMeshCommand(baseTopology, {
          type: 'loop-cut',
          edgeId,
          factor,
          cuts,
        })
        const segments = customMeshLoopCutSegments(baseTopology, edgeId, factor, cuts)
        if (!result.ok || !segments) {
          setError(result.ok ? 'Could not preview loop cut' : result.error)
          return false
        }
        latestFactor = factor
        activeCuts = cuts
        latestTopology = result.topology
        latestSelection = result.selection
        setPreviewTopology(result.topology)
        setLoopCutSegments(segments)
        setLoopCutCount(cuts)
        setLoopCutFactor(factor)
        useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
        useScene.getState().markDirty(node.id)
        setError(null)
        return true
      }
      if (!updatePreview(0.5)) return

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'loop-cut'))
      playCustomMeshSfx('operation-start')
      useViewer.getState().setInputDragging(true)
      document.body.style.cursor = 'ew-resize'

      const onMove = (pointerEvent: PointerEvent) => {
        if (!firstStageConfirmed) return
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
          playCustomMeshSfx('move-step')
        } else if (!snapping) {
          lastSnapFactor = null
        }
        updatePreview(factor)
      }

      const onWheel = (wheelEvent: WheelEvent) => {
        const direction = consumeCustomMeshGestureWheel(wheelEvent)
        if (direction === 0) return
        const cuts = Math.min(32, Math.max(1, activeCuts + direction))
        if (cuts !== activeCuts) playCustomMeshSfx('resize-step')
        updatePreview(latestFactor, cuts)
      }

      const finish = (commit: boolean) => {
        if (finished) return
        finished = true
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onFirstPointerUp)
        window.removeEventListener('pointerdown', onSecondPointerDown, true)
        window.removeEventListener('wheel', onWheel, CUSTOM_MESH_WHEEL_OPTIONS)
        window.removeEventListener('pointercancel', onPointerCancel)
        window.removeEventListener('blur', onPointerCancel)
        cancelDragRef.current = null
        useLiveNodeOverrides.getState().clear(node.id)
        useScene.getState().markDirty(node.id)
        useViewer.getState().setInputDragging(previousInputDragging)
        document.body.style.cursor = previousCursor
        setPreviewTopology(null)
        setLoopCutSegments(null)
        if (commit && latestTopology && latestSelection && latestFactor > 0) {
          useScene.getState().updateNode(node.id, { topology: latestTopology })
          setMode(latestSelection.mode)
          setSelectedIds(latestSelection.ids)
          setActiveId(latestSelection.ids.at(-1) ?? null)
          playCustomMeshSfx('operation-commit')
        } else if (!commit) {
          playCustomMeshSfx('cancel')
        }
        if (ownsEditSession()) {
          useInteractionScope.getState().begin(meshEditScope(node.id))
        }
        swallowNextClick()
      }
      const onFirstPointerUp = () => {
        firstStageConfirmed = true
      }
      const onSecondPointerDown = (pointerEvent: PointerEvent) => {
        if (!firstStageConfirmed || (pointerEvent.button !== 0 && pointerEvent.button !== 2)) return
        pointerEvent.preventDefault()
        pointerEvent.stopImmediatePropagation()
        if (pointerEvent.button === 2) updatePreview(0.5)
        finish(true)
      }
      const onPointerCancel = () => finish(false)
      cancelDragRef.current = onPointerCancel
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onFirstPointerUp, { once: true })
      window.addEventListener('pointerdown', onSecondPointerDown, true)
      window.addEventListener('wheel', onWheel, CUSTOM_MESH_WHEEL_OPTIONS)
      window.addEventListener('pointercancel', onPointerCancel, { once: true })
      window.addEventListener('blur', onPointerCancel, { once: true })
    },
    [displayTopology, loopCutCount, makeRay, node.id, ownsEditSession, target],
  )

  const previewCommand = (command: CustomMeshCommand, operator: ModalOperator) => {
    if (cancelDragRef.current || modalDraftRef.current) return
    useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', operator))
    const result = applyCustomMeshCommand(node.topology, command)
    if (!result.ok) {
      useInteractionScope.getState().begin(meshEditScope(node.id))
      setError(result.error)
      return
    }
    const draft = { topology: result.topology, selection: result.selection, operator }
    setModalDraft(draft)
    setToolbarPanel(null)
    setPreviewTopology(result.topology)
    useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
    useScene.getState().markDirty(node.id)
    setError(null)
  }

  const extrudeSelectedFace = () => {
    if (mode !== 'face' || selectedIds.length !== 1) return
    playCustomMeshSfx('operation-start')
    previewCommand(
      { type: 'extrude-face', faceId: selectedIds[0]!, distance: Number(extrudeDistance) },
      'extrude',
    )
  }

  const insetSelectedFace = () => {
    if (mode !== 'face' || selectedIds.length !== 1) return
    playCustomMeshSfx('operation-start')
    previewCommand(
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
    playCustomMeshSfx('tool-select')
    previewCommand({ type: 'delete-components', selection }, 'delete')
  }

  const mergeSelection = () => {
    if (mode !== 'vertex' || selectedIds.length < 2) return
    playCustomMeshSfx('operation-start')
    previewCommand({ type: 'merge-vertices', vertexIds: selectedIds }, 'merge')
  }

  const dissolveSelection = () => {
    if (mode !== 'edge' || selectedIds.length !== 1) return
    playCustomMeshSfx('operation-start')
    previewCommand({ type: 'dissolve-edge', edgeId: selectedIds[0]! }, 'dissolve')
  }

  const updateSelection = (next: CustomMeshSelectionState) => {
    setMode(next.mode)
    setSelectedIds(next.ids)
    setActiveId(next.activeId)
    setError(null)
    playCustomMeshSfx('component-select')
  }

  const selectAll = () =>
    updateSelection(
      selectAllCustomMeshComponents(displayTopology, { mode, ids: selectedIds, activeId }),
    )
  const invertSelection = () =>
    updateSelection(
      invertCustomMeshSelection(displayTopology, { mode, ids: selectedIds, activeId }),
    )
  const clearSelection = () =>
    updateSelection(clearCustomMeshSelection({ mode, ids: selectedIds, activeId }))

  const keyboardActionsRef = useRef({
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
          playCustomMeshSfx('tool-select')
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
          playCustomMeshSfx('tool-select')
          setTransformTool('move')
        }
      } else if (key === 'e') {
        actions.extrudeSelectedFace()
      } else if (key === 'i') {
        actions.insetSelectedFace()
      } else if (key === 'r') {
        if (event.ctrlKey || event.metaKey) {
          playCustomMeshSfx('tool-select')
          setTransformTool('loop-cut')
          setToolbarPanel(null)
        } else if (actions.hasSelection) {
          playCustomMeshSfx('tool-select')
          setTransformTool('rotate')
        }
      } else if (key === 's') {
        if (actions.hasSelection) {
          playCustomMeshSfx('tool-select')
          setTransformTool('scale')
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
    useEditor.getState().setMovingNode(node as never)
    useViewer.getState().setSelection({ selectedIds: [] })
    triggerSFX('sfx:item-pick')
  }
  const deleteNode = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    useViewer.getState().setSelection({ selectedIds: [] })
    useScene.getState().deleteNode(node.id)
    playCustomMeshSfx('delete')
  }

  const componentLabel =
    selectedIds.length === 1 ? mode : mode === 'vertex' ? 'vertices' : `${mode}s`
  const selectionStatus = formatCustomMeshSelectionStatus(mode, selectedIds.length)
  const operationAvailability = customMeshOperationAvailability(mode, selectedIds.length)
  const loopCutActive = transformTool === 'loop-cut'
  const bevelActive = transformTool === 'bevel'
  const componentStatus = modalDraft
    ? `${modalDraft.operator} preview · Enter to confirm · Esc to cancel`
    : transformTool === 'loop-cut'
      ? `Loop Cut · ${loopCutCount} cut${loopCutCount === 1 ? '' : 's'} · factor ${loopCutFactor.toFixed(2)} · first click chooses ring, second click confirms · wheel changes count`
      : transformTool === 'bevel'
        ? `Bevel · drag an edge to peel it · wheel changes segments (${bevelSegments}) · release to apply`
        : selectedIds.length === 0
          ? `Click a ${mode} to select it`
          : transformTool === 'move'
            ? `${selectedIds.length} ${componentLabel} selected · drag an axis to move · Alt for free movement`
            : transformTool === 'rotate'
              ? `${selectedIds.length} ${componentLabel} selected · drag a rotation ring · Alt for free rotation`
              : transformTool === 'scale'
                ? `${selectedIds.length} ${componentLabel} selected · drag a colored handle to scale · Alt for free scaling`
                : `${selectedIds.length} ${componentLabel} selected · choose a transform or mesh operator`
  const showComponentStatus =
    Boolean(error || modalDraft || dragAxis) ||
    transformTool === 'loop-cut' ||
    transformTool === 'bevel' ||
    selectedIds.length === 0

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
                const center = customMeshFaceCentroid(displayTopology, face)
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
          {gizmoOrigin && transformTool === 'move' ? (
            <group position={gizmoOrigin}>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <AxisHandle
                  active={dragAxis === axis}
                  axis={axis}
                  key={axis}
                  length={gizmoLength}
                  onPointerDown={beginAxisDrag}
                  radius={gizmoRadius}
                />
              ))}
            </group>
          ) : null}
          {gizmoOrigin && transformTool === 'rotate' ? (
            <group position={gizmoOrigin}>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <RotationHandle
                  active={dragAxis === axis}
                  axis={axis}
                  key={axis}
                  onPointerDown={beginRotationDrag}
                  radius={rotationGizmoRadius}
                  tube={gizmoRadius}
                />
              ))}
            </group>
          ) : null}
          {gizmoOrigin && transformTool === 'scale' ? (
            <group position={gizmoOrigin}>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <AxisHandle
                  active={dragAxis === axis}
                  appearance="scale"
                  axis={axis}
                  key={axis}
                  length={gizmoLength}
                  onPointerDown={beginScaleDrag}
                  radius={gizmoRadius}
                />
              ))}
            </group>
          ) : null}
          {transformTool === 'loop-cut'
            ? displayTopology.edges.map((edge) => {
                const start = vertexById.get(edge.vertexIds[0])
                const end = vertexById.get(edge.vertexIds[1])
                return start && end ? (
                  <LoopCutTarget
                    edgeId={edge.id}
                    end={end}
                    key={edge.id}
                    onHover={previewLoopCut}
                    onPointerDown={beginLoopCutDrag}
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
            <div className={cn(FLOATING_PANEL_CLASS, 'relative items-center gap-1 px-2')}>
              <div className="flex items-center overflow-hidden rounded-lg border border-border/45 bg-accent/15">
                <ToolbarButton
                  active={transformTool === 'select'}
                  disabled={Boolean(modalDraft || cancelDragRef.current)}
                  label="Select tool"
                  onClick={() => setTransformTool('select')}
                >
                  <MousePointer2 className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  active={transformTool === 'move'}
                  disabled={Boolean(
                    selectedIds.length === 0 || modalDraft || cancelDragRef.current,
                  )}
                  label="Move selected components (G)"
                  onClick={() => setTransformTool('move')}
                >
                  <Move3D className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  active={transformTool === 'rotate'}
                  disabled={Boolean(
                    selectedIds.length === 0 || modalDraft || cancelDragRef.current,
                  )}
                  label="Rotate selected components (R)"
                  onClick={() => setTransformTool('rotate')}
                >
                  <Rotate3D className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  active={transformTool === 'scale'}
                  disabled={Boolean(
                    selectedIds.length === 0 || modalDraft || cancelDragRef.current,
                  )}
                  label="Scale selected components (S)"
                  onClick={() => setTransformTool('scale')}
                >
                  <Scaling className="h-4 w-4" />
                </ToolbarButton>
              </div>
              <span className="mx-1 h-7 w-px bg-border/40" />
              <div className="flex items-center overflow-hidden rounded-lg border border-border/45 bg-accent/15">
                <ToolbarButton
                  active={mode === 'vertex'}
                  disabled={Boolean(modalDraft || cancelDragRef.current)}
                  label="Vertex select (1)"
                  onClick={() => switchMode('vertex')}
                >
                  <CircleDot className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  active={mode === 'edge'}
                  disabled={Boolean(modalDraft || cancelDragRef.current)}
                  label="Edge select (2)"
                  onClick={() => switchMode('edge')}
                >
                  <ScanLine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  active={mode === 'face'}
                  disabled={Boolean(modalDraft || cancelDragRef.current)}
                  label="Face select (3)"
                  onClick={() => switchMode('face')}
                >
                  <Square className="h-4 w-4" />
                </ToolbarButton>
              </div>
              <span className="mx-1 h-7 w-px bg-border/40" />
              <span className="min-w-16 whitespace-nowrap rounded-lg border border-border/45 px-2.5 py-2 text-center font-mono text-[10px] text-foreground tracking-[0.08em]">
                {selectionStatus}
              </span>

              <div className="relative">
                <button
                  aria-expanded={toolbarPanel === 'operations'}
                  aria-haspopup="dialog"
                  className={cn(
                    'flex h-9 min-w-28 items-center justify-center gap-2 rounded-lg px-3 text-xs transition-colors disabled:opacity-35',
                    toolbarPanel === 'operations'
                      ? 'bg-accent text-foreground ring-1 ring-border/60 ring-inset'
                      : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                  )}
                  disabled={Boolean(modalDraft)}
                  onClick={(event) => {
                    event.stopPropagation()
                    playCustomMeshSfx('tool-select')
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
                  <ToolbarPanelFrame label="Mesh operations" className="w-[32rem]">
                    <div className="space-y-1">
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
                          playCustomMeshSfx('tool-select')
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
                          playCustomMeshSfx('tool-select')
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

              <span className="mx-1 h-7 w-px bg-border/40" />
              {modalDraft ? (
                <>
                  <ToolbarButton
                    label="Cancel preview (Esc)"
                    onClick={cancelModalDraft}
                    sound={false}
                  >
                    <XIcon className="h-4 w-4" />
                  </ToolbarButton>
                  <ToolbarButton
                    label="Confirm preview (Enter)"
                    onClick={confirmModalDraft}
                    sound={false}
                  >
                    <Check className="h-4 w-4" />
                  </ToolbarButton>
                </>
              ) : (
                <ToolbarButton label="Finish edit mode (Tab)" onClick={exitEditMode} sound={false}>
                  <Check className="h-4 w-4" />
                </ToolbarButton>
              )}

              <div className="relative">
                <ToolbarButton
                  active={toolbarPanel === 'selection'}
                  disabled={Boolean(modalDraft)}
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
          {editing && showComponentStatus ? (
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

const CustomMeshSelectionAffordance = () => {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const node = useScene((state) => {
    if (selectedIds.length !== 1) return null
    const selected = state.nodes[selectedIds[0] as AnyNodeId]
    return selected?.type === 'custom-mesh' ? (selected as CustomMeshNode) : null
  })
  const [target, setTarget] = useState<Object3D | null>(null)
  const nodeId = node?.id ?? null

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

  if (!node || !target) return null
  const mount = target.parent ?? target
  return createPortal(
    <CustomMeshEditor mirrorTarget={mount !== target} node={node} target={target} />,
    mount,
    undefined,
  )
}

export default CustomMeshSelectionAffordance

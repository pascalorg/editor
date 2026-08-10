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
  isGridSnapActive,
  markToolCancelConsumed,
  meshEditScope,
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
  CircleDot,
  Eye,
  EyeOff,
  MousePointer2,
  Move3D,
  PencilRuler,
  Rotate3D,
  Rows3,
  Scaling,
  ScanLine,
  Square,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
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
import { signedAngleAroundAxis, unwrapRotationDelta } from './rotation-drag'
import {
  type CustomMeshSelectionState,
  clearCustomMeshSelection,
  convertCustomMeshSelection,
  invertCustomMeshSelection,
  selectAllCustomMeshComponents,
  selectCustomMeshComponent,
} from './selection-model'

type ComponentMode = CustomMeshSelection['mode']
type Point = [number, number, number]
type Axis = 'x' | 'y' | 'z'
type TransformTool = 'select' | 'move' | 'rotate' | 'loop-cut'

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

const FLOATING_PANEL_CLASS =
  'corner-smooth pointer-events-auto flex rounded-xl border border-border/40 bg-background/95 p-1.5 shadow-elevation-4 backdrop-blur-xl'
const TOOLBAR_INPUT_CLASS =
  'h-7 w-12 rounded-md border border-border/50 bg-accent/30 px-1.5 font-mono text-xs text-foreground tabular-nums outline-none transition-[border-color,box-shadow,background-color] hover:border-border/80 focus:border-ring focus:ring-1 focus:ring-ring/40'

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
  onSelect: (id: string, additive: boolean) => void
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
      active ? '#ffffff' : selected ? '#fb923c' : hovered ? '#fcd34d' : '#6b7280',
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
          onSelect(id, event.nativeEvent.shiftKey)
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
}: {
  id: string
  start: Point
  end: Point
  radius: number
  selected: boolean
  active: boolean
  xray: boolean
  onSelect: (id: string, additive: boolean) => void
}) {
  const [hovered, setHovered] = useState(false)
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
  useEffect(() => {
    visibleMaterial.color.set(
      active ? '#ffffff' : selected ? '#fb923c' : hovered ? '#fcd34d' : '#6b7280',
    )
    visibleMaterial.opacity = active || selected || hovered ? 1 : 0.65
  }, [active, hovered, selected, visibleMaterial])
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
      visibleMaterial.dispose()
      hitMaterial.dispose()
    },
    [hitGeometry, hitMaterial, visibleGeometry, visibleMaterial],
  )

  return (
    <>
      <primitive object={visibleLine} />
      <group position={placement.position} quaternion={placement.quaternion}>
        <mesh
          frustumCulled={false}
          geometry={hitGeometry}
          layers={EDITOR_LAYER}
          material={hitMaterial}
          onClick={(event) => {
            event.stopPropagation()
            onSelect(id, event.nativeEvent.shiftKey)
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
    </>
  )
}

function FaceHandle({
  face,
  topology,
  selected,
  active,
  xray,
  onSelect,
}: {
  face: CustomMeshFace
  topology: CustomMeshTopology
  selected: boolean
  active: boolean
  xray: boolean
  onSelect: (id: string, additive: boolean) => void
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
    fillMaterial.color.set(active ? '#ffffff' : selected ? '#fb923c' : '#fbbf24')
    fillMaterial.opacity = selected ? 0.26 : hovered ? 0.14 : 0.001
    outlineMaterial.color.set(active ? '#ffffff' : selected ? '#fb923c' : '#fcd34d')
    outlineMaterial.opacity = selected || hovered ? 1 : 0
  }, [active, fillMaterial, hovered, outlineMaterial, selected])
  const outline = useMemo(() => {
    if (!geometries) return null
    const line = new LineSegments(geometries.outline, outlineMaterial)
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
        material={fillMaterial}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(face.id, event.nativeEvent.shiftKey)
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
  onPointerDown,
}: {
  axis: Axis
  length: number
  radius: number
  active: boolean
  onPointerDown: (axis: Axis, event: ThreeEvent<PointerEvent>) => void
}) {
  const [hovered, setHovered] = useState(false)
  const shaftGeometry = useMemo(
    () => new CylinderGeometry(radius, radius, length * 0.72, 10),
    [length, radius],
  )
  const tipGeometry = useMemo(
    () => new ConeGeometry(radius * 2.5, length * 0.28, 12),
    [length, radius],
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
        material={material}
        position={[0, length * 0.36, 0]}
        raycast={() => {}}
        renderOrder={1210}
      />
      <mesh
        geometry={tipGeometry}
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
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  destructive?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <span className="group relative inline-flex">
      <button
        aria-label={label}
        className={cn(
          'flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-muted-foreground transition-colors',
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
          onClick?.()
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
  const [editing, setEditing] = useState(false)
  const editingRef = useRef(false)
  const [mode, setMode] = useState<ComponentMode>('face')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [transformTool, setTransformTool] = useState<TransformTool>('select')
  const [xray, setXray] = useState(false)
  const [previewTopology, setPreviewTopology] = useState<CustomMeshTopology | null>(null)
  const [dragAxis, setDragAxis] = useState<Axis | null>(null)
  const [loopCutSegments, setLoopCutSegments] = useState<[Point, Point][] | null>(null)
  const [extrudeDistance, setExtrudeDistance] = useState('0.25')
  const [insetAmount, setInsetAmount] = useState('0.15')
  const [rotationSnapAngle, setRotationSnapAngle] = useState('15')
  const [scaleFactor, setScaleFactor] = useState('1.1')
  const [error, setError] = useState<string | null>(null)
  const cancelDragRef = useRef<(() => void) | null>(null)
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

  useFrame(() => {
    const outer = outerRef.current
    if (!(outer && mirrorTarget)) return
    outer.position.copy(target.position)
    outer.quaternion.copy(target.quaternion)
    outer.scale.copy(target.scale)
  })

  useEffect(() => {
    editingRef.current = editing
  }, [editing])

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
    editingRef.current = false
    setEditing(false)
    setPreviewTopology(null)
    setSelectedIds([])
    setActiveId(null)
    setTransformTool('select')
    setDragAxis(null)
    setLoopCutSegments(null)
    setError(null)
  }, [endOwnedScope, node.id])

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
    if (!editing) return
    const onToolCancel = () => {
      markToolCancelConsumed()
      if (cancelDragRef.current) cancelDragRef.current()
      else exitEditMode()
    }
    emitter.on('tool:cancel', onToolCancel)
    return () => emitter.off('tool:cancel', onToolCancel)
  }, [editing, exitEditMode])

  useEffect(() => {
    if (!editing) return
    const onGridClick = () => {
      const scope = useInteractionScope.getState().scope
      if (scope.kind !== 'mesh-editing' || scope.nodeId !== node.id || cancelDragRef.current) return
      setSelectedIds([])
      setActiveId(null)
      setError(null)
    }
    emitter.on('grid:click', onGridClick)
    return () => emitter.off('grid:click', onGridClick)
  }, [editing, node.id])

  useEffect(() => {
    if (!editing) return
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
        exitEditMode()
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
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeId, editing, exitEditMode, mode, node.topology, selectedIds])

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

  const enterEditMode = () => {
    const face = preferredFace(node.topology)
    setMode('face')
    setSelectedIds(face ? [face.id] : [])
    setActiveId(face?.id ?? null)
    setTransformTool('select')
    setError(null)
    editingRef.current = true
    setEditing(true)
    useInteractionScope.getState().begin(meshEditScope(node.id))
    triggerSFX('sfx:item-pick')
  }

  const selectComponent = useCallback(
    (id: string, additive: boolean) => {
      const next = selectCustomMeshComponent({ mode, ids: selectedIds, activeId }, id, additive)
      setSelectedIds(next.ids)
      setActiveId(next.activeId)
      setError(null)
    },
    [activeId, mode, selectedIds],
  )

  const switchMode = (nextMode: ComponentMode) => {
    if (cancelDragRef.current) return
    const converted = convertCustomMeshSelection(
      displayTopology,
      { mode, ids: selectedIds, activeId },
      nextMode,
    )
    setMode(converted.mode)
    setSelectedIds(converted.ids)
    setActiveId(converted.activeId)
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
      if (!editingRef.current || selectedIds.length === 0 || cancelDragRef.current) return
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
      let finished = false

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'translate'))
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
        if (isGridSnapActive() && !pointerEvent.altKey) {
          const step = useEditor.getState().gridSnapStep
          if (step > 0) distance = Math.round(distance / step) * step
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
          triggerSFX('sfx:item-pick')
        }
        if (editingRef.current) {
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
    [displayTopology, makeRay, node.id, selectedIds.length, selection, target],
  )

  const beginRotationDrag = useCallback(
    (axis: Axis, event: ThreeEvent<PointerEvent>) => {
      if (!editingRef.current || selectedIds.length === 0 || cancelDragRef.current) return
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
      let latestTopology: CustomMeshTopology | null = null
      let finished = false

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'rotate'))
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
        const snapDegrees = Math.abs(Number(rotationSnapAngle))
        if (!pointerEvent.altKey && Number.isFinite(snapDegrees) && snapDegrees > 0) {
          const step = (snapDegrees * Math.PI) / 180
          angle = Math.round(angle / step) * step
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
          triggerSFX('sfx:item-pick')
        }
        if (editingRef.current) {
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
    [displayTopology, makeRay, node.id, rotationSnapAngle, selectedIds.length, selection, target],
  )

  const previewLoopCut = useCallback(
    (edgeId: string | null) => {
      if (cancelDragRef.current) return
      if (!edgeId) {
        setLoopCutSegments(null)
        setError(null)
        return
      }
      const segments = customMeshLoopCutSegments(displayTopology, edgeId, 0.5)
      setLoopCutSegments(segments)
      setError(segments ? null : 'Loop cut requires a connected ring of quad faces')
    },
    [displayTopology],
  )

  const beginLoopCutDrag = useCallback(
    (edgeId: string, event: ThreeEvent<PointerEvent>) => {
      if (!editingRef.current || cancelDragRef.current) return
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
      let finished = false

      const updatePreview = (factor: number) => {
        const result = applyCustomMeshCommand(baseTopology, { type: 'loop-cut', edgeId, factor })
        const segments = customMeshLoopCutSegments(baseTopology, edgeId, factor)
        if (!result.ok || !segments) {
          setError(result.ok ? 'Could not preview loop cut' : result.error)
          return false
        }
        latestFactor = factor
        latestTopology = result.topology
        latestSelection = result.selection
        setPreviewTopology(result.topology)
        setLoopCutSegments(segments)
        useLiveNodeOverrides.getState().set(node.id, { topology: result.topology })
        useScene.getState().markDirty(node.id)
        setError(null)
        return true
      }
      if (!updatePreview(0.5)) return

      useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', 'loop-cut'))
      useViewer.getState().setInputDragging(true)
      document.body.style.cursor = 'ew-resize'

      const onMove = (pointerEvent: PointerEvent) => {
        const parameter = closestAxisParameterToRay(
          worldStart,
          worldAxis,
          makeRay(pointerEvent.clientX, pointerEvent.clientY),
        )
        const factor = Math.min(
          0.98,
          Math.max(0.02, 0.5 + (parameter - initialParameter) / worldLength),
        )
        updatePreview(factor)
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
        setLoopCutSegments(null)
        if (commit && latestTopology && latestSelection && latestFactor > 0) {
          useScene.getState().updateNode(node.id, { topology: latestTopology })
          setMode(latestSelection.mode)
          setSelectedIds(latestSelection.ids)
          setActiveId(latestSelection.ids.at(-1) ?? null)
          triggerSFX('sfx:item-pick')
        }
        if (editingRef.current) {
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
    [displayTopology, makeRay, node.id, target],
  )

  const commitCommand = (
    command: CustomMeshCommand,
    operator: 'rotate' | 'scale' | 'extrude' | 'inset' | 'merge' | 'dissolve' | 'delete',
  ) => {
    if (cancelDragRef.current) return
    useInteractionScope.getState().begin(meshEditScope(node.id, 'operating', operator))
    const result = applyCustomMeshCommand(node.topology, command)
    useInteractionScope.getState().begin(meshEditScope(node.id))
    if (!result.ok) {
      setError(result.error)
      return
    }
    useScene.getState().updateNode(node.id, { topology: result.topology })
    setMode(result.selection.mode)
    setSelectedIds(result.selection.ids)
    setActiveId(result.selection.ids.at(-1) ?? null)
    setError(null)
    triggerSFX('sfx:item-pick')
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

  const scaleSelection = () => {
    if (!gizmoOrigin) return
    const factor = Number(scaleFactor)
    commitCommand(
      {
        type: 'scale-components',
        selection,
        pivot: gizmoOrigin,
        factors: [factor, factor, factor],
      },
      'scale',
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

  const updateSelection = (next: CustomMeshSelectionState) => {
    setMode(next.mode)
    setSelectedIds(next.ids)
    setActiveId(next.activeId)
    setError(null)
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
    clearSelection,
    deleteSelection,
    dissolveSelection,
    extrudeSelectedFace,
    hasSelection: selectedIds.length > 0,
    insetSelectedFace,
    invertSelection,
    mergeSelection,
    scaleSelection,
    selectAll,
  })
  keyboardActionsRef.current = {
    clearSelection,
    deleteSelection,
    dissolveSelection,
    extrudeSelectedFace,
    hasSelection: selectedIds.length > 0,
    insetSelectedFace,
    invertSelection,
    mergeSelection,
    scaleSelection,
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
      if (key === 'a') {
        if (event.altKey) actions.clearSelection()
        else actions.selectAll()
      } else if (key === 'i' && (event.ctrlKey || event.metaKey)) {
        actions.invertSelection()
      } else if (key === 'g') {
        if (actions.hasSelection) setTransformTool('move')
      } else if (key === 'e') {
        actions.extrudeSelectedFace()
      } else if (key === 'i') {
        actions.insetSelectedFace()
      } else if (key === 'r') {
        if (event.ctrlKey || event.metaKey) setTransformTool('loop-cut')
        else if (actions.hasSelection) setTransformTool('rotate')
      } else if (key === 's') {
        actions.scaleSelection()
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

  const moveNode = () => {
    useEditor.getState().setMovingNode(node as never)
    useViewer.getState().setSelection({ selectedIds: [] })
    triggerSFX('sfx:item-pick')
  }
  const deleteNode = () => {
    useViewer.getState().setSelection({ selectedIds: [] })
    useScene.getState().deleteNode(node.id)
  }

  const componentLabel =
    selectedIds.length === 1 ? mode : mode === 'vertex' ? 'vertices' : `${mode}s`
  const componentStatus =
    transformTool === 'loop-cut'
      ? 'Loop Cut · hover an edge to preview · click or drag to cut and slide · Ctrl+R'
      : selectedIds.length === 0
        ? `Click a ${mode} to select it`
        : transformTool === 'move'
          ? `${selectedIds.length} ${componentLabel} selected · drag an axis to move · Alt for free movement`
          : transformTool === 'rotate'
            ? `${selectedIds.length} ${componentLabel} selected · drag a rotation ring · Alt for free rotation`
            : `${selectedIds.length} ${componentLabel} selected · choose a transform or mesh operator`

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
            ? displayTopology.faces.map((face) => (
                <FaceHandle
                  active={activeId === face.id}
                  face={face}
                  key={face.id}
                  onSelect={selectComponent}
                  selected={selectedSet.has(face.id)}
                  topology={displayTopology}
                  xray={xray}
                />
              ))
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
        >
          {editing ? (
            <div className={cn(FLOATING_PANEL_CLASS, 'flex-col gap-1.5')}>
              <div className="flex items-center gap-1">
                <span className="whitespace-nowrap px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-foreground">
                  Edit mode
                </span>
                <span className="mx-0.5 h-5 w-px bg-border/40" />
                <ToolbarButton
                  active={mode === 'vertex'}
                  label="Vertex select (1)"
                  onClick={() => switchMode('vertex')}
                >
                  <CircleDot className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  active={mode === 'edge'}
                  label="Edge select (2)"
                  onClick={() => switchMode('edge')}
                >
                  <ScanLine className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  active={mode === 'face'}
                  label="Face select (3)"
                  onClick={() => switchMode('face')}
                >
                  <Square className="h-4 w-4" />
                </ToolbarButton>
                <span className="mx-0.5 h-5 w-px bg-border/40" />
                <ToolbarButton label="Select all" onClick={selectAll}>
                  <span className="px-0.5 text-[10px] font-medium">All</span>
                </ToolbarButton>
                <ToolbarButton label="Invert selection" onClick={invertSelection}>
                  <span className="px-0.5 text-[10px] font-medium">Invert</span>
                </ToolbarButton>
                <ToolbarButton label="Clear component selection" onClick={clearSelection}>
                  <span className="px-0.5 text-[10px] font-medium">Clear</span>
                </ToolbarButton>
                <ToolbarButton
                  active={xray}
                  label="Toggle X-ray selection"
                  onClick={() => setXray((value) => !value)}
                >
                  {xray ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </ToolbarButton>
                <span className="mx-0.5 h-5 w-px bg-border/40" />
                <ToolbarButton label="Finish edit mode (Tab)" onClick={exitEditMode}>
                  <Check className="h-4 w-4" />
                </ToolbarButton>
              </div>
              <div className="flex items-center gap-1 border-border/40 border-t pt-1.5">
                <ToolbarButton
                  active={transformTool === 'select'}
                  label="Select tool"
                  onClick={() => setTransformTool('select')}
                >
                  <MousePointer2 className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  active={transformTool === 'move'}
                  disabled={selectedIds.length === 0}
                  label="Move selected components"
                  onClick={() => setTransformTool('move')}
                >
                  <Move3D className="h-4 w-4" />
                </ToolbarButton>
                <span className="mx-0.5 h-5 w-px bg-border/40" />
                <input
                  aria-label="Rotation snap angle in degrees"
                  className={TOOLBAR_INPUT_CLASS}
                  min="0"
                  onChange={(event) => setRotationSnapAngle(event.target.value)}
                  step="5"
                  type="number"
                  value={rotationSnapAngle}
                />
                <ToolbarButton
                  active={transformTool === 'rotate'}
                  disabled={selectedIds.length === 0}
                  label="Rotate selected components"
                  onClick={() => setTransformTool('rotate')}
                >
                  <Rotate3D className="h-4 w-4" />
                </ToolbarButton>
                <ToolbarButton
                  active={transformTool === 'loop-cut'}
                  label="Loop Cut and Slide (Ctrl+R)"
                  onClick={() => setTransformTool('loop-cut')}
                >
                  <Rows3 className="h-4 w-4" />
                </ToolbarButton>
                <input
                  aria-label="Uniform scale factor"
                  className={TOOLBAR_INPUT_CLASS}
                  onChange={(event) => setScaleFactor(event.target.value)}
                  step="0.1"
                  type="number"
                  value={scaleFactor}
                />
                <ToolbarButton
                  disabled={selectedIds.length === 0}
                  label="Scale uniformly"
                  onClick={scaleSelection}
                >
                  <Scaling className="h-4 w-4" />
                </ToolbarButton>
                <span className="mx-0.5 h-5 w-px bg-border/40" />
                <input
                  aria-label="Extrude distance"
                  className={TOOLBAR_INPUT_CLASS}
                  onChange={(event) => setExtrudeDistance(event.target.value)}
                  step="0.05"
                  type="number"
                  value={extrudeDistance}
                />
                <ToolbarButton
                  disabled={mode !== 'face' || selectedIds.length !== 1}
                  label="Extrude selected face"
                  onClick={extrudeSelectedFace}
                >
                  <ArrowUpFromLine className="h-4 w-4" />
                </ToolbarButton>
                <input
                  aria-label="Inset ratio"
                  className={TOOLBAR_INPUT_CLASS}
                  max="0.95"
                  min="0.01"
                  onChange={(event) => setInsetAmount(event.target.value)}
                  step="0.05"
                  type="number"
                  value={insetAmount}
                />
                <ToolbarButton
                  disabled={mode !== 'face' || selectedIds.length !== 1}
                  label="Inset selected face"
                  onClick={insetSelectedFace}
                >
                  <span className="px-0.5 text-[10px] font-medium">Inset</span>
                </ToolbarButton>
                <ToolbarButton
                  disabled={mode !== 'vertex' || selectedIds.length < 2}
                  label="Merge selected vertices (M)"
                  onClick={mergeSelection}
                >
                  <span className="px-0.5 text-[10px] font-medium">Merge</span>
                </ToolbarButton>
                <ToolbarButton
                  disabled={mode !== 'edge' || selectedIds.length !== 1}
                  label="Dissolve selected edge (D)"
                  onClick={dissolveSelection}
                >
                  <span className="px-0.5 text-[10px] font-medium">Dissolve</span>
                </ToolbarButton>
                <ToolbarButton
                  destructive
                  disabled={selectedIds.length === 0}
                  label="Delete selected components"
                  onClick={deleteSelection}
                >
                  <Trash2 className="h-4 w-4" />
                </ToolbarButton>
              </div>
            </div>
          ) : (
            <div className={cn(FLOATING_PANEL_CLASS, 'items-center gap-1')}>
              <ToolbarButton label="Move" onClick={moveNode}>
                <Move3D className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton label="Edit mesh" onClick={enterEditMode}>
                <PencilRuler className="h-4 w-4" />
              </ToolbarButton>
              <ToolbarButton destructive label="Delete" onClick={deleteNode}>
                <Trash2 className="h-4 w-4" />
              </ToolbarButton>
            </div>
          )}
          {editing ? (
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

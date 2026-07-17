'use client'

import {
  type AnyNode,
  type MeasurementNode,
  type MeasurementPoint,
  measurementAngle,
  measurementArea,
  measurementDistance,
  measurementNormal,
  measurementPerimeter,
  measurementPrismVolume,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  buildMeasurementAngleArcPoints,
  formatAngleRadians,
  formatAreaLabel,
  formatLinearMeasurement,
  formatVolumeLabel,
  measurementPolygonLabelAnchor,
  measurementPresentationColor,
  triangulateMeasurementPolygon,
} from '@pascal-app/editor'
import { OVERLAY_LAYER, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  MathUtils,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three'
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import { useShallow } from 'zustand/react/shallow'
import {
  measurementDependencyIds,
  type ResolvedMeasurementPayload,
  resolveMeasurementNode,
} from './resolve'

type MeasurementRenderData = {
  fillGeometry: BufferGeometry | null
  labelPosition: MeasurementPoint
  lineGeometry: BufferGeometry
  markerPoints: MeasurementPoint[]
}

const MARKER_PLANE_NORMAL = new Vector3(0, 0, 1)

function fallbackMarkerNormal(
  measurement: ResolvedMeasurementPayload,
  index: number,
): MeasurementPoint {
  if (
    measurement.kind === 'area' ||
    measurement.kind === 'perimeter' ||
    measurement.kind === 'volume'
  ) {
    return measurementNormal(measurement.base) ?? [0, 1, 0]
  }
  if (measurement.kind === 'angle') {
    const [start, vertex, end] = measurement.points
    const normal = new Vector3(...start)
      .sub(new Vector3(...vertex))
      .cross(new Vector3(...end).sub(new Vector3(...vertex)))
    return normal.lengthSq() > 1e-12 ? normal.normalize().toArray() : [0, 1, 0]
  }

  const [start, end] = measurement.points
  if (Math.abs(start[1]) < 0.05 && Math.abs(end[1]) < 0.05) return [0, 1, 0]
  const direction = new Vector3(...end).sub(new Vector3(...start)).normalize()
  const horizontalNormal = direction.cross(new Vector3(0, 1, 0))
  if (horizontalNormal.lengthSq() > 1e-12) {
    const normal = horizontalNormal.normalize()
    if (index > 0) normal.negate()
    return normal.toArray()
  }
  return [0, 0, 1]
}

function SurfaceContactMarker({
  color,
  normal,
  point,
}: {
  color: string
  normal: MeasurementPoint
  point: MeasurementPoint
}) {
  const ref = useRef<Group>(null)
  const worldPosition = useMemo(() => new Vector3(), [])
  const cameraSpacePosition = useMemo(() => new Vector3(), [])
  const rotation = useMemo(() => {
    const resolvedNormal = new Vector3(...normal)
    if (resolvedNormal.lengthSq() <= 1e-12) resolvedNormal.copy(MARKER_PLANE_NORMAL)
    return new Quaternion().setFromUnitVectors(MARKER_PLANE_NORMAL, resolvedNormal.normalize())
  }, [normal])
  const materials = useMemo(
    () => ({
      halo: new MeshBasicNodeMaterial({
        color: '#f8fafc',
        depthTest: true,
        depthWrite: false,
        opacity: 0.92,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: DoubleSide,
        transparent: true,
      }),
      target: new MeshBasicNodeMaterial({
        color,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        side: DoubleSide,
      }),
    }),
    [color],
  )

  useEffect(
    () => () => {
      materials.halo.dispose()
      materials.target.dispose()
    },
    [materials],
  )

  useFrame(({ camera, size }) => {
    const group = ref.current
    if (!group) return
    group.getWorldPosition(worldPosition)
    let worldUnitsPerPixel = 0.01
    if ((camera as PerspectiveCamera).isPerspectiveCamera) {
      const perspective = camera as PerspectiveCamera
      const depth = Math.abs(
        cameraSpacePosition.copy(worldPosition).applyMatrix4(perspective.matrixWorldInverse).z,
      )
      worldUnitsPerPixel =
        (2 * depth * Math.tan(MathUtils.degToRad(perspective.getEffectiveFOV() * 0.5))) /
        Math.max(size.height, 1)
    } else if ((camera as OrthographicCamera).isOrthographicCamera) {
      const orthographic = camera as OrthographicCamera
      worldUnitsPerPixel =
        (orthographic.top - orthographic.bottom) / Math.max(orthographic.zoom * size.height, 1)
    }
    const scale = worldUnitsPerPixel * 7
    if (Number.isFinite(scale)) group.scale.setScalar(MathUtils.clamp(scale, 0.002, 0.24))
  })

  return (
    <group position={point} quaternion={rotation} ref={ref}>
      <mesh layers={OVERLAY_LAYER} material={materials.halo} renderOrder={1002}>
        <ringGeometry args={[0.48, 1, 40]} />
      </mesh>
      <mesh layers={OVERLAY_LAYER} material={materials.target} renderOrder={1003}>
        <ringGeometry args={[0.62, 0.86, 40]} />
      </mesh>
    </group>
  )
}

const add = (point: MeasurementPoint, offset: MeasurementPoint): MeasurementPoint => [
  point[0] + offset[0],
  point[1] + offset[1],
  point[2] + offset[2],
]

const midpoint = (start: MeasurementPoint, end: MeasurementPoint): MeasurementPoint => [
  (start[0] + end[0]) / 2,
  (start[1] + end[1]) / 2,
  (start[2] + end[2]) / 2,
]

function buildFillGeometry(measurement: ResolvedMeasurementPayload): BufferGeometry | null {
  if (
    measurement.kind === 'distance' ||
    measurement.kind === 'angle' ||
    measurement.kind === 'perimeter'
  ) {
    return null
  }

  const triangles = triangulateMeasurementPolygon(measurement.base)
  if (triangles.length === 0) return null

  const top =
    measurement.kind === 'volume'
      ? measurement.base.map((point) => add(point, measurement.extrusion))
      : []
  const points = measurement.kind === 'volume' ? [...measurement.base, ...top] : measurement.base
  const indices: number[] = []

  for (const triangle of triangles) {
    indices.push(triangle[0]!, triangle[1]!, triangle[2]!)
    if (measurement.kind === 'volume') {
      const offset = measurement.base.length
      indices.push(triangle[0]! + offset, triangle[1]! + offset, triangle[2]! + offset)
    }
  }

  if (measurement.kind === 'volume') {
    const offset = measurement.base.length
    for (let index = 0; index < offset; index++) {
      const next = (index + 1) % offset
      indices.push(index, next, next + offset, index, next + offset, index + offset)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function buildRenderData(measurement: ResolvedMeasurementPayload): MeasurementRenderData {
  const linePositions: number[] = []
  const pushSegment = (start: MeasurementPoint, end: MeasurementPoint) => {
    linePositions.push(...start, ...end)
  }

  let markerPoints: MeasurementPoint[]
  let labelPosition: MeasurementPoint

  if (measurement.kind === 'distance') {
    const [start, end] = measurement.points
    pushSegment(start, end)
    markerPoints = [start, end]
    labelPosition = midpoint(start, end)
  } else if (measurement.kind === 'angle') {
    const [start, vertex, end] = measurement.points
    pushSegment(start, vertex)
    pushSegment(vertex, end)
    const angleArc = buildMeasurementAngleArcPoints(start, vertex, end)
    for (let index = 1; index < angleArc.length; index++) {
      pushSegment(angleArc[index - 1]!, angleArc[index]!)
    }
    markerPoints = [start, vertex, end]
    labelPosition = angleArc[Math.floor(angleArc.length / 2)] ?? vertex
  } else if (measurement.kind === 'area' || measurement.kind === 'perimeter') {
    for (let index = 0; index < measurement.base.length; index++) {
      pushSegment(
        measurement.base[index]!,
        measurement.base[(index + 1) % measurement.base.length]!,
      )
    }
    markerPoints = measurement.base
    labelPosition = measurementPolygonLabelAnchor(measurement.base) ?? measurement.base[0]!
  } else {
    const top = measurement.base.map((point) => add(point, measurement.extrusion))
    for (let index = 0; index < measurement.base.length; index++) {
      const next = (index + 1) % measurement.base.length
      pushSegment(measurement.base[index]!, measurement.base[next]!)
      pushSegment(top[index]!, top[next]!)
      pushSegment(measurement.base[index]!, top[index]!)
    }
    markerPoints = [...measurement.base, ...top]
    const centroid = measurementPolygonLabelAnchor(measurement.base) ?? measurement.base[0]!
    labelPosition = add(centroid, [
      measurement.extrusion[0] / 2,
      measurement.extrusion[1] / 2,
      measurement.extrusion[2] / 2,
    ])
  }

  const lineGeometry = new BufferGeometry()
  lineGeometry.setAttribute('position', new Float32BufferAttribute(linePositions, 3))

  return {
    fillGeometry: buildFillGeometry(measurement),
    labelPosition,
    lineGeometry,
    markerPoints,
  }
}

function formatMeasurement(
  measurement: ResolvedMeasurementPayload,
  unit: 'metric' | 'imperial',
): string {
  if (measurement.kind === 'distance') {
    return formatLinearMeasurement(measurementDistance(...measurement.points), unit)
  }
  if (measurement.kind === 'angle') {
    return formatAngleRadians(measurementAngle(...measurement.points))
  }
  if (measurement.kind === 'area') {
    return `A ${formatAreaLabel(measurementArea(measurement.base), unit)}`
  }
  if (measurement.kind === 'perimeter') {
    return `P ${formatLinearMeasurement(measurementPerimeter(measurement.base), unit)}`
  }
  return `V ${formatVolumeLabel(measurementPrismVolume(measurement.base, measurement.extrusion), unit)}`
}

export function areMeasurementAncestorsVisible(object: Object3D | null): boolean {
  let ancestor = object?.parent ?? null
  while (ancestor) {
    if (!ancestor.visible) return false
    ancestor = ancestor.parent
  }
  return true
}

export const MeasurementRenderer = ({ node }: { node: MeasurementNode }) => {
  const ref = useRef<Group>(null!)
  const ancestorVisibilityRef = useRef(true)
  const [ancestorsVisible, setAncestorsVisible] = useState(true)
  useRegistry(node.id, 'measurement', ref)

  const handlers = useNodeEvents(node, 'measurement')
  const showMeasurements = useViewer((state) => state.showMeasurements)
  const unit = useViewer((state) => state.unit)
  const active = useViewer(
    (state) =>
      state.hoveredId === node.id || state.selection.selectedIds.some((id) => id === node.id),
  )
  const ownOverride = useLiveNodeOverrides((state) => state.overrides.get(node.id)) as
    | Partial<MeasurementNode>
    | undefined
  const effectiveNode = useMemo(
    () => (ownOverride ? ({ ...node, ...ownOverride } as MeasurementNode) : node),
    [node, ownOverride],
  )
  const dependencyIds = measurementDependencyIds(
    effectiveNode.measurement,
    (id) => useScene.getState().nodes[id],
  )
  useScene(useShallow((state) => dependencyIds.map((id) => state.nodes[id])))
  useLiveNodeOverrides(useShallow((state) => dependencyIds.map((id) => state.overrides.get(id))))
  const resolved = resolveMeasurementNode(effectiveNode, (id) => {
    const referencedNode = useScene.getState().nodes[id]
    if (!referencedNode) return undefined
    const liveOverride = useLiveNodeOverrides.getState().overrides.get(id)
    return liveOverride ? ({ ...referencedNode, ...liveOverride } as AnyNode) : referencedNode
  })
  const data = buildRenderData(resolved.payload)
  const label = useMemo(() => {
    const value = formatMeasurement(resolved.payload, unit)
    return resolved.dangling.length > 0 ? `Unlinked · ${value}` : value
  }, [resolved, unit])
  const color = measurementPresentationColor(resolved.dangling.length > 0, active)
  const lineMaterial = useMemo(
    () =>
      new LineBasicNodeMaterial({
        color,
        linewidth: 2,
        depthTest: false,
        depthWrite: false,
      }),
    [color],
  )
  const fillMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        side: DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    [color],
  )

  useEffect(
    () => () => {
      data.fillGeometry?.dispose()
      data.lineGeometry.dispose()
    },
    [data],
  )
  useEffect(
    () => () => {
      lineMaterial.dispose()
      fillMaterial.dispose()
    },
    [fillMaterial, lineMaterial],
  )

  useFrame(() => {
    const visible = areMeasurementAncestorsVisible(ref.current)
    if (visible === ancestorVisibilityRef.current) return
    ancestorVisibilityRef.current = visible
    setAncestorsVisible(visible)
  })

  const shouldShow = showMeasurements && effectiveNode.visible !== false && ancestorsVisible

  return (
    <group ref={ref} {...handlers} userData={{ labelPosition: data.labelPosition }}>
      {shouldShow && (
        <>
          {data.fillGeometry && (
            <mesh
              frustumCulled={false}
              geometry={data.fillGeometry}
              layers={OVERLAY_LAYER}
              material={fillMaterial}
              renderOrder={1000}
              userData={{ excludeFromBvh: true }}
            />
          )}
          <lineSegments
            frustumCulled={false}
            geometry={data.lineGeometry}
            layers={OVERLAY_LAYER}
            material={lineMaterial}
            renderOrder={1001}
          />
          {data.markerPoints.map((point, index) => (
            <SurfaceContactMarker
              color={color}
              key={`${point.join(':')}:${index}`}
              normal={
                resolved.anchorNormals[index] ?? fallbackMarkerNormal(resolved.payload, index)
              }
              point={point}
            />
          ))}
          <Html
            center
            position={data.labelPosition}
            style={{ pointerEvents: 'none' }}
            zIndexRange={[30, 0]}
          >
            <div
              className={`whitespace-nowrap font-medium text-base text-white ${
                effectiveNode.measurement.kind === 'distance' ? '-translate-y-3' : ''
              }`}
              style={{
                textShadow: `-1px -1px 0 ${color}, 1px -1px 0 ${color}, -1px 1px 0 ${color}, 1px 1px 0 ${color}`,
              }}
            >
              {label}
            </div>
          </Html>
        </>
      )}
    </group>
  )
}

export default MeasurementRenderer

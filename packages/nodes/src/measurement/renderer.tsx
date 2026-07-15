'use client'

import {
  type AnyNode,
  type MeasurementNode,
  type MeasurementPoint,
  measurementAngle,
  measurementArea,
  measurementDistance,
  measurementPerimeter,
  measurementPrismVolume,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
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
  type Object3D,
  SphereGeometry,
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
    markerPoints = [start, vertex, end]
    labelPosition = vertex
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
  const dependencyIds = measurementDependencyIds(
    node.measurement,
    (id) => useScene.getState().nodes[id],
  )
  useScene(useShallow((state) => dependencyIds.map((id) => state.nodes[id])))
  useLiveNodeOverrides(useShallow((state) => dependencyIds.map((id) => state.overrides.get(id))))
  const resolved = resolveMeasurementNode(node, (id) => {
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
  const markerGeometry = useMemo(() => new SphereGeometry(0.035, 12, 8), [])
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
  const markerMaterial = useMemo(
    () =>
      new MeshBasicNodeMaterial({
        color,
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
      markerGeometry.dispose()
      lineMaterial.dispose()
      fillMaterial.dispose()
      markerMaterial.dispose()
    },
    [fillMaterial, lineMaterial, markerGeometry, markerMaterial],
  )

  useFrame(() => {
    const visible = areMeasurementAncestorsVisible(ref.current)
    if (visible === ancestorVisibilityRef.current) return
    ancestorVisibilityRef.current = visible
    setAncestorsVisible(visible)
  })

  const shouldShow = showMeasurements && node.visible !== false && ancestorsVisible

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
            <mesh
              geometry={markerGeometry}
              key={`${point.join(':')}:${index}`}
              layers={OVERLAY_LAYER}
              material={markerMaterial}
              position={point}
              renderOrder={1002}
              userData={{ excludeFromBvh: true }}
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
                node.measurement.kind === 'distance' ? '-translate-y-3' : ''
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

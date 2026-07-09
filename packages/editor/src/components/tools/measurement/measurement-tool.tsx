'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type CeilingNode,
  type ColumnNode,
  type ElevatorNode,
  emitter,
  type FenceNode,
  type GridEvent,
  getFenceCenterlineLength,
  getScaledDimensions,
  getWallCurveLength,
  type ItemNode,
  type NodeEvent,
  type SlabNode,
  sceneRegistry,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef } from 'react'
import { Box3, BoxGeometry, Quaternion, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { EDITOR_LAYER } from '../../../lib/constants'
import {
  angleBetweenMeasurements,
  formatAngleMeasurement,
  formatAreaMeasurement,
  formatLinearMeasurement,
} from '../../../lib/measurements'
import { cn } from '../../../lib/utils'
import useInteractionScope from '../../../store/use-interaction-scope'
import {
  axisLockedMeasurementPoint,
  distanceBetweenMeasurements,
  type MeasurementAngle,
  type MeasurementArea,
  type MeasurementPerimeter,
  type MeasurementPoint,
  type MeasurementSegment,
  type MeasurementSnapTarget,
  useMeasurementTool,
} from '../../../store/use-measurement-tool'

const MEASUREMENT_COLOR = 0x0e_a5_e9
const MEASUREMENT_DRAFT_COLOR = 0xf5_9e_0b
const MEASUREMENT_LINE_WIDTH = 0.018
const MEASUREMENT_END_TICK = 0.28
const MEASUREMENT_LABEL_LIFT = 0.08
const MEASUREMENT_CURSOR_SIZE = 0.18
const MEASUREMENT_CURSOR_WIDTH = 0.018
const MEASUREMENT_SURFACE_SNAP_RADIUS = 0.25
const SURFACE_EVENT_SUPPRESSION_MS = 80

const dashGeometry = new BoxGeometry(1, 1, 1)
const MEASUREMENT_BAR_AXIS = new Vector3(1, 0, 0)
const measurementMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
})
const draftMeasurementMaterial = new MeshBasicNodeMaterial({
  color: MEASUREMENT_DRAFT_COLOR,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  transparent: true,
})

const MEASURABLE_NODE_KINDS = [
  'wall',
  'fence',
  'item',
  'column',
  'slab',
  'ceiling',
  'roof',
  'roof-segment',
  'window',
  'door',
  'stair',
  'stair-segment',
  'shelf',
  'spawn',
  'elevator',
] as const

function isCanvasEvent(event: GridEvent, canvas: HTMLCanvasElement): boolean {
  return event.nativeEvent?.target === canvas
}

function measurementPointFromGridEvent(event: GridEvent): MeasurementPoint {
  return [...event.localPosition] as MeasurementPoint
}

function worldToBuildingLocal(point: [number, number, number]): MeasurementPoint {
  const buildingId = useViewer.getState().selection.buildingId
  const buildingMesh = buildingId ? sceneRegistry.nodes.get(buildingId as AnyNodeId) : null
  const local = buildingMesh
    ? buildingMesh.worldToLocal(new Vector3(...point))
    : new Vector3(...point)
  return [local.x, local.y, local.z]
}

function measurementPointFromNodeEvent(event: NodeEvent): MeasurementPoint {
  return worldToBuildingLocal(event.position)
}

function nodeLocalToMeasurementPoint(node: AnyNode, point: Vector3): MeasurementPoint | null {
  const object = sceneRegistry.nodes.get(node.id as AnyNodeId)
  if (!object) return null
  const worldPoint = object.localToWorld(point.clone())
  return worldToBuildingLocal([worldPoint.x, worldPoint.y, worldPoint.z])
}

function wallLengthSegment(node: WallNode): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} {
  return {
    start: [node.start[0], 0, node.start[1]],
    end: [node.end[0], 0, node.end[1]],
    measuredDistanceMeters: getWallCurveLength(node),
  }
}

function fenceLengthSegment(node: FenceNode): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} {
  return {
    start: [node.start[0], 0, node.start[1]],
    end: [node.end[0], 0, node.end[1]],
    measuredDistanceMeters: getFenceCenterlineLength(node),
  }
}

function horizontalBoxLengthSegment(
  node: AnyNode,
  dimensions: readonly [number, number, number],
): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} | null {
  const [width, , depth] = dimensions
  const measureWidth = width >= depth
  const halfLength = (measureWidth ? width : depth) / 2
  if (halfLength < 1e-4) return null

  const start = nodeLocalToMeasurementPoint(
    node,
    measureWidth ? new Vector3(-halfLength, 0, 0) : new Vector3(0, 0, -halfLength),
  )
  const end = nodeLocalToMeasurementPoint(
    node,
    measureWidth ? new Vector3(halfLength, 0, 0) : new Vector3(0, 0, halfLength),
  )
  if (!(start && end)) return null

  return {
    start,
    end,
    measuredDistanceMeters: halfLength * 2,
  }
}

function directLengthSegmentFromNode(node: AnyNode): {
  end: MeasurementPoint
  measuredDistanceMeters: number
  start: MeasurementPoint
} | null {
  if (node.type === 'wall') return wallLengthSegment(node as WallNode)
  if (node.type === 'fence') return fenceLengthSegment(node as FenceNode)
  if (node.type === 'item')
    return horizontalBoxLengthSegment(node, getScaledDimensions(node as ItemNode))
  if (node.type === 'column') {
    const column = node as ColumnNode
    return horizontalBoxLengthSegment(node, [column.width, column.height, column.depth])
  }
  if (node.type === 'elevator') {
    const elevator = node as ElevatorNode
    return horizontalBoxLengthSegment(node, [
      elevator.shaftWidth ?? elevator.width,
      elevator.cabHeight,
      elevator.shaftDepth ?? elevator.depth,
    ])
  }
  return null
}

function polygonAreaAndCentroid(polygon: ReadonlyArray<readonly [number, number]>): {
  area: number
  centroid: { x: number; y: number }
} {
  let cx = 0
  let cy = 0
  let area = 0

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const p1 = polygon[j]!
    const p2 = polygon[i]!
    const f = p1[0] * p2[1] - p2[0] * p1[1]
    cx += (p1[0] + p2[0]) * f
    cy += (p1[1] + p2[1]) * f
    area += f
  }

  area /= 2

  if (Math.abs(area) < 1e-9) {
    const fallback = polygon[0] ?? [0, 0]
    return { area: 0, centroid: { x: fallback[0], y: fallback[1] } }
  }

  return {
    area: Math.abs(area),
    centroid: { x: cx / (6 * area), y: cy / (6 * area) },
  }
}

function surfaceAreaMeasurementFromNode(node: AnyNode): {
  areaSquareMeters: number
  labelPoint: MeasurementPoint
} | null {
  if (!(node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone')) return null

  const surface = node as SlabNode | CeilingNode | ZoneNode
  const outer = polygonAreaAndCentroid(surface.polygon)
  const holes = 'holes' in surface ? surface.holes : []
  const holesArea = holes.reduce((sum, hole) => sum + polygonAreaAndCentroid(hole).area, 0)
  const labelY =
    surface.type === 'ceiling' ? surface.height : surface.type === 'slab' ? surface.elevation : 0

  return {
    areaSquareMeters: Math.max(0, outer.area - holesArea),
    labelPoint: [outer.centroid.x, labelY + 0.05, outer.centroid.y],
  }
}

function polygonPerimeter(polygon: ReadonlyArray<readonly [number, number]>): number {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point
    return sum + Math.hypot(next[0] - point[0], next[1] - point[1])
  }, 0)
}

function surfacePerimeterMeasurementFromNode(node: AnyNode): {
  labelPoint: MeasurementPoint
  lengthMeters: number
} | null {
  if (!(node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone')) return null

  const surface = node as SlabNode | CeilingNode | ZoneNode
  const outer = polygonAreaAndCentroid(surface.polygon)
  const holes = 'holes' in surface ? surface.holes : []
  const holesLength = holes.reduce((sum, hole) => sum + polygonPerimeter(hole), 0)
  const labelY =
    surface.type === 'ceiling' ? surface.height : surface.type === 'slab' ? surface.elevation : 0

  return {
    labelPoint: [outer.centroid.x, labelY + 0.05, outer.centroid.y],
    lengthMeters: polygonPerimeter(surface.polygon) + holesLength,
  }
}

function squaredMeasurementDistance(a: MeasurementPoint, b: MeasurementPoint): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz
}

function surfaceMeasurementAnchors(node: SlabNode | CeilingNode | ZoneNode): MeasurementPoint[] {
  const centroid = polygonAreaAndCentroid(node.polygon).centroid
  const y = node.type === 'ceiling' ? node.height : node.type === 'slab' ? node.elevation : 0
  const edgeMidpoints = node.polygon.map((point, index) => {
    const next = node.polygon[(index + 1) % node.polygon.length] ?? point
    return [(point[0] + next[0]) / 2, y, (point[1] + next[1]) / 2] as MeasurementPoint
  })
  return [
    ...node.polygon.map((point) => [point[0], y, point[1]] as MeasurementPoint),
    ...edgeMidpoints,
    [centroid.x, y, centroid.y],
  ]
}

function localBoxMeasurementAnchors(
  node: AnyNode,
  dimensions: readonly [number, number, number],
): MeasurementPoint[] {
  const [width, , depth] = dimensions
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const localAnchors = [
    new Vector3(-halfWidth, 0, -halfDepth),
    new Vector3(halfWidth, 0, -halfDepth),
    new Vector3(halfWidth, 0, halfDepth),
    new Vector3(-halfWidth, 0, halfDepth),
    new Vector3(0, 0, -halfDepth),
    new Vector3(halfWidth, 0, 0),
    new Vector3(0, 0, halfDepth),
    new Vector3(-halfWidth, 0, 0),
    new Vector3(0, 0, 0),
  ]

  return localAnchors
    .map((anchor) => nodeLocalToMeasurementPoint(node, anchor))
    .filter((anchor): anchor is MeasurementPoint => anchor !== null)
}

function boundingBoxMeasurementAnchors(node: AnyNode): MeasurementPoint[] {
  const object = sceneRegistry.nodes.get(node.id as AnyNodeId)
  if (!object) return []

  object.updateWorldMatrix(true, true)
  const box = new Box3().setFromObject(object)
  if (box.isEmpty()) return []

  const min = box.min
  const max = box.max
  const center = box.getCenter(new Vector3())
  const corners = [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(max.x, max.y, max.z),
    new Vector3(min.x, max.y, max.z),
  ]
  const edgeMidpoints = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
    [corners[4], corners[5]],
    [corners[5], corners[6]],
    [corners[6], corners[7]],
    [corners[7], corners[4]],
    [corners[0], corners[4]],
    [corners[1], corners[5]],
    [corners[2], corners[6]],
    [corners[3], corners[7]],
  ].map(([a, b]) => a!.clone().add(b!).multiplyScalar(0.5))
  const faceCenters = [
    new Vector3(center.x, min.y, center.z),
    new Vector3(center.x, max.y, center.z),
    new Vector3(min.x, center.y, center.z),
    new Vector3(max.x, center.y, center.z),
    new Vector3(center.x, center.y, min.z),
    new Vector3(center.x, center.y, max.z),
  ]

  return [...corners, ...edgeMidpoints, ...faceCenters, center].map((point) =>
    worldToBuildingLocal([point.x, point.y, point.z]),
  )
}

function nodeMeasurementAnchors(node: AnyNode): MeasurementPoint[] {
  const boxAnchors = boundingBoxMeasurementAnchors(node)

  if (node.type === 'slab' || node.type === 'ceiling' || node.type === 'zone') {
    return [...surfaceMeasurementAnchors(node as SlabNode | CeilingNode | ZoneNode), ...boxAnchors]
  }
  if (node.type === 'item') {
    return [
      ...localBoxMeasurementAnchors(node, getScaledDimensions(node as ItemNode)),
      ...boxAnchors,
    ]
  }
  if (node.type === 'column') {
    const column = node as ColumnNode
    return [
      ...localBoxMeasurementAnchors(node, [column.width, column.height, column.depth]),
      ...boxAnchors,
    ]
  }
  if (node.type === 'elevator') {
    const elevator = node as ElevatorNode
    return [
      ...localBoxMeasurementAnchors(node, [
        elevator.shaftWidth ?? elevator.width,
        elevator.cabHeight,
        elevator.shaftDepth ?? elevator.depth,
      ]),
      ...boxAnchors,
    ]
  }
  return boxAnchors
}

function resolveNodeMeasurementSnap(
  node: AnyNode,
  point: MeasurementPoint,
): {
  point: MeasurementPoint
  target: MeasurementSnapTarget | null
} {
  const anchors = nodeMeasurementAnchors(node)
  if (anchors.length === 0) return { point, target: null }

  const maxDistanceSq = MEASUREMENT_SURFACE_SNAP_RADIUS * MEASUREMENT_SURFACE_SNAP_RADIUS
  let closest: MeasurementPoint | null = null
  let closestDistanceSq = maxDistanceSq

  for (const anchor of anchors) {
    const distanceSq = squaredMeasurementDistance(point, anchor)
    if (distanceSq <= closestDistanceSq) {
      closest = anchor
      closestDistanceSq = distanceSq
    }
  }

  return {
    point: closest ?? point,
    target: closest ? { label: 'Snap', point: closest, view: '3d' } : null,
  }
}

export function handleMeasurementGridMove3D(
  event: GridEvent,
  canvas: HTMLCanvasElement,
  shouldIgnoreGridEvent: () => boolean = () => false,
): void {
  if (!isCanvasEvent(event, canvas)) return
  if (shouldIgnoreGridEvent()) return
  const measurement = useMeasurementTool.getState()
  const rawPoint = measurementPointFromGridEvent(event)
  measurement.setSnapTarget(null)
  const point =
    event.nativeEvent.shiftKey && measurement.draft?.view === '3d'
      ? axisLockedMeasurementPoint(measurement.draft.start, rawPoint, '3d')
      : rawPoint
  measurement.setCursor('3d', point)
  if (measurement.angleDraft) {
    measurement.updateAngle(point)
    return
  }
  if (!measurement.draft) return
  measurement.update(point)
}

export function handleMeasurementGridClick3D(
  event: GridEvent,
  canvas: HTMLCanvasElement,
  shouldIgnoreGridEvent: () => boolean = () => false,
): void {
  if (!isCanvasEvent(event, canvas)) return
  if (shouldIgnoreGridEvent()) return
  const measurement = useMeasurementTool.getState()
  const rawPoint = measurementPointFromGridEvent(event)
  measurement.setSnapTarget(null)
  const point =
    event.nativeEvent.shiftKey && measurement.draft?.view === '3d'
      ? axisLockedMeasurementPoint(measurement.draft.start, rawPoint, '3d')
      : rawPoint
  measurement.setCursor('3d', point)
  if (event.nativeEvent.shiftKey && measurement.draft?.view === '3d') {
    measurement.commit(point)
    return
  }
  if (event.nativeEvent.shiftKey || measurement.mode === 'angle' || measurement.angleDraft) {
    if (measurement.angleDraft) {
      measurement.commitAngle(point)
    } else {
      measurement.beginAngle('3d', point)
    }
    return
  }
  if (measurement.mode !== 'distance') return
  if (measurement.draft) {
    measurement.commit(point)
  } else {
    measurement.begin('3d', point)
  }
}

export function handleMeasurementNodeClick3D(event: NodeEvent): void {
  event.stopPropagation()

  const measurement = useMeasurementTool.getState()
  const snap = resolveNodeMeasurementSnap(event.node, measurementPointFromNodeEvent(event))
  const isAxisLocked = event.nativeEvent.shiftKey && measurement.draft?.view === '3d'
  const point =
    isAxisLocked && measurement.draft
      ? axisLockedMeasurementPoint(measurement.draft.start, snap.point, '3d')
      : snap.point
  const quickMeasure = Boolean(
    event.nativeEvent.altKey || event.nativeEvent.ctrlKey || event.nativeEvent.metaKey,
  )
  measurement.setCursor('3d', point)
  measurement.setSnapTarget(isAxisLocked ? null : snap.target)
  if (event.nativeEvent.shiftKey && measurement.draft?.view === '3d') {
    measurement.commit(point)
    return
  }
  if (event.nativeEvent.shiftKey || measurement.mode === 'angle' || measurement.angleDraft) {
    if (measurement.angleDraft) {
      measurement.commitAngle(point)
    } else {
      measurement.beginAngle('3d', point)
    }
    return
  }

  if (!measurement.draft) {
    if (quickMeasure || measurement.mode === 'perimeter') {
      const perimeter = surfacePerimeterMeasurementFromNode(event.node)
      if (perimeter) {
        measurement.addPerimeter('3d', perimeter.labelPoint, perimeter.lengthMeters)
        return
      }
    }

    if (measurement.mode === 'area') {
      const area = surfaceAreaMeasurementFromNode(event.node)
      if (area) {
        measurement.addArea('3d', area.labelPoint, area.areaSquareMeters)
        return
      }
    }

    if (measurement.mode === 'distance' && quickMeasure) {
      const segment = directLengthSegmentFromNode(event.node)
      if (segment) {
        measurement.addSegment('3d', segment.start, segment.end, segment.measuredDistanceMeters)
        return
      }
    }
  }

  if (measurement.mode !== 'distance') return

  if (measurement.draft) {
    measurement.commit(point)
  } else {
    measurement.begin('3d', point)
  }
}

function MeasurementCursor3D({ point }: { point: MeasurementPoint }) {
  return (
    <group position={point}>
      <mesh
        geometry={dashGeometry}
        layers={EDITOR_LAYER}
        material={draftMeasurementMaterial}
        renderOrder={1001}
        scale={[MEASUREMENT_CURSOR_SIZE, MEASUREMENT_CURSOR_WIDTH, MEASUREMENT_CURSOR_WIDTH]}
      />
      <mesh
        geometry={dashGeometry}
        layers={EDITOR_LAYER}
        material={draftMeasurementMaterial}
        renderOrder={1001}
        scale={[MEASUREMENT_CURSOR_WIDTH, MEASUREMENT_CURSOR_WIDTH, MEASUREMENT_CURSOR_SIZE]}
      />
      <mesh
        geometry={dashGeometry}
        layers={EDITOR_LAYER}
        material={draftMeasurementMaterial}
        renderOrder={1001}
        scale={[MEASUREMENT_CURSOR_WIDTH, MEASUREMENT_CURSOR_SIZE, MEASUREMENT_CURSOR_WIDTH]}
      />
    </group>
  )
}

function MeasurementSnapTarget3D({ target }: { target: MeasurementSnapTarget }) {
  return (
    <group position={target.point}>
      <MeasurementCursor3D point={[0, 0, 0]} />
      <Html center distanceFactor={12} position={[0, MEASUREMENT_CURSOR_SIZE + 0.08, 0]}>
        <span className="pointer-events-none whitespace-nowrap rounded-full border border-sky-400/60 bg-background/90 px-2 py-1 font-semibold text-[10px] text-sky-700 shadow-sm backdrop-blur dark:text-sky-300">
          {target.label}
        </span>
      </Html>
    </group>
  )
}

function MeasurementArea3D({
  area,
  isSelected,
  onSelect,
}: {
  area: MeasurementArea
  isSelected: boolean
  onSelect: (id: string, event: PointerEvent<HTMLSpanElement>) => void
}) {
  const unit = useViewer((s) => s.unit)

  return (
    <Html center distanceFactor={12} position={area.labelPoint}>
      <MeasurementValuePill
        isSelected={isSelected}
        onPointerDown={(event) => onSelect(area.id, event)}
      >
        {formatAreaMeasurement(area.areaSquareMeters, unit)}
      </MeasurementValuePill>
    </Html>
  )
}

function MeasurementPerimeter3D({
  isSelected,
  onSelect,
  perimeter,
}: {
  isSelected: boolean
  onSelect: (id: string, event: PointerEvent<HTMLSpanElement>) => void
  perimeter: MeasurementPerimeter
}) {
  const unit = useViewer((s) => s.unit)

  return (
    <Html center distanceFactor={12} position={perimeter.labelPoint}>
      <MeasurementValuePill
        isSelected={isSelected}
        onPointerDown={(event) => onSelect(perimeter.id, event)}
      >
        {`P ${formatLinearMeasurement(perimeter.lengthMeters, unit)}`}
      </MeasurementValuePill>
    </Html>
  )
}

function MeasurementValuePill({
  children,
  draft = false,
  isSelected = true,
  onPointerDown,
}: {
  children: ReactNode
  draft?: boolean
  isSelected?: boolean
  onPointerDown?: (event: PointerEvent<HTMLSpanElement>) => void
}) {
  return (
    <span
      className={cn(
        'pointer-events-none whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-3 py-1.5 font-medium text-foreground text-xs tabular-nums shadow-sm backdrop-blur',
        'transition-[border-color,box-shadow,color,opacity]',
        onPointerDown && 'pointer-events-auto cursor-pointer',
        draft && 'border-amber-500/55 text-amber-700 shadow-amber-500/10 dark:text-amber-300',
        !isSelected && 'opacity-45',
      )}
      onPointerDown={onPointerDown}
    >
      {children}
    </span>
  )
}

function MeasurementBar3D({
  end,
  material,
  start,
  width = MEASUREMENT_LINE_WIDTH,
}: {
  end: Vector3
  material: MeshBasicNodeMaterial
  start: Vector3
  width?: number
}) {
  const segment = useMemo(() => {
    const direction = end.clone().sub(start)
    const length = direction.length()
    if (!Number.isFinite(length) || length < 1e-4) return null

    return {
      length,
      position: start.clone().add(end).multiplyScalar(0.5),
      quaternion: new Quaternion().setFromUnitVectors(MEASUREMENT_BAR_AXIS, direction.normalize()),
    }
  }, [end, start])

  if (!segment) return null

  return (
    <mesh
      geometry={dashGeometry}
      layers={EDITOR_LAYER}
      material={material}
      position={segment.position}
      quaternion={segment.quaternion}
      renderOrder={1000}
      scale={[segment.length, width, width]}
    />
  )
}

function MeasurementLine3D({
  draft = false,
  isSelected = true,
  onSelect,
  segment,
  showLabel = true,
}: {
  draft?: boolean
  isSelected?: boolean
  onSelect?: (id: string, event: PointerEvent<HTMLSpanElement>) => void
  segment: Pick<MeasurementSegment, 'id' | 'start' | 'end' | 'measuredDistanceMeters'>
  showLabel?: boolean
}) {
  const unit = useViewer((s) => s.unit)
  const distance =
    segment.measuredDistanceMeters ?? distanceBetweenMeasurements(segment.start, segment.end)
  const lineLayout = useMemo(() => {
    const start = new Vector3(...segment.start)
    const end = new Vector3(...segment.end)
    const direction = end.clone().sub(start)
    const length = direction.length()
    const midpoint = start.clone().add(end).multiplyScalar(0.5)
    const unitDirection = length > 1e-4 ? direction.clone().normalize() : new Vector3(1, 0, 0)
    const tickDirection =
      Math.abs(unitDirection.dot(new Vector3(0, 1, 0))) > 0.94
        ? new Vector3(1, 0, 0)
        : new Vector3(0, 1, 0)
    const tickOffset = tickDirection.clone().multiplyScalar(MEASUREMENT_END_TICK / 2)

    return {
      end,
      labelPosition: midpoint
        .clone()
        .add(
          tickDirection.clone().multiplyScalar(MEASUREMENT_END_TICK / 2 + MEASUREMENT_LABEL_LIFT),
        ),
      start,
      tickEndA: end.clone().add(tickOffset),
      tickEndB: end.clone().sub(tickOffset),
      tickStartA: start.clone().add(tickOffset),
      tickStartB: start.clone().sub(tickOffset),
    }
  }, [segment.end, segment.start])

  if (distance < 1e-4) return null

  const material = draft ? draftMeasurementMaterial : measurementMaterial

  return (
    <group>
      <MeasurementBar3D end={lineLayout.end} material={material} start={lineLayout.start} />
      <MeasurementBar3D
        end={lineLayout.tickStartB}
        material={material}
        start={lineLayout.tickStartA}
      />
      <MeasurementBar3D end={lineLayout.tickEndB} material={material} start={lineLayout.tickEndA} />
      {showLabel ? (
        <Html center distanceFactor={12} position={lineLayout.labelPosition}>
          <MeasurementValuePill
            draft={draft}
            isSelected={isSelected}
            onPointerDown={onSelect && !draft ? (event) => onSelect(segment.id, event) : undefined}
          >
            {formatLinearMeasurement(distance, unit)}
          </MeasurementValuePill>
        </Html>
      ) : null}
    </group>
  )
}

function MeasurementAngle3D({
  angle,
  draft = false,
  isSelected,
  onSelect,
}: {
  angle: MeasurementAngle
  draft?: boolean
  isSelected: boolean
  onSelect?: (id: string, event: PointerEvent<HTMLSpanElement>) => void
}) {
  const labelPosition = useMemo(() => {
    const first = new Vector3(...angle.first)
    const vertex = new Vector3(...angle.vertex)
    const second = new Vector3(...angle.second)
    const firstDirection = first.sub(vertex).normalize()
    const secondDirection = second.sub(vertex).normalize()
    const bisector = firstDirection.add(secondDirection)
    if (bisector.lengthSq() < 1e-6) {
      bisector.copy(secondDirection)
    }
    return vertex.clone().add(bisector.normalize().multiplyScalar(0.45))
  }, [angle.first, angle.second, angle.vertex])

  return (
    <group>
      <MeasurementLine3D
        draft={draft}
        isSelected={isSelected}
        segment={{ id: `${angle.id}-a`, start: angle.vertex, end: angle.first }}
        showLabel={false}
      />
      <MeasurementLine3D
        draft={draft}
        isSelected={isSelected}
        segment={{ id: `${angle.id}-b`, start: angle.vertex, end: angle.second }}
        showLabel={false}
      />
      <Html center distanceFactor={12} position={labelPosition}>
        <MeasurementValuePill
          draft={draft}
          isSelected={isSelected}
          onPointerDown={onSelect && !draft ? (event) => onSelect(angle.id, event) : undefined}
        >
          {formatAngleMeasurement(
            angleBetweenMeasurements(angle.first, angle.vertex, angle.second),
          )}
        </MeasurementValuePill>
      </Html>
    </group>
  )
}

export function MeasurementTool() {
  const unit = useViewer((state) => state.unit)
  const canvas = useThree((state) => state.gl.domElement)
  const segments = useMeasurementTool((state) => state.segments)
  const areas = useMeasurementTool((state) => state.areas)
  const perimeters = useMeasurementTool((state) => state.perimeters)
  const angles = useMeasurementTool((state) => state.angles)
  const draft = useMeasurementTool((state) => state.draft)
  const angleDraft = useMeasurementTool((state) => state.angleDraft)
  const cursor = useMeasurementTool((state) => state.cursor)
  const snapTarget = useMeasurementTool((state) => state.snapTarget)
  const selectedId = useMeasurementTool((state) => state.selectedId)
  const lastSurfaceEventAtRef = useRef(0)

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'measurement' })
    return () => {
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'measurement')
      useMeasurementTool.getState().cancelDraft()
      useMeasurementTool.getState().setCursor('3d', null)
    }
  }, [])

  useEffect(() => {
    const noteSurfaceEvent = () => {
      lastSurfaceEventAtRef.current = performance.now()
    }
    const shouldIgnoreGridEvent = () =>
      performance.now() - lastSurfaceEventAtRef.current < SURFACE_EVENT_SUPPRESSION_MS

    const handleMove = (event: GridEvent) => {
      handleMeasurementGridMove3D(event, canvas, shouldIgnoreGridEvent)
    }

    const handleClick = (event: GridEvent) => {
      handleMeasurementGridClick3D(event, canvas, shouldIgnoreGridEvent)
    }

    const handleNodeMove = (event: NodeEvent) => {
      noteSurfaceEvent()
      const snap = resolveNodeMeasurementSnap(event.node, measurementPointFromNodeEvent(event))
      const measurement = useMeasurementTool.getState()
      const isAxisLocked = event.nativeEvent.shiftKey && measurement.draft?.view === '3d'
      const point =
        isAxisLocked && measurement.draft
          ? axisLockedMeasurementPoint(measurement.draft.start, snap.point, '3d')
          : snap.point
      measurement.setCursor('3d', point)
      measurement.setSnapTarget(isAxisLocked ? null : snap.target)
      if (measurement.angleDraft) {
        measurement.updateAngle(point)
        return
      }
      if (!measurement.draft) return
      measurement.update(point)
    }

    const handleNodeClick = (event: NodeEvent) => {
      noteSurfaceEvent()
      handleMeasurementNodeClick3D(event)
    }

    const handleCancel = () => {
      const measurement = useMeasurementTool.getState()
      if (
        !measurement.cursor &&
        !measurement.angleDraft &&
        !measurement.draft &&
        measurement.segments.length === 0 &&
        measurement.areas.length === 0 &&
        measurement.perimeters.length === 0 &&
        measurement.angles.length === 0
      )
        return
      markToolCancelConsumed()
      measurement.clear()
    }

    emitter.on('grid:move', handleMove)
    emitter.on('grid:click', handleClick)
    emitter.on('tool:cancel', handleCancel)
    for (const kind of MEASURABLE_NODE_KINDS) {
      emitter.on(`${kind}:move` as never, handleNodeMove as never)
      emitter.on(`${kind}:click` as never, handleNodeClick as never)
    }
    return () => {
      emitter.off('grid:move', handleMove)
      emitter.off('grid:click', handleClick)
      emitter.off('tool:cancel', handleCancel)
      for (const kind of MEASURABLE_NODE_KINDS) {
        emitter.off(`${kind}:move` as never, handleNodeMove as never)
        emitter.off(`${kind}:click` as never, handleNodeClick as never)
      }
    }
  }, [canvas])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.key === 'Delete' || event.key === 'Backspace')) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return
      const measurement = useMeasurementTool.getState()
      if (!measurement.selectedId) return
      event.preventDefault()
      event.stopPropagation()
      measurement.deleteSelected()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  const handleSelectMeasurement = (id: string, event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault()
    event.stopPropagation()
    useMeasurementTool.getState().selectMeasurement(id)
  }
  const draftAngle =
    angleDraft?.view === '3d' && angleDraft.vertex && angleDraft.second
      ? {
          first: angleDraft.first,
          id: 'measurement-angle-draft',
          second: angleDraft.second,
          vertex: angleDraft.vertex,
          view: angleDraft.view,
        }
      : null

  return (
    <>
      {segments
        .filter((segment) => segment.view === '3d')
        .map((segment) => (
          <MeasurementLine3D
            isSelected={selectedId ? selectedId === segment.id : true}
            key={segment.id}
            onSelect={handleSelectMeasurement}
            segment={segment}
          />
        ))}
      {draft?.view === '3d' && draft.end ? (
        <MeasurementLine3D
          draft
          segment={{ id: 'measurement-draft', start: draft.start, end: draft.end }}
        />
      ) : null}
      {areas
        .filter((area) => area.view === '3d')
        .map((area) => (
          <MeasurementArea3D
            area={area}
            isSelected={selectedId ? selectedId === area.id : true}
            key={area.id}
            onSelect={handleSelectMeasurement}
          />
        ))}
      {perimeters
        .filter((perimeter) => perimeter.view === '3d')
        .map((perimeter) => (
          <MeasurementPerimeter3D
            isSelected={selectedId ? selectedId === perimeter.id : true}
            key={perimeter.id}
            onSelect={handleSelectMeasurement}
            perimeter={perimeter}
          />
        ))}
      {angles
        .filter((angle) => angle.view === '3d')
        .map((angle) => (
          <MeasurementAngle3D
            angle={angle}
            isSelected={selectedId ? selectedId === angle.id : true}
            key={angle.id}
            onSelect={handleSelectMeasurement}
          />
        ))}
      {draftAngle ? <MeasurementAngle3D angle={draftAngle} draft isSelected /> : null}
      {snapTarget?.view === '3d' ? <MeasurementSnapTarget3D target={snapTarget} /> : null}
      {cursor?.view === '3d' ? <MeasurementCursor3D point={cursor.point} /> : null}
    </>
  )
}

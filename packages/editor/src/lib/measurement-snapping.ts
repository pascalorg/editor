import {
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
  type MeasurementDefinitionSnapGeometry,
  nodeAlignmentAnchors,
  nodeRegistry,
} from '@pascal-app/core'
import type {
  MeasurementPoint,
  MeasurementSegment,
  MeasurementSnapKind,
  MeasurementSnapSettings,
  MeasurementSnapTarget,
  MeasurementView,
} from '../store/use-measurement-tool'

export type MeasurementSnapAnchor = {
  kind?: MeasurementSnapKind
  label: string
  point: MeasurementPoint
  priority?: number
}

export type MeasurementSnapSegment = {
  kind?: MeasurementSnapKind
  label: string
  sourceId?: string
  start: MeasurementPoint
  end: MeasurementPoint
  priority?: number
}

export type MeasurementSnapGeometry = {
  anchors: MeasurementSnapAnchor[]
  segments: MeasurementSnapSegment[]
}

type PlanPoint = { x: number; y: number }
type PlanAABB = { minX: number; minZ: number; maxX: number; maxZ: number }
type UnknownPlanPolygonObject = { points?: unknown; type?: unknown }

const EPSILON = 1e-8
const DEFAULT_GRID_STEP = 0.5
const DEFAULT_GRID_PRIORITY = 100
const CURVE_SNAP_SEGMENTS = 32
const SNAP_PRIORITY_BUCKET = 1000

function snapPriority(anchor: Pick<MeasurementSnapAnchor, 'kind' | 'label' | 'priority'>): number {
  return (
    anchor.priority ?? SNAP_KIND_PRIORITY[anchor.kind ?? measurementSnapKindFromLabel(anchor.label)]
  )
}

const SNAP_KIND_PRIORITY: Record<MeasurementSnapKind, number> = {
  endpoint: 0,
  intersection: 0,
  vertex: 0,
  measurement: 1,
  midpoint: 2,
  center: 3,
  surface: 3,
  edge: 4,
  guide: 5,
  grid: DEFAULT_GRID_PRIORITY,
}

function snapScore(distanceSq: number, priority: number): number {
  return priority * SNAP_PRIORITY_BUCKET + distanceSq
}

export function measurementSnapKindFromLabel(label: string): MeasurementSnapKind {
  const normalized = label.toLowerCase()
  if (normalized.includes('surface')) return 'surface'
  if (normalized.includes('measurement')) return 'measurement'
  if (normalized.includes('intersection')) return 'intersection'
  if (
    normalized.includes('parallel') ||
    normalized.includes('perpendicular') ||
    normalized.includes('polar') ||
    normalized.includes('guide')
  )
    return 'guide'
  if (normalized.includes('grid')) return 'grid'
  if (normalized.includes('midpoint')) return 'midpoint'
  if (normalized.includes('endpoint')) return 'endpoint'
  if (normalized.includes('vertex') || normalized.includes('corner')) return 'vertex'
  if (normalized.includes('center')) return 'center'
  if (normalized.includes('edge')) return 'edge'
  return 'vertex'
}

export function polygonAreaAndCentroid(polygon: ReadonlyArray<readonly [number, number]>): {
  area: number
  centroid: PlanPoint
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

  if (Math.abs(area) < EPSILON) {
    const fallback = polygon[0] ?? [0, 0]
    return { area: 0, centroid: { x: fallback[0], y: fallback[1] } }
  }

  return {
    area: Math.abs(area),
    centroid: { x: cx / (6 * area), y: cy / (6 * area) },
  }
}

function planDistanceSq(a: MeasurementPoint, b: MeasurementPoint): number {
  const dx = a[0] - b[0]
  const dz = a[2] - b[2]
  return dx * dx + dz * dz
}

function projectPointToPlanSegment(
  point: MeasurementPoint,
  start: MeasurementPoint,
  end: MeasurementPoint,
): MeasurementPoint | null {
  const dx = end[0] - start[0]
  const dz = end[2] - start[2]
  const lengthSq = dx * dx + dz * dz
  if (lengthSq < EPSILON) return null
  const t = Math.min(
    1,
    Math.max(0, ((point[0] - start[0]) * dx + (point[2] - start[2]) * dz) / lengthSq),
  )
  return [start[0] + dx * t, start[1] + (end[1] - start[1]) * t, start[2] + dz * t]
}

function addPolygonGeometry(
  geometry: MeasurementSnapGeometry,
  polygon: ReadonlyArray<readonly [number, number]>,
  y: number,
  vertexLabel: string,
  edgeLabel: string,
  centerLabel: string,
) {
  if (polygon.length === 0) return
  const centroid = polygonAreaAndCentroid(polygon).centroid
  const points = polygon.map((point) => [point[0], y, point[1]] as MeasurementPoint)

  for (const point of points) {
    geometry.anchors.push({ label: vertexLabel, kind: 'vertex', point, priority: 0 })
  }
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!
    geometry.anchors.push({
      label: 'Edge midpoint',
      kind: 'midpoint',
      point: [(start[0] + end[0]) / 2, y, (start[2] + end[2]) / 2],
      priority: 1,
    })
    geometry.segments.push({ label: edgeLabel, kind: 'edge', start, end, priority: 3 })
  }
  geometry.anchors.push({
    label: centerLabel,
    kind: 'center',
    point: [centroid.x, y, centroid.y],
    priority: 2,
  })
}

function normalizePlanPolygon(polygon: unknown): ReadonlyArray<readonly [number, number]> | null {
  const points =
    Array.isArray(polygon) || !polygon || typeof polygon !== 'object'
      ? polygon
      : (polygon as UnknownPlanPolygonObject).points
  if (!Array.isArray(points) || points.length < 3) return null

  const normalized = points
    .map((point): readonly [number, number] | null => {
      if (!Array.isArray(point) || point.length < 2) return null
      const [x, z] = point
      return typeof x === 'number' && typeof z === 'number' ? [x, z] : null
    })
    .filter((point): point is readonly [number, number] => point !== null)

  return normalized.length >= 3 ? normalized : null
}

function genericPolygonElevation(node: AnyNode): number {
  const maybePosition = (node as { position?: unknown }).position
  if (Array.isArray(maybePosition) && typeof maybePosition[1] === 'number') {
    return maybePosition[1]
  }
  const maybeElevation = (node as { elevation?: unknown }).elevation
  return typeof maybeElevation === 'number' ? maybeElevation : 0
}

function addGenericPolygonGeometry(geometry: MeasurementSnapGeometry, node: AnyNode): boolean {
  const polygon = normalizePlanPolygon((node as { polygon?: unknown }).polygon)
  if (!polygon) return false

  const y = genericPolygonElevation(node)
  const labelPrefix = 'Polygon'
  addPolygonGeometry(
    geometry,
    polygon,
    y,
    `${labelPrefix} vertex`,
    `${labelPrefix} edge`,
    `${labelPrefix} center`,
  )

  const holes = (node as { holes?: unknown }).holes
  if (Array.isArray(holes)) {
    for (const hole of holes) {
      const normalizedHole = normalizePlanPolygon(hole)
      if (!normalizedHole) continue
      addPolygonGeometry(
        geometry,
        normalizedHole,
        y,
        `${labelPrefix} opening vertex`,
        `${labelPrefix} opening edge`,
        `${labelPrefix} opening center`,
      )
    }
  }

  return true
}

function addRectangleGeometry(
  geometry: MeasurementSnapGeometry,
  polygon: ReadonlyArray<PlanPoint>,
) {
  if (polygon.length === 0) return
  const centroid = {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
  }
  const points = polygon.map((point) => [point.x, 0, point.y] as MeasurementPoint)
  for (const point of points) {
    geometry.anchors.push({ label: 'Corner', kind: 'vertex', point, priority: 0 })
  }
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!
    const end = points[(index + 1) % points.length]!
    geometry.anchors.push({
      label: 'Edge midpoint',
      kind: 'midpoint',
      point: [(start[0] + end[0]) / 2, 0, (start[2] + end[2]) / 2],
      priority: 1,
    })
    geometry.segments.push({ label: 'Edge', kind: 'edge', start, end, priority: 3 })
  }
  geometry.anchors.push({
    label: 'Center',
    kind: 'center',
    point: [centroid.x, 0, centroid.y],
    priority: 2,
  })
}

function addPlanAABBGeometry(
  geometry: MeasurementSnapGeometry,
  aabb: PlanAABB,
  labels: {
    center: string
    edge: string
    vertex: string
  },
) {
  addRectangleGeometry(geometry, [
    { x: aabb.minX, y: aabb.minZ },
    { x: aabb.maxX, y: aabb.minZ },
    { x: aabb.maxX, y: aabb.maxZ },
    { x: aabb.minX, y: aabb.maxZ },
  ])
  const addedAnchorCount = 9
  const addedSegmentCount = 4
  for (const anchor of geometry.anchors.slice(-addedAnchorCount)) {
    if (anchor.kind === 'center') anchor.label = labels.center
    else if (anchor.kind === 'midpoint') anchor.label = 'Edge midpoint'
    else anchor.label = labels.vertex
  }
  for (const segment of geometry.segments.slice(-addedSegmentCount)) {
    segment.label = labels.edge
  }
}

function addAlignmentAnchorGeometry(
  geometry: MeasurementSnapGeometry,
  node: AnyNode,
  nodesById: Readonly<Record<string, AnyNode>>,
) {
  const anchors = nodeAlignmentAnchors(node, nodesById)
  if (anchors.length === 0) return

  const uniquePoints = new Map<string, MeasurementPoint>()
  for (const anchor of anchors) {
    const key = `${anchor.x.toFixed(6)}:${anchor.z.toFixed(6)}`
    if (!uniquePoints.has(key)) uniquePoints.set(key, [anchor.x, 0, anchor.z])
  }

  const points = [...uniquePoints.values()]
  if (points.length === 4) {
    const xs = [...new Set(points.map((point) => point[0]))]
    const zs = [...new Set(points.map((point) => point[2]))]
    if (xs.length === 2 && zs.length === 2) {
      addPlanAABBGeometry(
        geometry,
        {
          minX: Math.min(...xs),
          minZ: Math.min(...zs),
          maxX: Math.max(...xs),
          maxZ: Math.max(...zs),
        },
        {
          center: 'Footprint center',
          edge: 'Footprint edge',
          vertex: 'Footprint vertex',
        },
      )
      return
    }
  }

  for (const point of points) {
    geometry.anchors.push({
      label: 'Footprint vertex',
      kind: 'vertex',
      point,
      priority: 0,
    })
  }
}

function addPathGeometry(geometry: MeasurementSnapGeometry, node: AnyNode) {
  const path = (node as { path?: unknown }).path
  if (!Array.isArray(path) || path.length < 2) return false

  const points = path
    .map((point): MeasurementPoint | null => {
      if (!Array.isArray(point) || point.length < 3) return null
      const [x, , z] = point
      return typeof x === 'number' && typeof z === 'number' ? [x, 0, z] : null
    })
    .filter((point): point is MeasurementPoint => point !== null)

  if (points.length < 2) return false

  geometry.anchors.push(
    { label: 'Run endpoint', kind: 'endpoint', point: points[0]!, priority: 0 },
    { label: 'Run endpoint', kind: 'endpoint', point: points[points.length - 1]!, priority: 0 },
  )

  for (let index = 1; index < points.length - 1; index += 1) {
    geometry.anchors.push({
      label: 'Run vertex',
      kind: 'vertex',
      point: points[index]!,
      priority: 0,
    })
  }

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!
    const end = points[index]!
    geometry.anchors.push({
      label: 'Run midpoint',
      kind: 'midpoint',
      point: [(start[0] + end[0]) / 2, 0, (start[2] + end[2]) / 2],
      priority: 1,
    })
    geometry.segments.push({
      label: 'Run edge',
      kind: 'edge',
      sourceId: node.id,
      start,
      end,
      priority: 3,
    })
  }

  return true
}

function measurementGeometryContext(
  node: AnyNode,
  nodesById: Readonly<Record<string, AnyNode>>,
): GeometryContext {
  const childIds = (node as { children?: readonly AnyNodeId[] }).children ?? []
  return {
    children: childIds.flatMap((id: AnyNodeId) => {
      const child = nodesById[id]
      return child ? [child] : []
    }),
    parent: node.parentId ? (nodesById[node.parentId] ?? null) : null,
    resolve: <N = AnyNode>(id: AnyNodeId) => nodesById[id] as N | undefined,
    siblings: node.parentId
      ? Object.values(nodesById).filter(
          (candidate) => candidate.parentId === node.parentId && candidate.id !== node.id,
        )
      : [],
  }
}

function addDefinitionSnapGeometry(
  geometry: MeasurementSnapGeometry,
  contribution: MeasurementDefinitionSnapGeometry,
): boolean {
  const anchors = contribution.anchors ?? []
  const segments = contribution.segments ?? []
  geometry.anchors.push(
    ...anchors.map((anchor) => ({
      ...anchor,
      point: [...anchor.point] as MeasurementPoint,
    })),
  )
  geometry.segments.push(
    ...segments.map((segment) => ({
      ...segment,
      start: [...segment.start] as MeasurementPoint,
      end: [...segment.end] as MeasurementPoint,
    })),
  )
  return anchors.length > 0 || segments.length > 0
}

function lineIntersection2D(
  a: MeasurementSnapSegment,
  b: MeasurementSnapSegment,
): MeasurementPoint | null {
  if (a.sourceId && a.sourceId === b.sourceId && segmentsSharePlanEndpoint(a, b)) {
    return null
  }

  const x1 = a.start[0]
  const y1 = a.start[2]
  const x2 = a.end[0]
  const y2 = a.end[2]
  const x3 = b.start[0]
  const y3 = b.start[2]
  const x4 = b.end[0]
  const y4 = b.end[2]
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denominator) < EPSILON) return null
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null
  return [
    x1 + t * (x2 - x1),
    (a.start[1] + a.end[1] + b.start[1] + b.end[1]) / 4,
    y1 + t * (y2 - y1),
  ]
}

function segmentsSharePlanEndpoint(a: MeasurementSnapSegment, b: MeasurementSnapSegment): boolean {
  return (
    planDistanceSq(a.start, b.start) < EPSILON ||
    planDistanceSq(a.start, b.end) < EPSILON ||
    planDistanceSq(a.end, b.start) < EPSILON ||
    planDistanceSq(a.end, b.end) < EPSILON
  )
}

export function collectPlanMeasurementSnapGeometry(
  nodes: ReadonlyArray<AnyNode>,
): MeasurementSnapGeometry {
  const geometry: MeasurementSnapGeometry = { anchors: [], segments: [] }
  const nodesById = Object.fromEntries(nodes.map((node) => [node.id, node])) as Record<
    string,
    AnyNode
  >

  for (const node of nodes) {
    const measurement = nodeRegistry.get(node.type)?.measurement
    const contributed = measurement?.snapGeometry?.(
      node as never,
      measurementGeometryContext(node, nodesById),
    )
    if (contributed && addDefinitionSnapGeometry(geometry, contributed)) continue
    if (addGenericPolygonGeometry(geometry, node)) continue
    if (addPathGeometry(geometry, node)) continue
    addAlignmentAnchorGeometry(geometry, node, nodesById)
  }

  for (let i = 0; i < geometry.segments.length; i += 1) {
    for (let j = i + 1; j < geometry.segments.length; j += 1) {
      const point = lineIntersection2D(geometry.segments[i]!, geometry.segments[j]!)
      if (point)
        geometry.anchors.push({ label: 'Intersection', kind: 'intersection', point, priority: 0 })
    }
  }

  return geometry
}

export function collectCommittedMeasurementSnapGeometry(
  segments: ReadonlyArray<MeasurementSegment>,
): MeasurementSnapGeometry {
  const geometry: MeasurementSnapGeometry = { anchors: [], segments: [] }

  for (const segment of segments) {
    const midpoint: MeasurementPoint = [
      (segment.start[0] + segment.end[0]) / 2,
      (segment.start[1] + segment.end[1]) / 2,
      (segment.start[2] + segment.end[2]) / 2,
    ]
    geometry.anchors.push(
      { label: 'Measurement endpoint', kind: 'measurement', point: segment.start, priority: 0 },
      { label: 'Measurement midpoint', kind: 'measurement', point: midpoint, priority: 1 },
      { label: 'Measurement endpoint', kind: 'measurement', point: segment.end, priority: 0 },
    )
    geometry.segments.push({
      label: 'Measurement edge',
      kind: 'measurement',
      start: segment.start,
      end: segment.end,
      priority: 3,
    })
  }

  return geometry
}

export function mergeMeasurementSnapGeometry(
  ...geometries: ReadonlyArray<MeasurementSnapGeometry>
): MeasurementSnapGeometry {
  return {
    anchors: geometries.flatMap((geometry) => geometry.anchors),
    segments: geometries.flatMap((geometry) => geometry.segments),
  }
}

function isMeasurementSnapKindEnabled(
  kind: MeasurementSnapKind,
  enabledSnapKinds: Partial<MeasurementSnapSettings> | undefined,
): boolean {
  return enabledSnapKinds?.[kind] ?? true
}

export function resolvePlanMeasurementSnap(
  point: MeasurementPoint,
  geometry: MeasurementSnapGeometry,
  options: {
    enabledSnapKinds?: Partial<MeasurementSnapSettings>
    radiusMeters: number
    view: MeasurementView
    gridStep?: number
  },
): { point: MeasurementPoint; target: MeasurementSnapTarget | null } {
  const maxDistanceSq = options.radiusMeters * options.radiusMeters
  let closest: MeasurementSnapAnchor | null = null
  let closestScore = Number.POSITIVE_INFINITY

  const consider = (
    anchor: MeasurementSnapAnchor,
    distanceSq = planDistanceSq(point, anchor.point),
  ) => {
    const kind = anchor.kind ?? measurementSnapKindFromLabel(anchor.label)
    if (!isMeasurementSnapKindEnabled(kind, options.enabledSnapKinds)) return
    if (distanceSq > maxDistanceSq) return
    const priority = snapPriority(anchor)
    const score = snapScore(distanceSq, priority)
    if (
      score < closestScore - EPSILON ||
      (Math.abs(score - closestScore) <= EPSILON && priority < snapPriority(closest ?? anchor))
    ) {
      closest = anchor
      closestScore = score
    }
  }

  for (const anchor of geometry.anchors) {
    consider(anchor)
  }

  for (const segment of geometry.segments) {
    const projection = projectPointToPlanSegment(point, segment.start, segment.end)
    if (!projection) continue
    consider({
      kind: segment.kind,
      label: segment.label,
      point: projection,
      priority: segment.priority,
    })
  }

  if (!closest && isMeasurementSnapKindEnabled('grid', options.enabledSnapKinds)) {
    const gridStep = options.gridStep ?? DEFAULT_GRID_STEP
    const gridPoint: MeasurementPoint = [
      Math.round(point[0] / gridStep) * gridStep,
      point[1],
      Math.round(point[2] / gridStep) * gridStep,
    ]
    if (planDistanceSq(point, gridPoint) <= maxDistanceSq) {
      closest = { label: 'Grid', kind: 'grid', point: gridPoint, priority: DEFAULT_GRID_PRIORITY }
    }
  }

  return {
    point: closest?.point ?? point,
    target: closest
      ? {
          kind: closest.kind ?? measurementSnapKindFromLabel(closest.label),
          label: closest.label,
          point: closest.point,
          view: options.view,
        }
      : null,
  }
}

export function resolvePlanMeasurementConstraint(
  start: MeasurementPoint,
  point: MeasurementPoint,
  geometry: MeasurementSnapGeometry,
  options: {
    enabledSnapKinds?: Partial<MeasurementSnapSettings>
    radiusMeters: number
    view: MeasurementView
  },
): { point: MeasurementPoint; target: MeasurementSnapTarget | null } {
  if (!isMeasurementSnapKindEnabled('guide', options.enabledSnapKinds)) {
    return { point, target: null }
  }

  const cursorDx = point[0] - start[0]
  const cursorDz = point[2] - start[2]
  const cursorLengthSq = cursorDx * cursorDx + cursorDz * cursorDz
  if (cursorLengthSq < EPSILON) return { point, target: null }

  const maxDistanceSq = options.radiusMeters * options.radiusMeters
  type MeasurementConstraintGuideCandidate = {
    guideLine: { end: MeasurementPoint; start: MeasurementPoint }
    label: string
    point: MeasurementPoint
    score: number
  }
  let closest: MeasurementConstraintGuideCandidate | null = null

  const considerGuideDirection = (
    label: string,
    direction: { x: number; z: number },
    scoreBias = 0,
    minDistanceSq = 0,
  ) => {
    const projectionLength = cursorDx * direction.x + cursorDz * direction.z
    const constrainedPoint: MeasurementPoint = [
      start[0] + direction.x * projectionLength,
      point[1],
      start[2] + direction.z * projectionLength,
    ]
    const distanceSq = planDistanceSq(point, constrainedPoint)
    if (minDistanceSq > 0 && distanceSq <= minDistanceSq) return
    if (distanceSq > maxDistanceSq) return
    const score = distanceSq + scoreBias
    if (!closest || score < closest.score) {
      const guideLength = Math.max(Math.sqrt(cursorLengthSq), options.radiusMeters * 3)
      closest = {
        guideLine: {
          start: [
            start[0] - direction.x * guideLength,
            start[1],
            start[2] - direction.z * guideLength,
          ],
          end: [
            start[0] + direction.x * guideLength,
            start[1],
            start[2] + direction.z * guideLength,
          ],
        },
        label,
        point: constrainedPoint,
        score,
      }
    }
  }

  const diagonal = Math.SQRT1_2
  const polarGuideBias = options.radiusMeters * options.radiusMeters * 4
  const polarDirections = [
    { label: 'Polar guide 0°', x: 1, z: 0 },
    { label: 'Polar guide 90°', x: 0, z: 1 },
    { label: 'Polar guide 45°', x: diagonal, z: diagonal },
    { label: 'Polar guide 135°', x: -diagonal, z: diagonal },
  ]
  for (const direction of polarDirections) {
    considerGuideDirection(direction.label, direction, polarGuideBias, EPSILON)
  }

  for (const segment of geometry.segments) {
    const segmentKind = segment.kind ?? measurementSnapKindFromLabel(segment.label)
    if (!isMeasurementSnapKindEnabled(segmentKind, options.enabledSnapKinds)) continue

    const hostPoint = projectPointToPlanSegment(start, segment.start, segment.end)
    if (!hostPoint || planDistanceSq(start, hostPoint) > maxDistanceSq) continue

    const segmentDx = segment.end[0] - segment.start[0]
    const segmentDz = segment.end[2] - segment.start[2]
    const segmentLength = Math.hypot(segmentDx, segmentDz)
    if (segmentLength < EPSILON) continue

    const unitDirections = [
      { label: 'Parallel', x: segmentDx / segmentLength, z: segmentDz / segmentLength },
      { label: 'Perpendicular', x: -segmentDz / segmentLength, z: segmentDx / segmentLength },
    ]

    for (const direction of unitDirections) {
      considerGuideDirection(
        direction.label,
        direction,
        direction.label === 'Perpendicular' ? 0 : EPSILON,
      )
    }
  }

  const resolvedClosest = closest as MeasurementConstraintGuideCandidate | null

  return {
    point: resolvedClosest?.point ?? point,
    target: resolvedClosest
      ? {
          kind: measurementSnapKindFromLabel(resolvedClosest.label),
          guideLine: resolvedClosest.guideLine,
          label: resolvedClosest.label,
          point: resolvedClosest.point,
          view: options.view,
        }
      : null,
  }
}

import {
  type AnyNode,
  type AnyNodeDefinition,
  type GeometryContext,
  getDutchRoofMetrics,
  getFenceCenterlineFrameAt,
  getFenceCenterlineLength,
  getRenderableSlabPolygon,
  getWallCurveFrameAt,
  getWallCurveLength,
  type MeasurementDefinition,
  type MeasurementDefinitionPoint,
  type MeasurementDefinitionSnapGeometry,
  nodeRegistry,
  registerNode,
  sampleFenceCenterline,
  sampleWallCenterline,
  stairFootprintAABB,
} from '@pascal-app/core'
import { z } from 'zod'

const CURVE_SNAP_SEGMENTS = 32
const WALL_SIDE_NORMAL_Y_THRESHOLD = 0.7
const WALL_SIDE_HEIGHT_EPSILON = 0.05
const TestSchema = z.object({}).passthrough()

type TestNode = AnyNode & Record<string, any>
type PlanPoint = { x: number; y: number }
type RoofPlanPoint = readonly [number, number]
type RoofPlanSegment = readonly [RoofPlanPoint, RoofPlanPoint]

function testDefinition(kind: string, measurement: MeasurementDefinition<TestNode>) {
  return {
    kind,
    schemaVersion: 1,
    schema: TestSchema,
    category: 'structure',
    defaults: () => ({}),
    capabilities: {},
    measurement,
  } as unknown as AnyNodeDefinition
}

function polygonAreaAndCentroid(polygon: ReadonlyArray<readonly [number, number]>) {
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
  return { area: Math.abs(area), centroid: { x: cx / (6 * area), y: cy / (6 * area) } }
}

function polygonPerimeter(polygon: ReadonlyArray<readonly [number, number]>) {
  return polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length] ?? point
    return sum + Math.hypot(next[0] - point[0], next[1] - point[1])
  }, 0)
}

function addPolygonSnapGeometry(
  geometry: Required<MeasurementDefinitionSnapGeometry>,
  polygon: ReadonlyArray<readonly [number, number]>,
  y: number,
  labels: { center: string; edge: string; vertex: string },
) {
  const points = polygon.map((point) => [point[0], y, point[1]] as MeasurementDefinitionPoint)
  const centroid = polygonAreaAndCentroid(polygon).centroid
  for (const point of points) {
    geometry.anchors.push({ label: labels.vertex, kind: 'vertex', point, priority: 0 })
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
    geometry.segments.push({ label: labels.edge, kind: 'edge', start, end, priority: 3 })
  }
  geometry.anchors.push({
    label: labels.center,
    kind: 'center',
    point: [centroid.x, y, centroid.y],
    priority: 2,
  })
}

function addRectangleSnapGeometry(
  geometry: Required<MeasurementDefinitionSnapGeometry>,
  polygon: ReadonlyArray<PlanPoint>,
  labels: { center: string; edge: string; vertex: string },
) {
  const centroid = {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
  }
  const points = polygon.map((point) => [point.x, 0, point.y] as MeasurementDefinitionPoint)
  for (const point of points) {
    geometry.anchors.push({ label: labels.vertex, kind: 'vertex', point, priority: 0 })
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
    geometry.segments.push({ label: labels.edge, kind: 'edge', start, end, priority: 3 })
  }
  geometry.anchors.push({
    label: labels.center,
    kind: 'center',
    point: [centroid.x, 0, centroid.y],
    priority: 2,
  })
}

function rotatePlanPoint(x: number, z: number, rotation: number): PlanPoint {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return { x: x * cos + z * sin, y: -x * sin + z * cos }
}

function rotatedRectanglePolygon(
  center: PlanPoint,
  width: number,
  depth: number,
  rotation: number,
) {
  const corners: Array<[number, number]> = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ]
  return corners.map(([x, z]) => {
    const rotated = rotatePlanPoint(x, z, rotation)
    return { x: center.x + rotated.x, y: center.y + rotated.y }
  })
}

function closestPointOnSegment(
  point: PlanPoint,
  start: PlanPoint,
  end: PlanPoint,
): { distanceSq: number; t: number } {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq < 1e-9) {
    const ox = point.x - start.x
    const oy = point.y - start.y
    return { distanceSq: ox * ox + oy * oy, t: 0 }
  }

  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq),
  )
  const projected = { x: start.x + dx * t, y: start.y + dy * t }
  const ox = point.x - projected.x
  const oy = point.y - projected.y
  return { distanceSq: ox * ox + oy * oy, t }
}

function wallFaceAnchor(
  node: TestNode,
  cursorPoint: readonly [number, number, number],
  cursorNormal?: readonly [number, number, number] | null,
): [number, number, number] {
  const planPoint = { x: cursorPoint[0], y: cursorPoint[2] }
  const sampleCount = Math.max(
    CURVE_SNAP_SEGMENTS,
    Math.ceil(getWallCurveLength(node as never) / 0.25),
  )
  let best: {
    distanceSq: number
    frameT: number
  } | null = null
  let previous = getWallCurveFrameAt(node as never, 0).point

  for (let index = 1; index <= sampleCount; index += 1) {
    const current = getWallCurveFrameAt(node as never, index / sampleCount).point
    const projected = closestPointOnSegment(planPoint, previous, current)
    if (!best || projected.distanceSq < best.distanceSq) {
      best = {
        distanceSq: projected.distanceSq,
        frameT: (index - 1 + projected.t) / sampleCount,
      }
    }
    previous = current
  }

  const frame = getWallCurveFrameAt(node as never, best?.frameT ?? 0)
  const signedCursorOffset =
    (planPoint.x - frame.point.x) * frame.normal.x + (planPoint.y - frame.point.y) * frame.normal.y
  const normalPlanLength = cursorNormal ? Math.hypot(cursorNormal[0], cursorNormal[2]) : 0
  const normalSide =
    cursorNormal && normalPlanLength > 1e-6
      ? Math.sign(
          (cursorNormal[0] / normalPlanLength) * frame.normal.x +
            (cursorNormal[2] / normalPlanLength) * frame.normal.y,
        )
      : 0
  const cursorSide = Math.sign(signedCursorOffset)
  const side = normalSide || cursorSide || 1
  const offset = ((node.thickness ?? 0.1) / 2) * side

  return [
    frame.point.x + frame.normal.x * offset,
    cursorPoint[1],
    frame.point.y + frame.normal.y * offset,
  ]
}

function fenceFaceAnchor(
  node: TestNode,
  cursorPoint: readonly [number, number, number],
  cursorNormal?: readonly [number, number, number] | null,
): [number, number, number] {
  const planPoint = { x: cursorPoint[0], y: cursorPoint[2] }
  const sampleCount = Math.max(
    CURVE_SNAP_SEGMENTS,
    Math.ceil(getFenceCenterlineLength(node as never) / 0.25),
  )
  let best: {
    distanceSq: number
    frameT: number
  } | null = null
  let previous = getFenceCenterlineFrameAt(node as never, 0).point

  for (let index = 1; index <= sampleCount; index += 1) {
    const current = getFenceCenterlineFrameAt(node as never, index / sampleCount).point
    const projected = closestPointOnSegment(planPoint, previous, current)
    if (!best || projected.distanceSq < best.distanceSq) {
      best = {
        distanceSq: projected.distanceSq,
        frameT: (index - 1 + projected.t) / sampleCount,
      }
    }
    previous = current
  }

  const frame = getFenceCenterlineFrameAt(node as never, best?.frameT ?? 0)
  const signedCursorOffset =
    (planPoint.x - frame.point.x) * frame.normal.x + (planPoint.y - frame.point.y) * frame.normal.y
  const normalPlanLength = cursorNormal ? Math.hypot(cursorNormal[0], cursorNormal[2]) : 0
  const normalSide =
    cursorNormal && normalPlanLength > 1e-6
      ? Math.sign(
          (cursorNormal[0] / normalPlanLength) * frame.normal.x +
            (cursorNormal[2] / normalPlanLength) * frame.normal.y,
        )
      : 0
  const cursorSide = Math.sign(signedCursorOffset)
  const side = normalSide || cursorSide || 1
  const offset = ((node.thickness ?? 0.08) / 2) * side

  return [
    frame.point.x + frame.normal.x * offset,
    cursorPoint[1],
    frame.point.y + frame.normal.y * offset,
  ]
}

function roofSegmentPlanFrame(segment: TestNode, ctx: GeometryContext) {
  const parentRoof = segment.parentId ? (ctx.resolve(segment.parentId as never) as TestNode) : null
  const parentPosition = parentRoof?.position ?? [0, 0, 0]
  const parentRotation = parentRoof?.rotation ?? 0
  const offset = rotatePlanPoint(segment.position[0], segment.position[2], parentRotation)
  return {
    center: { x: parentPosition[0] + offset.x, y: parentPosition[2] + offset.y },
    rotation: parentRotation + segment.rotation,
  }
}

function roofSegmentPlanLinework(node: TestNode) {
  const hw = node.width / 2
  const hd = node.depth / 2
  const ridges: RoofPlanSegment[] = []
  const hips: RoofPlanSegment[] = []
  const breaks: RoofPlanSegment[] = []
  let slope: { head: RoofPlanPoint; tail: RoofPlanPoint } | null = null
  const e1: RoofPlanPoint = [-hw, hd]
  const e2: RoofPlanPoint = [hw, hd]
  const e3: RoofPlanPoint = [hw, -hd]
  const e4: RoofPlanPoint = [-hw, -hd]
  const pushHip = () => {
    if (Math.abs(node.width - node.depth) < 0.01) {
      const peak: RoofPlanPoint = [0, 0]
      hips.push([e1, peak], [e2, peak], [e3, peak], [e4, peak])
    } else if (node.width >= node.depth) {
      const r1: RoofPlanPoint = [-hw + hd, 0]
      const r2: RoofPlanPoint = [hw - hd, 0]
      ridges.push([r1, r2])
      hips.push([e1, r1], [e4, r1], [e2, r2], [e3, r2])
    } else {
      const r1: RoofPlanPoint = [0, hd - hw]
      const r2: RoofPlanPoint = [0, -hd + hw]
      ridges.push([r1, r2])
      hips.push([e1, r1], [e2, r1], [e3, r2], [e4, r2])
    }
  }
  switch (node.roofType) {
    case 'gable':
      ridges.push([
        [-hw, 0],
        [hw, 0],
      ])
      break
    case 'shed':
      slope = { tail: [0, -hd * 0.55], head: [0, hd * 0.55] }
      break
    case 'hip':
      pushHip()
      break
    case 'gambrel': {
      const mz = hd * node.gambrelLowerWidthRatio
      ridges.push([
        [-hw, 0],
        [hw, 0],
      ])
      breaks.push(
        [
          [-hw, mz],
          [hw, mz],
        ],
        [
          [-hw, -mz],
          [hw, -mz],
        ],
      )
      break
    }
    case 'mansard': {
      const inset = Math.min(node.width, node.depth) * node.mansardSteepWidthRatio
      if (hw - inset > 0.02 && hd - inset > 0.02) {
        const w1: RoofPlanPoint = [-hw + inset, hd - inset]
        const w2: RoofPlanPoint = [hw - inset, hd - inset]
        const w3: RoofPlanPoint = [hw - inset, -hd + inset]
        const w4: RoofPlanPoint = [-hw + inset, -hd + inset]
        breaks.push([w1, w2], [w2, w3], [w3, w4], [w4, w1])
        hips.push([e1, w1], [e2, w2], [e3, w3], [e4, w4])
      } else {
        pushHip()
      }
      break
    }
    case 'dutch': {
      const metrics = getDutchRoofMetrics(node as never)
      if (!(metrics.waistHalfX > 0.02 && metrics.waistHalfZ > 0.02)) {
        pushHip()
        break
      }
      const w1: RoofPlanPoint = [-metrics.waistHalfX, metrics.waistHalfZ]
      const w2: RoofPlanPoint = [metrics.waistHalfX, metrics.waistHalfZ]
      const w3: RoofPlanPoint = [metrics.waistHalfX, -metrics.waistHalfZ]
      const w4: RoofPlanPoint = [-metrics.waistHalfX, -metrics.waistHalfZ]
      hips.push([e1, w1], [e2, w2], [e3, w3], [e4, w4])
      breaks.push([w1, w2], [w2, w3], [w3, w4], [w4, w1])
      ridges.push([metrics.ridgeStart, metrics.ridgeEnd])
      break
    }
  }
  return { breaks, hips, ridges, slope }
}

function addRoofPlanSegment(
  geometry: Required<MeasurementDefinitionSnapGeometry>,
  segment: RoofPlanSegment,
  toPlan: (point: RoofPlanPoint) => MeasurementDefinitionPoint,
  label: string,
  sourceId: string,
) {
  const start = toPlan(segment[0])
  const end = toPlan(segment[1])
  geometry.anchors.push(
    { label: `${label} endpoint`, kind: 'endpoint', point: start, priority: 0 },
    {
      label: `${label} midpoint`,
      kind: 'midpoint',
      point: [(start[0] + end[0]) / 2, 0, (start[2] + end[2]) / 2],
      priority: 1,
    },
    { label: `${label} endpoint`, kind: 'endpoint', point: end, priority: 0 },
  )
  geometry.segments.push({
    label: `${label} edge`,
    kind: 'edge',
    sourceId,
    start,
    end,
    priority: 3,
  })
}

function surfaceMeasurement(): MeasurementDefinition<TestNode> {
  const boundaryPolygon = (node: TestNode): Array<[number, number]> =>
    node.type === 'slab' ? getRenderableSlabPolygon(node as never) : node.polygon

  return {
    area: (node) => {
      const boundary = boundaryPolygon(node)
      const outer = polygonAreaAndCentroid(boundary)
      const holes = node.holes ?? []
      const holesArea = holes.reduce((sum: number, hole: [number, number][]) => {
        return sum + polygonAreaAndCentroid(hole).area
      }, 0)
      const y = node.type === 'ceiling' ? node.height : node.type === 'slab' ? node.elevation : 0
      return {
        areaSquareMeters: Math.max(0, outer.area - holesArea),
        boundaryPoints: boundary.map((point: [number, number]) => [
          point[0],
          y + 0.02,
          point[1],
        ]),
        labelPoint: [outer.centroid.x, y + 0.05, outer.centroid.y],
      }
    },
    perimeter: (node) => {
      const boundary = boundaryPolygon(node)
      const outer = polygonAreaAndCentroid(boundary)
      const holes = node.holes ?? []
      const holesLength = holes.reduce((sum: number, hole: [number, number][]) => {
        return sum + polygonPerimeter(hole)
      }, 0)
      const y = node.type === 'ceiling' ? node.height : node.type === 'slab' ? node.elevation : 0
      return {
        boundaryPoints: boundary.map((point: [number, number]) => [
          point[0],
          y + 0.02,
          point[1],
        ]),
        labelPoint: [outer.centroid.x, y + 0.05, outer.centroid.y],
        lengthMeters: polygonPerimeter(boundary) + holesLength,
      }
    },
    snapGeometry: (node) => {
      const y = node.type === 'ceiling' ? node.height : node.type === 'slab' ? node.elevation : 0
      const geometry: Required<MeasurementDefinitionSnapGeometry> = { anchors: [], segments: [] }
      addPolygonSnapGeometry(geometry, boundaryPolygon(node), y, {
        center: 'Center',
        edge: 'Edge',
        vertex: 'Vertex',
      })
      for (const hole of node.holes ?? []) {
        addPolygonSnapGeometry(geometry, hole, y, {
          center: 'Surface opening center',
          edge: 'Surface opening edge',
          vertex: 'Surface opening vertex',
        })
      }
      return geometry
    },
  }
}

function surfacePerimeterWithoutBoundaryMeasurement(): MeasurementDefinition<TestNode> {
  const measurement = surfaceMeasurement()
  return {
    area: measurement.area,
    perimeter: (node, ctx) => {
      const perimeter = measurement.perimeter?.(node, ctx)
      if (!perimeter) return null
      return {
        labelPoint: perimeter.labelPoint,
        lengthMeters: perimeter.lengthMeters,
      }
    },
    snapGeometry: measurement.snapGeometry,
  }
}

function wallMeasurement(): MeasurementDefinition<TestNode> {
  return {
    directLength: (node, _ctx, cursorPoint, cursorNormal) => {
      const height = node.height ?? 2.5
      const normalY = cursorNormal ? Math.abs(cursorNormal[1]) : null
      const isSideNormal = normalY !== null && normalY < WALL_SIDE_NORMAL_Y_THRESHOLD
      const isWallSideHover =
        !cursorNormal &&
        cursorPoint &&
        cursorPoint[1] > WALL_SIDE_HEIGHT_EPSILON &&
        cursorPoint[1] < height - WALL_SIDE_HEIGHT_EPSILON
      if (cursorPoint && (isSideNormal || isWallSideHover)) {
        const anchor = wallFaceAnchor(node, cursorPoint, cursorNormal)
        return {
          start: [anchor[0], 0, anchor[2]],
          end: [anchor[0], height, anchor[2]],
          measuredDistanceMeters: height,
        }
      }
      return {
        start: [node.start[0], 0, node.start[1]],
        end: [node.end[0], 0, node.end[1]],
        measuredDistanceMeters: getWallCurveLength(node as never),
      }
    },
    snapGeometry: (node) => {
      const midpoint = getWallCurveFrameAt(node as never, 0.5).point
      const geometry: Required<MeasurementDefinitionSnapGeometry> = {
        anchors: [
          {
            label: 'Endpoint',
            kind: 'endpoint',
            point: [node.start[0], 0, node.start[1]],
            priority: 0,
          },
          { label: 'Midpoint', kind: 'midpoint', point: [midpoint.x, 0, midpoint.y], priority: 1 },
          {
            label: 'Endpoint',
            kind: 'endpoint',
            point: [node.end[0], 0, node.end[1]],
            priority: 0,
          },
        ],
        segments: [],
      }
      const samples = sampleWallCenterline(node as never, CURVE_SNAP_SEGMENTS)
      for (let index = 1; index < samples.length; index += 1) {
        const startPoint = samples[index - 1]!
        const endPoint = samples[index]!
        geometry.segments.push({
          label: 'Wall edge',
          kind: 'edge',
          sourceId: node.id,
          start: [startPoint.x, 0, startPoint.y],
          end: [endPoint.x, 0, endPoint.y],
          priority: 3,
        })
      }
      return geometry
    },
  }
}

function fenceMeasurement(): MeasurementDefinition<TestNode> {
  return {
    directLength: (node, _ctx, cursorPoint, cursorNormal) => {
      const height = node.height ?? 1.8
      const normalY = cursorNormal ? Math.abs(cursorNormal[1]) : null
      const isSideNormal = normalY !== null && normalY < WALL_SIDE_NORMAL_Y_THRESHOLD
      const isFenceSideHover =
        !cursorNormal &&
        cursorPoint &&
        cursorPoint[1] > WALL_SIDE_HEIGHT_EPSILON &&
        cursorPoint[1] < height - WALL_SIDE_HEIGHT_EPSILON
      if (cursorPoint && (isSideNormal || isFenceSideHover)) {
        const anchor = fenceFaceAnchor(node, cursorPoint, cursorNormal)
        return {
          start: [anchor[0], 0, anchor[2]],
          end: [anchor[0], height, anchor[2]],
          measuredDistanceMeters: height,
        }
      }
      return {
        start: [node.start[0], 0, node.start[1]],
        end: [node.end[0], 0, node.end[1]],
        measuredDistanceMeters: getFenceCenterlineLength(node as never),
      }
    },
    snapGeometry: (node) => {
      const midpoint = getFenceCenterlineFrameAt(node as never, 0.5).point
      const geometry: Required<MeasurementDefinitionSnapGeometry> = {
        anchors: [
          {
            label: 'Endpoint',
            kind: 'endpoint',
            point: [node.start[0], 0, node.start[1]],
            priority: 0,
          },
          ...(node.path ?? []).map((point: [number, number]) => ({
            label: 'Path point',
            kind: 'vertex' as const,
            point: [point[0], 0, point[1]] as MeasurementDefinitionPoint,
            priority: 0,
          })),
          { label: 'Midpoint', kind: 'midpoint', point: [midpoint.x, 0, midpoint.y], priority: 1 },
          {
            label: 'Endpoint',
            kind: 'endpoint',
            point: [node.end[0], 0, node.end[1]],
            priority: 0,
          },
        ],
        segments: [],
      }
      const samples = sampleFenceCenterline(node as never, CURVE_SNAP_SEGMENTS)
      for (let index = 1; index < samples.length; index += 1) {
        const startPoint = samples[index - 1]!
        const endPoint = samples[index]!
        geometry.segments.push({
          label: 'Fence edge',
          kind: 'edge',
          sourceId: node.id,
          start: [startPoint.x, 0, startPoint.y],
          end: [endPoint.x, 0, endPoint.y],
          priority: 3,
        })
      }
      return geometry
    },
  }
}

function openingMeasurement(): MeasurementDefinition<TestNode> {
  type OpeningFrame = {
    bottomY: number
    centerX: number
    centerZ: number
    dirX: number
    dirZ: number
    leftS: number
    normalX: number
    normalZ: number
    rightS: number
    topY: number
    wallStart: readonly [number, number]
  }

  const frameForOpening = (node: TestNode, ctx: GeometryContext): OpeningFrame | null => {
    const host = node.wallId ? (ctx.resolve(node.wallId as never) as TestNode) : null
    if (!host) return null
    const dx = host.end[0] - host.start[0]
    const dz = host.end[1] - host.start[1]
    const hostLength = Math.hypot(dx, dz)
    if (hostLength < 1e-4 || node.width < 1e-4 || node.height < 1e-4) return null
    const dirX = dx / hostLength
    const dirZ = dz / hostLength
    const halfWidth = node.width / 2
    const centerS = node.position[0]
    const centerX = host.start[0] + dirX * centerS
    const centerZ = host.start[1] + dirZ * centerS
    const centerY = node.position[1]
    return {
      bottomY: centerY - node.height / 2,
      centerX,
      centerZ,
      dirX,
      dirZ,
      leftS: centerS - halfWidth,
      normalX: -dirZ,
      normalZ: dirX,
      rightS: centerS + halfWidth,
      topY: centerY + node.height / 2,
      wallStart: host.start,
    }
  }

  const pointFromFrame = (
    frame: OpeningFrame,
    alongWall: number,
    y: number,
    faceOffset: number,
  ): MeasurementDefinitionPoint => [
    frame.wallStart[0] + frame.dirX * alongWall + frame.normalX * faceOffset,
    y,
    frame.wallStart[1] + frame.dirZ * alongWall + frame.normalZ * faceOffset,
  ]

  const directLength = (
    node: TestNode,
    ctx: GeometryContext,
    cursorPoint?: MeasurementDefinitionPoint | null,
  ) => {
    const frame = frameForOpening(node, ctx)
    if (!frame) return null
    if (cursorPoint) {
      const faceOffset =
        (cursorPoint[0] - frame.centerX) * frame.normalX +
        (cursorPoint[2] - frame.centerZ) * frame.normalZ
      const offset = Math.abs(faceOffset) > 1e-6 ? faceOffset : (node.position[2] ?? 0)
      const cursorS =
        (cursorPoint[0] - frame.wallStart[0]) * frame.dirX +
        (cursorPoint[2] - frame.wallStart[1]) * frame.dirZ
      const cursorY = cursorPoint[1]
      const horizontalDistanceSq = (edgeY: number) => {
        const clampedS = Math.max(frame.leftS, Math.min(frame.rightS, cursorS))
        const ds = cursorS - clampedS
        const dy = cursorY - edgeY
        return ds * ds + dy * dy
      }
      const verticalDistanceSq = (edgeS: number) => {
        const clampedY = Math.max(frame.bottomY, Math.min(frame.topY, cursorY))
        const ds = cursorS - edgeS
        const dy = cursorY - clampedY
        return ds * ds + dy * dy
      }
      const candidates = [
        {
          distanceSq: horizontalDistanceSq(frame.bottomY),
          end: pointFromFrame(frame, frame.rightS, frame.bottomY, offset),
          measuredDistanceMeters: node.width,
          start: pointFromFrame(frame, frame.leftS, frame.bottomY, offset),
        },
        {
          distanceSq: horizontalDistanceSq(frame.topY),
          end: pointFromFrame(frame, frame.rightS, frame.topY, offset),
          measuredDistanceMeters: node.width,
          start: pointFromFrame(frame, frame.leftS, frame.topY, offset),
        },
        {
          distanceSq: verticalDistanceSq(frame.leftS),
          end: pointFromFrame(frame, frame.leftS, frame.topY, offset),
          measuredDistanceMeters: node.height,
          start: pointFromFrame(frame, frame.leftS, frame.bottomY, offset),
        },
        {
          distanceSq: verticalDistanceSq(frame.rightS),
          end: pointFromFrame(frame, frame.rightS, frame.topY, offset),
          measuredDistanceMeters: node.height,
          start: pointFromFrame(frame, frame.rightS, frame.bottomY, offset),
        },
      ]
      return candidates.reduce((best, candidate) =>
        candidate.distanceSq < best.distanceSq ? candidate : best,
      )
    }
    return {
      start: pointFromFrame(frame, frame.leftS, 0, node.position[2] ?? 0),
      end: pointFromFrame(frame, frame.rightS, 0, node.position[2] ?? 0),
      measuredDistanceMeters: node.width,
    }
  }
  return {
    directLength,
    snapGeometry: (node, ctx) => {
      const segment = directLength(node, ctx)
      if (!segment) return null
      return {
        anchors: [
          { label: 'Opening endpoint', kind: 'endpoint', point: segment.start, priority: 0 },
          {
            label: 'Opening center',
            kind: 'center',
            point: [
              (segment.start[0] + segment.end[0]) / 2,
              0,
              (segment.start[2] + segment.end[2]) / 2,
            ],
            priority: 0,
          },
          { label: 'Opening endpoint', kind: 'endpoint', point: segment.end, priority: 0 },
        ],
        segments: [
          {
            label: 'Opening edge',
            kind: 'edge',
            sourceId: node.id,
            start: segment.start,
            end: segment.end,
            priority: 2,
          },
        ],
      }
    },
  }
}

function siteMeasurement(): MeasurementDefinition<TestNode> {
  return {
    snapGeometry: (node) => {
      const polygon = Array.isArray(node.polygon) ? node.polygon : node.polygon.points
      const geometry: Required<MeasurementDefinitionSnapGeometry> = { anchors: [], segments: [] }
      addPolygonSnapGeometry(geometry, polygon, 0, {
        center: 'Property line center',
        edge: 'Property line edge',
        vertex: 'Property line vertex',
      })
      return geometry
    },
  }
}

function stairMeasurement(): MeasurementDefinition<TestNode> {
  return {
    snapGeometry: (node, ctx) => {
      const nodes = Object.fromEntries(
        [node, ...ctx.children, ...ctx.siblings, ...(ctx.parent ? [ctx.parent] : [])].map(
          (entry) => [entry.id, entry],
        ),
      )
      const aabb = stairFootprintAABB(node as never, nodes)
      if (!aabb) return null
      const geometry: Required<MeasurementDefinitionSnapGeometry> = { anchors: [], segments: [] }
      addRectangleSnapGeometry(
        geometry,
        [
          { x: aabb.minX, y: aabb.minZ },
          { x: aabb.maxX, y: aabb.minZ },
          { x: aabb.maxX, y: aabb.maxZ },
          { x: aabb.minX, y: aabb.maxZ },
        ],
        { center: 'Stair center', edge: 'Stair edge', vertex: 'Stair corner' },
      )
      return geometry
    },
  }
}

function roofSegmentMeasurement(): MeasurementDefinition<TestNode> {
  return {
    snapGeometry: (node, ctx) => {
      const { center, rotation } = roofSegmentPlanFrame(node, ctx)
      const geometry: Required<MeasurementDefinitionSnapGeometry> = { anchors: [], segments: [] }
      addRectangleSnapGeometry(
        geometry,
        rotatedRectanglePolygon(center, node.width, node.depth, rotation),
        {
          center: 'Roof center',
          edge: 'Roof eave edge',
          vertex: 'Roof eave corner',
        },
      )
      for (const anchor of geometry.anchors) {
        if (anchor.label === 'Roof eave corner') anchor.priority = -1
      }
      const toPlan = ([localX, localZ]: RoofPlanPoint): MeasurementDefinitionPoint => {
        const offsetPoint = rotatePlanPoint(localX, localZ, rotation)
        return [center.x + offsetPoint.x, 0, center.y + offsetPoint.y]
      }
      const linework = roofSegmentPlanLinework(node)
      for (const ridge of linework.ridges)
        addRoofPlanSegment(geometry, ridge, toPlan, 'Roof ridge', `${node.id}:ridge`)
      for (const hip of linework.hips)
        addRoofPlanSegment(geometry, hip, toPlan, 'Roof hip', `${node.id}:hip`)
      for (const roofBreak of linework.breaks)
        addRoofPlanSegment(geometry, roofBreak, toPlan, 'Roof break', `${node.id}:break`)
      if (linework.slope) {
        addRoofPlanSegment(
          geometry,
          [linework.slope.tail, linework.slope.head],
          toPlan,
          'Roof slope',
          `${node.id}:slope`,
        )
      }
      return geometry
    },
  }
}

function skylightMeasurement(): MeasurementDefinition<TestNode> {
  return {
    snapGeometry: (node, ctx) => {
      const segment = node.roofSegmentId
        ? (ctx.resolve(node.roofSegmentId as never) as TestNode)
        : null
      if (!segment) return null
      const frame = roofSegmentPlanFrame(segment, ctx)
      const centerOffset = rotatePlanPoint(node.position[0], node.position[2], frame.rotation)
      const center = { x: frame.center.x + centerOffset.x, y: frame.center.y + centerOffset.y }
      const geometry: Required<MeasurementDefinitionSnapGeometry> = { anchors: [], segments: [] }
      addRectangleSnapGeometry(
        geometry,
        rotatedRectanglePolygon(
          center,
          node.width,
          node.height,
          frame.rotation + (node.rotation ?? 0),
        ),
        { center: 'Skylight center', edge: 'Skylight edge', vertex: 'Skylight corner' },
      )
      return geometry
    },
  }
}

export function registerMeasurementTestNodes() {
  for (const [kind, measurement] of [
    ['wall', wallMeasurement()],
    ['fence', fenceMeasurement()],
    ['slab', surfaceMeasurement()],
    ['ceiling', surfaceMeasurement()],
    ['zone', surfaceMeasurement()],
    ['site', siteMeasurement()],
    ['door', openingMeasurement()],
    ['window', openingMeasurement()],
    ['stair', stairMeasurement()],
    ['roof-segment', roofSegmentMeasurement()],
    ['skylight', skylightMeasurement()],
    ['surface-perimeter-without-boundary', surfacePerimeterWithoutBoundaryMeasurement()],
  ] as const) {
    if (!nodeRegistry.has(kind)) registerNode(testDefinition(kind, measurement))
  }
}

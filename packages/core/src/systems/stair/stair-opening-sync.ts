import type {
  AnyNode,
  AnyNodeId,
  CeilingNode,
  LevelNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
} from '../../schema'

import { resolveLevelId } from '../../hooks/spatial-grid/spatial-grid-sync'
import type {
  AnyNode,
  AnyNodeId,
  CeilingNode,
  SlabNode,
  StairNode,
  StairSegmentNode,
} from '../../schema'
import { DEFAULT_WALL_HEIGHT } from '../wall/wall-footprint'

type Point2D = [number, number]

type SurfaceHoleMetadata = {
  source: 'manual' | 'stair'
  stairId?: string
}

type SegmentTransform = {
  position: [number, number, number]
  rotation: number
}

type StraightStairLayout = {
  segment: StairSegmentNode
  transform: SegmentTransform
  topElevation: number
}

type AxisAlignedRect = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const CURVED_STAIR_SLAB_OPENING_RATIO = 0.9
const STRAIGHT_STAIR_TARGET_THRESHOLD_MIN = 0.35
const STAIR_SLAB_OPENING_TIGHTENING = 0
const CURVED_STAIR_OPENING_STEP_PADDING = 3

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function pointsEqual(a: Point2D, b: Point2D, tolerance = 1e-5) {
  const dx = a[0] - b[0]
  const dz = a[1] - b[1]
  return dx * dx + dz * dz <= tolerance * tolerance
}

function polygonsEqual(left: Point2D[][], right: Point2D[][]) {
  if (left.length !== right.length) return false
  return left.every((polygon, polygonIndex) => {
    const other = right[polygonIndex]
    if (!(other && polygon.length === other.length)) return false
    return polygon.every((point, pointIndex) => {
      const otherPoint = other[pointIndex]
      if (!otherPoint) return false
      return pointsEqual(point, otherPoint)
    })
  })
}

function metadataEqual(left: SurfaceHoleMetadata[], right: SurfaceHoleMetadata[]) {
  if (left.length !== right.length) return false
  return left.every(
    (entry, index) =>
      entry.source === right[index]?.source &&
      (entry.stairId ?? null) === (right[index]?.stairId ?? null),
  )
}

function normalizeExistingMetadata(
  holes: Point2D[][],
  metadata: SurfaceHoleMetadata[] | undefined,
): SurfaceHoleMetadata[] {
  return holes.map((_, index) => metadata?.[index] ?? { source: 'manual' })
}

function expandPolygonFromCentroid(polygon: Point2D[], offset: number) {
  if (Math.abs(offset) < 1e-6) {
    return polygon.map(([x, z]) => [x, z] as Point2D)
  }

  const centroid = polygon.reduce(
    (acc, [x, z]) => {
      acc.x += x
      acc.z += z
      return acc
    },
    { x: 0, z: 0 },
  )
  centroid.x /= Math.max(polygon.length, 1)
  centroid.z /= Math.max(polygon.length, 1)

  return polygon.map(([x, z]) => {
    const dx = x - centroid.x
    const dz = z - centroid.z
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) {
      return [x, z] as Point2D
    }

    const scale = Math.max(0.1, (length + offset) / length)
    return [centroid.x + dx * scale, centroid.z + dz * scale] as Point2D
  })
}

function rotateXZ(x: number, z: number, angle: number): [number, number] {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [x * cos + z * sin, -x * sin + z * cos]
}

function computeSegmentTransforms(segments: StairSegmentNode[]): SegmentTransform[] {
  const transforms: SegmentTransform[] = []
  let currentX = 0
  let currentY = 0
  let currentZ = 0
  let currentRot = 0

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (!segment) continue

    if (index === 0) {
      transforms.push({
        position: [currentX, currentY, currentZ],
        rotation: currentRot,
      })
      continue
    }

    const previous = segments[index - 1]
    if (!previous) continue

    let attachX = 0
    let attachZ = 0
    let rotationDelta = 0

    switch (segment.attachmentSide) {
      case 'front':
        attachX = 0
        attachZ = previous.length
        break
      case 'left':
        attachX = previous.width / 2
        attachZ = previous.length / 2
        rotationDelta = Math.PI / 2
        break
      case 'right':
        attachX = -previous.width / 2
        attachZ = previous.length / 2
        rotationDelta = -Math.PI / 2
        break
    }

    const [deltaX, deltaZ] = rotateXZ(attachX, attachZ, currentRot)
    currentX += deltaX
    currentY += previous.height
    currentZ += deltaZ
    currentRot += rotationDelta

    transforms.push({
      position: [currentX, currentY, currentZ],
      rotation: currentRot,
    })
  }

  return transforms
}

function getLevelNumber(levelId: string | null, nodes: Record<string, AnyNode>) {
  if (!levelId) return undefined
  const node = nodes[levelId as AnyNodeId]
  return node?.type === 'level' ? node.level : undefined
}

function getResolvedStairLevelIds(stair: StairNode, nodes: Record<string, AnyNode>) {
  const parentLevelId = resolveLevelId(stair, nodes)
  const fromLevelId = stair.fromLevelId ?? parentLevelId
  const toLevelId = stair.toLevelId ?? fromLevelId
  return { fromLevelId, toLevelId }
}

function resolveStraightSegments(stair: StairNode, nodes: Record<string, AnyNode>) {
  return (stair.children ?? [])
    .map((childId) => nodes[childId as AnyNodeId] as StairSegmentNode | undefined)
    .filter(
      (segment): segment is StairSegmentNode =>
        segment?.type === 'stair-segment' && segment.visible !== false,
    )
}

function toWorldPlanPoint(stair: StairNode, localX: number, localZ: number): Point2D {
  const [worldX, worldZ] = rotateXZ(localX, localZ, stair.rotation ?? 0)
  return [stair.position[0] + worldX, stair.position[2] + worldZ]
}

function getStraightStairLayouts(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
): StraightStairLayout[] {
  const segments = resolveStraightSegments(stair, nodes)
  const transforms = computeSegmentTransforms(segments)

  return segments.map((segment, index) => {
    const transform = transforms[index] ?? {
      position: [0, 0, 0] as [number, number, number],
      rotation: 0,
    }

    return {
      segment,
      transform,
      topElevation: transform.position[1] + (segment.segmentType === 'stair' ? segment.height : 0),
    }
  })
}

function getStraightSegmentFootprintPolygon(
  stair: StairNode,
  layout: StraightStairLayout,
): Point2D[] {
  return getStraightSegmentSlicePolygon(stair, layout, 0, layout.segment.length)
}

function getStraightSegmentLocalSlicePolygon(
  layout: StraightStairLayout,
  startAlong: number,
  endAlong: number,
): Point2D[] {
  const { segment, transform } = layout
  const clampedStart = clamp(startAlong, 0, segment.length)
  const clampedEnd = clamp(endAlong, clampedStart, segment.length)
  const sliceLength = Math.max(clampedEnd - clampedStart, 1e-4)
  const sliceCenterAlong = clampedStart + sliceLength / 2
  const [centerOffsetX, centerOffsetZ] = rotateXZ(0, sliceCenterAlong, transform.rotation)
  const centerX = transform.position[0] + centerOffsetX
  const centerZ = transform.position[2] + centerOffsetZ
  const halfWidth = segment.width / 2
  const halfLength = sliceLength / 2
  const corners: Point2D[] = [
    [-halfWidth, -halfLength],
    [halfWidth, -halfLength],
    [halfWidth, halfLength],
    [-halfWidth, halfLength],
  ]

  return corners.map(([localWidth, localLength]) => {
    const [offsetX, offsetZ] = rotateXZ(localWidth, localLength, transform.rotation)
    return [centerX + offsetX, centerZ + offsetZ]
  })
}

function getStraightSegmentSlicePolygon(
  stair: StairNode,
  layout: StraightStairLayout,
  startAlong: number,
  endAlong: number,
): Point2D[] {
  return getStraightSegmentLocalSlicePolygon(layout, startAlong, endAlong).map(([x, z]) =>
    toWorldPlanPoint(stair, x, z),
  )
}

function getStraightFlightOpeningDepth(stair: StairNode, segment: StairSegmentNode) {
  const treadDepth = Math.max(
    0.2,
    segment.length / Math.max(segment.stepCount || stair.stepCount || 10, 1),
  )
  return Math.min(segment.length, Math.max(treadDepth * 6, segment.length * 0.62, 1.8))
}

function polygonArea(points: Point2D[]) {
  let area = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    if (!current || !next) continue
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

function pointOnSegment(point: Point2D, a: Point2D, b: Point2D, tolerance = 1e-6) {
  const cross = (point[1] - a[1]) * (b[0] - a[0]) - (point[0] - a[0]) * (b[1] - a[1])
  if (Math.abs(cross) > tolerance) return false
  const dot = (point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])
  if (dot < -tolerance) return false
  const lenSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2
  return dot <= lenSq + tolerance
}

function pointInPolygon(point: Point2D, polygon: Point2D[]) {
  if (polygon.length < 3) return false
  let inside = false
  const [x, z] = point

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (pointOnSegment(point, a, b)) return true
    const intersects =
      a[1] > z !== b[1] > z && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    if (intersects) inside = !inside
  }

  return inside
}

function polygonContainsPolygon(outer: Point2D[], inner: Point2D[]) {
  return inner.every((point) => pointInPolygon(point, outer))
}

function getAxisAlignedRectFromPolygon(polygon: Point2D[]): AxisAlignedRect | null {
  if (polygon.length < 4) return null
  const xs = polygon.map(([x]) => x)
  const zs = polygon.map(([, z]) => z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  if (!(maxX > minX && maxZ > minZ)) return null
  return { minX, maxX, minZ, maxZ }
}

function expandRect(rect: AxisAlignedRect, offset: number): AxisAlignedRect {
  if (offset <= 1e-6) {
    return rect
  }

  return {
    minX: rect.minX - offset,
    maxX: rect.maxX + offset,
    minZ: rect.minZ - offset,
    maxZ: rect.maxZ + offset,
  }
}

function buildUnionPolygonsFromRects(rects: AxisAlignedRect[]): Point2D[][] {
  if (rects.length === 0) return []

  const xs = Array.from(
    new Set(
      rects.flatMap((rect) => [rect.minX, rect.maxX]).map((value) => Number(value.toFixed(6))),
    ),
  ).sort((a, b) => a - b)
  const zs = Array.from(
    new Set(
      rects.flatMap((rect) => [rect.minZ, rect.maxZ]).map((value) => Number(value.toFixed(6))),
    ),
  ).sort((a, b) => a - b)
  if (xs.length < 2 || zs.length < 2) return []

  const occupied = new Set<string>()
  for (let xi = 0; xi < xs.length - 1; xi += 1) {
    for (let zi = 0; zi < zs.length - 1; zi += 1) {
      const cx = (xs[xi]! + xs[xi + 1]!) / 2
      const cz = (zs[zi]! + zs[zi + 1]!) / 2
      if (
        rects.some((rect) => cx > rect.minX && cx < rect.maxX && cz > rect.minZ && cz < rect.maxZ)
      ) {
        occupied.add(`${xi}:${zi}`)
      }
    }
  }

  const edgeMap = new Map<string, Point2D>()
  const addEdge = (start: Point2D, end: Point2D) => {
    edgeMap.set(`${start[0]},${start[1]}`, end)
  }

  for (let xi = 0; xi < xs.length - 1; xi += 1) {
    for (let zi = 0; zi < zs.length - 1; zi += 1) {
      if (!occupied.has(`${xi}:${zi}`)) continue

      const x0 = xs[xi]!
      const x1 = xs[xi + 1]!
      const z0 = zs[zi]!
      const z1 = zs[zi + 1]!

      if (!occupied.has(`${xi}:${zi - 1}`)) addEdge([x0, z0], [x1, z0])
      if (!occupied.has(`${xi + 1}:${zi}`)) addEdge([x1, z0], [x1, z1])
      if (!occupied.has(`${xi}:${zi + 1}`)) addEdge([x1, z1], [x0, z1])
      if (!occupied.has(`${xi - 1}:${zi}`)) addEdge([x0, z1], [x0, z0])
    }
  }

  const polygons: Point2D[][] = []
  while (edgeMap.size > 0) {
    const firstEntry = edgeMap.entries().next().value as [string, Point2D] | undefined
    if (!firstEntry) break
    const [startKey] = firstEntry
    const startParts = startKey.split(',').map(Number)
    const sx = startParts[0]
    const sz = startParts[1]
    if (sx === undefined || sz === undefined) {
      edgeMap.delete(startKey)
      continue
    }
    const start: Point2D = [sx, sz]
    const polygon: Point2D[] = [start]
    let current = start

    while (true) {
      const currentKey = `${current[0]},${current[1]}`
      const next = edgeMap.get(currentKey)
      if (!next) break
      edgeMap.delete(currentKey)
      if (pointsEqual(next, start)) {
        break
      }
      polygon.push(next)
      current = next
    }

    if (polygon.length >= 3) {
      polygons.push(polygonArea(polygon) < 0 ? [...polygon].reverse() : polygon)
    }
  }

  return polygons
}

function getCurvedOpeningStepCount(
  stair: StairNode,
  innerRadius: number,
  outerRadius: number,
  totalSweep: number,
) {
  const stepCount = Math.max(2, Math.round(stair.stepCount ?? 10))
  const stepSweep = Math.abs(totalSweep) / stepCount
  const midRadius = Math.max((innerRadius + outerRadius) * 0.5, 0.01)
  const treadDepth = Math.max(stepSweep * midRadius, 0.2)
  return Math.min(
    stepCount,
    Math.max(
      1,
      Math.ceil(1.8 / treadDepth),
      Math.ceil(stepCount * CURVED_STAIR_SLAB_OPENING_RATIO),
    ),
  )
}

function buildArcOpeningPolygon(
  stair: StairNode,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
): Point2D[] {
  const sweep = endAngle - startAngle
  const segmentCount = Math.max(
    10,
    Math.min(
      32,
      Math.ceil(Math.abs(sweep) / (Math.PI / 24) + Math.max(stair.stepCount ?? 1, 1) * 0.5),
    ),
  )
  const outerPoints: Point2D[] = []
  const innerPoints: Point2D[] = []

  for (let index = 0; index <= segmentCount; index++) {
    const t = index / segmentCount
    const angle = startAngle + sweep * t
    outerPoints.push(
      toWorldPlanPoint(stair, Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius),
    )
  }

  for (let index = segmentCount; index >= 0; index--) {
    const t = index / segmentCount
    const angle = startAngle + sweep * t

    innerPoints.push(
      toWorldPlanPoint(stair, Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius),
    )
  }

  return [...outerPoints, ...innerPoints]
}

function getCurvedOpeningPolygon(stair: StairNode, targetElevation?: number): Point2D[] {
  const width = Math.max(stair.width ?? 1, 0.4)
  const innerRadius = Math.max(0.2, stair.innerRadius ?? 0.9)
  const outerRadius = innerRadius + width
  const totalSweep = stair.sweepAngle ?? Math.PI / 2
  const stepCount = Math.max(2, Math.round(stair.stepCount ?? 10))
  const stepHeight = Math.max(stair.totalRise ?? 2.5, 0.1) / stepCount
  const stepSweep = totalSweep / stepCount
  const targetThreshold = Math.max(stepHeight * 2, STRAIGHT_STAIR_TARGET_THRESHOLD_MIN)
  const endAngle = totalSweep / 2

  const fallbackStartStepIndex = Math.max(
    0,
    stepCount - getCurvedOpeningStepCount(stair, innerRadius, outerRadius, totalSweep),
  )
  let startStepIndex = fallbackStartStepIndex
  if (typeof targetElevation === 'number') {
    for (let index = 0; index < stepCount; index += 1) {
      const stepTopElevation = stepHeight * (index + 1)
      if (stepTopElevation >= targetElevation - targetThreshold) {
        startStepIndex = Math.max(
          0,
          Math.min(fallbackStartStepIndex, index - CURVED_STAIR_OPENING_STEP_PADDING),
        )
        break
      }
    }
  }

  const startAngle = -totalSweep / 2 + stepSweep * startStepIndex
  return buildArcOpeningPolygon(stair, innerRadius, outerRadius, startAngle, endAngle)
}

function getSpiralOpeningPolygon(stair: StairNode): Point2D[] {
  const radius = Math.max(0.05, stair.innerRadius ?? 0.9) + Math.max(stair.width ?? 1, 0.4)
  const segmentCount = 48

  return Array.from({ length: segmentCount }).map((_, index) => {
    const angle = (index / segmentCount) * Math.PI * 2
    return toWorldPlanPoint(stair, Math.cos(angle) * radius, Math.sin(angle) * radius)
  })
}

function getStraightOpeningPolygonsForSurface(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  targetElevation: number,
) {
  const layouts = getStraightStairLayouts(stair, nodes)
  if (layouts.length === 0) return []

  const riserHeight = (stair.totalRise ?? 2.5) / Math.max(stair.stepCount ?? 10, 1)
  const targetThreshold = Math.max(riserHeight * 2, STRAIGHT_STAIR_TARGET_THRESHOLD_MIN)
  const openingOffset = Math.max(stair.openingOffset ?? 0, 0)
  const openingRects: AxisAlignedRect[] = []

  for (let index = 0; index < layouts.length; index += 1) {
    const layout = layouts[index]
    if (!layout) continue

    const { segment, transform } = layout
    const segmentStartElevation = transform.position[1]
    const segmentTopElevation = layout.topElevation

    if (segment.segmentType === 'stair') {
      if (Math.abs(targetElevation - segmentTopElevation) <= targetThreshold) {
        const openingDepth = getStraightFlightOpeningDepth(stair, segment)
        const flightRect = getAxisAlignedRectFromPolygon(
          getStraightSegmentLocalSlicePolygon(
            layout,
            Math.max(0, segment.length - openingDepth),
            segment.length,
          ),
        )
        if (flightRect) openingRects.push(expandRect(flightRect, openingOffset))
      }
      continue
    }

    if (Math.abs(targetElevation - segmentStartElevation) > targetThreshold) {
      continue
    }

    const landingRects: AxisAlignedRect[] = []
    const landingRect = getAxisAlignedRectFromPolygon(
      getStraightSegmentLocalSlicePolygon(layout, 0, layout.segment.length),
    )
    if (landingRect) landingRects.push(expandRect(landingRect, openingOffset))
    const previous = layouts[index - 1]
    if (previous?.segment.segmentType === 'stair') {
      const previousTopElevation = previous.topElevation
      if (Math.abs(targetElevation - previousTopElevation) <= targetThreshold) {
        const previousDepth = getStraightFlightOpeningDepth(stair, previous.segment)
        const previousRect = getAxisAlignedRectFromPolygon(
          getStraightSegmentLocalSlicePolygon(
            previous,
            Math.max(0, previous.segment.length - previousDepth),
            previous.segment.length,
          ),
        )
        if (previousRect) landingRects.push(expandRect(previousRect, openingOffset))
      }
    }

    openingRects.push(...landingRects)
  }

  if (openingRects.length > 0) {
    const unionPolygons = buildUnionPolygonsFromRects(openingRects).map((polygon) =>
      polygon.map(([x, z]) => toWorldPlanPoint(stair, x, z)),
    )
    if (unionPolygons.length > 0) {
      return unionPolygons
    }
  }

  let fallbackLayout = layouts[layouts.length - 1]
  for (let index = layouts.length - 1; index >= 0; index -= 1) {
    const layout = layouts[index]
    if (layout?.segment.segmentType === 'stair') {
      fallbackLayout = layout
      break
    }
  }
  return fallbackLayout ? [getStraightSegmentFootprintPolygon(stair, fallbackLayout)] : []
}

function getStairOpeningPolygons(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  targetElevation?: number,
) {
  if ((stair.slabOpeningMode ?? 'none') !== 'destination') {
    return []
  }

  if (stair.stairType === 'curved') {
    return [getCurvedOpeningPolygon(stair, targetElevation)]
  }

  if (stair.stairType === 'spiral') {
    return [getSpiralOpeningPolygon(stair)]
  }

  if (typeof targetElevation === 'number') {
    return getStraightOpeningPolygonsForSurface(stair, nodes, targetElevation)
  }

  return getStraightOpeningPolygonsForSurface(
    stair,
    nodes,
    Math.max(...getStraightStairLayouts(stair, nodes).map((layout) => layout.topElevation), 0),
  )
}

function getTargetSlabElevationForStair(
  stair: StairNode,
  slab: SlabNode,
  slabLevelId: string,
  nodes: Record<string, AnyNode>,
) {
  const { fromLevelId } = getResolvedStairLevelIds(stair, nodes)
  const fromLevel = getLevelNumber(fromLevelId, nodes)
  const slabLevel = getLevelNumber(slabLevelId, nodes)

  if (fromLevel === undefined || slabLevel === undefined) {
    return slab.elevation ?? 0.05
  }

  return (
    (slabLevel - fromLevel) * DEFAULT_WALL_HEIGHT +
    (slab.elevation ?? 0.05) -
    (stair.position[1] ?? 0)
  )
}

function getTargetCeilingElevationForStair(
  stair: StairNode,
  ceiling: CeilingNode,
  ceilingLevelId: string,
  nodes: Record<string, AnyNode>,
) {
  const { fromLevelId } = getResolvedStairLevelIds(stair, nodes)
  const fromLevel = getLevelNumber(fromLevelId, nodes)
  const ceilingLevel = getLevelNumber(ceilingLevelId, nodes)

  if (fromLevel === undefined || ceilingLevel === undefined) {
    return ceiling.height ?? DEFAULT_WALL_HEIGHT
  }

  return (
    (ceilingLevel - fromLevel) * DEFAULT_WALL_HEIGHT +
    (ceiling.height ?? DEFAULT_WALL_HEIGHT) -
    (stair.position[1] ?? 0)
  )
}

function shouldApplyStairToSlab(
  stair: StairNode,
  slabLevelId: string,
  nodes: Record<string, AnyNode>,
) {
  const { fromLevelId, toLevelId } = getResolvedStairLevelIds(stair, nodes)
  const fromLevel = getLevelNumber(fromLevelId, nodes)
  const toLevel = getLevelNumber(toLevelId, nodes)
  const slabLevel = getLevelNumber(slabLevelId, nodes)

  if (slabLevel === undefined) {
    return toLevelId === slabLevelId
  }

  if (fromLevel === undefined || toLevel === undefined) {
    return toLevelId === slabLevelId
  }

  const minLevel = Math.min(fromLevel, toLevel)
  const maxLevel = Math.max(fromLevel, toLevel)
  return slabLevel > minLevel && slabLevel <= maxLevel
}

function shouldApplyStairToCeiling(
  stair: StairNode,
  ceilingLevelId: string,
  nodes: Record<string, AnyNode>,
) {
  const { fromLevelId, toLevelId } = getResolvedStairLevelIds(stair, nodes)
  const fromLevel = getLevelNumber(fromLevelId, nodes)
  const toLevel = getLevelNumber(toLevelId, nodes)
  const ceilingLevel = getLevelNumber(ceilingLevelId, nodes)

  if (ceilingLevel === undefined) {
    return fromLevelId === ceilingLevelId
  }

  if (fromLevel === undefined || toLevel === undefined) {
    return fromLevelId === ceilingLevelId
  }

  const minLevel = Math.min(fromLevel, toLevel)
  const maxLevel = Math.max(fromLevel, toLevel)
  return ceilingLevel >= minLevel && ceilingLevel < maxLevel
}

export function syncAutoStairOpenings(nodes: Record<string, AnyNode>) {
  const stairs = Object.values(nodes).filter(
    (node): node is StairNode => node.type === 'stair' && node.visible !== false,
  )
  const slabs = Object.values(nodes).filter((node): node is SlabNode => node.type === 'slab')
  const ceilings = Object.values(nodes).filter(
    (node): node is CeilingNode => node.type === 'ceiling',
  )
  const updates: Array<{ id: AnyNodeId; data: Partial<SlabNode | CeilingNode> }> = []

  for (const slab of slabs) {
    const slabLevelId = resolveLevelId(slab, nodes)
    const existingHoles = slab.holes ?? []
    const existingMetadata = normalizeExistingMetadata(existingHoles, slab.holeMetadata)
    const manualHoles = existingHoles.filter(
      (_hole, index) => existingMetadata[index]?.source !== 'stair',
    )
    const manualMetadata = existingMetadata
      .filter((entry) => entry.source !== 'stair')
      .map((entry) => ({ ...entry }))

    const stairHoles = stairs
      .filter((stair) => shouldApplyStairToSlab(stair, slabLevelId, nodes))
      .flatMap((stair) =>
        getStairOpeningPolygons(
          stair,
          nodes,
          getTargetSlabElevationForStair(stair, slab, slabLevelId, nodes),
        ).map((polygon) => ({
          polygon:
            stair.stairType === 'straight'
              ? polygon
              : expandPolygonFromCentroid(
                  polygon,
                  Math.max((stair.openingOffset ?? 0) - STAIR_SLAB_OPENING_TIGHTENING, 0),
                ),
          metadata: {
            source: 'stair' as const,
            stairId: stair.id,
          },
        })),
      )
      .filter((hole) => polygonContainsPolygon(slab.polygon, hole.polygon))

    const nextHoles = [...manualHoles, ...stairHoles.map((hole) => hole.polygon)]
    const nextMetadata = [...manualMetadata, ...stairHoles.map((hole) => hole.metadata)]

    if (
      !polygonsEqual(existingHoles, nextHoles) ||
      !metadataEqual(existingMetadata, nextMetadata)
    ) {
      updates.push({
        id: slab.id,
        data: {
          holes: nextHoles,
          holeMetadata: nextMetadata,
        },
      })
    }
  }

  for (const ceiling of ceilings) {
    const ceilingLevelId = resolveLevelId(ceiling, nodes)
    const existingHoles = ceiling.holes ?? []
    const existingMetadata = normalizeExistingMetadata(existingHoles, ceiling.holeMetadata)
    const manualHoles = existingHoles.filter(
      (_hole, index) => existingMetadata[index]?.source !== 'stair',
    )
    const manualMetadata = existingMetadata
      .filter((entry) => entry.source !== 'stair')
      .map((entry) => ({ ...entry }))

    const stairHoles = stairs
      .filter((stair) => shouldApplyStairToCeiling(stair, ceilingLevelId, nodes))
      .flatMap((stair) =>
        getStairOpeningPolygons(
          stair,
          nodes,
          getTargetCeilingElevationForStair(stair, ceiling, ceilingLevelId, nodes),
        ).map((polygon) => ({
          polygon:
            stair.stairType === 'straight'
              ? polygon
              : expandPolygonFromCentroid(
                  polygon,
                  Math.max((stair.openingOffset ?? 0) - STAIR_SLAB_OPENING_TIGHTENING, 0),
                ),
          metadata: {
            source: 'stair' as const,
            stairId: stair.id,
          },
        })),
      )
      .filter((hole) => polygonContainsPolygon(ceiling.polygon, hole.polygon))

    const nextHoles = [...manualHoles, ...stairHoles.map((hole) => hole.polygon)]
    const nextMetadata = [...manualMetadata, ...stairHoles.map((hole) => hole.metadata)]

    if (
      !polygonsEqual(existingHoles, nextHoles) ||
      !metadataEqual(existingMetadata, nextMetadata)
    ) {
      updates.push({
        id: ceiling.id,
        data: {
          holes: nextHoles,
          holeMetadata: nextMetadata,
        },
      })
    }
  }

  return updates
}

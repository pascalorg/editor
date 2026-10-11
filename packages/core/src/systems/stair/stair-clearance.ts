import { resolveLevelId } from '../../lib/node-ancestry'
import { area, intersection, type Polygon, type Ring, union } from '../../lib/polygon-boolean'
import type { AnyNode, AnyNodeId, StairNode, StairSegmentNode } from '../../schema'
import { StairDesignTargets } from '../../schema/nodes/stair'
import { resolveCeilingHeight } from '../../services/level-height'
import { getLevelElevations } from '../../services/storey'
import { stairBaseElevation } from './stair-base-elevation'
import {
  resolveArcStairConstruction,
  resolveStairConstruction,
  resolveStraightStairConstruction,
  type StairArcConstructionPiece,
  stairArcSliceCount,
} from './stair-construction'
import { measureStairDetail, STAIR_DETAIL_SURFACE_BUDGET } from './stair-detail-budget'
import { computeSegmentTransforms, rotateXZ } from './stair-footprint'
import { resolveStairArcLayout } from './stair-layout'
import { resolveStairTotalRise } from './stair-rise-query'
import { resolveStairWinder, resolveWinderStairConstruction } from './stair-winder'

export type StairBodySurface = {
  region: Polygon
  underside: [number, number, number]
  undersideFloor: number | null
  top: number
}

export type StairWalkingSurface = {
  nodeId: string
  index: number
  kind: 'tread' | 'landing'
  region: Polygon
  top: number
  approach: number
  undersideFloor: number | null
  underside: [number, number, number]
  walkingLine: [[number, number, number], [number, number, number]]
  bodies?: StairBodySurface[]
}

const TAU = 2 * Math.PI
const MAX_CLEARANCE_SURFACES = STAIR_DETAIL_SURFACE_BUDGET

function detailError(stair: StairNode, nodes: Record<string, AnyNode>) {
  return measureStairDetail(
    stair,
    stair.children
      .map((id) => nodes[id])
      .filter((node): node is StairSegmentNode => node?.type === 'stair-segment'),
  ).error
}

function sourceFrame(stair: StairNode, nodes: Record<string, AnyNode>) {
  const levels = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const sourceId =
    nodes[stair.fromLevelId ?? '']?.type === 'level'
      ? stair.fromLevelId
      : (Object.values(nodes).find(
          (node) => node.type === 'level' && node.children.includes(stair.id),
        )?.id ?? resolveLevelId(stair, nodes))
  const source = sourceId ? levels.get(sourceId) : undefined
  return {
    levels,
    sourceId: sourceId ?? null,
    base: (source?.baseY ?? 0) + stairBaseElevation(stair, nodes, sourceId ?? null),
    buildingId: source?.buildingId,
  }
}

function visible(node: AnyNode, nodes: Record<string, AnyNode>) {
  const visited = new Set<string>()
  let current: AnyNode | undefined = node
  while (current && !visited.has(current.id)) {
    if (current.visible === false && current.type !== 'site') return false
    visited.add(current.id)
    current = nodes[current.parentId ?? '']
  }
  return true
}

function arcRegion(
  point: (x: number, z: number) => [number, number],
  inner: number,
  outer: number,
  start: number,
  end: number,
): Polygon {
  const full = Math.abs(end - start) >= TAU - 1e-8
  const sweep = full ? Math.sign(end - start || 1) * TAU : end - start
  const count = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 60)))
  const rim = (radius: number): Ring =>
    Array.from({ length: count + (full ? 0 : 1) }, (_, i) => {
      const angle = start + (sweep * i) / count
      return point(Math.cos(angle) * radius, Math.sin(angle) * radius)
    })
  const outerRing = rim(outer)
  const innerRing = rim(inner)
  return full
    ? { outer: outerRing, holes: [innerRing] }
    : { outer: [...outerRing, ...innerRing.reverse()], holes: [] }
}

function arcPieceBodies(
  piece: StairArcConstructionPiece,
  point: (x: number, z: number) => [number, number],
  base: number,
): StairBodySurface[] {
  const sweep =
    Math.sign(piece.endAngle - piece.startAngle || 1) *
    Math.min(Math.abs(piece.endAngle - piece.startAngle), TAU)
  const count = stairArcSliceCount(piece.innerRadius, piece.outerRadius, sweep)
  const bodies: StairBodySurface[] = []
  const at = (radius: number, t: number): [number, number, number] => {
    const angle = piece.startAngle + sweep * t
    const [x, z] = point(Math.cos(angle) * radius, Math.sin(angle) * radius)
    return [x, z, base + piece.bottomStart + (piece.bottomEnd - piece.bottomStart) * t]
  }
  const triangle = (
    p: [number, number, number],
    q: [number, number, number],
    r: [number, number, number],
  ) => {
    const ux = q[0] - p[0],
      uz = q[1] - p[1],
      uy = q[2] - p[2]
    const vx = r[0] - p[0],
      vz = r[1] - p[1],
      vy = r[2] - p[2]
    const determinant = ux * vz - uz * vx
    if (Math.abs(determinant) < Number.EPSILON * Number.EPSILON) return
    const a = (uy * vz - uz * vy) / determinant,
      b = (ux * vy - uy * vx) / determinant
    bodies.push({
      region: {
        outer: [
          [p[0], p[1]],
          [q[0], q[1]],
          [r[0], r[1]],
        ],
        holes: [],
      },
      underside: [a, b, p[2] - a * p[0] - b * p[1]],
      undersideFloor: null,
      top: base + piece.top,
    })
  }
  for (let index = 0; index < count; index++) {
    const t0 = index / count,
      t1 = (index + 1) / count
    const innerStart = at(piece.innerRadius, t0),
      innerEnd = at(piece.innerRadius, t1)
    const outerStart = at(piece.outerRadius, t0),
      outerEnd = at(piece.outerRadius, t1)
    triangle(innerStart, innerEnd, outerEnd)
    triangle(innerStart, outerEnd, outerStart)
  }
  return bodies
}

/** Building-local plan coordinates and absolute building Y, matching rendered walking surfaces. */
export function resolveStairWalkingSurfaces(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
): StairWalkingSurface[] {
  if (!visible(stair, nodes)) return []
  const error = detailError(stair, nodes)
  if (error) throw new RangeError(error)
  if (countSurfaces(stair, nodes) > MAX_CLEARANCE_SURFACES)
    throw new RangeError('Detailed stair clearance exceeds the surface query budget')
  const frame = sourceFrame(stair, nodes)
  const point = (x: number, z: number): [number, number] => {
    const [dx, dz] = rotateXZ(x, z, stair.rotation)
    return [stair.position[0] + dx, stair.position[2] + dz]
  }
  if (stair.stairType !== 'straight') {
    const layout = resolveStairArcLayout(stair, resolveStairTotalRise(stair, nodes))
    const explicit = resolveArcStairConstruction(stair, resolveStairTotalRise(stair, nodes))
    const bodies = new Map<number, StairBodySurface[]>()
    for (const piece of explicit ?? []) {
      const list = bodies.get(piece.index) ?? []
      list.push(...arcPieceBodies(piece, point, frame.base))
      bodies.set(piece.index, list)
    }
    const steps = [...layout.steps, ...(layout.landing ? [layout.landing] : [])]
    return steps.map((step, index): StairWalkingSurface => {
      const start = point(
        Math.cos(step.startAngle) * layout.walkingRadius,
        Math.sin(step.startAngle) * layout.walkingRadius,
      )
      const end = point(
        Math.cos(step.endAngle) * layout.walkingRadius,
        Math.sin(step.endAngle) * layout.walkingRadius,
      )
      const top = frame.base + step.top
      return {
        nodeId: stair.id,
        index,
        kind: index < layout.steps.length ? 'tread' : 'landing',
        region: arcRegion(
          point,
          layout.innerRadius,
          layout.outerRadius,
          step.startAngle - (index < layout.steps.length ? layout.nosingSweep : 0),
          step.endAngle,
        ),
        top,
        approach:
          frame.base + (index < layout.steps.length ? step.top - layout.riserHeight : step.top),
        undersideFloor: null,
        underside: [0, 0, frame.base + step.bottom],
        ...(explicit ? { bodies: bodies.get(index) ?? [] } : {}),
        walkingLine: [
          [start[0], top, start[1]],
          [end[0], top, end[1]],
        ],
      }
    })
  }
  const children = stair.children
    .map((id) => nodes[id])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')
  const segments: (Pick<
    StairSegmentNode,
    | 'width'
    | 'length'
    | 'height'
    | 'stepCount'
    | 'thickness'
    | 'fillToFloor'
    | 'attachmentSide'
    | 'segmentType'
    | 'construction'
    | 'winder'
  > & { id: string })[] = children.length
    ? children
    : [
        {
          id: stair.id,
          segmentType: 'stair',
          length: 3,
          width: stair.width,
          height: resolveStairTotalRise(stair, nodes),
          stepCount: Math.max(2, Math.round(stair.stepCount)),
          thickness: stair.thickness,
          fillToFloor: stair.fillToFloor,
          construction: stair.construction,
          attachmentSide: 'front',
        },
      ]
  const transforms = computeSegmentTransforms(segments)
  return segments.flatMap((segment, segmentIndex) => {
    if (children.length && !visible(children[segmentIndex]!, nodes)) return []
    const transform = transforms[segmentIndex]!
    const landing = segment.segmentType === 'landing'
    const count = landing ? 1 : Math.max(1, Math.round(segment.stepCount))
    const going = segment.length / count
    const riser = landing ? 0 : segment.height / count
    const yaw = stair.rotation + transform.rotation
    const localPoint = (x: number, z: number) => {
      const [dx, dz] = rotateXZ(x, z, transform.rotation)
      return point(transform.position[0] + dx, transform.position[2] + dz)
    }
    const winder = resolveStairWinder(segment)
    if (winder) {
      const pieces = resolveWinderStairConstruction(
        segment as StairSegmentNode,
        transform.position[1],
        stair,
      )!
      return winder.treads.map((tread, index): StairWalkingSurface => {
        const top = frame.base + transform.position[1] + tread.elevation
        const bodyPieces = pieces.filter((piece) => piece.index === index)
        const bodies = bodyPieces.flatMap((piece) => {
          // Fan triangles preserve a varying underside across each square-rim leg.
          return piece.polygon
            .slice(1, -1)
            .map((_, i) => {
              const indices = [0, i + 1, i + 2],
                vertices = indices.map((j) => localPoint(...piece.polygon[j]!)),
                ys = indices.map((j) => frame.base + transform.position[1] + piece.bottom[j]!)
              const [a, b, c] = vertices as [[number, number], [number, number], [number, number]]
              const determinant = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
              if (Math.abs(determinant) < 1e-12) return null
              const sx =
                ((ys[1]! - ys[0]!) * (c[1] - a[1]) - (ys[2]! - ys[0]!) * (b[1] - a[1])) /
                determinant
              const sz =
                ((b[0] - a[0]) * (ys[2]! - ys[0]!) - (c[0] - a[0]) * (ys[1]! - ys[0]!)) /
                determinant
              return {
                region: { outer: vertices, holes: [] },
                underside: [sx, sz, ys[0]! - sx * a[0] - sz * a[1]] as [number, number, number],
                undersideFloor: null,
                top: frame.base + transform.position[1] + piece.top,
              }
            })
            .filter((body): body is NonNullable<typeof body> => body !== null)
        })
        const start =
          winder.walkingLine.find(
            (p) => Math.abs(p[1] - (index * segment.height) / segment.stepCount) < 1e-7,
          ) ?? winder.walkingLine[0]!
        const end =
          winder.walkingLine.find(
            (p) => Math.abs(p[1] - ((index + 1) * segment.height) / segment.stepCount) < 1e-7,
          ) ?? winder.walkingLine.at(-1)!
        const a = localPoint(start[0], start[2]),
          b = localPoint(end[0], end[2])
        return {
          nodeId: segment.id,
          index,
          kind: 'tread',
          region: { outer: tread.polygon.map((p) => localPoint(...p)), holes: [] },
          top,
          approach: top - segment.height / segment.stepCount,
          underside: [0, 0, Math.min(...bodies.map((body) => body.underside[2]))],
          undersideFloor: null,
          walkingLine: [
            [a[0], top, a[1]],
            [b[0], top, b[1]],
          ],
          bodies,
        }
      })
    }
    const origin = localPoint(0, 0)
    const slope = landing ? 0 : segment.height / segment.length
    const verticalThickness = landing
      ? segment.thickness
      : segment.thickness * Math.sqrt(1 + slope * slope)
    const a = Math.sin(yaw) * slope
    const b = Math.cos(yaw) * slope
    const underside: [number, number, number] = segment.fillToFloor
      ? [0, 0, frame.base]
      : [
          a,
          b,
          frame.base + transform.position[1] - verticalThickness - a * origin[0] - b * origin[1],
        ]
    const construction = resolveStairConstruction(segment, stair)
    const pieces = resolveStraightStairConstruction(
      segment as StairSegmentNode,
      transform.position[1],
      stair,
    )
    const bodies = new Map<number, StairBodySurface[]>()
    for (const piece of pieces ?? []) {
      const [slope, intercept] = piece.underside
      const a = Math.sin(yaw) * slope,
        b = Math.cos(yaw) * slope
      const list = bodies.get(piece.index) ?? []
      list.push({
        region: {
          outer: [
            localPoint(piece.x0, piece.z0),
            localPoint(piece.x1, piece.z0),
            localPoint(piece.x1, piece.z1),
            localPoint(piece.x0, piece.z1),
          ],
          holes: [],
        },
        underside: [
          a,
          b,
          frame.base + transform.position[1] + intercept - a * origin[0] - b * origin[1],
        ],
        undersideFloor: null,
        top: frame.base + transform.position[1] + piece.top,
      })
      bodies.set(piece.index, list)
    }
    return Array.from({ length: count }, (_, index): StairWalkingSurface => {
      const z0 = index * going,
        z1 = (index + 1) * going
      const top = frame.base + transform.position[1] + (index + 1) * riser
      const start = localPoint(0, z0),
        end = localPoint(0, z1)
      return {
        nodeId: segment.id,
        index,
        kind: landing ? 'landing' : 'tread',
        region: {
          outer: [
            localPoint(-segment.width / 2, z0 - (landing ? 0 : (construction?.nosing ?? 0))),
            localPoint(segment.width / 2, z0 - (landing ? 0 : (construction?.nosing ?? 0))),
            localPoint(segment.width / 2, z1),
            localPoint(-segment.width / 2, z1),
          ],
          holes: [],
        },
        top,
        approach: frame.base + transform.position[1] + index * riser,
        undersideFloor:
          !landing && !segment.fillToFloor && transform.position[1] === 0 ? frame.base : null,
        underside,
        walkingLine: [
          [start[0], top, start[1]],
          [end[0], top, end[1]],
        ],
        ...(pieces ? { bodies: bodies.get(index) ?? [] } : {}),
      }
    })
  })
}

function effectiveCount(count: number, minimum: number) {
  return Number.isFinite(count) ? Math.max(minimum, Math.round(count)) : Infinity
}

function countSurfaces(stair: StairNode, nodes: Record<string, AnyNode>) {
  if (stair.stairType !== 'straight')
    return effectiveCount(stair.stepCount, 2) + (stair.topLandingMode === 'integrated' ? 1 : 0)
  const children = stair.children
    .map((id) => nodes[id])
    .filter((node): node is StairSegmentNode => node?.type === 'stair-segment')
  return children.length
    ? children.reduce(
        (count, child) =>
          count +
          (visible(child, nodes)
            ? child.segmentType === 'landing'
              ? 1
              : effectiveCount(child.stepCount, 1)
            : 0),
        0,
      )
    : effectiveCount(stair.stepCount, 2)
}

export type StairHeadroom = {
  /** Actual overhead clearance by flight; missing entries have no measured overhead. */
  flightMinimum: Record<string, number>
  status: 'evaluated' | 'unresolved'
  checkedSurfaceTypes: readonly ['slab', 'ceiling', 'stair-body']
  required: number
  minimum: number | null
  obstructions: { nodeId: string; treadNodeId: string; treadIndex: number; clearance: number }[]
}

export function measureStairHeadroom(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
): StairHeadroom {
  const required =
    stair.designTargets?.minimumHeadroom ?? StairDesignTargets.parse({}).minimumHeadroom
  const checkedSurfaceTypes = ['slab', 'ceiling', 'stair-body'] as const
  const unresolved = (): StairHeadroom => ({
    status: 'unresolved',
    flightMinimum: {},
    checkedSurfaceTypes,
    required,
    minimum: null,
    obstructions: [],
  })
  if (detailError(stair, nodes) || countSurfaces(stair, nodes) > MAX_CLEARANCE_SURFACES)
    return unresolved()
  const frame = sourceFrame(stair, nodes)
  const walking = resolveStairWalkingSurfaces(stair, nodes)
  const obstacles: {
    nodeId: string
    region: Polygon
    underside: [number, number, number]
    top: number
    walking?: StairWalkingSurface
    undersideFloor?: number | null
  }[] = []
  for (const node of Object.values(nodes)) {
    if (!visible(node, nodes) || (node.type !== 'slab' && node.type !== 'ceiling')) continue
    const level = frame.levels.get(resolveLevelId(node, nodes))
    if (!level || level.buildingId !== frame.buildingId) continue
    const top =
      level.baseY +
      (node.type === 'slab'
        ? node.elevation
        : resolveCeilingHeight(node, nodes as Record<AnyNodeId, AnyNode>))
    obstacles.push({
      nodeId: node.id,
      region: { outer: node.polygon, holes: node.holes },
      top,
      underside: [0, 0, top - (node.type === 'slab' ? node.thickness : 0)],
    })
  }
  let surfaceCount = walking.length
  for (const other of Object.values(nodes)) {
    if (other.type !== 'stair' || other.id === stair.id || !visible(other, nodes)) continue
    if (sourceFrame(other, nodes).buildingId !== frame.buildingId) continue
    if (detailError(other, nodes)) return unresolved()
    surfaceCount += countSurfaces(other, nodes)
    if (surfaceCount > MAX_CLEARANCE_SURFACES) return unresolved()
    for (const surface of resolveStairWalkingSurfaces(other, nodes))
      for (const body of surface.bodies ?? [surface])
        obstacles.push({ nodeId: surface.nodeId, ...body, walking: surface })
  }
  for (const surface of walking)
    for (const body of surface.bodies ?? [surface])
      obstacles.push({ nodeId: surface.nodeId, ...body, walking: surface })
  const order = new Map(walking.map((surface, index) => [surface, index]))
  const obstructions: {
    nodeId: string
    treadNodeId: string
    treadIndex: number
    clearance: number
  }[] = []
  const flightMinimum: Record<string, number> = {}
  let minimum = Infinity
  for (const surface of walking) {
    for (const obstacle of obstacles) {
      if (obstacle.walking === surface || obstacle.top <= surface.top + 1e-6) continue
      // A nosing overlaps its own next approach; it is not an overhead flight.
      if (
        obstacle.walking &&
        order.has(obstacle.walking) &&
        Math.abs(order.get(obstacle.walking)! - order.get(surface)!) === 1 &&
        (obstacle.walking.bodies || surface.bodies)
      )
        continue
      const overlap = intersection(surface.region, obstacle.region)
      if (area(overlap) <= 1e-6) continue
      const [a, b, c] = obstacle.underside
      const clearance = Math.max(
        0,
        Math.min(
          ...overlap.flatMap((region) =>
            region.outer.map(
              ([x, z]) =>
                Math.max(a * x + b * z + c, obstacle.undersideFloor ?? -Infinity) - surface.top,
            ),
          ),
        ),
      )
      minimum = Math.min(minimum, clearance)
      if (surface.kind === 'tread')
        flightMinimum[surface.nodeId] = Math.min(
          flightMinimum[surface.nodeId] ?? Infinity,
          clearance,
        )
      if (clearance < required - 1e-6)
        obstructions.push({
          nodeId: obstacle.nodeId,
          treadNodeId: surface.nodeId,
          treadIndex: surface.index,
          clearance,
        })
    }
  }
  return {
    status: 'evaluated' as const,
    flightMinimum,
    checkedSurfaceTypes,
    required,
    minimum: Number.isFinite(minimum) ? minimum : null,
    obstructions,
  }
}

function expand(region: Polygon, offset: number): Polygon[] {
  if (!(offset > 0)) return [region]
  const pieces: Polygon[] = [region]
  for (const ring of [region.outer, ...region.holes])
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i]!,
        q = ring[(i + 1) % ring.length]!
      const length = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (!length) continue
      const nx = (-(q[1] - p[1]) / length) * offset,
        nz = ((q[0] - p[0]) / length) * offset
      pieces.push({
        outer: [
          [p[0] + nx, p[1] + nz],
          [q[0] + nx, q[1] + nz],
          [q[0] - nx, q[1] - nz],
          [p[0] - nx, p[1] - nz],
        ],
        holes: [],
      })
      pieces.push({
        outer: Array.from({ length: 12 }, (_, j) => [
          p[0] + Math.cos((j * TAU) / 12) * offset,
          p[1] + Math.sin((j * TAU) / 12) * offset,
        ]),
        holes: [],
      })
    }
  return union(pieces)
}

/** Surface-hole rings cannot contain islands; split annular cuts while preserving their centre. */
function openingRings(regions: Polygon[]): Ring[] {
  return regions.flatMap((region) => {
    if (!region.holes.length) return [region.outer]
    const hole = region.holes[0]!
    const xs = region.outer.map((p) => p[0]),
      zs = region.outer.map((p) => p[1])
    const mid = hole.reduce((sum, p) => sum + p[0], 0) / hole.length
    const minX = Math.min(...xs) - 1,
      maxX = Math.max(...xs) + 1,
      minZ = Math.min(...zs) - 1,
      maxZ = Math.max(...zs) + 1
    return openingRings([
      ...intersection(region, [
        [minX, minZ],
        [mid, minZ],
        [mid, maxZ],
        [minX, maxZ],
      ]),
      ...intersection(region, [
        [mid, minZ],
        [maxX, minZ],
        [maxX, maxZ],
        [mid, maxZ],
      ]),
    ])
  })
}

function belowPlane(
  region: Polygon,
  plane: [number, number, number],
  elevation: number,
): Polygon[] {
  const [a, b, c] = plane
  if (Math.abs(a) + Math.abs(b) < 1e-12) return c <= elevation + 1e-6 ? [region] : []
  const xs = region.outer.map((p) => p[0]),
    zs = region.outer.map((p) => p[1])
  const x0 = Math.min(...xs) - 1,
    x1 = Math.max(...xs) + 1,
    z0 = Math.min(...zs) - 1,
    z1 = Math.max(...zs) + 1
  const rectangle: Ring = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
  const clipped: Ring = []
  for (let i = 0; i < rectangle.length; i++) {
    const p = rectangle[i]!,
      q = rectangle[(i + 1) % rectangle.length]!
    const dp = a * p[0] + b * p[1] + c - elevation,
      dq = a * q[0] + b * q[1] + c - elevation
    if (dp <= 0) clipped.push(p)
    if (dp <= 0 !== dq <= 0) {
      const t = dp / (dp - dq)
      clipped.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])])
    }
  }
  return clipped.length >= 3 ? intersection(region, clipped) : []
}

export function stairClearanceOpening(
  stair: StairNode,
  nodes: Record<string, AnyNode>,
  undersideElevation: number,
  offset = 0,
  surfaceTopElevation = undersideElevation,
): Ring[] | null {
  if (detailError(stair, nodes) || countSurfaces(stair, nodes) > MAX_CLEARANCE_SURFACES) return null
  const required =
    stair.designTargets?.minimumHeadroom ?? StairDesignTargets.parse({}).minimumHeadroom
  const regions = resolveStairWalkingSurfaces(stair, nodes).flatMap((surface) => {
    if (surface.top + required <= undersideElevation + 1e-6) return []
    if (surface.approach <= surfaceTopElevation + 1e-6)
      return expand(surface.region, Math.max(0, offset))
    if (
      surface.top < undersideElevation - 1e-6 ||
      (!surface.bodies &&
        surface.undersideFloor !== null &&
        surface.undersideFloor > surfaceTopElevation + 1e-6)
    )
      return []
    return (surface.bodies ?? [surface]).flatMap((body) => {
      if (body.top < undersideElevation - 1e-6) return []
      if (body.undersideFloor !== null && body.undersideFloor > surfaceTopElevation + 1e-6)
        return []
      return belowPlane(body.region, body.underside, surfaceTopElevation).flatMap((region) =>
        expand(region, Math.max(0, offset)),
      )
    })
  })
  return openingRings(union(regions))
}

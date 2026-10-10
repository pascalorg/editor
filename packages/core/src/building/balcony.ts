import { type AnyNode, FenceNode, type LevelNode, SlabNode, type WallNode } from '../schema'
import { getStoredLevelHeight } from '../services/storey'
import { getWallCurveFrameAt, getWallCurveLength } from '../systems/wall/wall-curve'
import { exposedBalconyEdges } from './balcony-edges'
import { wallBaseElevationIn } from './wall-support-in'

export type BalconyPoint = [number, number]
export type BalconyOptions = {
  depth: number
  reverse: boolean
  thickness: number
  railing: 'slat' | 'rail' | 'glass' | 'none'
  railingHeight: number
  openEdge: number | null
}
export const DEFAULT_BALCONY: BalconyOptions = {
  depth: 1.4,
  reverse: false,
  thickness: 0.18,
  railing: 'slat',
  railingHeight: 1.1,
  openEdge: null,
}
export function balconyElevation(value: number, floorHeight: number, options: BalconyOptions) {
  const max = floorHeight - (options.railing === 'none' ? 0 : options.railingHeight)
  if (![value, max].every(Number.isFinite))
    throw Error('The railing must fit within the floor height.')
  return Math.max(0, Math.min(Math.max(0, max), value))
}

export function balconySlab(input: Parameters<typeof SlabNode.parse>[0]): SlabNode {
  return SlabNode.parse({
    name: 'Balcony slab',
    thickness: 0.18,
    autoFromWalls: false,
    fillToTerrain: false,
    material: {
      preset: 'concrete',
      properties: { color: '#aaaeb0', roughness: 0.85, metalness: 0 },
    },
    ...(input as object),
  })
}
export function balconyGuard(input: Parameters<typeof FenceNode.parse>[0]): FenceNode {
  const data = input as Record<string, unknown>
  const slots = { ...(data.slots as Record<string, string> | undefined) }
  const wasGlass = slots.infill === 'library:preset-glass'
  if (data.style === 'glass') slots.infill = 'library:preset-glass'
  else if (slots.infill === 'library:preset-glass') delete slots.infill
  return FenceNode.parse({
    name: 'Balcony railing',
    supportOffset: 0,
    height: 1.1,
    thickness: 0.035,
    postSize: 0.04,
    postSpacing: 1.2,
    baseStyle: 'floating',
    baseHeight: 0,
    groundClearance: 0,
    topRailHeight: 0.04,
    postCap: 'none',
    style: 'slat',
    material: {
      preset: 'custom',
      properties: { color: '#656d74', roughness: 0.4, metalness: 0.65 },
    },
    ...data,
    slots,
    ...(wasGlass && data.style !== 'glass' ? { slatGap: 0.01 } : {}),
    // Native horizontal infill at zero gap is one continuous panel, with separate metal slots.
    ...(data.style === 'glass' ? { style: 'horizontal', slatGap: 0, showInfill: true } : {}),
  })
}

export function validateBalconyPolygon(points: BalconyPoint[]) {
  if (points.length < 3 || points.length > 1024 || points.some((p) => !p.every(Number.isFinite)))
    throw Error('Choose a closed footprint with 3–1024 corners.')
  const cross = (a: BalconyPoint, b: BalconyPoint, c: BalconyPoint) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.001)
      throw Error('The footprint has a collapsed edge.')
    area += a[0] * b[1] - a[1] * b[0]
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue
      const c = points[j]!,
        d = points[(j + 1) % points.length]!
      if (cross(a, b, c) * cross(a, b, d) < -1e-12 && cross(c, d, a) * cross(c, d, b) < -1e-12)
        throw Error('The balcony overlaps itself. Reduce projection or select fewer edges.')
    }
  }
  if (Math.abs(area) < 0.02) throw Error('The balcony footprint has no usable area.')
}

/** Offset to one side, keeping the source path open as the balcony entrance. */
export function balconyFromEdge(points: BalconyPoint[], depth: number, reverse = false) {
  if (points.length < 2 || !Number.isFinite(depth) || depth < 0.2 || depth > 10)
    throw Error('Use a projection of 0.2–10 m and select an edge.')
  const normals = points.slice(1).map((b, i): BalconyPoint => {
    const a = points[i]!,
      length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length < 0.001) throw Error('The selected edge is too short.')
    return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length]
  })
  const far = points.map((p, i): BalconyPoint => {
    const a = normals[Math.max(0, i - 1)]!,
      b = normals[Math.min(i, normals.length - 1)]!
    const denominator = 1 + a[0] * b[0] + a[1] * b[1]
    if (denominator < 0.1) throw Error('This edge turns back on itself. Select a shorter run.')
    const sign = reverse ? -1 : 1
    return [
      p[0] + (sign * depth * (a[0] + b[0])) / denominator,
      p[1] + (sign * depth * (a[1] + b[1])) / denominator,
    ]
  })
  const polygon = [...points, ...[...far].reverse()]
  validateBalconyPolygon(polygon)
  return {
    polygon,
    guardEdges: [
      [points[0]!, far[0]!],
      ...far.slice(1).map((p, i) => [far[i]!, p]),
      [far.at(-1)!, points.at(-1)!],
    ] as [BalconyPoint, BalconyPoint][],
  }
}

export function createBalconyParts({
  level,
  polygon,
  holes = [],
  guardEdges,
  options,
  elevation = 0,
  metadata = {},
  name = 'Balcony',
  walls = [],
  nodes = {},
}: {
  level: LevelNode
  polygon: BalconyPoint[]
  holes?: BalconyPoint[][]
  guardEdges?: [BalconyPoint, BalconyPoint][]
  options: BalconyOptions
  elevation?: number
  metadata?: Record<string, unknown>
  name?: string
  walls?: readonly WallNode[]
  nodes?: Record<string, AnyNode>
}): (SlabNode | FenceNode)[] {
  validateBalconyPolygon(polygon)
  holes.forEach(validateBalconyPolygon)
  if (
    !Number.isFinite(options.thickness) ||
    options.thickness < 0.02 ||
    options.thickness > 1 ||
    !Number.isFinite(options.railingHeight) ||
    options.railingHeight < 0.3 ||
    options.railingHeight > 3 ||
    !['slat', 'rail', 'glass', 'none'].includes(options.railing)
  )
    throw Error('Use a slab thickness of 0.02–1 m and railing height of 0.3–3 m.')
  const floorHeight = getStoredLevelHeight(level)
  if (options.railing !== 'none' && options.railingHeight > floorHeight)
    throw Error('The railing must fit within the floor height.')
  const top = balconyElevation(elevation, floorHeight, options)
  if (Math.abs(top - elevation) > 0.0001)
    throw Error('The balcony and railing must fit within this floor.')
  const slab = balconySlab({
    parentId: level.id,
    name: `${name} slab`,
    polygon,
    holes,
    elevation,
    thickness: options.thickness,
    metadata,
  })
  const identity = { id: slab.id, source: 'balcony-tool' }
  const perimeter =
    guardEdges ??
    [polygon, ...holes].flatMap((loop, ring) =>
      loop.flatMap((p, i) =>
        ring === 0 && i === options.openEdge
          ? []
          : [[p, loop[(i + 1) % loop.length]!] as [BalconyPoint, BalconyPoint]],
      ),
    )
  const edges = exposedBalconyEdges(perimeter, walls, level, elevation, nodes)
  slab.metadata = {
    ...metadata,
    balcony: {
      ...identity,
      role: 'deck',
      options,
      ...(options.railing === 'none'
        ? {
            guardBoundaryIndices: [polygon, ...holes]
              .flatMap((loop) =>
                loop.map(
                  (p, i) => [p, loop[(i + 1) % loop.length]!] as [BalconyPoint, BalconyPoint],
                ),
              )
              .flatMap(([a, b], i) =>
                perimeter.some(([c, d]) => (a === c && b === d) || (a === d && b === c)) ? [i] : [],
              ),
          }
        : {}),
    },
  }
  if (options.railing === 'none') return [slab]
  return [
    slab,
    ...edges.map(([start, end]) =>
      balconyGuard({
        parentId: level.id,
        name: `${name} railing`,
        start,
        end,
        supportSlabId: slab.id,
        height: options.railingHeight,
        style: options.railing,
        metadata: { ...metadata, balcony: { ...identity, role: 'guard' } },
      }),
    ),
  ]
}

export function balconyFromWall(
  wall: WallNode,
  level: LevelNode,
  nodes: Record<string, AnyNode>,
  options: BalconyOptions,
  elevationOffset = 0,
) {
  if (wall.parentId !== level.id || wall.metadata.linkedArray || level.metadata.placeholderSource)
    throw Error('Choose a wall on an editable floor; make linked copies real first.')
  const length = getWallCurveLength(wall)
  const segments = wall.curveOffset ? Math.min(128, Math.max(8, Math.ceil(length / 0.25))) : 1
  const front = wall.frontSide === 'exterior' || wall.backSide !== 'exterior'
  const sign = (front ? 1 : -1) * (options.reverse ? -1 : 1)
  const points = Array.from({ length: segments + 1 }, (_, i): BalconyPoint => {
    const frame = getWallCurveFrameAt(wall, i / segments)
    const offset = ((wall.thickness ?? 0.2) / 2 - 0.02) * sign
    return [frame.point.x + frame.normal.x * offset, frame.point.y + frame.normal.y * offset]
  })
  // The small overlap avoids a visible seam at the wall face.
  const footprint = balconyFromEdge(points, Math.min(10, options.depth + 0.02), sign < 0)
  return createBalconyParts({
    level,
    ...footprint,
    walls: Object.values(nodes).filter((n): n is WallNode => n.type === 'wall'),
    nodes,
    options,
    elevation: wallBaseElevationIn(wall, nodes) + elevationOffset,
    metadata: { balconySourceWall: wall.id },
  })
}

import type { AnyNode, WallNode } from '../../schema'
import { getWallArcData, getWallCurveLength } from '../../systems/wall/wall-curve'
import { buildMergedWallAttachmentUpdates } from '../../systems/wall/wall-merge'
import { at, type Point, type StructureMintId, type StructureNodes } from './shared'

export function wallStation(wall: Pick<WallNode, 'start' | 'end'>, point: Point) {
  const dx = wall.end[0] - wall.start[0],
    dz = wall.end[1] - wall.start[1]
  return ((point[0] - wall.start[0]) * dx + (point[1] - wall.start[1]) * dz) / (dx * dx + dz * dz)
}

export function collinearOverlap(a: WallNode, b: WallNode) {
  if (a.curveOffset || b.curveOffset) return false
  const length = Math.hypot(b.end[0] - b.start[0], b.end[1] - b.start[1])
  if (length < 1e-8) return false
  const distance = (p: Point) =>
    Math.abs(
      (p[0] - b.start[0]) * (b.end[1] - b.start[1]) - (p[1] - b.start[1]) * (b.end[0] - b.start[0]),
    ) / length
  const ts = [wallStation(b, a.start), wallStation(b, a.end)]
  return (
    distance(a.start) < 0.1 &&
    distance(a.end) < 0.1 &&
    (Math.min(1, Math.max(...ts)) - Math.max(0, Math.min(...ts))) * length >= 0.1
  )
}

export function wallAttachments(nodes: StructureNodes, wall: WallNode) {
  return Object.values(nodes).filter(
    (node) => node.parentId === wall.id || ('wallId' in node && node.wallId === wall.id),
  )
}

export function wallSlice(
  wall: WallNode,
  start: Point,
  end: Point,
  id: string,
  range?: [number, number],
): WallNode {
  const length = getWallCurveLength(wall)
  const offset = (range?.[0] ?? wallStation(wall, start)) * length
  const sliceLength = range
    ? (range[1] - range[0]) * length
    : Math.hypot(end[0] - start[0], end[1] - start[1])
  const arc = range ? getWallArcData(wall) : null
  // Region stations are metres from the source start, so a trimmed wall needs a new origin.
  const faceRegions = wall.faceRegions?.flatMap((region) => {
    const lo = Math.max(0, (region.u0 ?? 0) - offset)
    const hi = Math.min(sliceLength, (region.u1 ?? length) - offset)
    return hi > lo
      ? [
          {
            ...region,
            ...(region.u0 === undefined && lo === 0 ? {} : { u0: lo }),
            ...(region.u1 === undefined && hi === sliceLength ? {} : { u1: hi }),
          },
        ]
      : []
  })
  return {
    ...wall,
    id: id as WallNode['id'],
    start,
    end,
    children: [],
    ...(arc && range
      ? {
          curveOffset:
            arc.direction *
            arc.radius *
            (1 - Math.cos((Math.abs(arc.delta) * (range[1] - range[0])) / 2)),
        }
      : {}),
    ...(faceRegions ? { faceRegions } : {}),
  }
}

export function rehostWallChild(
  nodes: Record<string, AnyNode>,
  child: AnyNode,
  source: WallNode,
  target: WallNode,
) {
  const host = { ...source, children: [child.id] as WallNode['children'] }
  const empty = { ...source, children: [] }
  const update = buildMergedWallAttachmentUpdates(
    host,
    empty,
    target.id,
    target.start,
    target.end,
    nodes,
  )[0]
  if (update) nodes[child.id] = { ...child, ...update.data } as AnyNode
}

export function remapWallReferences(
  nodes: Record<string, AnyNode>,
  source: WallNode,
  targets: WallNode[],
) {
  for (const zone of Object.values(nodes)) {
    if (zone.type !== 'zone') continue
    const overrides = zone.wallOverrides?.flatMap((entry) =>
      entry.wallId !== source.id
        ? [entry]
        : targets.map((target) => {
            const reversed =
              (source.end[0] - source.start[0]) * (target.end[0] - target.start[0]) +
                (source.end[1] - source.start[1]) * (target.end[1] - target.start[1]) <
              0
            return {
              ...entry,
              wallId: target.id,
              face: reversed ? ((entry.face === 'a' ? 'b' : 'a') as 'a' | 'b') : entry.face,
            }
          }),
    )
    if (
      (zone.boundaryWallIds ?? []).includes(source.id) ||
      zone.wallOverrides?.some((entry) => entry.wallId === source.id)
    )
      nodes[zone.id] = {
        ...zone,
        boundaryWallIds: [
          ...new Set(
            (zone.boundaryWallIds ?? []).flatMap((id) =>
              id === source.id ? targets.map((wall) => wall.id) : [id],
            ),
          ),
        ],
        ...(overrides ? { wallOverrides: overrides } : {}),
      }
  }
}

export function splitCollinearWalls(
  nodes: Record<string, AnyNode>,
  placed: WallNode,
  destination: WallNode,
  mintId: StructureMintId,
) {
  const ts = [wallStation(destination, placed.start), wallStation(destination, placed.end)]
  const lo = Math.max(0, Math.min(...ts)),
    hi = Math.min(1, Math.max(...ts))
  const shared = wallSlice(
    destination,
    at(destination.start, destination.end, lo),
    at(destination.start, destination.end, hi),
    destination.id,
  )
  const targets = [shared]
  const bySource = new Map<WallNode, WallNode[]>()
  for (const source of [destination, placed]) {
    const cut0 = wallStation(source, shared.start),
      cut1 = wallStation(source, shared.end)
    const own = [shared]
    for (const [a, b] of [
      [0, Math.min(cut0, cut1)],
      [Math.max(cut0, cut1), 1],
    ]) {
      if (b! - a! <= 1e-6) continue
      const tail = wallSlice(
        source,
        at(source.start, source.end, a!),
        at(source.start, source.end, b!),
        mintId('wall'),
      )
      own.push(tail)
      targets.push(tail)
    }
    bySource.set(source, own)
  }
  for (const source of [destination, placed]) {
    const own = bySource.get(source)!
    for (const child of wallAttachments(nodes, source)) {
      const t =
        'position' in child && Array.isArray(child.position)
          ? child.position[0] /
            Math.hypot(source.end[0] - source.start[0], source.end[1] - source.start[1])
          : 0.5
      const point = at(source.start, source.end, t)
      const target =
        own.find((wall) => {
          const station = wallStation(wall, point)
          return station >= -1e-6 && station <= 1 + 1e-6
        }) ?? shared
      rehostWallChild(nodes, child, source, target)
    }
    remapWallReferences(nodes, source, own)
  }
  delete nodes[placed.id]
  for (const wall of targets) nodes[wall.id] = wall
  return bySource
}

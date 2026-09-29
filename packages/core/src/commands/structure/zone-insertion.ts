import type { BoundaryNode } from '../../lib/room-topology-index'
import type { AnyNode, AnyNodeId, WallNode } from '../../schema'
import { getWallArcData, getWallCurveLength } from '../../systems/wall/wall-curve'
import { planWallInsertion } from '../../systems/wall/wall-topology'
import { boundaries, type StructureConflict, type StructureMintId } from './shared'
import {
  boundaryPoint,
  boundaryStation,
  clearOpeningCuts,
  dropCrossingCuts,
} from './zone-crossings'
import {
  remapWallReferences,
  splitCollinearWalls,
  wallAttachments,
  wallSlice,
} from './zone-wall-merge'

export function insertDroppedBoundaries(
  nodes: Record<string, AnyNode>,
  moving: Set<string>,
  levelId: string,
  idMap: Record<string, string[]>,
  mintId: StructureMintId,
  force: boolean,
  stationary: Set<string>,
): StructureConflict | undefined {
  const replace = (
    source: BoundaryNode,
    pieces: Array<{ start: [number, number]; end: [number, number]; id: string }>,
  ) => {
    const ordered = pieces.sort(
      (a, b) => boundaryStation(source, a.start) - boundaryStation(source, b.start),
    )
    const ranges = ordered.map(
      (piece) =>
        [boundaryStation(source, piece.start), boundaryStation(source, piece.end)] as const,
    )
    if (source.type === 'wall') {
      const conflict = clearOpeningCuts(nodes, source, ranges.flat(), force)
      if (conflict) return conflict
    }
    const targets = ordered.map((piece, i): BoundaryNode => {
      const id = i === 0 ? source.id : source.type === 'wall' ? piece.id : mintId('separator')
      const [lo, hi] = ranges[i]!
      return source.type === 'wall'
        ? wallSlice(source, piece.start, piece.end, id, [lo, hi])
        : { ...source, id: id as typeof source.id, start: piece.start, end: piece.end }
    })
    const children = source.type === 'wall' ? wallAttachments(nodes, source) : []
    for (const child of children) {
      const position =
        'position' in child && Array.isArray(child.position) ? child.position : undefined
      const length = getWallCurveLength(source as WallNode)
      const t = position ? position[0] / length : 0.5
      const index = Math.max(
        0,
        ranges.findIndex(([lo, hi]) => t >= lo - 1e-6 && t <= hi + 1e-6),
      )
      const host = targets[index]!
      nodes[child.id] = {
        ...child,
        parentId: host.id,
        ...('wallId' in child ? { wallId: host.id } : {}),
        ...(position
          ? { position: [position[0] - ranges[index]![0] * length, position[1], position[2]] }
          : {}),
        ...('wallT' in child
          ? { wallT: (t - ranges[index]![0]) / (ranges[index]![1] - ranges[index]![0]) }
          : {}),
      } as AnyNode
    }
    if (source.type === 'wall') remapWallReferences(nodes, source, targets as WallNode[])
    else
      for (const zone of Object.values(nodes))
        if (zone.type === 'zone' && zone.boundarySeparatorIds.includes(source.id))
          nodes[zone.id] = {
            ...zone,
            boundarySeparatorIds: zone.boundarySeparatorIds.flatMap((id) =>
              id === source.id ? targets.map((node) => node.id) : [id],
            ),
          }
    for (const [key, values] of Object.entries(idMap))
      idMap[key] = [
        ...new Set(
          values.flatMap((id) => (id === source.id ? targets.map((node) => node.id) : [id])),
        ),
      ]
    idMap[source.id] ??= targets.map((node) => node.id)
    delete nodes[source.id]
    for (const target of targets) nodes[target.id] = target
    if (moving.has(source.id)) for (const target of targets) moving.add(target.id)
    if (stationary.has(source.id)) for (const target of targets) stationary.add(target.id)
  }
  const bounds = (wall: BoundaryNode) => {
    const points = [wall.start, wall.end]
    const arc = wall.type === 'wall' ? getWallArcData(wall) : null
    if (arc)
      for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const point: [number, number] = [
          arc.center.x + arc.radius * Math.cos(angle),
          arc.center.y + arc.radius * Math.sin(angle),
        ]
        const t = boundaryStation(wall, point)
        if (t >= 0 && t <= 1) points.push(point)
      }
    return [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ] as const
  }
  const curves = boundaries(nodes, levelId)
    .filter((node) => moving.has(node.id) && node.type === 'wall' && node.curveOffset)
    .map(bounds)
  const queue: string[] = boundaries(nodes, levelId)
    .filter((node) => {
      if (moving.has(node.id)) return true
      const box = bounds(node)
      return curves.some(
        (curve) =>
          box[0] <= curve[2] + 1e-6 &&
          box[2] >= curve[0] - 1e-6 &&
          box[1] <= curve[3] + 1e-6 &&
          box[3] >= curve[1] - 1e-6,
      )
    })
    .map((node) => node.id)
  while (queue.length) {
    const source = nodes[queue.shift()!]
    if (
      !source ||
      (source.type !== 'wall' && source.type !== 'separator') ||
      (source.type === 'wall' && source.curveOffset)
    )
      continue
    const others = boundaries(nodes, levelId).filter(
      (node) => node.id !== source.id && (moving.has(source.id) || moving.has(node.id)),
    )
    // Opening clearance is checked before geometry planning. Virtual boundaries use
    // the same crossing planner; their split pieces are restored as separators.
    const geometry = Object.fromEntries(
      others.map((node) => [node.id, { ...node, type: 'wall', children: [] }]),
    ) as Record<string, AnyNode>
    const inserted = planWallInsertion(geometry, {
      levelId: source.parentId! as AnyNodeId,
      start: source.start,
      end: source.end,
      joinRadius: 1e-7,
      wallDefaults: { ...source, type: 'wall' } as Partial<WallNode>,
      mintId: () => mintId('wall'),
    })
    if (!inserted.ok) continue
    const { plan } = inserted
    if (!plan.changes.delete.length && plan.insertedWalls.length === 1) continue
    const replacements = plan.changes.create
      .map(({ node }) => node as WallNode)
      .filter((node) => !plan.insertedWalls.some((inserted) => inserted.id === node.id))
    for (const id of plan.changes.delete) {
      const original = nodes[id] as BoundaryNode
      const pieces = replacements.filter((piece) =>
        [piece.start, piece.end].every((point) => {
          const t = boundaryStation(original, point),
            onLine = boundaryPoint(original, t)
          return (
            t >= -1e-6 &&
            t <= 1 + 1e-6 &&
            Math.hypot(point[0] - onLine[0], point[1] - onLine[1]) < 1e-5
          )
        }),
      )
      if (!pieces.length) throw Error(`Missing crossing replacements for ${id}`)
      const conflict = replace(original, pieces)
      if (conflict) return conflict
      if (moving.has(id)) queue.push(...(idMap[id] ?? []))
    }
    const conflict = replace(source, plan.insertedWalls)
    if (conflict) return conflict
    if (moving.has(source.id)) queue.push(...(idMap[source.id] ?? []))
  }
  // The insertion primitive draws straight segments. Arc/arc crossings and
  // sub-centimetre remnants still need exact cuts on their original curves.
  for (const [id, cuts] of dropCrossingCuts(nodes, moving, levelId)) {
    const source = nodes[id] as BoundaryNode
    const parameters = [0, ...cuts, 1]
    const conflict = replace(
      source,
      parameters.slice(1).map((hi, i) => ({
        id: mintId('wall'),
        start: boundaryPoint(source, parameters[i]!),
        end: boundaryPoint(source, hi),
      })),
    )
    if (conflict) return conflict
  }
  const samePoint = (a: [number, number], b: [number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6
  const segments = boundaries(nodes, levelId)
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      let a = nodes[segments[i]!.id] as BoundaryNode | undefined
      let b = nodes[segments[j]!.id] as BoundaryNode | undefined
      if (
        !a ||
        !b ||
        (!moving.has(a.id) && !moving.has(b.id)) ||
        (a.type === 'wall' && a.curveOffset) ||
        (b.type === 'wall' && b.curveOffset)
      )
        continue
      if (
        !(
          (samePoint(a.start, b.start) && samePoint(a.end, b.end)) ||
          (samePoint(a.start, b.end) && samePoint(a.end, b.start))
        )
      )
        continue
      if (a.type === 'wall' && b.type === 'wall') {
        if (stationary.has(b.id) && !stationary.has(a.id)) [a, b] = [b, a]
        splitCollinearWalls(nodes, b as WallNode, a as WallNode, mintId)
      } else {
        if (b.type === 'wall' || (a.type === 'separator' && stationary.has(b.id))) [a, b] = [b, a]
        for (const zone of Object.values(nodes))
          if (zone.type === 'zone' && zone.boundarySeparatorIds.includes(b.id))
            nodes[zone.id] = {
              ...zone,
              boundarySeparatorIds: zone.boundarySeparatorIds.flatMap((id) =>
                id === b!.id ? (a!.type === 'separator' ? [a!.id] : []) : [id],
              ),
              boundaryWallIds:
                a.type === 'wall'
                  ? [...new Set([...zone.boundaryWallIds, a.id])]
                  : zone.boundaryWallIds,
            }
        delete nodes[b.id]
      }
      for (const [id, targets] of Object.entries(idMap))
        idMap[id] = [...new Set(targets.map((target) => (target === b!.id ? a!.id : target)))]
      idMap[b.id] ??= [a.id]
      if (moving.has(b.id)) moving.add(a.id)
    }
}

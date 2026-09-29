import { polygonCentroid } from '../../lib/polygon-label'
import { getRoomBaseElevation } from '../../lib/room-floor-feasibility'
import { extractRooms } from '../../lib/room-graph'
import type { AnyNode, WallNode, ZoneNode } from '../../schema'
import { isDerivedNode } from '../../store/derived-node-guard'
import { getWallCurveFrameAt, getWallCurveLength } from '../../systems/wall/wall-curve'
import { planWallDivision } from '../../systems/wall/wall-operations'
import type { CeilingHostAssignment, SupportHostAssignment } from './apply-zone-transform'
import {
  applyToScratch,
  at,
  boundaries,
  conflict,
  diffStructure,
  type Point,
  requireZone,
  roomFace,
  type StructureConflict,
  type StructureNodes,
  type StructurePlan,
} from './shared'
import { validateMezzanine } from './validate-mezzanine'
import { clearOpeningCuts, dropCrossingCuts } from './zone-crossings'
import { preserveDroppedRoomSeeds, snapDroppedWalls } from './zone-drop'
import { insertDroppedBoundaries } from './zone-insertion'
import {
  collectTransformContents,
  includeDescendants,
  repairTransformChildren,
} from './zone-transform-content'
import {
  collinearOverlap,
  splitCollinearWalls,
  wallAttachments,
  wallSlice,
} from './zone-wall-merge'

export type TransformZoneInput = {
  zoneId: string
  translate?: Point
  /** Radians about Y; rotation precedes translation. Defaults to the room's area centroid. */
  rotate?: { angle: number; pivot?: Point }
  force?: boolean
  mintId: (kind: AnyNode['type']) => string
}
export type ZoneTransformPlan = StructurePlan & {
  zoneId: string
  idMap: Record<string, string[]>
  ceilingHosts?: CeilingHostAssignment[]
  supportHosts?: SupportHostAssignment[]
}

export function transformZone(nodes: StructureNodes, input: TransformZoneInput): ZoneTransformPlan {
  return planZoneTransform(nodes, input, false)
}

export function planZoneTransform(
  nodes: StructureNodes,
  input: TransformZoneInput,
  duplicate: boolean,
): ZoneTransformPlan {
  const zone = requireZone(nodes, input.zoneId)
  const mezzanine = zone.floor?.support === 'open'
  const face = mezzanine
    ? { id: zone.id, referencePolygon: zone.polygon, holes: zone.holes, spans: [] }
    : roomFace(nodes, zone)
  const idMap: Record<string, string[]> = {}
  const failed = (code: string, ids: string[], message: string): ZoneTransformPlan => ({
    ...conflict(code, ids, message),
    zoneId: zone.id,
    idMap: {},
  })
  if (!face)
    return failed('open-room', [zone.id], 'The room needs an enclosed boundary before it can move.')
  const angle = input.rotate?.angle ?? 0,
    translate = input.translate ?? [0, 0]
  const pivot =
    input.rotate?.pivot ?? polygonCentroid({ outer: face.referencePolygon, holes: face.holes })
  if (![angle, ...translate, ...pivot].every(Number.isFinite))
    throw Error('Room transforms must be finite.')
  if (!duplicate && angle === 0 && translate.every((v) => v === 0))
    return { changes: [], zoneId: zone.id, idMap: { [zone.id]: [zone.id] } }
  const exact = (value: number) => (Math.abs(value) < 1e-12 ? 0 : value)
  const cosine = exact(Math.cos(angle)),
    sine = exact(Math.sin(angle))
  const transform = ([x, z]: Point): Point => [
    pivot[0] + cosine * (x - pivot[0]) + sine * (z - pivot[1]) + translate[0] + 0,
    pivot[1] - sine * (x - pivot[0]) + cosine * (z - pivot[1]) + translate[1] + 0,
  ]
  if (mezzanine) {
    const invalid = validateMezzanine(
      nodes,
      {
        ...zone,
        polygon: zone.polygon.map(transform),
        holes: zone.holes.map((hole) => hole.map(transform)),
      },
      duplicate ? undefined : zone.id,
    )
    if (invalid) return { changes: [], conflicts: [invalid], zoneId: zone.id, idMap: {} }
  }
  const allocated = new Set(Object.keys(nodes))
  const mintId = (kind: AnyNode['type']) => {
    const minted = input.mintId(kind)
    const id = kind === 'stair-segment' ? minted.replace(/^stair-segment_/, 'sseg_') : minted
    if (!id.startsWith(`${kind === 'stair-segment' ? 'sseg' : kind}_`) || allocated.has(id))
      throw Error(`Invalid or reused ${kind} id: ${id}`)
    allocated.add(id)
    return id
  }
  let scratch: Record<string, AnyNode> = { ...nodes }
  const ceilingHosts: CeilingHostAssignment[] = []
  const supportHosts: SupportHostAssignment[] = []
  const moving = new Set<string>()
  const plain = new Set<string>()
  const sourceFor = new Map<string, string>()
  const allFaces = extractRooms(boundaries(nodes, zone.parentId!))
  const boundaryIds = [...new Set(face.spans.map((span) => span.boundaryId))]
  const materialCopies = new Set<string>()
  for (const boundaryId of boundaryIds) {
    const original = nodes[boundaryId]
    if (!original || (original.type !== 'wall' && original.type !== 'separator')) continue
    const spans = face.spans.filter((span) => span.boundaryId === boundaryId)
    const opposite = allFaces
      .filter((other) => other.id !== face.id)
      .flatMap((other) => other.spans)
      .filter(
        (span) => span.boundaryId === boundaryId && spans.some((own) => own.face !== span.face),
      )
    const cuts = [
      ...new Set([
        0,
        1,
        ...spans.flatMap((span) => [span.t0, span.t1]),
        ...opposite.flatMap((span) => [span.t0, span.t1]),
      ]),
    ].sort((a, b) => a - b)
    const ranges: Array<{ lo: number; hi: number; shared: boolean }> = []
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1]!,
        hi = cuts[i]!,
        mid = (lo + hi) / 2
      if (hi - lo < 1e-6 || !spans.some((span) => mid >= span.t0 && mid <= span.t1)) continue
      const shared = opposite.some((span) => mid >= span.t0 && mid <= span.t1)
      const previous = ranges.at(-1)
      if (previous && previous.shared === shared && Math.abs(previous.hi - lo) < 1e-6)
        previous.hi = hi
      else ranges.push({ lo, hi, shared })
    }
    const segments = [{ lo: 0, hi: 1, id: original.id as string }]
    const needsDivision =
      !duplicate &&
      ranges.some((range) => !range.shared) &&
      (ranges.length > 1 || ranges[0]!.lo > 1e-6 || ranges[0]!.hi < 1 - 1e-6)
    if (needsDivision) {
      const splits = [...new Set(ranges.flatMap((range) => [range.lo, range.hi]))]
        .filter((t) => t > 1e-6 && t < 1 - 1e-6)
        .sort((a, b) => b - a)
      if (original.type === 'wall') {
        const blocked = clearOpeningCuts(scratch, original, splits, input.force ?? false)
        if (blocked) return { changes: [], conflicts: [blocked], idMap: {}, zoneId: zone.id }
      }
      try {
        for (const t of splits) {
          const first = segments[0]!,
            current = scratch[first.id] as typeof original
          let id: string
          if (current.type === 'wall') {
            const division = planWallDivision(
              scratch,
              current.id,
              t * getWallCurveLength(original as WallNode),
              () => mintId('wall'),
            )
            scratch = applyToScratch(scratch, division.changes)
            id = division.changes.create[0]!.node.id
          } else {
            id = mintId('separator')
            const point = at(original.start, original.end, t)
            scratch[id] = { ...current, id: id as typeof current.id, start: point }
            scratch[current.id] = { ...current, end: point }
          }
          segments.push({ lo: t, hi: first.hi, id })
          first.hi = t
        }
      } catch (error) {
        return failed('occupied-split', [boundaryId], String(error))
      }
    }
    idMap[boundaryId] = []
    for (const { lo, hi, shared } of ranges) {
      let boundary = scratch[
        segments.find((segment) => (lo + hi) / 2 >= segment.lo && (lo + hi) / 2 <= segment.hi)!.id
      ] as typeof original
      if (duplicate || shared) {
        const id = mintId(original.type)
        const point = (t: number): Point => {
          if (original.type === 'separator') return at(original.start, original.end, t)
          const frame = getWallCurveFrameAt(original, t)
          return [frame.point.x, frame.point.y]
        }
        boundary =
          original.type === 'wall'
            ? wallSlice(original, point(lo), point(hi), id, [lo, hi])
            : { ...original, id: id as typeof original.id, start: point(lo), end: point(hi) }
        scratch[id] = boundary
        sourceFor.set(id, original.id)
        if (shared) {
          plain.add(id)
          materialCopies.add(id)
        } else if (original.type === 'wall') {
          const length = getWallCurveLength(original)
          for (const child of wallAttachments(nodes, original)) {
            const t =
              'position' in child && Array.isArray(child.position)
                ? child.position[0] / length
                : 0.5
            if (t < lo - 1e-6 || t > hi + 1e-6) continue
            const childId = mintId(child.type)
            scratch[childId] = {
              ...child,
              id: childId,
              parentId: id,
              wallId: id,
              ...('position' in child && Array.isArray(child.position)
                ? {
                    position: [
                      child.position[0] - lo * length,
                      child.position[1],
                      child.position[2],
                    ],
                  }
                : {}),
              ...('wallT' in child ? { wallT: (t - lo) / (hi - lo) } : {}),
            } as AnyNode
            sourceFor.set(childId, child.id)
            idMap[child.id] = [childId]
            moving.add(childId)
          }
        }
      }
      moving.add(boundary.id)
      idMap[boundaryId]!.push(boundary.id)
    }
  }
  const contents = collectTransformContents(nodes, zone)
  if (duplicate) {
    // Copy descendants from the source graph before remapping parents, including nested wall items.
    const sources = new Set([
      ...contents,
      ...[...sourceFor].filter(([id]) => !plain.has(id)).map(([, source]) => source),
    ])
    for (const id of boundaryIds) sources.delete(id)
    includeDescendants(nodes, sources)
    for (const id of sources) {
      if (idMap[id]) continue
      const node = nodes[id]!
      const copyId = mintId(node.type)
      scratch[copyId] = { ...node, id: copyId } as AnyNode
      moving.add(copyId)
      sourceFor.set(copyId, id)
      idMap[id] = [copyId]
    }
  } else {
    for (const id of contents) moving.add(id)
    includeDescendants(scratch, moving)
  }
  const resultZoneId = duplicate ? mintId('zone') : zone.id
  idMap[zone.id] = [resultZoneId]
  scratch[resultZoneId] = {
    ...zone,
    id: resultZoneId as ZoneNode['id'],
    ...(duplicate ? { name: nextRoomName(nodes, zone.name) } : {}),
  }
  moving.add(resultZoneId)
  sourceFor.set(resultZoneId, zone.id)
  for (const id of moving) {
    const node = scratch[id]!
    let next = { ...node } as AnyNode
    const sourceId = sourceFor.get(id) ?? id
    const source = nodes[sourceId] ?? node
    if (duplicate && source.parentId && idMap[source.parentId])
      next.parentId = idMap[source.parentId]![0] as AnyNode['parentId']
    for (const key of ['supportSlabId', 'deckSlabId', 'wallId', 'hostZoneId'] as const) {
      const ref = (source as unknown as Record<string, unknown>)[key]
      if (typeof ref !== 'string') continue
      if (duplicate && idMap[ref]) Object.assign(next, { [key]: idMap[ref]![0] })
      else if (duplicate && nodes[ref] && isDerivedNode(nodes[ref]!)) {
        const slab = nodes[ref]
        if (slab?.type === 'slab' && (key === 'supportSlabId' || key === 'deckSlabId')) {
          const copiedZone = slab.zoneIds?.map((id) => idMap[id]?.[0]).find(Boolean)
          if (copiedZone) supportHosts.push({ nodeId: next.id, zoneId: copiedZone, field: key })
        }
        Object.assign(next, { [key]: undefined })
      }
    }
    if (duplicate && next.type === 'floor-opening' && next.ownerId) {
      const copiedOwner = idMap[next.ownerId]?.[0]
      next.ownerId = copiedOwner
      if (!copiedOwner && next.source === 'plugin:pool') next.source = 'manual'
    }
    if (duplicate && 'collectionIds' in next) next.collectionIds = []
    const parent = next.parentId ? scratch[next.parentId] : undefined
    const inheritedPose =
      parent && moving.has(parent.id) && ('position' in parent || parent.type === 'wall')
    if (next.type === 'wall' || next.type === 'separator')
      next = { ...next, start: transform(next.start), end: transform(next.end) }
    if ('polygon' in next && Array.isArray(next.polygon)) {
      next = {
        ...next,
        polygon: next.polygon.map(transform),
        ...('holes' in next && Array.isArray(next.holes)
          ? { holes: next.holes.map((hole) => hole.map(transform)) }
          : {}),
      } as AnyNode
    }
    if ('position' in next && Array.isArray(next.position) && !inheritedPose) {
      const point = transform([next.position[0], next.position[2]])
      let y = next.position[1]
      if (duplicate && parent && isDerivedNode(parent)) {
        if (parent.type === 'ceiling') {
          ceilingHosts.push({
            nodeId: next.id,
            zoneId: idMap[parent.zoneId ?? '']?.[0] ?? resultZoneId,
            offsetY: y,
          })
          y += parent.height ?? 2.7
        }
        next.parentId = zone.parentId
      }
      next = {
        ...next,
        position: [point[0], y + 0, point[1]],
        ...('rotation' in next
          ? {
              rotation: Array.isArray(next.rotation)
                ? [next.rotation[0] + 0, next.rotation[1] + angle + 0, next.rotation[2] + 0]
                : typeof next.rotation === 'number'
                  ? next.rotation + angle + 0
                  : next.rotation,
            }
          : {}),
      } as AnyNode
    }
    if (next.type === 'zone')
      next = {
        ...next,
        ...(next.floor?.support === 'open' && !mezzanine ? { hostZoneId: resultZoneId } : {}),
        seed: transform(
          next.seed ??
            polygonCentroid({
              outer: node.type === 'zone' ? node.polygon : zone.polygon,
              holes: [],
            }),
        ),
        boundaryWallIds: (next.boundaryWallIds ?? []).flatMap(
          (id) => idMap[id] ?? [id],
        ) as WallNode['id'][],
        boundarySeparatorIds: (next.boundarySeparatorIds ?? []).flatMap((id) => idMap[id] ?? [id]),
        ...(next.wallOverrides
          ? {
              wallOverrides: next.wallOverrides.flatMap((entry) =>
                (idMap[entry.wallId] ?? [entry.wallId]).map((wallId) => ({ ...entry, wallId })),
              ),
            }
          : {}),
        // A copied door carries its step paint to the copy.
        ...(next.floorStepOverrides
          ? {
              floorStepOverrides: next.floorStepOverrides.map((entry) => ({
                ...entry,
                key: idMap[entry.key]?.[0] ?? entry.key,
              })),
            }
          : {}),
        ...(next.floor
          ? {
              floor: {
                ...next.floor,
                ...(duplicate && next.floor.footprint
                  ? { elevation: next.floor.elevation ?? getRoomBaseElevation(nodes, sourceId) }
                  : {}),
                ...(duplicate && next.floor.sourceSlabId
                  ? {
                      sourceSlabId: idMap[next.floor.sourceSlabId]?.[0] as
                        | `slab_${string}`
                        | undefined,
                    }
                  : {}),
                ...(next.floor.regions
                  ? {
                      regions: next.floor.regions.map((region) => ({
                        ...region,
                        polygon: region.polygon.map(transform),
                      })),
                    }
                  : {}),
              },
            }
          : {}),
        ...(next.ceiling?.regions
          ? {
              ceiling: {
                ...next.ceiling,
                regions: next.ceiling.regions.map((region) => ({
                  ...region,
                  polygon: region.polygon.map(transform),
                })),
              },
            }
          : {}),
      }
    scratch[id] = next
    idMap[sourceId] ??= [id]
  }
  if (mezzanine) {
    repairTransformChildren(scratch, nodes)
    return {
      changes: diffStructure(nodes, scratch),
      zoneId: resultZoneId,
      idMap,
      ceilingHosts,
      supportHosts,
    }
  }
  const stationary = new Set(
    boundaries(scratch, zone.parentId!)
      .filter((node) => !moving.has(node.id))
      .map((node) => node.id),
  )
  snapDroppedWalls(scratch, moving, zone.parentId!)
  const preserveFinish = (wallId: string) => {
    const current = scratch[resultZoneId] as ZoneNode
    const wall = scratch[wallId]
    if (wall?.type !== 'wall' || current.wallMaterial) return
    const overrides = [...(current.wallOverrides ?? [])]
    for (const span of face.spans) {
      if (!idMap[span.boundaryId]?.includes(wallId)) continue
      const finish = wall.slots?.[span.face]
      if (finish && !overrides.some((entry) => entry.wallId === wallId && entry.face === span.face))
        overrides.push({ wallId, face: span.face, finish })
    }
    if (overrides.length !== (current.wallOverrides?.length ?? 0))
      scratch[resultZoneId] = { ...current, wallOverrides: overrides }
  }
  for (const wallId of materialCopies) preserveFinish(wallId)
  const conflicts: StructureConflict[] = []
  if (!duplicate) {
    const plates = new Set(
      Object.values(nodes)
        .filter(
          (node) =>
            node.type === 'slab' &&
            node.parentId === zone.parentId &&
            (node.zoneIds?.some((id) => moving.has(id)) || moving.has(node.id)),
        )
        .map((node) => node.id),
    )
    for (const node of Object.values(nodes))
      if (
        node.type === 'stair' &&
        node.parentId !== zone.parentId &&
        node.deckSlabId &&
        plates.has(node.deckSlabId as never)
      )
        conflicts.push({
          code: 'deck-reference',
          nodeIds: [node.id, node.deckSlabId],
          message: 'A stair on another level uses the moving room’s floor as its destination deck.',
        })
  }
  if (conflicts.length && !input.force)
    return { changes: [], conflicts, idMap: {}, zoneId: resultZoneId }
  for (const [id, cuts] of dropCrossingCuts(scratch, moving, zone.parentId!)) {
    const wall = scratch[id]
    if (wall?.type !== 'wall') continue
    const blocked = clearOpeningCuts(scratch, wall, cuts, input.force ?? false)
    if (blocked) return { changes: [], conflicts: [blocked], idMap: {}, zoneId: resultZoneId }
  }
  const queue = [...moving].filter((id) => scratch[id]?.type === 'wall')
  while (queue.length) {
    const id = queue.shift()!,
      placed = scratch[id]
    if (placed?.type !== 'wall') continue
    const destination = Object.values(scratch).find(
      (node): node is WallNode =>
        node.type === 'wall' &&
        node.parentId === zone.parentId &&
        !moving.has(node.id) &&
        collinearOverlap(placed, node),
    )
    if (!destination) continue
    preserveFinish(placed.id)
    const split = splitCollinearWalls(scratch, placed, destination, mintId)
    const replacements = split.get(placed)!
    moving.add(destination.id)
    for (const [sourceWall, targets] of split) {
      if (stationary.has(sourceWall.id)) for (const target of targets) stationary.add(target.id)
      for (const [sourceId, ids] of Object.entries(idMap))
        idMap[sourceId] = [
          ...new Set(
            ids.flatMap((old) => (old === sourceWall.id ? targets.map((wall) => wall.id) : [old])),
          ),
        ]
      idMap[sourceWall.id] ??= targets.map((wall) => wall.id)
    }
    for (const tail of replacements.slice(1)) {
      moving.add(tail.id)
      queue.push(tail.id)
    }
  }
  const blocked = insertDroppedBoundaries(
    scratch,
    moving,
    zone.parentId!,
    idMap,
    mintId,
    input.force ?? false,
    stationary,
  )
  if (blocked) return { changes: [], conflicts: [blocked], idMap: {}, zoneId: resultZoneId }
  preserveDroppedRoomSeeds(scratch, resultZoneId)
  repairTransformChildren(scratch, nodes)
  return {
    changes: diffStructure(nodes, scratch),
    ...(conflicts.length ? { conflicts } : {}),
    idMap,
    zoneId: resultZoneId,
    ...(ceilingHosts.length ? { ceilingHosts } : {}),
    ...(supportHosts.length ? { supportHosts } : {}),
  }
}

function nextRoomName(nodes: StructureNodes, name: string) {
  const base = name.replace(/ \d+$/, '') || 'Room'
  const used = new Set(
    Object.values(nodes)
      .filter((node) => node.type === 'zone')
      .map((node) => node.name),
  )
  let number = 2
  while (used.has(`${base} ${number}`)) number++
  return `${base} ${number}`
}

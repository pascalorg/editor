import { area, containsPoint, intersection } from '../../lib/polygon-boolean'
import { type ExtractedRoom, extractRooms } from '../../lib/room-graph'
import type { AnyNode, ZoneNode } from '../../schema'
import { isDerivedNode } from '../../store/derived-node-guard'
import { getWallCurveFrameAt, getWallCurveLength } from '../../systems/wall/wall-curve'
import {
  containedMezzanines,
  electedIntentPlate,
  isFloorPlacedIntent,
  type PositionedIntent,
} from './mezzanine-content'
import {
  applyToScratch,
  boundaries,
  diffStructure,
  pointInRoom,
  requireZone,
  roomFace,
  type StructureNodes,
  type StructurePlan,
  sharedSpan,
  structureChangeBatch,
} from './shared'

export type DeleteZonePayload = {
  zoneId: string
  name: string
  contents: 'delete' | 'keep'
  /**
   * `delete`: the room goes with the walls, separators and openings only it
   * uses. `merge`: an area Divide made (a separator on its outline) goes back
   * into the room across those separators; walls and items stay. `blocked`:
   * every boundary is a wall another room shares — nothing of its own to
   * remove, so deleting one of those walls is the way (a conflict, no changes).
   */
  mode: 'delete' | 'merge' | 'blocked'
  /** `merge`: the room the area goes back into. */
  mergedIntoZoneId?: string
  opensZoneIds: string[]
  keptSharedSeparatorIds: string[]
  wallIds: string[]
  keptSharedWallIds: string[]
  separatorIds: string[]
  openingIds: string[]
  itemIds: string[]
}

function levelPose(nodes: StructureNodes, item: PositionedIntent, levelId: string) {
  let position = [...item.position] as [number, number, number]
  let yaw = Array.isArray(item.rotation) ? item.rotation[1] : item.rotation
  let parent = item.parentId ? nodes[item.parentId] : undefined
  const visited = new Set<string>()
  while (parent && parent.id !== levelId && !visited.has(parent.id)) {
    visited.add(parent.id)
    if (parent.type === 'wall') {
      const frame = getWallCurveFrameAt(parent, position[0] / getWallCurveLength(parent))
      position = [
        frame.point.x + frame.normal.x * position[2],
        position[1],
        frame.point.y + frame.normal.y * position[2],
      ]
      yaw -= Math.atan2(frame.tangent.y, frame.tangent.x)
    } else if (parent.type === 'ceiling') position[1] += parent.height ?? 2.7
    else if ('position' in parent && Array.isArray(parent.position)) {
      const rotation =
        'rotation' in parent && Array.isArray(parent.rotation) ? (parent.rotation[1] as number) : 0
      const c = Math.cos(rotation),
        s = Math.sin(rotation)
      position = [
        parent.position[0] + c * position[0] + s * position[2],
        parent.position[1] + position[1],
        parent.position[2] - s * position[0] + c * position[2],
      ]
      yaw += rotation
    }
    parent = parent.parentId ? nodes[parent.parentId] : undefined
  }
  return parent?.id === levelId
    ? {
        position,
        rotation: Array.isArray(item.rotation)
          ? ([item.rotation[0], yaw, item.rotation[2]] as [number, number, number])
          : yaw,
      }
    : null
}

export const SHARED_WALLS_DELETE_MESSAGE = 'To remove this room, delete one of its walls.'

type ZoneInput = { zoneId: string; contents: 'delete' | 'keep' }
type DeleteZonePlan = StructurePlan & { payload: DeleteZonePayload }

/**
 * Deletes a room the way its boundaries allow:
 * - an area Divide made (a separator shared with a room on its outline) merges
 *   back into that room — the one sharing the most separator length — by
 *   removing those separators; its intent (name, finishes, regions) goes, its
 *   walls and items stay, and mezzanines it hosts move to the merged room;
 * - a room whose every boundary is a wall shared with other rooms is refused
 *   (`shared-walls`): only deleting one of those walls can remove it;
 * - otherwise the room goes with the walls, separators and openings only it
 *   uses, and its items per `contents`.
 */
export function deleteZone(sourceNodes: StructureNodes, input: ZoneInput): DeleteZonePlan {
  const zone = requireZone(sourceNodes, input.zoneId)
  const faces = extractRooms(boundaries(sourceNodes, zone.parentId!))
  const target = mergeTarget(sourceNodes, zone, faces)
  if (target) return mergeBack(sourceNodes, zone, target, input.contents)
  const plan = planZoneRemoval(sourceNodes, input)
  const spans = roomFace(sourceNodes, zone, faces)?.spans ?? []
  if (!spans.length || !spans.every((span) => sharedSpan(sourceNodes, zone, span))) return plan
  return {
    changes: [],
    conflicts: [
      {
        code: 'shared-walls',
        nodeIds: [zone.id, ...plan.payload.keptSharedWallIds],
        message: SHARED_WALLS_DELETE_MESSAGE,
      },
    ],
    payload: {
      ...plan.payload,
      mode: 'blocked',
      opensZoneIds: [],
      wallIds: [],
      separatorIds: [],
      openingIds: [],
      itemIds: [],
    },
  }
}

type MergeTarget = { zone: ZoneNode; separatorIds: string[] }

/**
 * The room an area Divide made goes back into: a room across a separator on
 * the area's outline (never an island inside one of its holes), preferring the
 * one sharing the most separator length, whose separators can go without
 * changing any other room.
 */
function mergeTarget(
  nodes: StructureNodes,
  zone: ZoneNode,
  faces: ExtractedRoom[],
): MergeTarget | null {
  const face = roomFace(nodes, zone, faces)
  const separatorSpans = face?.spans.filter((span) => span.kind === 'separator') ?? []
  if (!(face && separatorSpans.length)) return null
  const insideHole = (point: [number, number]) =>
    face.holes.some((hole) => containsPoint([{ outer: hole, holes: [] }], point))
  const candidates = Object.values(nodes).flatMap((other) => {
    if (
      other.type !== 'zone' ||
      other.id === zone.id ||
      other.parentId !== zone.parentId ||
      other.spaceRole !== 'room' ||
      other.floor?.support === 'open' ||
      (other.seed && insideHole(other.seed))
    )
      return []
    const otherSpans = roomFace(nodes, other, faces)?.spans ?? []
    let length = 0
    const separatorIds = new Set<string>()
    for (const span of separatorSpans)
      for (const facing of otherSpans) {
        if (facing.boundaryId !== span.boundaryId || facing.face === span.face) continue
        const overlap = Math.min(facing.t1, span.t1) - Math.max(facing.t0, span.t0)
        const boundary = nodes[span.boundaryId]
        if (overlap <= 1e-6 || boundary?.type !== 'separator') continue
        separatorIds.add(boundary.id)
        length +=
          overlap *
          Math.hypot(boundary.end[0] - boundary.start[0], boundary.end[1] - boundary.start[1])
      }
    return separatorIds.size ? [{ zone: other, separatorIds: [...separatorIds], length }] : []
  })
  candidates.sort((a, b) => b.length - a.length || a.zone.id.localeCompare(b.zone.id))
  const before = boundaries(nodes, zone.parentId!)
  for (const candidate of candidates) {
    const removed = new Set(candidate.separatorIds)
    const after = extractRooms(before.filter((node) => !removed.has(node.id)))
    if (after.length === faces.length - 1) return candidate
  }
  return null
}

function mergeBack(
  nodes: StructureNodes,
  zone: ZoneNode,
  target: MergeTarget,
  contents: 'delete' | 'keep',
): DeleteZonePlan {
  const levelId = zone.parentId!
  const ceilings = new Set<string>(
    Object.values(nodes)
      .filter((n) => n.type === 'ceiling' && n.zoneId === zone.id)
      .map((n) => n.id),
  )
  const items = Object.values(nodes).flatMap((n) => {
    if (n.type !== 'item' && !isFloorPlacedIntent(n)) return []
    const pose = levelPose(nodes, n, levelId)
    return pose && pointInRoom(zone, [pose.position[0], pose.position[2]])
      ? [{ node: n, pose }]
      : []
  })
  const scratch: Record<string, AnyNode> = { ...nodes }
  delete scratch[zone.id]
  for (const id of target.separatorIds) delete scratch[id]
  for (const { node, pose } of items) {
    const support = node.supportSlabId ? nodes[node.supportSlabId] : undefined
    // Its own floor goes with the area; the merged room's floor carries it.
    const ownFloor = support?.type === 'slab' && !!support.zoneIds?.includes(zone.id)
    // Its ceiling goes too; what hangs from it stays where it is, on the level.
    const hung = !!node.parentId && ceilings.has(node.parentId)
    if (hung)
      scratch[node.id] = {
        ...node,
        ...pose,
        parentId: levelId,
        wallId: undefined,
        wallT: undefined,
        supportSlabId: undefined,
      } as AnyNode
    else if (ownFloor) scratch[node.id] = { ...node, supportSlabId: undefined } as AnyNode
  }
  for (const node of Object.values(scratch)) {
    if (node.type === 'zone' && node.hostZoneId === zone.id)
      scratch[node.id] = { ...node, hostZoneId: target.zone.id }
    if (node.type === 'floor-opening' && node.hostZoneId === zone.id)
      scratch[node.id] = { ...node, hostZoneId: target.zone.id }
    if (node.type === 'unit' && node.members.includes(zone.id))
      scratch[node.id] = { ...node, members: node.members.filter((id) => id !== zone.id) }
  }
  return {
    changes: diffStructure(nodes, pruneDeleted(nodes, scratch)),
    payload: {
      zoneId: zone.id,
      name: zone.name,
      contents,
      mode: 'merge',
      mergedIntoZoneId: target.zone.id,
      opensZoneIds: [],
      keptSharedSeparatorIds: [],
      wallIds: [],
      keptSharedWallIds: [],
      separatorIds: target.separatorIds,
      openingIds: [],
      itemIds: items.map(({ node }) => node.id),
    },
  }
}

/** Removes what hangs from deleted nodes and drops deleted ids from `children`. */
function pruneDeleted(nodes: StructureNodes, scratch: Record<string, AnyNode>) {
  const deleted = new Set(Object.keys(nodes).filter((id) => !scratch[id]))
  let changed = true
  while (changed) {
    changed = false
    for (const node of Object.values(scratch))
      if (node.parentId && deleted.has(node.parentId)) {
        delete scratch[node.id]
        deleted.add(node.id)
        changed = true
      }
  }
  for (const node of Object.values(scratch))
    if (
      !isDerivedNode(node) &&
      'children' in node &&
      Array.isArray(node.children) &&
      node.children.some((id) => deleted.has(id))
    )
      scratch[node.id] = {
        ...node,
        children: node.children.filter((id) => !deleted.has(id)),
      } as AnyNode
  return scratch
}

/**
 * The room removed with the walls, separators and openings only it uses (and
 * its items per `contents`), whatever its neighbours. Wall deletion uses this
 * directly for the rooms it takes down.
 */
export function planZoneRemoval(sourceNodes: StructureNodes, input: ZoneInput): DeleteZonePlan {
  const zone = requireZone(sourceNodes, input.zoneId)
  let nodes = sourceNodes
  const stackedItems: string[] = []
  for (const stacked of containedMezzanines(sourceNodes, zone)) {
    const plan = planZoneRemoval(nodes, { zoneId: stacked.id, contents: input.contents })
    nodes = applyToScratch(nodes, structureChangeBatch(plan.changes))
    stackedItems.push(...plan.payload.itemIds)
  }
  const spans = roomFace(nodes, zone)?.spans ?? []
  const wallIds = [...new Set(spans.filter((s) => s.kind === 'wall').map((s) => s.boundaryId))]
  const shared = spans.filter((span) => sharedSpan(nodes, zone, span))
  const keptSharedWallIds = [
    ...new Set(shared.filter((s) => s.kind === 'wall').map((s) => s.boundaryId)),
  ]
  const keptSharedSeparatorIds = [
    ...new Set(shared.filter((s) => s.kind === 'separator').map((s) => s.boundaryId)),
  ]
  const removedWalls = wallIds.filter((id) => !keptSharedWallIds.includes(id))
  const separatorIds = [
    ...new Set(
      spans
        .filter((s) => s.kind === 'separator' && !keptSharedSeparatorIds.includes(s.boundaryId))
        .map((s) => s.boundaryId),
    ),
  ]
  const openingIds = Object.values(nodes)
    .filter(
      (n) =>
        (n.type === 'door' || n.type === 'window') &&
        (removedWalls.includes(n.parentId ?? '') ||
          ('wallId' in n && removedWalls.includes(n.wallId as string))),
    )
    .map((n) => n.id)
  const floorOpeningIds = Object.values(nodes)
    .filter(
      (node) =>
        node.type === 'floor-opening' &&
        (node.hostZoneId === zone.id ||
          (!node.hostZoneId &&
            node.parentId === zone.parentId &&
            node.polygon.every((point) => pointInRoom(zone, point)))),
    )
    .map((node) => node.id)
  const items = Object.values(nodes).flatMap((n) => {
    if (n.type !== 'item' && !isFloorPlacedIntent(n)) return []
    const pose = levelPose(nodes, n, zone.parentId!)
    if (zone.floor?.support === 'open') {
      const parent = n.parentId ? nodes[n.parentId] : undefined
      const host =
        parent?.type === 'level' && isFloorPlacedIntent(n)
          ? electedIntentPlate(nodes, n)
          : undefined
      if (
        !(parent?.type === 'ceiling' && parent.zoneId === zone.id) &&
        !(host?.type === 'slab' && host.zoneIds?.includes(zone.id))
      )
        return []
      return pose ? [{ node: n, pose }] : []
    }
    return pose &&
      (pointInRoom(zone, [pose.position[0], pose.position[2]]) ||
        removedWalls.includes(n.parentId ?? ''))
      ? [{ node: n, pose }]
      : []
  })
  const payload: DeleteZonePayload = {
    zoneId: zone.id,
    mode: 'delete',
    opensZoneIds: [],
    keptSharedSeparatorIds,
    name: zone.name,
    contents: input.contents,
    wallIds: removedWalls,
    keptSharedWallIds,
    separatorIds,
    openingIds: [...openingIds, ...floorOpeningIds],
    itemIds: [...new Set([...stackedItems, ...items.map(({ node }) => node.id)])],
  }
  const scratch: Record<string, AnyNode> = { ...nodes }
  for (const id of [
    zone.id,
    ...removedWalls,
    ...separatorIds,
    ...openingIds,
    ...floorOpeningIds,
    ...(input.contents === 'delete' ? payload.itemIds : []),
  ])
    delete scratch[id]
  const removedHosts = new Set([
    ...removedWalls,
    ...Object.values(nodes)
      .filter((n) => n.type === 'ceiling' && n.zoneId === zone.id)
      .map((n) => n.id),
  ])
  if (input.contents === 'keep')
    for (const { node, pose } of items) {
      if (
        zone.floor?.support === 'open' &&
        node.supportSlabId &&
        nodes[node.supportSlabId]?.type === 'slab' &&
        (nodes[node.supportSlabId] as import('../../schema').SlabNode).zoneIds?.includes(zone.id)
      )
        scratch[node.id] = { ...node, supportSlabId: undefined } as AnyNode
      if (!node.parentId || !removedHosts.has(node.parentId)) continue
      scratch[node.id] = {
        ...node,
        ...pose,
        parentId: zone.parentId,
        wallId: undefined,
        wallT: undefined,
        supportSlabId: undefined,
      } as AnyNode
    }
  for (const node of Object.values(scratch))
    if (node.type === 'unit' && node.members.includes(zone.id))
      scratch[node.id] = { ...node, members: node.members.filter((id) => id !== zone.id) }
  pruneDeleted(nodes, scratch)
  const beforeFaces = extractRooms(boundaries(nodes, zone.parentId!))
  const afterFaces = extractRooms(boundaries(scratch, zone.parentId!))
  payload.opensZoneIds = Object.values(nodes).flatMap((other) => {
    if (
      other.type !== 'zone' ||
      other.spaceRole !== 'room' ||
      other.id === zone.id ||
      other.parentId !== zone.parentId
    )
      return []
    const before = roomFace(nodes, other, beforeFaces)
    if (!before) return []
    const footprint = { outer: before.referencePolygon, holes: before.holes }
    const size = area([footprint])
    const preserved = afterFaces.some((face) => {
      const candidate = { outer: face.referencePolygon, holes: face.holes }
      const overlap = area(intersection(footprint, candidate))
      return overlap / Math.max(size + area([candidate]) - overlap, 1e-9) > 0.99999
    })
    return preserved ? [] : [other.id]
  })
  return { changes: diffStructure(sourceNodes, scratch), payload }
}

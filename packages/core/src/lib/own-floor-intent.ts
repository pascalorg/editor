import { boundaries, diffStructure, roomFace } from '../commands/structure/shared'
import type { AnyNode, AnyNodeId, SlabNode, ZoneNode } from '../schema'
import { resolveCeilingHeight } from '../services/level-height'
import { getLevelElevations, getWallPlaneTop } from '../services/storey'
import { MIN_WALL_HEIGHT, resolveWallTop } from '../systems/wall/wall-top'
import { reconcileStructureWithStableIds } from '../utils/structure-id'
import { mintFloorFootprintKey } from './floor-footprint-key'
import { floorPlateHoldsUnderside } from './floor-foundation-datum'
import { floorIntentConflicts } from './floor-intent-changes'
import { isFloorAnchoredOpening } from './floor-opening-footprints'
import { floorRoomFaces } from './floor-room-faces'
import { getOpeningFloorDatum, wallSupportForNodes } from './opening-floor-datum'
import { getRoomBaseElevation, roundFloorElevation } from './room-floor-feasibility'

type Update = { id: AnyNodeId; data: Partial<AnyNode> }

export function ownFloorIntentChanges(
  nodes: Readonly<Record<string, AnyNode>>,
  updates: readonly Update[],
) {
  const result: Update[] = []
  let changed = false
  const refuse = (id: string, detail: string) => ({
    updates: [] as Update[],
    conflicts: [
      { code: 'room-floor-footprint', nodeIds: [id], message: `Level the floors first. ${detail}` },
    ],
  })
  for (const update of updates) {
    const zone = nodes[update.id]
    const data = update.data as Partial<ZoneNode>
    if (
      zone?.type !== 'zone' ||
      !Object.hasOwn(data, 'floor') ||
      (!zone.floor?.footprint && !data.floor?.footprint)
    ) {
      result.push(update)
      continue
    }
    const floor = { ...data.floor }
    const mint = floor.footprint === 'new'
    if (mint) floor.footprint = mintFloorFootprintKey(zone.id)
    const key = floor.footprint
    if (key === zone.floor?.footprint) {
      if (key && floor.elevation !== zone.floor?.elevation) {
        const conflicts = floorIntentConflicts(nodes, [update])
        if (conflicts.length) return { updates: [] as Update[], conflicts }
      }
      result.push(update)
      continue
    }
    if (
      zone.spaceRole !== 'room' ||
      zone.floor?.support === 'open' ||
      zone.floor?.sourceSlabId ||
      zone.hasFloor === false
    )
      return refuse(
        zone.id,
        'Only a grounded room with a generated floor can change its footprint.',
      )
    const faces = floorRoomFaces(boundaries(nodes, zone.parentId!))
    const face = roomFace(nodes, zone, faces)
    const neighbours = Object.values(nodes).filter(
      (node): node is ZoneNode =>
        node.type === 'zone' &&
        node.spaceRole === 'room' &&
        node.id !== zone.id &&
        node.parentId === zone.parentId &&
        node.floor?.support !== 'open' &&
        node.hasFloor !== false &&
        !!roomFace(nodes, node, faces)?.spans.some((other) =>
          face?.spans.some(
            (span) =>
              span.boundaryId === other.boundaryId &&
              span.face !== other.face &&
              Math.min(span.t1, other.t1) - Math.max(span.t0, other.t0) > 1e-6,
          ),
        ),
    )
    const base = Object.values(nodes).find(
      (node): node is SlabNode =>
        node.type === 'slab' && node.plateRole === 'base' && !!node.zoneIds?.includes(zone.id),
    )
    if (!base) return refuse(zone.id, 'This room has no single base plate to convert.')
    const top = roundFloorElevation(zone.floor?.elevation ?? getRoomBaseElevation(nodes, zone.id))
    if (
      mint &&
      floorPlateHoldsUnderside(nodes, base) &&
      base.thickness + top - base.elevation < 0.02 - 1e-9
    )
      return refuse(zone.id, 'The floor must retain at least 0.02 m above its soffit.')
    // Room intent stores the level-local walking top, preserving its world height
    // when the destination base is at a different height.
    floor.elevation = top
    if (
      !key &&
      !base.zoneIds?.some(
        (id) =>
          id !== zone.id &&
          nodes[id]?.type === 'zone' &&
          nodes[id].floor?.footprint === zone.floor?.footprint,
      )
    ) {
      const target = Object.values(nodes)
        .filter(
          (node): node is SlabNode =>
            node.type === 'slab' &&
            node.plateRole === 'base' &&
            node.id !== base.id &&
            !!node.zoneIds?.some((id) =>
              neighbours.some((room) => room.id === id && !room.floor?.footprint),
            ),
        )
        .sort((a, b) => a.id.localeCompare(b.id))[0]
      if (target)
        result.push({
          id: base.id,
          data: {
            floorHeight: target.floorHeight ?? target.elevation,
            referenceFloorElevation: target.referenceFloorElevation,
            thickness: target.thickness,
            foundation: target.foundation,
            slots: target.slots,
          },
        })
    }
    result.push({ ...update, data: { ...data, floor } })
    changed = true
  }
  if (!changed) return { updates: result, conflicts: [] }
  const draft = { ...nodes }
  for (const { id, data } of result) draft[id] = { ...draft[id], ...data } as AnyNode
  let next = reconcileStructureWithStableIds({ nodes: draft }).nodes
  const beforeLevels = getLevelElevations(nodes)
  const afterLevels = getLevelElevations(next)
  for (const [id, level] of beforeLevels)
    if (Math.abs(level.baseY - (afterLevels.get(id)?.baseY ?? level.baseY)) > 1e-6)
      return refuse(id, 'Changing the footprint would move another storey.')
  const wallUpdates: Update[] = []
  for (const old of Object.values(nodes)) {
    const current = next[old.id]
    if (old.type !== 'wall' || current?.type !== 'wall' || !old.parentId) continue
    const oldTop = resolveWallTop(
      old,
      getWallPlaneTop(old, old.parentId, nodes),
      wallSupportForNodes(old, nodes).elevation,
    )
    const support = wallSupportForNodes(current, next).elevation
    const newTop = resolveWallTop(
      current,
      getWallPlaneTop(current, current.parentId!, next),
      support,
    )
    if (Math.abs(oldTop - newTop) <= 1e-6) continue
    if (oldTop - support < MIN_WALL_HEIGHT)
      return refuse(
        old.id,
        `The preserved wall top would leave less than ${MIN_WALL_HEIGHT} m of wall.`,
      )
    wallUpdates.push({ id: old.id, data: { height: roundFloorElevation(oldTop - support) } })
  }
  if (wallUpdates.length) {
    result.push(...wallUpdates)
    for (const { id, data } of wallUpdates) draft[id] = { ...draft[id], ...data } as AnyNode
    next = reconcileStructureWithStableIds({ nodes: draft }).nodes
  }
  const ceilingUpdates: Update[] = []
  for (const old of Object.values(nodes)) {
    const current = next[old.id]
    if (old.type !== 'ceiling' || current?.type !== 'ceiling') continue
    const height = resolveCeilingHeight(old, nodes)
    if (Math.abs(height - resolveCeilingHeight(current, next)) > 1e-6)
      ceilingUpdates.push({
        id: old.id,
        data: { height, metadata: { ...old.metadata, floorReassignmentHeight: true } },
      })
  }
  if (ceilingUpdates.length) {
    result.push(...ceilingUpdates)
    for (const { id, data } of ceilingUpdates) draft[id] = { ...draft[id], ...data } as AnyNode
    next = reconcileStructureWithStableIds({ nodes: draft }).nodes
    for (const { id, data } of ceilingUpdates) {
      const ceiling = next[id]
      if (
        ceiling?.type !== 'ceiling' ||
        Math.abs(resolveCeilingHeight(ceiling, next) - (data as { height: number }).height) > 1e-6
      )
        return refuse(
          id,
          'Changing the footprint cannot preserve the ceiling beneath the covering floor.',
        )
    }
  }
  const openingUpdates: Update[] = []
  for (const old of Object.values(nodes)) {
    const current = next[old.id]
    if (
      (old.type !== 'door' && old.type !== 'window') ||
      (current?.type !== 'door' && current?.type !== 'window')
    )
      continue
    const oldWall = nodes[old.parentId!],
      newWall = next[current.parentId!]
    if (oldWall?.type !== 'wall' || newWall?.type !== 'wall') continue
    const delta =
      getOpeningFloorDatum(oldWall, old, nodes) +
      old.position[1] -
      getOpeningFloorDatum(newWall, current, next) -
      current.position[1]
    if (Math.abs(delta) <= 1e-6) continue
    openingUpdates.push({
      id: old.id,
      data: {
        position: [current.position[0], current.position[1] + delta, current.position[2]],
        // Keep the anchoring rule when compensation crosses the implicit sill threshold.
        verticalAnchor: isFloorAnchoredOpening(old) ? 'floor' : 'wall',
      },
    })
  }
  if (openingUpdates.length) {
    result.push(...openingUpdates)
    for (const { id, data } of openingUpdates) draft[id] = { ...draft[id], ...data } as AnyNode
    next = reconcileStructureWithStableIds({ nodes: draft }).nodes
  }
  for (const old of Object.values(nodes)) {
    const current = next[old.id]
    if (
      (old.type !== 'door' && old.type !== 'window') ||
      (current?.type !== 'door' && current?.type !== 'window')
    )
      continue
    const oldWall = nodes[old.parentId!],
      newWall = next[current.parentId!]
    if (oldWall?.type !== 'wall' || newWall?.type !== 'wall') continue
    if (
      Math.abs(
        getOpeningFloorDatum(oldWall, old, nodes) +
          old.position[1] -
          getOpeningFloorDatum(newWall, current, next) -
          current.position[1],
      ) > 1e-6
    )
      return refuse(old.id, 'Changing the footprint would move a door or window.')
  }
  const diff = diffStructure(nodes, next)
  const conflicts = floorIntentConflicts(
    nodes,
    diff.flatMap((patch) => (patch.op === 'update' ? [{ id: patch.id, data: patch.data }] : [])),
    diff.flatMap((patch) => (patch.op === 'create' ? [patch.node] : [])),
    diff.flatMap((patch) => (patch.op === 'delete' ? [patch.id] : [])),
  )
  if (conflicts.length) return refuse(result[0]!.id, conflicts.map((c) => c.message).join(' '))
  return { updates: result, conflicts: [] }
}

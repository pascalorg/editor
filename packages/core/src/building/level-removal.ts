import { groundSeat } from '../lib/ground-seat'
import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  type LevelNode,
  SlabNode,
} from '../schema'
import { getAuthoredLevelElevations, getStoredLevelHeight } from '../services/storey'
import { buildGroundLevelChanges } from './ground-level'
import { isHouseFloor } from './level-insertion'

/** A floor plate on the ground as the schema makes one. */
const GROUND_PLATE_THICKNESS = SlabNode.shape.thickness.parse(undefined)

type Update = { id: AnyNodeId; data: Partial<AnyNode> }

/** `nodes` without `levelId` and everything on it, its building no longer listing it. */
function withoutLevel(nodes: Record<AnyNodeId, AnyNode>, level: LevelNode) {
  const next = { ...nodes }
  const drop = (id: AnyNodeId) => {
    const node = next[id]
    if (!node) return
    if ('children' in node && Array.isArray(node.children))
      for (const child of node.children) drop(child as AnyNodeId)
    delete next[id]
  }
  drop(level.id as AnyNodeId)
  const building = level.parentId ? next[level.parentId as AnyNodeId] : undefined
  if (building?.type === 'building')
    next[building.id as AnyNodeId] = {
      ...building,
      children: building.children.filter((id) => id !== level.id),
    } as AnyNode
  return next
}

/**
 * What deleting a level changes beside it, as the level menu's "Delete level" does, for one undo
 * step with the deletion: the building stands as it did. Taking out the lowest floor (a basement)
 * leaves the floors over it where they stand, the next one taking the offset the stack stood on
 * (levels stack from the lowest one's own `baseElevation`), and its floor, framed over the basement,
 * is a plate on the ground again, its top held; a basement deleted from over another lets the one
 * under it come up into its place. A ground floor seated on its
 * foundation stays seated: where the deletion takes the floor the building stood on out from under
 * it (the level named the ground floor, a basement set as one), the building comes down so the
 * floor now at grade sits on the foundation. The floor numbers close up on the deleted one's side
 * of the ground floor, which stays 0. Empty for an id that is no level of a building.
 */
export function buildLevelRemovalChanges({
  nodes,
  levelId,
}: {
  nodes: Record<AnyNodeId, AnyNode>
  levelId: string
}): Update[] {
  const level = nodes[levelId as AnyNodeId]
  if (level?.type !== 'level') return []
  const building = level.parentId ? nodes[level.parentId as AnyNodeId] : undefined
  if (building?.type !== 'building') return []
  const levels = (building as BuildingNode).children.flatMap((id) => {
    const node = nodes[id as AnyNodeId]
    return node?.type === 'level' && node.id !== level.id ? [node] : []
  })
  if (levels.length === 0) return []

  const updates: Update[] = []
  const merge = ({ id, data }: Update) => {
    const index = updates.findIndex((entry) => entry.id === id)
    if (index === -1) updates.push({ id, data })
    else
      updates[index] = {
        id,
        data: { ...updates[index]!.data, ...data } as Partial<AnyNode>,
      }
  }
  // The floors stay numbered in a row from the ground floor's 0: those past the deleted one close
  // up towards it.
  for (const other of levels) {
    const past = level.level > 0 ? other.level > level.level : other.level < level.level
    if (level.level !== 0 && past)
      merge({
        id: other.id as AnyNodeId,
        data: { level: other.level + (level.level > 0 ? -1 : 1) } as Partial<AnyNode>,
      })
  }
  const lowest = levels.reduce((low, next) => (next.level < low.level ? next : low))
  if (level.level < lowest.level) {
    // The next floor up stood on the deleted one: it takes over the offset the stack stood on.
    const elevations = getAuthoredLevelElevations(nodes)
    const standsAt = elevations.get(lowest.id)?.baseY
    if (standsAt !== undefined && Math.abs(standsAt - (lowest.baseElevation ?? 0)) > 1e-6)
      merge({
        id: lowest.id as AnyNodeId,
        data: { baseElevation: Math.round(standsAt * 1e6) / 1e6 } as Partial<AnyNode>,
      })
    for (const id of lowest.children) {
      const plate = nodes[id as AnyNodeId]
      if (isHouseFloor(plate) && plate.buildUp)
        merge({
          id: plate.id as AnyNodeId,
          data: { buildUp: undefined, thickness: GROUND_PLATE_THICKNESS } as Partial<AnyNode>,
        })
    }
  } else if (level.level < 0) {
    // A basement over another: the floors under it come up into its place, the stack starting
    // that much higher, so the ground floor and everything over it stay where they stand.
    const rise = getStoredLevelHeight(level) + (level.baseElevation ?? 0)
    if (Math.abs(rise) > 1e-6)
      merge({
        id: lowest.id as AnyNodeId,
        data: {
          baseElevation: Math.round(((lowest.baseElevation ?? 0) + rise) * 1e6) / 1e6,
        } as Partial<AnyNode>,
      })
  }

  const before = groundSeat(nodes, building.id)
  const after = withoutLevel(nodes, level)
  for (const { id, data } of updates) after[id] = { ...after[id], ...data } as AnyNode
  const seat = groundSeat(after, building.id)
  if (!(before?.seated && seat && !seat.seated)) return updates
  const reseat = buildGroundLevelChanges({ nodes: after, levelId: seat.levelId })
  if (!reseat || reseat.unchanged) return updates
  for (const update of reseat.update) merge(update)
  return updates
}

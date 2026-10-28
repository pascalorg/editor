import { DEFAULT_FLOOR_BUILD_UP, floorBuildUpPatch } from '../lib/build-up'
import { designedFoundationReport } from '../lib/generic-foundation'
import { isSiteFlatwork } from '../lib/site-flatwork'
import {
  type AnyNode,
  type AnyNodeId,
  DEFAULT_UPPER_FLOOR_THICKNESS,
  LevelNode,
  type SlabNode,
} from '../schema'
import { getAuthoredLevelElevations } from '../services/storey'
import { buildSeatChanges, designedSeatMove } from './foundation'

/** A floor of the house the level stands on: not flatwork (a drive) and not a recess (a pool). */
export const isHouseFloor = (node: AnyNode | undefined): node is SlabNode =>
  node?.type === 'slab' &&
  node.plateRole === 'base' &&
  node.recessed !== true &&
  !isSiteFlatwork(node) &&
  node.polygon.length >= 3

/**
 * A new floor under the building's lowest, as the editor's "+" below makes it. Levels stack from
 * the lowest one's own `baseElevation`, so a new lowest floor left at 0
 * would push every floor above it up by its height: a basement added to a house stood the house on
 * the ground a storey too high (and a second basement, two storeys). The new floor takes the offset
 * that puts it one storey under where the lowest floor stood, and the old lowest floor gives its own
 * offset up, so every existing floor keeps its place. The floor over the new one is framed now: the
 * old lowest floor's plates take the default framed floor's layers (`DEFAULT_FLOOR_BUILD_UP`:
 * flooring, sheathing, joists, the ceiling under them) and its thickness, their tops held, so the
 * framing hangs into the new storey, as an upper floor's does over the rooms under it; the new
 * storey is that much taller, its rooms keeping `height` under the joists. Where the building's
 * designed foundation then stands it on the basement, the house is seated on it, its walls' top
 * `basementTopAboveGradeIn` over the highest grade (`basementSeat`); without one it stays where it
 * stood. One change set, one undo step.
 */
export function buildLevelBelowChanges({
  nodes,
  buildingId,
  height,
}: {
  nodes: Readonly<Record<string, AnyNode>>
  buildingId: string
  height: number
}) {
  const building = nodes[buildingId]
  const levels = (building?.type === 'building' ? building.children : []).flatMap((id) => {
    const level = nodes[id]
    return level?.type === 'level' ? [level] : []
  })
  const lowest = levels.reduce<(typeof levels)[number] | null>(
    (low, level) => (low === null || level.level < low.level ? level : low),
    null,
  )
  const standsAt = lowest
    ? (getAuthoredLevelElevations(nodes).get(lowest.id)?.baseY ?? lowest.baseElevation)
    : 0
  const framed = (lowest?.children ?? []).flatMap((id) => {
    const plate = nodes[id]
    return isHouseFloor(plate) && plate.thickness < DEFAULT_UPPER_FLOOR_THICKNESS - 1e-6
      ? [plate]
      : []
  })
  const hang = Math.max(
    0,
    ...framed.map((plate) => DEFAULT_UPPER_FLOOR_THICKNESS - plate.thickness),
  )
  const round = (value: number) => Math.round(value * 1e6) / 1e6
  const newLevel = LevelNode.parse({
    level: (lowest?.level ?? 1) - 1,
    height: round(height + hang),
    children: [],
    parentId: buildingId,
    baseElevation: lowest ? round(standsAt - height - hang) : 0,
  })
  const update = [
    ...(lowest && lowest.baseElevation !== 0
      ? [{ id: lowest.id as AnyNodeId, data: { baseElevation: 0 } as Partial<AnyNode> }]
      : []),
    ...framed.map((plate) => ({
      id: plate.id as AnyNodeId,
      data: floorBuildUpPatch(DEFAULT_FLOOR_BUILD_UP) as Partial<AnyNode>,
    })),
  ]
  return {
    newLevel,
    create: [{ node: newLevel as AnyNode, parentId: buildingId as AnyNodeId }],
    update: [...update, ...basementSeat(nodes, buildingId, newLevel, update)],
  }
}

/**
 * The house seated on the basement just added, where its designed foundation stands it on one: the
 * basement walls' top `basementTopAboveGradeIn` over the highest grade along them
 * (`designedSeatMove`), measured on the floors as the insertion leaves them. Empty where nothing is
 * designed (the record off, no closed outline) or the house stands there already.
 */
function basementSeat(
  nodes: Readonly<Record<string, AnyNode>>,
  buildingId: string,
  newLevel: LevelNode,
  update: Array<{ id: AnyNodeId; data: Partial<AnyNode> }>,
) {
  const building = nodes[buildingId]
  if (building?.type !== 'building') return []
  const after: Record<AnyNodeId, AnyNode> = {
    ...(nodes as Record<AnyNodeId, AnyNode>),
    [newLevel.id]: newLevel as AnyNode,
    [building.id]: { ...building, children: [...building.children, newLevel.id] } as AnyNode,
  }
  for (const { id, data } of update) after[id] = { ...after[id], ...data } as AnyNode
  if (!designedFoundationReport(after, buildingId)?.basement) return []
  return buildSeatChanges(after, buildingId, designedSeatMove(after, buildingId) ?? 0)
}

import { type AnyNode, type AnyNodeId, LevelNode } from '../schema'
import { getAuthoredLevelElevations } from '../services/storey'

/**
 * A new floor under the building's lowest, as the editor's "+" below makes it, without lifting the
 * building. Levels stack from the lowest one's own `baseElevation`, so a new lowest floor left at 0
 * would push every floor above it up by its height: a basement added to a house stood the house on
 * the ground a storey too high (and a second basement, two storeys). The new floor takes the offset
 * that puts it one storey under where the lowest floor stood, and the old lowest floor gives its own
 * offset up, so every existing floor keeps its place. One change set, one undo step.
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
  const newLevel = LevelNode.parse({
    level: (lowest?.level ?? 1) - 1,
    height,
    children: [],
    parentId: buildingId,
    baseElevation: lowest ? standsAt - height : 0,
  })
  return {
    newLevel,
    create: [{ node: newLevel as AnyNode, parentId: buildingId as AnyNodeId }],
    update:
      lowest && lowest.baseElevation !== 0
        ? [{ id: lowest.id as AnyNodeId, data: { baseElevation: 0 } as Partial<AnyNode> }]
        : [],
  }
}

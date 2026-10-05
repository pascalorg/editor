import { refuse } from '../agent-tools/refusal'
import { type BuildingNode, LevelNode } from '../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../services/level-height'
import { levelsOf } from './scene-queries'
import type { AgentContext, AgentOperation, SceneNodes } from './types'

type AddLevelInput = {
  buildingId?: string
  position?: 'above' | 'below'
  name?: string
  height?: number
}

/** The building named, else the one holding the viewed floor, else the scene's only building. */
export function targetBuilding(
  nodes: SceneNodes,
  buildingId: string | undefined,
  context: AgentContext,
): BuildingNode {
  if (buildingId) {
    const node = nodes[buildingId]
    if (!node) refuse('building_not_found', `Building not found: ${buildingId}.`, { buildingId })
    if (node.type !== 'building')
      refuse('not_a_building', `Node ${buildingId} is a ${node.type}, not a building.`, {
        buildingId,
        type: node.type,
      })
    return node
  }
  const viewed = context.activeLevelId ? nodes[context.activeLevelId] : undefined
  const holder = viewed?.parentId ? nodes[viewed.parentId] : undefined
  if (holder?.type === 'building') return holder
  const buildings = Object.values(nodes).filter(
    (node): node is BuildingNode => node.type === 'building',
  )
  if (buildings.length === 1) return buildings[0]!
  if (!buildings.length) refuse('no_building', 'The scene has no building to add a level to.')
  return refuse(
    'building_required',
    `The scene has ${buildings.length} buildings; say which: ${buildings.map((building) => building.id).join(', ')}.`,
    { buildingIds: buildings.map((building) => building.id) },
  )
}

/** `add_level`: an empty level over the building's highest, or under its lowest — the editor's +. */
export const addLevel: AgentOperation<AddLevelInput> = (nodes, input, context) => {
  const building = targetBuilding(nodes, input.buildingId, context)
  const floors = levelsOf(nodes)
    .filter((level) => level.parentId === building.id || building.children.includes(level.id))
    .map((level) => level.level)
  const below = input.position === 'below'
  const floorIndex = !floors.length ? 0 : below ? Math.min(...floors) - 1 : Math.max(...floors) + 1
  const level = LevelNode.parse({
    parentId: building.id,
    level: floorIndex,
    height: input.height ?? DEFAULT_LEVEL_HEIGHT,
    children: [],
    ...(input.name ? { name: input.name } : {}),
  })
  return {
    result: {
      ok: true,
      levelId: level.id,
      buildingId: building.id,
      floorIndex,
      ...(level.name ? { name: level.name } : {}),
      height: level.height,
      message: `Added ${level.name ?? `level ${floorIndex}`} ${below ? 'below' : 'above'} the existing levels of ${building.name ?? building.id}.`,
    },
    changes: { create: [{ node: level, parentId: building.id }] },
  }
}

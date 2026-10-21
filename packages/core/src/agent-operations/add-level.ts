import { refuse } from '../agent-tools/refusal'
import { buildLevelBelowChanges } from '../building/level-insertion'
import { foundationReadingOfLevel } from '../lib/foundation-construction'
import { foundationWallRule, levelHoldsFoundationWalls } from '../lib/foundation-wall'
import { BuildingNode, LevelNode, SiteNode } from '../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../services/level-height'
import { storeyInsertIndex } from '../services/roof-level'
import { applySceneChanges } from './apply-changes'
import { levelsOf, queryNodes } from './scene-queries'
import type { AgentContext, AgentOperation, SceneChanges, SceneNodes } from './types'

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
  const buildings = queryNodes<BuildingNode>(nodes, { type: 'building' })
  if (buildings.length === 1) return buildings[0]!
  if (!buildings.length) refuse('no_building', 'The scene has no building.')
  return refuse(
    'building_required',
    `The scene has ${buildings.length} buildings; say which: ${buildings.map((building) => building.id).join(', ')}.`,
    { buildingIds: buildings.map((building) => building.id) },
  )
}

/**
 * On a scene with no building, the editor's own empty scene: a site (unless one stands), its
 * building, the ground level. An agent that cleared the scene to restart begins again here.
 */
function freshStart(nodes: SceneNodes, input: AddLevelInput) {
  const standing = queryNodes(nodes, { type: 'site' })[0]
  const site = standing ? null : SiteNode.parse({ children: [] })
  const siteId = standing?.id ?? site!.id
  const building = BuildingNode.parse({ parentId: siteId, children: [] })
  const level = LevelNode.parse({
    parentId: building.id,
    level: 0,
    height: input.height ?? DEFAULT_LEVEL_HEIGHT,
    children: [],
    ...(input.name ? { name: input.name } : {}),
  })
  return {
    result: {
      ok: true,
      levelId: level.id,
      buildingId: building.id,
      ...(site ? { siteId: site.id } : {}),
      floorIndex: 0,
      ...(level.name ? { name: level.name } : {}),
      height: level.height,
      message: `The scene had no building: made ${site ? 'a site, ' : ''}a building and its ground level.`,
    },
    changes: {
      create: [
        ...(site ? [{ node: site }] : []),
        { node: building, parentId: siteId },
        { node: level, parentId: building.id },
      ],
    },
  }
}

/**
 * `add_level`: an empty level over the building's top storey, under its roof level (which moves up
 * one), or under its lowest level — the editor's +.
 */
export const addLevel: AgentOperation<AddLevelInput> = (nodes, input, context) => {
  if (!(input.buildingId || queryNodes(nodes, { type: 'building' }).length))
    return freshStart(nodes, input)
  const building = targetBuilding(nodes, input.buildingId, context)
  const floors = levelsOf(nodes)
    .filter((level) => level.parentId === building.id || building.children.includes(level.id))
    .map((level) => level.level)
  const below = input.position === 'below'
  const above = storeyInsertIndex(nodes, building.id)
  // A basement goes under the lowest floor and leaves every floor where
  // it stands, as the editor's "+" below does: the ground floor keeps its grade.
  const stacked =
    below && floors.length
      ? buildLevelBelowChanges({
          nodes,
          buildingId: building.id,
          height: input.height ?? DEFAULT_LEVEL_HEIGHT,
        })
      : null
  const floorIndex = stacked
    ? stacked.newLevel.level
    : below && floors.length
      ? Math.min(...floors) - 1
      : above.floorIndex
  const shift = below ? [] : above.shift
  const level =
    stacked?.newLevel ??
    LevelNode.parse({
      parentId: building.id,
      level: floorIndex,
      height: input.height ?? DEFAULT_LEVEL_HEIGHT,
      children: [],
      ...(input.name ? { name: input.name } : {}),
    })
  if (stacked && input.name) level.name = input.name
  const changes: SceneChanges = {
    create: [{ node: level, parentId: building.id }],
    update: stacked ? stacked.update : shift,
  }
  const after = applySceneChanges(nodes, changes)
  const foundation = levelHoldsFoundationWalls(after, level.id)
    ? foundationWallRule(foundationReadingOfLevel(after, level.id))
    : null
  return {
    result: {
      ok: true,
      levelId: level.id,
      buildingId: building.id,
      floorIndex,
      ...(level.name ? { name: level.name } : {}),
      height: level.height,
      ...(foundation ? { wallConstruction: foundation } : {}),
      ...(shift.length ? { shiftedLevelIds: shift.map(({ id }) => id) } : {}),
      message: `Added ${level.name ?? `level ${floorIndex}`} ${below ? (stacked ? 'below the existing levels, every floor keeping its place' : 'below the existing levels') : shift.length ? 'on top of the storeys, under the roof level' : 'above the existing levels'} of ${building.name ?? building.id}.${foundation ? ` It is below grade: ${foundation}; a wall given a thickness keeps it.` : ''}`,
    },
    changes,
  }
}

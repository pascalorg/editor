import { area } from '../lib/polygon-boolean'
import { roomFloorChoices } from '../lib/room-floor-choices'
import type { AnyNode, AnyNodeId, ItemNode, LevelNode, WallNode, ZoneNode } from '../schema'
import { DEFAULT_LEVEL_HEIGHT } from '../services/level-height'
import { getWallPlaneTop } from '../services/storey'
import { computeWallSlabSupport } from '../systems/slab/slab-support'
import { resolveWallEffectiveHeight } from '../systems/wall/wall-top'
import { type LevelTargetInput, targetLevel } from './level-target'
import { contentCounts, levelIdOf, levelRole, nodesOnLevel } from './scene-queries'
import type { AgentOperation, SceneNodes } from './types'

const round2 = (value: number) => Math.round(value * 100) / 100

function ofType<T extends AnyNode['type']>(content: readonly AnyNode[], type: T) {
  return content.filter((node): node is Extract<AnyNode, { type: T }> => node.type === type)
}

/**
 * The height a wall stands at, as rendered: its own, or its storey's plane (clamped under a
 * covering slab) above the slab it stands on. Pure over the scene, unlike the viewer's grid.
 */
export function wallResolvedHeight(nodes: SceneNodes, wall: WallNode): number {
  const levelId = levelIdOf(nodes, wall.id)
  if (!levelId) return resolveWallEffectiveHeight(wall, DEFAULT_LEVEL_HEIGHT, 0)
  const onLevel = nodesOnLevel(nodes, levelId)
  const support = computeWallSlabSupport(
    wall,
    ofType(onLevel, 'slab'),
    ofType(onLevel, 'wall'),
    wall.supportSlabId,
    undefined,
    0,
    nodes as Record<AnyNodeId, AnyNode>,
  )
  const planeTop = getWallPlaneTop(wall, levelId, nodes as Record<AnyNodeId, AnyNode>)
  return resolveWallEffectiveHeight(wall, planeTop, support.elevation)
}

export function wallSummary(nodes: SceneNodes, wall: WallNode) {
  return {
    id: wall.id,
    name: wall.name,
    start: wall.start,
    end: wall.end,
    length: round2(Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])),
    height: wall.height,
    resolvedHeight: wallResolvedHeight(nodes, wall),
    heightIsExplicit: wall.height !== undefined,
    thickness: wall.thickness,
    openings: wall.children.flatMap((id) => {
      const child = nodes[id]
      if (child?.type !== 'door' && child?.type !== 'window') return []
      const { type, position, width, height } = child
      return [{ id, type, position, width, height }]
    }),
  }
}

function zoneSize(zone: ZoneNode) {
  const xs = zone.polygon.map((point) => point[0])
  const zs = zone.polygon.map((point) => point[1])
  return {
    areaSqMeters: round2(area([{ outer: zone.polygon, holes: zone.holes ?? [] }])),
    bounds: {
      width: round2(Math.max(...xs) - Math.min(...xs)),
      depth: round2(Math.max(...zs) - Math.min(...zs)),
    },
  }
}

const zoneSummary = (nodes: SceneNodes, zone: ZoneNode) => ({
  id: zone.id,
  name: zone.name,
  color: zone.color,
  polygon: zone.polygon,
  holes: zone.holes ?? [],
  ...zoneSize(zone),
  floor_choices: roomFloorChoices(nodes, zone.id),
})

const itemSummary = (item: ItemNode) => ({
  id: item.id,
  name: item.name ?? item.asset.name,
  parentId: item.parentId,
  position: item.position,
  assetId: item.asset.id,
  category: item.asset.category,
})

// Listed on their own, or inside what holds them (openings in walls, flights in stairs).
const SUMMARISED = new Set<AnyNode['type']>([
  'wall',
  'door',
  'window',
  'zone',
  'slab',
  'ceiling',
  'item',
  'floor-opening',
  'stair',
  'stair-segment',
  'roof',
  'roof-segment',
])

/** Everything on a level, compactly: what to act on, with ids. Polygons stay in get_zones. */
function levelSummary(nodes: SceneNodes, level: LevelNode) {
  const content = nodesOnLevel(nodes, level.id)
  const { role, metadataRole, referenceLevelId } = levelRole(nodes, level)
  return {
    levelId: level.id,
    levelName: level.name,
    floorIndex: level.level,
    role,
    metadataRole,
    isOccupiedStory: role === 'occupied',
    isSupportLevel: role !== 'occupied',
    referenceLevelId,
    counts: contentCounts(content),
    walls: ofType(content, 'wall').map((wall) => wallSummary(nodes, wall)),
    zones: ofType(content, 'zone').map((zone) => ({
      id: zone.id,
      name: zone.name,
      holes: zone.holes ?? [],
      ...zoneSize(zone),
      floor_choices: roomFloorChoices(nodes, zone.id),
    })),
    slabs: ofType(content, 'slab').map((slab) => ({
      id: slab.id,
      elevation: slab.elevation,
      holeCount: slab.holes?.length ?? 0,
    })),
    ceilings: ofType(content, 'ceiling').map((ceiling) => ({
      id: ceiling.id,
      height: ceiling.height,
      itemCount: ceiling.children.filter((id) => nodes[id]?.type === 'item').length,
    })),
    items: ofType(content, 'item').map(itemSummary),
    openings: ofType(content, 'floor-opening').map((opening) => ({
      id: opening.id,
      polygon: opening.polygon,
      hostZoneId: opening.hostZoneId ?? null,
      source: opening.source,
      drawnOn: opening.drawnOn,
      cutsPrimary: opening.cutsPrimary,
      cutsAdjacent: opening.cutsAdjacent,
    })),
    stairs: ofType(content, 'stair').map((stair) => ({
      id: stair.id,
      name: stair.name,
      position: stair.position,
    })),
    roofs: ofType(content, 'roof').map((roof) => ({
      id: roof.id,
      name: roof.name,
      segmentCount: roof.children.length,
    })),
    other: content
      .filter((node) => !SUMMARISED.has(node.type))
      .map((node) => ({ id: node.id, type: node.type, name: node.name })),
  }
}

/** `get_level_summary`. */
export const getLevelSummary: AgentOperation<LevelTargetInput> = (nodes, input, context) => ({
  result: levelSummary(nodes, targetLevel(nodes, input, context)),
})

/** `get_walls`. */
export const getWalls: AgentOperation<LevelTargetInput> = (nodes, input, context) => {
  const level = targetLevel(nodes, input, context)
  const walls = ofType(nodesOnLevel(nodes, level.id), 'wall')
  return { result: { levelId: level.id, walls: walls.map((wall) => wallSummary(nodes, wall)) } }
}

/** `get_zones`. */
export const getZones: AgentOperation<LevelTargetInput> = (nodes, input, context) => {
  const level = targetLevel(nodes, input, context)
  const zones = ofType(nodesOnLevel(nodes, level.id), 'zone')
  return { result: { levelId: level.id, zones: zones.map((zone) => zoneSummary(nodes, zone)) } }
}

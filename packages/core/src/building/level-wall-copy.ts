import { exteriorWallLoops } from '../lib/exterior-wall-loops'
import { levelHoldsFoundationWalls, withFoundationConstruction } from '../lib/foundation-wall'
import { type AnyNode, type AnyNodeId, generateId, type LevelNode, WallNode } from '../schema'
import { wallFollowsStorey } from '../systems/wall/wall-top'

/** The visible walls of `levelId` on its outline: the walls a closed circuit's outside runs along. */
export function levelExteriorWalls(nodes: Record<string, AnyNode>, levelId: string): WallNode[] {
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' && node.parentId === levelId && node.visible !== false,
  )
  const outline = new Set(
    exteriorWallLoops(walls).flatMap((loop) => loop.map((face) => face.wallId)),
  )
  return walls.filter((wall) => outline.has(wall.id))
}

/**
 * Copy a level's exterior walls, in place, onto another level of the building (a floor just added
 * above or below it): the same plan positions, thickness, construction and finishes, so the new
 * storey's outside lines up with the one it stands on. What belongs to the source storey stays
 * there: its doors and windows, its support and terrain settings, and a height that only meant
 * "as tall as this storey" (the copy follows its own storey). A copy between a basement and a floor
 * over the ground takes the construction of where it lands: walls copied down to a basement get the
 * foundation build, and foundation walls copied up are plain walls. Rooms then come from the copied
 * walls as from drawn ones. Returns the create entries for `applyNodeChanges`; empty when the
 * source has no closed outline.
 */
export function buildExteriorWallCopy({
  nodes,
  fromLevelId,
  toLevelId,
  mintId = () => generateId('wall'),
}: {
  nodes: Record<string, AnyNode>
  fromLevelId: string
  toLevelId: string
  mintId?: () => string
}): Array<{ node: WallNode; parentId: AnyNodeId }> {
  const from = nodes[fromLevelId]
  const to = nodes[toLevelId]
  if (from?.type !== 'level' || to?.type !== 'level' || from.id === to.id) return []
  const graph = nodes as Record<AnyNodeId, AnyNode>
  const sourceFoundation = levelHoldsFoundationWalls(graph, fromLevelId)
  const targetFoundation = levelHoldsFoundationWalls(graph, toLevelId)
  const reconstruct = sourceFoundation !== targetFoundation
  const storeyHeight = (from as LevelNode).height ?? null
  const copies = levelExteriorWalls(nodes, fromLevelId).map((wall) => {
    const {
      id: _id,
      children: _children,
      parentId: _parentId,
      metadata: _metadata,
      supportSlabId: _support,
      supportOffset: _offset,
      fillToTerrain: _fill,
      underpinning: _underpinning,
      faceRegions: _regions,
      height,
      assembly,
      thickness,
      ...kept
    } = wall
    return WallNode.parse({
      ...kept,
      id: mintId(),
      parentId: toLevelId,
      children: [],
      ...(height !== undefined && !wallFollowsStorey(wall, storeyHeight) ? { height } : {}),
      ...(reconstruct ? {} : { assembly, thickness }),
    })
  })
  if (!copies.length) return []
  const levelWalls = [
    ...Object.values(nodes).filter(
      (node): node is WallNode => node.type === 'wall' && node.parentId === toLevelId,
    ),
    ...copies,
  ]
  const built = targetFoundation
    ? withFoundationConstruction(graph, toLevelId, levelWalls, copies, {})
    : copies
  return built.map((node) => ({ node, parentId: toLevelId as AnyNodeId }))
}

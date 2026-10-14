import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  DEFAULT_LEVEL_HEIGHT,
  LevelNode,
  storeyInsertIndex,
  useScene,
} from '@pascal-app/core'

/**
 * The editor's "add a floor": an empty storey on top of the building's storeys, under its roof
 * level, which moves up one in the same undo step, so the roof stays on top (add_level's rule).
 */
export function addStoreyOnTop(buildingId: BuildingNode['id']): LevelNode {
  const scene = useScene.getState()
  const { floorIndex, shift } = storeyInsertIndex(scene.nodes, buildingId)
  const level = LevelNode.parse({
    level: floorIndex,
    height: DEFAULT_LEVEL_HEIGHT,
    children: [],
    parentId: buildingId,
  })
  scene.applyNodeChanges({
    create: [{ node: level, parentId: buildingId }],
    update: shift.map(({ id, data }) => ({ id: id as AnyNodeId, data: data as Partial<AnyNode> })),
  })
  return level
}

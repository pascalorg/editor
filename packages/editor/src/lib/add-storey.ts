import {
  type AnyNode,
  type AnyNodeId,
  type BuildingNode,
  DEFAULT_LEVEL_HEIGHT,
  LevelNode,
  storeyInsertIndex,
  useScene,
} from '@pascal-app/core'
import { buildGroundLevelChanges, buildLevelBelowChanges } from '@pascal-app/core/building'

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

/**
 * The editor's "add a basement": an empty storey under the building's lowest, the floors above it
 * staying where they are (`buildLevelBelowChanges`), in one undo step. Every floor under the ground
 * is its own storey down, so a second, third or fourth basement stacks below the one before.
 */
export function addStoreyBelow(buildingId: BuildingNode['id']): LevelNode {
  const scene = useScene.getState()
  const { newLevel, create, update } = buildLevelBelowChanges({
    nodes: scene.nodes,
    buildingId,
    height: DEFAULT_LEVEL_HEIGHT,
  })
  scene.applyNodeChanges({ create, update })
  return newLevel
}

/**
 * The editor's "Set as ground floor": the level stands at grade, the building seated to it and the
 * floors renumbered so it is 0 (`buildGroundLevelChanges`), in one undo step. `false` when it
 * already is the ground floor, seated.
 */
export function setGroundFloor(levelId: LevelNode['id']): boolean {
  const scene = useScene.getState()
  const built = buildGroundLevelChanges({ nodes: scene.nodes, levelId })
  if (!built || built.unchanged) return false
  scene.applyNodeChanges({ update: built.update })
  return true
}

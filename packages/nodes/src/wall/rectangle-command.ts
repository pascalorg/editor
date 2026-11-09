import {
  type AnyNodeId,
  planWallRectangle,
  resolveWallConstruction,
  runAsSingleSceneHistoryStep,
  useScene,
  type WallConstructionOptions,
  type WallNode,
  type WallPlanPoint,
} from '@pascal-app/core'

export function createWallRectangle(
  levelId: AnyNodeId,
  start: WallPlanPoint,
  end: WallPlanPoint,
  defaults: Partial<WallNode> = {},
  options?: WallConstructionOptions,
) {
  const scene = useScene.getState()
  if (scene.readOnly) throw Error('This scene is read-only.')
  const plan = planWallRectangle(scene.nodes, { levelId, start, end, wallDefaults: defaults })
  if (!plan.changes.create.length && !plan.changes.update.length && !plan.changes.delete.length)
    return []
  const construction = resolveWallConstruction(scene.nodes, levelId, plan.walls, options)
  const walls = new Map(construction.walls.map((w) => [w.id, w]))
  const changes = {
    ...plan.changes,
    create: plan.changes.create.map((op) => ({
      ...op,
      node: walls.get(op.node.id as WallNode['id']) ?? op.node,
    })),
  }
  if (construction.sourceSupportUpdate) changes.update.push(construction.sourceSupportUpdate)
  runAsSingleSceneHistoryStep(useScene, () => scene.applyNodeChanges(changes))
  return construction.walls
}

import {
  type AnyNode,
  type AnyNodeId,
  getLevelElevations,
  isRoofLevel,
  type LevelNode,
  planRoofLevel,
  type RoofNode,
  type RoofSegmentNode,
  resolveRoofElevation,
  type SceneApi,
} from '@pascal-app/core'
import { applySceneChanges } from '@pascal-app/core/agent-operations'

/**
 * Where a roof drawn by hand goes, by core's rule for every roof writer (`planRoofLevel`): on the
 * level directly above the storey whose walls carry it, which over the top storey is the
 * building's roof level, created or declared in the same undo step as the roof.
 */
export type RoofLevelTarget = {
  levelId: LevelNode['id']
  create: { node: AnyNode; parentId?: AnyNodeId }[]
  update: { id: AnyNodeId; data: Partial<AnyNode> }[]
  /** The scene with the target written, to resolve the roof's elevation against. */
  nodes: Readonly<Record<AnyNodeId, AnyNode>>
}

const levelHoldsWalls = (nodes: Readonly<Record<string, AnyNode>>, levelId: string) => {
  const level = nodes[levelId]
  return level?.type === 'level' && level.children.some((id) => nodes[id]?.type === 'wall')
}

/** The target of a roof carried by `storeyId`'s walls, `roofHeight` its rise over its eaves. */
export function roofLevelTarget(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  storeyId: LevelNode['id'],
  roofHeight: number,
): RoofLevelTarget {
  const plan = planRoofLevel(nodes, storeyId, roofHeight)
  const create =
    plan.kind === 'roof' && plan.create
      ? [{ node: plan.create, parentId: (plan.create.parentId ?? undefined) as AnyNodeId }]
      : []
  const update = (plan.kind === 'roof' ? plan.update : []).map(({ id, data }) => ({
    id: id as AnyNodeId,
    data: data as Partial<AnyNode>,
  }))
  return {
    levelId: plan.levelId as LevelNode['id'],
    create,
    update,
    nodes: create.length || update.length ? applySceneChanges(nodes, { create, update }) : nodes,
  }
}

/**
 * The target of a roof drawn on the armed level: over its walls when it holds some, else the
 * level itself (an empty upper level or the roof level, already above what it covers).
 */
export function drawnRoofLevelTarget(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: LevelNode['id'],
  roofHeight: number,
): RoofLevelTarget {
  return levelHoldsWalls(nodes, levelId)
    ? roofLevelTarget(nodes, levelId, roofHeight)
    : { levelId, create: [], update: [], nodes }
}

/**
 * How a roof drawn on the armed level stands: lifted onto the roof level over the armed storey, on
 * that storey's walls, following their height as a roof over a room does; anywhere else (a lower
 * wing's storey above, an empty level) on the level plane it was drawn on.
 */
export function drawnRoofSupport(
  target: RoofLevelTarget,
  armedLevelId: string,
): NonNullable<RoofNode['support']> {
  return target.levelId !== armedLevelId && isRoofLevel(target.nodes[target.levelId as AnyNodeId])
    ? { kind: 'walls' }
    : { kind: 'level' }
}

/** A roof's eave on the wall tops under it, read with the roof written into the target's scene. */
export function seatedRoofElevation(
  target: RoofLevelTarget,
  roof: RoofNode,
  segments: RoofSegmentNode[],
): number {
  const seated = applySceneChanges(target.nodes, {
    create: [
      { node: roof, parentId: target.levelId as AnyNodeId },
      ...segments.map((segment) => ({ node: segment as AnyNode, parentId: roof.id as AnyNodeId })),
    ],
  })
  return resolveRoofElevation(seated[roof.id as AnyNodeId] as RoofNode, seated)
}

/** How far above the armed level a target sits (m), to draw the roof's ghost where it lands. */
export function roofLevelTargetOffset(target: RoofLevelTarget, armedLevelId: string): number {
  const elevations = getLevelElevations(target.nodes as Record<AnyNodeId, AnyNode>)
  return (elevations.get(target.levelId)?.baseY ?? 0) - (elevations.get(armedLevelId)?.baseY ?? 0)
}

/** Writes a roof's nodes with its target level, in one step when the scene can. */
export function writeRoofNodes(
  sceneApi: SceneApi,
  target: RoofLevelTarget,
  ops: { node: AnyNode; parentId?: AnyNodeId }[],
): void {
  const create = [...target.create, ...ops]
  if (sceneApi.applyChanges) {
    sceneApi.applyChanges({ create, update: target.update })
    return
  }
  for (const { id, data } of target.update) sceneApi.update(id, data)
  if (sceneApi.createMany) {
    sceneApi.createMany(create)
    return
  }
  for (const op of create) sceneApi.upsert(op.node, op.parentId)
}

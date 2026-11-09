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
  seatRoofs,
  standsOverStorey,
  useScene,
} from '@pascal-app/core'
import { applySceneChanges } from '@pascal-app/core/agent-operations'
import { selectPlacedNode } from '@pascal-app/editor'

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

/** A roof drawn by hand, in the plan of the level it was drawn on: its footprint and form. */
export type DrawnRoof = {
  center: [number, number]
  /** Along plan x and z (a cone: its diameter both ways). */
  width: number
  depth: number
  roofType: string
}

/** Whether a roof drawn on a walled level stands over that storey (core's `standsOverStorey`). */
function overStorey(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: LevelNode['id'],
  drawn: DrawnRoof,
): boolean {
  const level = nodes[levelId]
  if (level?.type !== 'level' || !level.children.some((id) => nodes[id]?.type === 'wall'))
    return false
  return standsOverStorey(nodes, levelId, {
    cx: drawn.center[0],
    cz: drawn.center[1],
    yaw: 0,
    hw: drawn.width / 2,
    hd: drawn.depth / 2,
    reach: { x: 0, z: 0 },
    roofType: drawn.roofType,
    peak: 0,
  })
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
 * The target of a roof drawn on the armed level: over that storey (`overStorey`), the level above
 * its walls; else the level itself (a porch on its posts, an empty upper level or the roof level,
 * already above what it covers).
 */
export function drawnRoofLevelTarget(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  levelId: LevelNode['id'],
  roofHeight: number,
  drawn: DrawnRoof,
): RoofLevelTarget {
  return overStorey(nodes, levelId, drawn)
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

/**
 * A roof edit written through the seat every roof writer runs (`seatRoofs`): a segment added to a
 * roof held by a storey that puts it on that storey's walls takes the roof to the level above them,
 * in the same store call.
 */
export function writeSeatedRoofEdit(
  sceneApi: SceneApi,
  edit: {
    create?: { node: AnyNode; parentId?: AnyNodeId }[]
    update?: { id: AnyNodeId; data: Partial<AnyNode> }[]
  },
): void {
  const { changes } = seatRoofs(sceneApi.nodes(), edit)
  if (sceneApi.applyChanges) {
    sceneApi.applyChanges(changes)
    return
  }
  // creates first: a roof the seat moves goes to a Roof level the seat creates
  for (const op of changes.create ?? []) sceneApi.upsert(op.node, op.parentId)
  for (const { id, data } of changes.update ?? []) sceneApi.update(id, data)
}

/**
 * A roof edit from the plan or an inspector (a move, a turn, a resize, a field), committed through
 * the seat (`seatRoofs`) in one store call: an edit that puts a storey-held roof on its walls takes
 * it to the level above them, and the selection follows `selectId` there.
 */
export function commitSeatedRoofEdit(
  update: { id: AnyNodeId; data: Partial<AnyNode> }[],
  selectId: AnyNodeId,
): void {
  const scene = useScene.getState()
  const { changes, notes } = seatRoofs(scene.nodes, { update })
  if (!notes.length) {
    scene.updateNodes(update)
    return
  }
  scene.applyNodeChanges(changes)
  selectPlacedNode(selectId)
}

import { planWallOpening, type WallOpeningInput } from '../building/wall-openings'
import { type Achieved, achievedChanges } from './achieved'
import type { SceneChanges, SceneNodes } from './types'

/**
 * add_door and add_window for every surface: the editor's placement rules (`planWallOpening`),
 * the node to create, and the one result the MCP and the chat both pass through as it is.
 */
export function addWallOpening(nodes: SceneNodes, input: WallOpeningInput) {
  const plan = planWallOpening(nodes as never, input)
  const changes: SceneChanges = {
    create: [{ node: plan.node as never, parentId: plan.wallId }],
  }
  return {
    changes,
    result: {
      ok: true as const,
      ...(input.kind === 'door' ? { doorId: plan.node.id } : { windowId: plan.node.id }),
      wallId: plan.wallId,
      localX: plan.localX,
      t: plan.t,
      wallLength: plan.wallLength,
      clamped: plan.clamped,
      coordinateSystem: 'wall-local-meters' as const,
      ...(plan.sillHeight === undefined ? {} : { sillHeight: plan.sillHeight }),
      message: `Added ${input.kind} "${plan.node.name}" on wall ${plan.wallId}${plan.clamped ? ', slid to fit' : ''}`,
      achieved: achievedChanges(nodes, changes),
    },
  }
}

type PlacedOpening = {
  type: string
  name?: string
  position: [number, number, number]
  height: number
  wallId?: string
}

/**
 * add_door / add_window with a nodeId, rebuilt from its script: the same answer as a new opening,
 * read from where it stands after the rebuild, with what the script reported.
 */
export function rebuiltOpeningResult(
  nodesAfter: SceneNodes,
  nodeId: string,
  summary: Record<string, unknown>,
  achieved: Achieved,
) {
  const node = nodesAfter[nodeId] as unknown as PlacedOpening
  const wall = node.wallId
    ? (nodesAfter[node.wallId] as unknown as { type: string; start: number[]; end: number[] })
    : undefined
  const wallLength =
    wall?.type === 'wall'
      ? Math.hypot(wall.end[0]! - wall.start[0]!, wall.end[1]! - wall.start[1]!)
      : 0
  return {
    ok: true as const,
    ...(node.type === 'door' ? { doorId: nodeId } : { windowId: nodeId }),
    wallId: node.wallId ?? '',
    localX: node.position[0],
    t: wallLength ? node.position[0] / wallLength : 0,
    wallLength,
    clamped: false,
    coordinateSystem: 'wall-local-meters' as const,
    ...(node.type === 'window' ? { sillHeight: node.position[1] - node.height / 2 } : {}),
    message: `Rebuilt ${node.type} "${node.name ?? nodeId}" from its script`,
    ...summary,
    achieved,
  }
}

import {
  type AnyNodeId,
  authorStairOpeningPatches,
  type FloorOpeningNode,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { getSegmentGridStep, snapPointToGrid, snapScalarToGrid } from '@pascal-app/editor'
import {
  createPolygonAddVertexAffordance,
  createPolygonDeleteVertexAffordance,
  createPolygonMoveEdgeAffordance,
  createPolygonVertexAffordance,
} from '../shared/polygon-vertex-affordance'
import {
  isOwnedOpening,
  moveRectangleEdge,
  openingRectangle,
  type Ring,
  resizeRectangleCorner,
} from './floorplan'

/** Every write for `ring` on a stair's opening: its floor and ceiling cuts take it as drawn. */
function ownedOpeningUpdates(id: AnyNodeId, ring: Ring) {
  const authored = authorStairOpeningPatches(useScene.getState().nodes, id, ring)
  return authored.length ? authored : [{ id, data: { polygon: ring } }]
}

function ownedOpeningSession(
  node: FloorOpeningNode,
  next: (rectangle: Ring, planPoint: readonly [number, number]) => Ring,
): FloorplanAffordanceSession {
  const rectangle = openingRectangle(node.polygon)
  const affectedIds = [
    ...new Set([
      node.id as AnyNodeId,
      ...authorStairOpeningPatches(useScene.getState().nodes, node.id, rectangle).map(
        (patch) => patch.id,
      ),
    ]),
  ]
  let ring: Ring | null = null
  // The drag previews through live overrides; the scene is written once, on release.
  return {
    affectedIds,
    apply({ planPoint }) {
      ring = next(rectangle, planPoint)
      useLiveNodeOverrides
        .getState()
        .setMany(
          ownedOpeningUpdates(node.id as AnyNodeId, ring).map(
            ({ id, data }) => [id, data as Record<string, unknown>] as const,
          ),
        )
    },
    canCommit: () => ring !== null,
    commit() {
      const overrides = useLiveNodeOverrides.getState()
      if (ring)
        useScene.getState().updateNodes(ownedOpeningUpdates(node.id as AnyNodeId, ring) as never)
      for (const id of affectedIds) overrides.clear(id)
    },
  }
}

/** Owned openings resize as a box; every other opening keeps the free polygon handles. */
function ownedOr(
  owned: FloorplanAffordance<FloorOpeningNode>['start'],
  free: FloorplanAffordance<FloorOpeningNode>,
): FloorplanAffordance<FloorOpeningNode> {
  return { start: (args) => (isOwnedOpening(args.node) ? owned(args) : free.start(args)) }
}

const inert = (node: FloorOpeningNode): FloorplanAffordanceSession => ({
  affectedIds: [node.id as AnyNodeId],
  apply() {},
  canCommit: () => false,
})

export const floorOpeningMoveVertexAffordance = ownedOr(({ node, payload }) => {
  const { vertexIndex } = payload as { vertexIndex: number }
  return ownedOpeningSession(node, (rectangle, planPoint) =>
    resizeRectangleCorner(
      rectangle,
      vertexIndex % 4,
      snapPointToGrid([planPoint[0], planPoint[1]], getSegmentGridStep()),
    ),
  )
}, createPolygonVertexAffordance<FloorOpeningNode>('floor-opening'))
export const floorOpeningAddVertexAffordance = ownedOr(
  ({ node }) => inert(node),
  createPolygonAddVertexAffordance<FloorOpeningNode>('floor-opening'),
)
export const floorOpeningMoveEdgeAffordance = ownedOr(({ node, payload, initialPlanPoint }) => {
  const { edgeIndex } = payload as { edgeIndex: number }
  return ownedOpeningSession(node, (rectangle, planPoint) => {
    const start = rectangle[edgeIndex % 4]!
    const end = rectangle[(edgeIndex + 1) % 4]!
    const opposite = rectangle[(edgeIndex + 2) % 4]!
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
    let normal: [number, number] = [-(end[1] - start[1]) / length, (end[0] - start[0]) / length]
    if ((opposite[0] - start[0]) * normal[0] + (opposite[1] - start[1]) * normal[1] > 0)
      normal = [-normal[0], -normal[1]]
    const distance = snapScalarToGrid(
      (planPoint[0] - initialPlanPoint[0]) * normal[0] +
        (planPoint[1] - initialPlanPoint[1]) * normal[1],
      getSegmentGridStep(),
    )
    return moveRectangleEdge(rectangle, edgeIndex % 4, distance)
  })
}, createPolygonMoveEdgeAffordance<FloorOpeningNode>('floor-opening'))
export const floorOpeningDeleteVertexAffordance = ownedOr(
  ({ node }) => inert(node),
  createPolygonDeleteVertexAffordance<FloorOpeningNode>('floor-opening'),
)

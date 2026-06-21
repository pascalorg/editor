import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  type PortConnectivity,
  resolveConnectivityUpdates,
  useScene,
} from '@pascal-app/core'
import { snapPointToGrid, type WallPlanPoint } from '@pascal-app/editor'
import {
  detectFittingEndpoint,
  type FittingEndpoint,
  planFittingEndpointReaim,
} from './fitting-endpoint-reaim'

/**
 * Shared "drag a path point" floor-plan affordance for polyline
 * distribution kinds (duct-segment / pipe-segment / lineset). It is the
 * 2D counterpart of their 3D `affordanceTools.selection` handles: one
 * draggable handle per path vertex, moved freely on the plan (XZ) with
 * grid snap (Shift bypasses). The vertex's Y (elevation / slope) is held
 * fixed — plan editing never changes height.
 *
 * Like the 3D handles, dragging a vertex that sits on a fitting carries the
 * joint along (port connectivity): the fitting follows, connected runs stretch
 * along their own axis and translate across it, and that perpendicular slide
 * propagates down the chain. And — duct / pipe only — dragging the free end
 * of a straight run whose other end sits on an elbow re-aims that elbow to
 * follow the drag (bend angle adapts) instead of translating it rigidly. Holding
 * **Alt** detaches: the joint breaks for the drag so the vertex moves on its
 * own (no elbow re-aim, no connectivity follow). Behavioral parity with the
 * 3D selection tool.
 *
 * Wired via `def.floorplanAffordances['move-path-point']`; the floor-plan
 * builders emit `endpoint-handle` primitives carrying `{ pointIndex }` so
 * the dispatcher routes pointer-downs here.
 */
export type PathPointPayload = { pointIndex: number }

type PathShape = { path: ReadonlyArray<readonly [number, number, number]> }

export function createPathPointMoveAffordance<N extends PathShape & { id: AnyNodeId }>(
  kind: string,
): FloorplanAffordance<N> {
  const inert: FloorplanAffordanceSession = {
    affectedIds: [],
    apply() {},
    canCommit() {
      return false
    },
  }
  return {
    start({ node, payload, nodes }): FloorplanAffordanceSession {
      const { pointIndex } = payload as PathPointPayload
      const initialPath = node.path.map((p) => [...p] as [number, number, number])
      const target = initialPath[pointIndex]
      if (!target) return { ...inert, affectedIds: [node.id] }
      // Hold the dragged vertex's elevation — the plan move only shifts XZ.
      const y = target[1]

      // Connectivity snapshot: which fittings / runs are mated to this run's
      // endpoints so they follow the drag. Only endpoints (first / last vertex)
      // bear ports; interior vertices have no joint, so skip the analysis.
      const isEndpoint = pointIndex === 0 || pointIndex === initialPath.length - 1

      // Fitting re-aim (duct / pipe): if this is a straight run whose OTHER
      // end sits on an elbow collar (bend angle adapts) or a duct tee branch
      // collar (branch lean adapts), the fitting swings to follow the drag —
      // the 2D twin of the 3D selection handle's behaviour. Takes precedence
      // over the rigid connectivity follow for this endpoint.
      const fittingEndpoint: FittingEndpoint | null = isEndpoint
        ? detectFittingEndpoint(kind, initialPath, pointIndex, nodes)
        : null

      const connectivity: PortConnectivity | null =
        isEndpoint && !fittingEndpoint
          ? analyzePortConnectivity(node as unknown as AnyNode, nodes)
          : null

      // Report every node the drag may write so the dispatcher snapshots them
      // for the single-undo dance.
      const affectedIds: AnyNodeId[] = [
        node.id,
        ...(fittingEndpoint ? [fittingEndpoint.fitting.id as AnyNodeId] : []),
        ...(connectivity?.connections.map((c) => c.nodeId) ?? []),
      ]

      const followUpdates = (nextPath: [number, number, number][]) => {
        if (!connectivity) return []
        const preview = {
          ...(node as unknown as Record<string, unknown>),
          path: nextPath,
        } as AnyNode
        return resolveConnectivityUpdates(connectivity, preview).filter(
          (u) => useScene.getState().nodes[u.id],
        )
      }

      return {
        affectedIds,
        apply({ planPoint, modifiers }) {
          // Plan coords map x→world X, y→world Z.
          const raw: WallPlanPoint = [planPoint[0], planPoint[1]]
          const [sx, sz] = modifiers.shiftKey ? raw : snapPointToGrid(raw)
          const dragged: [number, number, number] = [sx, y, sz]
          // Alt = detach: break the joint for this drag — the elbow does NOT
          // re-aim and mated fittings / runs do NOT follow; the vertex moves
          // on its own. Mirrors the 3D selection drag and the wall corner.
          const detached = modifiers.altKey
          // Fitting re-aim: the fitting swings to follow the dragged end and
          // the run rides its re-aimed collar. Out-of-range turns hold the
          // frame.
          if (!detached && fittingEndpoint) {
            const plan = planFittingEndpointReaim(fittingEndpoint, pointIndex, dragged)
            if (!plan) return
            useScene.getState().updateNodes([
              { id: node.id, data: { path: plan.path } as Partial<unknown> as never },
              {
                id: plan.fittingUpdate.id,
                data: plan.fittingUpdate.data as Partial<unknown> as never,
              },
            ])
            return
          }
          const nextPath = initialPath.map((p, i) => (i === pointIndex ? dragged : p))
          useScene.getState().updateNodes([
            { id: node.id, data: { path: nextPath } as Partial<unknown> as never },
            ...(detached ? [] : followUpdates(nextPath)).map((u) => ({
              id: u.id,
              data: u.data as Partial<unknown> as never,
            })),
          ])
        },
        canCommit() {
          const final = useScene.getState().nodes[node.id] as N | undefined
          return (
            !!final &&
            (final as unknown as { type: string }).type === kind &&
            final.path.length >= 2
          )
        },
      }
    },
  }
}

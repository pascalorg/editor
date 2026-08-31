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

/**
 * Shared "side-move a path segment" floor-plan affordance for polyline
 * distribution kinds (duct-segment / pipe-segment). It is the 2D counterpart
 * of the in-world side-move arrows in the kind's 3D
 * `affordanceTools.selection` handles.
 *
 *  - **move-segment**: slide one segment perpendicular to itself. Both its
 *    vertices translate by the same plan-normal offset (the offset is the
 *    cursor's projection onto the segment normal); neighbours stretch and any
 *    mated joint follows via port connectivity. Grid-snapped (Shift bypasses).
 *
 * The vertices' Y (elevation) is always held — plan editing never changes
 * height, matching the path-point affordance. Behavioral parity with the 3D
 * selection arrows. (Length editing stays on the per-vertex hex handles.)
 *
 * Wired via `def.floorplanAffordances['move-segment']`; the floor-plan
 * builder emits `move-arrow` primitives carrying the segment index so the
 * dispatcher routes pointer-downs here.
 */
export type SegmentMovePayload = {
  /** Index of the segment's first vertex (it spans [i, i+1]). */
  segmentIndex: number
  /** Unit plan normal [nx, nz] the segment slides along. */
  normal: [number, number]
}

type Point = [number, number, number]
type PathShape = { path: ReadonlyArray<readonly [number, number, number]>; id: AnyNodeId }

const inert: FloorplanAffordanceSession = {
  affectedIds: [],
  apply() {},
  canCommit() {
    return false
  },
}

/**
 * Connectivity snapshot + follow-update builder. Endpoints bear ports; an
 * interior segment vertex never does, so the caller passes `analyze: false`
 * to skip the work when neither moved vertex is a run end.
 */
function makeConnectivity<N extends PathShape>(
  node: N,
  nodes: Record<AnyNodeId, AnyNode>,
  analyze: boolean,
): {
  connectivity: PortConnectivity | null
  affectedIds: AnyNodeId[]
  followUpdates: (nextPath: Point[]) => { id: AnyNodeId; data: Partial<AnyNode> }[]
} {
  const connectivity = analyze ? analyzePortConnectivity(node as unknown as AnyNode, nodes) : null
  const affectedIds: AnyNodeId[] = [
    node.id,
    ...(connectivity?.connections.map((c) => c.nodeId) ?? []),
  ]
  const followUpdates = (nextPath: Point[]) => {
    if (!connectivity) return []
    const preview = {
      ...(node as unknown as Record<string, unknown>),
      path: nextPath,
    } as AnyNode
    return resolveConnectivityUpdates(connectivity, preview).filter(
      (u) => useScene.getState().nodes[u.id],
    )
  }
  return { connectivity, affectedIds, followUpdates }
}

export function createSegmentMoveAffordance<N extends PathShape>(
  kind: string,
): FloorplanAffordance<N> {
  return {
    start({ node, payload, nodes }): FloorplanAffordanceSession {
      const { segmentIndex, normal } = payload as SegmentMovePayload
      const initialPath = node.path.map((p) => [...p] as Point)
      const a = initialPath[segmentIndex]
      const b = initialPath[segmentIndex + 1]
      if (!a || !b) return { ...inert, affectedIds: [node.id] }
      const lastIndex = initialPath.length - 1
      // A moved vertex bears a port only if it's a run end.
      const touchesEnd = segmentIndex === 0 || segmentIndex + 1 === lastIndex
      const { affectedIds, followUpdates } = makeConnectivity(node, nodes, touchesEnd)
      const mid: WallPlanPoint = [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2]

      return {
        affectedIds,
        apply({ planPoint, modifiers }) {
          // Project the cursor onto the segment normal — that signed distance
          // is how far the whole segment slides. Grid-snap the magnitude
          // (Shift bypasses) so the slide lands on the same lattice as the
          // other plan tools.
          const signedRaw =
            (planPoint[0] - mid[0]) * normal[0] + (planPoint[1] - mid[1]) * normal[1]
          const signed = modifiers.shiftKey ? signedRaw : snapPointToGrid([signedRaw, 0])[0]
          const ox = normal[0] * signed
          const oz = normal[1] * signed
          const nextPath = initialPath.map((p, i) =>
            i === segmentIndex || i === segmentIndex + 1
              ? ([p[0] + ox, p[1], p[2] + oz] as Point)
              : p,
          )
          useScene.getState().updateNodes([
            { id: node.id, data: { path: nextPath } as Partial<unknown> as never },
            ...followUpdates(nextPath).map((u) => ({
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

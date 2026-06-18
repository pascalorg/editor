import {
  type AnyNodeId,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  useScene,
} from '@pascal-app/core'
import { snapPointToGrid, type WallPlanPoint } from '@pascal-app/editor'

/**
 * Shared "drag a path point" floor-plan affordance for polyline
 * distribution kinds (duct-segment / pipe-segment / lineset). It is the
 * 2D counterpart of their 3D `affordanceTools.selection` handles: one
 * draggable handle per path vertex, moved freely on the plan (XZ) with
 * grid snap (Shift bypasses). The vertex's Y (elevation / slope) is held
 * fixed — plan editing never changes height.
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
    start({ node, payload }): FloorplanAffordanceSession {
      const { pointIndex } = payload as PathPointPayload
      const initialPath = node.path.map((p) => [...p] as [number, number, number])
      const target = initialPath[pointIndex]
      if (!target) return { ...inert, affectedIds: [node.id] }
      // Hold the dragged vertex's elevation — the plan move only shifts XZ.
      const y = target[1]

      return {
        affectedIds: [node.id],
        apply({ planPoint, modifiers }) {
          // Plan coords map x→world X, y→world Z.
          const raw: WallPlanPoint = [planPoint[0], planPoint[1]]
          const [sx, sz] = modifiers.shiftKey ? raw : snapPointToGrid(raw)
          const nextPath = initialPath.map((p, i) =>
            i === pointIndex ? ([sx, y, sz] as [number, number, number]) : p,
          )
          useScene
            .getState()
            .updateNodes([{ id: node.id, data: { path: nextPath } as Partial<unknown> as never }])
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

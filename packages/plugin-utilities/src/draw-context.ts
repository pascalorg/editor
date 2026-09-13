import type { AnyNodeId, GeometryContext } from '@pascal-app/core'
import { frameFromContext } from './frame-context'
import {
  type BuildingFrame,
  IDENTITY_FRAME,
  type LooseNode,
  type LooseNodes,
  resolveFrame,
  siteToLocalPlan,
} from './site-frame'

export type PlanPoint = [number, number]

/**
 * What a utilities 2D symbol builder needs, independent of WHICH surface is
 * asking.
 *
 * Two surfaces ask, in two different coordinate frames:
 *  - `def.floorplan`, dispatched by `FloorplanRegistryLayer`, which draws in
 *    BUILDING-LOCAL metres → `toPlan` is `siteToLocalPlan(frame, ·)`;
 *  - `buildUtilitiesDrawing`, the shared drawing-output contract from
 *    docs/construction-documents.md, which emits SITE metres for the site
 *    plan and for sheets → `toPlan` is the identity.
 *
 * `frame` stays the BUILDING frame in both cases, because it is also used to
 * lift a wall-anchored service point out of wall coordinates. Only `toPlan`
 * differs. Keeping them separate is what stops the site plan and the floor
 * plan disagreeing about where a meter is.
 */
export type UtilitiesDrawContext = {
  frame: BuildingFrame
  toPlan: (site: readonly [number, number]) => PlanPoint
  resolve: (id: string) => LooseNode | undefined
  view?: GeometryContext['viewState']
}

/** Draw context for a `def.floorplan` call — output in building-local metres. */
export function floorplanDrawContext(
  node: LooseNode,
  ctx: GeometryContext,
): UtilitiesDrawContext {
  const frame = frameFromContext(node, ctx)
  return {
    frame,
    toPlan: (site) => siteToLocalPlan(frame, site),
    resolve: (id) => ctx.resolve(id as AnyNodeId) as unknown as LooseNode | undefined,
    ...(ctx.viewState ? { view: ctx.viewState } : {}),
  }
}

/** Draw context for the site-plan / sheet contract — output in SITE metres. */
export function siteDrawContext(nodes: LooseNodes, node: LooseNode): UtilitiesDrawContext {
  return {
    frame: resolveFrame(nodes, node),
    toPlan: (site) => [site[0], site[1]],
    resolve: (id) => nodes[id],
  }
}

/** A context with no scene behind it — used by tests and by empty scenes. */
export const IDENTITY_DRAW_CONTEXT: UtilitiesDrawContext = {
  frame: IDENTITY_FRAME,
  toPlan: (site) => [site[0], site[1]],
  resolve: () => undefined,
}

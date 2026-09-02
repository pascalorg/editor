import {
  type AnyNode,
  type FloorplanMoveTargetSession,
  type SceneApi,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, useEditor } from '@pascal-app/editor'
import { nearestWall } from '../anchor'
import { asNodeId } from '../kind-guards'
import type { ServicePointNode } from '../schema'
import {
  type LooseNode,
  type LooseNodes,
  localToSitePlan,
  resolveFrame,
  siteToLocalPlan,
} from '../site-frame'

/**
 * How far from a wall centreline a dragged service point still lands ON that
 * wall, metres. Same radius the placement tool uses, so dragging and placing
 * agree about what counts as "near a wall".
 */
export const WALL_REHOST_RADIUS = 1.5

/** The anchor a plan position resolves to: a wall slot, or free-standing. */
export type ServicePointDrop =
  | { kind: 'wall'; wallId: string; wallT: number }
  | { kind: 'free'; position: [number, number, number] }

/**
 * Where a service point dropped at a BUILDING-LOCAL plan point belongs.
 *
 * Within `WALL_REHOST_RADIUS` of any wall it re-hosts onto that wall and
 * slides to the projected `wallT` — which is both behaviours the brief asks
 * for, and they are the same operation: `nearestWall` does not care whether
 * the wall it finds is the one the point is already on.
 *
 * Pure, so the 2D move, the 3D move's commit hook and the tests all decide
 * the same way.
 */
export function resolveServicePointDrop(
  nodes: LooseNodes,
  localPlan: readonly [number, number],
  sitePlan: readonly [number, number],
  height: number,
  radius = WALL_REHOST_RADIUS,
): ServicePointDrop {
  const hit = nearestWall(nodes, localPlan, radius)
  if (hit) return { kind: 'wall', wallId: hit.geom.id, wallT: hit.t }
  return { kind: 'free', position: [sitePlan[0], height, sitePlan[1]] }
}

/** The scene patch a drop writes. A wall drop resets `position` to the
 * sentinel so the anchor is authoritative again (see `anchor.ts`). */
export function servicePointDropPatch(drop: ServicePointDrop): Record<string, unknown> {
  return drop.kind === 'wall'
    ? { wallId: drop.wallId, wallT: drop.wallT, position: [0, 0, 0] }
    : { wallId: null, wallT: null, position: drop.position }
}

/**
 * 2D move for a service point.
 *
 * Preview writes `position` only — that is what makes the meter follow the
 * cursor, because a live `position` off the sentinel outranks the wall anchor
 * (`anchor.ts`). Commit converts that position into an anchor: back onto its
 * own wall at the new `wallT`, onto a DIFFERENT wall if one is nearer, or
 * free-standing if none is within `WALL_REHOST_RADIUS`.
 *
 * Any run linked to this point re-derives its endpoint from the override on
 * every frame, so the drop moves with the meter live rather than snapping
 * after the fact.
 */
export function servicePointFloorplanMove({
  node,
  nodes,
}: {
  node: ServicePointNode
  nodes: Readonly<Record<string, unknown>>
}): FloorplanMoveTargetSession {
  const loose = nodes as unknown as LooseNodes
  const frame = resolveFrame(loose, node as unknown as LooseNode)
  let drop: ServicePointDrop | null = null

  return {
    affectedIds: [asNodeId(node.id)],
    apply({ planPoint, modifiers }) {
      const step = modifiers.altKey || !isGridSnapActive() ? 0 : useEditor.getState().gridSnapStep
      const local: [number, number] =
        step > 0
          ? [Math.round(planPoint[0] / step) * step, Math.round(planPoint[1] / step) * step]
          : [planPoint[0], planPoint[1]]
      const site = localToSitePlan(frame, local)
      // Alt is the escape hatch: hold it and the point stays free-standing
      // instead of being pulled onto whatever wall is nearest.
      drop = modifiers.altKey
        ? { kind: 'free', position: [site[0], node.height, site[1]] }
        : resolveServicePointDrop(loose, local, site, node.height)
      // The preview always follows the cursor, wall or not. Snapping the
      // preview onto the wall slot would hide which wall the drop will pick.
      useLiveNodeOverrides
        .getState()
        .set(asNodeId(node.id), { position: [site[0], node.height, site[1]] })
    },
    canCommit: () => drop !== null,
    commit() {
      const resolved = drop
      useLiveNodeOverrides.getState().clear(asNodeId(node.id))
      if (resolved) {
        useScene.getState().updateNode(asNodeId(node.id), servicePointDropPatch(resolved) as never)
      }
    },
  }
}

/**
 * The 3D move's commit hook.
 *
 * The host move tool has already written the dragged `position` (in site
 * metres, via `movable.parentFrame`) by the time this runs. Turn it back into
 * a wall anchor exactly the way the 2D path does, so the two gestures cannot
 * disagree — `move-registry-node-tool.tsx:877` calls this inside the resumed
 * history window, so the re-anchor is one undo step with the move.
 */
export function servicePointMoveCommit(node: AnyNode, parent: AnyNode, sceneApi: SceneApi): void {
  const point = node as unknown as ServicePointNode
  const loose = sceneApi.nodes() as unknown as LooseNodes
  const frame = resolveFrame(loose, point as unknown as LooseNode)
  const site: [number, number] = [point.position[0], point.position[2]]
  const local = siteToLocalPlan(frame, site)
  const drop = resolveServicePointDrop(loose, local, site, point.height)
  sceneApi.update(asNodeId(point.id), servicePointDropPatch(drop) as never)
  void parent
}

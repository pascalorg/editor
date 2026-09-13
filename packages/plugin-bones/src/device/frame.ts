import {
  isMovedPosition,
  nearestUsableWall,
  projectWallT,
  usableWall,
  wallAngle,
  wallGeom,
  wallPointAt,
} from '../service/placement'

/**
 * Door-style drag frame for `bones:device` nodes — the same
 * `capabilities.movable.parentFrame` contract the service points use
 * (service/frame.ts, host source core registry/types.ts): the plan cursor
 * projects onto the wall axis (clamped 0..1), the proxy box rides the wall
 * live through `useLiveNodeOverrides`, and the commit writes ONE tracked
 * update — `position` = the on-axis plan point the tool projected through
 * `planToLocal`. The RECONCILER (device/place.ts) then converts that point
 * into the wall anchor (`wallId` + `wallT`, position reset to [0,0,0]) inside
 * its history-paused batch.
 *
 * DELIBERATELY NO `onCommit` (night-5 D2/D3 root cause): the host's
 * MoveRegistryNodeTool runs its `parentFrame.onCommit` branch with history
 * RESUMED and follows it with `updateNode(parentWall, resolveSupportSlabPatch)`
 * — a semantic no-op patch that nonetheless flags the WALL as a scene-commit
 * candidate. That flag wakes the host's space-detection sync mid-commit
 * (`initSpaceDetectionSync`, core lib/space-detection.ts), which rewrites
 * every unclassified wall's `frontSide`/`backSide` and materializes zone
 * schema defaults — partly as a TRACKED history entry. Net effect measured on
 * the night-4 scene: one outlet drag = THREE undo entries and the engine's
 * counts drifting 1255·77 → 1218·79 (walls flipping exterior-ness under the
 * engines), with Cmd+Z landing a third corrupted state (1207·74). Dropping
 * `onCommit` skips that whole host branch: one drag = one tracked write, and
 * the anchor conversion happens where every other derived-state write lives —
 * the paused reconcile batch, which space detection treats as a new baseline
 * instead of an edit.
 *
 * `heightAff` is deliberately NOT touched by the commit: the host move tool
 * is planar (localY passes through untouched), so height edits ride the
 * inspector's heightAff slider — any write there differs from the seed and
 * the engine clamps it into the legal band (electrical.ts height bands).
 *
 * The moment the committed anchor differs from the node's SEED anchor, the
 * node becomes an engine override (device/overrides.ts) and the wiring
 * re-routes to wherever the box snapped.
 */

type LooseNode = Record<string, unknown>
type LooseNodes = Readonly<Record<string, LooseNode>>

/** Plugin-local mirror of the host's MovableParentFrame contract (the pinned
 * @pascal-app/core types predate it — cast at the attach point, like the
 * service definition does). `onCommit` is part of the host contract but is
 * OPTIONAL — and intentionally absent here (see the module doc). */
export type DeviceParentFrame = {
  resolveParent: (node: LooseNode, nodes: LooseNodes) => LooseNode | null
  parentRotationY: (parent: LooseNode, nodes?: LooseNodes) => number
  localToPlan: (
    parent: LooseNode,
    local: readonly [number, number, number],
    nodes?: LooseNodes,
  ) => [number, number, number]
  planToLocal: (
    parent: LooseNode,
    planX: number,
    localY: number,
    planZ: number,
    nodes?: LooseNodes,
  ) => [number, number, number]
  onCommit?: (
    node: LooseNode,
    parent: LooseNode,
    sceneApi: { update: (id: string, patch: Record<string, unknown>) => void },
  ) => void
}

type AnchorNode = { parentId?: string | null; position?: readonly unknown[] }

/**
 * The wall the drag rides — mirrors the device placement precedence: a moved
 * (non-default) `position` resolves to the NEAREST usable wall, a default
 * position resolves the stored `wallId` anchor. Unresolvable → null → the
 * host falls back to a plain plan-frame move.
 */
export function resolveDeviceParent(node: LooseNode, nodes: LooseNodes): LooseNode | null {
  if (typeof node.deviceId !== 'string') return null
  const anchor = node as AnchorNode
  const position = anchor.position
  if (isMovedPosition(position as readonly unknown[] | undefined)) {
    const p = position as readonly [number, number, number]
    const hit = nearestUsableWall(
      nodes as Record<string, Record<string, unknown>>,
      anchor,
      [p[0], p[2]],
    )
    return hit ? (nodes[hit.wallId] ?? null) : null
  }
  const wall = typeof node.wallId === 'string' ? nodes[node.wallId] : undefined
  return wall && usableWall(wall, anchor) ? wall : null
}

/** Project a plan point onto the parent wall's axis (clamped 0..1) —
 * idempotent, so the live preview and the commit agree (service/frame.ts). */
function projectToAxis(
  parent: LooseNode,
  planX: number,
  localY: number,
  planZ: number,
): [number, number, number] {
  const geom = wallGeom(parent)
  if (!geom) return [planX, localY, planZ]
  const t = projectWallT(geom, [planX, planZ])
  const [x, z] = wallPointAt(geom, t)
  return [x, localY, z]
}

export const deviceParentFrame: DeviceParentFrame = {
  resolveParent: resolveDeviceParent,

  parentRotationY: (parent) => {
    const geom = wallGeom(parent)
    return geom ? wallAngle(geom) : 0
  },

  localToPlan: (parent, local) => projectToAxis(parent, local[0], local[1], local[2]),

  planToLocal: (parent, planX, localY, planZ) => projectToAxis(parent, planX, localY, planZ),

  // NO onCommit — see the module doc. The reconciler normalizes the committed
  // position into wallId/wallT inside its history-paused batch instead.
}

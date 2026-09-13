import {
  isMovedPosition,
  nearestUsableWall,
  projectWallT,
  type ServicePlacementNode,
  usableWall,
  WALL_MOUNTED_TYPES,
  wallAngle,
  wallGeom,
  wallPointAt,
} from './placement'

/**
 * Door-style drag frame for wall-mounted `bones:service` nodes — the host's
 * `capabilities.movable.parentFrame` (MovableParentFrame) contract. With it,
 * the generic MoveRegistryNodeTool slides a panel / water heater / meter
 * ALONG ITS WALL like a door: the plan cursor projects onto the wall axis
 * (clamped 0..1), the live preview flows through `useLiveNodeOverrides`
 * (the renderer merges the override and re-resolves placement — the box and
 * both sign plates track the cursor on the wall), and the commit writes ONE
 * tracked update: `position` = the on-axis plan point. The X-ray's reconcile
 * effect then converts that point into the wall anchor (`wallId` + `wallT`,
 * position reset to [0,0,0]) inside its history-paused batch
 * (service/normalize.ts) — which keeps the "wallT inert after a gizmo drag"
 * quirk retired without minting a second history entry.
 *
 * DELIBERATELY NO `onCommit` (night-5 D2/D3 root cause, see device/frame.ts
 * for the full write trace): the host runs the `parentFrame.onCommit` branch
 * with history RESUMED and follows it with an `updateNode(parentWall,
 * resolveSupportSlabPatch)` no-op patch that flags the WALL as a commit
 * candidate — waking the space-detection sync mid-commit, which rewrites
 * unclassified walls' `frontSide`/`backSide` + zone defaults (partly TRACKED).
 * That is what made a night-4 PANEL drag drop the device count 77 → 74 and an
 * outlet drag mint three undo entries. No `onCommit` ⇒ that branch never runs.
 *
 * The pinned @pascal-app/core (0.9.1) predates `MovableParentFrame` /
 * `cursorAttached` in its published types, so the contract is mirrored here
 * (host source: core registry/types.ts) and cast at the attach point in
 * definition.ts — same runtime shape, plugin-local type safety.
 *
 * Floor-placed types (sewer exit, heat pump) return a null parent from
 * `resolveParent`, which the host reads as "move in the plan frame" — their
 * plain moves are unchanged.
 */

type LooseNode = Record<string, unknown>
type LooseNodes = Readonly<Record<string, LooseNode>>

/** Plugin-local mirror of the host's MovableParentFrame contract. `onCommit`
 * is part of the host contract but OPTIONAL — and intentionally absent here
 * (see the module doc). */
export type ServiceParentFrame = {
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

const asService = (node: LooseNode): (ServicePlacementNode & { id?: unknown }) | null => {
  const serviceType = node.serviceType
  return typeof serviceType === 'string'
    ? (node as unknown as ServicePlacementNode & { id?: unknown })
    : null
}

/**
 * The wall the drag should ride, mirroring `resolveServicePlacement`'s own
 * precedence so the drag starts on the wall the box is actually rendered
 * against: a moved (non-default) `position` resolves to the NEAREST usable
 * wall; a default position resolves the stored `wallId` anchor. Floor types
 * and unresolvable anchors (missing / curved / foreign wall) → null → the
 * host falls back to a plain plan-frame move.
 */
export function resolveServiceParent(node: LooseNode, nodes: LooseNodes): LooseNode | null {
  const service = asService(node)
  if (!service) return null
  if (!WALL_MOUNTED_TYPES.has(service.serviceType)) return null
  if (isMovedPosition(service.position)) {
    const hit = nearestUsableWall(
      nodes as Record<string, Record<string, unknown>>,
      service,
      [service.position[0], service.position[2]],
    )
    return hit ? (nodes[hit.wallId] ?? null) : null
  }
  const wall = typeof service.wallId === 'string' ? nodes[service.wallId] : undefined
  return wall && usableWall(wall, service) ? wall : null
}

/** Project a plan point onto the parent wall's axis (clamped 0..1). The
 * "local" frame IS plan coordinates constrained to the wall axis — so the
 * host's `position` live-override previews through the renderer's existing
 * nearest-wall resolution with zero extra wiring. Idempotent: projecting a
 * point already on the axis returns it unchanged (round-trip stable). */
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

export const serviceParentFrame: ServiceParentFrame = {
  resolveParent: resolveServiceParent,

  parentRotationY: (parent) => {
    const geom = wallGeom(parent)
    return geom ? wallAngle(geom) : 0
  },

  localToPlan: (parent, local) => projectToAxis(parent, local[0], local[1], local[2]),

  planToLocal: (parent, planX, localY, planZ) => projectToAxis(parent, planX, localY, planZ),

  // NO onCommit — see the module doc. The X-ray reconcile effect normalizes
  // the committed position into wallId/wallT (service/normalize.ts) inside
  // its history-paused batch instead.
}

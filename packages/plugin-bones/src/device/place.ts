import { isMovedPosition, nearestUsableWall } from '../service/placement'
import type { DerivedDevice } from './derive'
import { isMovedDeviceNode } from './overrides'
import { DeviceNode } from './schema'

/**
 * Reconcile the level's `bones:device` nodes against the engine's derived
 * device manifest — the movable-outlets analog of `buildServicePointNodes`
 * (service/place.ts), extended from a one-shot seeding action into a diff so
 * EVERY derived wall device stays hoverable/draggable as the scene evolves:
 *
 *  - CREATE a node (at the derived anchor, seed = anchor) for every derived
 *    device that has none — creation alone never moves anything (the engine
 *    ignores unmoved nodes, checklist parity with A4's idempotent seeding);
 *  - NORMALIZE a drag-committed `position` into the wall anchor: the host
 *    move tool's commit writes the on-axis plan point into `position` (the
 *    drag frame has NO onCommit — device/frame.ts explains the host
 *    space-detection cascade that retired it); the reconciler converts it to
 *    `wallId` + `wallT` and resets position to [0,0,0]. Same spot, different
 *    encoding — the user's move is never altered, only re-keyed to the
 *    anchor form the inspector slider and the engines read. Runs in the
 *    history-paused batch, so a drag stays ONE undo entry;
 *  - RE-SEAT nodes the user has NOT moved (anchor still equals seed) when
 *    the derivation changed under them — walls edited, openings added;
 *  - NEVER touch a moved node's anchor (it is the user's override); only its
 *    derived `deviceKind` keeps following the engine (a GFCI zone change
 *    re-labels the same moved box);
 *  - REMOVE orphans whose deviceId no longer derives, and duplicate nodes of
 *    one deviceId (lowest id wins — the extraction's winner stays).
 *
 * Pure: returns the plan; the caller (FramingRenderer's reconcile effect)
 * applies it through the host scene API in one batch.
 */

const EPS = 1e-6

type LooseNode = Record<string, unknown>

export type DeviceReconciliation = {
  create: DeviceNode[]
  update: { id: string; data: Record<string, unknown> }[]
  remove: string[]
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The level's visible bones:device nodes, keyed by deviceId (lowest node id
 * wins — extraction parity); extras land in `extras` for removal. */
function indexDeviceNodes(
  nodes: Record<string, LooseNode>,
  levelId: string,
): { byDeviceId: Map<string, LooseNode>; extras: string[] } {
  const byDeviceId = new Map<string, LooseNode>()
  const extras: string[] = []
  for (const node of Object.values(nodes)) {
    if (node.type !== 'bones:device' || node.parentId !== levelId) continue
    const deviceId = typeof node.deviceId === 'string' ? node.deviceId : ''
    if (!deviceId) continue
    const current = byDeviceId.get(deviceId)
    if (!current) {
      byDeviceId.set(deviceId, node)
      continue
    }
    // duplicate: keep the lowest id (the extraction's winner), drop the other
    if (String(node.id ?? '') < String(current.id ?? '')) {
      extras.push(String(current.id ?? ''))
      byDeviceId.set(deviceId, node)
    } else {
      extras.push(String(node.id ?? ''))
    }
  }
  return { byDeviceId, extras }
}

export function reconcileDeviceNodes(
  nodes: Record<string, LooseNode>,
  levelId: string,
  derived: DerivedDevice[],
): DeviceReconciliation {
  const { byDeviceId, extras } = indexDeviceNodes(nodes, levelId)
  const create: DeviceNode[] = []
  const update: { id: string; data: Record<string, unknown> }[] = []
  const remove: string[] = [...extras]

  const derivedIds = new Set(derived.map((d) => d.deviceId))

  for (const d of derived) {
    const node = byDeviceId.get(d.deviceId)
    if (!node) {
      create.push(
        DeviceNode.parse({
          deviceId: d.deviceId,
          deviceKind: d.deviceKind,
          wallId: d.wallId,
          wallT: d.wallT,
          heightAff: d.heightAff,
          seedWallId: d.wallId,
          seedWallT: d.wallT,
          seedHeightAff: d.heightAff,
        }),
      )
      continue
    }
    const id = String(node.id ?? '')
    if (!id) continue
    const data: Record<string, unknown> = {}
    // deviceKind is DERIVED — it follows the engine on moved nodes too.
    if (node.deviceKind !== d.deviceKind) data.deviceKind = d.deviceKind
    // Drag-commit normalization: a moved (non-default) position converts to
    // the equivalent wall anchor — the exact projection the renderer's
    // position path draws (nearestUsableWall), so the box never moves.
    // Converges: once position is [0,0,0] this branch is dead.
    if (isMovedPosition(node.position as readonly unknown[] | undefined)) {
      const p = node.position as readonly [number, number, number]
      const hit = nearestUsableWall(
        nodes as Record<string, Record<string, unknown>>,
        node as { parentId?: string | null },
        [p[0], p[2]],
      )
      if (hit) {
        data.wallId = hit.wallId
        data.wallT = hit.t
        data.position = [0, 0, 0]
      }
      // No usable wall: leave the position — the engines' position-wins
      // path (movedOverridePosition) still resolves it.
    }
    if (!isMovedDeviceNode(node)) {
      // Unmoved = the node tracks auto-placement: re-seat anchor AND seed
      // when the derivation drifted (a wall edit moved the derived spot).
      const drifted =
        node.wallId !== d.wallId ||
        !finite(node.wallT) ||
        Math.abs(node.wallT - d.wallT) > EPS ||
        !finite(node.heightAff) ||
        Math.abs(node.heightAff - d.heightAff) > EPS
      if (drifted) {
        data.wallId = d.wallId
        data.wallT = d.wallT
        data.heightAff = d.heightAff
        data.seedWallId = d.wallId
        data.seedWallT = d.wallT
        data.seedHeightAff = d.heightAff
      }
    }
    if (Object.keys(data).length > 0) update.push({ id, data })
  }

  // Orphans: the deviceId no longer derives (wall deleted, opening removed,
  // electrical layout changed) — nothing left to override.
  for (const [deviceId, node] of byDeviceId) {
    if (derivedIds.has(deviceId)) continue
    const id = String(node.id ?? '')
    if (id) remove.push(id)
  }

  return { create, update, remove }
}

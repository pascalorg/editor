import {
  type AnyNode,
  type AnyNodeId,
  analyzePortConnectivity,
  type PortConnectivity,
  resolveConnectivityUpdates,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'

type Vec3 = [number, number, number]

/** Live transform of the moved node for a given drag frame — whichever of
 *  `path` (runs) or `position` (fittings) the node moves by. */
type MovedTransform = { path?: Vec3[]; position?: Vec3 }

/**
 * Connectivity follow for whole-node ghost move tools (duct / pipe /
 * lineset `MoveTool`, and the duct-fitting `MoveTool`). When you grab a
 * committed run or fitting by its floating move button and slide it, the
 * shared port-connectivity service walks the joint graph and produces the
 * patches that keep neighbours welded:
 *
 * - Moving a **run**: both endpoints translate by the same delta, so any
 *   fitting mated to either end follows rigidly and the OTHER runs on those
 *   fittings stretch / translate per the axis-decomposition rules.
 * - Moving a **fitting**: its collars push the connected runs — the part of
 *   the move along a run's axis stretches it, the part across translates the
 *   whole run (preserving its direction), and that perpendicular part carries
 *   on to whatever is mated to the run's far end.
 *
 * The moved node's own transform drives the snapshot. Followers preview
 * through `useLiveNodeOverrides` (transient — no history churn;
 * `getEffectiveNode` merges overrides so the connected geometry rebuilds at
 * pointer rate), then fold into the commit's single tracked `updateNodes`
 * batch.
 *
 * Returns `null` when nothing is connected, so callers skip all the work.
 */
export function startRunMoveConnectivity(node: AnyNode): RunMoveConnectivity | null {
  const snapshot = analyzePortConnectivity(node, useScene.getState().nodes)
  if (snapshot.connections.length === 0) return null
  return new RunMoveConnectivity(node, snapshot)
}

export class RunMoveConnectivity {
  private overriddenIds: AnyNodeId[] = []

  constructor(
    private readonly node: AnyNode,
    private readonly connectivity: PortConnectivity,
  ) {}

  /** Patches that keep the connected nodes attached for a given live transform. */
  private updatesFor(transform: MovedTransform): { id: AnyNodeId; data: Partial<AnyNode> }[] {
    const preview = { ...(this.node as Record<string, unknown>), ...transform } as AnyNode
    return resolveConnectivityUpdates(this.connectivity, preview).filter(
      (u) => useScene.getState().nodes[u.id],
    )
  }

  /** Live-preview the followers for the moved node's current drag transform. */
  preview(transform: MovedTransform): void {
    const updates = this.updatesFor(transform)
    const overrides = useLiveNodeOverrides.getState()
    const nextIds = updates.map((u) => u.id)
    // Drop overrides on nodes that fell out of this frame's update set (e.g. a
    // follower that returned to its origin resolves to a no-op delta).
    for (const id of this.overriddenIds) {
      if (!nextIds.includes(id)) {
        overrides.clear(id)
        if (useScene.getState().nodes[id]) useScene.getState().markDirty(id)
      }
    }
    if (updates.length > 0) {
      overrides.setMany(updates.map((u) => [u.id, u.data as Record<string, unknown>] as const))
      for (const u of updates) {
        if (useScene.getState().nodes[u.id]) useScene.getState().markDirty(u.id)
      }
    }
    this.overriddenIds = nextIds
  }

  /** Follower patches to fold into the commit `updateNodes` batch. */
  commitUpdates(transform: MovedTransform): { id: AnyNodeId; data: Partial<AnyNode> }[] {
    return this.updatesFor(transform)
  }

  /** Drop all live overrides (commit clears them once the scene write lands;
   *  cancel / unmount clears them to reveal the unchanged followers). */
  clear(): void {
    const overrides = useLiveNodeOverrides.getState()
    for (const id of this.overriddenIds) {
      overrides.clear(id)
      if (useScene.getState().nodes[id]) useScene.getState().markDirty(id)
    }
    this.overriddenIds = []
  }
}

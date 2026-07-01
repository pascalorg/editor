import {
  type AnyNodeId,
  type FenceNode,
  type FloorplanMoveTarget,
  type FloorplanMoveTargetSession,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  getSegmentGridStep,
  isGridSnapActive,
  isSegmentLongEnough,
  snapPointToGrid,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

type PlanPoint = [number, number]

function pointsEqual(a: PlanPoint, b: PlanPoint): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

type LinkedFenceSnapshot = { id: AnyNodeId; start: PlanPoint; end: PlanPoint; path?: PlanPoint[] }

function getLinkedFenceSnapshots(args: {
  fenceId: AnyNodeId
  parentId: string | null
  originalStart: PlanPoint
  originalEnd: PlanPoint
}): LinkedFenceSnapshot[] {
  const { fenceId, parentId, originalStart, originalEnd } = args
  const { nodes } = useScene.getState()
  const snapshots: LinkedFenceSnapshot[] = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'fence' || node.id === fenceId) continue
    if ((node.parentId ?? null) !== parentId) continue
    const fence = node as FenceNode
    if (
      pointsEqual(fence.start as PlanPoint, originalStart) ||
      pointsEqual(fence.start as PlanPoint, originalEnd) ||
      pointsEqual(fence.end as PlanPoint, originalStart) ||
      pointsEqual(fence.end as PlanPoint, originalEnd)
    ) {
      snapshots.push({
        id: fence.id as AnyNodeId,
        start: [fence.start[0], fence.start[1]],
        end: [fence.end[0], fence.end[1]],
        path: fence.path?.map((point) => [point[0], point[1]]),
      })
    }
  }
  return snapshots
}

function translatePath(
  path: PlanPoint[] | undefined,
  dx: number,
  dz: number,
): PlanPoint[] | undefined {
  return path?.map((point) => [point[0] + dx, point[1] + dz])
}

/**
 * 2D floor-plan body move for fence. Mirrors `wallFloorplanMoveTarget`
 * but without bridge-wall planning: fence corners cascade through
 * shared endpoints, ALT detaches them, and there's no perpendicular
 * branch logic to chase. Tick publishes endpoint overrides; commit
 * folds them into a single tracked update.
 */
export const fenceFloorplanMoveTarget: FloorplanMoveTarget<FenceNode> = ({ node }) => {
  const fenceId = node.id as AnyNodeId
  const originalStart: PlanPoint = [node.start[0], node.start[1]]
  const originalEnd: PlanPoint = [node.end[0], node.end[1]]
  const originalMetadata =
    typeof node.metadata === 'object' && node.metadata !== null && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {}
  const isNew = !!originalMetadata.isNew

  const linkedOriginals: LinkedFenceSnapshot[] = isNew
    ? []
    : getLinkedFenceSnapshots({
        fenceId,
        parentId: node.parentId ?? null,
        originalStart,
        originalEnd,
      })

  let rawAnchor: PlanPoint | null = null
  let lastDelta: PlanPoint = [0, 0]
  let lastNextStart: PlanPoint = originalStart
  let lastNextEnd: PlanPoint = originalEnd
  let lastNextPath: PlanPoint[] | undefined = node.path?.map((point) => [point[0], point[1]])

  const projectLinked = (
    snapshot: LinkedFenceSnapshot,
    nextStart: PlanPoint,
    nextEnd: PlanPoint,
    dx: number,
    dz: number,
  ): { start: PlanPoint; end: PlanPoint; path?: PlanPoint[] } => {
    const start = pointsEqual(snapshot.start, originalStart)
      ? nextStart
      : pointsEqual(snapshot.start, originalEnd)
        ? nextEnd
        : snapshot.start
    const end = pointsEqual(snapshot.end, originalStart)
      ? nextStart
      : pointsEqual(snapshot.end, originalEnd)
        ? nextEnd
        : snapshot.end

    return {
      start,
      end,
      path: translatePath(snapshot.path, dx, dz),
    }
  }

  const session: FloorplanMoveTargetSession = {
    affectedIds: [fenceId, ...linkedOriginals.map((l) => l.id)],

    apply({ planPoint, modifiers }) {
      if (!rawAnchor) {
        rawAnchor = [planPoint[0], planPoint[1]]
        return
      }
      const rawDx = planPoint[0] - rawAnchor[0]
      const rawDz = planPoint[1] - rawAnchor[1]
      const step = isGridSnapActive() ? getSegmentGridStep() : 0
      const nextStart = snapPointToGrid([originalStart[0] + rawDx, originalStart[1] + rawDz], step)
      const dx = nextStart[0] - originalStart[0]
      const dz = nextStart[1] - originalStart[1]
      if (dx === lastDelta[0] && dz === lastDelta[1]) return
      lastDelta = [dx, dz]
      const nextEnd: PlanPoint = [originalEnd[0] + dx, originalEnd[1] + dz]
      lastNextStart = nextStart
      lastNextEnd = nextEnd
      lastNextPath = translatePath(
        node.path?.map((point) => [point[0], point[1]]),
        dx,
        dz,
      )

      const linkedUpdates = modifiers.altKey
        ? []
        : linkedOriginals.map((l) => ({
            id: l.id,
            ...projectLinked(l, nextStart, nextEnd, dx, dz),
          }))

      useLiveNodeOverrides
        .getState()
        .setMany([
          [fenceId, { start: nextStart, end: nextEnd, path: lastNextPath }],
          ...linkedUpdates.map(
            (u) =>
              [u.id, { start: u.start, end: u.end, path: u.path }] as [
                string,
                Record<string, unknown>,
              ],
          ),
        ])
      const sceneState = useScene.getState()
      sceneState.markDirty(fenceId)
      for (const u of linkedUpdates) sceneState.markDirty(u.id)
    },

    canCommit() {
      const [dx, dz] = lastDelta
      return (dx !== 0 || dz !== 0) && isSegmentLongEnough(lastNextStart, lastNextEnd)
    },

    commit() {
      // The overlay (see `floorplan-registry-move-overlay.tsx`) has already
      // (a) written the snapshot back to scene to establish a clean
      // baseline for the single-undo dance and (b) resumed history.
      // This `updateNodes` IS the final-state write — recorded as one
      // tracked change. Drop the override AFTER the scene write so
      // mid-commit reads still see the new position (override wins until
      // cleared; scene wins after).
      const fenceUpdate: { id: AnyNodeId; data: Partial<FenceNode> } = isNew
        ? {
            id: fenceId,
            data: {
              start: lastNextStart,
              end: lastNextEnd,
              path: lastNextPath,
              metadata: { ...originalMetadata, isNew: false },
            } as Partial<FenceNode>,
          }
        : { id: fenceId, data: { start: lastNextStart, end: lastNextEnd, path: lastNextPath } }
      const linkedUpdates = linkedOriginals.map((l) => ({
        id: l.id,
        ...projectLinked(l, lastNextStart, lastNextEnd, lastDelta[0], lastDelta[1]),
      }))
      useScene.getState().updateNodes([
        fenceUpdate,
        ...linkedUpdates.map((u) => ({
          id: u.id,
          data: { start: u.start, end: u.end, path: u.path },
        })),
      ])
      const overrides = useLiveNodeOverrides.getState()
      overrides.clear(fenceId)
      for (const l of linkedOriginals) overrides.clear(l.id)
      // Re-select the moved fence so selection-gated chrome (endpoint
      // handles, side arrows, curve dot) remains visible at the new
      // position — the action menu's Move click cleared selection on
      // entry. Matches the wall move-target's post-commit re-select.
      useViewer.getState().setSelection({ selectedIds: [fenceId] })
    },
  }
  return session
}

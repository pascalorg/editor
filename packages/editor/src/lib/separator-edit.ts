import {
  type AnyNode,
  type AnyNodeId,
  joinedSeparatorIds,
  runAsSingleSceneHistoryStep,
  type SeparatorNode,
  setSeparatorEnd,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
  type WallPlanPoint,
} from '@pascal-app/core'
import { runRoomHandleDrag } from './room-handle-drag'
import { applyRoomPlan } from './room-structure-commands'
import { levelSeparatorLines } from './separator-lines'
import { isWallRunFree, publishWallRunFeedback, snapWallRunDraftPoint } from './wall-run-snap'

/** Scope label of an invisible wall's end drag (its 3D grip). */
export const SEPARATOR_END_DRAG_LABEL = 'separator-end'

const SAME_POINT = 1e-6

export type SeparatorEndDrag = {
  /** The invisible walls the drag may move: the dragged one and those it can carry. */
  affectedIds: AnyNodeId[]
  /** Snaps the end to `point` (level plan) and previews it; `detach` (Alt) leaves the joined ones. */
  move: (point: WallPlanPoint, detach: boolean) => void
  /** Whether the end has moved somewhere it may stay. */
  canCommit: () => boolean
  /** Writes the end as one undo step; false when it did not move or core refused it. */
  commit: () => boolean
  /** Drops the preview; writes nothing. */
  cancel: () => void
}

/**
 * An invisible wall's end dragged: its handle on the plan, its grip in 3D. The
 * end snaps as a wall run does — square to the house or to its own line, its
 * length on the grid, onto wall and invisible-wall ends and bodies, so it
 * comes back together on its old corner — the invisible walls joined at that
 * end follow it live, and the release writes it once (`setSeparatorEnd`).
 * The scene is untouched until then.
 */
export function beginSeparatorEndDrag(
  separatorId: string,
  endpoint: 'start' | 'end',
): SeparatorEndDrag | null {
  const nodes = useScene.getState().nodes
  const separator = nodes[separatorId as AnyNodeId]
  if (separator?.type !== 'separator') return null
  const from = separator[endpoint]
  const fixed = endpoint === 'start' ? separator.end : separator.start
  const levelId = separator.parentId
  const atFrom = (point: WallPlanPoint) =>
    Math.abs(point[0] - from[0]) <= SAME_POINT && Math.abs(point[1] - from[1]) <= SAME_POINT
  const others = Object.values(nodes).filter(
    (node): node is SeparatorNode =>
      node.type === 'separator' && node.parentId === levelId && node.id !== separator.id,
  )
  // The ends following this one are no snap targets while they do: they sit where it left.
  const joined = joinedSeparatorIds(nodes, separator, endpoint)
  const walls = Object.values(nodes).filter(
    (node): node is WallNode => node.type === 'wall' && node.parentId === levelId,
  )
  const targets = {
    attached: [
      ...walls,
      ...levelSeparatorLines(nodes, levelId, new Set([separator.id, ...joined])),
    ],
    detached: [...walls, ...levelSeparatorLines(nodes, levelId, new Set([separator.id]))],
  }
  const length = Math.hypot(from[0] - fixed[0], from[1] - fixed[1])
  const reference: WallPlanPoint | null =
    length > 1e-9 ? [(from[0] - fixed[0]) / length, (from[1] - fixed[1]) / length] : null
  let target: { point: WallPlanPoint; detach: boolean } | null = null
  const previewIds = new Set<AnyNodeId>()
  const preview = (updates: Array<[AnyNodeId, Partial<AnyNode>]>) => {
    const overrides = useLiveNodeOverrides.getState()
    const next = new Set(updates.map(([id]) => id))
    for (const id of previewIds) {
      if (next.has(id)) continue
      overrides.clear(id)
      useScene.getState().markDirty(id)
      previewIds.delete(id)
    }
    if (updates.length) overrides.setMany(updates)
    for (const id of next) {
      previewIds.add(id)
      useScene.getState().markDirty(id)
    }
  }
  return {
    affectedIds: [separator.id, ...others.map((node) => node.id)] as AnyNodeId[],
    move(point, detach) {
      const snap = snapWallRunDraftPoint({
        point,
        start: fixed,
        runStart: fixed,
        reference,
        walls: detach ? targets.detached : targets.attached,
        free: isWallRunFree(null),
      })
      publishWallRunFeedback(snap)
      const plan = setSeparatorEnd(nodes, { separatorId, endpoint, point: snap.point, detach })
      if (plan.conflicts?.length) {
        target = null
        preview([])
        return
      }
      target = { point: snap.point, detach }
      preview(
        plan.changes.flatMap(
          (change): Array<[AnyNodeId, Partial<AnyNode>]> =>
            change.op === 'update' ? [[change.id as AnyNodeId, change.data]] : [],
        ),
      )
    },
    canCommit: () => !!target && !atFrom(target.point),
    commit() {
      preview([])
      publishWallRunFeedback(null)
      if (!target || atFrom(target.point)) return false
      const current = useScene.getState().nodes
      if (current[separatorId as AnyNodeId]?.type !== 'separator') return false
      const plan = setSeparatorEnd(current, { separatorId, endpoint, ...target })
      return runAsSingleSceneHistoryStep(useScene, () => applyRoomPlan(plan))
    },
    cancel() {
      preview([])
      publishWallRunFeedback(null)
    },
  }
}

/**
 * An invisible wall's 3D end grip: `toPlan` reads the pointer on the floor the
 * separator lies on, in level plan metres. One gesture under the lifecycle
 * owner (Escape or ⌘Z cancels), one undo step; Alt leaves the joined
 * invisible walls where they are.
 */
export function runSeparatorEndDrag({
  separatorId,
  endpoint,
  levelId,
  toPlan,
}: {
  separatorId: string
  endpoint: 'start' | 'end'
  levelId: string
  toPlan: (clientX: number, clientY: number) => WallPlanPoint | null
}) {
  const drag = beginSeparatorEndDrag(separatorId, endpoint)
  if (!drag) return null
  let altHeld = false
  const trackAlt = (event: KeyboardEvent | PointerEvent) => {
    altHeld = event.altKey
  }
  const events = ['pointermove', 'keydown', 'keyup'] as const
  for (const type of events) window.addEventListener(type, trackAlt, true)
  const stop = () => {
    for (const type of events) window.removeEventListener(type, trackAlt, true)
  }
  return runRoomHandleDrag<WallPlanPoint>({
    label: SEPARATOR_END_DRAG_LABEL,
    nodeId: separatorId,
    levelId,
    requires: [separatorId],
    sample: toPlan,
    onValue: (point) => drag.move(point, altHeld),
    onCommit: () => {
      stop()
      drag.commit()
    },
    onCancel: () => {
      stop()
      drag.cancel()
    },
  })
}

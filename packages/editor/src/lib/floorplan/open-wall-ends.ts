import {
  type OpenWallEnd,
  planJoinOpenWallEnd,
  runAsSingleSceneHistoryStep,
  useScene,
  type WallJoinResult,
} from '@pascal-app/core'
import { formatLinearMeasurement, type LinearUnit } from '../measurements'

const JOIN_REFUSALS: Record<Extract<WallJoinResult, { ok: false }>['reason'], string> = {
  'covered-existing-wall': 'An existing wall already covers this span',
  'segment-too-short': 'Joining would make the wall too short',
  'stale-end': 'This wall end has changed',
  'no-target': 'The other wall has moved or is no longer available',
  'attachment-outside-wall': 'A door or window is in the way',
  'attachment-straddles-junction': 'A door or window is in the way',
}

export function joinOpenWallEnd(end: OpenWallEnd): string | null {
  const scene = useScene.getState()
  if (scene.readOnly) return 'This scene is read-only'
  const result = planJoinOpenWallEnd(scene.nodes, end)
  if (!result.ok) return JOIN_REFUSALS[result.reason]
  runAsSingleSceneHistoryStep(useScene, () =>
    useScene.getState().applyNodeChanges(result.plan.changes),
  )
  return null
}

/** Stable id of one wall end, for hover / pin state. */
export function openWallEndKey(end: Pick<OpenWallEnd, 'wallId' | 'end'>): string {
  return `${end.wallId}:${end.end}`
}

/** Short distances read in the unit a person would say out loud: "4 cm", "8 mm", `1.5"`. */
export function formatOpenWallEndDistance(meters: number, unit: LinearUnit): string {
  const value = Math.abs(meters)
  if (unit === 'imperial') {
    const inches = value / 0.0254
    if (inches >= 12) return formatLinearMeasurement(value, unit)
    return `${Number.parseFloat(inches.toFixed(inches < 1 ? 2 : 1))}"`
  }
  if (value >= 1) return formatLinearMeasurement(value, unit)
  if (value < 0.01) return `${Math.max(1, Math.round(value * 1000))} mm`
  return `${Math.round(value * 100)} cm`
}

function candidateDistance(end: OpenWallEnd): number | null {
  if (!end.candidate) return null
  return Math.hypot(end.candidate.point[0] - end.point[0], end.candidate.point[1] - end.point[1])
}

/** What is wrong at this end, in a few words. Null when there is nothing to name. */
export function openWallEndLabel(end: OpenWallEnd, unit: LinearUnit): string | null {
  const gap = end.gap ?? candidateDistance(end)
  switch (end.reason) {
    case 'gap':
      return gap === null ? 'Not joined' : `${formatOpenWallEndDistance(gap, unit)} gap`
    case 'crosses': {
      const overlap = candidateDistance(end)
      return overlap === null
        ? 'Walls cross'
        : `Overlaps by ${formatOpenWallEndDistance(overlap, unit)}`
    }
    case 'parallel':
      return gap === null
        ? 'Runs alongside a wall'
        : `Parallel, ${formatOpenWallEndDistance(gap, unit)} apart`
    case 'rejected':
      return 'Not joined'
    case 'isolated':
      return null
  }
}

/**
 * Which open ends the floor plan marks. A near miss (an end with a join
 * candidate) on a wall that bounds no room is always worth a dot — it is what
 * keeps a room from closing. While walls or rooms are being drawn, every open
 * end of a room-less wall shows, and near misses on walls that already bound a
 * room too, since that is when the person is joining things.
 */
export function visibleOpenWallEnds(
  ends: readonly OpenWallEnd[],
  roomWallIds: ReadonlySet<string>,
  drawing: boolean,
): OpenWallEnd[] {
  return ends.filter((end) => {
    const boundsRoom = roomWallIds.has(end.wallId)
    if (end.candidate) return drawing || !boundsRoom
    return drawing && !boundsRoom
  })
}

const samePoint = (a: readonly [number, number], b: readonly [number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6

/** How squarely joining this end slides its wall along its own line (1) rather than tilting it (0). */
function joinAlignment(
  end: OpenWallEnd,
  wallDirection: (wallId: string) => readonly [number, number] | null,
): number {
  const direction = wallDirection(end.wallId)
  if (!(direction && end.candidate)) return 0
  const dx = end.candidate.point[0] - end.point[0]
  const dz = end.candidate.point[1] - end.point[1]
  const move = Math.hypot(dx, dz)
  const length = Math.hypot(direction[0], direction[1])
  if (move < 1e-9 || length < 1e-9) return 1
  return Math.abs(dx * direction[0] + dz * direction[1]) / (move * length)
}

/**
 * Two ends that are each other's join candidate are one gap: keep the end
 * whose join slides its wall along its own line, so "Join walls" closes the
 * gap without tilting the other wall.
 */
export function collapseMutualOpenWallEnds(
  ends: readonly OpenWallEnd[],
  wallDirection: (wallId: string) => readonly [number, number] | null,
): OpenWallEnd[] {
  const dropped = new Set<OpenWallEnd>()
  const byWall = new Map<string, OpenWallEnd[]>()
  for (const end of ends) {
    const group = byWall.get(end.wallId)
    if (group) group.push(end)
    else byWall.set(end.wallId, [end])
  }
  for (const end of ends) {
    if (dropped.has(end) || !end.candidate) continue
    const candidate = end.candidate
    const partner = byWall
      .get(candidate.wallId)
      ?.find(
        (other) =>
          other !== end &&
          !dropped.has(other) &&
          other.wallId === candidate.wallId &&
          samePoint(other.point, candidate.point) &&
          other.candidate?.wallId === end.wallId &&
          samePoint(other.candidate.point, end.point),
      )
    if (!partner) continue
    dropped.add(
      joinAlignment(partner, wallDirection) > joinAlignment(end, wallDirection) ? end : partner,
    )
  }
  return ends.filter((end) => !dropped.has(end))
}

/** "2 wall ends aren't joined — rooms can't close", or null when every end is joined. */
export function openWallEndsSummary(joinableCount: number): string | null {
  if (joinableCount === 0) return null
  return joinableCount === 1
    ? "1 wall end isn't joined — a room can't close"
    : `${joinableCount} wall ends aren't joined — rooms can't close`
}

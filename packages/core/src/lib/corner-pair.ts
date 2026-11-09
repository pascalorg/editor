import type { AnyNode, WallNode, WindowNode } from '../schema'

/**
 * Corner windows: a window joined at its wall's end to a window on the wall that meets it there.
 * The lookups the viewer and the editor read; planning one lives in building/corner-window.
 */

type Nodes = Readonly<Record<string, AnyNode>>
export type WallEnd = 'start' | 'end'

/** How close a wall's end must be to a point to meet there (m). */
const AT = 1e-3
/** How close a window's edge must be to its wall's end to be one side of a corner pair (m). */
const REACHES = 0.01
/**
 * How near a corner a window counts as being at it, to wrap it or join it to the window on the
 * other wall (m); a window this near is slid to the corner when it joins.
 */
export const CORNER_REACH_M = 0.3
/** A corner this close to folded back or to straight is no corner (degrees). */
export const DEGENERATE_CORNER_DEG = 10

/** Whether two walls meeting at `angle` (degrees) make a corner a window can wrap. */
export const isWrappableAngle = (angle: number) =>
  angle >= DEGENERATE_CORNER_DEG && angle <= 180 - DEGENERATE_CORNER_DEG

/**
 * Whether the glass of a window fuses at a corner: a fixed, rectangular, framed window's does. The
 * other families keep their frames, so their sides meet at the frames as at a post.
 */
export const fusesAtCorner = (
  window: Pick<WindowNode, 'windowType' | 'openingShape' | 'openingKind' | 'source'>,
) =>
  !window.source &&
  window.openingKind !== 'opening' &&
  (window.windowType ?? 'fixed') === 'fixed' &&
  (window.openingShape ?? 'rectangle') === 'rectangle'

const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!)
export const wallLengthOf = (wall: WallNode) => distance(wall.start, wall.end)
export const wallEndPoint = (wall: WallNode, end: WallEnd) =>
  end === 'start' ? wall.start : wall.end

/** The walls of a level ending at a point, with the end that does. */
export function wallsEndingAt(
  nodes: Nodes,
  levelId: string | undefined,
  point: readonly number[],
  includeCurved = false,
) {
  return Object.values(nodes).flatMap((node) => {
    if (
      node.type !== 'wall' ||
      (levelId && node.parentId !== levelId) ||
      (node.curveOffset && !includeCurved)
    )
      return []
    const wall = node as WallNode
    const end: WallEnd | null =
      distance(wall.start, point) <= AT ? 'start' : distance(wall.end, point) <= AT ? 'end' : null
    return end ? [{ wall, end }] : []
  })
}

/** The angle two walls make at the corner they share, between their directions away from it. */
export function cornerAngle(
  a: { wall: WallNode; end: WallEnd },
  b: { wall: WallNode; end: WallEnd },
) {
  const away = ({ wall, end }: { wall: WallNode; end: WallEnd }) => {
    const [from, to] = end === 'start' ? [wall.start, wall.end] : [wall.end, wall.start]
    const length = distance(from, to)
    return [(to[0] - from[0]) / length, (to[1] - from[1]) / length]
  }
  const [u, v] = [away(a), away(b)]
  const cos = Math.max(-1, Math.min(1, u[0]! * v[0]! + u[1]! * v[1]!))
  return (Math.acos(cos) * 180) / Math.PI
}

/** Whether a window's edge reaches `end` of its wall. */
export function windowReachesEnd(nodes: Nodes, window: WindowNode, end: WallEnd): boolean {
  const wall = nodes[window.parentId ?? '']
  return wall?.type === 'wall' && Math.abs(windowEndGap(wall as WallNode, window, end)) <= REACHES
}

/** The end of its wall a window's edge reaches, if it reaches one; `start` when it spans the wall. */
export function windowCornerEnd(nodes: Nodes, window: WindowNode): WallEnd | null {
  return windowReachesEnd(nodes, window, 'start')
    ? 'start'
    : windowReachesEnd(nodes, window, 'end')
      ? 'end'
      : null
}

/** How far a window's edge is from an end of its wall (m); negative past it. */
export function windowEndGap(wall: WallNode, window: WindowNode, end: WallEnd): number {
  return end === 'start'
    ? window.position[0] - window.width / 2
    : wallLengthOf(wall) - (window.position[0] + window.width / 2)
}

/** The end of its wall a window is within `reach` of, the nearer if both; null when neither. */
export function windowNearCornerEnd(
  nodes: Nodes,
  window: WindowNode,
  reach = CORNER_REACH_M,
): WallEnd | null {
  const wall = nodes[window.parentId ?? '']
  if (wall?.type !== 'wall') return null
  const gaps = (['start', 'end'] as const)
    .map((end) => ({ end, gap: windowEndGap(wall as WallNode, window, end) }))
    .filter(({ gap }) => gap <= reach)
    .sort((a, b) => a.gap - b.gap)
  return gaps[0]?.end ?? null
}

/**
 * A window's corner pair: its wall, the end it runs to, the partner on the other wall and the
 * angle between the walls; null when it has none. A `corner` that no longer makes one is no pair:
 * the partner gone or not naming it back, either side moved off its corner, or the walls no longer
 * meeting there on one level at an angle a window wraps.
 */
export function cornerPair(nodes: Nodes, window: WindowNode) {
  const corner = window.corner
  const partner = corner ? nodes[corner.partnerId] : undefined
  if (!corner || partner?.type !== 'window') return null
  const other = partner as WindowNode
  if (other.corner?.partnerId !== window.id) return null
  if (
    !windowReachesEnd(nodes, window, corner.end) ||
    !windowReachesEnd(nodes, other, other.corner.end)
  )
    return null
  const [wall, partnerWall] = [nodes[window.parentId ?? ''], nodes[other.parentId ?? '']]
  if (wall?.type !== 'wall' || partnerWall?.type !== 'wall' || wall.id === partnerWall.id)
    return null
  if (
    wall.parentId !== partnerWall.parentId ||
    distance(
      wallEndPoint(wall as WallNode, corner.end),
      wallEndPoint(partnerWall as WallNode, other.corner.end),
    ) > AT
  )
    return null
  const angle = cornerAngle(
    { wall: wall as WallNode, end: corner.end },
    { wall: partnerWall as WallNode, end: other.corner.end },
  )
  if (!isWrappableAngle(angle)) return null
  return {
    wall: wall as WallNode,
    end: corner.end,
    partner: other,
    partnerWall,
    angle,
    post: corner.post,
  }
}

/**
 * The updates that clear a window's `corner`, and its partner's when the partner names it back:
 * Unwrap, and what a move, a delete or a merge leaves when the window is no longer one side of
 * that pair. Whether the pair still holds or not, so a broken link is never left behind.
 */
export function cornerLinkClears(
  nodes: Nodes,
  windowId: string,
): { id: string; data: Pick<WindowNode, 'corner'> }[] {
  const window = nodes[windowId]
  const corner = window?.type === 'window' ? (window as WindowNode).corner : undefined
  if (!corner) return []
  const partner = nodes[corner.partnerId]
  return [
    { id: windowId, data: { corner: undefined } },
    ...(partner?.type === 'window' && (partner as WindowNode).corner?.partnerId === windowId
      ? [{ id: partner.id, data: { corner: undefined } }]
      : []),
  ]
}

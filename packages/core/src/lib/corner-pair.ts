import type { AnyNode, WallNode, WindowNode } from '../schema'

/**
 * Corner windows (L65): a window joined at its wall's end to a window on the wall that meets it
 * there. The lookups the viewer and the editor read; planning one lives in building/corner-window.
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

/** The end of its wall a window's edge reaches, if it reaches one. */
export function windowCornerEnd(nodes: Nodes, window: WindowNode): WallEnd | null {
  const wall = nodes[window.parentId ?? '']
  if (wall?.type !== 'wall') return null
  const length = wallLengthOf(wall as WallNode)
  const [left, right] = [
    window.position[0] - window.width / 2,
    window.position[0] + window.width / 2,
  ]
  return Math.abs(left) <= REACHES ? 'start' : Math.abs(right - length) <= REACHES ? 'end' : null
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
 * angle between the walls; null when it has none, or its partner does not name it back (a deleted
 * or unwrapped partner leaves no pair).
 */
export function cornerPair(nodes: Nodes, window: WindowNode) {
  const corner = window.corner
  const partner = corner ? nodes[corner.partnerId] : undefined
  if (!corner || partner?.type !== 'window') return null
  const other = partner as WindowNode
  if (other.corner?.partnerId !== window.id) return null
  // Moved off its corner (dragged along its wall), a window is no longer one side of the pair.
  if (
    windowCornerEnd(nodes, window) !== corner.end ||
    windowCornerEnd(nodes, other) !== other.corner.end
  )
    return null
  const [wall, partnerWall] = [nodes[window.parentId ?? ''], nodes[other.parentId ?? '']]
  if (wall?.type !== 'wall' || partnerWall?.type !== 'wall') return null
  const angle = cornerAngle(
    { wall: wall as WallNode, end: corner.end },
    { wall: partnerWall as WallNode, end: other.corner.end },
  )
  return {
    wall: wall as WallNode,
    end: corner.end,
    partner: other,
    partnerWall,
    angle,
    post: corner.post,
  }
}

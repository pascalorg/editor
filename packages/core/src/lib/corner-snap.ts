import { isAgentRefusal } from '../agent-tools/refusal'
import { planWallOpening } from '../building/wall-openings'
import type { AnyNode, WallNode, WindowNode } from '../schema'
import {
  CORNER_REACH_M,
  cornerAngle,
  DEGENERATE_CORNER_DEG,
  type WallEnd,
  wallEndPoint,
  wallLengthOf,
  wallsEndingAt,
  windowEndGap,
  windowNearCornerEnd,
} from './corner-pair'

/**
 * Placing or dragging a window near a corner (the owner, 8 October): inside the corner zone the
 * window snaps its edge to the corner and the window waiting on the other wall, if any, is found, so
 * the tool can highlight it and say the two will join. Pure: the tools read the answer.
 */

type Nodes = Readonly<Record<string, AnyNode>>

/** How near a corner the zone starts (m): a window's edge this close to a wall's end snaps to it. */
export const CORNER_SNAP_ENTER_M = CORNER_REACH_M
/** How far out the zone reaches for a window already snapped (m), so its edge does not flicker. */
export const CORNER_SNAP_EXIT_M = CORNER_REACH_M + 0.1

export type CornerSnap = {
  /** The end of the window's wall the corner is at. */
  end: WallEnd
  /** The window's centre along its wall once snapped (m). */
  centreX: number
  corner: [number, number]
  otherWall: WallNode
  otherEnd: WallEnd
  /** The window waiting at the other wall's corner, the nearest, if one is. */
  waitingId: string | null
}

/**
 * Why a wall end in the zone is not a corner window's: the owner could not find Wrap the corner
 * where a lone wall, a T-junction, a curved or curtain wall, a flat angle or a full wall gave
 * nothing at all, so the hint says it.
 */
export type CornerBlockReason =
  | 'free_end'
  | 'several_walls'
  | 'angle'
  | 'curved'
  | 'curtain'
  | 'no_room'

export type CornerBlock = { reason: CornerBlockReason; end: WallEnd }

export type CornerInput = {
  wallId: string
  /** Where the window's centre is along its wall (m). */
  centreX: number
  width: number
  /** The window's height and the sill it stands at (m), for the match the other wall would take. */
  height?: number
  sillHeight?: number
  /** The window being dragged: never the one waiting. */
  ignoreId?: string
  /** The end snapped to or blocked at the last time, so the zone is wider while the window stays in it. */
  held?: WallEnd | null
}

type Evaluation = { snap: CornerSnap } | { block: CornerBlock } | null

const isCurved = (wall: WallNode) => Boolean(wall.curveOffset)
const isCurtain = (wall: WallNode) => wall.wallType === 'curtain'

function evaluate(nodes: Nodes, input: CornerInput): Evaluation {
  const wall = nodes[input.wallId]
  if (wall?.type !== 'wall') return null
  const length = wallLengthOf(wall as WallNode)
  if (input.width > length) return null

  const gaps = (['start', 'end'] as const)
    .map((end) => ({
      end,
      gap:
        end === 'start'
          ? input.centreX - input.width / 2
          : length - (input.centreX + input.width / 2),
    }))
    .filter(
      ({ end, gap }) => gap <= (input.held === end ? CORNER_SNAP_EXIT_M : CORNER_SNAP_ENTER_M),
    )
    .sort((a, b) => a.gap - b.gap)
  const end = gaps[0]?.end
  if (!end) return null
  const blocked = (reason: CornerBlockReason): Evaluation => ({ block: { reason, end } })

  if (isCurved(wall as WallNode)) return blocked('curved')
  const point = wallEndPoint(wall as WallNode, end)
  // Curved walls are counted here only to be named: they never make a corner window.
  const others = wallsEndingAt(nodes, wall.parentId ?? undefined, point, true).filter(
    (meeting) => meeting.wall.id !== wall.id,
  )
  if (others.some((meeting) => isCurved(meeting.wall))) return blocked('curved')
  if (others.length === 0) return blocked('free_end')
  if (others.length > 1) return blocked('several_walls')
  const { wall: otherWall, end: otherEnd } = others[0]!
  if (isCurtain(wall as WallNode) || isCurtain(otherWall)) return blocked('curtain')
  const angle = cornerAngle({ wall: wall as WallNode, end }, { wall: otherWall, end: otherEnd })
  if (angle < DEGENERATE_CORNER_DEG || angle > 180 - DEGENERATE_CORNER_DEG) return blocked('angle')

  const waiting = Object.values(nodes)
    .filter(
      (node): node is WindowNode =>
        node.type === 'window' &&
        node.parentId === otherWall.id &&
        node.id !== input.ignoreId &&
        !node.corner &&
        !(node.metadata as { isTransient?: boolean } | null)?.isTransient &&
        windowNearCornerEnd(nodes, node as WindowNode) === otherEnd,
    )
    .sort((a, b) => windowEndGap(otherWall, a, otherEnd) - windowEndGap(otherWall, b, otherEnd))[0]

  // With none waiting the click makes the match on the other wall: if that wall cannot take it,
  // the corner is not offered.
  if (!waiting) {
    const otherLength = wallLengthOf(otherWall)
    const width = Math.min(input.width, otherLength)
    const height = input.height ?? 1.5
    try {
      planWallOpening(nodes as never, {
        kind: 'window',
        wallId: otherWall.id,
        t: (otherEnd === 'start' ? width / 2 : otherLength - width / 2) / otherLength,
        width,
        height,
        ...(input.sillHeight === undefined ? {} : { sillHeight: input.sillHeight }),
      })
    } catch (error) {
      if (isAgentRefusal(error)) return blocked('no_room')
      throw error
    }
  }

  return {
    snap: {
      end,
      centreX: end === 'start' ? input.width / 2 : length - input.width / 2,
      corner: [point[0]!, point[1]!],
      otherWall,
      otherEnd,
      waitingId: waiting?.id ?? null,
    },
  }
}

/** The snap and the block for one window position: at most one of them is set. */
export function evaluateCorner(
  nodes: Nodes,
  input: CornerInput,
): { snap: CornerSnap | null; block: CornerBlock | null } {
  const found = evaluate(nodes, input)
  return {
    snap: found && 'snap' in found ? found.snap : null,
    block: found && 'block' in found ? found.block : null,
  }
}

export function cornerSnap(nodes: Nodes, input: CornerInput): CornerSnap | null {
  const found = evaluate(nodes, input)
  return found && 'snap' in found ? found.snap : null
}

/** Why a window within the corner zone gets no corner, or null where it does, or is out of the zone. */
export function cornerBlock(nodes: Nodes, input: CornerInput): CornerBlock | null {
  const found = evaluate(nodes, input)
  return found && 'block' in found ? found.block : null
}

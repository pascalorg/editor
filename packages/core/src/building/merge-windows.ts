import { refuse } from '../agent-tools/refusal'
import {
  CORNER_REACH_M,
  cornerAngle,
  cornerPair,
  DEGENERATE_CORNER_DEG,
  type WallEnd,
  wallEndPoint,
  wallLengthOf,
  windowEndGap,
} from '../lib/corner-pair'
import type { AnyNode, AnyNodeId, WallNode, WindowNode } from '../schema'
import { findWallChildOverlap, resolveWallOpeningCeiling } from './wall-openings'

/**
 * Two windows that exist become one (the owner, 8 October): the one operation behind the editor's
 * Merge windows button, Wrap the corner when a window already waits at the corner, and the agents'
 * `merge_windows`.
 *
 * On two walls that meet at a corner, each reaching it within `CORNER_REACH_M`, they become one
 * corner window: both adopted, each slid to the corner keeping its width, the glass fused, one sill.
 * Side by side on one wall with at most `MERGE_GAP_M` between them and nothing between, they
 * become one window spanning both outer edges. The first window named is the one whose height, sill
 * and type (corner) or type and style (one wall) the result keeps.
 */

type Nodes = Readonly<Record<string, AnyNode>>

/** The widest gap between two windows on one wall that still merges them (m). */
export const MERGE_GAP_M = 0.3

/** What two windows share on a corner window: the second takes the first's. */
const SHARED = [
  'height',
  'windowType',
  'frameThickness',
  'frameDepth',
  'sill',
  'sillDepth',
  'sillThickness',
] as const

export type WindowMerge = {
  kind: 'corner' | 'same-wall'
  /** The windows that stay, in the order named. */
  windowIds: string[]
  /** The window that went into the first (a merge on one wall). */
  removedIds: string[]
  wallIds: string[]
  /** The bottom edge of the result (m). */
  sillHeight: number
  height: number
  /** The width of the merged window (a merge on one wall). */
  width?: number
  /** The angle the walls make (a corner). */
  angle?: number
  changes: { update: { id: AnyNodeId; data: Partial<WindowNode> }[]; delete: AnyNodeId[] }
  message: string
}

const metres = (value: number) => `${value.toFixed(2)} m`
const round = (value: number) => Math.round(value * 100) / 100

function windowOf(nodes: Nodes, id: string): { window: WindowNode; wall: WallNode } {
  const node = nodes[id]
  if (!node) refuse('window_not_found', `Window not found: ${id}.`, { windowId: id })
  if (node.type !== 'window')
    refuse('not_a_window', `Node ${id} is a ${node.type}, not a window.`, {
      windowId: id,
      type: node.type,
    })
  const window = node as WindowNode
  const wall = nodes[window.parentId ?? '']
  if (wall?.type !== 'wall')
    refuse(
      'window_not_on_wall',
      `Window ${id} is not on a straight wall (a roof or dormer window), so it cannot join another.`,
      { windowId: id },
    )
  return { window, wall: wall as WallNode }
}

const sillOf = (window: WindowNode) => window.position[1] - window.height / 2
const headOf = (window: WindowNode) => window.position[1] + window.height / 2

/** The shared point of two walls' ends, with the end of each there; null when they share none. */
function sharedCorner(a: WallNode, b: WallNode) {
  for (const endA of ['start', 'end'] as const)
    for (const endB of ['start', 'end'] as const) {
      const [p, q] = [wallEndPoint(a, endA), wallEndPoint(b, endB)]
      if (Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!) <= 1e-3) return { endA, endB, point: p }
    }
  return null
}

/**
 * The plan to merge two windows, or a refusal that says why. Pure: `changes` is for the caller to
 * apply (the editor's store, an agent operation's `SceneChanges`).
 */
export function mergeWindows(nodes: Nodes, firstId: string, secondId: string): WindowMerge {
  if (firstId === secondId) refuse('same_window', 'Pick two different windows to merge.')
  const first = windowOf(nodes, firstId)
  const second = windowOf(nodes, secondId)
  for (const [mine, other] of [
    [first.window, second.window],
    [second.window, first.window],
  ] as const) {
    if (mine.corner && mine.corner.partnerId === other.id && cornerPair(nodes, mine))
      refuse('windows_already_joined', `${mine.id} and ${other.id} already wrap this corner.`, {
        windowIds: [mine.id, other.id],
      })
    if (mine.corner && mine.corner.partnerId !== other.id && nodes[mine.corner.partnerId])
      refuse(
        'window_already_joined',
        `Window ${mine.id} already wraps a corner with ${mine.corner.partnerId}; unwrap it before joining it to ${other.id}.`,
        { windowId: mine.id, partnerId: mine.corner.partnerId },
      )
  }
  return first.wall.id === second.wall.id
    ? mergeOnOneWall(nodes, first, second)
    : mergeAtCorner(nodes, first, second)
}

type Side = { window: WindowNode; wall: WallNode }

function mergeOnOneWall(nodes: Nodes, first: Side, second: Side): WindowMerge {
  const wall = first.wall
  const [a, b] = [first.window, second.window]
  const [leftOf, rightOf] = a.position[0] <= b.position[0] ? ([a, b] as const) : ([b, a] as const)
  const gap = rightOf.position[0] - rightOf.width / 2 - (leftOf.position[0] + leftOf.width / 2)
  if (gap > MERGE_GAP_M + 1e-9)
    refuse(
      'windows_not_adjacent',
      `${a.id} and ${b.id} are ${metres(gap)} apart on wall ${wall.id}; windows join when at most ${metres(MERGE_GAP_M)} separates them.`,
      { windowIds: [a.id, b.id], gap, limit: MERGE_GAP_M },
    )

  const outerLeft = leftOf.position[0] - leftOf.width / 2
  const outerRight = rightOf.position[0] + rightOf.width / 2
  const bottom = Math.min(sillOf(a), sillOf(b))
  const top = Math.max(headOf(a), headOf(b))
  const centre: [number, number] = [(outerLeft + outerRight) / 2, (bottom + top) / 2]
  const between = findWallChildOverlap(
    wall.id,
    nodes,
    centre[0],
    centre[1],
    outerRight - outerLeft,
    top - bottom,
    [a.id, b.id],
  )
  if (between)
    refuse(
      'opening_between',
      `${between.type === 'item' ? 'An item' : `A ${between.type}`}, ${between.id}, sits between ${a.id} and ${b.id} on wall ${wall.id}, so they cannot become one window.`,
      { windowIds: [a.id, b.id], blockingId: between.id },
    )

  const width = outerRight - outerLeft
  return {
    kind: 'same-wall',
    windowIds: [a.id],
    removedIds: [b.id],
    wallIds: [wall.id],
    sillHeight: bottom,
    height: top - bottom,
    width,
    changes: {
      update: [
        {
          id: a.id as AnyNodeId,
          data: { width, height: top - bottom, position: [centre[0], centre[1], a.position[2]] },
        },
      ],
      delete: [b.id as AnyNodeId],
    },
    message: `Merged ${b.id} into ${a.id}: one window ${metres(width)} wide on wall ${wall.id}, from a sill of ${metres(bottom)} to ${metres(top)}. Its type and style are ${a.id}'s, the window named first.`,
  }
}

function mergeAtCorner(nodes: Nodes, first: Side, second: Side): WindowMerge {
  const [a, b] = [first.window, second.window]
  const joint = sharedCorner(first.wall, second.wall)
  if (!joint || first.wall.parentId !== second.wall.parentId)
    refuse(
      'walls_not_meeting',
      `Wall ${first.wall.id} and wall ${second.wall.id} do not meet at a corner, so ${a.id} and ${b.id} cannot wrap one. On one wall, windows side by side merge instead.`,
      { wallIds: [first.wall.id, second.wall.id] },
    )
  const angle = cornerAngle(
    { wall: first.wall, end: joint.endA },
    { wall: second.wall, end: joint.endB },
  )
  if (angle < DEGENERATE_CORNER_DEG || angle > 180 - DEGENERATE_CORNER_DEG)
    refuse(
      'corner_angle',
      `The walls meet at ${Math.round(angle)}°: too close to ${angle < 90 ? 'folded back' : 'straight'} for a corner window.`,
      { angle },
    )

  const sides = [
    { ...first, end: joint.endA },
    { ...second, end: joint.endB },
  ]
  for (const { window, wall, end } of sides) {
    const gap = windowEndGap(wall, window, end)
    if (gap > CORNER_REACH_M + 1e-9)
      refuse(
        'window_not_at_corner',
        `Window ${window.id} is ${metres(gap)} from the corner of wall ${wall.id}; a window joins a corner window when it is within ${metres(CORNER_REACH_M)} of the corner.`,
        { windowId: window.id, gap, limit: CORNER_REACH_M },
      )
  }

  const ceiling = resolveWallOpeningCeiling(second.wall, nodes as Record<AnyNodeId, AnyNode>)
  if (headOf(a) > ceiling + 1e-6)
    refuse(
      'height_exceeds_wall',
      `Window ${a.id} is taller than wall ${second.wall.id} (${metres(headOf(a))} against ${metres(ceiling)}), so ${b.id} cannot take its height and sill. Name the other window first, or lower ${a.id}.`,
      { windowId: b.id, wallId: second.wall.id },
    )

  // Each side slides to the corner, keeping its width, if no other opening is in the way.
  const centreAt = (window: WindowNode, wall: WallNode, end: WallEnd) =>
    end === 'start' ? window.width / 2 : wallLengthOf(wall) - window.width / 2
  const placed = sides.map(({ window, wall, end }, index) => {
    const x = centreAt(window, wall, end)
    const y = a.position[1]
    const blocking = findWallChildOverlap(wall.id, nodes, x, y, window.width, a.height, window.id)
    if (blocking)
      refuse(
        'opening_overlap',
        `Sliding ${window.id} to the corner of wall ${wall.id} would overlap ${blocking.type} ${blocking.id}.`,
        { windowId: window.id, blockingId: blocking.id },
      )
    const corner = {
      end,
      partnerId: sides[1 - index]!.window.id,
      post: 'none' as const,
    }
    const aligned: Partial<WindowNode> =
      index === 0
        ? {}
        : Object.fromEntries(SHARED.map((key) => [key, a[key]]).filter(([, v]) => v !== undefined))
    return {
      id: window.id as AnyNodeId,
      data: { ...aligned, position: [x, y, window.position[2]], corner } as Partial<WindowNode>,
    }
  })

  return {
    kind: 'corner',
    windowIds: [a.id, b.id],
    removedIds: [],
    wallIds: [first.wall.id, second.wall.id],
    sillHeight: sillOf(a),
    height: a.height,
    angle: round(angle),
    changes: { update: placed, delete: [] },
    message: `Joined ${a.id} and ${b.id} as one corner window across ${first.wall.id} and ${second.wall.id} (${Math.round(angle)}°), the glass fused at the corner. Both take ${a.id}'s height and sill (${metres(a.height)} tall from ${metres(sillOf(a))}) and type, as it was named first.`,
  }
}

/**
 * What the Merge windows button does for a selection: nothing unless exactly two windows are
 * selected; otherwise whether they can join, and if not, why, in the refusal's own words.
 */
export function windowMergeOffer(
  nodes: Nodes,
  selectedIds: readonly string[],
): { reason: string | null } | null {
  if (selectedIds.length !== 2) return null
  if (selectedIds.some((id) => nodes[id]?.type !== 'window')) return null
  try {
    mergeWindows(nodes, selectedIds[0]!, selectedIds[1]!)
    return { reason: null }
  } catch (error) {
    return { reason: error instanceof Error ? error.message : 'These windows cannot be merged.' }
  }
}

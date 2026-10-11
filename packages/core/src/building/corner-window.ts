import { refuse } from '../agent-tools/refusal'
import {
  CORNER_REACH_M,
  cornerAngle,
  cornerPair,
  DEGENERATE_CORNER_DEG,
  wallEndPoint,
  wallLengthOf,
  wallsEndingAt,
  windowEndGap,
  windowNearCornerEnd,
} from '../lib/corner-pair'
import type { AnyNode, AnyNodeId, WallNode, WindowNode } from '../schema'
import { mergeWindows } from './merge-windows'
import {
  centredWindowSill,
  DEFAULT_WINDOW,
  planWallOpening,
  type WallOpeningInput,
} from './wall-openings'

export { cornerPair, windowCornerEnd } from '../lib/corner-pair'

type Nodes = Readonly<Record<string, AnyNode>>
type Point = [number, number]

export type CornerWindowInput = {
  corner: Point
  levelId?: string
  /** The two walls, when more than two meet at the corner. */
  wallIds?: [string, string]
  /** How far the glass runs along each wall from the corner (m), unless `widths` names the wall. */
  width?: number
  widths?: Record<string, number>
  height?: number
  sillHeight?: number
  post?: 'none' | 'post'
  windowType?: WallOpeningInput['windowType']
  style?: string
}

/**
 * A corner window (L65): one window on each of the two walls meeting at `corner`, each running to
 * it, joined, at any angle the walls make. Each side is placed by add_window's rules, and the two
 * keep one sill: with none given, both are centred on the lower of the two walls.
 */
export function planCornerWindow(nodes: Nodes, input: CornerWindowInput) {
  const point = input.corner
  const meeting = wallsEndingAt(nodes, input.levelId, point).filter(
    ({ wall }) => !input.wallIds || input.wallIds.includes(wall.id),
  )
  if (meeting.length < 2)
    refuse(
      'no_corner',
      `No two walls end at (${point.join(', ')}): a corner window goes where two walls meet; get_walls gives their ends.`,
      { corner: point },
    )
  if (meeting.length > 2)
    refuse(
      'corner_ambiguous',
      `${meeting.length} walls end at (${point.join(', ')}): say which two with wallIds (${meeting.map(({ wall }) => wall.id).join(', ')}).`,
      { corner: point, wallIds: meeting.map(({ wall }) => wall.id) },
    )
  const [a, b] = meeting as [(typeof meeting)[0], (typeof meeting)[0]]
  const angle = cornerAngle(a, b)
  if (angle < DEGENERATE_CORNER_DEG || angle > 180 - DEGENERATE_CORNER_DEG)
    refuse(
      'corner_angle',
      `The walls at (${point.join(', ')}) meet at ${Math.round(angle)}°: too close to ${angle < 90 ? 'folded back' : 'straight'} for a corner window. Along a straight run, one add_window is the window.`,
      { angle },
    )
  const sillHeight =
    input.sillHeight ??
    centredWindowSill(
      [a.wall, b.wall],
      input.height ?? DEFAULT_WINDOW.height,
      nodes as Readonly<Record<AnyNodeId, AnyNode>>,
    )
  const windows = [a, b].map(({ wall, end }) => {
    const width = input.widths?.[wall.id] ?? input.width ?? 1.2
    const length = wallLengthOf(wall)
    if (width > length)
      refuse(
        'width_exceeds_wall',
        `Wall ${wall.id} is ${length.toFixed(2)} m long, too short for a ${width.toFixed(2)} m side of the corner window.`,
        { wallId: wall.id, width, length },
      )
    const centre = end === 'start' ? width / 2 : length - width / 2
    return {
      end,
      node: planWallOpening(nodes as never, {
        kind: 'window',
        wallId: wall.id,
        t: centre / length,
        width,
        ...(input.height === undefined ? {} : { height: input.height }),
        sillHeight,
        ...(input.windowType ? { windowType: input.windowType } : {}),
        ...(input.style ? { style: input.style } : {}),
      }).node as WindowNode,
    }
  })
  const post = input.post ?? 'none'
  const [first, second] = windows as [(typeof windows)[0], (typeof windows)[0]]
  return {
    windows: [
      { ...first.node, corner: { end: first.end, partnerId: second.node.id, post } },
      { ...second.node, corner: { end: second.end, partnerId: first.node.id, post } },
    ] as WindowNode[],
    wallIds: [a.wall.id, b.wall.id] as [string, string],
    angle,
  }
}

/** What both sides of a corner window share: changed on one, it changes on the other. */
const SHARED = [
  'height',
  'windowType',
  'frameThickness',
  'frameDepth',
  'sill',
  'sillDepth',
  'sillThickness',
] as const

/** The partner's update for a change to one side of a corner window; null when nothing shared changed. */
export function cornerPartnerUpdates(
  nodes: Nodes,
  windowId: string,
  patch: Partial<WindowNode>,
): Partial<WindowNode> | null {
  const window = nodes[windowId]
  if (window?.type !== 'window') return null
  const pair = cornerPair(nodes, window as WindowNode)
  if (!pair) return null
  const update: Record<string, unknown> = {}
  for (const key of SHARED) if (patch[key] !== undefined) update[key] = patch[key]
  if (patch.position)
    update.position = [pair.partner.position[0], patch.position[1], pair.partner.position[2]]
  if (patch.corner?.post) update.corner = { ...pair.partner.corner!, post: patch.corner.post }
  return Object.keys(update).length ? (update as Partial<WindowNode>) : null
}

/**
 * The editor's Wrap the corner: a window within `CORNER_REACH_M` of a corner where exactly one other
 * wall ends is slid to the corner and joined to the window waiting there on that wall, adopted
 * (`mergeWindows`); with none waiting, it gets a partner on that wall, of its width (as far as the
 * wall allows), height, sill and type. `create` is the partner to add, if any; `updates` are the
 * windows that change, by id.
 */
export function wrapCorner(
  nodes: Nodes,
  windowId: string,
): { create: WindowNode | null; updates: Record<string, Partial<WindowNode>> } {
  const window = nodes[windowId] as WindowNode | undefined
  const end = window?.type === 'window' ? windowNearCornerEnd(nodes, window) : null
  const wall = window ? (nodes[window.parentId ?? ''] as WallNode | undefined) : undefined
  if (!window || !end || wall?.type !== 'wall')
    refuse(
      'no_corner',
      `This window is not within ${CORNER_REACH_M.toFixed(2)} m of a corner of its wall.`,
    )
  const others = wallsEndingAt(nodes, wall.parentId ?? undefined, wallEndPoint(wall, end)).filter(
    (meeting) => meeting.wall.id !== wall.id,
  )
  if (others.length !== 1)
    refuse('no_corner', 'A corner window needs exactly one other wall ending at this corner.')
  const { wall: other, end: otherEnd } = others[0]!

  // A window already waiting at the other wall's corner is adopted, the nearest first.
  const waiting = Object.values(nodes)
    .filter(
      (node): node is WindowNode =>
        node.type === 'window' &&
        node.parentId === other.id &&
        node.id !== window.id &&
        !node.corner &&
        windowNearCornerEnd(nodes, node as WindowNode) === otherEnd,
    )
    .sort((a, b) => windowEndGap(other, a, otherEnd) - windowEndGap(other, b, otherEnd))[0]
  if (waiting) {
    const merge = mergeWindows(nodes, window.id, waiting.id)
    return {
      create: null,
      updates: Object.fromEntries(merge.changes.update.map(({ id, data }) => [id, data])),
    }
  }

  const width = Math.min(window.width, wallLengthOf(other))
  const centre = otherEnd === 'start' ? width / 2 : wallLengthOf(other) - width / 2
  const sillHeight = window.position[1] - window.height / 2
  const partner = planWallOpening(nodes as never, {
    kind: 'window',
    wallId: other.id,
    t: centre / wallLengthOf(other),
    width,
    height: window.height,
    sillHeight,
    windowType: window.windowType,
  }).node as WindowNode
  const post = 'none' as const
  const slidTo = end === 'start' ? window.width / 2 : wallLengthOf(wall) - window.width / 2
  return {
    create: {
      ...partner,
      columnRatios: window.columnRatios,
      rowRatios: window.rowRatios,
      corner: { end: otherEnd, partnerId: window.id, post },
    } as WindowNode,
    updates: {
      [window.id]: {
        corner: { end, partnerId: partner.id, post },
        ...(Math.abs(windowEndGap(wall, window, end)) > 1e-6
          ? { position: [slidTo, window.position[1], window.position[2]] }
          : {}),
      } as Partial<WindowNode>,
    },
  }
}

/** The editor's Unwrap: both windows stay, plain, ending at the corner. */
export function unwrapCorner(nodes: Nodes, windowId: string): Record<string, Partial<WindowNode>> {
  const window = nodes[windowId] as WindowNode | undefined
  const pair = window?.type === 'window' ? cornerPair(nodes, window) : null
  if (!window || !pair) return {}
  return { [window.id]: { corner: undefined }, [pair.partner.id]: { corner: undefined } }
}

/**
 * A new width for one side of a corner window, its corner end kept at the corner (the panel's
 * Width and Other side): the free edge moves, as far as the wall allows.
 */
export function cornerSideWidth(
  nodes: Nodes,
  windowId: string,
  width: number,
): Partial<WindowNode> | null {
  const window = nodes[windowId] as WindowNode | undefined
  const pair = window?.type === 'window' ? cornerPair(nodes, window) : null
  if (!window || !pair) return null
  const length = wallLengthOf(pair.wall)
  const clamped = Math.max(0.1, Math.min(width, length))
  const centre = pair.end === 'start' ? clamped / 2 : length - clamped / 2
  return { width: clamped, position: [centre, window.position[1], window.position[2]] }
}

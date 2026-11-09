import type { AnyNode, AnyNodeId } from '../schema'
import { ColumnNode, type ColumnPostBase } from '../schema/nodes/column'
import { getWallPlaneTop } from '../services/storey'
import { beamBottomElevation, beamsOverPoint } from './beam'

type Nodes = Record<AnyNodeId, AnyNode>

const INCH = 0.0254
const FOOT = 12 * INCH
/** The shortest post the tools make: under that a beam is sitting on the floor. */
export const FRAMING_POST_MIN_HEIGHT = 0.3
/** A post's height where nothing says otherwise: a porch's eight-foot post. */
const DEFAULT_POST_HEIGHT = 8 * FOOT

/** The square framing posts, by their actual dressed side: 3-1/2, 5-1/2 and 7-1/4 in. */
export const FRAMING_POST_SIZES = {
  '4x4': 3.5 * INCH,
  '6x6': 5.5 * INCH,
  '8x8': 7.25 * INCH,
} as const

export type FramingPostSize = keyof typeof FRAMING_POST_SIZES

export const DEFAULT_FRAMING_POST_SIZE: FramingPostSize = '6x6'

/**
 * The tallest each post may stand on a deck (IRC Table R507.4; the table also turns on the
 * species and the area the post carries, so this is the check, not the design).
 */
export const FRAMING_POST_MAX_HEIGHT: Record<FramingPostSize, number> = {
  '4x4': 8 * FOOT,
  '6x6': 11 * FOOT,
  '8x8': 14 * FOOT,
}

/** A framing post's wood: pressure-treated, as a post on a slab or the ground must be. */
export const FRAMING_POST_MATERIAL_REF = 'library:wood-woodplank19'

/**
 * The bases a post stands on, drawn as the column's base block: a steel post base holding the
 * wood an inch and a half off the concrete, or a concrete pier 8 in tall and 3 in wider than the
 * post all round.
 */
const POST_BASES: Record<
  Exclude<ColumnPostBase, 'none'>,
  { height: number; margin: number; material: string }
> = {
  'post-base': { height: 1.5 * INCH, margin: 0.25 * INCH, material: 'library:metal-steel' },
  pier: { height: 8 * INCH, margin: 3 * INCH, material: 'library:concrete-raw' },
}

export const FRAMING_POST_BASE_LABELS: Record<ColumnPostBase, string> = {
  none: 'None',
  'post-base': 'Post base',
  pier: 'Concrete pier',
}

/** Whether a node is a framing post: a column marked `role: 'post'`. */
export function isFramingPost(node: AnyNode | null | undefined): node is ColumnNode {
  return node?.type === 'column' && node.role === 'post'
}

/** The post size a column's section is, or null when it is none of them (or not square). */
export function framingPostSize(
  column: Pick<ColumnNode, 'width' | 'depth'>,
): FramingPostSize | null {
  for (const [size, side] of Object.entries(FRAMING_POST_SIZES) as [FramingPostSize, number][]) {
    if (Math.abs(column.width - side) < INCH / 16 && Math.abs(column.depth - side) < INCH / 16)
      return size
  }
  return null
}

/**
 * The column fields that set a post's base, the base block and its material together: a post with
 * none starts straight off the floor.
 */
export function framingPostBasePatch(
  post: Pick<ColumnNode, 'width' | 'depth'> & { slots?: Record<string, string> },
  base: ColumnPostBase,
): Partial<ColumnNode> {
  const { base: _base, ...slots } = post.slots ?? {}
  // The base scales stay at 1 with no base: the plan's footprint reads them whatever the style.
  if (base === 'none')
    return {
      postBase: 'none',
      baseStyle: 'none',
      baseHeight: 0,
      baseWidthScale: 1,
      baseDepthScale: 1,
      slots,
    }
  const { height, margin, material } = POST_BASES[base]
  return {
    postBase: base,
    baseStyle: 'simple-square',
    baseHeight: height,
    baseWidthScale: Math.min(3, (post.width + margin * 2) / post.width),
    baseDepthScale: Math.min(3, (post.depth + margin * 2) / post.depth),
    slots: { ...slots, base: material },
  }
}

/**
 * The column fields that make a framing post: a plain square sawn post of `size`, sharp-cornered,
 * its shaft the whole section with no capital, pressure-treated, on `base`.
 */
export function framingPostFields(
  size: FramingPostSize = DEFAULT_FRAMING_POST_SIZE,
  base: ColumnPostBase = 'none',
): Partial<ColumnNode> {
  const side = FRAMING_POST_SIZES[size]
  return {
    role: 'post',
    style: 'plain',
    crossSection: 'square',
    supportStyle: 'vertical',
    width: side,
    depth: side,
    radius: side / 2,
    edgeSoftness: 0,
    shaftProfile: 'straight',
    shaftTaper: 0,
    shaftBulge: 0,
    shaftStartScale: 1,
    shaftEndScale: 1,
    shaftSegmentCount: 1,
    shaftTwistStep: 0,
    shaftCornerRadius: 0,
    shaftDetail: 'none',
    capitalStyle: 'none',
    capitalHeight: 0,
    // No capital, but the plan's footprint reads its scales: the post's own size.
    capitalWidthScale: 1,
    capitalDepthScale: 1,
    baseRoundBandCount: 0,
    ringCount: 0,
    fluteCount: 0,
    spiralRibCount: 0,
    panelCount: 0,
    latheRingCount: 0,
    carvingLevel: 0,
    lowerBandEnabled: false,
    dentilCount: 0,
    beadCount: 0,
    ...framingPostBasePatch(
      { width: side, depth: side, slots: { shaft: FRAMING_POST_MATERIAL_REF } },
      base,
    ),
  }
}

/** What `createFramingPost` builds a post from. */
export type FramingPostInput = {
  /**
   * Where it stands: a level-local plan point `[x, z]`, or the column's `[x, y, z]` with `y` its
   * foot over what it stands on (a deck post on the ground carries the grade there).
   */
  position: readonly [number, number] | readonly [number, number, number]
  size?: FramingPostSize
  base?: ColumnPostBase
  /** Its height, foot to top. Else `topElevation - baseElevation`, else eight feet. */
  height?: number
  /** Its foot, level-local: the top of the slab or the ground it stands on. */
  baseElevation?: number
  /** Its top, level-local: the underside of the beam it carries. */
  topElevation?: number
  /** The level it goes on: its `parentId`. */
  levelId?: string
  /** What it stands on: a slab id, or `'ground'` (`GROUND_SUPPORT_ID`). */
  supportSlabId?: string
  rotation?: number
  name?: string
  metadata?: Record<string, unknown>
}

/**
 * A framing post, as a column node ready for `createNode` on its level: what the Post tool places,
 * and what code that frames a porch or a deck makes under its beams.
 */
export function createFramingPost(input: FramingPostInput): ColumnNode {
  const size = input.size ?? DEFAULT_FRAMING_POST_SIZE
  const position: [number, number, number] =
    input.position.length === 3
      ? [input.position[0], input.position[1], input.position[2]]
      : [input.position[0], 0, input.position[1]]
  const height =
    input.height ??
    (input.topElevation !== undefined
      ? input.topElevation - (input.baseElevation ?? 0) - position[1]
      : DEFAULT_POST_HEIGHT)
  return ColumnNode.parse({
    name: input.name ?? 'Post',
    ...framingPostFields(size, input.base ?? 'none'),
    position,
    rotation: input.rotation ?? 0,
    height: Math.max(FRAMING_POST_MIN_HEIGHT, height),
    ...(input.levelId ? { parentId: input.levelId } : {}),
    ...(input.supportSlabId ? { supportSlabId: input.supportSlabId } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  })
}

/** What a post at a plan point stands up to: the beam over it, else the ceiling plane. */
export type FramingPostTop = {
  /** Level-local Y of the post's top. */
  top: number
  /** The beam it carries, when one is over it. */
  beamId: string | null
}

/**
 * Where the top of a post standing at a plan point of a level goes: the underside of the lowest
 * beam over it that clears its foot (`baseElevation`), else the ceiling plane there (the top of
 * the level's walls), as a post under a ceiling with no beam yet stands to it.
 */
export function framingPostTopAt(
  nodes: Nodes,
  levelId: string,
  point: readonly [number, number],
  options: { baseElevation?: number; side?: number } = {},
): FramingPostTop {
  const foot = options.baseElevation ?? 0
  for (const beam of beamsOverPoint(nodes, levelId, point)) {
    const bottom = beamBottomElevation(nodes, beam)
    if (bottom >= foot + FRAMING_POST_MIN_HEIGHT) return { top: bottom, beamId: beam.id }
  }
  const half = Math.max(options.side ?? FRAMING_POST_SIZES['6x6'], 0.02) / 2
  return {
    top: getWallPlaneTop(
      { start: [point[0] - half, point[1]], end: [point[0] + half, point[1]], thickness: half * 2 },
      levelId,
      nodes,
    ),
    beamId: null,
  }
}

/**
 * A post taller than its size may stand (`FRAMING_POST_MAX_HEIGHT`): the size and the limit, for
 * the panel to warn with; null for a post within it or of no post size.
 */
export function framingPostHeightLimit(
  post: Pick<ColumnNode, 'width' | 'depth' | 'height'>,
): { size: FramingPostSize; limit: number } | null {
  const size = framingPostSize(post)
  if (!size) return null
  const limit = FRAMING_POST_MAX_HEIGHT[size]
  return post.height > limit + 1e-6 ? { size, limit } : null
}

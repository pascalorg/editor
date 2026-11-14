import { z } from 'zod'
import { StairRailingStyle } from './stair-types'

/**
 * A railing wall (`WallNode.wallType: 'railing'`): drawn and joined
 * like any wall, and like any wall it closes rooms (a deck or a porch its railings fence is a
 * room), but it stands as an open guard instead of a framed body: posts at its ends and equally
 * spaced between them, rails, and the infill its style sets. Its doors are gaps in the guard (a
 * doorway: no leaf, casing or threshold), with a post either side. It takes no finishes, assembly,
 * framing or foundation, and it keeps its own height rather than following the storey.
 */

const INCH = 0.0254

/** A guard's height over the floor, IRC R312.1.2: 36 in where the drop is more than 30 in. */
export const RAILING_GUARD_HEIGHT = 36 * INCH
/** The taller guard the IBC (1015.3) and some local codes ask for: 42 in. */
export const RAILING_GUARD_HEIGHT_TALL = 42 * INCH
/** The largest sphere a guard's openings may pass, IRC R312.1.3: 4 in. */
export const RAILING_SPHERE_LIMIT = 4 * INCH
/** Guard posts on centre at most this far apart: 6 ft, the AWC Deck Construction Guide (DCA 6). */
export const RAILING_MAX_POST_SPACING = 72 * INCH

/** The railing styles: the stair guards' vocabulary (`StairRailingStyle`). */
export const RailingWallStyle = StairRailingStyle
export type RailingWallStyle = z.infer<typeof RailingWallStyle>

/**
 * How a railing wall is built, metres. The guard's height is the wall's own `height`; its
 * `thickness` follows `postSize`, so the plan outline and the room it closes run along the posts.
 * - `postSpacing`: the most the posts stand apart on centre; they are equally spaced between the
 *   run's ends (each end, and each side of an opening, has its post).
 * - `postSize`: the posts' square section.
 * - `infillSize`: a baluster's (picket's, bar's) square section, a cable's diameter, a board's
 *   face height, a glass pane's thickness.
 * - `infillGap`: the clear space between the infill members (keep it under the 4 in sphere).
 * - `bottomClearance`: the clear space under the bottom rail (or the lowest infill) over the floor.
 * - `cap`: a 2x6 cap laid flat over the top rail (the post-and-rail and boards styles).
 */
export const RailingWallConfig = z.object({
  style: RailingWallStyle.default('post-and-rail'),
  postSpacing: z.number().finite().positive().default(RAILING_MAX_POST_SPACING),
  postSize: z
    .number()
    .finite()
    .positive()
    .default(3.5 * INCH),
  infillSize: z
    .number()
    .finite()
    .positive()
    .default(1.5 * INCH),
  infillGap: z
    .number()
    .finite()
    .nonnegative()
    .default(3.5 * INCH),
  bottomClearance: z
    .number()
    .finite()
    .nonnegative()
    .default(3.5 * INCH),
  cap: z.boolean().default(true),
})
export type RailingWallConfig = z.infer<typeof RailingWallConfig>

/**
 * The default railing: the DCA 6 deck guard — 4x4 posts at most 6 ft apart, a 2x6 cap over a
 * 2x4 top rail, a 2x4 bottom rail 3½ in off the floor, and 2x2 balusters 3½ in clear.
 */
export const DEFAULT_RAILING_WALL: RailingWallConfig = RailingWallConfig.parse({})

/**
 * The members each style is drawn with when picked: its posts' section, its infill's section and
 * clear gap, and its clearance over the floor (the stair guards' members, `nodes/stair/*-guard`).
 */
export const RAILING_STYLE_DEFAULTS: Record<
  RailingWallStyle,
  Pick<RailingWallConfig, 'postSize' | 'infillSize' | 'infillGap' | 'bottomClearance'>
> = {
  // DCA 6: 4x4 posts, 2x2 balusters 3½ in clear on a 2x4 bottom rail 3½ in up.
  'post-and-rail': {
    postSize: 3.5 * INCH,
    infillSize: 1.5 * INCH,
    infillGap: 3.5 * INCH,
    bottomClearance: 3.5 * INCH,
  },
  // Joinery: newels, 1¼ in square balusters between a handrail and a shoe rail.
  balusters: {
    postSize: 3.5 * INCH,
    infillSize: 1.25 * INCH,
    infillGap: 3.5 * INCH,
    bottomClearance: 2.25 * INCH,
  },
  // 2 in posts, ⅜ in cables 3 in on centre under a flat cap.
  cable: {
    postSize: 2 * INCH,
    infillSize: 0.375 * INCH,
    infillGap: 2.625 * INCH,
    bottomClearance: 2.75 * INCH,
  },
  // 4x4 posts, 1x6 boards on the flat 3½ in apart under a 2x6 cap.
  boards: {
    postSize: 3.5 * INCH,
    infillSize: 5.5 * INCH,
    infillGap: 3.5 * INCH,
    bottomClearance: 3.5 * INCH,
  },
  // 1½ in posts and one ½ in tempered pane per bay.
  glass: {
    postSize: 1.5 * INCH,
    infillSize: 0.5 * INCH,
    infillGap: 0,
    bottomClearance: 3 * INCH,
  },
  // 1½ in steel posts on baseplates, ⅝ in square bars between two flat rails.
  metal: {
    postSize: 1.5 * INCH,
    infillSize: 0.625 * INCH,
    infillGap: 3.75 * INCH,
    bottomClearance: 3 * INCH,
  },
}

/** A railing wall's config with every field present: its own over the defaults. */
export function getRailingWallConfig(wall: { railing?: Partial<RailingWallConfig> }) {
  return wall.railing ? { ...DEFAULT_RAILING_WALL, ...wall.railing } : DEFAULT_RAILING_WALL
}

/** Whether a node is a railing wall. */
export function isRailingWall(node: { type?: string; wallType?: string } | null | undefined) {
  return node?.type === 'wall' && node.wallType === 'railing'
}

/** A railing's height: its own, else the 36 in guard (a railing never follows the storey). */
export function getRailingWallHeight(wall: { height?: number }): number {
  return wall.height ?? RAILING_GUARD_HEIGHT
}

export type RailingWallPatch = {
  wallType: 'railing'
  thickness: number
  height: number
  railing: RailingWallConfig
  assembly: undefined
}

/**
 * What a newly drawn railing wall is (the Build panel's Railing): a railing of `style` with that
 * style's members, as thick as its posts, 36 in tall, and no assembly (a railing has no layers).
 */
export function railingWallDefaults(style: RailingWallStyle = 'post-and-rail'): RailingWallPatch {
  const railing = { ...DEFAULT_RAILING_WALL, ...RAILING_STYLE_DEFAULTS[style], style }
  return {
    wallType: 'railing',
    thickness: railing.postSize,
    height: RAILING_GUARD_HEIGHT,
    railing,
    assembly: undefined,
  }
}

/**
 * What a door placed on a railing becomes: a gap in the guard as tall as the guard, with no leaf,
 * casing or threshold. The guard stands a post either side of it.
 */
export function railingOpeningFields(wall: { height?: number }) {
  return {
    openingKind: 'opening' as const,
    height: getRailingWallHeight(wall),
    threshold: false,
    casingFaceA: false,
    casingFaceB: false,
  }
}

/** A railing wall's paint slots: its posts and rails, and its infill. */
export type RailingWallSlotId = 'railing-frame' | 'railing-infill'

const WOOD_STYLES: ReadonlySet<RailingWallStyle> = new Set(['post-and-rail', 'balusters', 'boards'])

/**
 * What an unpainted railing shows: a wood guard painted white, a metal one steel, and glass
 * panes glass.
 */
export function railingWallSlotDefault(style: RailingWallStyle, slot: RailingWallSlotId): string {
  if (slot === 'railing-infill' && style === 'glass') return 'library:preset-glass'
  return WOOD_STYLES.has(style) ? 'library:preset-white' : 'library:metal-steel'
}

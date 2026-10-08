/**
 * One coherent baluster guard laid out along a rail path, as oriented boxes.
 *
 * A guard is built the way a joiner builds it: a newel at each end (and, when
 * a spacing is given, every bay between), a top rail and a bottom rail that
 * follow the path with a square fitting block closing every interior corner,
 * and square pickets spanning the two rails. The path sampling, corner finding
 * and newel/picket stations are the style-agnostic chassis in `guard-path.ts`,
 * shared with the deck post-and-rail guard; this file only turns those stations
 * into the baluster style's members. The caller renders the boxes
 * (`renderer.tsx`) or merges them into one mesh (`continuous-railings.tsx`),
 * so this stays pure data — no Three.js meshes, no React.
 *
 * `pickets` is a metre pitch sampled along the horizontal run, so the density
 * tracks the run rather than the path's tessellation. Pickets that fall inside
 * a newel are dropped. `reach` runs the rails that far past the top vertex
 * along the final slope to die into a post standing there; `topPost: false`
 * then omits the top newel.
 */

import {
  buildGuardChassis,
  type GuardBox,
  type GuardRail,
  guardPickets,
  type Vec3,
} from './guard-path'

export type BalusterGuardOptions = {
  railHeight: number
  /** Metre pitch for pickets, sampled along the horizontal run. */
  pickets: number
  /** Metres between newels along the run; omit (or Infinity) for ends only. */
  postSpacing?: number
  topPost?: boolean
  postThrough?: boolean
  /** Metres the rails run past the top vertex, along the final slope. */
  reach?: number
}

// Residential wood balusters, in metres: a 3¼ in newel, a graspable cap on a
// top rail, a shoe rail off the nosing line, and 1¼ in square pickets between
// them. The joint block is a newel-less fitting that closes a plan corner.
const NEWEL = 0.082
const NEWEL_CAP_T = 0.028
const NEWEL_CAP_OVERHANG = 0.03
const NEWEL_EMBED = 0.03
const NEWEL_ABOVE = 0.04
const POST_THROUGH_RISE = 0.0762
/** The two rails' section (`across` the run, `vertical`) and `y` off the nosing line. */
export const BALUSTER_RAIL_PROFILE = {
  top: { across: 0.062, vertical: 0.05, y: 0 },
  bottom: { across: 0.045, vertical: 0.045, y: 0.08 },
} as const
const TOP_RAIL_T = BALUSTER_RAIL_PROFILE.top.vertical
const BOTTOM_RAIL_T = BALUSTER_RAIL_PROFILE.bottom.vertical
const BOTTOM_RAIL_Y = BALUSTER_RAIL_PROFILE.bottom.y
const PICKET = 0.032
/** The widest clear gap left between pickets, in metres (0.1016 m = 4 in). */
const PICKET_MAX_GAP = 0.1016

/** A guard's rails as `{ center y off the nosing line, section across, vertical }`,
 * bottom-to-top. Shared with the flight-to-flight connector so a bridge carries
 * the same rails as the guards it joins. */
export function balusterGuardRails(railHeight: number): GuardRail[] {
  return [
    { y: railHeight, across: BALUSTER_RAIL_PROFILE.top.across, vertical: TOP_RAIL_T },
    { y: BOTTOM_RAIL_Y, across: BALUSTER_RAIL_PROFILE.bottom.across, vertical: BOTTOM_RAIL_T },
  ]
}

export function buildBalusterGuard(points: Vec3[], options: BalusterGuardOptions): GuardBox[] {
  const { railHeight } = options
  const chassis = buildGuardChassis(
    points,
    options,
    balusterGuardRails(railHeight),
    {
      width: NEWEL,
      embed: NEWEL_EMBED,
      top: NEWEL_ABOVE,
      throughTop: NEWEL_ABOVE + POST_THROUGH_RISE,
      capThickness: NEWEL_CAP_T,
      capOverhang: NEWEL_CAP_OVERHANG,
    },
    {
      picketPitch: options.pickets,
      picketMinPitch: PICKET + 0.02,
      picketMaxPitch: PICKET_MAX_GAP + PICKET,
    },
  )
  if (!chassis) return []
  const { path, boxes } = chassis
  if (path.kind === 'pivot') return boxes
  boxes.push(
    ...guardPickets(
      path,
      PICKET,
      NEWEL,
      BOTTOM_RAIL_Y + BOTTOM_RAIL_T / 2,
      railHeight - TOP_RAIL_T / 2,
    ),
  )

  return boxes
}

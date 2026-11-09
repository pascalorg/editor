/**
 * One coherent glass-panel guard laid out along a rail path — a modern framed
 * glass balustrade in metres: a slim square post at each end (and every bay
 * ≤ 4 ft between), a flat cap over them, and one flat tempered-glass panel per
 * bay, point-fixed to its flanking posts by small edge clamps. It shares the
 * path sampling, corner finding and post stations in `guard-path.ts` with the
 * baluster, cable and deck guards, so a straight flight, a chained L/U landing
 * turn, a winder, a curved or spiral sweep and an integrated top landing all
 * read as the same glass rail; only the sections and the glass infill differ.
 *
 * The panels are the physical intent of a glass rail, not a fiction: a tempered
 * pane is rigid and flat, so on a curved or spiral sweep it cannot follow the
 * arc. Each panel is therefore a flat parallelogram spanning the straight chord
 * between two consecutive posts, with plumb vertical edges inset from each post
 * by a reveal gap and a top/bottom clearance to the cap and the nosing line.
 * Adjacent panels meet at a post with twice the reveal between them, never
 * sharing or crossing a vertex. On a straight flight the collinear posts make
 * those chords read as one plane.
 *
 * A flat chord between two posts on a curve lies inside the rail curve by its
 * sagitta — on the outer rail that is up to tens of centimetres toward the
 * treads, so a chord laid on the posts would push the pane well past the guard
 * line into the walking volume. When the caller supplies `insideWalk` (which
 * side of a point is the walkable surface), each bay measures how far its flat
 * chord sags toward that surface and shifts the whole pane — and its clamps —
 * radially outward by that sag plus the pane's half-thickness, so the pane's
 * walking-facing face sits at or outside the rail line across the entire bay.
 * The inner rail's chord sags into the void, away from the walkable surface, so
 * it is left on the line; a straight run has no sag; neither is shifted. The
 * frame is pure `GuardBox` data; the panels are the corner parametrics the
 * renderer extrudes with metre UVs. No Three.js.
 *
 * `reach` runs the cap that far past the top vertex along the final slope to die
 * into a post standing there; `topPost: false` then omits the top post.
 * `postThrough` runs the posts past the cap with a small cap of their own.
 */

import {
  add,
  barBox,
  buildGuardChassis,
  type GuardBox,
  type GuardRail,
  horizontalLength,
  scale,
  sub,
  type Vec3,
} from './guard-path'

export type GlassGuardOptions = {
  railHeight: number
  /** Metres between posts along the run; omit (or Infinity) for ends only. */
  postSpacing?: number
  topPost?: boolean
  postThrough?: boolean
  /** Metres the cap runs past the top vertex, along the final slope. */
  reach?: number
  /** Whether a horizontal point (in the path's frame) is on the walkable
   * surface. When given, a bay whose flat chord sags toward that surface shifts
   * its pane radially outward to keep the pane's face off the walking volume. */
  insideWalk?: (x: number, z: number) => boolean
}

/** A flat glass panel spanning one bay, as the parallelogram the renderer
 * extrudes: `start` is its inset bottom corner on the nosing line, `yaw` the
 * plan heading of its chord, and the panel rises `rise` over `run` horizontally
 * with its lower and upper edges `bottom` and `top` above the nosing line. */
export type GlassPanel = {
  start: Vec3
  yaw: number
  run: number
  rise: number
  bottom: number
  top: number
  thickness: number
}

export type GlassGuard = { frame: GuardBox[]; panels: GlassPanel[] }

// Dressed glass balustrade, in metres.
const POST = 0.0381 // a slim 1½ in square stainless post
const POST_EMBED = 0.05 // the post foot runs this far below the nosing line
const CAP_W = 0.0635 // a flat 2½ in cap over the posts
const CAP_T = 0.0381
const PANEL_T = 0.0127 // ½ in tempered glass
const PANEL_REVEAL = 0.015 // the pane is held this far off each post, plan
const PANEL_FOOT = 0.075 // the glass sits this far over the nosing line
const PANEL_HEAD = 0.01 // and this far under the cap underside
const CLAMP_W = 0.05 // a point clamp straddling the pane edge
const CLAMP_T = 0.03
const CLAMP_LEN = 0.05
const CLAMP_LEVELS = [0.22, 0.78] // clamp heights, as a fraction of pane height
const POST_ABOVE_CAP = 0.0762 // a through-post stands this far above the cap…
const POST_CAP_T = 0.0254 // …under a 1 in cap of its own
const POST_CAP_OVERHANG = 0.0381

/** The glass guard's single flat cap rail. Shared with the flight connector so a
 * bridge between flights carries the same cap as the guards it joins. */
export function glassGuardRails(railHeight: number): GuardRail[] {
  return [{ y: railHeight - CAP_T / 2, across: CAP_W, vertical: CAP_T }]
}

/** A clamp block straddling the pane edge at height `y`, pointing along the
 * chord toward the post — the point fixing that ties the pane to the frame. */
function clamp(edge: Vec3, alongH: Vec3, y: number, post: Vec3): GuardBox {
  const paneAnchor = add(edge, [0, y, 0])
  const postAnchor: Vec3 = [post[0], paneAnchor[1], post[2]]
  const bridge = barBox(postAnchor, paneAnchor, CLAMP_W, CLAMP_T)
  if (bridge) {
    return { ...bridge, size: [CLAMP_W, CLAMP_T, bridge.size[2] + CLAMP_LEN] }
  }
  return {
    center: add(edge, [0, y, 0]),
    size: [CLAMP_W, CLAMP_T, CLAMP_LEN],
    direction: alongH,
  }
}

/** The horizontal fractions of a bay sampled to find the chord's deepest sag;
 * a convex arc sags most near the middle, so the quarter points bracket it. */
const SAG_SAMPLES = [0.25, 0.5, 0.75]

/**
 * How far, and which way, to shift a bay's pane off the walking volume. The rail
 * point at the bay's middle sits on the walkable boundary, so a small probe to
 * either side of it along the chord normal names the outward (non-walkable)
 * side; the pane is then pushed out by the deepest the flat chord sags past the
 * rail curve toward the walkable side, plus a half-thickness so the face clears.
 * Returns the zero vector when the side is unknown, the bay is straight, or the
 * chord sags into the void (the inner rail) rather than toward the walking side.
 */
function paneOffset(
  a: Vec3,
  b: Vec3,
  alongH: Vec3,
  sa: number,
  sb: number,
  pointAt: (s: number) => Vec3,
  insideWalk?: (x: number, z: number) => boolean,
): Vec3 {
  if (!insideWalk || sb <= sa) return [0, 0, 0]
  const normal: Vec3 = [-alongH[2], 0, alongH[0]]
  const railMid = pointAt((sa + sb) / 2)
  const probe = 0.01
  const plusIn = insideWalk(railMid[0] + normal[0] * probe, railMid[2] + normal[2] * probe)
  const minusIn = insideWalk(railMid[0] - normal[0] * probe, railMid[2] - normal[2] * probe)
  if (plusIn === minusIn) return [0, 0, 0]
  const out: Vec3 = plusIn ? scale(normal, -1) : normal
  let sag = 0
  for (const f of SAG_SAMPLES) {
    const rail = pointAt(sa + (sb - sa) * f)
    const chordX = a[0] + (b[0] - a[0]) * f
    const chordZ = a[2] + (b[2] - a[2]) * f
    const inward = (rail[0] - chordX) * out[0] + (rail[2] - chordZ) * out[2]
    if (inward > sag) sag = inward
  }
  if (sag <= 1e-6) return [0, 0, 0]
  return scale(out, sag + PANEL_T / 2)
}

export function buildGlassGuard(points: Vec3[], options: GlassGuardOptions): GlassGuard {
  const { railHeight } = options
  const chassis = buildGuardChassis(
    points,
    options,
    glassGuardRails(railHeight),
    {
      width: POST,
      embed: POST_EMBED,
      top: -CAP_T,
      throughTop: POST_ABOVE_CAP,
      capThickness: POST_CAP_T,
      capOverhang: POST_CAP_OVERHANG,
    },
    { cornerPosts: true },
  )
  if (!chassis) return { frame: [], panels: [] }
  const { path, boxes } = chassis
  if (path.kind === 'pivot') return { frame: boxes, panels: [] }
  const frame = boxes
  const { postPositions, postStations, pointAt } = path

  // One flat pane per bay, inset from both posts, with edge clamps. The pane top
  // sits under the cap underside; the foot clears the nosing line.
  const top = railHeight - CAP_T - PANEL_HEAD
  const bottom = PANEL_FOOT
  const panels: GlassPanel[] = []
  if (top > bottom + 1e-6) {
    for (let i = 1; i < postPositions.length; i++) {
      const a = postPositions[i - 1]!
      const b = postPositions[i]!
      const span = horizontalLength(sub(b, a))
      if (span < 1e-4) continue
      const reveal = Math.min(PANEL_REVEAL, span * 0.2)
      const run = span - 2 * reveal
      if (run < 1e-4) continue
      const alongH: Vec3 = scale([b[0] - a[0], 0, b[2] - a[2]], 1 / span)
      const yaw = Math.atan2(alongH[2], alongH[0])

      // Shift the pane off the walking volume by however far its flat chord sags
      // past the rail curve toward that side, plus a half-thickness so the pane's
      // face — not just its mid-plane — clears the rail line. A straight run and
      // the inner (into-the-void) rail measure no inward sag and stay on the line.
      const shift = paneOffset(
        a,
        b,
        alongH,
        postStations[i - 1]!,
        postStations[i]!,
        pointAt,
        options.insideWalk,
      )
      const foot = (s: number): Vec3 => [
        a[0] + alongH[0] * s + shift[0],
        a[1] + ((b[1] - a[1]) * s) / span,
        a[2] + alongH[2] * s + shift[2],
      ]
      const start = foot(reveal)
      const rise = foot(span - reveal)[1] - start[1]
      panels.push({ start, yaw, run, rise, bottom, top, thickness: PANEL_T })
      for (const [edge, post] of [
        [foot(reveal), a],
        [foot(span - reveal), b],
      ] as const)
        for (const level of CLAMP_LEVELS)
          frame.push(clamp(edge, alongH, bottom + level * (top - bottom), post))
    }
  }

  return { frame, panels }
}

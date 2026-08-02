/**
 * The sculpt brush: pointer motion → `HeightPatch`.
 *
 * The obvious implementation — `h += strength * falloff` every tick — is wrong,
 * and it is wrong in a way that is well documented by the people who ship it.
 * Dwelling in one spot accumulates without bound, overlapping dabs double-apply,
 * and a fast drag deposits less material than a slow one. That is exactly the
 * "hash edges and jagged" result expert Sims builders complain about and route
 * around. This module implements the model the mature tools converge on instead:
 *
 * 1. **Freeze a snapshot at pointer-down.** Every dab is evaluated against the
 *    snapshot, never against the running result.
 * 2. **Saturating coverage mask.** A dab raises coverage to `max(mask, falloff)`
 *    rather than adding to it, and the height is always
 *    `snapshot + delta * mask`. Re-crossing your own stroke therefore cannot
 *    compound — the second pass recomputes the same value from the same
 *    snapshot.
 * 3. **Arc-length dab spacing.** `advanceStroke` walks from the previous dab to
 *    the new pointer position in fixed metre steps, so stroke strength is a
 *    function of distance travelled, not of mouse speed or frame rate.
 * 4. **Cosine-bell falloff.** Of the standard sculpt kernels this is one of only
 *    two that are C¹ at *both* centre and rim, which is what prevents a visible
 *    ridge at the brush boundary.
 *
 * The consequence users feel: one stroke is one bounded, repeatable edit. Hold
 * still and nothing runs away; press again to go further.
 *
 * The `TerrainStroke` returned by `beginStroke` is a mutable accumulator — the
 * one mutable thing in this file, and deliberately so. It is owned by exactly
 * one in-flight gesture and dies with it, which is cheaper and clearer than
 * rebuilding a coverage map per pointer-move.
 */

import {
  type HeightPatch,
  heightAt,
  heightAtSample,
  quantize,
  type TerrainField,
} from './terrain-field'

export type BrushShape = 'round' | 'square'

/**
 * `raise`/`lower` are one verb with an inverted sign at the call site, matching
 * every surveyed tool's modifier-inverts convention. `flatten` is absolute:
 * it converges on a target height, which is the operation that makes two
 * disjoint building pads provably equal — the thing freehand push/pull cannot do.
 */
export type TerrainVerb = 'raise' | 'lower' | 'flatten' | 'smooth'

export type BrushSettings = {
  /** Brush radius in metres. */
  radius: number
  /** 0–1. Scales how far one full stroke pass gets toward its goal. */
  strength: number
  /**
   * 0–1 softness. 0 is a hard-edged stamp; 1 puts the cosine bell across the
   * whole radius. The inner `1 - falloff` fraction stays at full coverage.
   */
  falloff: number
  shape: BrushShape
}

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  radius: 2,
  strength: 0.6,
  falloff: 0.6,
  shape: 'round',
}

/**
 * Metres a single raise/lower stroke moves the ground at full strength and full
 * coverage. Bounding it per stroke is what makes the verb aimable: the user
 * knows a pass is worth at most this much, and repeats for more.
 */
export const RAISE_METRES_PER_STROKE = 1

/**
 * Smallest brush radius that still bites, as a multiple of the field's spacing.
 *
 * A dab only moves samples that fall *inside* its radius, so a brush narrower
 * than the gap between samples can land entirely between four of them and change
 * nothing: `advanceStroke` returns `null`, and the user drags with no mark, no
 * cursor change, and no error. 1.5 rather than the ~0.71 where a round brush
 * first catches a corner, because a brush that only bites when it happens to
 * straddle a sample is worse than one that is honestly too small — at 1.5 the
 * worst-case coverage is 0.97, so the dab lands wherever it is aimed.
 *
 * A *multiple* of spacing rather than a constant because spacing is not fixed:
 * `fieldExtentForSite` stretches it once a lot exceeds what 257² samples cover
 * at the default, so on a 300 m lot the old flat 0.5 m floor sat below half the
 * sample gap and the brush silently stopped working at the bottom of its range.
 */
export const MIN_BRUSH_RADIUS_IN_SPACINGS = 1.5

/**
 * Clamp a radius to what `field` can actually resolve.
 *
 * Lives here rather than in the editor's UI layer because it is a fact about the
 * footprint math above, not a preference: every producer of a radius (slider,
 * `[`/`]`, a future import preset) has to respect it or it produces a brush that
 * does nothing.
 */
export function minBrushRadius(field: Pick<TerrainField, 'spacing'>): number {
  return field.spacing * MIN_BRUSH_RADIUS_IN_SPACINGS
}

/** Dabs are placed every `radius * this` metres along the pointer path. */
const DAB_SPACING_FRACTION = 0.25

/**
 * Jacobi iterations used to precompute the smooth target. Each is applied with
 * λ = 0.25 on a 4-neighbour stencil, the stability bound for the discrete
 * diffusion — above it the filter oscillates instead of converging.
 */
const SMOOTH_ITERATIONS = 8
const SMOOTH_LAMBDA = 0.25

export type TerrainStroke = {
  readonly verb: TerrainVerb
  readonly settings: BrushSettings
  /** The field at pointer-down. Never mutated; every dab reads from it. */
  readonly snapshot: TerrainField
  /** Absolute target height in metres. Only meaningful for `flatten`. */
  readonly target: number
  /** Sample index → saturating coverage in 0–1. */
  readonly mask: Map<number, number>
  /** Lazily computed diffused snapshot, for `smooth`. */
  smoothed: Int16Array | null
  /** Last dab centre, for arc-length spacing. Null until the first dab. */
  lastX: number | null
  lastZ: number | null
}

export function beginStroke(options: {
  field: TerrainField
  verb: TerrainVerb
  settings?: Partial<BrushSettings>
  /** Absolute height for `flatten`, in metres. Ignored by the other verbs. */
  target?: number
}): TerrainStroke {
  return {
    verb: options.verb,
    settings: { ...DEFAULT_BRUSH_SETTINGS, ...options.settings },
    snapshot: options.field,
    target: options.target ?? 0,
    mask: new Map(),
    smoothed: null,
    lastX: null,
    lastZ: null,
  }
}

/**
 * Sample the height a `flatten` stroke should aim at, from the field itself.
 *
 * Sampling before the stroke starts (right-click / first click, per the surveyed
 * tools) is what makes "flatten this pad to match that corner" a two-step
 * gesture instead of a numeric-entry chore.
 */
export function sampleTarget(field: TerrainField, x: number, z: number): number {
  return heightAt(field, x, z)
}

/**
 * Forget where the last dab landed, without ending the stroke.
 *
 * Needed because dab spacing is a true *arc length*: `advanceStroke` interpolates
 * from the previous centre, so any gap in the pointer stream is bridged with a
 * line of dabs when it resumes. That is exactly right for a dropped frame, and
 * exactly wrong when the caller deliberately skipped a stretch — a camera zoom
 * mid-stroke moves the ground under a held brush, and bridging back to a centre
 * from before the zoom paints a stripe across everything in between.
 *
 * A stroke resumed after this deposits its next dab at the pointer, like the
 * first one. The mask is untouched, so the stroke stays saturating across the
 * break and the whole gesture is still one undo step.
 */
export function detachStrokeAnchor(stroke: TerrainStroke): void {
  stroke.lastX = null
  stroke.lastZ = null
}

/**
 * Extend the stroke to the pointer's new position and return the patch to apply.
 *
 * Returns `null` when the motion is shorter than the dab spacing (nothing
 * changed yet) or when the footprint misses the field entirely. The patch is
 * absolute heights over the union of the dabs placed by *this* call, recomputed
 * from the snapshot and the saturated mask — which is why applying patches in
 * order converges rather than compounding.
 */
export function advanceStroke(stroke: TerrainStroke, x: number, z: number): HeightPatch | null {
  const dabs = dabPositions(stroke, x, z)
  if (dabs.length === 0) return null

  const field = stroke.snapshot
  let minCol = field.cols
  let minRow = field.rows
  let maxCol = -1
  let maxRow = -1

  for (const [dx, dz] of dabs) {
    const range = footprint(field, dx, dz, stroke.settings.radius)
    if (!range) continue
    if (range.col0 < minCol) minCol = range.col0
    if (range.row0 < minRow) minRow = range.row0
    if (range.col1 > maxCol) maxCol = range.col1
    if (range.row1 > maxRow) maxRow = range.row1

    for (let r = range.row0; r <= range.row1; r++) {
      const sampleZ = field.origin[1] + r * field.spacing
      for (let c = range.col0; c <= range.col1; c++) {
        const sampleX = field.origin[0] + c * field.spacing
        const coverage = weightAt(stroke.settings, sampleX - dx, sampleZ - dz)
        if (coverage <= 0) continue
        const index = r * field.cols + c
        const previous = stroke.mask.get(index) ?? 0
        if (coverage > previous) stroke.mask.set(index, coverage)
      }
    }
  }

  if (maxCol < minCol || maxRow < minRow) return null

  const cols = maxCol - minCol + 1
  const rows = maxRow - minRow + 1
  const heights = new Int16Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    const fieldRow = minRow + r
    for (let c = 0; c < cols; c++) {
      const fieldCol = minCol + c
      const index = fieldRow * field.cols + fieldCol
      heights[r * cols + c] = resolveSample(stroke, index, fieldCol, fieldRow)
    }
  }

  return { col0: minCol, row0: minRow, cols, rows, heights }
}

/**
 * The quantized height a sample should hold given the stroke's current mask.
 *
 * Every verb has the same shape — `snapshot + (goal - snapshot) * mask *
 * strength` — which is what makes them all saturating. `raise`/`lower` express
 * their goal as an offset from the snapshot, `flatten` as an absolute, and
 * `smooth` as the diffused snapshot.
 */
function resolveSample(stroke: TerrainStroke, index: number, col: number, row: number): number {
  const field = stroke.snapshot
  const base = field.heights[index] ?? 0
  const coverage = stroke.mask.get(index) ?? 0
  if (coverage <= 0) return base

  const amount = coverage * stroke.settings.strength
  const baseMetres = base * field.step

  switch (stroke.verb) {
    case 'raise':
      return quantize(field, baseMetres + RAISE_METRES_PER_STROKE * amount)
    case 'lower':
      return quantize(field, baseMetres - RAISE_METRES_PER_STROKE * amount)
    case 'flatten':
      return quantize(field, baseMetres + (stroke.target - baseMetres) * amount)
    case 'smooth': {
      const smoothed = smoothedSnapshot(stroke)
      const goal = (smoothed[index] ?? base) * field.step
      return quantize(field, baseMetres + (goal - baseMetres) * amount)
    }
    default:
      // `col`/`row` are carried for future verbs that need position (terrace).
      void col
      void row
      return base
  }
}

/**
 * The diffused snapshot every `smooth` dab lerps toward, computed once per
 * stroke.
 *
 * Whole-field rather than stroke-local: a local blur would need its border
 * samples pinned, and pinned borders are precisely where a smooth brush leaves
 * the ridge it was supposed to remove. The cost is a few passes over an array
 * that is 4 225 entries at the default 65² size.
 */
function smoothedSnapshot(stroke: TerrainStroke): Int16Array {
  if (stroke.smoothed) return stroke.smoothed
  const field = stroke.snapshot
  let current = new Int16Array(field.heights)
  let next = new Int16Array(current.length)
  for (let iteration = 0; iteration < SMOOTH_ITERATIONS; iteration++) {
    for (let r = 0; r < field.rows; r++) {
      for (let c = 0; c < field.cols; c++) {
        const index = r * field.cols + c
        const centre = current[index] ?? 0
        const laplacian =
          sampleClamped(current, field, c - 1, r) +
          sampleClamped(current, field, c + 1, r) +
          sampleClamped(current, field, c, r - 1) +
          sampleClamped(current, field, c, r + 1) -
          4 * centre
        next[index] = Math.round(centre + SMOOTH_LAMBDA * laplacian)
      }
    }
    const swap = current
    current = next
    next = swap
  }
  stroke.smoothed = current
  return current
}

function sampleClamped(heights: Int16Array, field: TerrainField, col: number, row: number): number {
  const c = Math.max(0, Math.min(field.cols - 1, col))
  const r = Math.max(0, Math.min(field.rows - 1, row))
  return heights[r * field.cols + c] ?? 0
}

/**
 * Dab centres from the last one to `(x, z)`, spaced by arc length.
 *
 * The first dab of a stroke is placed exactly at the pointer, so a click with no
 * drag still deposits one dab. After that, motion shorter than one spacing
 * deposits nothing and the stroke keeps its old anchor — which is what makes the
 * spacing a true arc length rather than a per-event budget.
 */
function dabPositions(stroke: TerrainStroke, x: number, z: number): Array<[number, number]> {
  if (stroke.lastX === null || stroke.lastZ === null) {
    stroke.lastX = x
    stroke.lastZ = z
    return [[x, z]]
  }

  const spacing = Math.max(1e-3, stroke.settings.radius * DAB_SPACING_FRACTION)
  const dx = x - stroke.lastX
  const dz = z - stroke.lastZ
  const distance = Math.hypot(dx, dz)
  if (distance < spacing) return []

  const steps = Math.floor(distance / spacing)
  const dabs: Array<[number, number]> = []
  for (let step = 1; step <= steps; step++) {
    const t = (step * spacing) / distance
    dabs.push([stroke.lastX + dx * t, stroke.lastZ + dz * t])
  }
  const last = dabs[dabs.length - 1]
  if (last) {
    stroke.lastX = last[0]
    stroke.lastZ = last[1]
  }
  return dabs
}

/** Sample range a dab of `radius` at `(x, z)` touches, clamped to the field. */
function footprint(
  field: TerrainField,
  x: number,
  z: number,
  radius: number,
): { col0: number; row0: number; col1: number; row1: number } | null {
  const col0 = Math.max(0, Math.ceil((x - radius - field.origin[0]) / field.spacing))
  const row0 = Math.max(0, Math.ceil((z - radius - field.origin[1]) / field.spacing))
  const col1 = Math.min(field.cols - 1, Math.floor((x + radius - field.origin[0]) / field.spacing))
  const row1 = Math.min(field.rows - 1, Math.floor((z + radius - field.origin[1]) / field.spacing))
  if (col1 < col0 || row1 < row0) return null
  return { col0, row0, col1, row1 }
}

/**
 * Coverage in 0–1 for a sample at offset `(dx, dz)` from a dab centre.
 *
 * Round uses Euclidean distance, square uses Chebyshev — the same radius means
 * the square brush's inscribed circle matches the round one, so switching shape
 * mid-session does not change the brush's apparent size.
 */
export function weightAt(settings: BrushSettings, dx: number, dz: number): number {
  const radius = Math.max(1e-6, settings.radius)
  const distance =
    settings.shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz)
  const normalized = distance / radius
  if (normalized >= 1) return 0

  const falloff = Math.min(1, Math.max(0, settings.falloff))
  if (falloff <= 0) return 1

  const inner = 1 - falloff
  if (normalized <= inner) return 1
  const t = (normalized - inner) / falloff
  // Cosine bell: 1 at t=0, 0 at t=1, zero derivative at both ends.
  return 0.5 * (1 + Math.cos(Math.PI * t))
}

/**
 * The world-XZ height under a brush, for the readout the sculpt HUD shows.
 * Thin, but it keeps the tool from importing `heightAt` just to render a number.
 */
export function brushHeightAt(field: TerrainField, x: number, z: number): number {
  return heightAt(field, x, z)
}

/** Peak coverage the stroke reached, for tests and for the HUD's "pass" readout. */
export function maxCoverage(stroke: TerrainStroke): number {
  let max = 0
  for (const value of stroke.mask.values()) if (value > max) max = value
  return max
}

/**
 * Highest sample height in metres under a world-XZ rect — the seed a `flatten`
 * pad uses when the user asks for "level with the high corner" rather than
 * typing a number.
 */
export function highestOver(
  field: TerrainField,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): number {
  const col0 = Math.max(0, Math.floor((minX - field.origin[0]) / field.spacing))
  const row0 = Math.max(0, Math.floor((minZ - field.origin[1]) / field.spacing))
  const col1 = Math.min(field.cols - 1, Math.ceil((maxX - field.origin[0]) / field.spacing))
  const row1 = Math.min(field.rows - 1, Math.ceil((maxZ - field.origin[1]) / field.spacing))
  if (col1 < col0 || row1 < row0) return heightAtSample(field, col0, row0)

  let highest = Number.NEGATIVE_INFINITY
  for (let r = row0; r <= row1; r++) {
    for (let c = col0; c <= col1; c++) {
      const value = (field.heights[r * field.cols + c] ?? 0) * field.step
      if (value > highest) highest = value
    }
  }
  return highest
}

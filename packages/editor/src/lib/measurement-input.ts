import type { LingoUnitSpec } from './measurement-parser'
import { parseMeasurement } from './measurement-parser'
import type { MetricNotation } from './measurements'

/**
 * The typed-dimension buffer ("measurements box"): while an interaction is in
 * flight the user types a value, and the interaction re-resolves to exactly
 * that value instead of whatever the cursor proposed.
 *
 * Pure logic only — no store, no React. The store wraps this; tools consume the
 * resolved number.
 */

/** What the active interaction is asking the user to type. */
export type MeasurementInputField = 'length' | 'angle'

const LENGTH_SPEC: LingoUnitSpec = { kind: 'length', unitId: 'm' }
const ANGLE_SPEC: LingoUnitSpec = { kind: 'angle', unitId: 'rad' }

export function measurementInputSpec(field: MeasurementInputField): LingoUnitSpec {
  return field === 'angle' ? ANGLE_SPEC : LENGTH_SPEC
}

/**
 * Unit a bare number is read in — SketchUp's "model units" rule. Follows the
 * viewer's display preference so `4200` means millimetres to a user working in
 * millimetres and metres to a user working in metres. An explicitly typed unit
 * (`180cm`) always wins over this; see `parseMeasurement`.
 */
export function bareLengthUnit(
  unit: 'metric' | 'imperial',
  notation: MetricNotation = 'meters',
): string {
  if (unit === 'imperial') return 'ft'
  return notation === 'millimeters' ? 'mm' : 'm'
}

/**
 * A buffer only ever *starts* with a digit, a decimal separator, or a sign.
 * This is what keeps the single-letter tool shortcuts (`b`, `v`, `m`, `x`, …)
 * usable: they are only shadowed once the user has committed to typing a
 * number, at which point every key belongs to the buffer so units like `mm`
 * and `ft` can be spelled out.
 */
export function isMeasurementInputStartKey(key: string): boolean {
  return key.length === 1 && (/[0-9]/.test(key) || key === '.' || key === ',')
}

/** Any single printable character continues an already-started buffer. */
export function isMeasurementInputContinueKey(key: string): boolean {
  return key.length === 1 && key !== ' '
}

/**
 * Read the buffer as a stored value: metres for `length`, radians for `angle`.
 *
 * The parser is forgiving by design, so a half-typed number resolves to what it
 * reads so far — `"4."` is 4, `"4.2"` is 4.2. That is what makes the draft track
 * the value live as it is typed rather than snapping into place only on Enter.
 * `null` is reserved for text that carries no quantity at all, and is the signal
 * to keep showing the cursor-driven value.
 */
export function resolveMeasurementInput(
  buffer: string,
  field: MeasurementInputField,
  bareUnit: string,
): number | null {
  const trimmed = buffer.trim().replace(',', '.')
  if (!trimmed) return null
  const spec = measurementInputSpec(field)
  const parsed = parseMeasurement(trimmed, spec, { bareUnit: field === 'angle' ? 'deg' : bareUnit })
  if (parsed === null || !Number.isFinite(parsed)) return null
  return parsed
}

export type PlanPoint = readonly [number, number]

/**
 * Place a point at exactly `length` from `start`, along the direction the
 * cursor is proposing. The cursor keeps choosing the *direction* (including any
 * axis lock or angle snap already applied to it) while the typed value owns the
 * *distance* — this is why typing a length mid-draft doesn't fight the snap.
 *
 * A degenerate direction (cursor still on the start point) has no answer, so
 * the caller keeps its current point.
 */
export function applyFixedLength(
  start: PlanPoint,
  directionTowards: PlanPoint,
  length: number,
): PlanPoint | null {
  if (!Number.isFinite(length) || length === 0) return null
  const dx = directionTowards[0] - start[0]
  const dy = directionTowards[1] - start[1]
  const magnitude = Math.hypot(dx, dy)
  if (magnitude < 1e-9) return null
  const scale = length / magnitude
  return [start[0] + dx * scale, start[1] + dy * scale]
}

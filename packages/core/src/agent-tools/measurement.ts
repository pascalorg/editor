import { type Kind, parseQuantity } from '@pascal-app/lingo'
import { z } from 'zod'

/**
 * Lengths, angles and roof pitches as every agent tool takes them (the tool catalogue's "one
 * convention per quantity"). A field states its unit, and a model may answer with a bare number
 * in that unit or with text in any unit: `measurement('length', 'm')` accepts `0.15`, `"6 in"`,
 * `"180cm"`, `"2 ft 3 in"`; `measurement('angle', 'deg')` accepts `45`, `"45°"`, `"1.57rad"`;
 * `roofPitch('twelfths')` accepts `6`, `"6:12"`, `"26.6°"`. The value reaches the handler as a
 * number in the field's unit, so a bare number keeps its meaning and no handler converts.
 * `min`/`max` (in the unit) refuse out-of-range values with a model-readable message.
 *
 * The emitted JSON Schema is `number | string`. The AI SDK and the MCP SDK apply the transform
 * when they validate a call, and every tab that runs a call parses it again with its contract.
 *
 * Tool-boundary safety: genuinely ambiguous separators (`"1,234"`, which could mean 1234 or
 * 1.234) are refused rather than absorbed, so a European decimal never becomes a 1000× value.
 * The MCP and the hosted chat import this module (`@pascal-app/core/agent-tools`).
 */

export interface MeasurementOptions {
  /** Semantic description (e.g. "Wall thickness"). The natural-language note is appended. */
  description?: string
  /** Upper bound, in `unit`. */
  max?: number
  /** Inclusive lower bound, in `unit`. */
  min?: number
  /** Require the value to be strictly greater than 0 (for non-zero dimensions). */
  positive?: boolean
}

// What a field says once per field, read on every call: its unit, named first so a bare number
// is read in it (a bare "45" in a radians field is 45 rad), and text in other units.
const UNIT_NOTES: Record<string, string> = {
  m: 'In metres, or text with a unit ("6 ft").',
  in: 'In inches, or text with a unit ("1.5 ft").',
  ft: 'In feet, or text with a unit ("72 in").',
  mm: 'In millimetres, or text with a unit ("2.6cm").',
  deg: 'In degrees, or text with a unit ("1.57rad").',
  rad: 'In radians, or text with a unit ("90°").',
}

function boundsNote(
  unit: string,
  min: number | undefined,
  max: number | undefined,
  positive: boolean,
): string {
  if (positive) {
    return max === undefined
      ? ` Must be greater than 0 ${unit}.`
      : ` Greater than 0, up to ${max} ${unit}.`
  }
  if (min !== undefined && max !== undefined) return ` Range ${min}–${max} ${unit}.`
  if (min !== undefined) return ` Minimum ${min} ${unit}.`
  if (max !== undefined) return ` Maximum ${max} ${unit}.`
  return ''
}

/** A number read from text, in the field's unit, or why it could not be read. */
type Reading = number | { error: string }

const BARE_NUMBER = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?\s*$/i

/** A conversion's float noise dropped: "6" read as inches is 6, not 5.999999999999999. */
const clean = (value: number) => Number(value.toPrecision(12))

/** `unitRequired`: text without a unit is refused, not read in `unit`. */
function readQuantity(text: string, kind: Kind, unit: string, unitRequired = false): Reading {
  const result = parseQuantity(text, {
    kind,
    unit,
    strictness: 'forgiving',
    accept: { bareNumbers: !unitRequired },
    // A genuinely ambiguous separator ("1,234") must not silently become a 1000× value at a
    // tool boundary: fail so the model self-corrects.
    escalate: { AMBIGUOUS_NUMBER: 'error' },
  })
  if (!result.ok)
    return { error: result.issues[0]?.message ?? `Could not read "${text}" as a ${kind}.` }
  return clean(result.quantity.to(unit).value)
}

/** A number or text field, read to a number in `unit` and held to the bounds. */
function quantityField(
  read: (text: string) => Reading,
  what: string,
  unit: string,
  note: string,
  opts: MeasurementOptions,
) {
  const { min, max, positive = false } = opts
  const outOfBounds = (value: number): string | undefined => {
    if (!Number.isFinite(value)) return `Value must be a finite ${what} in ${unit}.`
    if (positive && value <= 0) return `Must be greater than 0 ${unit} (got ${value}).`
    if (min !== undefined && value < min) return `Must be at least ${min} ${unit} (got ${value}).`
    if (max !== undefined && value > max) return `Must be at most ${max} ${unit} (got ${value}).`
  }
  const description = [opts.description, note + boundsNote(unit, min, max, positive)]
    .filter(Boolean)
    .join(' ')
  return z
    .union([z.number(), z.string()])
    .transform((val, ctx) => {
      const refuse = (message: string) => {
        ctx.addIssue({ code: 'custom', message })
        return z.NEVER
      }
      const value = typeof val === 'number' ? val : read(val)
      if (typeof value !== 'number') return refuse(value.error)
      const problem = outOfBounds(value)
      return problem === undefined ? value : refuse(problem)
    })
    .describe(description)
}

/** A length or an angle in `unit` (`m`, `in`, `ft`, `mm`; `deg`, `rad`). */
export function measurement(kind: Kind, unit: string, opts: MeasurementOptions = {}) {
  return quantityField(
    (text) => readQuantity(text, kind, unit),
    kind,
    unit,
    UNIT_NOTES[unit] ?? `In ${unit}, or text with a unit.`,
    opts,
  )
}

/** A roof's pitch: its angle in degrees, or its rise per 12 of run (`6` for a 6:12 roof). */
export type PitchUnit = 'deg' | 'twelfths'

/** Rise over run, as a pitch is said: "6:12", "6/12", "6 in 12", "6-in-12", "6 on 12", "6:12 pitch". */
const RISE_OVER_RUN =
  /^\s*\+?(\d+\.?\d*|\.\d+)\s*(?::|\/|-?\s*(?:in|on)\s*-?)\s*(\d+\.?\d*|\.\d+)(?:\s*pitch)?\s*$/i

const twelfthsToDegrees = (twelfths: number) => (Math.atan(twelfths / 12) * 180) / Math.PI
const degreesToTwelfths = (degrees: number) => 12 * Math.tan((degrees * Math.PI) / 180)

const PITCH_NOTES: Record<PitchUnit, string> = {
  deg: 'In degrees, or rise over run ("6:12").',
  twelfths: 'Rise per 12 of run (6 for 6:12), or "6:12" or "26.6°".',
}

function readPitch(said: string, unit: PitchUnit): Reading {
  // Full-width forms ("６／１２") read as their ASCII twins.
  const text = said.normalize('NFKC')
  const ratio = RISE_OVER_RUN.exec(text)
  if (ratio) {
    const run = Number(ratio[2])
    if (run === 0) return { error: `"${text}" has no run: give the rise per 12, as "6:12".` }
    const twelfths = (12 * Number(ratio[1])) / run
    return clean(unit === 'twelfths' ? twelfths : twelfthsToDegrees(twelfths))
  }
  if (BARE_NUMBER.test(text)) return Number(text)
  // Anything else must name its angle unit ("26.6°", "0.46 rad"): without one, the unit parser
  // reads text such as "6,0" or "6 / 12 / 1" as degrees. It reads what was said, not its NFKC
  // form, which turns "26¼°" into "261⁄4°".
  const degrees = readQuantity(said, 'angle', 'deg', true)
  if (typeof degrees !== 'number')
    return {
      error: `Could not read "${said}" as a roof pitch: give degrees ("26.6°") or the rise per 12 ("6:12").`,
    }
  if (unit === 'deg') return degrees
  // A plane at 90° rises forever per 12 of run: no roof.
  if (Math.abs(degrees) >= 90) return { error: `A roof pitch is under 90° (got ${degrees}°).` }
  return clean(degreesToTwelfths(degrees))
}

/**
 * A roof pitch in `unit`, read from either way of saying it: degrees (`26.6`, `"26.6°"`,
 * `"0.46 rad"`) or rise over run (`"6:12"`, `"6/12"`, `"6 in 12"`). A bare number is in `unit`.
 */
export function roofPitch(unit: PitchUnit, opts: MeasurementOptions = {}) {
  return quantityField((text) => readPitch(text, unit), 'roof pitch', unit, PITCH_NOTES[unit], opts)
}

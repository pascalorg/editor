import { type Kind, parseQuantity } from '@pascal-app/lingo'
import { z } from 'zod'

/**
 * A zod field for a measurement tool argument that a model may emit as a bare
 * number OR as natural language. `measurement('length', 'm')` accepts `0.15`,
 * `"6 in"`, `"180cm"`, `"2 ft 3 in"`; `measurement('angle', 'deg')` accepts
 * `45`, `"45°"`, `"1.57rad"`, `"0.25 turn"`. The value is canonicalized (via
 * `@pascal-app/lingo`) to a number in `unit` — the exact unit the tool handler
 * already expects — so no handler change is needed. `min`/`max` (in `unit`)
 * reject out-of-range values with a model-readable message.
 *
 * The emitted JSON Schema is `number | string`, so the model is free to answer
 * in whatever unit it is thinking in; AI SDK v6 applies the transform and
 * forwards the canonical number to the tool executor.
 *
 * Tool-boundary safety: genuinely ambiguous separators (`"1,234"`, which could
 * mean 1234 or 1.234) are rejected rather than silently absorbed, so a European
 * decimal never becomes a 1000× value.
 *
 * NOTE: intentionally duplicated as `editor/packages/mcp/src/tools/measurement.ts`
 * (MCP tools) and `packages/ai/src/tools/scene/measurement.ts` (AI-chat tools).
 * The two tool stacks live in different packages — one inside the `editor`
 * submodule — so they can't share a module. Keep the two copies identical; the
 * clean long-term dedup is a zod-field adapter exported from `@pascal-app/lingo`.
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

function unitNoun(unit: string): string {
  switch (unit) {
    case 'm':
      return 'meters'
    case 'deg':
      return 'degrees'
    case 'rad':
      return 'radians'
    default:
      return unit
  }
}

function naturalLanguageNote(kind: Kind, unit: string): string {
  let examples: string
  if (kind === 'angle') {
    // Lead with an example in the field's own unit so a bare number is read
    // the way the model intends (a bare "45" in a radians field is 45 rad).
    examples =
      unit === 'rad' ? '1.5708, "90°", "1.57rad", "0.25 turn"' : '45, "45°", "1.57rad", "0.25 turn"'
  } else {
    examples = '0.9, "6 ft", "180cm", "2 ft 3 in"'
  }
  return `Accepts a number (${unitNoun(unit)}) or a natural-language string; other units are converted. e.g. ${examples}.`
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

export function measurement(kind: Kind, unit: string, opts: MeasurementOptions = {}) {
  const { min, max, positive = false } = opts
  const description = [
    opts.description,
    naturalLanguageNote(kind, unit) + boundsNote(unit, min, max, positive),
  ]
    .filter(Boolean)
    .join(' ')

  return z
    .union([z.number(), z.string()])
    .transform((val, ctx) => {
      let value: number
      if (typeof val === 'number') {
        value = val
      } else {
        const result = parseQuantity(val, {
          kind,
          unit,
          strictness: 'forgiving',
          // A genuinely ambiguous separator ("1,234") must not silently become
          // a 1000× value at a tool boundary — fail so the model self-corrects.
          escalate: { AMBIGUOUS_NUMBER: 'error' },
        })
        if (!result.ok) {
          ctx.addIssue({
            code: 'custom',
            message: result.issues[0]?.message ?? `Could not read "${val}" as a ${kind}.`,
          })
          return z.NEVER
        }
        value = result.quantity.to(unit).value
      }
      if (!Number.isFinite(value)) {
        ctx.addIssue({ code: 'custom', message: `Value must be a finite ${kind} in ${unit}.` })
        return z.NEVER
      }
      if (positive && value <= 0) {
        ctx.addIssue({ code: 'custom', message: `Must be greater than 0 ${unit} (got ${value}).` })
        return z.NEVER
      }
      if (min !== undefined && value < min) {
        ctx.addIssue({ code: 'custom', message: `Must be at least ${min} ${unit} (got ${value}).` })
        return z.NEVER
      }
      if (max !== undefined && value > max) {
        ctx.addIssue({ code: 'custom', message: `Must be at most ${max} ${unit} (got ${value}).` })
        return z.NEVER
      }
      return value
    })
    .describe(description)
}

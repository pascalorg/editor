import type { Completion } from '../complete/types'
import type {
  IssueCode,
  Kind,
  LingoIssue,
  LingoOptions,
  LingoResult,
  Messages,
  NumberFormatPolicy,
  Quantity,
  QuantityRange,
  Registry,
  Severity,
  UnitSystem,
} from '../index'
import { Controller, type LingoElement, registry } from './controller'
import type { CandidateResult } from './format'

/**
 * A `LingoField`'s current state, reflected as `data-state` on the element.
 * `'incomplete'` (a valid prefix, mid-typing) never renders an error —
 * distinct from `'invalid'`.
 * @example
 * ```ts
 * import { lingoInput } from '@pascal-app/lingo/dom'
 * const field = lingoInput(document.querySelector<HTMLInputElement>('#height')!, { kind: 'length', unit: 'm' })
 * field.state // 'idle' until the user types
 * ```
 */
export type LingoFieldState = 'idle' | 'incomplete' | 'valid' | 'invalid'
/**
 * How a committed value is written back into the input: `'canonical'`
 * (re-render in the display unit, e.g. "0.61 m"), `'echo'` (keep the user's
 * own unit), or `'preserve'` (never touch what the user typed).
 */
export type LingoDisplayMode = 'canonical' | 'echo' | 'preserve'
/**
 * How validation errors surface: `'native'` uses Constraint Validation
 * (`setCustomValidity`/`reportValidity`); `'aria'` relies on `errorElement` +
 * `aria-invalid`/`aria-describedby` instead. Defaults to `'aria'` when
 * `errorElement` is set, `'native'` otherwise.
 */
export type LingoValidationBehavior = 'native' | 'aria'

/**
 * Options for `lingoInput()`. Most fields mirror `LingoOptions`
 * (`kind`/`unit`/`system`/`strictness`/`accept`/`tolerance`/`escalate`/
 * `messages`/`registry`); the rest control DOM wiring: `min`/`max` bounds
 * (as parseable strings or numbers), `name` (adds a hidden input carrying
 * the canonical value on submit), `errorElement`/`hintElement` (selector or
 * element for error text / live "= 1.8 m" hints), and `onParse`/`onCommit`/
 * `onError`/`onStateChange` callbacks (mirrored by the `'lingo:change'` DOM
 * event for non-React listeners).
 * @example
 * ```ts
 * import { lingoInput } from '@pascal-app/lingo/dom'
 * lingoInput(document.querySelector<HTMLInputElement>('#height')!, {
 *   kind: 'length',
 *   unit: 'm',              // canonical unit — what your backend receives
 *   name: 'height_m',       // hidden input carries "1.8034" on submit
 *   errorElement: '#height-error',
 *   hintElement: '#height-hint',
 * })
 * ```
 */
export interface LingoInputOptions {
  accept?: LingoOptions['accept']
  /** Ranked completion provider — inject from `@pascal-app/lingo/complete`. */
  complete?: (text: string) => readonly Completion[]
  debounce?: number
  display?: LingoDisplayMode
  displayUnit?: string
  errorElement?: HTMLElement | string
  escalate?: Partial<Record<IssueCode, Severity>>
  formatCandidate?: (r: CandidateResult) => string | undefined
  formatHint?: (r: LingoResult) => string | undefined
  hiddenFormat?: (q: Quantity | QuantityRange) => string | undefined
  hintElement?: HTMLElement | string
  inputmode?: string
  kind?: Kind
  listboxId?: string
  max?: string | number
  messages?: Messages
  min?: string | number
  name?: string
  numberFormat?: NumberFormatPolicy
  onCommit?: (field: LingoField) => void
  /** Fires whenever ranked completions are recomputed (typing). */
  onComplete?: (completions: readonly Completion[], field: LingoField) => void
  onError?: (issues: readonly LingoIssue[], field: LingoField) => void
  onParse?: (result: LingoResult, field: LingoField) => void
  onStateChange?: (state: LingoFieldState, field: LingoField) => void
  profile?: string
  registry?: Registry
  required?: boolean
  strictness?: LingoOptions['strictness']
  system?: Exclude<UnitSystem, 'shared'>
  tolerance?: LingoOptions['tolerance']
  unit?: string
  validationBehavior?: LingoValidationBehavior
}

/**
 * The live controller `lingoInput()` returns/attaches. Also reachable via
 * `lingoInput.get(element)`.
 * @example
 * ```ts
 * import { lingoInput } from '@pascal-app/lingo/dom'
 * const field = lingoInput(document.querySelector<HTMLInputElement>('#height')!, {
 *   kind: 'length', unit: 'm',
 * })
 * field.set('6ft')      // programmatic — agents welcome
 * field.value            // 1.8288 (number, in meters)
 * field.state             // 'valid'
 * field.destroy()          // detach, restore original attributes/listeners
 * ```
 */
export interface LingoField {
  commit(): void
  destroy(): void
  readonly quantity: Quantity | QuantityRange | null
  readonly raw: string
  readonly result: LingoResult | null
  set(v: number | string): void
  readonly state: LingoFieldState
  update(opts: Partial<LingoInputOptions>): void
  readonly value: number | null
}

/**
 * Turn an `<input>`/`<textarea>` into a natural-language field. Headless: no
 * styles shipped, state exposed as `data-*` attributes so you style it
 * yourself:
 *
 * - `data-lingo="input"` — marks the element as controlled.
 * - `data-state` — mirrors `LingoFieldState` ('idle' | 'incomplete' | 'valid' | 'invalid').
 * - `data-kind` — the parsed value's `Kind`, when known.
 * - `data-touched` — present once the user has blurred/committed the field.
 * - `data-dirty` — present once the value differs from its initial value.
 * - `data-valid` / `data-invalid` — present once touched AND that state applies.
 * - `data-approx` — present when the committed value is approximate ("about 5 kg").
 * - `data-canonical` — the committed value's raw canonical number as a string.
 * - `data-unit` — the `unit` option, when set.
 *
 * A `'lingo:change'` `CustomEvent` (bubbling) fires whenever `state`/`value`
 * changes, with `detail: { state, value, result }` — for listeners that
 * aren't holding a reference to the returned `LingoField`.
 *
 * Throws if called outside a DOM environment, or if the element is already
 * controlled (reuse `lingoInput.get(element)` or call `field.destroy()` first).
 * @example
 * ```ts
 * import { lingoInput } from '@pascal-app/lingo/dom'
 *
 * const field = lingoInput(document.querySelector<HTMLInputElement>('#height')!, {
 *   kind: 'length',
 *   unit: 'm',
 *   name: 'height_m',
 *   errorElement: '#height-error',
 *   hintElement: '#height-hint',
 * })
 *
 * document.querySelector('#height')!.addEventListener('lingo:change', (e) => {
 *   console.log((e as CustomEvent).detail.state) // 'idle' | 'incomplete' | 'valid' | 'invalid'
 * })
 *
 * // user types: 5'11     → hint shows "= 1.80 m", state 'valid'
 * // user types: 5 f      → state 'incomplete' (never yelled at mid-typing)
 * // user types: banana   → on blur: aria-invalid, error text + announcement
 * // on blur              → input shows "1.8 m" (display: 'canonical')
 * ```
 */
export function lingoInput(el: LingoElement, opts: LingoInputOptions = {}): LingoField {
  if (typeof window === 'undefined' && typeof document === 'undefined') {
    throw new Error(
      'lingo: lingoInput(element) requires a browser DOM. Call it after document exists or guard server-side code.',
    )
  }
  if (registry.has(el)) {
    throw new Error(
      'lingo: input is already controlled. Reuse lingoInput.get(element), call field.destroy(), or pass another element.',
    )
  }
  const field = new Controller(el, opts)
  registry.set(el, field)
  return field
}

export namespace lingoInput {
  /**
   * Look up the `LingoField` already attached to an element, if any —
   * avoids the "already controlled" throw when code paths might attach twice.
   * @example
   * ```ts
   * import { lingoInput } from '@pascal-app/lingo/dom'
   * const el = document.querySelector<HTMLInputElement>('#height')!
   * lingoInput.get(el) ?? lingoInput(el, { kind: 'length', unit: 'm' })
   * ```
   */
  export function get(el: LingoElement): LingoField | undefined {
    return registry.get(el)
  }
}

export type { CandidateResult, LingoFieldFormatOptions } from './format'

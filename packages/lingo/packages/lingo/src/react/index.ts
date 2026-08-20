'use client'

import * as React from 'react'
import type { Completion } from '../complete/types'
import {
  type LingoField,
  type LingoFieldState,
  type LingoInputOptions,
  lingoInput,
} from '../dom/index'
import type { LingoResult, Quantity, QuantityRange } from '../index'
import { optionSignature, structuralSignature } from './signature'

/**
 * Options for `useLingoInput()`: every `LingoInputOptions` field, plus a
 * controlled `value` (set it to drive the field programmatically) and
 * `onValueChange` for React-idiomatic change handling instead of
 * `onStateChange`/the `'lingo:change'` DOM event.
 */
export type UseLingoInputOptions = LingoInputOptions & {
  value?: number | null
  onValueChange?: (v: number | null, q: Quantity | QuantityRange | null) => void
}

/** What `useLingoInput()` returns — spread `ref` onto your `<input>`. */
export interface UseLingoInputResult<
  T extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement,
> {
  commit(): void
  /** Ranked completions from the injected provider; empty while collapsed. */
  completions: readonly Completion[]
  /** Ranked completion currently highlighted, or `-1` when collapsed. */
  highlightedIndex: number
  quantity: Quantity | QuantityRange | null
  ref: (node: T | null) => void
  result: LingoResult | null
  /** Select a completion by index, defaulting to `highlightedIndex`. */
  selectCompletion(index?: number): void
  set(v: number | string): void
  /** Move the highlight, clamped to the current completion list. */
  setHighlightedIndex(index: number): void
  /** Mirrors the underlying `LingoField.state` — see `LingoFieldState`. */
  state: LingoFieldState
  value: number | null
}

type LiveMessages = NonNullable<LingoInputOptions['messages']>
type FormatCandidateInput = Parameters<NonNullable<LingoInputOptions['formatCandidate']>>[0]

const CONTROLLED_VALUE_EPSILON = 1e-12

interface Snapshot {
  quantity: Quantity | QuantityRange | null
  quantitySig: string
  result: LingoResult | null
  resultSig: string
  state: LingoFieldState
  value: number | null
}

function liveMessages(source: React.RefObject<UseLingoInputOptions>): LiveMessages {
  return new Proxy({} as LiveMessages, {
    get(_target, prop) {
      if (typeof prop !== 'string') {
        return
      }
      return (source.current.messages as Record<string, unknown> | undefined)?.[prop]
    },
    ownKeys() {
      return Reflect.ownKeys(source.current.messages ?? {})
    },
    getOwnPropertyDescriptor(_target, prop) {
      const messages = source.current.messages
      if (!(messages && Object.hasOwn(messages, prop))) {
        return
      }
      return { configurable: true, enumerable: true }
    },
  })
}

function sameControlledValue(expected: number | null, actual: number | null): boolean {
  if (Object.is(expected, actual)) {
    return true
  }
  if (expected === null || actual === null) {
    return false
  }
  if (!(Number.isFinite(expected) && Number.isFinite(actual))) {
    return false
  }
  const scale = Math.max(1, Math.abs(expected), Math.abs(actual))
  return Math.abs(expected - actual) <= CONTROLLED_VALUE_EPSILON * scale
}

function snapshot(field: LingoField | null): Snapshot {
  const quantity = field?.quantity ?? null
  const result = field?.result ?? null
  return {
    state: field?.state ?? 'idle',
    value: field?.value ?? null,
    quantity,
    result,
    quantitySig: structuralSignature(quantity),
    resultSig: structuralSignature(result),
  }
}

/** Options passed to update() — value options only; messages, function options,
 * and event callbacks stay as the live-reading wrappers installed at attach. */
function updateOptions(o: UseLingoInputOptions): Partial<LingoInputOptions> {
  return {
    kind: o.kind,
    unit: o.unit,
    displayUnit: o.displayUnit,
    display: o.display,
    system: o.system,
    numberFormat: o.numberFormat,
    profile: o.profile,
    strictness: o.strictness,
    accept: o.accept,
    tolerance: o.tolerance,
    escalate: o.escalate,
    registry: o.registry,
    min: o.min,
    max: o.max,
    required: o.required,
    name: o.name,
    validationBehavior: o.validationBehavior,
    errorElement: o.errorElement,
    hintElement: o.hintElement,
    inputmode: o.inputmode,
    listboxId: o.listboxId,
    debounce: o.debounce,
  }
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return (
    a.state === b.state &&
    a.value === b.value &&
    a.quantitySig === b.quantitySig &&
    a.resultSig === b.resultSig
  )
}

interface CompletionView {
  completions: readonly Completion[]
  highlightedIndex: number
}

const EMPTY_COMPLETION_VIEW: CompletionView = {
  completions: [],
  highlightedIndex: -1,
}

/**
 * React hook wrapping `lingoInput()`: attach `ref` to your `<input>`/
 * `<textarea>` and get back live parse and injected completion state.
 * Options are live-read on every render (see the option-signature note
 * below) so inline objects/callbacks are safe to pass without memoizing.
 * @example
 * ```tsx
 * import { completions } from '@pascal-app/lingo/complete'
 * import { useLingoInput } from '@pascal-app/lingo/react'
 *
 * function HeightField() {
 *   const field = useLingoInput({
 *     kind: 'length',
 *     unit: 'm',
 *     complete: (text) => completions(text, { kind: 'length' }),
 *   })
 *   return <input ref={field.ref} data-state={field.state} />
 * }
 * ```
 */
export function useLingoInput<T extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement>(
  opts: UseLingoInputOptions = {},
): UseLingoInputResult<T> {
  const fieldRef = React.useRef<LingoField | null>(null)
  const elementRef = React.useRef<T | null>(null)
  const optsRef = React.useRef(opts)
  const appliedSigRef = React.useRef<string | null>(null)
  const [view, setView] = React.useState<Snapshot>(() => snapshot(null))
  const [completionView, setCompletionView] = React.useState<CompletionView>(EMPTY_COMPLETION_VIEW)

  optsRef.current = opts

  const syncView = React.useCallback(() => {
    const next = snapshot(fieldRef.current)
    setView((prev) => (sameSnapshot(prev, next) ? prev : next))
  }, [])

  const updateCompletionView = React.useCallback((completions: readonly Completion[]) => {
    const next: CompletionView = {
      completions,
      highlightedIndex: completions.length ? 0 : -1,
    }
    setCompletionView(next)
  }, [])

  const liveComplete = React.useCallback(
    (text: string) => optsRef.current.complete?.(text) ?? [],
    [],
  )

  const handleCompletions = React.useCallback(
    (completions: readonly Completion[], field: LingoField) => {
      const expanded = elementRef.current?.getAttribute('aria-expanded') === 'true'
      updateCompletionView(expanded ? completions : [])
      optsRef.current.onComplete?.(completions, field)
    },
    [updateCompletionView],
  )

  const ref = React.useCallback(
    (node: T | null) => {
      if (fieldRef.current) {
        fieldRef.current.destroy()
        fieldRef.current = null
      }
      elementRef.current = node
      if (!node) {
        appliedSigRef.current = null
        setView(snapshot(null))
        updateCompletionView([])
        return
      }
      const current = optsRef.current
      const completionEnabled = Boolean(current.complete || current.onComplete)
      appliedSigRef.current = optionSignature(current)
      fieldRef.current = lingoInput(node, {
        ...updateOptions(current),
        messages: liveMessages(optsRef),
        // Function options live-read through the ref so new inline identities
        // per render never require a controller update.
        hiddenFormat: (q) => optsRef.current.hiddenFormat?.(q),
        formatHint: (r) => optsRef.current.formatHint?.(r),
        formatCandidate: (r: FormatCandidateInput) => optsRef.current.formatCandidate?.(r),
        onStateChange: (state, field) => {
          optsRef.current.onStateChange?.(state, field)
          const f = fieldRef.current
          syncView()
          if (f) {
            optsRef.current.onValueChange?.(f.value, f.quantity)
          }
        },
        onParse: (result, field) => {
          optsRef.current.onParse?.(result, field)
          // A re-parse can change result/quantity spans without moving state or
          // the canonical value (onStateChange stays silent then) — sync here so
          // the snapshot signatures catch it. sameSnapshot() guards the loop.
          syncView()
        },
        onCommit: (field) => {
          optsRef.current.onCommit?.(field)
          syncView()
        },
        ...(completionEnabled && {
          complete: current.complete ? liveComplete : undefined,
          onComplete: handleCompletions,
        }),
        onError: (issues, field) => optsRef.current.onError?.(issues, field),
      })
      syncView()
    },
    [handleCompletions, liveComplete, syncView, updateCompletionView],
  )

  React.useEffect(
    () => () => {
      fieldRef.current?.destroy()
      fieldRef.current = null
      elementRef.current = null
    },
    [],
  )

  const sig = optionSignature(opts)
  /*
   * Keep this effect keyed by optionSignature(), not the raw opts object.
   * Inline option objects would otherwise make field.update() run on every
   * render, which can cascade through state updates into React error #185.
   * Callback-style options are installed once as ref-backed live readers.
   */
  React.useEffect(() => {
    const field = fieldRef.current
    if (!field) {
      return
    }
    if (appliedSigRef.current === sig) {
      return
    }
    appliedSigRef.current = sig
    field.update(updateOptions(optsRef.current))
    syncView()
  }, [sig, syncView])

  React.useEffect(() => {
    const field = fieldRef.current
    if (!field || opts.value === undefined) {
      return
    }
    if (!sameControlledValue(opts.value, field.value)) {
      if (opts.value === null) {
        field.set('')
      } else {
        field.set(String(opts.value))
      }
      syncView()
    }
  }, [opts.value, syncView])

  const set = React.useCallback(
    (value: number | string) => {
      fieldRef.current?.set(typeof value === 'number' ? String(value) : value)
      updateCompletionView([])
      syncView()
    },
    [syncView, updateCompletionView],
  )

  const commit = React.useCallback(() => {
    fieldRef.current?.commit()
    updateCompletionView([])
    syncView()
  }, [syncView, updateCompletionView])

  const setHighlightedIndex = React.useCallback((index: number) => {
    setCompletionView((current) => ({
      ...current,
      highlightedIndex: current.completions.length
        ? Math.min(Math.max(index, 0), current.completions.length - 1)
        : -1,
    }))
  }, [])

  const selectCompletion = React.useCallback(
    (index?: number) => {
      const selected = completionView.completions[index ?? completionView.highlightedIndex]
      if (!selected) {
        return
      }
      fieldRef.current?.set(selected.text)
      updateCompletionView([])
      syncView()
    },
    [completionView, syncView, updateCompletionView],
  )

  return {
    ref,
    state: view.state,
    value: view.value,
    quantity: view.quantity,
    result: view.result,
    completions: completionView.completions,
    highlightedIndex: completionView.highlightedIndex,
    setHighlightedIndex,
    selectCompletion,
    set,
    commit,
  }
}

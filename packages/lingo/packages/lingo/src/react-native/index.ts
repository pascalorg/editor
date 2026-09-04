import * as React from 'react'
import type { Completion } from '../complete/types'
import {
  acceptedResult,
  type CandidateResult,
  defaultCandidate,
  defaultHiddenValue,
  defaultHint,
  failResult,
  formatQuantityForDisplay,
  formatResultForCommit,
  localIssue,
  materialize,
  toLingoOptions,
} from '../dom/format'
import type { LingoDisplayMode, LingoFieldState } from '../dom/index'
import type { LingoIssue, LingoOptions, LingoResult, Quantity, QuantityRange, Span } from '../index'
import { firstError, lingo, parseQuantity, partialState } from '../index'
import { optionSignature } from '../react/signature'

/**
 * Options for `useLingoTextInput()`. Parsing options match the main lingo
 * entry; the remaining fields control React Native display, commit, and
 * callback behavior without importing `react-native`.
 * @example
 * ```tsx
 * const field = useLingoTextInput({ kind: 'mass', unit: 'kg', min: 0 })
 * ```
 */
export interface UseLingoTextInputOptions extends LingoOptions {
  complete?: (text: string) => readonly Completion[]
  debounce?: number
  defaultText?: string
  display?: LingoDisplayMode
  displayUnit?: string
  formatCandidate?: (candidate: CandidateResult) => string | undefined
  formatHint?: (result: LingoResult) => string | undefined
  hiddenFormat?: (quantity: Quantity | QuantityRange) => string | undefined
  max?: string | number
  min?: string | number
  onCommit?: (result: LingoResult | null) => void
  onComplete?: (completions: readonly Completion[]) => void
  onError?: (issues: readonly LingoIssue[]) => void
  onParse?: (result: LingoResult) => void
  onStateChange?: (state: LingoFieldState, result: LingoResult | null) => void
  onValueChange?: (value: number | null, quantity: Quantity | QuantityRange | null) => void
  required?: boolean
  value?: number | null
}

/**
 * The platform-neutral subset of React Native `TextInput` props returned by
 * `useLingoTextInput()`.
 * @example
 * ```tsx
 * <TextInput {...field.inputProps} />
 * ```
 */
export interface LingoTextInputProps {
  onBlur(): void
  onChangeText(text: string): void
  onSubmitEditing(): void
  value: string
}

/**
 * Live state returned by `useLingoTextInput()`.
 * @example
 * ```tsx
 * const field = useLingoTextInput({ kind: 'length', unit: 'm' })
 * field.value // canonical number; field.text is display text
 * ```
 */
export interface UseLingoTextInputResult {
  commit(): void
  completions: readonly Completion[]
  dirty: boolean
  errorMessage: string | null
  highlightedIndex: number
  hint: string | null
  inputProps: LingoTextInputProps
  quantity: Quantity | QuantityRange | null
  result: LingoResult | null
  selectCompletion(index?: number): void
  set(value: number | string): void
  setHighlightedIndex(index: number): void
  state: LingoFieldState
  submitValue: string
  text: string
  touched: boolean
  value: number | null
}

interface NativeView {
  errorMessage: string | null
  hint: string | null
  quantity: Quantity | QuantityRange | null
  result: LingoResult | null
  state: LingoFieldState
  submitValue: string
  text: string
  touched: boolean
  value: number | null
}

interface ParsedBound {
  label: string
  quantity: Quantity
}

const EMPTY_COMPLETIONS: readonly Completion[] = []
const CONTROLLED_VALUE_EPSILON = 1e-12

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

function displayTextForValue(value: number | null, options: UseLingoTextInputOptions): string {
  if (value === null) {
    return ''
  }
  if (!options.unit) {
    return String(value)
  }
  const parsed = parseQuantity(String(value), toLingoOptions(options))
  return parsed.ok
    ? formatQuantityForDisplay(parsed.quantity, options.displayUnit ?? options.unit)
    : String(value)
}

function parseBound(
  value: string | number | undefined,
  options: UseLingoTextInputOptions,
): ParsedBound | null {
  if (value === undefined) {
    return null
  }
  const parsed = parseQuantity(String(value), toLingoOptions(options))
  if (!parsed.ok) {
    return null
  }
  const unit = options.unit ?? parsed.quantity.unit
  const quantity = parsed.quantity.to(unit)
  return { quantity, label: formatQuantityForDisplay(quantity, unit) }
}

function boundsIssue(
  result: LingoResult,
  text: string,
  options: UseLingoTextInputOptions,
): LingoIssue | null {
  const quantity = materialize(result, options).quantity
  if (!quantity) {
    return null
  }
  const minBound = parseBound(options.min, options)
  const maxBound = parseBound(options.max, options)
  const span: Span = { start: 0, end: text.length }
  const min = 'base' in quantity ? quantity : quantity.min()
  const max = 'base' in quantity ? quantity : quantity.max()
  if (minBound && min && min.base < minBound.quantity.base) {
    return localIssue(options, 'RANGE_MIN', { min: minBound.label }, span)
  }
  if (maxBound && max && max.base > maxBound.quantity.base) {
    return localIssue(options, 'RANGE_MAX', { max: maxBound.label }, span)
  }
  return null
}

function viewFor(
  text: string,
  state: LingoFieldState,
  result: LingoResult | null,
  touched: boolean,
  options: UseLingoTextInputOptions,
): NativeView {
  const material = state === 'valid' ? materialize(result, options) : null
  const error = state === 'invalid' && touched ? firstError(result) : null
  const candidate = state === 'invalid' && result && !result.ok ? result.candidate : undefined
  const hint = candidate
    ? (options.formatCandidate?.(candidate) ?? defaultCandidate(candidate))
    : state === 'valid' && result?.ok
      ? (options.formatHint?.(result) ?? defaultHint(result, options))
      : null
  return {
    text,
    state,
    result,
    touched,
    value: material?.value ?? null,
    quantity: material?.quantity ?? null,
    errorMessage: error?.message ?? null,
    hint,
    submitValue: material?.quantity
      ? (options.hiddenFormat?.(material.quantity) ??
        defaultHiddenValue(material.quantity, options.unit))
      : '',
  }
}

/**
 * Upgrade React Native `TextInput` with lingo parsing and commit semantics.
 * Spread `inputProps` onto the input; render errors, hints, and completions
 * however your native design system requires.
 * @example
 * ```tsx
 * import { Text, TextInput, View } from 'react-native'
 * import { useLingoTextInput } from '@pascal-app/lingo/react-native'
 *
 * function HeightField() {
 *   const field = useLingoTextInput({ kind: 'length', unit: 'm' })
 *   return (
 *     <View>
 *       <TextInput {...field.inputProps} />
 *       {field.errorMessage ? <Text>{field.errorMessage}</Text> : null}
 *     </View>
 *   )
 * }
 * ```
 */
export function useLingoTextInput(options: UseLingoTextInputOptions = {}): UseLingoTextInputResult {
  const initialText =
    options.value === undefined
      ? (options.defaultText ?? '')
      : displayTextForValue(options.value, options)
  const initialTextRef = React.useRef(initialText)
  const optionsRef = React.useRef(options)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewRef = React.useRef(viewFor(initialText, 'idle', null, false, options))
  const [view, setView] = React.useState(viewRef.current)
  const [completions, setCompletions] = React.useState<readonly Completion[]>(EMPTY_COMPLETIONS)
  const [highlightedIndex, setHighlightedIndexState] = React.useState(-1)

  optionsRef.current = options

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const updateCompletions = React.useCallback((next: readonly Completion[]) => {
    setCompletions(next)
    setHighlightedIndexState(next.length ? 0 : -1)
    optionsRef.current.onComplete?.(next)
  }, [])

  const publish = React.useCallback((next: NativeView) => {
    const previous = viewRef.current
    viewRef.current = next
    setView(next)
    if (previous.state !== next.state) {
      optionsRef.current.onStateChange?.(next.state, next.result)
    }
    if (!sameControlledValue(previous.value, next.value)) {
      optionsRef.current.onValueChange?.(next.value, next.quantity)
    }
  }, [])

  const parseNow = React.useCallback(
    (text: string, committed: boolean, touched: boolean): LingoResult | null => {
      clearTimer()
      const current = optionsRef.current
      if (committed) {
        updateCompletions(EMPTY_COMPLETIONS)
      } else {
        const next = text.trim() && current.complete ? current.complete(text) : EMPTY_COMPLETIONS
        updateCompletions(next)
      }

      const partial = partialState(text, toLingoOptions(current))
      if (partial === 'empty') {
        if (committed && current.required) {
          const issue = localIssue(current, 'REQUIRED', {}, { start: 0, end: text.length })
          const failed = failResult(text, [issue])
          publish(viewFor(text, 'invalid', failed, touched, current))
          current.onError?.(failed.issues)
          current.onCommit?.(failed)
          return failed
        }
        publish(viewFor(text, 'idle', null, touched, current))
        if (committed) {
          current.onCommit?.(null)
        }
        return null
      }
      if (partial === 'incomplete') {
        publish(viewFor(text, 'incomplete', null, touched, current))
        if (committed) {
          current.onCommit?.(null)
        }
        return null
      }

      const parsed = acceptedResult(lingo(text, toLingoOptions(current)), current)
      current.onParse?.(parsed)
      if (!parsed.ok) {
        publish(viewFor(text, 'invalid', parsed, touched, current))
        if (committed) {
          current.onError?.(parsed.issues)
          current.onCommit?.(parsed)
        }
        return parsed
      }

      if (committed) {
        const issue = boundsIssue(parsed, text, current)
        if (issue) {
          const failed = failResult(text, [issue])
          publish(viewFor(text, 'invalid', failed, touched, current))
          current.onError?.(failed.issues)
          current.onCommit?.(failed)
          return failed
        }
      }

      const formatted = committed ? formatResultForCommit(parsed, current) : null
      publish(viewFor(formatted ?? text, 'valid', parsed, touched, current))
      if (committed) {
        current.onCommit?.(parsed)
      }
      return parsed
    },
    [clearTimer, publish, updateCompletions],
  )

  const onChangeText = React.useCallback(
    (text: string) => {
      clearTimer()
      const current = { ...viewRef.current, text }
      viewRef.current = current
      setView(current)
      timerRef.current = setTimeout(
        () => parseNow(text, false, viewRef.current.touched),
        optionsRef.current.debounce ?? 150,
      )
    },
    [clearTimer, parseNow],
  )

  const commit = React.useCallback(() => {
    parseNow(viewRef.current.text, true, true)
  }, [parseNow])

  const set = React.useCallback(
    (value: number | string) => {
      const text =
        typeof value === 'number' ? displayTextForValue(value, optionsRef.current) : value
      parseNow(text, true, viewRef.current.touched)
    },
    [parseNow],
  )

  const setHighlightedIndex = React.useCallback(
    (index: number) => {
      setHighlightedIndexState(
        completions.length ? Math.min(Math.max(index, 0), completions.length - 1) : -1,
      )
    },
    [completions.length],
  )

  const selectCompletion = React.useCallback(
    (index?: number) => {
      const selected = completions[index ?? highlightedIndex]
      if (selected) {
        set(selected.text)
      }
    },
    [completions, highlightedIndex, set],
  )

  const signature = optionSignature(options)
  React.useEffect(() => {
    if (viewRef.current.text) {
      parseNow(viewRef.current.text, false, viewRef.current.touched)
    }
  }, [parseNow, signature])

  React.useEffect(() => {
    if (options.value === undefined) {
      return
    }
    if (options.value === null) {
      if (viewRef.current.text) {
        parseNow('', true, viewRef.current.touched)
      }
      return
    }
    if (!sameControlledValue(options.value, viewRef.current.value)) {
      set(options.value)
    }
  }, [options.value, parseNow, set])

  React.useEffect(() => clearTimer, [clearTimer])

  const inputProps = React.useMemo<LingoTextInputProps>(
    () => ({
      value: view.text,
      onChangeText,
      onBlur: commit,
      onSubmitEditing: commit,
    }),
    [commit, onChangeText, view.text],
  )

  return {
    inputProps,
    text: view.text,
    state: view.state,
    value: view.value,
    quantity: view.quantity,
    result: view.result,
    touched: view.touched,
    dirty: view.text !== initialTextRef.current,
    errorMessage: view.errorMessage,
    hint: view.hint,
    submitValue: view.submitValue,
    completions,
    highlightedIndex,
    setHighlightedIndex,
    selectCompletion,
    set,
    commit,
  }
}

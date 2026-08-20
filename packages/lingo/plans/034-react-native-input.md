---
id: 034
title: React Native text input
status: done — shipped 2026-07-20
created: 2026-07-20
updated: 2026-07-21
goal: "Ship a DOM-free React Native hook that gives TextInput the same parse, commit, validation, and completion semantics as lingo's web fields."
success_criteria:
  - "[MET: handler tests] TextInput handlers parse while typing and canonicalize on blur/submit -> src/react-native/use-lingo-text-input.test.tsx"
  - "[MET: issue-span tests] Required/bounds failures retain original-input spans -> src/react-native/use-lingo-text-input.test.tsx"
  - "[MET: completion tests + size gate] Injected completions select without bundling ./complete -> src/react-native/use-lingo-text-input.test.tsx + scripts/size.mjs"
  - "[MET: build + zero-deps gate] ./react-native builds with React as its only optional peer and no react-native import -> build + zero-deps gate"
---

# React Native text input

Driver: mobile forms need the same forgiving text-to-canonical-value boundary as
web forms, but `useLingoInput()` is intentionally built on the DOM controller
and cannot attach to React Native `TextInput`.

## Design principle

**Share parsing semantics, not platform mechanics.** React Native gets a
separate headless entry over the same parser and commit-format helpers. It does
not emulate DOM refs, Constraint Validation, hidden inputs, or ARIA.

## Design (locked-in 2026-07-20)

```ts
export interface UseLingoTextInputOptions extends LingoOptions {
  defaultText?: string
  value?: number | null
  display?: 'canonical' | 'echo' | 'preserve'
  displayUnit?: string
  min?: string | number
  max?: string | number
  required?: boolean
  debounce?: number
  complete?: (text: string) => readonly Completion[]
  hiddenFormat?: (quantity: Quantity | QuantityRange) => string | undefined
  formatHint?: (result: LingoResult) => string | undefined
  formatCandidate?: (candidate: CandidateResult) => string | undefined
  onValueChange?: (value: number | null, quantity: Quantity | QuantityRange | null) => void
  onStateChange?: (state: LingoFieldState, result: LingoResult | null) => void
  onParse?: (result: LingoResult) => void
  onCommit?: (result: LingoResult | null) => void
  onError?: (issues: readonly LingoIssue[]) => void
  onComplete?: (completions: readonly Completion[]) => void
}

export interface LingoTextInputProps {
  value: string
  onChangeText(text: string): void
  onBlur(): void
  onSubmitEditing(): void
}

export interface UseLingoTextInputResult {
  inputProps: LingoTextInputProps
  text: string
  state: LingoFieldState
  value: number | null
  quantity: Quantity | QuantityRange | null
  result: LingoResult | null
  touched: boolean
  dirty: boolean
  errorMessage: string | null
  hint: string | null
  submitValue: string
  completions: readonly Completion[]
  highlightedIndex: number
  setHighlightedIndex(index: number): void
  selectCompletion(index?: number): void
  set(value: number | string): void
  commit(): void
}

export function useLingoTextInput(
  options?: UseLingoTextInputOptions,
): UseLingoTextInputResult
```

`inputProps` is structurally compatible with React Native `TextInput`; the
entry imports no `react-native` runtime or types. `onChangeText` updates display
text immediately and debounces parsing. `onBlur`, `onSubmitEditing`, and
`commit()` parse immediately, apply required/bounds checks, and rewrite valid
text according to `display`. `set()` and completion selection commit without
marking the field touched.

`value` is the controlled canonical number in `unit`; `text` is display text.
`submitValue` is the native equivalent of the DOM controller's hidden value.
Completion generation remains injected, so importing `./react-native` does not
pull in `./complete`.

## Changes

1. Add `src/react-native/` with the hook and handler-driven React tests.
2. Add the `./react-native` package export and independent build/size gate.
3. Permit the existing optional React peer in both React adapter entries; add
   no `react-native` dependency or peer.
4. Update the package guide, architecture, glossary entry list, README,
   recipes, llms.txt, and changelog.

## Non-goals

- No React Native component, popup, styling, or form-library dependency.
- No DOM controller or `react-native` runtime import.
- No ARIA/Constraint Validation emulation; callers use native accessibility
  props and render `errorMessage`/`hint`.
- No shared-controller rewrite. The hook reuses DOM-free
  `LingoFieldFormatOptions` helpers from `dom/format.ts` (parse options,
  materialize, commit/hint formatting) without casting through DOM callback
  shapes; broader controller extraction waits for another non-DOM adapter.
- No date-specific field mode; callers may inject date completions, while this
  field retains the quantity parser semantics of the DOM controller.

## Acceptance

`bun run check` and `bun run lint` green; corpus diff zero; the new entry's size
gate green; built output contains no `react-native` import.

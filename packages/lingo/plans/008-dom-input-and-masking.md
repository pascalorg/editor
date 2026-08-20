---
id: 008
title: DOM input & masking
status: approved
created: 2026-07-03
updated: 2026-07-03
---

# DOM input & masking (`@pascal-app/lingo/dom`)

Headless controller that upgrades any `<input>`/`<textarea>` into a natural-language
field. Philosophy: **never fight the user's keystrokes.** Natural language can't be
character-masked (unlike phone numbers); the "mask" here is semantic — we parse live,
preview the canonical interpretation, and normalize on commit. Inspired by
inclusive-dates' accessibility wiring and libphonenumber's AsYouType separation.

## API

```ts
const field = lingoInput(el, {
  kind: 'length',
  unit: 'm',                    // canonical unit for value/form submission
  displayUnit?,                 // echo unit on blur; default: keep user's unit
  display?: 'canonical' | 'echo' | 'preserve',   // blur behavior; default 'canonical'
  system?, numberFormat?, profile?, inputmode?,
  strictness?, accept?, tolerance?, escalate?,   // the plan-014 dial
  min?, max?,                   // parsed with same engine: min: "50cm" ✓
  required?,
  name?,                        // creates/syncs hidden input `name` with the value in opts.unit
  hiddenFormat?: (q) => string, // default: the number in opts.unit, e.g. "1.8034" (m)
  messages?,                    // override error copy (plan 009)
  errorElement?: HTMLElement | string,  // where to render + announce errors
  hintElement?: HTMLElement | string,   // live preview slot ("= 1.80 m")
  formatHint?: (result) => string,
  formatCandidate?: (candidate) => string,   // did-you-mean copy for confirm UX
  validationBehavior?: 'native' | 'aria',
  debounce? = 150,
  onParse?, onCommit?, onError?, onStateChange?,
})
// As-built note (2026-07-05): the sketched `locale?` and `now?: () => Date`
// options never shipped — the v0.1 DOM layer is quantity-focused.

field.value          // canonical number | null   (in opts.unit)
field.quantity       // Quantity | Range | null
field.result         // last full LingoResult
field.state          // 'idle' | 'incomplete' | 'valid' | 'invalid'
field.set(number | string)       // programmatic set (agents!) — formats into the input
field.update(opts)   // live reconfigure
field.commit()       // force blur-equivalent normalization
field.destroy()
```

## Behavior

- **Events**: parse on `input` (debounced), commit on `blur`/`Enter`/form `submit`.
  `compositionstart/end` guard: never parse mid-IME composition.
- **No beforeinput filtering** (free text!). *(As-built note: the sketched
  opt-in `restrict: true` char-filtering never shipped — natural language can't
  be plausibly char-masked, per D6.)*
- **Commit**: on valid parse → rewrite input per `display` mode ('canonical':
  `format(q, { unit: displayUnit ?? unit })`; 'echo': pretty-print user's own unit;
  'preserve': leave text). Caret untouched (rewrite happens on blur only; Enter
  commits then restores caret at end).
- **Hidden field**: when `name` given — the visible input gets no name (won't submit
  prose); hidden input carries canonical value ('1.8034'), exactly like date pickers
  submitting ISO. Forms drop in with zero server changes.
- **Validation**: integrates Constraint Validation — `setCustomValidity(message)` +
  `reportValidity` on submit attempt; `required`, `min`, `max` enforced post-parse
  (`RANGE_MIN`/`RANGE_MAX` issues, message shows both canonical and user-unit bounds).
- **ARIA**: `aria-invalid` on error state; error element gets generated id, wired via
  `aria-describedby` (appended, not clobbered); error element gets `role="status"`
  live announcements debounced 1s after typing pauses (per APG guidance — never
  announce per keystroke); hint element `aria-hidden` (visual aid; the committed value
  is the accessible value).
- **State attributes** (styling hooks, Radix-style):
  `data-lingo="input"`, `data-state="empty|editing|valid|invalid|ambiguous"`,
  `data-kind`, plus `data-approx` when approximate. No stylesheet shipped in v0.1;
  demo shows a copy-paste baseline using `:user-invalid`-compatible selectors.
- **SSR-safe**: module evaluates without `window`; `lingoInput` throws a clear error
  if called server-side.

## React (`@pascal-app/lingo/react`)

`useLingoInput(opts)` → `{ inputProps, hintProps, errorProps, state, quantity, value,
set }`. Controlled via `value`/`onValueChange` (canonical number), uncontrolled by
default. Implementation wraps the DOM controller in a ref lifecycle (effect mount/
destroy, option updates via `field.update(opts)`).

## Non-goals v0.1

Character-level as-you-type reformatting (caret math for prose = fighting users),
dropdown suggestion UI (userland; we expose `suggestions`, `alternatives`, and
the `./complete` entry's ranked `completions` — inject via `complete`/
`onComplete` on `lingoInput`), shipping CSS.

## Research addenda (masking study, 2026-07-03) — binding refinements

1. **Partial parsing states**: expose `partialState(text, opts)` and use it in
   the controller — while typing, state is `empty | incomplete | valid | invalid`;
   `"2 f"` is *incomplete* (a prefix of "2 ft"), never *invalid*. Error styling and
   announcements are suppressed while `incomplete` (react-aria `isValidPartialNumber`
   pattern).
2. **`validationBehavior: 'native' | 'aria'`** (react-aria pattern): `native` calls
   `setCustomValidity` (participates in submit-blocking + `:user-invalid`); `aria`
   (default when `errorElement` given) renders custom UI. `validity.customError` kept
   in sync whenever a form ancestor exists.
3. **Agent compatibility rule**: untrusted (`isTrusted: false`) `input` events are
   processed identically to trusted ones — Playwright/testing-library/LLM agents work
   with zero special-casing. Never gate on trusted events.
4. **Zero-JS observability**: mirror state as `data-canonical` + `data-unit` attrs on
   the input and dispatch bubbling `CustomEvent('lingo:change', { detail })` — frameworks
   and agents can subscribe without importing us. Static `lingoInput.get(el)` registry.
5. **State vocabulary** (Base UI alignment): `data-state="idle|incomplete|valid|invalid"`
   plus booleans `data-invalid`/`data-valid` (only post-touch, `:user-invalid` timing),
   `data-touched`, `data-dirty`, `data-approx`.
6. **Attach hygiene**: set `autocomplete="off" autocorrect="off" autocapitalize="none"
   spellcheck="false"` (autocorrect mangles unit tokens), `inputmode` option
   (default `text`; docs note `decimal` for numeric-ish fields, iOS minus-key caveat).
7. **Live reconfig**: `field.update(opts)` (imask lesson — Maskito's recreate-only is
   a DX papercut). Handle form `reset` event (resync hidden input + state).
8. **Announcement split** (WAI + Base UI): hints are VISUAL-ONLY in v0.1
   (aria-hidden; D12 — per-keystroke polite announcements are contested UX);
   error announcements only on commit via `role="alert"` OR
   `aria-live="assertive"` (never both). No announcements while `incomplete`.
   A dedicated polite live region for hints is a 0.2 candidate.
9. **Result triad naming** (imask lesson): `field.raw` (text), `field.value`
   (canonical number), `field.quantity` (rich object) — mirrors
   value/unmaskedValue/typedValue.

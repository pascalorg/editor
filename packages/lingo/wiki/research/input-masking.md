# Prior-art study: input masking & form-field DX

Research pass 2026-07-03 (background agent). Subjects: imask, Maskito, cleave-zen/cleave.js, AutoNumeric, react-number-format, react-aria NumberField + @internationalized/number, libphonenumber-js AsYouType, Constraint Validation API, WAI/APG, Radix/Headless UI/Base UI/downshift, flatpickr.

## Attach API landscape

- **Maskito** (`@maskito/core`, Apache-2.0, 4.1 kB gz, 0 deps — the size bar): `new Maskito(el, options)` + single `destroy()`; cancels `beforeinput` (necessity for masks, not for us); no update method (recreate-only — a DX papercut we avoid); pure `maskitoTransform(value, options)` for programmatic writes; `useMaskito` returns a ref.
- **imask** (MIT, 15.7 kB): `IMask(el, opts)` → `updateOptions()`, `destroy()`, `on('accept'|'complete')`; **value triad** value/unmaskedValue/typedValue → our raw/value/quantity; state-diff caret engine.
- **cleave-zen** (MIT): DOM-decoupled pure formatters + optional cursor tracker — its own predecessor's deprecation lesson: never hard-bind logic to DOM instances.
- **react-number-format** (MIT): `onValueChange({formattedValue, value, floatValue}, sourceInfo)` + `isAllowed` veto.
- **react-aria NumberField / @internationalized/number** (Apache-2.0) — the gold standard: `NumberParser.isValidPartialNumber()` (lone "." passes partial, fails full) → our `isValidPartialQuantity` tri-state incomplete|valid|invalid; commit on blur (`commitBehavior: 'snap'|'validate'`); `validationBehavior: 'native'|'aria'`; OS-aware `inputmode` (iOS numeric pad lacks minus); locale numerals derived from Intl.formatToParts instead of shipping CLDR.
- **AutoNumeric** (MIT, 43.6 kB gz): the monolith cautionary tale.
- **libphonenumber-js AsYouType**: feed text → rich result incrementally; "ignores everything except digits" — steal the shape, not the rewrite.

## Input interception rules (adopted)

1. Natural language can't be char-masked → **never cancel beforeinput, never rewrite while typing**; parse on `input` (read-only), preview in a hint, normalize on commit (blur/Enter/submit).
2. IME: check `isComposing`; never parse/announce/mutate between compositionstart/end (Quill/Chrome-65 CJK breakage class); real parse on compositionend.
3. Treat `isTrusted: false` input events identically — Playwright/testing-library/LLM agents work with zero special-casing (Maskito's maskitoTransform workaround exists because it doesn't).
4. Attach hygiene: `autocomplete=off autocorrect=off autocapitalize=none spellcheck=false` (autocorrect mangles "3 mi" → "3 mì"); `inputmode` option, default text.
5. Caret math (count-significant-chars mapping) only needed if we ever rewrite live — we don't in v0.1.

## Error surfacing (adopted)

- Constraint Validation: `setCustomValidity()` under `validationBehavior:'native'`; `checkValidity` silent vs `reportValidity` UI; keep `validity.customError` synced even in aria mode when a form exists; note `form.submit()` bypasses validation.
- `:user-invalid` timing (Baseline 2023): judge only after interaction completes — mirrored in our data-attrs.
- ARIA: `aria-invalid` while invalid; error text linked via `aria-describedby` only-while-error; `role="alert"` OR `aria-live="assertive"` for commit errors (never both — double announcements); `role="status"`/polite for while-typing feedback, debounced (~500 ms after typing pauses; WAI: read once when the user stops typing); prefer announcing the positive preview over errors mid-typing; suppress announcements entirely while `incomplete`.
- Base UI Field: `validationMode: 'onSubmit'|'onBlur'|'onChange'` + `validationDebounceTime` — copied options.

## Styling & headless conventions (adopted)

- Zero shipped CSS (Radix/Headless/Base UI); optional `theme.css` < 1 kB targeting only data-attrs.
- One `data-*` per state (Headless UI v2 lesson — no combined strings): `data-lingo`, `data-state="idle|incomplete|valid|invalid"`, `data-invalid`/`data-valid` (post-touch only), `data-touched`, `data-dirty`, `data-approx`; mirror on lib-rendered hint/error nodes.
- Namespaced `--lingo-*` custom properties for computed values.
- downshift prop-getters for the React hook.

## Programmatic/agent friendliness (adopted)

- flatpickr `altInput` / native `type=date` pattern: visible input nameless & pretty, hidden input carries canonical value for FormData; resync on form `reset`.
- Imperative surface: `field.set(number|string)`, `field.value`, `field.quantity`, static `lingoInput.get(el)`.
- Zero-JS observability: `data-canonical` + `data-unit` attrs and bubbling `CustomEvent('lingo:change', {detail})` — subscribe without importing the lib.

## Licenses

imask MIT · Maskito Apache-2.0 · cleave-zen MIT (cleave.js Apache-2.0) · AutoNumeric MIT · react-number-format MIT · react-aria/@internationalized Apache-2.0 · libphonenumber-js MIT · Radix MIT · Headless UI MIT · Base UI MIT · downshift MIT · flatpickr MIT · W3C/WAI docs (spec/CC).

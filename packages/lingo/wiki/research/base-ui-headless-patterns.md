# Base UI headless-component patterns for lingo's DOM layer (research 2026-07-09)

Multi-agent web research pass 2026-07-09. Claims are agent-reported (Base UI
v1.6.0 inspected) and worth re-verifying against source before acting. Companion
to `input-masking.md` (which notes Base UI's `validationMode` options) and
`ecosystem-form-libraries.md` (which covers form-library Standard Schema
integration). This file focuses on Base UI's Combobox, Field composition, and
state-mapping patterns as they apply to lingo's DOM controller and completions.

## Combobox ARIA contract (directly applicable to lingo completions)

Base UI's Combobox (v1.6.0) separates three concerns:

1. **ARIA wiring**: `role="combobox"` + `aria-autocomplete="list"` on the input;
   `aria-expanded` on trigger; `aria-activedescendant` pointing at the
   highlighted item ID; `role="listbox"` on the popup with items bearing
   `role="option"` + unique IDs.
2. **Keyboard navigation**: `CompositeList` with document-order item
   registration, O(1) index lookup, Arrow/Enter/Escape delegation.
3. **Filtering**: `useFilter` with `Intl.Collator` for locale-sensitive
   matching (sensitivity `'base'` handles accented characters correctly).

**Gap in lingo**: the DOM controller's `emitCompletions()` fires the `onComplete`
callback with ranked completions but does not manage ARIA state on the input or
the popup container. When completions are active, the input should declare itself
a combobox so screen readers can navigate the completions list. The pattern is pure
attribute-setting — no new runtime dependency needed.

Relevant files: `packages/lingo/src/dom/controller.ts` (emitCompletions),
`packages/lingo/src/complete/completions.ts` (completions engine).
(agent-researched, 2026-07-09)

## Automatic state-to-data-attribute mapping

Base UI's `useRender` hook accepts a state object and a `stateAttributesMapping`
config, then converts boolean state properties to presence/absence data-*
attributes in a single declarative pass. Component authors define
`{ disabled: 'data-disabled', valid: 'data-valid' }` and the hook handles
set/remove.

**Gap in lingo**: `Controller.render()` has 40+ lines of manual
`attrs.set`/`attrs.remove` calls. A declarative map
(`{ touched: 'data-touched', dirty: 'data-dirty', invalid: 'data-invalid', ... }`)
and a single sync loop would reduce bug surface (forgetting to clear an
attribute) and make the attribute set trivially extensible.
(agent-researched, 2026-07-09)

## Field.Validity render-prop and dynamic aria-describedby registry

Base UI's `Field.Validity` passes the full `ValidityState` + error array +
current value to a function child, enabling structured error UIs per constraint
violation. `Field.Error` uses a `match` prop (`valueMissing`, `typeMismatch`,
etc.) for conditional rendering. Error elements self-register their ID via
`setMessageIds` and the parent auto-wires `aria-describedby`.

Multiple descriptions are handled via a `messageIds` array in context —
`FieldDescription` and `FieldError` both append on mount and remove on unmount.
The control's `aria-describedby` is always the joined list of currently-mounted
description IDs.

**Gap in lingo**: the controller only registers `errorEl` into
`aria-describedby`. When a polite live hint lands (plan 008), that element also
needs `describedby` wiring. Formalizing a `describedByIds` Set with a single
`syncDescribedBy()` call mirrors Base UI's registry and prepares for it.
(agent-researched, 2026-07-09)

## Validation timing modes and controlled/uncontrolled duality

Base UI's Field accepts `validationMode: 'onSubmit' | 'onBlur' | 'onChange'`
with `validationDebounceTime`. It tracks `touched`/`dirty`/`valid`/`focused` as
independent booleans (not a string enum). A `useControlled` hook detects
controlled/uncontrolled mode switches and emits dev-mode warnings.

**Application to lingo**: exposing a `validationTiming` option
(`'eager' | 'blur' | 'submit'`) would map to when `data-invalid`/`aria-invalid`
activate, giving form authors control over error-surfacing rhythm without
forking the controller. The React hook could similarly warn on
controlled/uncontrolled mode switches. (agent-researched, 2026-07-09)

## Intl.Collator-based filtering for locale-aware completion matching

Base UI's `useComboboxFilter` uses `Intl.Collator` with `sensitivity:'base'`
for accent-insensitive, case-insensitive prefix matching. This handles
German ss, Turkish dotted-i, and French accents correctly.

**Gap in lingo**: the completions engine does prefix matching via the registry's
`aliasCompletions` (character-level). For locale packs with accented aliases
(e.g. French "metre" from "metre"), `Intl.Collator`-based comparison would
improve matching without adding dependencies (Intl is allowed per hard rules).
(agent-researched, 2026-07-09)

## Licenses

Base UI: MIT (MUI / Radix / Floating-UI team).

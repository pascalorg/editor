# Form-library integration for lingo (research 2026-07-05)

Research pass 2026-07-05 (source-level study, not docs-summarized): npm registry
dist-tags, unpkg-served `.d.ts` files, GitHub source on `main` for
`react-hook-form`/`resolvers`, `@tanstack/form`, `vee-validate`, plus
`ui.shadcn.com` (live-fetched + `curl -IL` redirect verification), MDN
(`Constraint_validation`, `ElementInternals`), `web.dev/articles/more-capable-form-controls`,
`angular.dev`, and direct reads of `packages/lingo/src/{ai,dom,react}/*.ts` in
this repo. Feeds plan 024 (ecosystem integration & documentation enrichment);
any shipped-code decisions this doc surfaces as open questions are decided
there, not here.

**Versions verified (npm, 2026-07-05)**: `react-hook-form@7.81.0` ·
`@hookform/resolvers@5.4.0` · `@tanstack/react-form@1.33.0` · `formik@2.4.9` ·
`vee-validate@4.15.1` (stable) / `vee-validate@5.0.0-beta.1` · `@angular/forms@22.0.5`
· `@standard-schema/spec@1.1.0` · `shadcn@4.13.0` (CLI).

## What a lingo field is, for a form library

`quantityField(opts)` / `rangeField(opts)` / `dateField(opts)` / `lingoObject(shape)`
(`packages/lingo/src/ai/{quantity-fields,date-field,canonicalize}.ts`) each
return a `LingoField<Output>`: an object implementing both halves of the
Standard Schema ecosystem — `StandardSchemaV1` (`~standard.validate`) and
`StandardJSONSchemaV1` (`~standard.jsonSchema`) — plus convenience
`.parse()`/`.safeParse()` (`packages/lingo/src/ai/standard-schema.ts:95-133`).
`vendor` is `'lingo'`. Every consumer below only ever touches the
`StandardSchemaV1` half; the JSON Schema half is an AI-SDK/tool-boundary
concern (`wiki/research/ai-structured-output.md`), irrelevant to forms.

Two properties every integration below has to account for:

1. **`validate` is always synchronous at runtime.** Every field factory builds
   its validator through `createField()`, whose `validate` parameter is a
   plain `(value: unknown) => FieldResult<Output>` — no `async`/`Promise`
   anywhere in that call graph. The one nuance: the *public type* of
   `field['~standard'].validate` is `FieldResult<Output> | PromiseLike<FieldResult<Output>>`,
   because `LingoField` is typed as an intersection with the spec's own
   `StandardSchemaV1Props` (which must allow async implementations in
   general). A caller that defensively `await`s the result loses nothing —
   awaiting a non-Promise resolves immediately — but don't assume the
   *type* proves synchrony; only the concrete lingo implementation does.
2. **Success carries a non-spec `warnings` array.** `FieldSuccess<Output>` is
   `{ value, issues?: undefined, warnings?: readonly FieldWarning[] }`
   (`standard-schema.ts:81-85`) — an intentional, spec-legal extension (the
   official `SuccessResult<Output>` is exactly `{ value, issues?: undefined }`,
   no `warnings` field, per `@standard-schema/spec@1.1.0`). It's how a
   benign-forgiveness parse ("assumed kg," "typo fixed," "read day-first")
   rides along on a *successful* result. **No consumer in this document reads
   it.** Every resolver/adapter below destructures `.value` (success) or
   `.issues` (failure) and nothing else — confirmed by reading
   `@hookform/resolvers`'s `standard-schema.ts`, TanStack's
   `standardSchemaValidator.ts`, and (for a fellow Standard-Schema consumer
   outside forms, as corroborating evidence) `@ai-sdk/provider-utils@5.0.5`'s
   `standardSchema()` adapter, which does `'value' in result ? { success: true, value: result.value } : ...` —
   `warnings` is silently dropped in all three. This is a real, currently
   undocumented UX cliff: a team that equates "Standard Schema support" with
   "full lingo UX transfers" will be surprised only hard pass/fail crosses
   the boundary.

## Support matrix (July 2026)

| Library | Version | Native Standard Schema? | Integration shape |
|---|---|---|---|
| react-hook-form + `@hookform/resolvers` | RHF **7.81.0**, resolvers **5.4.0** (2026-05-21) | Yes — **whole-form only**, via `standardSchemaResolver` | `lingoObject(shape)` → `resolver`; single fields → `register(name, { validate })` |
| TanStack Form (`@tanstack/react-form`) | **1.33.0** (2026-05-28) | Yes — natively, **per-field or whole-form**, vendor-agnostic | `validators={{ onChange: field }}`; `onSubmit` always gets raw input (see below) |
| Formik | **2.4.9** (2025-11-10) | **No** — Yup-shaped `validationSchema`; effectively unmaintained | manual `validate` prop calling `.safeParse()` |
| vee-validate | stable **4.15.1**; v5 **5.0.0-beta.1** (2026-03-04, beta since 2025-08-02) | No in v4 (wrap manually); **yes in v5**, still beta | v4: `useField(name, fn)` wrapper; v5: `useField(name, field)` / `useForm({ validationSchema })` directly |
| Angular Signal Forms | `@angular/forms` **22.0.5**; Signal Forms stable since **v22** (2026-06-03) | Yes, via `validateStandardSchema(path, schema)` — accepts a **nested field path** | classic Reactive Forms (still most production Angular) has no adapter — wrap a `ValidatorFn` |

## react-hook-form 7.81 + `@hookform/resolvers` 5.4

**Whole-form**, when a form (or sub-object) is entirely lingo fields —
`lingoObject` is itself a `LingoField`, so it drops straight into the resolver
with zero adapter code:

```tsx
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { useForm } from 'react-hook-form'
import { lingoObject, quantityField, dateField } from '@pascal-app/lingo/ai'

const schema = lingoObject({
  weight_kg: quantityField({ kind: 'mass', unit: 'kg', min: 0 }),
  visit_date: dateField({ now: new Date() }),
  note: 'string',
})

useForm({ resolver: standardSchemaResolver(schema) })
// handleSubmit(onValid) receives canonical numbers/ISO strings, not raw text
```

The resolver's source (`@hookform/resolvers`'s `standard-schema/src/standard-schema.ts`,
exported via the `./standard-schema` subpath) does exactly this:

```ts
let result = schema['~standard'].validate(values)
if (result instanceof Promise) result = await result
// on failure: getDotPath(issue) per issue → toNestErrors() → RHF's formState.errors
// on success:
return { values: resolverOptions.raw ? Object.assign({}, values) : result.value, errors: {} }
```

It calls `schema['~standard'].validate(values)` directly, awaits only if the
result actually is a Promise (lingo's never is, per above), and **substitutes
`result.value` for the submitted form values unless `{ raw: true }`** — free
canonicalization-on-submit, the same mechanism any Zod/Valibot user gets.

**Correction worth stating plainly, since it's misquoted in circulation**:
`standardSchemaResolver` shipped in **`@hookform/resolvers` v4.0.0** (released
2025-02-10, PR #738), not v4.1.2. `v4.1.1` (2025-02-22, PR #746) fixed object
path-segment handling in the same resolver. `v4.1.2` (2025-02-24, PR #748) was
a pure packaging fix — it moved `@standard-schema/utils` from `devDependencies`
to `dependencies`, closing issue #747 ("Standard Schema Resolver `Could not
resolve "@standard-schema/utils"`"), a runtime resolution error for consumers,
not the resolver's introduction. Current is 5.4.0 (2026-05-21).

**One field**, independent of whatever validates the rest of the form — RHF's
resolver is a single whole-form slot (`Resolver<TFieldValues>` takes the
*complete* values object; there is no per-field resolver map), so a bare
`quantityField(...)` cannot be passed as `resolver` the way `zodResolver(z.object({...}))`
might suggest. The correct hook for one field is `register(name, { validate })`,
which RHF documents as running "on its own without depending on other
validation rules":

```tsx
import { quantityField } from '@pascal-app/lingo/ai'
const heightField = quantityField({ kind: 'length', unit: 'm', min: 0.3, max: 2.5 })

register('height_m', {
  validate: (v) => {
    const r = heightField.safeParse(v)
    return r.issues ? r.issues[0].message : true
  },
})
```

Note RHF discourages mixing the two mechanisms *on the same field*: once a
resolver governs a form, register-level `validate`/`required`/`min` rules on
resolver-covered fields are overridden. Pick one per field/form, not both.

**Controlled bridge** — RHF is uncontrolled by default, and `useLingoInput` is
a ref-based headless controller (like `register`, not a plain `value`/`onChange`
pair), so getting lingo's live partial-state UX ("2 f" reads *incomplete*, not
invalid) into RHF's `Controller` means merging two refs on one `<input>` and
making `onValueChange` the single write path into `field.onChange` — never let
both `lingoInput`'s own DOM writes and RHF's `Controller` mutate the input
independently:

```tsx
<Controller
  name="height_m"
  control={control}
  render={({ field }) => {
    const { ref, state } = useLingoInput({
      kind: 'length',
      unit: 'm',
      value: field.value ?? null,
      onValueChange: (v) => field.onChange(v),
    })
    return (
      <input
        ref={(el) => { ref(el); field.ref(el) }}
        onBlur={field.onBlur}
        data-state={state}
        placeholder={`5'11" or 180cm`}
      />
    )
  }}
/>
```

Seed `defaultValues: { height_m: null }`, not `''` — `useLingoInput`'s
controlled `value` is `number | null`. `formState`/submitted values then hold
the canonical meters number live, not just on submit.

**TypeScript ergonomics caveat**: RHF's third `useForm` generic
(`TTransformedValues`) is meant to type `handleSubmit`'s callback as the
resolver's *output* shape, independent of the registered field types, but
inference has open rough edges (react-hook-form/react-hook-form#11023,
discussion #10654) — the explicit three-generic form
(`useForm<RawShape, unknown, CanonicalShape>({ resolver: standardSchemaResolver(schema) })`)
may be required rather than relying on full inference.

**`lingoObject` array specs compose with `useFieldArray`**: a one-element-array
spec (`{ items: [quantityField(...)] }`) emits issue paths as
`[{key:'items'},{key:i},{key:'weight'}]` (`prependPath` in `canonicalize.ts`),
which lines up directly with RHF's nested `errors.items[i].weight` shape —
useful for repeating line-item forms (shipment weights, invoice quantities)
without hand-rolled path mapping.

## TanStack Form 1.33

Pass a `LingoField` straight through as a validator — no wrapper. TanStack's
`standardSchemaValidator.ts` (`@tanstack/form-core`) calls
`schema['~standard'].validate(value)` with zero vendor branching, per-field or
whole-form:

```tsx
<form.Field name="height_m" validators={{ onChange: heightField }}>
  {(field) => (
    <input
      value={field.state.value ?? ''}
      onChange={(e) => field.handleChange(Number(e.target.value))}
    />
  )}
</form.Field>
```

**Load-bearing caveat, docs-quoted**: *"The value passed to the `onSubmit`
function will always be the input data"* (TanStack Form docs, submission
handling guide) — a Standard Schema's transformed output is never applied to
field or form state, on this path. A lingo field wired only as
`validators.onChange` will validate the natural-language text correctly but
submit the raw string — the same trap a plain Zod `.transform()` hits on
TanStack Form, not lingo-specific, but easy to miss.

The fix is exactly what `useLingoInput` already exists for: keep the field
canonical throughout by funneling its `onValueChange` into `field.handleChange`,
so the value TanStack Form submits is already the canonical number and the
documented limitation never bites:

```tsx
<form.Field name="height_m">
  {(field) => {
    const { ref, state } = useLingoInput({
      kind: 'length',
      unit: 'm',
      onValueChange: (v) => field.handleChange(v),
    })
    return <input ref={ref} data-state={state} onBlur={field.handleBlur} />
  }}
</form.Field>
```

This is a genuine differentiator worth naming explicitly in lingo's docs: unlike
`z.transform()` (which TanStack Form also ignores on `onSubmit` until a manual
re-parse), lingo's live controller keeps canonical values in form state the
whole time, not just after an extra step.

## Formik 2.4.9

No Standard Schema hook exists, and none is coming — Formik ships
Yup-shaped `validationSchema`, and maintainer Jared Palmer has said publicly he
hasn't maintained it since 2020 (X: `x.com/jaredpalmer/status/1986851141645443151`).
Any lingo integration here is permanently a manual `validate` prop, which
Formik has always supported and documents as "schema agnostic": return
`undefined` for valid, a string for invalid (`formik.org/docs/guides/validation`).

```tsx
<Field
  name="height_m"
  validate={(v) => heightField.safeParse(v).issues?.[0]?.message}
/>
```

Controlled bridge via `setFieldValue`:

```tsx
const { values, setFieldValue } = useFormikContext<{ height_m: number | null }>()
const { ref } = useLingoInput({
  kind: 'length',
  unit: 'm',
  value: values.height_m,
  onValueChange: (v) => setFieldValue('height_m', v),
})
```

Don't advertise parity with the other four libraries here — this is
permanently the manual-wrapper tier, not a "Standard Schema works out of the
box" story, and a large share of Formik's remaining install base (133+ open
PRs, sporadic releases) can't migrate off easily even if they wanted native
support.

## vee-validate: v4 stable (wrapper) vs v5 beta (native)

v4's published types (`vee-validate@4.15.1`'s `.d.ts`, `RuleExpression<TValue>`)
have **no** `StandardSchemaV1` member — only `GenericValidateFunction | TypedSchema | YupSchema`.
Wrap manually; this is the production-safe default today:

```ts
useField('height_m', (v) => {
  const r = heightField.safeParse(v)
  return r.issues ? r.issues[0].message : true // GenericValidateFunction: true | string
})
```

v5 (`5.0.0-beta.1`, beta since 2025-08-02, two prereleases in ~11 months with
no announced stable date) imports `StandardSchemaV1` directly into
`RuleExpression` and `useForm`'s `schema` option — drop-in, once it stabilizes:

```ts
useField('height_m', heightField)
// or
useForm({ validationSchema: lingoObject({ height_m: heightField, weight_kg: weightField }) })
```

Lead docs with the v4 wrapper as the thing teams should actually ship; label
the v5 path "ready for when vee-validate v5 stabilizes," not the default
recommendation — a two-beta, no-stable-date surface is a foundation that can
still shift.

Vue has no React-style hooks, so the controlled bridge goes through the
framework-agnostic DOM controller against a template ref instead of
`useLingoInput`:

```ts
lingoInput(el, {
  kind: 'length',
  unit: 'm',
  onCommit: (f) => { value.value = f.value },
})
```

## Angular: Signal Forms (v22) vs classic Reactive Forms

Signal Forms went stable in **v22** (2026-06-03). `validateStandardSchema(path, schema)`
accepts a **nested field path**, not just the form root, which matters because
it means a lingo field is not limited to whole-form validation the way RHF's
resolver is:

```ts
import { form, validateStandardSchema } from '@angular/forms/signals'

const patientForm = form(signal({ height_m: null as number | null }), (schemaPath) => {
  validateStandardSchema(schemaPath.height_m, heightField)
})
```

Bridge from the DOM controller: `patientForm.height_m().value.set(canonicalNumber)`
inside `onCommit`.

Classic Reactive Forms — still the majority of production Angular code, since
Signal Forms only went stable a month before this research pass — has no
Standard Schema adapter at all. Wrap a `ValidatorFn`:

```ts
const lingoValidator: ValidatorFn = (control) => {
  const r = heightField.safeParse(control.value)
  return r.issues ? { lingo: r.issues[0].message } : null
}
```

A lingo Angular guide that only shows `validateStandardSchema` is inapplicable
to most Angular codebases actually shipping today — both recipes need to ship
together, not just the newer one.

## Key traps (cross-cutting)

- **`lingoObject` is closed by default.** Unknown keys fail validation and the
  emitted JSON Schema sets `additionalProperties: false` — a tool-boundary
  default from plan 020 (OpenAI strict structured outputs require it), not a
  forms default. Used as a form resolver, either pass
  `lingoObject(shape, { passthrough: true })` or declare every field the form
  actually submits (`packages/lingo/src/ai/canonicalize.ts:123-163`).
- **RHF's resolver is whole-form only.** There is no way to pass a bare
  `quantityField()`/`dateField()` as `resolver` the way
  `zodResolver(z.object({...}))` might suggest by analogy — the natural first
  attempt will type-error or silently validate the wrong shape. Point
  developers at `lingoObject()` (whole form) or `register(name, { validate })`
  (one field); the two don't compose on the identical field.
- **`useLingoInput` is ref-based, not controlled `value`/`onChange`.** Merging
  its `ref` with a form library's own ref callback (RHF's `Controller`
  `field.ref`) is an extra wiring step every integration needs — get it wrong
  (two independent writers touching the same `<input>`) and you get a subtle
  input-fighting bug that's hard to trace back to "two refs." Whichever
  integration is written, make one side (`onValueChange` → the form
  library's `onChange`) the single funnel; never let both sides mutate value
  state independently.
- **The `warnings` channel is invisible everywhere.** All five libraries above
  read only `.value`/`.issues`; none has a UI slot for a benign-forgiveness
  success message. This silently drops lingo's clearest UX differentiator
  (typo-fixed / unit-assumed hints) the moment a team adopts the plain
  Standard Schema path instead of `useLingoInput`'s own `state`/hint surface.

## shadcn/ui: Field primitives replaced Form as the taught pattern

`ui.shadcn.com/docs/components/form` now permanently 308-redirects to
`ui.shadcn.com/docs/forms` (verified via `curl -IL`, `location: /docs/forms`).
That hub no longer teaches one `Form` component — it presents "pick your
framework" across **React Hook Form**, **TanStack Form**, and **Formisch**
(React `useActionState` marked "coming soon"), all built on a new **`Field`**
primitive family shipped October 2025: `Field`, `FieldLabel`,
`FieldDescription`, `FieldError`, `FieldGroup`, `FieldSet`, plus
`FieldContent`/`FieldTitle`/`FieldSeparator`/`FieldLegend`
(`npx shadcn@latest add field`).

Two distinct kinds of "agnostic" are easy to conflate here, and shadcn's own
copy is precise about which is which: `Field` is **form-library-agnostic**
(shadcn's own words are "Server Actions, React Hook Form, TanStack Form, Bring
Your Own Form" — agnostic to *which library owns form state*), while
**`FieldError` is Standard-Schema-agnostic**, i.e. agnostic to which
*validator* produced the error. The docs state plainly: *"FieldError also
accepts issues produced by any validator that implements Standard Schema,
including Zod, Valibot, and ArkType. Pass the `issues` array from the schema
result directly to render a unified error list across libraries."* The
documented prop is `errors: Array<{ message?: string } | undefined>`, and the
shipped `field.tsx` source confirms there is no RHF- or Zod-specific branching
— it only ever reads `error?.message`. A `LingoField`'s
`['~standard'].validate()` failure branch is `{ issues: [{ message, path }] }`
per spec, which satisfies that shape with zero adapter code:

```tsx
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Controller, useForm } from 'react-hook-form'
import { lingoObject, quantityField } from '@pascal-app/lingo/ai'
import { Field, FieldLabel, FieldDescription, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

const schema = lingoObject({
  height: quantityField({ kind: 'length', unit: 'm', min: 0.3, max: 2.5 }),
  weight: quantityField({ kind: 'mass', unit: 'kg', min: 0 }),
})

const form = useForm<{ height: string; weight: string }, unknown, { height: number; weight: number }>({
  resolver: standardSchemaResolver(schema),
  defaultValues: { height: '', weight: '' },
})

<form onSubmit={form.handleSubmit((data) => { /* data.height === 1.8034 (m) */ })}>
  <Controller
    name="height"
    control={form.control}
    render={({ field, fieldState }) => (
      <Field data-invalid={fieldState.invalid}>
        <FieldLabel htmlFor={field.name}>Height</FieldLabel>
        <Input {...field} id={field.name} aria-invalid={fieldState.invalid}
               placeholder={`5'11" or 180cm`} autoComplete="off" />
        <FieldDescription>Any format — imperial or metric.</FieldDescription>
        {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
      </Field>
    )}
  />
</form>
```

This is the exact `Controller`/`Field`/`fieldState.error` anatomy shadcn's
current React Hook Form guide shows — the *only* lingo-specific line is the
`resolver`. shadcn's own guide even says client-side validation examples
using Zod "can be replaced with any other Standard Schema validation
library" — lingo qualifies directly.

The **legacy** `Form`/`FormField`/`FormItem`/`FormLabel`/`FormControl`/
`FormDescription`/`FormMessage` registry item is not removed: fetching
`ui.shadcn.com/r/styles/new-york-v4/form.json` still returns it, unchanged in
shape (`FormField` = `<Controller>` + React context; `FormControl` = a Radix
`Slot.Root` cloning `aria-invalid`/`aria-describedby` onto its child). GitHub
discussion shadcn-ui/ui#9505 confirms it's kept as "a thin React Hook Form
wrapper," just no longer the promoted starting point. Both patterns are live
simultaneously — the legacy one is what most existing production shadcn
codebases already have installed, so a lingo recipe needs both, not just the
newer one.

## Vanilla HTML/JS: `lingoInput()` sits on top of Constraint Validation

`lingoInput()` (`packages/lingo/src/dom/index.ts`) doesn't replace the
platform's own form validation — it layers onto it. The render method syncs
`setCustomValidity(message)` under this exact condition (source,
`index.ts:832`):

```ts
(this.validationBehavior() === 'native' || this.form) &&
  typeof this.el.setCustomValidity === 'function'
```

That is: **whenever the input has a form ancestor at all**, `customError`
stays synced, regardless of `validationBehavior`. `reportValidity()` (the
call that paints the native error bubble) is only invoked from `'native'`
mode's Enter/submit handlers — but the browser's own pre-submit validation
pass (spec-equivalent to `reportValidity()`, and outside lingo's control) will
still fire on a real `<form>` submit as long as `customError` is set, even in
`'aria'` mode. Practical, currently-undocumented consequence: pair
`validationBehavior: 'aria'` with `<form novalidate>` if the goal is *only*
lingo's own `errorElement` text and no native bubble — this is MDN's own
documented mechanism for suppressing built-in UI in favor of fully custom
validation, not a lingo-specific workaround.

A hard, unenforced-by-code requirement: the underlying element must be
`type="text"` (or unset). `type="number"`'s HTML value-sanitization algorithm
blanks any non-numeric keystroke before lingo's input handler ever runs, so
`"5'11\""` never reaches the parser at all — this happens at the browser
level, invisible in lingo's own source.

Progressive-enhancement recipe (works with zero server change if the server
can also run lingo; degrades to raw text otherwise):

```html
<form method="post" action="/signup" novalidate>
  <label for="height">Height</label>
  <input id="height" name="height" inputmode="text" placeholder="5'11&quot; or 180cm" required>
  <p id="height-error" role="alert"></p>
  <p id="height-hint" aria-hidden="true"></p>
  <button>Continue</button>
</form>
<script type="module">
  import { lingoInput } from '@pascal-app/lingo/dom'
  lingoInput(document.querySelector('#height'), {
    kind: 'length', unit: 'm', name: 'height', min: '0.3m', max: '2.5m', required: true,
    validationBehavior: 'aria',
    errorElement: '#height-error', hintElement: '#height-hint',
  })
</script>
```

No-JS tier: the form posts `height=5'11"` (raw text) under the field name.
JS tier: `configureHidden()` strips `name` off the visible input and moves it
to a synthesized `<input type="hidden">` carrying the canonical decimal, so
the server always reads one key (`height`) whose *shape* depends on whether JS
ran — re-parse server-side regardless, as defense-in-depth (this repo's own
two-way guarantee already implies a server-capable parser exists).

## Web components: a genuine gap, not a docs gap

`find src/{dom,react}` is the entire DOM surface today — there is no
`./element` entry and no custom-element code anywhere in the package (`ls
packages/lingo/src` confirms only `ai/`, `core/`, `date/`, `dom/`, `format/`,
`fuzzy/`, `number/`, `parse/`, `react/`, `units/`, `locale/`, `messages/`).
Two shapes are available at very different cost:

**(a) Light-DOM wrapper — works today, zero new lingo code.** Keep the real
`<input>` in light DOM (so it stays natively form-associated) and have a
custom element call `lingoInput()` in `connectedCallback` / `.destroy()` in
`disconnectedCallback`. One real, source-verified caveat: `errorElement`/
`hintElement` string selectors resolve via `this.el.ownerDocument.querySelector(target)`
(`index.ts:971-991`), which **cannot cross a shadow boundary** — if the
hint/error nodes live inside the element's own shadow root, pass live
`HTMLElement` references instead of selector strings (already supported by
the existing `HTMLElement | string` option type, just undocumented as a
shadow-DOM pattern).

**(b) A true form-associated custom element — new code, real opportunity.**
`static formAssociated = true` plus `attachInternals()` lets an element call
`internals.setFormValue(value)` / `internals.setValidity(flags, message, anchor)`
directly (Baseline-safe since Safari 16.4, 2023). This collapses lingo's
current two-node trick (visible input + synthesized hidden input) into one
node, and makes lingo usable — unmodified in spirit — from Vue/Svelte/Angular/
plain-HTML design systems with no framework adapter at all:

```js
class LingoInputElement extends HTMLElement {
  static formAssociated = true
  #internals = this.attachInternals()
  #input = document.createElement('input')
  connectedCallback() {
    this.attachShadow({ mode: 'open' }).append(this.#input)
    this.field = lingoInput(this.#input, {
      kind: this.getAttribute('kind'),
      unit: this.getAttribute('unit'),
      validationBehavior: 'native',
      onStateChange: (state, f) => {
        this.#internals.setFormValue(f.value != null ? String(f.value) : null)
        this.#internals.setValidity(
          state === 'invalid' ? { customError: true } : {},
          state === 'invalid' ? this.#input.validationMessage : '',
          this.#input,
        )
      },
    })
  }
  formResetCallback() { this.#input.value = ''; this.field?.commit() }
  formDisabledCallback(disabled) { this.#input.disabled = disabled }
}
customElements.define('lingo-input', LingoInputElement)
```

This does not exist in the package today. It is materially new surface —
validity/value plumbing re-derived through `ElementInternals` instead of
`setCustomValidity` + a hidden input — not a quick docs addition, and should
not be scoped as one.

## Implications for lingo

This research pass finds the runtime story already works — every library
above either consumes `~standard.validate` directly (TanStack Form, vee-validate
v5, Angular Signal Forms) or has an official adapter that does
(`@hookform/resolvers`) — so the leverage is almost entirely in recipes and one
small bridge, not new parsing/validation code. `docs/recipes.md` today has
field configs, server-side validation, and AI-tool/MCP recipes, but **zero**
form-library recipes; this is the gap this research closes the analysis on.
Concretely, for plan 024 to weigh:

- **A recipe per library, doc-only.** Each library section above (RHF, TanStack
  Form, Formik, vee-validate, Angular) is directly portable into
  `docs/recipes.md` / site `/integrations` as-is — code, caveats, and the
  "whole form vs. one field" decision tree up front, so a developer doesn't
  first try (and fail) to pass a bare `quantityField()` where RHF expects a
  whole-form resolver. Both shadcn patterns (`Field`-based and legacy
  `Form`-based) need their own recipe, since both are live in production
  today.
- **The RHF `Controller`-ref-merge bridge.** Every framework integration above
  that wants live partial-state UX (not just blur/submit validation) re-derives
  the identical boilerplate: merge `useLingoInput`'s ref with the form
  library's own ref, and make `onValueChange` the single write funnel. Whether
  that boilerplate stays a documented pattern or becomes a small shipped
  helper (mirroring how `@hookform/resolvers` itself exists as "one adapter
  package per ecosystem") is an open question for plan 024's design-principle
  gate (~70% recipes, ~30% justified new code, "own entry, own budget" if
  anything ships) — this doc surfaces the need, plan 024 decides the shape.
- **Surfacing `warnings`.** No library here has a UI slot for it, so the
  recipe-level fix is per-framework: show `field.safeParse(value).warnings`
  in whatever hint/description slot each library exposes (shadcn's
  `FieldDescription`, RHF's `formState` read alongside the resolver result,
  Formik's `status`, vee-validate's meta). Worth a dedicated docs section
  precisely because it's the one place all five libraries fall short of the
  DOM/React layer's own hint UX, and it is otherwise invisible unless called
  out.
- **The custom-element opportunity.** A `<lingo-input>` form-associated custom
  element (candidate entry, e.g. `@pascal-app/lingo/element`) is the only item
  in this research that is new code rather than documentation — genuinely
  useful for design systems spanning multiple frameworks, but scoped,
  budgeted, and gated the same way as any other candidate in plan 024, not a
  quick win bundled with the recipe work.

## Sources

- `react-hook-form.com/docs/useform`, `react-hook-form.com/docs/useform/register`,
  `github.com/react-hook-form/resolvers` (README, `standard-schema/src/standard-schema.ts`,
  PRs #738/#746/#748, issue #747), `github.com/react-hook-form/react-hook-form`
  (issue #11023, discussion #10654, discussion #7512)
- `github.com/TanStack/form/blob/main/packages/form-core/src/standardSchemaValidator.ts`,
  `tanstack.com/form/v1/docs/framework/react/guides/submission-handling`
- `formik.org/docs/guides/validation`, `x.com/jaredpalmer/status/1986851141645443151`
- `vee-validate@4.15.1` and `vee-validate@5.0.0-beta.1` published `.d.ts` (unpkg)
- `angular.dev/api/forms/signals/validateStandardSchema`, `angular.dev/essentials/signal-forms`
- `ui.shadcn.com/docs/forms`, `ui.shadcn.com/docs/components/field`,
  `ui.shadcn.com/r/styles/new-york-v4/form.json`, `ui.shadcn.com/docs/changelog/2025-10-new-components`,
  GitHub discussion `shadcn-ui/ui#9505`
- MDN `Constraint_validation`, MDN `ElementInternals`,
  `web.dev/articles/more-capable-form-controls`
- `github.com/standard-schema/standard-schema`, `@standard-schema/spec@1.1.0` (npm/unpkg)
- This repo: `packages/lingo/src/ai/{standard-schema,quantity-fields,date-field,canonicalize}.ts`,
  `packages/lingo/src/dom/index.ts`, `packages/lingo/src/react/index.ts`,
  `packages/lingo/docs/recipes.md`, plans/020, plans/024

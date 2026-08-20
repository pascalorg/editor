---
id: 027
title: Compile-time type inference
status: done
created: 2026-07-06
updated: 2026-07-07
goal: "Unit/kind refs are literal-typed with zero runtime cost — wrong-kind convert/quantity calls are compile errors, dynamic strings still compile."
---

# 027 — Compile-time type inference

Type inference on the code side, in the Matt Pocock / Total TypeScript style
(D29, D33, D39; cross-kind collision resolution hardened per D54).

Deferred (not shipped, tracked here so the plan doesn't over-promise): the
"conservative literal parse" `parseQuantity<S extends \`${number} ${BuiltinUnitRef}\`>`
template-literal overload below is not implemented — `parseQuantity()` takes
`string` and the value type is not narrowed from a literal input. Arbitrary
custom-registry literal inference also remains deferred (`createLingo({ kinds })`
returns broad `string` refs). D54 closed the real correctness hole: colliding refs
(`oz`, `C`) resolved to a *union* so `convert(5, 'oz', 'ml')` compiled then threw;
`KindOfUnit` walks the `allKinds` tuple and returns the single runtime kind,
and `type-inference.test-d.ts` gates all 33 kinds with a drift check.

**Hard constraint: zero runtime cost.** Everything here is type-only — generic
signatures, `const` type parameters, and generated type maps. No new runtime code
paths, no bundle size beyond `.d.ts`. Don't reimplement the parser in types
(kills editor perf); focus on unit refs, kind narrowing, and conservative literal
autocomplete.

## Problem this solves (without inference, all `string`)

```ts
convert(5, 'kg', 'cm')       // compiles; throws at runtime
quantity(5, 'kg', 'length')  // compiles; throws (kg is mass, not length)
quantity(5, 'not-a-unit')    // compiles; throws
```

`Kind` widens to `(string & {})`; `convert`/`quantity` take `string`; `UnitDef.id`
is `string` so literal refs erase once data is annotated (`core/types.ts:14,54`;
`index.ts:125,149,392`).

## Design — literal preservation (the crux; locked-in 2026-07-06)

The unit tables are `export const length: KindDef = {…}`, and `KindDef.units:
UnitDef[]` **widens `id` to `string`** — so literal ids are erased and no type map
can be derived from the data. Fix with a Pocock-style `const`-generic identity
helper (zero runtime cost, runtime object unchanged):

```ts
// core: preserves literals in the type, returns the same object at runtime.
export function defineKind<const T extends KindDef>(kind: T): T { return kind }
// units/length.ts
export const length = defineKind({ kind: 'length', baseUnit: 'm', units: [
  { id: 'm', symbol: 'm', name: 'meter', factor: 1, system: 'metric' },
  …
] })
```

Then derive the maps by indexed access — no codegen, no drift:

```ts
type UnitIdByKind<K extends BuiltinKind> =
  Extract<(typeof allKindsTuple)[number], { kind: K }>['units'][number]['id']
```

- Registry/consumer signatures widen to `readonly UnitDef[]` where they take unit
  arrays, or accept `KindDef` structurally (the narrowed literal type is
  assignable to the wide one) — verify no runtime/`bun run size` change.
- `allKinds` becomes a `readonly` tuple (`as const`-ish via `defineKind` elements)
  so `KindOfUnit<U>` can search across kinds at the type level.
- Fallback if `defineKind` ripples too far into registry internals: a tiny
  codegen script emitting `unit-refs.generated.ts`, gated by a `*.test-d.ts` that
  fails if a runtime unit id is missing from the union. Prefer `defineKind` first.

## Design — public type vocabulary (locked-in 2026-07-06)

Generated from the built-in unit tables as **type-only** exports (via the
`defineKind` literal preservation above, kept honest by a `*.test-d.ts` gate):

```ts
export type BuiltinKind =
  | 'length' | 'mass' | 'temperature' | 'duration' | 'volume' | 'area'
  | 'speed' | 'data' | 'pressure' | 'energy' | 'angle' | 'percent'

/** Canonical unit ids per kind, e.g. UnitIdByKind<'length'> = 'm'|'cm'|'ft'|… */
export type UnitIdByKind<K extends BuiltinKind> = …
/** Ids plus their known aliases, for parse/convert inputs. */
export type UnitRefByKind<K extends BuiltinKind> = UnitIdByKind<K> | AliasByKind<K>
export type BuiltinUnitRef = { [K in BuiltinKind]: UnitRefByKind<K> }[BuiltinKind]
/** Type-level unit→kind lookup for built-ins. */
export type KindOfUnit<U extends string> = …
/** Canonical id a ref resolves to (alias → id). */
export type CanonicalUnitId<U extends string> = …
```

The escape hatch `(string & {})` stays in every input position so custom
registries and dynamic strings still compile — literals get autocomplete + errors,
unknown strings degrade gracefully (no hard failure).

## Design — typed signatures

```ts
// quantity(): infer kind from the unit; reject wrong kind / unknown unit.
declare function quantity<const U extends BuiltinUnitRef>(
  value: number, unit: U,
): Quantity<KindOfUnit<U>>
declare function quantity<const K extends BuiltinKind, const U extends UnitRefByKind<K>>(
  value: number, unit: U, kind: K,
): Quantity<K>

// convert(): `to` is constrained to the SAME kind as `from` → cross-kind is a
// compile error, not a runtime throw.
declare function convert<
  const From extends BuiltinUnitRef,
  const To extends UnitRefByKind<KindOfUnit<From>>,
>(value: number, from: From, to: To): number
```

- `Quantity` gains an optional `Kind` type parameter defaulting to `Kind` so
  existing untyped usage is unaffected (`Quantity` === `Quantity<Kind>`).
- Same treatment for `convertDelta`, `to()`, `valueIn()`, `contains(value, unit)`.

Custom registries keep their literals:

```ts
declare function createLingo<const Kinds extends readonly KindDef[]>(
  options: { kinds: Kinds } & Omit<CreateLingoOptions, 'kinds'>,
): LingoInstanceFor<Kinds>   // unit refs typed to the registered set
```

Built-in `createLingo()` overloads return `BuiltinLingoInstance`, so instance
`.quantity()`/`.convert()`/`.convertDelta()`/`.fromMinor()` keep the same
literal built-in unit checks as the top-level helpers. `createLingo({ kinds })`
and `createLingo({ registry })` return broad `string` refs; deriving safe
literal refs for arbitrary caller-owned registries remains a follow-up, not
this plan.

Conservative literal parse (obvious template shapes only; fall back to the
union) — DEFERRED, see the note at the top:

```ts
declare function parseQuantity<const S extends `${number} ${BuiltinUnitRef}`>(
  input: S,
): QuantityResultFor<UnitIn<S>>
declare function parseQuantity(input: string, opts?: LingoOptions): QuantityResult | FailResult
```

## Non-goals

- No type-level parsing of ranges, conversions, compounds, fuzzy, or dates.
- No dependency; no runtime validation change (that's plan 025's `fromJSON`).
- Keep generated unions flat and cached behind named exports to bound `.d.ts`
  size and editor cost.

## Acceptance / gates

- `*.test-d.ts` (expect-type / tsd-style, devDep only) proving: wrong-kind
  `convert`/`quantity` error; unknown unit errors; correct calls infer the kind;
  `(string & {})` escape still compiles; built-in `createLingo()` keeps those
  checks; custom `createLingo({ kinds })` keeps broad refs until a later
  `LingoInstanceFor<Kinds>` pass.
- No runtime diff: `bun run size` unchanged (type-only); `bun run build` emits the
  new `.d.ts` exports.
- A sync gate so the generated unit-ref unions can't drift from the registry data
  (fail typecheck if a built-in unit id is missing from `UnitIdByKind`).
- TSDoc `@example` on new type exports; README "type-safe by default" section.

## Sequencing

Depends on: 025 (`Quantity<K>` composes with the wire shapes). Related: 026
(built-in currency refs slot into the same vocabulary).

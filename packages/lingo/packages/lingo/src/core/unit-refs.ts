import type { allKinds } from '../units/index'

/** The literal built-in kind tuple that powers the unit-ref type vocabulary. */
type AllKinds = typeof allKinds

/**
 * Built-in measurement kinds shipped by lingo.
 * @example
 * ```ts
 * import type { BuiltinKind } from '@pascal-app/lingo'
 * const kind: BuiltinKind = 'length'
 * ```
 */
export type BuiltinKind = AllKinds[number]['kind']

type UnitDefByKind<K extends BuiltinKind> = Extract<AllKinds[number], { kind: K }>['units'][number]
type StringLiteral<T> = T extends string ? (string extends T ? never : T) : never
type StringProp<T, P extends PropertyKey> = T extends unknown
  ? T extends { [Key in P]?: infer Value }
    ? StringLiteral<Extract<Value, string>>
    : never
  : never
type StringArrayProp<T, P extends PropertyKey> = T extends unknown
  ? T extends { [Key in P]?: infer Value }
    ? Value extends readonly string[]
      ? StringLiteral<Extract<Value[number], string>>
      : never
    : never
  : never

/**
 * Canonical built-in unit ids for a kind.
 * @example
 * ```ts
 * import type { UnitIdByKind } from '@pascal-app/lingo'
 * const unit: UnitIdByKind<'length'> = 'cm'
 * ```
 */
export type UnitIdByKind<K extends BuiltinKind> = UnitDefByKind<K>['id']

type UnitSymbolByKind<K extends BuiltinKind> = UnitDefByKind<K>['symbol']
type UnitNameByKind<K extends BuiltinKind> = UnitDefByKind<K>['name']
type UnitPluralByKind<K extends BuiltinKind> =
  | StringProp<UnitDefByKind<K>, 'plural'>
  | `${UnitNameByKind<K>}s`
type CaseExactByKind<K extends BuiltinKind> = StringArrayProp<UnitDefByKind<K>, 'caseExact'>

/**
 * Declared parse aliases for units in a built-in kind.
 * @example
 * ```ts
 * import type { AliasByKind } from '@pascal-app/lingo'
 * const alias: AliasByKind<'mass'> = 'kilos'
 * ```
 */
export type AliasByKind<K extends BuiltinKind> = StringArrayProp<UnitDefByKind<K>, 'aliases'>

/**
 * Any built-in unit ref accepted by a kind: id, symbol, name, plural, alias, or
 * exact-case ref.
 * @example
 * ```ts
 * import type { UnitRefByKind } from '@pascal-app/lingo'
 * const unit: UnitRefByKind<'volume'> = 'L'
 * ```
 */
export type UnitRefByKind<K extends BuiltinKind> =
  | UnitIdByKind<K>
  | UnitSymbolByKind<K>
  | UnitNameByKind<K>
  | UnitPluralByKind<K>
  | AliasByKind<K>
  | CaseExactByKind<K>

/**
 * Any built-in unit ref known to the default registry.
 * @example
 * ```ts
 * import type { BuiltinUnitRef } from '@pascal-app/lingo'
 * const unit: BuiltinUnitRef = 'kg'
 * ```
 */
export type BuiltinUnitRef = { [K in BuiltinKind]: UnitRefByKind<K> }[BuiltinKind]

/**
 * Walks the built-in kind tuple in registration order and returns the FIRST
 * kind whose refs include `U`. A mapped union (`{ [K]: … }[BuiltinKind]`) would
 * return EVERY claiming kind, so a cross-kind ref like `oz` (mass + volume) or
 * `C` (temperature + charge) widened to a union — and `convert(5, 'oz', 'ml')`
 * then compiled and threw at runtime. Earlier kinds win here, mirroring the
 * registry's cross-kind priority (`allKinds` order), so `KindOfUnit` resolves
 * to the one kind the runtime actually picks.
 */
type KindOfUnitFrom<U extends string, T extends readonly unknown[]> = T extends readonly [
  infer Head,
  ...infer Tail,
]
  ? Head extends { kind: infer K extends BuiltinKind }
    ? U extends UnitRefByKind<K>
      ? K
      : KindOfUnitFrom<U, Tail>
    : never
  : never

/**
 * Type-level lookup from a built-in unit ref to its built-in kind. Colliding
 * refs resolve to the single kind the runtime picks, not a union.
 * @example
 * ```ts
 * import type { KindOfUnit } from '@pascal-app/lingo'
 * type K = KindOfUnit<'kg'> // 'mass'
 * type Oz = KindOfUnit<'oz'> // 'mass' (not 'mass' | 'volume')
 * ```
 */
export type KindOfUnit<U extends string> = KindOfUnitFrom<U, AllKinds>

/**
 * Canonical id approximation for a built-in unit ref.
 * @example
 * ```ts
 * import type { CanonicalUnitId } from '@pascal-app/lingo'
 * type Id = CanonicalUnitId<'kilos'> // a mass unit id
 * ```
 */
export type CanonicalUnitId<U extends string> =
  KindOfUnit<U> extends infer K extends BuiltinKind ? UnitIdByKind<K> : never

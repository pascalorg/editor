import { editDistanceWithRows, typoBudget } from './suggest'
import type { Kind, KindDef, UnitDef } from './types'

/**
 * Unit registry: kinds, units, and the alias index used by the parser.
 *
 * Alias matching is longest-prefix over the normalized input (not token
 * equality) so aliases may contain spaces, dots and slashes ("fl. oz.",
 * "sq ft", "km/h"). Case-insensitive aliases match against the lowercased
 * text; `caseExact` aliases (data units, 'Cal') match the raw text and win
 * over same-length case-insensitive hits.
 */

interface AliasEntry {
  exact: boolean
  /** Alias text; lowercase for ci entries, raw for exact entries. */
  key: string
  kind: Kind
  mask: number
  unit: UnitDef
}

type StoredKindDef = Omit<KindDef, 'units'> & { units: UnitDef[] }

/**
 * One unit alias hit at a text position — what `Registry.matchUnitsAt()`
 * returns, sorted best-first.
 * @example
 * ```ts
 * import { defaultRegistry } from '@pascal-app/lingo'
 * const hits = defaultRegistry.matchUnitsAt('cm', 'cm', 0)
 * hits[0]?.unit.id // 'cm'
 * ```
 */
export interface UnitMatch {
  alias: string
  exact: boolean
  kind: Kind
  kindDef: KindDef
  /** Characters of normalized text consumed by the alias. */
  length: number
  unit: UnitDef
}

/** One ranked alias expansion for prefix autocomplete (`aliasCompletions`). */
export interface AliasCompletion {
  alias: string
  exact: boolean
  kind: Kind
  unit: UnitDef
}

const NO_ENTRIES: AliasEntry[] = []

function charMask(text: string): number {
  let mask = 0
  for (let i = 0; i < text.length; i++) {
    mask |= 1 << (text.charCodeAt(i) & 31)
  }
  return mask
}

function isWordChar(ch: string): boolean {
  return /[a-z0-9°μ]/i.test(ch)
}

/**
 * Fuzzy vocabulary: words denoting a region of a scale ("hot"), attached to
 * a kind via `defineFuzzyVocab`. Bands are [min, max) in `unit`.
 * @example
 * ```ts
 * import { defineFuzzyVocab, type FuzzyVocab } from '@pascal-app/lingo'
 * const parcels: FuzzyVocab = {
 *   profile: 'parcels', unit: 'kg',
 *   terms: { light: [0, 5], heavy: [20, 70] },
 * }
 * defineFuzzyVocab('mass', parcels)
 * // lingo('heavy', { kind: 'mass', profile: 'parcels' }) → 20–70 kg
 * ```
 */
export interface FuzzyVocab {
  /** Lead-in words to strip: "it's", "feels", "pretty"… */
  fillers?: string[]
  profile: string
  terms: Record<string, readonly [number, number]>
  unit: string
}

/**
 * Kinds, units, and the alias index the parser looks units up in. Build one
 * with `createRegistry()` (bring-your-own-data) or extend the default one
 * via `registerKind`/`registerUnits`/`defineFuzzyVocab`.
 * @example
 * ```ts
 * import { createRegistry } from '@pascal-app/lingo/core'
 * const reg = createRegistry([{
 *   kind: 'length', baseUnit: 'm',
 *   units: [{ id: 'm', symbol: 'm', name: 'meter', factor: 1, system: 'metric' }],
 * }])
 * reg.unit('length', 'm')?.factor // 1
 * ```
 */
export class Registry {
  private kindDefs = new Map<Kind, StoredKindDef>()
  private unitsByKind = new Map<Kind, Map<string, UnitDef>>()
  /** First-char buckets, entries sorted by key length descending. */
  private ci = new Map<string, AliasEntry[]>()
  private exact = new Map<string, AliasEntry[]>()
  private fuzzy = new Map<Kind, FuzzyVocab[]>()
  private suggestAll: AliasEntry[][] = []
  private suggestDirty = true

  constructor(kinds: readonly KindDef[] = []) {
    for (const k of kinds) {
      this.registerKind(k)
    }
  }

  /**
   * Register a new measurement kind. Throws if the kind id is already
   * registered, its base unit is missing, or the base unit isn't factor 1 /
   * offset 0.
   * @example
   * ```ts
   * import { defaultRegistry, registerKind } from '@pascal-app/lingo'
   * registerKind({
   *   kind: 'widget', baseUnit: 'widget',
   *   units: [{ id: 'widget', symbol: 'widget', name: 'widget', factor: 1, system: 'shared' }],
   * })
   * defaultRegistry.kind('widget')?.baseUnit // 'widget'
   * ```
   */
  registerKind(def: KindDef): void {
    const copy = structuredClone(def)
    const stored: StoredKindDef = { ...copy, units: [...copy.units] }
    if (this.kindDefs.has(def.kind)) {
      throw new Error(`lingo: kind "${def.kind}" is already registered`)
    }
    this.kindDefs.set(stored.kind, stored)
    this.unitsByKind.set(stored.kind, new Map())
    for (const unit of stored.units) {
      this.addUnit(stored, unit)
    }
    const base = this.unitsByKind.get(stored.kind)!.get(stored.baseUnit)
    if (!base) {
      throw new Error(
        `lingo: kind "${stored.kind}" declares missing base unit "${stored.baseUnit}"`,
      )
    }
    if (base.factor !== 1 || (base.offset ?? 0) !== 0) {
      throw new Error(
        `lingo: base unit "${stored.baseUnit}" of "${stored.kind}" must have factor 1 and no offset`,
      )
    }
  }

  /**
   * Add units to an existing kind (user extension point).
   * @example
   * ```ts
   * import { registerUnits, convert } from '@pascal-app/lingo'
   * registerUnits('length', [
   *   { id: 'smoot', symbol: 'smoot', name: 'smoot', factor: 1.702, system: 'us', aliases: ['smoots'] },
   * ])
   * convert(1, 'smoot', 'm') // 1.702
   * ```
   */
  registerUnits(kind: Kind, units: readonly UnitDef[]): void {
    const def = this.kindDefs.get(kind)
    if (!def) {
      throw new Error(`lingo: unknown kind "${kind}"`)
    }
    for (const unit of units) {
      // Same defensive copy as registerKind: later caller mutations must not
      // reach the registry (createRegistry promises copied unit arrays).
      const copy = structuredClone(unit)
      this.addUnit(def, copy)
      def.units.push(copy)
    }
  }

  registerUnitAliases(kind: Kind, unitRef: string, aliases: readonly string[]): void {
    const unit = this.unitByRef(kind, unitRef)
    if (!unit) {
      return
    }
    for (const alias of aliases) {
      this.insert(this.ci, alias.toLowerCase(), false, kind, unit)
    }
  }

  private addUnit(def: StoredKindDef, unit: UnitDef): void {
    const byId = this.unitsByKind.get(def.kind)!
    if (byId.has(unit.id)) {
      throw new Error(`lingo: duplicate unit id "${unit.id}" in kind "${def.kind}"`)
    }
    if (!(unit.factor > 0 && Number.isFinite(unit.factor))) {
      throw new Error(`lingo: unit "${unit.id}" (${def.kind}) needs a positive finite factor`)
    }
    byId.set(unit.id, unit)

    const exactSet = new Set(unit.caseExact ?? [])
    const exactLower = new Set([...exactSet].map((s) => s.toLowerCase()))
    const ciKeys = new Set<string>()
    for (const raw of [
      unit.id,
      unit.symbol,
      unit.name,
      unit.plural ?? `${unit.name}s`,
      ...(unit.aliases ?? []),
    ]) {
      const key = raw.toLowerCase()
      // A string listed in caseExact must not also match case-insensitively.
      if (!exactLower.has(key)) {
        ciKeys.add(key)
      }
    }
    for (const key of ciKeys) {
      this.insert(this.ci, key, false, def.kind, unit)
    }
    for (const key of exactSet) {
      this.insert(this.exact, key, true, def.kind, unit)
    }
  }

  private insert(
    pool: Map<string, AliasEntry[]>,
    key: string,
    exact: boolean,
    kind: Kind,
    unit: UnitDef,
  ): void {
    if (key.length === 0) {
      return
    }
    const bucketKey = key[0]!
    let bucket = pool.get(bucketKey)
    if (!bucket) {
      pool.set(bucketKey, (bucket = []))
    }
    if (!exact) {
      const dup = bucket.find((e) => e.key === key && e.kind === kind)
      if (dup) {
        if (dup.unit.id === unit.id) {
          return
        }
        throw new Error(
          `lingo: alias "${key}" collides inside kind "${kind}" (${dup.unit.id} vs ${unit.id})`,
        )
      }
    }
    bucket.push({ key, exact, kind, unit, mask: charMask(key) })
    bucket.sort((a, b) => b.key.length - a.key.length)
    if (!exact) {
      this.suggestDirty = true
    }
  }

  /**
   * Look up a registered kind's definition.
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.kind('length')?.baseUnit // 'm'
   * ```
   */
  kind(kind: Kind): KindDef | undefined {
    return this.kindDefs.get(kind)
  }

  /**
   * All registered kind ids.
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.kinds() // ['length', 'mass', 'temperature', 'duration', …]
   * ```
   */
  kinds(): Kind[] {
    return [...this.kindDefs.keys()]
  }

  /**
   * Look up a unit by its exact id within a kind.
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.unit('length', 'm')?.symbol // 'm'
   * ```
   */
  unit(kind: Kind, id: string): UnitDef | undefined {
    return this.unitsByKind.get(kind)?.get(id)
  }

  /**
   * Find a unit id across kinds (first registered kind wins).
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.findUnit('ft')?.kind // 'length'
   * ```
   */
  findUnit(id: string): { kind: Kind; unit: UnitDef } | undefined {
    for (const [kind, units] of this.unitsByKind) {
      const unit = units.get(id)
      if (unit) {
        return { kind, unit }
      }
    }
    return
  }

  /**
   * Resolve a unit reference liberally: exact id first, then any alias
   * (`convert(1, 'gal', 'L')` works even though the id is 'l').
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.unitByRef('length', 'meters')?.id // 'm'
   * ```
   */
  unitByRef(kind: Kind, ref: string): UnitDef | undefined {
    const exact = this.unit(kind, ref)
    if (exact) {
      return exact
    }
    const hit = this.matchUnitsAt(ref, ref.toLowerCase(), 0, kind).find(
      (m) => m.kind === kind && m.length === ref.length,
    )
    return hit?.unit
  }

  /**
   * Cross-kind liberal resolution (registration order = priority).
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.findUnitByRef('ft') // { kind: 'length', unit: { id: 'ft', … } }
   * ```
   */
  findUnitByRef(ref: string): { kind: Kind; unit: UnitDef } | undefined {
    const exact = this.findUnit(ref)
    if (exact) {
      return exact
    }
    const hit = this.matchUnitsAt(ref, ref.toLowerCase(), 0).find((m) => m.length === ref.length)
    return hit ? { kind: hit.kind, unit: hit.unit } : undefined
  }

  /**
   * All units registered under a kind, in registration order.
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.unitsOf('angle').map((u) => u.id) // ['rad', 'deg', 'arcmin', 'arcsec', 'gon', 'turn']
   * ```
   */
  unitsOf(kind: Kind): UnitDef[] {
    return this.kindDefs.get(kind)?.units ?? []
  }

  /**
   * The kind's canonical base unit (factor 1, no offset) — what `Quantity.base`
   * is expressed in.
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.baseUnit('mass').id // 'kg'
   * ```
   */
  baseUnit(kind: Kind): UnitDef {
    const def = this.kindDefs.get(kind)
    if (!def) {
      throw new Error(`lingo: unknown kind "${kind}"`)
    }
    return this.unitsByKind.get(kind)!.get(def.baseUnit)!
  }

  /**
   * All unit alias matches at `pos`. `text` is normalized input, `lower` its
   * lowercase twin. Sorted best-first: longer match > exact-case > kind-context
   * > registration order. Boundary rule: the character after a match must not
   * be a word character unless the alias itself ends in a non-word character
   * (so "mi" never matches inside "mix", but "ft." and "″" always terminate).
   * Digits are allowed after a match (compound tails like "1m80"). Mainly for
   * grammar internals; most callers want `unitByRef`/`findUnitByRef`.
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.matchUnitsAt('cm', 'cm', 0)[0]?.unit.id // 'cm'
   * ```
   */
  matchUnitsAt(text: string, lower: string, pos: number, kind?: Kind): UnitMatch[] {
    const out: UnitMatch[] = []
    this.collect(this.exact, text, pos, out)
    this.collect(this.ci, lower, pos, out)
    if (out.length === 0) {
      return out
    }
    out.sort((a, b) => {
      if (a.length !== b.length) {
        return b.length - a.length
      }
      if (a.exact !== b.exact) {
        return a.exact ? -1 : 1
      }
      if (kind) {
        const ak = a.kind === kind ? 0 : 1
        const bk = b.kind === kind ? 0 : 1
        if (ak !== bk) {
          return ak - bk
        }
      }
      return 0
    })
    // Dedupe: after sort, duplicates (same kind+unit+length) are adjacent.
    let w = 1
    for (let r = 1; r < out.length; r++) {
      const m = out[r]!
      const p = out[w - 1]!
      if (m.length !== p.length || m.kind !== p.kind || m.unit.id !== p.unit.id) {
        out[w++] = m
      }
    }
    out.length = w
    return out
  }

  private collect(
    pool: Map<string, AliasEntry[]>,
    haystack: string,
    pos: number,
    out: UnitMatch[],
  ): void {
    const ch = haystack[pos]
    if (ch === undefined) {
      return
    }
    for (const entry of pool.get(ch) ?? NO_ENTRIES) {
      const len = matchKey(entry.key, haystack, pos)
      if (len < 0) {
        continue
      }
      const next = haystack[pos + len]
      if (next !== undefined && isWordChar(next)) {
        const lastOfKey = entry.key[entry.key.length - 1]!
        // Aliases ending in a word char require a boundary — except digits,
        // which the grammar may consume as a compound tail ("1m80").
        if (isWordChar(lastOfKey) && !/[0-9]/.test(next)) {
          continue
        }
      }
      out.push({
        unit: entry.unit,
        kind: entry.kind,
        kindDef: this.kindDefs.get(entry.kind)!,
        length: len,
        exact: entry.exact,
        alias: entry.key,
      })
    }
  }

  /**
   * Is `token` a strict prefix of any alias? (Partial-input detection —
   * powers `partialState()`'s 'incomplete' verdict for as-you-type UIs.)
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.hasAliasPrefix('met', 'length') // true ("met" prefixes "meter")
   * ```
   */
  hasAliasPrefix(token: string, kind?: Kind): boolean {
    const needle = token.toLowerCase()
    const first = needle[0]
    if (!first) {
      return false
    }
    for (const e of this.ci.get(first) ?? NO_ENTRIES) {
      if (kind && e.kind !== kind) {
        continue
      }
      if (e.key.length > needle.length && e.key.startsWith(needle)) {
        return true
      }
    }
    const rawFirst = token[0]!
    for (const e of this.exact.get(rawFirst) ?? NO_ENTRIES) {
      if (kind && e.kind !== kind) {
        continue
      }
      if (e.key.length > token.length && e.key.startsWith(token)) {
        return true
      }
    }
    return false
  }

  /**
   * All unit aliases that strictly extend `prefix`, ranked for autocomplete.
   * Dedupes by kind+unit id (shortest alias wins). `kind` biases sort order.
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.aliasCompletions('f').map((c) => c.alias)
   * // ['f', 'ft', 'fahrenheit', …] — unique units, best-first
   * ```
   */
  aliasCompletions(prefix: string, kind?: Kind, limit = 20): AliasCompletion[] {
    const needle = prefix.toLowerCase()
    if (!(prefix && needle[0])) {
      return []
    }
    const rawHits: Array<{ entry: AliasEntry; exact: boolean }> = []
    for (const e of this.ci.get(needle[0]!) ?? NO_ENTRIES) {
      if (kind && e.kind !== kind) {
        continue
      }
      if (e.key.length > needle.length && e.key.startsWith(needle)) {
        rawHits.push({ entry: e, exact: false })
      }
    }
    const rawFirst = prefix[0]!
    for (const e of this.exact.get(rawFirst) ?? NO_ENTRIES) {
      if (kind && e.kind !== kind) {
        continue
      }
      if (e.key.length > prefix.length && e.key.startsWith(prefix)) {
        rawHits.push({ entry: e, exact: true })
      }
    }
    rawHits.sort((a, b) => {
      if (kind) {
        const ak = a.entry.kind === kind ? 0 : 1
        const bk = b.entry.kind === kind ? 0 : 1
        if (ak !== bk) {
          return ak - bk
        }
      }
      if (a.exact !== b.exact) {
        return a.exact ? -1 : 1
      }
      const al = a.entry.key.length
      const bl = b.entry.key.length
      if (al !== bl) {
        return al - bl
      }
      return 0
    })
    const seen = new Set<string>()
    const out: AliasCompletion[] = []
    for (const hit of rawHits) {
      const key = `${hit.entry.kind}|${hit.entry.unit.id}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      out.push({
        alias: hit.exact ? hit.entry.key : hit.entry.key,
        kind: hit.entry.kind,
        unit: hit.entry.unit,
        exact: hit.exact,
      })
      if (out.length >= limit) {
        break
      }
    }
    return out
  }

  /**
   * Attach a fuzzy vocabulary to a kind (first vocab = default profile).
   * Throws if the kind or the vocab's `unit` isn't registered.
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.defineFuzzyVocab('mass', {
   *   profile: 'parcels', unit: 'kg',
   *   terms: { light: [0, 5], heavy: [20, 70] },
   * })
   * ```
   */
  defineFuzzyVocab(kind: Kind, vocab: FuzzyVocab): void {
    if (!this.kindDefs.has(kind)) {
      throw new Error(`lingo: unknown kind "${kind}"`)
    }
    if (!this.unit(kind, vocab.unit)) {
      throw new Error(`lingo: fuzzy vocab unit "${vocab.unit}" not in kind "${kind}"`)
    }
    vocab = structuredClone(vocab)
    const list = this.fuzzy.get(kind) ?? []
    list.push(vocab)
    this.fuzzy.set(kind, list)
  }

  /**
   * Registered fuzzy vocabularies, optionally filtered to one kind.
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.fuzzyVocabs('temperature').map((v) => v.vocab.profile)
   * // ['weather', 'water', 'oven']
   * ```
   */
  fuzzyVocabs(kind?: Kind): Array<{ kind: Kind; vocab: FuzzyVocab }> {
    const out: Array<{ kind: Kind; vocab: FuzzyVocab }> = []
    for (const [k, vocabs] of this.fuzzy) {
      if (kind && k !== kind) {
        continue
      }
      for (const vocab of vocabs) {
        out.push({ kind: k, vocab })
      }
    }
    return out
  }

  /**
   * Did-you-mean unit suggestions for an unknown token, ranked by edit
   * distance. Empty for tokens too short to guess safely (see `typoBudget`).
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.suggestUnits('meterz', 'length') // ['m']
   * ```
   */
  suggestUnits(token: string, kind?: Kind, limit = 3): string[] {
    return this.suggestUnitsDetailed(token, kind, limit).map((s) => s.symbol)
  }

  /**
   * Like `suggestUnits`, with distance and unit identity attached (what
   * `formatIssue`/UNKNOWN_UNIT rendering is built from).
   * @example
   * ```ts
   * import { defaultRegistry } from '@pascal-app/lingo'
   * defaultRegistry.suggestUnitsDetailed('meterz', 'length')
   * // [{ symbol: 'm', distance: 1, kind: 'length', unitId: 'm' }]
   * ```
   */
  suggestUnitsDetailed(
    token: string,
    kind?: Kind,
    limit = 3,
  ): Array<{ symbol: string; distance: number; kind: Kind; unitId: string }> {
    const budget = typoBudget(token)
    if (budget === 0) {
      return []
    }
    const needle = token.toLowerCase()
    const mask = charMask(needle)
    const pick = (
      onlyKind?: Kind,
    ): Array<{ symbol: string; distance: number; kind: Kind; unitId: string }> => {
      const rows: [number[], number[], number[]] = [[], [], []]
      const hits: Array<{ entry: AliasEntry; distance: number; rank: number }> = []
      let rank = 0
      for (let len = needle.length - budget; len <= needle.length + budget; len++) {
        for (const e of this.suggestAll[len] ?? NO_ENTRIES) {
          if (onlyKind && e.kind !== onlyKind) {
            continue
          }
          if (needle.length > budget && e.key.length > budget && (mask & e.mask) === 0) {
            rank++
            continue
          }
          const distance = editDistanceWithRows(needle, e.key, budget, rows)
          if (distance <= budget) {
            hits.push({ entry: e, distance, rank })
          }
          rank++
        }
      }
      hits.sort(
        (x, y) =>
          x.distance - y.distance || x.entry.key.length - y.entry.key.length || x.rank - y.rank,
      )
      const out: Array<{ symbol: string; distance: number; kind: Kind; unitId: string }> = []
      const seen = new Set<string>()
      for (const hit of hits.slice(0, limit * 4)) {
        const owner = hit.entry
        const id = `${owner.kind}|${owner.unit.id}`
        if (seen.has(id)) {
          continue
        }
        seen.add(id)
        out.push({
          symbol: owner.unit.symbol,
          distance: hit.distance,
          kind: owner.kind,
          unitId: owner.unit.id,
        })
        if (out.length >= limit) {
          break
        }
      }
      return out
    }
    if (this.suggestDirty) {
      this.rebuildSuggestions()
    }
    if (kind) {
      const inKind = pick(kind)
      if (inKind.length > 0) {
        return inKind
      }
    }
    return pick()
  }

  private rebuildSuggestions(): void {
    this.suggestAll = []
    for (const e of this.ciEntries()) {
      const len = e.key.length
      let bucket = this.suggestAll[len]
      if (!bucket) {
        this.suggestAll[len] = bucket = []
      }
      bucket.push(e)
    }
    this.suggestDirty = false
  }

  /** Only the ci pool: exact-pool aliases deliberately never enter the suggestion index. */
  private *ciEntries(): Iterable<AliasEntry> {
    for (const bucket of this.ci.values()) {
      for (const e of bucket) {
        yield e
      }
    }
  }
}

/**
 * Match `key` against `haystack` at `pos`. A single space in the key consumes
 * one-or-more spaces in the text. Returns consumed length or -1.
 */
function matchKey(key: string, haystack: string, pos: number): number {
  let i = pos
  for (let k = 0; k < key.length; k++) {
    const kc = key[k]!
    if (kc === ' ') {
      if (haystack[i] !== ' ') {
        return -1
      }
      while (haystack[i] === ' ') {
        i++
      }
    } else {
      if (haystack[i] !== kc) {
        return -1
      }
      i++
    }
  }
  return i - pos
}

/**
 * Create a registry from kind definitions (defensive copy of unit arrays).
 * Use `allKinds` for the full built-in set, or a subset for a smaller build;
 * pass the result as `{ registry }` to any parse call, or wrap it in
 * `createLingo({ registry })` for an isolated instance.
 * @example
 * ```ts
 * import { createRegistry } from '@pascal-app/lingo/core'
 * const reg = createRegistry([{
 *   kind: 'length', baseUnit: 'm',
 *   units: [{ id: 'm', symbol: 'm', name: 'meter', factor: 1, system: 'metric' }],
 * }])
 * ```
 */
export function createRegistry(kinds: readonly KindDef[]): Registry {
  return new Registry(kinds)
}

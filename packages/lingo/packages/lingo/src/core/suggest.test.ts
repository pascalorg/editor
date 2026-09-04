import { describe, expect, it } from 'vitest'
import { allKinds } from '../units/index'
import { createRegistry } from './registry'
import { typoBudget } from './suggest'
import type { Kind, KindDef, UnitDef } from './types'

interface RefAlias {
  key: string
  kind: Kind
  unit: UnitDef
}

interface RefSuggestion {
  distance: number
  kind: Kind
  symbol: string
  unitId: string
}

function insertAlias(buckets: Map<string, RefAlias[]>, entry: RefAlias): void {
  if (entry.key.length === 0) {
    return
  }
  const bucketKey = entry.key[0]!
  let bucket = buckets.get(bucketKey)
  if (!bucket) {
    buckets.set(bucketKey, (bucket = []))
  }
  const duplicate = bucket.find((e) => e.key === entry.key && e.kind === entry.kind)
  if (duplicate) {
    if (duplicate.unit.id === entry.unit.id) {
      return
    }
    throw new Error(`duplicate alias ${entry.kind}:${entry.key}`)
  }
  bucket.push(entry)
  bucket.sort((a, b) => b.key.length - a.key.length)
}

function aliasEntries(kinds: readonly KindDef[]): RefAlias[] {
  const buckets = new Map<string, RefAlias[]>()
  for (const kindDef of kinds) {
    for (const unit of kindDef.units) {
      const exactLower = new Set((unit.caseExact ?? []).map((s) => s.toLowerCase()))
      const keys = new Set<string>()
      for (const raw of [
        unit.id,
        unit.symbol,
        unit.name,
        unit.plural ?? `${unit.name}s`,
        ...(unit.aliases ?? []),
      ]) {
        const key = raw.toLowerCase()
        if (!exactLower.has(key)) {
          keys.add(key)
        }
      }
      for (const key of keys) {
        insertAlias(buckets, { key, kind: kindDef.kind, unit })
      }
    }
  }
  return [...buckets.values()].flat()
}

// Independent Damerau–Levenshtein oracle. Bounded by `max` so results stay
// exact for every distance the caller keeps (<= budget) while cutting the
// O(probes × aliases) sweep ~7x — mirrors the production cutoff in
// editDistanceWithRows without sharing its code, keeping the cross-check honest.
function referenceDistance(a: string, b: string, max: number): number {
  if (a === b) {
    return 0
  }
  if (Math.abs(a.length - b.length) > max) {
    return max + 1
  }
  if (a.length === 0) {
    return b.length
  }
  if (b.length === 0) {
    return a.length
  }

  let prevPrev: number[] = []
  let prev: number[] = []
  let curr: number[] = []
  for (let j = 0; j <= b.length; j++) {
    prev[j] = j
  }

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    let rowMin = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      let d = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
      if (
        i > 1 &&
        j > 1 &&
        ca === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        d = Math.min(d, prevPrev[j - 2]! + 1)
      }
      curr[j] = d
      if (d < rowMin) {
        rowMin = d
      }
    }
    if (rowMin > max) {
      return max + 1
    }
    const swap = prevPrev
    prevPrev = prev
    prev = curr
    curr = swap
  }
  const result = prev[b.length]!
  return result > max ? max + 1 : result
}

function referenceSuggest(
  token: string,
  aliases: RefAlias[],
  byKind: Map<Kind, RefAlias[]>,
  kind?: Kind,
  limit = 3,
): RefSuggestion[] {
  const budget = typoBudget(token)
  if (budget === 0) {
    return []
  }
  const needle = token.toLowerCase()
  const pick = (pool: RefAlias[]): RefSuggestion[] => {
    const hits: Array<{ entry: RefAlias; distance: number; rank: number }> = []
    for (let rank = 0; rank < pool.length; rank++) {
      const entry = pool[rank]!
      const distance = referenceDistance(needle, entry.key, budget)
      if (distance <= budget) {
        hits.push({ entry, distance, rank })
      }
    }
    hits.sort(
      (a, b) =>
        a.distance - b.distance || a.entry.key.length - b.entry.key.length || a.rank - b.rank,
    )
    const out: RefSuggestion[] = []
    const seen = new Set<string>()
    for (const hit of hits.slice(0, limit * 4)) {
      const id = `${hit.entry.kind}|${hit.entry.unit.id}`
      if (seen.has(id)) {
        continue
      }
      seen.add(id)
      out.push({
        symbol: hit.entry.unit.symbol,
        distance: hit.distance,
        kind: hit.entry.kind,
        unitId: hit.entry.unit.id,
      })
      if (out.length >= limit) {
        break
      }
    }
    return out
  }
  if (kind) {
    const inKind = pick(byKind.get(kind) ?? [])
    if (inKind.length > 0) {
      return inKind
    }
  }
  return pick(aliases)
}

function replacementFor(ch: string): string {
  if (ch !== 'x') {
    return 'x'
  }
  return 'q'
}

function mutations(alias: string): string[] {
  const out = new Set<string>()
  const first = alias[0] ?? 'x'
  const replacement = replacementFor(first)
  if (alias.length > 0) {
    out.add(alias.slice(0, -1))
    out.add(`${alias}${replacement}`)
    out.add(`${replacement}${alias.slice(1)}`)
  }
  if (alias.length > 1) {
    out.add(`${alias[1]!}${alias[0]!}${alias.slice(2)}`)
    out.add(`${alias[1]!}${alias[0]!}${alias.slice(2)}${replacement}`)
  }
  if (alias.length > 2) {
    out.add(`${replacement}${alias.slice(1, -1)}`)
  }
  out.delete(alias)
  return [...out]
}

function junkProbes(): string[] {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'
  let seed = 1718
  const out = new Set(['blorks', 'qqqqq', 'madeupunit', 'zzzzzzzz', 'not-a-real-unit'])
  for (let i = 0; i < 64; i++) {
    const len = 3 + (seed % 11)
    let text = ''
    for (let j = 0; j < len; j++) {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
      text += alphabet[seed % alphabet.length]!
    }
    out.add(text)
  }
  return [...out]
}

describe('unit suggestions', () => {
  it('matches an unpruned reference across generated alias probes', () => {
    const registry = createRegistry(allKinds)
    const aliases = aliasEntries(allKinds)
    const byKind = new Map<Kind, RefAlias[]>()
    for (const entry of aliases) {
      const list = byKind.get(entry.kind) ?? []
      list.push(entry)
      byKind.set(entry.kind, list)
    }

    const globalProbes = new Set<string>(junkProbes())
    const kindCases: Array<{ probe: string; kind: Kind }> = []
    for (const entry of aliases) {
      for (const probe of mutations(entry.key)) {
        globalProbes.add(probe)
        kindCases.push({ probe, kind: entry.kind })
      }
    }

    let comparedPairs = 0
    for (const probe of globalProbes) {
      expect(registry.suggestUnitsDetailed(probe)).toEqual(referenceSuggest(probe, aliases, byKind))
      comparedPairs += aliases.length
    }
    for (const { probe, kind } of kindCases) {
      expect(registry.suggestUnitsDetailed(probe, kind)).toEqual(
        referenceSuggest(probe, aliases, byKind, kind),
      )
    }

    expect(aliases.length).toBeGreaterThan(300)
    expect(globalProbes.size).toBeGreaterThan(1000)
    expect(kindCases.length).toBeGreaterThan(1000)
    expect(comparedPairs).toBe(aliases.length * globalProbes.size)
  })
})

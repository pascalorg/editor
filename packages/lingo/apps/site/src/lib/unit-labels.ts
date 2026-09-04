import type { Kind, KindDef, UnitDef } from '@pascal-app/lingo'
import { allKinds } from '@pascal-app/lingo'

const UNITS_BY_KIND = new Map<Kind, Map<string, UnitDef>>(
  allKinds.map((kind) => [kind.kind, new Map(kind.units.map((unit) => [unit.id, unit]))]),
)

export function unitSymbol(kind: Kind, unitRef: string): string {
  return UNITS_BY_KIND.get(kind)?.get(unitRef)?.symbol ?? unitRef
}

export function baseUnitSymbol(kind: KindDef): string {
  return unitSymbol(kind.kind, kind.baseUnit)
}

export function unitSamples(kind: KindDef, count = 4): string[] {
  const seen = new Set<string>()
  const samples: string[] = []

  for (const unit of kind.units) {
    for (const sample of [unit.symbol, ...(unit.aliases ?? [])]) {
      if (seen.has(sample)) {
        continue
      }
      seen.add(sample)
      samples.push(sample)
      if (samples.length >= count) {
        return samples
      }
    }
  }

  return samples
}

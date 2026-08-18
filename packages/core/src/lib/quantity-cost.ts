import type { UnitPrice, UnitPriceMap } from '../schema/unit-prices'
import { unitPriceKey } from '../schema/unit-prices'
import type { QuantityLine, QuantityTakeoff } from './quantity-takeoff'

/**
 * A takeoff with unit prices applied — the pure arithmetic between a line's
 * quantity and its price. No formatting or currency symbols here; those are the
 * display layer's job. `cost` is `unitPrice.amount * value`, and `totals` rolls
 * it up per currency so a mixed-currency sheet can still be summed honestly.
 */

export type PricedQuantityLine = QuantityLine & {
  unitPrice?: UnitPrice
  /** `unitPrice.amount * value`. Absent when the line is unpriced. */
  cost?: number
}

export type CurrencyTotal = { currency: string; cost: number }

export type PricedQuantityTakeoff = Omit<QuantityTakeoff, 'sections'> & {
  sections: (Omit<QuantityTakeoff['sections'][number], 'lines'> & {
    lines: PricedQuantityLine[]
  })[]
  /** Totals per currency, sorted by currency code for a stable order. */
  totals: CurrencyTotal[]
}

/**
 * Attach a unit price to each line it matches and roll the totals up.
 *
 * Pure: the input takeoff and price map are read, never mutated. A line whose
 * key is absent from `prices` passes through untouched with no `cost`.
 */
export function priceQuantityTakeoff(
  takeoff: QuantityTakeoff,
  prices: UnitPriceMap,
): PricedQuantityTakeoff {
  const totals = new Map<string, number>()

  const sections = takeoff.sections.map((section) => {
    const lines = section.lines.map((line) => {
      const unitPrice = prices[unitPriceKey(section.kind, line.key, line.group)]
      if (!unitPrice) return line
      const cost = unitPrice.amount * line.value
      totals.set(unitPrice.currency, (totals.get(unitPrice.currency) ?? 0) + cost)
      return { ...line, unitPrice, cost }
    })
    return { ...section, lines }
  })

  return {
    ...takeoff,
    sections,
    totals: [...totals.entries()]
      .map(([currency, cost]) => ({ currency, cost }))
      .sort((left, right) => left.currency.localeCompare(right.currency)),
  }
}

import { describe, expect, test } from 'bun:test'
import { type UnitPriceMap, unitPriceKey } from '../schema/unit-prices'
import { priceQuantityTakeoff } from './quantity-cost'
import type { QuantityTakeoff } from './quantity-takeoff'

const takeoff: QuantityTakeoff = {
  nodeCount: 3,
  sections: [
    {
      kind: 'wall',
      label: 'Walls',
      lines: [
        { key: 'length', label: 'Length', unit: 'length', value: 10, nodeCount: 2 },
        {
          key: 'area',
          label: 'Face area',
          unit: 'area',
          value: 26,
          nodeCount: 2,
          group: 'Brick',
        },
      ],
    },
    {
      kind: 'door',
      label: 'Doors',
      lines: [{ key: 'count', label: 'Count', unit: 'count', value: 3, nodeCount: 3 }],
    },
  ],
}

describe('priceQuantityTakeoff', () => {
  test('attaches a price to the line its key matches and computes the cost', () => {
    const prices: UnitPriceMap = {
      [unitPriceKey('wall', 'length')]: { amount: 50, currency: 'TRY' },
    }
    const priced = priceQuantityTakeoff(takeoff, prices)

    const line = priced.sections[0]!.lines[0]!
    expect(line.unitPrice).toEqual({ amount: 50, currency: 'TRY' })
    expect(line.cost).toBe(500)
  })

  test('a grouped line keys on its group, so two materials price independently', () => {
    const prices: UnitPriceMap = {
      [unitPriceKey('wall', 'area', 'Brick')]: { amount: 12, currency: 'TRY' },
    }
    const priced = priceQuantityTakeoff(takeoff, prices)

    expect(priced.sections[0]!.lines[1]!.cost).toBe(12 * 26)
    expect(priced.sections[0]!.lines[0]!.unitPrice).toBeUndefined()
  })

  test('an unpriced line passes through untouched with no cost', () => {
    const priced = priceQuantityTakeoff(takeoff, {})
    expect(priced.sections[0]!.lines[0]!.cost).toBeUndefined()
    expect(priced.sections[0]!.lines[0]!.unitPrice).toBeUndefined()
  })

  test('totals roll up per currency and sort by currency code', () => {
    const prices: UnitPriceMap = {
      [unitPriceKey('wall', 'length')]: { amount: 10, currency: 'USD' },
      [unitPriceKey('door', 'count')]: { amount: 5, currency: 'TRY' },
    }
    const priced = priceQuantityTakeoff(takeoff, prices)

    expect(priced.totals).toEqual([
      { currency: 'TRY', cost: 15 },
      { currency: 'USD', cost: 100 },
    ])
  })

  test('an empty price map yields no totals', () => {
    expect(priceQuantityTakeoff(takeoff, {}).totals).toEqual([])
  })
})

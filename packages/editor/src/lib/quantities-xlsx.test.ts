import { describe, expect, test } from 'bun:test'
import type { PricedQuantityTakeoff } from '@pascal-app/core'
import { strFromU8, unzipSync } from 'fflate'
import { buildQuantityTakeoffXlsx } from './quantities-xlsx'

const takeoff: PricedQuantityTakeoff = {
  nodeCount: 3,
  sections: [
    {
      kind: 'wall',
      label: 'Walls',
      lines: [
        {
          key: 'length',
          label: 'Length',
          unit: 'length',
          value: 10,
          nodeCount: 2,
          unitPrice: { amount: 50, currency: 'TRY' },
          cost: 500,
        },
      ],
    },
  ],
  totals: [{ currency: 'TRY', cost: 500 }],
}

describe('buildQuantityTakeoffXlsx', () => {
  test('produces a zip archive', () => {
    const bytes = buildQuantityTakeoffXlsx(takeoff)
    // A zip always opens with the 'PK' signature.
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
  })

  test('writes a Summary sheet and one sheet per category', () => {
    const files = unzipSync(buildQuantityTakeoffXlsx(takeoff))

    const workbook = strFromU8(files['xl/workbook.xml'] as Uint8Array)
    expect(workbook).toContain('Summary')
    expect(workbook).toContain('Walls')

    const summary = strFromU8(files['xl/worksheets/sheet1.xml'] as Uint8Array)
    expect(summary).toContain('Total Cost')
    expect(summary).toContain('TRY')

    const walls = strFromU8(files['xl/worksheets/sheet2.xml'] as Uint8Array)
    expect(walls).toContain('Length')
    expect(walls).toContain('Unit Price')
  })

  test('escapes a label so it cannot break the sheet XML', () => {
    const malicious: PricedQuantityTakeoff = {
      nodeCount: 1,
      sections: [
        {
          kind: 'wall',
          label: 'Walls & <Flashing>',
          lines: [{ key: 'length', label: 'A & B', unit: 'length', value: 1, nodeCount: 1 }],
        },
      ],
      totals: [],
    }
    const files = unzipSync(buildQuantityTakeoffXlsx(malicious))
    const walls = strFromU8(files['xl/worksheets/sheet2.xml'] as Uint8Array)
    expect(walls).toContain('A &amp; B')
    expect(walls).not.toContain('A & B<')
  })
})

import { describe, expect, test } from 'bun:test'
import { linearFeet, METRES_PER_FOOT, metresToFeet, totalsBySystem } from '../geometry/totals'
import { UtilityLineNode } from '../schema'

const line = (patch: Partial<Record<string, unknown>>) =>
  UtilityLineNode.parse({ ...patch })

describe('linear-feet totals', () => {
  test('a foot is exactly 0.3048 m', () => {
    expect(METRES_PER_FOOT).toBe(0.3048)
    expect(metresToFeet(0.3048)).toBeCloseTo(1, 12)
  })

  test('sums runs of the same system and keeps the OH / UG split', () => {
    const totals = totalsBySystem([
      line({
        system: 'power',
        routing: 'underground',
        path: [
          [0, -0.75, 0],
          [30.48, -0.75, 0],
        ],
      }),
      line({
        system: 'power',
        routing: 'overhead',
        sagRatio: 0,
        path: [
          [0, 6, 0],
          [0, 6, 15.24],
        ],
      }),
    ])
    expect(totals).toHaveLength(1)
    const power = totals[0]!
    expect(power.count).toBe(2)
    expect(Math.round(power.feet)).toBe(150)
    expect(Math.round(metresToFeet(power.undergroundMetres))).toBe(100)
    expect(Math.round(metresToFeet(power.overheadMetres))).toBe(50)
  })

  test('systems are ordered longest first, and empty systems are omitted', () => {
    const totals = totalsBySystem([
      line({ system: 'water', path: [[0, -1, 0], [5, -1, 0]] }),
      line({ system: 'sewer', path: [[0, -1, 0], [20, -1, 0]] }),
      line({ system: 'gas', path: [] }),
    ])
    expect(totals.map((t) => t.system)).toEqual(['sewer', 'water'])
  })

  test('an overhead run bills more wire than its chord', () => {
    const path: [number, number, number][] = [
      [0, 8, 0],
      [30, 8, 0],
    ]
    const buried = linearFeet([line({ system: 'power', routing: 'underground', path })])
    const strung = linearFeet([
      line({ system: 'power', routing: 'overhead', sagRatio: 0.015, path }),
    ])
    expect(strung).toBeGreaterThanOrEqual(buried)
  })

  test('linearFeet can be filtered to one routing', () => {
    const lines = [
      line({ system: 'power', routing: 'underground', path: [[0, -1, 0], [30.48, -1, 0]] }),
      line({ system: 'comm', routing: 'overhead', sagRatio: 0, path: [[0, 5, 0], [30.48, 5, 0]] }),
    ]
    expect(linearFeet(lines, 'underground')).toBe(100)
    expect(linearFeet(lines, 'overhead')).toBe(100)
    expect(linearFeet(lines)).toBe(200)
  })

  test('a run with fewer than two vertices contributes nothing', () => {
    expect(totalsBySystem([line({ path: [[0, 0, 0]] })])).toEqual([])
  })
})

import { describe, expect, test } from 'bun:test'
import fixture from './__fixtures__/plancrafters-cottage.json'
import type { ScheduleNodes } from './schedule'
import { buildSchedule } from './schedule'
import { enrichOpeningSchedule } from './schedule-openings'

const nodes = (fixture as { graph: { nodes: ScheduleNodes } }).graph.nodes
const levelId = Object.values(nodes).find((n) => n?.type === 'level')!.id

describe('door / window schedule enrichment', () => {
  test('windows get QTY, EGRESS, TEMPERED and STATUS columns and collapse duplicates', () => {
    const base = buildSchedule(nodes, levelId, 'windows')
    const table = enrichOpeningSchedule(base, nodes, levelId, 'windows')
    const keys = table.columns.map((c) => c.key)
    expect(keys).toContain('qty')
    expect(keys).toContain('egress')
    expect(keys).toContain('tempered')
    expect(keys).toContain('status')
    // 10 windows, several identical → fewer rows than openings, QTYs sum to 10.
    expect(table.rows.length).toBeLessThan(base.rows.length)
    const qty = table.rows.reduce((sum, row) => sum + Number(row.qty), 0)
    expect(qty).toBe(base.rows.length)
    expect(table.rows.every((row) => row.status === 'NEW')).toBe(true)
    // Bedroom windows are flagged as egress openings (R310) — the cottage has
    // three bedrooms with a window each.
    const egress = table.rows.filter((row) => row.egress?.startsWith("REQ'D"))
    expect(egress.length).toBeGreaterThan(0)
  })

  test('doors get QTY and STATUS; no egress column', () => {
    const base = buildSchedule(nodes, levelId, 'doors')
    const table = enrichOpeningSchedule(base, nodes, levelId, 'doors')
    const keys = table.columns.map((c) => c.key)
    expect(keys).toContain('qty')
    expect(keys).not.toContain('egress')
    const qty = table.rows.reduce((sum, row) => sum + Number(row.qty), 0)
    expect(qty).toBe(base.rows.length)
  })
})

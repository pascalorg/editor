import { describe, expect, test } from 'bun:test'
import { missingSheets, planDefaultSet } from './generate'
import type { NodeMap } from './model'
import { SheetNode } from './schema'
import { sheetFrame } from './titleblock'

/** The drawable frame of an ARCH D sheet — the box every viewport must fit. */
const FRAME = sheetFrame(36, 24)

function scene(levelCount = 1): NodeMap {
  const nodes: NodeMap = {
    site_1: {
      id: 'site_1',
      type: 'site',
      polygon: {
        type: 'polygon',
        points: [
          [-5, -8],
          [15, -8],
          [15, 16],
          [-5, 16],
        ],
      },
    },
  }
  for (let i = 0; i < levelCount; i++) {
    nodes[`level_${i}`] = { id: `level_${i}`, type: 'level', level: i, children: [] }
  }
  nodes.wall_n = { id: 'wall_n', type: 'wall', parentId: 'level_0', start: [0, 0], end: [10, 0] }
  nodes.wall_s = { id: 'wall_s', type: 'wall', parentId: 'level_0', start: [10, 8], end: [0, 8] }
  return nodes
}

/** Materialise a planned set into the node map, the way the generator does. */
function withSheets(nodes: NodeMap): NodeMap {
  const out = { ...nodes }
  planDefaultSet(nodes).forEach((plan, i) => {
    const sheet = SheetNode.parse({ number: plan.number, title: plan.title, order: i })
    out[sheet.id] = sheet as unknown as NodeMap[string]
  })
  return out
}

describe('the default set', () => {
  test('covers the standard sheets', () => {
    const numbers = planDefaultSet(scene()).map((p) => p.number)
    // The plan-set modules (structural, MEP, notes, energy) add their own
    // sheets by number; the architectural core is always present, in order.
    const core = ['A0.0', 'A1.0', 'A2.0', 'A3.0', 'A4.0', 'A5.0', 'A8.0']
    expect(core.filter((n) => numbers.includes(n))).toEqual(core)
    expect(numbers.filter((n) => core.includes(n))).toEqual(core)
    expect(numbers.some((n) => /^S1/.test(n))).toBe(true)
    expect(numbers.some((n) => /^E1/.test(n))).toBe(true)
    // Architectural first, then structural, then the trades.
    const rank = (n: string) => (/^A/.test(n) ? 0 : /^S/.test(n) ? 1 : 2)
    expect([...numbers].map(rank)).toEqual([...numbers].map(rank).sort((a, b) => a - b))
  })

  test('A1.0 is the site plan with the fire separation table beside it', () => {
    const a1 = planDefaultSet(scene()).find((p) => p.number === 'A1.0')!
    expect(a1.viewports.map((v) => v.kind)).toEqual(['site-plan', 'general-notes'])
    const site = a1.viewports[0] as { x: number; w: number }
    const fire = a1.viewports[1] as { x: number; w: number; notesKey?: string; levelId?: string }
    expect(fire.notesKey).toBe('fire-separation')
    expect(fire.levelId).toBeDefined()
    // the plan keeps two thirds of the field, the table the rest, nothing overlapping
    expect(site.x + site.w).toBeLessThanOrEqual(fire.x)
    expect(fire.x + fire.w).toBeLessThanOrEqual(FRAME.x + FRAME.w + 1e-6)
  })

  test('one floor-plan sheet per level', () => {
    const numbers = planDefaultSet(scene(3)).map((p) => p.number)
    expect(numbers.filter((n) => /^A2\./.test(n))).toEqual(['A2.0', 'A2.1', 'A2.2'])
    expect(numbers.indexOf('A2.2')).toBeLessThan(numbers.indexOf('A3.0'))
  })

  test('the cover asks for the standard pose, never the current camera', () => {
    const cover = planDefaultSet(scene()).find((p) => p.number === 'A0.0')!
    const view = cover.viewports.find((v) => v.kind === 'view3d')!
    expect(view.pose).toBe('cover-front')
  })

  test('A4.0–A4.3 carry one elevation each, north east south west, the whole frame', () => {
    const plans = planDefaultSet(scene())
    const sheets = ['A4.0', 'A4.1', 'A4.2', 'A4.3'].map((n) => plans.find((p) => p.number === n)!)
    expect(sheets.map((s) => s.viewports.map((v) => v.direction))).toEqual([['north'], ['east'], ['south'], ['west']])
    for (const sheet of sheets) {
      const vp = sheet.viewports[0]!
      expect(vp.kind).toBe('elevation')
      expect(vp.w).toBeCloseTo(FRAME.w, 6)
      expect(vp.x).toBeCloseTo(FRAME.x, 6)
    }
    expect(sheets.map((s) => s.title)).toEqual(['North elevation', 'East elevation', 'South elevation', 'West elevation'])
  })

  test('A5.0 plans the two default cuts when there are no markers', () => {
    // The scene has walls, so the sheet gets the longitudinal and transverse
    // default cuts rather than one empty placeholder.
    const sections = planDefaultSet(scene()).find((p) => p.number === 'A5.0')!
    // two cuts down the left, the assembly schedule down the right
    expect(sections.viewports).toHaveLength(3)
    expect(sections.viewports.map((v) => v.kind)).toEqual(['section', 'section', 'general-notes'])
    expect(sections.viewports.slice(0, 2).map((v) => v.title)).toEqual(['Section A', 'Section B'])
    expect(sections.viewports[2]).toMatchObject({ notesKey: 'assemblies' })
    // The markers themselves are created by `ensureSectionMarkers` at generate
    // time; planning alone leaves the ids unbound.
    expect(sections.viewports[0]?.markerId).toBeUndefined()
  })

  test('A5.0 falls back to one unassigned viewport when there is nothing to cut', () => {
    const empty: NodeMap = { site_1: { id: 'site_1', type: 'site' } }
    const sections = planDefaultSet(empty).find((p) => p.number === 'A5.0')!
    expect(sections.viewports).toHaveLength(1)
    expect(sections.viewports[0]?.kind).toBe('section')
    expect(sections.viewports[0]?.markerId).toBeUndefined()
  })

  test('a section marker in the scene becomes a section viewport', () => {
    const nodes = scene()
    nodes.marker_1 = { id: 'marker_1', type: 'sections:section-marker', name: 'Section A' }
    const sections = planDefaultSet(nodes).find((p) => p.number === 'A5.0')!
    expect(sections.viewports[0]).toMatchObject({ kind: 'section', markerId: 'marker_1' })
  })

  test('A8.0 has a door and a window schedule per level', () => {
    const schedules = planDefaultSet(scene(2)).find((p) => p.number === 'A8.0')!
    expect(schedules.viewports.map((v) => v.scheduleOf)).toEqual([
      'doors',
      'windows',
      'doors',
      'windows',
    ])
  })

  test('every viewport sits inside the paper', () => {
    for (const plan of planDefaultSet(scene(2))) {
      for (const vp of plan.viewports) {
        expect(vp.x!).toBeGreaterThanOrEqual(0.5)
        expect(vp.y!).toBeGreaterThanOrEqual(0.5)
        expect(vp.x! + vp.w!).toBeLessThanOrEqual(FRAME.x + FRAME.w + 1e-6)
        expect(vp.y! + vp.h!).toBeLessThanOrEqual(FRAME.y + FRAME.h + 1e-6)
      }
    }
  })
})

describe('idempotency', () => {
  test('a second run creates nothing and keeps everything', () => {
    const nodes = scene(2)
    const total = planDefaultSet(nodes).length
    const first = missingSheets(nodes)
    expect(first.create.map((p) => p.number)).toHaveLength(total)
    expect(first.keep).toEqual([])

    const populated = withSheets(nodes)
    const second = missingSheets(populated)
    expect(second.create).toEqual([])
    expect(second.keep).toHaveLength(total)
  })

  test('adding a level only adds that level`s sheet', () => {
    const populated = withSheets(scene(1))
    populated.level_1 = { id: 'level_1', type: 'level', level: 1, children: [] }
    const next = missingSheets(populated)
    expect(next.create.map((p) => p.number)).toEqual(['A2.1'])
  })

  test('a hand-made sheet with a default number is never touched', () => {
    const nodes = scene()
    const mine = SheetNode.parse({ number: 'A1.0', title: 'My own site plan' })
    nodes[mine.id] = mine as unknown as NodeMap[string]
    const result = missingSheets(nodes)
    expect(result.keep).toContain('A1.0')
    expect(result.create.map((p) => p.number)).not.toContain('A1.0')
  })
})

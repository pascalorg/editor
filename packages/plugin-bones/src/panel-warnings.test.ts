import { describe, expect, test } from 'bun:test'
import type { Member } from './core/types'
import { groupWarnings, warningCount } from './panel-warnings'
import { buildPlanSet } from './plans/plan-set'

/**
 * Day-9 declutter gates — the sidebar folds repeated-class warnings into
 * group rows, but grouping is PRESENTATION ONLY: every warning survives
 * verbatim inside its group, the input array is never touched, and the
 * plan-set Flags block (paper) stays byte-equal. The fixture mirrors the
 * user's day-9 paste: 10 braced-wall-line warnings + 7 assorted singles.
 */

const BRACED_MESSAGE =
  'CS-WSP continuous sheathing assumed — R602.10 panel length/spacing not verified'

const bracedWarnings = [
  `braced wall line X1 (3 walls, 12.4m): ${BRACED_MESSAGE}`,
  `braced wall line X2 (1 wall, 8.0m): ${BRACED_MESSAGE}`,
  `braced wall line X3 (2 walls, 9.6m): ${BRACED_MESSAGE}`,
  `braced wall line X4 (1 wall, 4.2m): ${BRACED_MESSAGE}`,
  `braced wall line X5 (2 walls, 11.1m): ${BRACED_MESSAGE}`,
  `braced wall line Z1 (3 walls, 10.9m): ${BRACED_MESSAGE}`,
  `braced wall line Z2 (1 wall, 6.4m): ${BRACED_MESSAGE}`,
  `braced wall line Z3 (2 walls, 7.7m): ${BRACED_MESSAGE}`,
  `braced wall line Z4 (1 wall, 5.5m): ${BRACED_MESSAGE}`,
  `braced wall line Z5 (2 walls, 12.0m): ${BRACED_MESSAGE}`,
]

const singleWarnings = [
  'Ground floor is slab-on-grade — the Foundation system draws the slab field, vapor retarder and footings',
  'roof intersection not framed — valley detail required (gable roof_1 x gable roof_2: only perpendicular valleys are modeled)',
  'kitchen "Kitchen" has no counter run — counter receptacles (NEC 210.52(C)) not placed; verify casework',
  'basin fixture unplaced — GFCI receptacle within 3 ft (NEC 210.52(D)) not derived; verify',
  'return grille placed on an interior wall — verify M1602.2 clearances',
  'return drop exceeds the joist bay — furr-down required, verify',
  'no exterior wall — condenser row placed at the anchor, verify',
]

const DAY9 = [...bracedWarnings, ...singleWarnings]

describe('groupWarnings — grouping truth', () => {
  test('10 braced-wall-line warnings fold into ONE group; the 7 singles stay plain', () => {
    const lines = groupWarnings(DAY9)
    const groups = lines.filter((l) => l.kind === 'group')
    const singles = lines.filter((l) => l.kind === 'single')
    expect(groups).toHaveLength(1)
    expect(singles).toHaveLength(7)
    expect(lines).toHaveLength(8)
  })

  test('the group row: label, count and the shared class message', () => {
    const group = groupWarnings(DAY9).find((l) => l.kind === 'group')
    if (group?.kind !== 'group') throw new Error('group expected')
    expect(group.label).toBe('braced wall lines')
    expect(group.warnings).toHaveLength(10)
    expect(group.message).toBe(BRACED_MESSAGE)
  })

  test('the title count equals every line shown when fully expanded (17)', () => {
    expect(warningCount(groupWarnings(DAY9))).toBe(17)
  })

  test('order: the group sits where its first member appeared; singles keep input order', () => {
    const mixed = [singleWarnings[0] as string, ...bracedWarnings, singleWarnings[1] as string]
    const lines = groupWarnings(mixed)
    expect(lines[0]).toEqual({ kind: 'single', text: singleWarnings[0] as string })
    expect(lines[1]?.kind).toBe('group')
    expect(lines[2]).toEqual({ kind: 'single', text: singleWarnings[1] as string })
  })
})

describe('groupWarnings — the honesty contract (verbatim, no drops)', () => {
  test('every braced warning survives VERBATIM inside the group, in input order', () => {
    const group = groupWarnings(DAY9).find((l) => l.kind === 'group')
    if (group?.kind !== 'group') throw new Error('group expected')
    expect(group.warnings).toEqual(bracedWarnings)
  })

  test('a lone colon-prefixed warning renders plain — groups of 1 never mint', () => {
    const lone = `braced wall line X1 (3 walls, 12.4m): ${BRACED_MESSAGE}`
    expect(groupWarnings([lone, ...singleWarnings])).toEqual([
      { kind: 'single', text: lone },
      ...singleWarnings.map((text) => ({ kind: 'single' as const, text })),
    ])
  })

  test('distinct colon-less warnings never cross-group (whole-text key)', () => {
    const lines = groupWarnings(singleWarnings)
    expect(lines.every((l) => l.kind === 'single')).toBe(true)
    expect(lines).toHaveLength(7)
  })

  test('identical duplicates dedupe first (the long-standing Set pass) — count follows', () => {
    const dup = singleWarnings[0] as string
    const lines = groupWarnings([dup, dup, dup])
    expect(lines).toEqual([{ kind: 'single', text: dup }])
    expect(warningCount(lines)).toBe(1)
  })

  test('unrelated prefixes sharing a class message still group — label falls back plural', () => {
    const lines = groupWarnings(['wall w1: same message here', 'door d9: same message here'])
    expect(lines).toEqual([
      {
        kind: 'group',
        label: 'warnings',
        message: 'same message here',
        warnings: ['wall w1: same message here', 'door d9: same message here'],
      },
    ])
  })
})

describe('grouping is PANEL-ONLY — result.warnings and paper untouched', () => {
  test('the input array is never mutated (frozen input, deep-equal after)', () => {
    const input = Object.freeze(DAY9.map((w) => w)) as readonly string[]
    const before = [...input]
    groupWarnings(input)
    expect([...input]).toEqual(before)
  })

  // the plan-set Flags block is composed from the SAME array the panel
  // groups — running the grouping must leave paper byte-equal (compose gate)
  const member = (over: Partial<Member>): Member => ({
    system: 'floor-framing',
    role: 'joist',
    size: '2x10',
    dims: [4, 0.235, 0.038],
    length: 4,
    position: [2, -0.3, 1],
    rotation: [0, 0, 0],
    material: 'lumber',
    sourceId: 'slab_1',
    ...over,
  })

  /** Rebuild readable text from a sheet: text contents in order, unescaped.
   * Flag lines wrap at word boundaries (~92 chars), so a long warning spans
   * consecutive <text> elements; joining with single spaces reconstructs it
   * exactly (the wrapper cuts AT a space and trims the remainder). */
  const textContent = (svg: string): string =>
    [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
      .map((m) => m[1] as string)
      .join(' ')
      .replaceAll('&quot;', '"')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&')

  test('plan-set Flags block byte-equal across a grouping pass; every warning prints verbatim', () => {
    const opts = { projectName: 'Day 9', levelName: 'Ground Floor', date: '2026-08-22' }
    const before = buildPlanSet([member({})], [], { ...opts, warnings: DAY9 })
    groupWarnings(DAY9)
    const after = buildPlanSet([member({})], [], { ...opts, warnings: DAY9 })
    expect(after.map((s) => s.svg).join('\n')).toBe(before.map((s) => s.svg).join('\n'))
    expect(after.map((s) => s.title)).toEqual(before.map((s) => s.title))
    // paper never groups: all 17 lines, verbatim, incl. every braced instance
    const flagsText = after
      .filter((s) => s.title.startsWith('Schedules') || s.title.startsWith('Flags'))
      .map((s) => textContent(s.svg))
      .join('\n')
    for (const warning of DAY9) expect(flagsText).toContain(warning)
  })
})

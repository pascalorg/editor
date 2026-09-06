import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { DEFAULT_SPEC, type FramingSpec } from '../core/spec'
import type { Member } from '../core/types'
import { LUMBER_CROSS_SECTIONS } from '../lumber'
import { frameRoofs, type RoofSegmentSlice } from './roof-framing'
import { computeTakeoff } from './takeoff'

/**
 * roofSystem 'truss' — pre-engineered gable trusses.
 *
 * What is pinned, and why:
 *  - ABSENCE IS STICK, BYTE FOR BYTE. The option is optional with no default;
 *    a spec without it must hash identically to DEFAULT_SPEC output. This is
 *    the master-baseline contract every stored scene rides on.
 *  - A truss is its own tie: bottom chords replace ceiling joists, so a
 *    trussed gable emits NO 'ceiling-joist', NO 'collar-tie', NO 'ridge'
 *    (no structural ridge, no purlins — those are the stick span fix).
 *  - Trusses bear FLAT: the bottom chord's underside sits ON the wall line
 *    (eaveY), not notched below it, and it spans wall line to wall line —
 *    no tail past the plate.
 *  - Honesty rides the members: webbing is labeled representative + a
 *    deferred manufacturer submittal; a span past 40 ft flags engineering;
 *    a non-gable segment in truss mode stays stick-framed AND says so.
 *  - The envelope is unchanged: deck, fascia, rake ladder still emit, so
 *    the roof reads the same from outside whichever system framed it.
 */

const byRole = (members: Member[], role: string): Member[] => members.filter((m) => m.role === role)
const hash = (members: Member[]): string =>
  createHash('sha256').update(JSON.stringify(members)).digest('hex')

function seg(overrides: Partial<RoofSegmentSlice> = {}): RoofSegmentSlice {
  return {
    id: 'roofseg_truss',
    roofType: 'gable',
    position: [0, 2.5, 0],
    yaw: 0,
    width: 8,
    depth: 6,
    pitch: (30 * Math.PI) / 180,
    overhang: 0.3,
    wallHeight: 0.5,
    ...overrides,
  }
}

const STICK: FramingSpec = { ...DEFAULT_SPEC, detail: '400' }
const TRUSS: FramingSpec = { ...STICK, roofSystem: 'truss' }

describe('roofSystem absent == stick, byte for byte', () => {
  test('a spec without roofSystem hashes identically to an explicit stick spec, for every shape', () => {
    for (const roofType of ['gable', 'shed', 'hip', 'flat', 'gambrel', 'mansard', 'dutch'] as const) {
      const a = frameRoofs([seg({ roofType })], [], STICK)
      const b = frameRoofs([seg({ roofType })], [], { ...STICK, roofSystem: 'stick' })
      expect(hash(b)).toBe(hash(a))
    }
  })

  test('stick output carries no truss roles at all', () => {
    const m = frameRoofs([seg()], [], STICK)
    expect(byRole(m, 'truss-chord')).toHaveLength(0)
    expect(byRole(m, 'truss-web')).toHaveLength(0)
    expect(byRole(m, 'rafter').length).toBeGreaterThan(2)
  })
})

describe('a trussed gable', () => {
  const m = frameRoofs([seg()], [], TRUSS)
  const chords = byRole(m, 'truss-chord')
  const tops = chords.filter((c) => c.label?.startsWith('Truss top chord'))
  const bottoms = chords.filter((c) => c.label?.startsWith('Truss bottom chord'))

  test('emits one bottom chord and two top chords per truss station, all 2x4', () => {
    expect(bottoms.length).toBeGreaterThan(2)
    expect(tops).toHaveLength(bottoms.length * 2)
    for (const c of chords) expect(c.size).toBe('2x4')
    // one station per rafter spacing across the width, with guaranteed ends
    const stations = bottoms.map((b) => b.position[0]).sort((a, b) => a - b)
    expect(new Set(stations.map((s) => s.toFixed(6))).size).toBe(bottoms.length)
    const gaps = stations.slice(1).map((s, i) => s - (stations[i] as number))
    // interior gaps are the 24" rafter spacing; the end gap may be shorter
    expect(gaps.slice(0, -1).every((g) => Math.abs(g - DEFAULT_SPEC.rafterSpacing) < 1e-6)).toBe(true)
  })

  test('the bottom chord IS the tie: no ceiling joists, collar ties, or ridge board', () => {
    expect(byRole(m, 'ceiling-joist')).toHaveLength(0)
    expect(byRole(m, 'collar-tie')).toHaveLength(0)
    expect(byRole(m, 'ridge')).toHaveLength(0)
  })

  test('trusses bear FLAT on the wall line: chord underside at eaveY, span wall line to wall line', () => {
    const roof = seg()
    for (const b of bottoms) {
      const underside = b.position[1] - roof.position[1] - b.dims[1] / 2
      // the two dropped gable-end trusses sit one outlooker thickness lower
      const dropped = b.label?.includes('dropped') ?? false
      if (!dropped) expect(Math.abs(underside - roof.wallHeight)).toBeLessThan(1e-6)
      // full depth minus the deck-slope end clip (the buy length stays the depth)
      expect(b.length).toBeLessThanOrEqual(roof.depth + 1e-9)
      expect(b.length).toBeGreaterThan(roof.depth - 0.4)
      expect(Math.abs(b.position[2] - roof.position[2])).toBeLessThan(1e-6) // centred on the ridge line
    }
  })

  test('top chords run tip to peak on the rafter slope planes, no ridge-face setback', () => {
    const roof = seg()
    const run = roof.depth / 2
    const cosT = Math.cos(roof.pitch)
    const [, cd] = LUMBER_CROSS_SECTIONS['2x4']
    const plumbInset = (cd / 2) * Math.tan(roof.pitch)
    const expected = run / cosT + roof.overhang - 2 * plumbInset
    for (const t of tops) expect(Math.abs(t.length - expected)).toBeLessThan(1e-6)
  })

  test('webbing is a king post + two struts per truss and is LABELED representative', () => {
    const webs = byRole(m, 'truss-web')
    // interior trusses only: the two gable-end trusses are a different product
    // (vertical webs at the stud module, framed as infill studs)
    expect(webs).toHaveLength((bottoms.length - 2) * 3)
    for (const w of webs) {
      expect(w.size).toBe('2x4')
      expect(w.label).toContain('representative')
    }
    const posts = webs.filter((w) => w.label?.includes('king post'))
    expect(posts).toHaveLength(bottoms.length - 2)
    // the king post stands plumb on the ridge line
    for (const p of posts) expect(Math.abs(p.position[2] - seg().position[2])).toBeLessThan(1e-6)
  })

  test('every bottom chord carries the deferred-submittal statement', () => {
    for (const b of bottoms) {
      expect(b.label).toContain('design by truss manufacturer')
      expect(b.label).toContain('deferred submittal')
      expect(b.label).toContain('R802.4.2')
    }
  })

  test('the envelope is unchanged: deck, fascia, rake ladder still emit', () => {
    expect(byRole(m, 'sheathing').length).toBeGreaterThan(0)
    expect(byRole(m, 'fascia').length).toBeGreaterThan(0)
    expect(byRole(m, 'outlooker').length).toBeGreaterThan(0)
    // the two barge rafters per rake are the only 'rafter' members left
    expect(byRole(m, 'rafter')).toHaveLength(4)
  })

  test('a small truss is a plain king post — no struts fake a W', () => {
    const small = frameRoofs([seg({ depth: 2.8 })], [], TRUSS)
    const webs = byRole(small, 'truss-web')
    expect(webs.every((w) => w.label?.includes('king post'))).toBe(true)
  })
})

describe('truss honesty flags', () => {
  test('no flag on a common truss span; a span past 40 ft flags an engineered package', () => {
    const ok = frameRoofs([seg({ depth: 10 })], [], TRUSS)
    expect(byRole(ok, 'truss-chord').every((c) => c.flag === undefined)).toBe(true)
    const wide = frameRoofs([seg({ depth: 13, width: 10 })], [], TRUSS)
    const flagged = byRole(wide, 'truss-chord').filter((c) => c.flag !== undefined)
    expect(flagged.length).toBeGreaterThan(0)
    for (const c of flagged) {
      expect(c.flag).toContain('exceeds')
      expect(c.flag).toContain('girder/piggyback')
    }
  })

  test('LOD 200 stays schematic: no span flag even past 40 ft', () => {
    const wide = frameRoofs([seg({ depth: 13, width: 10 })], [], { ...TRUSS, detail: '200' })
    expect(byRole(wide, 'truss-chord').every((c) => c.flag === undefined)).toBe(true)
  })

  test('a non-gable segment in truss mode stays stick-framed and SAYS so on its rafters', () => {
    const hip = frameRoofs([seg({ roofType: 'hip' })], [], TRUSS)
    expect(byRole(hip, 'truss-chord')).toHaveLength(0)
    const rafters = byRole(hip, 'rafter')
    expect(rafters.length).toBeGreaterThan(0)
    expect(rafters.every((r) => r.flag?.includes('truss roof system selected'))).toBe(true)
    expect(rafters[0]?.flag).toContain('hip segment shown stick-framed')
    // ...and its stick geometry is byte-identical to a stick hip apart from the flag
    const stick = frameRoofs([seg({ roofType: 'hip' })], [], STICK)
    const strip = (ms: Member[]) => ms.map(({ flag: _f, ...rest }) => rest)
    expect(hash(strip(hip) as Member[])).toBe(hash(strip(stick) as Member[]))
  })
})

describe('trusses in the takeoff', () => {
  test('chords book the R602.3(1) Item 6 heel toe-nails; webs book no site nails', () => {
    const m = frameRoofs([seg()], [], TRUSS)
    const rows = computeTakeoff(m, [])
    const text = JSON.stringify(rows)
    // heel toe-nails book (Item 6) — the takeoff sees nails for the trusses
    expect(text).toMatch(/10d/)
    // ...and no row books a web fastener: webs are factory-plated
    expect(rows.some((r) => JSON.stringify(r).includes('truss-web') && /nail/i.test(JSON.stringify(r)))).toBe(false)
  })
})

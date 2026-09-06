/**
 * Hills (W14): the lot drop-in writes the site's USGS heightfield; the
 * generator stands the house with its finish floor above the HIGHEST grade
 * under the footprint; Bones reads the ground through the building and
 *
 *   - steps the footings down the hill (R403.1.5), one level segment per
 *     24 in of fall, a vertical step block between them, the bottom never
 *     above the frost line at any point;
 *   - grows the stemwalls with them and says how much shows;
 *   - runs every girder / deck post to its OWN grade with the pad there;
 *   - drapes the crawl-space ground cover strip by strip.
 *
 * A site with no terrain is flat ground — byte-identical to before.
 */
import { describe, expect, test } from 'bun:test'
import { createTerrainField, encodeTerrainField, quantize } from '@pascal-app/core'
import type { Member } from '../core/types'
import { computeLevel, groundGradeOf } from './compute'
import { FramingNode } from './schema'

const IN = 0.0254
const FT = 0.3048
/** The ground: a plane rising 10 % towards +x (site metres). */
const SLOPE = 0.1
const wall = (id: string, start: [number, number], end: [number, number], exterior = true) => ({
  id,
  type: 'wall',
  parentId: 'lvl0',
  start,
  end,
  thickness: 0.14,
  height: 2.7,
  frontSide: exterior ? 'exterior' : 'interior',
  backSide: 'interior',
  children: [],
})

function terrain() {
  // origin (−5, −5), 0.5 m spacing, 61 × 41 samples: x −5..25, z −5..15
  const field = createTerrainField({ origin: [-5, -5], spacing: 0.5, cols: 61, rows: 41 })
  for (let r = 0; r < 41; r++) {
    for (let c = 0; c < 61; c++) field.heights[r * 61 + c] = quantize(field, SLOPE * (-5 + c * 0.5))
  }
  return encodeTerrainField(field)
}

/** A 10 × 7 m raised house (18 in stem) with a 16 × 12 ft deck behind it; `hill` puts it on the slope. */
function scene(hill: boolean) {
  const highest = hill ? SLOPE * 10 : 0 // the ground at x = 10, the high side
  const ff = 18 * IN
  const nodes: Record<string, Record<string, unknown>> = {
    site: { id: 'site', type: 'site', children: ['bldg'], ...(hill ? { terrain: terrain() } : {}) },
    bldg: {
      id: 'bldg',
      type: 'building',
      parentId: 'site',
      children: ['lvl0'],
      position: [0, highest + ff, 0],
      rotation: [0, 0, 0],
      metadata: { foundation: { type: 'raised', ffAboveGradeIn: 18 } },
    },
    lvl0: {
      id: 'lvl0',
      type: 'level',
      parentId: 'bldg',
      level: 0,
      height: 2.7,
      children: ['wa', 'wb', 'wc', 'wd', 'wi', 'floor', 'deck'],
    },
    wa: wall('wa', [0, 0], [10, 0]),
    wb: wall('wb', [10, 0], [10, 7]),
    wc: wall('wc', [10, 7], [0, 7]),
    wd: wall('wd', [0, 7], [0, 0]),
    wi: wall('wi', [5, 0], [5, 7], false),
    floor: {
      id: 'floor',
      type: 'slab',
      parentId: 'lvl0',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 7],
        [0, 7],
      ],
      holes: [],
      elevation: 0.05,
      thickness: 0.019,
      metadata: { floor: 'platform' },
    },
    deck: {
      id: 'deck',
      type: 'slab',
      parentId: 'lvl0',
      polygon: [
        [2, 7],
        [2 + 16 * FT, 7],
        [2 + 16 * FT, 7 + 12 * FT],
        [2, 7 + 12 * FT],
      ],
      holes: [],
      elevation: 0.05 - IN,
      thickness: 1.5 * IN,
      metadata: { floor: 'deck' },
    },
  }
  return nodes
}

const bones = () =>
  FramingNode.parse({
    id: 'bonesframing_t',
    parentId: 'lvl0',
    jurisdiction: 'INTL',
    detail: '300',
  }) as FramingNode
const roles = (members: Member[], role: string): Member[] => members.filter((m) => m.role === role)
const of = (members: Member[], id: string) => members.filter((m) => m.sourceId === id)
const top = (m: Member) => m.position[1]! + m.dims[1]! / 2
const bottom = (m: Member) => m.position[1]! - m.dims[1]! / 2
/** Level-local grade on the hill: the site plane rises 10 % in x, the building stands 18 in above the high side. */
const localGrade = (x: number) => SLOPE * x - (SLOPE * 10 + 18 * IN)

describe('groundGradeOf', () => {
  test('reads the site heightfield through the building; a site without terrain is null', () => {
    const hill = scene(true)
    const g = groundGradeOf(hill, hill.bldg, 0)
    expect(g).not.toBeNull()
    expect(g!(0, 0)).toBeCloseTo(localGrade(0), 3)
    expect(g!(10, 3)).toBeCloseTo(localGrade(10), 3)
    // a building turned 90° reads the ground along its own x
    const turned = { ...hill.bldg, rotation: [0, Math.PI / 2, 0], position: [4, 0, 0] }
    const gt = groundGradeOf(hill, turned, 0)
    // local +x → world −z under a +90° yaw: the slope is along world x, so the local x axis is level
    expect(gt!(3, 0)).toBeCloseTo(gt!(0, 0), 3)
    expect(gt!(0, 2)).toBeCloseTo(gt!(0, 0) + SLOPE * 2, 3)
    expect(groundGradeOf(scene(false), scene(false).bldg, 0)).toBeNull()
  })
})

describe('a raised house on a 10 % hill', () => {
  const flat = computeLevel(scene(false), bones())
  const hill = computeLevel(scene(true), bones())
  const frost =
    -18 * IN -
    Math.min(
      ...roles(flat.members, 'footing')
        .filter((f) => !/Pad|step/.test(f.label ?? ''))
        .map(bottom),
    )

  test('the footing under the wall running up the hill is stepped; the one across the hill is level', () => {
    const up = roles(of(hill.members, 'wa'), 'footing')
    const runs = up.filter((f) => /step \d of \d/.test(f.label ?? ''))
    const steps = up.filter((f) => /Footing step/.test(f.label ?? ''))
    expect(runs.length).toBeGreaterThanOrEqual(2)
    expect(steps.length).toBe(runs.length - 1)
    // every segment bottoms at or below the frost line under its shallowest point
    for (const f of runs) {
      const xHigh = f.position[0]! + f.dims[0]! / 2
      expect(bottom(f)).toBeLessThanOrEqual(localGrade(xHigh) - frost + 1e-6)
      expect(bottom(f)).toBeGreaterThanOrEqual(
        localGrade(f.position[0]! - f.dims[0]! / 2) - frost - 24 * IN - 1e-6,
      )
    }
    // the bottoms rise with the hill
    const sorted = [...runs].sort((a, b) => a.position[0]! - b.position[0]!)
    expect(bottom(sorted[sorted.length - 1]!)).toBeGreaterThan(bottom(sorted[0]!) + 0.3)
    // each step is a vertical block no taller than 24 in + the footing
    for (const s of steps) expect(s.dims[1]).toBeLessThanOrEqual(24 * IN + 8 * IN + 1e-6)
    // the wall across the hill at x = 0 (the low side) gets one level footing at its own frost line
    const across = roles(of(hill.members, 'wd'), 'footing').filter(
      (f) => !/Pad/.test(f.label ?? ''),
    )
    expect(across).toHaveLength(1)
    expect(bottom(across[0]!)).toBeCloseTo(localGrade(0) - frost, 3)
    expect(across[0]!.label).not.toContain('step')
  })

  test('the stemwalls grow with the footing: taller on the low side, and they say how much shows', () => {
    const low = roles(of(hill.members, 'wd'), 'stemwall')
    const high = roles(of(hill.members, 'wb'), 'stemwall')
    expect(low).toHaveLength(1)
    expect(high).toHaveLength(1)
    expect(low[0]!.dims[1]).toBeGreaterThan(high[0]!.dims[1] + 0.9)
    expect(low[0]!.label).toMatch(/exposed above grade/)
    // the stemwall under the stepped footing comes in segments matching the footing runs
    const stepped = roles(of(hill.members, 'wa'), 'stemwall')
    expect(stepped.length).toBe(
      roles(of(hill.members, 'wa'), 'footing').filter((f) => /step \d of/.test(f.label ?? ''))
        .length,
    )
    for (const s of stepped)
      expect(top(s)).toBeCloseTo(top(roles(of(flat.members, 'wa'), 'stemwall')[0]!), 6)
  })

  test('platform and deck posts run to their own grade, with a pad at each', () => {
    const posts = roles(hill.members, 'post').filter((m) => m.system === 'floor-framing')
    expect(posts.length).toBeGreaterThan(4)
    for (const p of posts) expect(bottom(p)).toBeCloseTo(localGrade(p.position[0]!), 2)
    const deckPosts = posts.filter((p) => p.sourceId === 'deck')
    expect(deckPosts.length).toBeGreaterThanOrEqual(2)
    const pads = hill.members.filter(
      (m) => m.role === 'footing' && /Pad footing/.test(m.label ?? ''),
    )
    expect(pads.length).toBe(posts.length)
    for (const pad of pads) expect(top(pad)).toBeCloseTo(localGrade(pad.position[0]!), 2)
  })

  test('the ground cover drapes down the hill; the reader is told', () => {
    const cover = roles(hill.members, 'vapor-retarder').filter((c) => /R408/.test(c.label ?? ''))
    expect(cover.length).toBeGreaterThan(2)
    for (const c of cover) expect(top(c)).toBeCloseTo(localGrade(c.position[0]!), 2)
    expect(hill.warnings.some((w) => /Hillside/.test(w))).toBe(true)
    expect(flat.warnings.some((w) => /Hillside/.test(w))).toBe(false)
  })

  test('without terrain nothing steps: one footing per wall, posts at the crawl grade', () => {
    for (const id of ['wa', 'wb', 'wc', 'wd']) {
      const fs = roles(of(flat.members, id), 'footing').filter((f) => !/Pad/.test(f.label ?? ''))
      expect(fs).toHaveLength(1)
      expect(fs[0]!.label).not.toContain('step')
    }
    for (const p of roles(flat.members, 'post')) expect(bottom(p)).toBeCloseTo(-18 * IN, 6)
  })
})

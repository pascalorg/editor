/**
 * Raised floors and grade (PlanCrafters' foundation record on the building
 * node, W11): `metadata.foundation = { type, ffAboveGradeIn }`.
 *
 *   - slab (default, or no record): everything as before — the pins hold.
 *   - a slab house standing above grade: the footing bottom drops by the
 *     same amount (frost depth is measured from GRADE), the stemwall grows
 *     and says how much of it shows.
 *   - raised: the ground floor is a framed platform (joists, rim, girders on
 *     pads at the crawl grade), a PT mudsill on the stemwall, anchor bolts
 *     through it, no slab field, a Class I ground cover at grade, untreated
 *     sole plates on the platform, no interior thickened footings.
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member } from '../core/types'
import { computeLevel, foundationOf } from './compute'
import { FramingNode } from './schema'

const IN = 0.0254
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

function scene(foundation?: { type: string; ffAboveGradeIn: number }) {
  const nodes: Record<string, Record<string, unknown>> = {
    bldg: {
      id: 'bldg',
      type: 'building',
      children: ['lvl0'],
      position: [0, foundation ? foundation.ffAboveGradeIn * IN : 0, 0],
      ...(foundation ? { metadata: { foundation } } : {}),
    },
    lvl0: {
      id: 'lvl0',
      type: 'level',
      parentId: 'bldg',
      level: 0,
      height: 2.7,
      children: ['wa', 'wb', 'wc', 'wd', 'wi', 'slab'],
    },
    wa: wall('wa', [0, 0], [10, 0]),
    wb: wall('wb', [10, 0], [10, 7]),
    wc: wall('wc', [10, 7], [0, 7]),
    wd: wall('wd', [0, 7], [0, 0]),
    // a long interior bearing wall down the middle
    wi: wall('wi', [5, 0], [5, 7], false),
    slab: {
      id: 'slab',
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
      thickness: foundation?.type === 'raised' ? 0.019 : 0.1016,
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
const minY = (members: Member[]) => Math.min(...members.map((m) => m.position[1] - m.dims[1] / 2))

describe('foundationOf', () => {
  test('reads the building record, defaults to slab at the plate line', () => {
    expect(foundationOf(undefined)).toEqual({ type: 'slab', ffAboveGradeM: 0 })
    expect(foundationOf({ metadata: {} })).toEqual({ type: 'slab', ffAboveGradeM: 0 })
    expect(
      foundationOf({ metadata: { foundation: { type: 'raised', ffAboveGradeIn: 18 } } }),
    ).toEqual({ type: 'raised', ffAboveGradeM: 18 * IN })
    expect(
      foundationOf({ metadata: { foundation: { type: 'garbage', ffAboveGradeIn: -3 } } }),
    ).toEqual({ type: 'slab', ffAboveGradeM: 0 })
  })
})

describe('slab-on-grade above grade', () => {
  const plain = computeLevel(scene(), bones())
  const up = computeLevel(scene({ type: 'slab', ffAboveGradeIn: 8 }), bones())

  test('the footing bottom drops by the finish floor height — frost depth is measured from grade', () => {
    // the jurisdiction profile resolves the frost depth — compare against the plain run, not the raw default
    const plainBottom = minY(roles(plain.members, 'footing'))
    expect(plainBottom).toBeLessThanOrEqual(-DEFAULT_SPEC.footingDepth + 1e-9)
    expect(minY(roles(up.members, 'footing'))).toBeCloseTo(plainBottom - 8 * IN, 6)
  })

  test('the stemwall still tops out at the plate line, taller by the exposure, and says so', () => {
    const stems = roles(up.members, 'stemwall')
    expect(stems.length).toBeGreaterThan(0)
    for (const s of stems) {
      expect(s.position[1]! + s.dims[1]! / 2).toBeCloseTo(0, 6)
      expect(s.label).toContain('exposed above grade')
    }
    const plainStem = roles(plain.members, 'stemwall')[0]!
    const upStem = stems[0]!
    expect(upStem.dims[1]).toBeCloseTo(plainStem.dims[1]! + 8 * IN, 6)
  })

  test('the slab field and the PT sole plates are unchanged', () => {
    expect(roles(up.members, 'slab').length).toBe(roles(plain.members, 'slab').length)
    expect(roles(up.members, 'mudsill')).toHaveLength(0)
    const plates = roles(up.members, 'bottom-plate')
    expect(plates.length).toBeGreaterThan(0)
    expect(plates.every((p) => p.material === 'pt-lumber')).toBe(true)
  })
})

describe('a raised floor over a crawl space', () => {
  const r = computeLevel(scene({ type: 'raised', ffAboveGradeIn: 18 }), bones())
  const grade = -18 * IN

  test('the ground floor is a framed platform: joists, rim, a girder on posts that reach the crawl grade', () => {
    expect(roles(r.members, 'joist').length).toBeGreaterThan(10)
    expect(roles(r.members, 'rim-joist').length).toBeGreaterThan(0)
    const posts = roles(r.members, 'post')
    expect(posts.length).toBeGreaterThan(0)
    for (const p of posts) expect(p.position[1]! - p.dims[1]! / 2).toBeCloseTo(grade, 6)
    expect(r.warnings.some((w) => /framed platform over a crawl space/.test(w))).toBe(true)
  })

  test('pads under the posts pour with their tops at grade', () => {
    const pads = r.members.filter((m) => m.role === 'footing' && /Pad footing/.test(m.label ?? ''))
    expect(pads.length).toBe(roles(r.members, 'post').length)
    for (const p of pads) expect(p.position[1]! + p.dims[1]! / 2).toBeCloseTo(grade, 6)
  })

  test('a PT mudsill on the stemwall under the platform, bolts through it, the stem from the frost line to the sill', () => {
    const sills = roles(r.members, 'mudsill')
    expect(sills).toHaveLength(4)
    const joistBottom = minY(roles(r.members, 'joist'))
    for (const s of sills) {
      expect(s.material).toBe('pt-lumber')
      expect(s.position[1]! + s.dims[1]! / 2).toBeCloseTo(joistBottom, 6) // sill top meets the joists
    }
    const stemTop = joistBottom - 1.5 * IN
    for (const s of roles(r.members, 'stemwall'))
      expect(s.position[1]! + s.dims[1]! / 2).toBeCloseTo(stemTop, 6)
    const plainBottom = minY(roles(computeLevel(scene(), bones()).members, 'footing'))
    expect(minY(roles(r.members, 'footing').filter((f) => !/Pad/.test(f.label ?? '')))).toBeCloseTo(
      plainBottom + grade,
      6,
    )
    for (const b of roles(r.members, 'anchor-bolt')) {
      // 7 in embedded below the stem top, sticking up through the sill
      expect(b.position[1]! - b.dims[1]! / 2).toBeCloseTo(stemTop - 7 * IN, 6)
    }
  })

  test('no slab field, a ground cover at grade instead; sole plates untreated; no interior thickened footings', () => {
    expect(roles(r.members, 'slab')).toHaveLength(0)
    const cover = roles(r.members, 'vapor-retarder')
    expect(cover.length).toBeGreaterThan(0)
    for (const c of cover) {
      expect(c.position[1]).toBeCloseTo(grade - c.dims[1]! / 2, 6)
      expect(c.label).toContain('R408')
    }
    const plates = roles(r.members, 'bottom-plate')
    expect(plates.length).toBeGreaterThan(0)
    expect(plates.every((p) => p.material === 'lumber')).toBe(true)
    expect(r.members.filter((m) => /Interior thickened footing/.test(m.label ?? ''))).toHaveLength(
      0,
    )
  })
})

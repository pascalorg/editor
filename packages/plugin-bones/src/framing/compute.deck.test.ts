/**
 * Decks and slab kinds (W10b): the generator tags every slab node with
 * `metadata.floor` — the storey floor, concrete at its own elevation, or a
 * wood deck — and Bones frames / pours each by what it is:
 *
 *   - a raised farmhouse: the floor is a framed platform, its garage pad
 *     ('garage-slab-at-grade') pours at grade, its rear deck ('deck') is
 *     framed by the deck engine on posts to grade with pads, and gets no
 *     slab field and no ground cover;
 *   - a slab house: the porch slab pours 4 in below the house slab as
 *     before; a deck drawn beside it still frames.
 */
import { describe, expect, test } from 'bun:test'
import type { Member } from '../core/types'
import { slabKindOf } from '../core/wall-model'
import { computeLevel } from './compute'
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
const slab = (
  id: string,
  polygon: [number, number][],
  elevation: number,
  thickness: number,
  floor?: string,
  name = id,
) => ({
  id,
  type: 'slab',
  name,
  parentId: 'lvl0',
  polygon,
  holes: [],
  elevation,
  thickness,
  ...(floor ? { metadata: { floor } } : {}),
})

/** A 10 × 7 m house, a 5 × 6 m garage wing on its right, a 16 × 12 ft deck behind the house. */
function scene(foundation: { type: 'slab' | 'raised'; ffAboveGradeIn: number }, withDeck = true) {
  const ff = foundation.ffAboveGradeIn * IN
  const raised = foundation.type === 'raised'
  const nodes: Record<string, Record<string, unknown>> = {
    bldg: {
      id: 'bldg',
      type: 'building',
      children: ['lvl0'],
      position: [0, ff, 0],
      metadata: { foundation },
    },
    lvl0: {
      id: 'lvl0',
      type: 'level',
      parentId: 'bldg',
      level: 0,
      height: 2.7,
      children: [
        'wa',
        'wb',
        'wc',
        'wd',
        'wi',
        'ga',
        'gb',
        'gc',
        'floor',
        'garage',
        ...(withDeck ? ['deck'] : []),
      ],
    },
    wa: wall('wa', [0, 0], [10, 0]),
    wb: wall('wb', [10, 0], [10, 7]),
    wc: wall('wc', [10, 7], [0, 7]),
    wd: wall('wd', [0, 7], [0, 0]),
    wi: wall('wi', [5, 0], [5, 7], false),
    ga: wall('ga', [10, 0], [15, 0]),
    gb: wall('gb', [15, 0], [15, 6]),
    gc: wall('gc', [15, 6], [10, 6]),
    floor: slab(
      'floor',
      [
        [0, 0],
        [10, 0],
        [10, 7],
        [0, 7],
      ],
      0.05,
      raised ? 0.019 : 0.1016,
      raised ? 'platform' : 'slab-on-grade',
    ),
    // the garage pad at grade: its walking surface drops by the finish-floor height
    garage: slab(
      'garage',
      [
        [10, 0],
        [15, 0],
        [15, 6],
        [10, 6],
      ],
      0.05 - ff,
      0.1016,
      'garage-slab-at-grade',
    ),
  }
  if (withDeck) {
    nodes.deck = slab(
      'deck',
      [
        [2, 7],
        [2 + 16 * 0.3048, 7],
        [2 + 16 * 0.3048, 7 + 12 * 0.3048],
        [2, 7 + 12 * 0.3048],
      ],
      0.05 - IN,
      1.5 * IN,
      'deck',
    )
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
const ofDeck = (members: Member[]) => members.filter((m) => m.sourceId === 'deck')

describe('slabKindOf', () => {
  test("reads the generator's tag; anything else is the storey floor", () => {
    expect(slabKindOf({ floor: 'deck' })).toBe('deck')
    expect(slabKindOf({ floor: 'porch-slab' })).toBe('slab')
    expect(slabKindOf({ floor: 'garage-slab-at-grade' })).toBe('slab')
    expect(slabKindOf({ floor: 'slab-on-grade' })).toBe('slab')
    expect(slabKindOf({ floor: 'platform' })).toBe('floor')
    expect(slabKindOf({})).toBe('floor')
    expect(slabKindOf(undefined)).toBe('floor')
  })
})

describe('a raised house with a garage pad at grade and a rear deck', () => {
  const r = computeLevel(scene({ type: 'raised', ffAboveGradeIn: 18 }), bones())
  const grade = -18 * IN
  const deck = ofDeck(r.members)

  test('the deck is framed by the deck engine: ledger on the rear wall, PT joists, a beam, posts to grade', () => {
    expect(roles(deck, 'ledger')).toHaveLength(1)
    expect(roles(deck, 'ledger')[0]!.position[2]).toBeGreaterThan(7) // on the outside of the rear wall
    expect(roles(deck, 'joist').length).toBeGreaterThan(10)
    for (const j of roles(deck, 'joist')) expect(j.material).toBe('pt-lumber')
    expect(roles(deck, 'girder')).toHaveLength(1)
    const posts = roles(deck, 'post')
    expect(posts.length).toBeGreaterThanOrEqual(2)
    for (const p of posts) expect(p.position[1]! - p.dims[1]! / 2).toBeCloseTo(grade, 6)
    expect(r.warnings.some((w) => /wood deck framed/.test(w))).toBe(true)
  })

  test('a pad footing under every deck post, top at grade', () => {
    const pads = r.members.filter((m) => m.role === 'footing' && /Pad footing/.test(m.label ?? ''))
    expect(pads.length).toBe(roles(r.members, 'post').length) // platform girder posts + deck posts
    for (const p of pads) expect(p.position[1]! + p.dims[1]! / 2).toBeCloseTo(grade, 6)
  })

  test('the platform is framed for the floor only — no joists under the garage pad or the deck outline', () => {
    const platformJoists = roles(r.members, 'joist').filter((m) => m.sourceId === 'floor')
    expect(platformJoists.length).toBeGreaterThan(10)
    expect(roles(r.members, 'joist').filter((m) => m.sourceId === 'garage')).toHaveLength(0)
    for (const j of platformJoists) {
      expect(j.position[0]).toBeLessThan(10.01)
      expect(j.position[2]).toBeLessThan(7.01)
    }
  })

  test('the garage pad pours at grade; the deck gets no slab field and no ground cover; the platform gets the cover', () => {
    const fields = roles(r.members, 'slab')
    expect(fields.length).toBeGreaterThan(0)
    for (const f of fields) {
      expect(f.sourceId).toBe('garage')
      expect(f.position[1]! + f.dims[1]! / 2).toBeCloseTo(grade, 6)
    }
    // the garage pad gets its own under-slab retarder; the R408 ground cover is the platform's alone
    const cover = roles(r.members, 'vapor-retarder').filter((c) => /R408/.test(c.label ?? ''))
    expect(cover.length).toBeGreaterThan(0)
    for (const c of cover) expect(c.sourceId).toBe('floor')
    expect(roles(r.members, 'vapor-retarder').some((c) => c.sourceId === 'deck')).toBe(false)
  })

  test('the rear wall keeps its exterior layers — the deck outside it is not floor coverage', () => {
    const rear = r.members.filter((m) => m.sourceId === 'wc')
    expect(rear.some((m) => m.role === 'sheathing')).toBe(true)
    expect(rear.some((m) => m.role === 'wrb')).toBe(true)
    expect(rear.some((m) => m.role === 'cladding')).toBe(true)
    expect(rear.filter((m) => m.role === 'drywall')).toHaveLength(1)
  })

  test('without the deck nothing else changes', () => {
    const plain = computeLevel(scene({ type: 'raised', ffAboveGradeIn: 18 }, false), bones())
    const keep = (ms: Member[]) =>
      ms.filter(
        (m) =>
          m.sourceId !== 'deck' && !(m.role === 'footing' && /Pad footing/.test(m.label ?? '')),
      )
    expect(keep(r.members).length).toBe(keep(plain.members).length)
    expect(roles(plain.members, 'slab').length).toBe(roles(r.members, 'slab').length)
  })
})

describe('a slab house with the same wing and deck', () => {
  const r = computeLevel(scene({ type: 'slab', ffAboveGradeIn: 8 }), bones())

  test('the house and garage pour (the garage 8 in lower); the deck frames flagged and unpropped — its frame is deeper than 8 in — and is not poured', () => {
    const fields = roles(r.members, 'slab')
    expect(fields.some((f) => f.sourceId === 'floor')).toBe(true)
    expect(fields.some((f) => f.sourceId === 'garage')).toBe(true)
    expect(fields.some((f) => f.sourceId === 'deck')).toBe(false)
    const houseTop = Math.max(
      ...fields.filter((f) => f.sourceId === 'floor').map((f) => f.position[1]! + f.dims[1]! / 2),
    )
    const garageTop = Math.max(
      ...fields.filter((f) => f.sourceId === 'garage').map((f) => f.position[1]! + f.dims[1]! / 2),
    )
    expect(houseTop).toBeCloseTo(0, 6)
    expect(garageTop).toBeCloseTo(-8 * IN, 6)
    const deck = ofDeck(r.members)
    expect(roles(deck, 'joist').length).toBeGreaterThan(10)
    expect(roles(deck, 'post')).toHaveLength(0)
    for (const m of deck) expect(m.flag).toMatch(/below grade/)
    expect(roles(r.members, 'joist').filter((m) => m.sourceId === 'floor')).toHaveLength(0)
  })
})

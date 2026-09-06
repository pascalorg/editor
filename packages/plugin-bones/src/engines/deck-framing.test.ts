import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member, SlabSlice, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { LUMBER_CROSS_SECTIONS } from '../lumber'
import { DECK_BEAM_INSET, frameDeck, ledgerEdgeOf } from './deck-framing'

const FT = 0.3048
const wall = (id: string, start: [number, number], end: [number, number]): WallSlice => {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz)
  return {
    id,
    start,
    end,
    length,
    dir: [dx / length, dz / length],
    thickness: 0.14,
    height: 2.7,
    exterior: true,
    curved: false,
  } as unknown as WallSlice
}

// the house's rear wall runs along x at z = 9.144 (30 ft); the deck sits behind it, +z
const REAR = wall('rear', [0, 9.144], [12.192, 9.144])
const DECK_TOP = 0.0246 // decking surface: the 0.05 finish floor less the 1 in deck drop
const deck = (over: Partial<SlabSlice> = {}): SlabSlice => ({
  id: 'slab_deck',
  polygon: [
    [2, 9.144],
    [2 + 16 * FT, 9.144],
    [2 + 16 * FT, 9.144 + 12 * FT],
    [2, 9.144 + 12 * FT],
  ],
  holes: [],
  elevation: DECK_TOP,
  thickness: 0.0381,
  kind: 'deck',
  ...over,
})
const HIGH = -36 * inches(1) // a deck 3 ft up: room for a dropped beam on posts
const RAISED = -18 * inches(1) // the raised farmhouse: a flush beam on short posts
const SLAB = -8 * inches(1) // a slab house: nothing fits
const roles = (ms: Member[], role: string) => ms.filter((m) => m.role === role)

describe('ledgerEdgeOf', () => {
  test('the edge on the house wall is the ledger; nothing near a wall is freestanding', () => {
    expect(ledgerEdgeOf(deck().polygon, [REAR])).toBe(0)
    expect(ledgerEdgeOf(deck().polygon, [wall('far', [0, 30], [12, 30])])).toBeNull()
  })
})

describe('a 16 × 12 ft rear deck on the house wall, 3 ft above grade', () => {
  const { ledgerEdge, beam, members } = frameDeck(deck(), [REAR], DEFAULT_SPEC, HIGH)
  const joists = roles(members, 'joist')
  const size = joists[0]?.size as string
  const [t, d] = LUMBER_CROSS_SECTIONS[size as '2x8']

  test('joists span from the ledger to the outer rim, 16 in o.c., sized from the table, PT', () => {
    expect(ledgerEdge).toBe(0)
    expect(beam).toBe('dropped')
    expect(joists.length).toBe(13) // 16 ft at 16 in: 12 bays + the end joist
    for (const j of joists) {
      expect(j.material).toBe('pt-lumber')
      expect(j.dims[0]).toBeCloseTo(12 * FT - 2 * t, 6)
      // joist tops under the decking
      expect((j.position[1] as number) + j.dims[1] / 2).toBeCloseTo(DECK_TOP - 0.0381, 9)
      expect(j.label).toContain('R507.6')
      expect(j.flag).toBeUndefined()
    }
    expect(['2x8', '2x10', '2x12']).toContain(size)
  })

  test('a PT ledger the width of the deck on the wall, one hanger per joist', () => {
    const ledger = roles(members, 'ledger')
    expect(ledger).toHaveLength(1)
    expect(ledger[0]!.dims[0]).toBeCloseTo(16 * FT, 6)
    expect(ledger[0]!.position[2]).toBeCloseTo(9.144 + t / 2, 6)
    expect(ledger[0]!.material).toBe('pt-lumber')
    expect(ledger[0]!.label).toContain('R507.9')
    expect(roles(members, 'hanger')).toHaveLength(joists.length)
  })

  test('rims on the three free edges, a dropped 4x8 beam 16 in in from the outer edge, 4x4 posts to grade', () => {
    expect(roles(members, 'rim-joist')).toHaveLength(3)
    const girders = roles(members, 'girder')
    expect(girders).toHaveLength(1)
    expect(girders[0]!.size).toBe('4x8')
    expect(girders[0]!.position[2]).toBeCloseTo(9.144 + 12 * FT - DECK_BEAM_INSET, 6)
    // dropped: beam top at the joist bottoms
    expect((girders[0]!.position[1] as number) + girders[0]!.dims[1] / 2).toBeCloseTo(
      DECK_TOP - 0.0381 - d,
      6,
    )
    const posts = roles(members, 'post')
    expect(posts).toHaveLength(3) // ≈ 15.7 ft of beam: ends + one between
    for (const p of posts) {
      expect((p.position[1] as number) - p.dims[1] / 2).toBeCloseTo(HIGH, 6)
      expect(p.material).toBe('pt-lumber')
      expect(p.position[2]).toBeCloseTo(9.144 + 12 * FT - DECK_BEAM_INSET, 6)
    }
  })

  test('every member belongs to the deck and the floor system', () => {
    for (const m of members) {
      expect(m.sourceId).toBe('slab_deck')
      expect(m.system).toBe('floor-framing')
    }
  })
})

describe('low decks', () => {
  test('the raised farmhouse (18 in) gets a flush beam doubled with the rim, joists hung on it, short posts', () => {
    const { beam, members } = frameDeck(deck(), [REAR], DEFAULT_SPEC, RAISED)
    expect(beam).toBe('flush')
    const joists = roles(members, 'joist')
    const [t, d] = LUMBER_CROSS_SECTIONS[joists[0]!.size as '2x8']
    const girders = roles(members, 'girder')
    expect(girders).toHaveLength(1)
    expect(girders[0]!.size).toBe(joists[0]!.size)
    expect(girders[0]!.label).toContain('flush')
    // flush: beam top at the joist tops, directly inside the outer rim
    expect((girders[0]!.position[1] as number) + girders[0]!.dims[1] / 2).toBeCloseTo(
      DECK_TOP - 0.0381,
      6,
    )
    expect(girders[0]!.position[2]).toBeCloseTo(9.144 + 12 * FT - t - t / 2, 6)
    // joists stop at the beam's inner face, hung at both ends
    for (const j of joists) expect(j.dims[0]).toBeCloseTo(12 * FT - 3 * t, 6)
    expect(roles(members, 'hanger')).toHaveLength(2 * joists.length)
    const posts = roles(members, 'post')
    expect(posts.length).toBeGreaterThanOrEqual(3)
    for (const p of posts) {
      expect((p.position[1] as number) - p.dims[1] / 2).toBeCloseTo(RAISED, 6)
      expect(p.dims[1]).toBeCloseTo(DECK_TOP - 0.0381 - d - RAISED, 6)
    }
    for (const m of members) expect(m.flag).toBeUndefined()
  })

  test('a deck off a slab house (8 in) cannot be propped: no posts, every member flagged', () => {
    const { beam, members } = frameDeck(deck(), [REAR], DEFAULT_SPEC, SLAB)
    expect(beam).toBe('unsupported')
    expect(roles(members, 'post')).toHaveLength(0)
    expect(roles(members, 'joist').length).toBeGreaterThan(0)
    for (const m of members) expect(m.flag).toMatch(/below grade/)
  })
})

describe('other decks', () => {
  test('a freestanding deck gets rims all round and beams under both ends of the joists', () => {
    const { ledgerEdge, members } = frameDeck(deck(), [], DEFAULT_SPEC, HIGH)
    expect(ledgerEdge).toBeNull()
    expect(roles(members, 'ledger')).toHaveLength(0)
    expect(roles(members, 'rim-joist')).toHaveLength(4)
    expect(roles(members, 'girder')).toHaveLength(2)
    expect(roles(members, 'post')).toHaveLength(6)
  })

  test('a deck along a wall that runs the other way frames in its own frame', () => {
    // the wall runs along z at x = 0; the deck lies to −x of it
    const side = wall('side', [0, 0], [0, 12])
    const d = deck({
      polygon: [
        [0, 2],
        [0, 2 + 16 * FT],
        [-12 * FT, 2 + 16 * FT],
        [-12 * FT, 2],
      ],
    })
    const { ledgerEdge, members } = frameDeck(d, [side], DEFAULT_SPEC, HIGH)
    expect(ledgerEdge).toBe(0)
    const ledger = roles(members, 'ledger')[0]!
    expect(ledger.position[0]).toBeCloseTo(-ledger.dims[2] / 2, 6)
    const beam = roles(members, 'girder')[0]!
    expect(beam.position[0]).toBeCloseTo(-12 * FT + DECK_BEAM_INSET, 6)
  })

  test('a tiny or degenerate outline frames nothing', () => {
    expect(
      frameDeck(
        deck({
          polygon: [
            [0, 0],
            [0.2, 0],
            [0.2, 0.2],
            [0, 0.2],
          ],
        }),
        [REAR],
      ).members,
    ).toHaveLength(0)
    expect(
      frameDeck(
        deck({
          polygon: [
            [0, 0],
            [1, 0],
          ],
        }),
        [REAR],
      ).members,
    ).toHaveLength(0)
  })
})

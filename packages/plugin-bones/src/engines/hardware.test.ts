/**
 * Simpson hardware on the members (W9): every steel connector Bones emits
 * names the part a builder orders — hangers by joist size, ties, post
 * bases on pads, post caps under a dropped beam, hold-downs and plate
 * washers — and the takeoff books them by model.
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import type { Member, SlabSlice, WallSlice } from '../core/types'
import { inches } from '../core/units'
import { frameDeck } from './deck-framing'
import {
  HOLD_DOWN,
  HURRICANE_TIE,
  hangerFor,
  modelOf,
  partLabel,
  postBaseFor,
  postCapFor,
} from './hardware'
import { computeTakeoff, modelsSummary } from './takeoff'

const FT = 0.3048
const roles = (ms: Member[], role: string) => ms.filter((m) => m.role === role)

describe('the catalog', () => {
  test('hangers follow the joist size; a size off the table says verify', () => {
    expect(hangerFor('2x6').model).toBe('LUS26')
    expect(hangerFor('2x8').model).toBe('LUS28')
    expect(hangerFor('2x10').model).toBe('LUS210')
    expect(hangerFor('2x12').model).toBe('HUS212')
    expect(hangerFor('2x8', true).model).toBe('LUS28-2')
    expect(hangerFor('4x8').verify).toBe(true)
    expect(hangerFor(undefined).model).toBe('LUS series')
  })

  test('post bases and caps by post size, ZMAX on treated posts', () => {
    expect(postBaseFor('4x4').model).toBe('ABU44Z')
    expect(postBaseFor('6x6').model).toBe('ABU66Z')
    expect(postBaseFor('4x4', false).model).toBe('ABU44')
    expect(postCapFor('4x4').model).toBe('AC4Z')
    expect(postBaseFor('2x4').verify).toBe(true)
  })

  test('labels carry the model, "or equal" and the fastening; modelOf reads them back', () => {
    const label = partLabel(hangerFor('2x8'), '2x8 joist @ girder')
    expect(label).toBe(
      'Simpson LUS28 (or equal) face-mount joist hanger — 2x8 joist @ girder; 10d common to the header, 10d×1½" to the joist (double-shear nailing)',
    )
    expect(modelOf(label)).toBe('LUS28')
    expect(modelOf('Joist hanger (LUS) @ girder')).toBeNull()
    expect(HURRICANE_TIE.model).toBe('H2.5A')
    expect(HOLD_DOWN.model).toBe('HDU2-SDS2.5')
    expect(partLabel(hangerFor('4x6'), 'beam')).toContain('VERIFY')
  })
})

describe('on the deck', () => {
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
  const deck: SlabSlice = {
    id: 'deck',
    polygon: [
      [2, 9.144],
      [2 + 16 * FT, 9.144],
      [2 + 16 * FT, 9.144 + 12 * FT],
      [2, 9.144 + 12 * FT],
    ],
    holes: [],
    elevation: 0.0246,
    thickness: 0.0381,
    kind: 'deck',
  }

  test('a high deck: LUS hangers by joist size at the ledger, an ABU44Z base at every post, an AC4Z cap under the dropped beam', () => {
    const { beam, members } = frameDeck(
      deck,
      [wall('rear', [0, 9.144], [12, 9.144])],
      DEFAULT_SPEC,
      -36 * inches(1),
    )
    expect(beam).toBe('dropped')
    const joist = roles(members, 'joist')[0]!.size as '2x8'
    for (const h of roles(members, 'hanger')) expect(modelOf(h.label)).toBe(hangerFor(joist).model)
    const posts = roles(members, 'post')
    const bases = roles(members, 'post-base')
    const caps = roles(members, 'post-cap')
    expect(bases).toHaveLength(posts.length)
    expect(caps).toHaveLength(posts.length)
    for (const b of bases) {
      expect(modelOf(b.label)).toBe('ABU44Z')
      expect(b.position[1] - b.dims[1] / 2).toBeCloseTo(-36 * inches(1), 6)
    }
    for (const c of caps) expect(modelOf(c.label)).toBe('AC4Z')
  })

  test('a low deck (flush beam) gets bases but no caps', () => {
    const { beam, members } = frameDeck(
      deck,
      [wall('rear', [0, 9.144], [12, 9.144])],
      DEFAULT_SPEC,
      -18 * inches(1),
    )
    expect(beam).toBe('flush')
    expect(roles(members, 'post-base').length).toBe(roles(members, 'post').length)
    expect(roles(members, 'post-cap')).toHaveLength(0)
  })
})

describe('the takeoff books the parts by model', () => {
  const m = (over: Partial<Member>): Member => ({
    system: 'floor-framing',
    role: 'hanger',
    dims: [0.076, 0.184, 0.019],
    length: 0.076,
    position: [1, 0, 1],
    rotation: [0, 0, 0],
    material: 'steel',
    sourceId: 'slab',
    ...over,
  })
  test('hangers grouped by model most common first; post bases and caps on their own rows', () => {
    const members = [
      m({ label: partLabel(hangerFor('2x8'), 'a') }),
      m({ label: partLabel(hangerFor('2x8'), 'b') }),
      m({ label: partLabel(hangerFor('2x10'), 'c') }),
      m({ role: 'post-base', system: 'foundation', label: partLabel(postBaseFor('4x4'), 'p') }),
      m({ role: 'post-cap', label: partLabel(postCapFor('4x4'), 'p') }),
    ]
    expect(modelsSummary(members, 'hanger')).toBe('Simpson LUS28 ×2, LUS210 ×1 (or equal)')
    const rows = computeTakeoff(members, [])
    const find = (item: string) => rows.find((r) => r.item === item)
    expect(find('Joist hangers')?.quantity).toBe(3)
    expect(find('Joist hangers')?.detail).toContain('LUS28 ×2, LUS210 ×1')
    expect(find('Post bases')?.quantity).toBe(1)
    expect(find('Post bases')?.detail).toContain('ABU44Z')
    expect(find('Post caps')?.detail).toContain('AC4Z')
  })
})

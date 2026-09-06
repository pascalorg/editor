/**
 * The porch roof — a shed on a LEDGER (`metadata.roof.attach: 'high'`),
 * open at the sides (`metadata.roof.open`). What the generator's porch
 * builder writes (plugin-generate porch.ts) and what Bones must frame for
 * it: rafters that stop at the wall face and hang on the ledger, no
 * pediment studs inside the house wall, no rake studs across an open side,
 * hurricane ties at the beam only.
 */
import { describe, expect, test } from 'bun:test'
import { DEFAULT_SPEC } from '../core/spec'
import { extractRoofs, frameRoofs, type RoofSegmentSlice } from './roof-framing'

const PITCH = Math.atan(4 / 12)
const PLATE = 2.4884

function porch(over: Partial<RoofSegmentSlice> = {}): RoofSegmentSlice {
  return {
    id: 'rseg_porch',
    roofType: 'shed',
    position: [0, PLATE, 0],
    yaw: 0,
    width: 6.096,
    depth: 1.9812,
    pitch: PITCH,
    overhang: 0.3556,
    wallHeight: 0, // seated convention: the segment's origin IS the plate (beam) line
    wallThickness: 0,
    attach: 'high',
    open: true,
    ...over,
  }
}

const byRole = (members: ReturnType<typeof frameRoofs>, role: string) =>
  members.filter((m) => m.role === role)

describe('a porch shed on a ledger', () => {
  const members = frameRoofs([porch()], [], DEFAULT_SPEC)
  const rafters = byRole(members, 'rafter')
  const ledger = byRole(members, 'ledger')
  const hangers = byRole(members, 'hanger')

  test('rafters stop at the wall face — no overhang past the high edge', () => {
    expect(rafters.length).toBeGreaterThan(8)
    const cosT = Math.cos(PITCH)
    for (const r of rafters) {
      // span = depth/cos + one overhang (the low eave's); centre moved down-slope by half an overhang
      expect(r.dims[0]).toBeCloseTo(1.9812 / cosT + 0.3556, 6)
      const highEnd = (r.position[2] as number) - (r.dims[0] / 2) * cosT
      expect(highEnd).toBeCloseTo(-1.9812 / 2, 6)
      const lowEnd = (r.position[2] as number) + (r.dims[0] / 2) * cosT
      expect(lowEnd).toBeCloseTo(1.9812 / 2 + 0.3556 * cosT, 6)
    }
  })

  test('one ledger the width of the porch at the wall, its top flush with the rafter tops', () => {
    expect(ledger).toHaveLength(1)
    const l = ledger[0]!
    expect(l.dims[0]).toBeCloseTo(6.096, 9)
    expect(l.position[2]).toBeCloseTo(-1.9812 / 2 + l.dims[2] / 2, 9)
    const [, rd] = [0, l.dims[1]]
    const rafterTopAtWall =
      PLATE + rd / (2 * Math.cos(PITCH)) + 1.9812 * Math.tan(PITCH) + rd / (2 * Math.cos(PITCH))
    expect((l.position[1] as number) + rd / 2).toBeCloseTo(rafterTopAtWall, 6)
    expect(l.material).toBe('lumber')
    expect(l.label).toContain('Ledger')
  })

  test('a hanger per rafter at the ledger, ties at the beam only', () => {
    expect(hangers).toHaveLength(rafters.length)
    for (const h of hangers) expect(h.label).toContain('LUS')
    const ties = members.filter((m) => (m.label ?? '').startsWith('hurricane tie'))
    if (DEFAULT_SPEC.hurricaneTies) {
      expect(ties).toHaveLength(rafters.length)
      for (const t of ties) expect(t.position[2]).toBeCloseTo(1.9812 / 2, 6)
    } else {
      expect(ties).toHaveLength(0)
    }
  })

  test('no pediment inside the house wall, no rake studs across the open sides', () => {
    expect(members.filter((m) => m.role === 'stud')).toHaveLength(0)
  })

  test('the deck stops at the wall too', () => {
    const deck = members.filter((m) => m.role === 'sheathing')
    expect(deck.length).toBeGreaterThan(0)
    for (const d of deck) {
      const zTop = (d.position[2] as number) - (d.dims[2] / 2) * Math.cos(PITCH)
      expect(zTop).toBeGreaterThanOrEqual(-1.9812 / 2 - 1e-6)
    }
  })
})

describe('the hints ride the segment node', () => {
  test('extractRoofs reads metadata.roof.attach / open', () => {
    const nodes = {
      level_1: { id: 'level_1', type: 'level', children: ['roof_1'] },
      roof_1: {
        id: 'roof_1',
        type: 'roof',
        parentId: 'level_1',
        position: [0, 0, 0],
        rotation: 0,
        children: ['rseg_1', 'rseg_2'],
      },
      rseg_1: {
        id: 'rseg_1',
        type: 'roof-segment',
        parentId: 'roof_1',
        roofType: 'shed',
        position: [0, 2.4884, 0],
        rotation: 0,
        width: 6,
        depth: 2,
        pitch: 18.43,
        overhang: 0.35,
        wallHeight: 0,
        metadata: { roof: { role: 'porch', attach: 'high', open: true } },
      },
      rseg_2: {
        id: 'rseg_2',
        type: 'roof-segment',
        parentId: 'roof_1',
        roofType: 'gable',
        position: [0, 2.7, 0],
        rotation: 0,
        width: 10,
        depth: 8,
        pitch: 30,
        overhang: 0.35,
        wallHeight: 0,
      },
    }
    const slices = extractRoofs(nodes as never, 'level_1')
    const porchSlice = slices.find((s) => s.id === 'rseg_1')
    const plain = slices.find((s) => s.id === 'rseg_2')
    expect(porchSlice?.attach).toBe('high')
    expect(porchSlice?.open).toBe(true)
    expect(plain?.attach).toBeUndefined()
    expect(plain?.open).toBeUndefined()
  })

  test('a plain shed is unchanged: pediment and rake studs, ties at both edges, overhang both ways', () => {
    const plain = frameRoofs([porch({ attach: undefined, open: undefined })], [], DEFAULT_SPEC)
    expect(plain.filter((m) => m.role === 'stud').length).toBeGreaterThan(8)
    expect(plain.filter((m) => m.role === 'ledger')).toHaveLength(0)
    expect(plain.filter((m) => m.role === 'hanger')).toHaveLength(0)
    const r = plain.find((m) => m.role === 'rafter')!
    expect(r.dims[0]).toBeCloseTo(1.9812 / Math.cos(PITCH) + 2 * 0.3556, 6)
  })
})

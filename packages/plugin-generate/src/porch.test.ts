import { describe, expect, test } from 'bun:test'
import {
  GUARD_HEIGHT,
  MAX_RISER,
  PORCH_COVER_HEIGHT,
  PORCH_FLOOR_DROP,
  type PorchIds,
  type PorchInput,
  porchFor,
  porchRoofForm,
  riserCount,
  TREAD_RUN,
} from './porch'
import { styleFor } from './styles'

const IN = 0.0254
const FT = 0.3048

function ids(): PorchIds {
  let n = 0
  return {
    slab: 'slab_porch',
    roof: 'roof_porch',
    segment: 'rseg_porch',
    stair: 'stair_porch',
    stairSegment: 'stair-segment_porch',
    column: () => `column_${n++}`,
    fence: () => `fence_${n++}`,
  }
}

/** A 40 ft front wall along +x at z = 0, the house behind it (+z), the door 20 ft along. */
function input(over: Partial<PorchInput> = {}): PorchInput {
  return {
    policy: 'full',
    style: styleFor('farmhouse'),
    levelId: 'level_1',
    wall: { start: [0, 0], end: [40 * FT, 0], thickness: 0.17 },
    doorAt: 20 * FT,
    doorWidth: 36 * IN,
    outward: [0, -1],
    bayWidth: 26 * FT,
    floorElevation: 0.05,
    gradeY: -8 * IN,
    overhang: 14 * IN,
    wallRole: 'eave',
    ...over,
  }
}

const byType = (ops: ReturnType<typeof porchFor>['ops'], type: string) =>
  ops.filter((o) => o.node.type === type).map((o) => o.node)

describe('riserCount', () => {
  test('the code minimum, relaxed while the riser still passes 7¾ in', () => {
    expect(riserCount(0)).toBe(0)
    expect(riserCount(6 * IN)).toBe(1)
    expect(riserCount(7.75 * IN)).toBe(1)
    expect(riserCount(8 * IN)).toBe(2)
    expect(riserCount(15.5 * IN)).toBe(2)
    expect(riserCount(24 * IN)).toBe(4) // 3 would be 8 in risers
    for (const rise of [5, 9, 13, 22, 30, 41]) {
      const n = riserCount(rise * IN)
      expect((rise * IN) / n).toBeLessThanOrEqual(MAX_RISER + 1e-9)
    }
  })
})

describe('porchRoofForm', () => {
  test('follows the style: gable, hip, or a flat canopy for shed and no-porch styles', () => {
    expect(porchRoofForm(styleFor('farmhouse'), 'full')).toBe('gable')
    expect(porchRoofForm(styleFor('craftsman'), 'entry')).toBe('gable')
    expect(porchRoofForm(styleFor('ranch'), 'entry')).toBe('hip')
    expect(porchRoofForm(styleFor('modern'), 'none')).toBe('flat')
    expect(porchRoofForm(styleFor('modern-mono'), 'none')).toBe('flat')
  })
})

describe('a full farmhouse porch', () => {
  const r = porchFor(input(), ids())
  const slab = byType(r.ops, 'slab')[0]!
  const posts = byType(r.ops, 'column')
  const rails = byType(r.ops, 'fence')
  const stair = byType(r.ops, 'stair')[0]!
  const flight = byType(r.ops, 'stair-segment')[0]!
  const seg = byType(r.ops, 'roof-segment')[0]!

  test('the landing is centred on the door, outside the wall face, 4 in below the finish floor', () => {
    expect(r.summary?.widthFt).toBe(20) // bay 26 − 2 = 24 → clamped to 20
    expect(r.summary?.depthFt).toBe(7)
    const poly = slab.polygon as [number, number][]
    expect(poly).toHaveLength(4)
    const xs = poly.map((p) => p[0])
    const zs = poly.map((p) => p[1])
    expect(Math.min(...xs)).toBeCloseTo(20 * FT - 10 * FT, 6)
    expect(Math.max(...xs)).toBeCloseTo(20 * FT + 10 * FT, 6)
    expect(Math.max(...zs)).toBeCloseTo(-0.085, 6) // the wall's exterior face
    expect(Math.min(...zs)).toBeCloseTo(-0.085 - 7 * FT, 6)
    expect(slab.elevation).toBeCloseTo(0.05 - PORCH_FLOOR_DROP, 9)
  })

  test('posts at the outer corners and no more than 8 ft apart, 7 in square, standing on the porch slab', () => {
    expect(posts.length).toBe(4) // 20 ft − 2 × 6 in = 19 ft → three bays
    for (const p of posts) {
      expect(p.supportSlabId).toBe('slab_porch')
      expect(p.width).toBeCloseTo(7 * IN, 9)
      expect(p.height).toBeCloseTo(PORCH_COVER_HEIGHT + PORCH_FLOOR_DROP, 9)
      expect(p.shaftProfile).toBe('straight')
      expect((p.position as number[])[1]).toBe(0)
    }
    const xs = posts.map((p) => (p.position as number[])[0]!).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(20 * FT - 10 * FT + 6 * IN, 6)
    expect(xs[3]).toBeCloseTo(20 * FT + 10 * FT - 6 * IN, 6)
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(8 * FT + 1e-9)
  })

  test('a 36 in guard on the sides and either side of the steps, hosted on the slab', () => {
    expect(rails).toHaveLength(4)
    for (const f of rails) {
      expect(f.style).toBe('rail')
      expect(f.height).toBeCloseTo(GUARD_HEIGHT, 9)
      expect(f.supportSlabId).toBe('slab_porch')
    }
  })

  test('the flight: 6 in rise → one riser, 60 in wide, climbing toward the porch from grade', () => {
    // porch top = 0.05 − 0.1016 = −0.0516; grade −0.2032 → rise 0.1516 m (5.97 in)
    expect(r.summary?.risers).toBe(1)
    expect(stair.deckSlabId).toBe('slab_porch')
    expect(stair.totalRise).toBeCloseTo(0.1516, 6)
    expect((stair.position as number[])[1]).toBeCloseTo(-8 * IN, 9)
    expect(stair.width).toBeCloseTo(60 * IN, 9)
    expect(flight.length).toBeCloseTo(TREAD_RUN, 9)
    expect(flight.height).toBeCloseTo(0.1516, 6)
    // bottom of the flight one tread beyond the porch edge, on the door's axis
    const pos = stair.position as number[]
    expect(pos[0]).toBeCloseTo(20 * FT, 6)
    expect(pos[2]).toBeCloseTo(-0.085 - 7 * FT - TREAD_RUN, 6)
    // local +x must point into the house (+z): three.js yaw −π/2
    expect(stair.rotation).toBeCloseTo(-Math.PI / 2, 5)
    expect(stair.railingMode).toBe('none')
  })

  test('a gable porch roof on the beam line, ridge square to the wall, reaching into the house by its run', () => {
    expect(seg.roofType).toBe('gable')
    expect(seg.wallHeight).toBe(0)
    expect((seg.position as number[])[1]).toBeCloseTo(0.05 + PORCH_COVER_HEIGHT, 9)
    expect(seg.pitch).toBeCloseTo(Math.atan(6 / 12) * (180 / Math.PI), 6) // 8:12 farmhouse capped at 6:12
    expect(seg.depth).toBeCloseTo(20 * FT, 6) // across the ridge: the porch width
    expect(seg.width).toBeCloseTo(6.5 * FT + 10 * FT, 6) // along the ridge: the beam line (7 ft − 6 in) + run (half the width)
    expect(r.summary?.attach).toBe('valley')
    // ridge along z: rotation ±π/2
    expect(Math.abs(Math.cos(seg.rotation as number))).toBeLessThan(1e-5)
    const pos = seg.position as number[]
    expect(pos[0]).toBeCloseTo(20 * FT, 6)
    // centre between the beam line (−0.085 − 6.5 ft) and the reach (−0.085 + 10 ft)
    expect(pos[2]).toBeCloseTo(-0.085 + (10 * FT - 6.5 * FT) / 2, 6)
  })

  test('ops are parent-first: roof before its segment, stair before its flight', () => {
    const types = r.ops.map((o) => o.node.type)
    expect(types.indexOf('roof')).toBeLessThan(types.indexOf('roof-segment'))
    expect(types.indexOf('stair')).toBeLessThan(types.indexOf('stair-segment'))
    expect(r.warnings).toEqual([])
  })
})

describe('policy', () => {
  test('an entry porch is 8 ft, 6 ft deep, no guard, 5½ in posts; craftsman tapers them', () => {
    const r = porchFor(input({ policy: 'entry', style: styleFor('craftsman') }), ids())
    expect(r.summary?.widthFt).toBe(8)
    expect(r.summary?.depthFt).toBe(6)
    expect(byType(r.ops, 'fence')).toHaveLength(0)
    const posts = byType(r.ops, 'column')
    expect(posts).toHaveLength(2)
    expect(posts[0]!.shaftProfile).toBe('tapered')
    expect(posts[0]!.width).toBeCloseTo(5.5 * IN, 9)
  })

  test('a no-porch style still gets a covered stoop: 6 ft, 5 ft deep, two 6 in posts, flat canopy meeting the wall', () => {
    const r = porchFor(input({ policy: 'none', style: styleFor('modern') }), ids())
    expect(r.summary?.widthFt).toBe(6)
    expect(r.summary?.depthFt).toBe(5)
    expect(r.summary?.roof).toBe('flat')
    expect(byType(r.ops, 'column')).toHaveLength(2)
    expect(byType(r.ops, 'fence')).toHaveLength(0)
    const seg = byType(r.ops, 'roof-segment')[0]!
    expect(seg.roofType).toBe('flat')
    expect(seg.pitch).toBe(0)
    // the canopy box stops one overhang short of the wall so its back overhang meets the face
    expect(seg.width).toBeCloseTo(4.5 * FT - 14 * IN, 6)
  })

  test('a hip style gets a hip porch roof on an eave or hip-end wall', () => {
    const r = porchFor(input({ policy: 'entry', style: styleFor('ranch'), wallRole: 'hip-end' }), ids())
    expect(byType(r.ops, 'roof-segment')[0]!.roofType).toBe('hip')
    expect(r.summary?.attach).toBe('valley')
  })

  test('on a gable-end wall the porch roof is a shed on a ledger, open at the sides, never steeper than 4:12', () => {
    const r = porchFor(input({ wallRole: 'gable-end' }), ids())
    const seg = byType(r.ops, 'roof-segment')[0]!
    expect(r.summary?.attach).toBe('ledger')
    expect(seg.roofType).toBe('shed')
    expect(seg.pitch).toBeCloseTo(Math.atan(4 / 12) * (180 / Math.PI), 6)
    expect((seg.metadata as { roof: Record<string, unknown> }).roof).toEqual({ role: 'porch', attach: 'high', open: true })
    // the box runs from the wall face to the beam line; +z points outward (toward −z world here)
    expect(seg.width).toBeCloseTo(20 * FT, 6)
    expect(seg.depth).toBeCloseTo(6.5 * FT, 6)
    expect(Math.abs(Math.cos(seg.rotation as number) + 1)).toBeLessThan(1e-5)
    const pos = seg.position as number[]
    expect(pos[2]).toBeCloseTo(-0.085 - (6.5 * FT) / 2, 6)
    // no role at all (no auto roof) also stops at the wall
    expect(porchFor(input({ wallRole: undefined }), ids()).summary?.attach).toBe('ledger')
  })

  test('the porch never passes a house corner: it shrinks to stay centred on a door near the end', () => {
    const r = porchFor(input({ doorAt: 4 * FT }), ids())
    // 2 × (4 ft − 6 in) = 7 ft
    expect(r.summary?.widthFt).toBe(7)
    expect(r.warnings).toEqual([])
    const tight = porchFor(input({ doorAt: 2 * FT }), ids())
    expect(tight.summary?.widthFt).toBe(5) // the 5 ft floor
    expect(tight.warnings[0]).toContain('pass the corner')
  })

  test('a landing more than 30 in above grade gets a guard even on an entry porch, and the flight its rails', () => {
    const r = porchFor(
      input({ policy: 'entry', style: styleFor('cottage'), gradeY: -36 * IN }),
      ids(),
    )
    expect(r.summary?.guard).toBe(true)
    expect(byType(r.ops, 'fence').length).toBeGreaterThan(0)
    const stair = byType(r.ops, 'stair')[0]!
    expect(stair.railingMode).toBe('both')
    expect(r.summary?.risers).toBe(5) // 34 in rise → 5 risers of 6.8 in
  })

  test('at grade there are no steps and the guard has one continuous front rail', () => {
    const r = porchFor(input({ gradeY: 0.05 - PORCH_FLOOR_DROP }), ids())
    expect(byType(r.ops, 'stair')).toHaveLength(0)
    expect(byType(r.ops, 'fence')).toHaveLength(3)
  })

  test('the door wall can run the other way: the porch follows its outward normal', () => {
    // a wall along −x (start at the right), house at −z, porch out at +z
    const r = porchFor(
      input({ wall: { start: [40 * FT, 0], end: [0, 0], thickness: 0.17 }, outward: [0, 1] }),
      ids(),
    )
    const slab = byType(r.ops, 'slab')[0]!
    const zs = (slab.polygon as [number, number][]).map((p) => p[1])
    expect(Math.min(...zs)).toBeCloseTo(0.085, 6)
    expect(Math.max(...zs)).toBeCloseTo(0.085 + 7 * FT, 6)
    const stair = byType(r.ops, 'stair')[0]!
    expect(stair.rotation).toBeCloseTo(Math.PI / 2, 5)
  })
})

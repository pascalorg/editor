import { describe, expect, test } from 'bun:test'
import {
  coverGeometry,
  GUARD_HEIGHT,
  LEDGER_CLEAR,
  MAX_RISER,
  MIN_COVER_HEIGHT,
  PIERCE_MIN,
  PORCH_BAND,
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
    beam: 'slab_beam',
    ceiling: 'ceiling_porch',
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

  test('the landing is centred on the door, outside the wall face, 1½ in below the finish floor', () => {
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

  test('posts at the outer corners and flanking the steps, no bay over 8 ft, 6x6, standing on the porch slab', () => {
    // corners at ±9.5 ft, one each side of the 60 in flight (±33.75 in) — four
    // posts, the widest bay 6.7 ft
    expect(posts.length).toBe(4)
    for (const p of posts) {
      expect(p.supportSlabId).toBe('slab_porch')
      expect(p.width).toBeCloseTo(5.5 * IN, 9)
      // the shaft is the full 6x6, the same post Bones frames: square,
      // sharp-cornered, one piece — not the renderer's rounded tube
      expect(p.shaftStartScale).toBe(1)
      expect(p.shaftEndScale).toBe(1)
      expect(p.shaftCornerRadius).toBe(0)
      expect(p.edgeSoftness).toBe(0)
      expect(p.shaftSegmentCount).toBe(1)
      // to the underside of the beam band (a 6x8 under its 2x plate)
      expect(p.height).toBeCloseTo(PORCH_COVER_HEIGHT + PORCH_FLOOR_DROP - PORCH_BAND, 9)
      expect(p.shaftProfile).toBe('straight')
      expect((p.position as number[])[1]).toBe(0)
    }
    const xs = posts.map((p) => (p.position as number[])[0]!).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(20 * FT - 10 * FT + 6 * IN, 6)
    expect(xs[3]).toBeCloseTo(20 * FT + 10 * FT - 6 * IN, 6)
    for (let i = 1; i < xs.length; i++)
      expect(xs[i]! - xs[i - 1]!).toBeLessThanOrEqual(8 * FT + 1e-9)
    // the flanking pair straddles the flight with a post's half and an inch to spare
    const flank = 30 * IN + 2.75 * IN + 1 * IN
    expect(xs[1]).toBeCloseTo(20 * FT - flank, 6)
    expect(xs[2]).toBeCloseTo(20 * FT + flank, 6)
  })

  test('a 36 in guard on the sides and either side of the steps, hosted on the slab', () => {
    expect(rails).toHaveLength(4)
    for (const f of rails) {
      expect(f.style).toBe('slat') // balusters, 3.5 in gap under the 4 in-sphere rule
      expect(f.slatGap).toBeCloseTo(3.5 * IN, 9)
      expect(f.height).toBeCloseTo(GUARD_HEIGHT, 9)
      expect(f.supportSlabId).toBe('slab_porch')
    }
  })

  test('the flight: 8½ in rise → two risers, 60 in wide, climbing toward the porch from grade', () => {
    // porch top = 0.05 − 0.0381 = 0.0119; grade −0.2032 → rise 0.2151 m (8.47 in)
    expect(r.summary?.risers).toBe(2)
    expect(stair.deckSlabId).toBe('slab_porch')
    expect(stair.totalRise).toBeCloseTo(0.2151, 6)
    expect((stair.position as number[])[1]).toBeCloseTo(-8 * IN, 9)
    expect(stair.width).toBeCloseTo(60 * IN, 9)
    expect(flight.length).toBeCloseTo(2 * TREAD_RUN, 9)
    expect(flight.height).toBeCloseTo(0.2151, 6)
    // bottom of the flight two treads beyond the porch edge, on the door's axis
    const pos = stair.position as number[]
    expect(pos[0]).toBeCloseTo(20 * FT, 6)
    expect(pos[2]).toBeCloseTo(-0.085 - 7 * FT - 2 * TREAD_RUN, 6)
    // the stair's run ascends along its own +Z; yaw 0 keeps +Z on +z (into the house)
    expect(stair.rotation).toBeCloseTo(0, 5)
    expect(stair.railingMode).toBe('none')
  })

  test('a gable porch roof on the beam line, ridge square to the wall, reaching into the house by its run', () => {
    expect(seg.roofType).toBe('gable')
    // the segment's wall band IS the beam: its top the bearing line, its bottom the posts' top
    expect(seg.wallHeight).toBeCloseTo(PORCH_BAND, 9)
    expect(seg.wallThickness).toBeCloseTo(5.5 * IN, 9)
    // the cover's slab is Bones' 2x6 rafter plus its 7/16 in sheathing
    expect(seg.deckThickness).toBeCloseTo(5.5 * IN + (7 / 16) * IN, 5)
    expect((seg.position as number[])[1]).toBeCloseTo(0.05 + PORCH_COVER_HEIGHT - PORCH_BAND, 9)
    const ceiling = byType(r.ops, 'ceiling')[0]!
    expect(ceiling).toBeDefined()
    expect(ceiling.height).toBeCloseTo(0.05 + PORCH_COVER_HEIGHT - PORCH_BAND, 9)
    expect(byType(r.ops, 'slab').some((s) => s.name === 'Porch beam')).toBe(false)
    expect(seg.pitch).toBeCloseTo(Math.atan(6 / 12) * (180 / Math.PI), 6) // 8:12 farmhouse capped at 6:12
    // the beam band is centred on the post lines (Bones' girder is): across
    // the ridge the box spans the corner posts' outer faces — the 20 ft
    // landing less the 6 in insets plus one post; along the ridge it runs
    // from the front posts' outer face (7 ft − 6 in + 2¾ in) into the house
    // by one run (half the span)
    const across = 20 * FT - 12 * IN + 5.5 * IN
    const beamOut = 6.5 * FT + 2.75 * IN
    expect(seg.depth).toBeCloseTo(across, 6)
    expect(seg.width).toBeCloseTo(beamOut + across / 2, 6)
    expect(r.summary?.attach).toBe('valley')
    // ridge along z: rotation ±π/2
    expect(Math.abs(Math.cos(seg.rotation as number))).toBeLessThan(1e-5)
    const pos = seg.position as number[]
    expect(pos[0]).toBeCloseTo(20 * FT, 6)
    // centre between the beam's outer face and the reach
    expect(pos[2]).toBeCloseTo(-0.085 + (across / 2 - beamOut) / 2, 6)
    // the beam's outer face is the posts' outer face: the front band's
    // outer plane sits half a post past the post line, so a post standing
    // on the line is flush with it, never proud of the beam's end
    const posts = byType(r.ops, 'column')
    const postLine = Math.min(...posts.map((p) => (p.position as number[])[2]!))
    expect(pos[2]! - seg.width! / 2).toBeCloseTo(postLine - 2.75 * IN, 6)
  })

  test('ops are parent-first: roof before its segment, stair before its flight', () => {
    const types = r.ops.map((o) => o.node.type)
    expect(types.indexOf('roof')).toBeLessThan(types.indexOf('roof-segment'))
    expect(types.indexOf('stair')).toBeLessThan(types.indexOf('stair-segment'))
    expect(r.warnings).toEqual([])
  })
})

describe('policy', () => {
  test('an entry porch is 8 ft, 6 ft deep, no guard, 5½ in posts — the craftsman too (one sawn 6x6, no taper)', () => {
    const r = porchFor(input({ policy: 'entry', style: styleFor('craftsman') }), ids())
    expect(r.summary?.widthFt).toBe(8)
    expect(r.summary?.depthFt).toBe(6)
    expect(byType(r.ops, 'fence')).toHaveLength(0)
    const posts = byType(r.ops, 'column')
    expect(posts).toHaveLength(2)
    expect(posts[0]!.shaftProfile).toBe('straight')
    expect(posts[0]!.shaftTaper).toBe(0)
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
    // out to the posts' outer face (2¾ in past the post line), less the back overhang
    expect(seg.width).toBeCloseTo(4.5 * FT + 2.75 * IN - 14 * IN, 6)
  })

  test('a hip style gets a hip porch roof on an eave or hip-end wall', () => {
    const r = porchFor(
      input({ policy: 'entry', style: styleFor('ranch'), wallRole: 'hip-end' }),
      ids(),
    )
    expect(byType(r.ops, 'roof-segment')[0]!.roofType).toBe('hip')
    expect(r.summary?.attach).toBe('valley')
  })

  test('on a gable-end wall the porch roof is a shed on a ledger, open at the sides, never steeper than 4:12', () => {
    const r = porchFor(input({ wallRole: 'gable-end' }), ids())
    const seg = byType(r.ops, 'roof-segment')[0]!
    expect(r.summary?.attach).toBe('ledger')
    expect(seg.roofType).toBe('shed')
    expect(seg.pitch).toBeCloseTo(Math.atan(4 / 12) * (180 / Math.PI), 6)
    expect((seg.metadata as { roof: Record<string, unknown> }).roof).toEqual({
      role: 'porch',
      attach: 'high',
      open: true,
    })
    // the box runs from the wall face to the beam line; +z points outward (toward −z world here)
    expect(seg.width).toBeCloseTo(20 * FT, 6)
    expect(seg.depth).toBeCloseTo(6.5 * FT + 2.75 * IN, 6) // out to the posts' outer face
    expect(Math.abs(Math.cos(seg.rotation as number) + 1)).toBeLessThan(1e-5)
    const pos = seg.position as number[]
    expect(pos[2]).toBeCloseTo(-0.085 - (6.5 * FT + 2.75 * IN) / 2, 6)
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

  test('at grade there are no steps and the front rail runs post to post: three bays across the 19 ft post line', () => {
    const r = porchFor(input({ gradeY: 0.05 - PORCH_FLOOR_DROP }), ids())
    expect(byType(r.ops, 'stair')).toHaveLength(0)
    // two sides + the front in one section per bay (posts at ±9.5 ft and two between)
    expect(byType(r.ops, 'fence')).toHaveLength(5)
    expect(byType(r.ops, 'column')).toHaveLength(4)
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
    // outward +z: the run must climb toward −z — yaw π
    expect(Math.abs(stair.rotation as number)).toBeCloseTo(Math.PI, 5)
  })
})

describe('landing, rails and pillars by style (PlanCrafters entrance presets)', () => {
  test('a raised house gets a wood deck: decking 1 in below the threshold, a guard, wood steps', () => {
    const r = porchFor(input({ landing: 'wood', gradeY: -18 * IN }), ids())
    const deck = byType(r.ops, 'slab')[0]!
    expect(deck.name).toBe('Porch')
    expect(deck.elevation).toBeCloseTo(0.05 - 1 * IN, 9)
    // decking over the joist / rim band: a 7 ft deck shows a 2x8 rim
    expect(deck.thickness).toBeCloseTo(1.5 * IN + 7.25 * IN, 9)
    expect((deck.metadata as { decking: number }).decking).toBeCloseTo(1.5 * IN, 9)
    expect((deck.metadata as { floor: string }).floor).toBe('deck')
    expect(deck.materialPreset).toBe('library:wood-floorplank1')
    expect(r.summary?.landing).toBe('wood')
    expect(r.summary?.guard).toBe(true)
    expect(r.summary?.risers).toBe(3) // 17 in of rise
    const stair = byType(r.ops, 'stair')[0]!
    expect(stair.fillToFloor).toBe(false)
    expect(stair.materialPreset).toBe('library:wood-floorplank1')
  })

  test('the moderns get cable rail on slim posts; the rest balusters', () => {
    const modern = porchFor(
      input({ style: styleFor('modern'), policy: 'deck', landing: 'wood', gradeY: -18 * IN }),
      ids(),
    )
    expect(modern.summary?.railStyle).toBe('cable')
    const rail = byType(modern.ops, 'fence')[0]!
    expect(rail.style).toBe('horizontal')
    expect(rail.slatGap).toBeCloseTo(3 * IN, 9)
    expect(rail.postSize).toBeCloseTo(2 * IN, 9)
    expect(porchFor(input(), ids()).summary?.railStyle).toBe('baluster')
  })

  test('the stucco ranch gets 13 in stucco piers; craftsman and farmhouse square 6x6', () => {
    const ranch = porchFor(input({ style: styleFor('ranch'), policy: 'entry' }), ids())
    const pier = byType(ranch.ops, 'column')[0]!
    expect(pier.name).toBe('Porch pier')
    expect(pier.width).toBeCloseTo(13 * IN, 9)
    expect(pier.materialPreset).toBe('library:concrete-stucco')
    const craftsman = byType(
      porchFor(input({ style: styleFor('craftsman'), policy: 'entry' }), ids()).ops,
      'column',
    )[0]!
    expect(craftsman.shaftProfile).toBe('straight')
    expect(craftsman.width).toBeCloseTo(5.5 * IN, 9)
    expect(byType(porchFor(input(), ids()).ops, 'column')[0]!.width).toBeCloseTo(5.5 * IN, 9)
  })

  test("a deck's posts are one 6x6 each from the grade under them to the beam, through the deck edge; a concrete porch's stand on the slab", () => {
    const deck = porchFor(
      input({ landing: 'wood', gradeY: -18 * IN, gradeAt: (x) => (x > 20 * FT ? -24 * IN : -18 * IN) }),
      ids(),
    )
    const posts = byType(deck.ops, 'column')
    expect(posts.length).toBeGreaterThan(0)
    const beam = (byType(deck.ops, 'roof-segment')[0]!.position as number[])[1]!
    for (const p of posts) {
      const foot = (p.position as number[])[1]!
      expect(foot).toBeCloseTo((p.position as number[])[0]! > 20 * FT ? -24 * IN : -18 * IN, 9)
      // hosted on the GROUND, so the viewer never elects the deck it passes through
      expect(p.supportSlabId).toBe('ground')
      expect(p.height).toBeCloseTo(beam - foot, 6)
      expect(p.width).toBeCloseTo(5.5 * IN, 9)
    }
    const flight = byType(deck.ops, 'stair')[0]!
    expect((flight.position as number[])[1]).toBeCloseTo(-18 * IN, 9)
    // on a terrain site the ground lift IS the grade: the post and the
    // flight are authored at 0 and keep their heights
    const hill = porchFor(
      input({
        landing: 'wood',
        gradeY: -18 * IN,
        gradeAt: (x) => (x > 20 * FT ? -24 * IN : -18 * IN),
        terrain: true,
      }),
      ids(),
    )
    for (const p of byType(hill.ops, 'column')) {
      expect((p.position as number[])[1]).toBe(0)
      expect(p.supportSlabId).toBe('ground')
      expect(p.height).toBeCloseTo(beam - ((p.position as number[])[0]! > 20 * FT ? -24 * IN : -18 * IN), 6)
    }
    expect((byType(hill.ops, 'stair')[0]!.position as number[])[1]).toBe(0)
    const slab = porchFor(input({ gradeY: -18 * IN }), ids())
    for (const p of byType(slab.ops, 'column')) {
      expect(p.supportSlabId).toBe('slab_porch')
      expect((p.position as number[])[1]).toBe(0)
    }
  })
})

describe('the rear entrance', () => {
  // the rear wall runs along −x at z = 30 ft (the house is at −z), the slider 20 ft along
  const rear = (over: Partial<PorchInput> = {}) =>
    input({
      entrance: 'rear',
      wall: { start: [40 * FT, 30 * FT], end: [0, 30 * FT], thickness: 0.17 },
      doorAt: 20 * FT,
      doorWidth: 72 * IN,
      outward: [0, 1],
      bayWidth: 18 * FT,
      wallRole: 'eave',
      ...over,
    })

  test('a slab house behind a porch style: a covered concrete patio 10 × 7 ft, no guard at one riser', () => {
    const r = porchFor(rear({ policy: 'patio' }), ids())
    expect(r.summary?.entrance).toBe('rear')
    expect(r.summary?.widthFt).toBe(10)
    expect(r.summary?.depthFt).toBe(7)
    expect(r.summary?.roof).toBe('gable')
    expect(r.summary?.guard).toBe(false)
    expect(byType(r.ops, 'slab')[0]!.name).toBe('Rear patio')
    expect(byType(r.ops, 'roof-segment')[0]!.name).toBe('Rear patio gable')
    expect(byType(r.ops, 'column').length).toBe(4) // the corners and the pair flanking the step
  })

  test('a slab house behind a no-porch style: a plain landing 10 × 6 ft, no cover, no posts', () => {
    const r = porchFor(rear({ policy: 'landing', style: styleFor('modern') }), ids())
    expect(r.summary?.roof).toBe('none')
    expect(byType(r.ops, 'roof')).toHaveLength(0)
    expect(byType(r.ops, 'column')).toHaveLength(0)
    expect(r.summary?.depthFt).toBe(6)
    expect(byType(r.ops, 'slab')[0]!.name).toBe('Rear landing')
  })

  test('a raised house: a 12 ft deep wood deck as wide as the room, guarded, covered for a porch style and bare for a modern', () => {
    const farm = porchFor(rear({ policy: 'deck', landing: 'wood', gradeY: -18 * IN }), ids())
    expect(farm.summary?.widthFt).toBe(18) // the room is 18 ft wide: max(16, min(room, 20))
    expect(farm.summary?.depthFt).toBe(12)
    expect(farm.summary?.guard).toBe(true)
    expect(farm.summary?.roof).toBe('gable')
    expect(byType(farm.ops, 'slab')[0]!.name).toBe('Rear deck')
    expect(byType(farm.ops, 'column')[0]!.width).toBeCloseTo(5.5 * IN, 9)
    const modern = porchFor(
      rear({ policy: 'deck', landing: 'wood', gradeY: -18 * IN, style: styleFor('modern') }),
      ids(),
    )
    expect(modern.summary?.roof).toBe('none')
    expect(byType(modern.ops, 'column')).toHaveLength(0)
    expect(modern.summary?.railStyle).toBe('cable')
  })
})

describe('the cover sized against the house roof (W19b)', () => {
  const plate = 0.05 + 9 * FT // a 9 ft plate over the house floor at 0.05
  const tan4 = 4 / 12

  test('a hip porch on a 9 ft house sits its beam at the plate, keeps its 4:12, and runs in to the pierce point plus one run', () => {
    const r = porchFor(
      input({
        policy: 'entry',
        style: styleFor('ranch'),
        wallRole: 'eave',
        housePlateY: plate,
        housePitch: 4,
      }),
      ids(),
    )
    const seg = byType(r.ops, 'roof-segment')[0]!
    expect(seg.roofType).toBe('hip')
    // entry porch: 8 ft wide, 6 ft deep, beam 6 in inside the edge; the box
    // spans the piers' outer faces (the stucco ranch's 13 in piers: run =
    // half of 8 ft − 12 in + 13 in) and runs out to the front piers' outer face
    const run = (8 * FT - 12 * IN + 13 * IN) / 2
    const beamLine = 6 * FT - 6 * IN + 6.5 * IN
    // the 9 ft porch ceiling IS the 9 ft plate: the beam level with it, and at
    // the ranch's own 4:12 the ridge pierces the same 4:12 slope one run in
    expect(plate).toBeCloseTo(0.05 + PORCH_COVER_HEIGHT, 9)
    expect(seg.pitch).toBeCloseTo(Math.atan(4 / 12) * (180 / Math.PI), 6)
    expect(r.summary?.roofPitch).toBeCloseTo(4, 5)
    const pierce = ((run * 4) / 12) / tan4
    expect(pierce).toBeGreaterThan(PIERCE_MIN)
    expect(r.summary?.roofPierceM).toBeCloseTo(pierce, 5)
    // the box starts at the wall face; the pierce is measured from the plate line (the wall centreline)
    expect(seg.width).toBeCloseTo(beamLine + 0.17 / 2 + pierce + 0.05 + run, 5)
    expect((seg.position as number[])[1]).toBeCloseTo(plate - PORCH_BAND, 6) // the band's top at the plate
    expect(r.summary?.coverHeightIn).toBeCloseTo(108, 1)
    expect(r.warnings.some((w) => w.includes('pierces'))).toBe(false)
  })

  test('a gable porch under a tall plate lifts its beam to that plate; a shallow one that still cannot pierce 0.9 m says so', () => {
    // a 12 ft wide porch (run 6 ft) under a 10 ft plate at 8:12
    const high = 0.05 + 10 * FT
    const cover = coverGeometry(
      { floorElevation: 0.05, housePlateY: high, housePitch: 8 },
      { pitch: 8 },
      'gable',
      6 * FT,
      6 * FT,
    )
    expect(cover.pitch).toBe(6)
    // the porch beam never sits under the house plate: lifted to it
    expect(high).toBeGreaterThan(0.05 + PORCH_COVER_HEIGHT)
    expect(cover.coverY).toBeCloseTo(high, 9)
    // level with the plate, the 6:12 rise over the run pierces the 8:12 slope
    const pierce = ((6 * FT * 6) / 12) / (8 / 12)
    expect(pierce).toBeGreaterThan(PIERCE_MIN)
    expect(cover.pierce).toBeCloseTo(pierce, 6)
    expect(cover.into).toBeCloseTo(pierce + 0.05, 6)
    // under a 12:12 main roof the 8 ft entry porch's 6:12 ridge (capped) reaches only 0.6 m in — it says so
    const r = porchFor(
      input({
        policy: 'entry',
        style: styleFor('farmhouse'),
        housePlateY: high,
        housePitch: 12,
        doorAt: 6 * FT,
        wall: { start: [0, 0], end: [12 * FT, 0], thickness: 0.17 },
      }),
      ids(),
    )
    expect(r.summary?.roofPierceM ?? 0).toBeLessThan(PIERCE_MIN)
    expect(r.warnings.some((w) => w.includes('pierces the house slope only'))).toBe(true)
  })

  test('a shed cover on a gable-end wall keeps its ledger under the house plate: the beam drops under it at 1:12, lower plates drop it to the headroom floor, then a canopy', () => {
    const r = porchFor(input({ wallRole: 'gable-end', housePlateY: plate }), ids())
    const seg = byType(r.ops, 'roof-segment')[0]!
    expect(seg.roofType).toBe('shed')
    const beamLine = 7 * FT - 6 * IN + 2.75 * IN // out to the posts' outer face
    // the 9 ft porch ceiling would put the beam AT the plate — a ledger
    // cannot hang there, so the beam drops to 1:12 under the ledger line
    expect(seg.pitch).toBeCloseTo(Math.atan(1 / 12) * (180 / Math.PI), 6)
    expect((seg.position as number[])[1]).toBeCloseTo(plate - LEDGER_CLEAR - beamLine / 12, 5)
    expect(seg.depth).toBeCloseTo(beamLine, 6)
    // a deeper cover under a lower plate: the beam drops to the headroom floor at 1:12
    const low = coverGeometry(
      { floorElevation: 0.05, housePlateY: 0.05 + 8.2 * FT },
      { pitch: 8 },
      'shed',
      3,
      3.5,
    )
    expect(low.form).toBe('shed')
    expect(low.pitch).toBeCloseTo(1, 6)
    expect(low.coverY).toBeGreaterThanOrEqual(0.05 + MIN_COVER_HEIGHT - 1e-9)
    // lower still: a flat canopy
    const flat = coverGeometry(
      { floorElevation: 0.05, housePlateY: 0.05 + 7.3 * FT },
      { pitch: 8 },
      'shed',
      3,
      3.5,
    )
    expect(flat.form).toBe('flat')
  })

  test('without house data the legacy sizes hold: one run in, the style pitch, the 9 ft beam', () => {
    const cover = coverGeometry({ floorElevation: 0.05 }, { pitch: 8 }, 'hip', 1.2, 2)
    expect(cover).toEqual({
      form: 'hip',
      coverY: 0.05 + PORCH_COVER_HEIGHT,
      pitch: 6,
      into: 1.2,
      pierce: 0,
    })
  })
})

import { describe, expect, test } from 'bun:test'
import { deriveRoof, type RoofIntent } from './derive'
import { decomposeRectilinear, mergeCollinear, popSide, type Pt, traceExteriorLoop, type WallInput } from './geometry'

const PLATE = 2.7432

/** Exterior walls around a closed polygon (counter-clockwise or not — the trace does not care). */
function ring(pts: Pt[], prefix = 'w', thickness = 0.17): WallInput[] {
  return pts.map((p, i) => ({
    id: `${prefix}${i}`,
    start: p,
    end: pts[(i + 1) % pts.length] as Pt,
    thickness,
    frontSide: 'exterior',
    backSide: 'interior',
  }))
}

const intent = (over: Partial<RoofIntent> = {}): RoofIntent => ({
  form: 'gable',
  pitchTwelfths: 6,
  overhang: 0.3,
  ...over,
})

describe('the exterior loop', () => {
  test('traces a rectangle and merges a wall split by a tee', () => {
    const walls = [
      ...ring([
        [0, 0],
        [5, 0],
        [10, 0],
        [10, 6],
        [0, 6],
      ]),
      { id: 'partition', start: [5, 0], end: [5, 6], thickness: 0.11 } as WallInput,
    ]
    const loop = traceExteriorLoop(walls)
    expect(loop).not.toBeNull()
    const merged = mergeCollinear(loop!)
    expect(merged.pts).toHaveLength(4)
    const front = merged.edges.find((e) => e.wallIds.length === 2)
    expect(front?.wallIds.sort()).toEqual(['w0', 'w1'])
  })

  test('refuses walls that do not close', () => {
    const open = ring([
      [0, 0],
      [10, 0],
      [10, 6],
      [0, 6],
    ]).slice(0, 3)
    expect(traceExteriorLoop(open)).toBeNull()
  })

  test('decomposes an L into a main and a wing, largest first', () => {
    const rects = decomposeRectilinear([
      [0, 0],
      [12, 0],
      [12, 8],
      [6, 8],
      [6, 13],
      [0, 13],
    ])
    expect(rects).toHaveLength(2)
    expect(rects[0]).toEqual({ a0: 0, a1: 12, b0: 0, b1: 8 })
    expect(rects[1]).toEqual({ a0: 0, a1: 6, b0: 8, b1: 13 })
  })

  test('popSide reads a garage projecting toward the street', () => {
    // street at −b: the garage (a 6..12) sits 2 m forward of the house front (b = 0)
    const poly: Pt[] = [
      [0, 0],
      [6, 0],
      [6, -2],
      [12, -2],
      [12, 8],
      [0, 8],
    ]
    expect(popSide(poly, [0, -1])).toBeCloseTo(2, 6)
    expect(
      popSide(
        [
          [0, 0],
          [12, 0],
          [12, 8],
          [0, 8],
        ],
        [0, -1],
      ),
    ).toBe(0)
  })
})

describe('deriveRoof on a rectangle', () => {
  const walls = ring([
    [0, 0],
    [10, 0],
    [10, 6],
    [0, 6],
  ])

  test('one gable segment seated on the plate, ridge along the long side, no knee wall', () => {
    const r = deriveRoof(walls, PLATE, intent())
    expect(r.ok).toBe(true)
    expect(r.segments).toHaveLength(1)
    const s = r.segments[0]!
    expect(s.roofType).toBe('gable')
    expect(s.position).toEqual([5, PLATE, 3])
    expect(s.width).toBeCloseTo(10, 9)
    expect(s.depth).toBeCloseTo(6, 9)
    expect(s.wallHeight).toBe(0)
    expect(s.wallThickness).toBeCloseTo(0.17, 9)
    expect(s.pitch).toBeCloseTo(26.565, 2)
    expect(s.overhang).toBeCloseTo(0.3 / Math.cos(Math.atan(0.5)), 9)
    expect(Math.abs(Math.sin(s.rotation))).toBeLessThan(1e-9) // ridge along x
    expect(r.coverage).toBe(1)
  })

  test('roles: long walls carry the eaves, short walls are the gable ends', () => {
    const r = deriveRoof(walls, PLATE, intent())
    expect(r.roles).toEqual({ w0: 'eave', w1: 'gable-end', w2: 'eave', w3: 'gable-end' })
    const hip = deriveRoof(walls, PLATE, intent({ form: 'hip' }))
    expect(hip.segments[0]?.roofType).toBe('hip')
    expect(hip.roles.w1).toBe('hip-end')
  })

  test('explicit gables turn the ridge: front/back gables on a wide house run the ridge front-to-back', () => {
    const r = deriveRoof(walls, PLATE, intent({ gables: [[0, -1], [0, 1]] }))
    const s = r.segments[0]!
    expect(s.width).toBeCloseTo(6, 9)
    expect(s.depth).toBeCloseTo(10, 9)
    expect(Math.abs(Math.cos(s.rotation))).toBeLessThan(1e-9)
    expect(r.roles.w0).toBe('gable-end')
    expect(r.roles.w1).toBe('eave')
  })

  test('a shed rises away from the street: high wall at the back, sides rake', () => {
    const r = deriveRoof(walls, PLATE, intent({ form: 'shed', frontDir: [0, -1] }))
    const s = r.segments[0]!
    expect(s.roofType).toBe('shed')
    expect(s.wallHeight).toBe(0)
    // +Z of the segment points toward the street (−z): rotation π
    expect(Math.abs(Math.cos(s.rotation) + 1)).toBeLessThan(1e-9)
    expect(r.roles).toEqual({ w0: 'eave', w1: 'rake', w2: 'shed-high', w3: 'rake' })
  })

  test('a flat roof is one flat segment on the plate', () => {
    const r = deriveRoof(walls, PLATE, intent({ form: 'flat' }))
    expect(r.segments[0]?.roofType).toBe('flat')
    expect(r.segments[0]?.pitch).toBe(0)
    expect(r.roles.w0).toBe('flat')
  })

  test('a house turned on its lot keeps its own axes', () => {
    const c = Math.cos(0.4)
    const s = Math.sin(0.4)
    const rot = (p: Pt): Pt => [p[0] * c - p[1] * s + 3, p[0] * s + p[1] * c - 2]
    const corners: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 6],
      [0, 6],
    ]
    const turned = ring(corners.map(rot))
    const r = deriveRoof(turned, PLATE, intent())
    expect(r.segments).toHaveLength(1)
    expect(r.segments[0]?.width).toBeCloseTo(10, 6)
    expect(r.segments[0]?.depth).toBeCloseTo(6, 6)
    expect(r.warnings).toEqual([])
  })
})

describe('deriveRoof on an L', () => {
  // main 12 × 8 with a 6 × 5 wing off the back (+z), street at −z
  const L = ring([
    [0, 0],
    [12, 0],
    [12, 8],
    [6, 8],
    [6, 13],
    [0, 13],
  ])

  test('two masses; the wing runs into the main by its run so the planes meet', () => {
    const r = deriveRoof(L, PLATE, intent({ style: 'farmhouse' }))
    expect(r.masses).toBe(2)
    expect(r.segments).toHaveLength(2)
    const main = r.segments[0]!
    const wing = r.segments[1]!
    expect(main.width).toBeCloseTo(12, 9)
    expect(main.depth).toBeCloseTo(8, 9)
    // the wing is 6 wide (its run is 3): it reaches 3 m into the main: depth 5 + 3
    expect(wing.width).toBeCloseTo(8, 9)
    expect(wing.depth).toBeCloseTo(6, 9)
    expect(Math.abs(Math.cos(wing.rotation))).toBeLessThan(1e-9) // ridge front-to-back
    expect(wing.position[2]).toBeCloseTo(8 + 5 / 2 - 3 / 2, 9)
    expect(r.coverage).toBe(1)
  })

  test('farmhouse gables everything; ranch hips everything; cottage gables the main only', () => {
    const farm = deriveRoof(L, PLATE, intent({ style: 'farmhouse' }))
    expect(farm.segments.map((s) => s.roofType)).toEqual(['gable', 'gable'])
    const ranch = deriveRoof(L, PLATE, intent({ style: 'ranch' }))
    expect(ranch.segments.map((s) => s.roofType)).toEqual(['hip', 'hip'])
    const cottage = deriveRoof(L, PLATE, intent({ style: 'cottage' }))
    expect(cottage.segments.map((s) => s.roofType)).toEqual(['gable', 'hip'])
  })

  test('craftsman gables the main ends and hips a wing whose cap does not face the street', () => {
    const side = deriveRoof(L, PLATE, intent({ style: 'craftsman', frontDir: [1, 0] }))
    expect(side.popped).toBe(false)
    expect(side.segments.map((s) => s.roofType)).toEqual(['gable', 'hip'])
  })

  test('a wing projecting toward the street is popped massing: hip everywhere, even for a gable style', () => {
    const r = deriveRoof(L, PLATE, intent({ style: 'craftsman', frontDir: [0, 1] }))
    expect(r.popped).toBe(true)
    expect(r.segments.every((s) => s.roofType === 'hip')).toBe(true)
  })

  test('the wall roles follow the masses', () => {
    const r = deriveRoof(L, PLATE, intent({ style: 'farmhouse' }))
    expect(r.roles.w0).toBe('eave') // front of the main
    expect(r.roles.w1).toBe('gable-end') // main's right end
    expect(r.roles.w3).toBe('eave') // wing's right side runs with its ridge
    expect(r.roles.w4).toBe('gable-end') // wing's outer cap
    expect(r.roles.w5).toBe('gable-end') // main's left end (the wing's left side is collinear with it)
  })
})

describe('policy', () => {
  test('a garage popping toward the street hips everything for a gable style, and says so', () => {
    const popped = ring([
      [0, 0],
      [6, 0],
      [6, -3],
      [12, -3],
      [12, 8],
      [0, 8],
    ])
    const r = deriveRoof(popped, PLATE, intent({ style: 'farmhouse', frontDir: [0, -1] }))
    expect(r.popped).toBe(true)
    expect(r.segments.every((s) => s.roofType === 'hip')).toBe(true)
    expect(r.warnings.some((w) => w.includes('pops toward the street'))).toBe(true)
  })

  test('a shallow pop-out on a gable end rides under the continued main roof', () => {
    // main 12 × 8, a 1.5 m deep bump across 6 of the 8 m end
    const bumped = ring([
      [0, 0],
      [12, 0],
      [12, 1],
      [13.5, 1],
      [13.5, 7],
      [12, 7],
      [12, 8],
      [0, 8],
    ])
    const r = deriveRoof(bumped, PLATE, intent({ style: 'farmhouse' }))
    expect(r.masses).toBe(1)
    expect(r.segments[0]?.width).toBeCloseTo(13.5, 9)
    expect(r.coverage).toBe(1)
  })

  test('walls that do not close still get a roof, with a warning', () => {
    const open = ring([
      [0, 0],
      [10, 0],
      [10, 6],
      [0, 6],
    ]).slice(0, 3)
    const r = deriveRoof(open, PLATE, intent())
    expect(r.ok).toBe(true)
    expect(r.segments).toHaveLength(1)
    expect(r.warnings[0]).toContain('do not close')
  })

  test('deterministic: the same walls and intent give the same roof', () => {
    const walls = ring([
      [0, 0],
      [12, 0],
      [12, 8],
      [6, 8],
      [6, 13],
      [0, 13],
    ])
    const a = JSON.stringify(deriveRoof(walls, PLATE, intent({ style: 'craftsman' })))
    const b = JSON.stringify(deriveRoof(walls, PLATE, intent({ style: 'craftsman' })))
    expect(a).toBe(b)
  })
})

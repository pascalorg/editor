import { describe, expect, test } from 'bun:test'
import { type Point2D, polygonArea, polygonSignedArea } from './polygon-relations'
import {
  buildableArea,
  remapSetbacksForVertexInsert,
  remapSetbacksForVertexRemove,
  resolveSetbackDistances,
  sumRingAreas,
} from './setback-offset'

/** A square of side `a` centred on the origin, wound the way the site node winds. */
function square(a: number): Point2D[] {
  const half = a / 2
  return [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ]
}

function boundsOf(ring: Point2D[]) {
  return {
    minX: Math.min(...ring.map(([x]) => x)),
    maxX: Math.max(...ring.map(([x]) => x)),
    minZ: Math.min(...ring.map(([, z]) => z)),
    maxZ: Math.max(...ring.map(([, z]) => z)),
  }
}

describe('buildableArea', () => {
  test('a uniform setback shrinks a square by twice the distance on each axis', () => {
    const rings = buildableArea(square(20), [3, 3, 3, 3])
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(4)
    expect(sumRingAreas(rings)).toBeCloseTo((20 - 6) ** 2, 6)
  })

  test('per-edge distances land the corners where the arithmetic says', () => {
    // 40 wide (x) by 20 deep (z). Edge 0 is the -Z side, edges run positively.
    const parcel: Point2D[] = [
      [-20, -10],
      [20, -10],
      [20, 10],
      [-20, 10],
    ]
    // front 5 to the -Z road, 3 to each side, 4 to the rear.
    const rings = buildableArea(parcel, [5, 3, 4, 3])
    expect(rings).toHaveLength(1)

    const bounds = boundsOf(rings[0]!)
    expect(bounds.minZ).toBeCloseTo(-5, 9)
    expect(bounds.maxZ).toBeCloseTo(6, 9)
    expect(bounds.minX).toBeCloseTo(-17, 9)
    expect(bounds.maxX).toBeCloseTo(17, 9)
    expect(sumRingAreas(rings)).toBeCloseTo(34 * 11, 6)
  })

  test('an edge with no setback stays where it is', () => {
    const rings = buildableArea(square(20), [0, 3, 3, 3])
    expect(rings).toHaveLength(1)
    expect(boundsOf(rings[0]!).minZ).toBeCloseTo(-10, 9)
    expect(sumRingAreas(rings)).toBeCloseTo(14 * 17, 6)
  })

  test('all-zero setbacks give the parcel back unchanged', () => {
    const rings = buildableArea(square(20), [0, 0, 0, 0])
    expect(rings).toEqual([square(20)])
  })

  test('an L-shaped parcel keeps its notch instead of bow-tying', () => {
    // 20x20 square with the +X/+Z quadrant cut out.
    const parcel: Point2D[] = [
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ]
    const rings = buildableArea(parcel, [2, 2, 2, 2, 2, 2])
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(6)

    // The outer edges come in by 2 and the reflex corner goes *out* by 2, so
    // the notch grows while the envelope shrinks.
    const inset = rings[0]!
    expect(polygonArea(inset)).toBeCloseTo(16 * 16 - 10 * 10, 6)
    expect(boundsOf(inset)).toEqual({ minX: 2, maxX: 18, minZ: 2, maxZ: 18 })
  })

  test('a sharp convex corner keeps its exact mitre, however deep it lands', () => {
    // A 10° wedge: the setback corner sits d / sin(5°) ≈ 11.5 m in from the
    // apex. That is where the buildable region genuinely starts, so no limit
    // may move it — cutting it short would hand back land inside the setback.
    const apexAngle = (10 * Math.PI) / 180
    const parcel: Point2D[] = [
      [0, 0],
      [40, -40 * Math.tan(apexAngle / 2)],
      [40, 40 * Math.tan(apexAngle / 2)],
    ]

    for (const miterLimit of [1, 4, 100]) {
      const rings = buildableArea(parcel, [1, 1, 1], { miterLimit })
      expect(rings[0]).toHaveLength(3)
      expect(rings[0]![0]![0]).toBeCloseTo(1 / Math.sin(apexAngle / 2), 6)
    }
  })

  test('a reflex corner bevels once the mitre runs past the limit', () => {
    // A narrow slit cut into a square: the reflex tip's exact setback boundary
    // is an arc, and the mitre that stands in for it overshoots badly.
    const parcel: Point2D[] = [
      [-10, -10],
      [10, -10],
      [10, 10],
      [0.4, 10],
      [0, 6],
      [-0.4, 10],
      [-10, 10],
    ]

    const mitred = buildableArea(parcel, new Array(7).fill(1), { miterLimit: 100 })
    const bevelled = buildableArea(parcel, new Array(7).fill(1), { miterLimit: 4 })

    expect(mitred).toHaveLength(1)
    expect(bevelled).toHaveLength(1)
    expect(bevelled[0]!.length).toBe(mitred[0]!.length + 1)

    const deepest = (ring: Point2D[]) =>
      Math.min(...ring.filter(([x]) => Math.abs(x) < 2).map(([, z]) => z))
    // Unclamped, a 1 m setback gouges the notch ~10 m deeper than the notch is.
    expect(deepest(mitred[0]!)).toBeLessThan(0)
    // Bevelled, the exclusion stays within a metre of the notch tip at z = 6.
    expect(deepest(bevelled[0]!)).toBeGreaterThan(5)
    // The mitre over-excludes here, so trimming it can only give area back.
    expect(sumRingAreas(bevelled)).toBeGreaterThan(sumRingAreas(mitred))
  })

  test('a setback that swallows the parcel returns nothing, not NaN', () => {
    const rings = buildableArea(square(10), [6, 6, 6, 6])
    expect(rings).toEqual([])

    const lopsided = buildableArea(square(10), [9, 0, 9, 0])
    expect(lopsided).toEqual([])
    expect(sumRingAreas(lopsided)).toBe(0)
  })

  test('a waisted parcel splits into two buildable pieces', () => {
    // Two 20x18 lobes joined by a 3 m neck, which a 2 m setback from either
    // side closes. The neck's offset edges slide through each other rather than
    // crossing at an angle, which is the case a naive intersection test misses.
    const parcel: Point2D[] = [
      [-10, -20],
      [10, -20],
      [10, -2],
      [1.5, -2],
      [1.5, 2],
      [10, 2],
      [10, 20],
      [-10, 20],
      [-10, 2],
      [-1.5, 2],
      [-1.5, -2],
      [-10, -2],
    ]
    const rings = buildableArea(parcel, new Array(parcel.length).fill(2))
    expect(rings).toHaveLength(2)
    for (const ring of rings) expect(polygonSignedArea(ring)).toBeGreaterThan(0)
    expect(sumRingAreas(rings)).toBeCloseTo(2 * 16 * 14, 6)
    // Each piece sits wholly on one side of the waist.
    const sides = rings.map((ring) => Math.sign(boundsOf(ring).minZ + boundsOf(ring).maxZ))
    expect(new Set(sides).size).toBe(2)
  })

  test('a flag lot loses its access strip and keeps the rear lot', () => {
    // The strip is 3 m wide, so a 2 m setback from each side closes it — and
    // the answer has to be the rear lot, not "nothing is buildable".
    const parcel: Point2D[] = [
      [-1.5, -30],
      [1.5, -30],
      [1.5, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
      [-10, -10],
      [-1.5, -10],
    ]
    const rings = buildableArea(parcel, new Array(parcel.length).fill(2))
    expect(rings).toHaveLength(1)
    expect(sumRingAreas(rings)).toBeCloseTo(16 * 16, 6)
  })

  test('a clockwise parcel is normalised, and its distances travel with it', () => {
    const parcel: Point2D[] = [
      [-20, -10],
      [20, -10],
      [20, 10],
      [-20, 10],
    ]
    const distances = [5, 3, 4, 3]

    const forward = buildableArea(parcel, distances)
    // Reversing the ring reverses the edges: edge i of the reversed ring is
    // edge (n - 2 - i) of the original, run backwards.
    const reversedParcel = [...parcel].reverse()
    const reversedDistances = [distances[2]!, distances[1]!, distances[0]!, distances[3]!]
    const backward = buildableArea(reversedParcel, reversedDistances)

    expect(boundsOf(backward[0]!)).toEqual(boundsOf(forward[0]!))
    expect(sumRingAreas(backward)).toBeCloseTo(sumRingAreas(forward), 9)
  })

  test('tolerates a closed ring, repeated points and a missing distance', () => {
    const closed: Point2D[] = [...square(20), [-10, -10]]
    const rings = buildableArea(closed, [3, 3, 3, 3, 3])
    expect(sumRingAreas(rings)).toBeCloseTo(14 * 14, 6)

    // Short distance array: the unnamed edges simply do not move.
    const partial = buildableArea(square(20), [3])
    expect(boundsOf(partial[0]!).minZ).toBeCloseTo(-7, 9)
    expect(boundsOf(partial[0]!).maxZ).toBeCloseTo(10, 9)
  })

  test('degenerate input returns nothing rather than throwing', () => {
    expect(buildableArea([], [])).toEqual([])
    expect(
      buildableArea(
        [
          [0, 0],
          [1, 0],
        ],
        [1, 1],
      ),
    ).toEqual([])
    expect(buildableArea(square(20), [Number.NaN, 3, 3, 3])[0]).toHaveLength(4)
  })

  test('a 100-vertex parcel offsets in well under a millisecond', () => {
    const parcel: Point2D[] = Array.from({ length: 100 }, (_, index) => {
      const angle = (index / 100) * Math.PI * 2
      const radius = 50 + Math.sin(angle * 5) * 4
      return [Math.cos(angle) * radius, Math.sin(angle) * radius]
    })
    const distances = new Array(100).fill(2)

    // Warm up, then measure: this runs on every frame of a drag.
    for (let i = 0; i < 20; i++) buildableArea(parcel, distances)
    const started = performance.now()
    const runs = 50
    for (let i = 0; i < runs; i++) buildableArea(parcel, distances)
    expect((performance.now() - started) / runs).toBeLessThan(1)
  })
})

describe('resolveSetbackDistances', () => {
  test('falls back to the site default for edges nobody has touched', () => {
    expect(resolveSetbackDistances(4, { '0': { role: 'road', distance: 5 } }, 3)).toEqual([
      5, 3, 3, 3,
    ])
  })

  test('treats a missing record, a bad number and a negative as the default', () => {
    expect(resolveSetbackDistances(3, undefined, 2)).toEqual([2, 2, 2])
    expect(resolveSetbackDistances(2, { '0': { distance: Number.NaN } }, 2)).toEqual([2, 2])
    expect(resolveSetbackDistances(2, { '1': { distance: -4 } }, 2)).toEqual([2, 0])
  })
})

describe('setback re-keying', () => {
  const rules = {
    '0': { role: 'road', distance: 5 },
    '2': { role: 'rear', distance: 4 },
  }

  test('inserting a vertex slides later edges up and splits the cut edge', () => {
    // Insert into edge 0: both halves inherit the road rule, the rear moves on.
    expect(remapSetbacksForVertexInsert(rules, 0)).toEqual({
      '0': rules['0'],
      '1': rules['0'],
      '3': rules['2'],
    })

    // Insert past every rule and nothing moves.
    expect(remapSetbacksForVertexInsert(rules, 3)).toEqual(rules)
  })

  test('removing a vertex merges its two edges and pulls later ones down', () => {
    // Vertex 3 of a 4-gon merges edges 2 and 3; the rear rule survives.
    expect(remapSetbacksForVertexRemove(rules, 3, 4)).toEqual({ '0': rules['0'], '2': rules['2'] })

    // Vertex 1 merges edges 0 and 1, keeping the road rule on the merged edge.
    expect(remapSetbacksForVertexRemove(rules, 1, 4)).toEqual({ '0': rules['0'], '1': rules['2'] })
  })

  test('removing the first vertex wraps the merge onto the last edge', () => {
    // Edges 3 and 0 merge; edge 3 has no rule, so edge 0's road rule carries.
    expect(remapSetbacksForVertexRemove(rules, 0, 4)).toEqual({
      '1': rules['2'],
      '2': rules['0'],
    })
  })

  test('the re-keyed rules still describe the same edges of the new polygon', () => {
    const parcel: Point2D[] = [
      [-20, -10],
      [20, -10],
      [20, 10],
      [-20, 10],
    ]
    const before = buildableArea(parcel, resolveSetbackDistances(4, rules, 3))

    // Split the +X edge (edge 1) at its midpoint — a shape-preserving edit.
    const after = [...parcel]
    after.splice(2, 0, [20, 0])
    const shifted = remapSetbacksForVertexInsert(rules, 1)
    const afterRings = buildableArea(after, resolveSetbackDistances(5, shifted, 3))

    expect(boundsOf(afterRings[0]!)).toEqual(boundsOf(before[0]!))
  })
})

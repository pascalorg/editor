import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  bendShedBandPoint,
  getShedEdgeSibling,
  getShedPieceSurface,
  getShedSiblingTopY,
  RoofNode,
  RoofSegmentNode,
  type ShedPlanPolygon,
} from '../index'

function segment(id: string, patch: Record<string, unknown> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({
    id,
    parentId: 'roof_shed',
    roofType: 'shed',
    width: 4,
    depth: 4,
    wallHeight: 2,
    pitch: 0,
    wallThickness: 0.01,
    overhang: 0,
    deckThickness: 0.2,
    shingleThickness: 0.05,
    ...patch,
  })
}

function rectangle(x0: number, z0: number, x1: number, z1: number): ShedPlanPolygon {
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ]
}

function scene(...nodes: AnyNode[]): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

const pitch = (Math.atan(0.5) * 180) / Math.PI
const thickness = 0.12 * Math.sqrt(5)
const arc = { centerX: 0, centerZ: 10, radius: 10 }

// Analytic oracles established from the native renderer before extraction:
// a 1:2 shed rises .5 per metre toward -Z; .2 deck + .05 shingle has
// vertical thickness .2/cos(atan(.5)) + .05*cos(atan(.5)) = .12*sqrt(5).
// Joint selection retains the renderer's sampled-edge rule, not a new overlap policy.
describe('shed band coordinates', () => {
  test('quarter turns retain the annular radius on either signed side', () => {
    for (const side of [-1, 1]) {
      const descriptor = freeze({ centerX: 3, centerZ: side * 2, radius: 2 })
      const quarter = bendShedBandPoint(descriptor, 3 + Math.PI, 0)
      expect(quarter[0]).toBeCloseTo(5, 9)
      expect(quarter[1]).toBeCloseTo(side * 2, 9)
      const inner = bendShedBandPoint(descriptor, 3 + Math.PI, side)
      expect(inner[0]).toBeCloseTo(4, 9)
      expect(inner[1]).toBeCloseTo(side * 2, 9)
      expect(bendShedBandPoint(descriptor, 3, 0)).toEqual([3, 0])
    }
  })

  test('zero centerZ uses the positive-radius convention', () => {
    const point = bendShedBandPoint({ centerX: 0, centerZ: 0, radius: 2 }, Math.PI, -2)
    expect(point[0]).toBeCloseTo(2, 9)
    expect(point[1]).toBeCloseTo(0, 9)
  })
})

describe('shed edge neighbors', () => {
  const start: [number, number] = [0, -1]
  const end: [number, number] = [0, 1]
  const own = segment('rseg_own')
  const neighbor = (patch: Record<string, unknown> = {}) =>
    segment('rseg_neighbor', {
      shedFootprintPieces: [rectangle(0, -2, 2, 2)],
      ...patch,
    })

  test('requires a whole sampled edge, not only its midpoint or one endpoint', () => {
    const full = neighbor()
    expect(getShedEdgeSibling(own, start, end, scene(own, full))).toBe(full)
    const partial = neighbor({ shedFootprintPieces: [rectangle(0, -0.1, 2, 0.1)] })
    expect(getShedEdgeSibling(own, start, end, scene(own, partial))).toBeUndefined()
    expect(getShedEdgeSibling(own, start, start, scene(own, full))).toBeUndefined()
    expect(getShedEdgeSibling(own, start, end)).toBeUndefined()
  })

  test('filters self, other roofs/scopes, non-sheds and unjoined owners', () => {
    const joined = segment('rseg_own', { shedJointNeighborIds: ['joined'] })
    for (const invalid of [
      neighbor({ id: joined.id }),
      neighbor({ parentId: 'roof_other', shedJointOwnerId: 'joined' }),
      neighbor({ roofType: 'gable', shedJointOwnerId: 'joined' }),
      neighbor({ shedJointOwnerId: 'unrelated' }),
      neighbor(),
    ]) {
      expect(getShedEdgeSibling(joined, start, end, scene(invalid))).toBeUndefined()
    }
    const allowed = neighbor({ shedJointOwnerId: 'joined' })
    expect(getShedEdgeSibling(joined, start, end, scene(allowed))).toBe(allowed)
    const scoped = segment('rseg_own', { shedJointScopeId: 'level_shared' })
    const otherParent = neighbor({ parentId: 'roof_other', shedJointScopeId: 'level_shared' })
    expect(getShedEdgeSibling(scoped, start, end, scene(otherParent))).toBe(otherParent)
  })

  test('keeps first matching object order rather than choosing the highest sibling', () => {
    const low = neighbor({ id: 'rseg_low', wallHeight: 1 })
    const high = neighbor({ id: 'rseg_high', wallHeight: 9 })
    expect(getShedEdgeSibling(own, start, end, scene(low, high))).toBe(low)
    expect(getShedEdgeSibling(own, start, end, scene(high, low))).toBe(high)
  })

  test('uses managed trimmed footprints but does not invent an unmanaged rectangle', () => {
    const managed = neighbor({ shedFootprintPieces: undefined, managedByParent: true })
    expect(getShedEdgeSibling(own, start, end, scene(managed))).toBe(managed)
    const trimmed = neighbor({
      shedFootprintPieces: undefined,
      managedByParent: true,
      trim: { left: 2.5 },
    })
    expect(getShedEdgeSibling(own, start, end, scene(trimmed))).toBeUndefined()
    const unmanaged = neighbor({ shedFootprintPieces: undefined })
    expect(getShedEdgeSibling(own, start, end, scene(unmanaged))).toBeUndefined()
  })

  test('retains the small seam tolerance and its 0.2 metre cap', () => {
    for (const [gap, accepted] of [
      [0.018, true],
      [0.025, false],
    ] as const) {
      const candidate = neighbor({ shedFootprintPieces: [rectangle(gap, -2, 2, 2)] })
      expect(getShedEdgeSibling(own, start, end, scene(candidate)) !== undefined).toBe(accepted)
    }
    for (const patch of [{ overhang: 0.5 }, { wallThickness: 0.5 }, { shedSideInfillSpan: 2 }]) {
      const wideSeam = segment('rseg_own', patch)
      for (const [gap, accepted] of [
        [0.19, true],
        [0.21, false],
      ] as const) {
        const candidate = neighbor({ shedFootprintPieces: [rectangle(gap, -2, 2, 2)] })
        expect(getShedEdgeSibling(wideSeam, start, end, scene(candidate)) !== undefined).toBe(
          accepted,
        )
      }
    }
  })

  test('resolves an edge through both segment and joint-owner rotation/translation', () => {
    // Two quarter turns: local (0,z) becomes world (14,18-z).
    const transformed = segment('rseg_own', {
      position: [2, 0, 4],
      rotation: Math.PI / 2,
      shedJointFrame: { position: [10, 0, 20], rotation: Math.PI / 2 },
      shedJointScopeId: 'level_shared',
    })
    const candidate = neighbor({
      parentId: 'roof_other',
      shedJointScopeId: 'level_shared',
      shedFootprintPieces: [rectangle(13.9, 16, 16, 20)],
    })
    expect(getShedEdgeSibling(transformed, start, end, scene(candidate))).toBe(candidate)
  })
})

describe('shed top surfaces', () => {
  test('returns physical layer heights in the flat local frame without mutating inputs', () => {
    const node = freeze(segment('rseg_own', { pitch, position: [30, 40, 50], rotation: 1 }))
    const outline = freeze(rectangle(-2, -2, 2, 2))
    const before = structuredClone(outline)
    const surface = getShedPieceSurface(node, outline)
    expect(surface.verticalThickness).toBeCloseTo(thickness, 9)
    expect(surface.edgeSiblings).toEqual([undefined, undefined, undefined, undefined])
    const expected = [4 + thickness, 4 + thickness, 2 + thickness, 2 + thickness]
    expect(surface.topY).toHaveLength(expected.length)
    surface.topY.forEach((height, index) => {
      expect(height).toBeCloseTo(expected[index]!, 9)
    })
    expect(outline).toEqual(before)
  })

  test('converts sibling heights using parent roof elevations and segment transforms', () => {
    const own = segment('rseg_own', {
      parentId: 'roof_own',
      position: [2, 3, 4],
      rotation: Math.PI / 2,
    })
    const sibling = segment('rseg_sibling', {
      parentId: 'roof_sibling',
      position: [1, 1, 1],
      rotation: Math.PI / 2,
      pitch,
      wallHeight: 4,
    })
    const nodes = freeze(
      scene(
        own,
        sibling,
        RoofNode.parse({ id: 'roof_own', position: [0, 7, 0] }),
        RoofNode.parse({ id: 'roof_sibling', position: [0, 11, 0] }),
      ),
    )
    // Own (1,0) -> shared (2,3) -> sibling (-2,1); origin delta = 12 - 10.
    expect(getShedSiblingTopY(own, sibling, [1, 0], nodes)).toBeCloseTo(6.5 + thickness, 9)
  })

  test('joint frames override parent origins and transform into the sibling frame', () => {
    const own = segment('rseg_own', {
      parentId: 'roof_own',
      position: [2, 3, 4],
      rotation: Math.PI / 2,
      shedJointFrame: { position: [10, 7, 20], rotation: Math.PI / 2 },
    })
    const sibling = segment('rseg_sibling', {
      parentId: 'roof_sibling',
      position: [0, 1, 0],
      depth: 8,
      pitch,
      wallHeight: 4,
      shedJointFrame: { position: [10, 11, 20], rotation: Math.PI / 2 },
    })
    const nodes = scene(
      own,
      sibling,
      RoofNode.parse({ id: 'roof_own', position: [0, 100, 0] }),
      RoofNode.parse({ id: 'roof_sibling', position: [0, -100, 0] }),
    )
    // Own (1,0) -> world (13,18) -> sibling (2,3), origin delta remains 2.
    expect(getShedSiblingTopY(own, sibling, [1, 0], nodes)).toBeCloseTo(6.5 + thickness, 9)
  })

  test('unbends curved sibling coordinates before evaluating its slope', () => {
    const own = segment('rseg_own')
    const sibling = segment('rseg_sibling', {
      pitch,
      arc,
      shedJointFrame: { position: [0, 0, 0], rotation: 0 },
    })
    // (6,2) is radius 10 from (0,10), hence flat-local z=0, not rendered z=2.
    expect(getShedSiblingTopY(own, sibling, [6, 2], scene(own, sibling))).toBeCloseTo(
      3 + thickness,
      9,
    )
    const curvedOwn = segment('rseg_own', {
      arc,
      shedJointFrame: { position: [0, 0, 0], rotation: 0 },
    })
    const straight = segment('rseg_straight', { pitch, depth: 40 })
    // A quarter turn maps (5pi,0) to (10,10), on the straight plane at height 7.
    expect(getShedSiblingTopY(curvedOwn, straight, [5 * Math.PI, 0], scene(straight))).toBeCloseTo(
      7 + thickness,
      9,
    )
  })

  test('pins only straight triangular patches to their curved-edge sibling', () => {
    const own = segment('rseg_own')
    const sibling = segment('rseg_sibling', {
      arc,
      wallHeight: 5,
      shedFootprintPieces: [rectangle(0, -2, 2, 2)],
    })
    const triangle: ShedPlanPolygon = [
      [0, -1],
      [0, 1],
      [-2, 0],
    ]
    const surface = getShedPieceSurface(own, triangle, freeze(scene(own, sibling)))
    expect(surface.topY).toEqual([5.25, 5.25, 2.25])
    expect(surface.edgeSiblings.map((node) => node?.id)).toEqual([sibling.id, undefined, undefined])
    const quad = getShedPieceSurface(own, rectangle(-2, -1, 0, 1), scene(sibling))
    expect(quad.topY).toEqual([2.25, 2.25, 2.25, 2.25])
    const straightSibling = { ...sibling, arc: undefined }
    expect(getShedPieceSurface(own, triangle, scene(straightSibling)).topY).toEqual([
      2.25, 2.25, 2.25,
    ])
    const band = getShedPieceSurface({ ...own, arc }, triangle, scene(sibling))
    expect(band.topY).toEqual([2.25, 2.25, 2.25])
    expect(band.edgeSiblings).toEqual([undefined, undefined, undefined])
  })

  test('later curved edges win at a shared triangle vertex in outline order', () => {
    const own = segment('rseg_own')
    const low = segment('rseg_low', {
      arc,
      wallHeight: 5,
      shedFootprintPieces: [rectangle(-1, -1, 3, 0.01)],
    })
    const high = segment('rseg_high', {
      arc,
      wallHeight: 8,
      shedFootprintPieces: [rectangle(-1, -1, 0.01, 3)],
    })
    const outline: ShedPlanPolygon = [
      [0, 0],
      [2, 0],
      [0, 2],
    ]
    const surface = getShedPieceSurface(own, outline, scene(low, high))
    expect(surface.edgeSiblings.map((node) => node?.id)).toEqual([low.id, undefined, high.id])
    expect(surface.topY).toEqual([8.25, 5.25, 8.25])
  })
})

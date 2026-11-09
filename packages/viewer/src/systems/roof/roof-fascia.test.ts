import { describe, expect, test } from 'bun:test'
import {
  LUMBER_DEPTH,
  ROOF_BUILD_UP_PRESETS,
  RoofSegmentNode,
  roofBuildUpPatch,
  roofSegmentEaveProfile,
} from '@pascal-app/core'
import * as THREE from 'three'
import { generateRoofSegmentGeometry, getRoofSegmentBrushes } from './roof-system'

/** The fascia the plane's eave rule gives it (`roofSegmentEaveProfile`): as deep as its tails need. */
const board = (node: RoofSegmentNode) => roofSegmentEaveProfile(node).fascia.height

/** A plate-seated segment the way the generator writes one (wallHeight 0, the eave hangs below the plate). */
function segment(patch: Partial<RoofSegmentNode>): RoofSegmentNode {
  return RoofSegmentNode.parse({
    fascia: true,
    roofType: 'gable',
    width: 5,
    depth: 8,
    pitch: 33.69,
    wallHeight: 0,
    wallThickness: 0.18,
    overhang: 0.55,
    deckThickness: 0.15,
    shingleThickness: 0.0127,
    ...patch,
  })
}

/**
 * Vertices of the trim-slot triangles whose centre lies outside the deck
 * along `axis` and within the span across it: the boards on that edge, not
 * the ends of the boards that meet it.
 */
function boardPoints(node: RoofSegmentNode, axis: 'x' | 'z', side: 1 | -1): THREE.Vector3[] {
  const geometry = generateRoofSegmentGeometry(node)
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const cos = Math.cos((node.pitch * Math.PI) / 180)
  const deckExt = node.wallThickness / 2 + node.overhang * cos
  const edge = (axis === 'x' ? node.width : node.depth) / 2 + deckExt
  const span = (axis === 'x' ? node.depth : node.width) / 2
  const points: THREE.Vector3[] = []
  const at = (i: number) =>
    new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i) : i)
  for (const group of geometry.groups) {
    if (group.materialIndex !== 2) continue
    for (let i = group.start; i < group.start + group.count; i += 3) {
      const tri = [at(i), at(i + 1), at(i + 2)]
      const c = tri.reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(1 / 3)
      const along = axis === 'x' ? c.x : c.z
      const across = axis === 'x' ? c.z : c.x
      if (along * side > edge + 0.005 && Math.abs(across) < span) points.push(...tri)
    }
  }
  geometry.dispose()
  return points
}

function eaveTopY(node: RoofSegmentNode): number {
  const t = (node.pitch * Math.PI) / 180
  const deckExt = node.wallThickness / 2 + node.overhang * Math.cos(t)
  return node.wallHeight - deckExt * Math.tan(t) + node.deckThickness / Math.cos(t)
}

describe('roof fascia', () => {
  test('a gable wears a plumb 1x on each eave, its top flush with the deck, as deep as its tails need, not lifted off the plate', () => {
    const node = segment({})
    // a 0.15 m deck: 0.14 m of tail under a 7/16 in sheet, the board 3/4 in or a whole 1x under it
    expect(board(node)).toBeGreaterThan(0.15 / Math.cos((node.pitch * Math.PI) / 180) + 0.006)
    for (const side of [1, -1] as const) {
      const ys = boardPoints(node, 'z', side).map((v) => v.y)
      expect(ys.length).toBeGreaterThan(0)
      expect(Math.max(...ys)).toBeCloseTo(eaveTopY(node), 3)
      expect(Math.min(...ys)).toBeCloseTo(eaveTopY(node) - board(node), 3)
    }
    // a plate-seated eave hangs below the plate
    expect(eaveTopY(node)).toBeLessThan(0)
  })

  test('the rake boards climb with the pitch to the ridge', () => {
    for (const pitch of [26.57, 45]) {
      const node = segment({ pitch })
      const t = (pitch * Math.PI) / 180
      const halfD = node.depth / 2 + node.wallThickness / 2 + node.overhang * Math.cos(t)
      const ys = boardPoints(node, 'x', 1).map((v) => v.y)
      expect(Math.max(...ys)).toBeCloseTo(eaveTopY(node) + halfD * Math.tan(t), 2)
    }
  })

  test('a gable overhang stands the rake boards out at it, the eave boards where they were', () => {
    const node = segment({ gableOverhang: 1.2 })
    const rake = node.width / 2 + node.wallThickness / 2 + 1.2
    for (const side of [1, -1] as const) {
      const xs = boardPoints(node, 'x', side).map((v) => v.x * side)
      expect(xs.length).toBeGreaterThan(0)
      expect(Math.min(...xs)).toBeGreaterThan(rake - 0.01)
      expect(Math.max(...xs)).toBeLessThan(rake + 0.03)
    }
    const ys = boardPoints(node, 'z', 1).map((v) => v.y)
    expect(Math.max(...ys)).toBeCloseTo(eaveTopY(node), 3)
  })

  test('a hip has boards on all four sides, level', () => {
    const node = segment({ roofType: 'hip' })
    for (const [axis, side] of [
      ['z', 1],
      ['z', -1],
      ['x', 1],
      ['x', -1],
    ] as const) {
      const ys = boardPoints(node, axis, side).map((v) => v.y)
      expect(ys.length).toBeGreaterThan(0)
      expect(Math.max(...ys)).toBeCloseTo(eaveTopY(node), 3)
    }
  })

  test('a shed on a ledger has no board on its high edge', () => {
    const on = segment({ roofType: 'shed', pitch: 18.43 })
    const off = segment({ roofType: 'shed', pitch: 18.43, fasciaHighEdge: false })
    expect(boardPoints(on, 'z', -1).length).toBeGreaterThan(0)
    expect(boardPoints(off, 'z', -1)).toHaveLength(0)
    expect(boardPoints(off, 'z', 1).length).toBeGreaterThan(0)
  })

  // Hawkesbury's flat roofs wear a black band ~0.3 m tall over their edge (2026-10-03).
  test('a flat roof sized on purpose wears a band to its top, over the membrane edge', () => {
    const node = segment({ roofType: 'flat', pitch: 0, fasciaHeight: 0.3, fasciaDepth: 0.03 })
    const top = eaveTopY(node) + node.shingleThickness
    for (const [axis, side] of [
      ['z', 1],
      ['x', -1],
    ] as const) {
      const points = boardPoints(node, axis, side)
      const ys = points.map((v) => v.y)
      expect(Math.max(...ys)).toBeCloseTo(top, 3)
      expect(Math.min(...ys)).toBeCloseTo(top - 0.3, 3)
      const out = points.map((v) => Math.abs(axis === 'x' ? v.x : v.z))
      const deckEdge = (axis === 'x' ? node.width : node.depth) / 2 + 0.09 + 0.55
      expect(Math.max(...out) - deckEdge).toBeCloseTo(0.03, 3)
    }
  })

  test('a flat roof not sized wears a 1x on its deck edge, as deep as its joists need', () => {
    const node = segment({ roofType: 'flat', pitch: 0 })
    const ys = boardPoints(node, 'z', 1).map((v) => v.y)
    expect(Math.max(...ys)).toBeCloseTo(eaveTopY(node), 3)
    expect(Math.min(...ys)).toBeCloseTo(eaveTopY(node) - board(node), 3)
  })

  test('fascia off leaves the bare deck edge', () => {
    const node = segment({ fascia: false })
    expect(boardPoints(node, 'z', 1)).toHaveLength(0)
    expect(boardPoints(node, 'x', 1)).toHaveLength(0)
  })

  test('a saved segment without the field wears no boards', () => {
    const node = segment({ fascia: undefined })
    expect(boardPoints(node, 'z', 1)).toHaveLength(0)
    expect(boardPoints(node, 'x', 1)).toHaveLength(0)
  })

  /** A gable framed 2x10 @ 16 at 6/12, its eave cut `eaveCut`. */
  const framed = (eaveCut?: RoofSegmentNode['eaveCut']) => {
    const preset = ROOF_BUILD_UP_PRESETS[0]!.buildUp
    return segment({
      pitch: 26.565,
      eaveCut,
      ...roofBuildUpPatch({
        ...preset,
        structure: { system: 'rafters', size: '2x10', spacing: 0.4064 },
      }),
    })
  }

  /** The deck slab's crossings, top down, on a plumb line `s` out past the +z wall line, mid-eave. */
  function deckAt(node: RoofSegmentNode, s: number, fascia = true): number[] {
    const brushes = getRoofSegmentBrushes(node, { fascia })!
    const mesh = new THREE.Mesh(
      brushes.deckSlab.geometry,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    )
    const hits = new THREE.Raycaster(
      new THREE.Vector3(0.3, 50, node.depth / 2 + s),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(mesh)
    return hits.map((hit) => hit.point.y)
  }

  test('the deck keeps its whole depth out to the eave: no 5 cm sliver with the tails under it', () => {
    const node = framed()
    const eave = roofSegmentEaveProfile(node)
    const s = eave.reach - 0.02
    const [top, bottom] = deckAt(node, s) as [number, number]
    expect(top).toBeCloseTo(eave.top(s), 3)
    expect(bottom).toBeCloseTo(eave.under(s), 3)
    expect(top - bottom).toBeCloseTo(
      LUMBER_DEPTH['2x10'] / Math.cos(Math.atan(0.5)) + 0.011 / Math.cos(Math.atan(0.5)),
      2,
    )
  })

  test('a square cut takes the deck square to the slope, the fascia square on it', () => {
    const node = framed('square')
    const eave = roofSegmentEaveProfile(node)
    // out past the square cut's foot only the board is left
    const [foot] = eave.end.slice(1) as [[number, number]]
    const s = (foot[0] + eave.reach) / 2
    // the bare deck (no boards) ends on the cut
    const ys = deckAt(node, s, false)
    const cut = eave.end[0]![1] - ((eave.reach - s) / eave.sin) * eave.cos
    expect(Math.min(...ys)).toBeCloseTo(cut, 3)
    const points = boardPoints(node, 'z', 1)
    expect(points.length).toBeGreaterThan(0)
    // the board square to the slope: its top face in the sheathing's plane, its outer edge the
    // profile's, in from a plumb board's
    const [, frontTop] = eave.fascia.corners
    const out = Math.max(...points.map((v) => v.z)) - node.depth / 2
    expect(out).toBeCloseTo(frontTop[0], 3)
    expect(out).toBeLessThan(eave.reach + eave.fascia.thickness - 0.001)
  })

  test('plumb and level boxes the eave: a soffit level from the wall out to the fascia, its returns at the rakes', () => {
    const node = framed('plumb-level')
    const eave = roofSegmentEaveProfile(node)
    const soffit = eave.soffit!
    for (const s of [eave.wallOut + 0.05, (eave.wallOut + eave.reach) / 2, eave.reach - 0.05]) {
      const ys = deckAt(node, s)
      expect(Math.min(...ys)).toBeCloseTo(soffit.y - soffit.thickness, 3)
    }
    // the fascia drops its 3/4 in past the soffit's level
    expect(eave.fascia.corners[2][1]).toBeCloseTo(soffit.y - 0.75 * 0.0254, 6)
  })
})

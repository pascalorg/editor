import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import * as THREE from 'three'
import { generateRoofSegmentGeometry } from './roof-system'

const BOARD = 0.184

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
  test('a gable wears a plumb 1x8 on each eave, on the deck edge, not lifted off the plate', () => {
    const node = segment({})
    for (const side of [1, -1] as const) {
      const ys = boardPoints(node, 'z', side).map((v) => v.y)
      expect(ys.length).toBeGreaterThan(0)
      expect(Math.max(...ys)).toBeCloseTo(eaveTopY(node), 3)
      expect(Math.min(...ys)).toBeCloseTo(eaveTopY(node) - BOARD, 3)
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
})

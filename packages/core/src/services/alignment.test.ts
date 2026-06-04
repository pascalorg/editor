import { describe, expect, test } from 'bun:test'
import { type AlignmentAnchor, bboxAnchors, resolveAlignment } from './alignment'

function center(nodeId: string, x: number, z: number): AlignmentAnchor {
  return { nodeId, kind: 'center', x, z }
}

function corner(nodeId: string, x: number, z: number): AlignmentAnchor {
  return { nodeId, kind: 'corner', x, z }
}

describe('resolveAlignment', () => {
  test('returns empty when no candidates within threshold', () => {
    const result = resolveAlignment({
      moving: [center('m', 0, 0)],
      candidates: [center('a', 1, 1)],
      threshold: 0.5,
    })
    expect(result.guides).toEqual([])
    expect(result.snap).toBeNull()
  })

  test('snaps moving anchor onto candidate X when within threshold', () => {
    const result = resolveAlignment({
      moving: [center('m', 0.03, 5)],
      candidates: [center('a', 0, 2)],
      threshold: 0.1,
    })
    expect(result.snap).toEqual({ dx: -0.03, dz: 0 })
    expect(result.guides).toHaveLength(1)
    expect(result.guides[0]!.axis).toBe('x')
    expect(result.guides[0]!.coord).toBe(0)
    expect(result.guides[0]!.from.z).toBe(2)
    expect(result.guides[0]!.to.z).toBe(5)
  })

  test('snaps both axes when both match', () => {
    const result = resolveAlignment({
      moving: [center('m', 0.03, 0.04)],
      candidates: [center('a', 0, 0)],
      threshold: 0.1,
    })
    expect(result.snap).toEqual({ dx: -0.03, dz: -0.04 })
    expect(result.guides).toHaveLength(2)
  })

  test('picks closest candidate per axis', () => {
    const result = resolveAlignment({
      moving: [center('m', 0.08, 0)],
      candidates: [center('a', 0, 5), center('b', 0.1, 5), center('c', 0.05, 10)],
      threshold: 0.1,
    })
    // |0.1 - 0.08| = 0.02 wins over |0.05 - 0.08| = 0.03 and |0 - 0.08| = 0.08
    expect(result.snap?.dx).toBeCloseTo(0.02, 10)
    expect(result.guides[0]!.candidateNodeId).toBe('b')
  })

  test('ties on the matched axis break toward the nearest perpendicular anchor', () => {
    const result = resolveAlignment({
      moving: [corner('m', 0.02, 4)],
      candidates: [corner('far', 0, 0), corner('near', 0, 5)],
      threshold: 0.1,
    })
    // Both share X (Δx = 0.02); 'near' (z=5) is closer to the moving z=4 than
    // 'far' (z=0), so the guide connects to the nearest real anchor.
    expect(result.guides[0]!.candidateNodeId).toBe('near')
  })

  test('threshold = 0 disables alignment', () => {
    const result = resolveAlignment({
      moving: [center('m', 0, 0)],
      candidates: [center('a', 0, 0)],
      threshold: 0,
    })
    expect(result.guides).toEqual([])
    expect(result.snap).toBeNull()
  })

  test('distance is the perpendicular gap to the matched axis', () => {
    const result = resolveAlignment({
      moving: [center('m', 0.02, 3)],
      candidates: [center('a', 0, 0)],
      threshold: 0.1,
    })
    // After snap: moving at (0, 3). X guide runs along x=0 from z=0 to z=3.
    expect(result.guides[0]!.distance).toBeCloseTo(3, 10)
  })
})

describe('bboxAnchors', () => {
  test('returns 9 anchors with correct kinds and positions', () => {
    const anchors = bboxAnchors('node', 0, 0, 2, 4)
    expect(anchors).toHaveLength(9)
    const corners = anchors.filter((a) => a.kind === 'corner')
    const edges = anchors.filter((a) => a.kind === 'edge-mid')
    const centers = anchors.filter((a) => a.kind === 'center')
    expect(corners).toHaveLength(4)
    expect(edges).toHaveLength(4)
    expect(centers).toHaveLength(1)
    expect(centers[0]).toEqual({ nodeId: 'node', kind: 'center', x: 1, z: 2 })
  })
})

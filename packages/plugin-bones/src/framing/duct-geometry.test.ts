import { describe, expect, test } from 'bun:test'
import { Box3 } from 'three'
import { elbowGeometry, elbowLength, transitionGeometry } from './duct-geometry'

describe('real duct fittings (2026-09-09)', () => {
  test('a rectangular elbow enters along +x a radius before the corner and leaves along turn·z a radius past it', () => {
    const g = elbowGeometry(0.36, 0.2, 0.36, 1)
    g.computeBoundingBox()
    const b = g.boundingBox as Box3
    // the sweep fills the square between the incoming leg's end (x = −R, its
    // section across z) and the outgoing leg's start (z = R, its section across x)
    expect(b.min.x).toBeCloseTo(-0.36, 6)
    expect(b.max.x).toBeCloseTo(0.18, 6)
    expect(b.min.z).toBeCloseTo(-0.18, 6)
    expect(b.max.z).toBeCloseTo(0.36, 6)
    expect(b.max.y - b.min.y).toBeCloseTo(0.2, 6)
    const left = elbowGeometry(0.36, 0.2, 0.36, -1)
    left.computeBoundingBox()
    expect((left.boundingBox as Box3).min.z).toBeCloseTo(-0.36, 6)
    expect((left.boundingBox as Box3).max.z).toBeCloseTo(0.18, 6)
    expect(g.getIndex()?.count ?? 0).toBeGreaterThan(0)
    expect(elbowLength(0.36)).toBeCloseTo((Math.PI / 2) * 0.36, 9)
  })
  test('a round elbow is a swept circle; a transition spans its two rectangles', () => {
    const g = elbowGeometry(0.15, 0.15, 0.15, 1, true)
    g.computeBoundingBox()
    const b = g.boundingBox as Box3
    expect(b.max.y - b.min.y).toBeCloseTo(0.15, 3)
    const t = transitionGeometry(0.6, 0.6, 0.36, 0.2, 0.3)
    t.computeBoundingBox()
    const tb = t.boundingBox as Box3
    expect(tb.max.y - tb.min.y).toBeCloseTo(0.3, 6)
    expect(tb.max.x - tb.min.x).toBeCloseTo(0.6, 6)
  })
})

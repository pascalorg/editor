import { describe, expect, test } from 'bun:test'
import { buildSkylightGeometry } from '../geometry'
import { SkylightNode } from '../schema'

describe('buildSkylightGeometry (stub)', () => {
  test('returns non-empty frame + glass geometries', () => {
    const geo = buildSkylightGeometry(SkylightNode.parse({}))
    expect(geo.frame.getAttribute('position').count).toBeGreaterThan(0)
    expect(geo.glass.getAttribute('position').count).toBeGreaterThan(0)
  })

  test('frame depth = frameDepth + curbHeight when curb=true', () => {
    const withCurb = buildSkylightGeometry(SkylightNode.parse({ curb: true, curbHeight: 0.1, frameDepth: 0.08 }))
    const withoutCurb = buildSkylightGeometry(SkylightNode.parse({ curb: false, frameDepth: 0.08 }))
    // Without curb, frame is shorter overall. Compare bounding box on Y.
    withCurb.frame.computeBoundingBox()
    withoutCurb.frame.computeBoundingBox()
    const tallY = withCurb.frame.boundingBox!.max.y - withCurb.frame.boundingBox!.min.y
    const shortY = withoutCurb.frame.boundingBox!.max.y - withoutCurb.frame.boundingBox!.min.y
    expect(tallY).toBeGreaterThan(shortY)
  })

  test('width × height drive the glass footprint', () => {
    const geo = buildSkylightGeometry(SkylightNode.parse({ width: 2, height: 1.5 }))
    geo.glass.computeBoundingBox()
    const bb = geo.glass.boundingBox!
    expect(bb.max.x - bb.min.x).toBeCloseTo(2)
    expect(bb.max.z - bb.min.z).toBeCloseTo(1.5)
  })
})

import { describe, expect, test } from 'bun:test'
import {
  buildDormerGhostGeometry,
  dormerSupportsArch,
  dormerSupportsCornerRadii,
} from '../geometry'
import { DormerNode } from '../schema'

describe('buildDormerGhostGeometry (placement preview)', () => {
  test('returns a buffer geometry with position attribute', () => {
    const geo = buildDormerGhostGeometry(DormerNode.parse({}))
    expect(geo.getAttribute('position').count).toBeGreaterThan(0)
  })

  test('width / depth drive the silhouette footprint', () => {
    const geo = buildDormerGhostGeometry(DormerNode.parse({ width: 2, depth: 4, height: 1 }))
    geo.computeBoundingBox()
    const bb = geo.boundingBox!
    expect(bb.max.x - bb.min.x).toBeCloseTo(2)
    expect(bb.max.z - bb.min.z).toBeCloseTo(4)
  })

  test('roofHeight raises the gable peak', () => {
    const a = buildDormerGhostGeometry(DormerNode.parse({ roofHeight: 0.5 }))
    const b = buildDormerGhostGeometry(DormerNode.parse({ roofHeight: 1.5 }))
    a.computeBoundingBox()
    b.computeBoundingBox()
    expect(b.boundingBox!.max.y).toBeGreaterThan(a.boundingBox!.max.y)
  })
})

describe('windowShape predicates', () => {
  test('dormerSupportsArch only when windowShape=arch', () => {
    expect(dormerSupportsArch(DormerNode.parse({ windowShape: 'arch' }))).toBe(true)
    expect(dormerSupportsArch(DormerNode.parse({ windowShape: 'rounded' }))).toBe(false)
    expect(dormerSupportsArch(DormerNode.parse({ windowShape: 'rectangle' }))).toBe(false)
  })
  test('dormerSupportsCornerRadii only when windowShape=rounded', () => {
    expect(dormerSupportsCornerRadii(DormerNode.parse({ windowShape: 'rounded' }))).toBe(true)
    expect(dormerSupportsCornerRadii(DormerNode.parse({ windowShape: 'arch' }))).toBe(false)
    expect(dormerSupportsCornerRadii(DormerNode.parse({ windowShape: 'rectangle' }))).toBe(false)
  })
})

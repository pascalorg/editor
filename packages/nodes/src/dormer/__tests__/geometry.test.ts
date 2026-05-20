import { describe, expect, test } from 'bun:test'
import {
  buildDormerGeometry,
  dormerSupportsArch,
  dormerSupportsCornerRadii,
} from '../geometry'
import { DormerNode } from '../schema'

describe('buildDormerGeometry (stub)', () => {
  test('returns body + roof geometries with positions', () => {
    const geo = buildDormerGeometry(DormerNode.parse({}))
    expect(geo.body.getAttribute('position').count).toBeGreaterThan(0)
    expect(geo.roof.getAttribute('position').count).toBeGreaterThan(0)
  })

  test('width / depth drive the body footprint', () => {
    const geo = buildDormerGeometry(DormerNode.parse({ width: 2, depth: 4, height: 1 }))
    geo.body.computeBoundingBox()
    const bb = geo.body.boundingBox!
    expect(bb.max.x - bb.min.x).toBeCloseTo(2)
    expect(bb.max.z - bb.min.z).toBeCloseTo(4)
    expect(bb.max.y - bb.min.y).toBeCloseTo(1)
  })

  test('roofHeight drives the gable peak height', () => {
    const a = buildDormerGeometry(DormerNode.parse({ roofHeight: 0.5 }))
    const b = buildDormerGeometry(DormerNode.parse({ roofHeight: 1.5 }))
    a.roof.computeBoundingBox()
    b.roof.computeBoundingBox()
    expect(b.roof.boundingBox!.max.y).toBeGreaterThan(a.roof.boundingBox!.max.y)
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

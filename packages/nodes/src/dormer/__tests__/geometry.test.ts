import { describe, expect, test } from 'bun:test'
import { getRoofSegmentSurfaceY, type RoofSegmentNode } from '@pascal-app/core'
import { getDormerExposedFaces } from '../csg-geometry'
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

const hostSegment = (overrides?: Partial<RoofSegmentNode>): RoofSegmentNode =>
  ({
    object: 'node',
    id: 'rseg_fixture',
    type: 'roof-segment',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: 0,
    roofType: 'gable',
    width: 8,
    depth: 6,
    wallHeight: 0.5,
    pitch: 40,
    wallThickness: 0.1,
    deckThickness: 0.1,
    overhang: 0.3,
    shingleThickness: 0.05,
    ...overrides,
  }) as RoofSegmentNode

// Default-dims dormer resting on the host surface at (x, z) — mirrors
// `useDormerPlacement`, which anchors dormer-local Y=0 at the cursor's
// surface height.
const dormerAt = (segment: RoofSegmentNode, x: number, z: number, rotation = 0) =>
  DormerNode.parse({ position: [x, getRoofSegmentSurfaceY(segment, x, z), z], rotation })

describe('getDormerExposedFaces', () => {
  test('default dormer mid-slope on the default 40° gable shows the down-slope window', () => {
    const seg = hostSegment()
    expect(getDormerExposedFaces(dormerAt(seg, 0, 1.5), seg)).toEqual({ front: true, back: false })
  })

  test('35° gable mid-slope stays exposed (centre datum, not window bottom)', () => {
    const seg = hostSegment({ pitch: 35 })
    expect(getDormerExposedFaces(dormerAt(seg, 0, 1.5), seg).front).toBe(true)
  })

  test('eave band: face hanging past the structural eave keeps the window (no plateau)', () => {
    const seg = hostSegment()
    expect(getDormerExposedFaces(dormerAt(seg, 0, 2.8), seg).front).toBe(true)
  })

  test('on the −Z slope the back face is the exposed one', () => {
    const seg = hostSegment()
    expect(getDormerExposedFaces(dormerAt(seg, 0, -1.5), seg)).toEqual({ front: false, back: true })
  })

  test('hip end-slope: face X feeds the max(fx, fz) profile', () => {
    const seg = hostSegment({ roofType: 'hip' })
    expect(getDormerExposedFaces(dormerAt(seg, 2.5, 0, Math.PI / 2), seg)).toEqual({
      front: true,
      back: false,
    })
  })

  test('~10° pitch buries the window on both faces', () => {
    const seg = hostSegment({ pitch: 10 })
    expect(getDormerExposedFaces(dormerAt(seg, 0, 1.5), seg)).toEqual({ front: false, back: false })
  })

  test('a π yaw swaps which face is down-slope', () => {
    const seg = hostSegment()
    expect(getDormerExposedFaces(dormerAt(seg, 0, 1.5, Math.PI), seg)).toEqual({
      front: false,
      back: true,
    })
  })
})

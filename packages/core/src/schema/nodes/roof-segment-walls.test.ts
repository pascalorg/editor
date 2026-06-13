import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from './roof-segment'
import {
  getRoofSegmentWallFace,
  getRoofWallFaceFrame,
  roofFacePointToSegment,
  segmentPointToRoofWallFace,
} from './roof-segment-walls'

function segment(overrides: Partial<RoofSegmentNode> = {}): RoofSegmentNode {
  return RoofSegmentNode.parse({
    id: 'rseg_test',
    type: 'roof-segment',
    roofType: 'gable',
    width: 8,
    depth: 6,
    wallHeight: 2.6,
    wallThickness: 0.1,
    pitch: 40,
    ...overrides,
  })
}

describe('roof wall face frames', () => {
  test('frame z = 0 lands on the nominal footprint (wall mid-plane)', () => {
    const seg = segment()
    // front face, u at the face middle, v = 1, mid-plane.
    const point = roofFacePointToSegment(seg, 'front', [(8 + 0.1) / 2, 1, 0])
    expect(point[0]).toBeCloseTo(0)
    expect(point[1]).toBeCloseTo(1)
    expect(point[2]).toBeCloseTo(3) // depth / 2 — the footprint plane
  })

  test('frame +z is the outward normal on every face', () => {
    const seg = segment()
    for (const [faceId, axis, sign] of [
      ['front', 2, 1],
      ['back', 2, -1],
      ['right', 0, 1],
      ['left', 0, -1],
    ] as const) {
      const onPlane = roofFacePointToSegment(seg, faceId, [1, 1, 0])
      const pushed = roofFacePointToSegment(seg, faceId, [1, 1, 0.5])
      expect(pushed[axis] - onPlane[axis]).toBeCloseTo(0.5 * sign)
      // The other horizontal axis is unaffected by the push.
      const other = axis === 2 ? 0 : 2
      expect(pushed[other] - onPlane[other]).toBeCloseTo(0)
    }
  })

  test('face frame agrees with the hit resolver coordinates', () => {
    const seg = segment()
    // A point on the outer surface (z = +thickness/2 off the mid-plane)
    // must read back with the same u/v and dist ≈ 0 off the outer plane.
    const segLocal = roofFacePointToSegment(seg, 'right', [2.5, 1.25, 0.05])
    const { u, v, dist } = segmentPointToRoofWallFace(seg, 'right', segLocal)
    expect(u).toBeCloseTo(2.5)
    expect(v).toBeCloseTo(1.25)
    expect(dist).toBeCloseTo(0)
  })

  test('resizing the segment moves the frame, not the stored coords', () => {
    // The core live-tracking property: the same face-local point maps to
    // the new plane after a depth change — children follow by re-render.
    const before = roofFacePointToSegment(segment(), 'front', [2, 1, 0])
    const after = roofFacePointToSegment(segment({ depth: 8 }), 'front', [2, 1, 0])
    expect(before[2]).toBeCloseTo(3)
    expect(after[2]).toBeCloseTo(4)
    expect(after[1]).toBeCloseTo(before[1])
  })

  test('frame yaw matches the face descriptor yaw', () => {
    const seg = segment()
    for (const faceId of ['front', 'back', 'right', 'left'] as const) {
      expect(getRoofWallFaceFrame(seg, faceId).yaw).toBe(getRoofSegmentWallFace(seg, faceId).yaw)
    }
  })
})

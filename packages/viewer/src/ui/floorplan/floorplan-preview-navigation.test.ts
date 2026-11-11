import { describe, expect, test } from 'bun:test'
import {
  cameraAzimuthFromFloorplanRotation,
  floorplanRotationFromCameraAzimuth,
  floorplanViewBoxFromNavigationPose,
  nearestEquivalentDegrees,
  visibleFloorplanViewWidth,
} from './floorplan-preview-navigation'

describe('floorplan preview navigation', () => {
  test('keeps continuous compass rotations across the angle seam', () => {
    expect(nearestEquivalentDegrees(-179, 179)).toBe(181)
    expect(floorplanRotationFromCameraAzimuth((-179 * Math.PI) / 180, 179)).toBeCloseTo(181)
  })

  test('uses the same north-up azimuth convention as the editor', () => {
    expect(cameraAzimuthFromFloorplanRotation(0)).toBe(0)
    expect(cameraAzimuthFromFloorplanRotation(90)).toBeCloseTo(Math.PI / 2)
  })

  test('maps a camera pose to an aspect-correct centered view box', () => {
    expect(
      floorplanViewBoxFromNavigationPose(
        {
          source: '3d',
          revision: 1,
          target: [0, 0, 0],
          azimuth: 0,
          viewWidth: 20,
        },
        { x: 4, y: 3 },
        0,
        { width: 1000, height: 500 },
      ),
    ).toEqual({ x: -6, y: -2, width: 20, height: 10 })
  })

  test('reports the actual horizontal span for meet-preserved SVG view boxes', () => {
    expect(
      visibleFloorplanViewWidth({ x: 0, y: 0, width: 10, height: 10 }, { width: 200, height: 100 }),
    ).toBe(20)
  })
})

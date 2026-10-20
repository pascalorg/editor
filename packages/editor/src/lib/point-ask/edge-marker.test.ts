import { describe, expect, test } from 'bun:test'
import { edgeMarker } from './edge-marker'

// A pin whose element is out of view (spec 2.6, "work outside the view shows an edge marker"):
// the marker sits on the viewport's edge, on the line from its centre towards the pin, and points
// at it. Written first: a marker for a pin that is in view; one off the edge on the wrong side;
// a pin behind the camera sending the marker nowhere.
const VIEW = { x0: 0, y0: 0, x1: 1000, y1: 600 }

describe('edgeMarker', () => {
  test('a pin in view needs none', () => {
    expect(edgeMarker({ x: 400, y: 300 }, VIEW)).toBeNull()
  })

  test('a pin to the right sits on the right edge, level with the line to it', () => {
    const marker = edgeMarker({ x: 2000, y: 300 }, VIEW)!

    expect(marker.x).toBe(1000 - 18)
    expect(marker.y).toBeCloseTo(300, 5)
    expect(marker.angle).toBeCloseTo(0, 5)
  })

  test('a pin above points up from the top edge', () => {
    const marker = edgeMarker({ x: 500, y: -900 }, VIEW)!

    expect(marker.y).toBe(18)
    expect(marker.x).toBeCloseTo(500, 5)
    expect(marker.angle).toBeCloseTo(-90, 5)
  })

  test('a pin beyond a corner sits in that corner region, on the line from the centre', () => {
    const marker = edgeMarker({ x: 3000, y: 1800 }, VIEW)!

    expect(marker.x).toBeLessThanOrEqual(1000 - 18)
    expect(marker.y).toBeLessThanOrEqual(600 - 18)
    // On the line through the centre (500, 300) and the pin: equal slope.
    const slope = (marker.y - 300) / (marker.x - 500)
    expect(slope).toBeCloseTo((1800 - 300) / (3000 - 500), 5)
  })

  test('is always inside the inset viewport', () => {
    for (const p of [
      { x: -500, y: 1200 },
      { x: 1500, y: -300 },
      { x: 2000, y: 640 },
      { x: -50, y: 300 },
    ]) {
      const marker = edgeMarker(p, VIEW)!
      expect(marker.x).toBeGreaterThanOrEqual(18)
      expect(marker.x).toBeLessThanOrEqual(1000 - 18)
      expect(marker.y).toBeGreaterThanOrEqual(18)
      expect(marker.y).toBeLessThanOrEqual(600 - 18)
    }
  })

  test('a pin behind the camera has no direction: the marker sits at the bottom, pointing down', () => {
    const marker = edgeMarker(null, VIEW)!

    expect(marker).toEqual({ x: 500, y: 600 - 18, angle: 90 })
  })
})

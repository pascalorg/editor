import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { resolveGutterPlacement } from './index'

describe('gutter placement', () => {
  const segment = RoofSegmentNode.parse({ type: 'roof-segment', width: 6, depth: 4, overhang: 0.3 })
  test('keeps both endpoints within the eave', () => {
    const pose = resolveGutterPlacement(segment, 3, 2, 2)
    expect(pose.eaveX + pose.length / 2).toBeLessThanOrEqual(3.3)
    expect(pose.eaveZ).toBeGreaterThan(2)
  })
  test('fits an oversized run instead of crossing both corners', () => {
    const pose = resolveGutterPlacement(segment, 2, 2, 20)
    expect(pose.eaveX).toBe(0)
    expect(pose.length).toBeLessThanOrEqual(6.6)
  })
  test('grid affects only the along-eave axis and off keeps raw precision', () => {
    const raw = resolveGutterPlacement(segment, 0.37, 2, 2)
    const grid = resolveGutterPlacement(segment, 0.37, 2, 2, 0.25)
    expect(raw.eaveX).toBe(0.37)
    expect(grid.eaveX).toBe(0.25)
    expect(grid.eaveZ).toBe(raw.eaveZ)
    expect(grid.eaveY).toBe(raw.eaveY)
  })
  test('force preserves the raw center and length beyond the corner', () => {
    const pose = resolveGutterPlacement(segment, 3.37, 2, 20, 0.25, true)
    expect(pose.eaveX).toBe(3.37)
    expect(pose.length).toBe(20)
  })
  test('side eaves constrain the swapped axis', () => {
    const pose = resolveGutterPlacement({ ...segment, roofType: 'hip' }, 3, 1.9, 2)
    expect(pose.side).toBe('+X')
    expect(pose.eaveZ + pose.length / 2).toBeLessThanOrEqual(2.3)
  })
})

import { describe, expect, test } from 'bun:test'
import { RoofSegmentNode } from '@pascal-app/core'
import { RidgeVentNode, resolveRidgeVentPlacement } from './index'

const segment = RoofSegmentNode.parse({
  roofType: 'gable',
  width: 8,
  depth: 6,
  overhang: 0,
  gableOverhang: 0,
  shingleThickness: 0,
  wallThickness: 0,
})
const vent = RidgeVentNode.parse({ length: 2 })
describe('ridge vent placement', () => {
  test('keeps the whole length on the ridge, snaps along it and preserves roof offset', () => {
    const end = resolveRidgeVentPlacement(segment, vent, 4, 2)!
    expect(end.position).toEqual([3, 0, 0])
    const grid = resolveRidgeVentPlacement(segment, { ...vent, position: [0, 0.2, 0] }, 0.13, 2, {
      gridStep: 0.25,
    })!
    expect(grid.position).toEqual([0.25, 0.2, 0])
    expect(grid.surfaceY - end.surfaceY).toBeCloseTo(0.2)
    expect(resolveRidgeVentPlacement(segment, vent, 0.13, 2)!.position[0]).toBeCloseTo(0.13)
  })
  test('fits to trimmed span and rejects an oversized vent', () => {
    const roof = RoofSegmentNode.parse({ ...segment, trim: { left: 2, right: 1 } })
    const fit = resolveRidgeVentPlacement(roof, vent, 0, 0, { fit: true })!
    expect(fit.length).toBeCloseTo(5)
    expect(fit.position[0]).toBeCloseTo(0.5)
    expect(resolveRidgeVentPlacement(roof, { ...vent, length: 6 }, 0, 0)!.valid).toBe(false)
  })
  test('accounts for vent width at a diagonal trim', () => {
    const roof = RoofSegmentNode.parse({ ...segment, trim: { frontLeftX: 2, frontLeftZ: 4 } })
    const narrow = resolveRidgeVentPlacement(roof, vent, 0, 0, { fit: true })!
    const wide = resolveRidgeVentPlacement(roof, { ...vent, width: 1 }, 0, 0, { fit: true })!
    expect(wide.length).toBeLessThan(narrow.length)
  })
  test('follows a diagonal hip and Alt preserves the raw position', () => {
    const hip = RoofSegmentNode.parse({ ...segment, roofType: 'hip' })
    const placed = resolveRidgeVentPlacement(hip, { ...vent, length: 1 }, -2.5, 1.5)!
    expect(Math.abs(placed.rotation)).toBeCloseTo(Math.PI / 4)
    expect(placed.valid).toBe(true)
    expect(resolveRidgeVentPlacement(segment, vent, 0.13, 2, { free: true })!.position).toEqual([
      0.13, 0, 2,
    ])
  })
  test('does not offer ridges on flat, glazed, barrel or conical roofs', () => {
    for (const roofType of ['flat', 'barrel', 'conical'] as const)
      expect(resolveRidgeVentPlacement({ ...segment, roofType }, vent, 0, 0)).toBeNull()
    expect(resolveRidgeVentPlacement({ ...segment, roofSystem: 'glazed' }, vent, 0, 0)).toBeNull()
  })
})

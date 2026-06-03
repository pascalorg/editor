import { describe, expect, test } from 'bun:test'
import {
  formatCatalogFieldNumber,
  inferCatalogParamsFromBounds,
  type BoundsSnapshot,
} from './infer-glb-catalog-params'

describe('inferCatalogParamsFromBounds', () => {
  test('detects millimeter scale and Z-up door-like bounds', () => {
    const bounds: BoundsSnapshot = {
      size: [788, 145, 2042],
      center: [0, 0, 1021],
      min: [-394, -72.5, 0],
    }
    const result = inferCatalogParamsFromBounds(bounds)
    expect(result.scale).toEqual([0.001, 0.001, 0.001])
    expect(result.rotation[0]).toBeCloseTo(-Math.PI / 2, 4)
    expect(result.dimensions[0]).toBeCloseTo(0.788, 3)
    expect(result.dimensions[1]).toBeCloseTo(2.042, 3)
    expect(result.dimensions[2]).toBeCloseTo(0.145, 3)
  })

  test('keeps meter-scale Y-up furniture', () => {
    const bounds: BoundsSnapshot = {
      size: [0.34, 0.39, 0.27],
      center: [0, 0.195, 0],
      min: [-0.17, 0, -0.135],
    }
    const result = inferCatalogParamsFromBounds(bounds)
    expect(result.scale).toEqual([1, 1, 1])
    expect(result.rotation).toEqual([0, 0, 0])
    expect(result.dimensions).toEqual([0.34, 0.39, 0.27])
  })
})

describe('formatCatalogFieldNumber', () => {
  test('formats zero and pi/2', () => {
    expect(formatCatalogFieldNumber(0)).toBe('0')
    expect(formatCatalogFieldNumber(-Math.PI / 2)).toBe('-1.5708')
  })
})

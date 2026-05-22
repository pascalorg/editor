import { describe, expect, test } from 'bun:test'
import { buildLanternGlassGeometry, clamp01, paneSize } from '../geometry'

describe('buildLanternGlassGeometry', () => {
  test('returns non-empty geometry across topScale variants', () => {
    const flatTop = buildLanternGlassGeometry(1, 1, 0.3, 0.5)
    const pointed = buildLanternGlassGeometry(1, 1, 0.3, 0)
    expect(flatTop.getAttribute('position').count).toBeGreaterThan(0)
    expect(pointed.getAttribute('position').count).toBeGreaterThan(0)
  })

  test('lantern height drives top vertex Y', () => {
    const geo = buildLanternGlassGeometry(1, 1, 0.4, 0)
    geo.computeBoundingBox()
    expect(geo.boundingBox!.max.y).toBeCloseTo(0.4)
  })
})

describe('paneSize / clamp01 helpers', () => {
  test('paneSize floors at 0.02', () => {
    expect(paneSize(0.001)).toBe(0.02)
    expect(paneSize(1)).toBe(1)
  })

  test('clamp01 clamps to [0,1]', () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(1.5)).toBe(1)
    expect(clamp01(0.4)).toBe(0.4)
  })
})

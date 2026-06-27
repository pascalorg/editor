import { describe, expect, test } from 'bun:test'
import {
  lowerDerivedPrimitiveShape,
  normalizePrimitiveKindFromRegistry,
  primitiveCapabilitySummary,
} from './primitive-registry'

describe('primitive registry', () => {
  test('normalizes primitive aliases and advertises derived primitives', () => {
    expect(normalizePrimitiveKindFromRegistry('oval panel')).toBe('ellipse-panel')
    expect(normalizePrimitiveKindFromRegistry('truss-tower')).toBe('box')
    expect(normalizePrimitiveKindFromRegistry('truss beam')).toBe('box')
    expect(normalizePrimitiveKindFromRegistry('\u534a\u7403')).toBe('hemisphere')
    expect(normalizePrimitiveKindFromRegistry('\u534a\u5706\u5f62\u7403')).toBe('hemisphere')
    expect(normalizePrimitiveKindFromRegistry('semi sphere')).toBe('hemisphere')
    expect(normalizePrimitiveKindFromRegistry('金字塔')).toBe('pyramid')
    expect(primitiveCapabilitySummary()).toContain('pyramid -> cone')
  })

  test('lowers derived primitives to canonical renderable shapes', () => {
    const pyramid = lowerDerivedPrimitiveShape({
      kind: 'pyramid',
      position: [0, 0.5, 0],
      radius: 0.5,
      height: 1,
    })
    const ellipsoid = lowerDerivedPrimitiveShape({
      kind: 'ellipsoid',
      position: [0, 1, 0],
      length: 2,
      width: 1,
      height: 0.5,
    })

    expect(pyramid).toMatchObject({ kind: 'cone', radialSegments: 4 })
    expect(ellipsoid).toMatchObject({ kind: 'sphere', scale: [1, 0.25, 0.5] })
  })
})

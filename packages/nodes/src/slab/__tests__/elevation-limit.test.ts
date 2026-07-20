import { describe, expect, test } from 'bun:test'
import { SlabNode } from '@pascal-app/core'
import { applySlabElevationPreset, applySlabTopChange } from '../elevation-limit'

function slab(overrides: Partial<SlabNode> = {}): SlabNode {
  return SlabNode.parse({ polygon: [], ...overrides })
}

describe('applySlabTopChange', () => {
  test('stretches a grounded slab upward and downward', () => {
    const grounded = slab({ elevation: 0.1, thickness: 0.1 })

    expect(applySlabTopChange(grounded, 0.25)).toEqual({
      elevation: 0.25,
      thickness: 0.25,
      recessed: false,
    })
    expect(applySlabTopChange(grounded, 0.04)).toEqual({
      elevation: 0.04,
      thickness: 0.04,
      recessed: false,
    })
  })

  test('crosses a grounded slab into a pool and back out', () => {
    const grounded = slab({ elevation: 0.1, thickness: 0.1 })
    const intoPool = applySlabTopChange(grounded, -0.15)

    expect(intoPool).toEqual({ elevation: -0.15, recessed: true })

    const pool = { ...grounded, ...intoPool }
    expect(applySlabTopChange(pool, 0.08)).toEqual({
      elevation: 0.08,
      recessed: false,
    })
  })

  test('moves a floating deck and clamps its underside to ground', () => {
    const floating = slab({ elevation: 0.5, thickness: 0.2 })

    expect(applySlabTopChange(floating, 0.4)).toEqual({
      elevation: 0.4,
      recessed: false,
    })

    const landedChange = applySlabTopChange(floating, 0.1)
    expect(landedChange).toEqual({ elevation: 0.2, recessed: false })

    const landed = { ...floating, ...landedChange }
    expect(applySlabTopChange(landed, 0.3)).toEqual({
      elevation: 0.3,
      thickness: 0.3,
      recessed: false,
    })
  })

  test('keeps a recessed pool thickness unchanged', () => {
    const pool = slab({ elevation: -0.15, thickness: 0.08, recessed: true })

    expect(applySlabTopChange(pool, -0.3)).toEqual({
      elevation: -0.3,
      recessed: true,
    })
  })

  test('allows a grounded stretch below the edit-time minimum thickness', () => {
    const grounded = slab({ elevation: 0.01, thickness: 0.01 })

    expect(applySlabTopChange(grounded, 0.015)).toEqual({
      elevation: 0.015,
      thickness: 0.015,
      recessed: false,
    })
  })
})

test('slab elevation presets keep their explicit writes', () => {
  expect(applySlabElevationPreset(-0.15)).toEqual({ elevation: -0.15, recessed: true })
  expect(applySlabElevationPreset(0)).toEqual({
    elevation: 0,
    thickness: 0,
    recessed: false,
  })
  expect(applySlabElevationPreset(0.05)).toEqual({
    elevation: 0.05,
    thickness: 0.05,
    recessed: false,
  })
  expect(applySlabElevationPreset(0.15)).toEqual({
    elevation: 0.15,
    thickness: 0.15,
    recessed: false,
  })
})

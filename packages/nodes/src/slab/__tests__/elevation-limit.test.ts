import { describe, expect, test } from 'bun:test'
import { MIN_SLAB_THICKNESS, SlabNode } from '@pascal-app/core'
import {
  applySlabAnchorElevationChange,
  applySlabBaseElevationChange,
  applySlabElevationPreset,
  applySlabRecessDepthChange,
  applySlabThicknessChange,
  applySlabTopChange,
  getSlabAnchorElevation,
  getSlabBaseElevation,
  getSlabRecessDepth,
} from '../elevation-limit'

function slab(overrides: Partial<SlabNode> = {}): SlabNode {
  return SlabNode.parse({ polygon: [], ...overrides })
}

describe('solid slab vertical interval', () => {
  test('changes thickness upward from a grounded underside', () => {
    const grounded = slab({ elevation: 0.1, thickness: 0.1 })

    expect(applySlabThicknessChange(grounded, 0.25)).toEqual({
      elevation: 0.25,
      thickness: 0.25,
      recessed: false,
    })
    expect(getSlabBaseElevation(grounded)).toBe(0)
  })

  test('changes thickness upward from a floating underside', () => {
    const floating = slab({ elevation: 0.5, thickness: 0.2 })

    expect(applySlabThicknessChange(floating, 0.4)).toEqual({
      elevation: 0.7,
      thickness: 0.4,
      recessed: false,
    })
  })

  test('clamps thickness without moving the authored underside', () => {
    const floating = slab({ elevation: 0.5, thickness: 0.2 })

    expect(applySlabThicknessChange(floating, 0)).toEqual({
      elevation: 0.3 + MIN_SLAB_THICKNESS,
      thickness: MIN_SLAB_THICKNESS,
      recessed: false,
    })
  })

  test('moves the underside anchor without changing thickness', () => {
    const floating = slab({ elevation: 0.5, thickness: 0.2 })

    expect(applySlabBaseElevationChange(floating, 0.8)).toEqual({
      elevation: 1,
    })
  })
})

describe('applySlabTopChange', () => {
  test('moves a solid slab while preserving thickness', () => {
    const floating = slab({ elevation: 0.5, thickness: 0.2 })

    expect(applySlabTopChange(floating, 0.7)).toEqual({
      elevation: 0.7,
      recessed: false,
    })
    expect(applySlabTopChange(floating, 0.1)).toEqual({
      elevation: 0.1,
      recessed: false,
    })
    expect(getSlabBaseElevation({ ...floating, ...applySlabTopChange(floating, 0.1) })).toBeCloseTo(
      -0.1,
    )
  })

  test('keeps the grounded pool cross-zero gesture', () => {
    const grounded = slab({ elevation: 0.1, thickness: 0.1 })
    const intoPool = applySlabTopChange(grounded, -0.15)

    expect(intoPool).toEqual({ elevation: -0.15, recessed: true })

    const pool = { ...grounded, ...intoPool }
    expect(applySlabTopChange(pool, -0.3)).toEqual({
      elevation: -0.3,
      recessed: true,
    })
    expect(applySlabTopChange(pool, 0.08)).toEqual({
      elevation: 0.08,
      thickness: 0.08,
      recessed: false,
      recessedRimElevation: undefined,
    })
  })
})

describe('anchor-relative slab presets', () => {
  test('keeps a raised solid slab on its underside anchor', () => {
    const raised = slab({ elevation: 0.8, thickness: 0.2 })

    expect(getSlabAnchorElevation(raised)).toBeCloseTo(0.6)
    const standard = applySlabElevationPreset(raised, 0.05)
    expect(standard).toEqual({
      elevation: expect.any(Number),
      thickness: 0.05,
      recessed: false,
      recessedRimElevation: undefined,
    })
    expect(standard.elevation).toBeCloseTo(0.65)

    const thick = applySlabElevationPreset(raised, 0.15)
    expect(thick).toEqual({
      elevation: expect.any(Number),
      thickness: 0.15,
      recessed: false,
      recessedRimElevation: undefined,
    })
    expect(thick.elevation).toBeCloseTo(0.75)
  })

  test('sinks below the current anchor and returns to a solid without losing it', () => {
    const raised = slab({ elevation: 0.8, thickness: 0.2, fillToTerrain: true })
    const recessedPatch = applySlabElevationPreset(raised, -0.15)

    expect(recessedPatch).toEqual({
      elevation: expect.any(Number),
      recessed: true,
      recessedRimElevation: expect.any(Number),
      fillToTerrain: undefined,
    })
    expect(recessedPatch.elevation).toBeCloseTo(0.45)
    expect(recessedPatch.recessedRimElevation).toBeCloseTo(0.6)

    const recessed = { ...raised, ...recessedPatch } as SlabNode
    expect(getSlabAnchorElevation(recessed)).toBeCloseTo(0.6)
    expect(getSlabRecessDepth(recessed)).toBeCloseTo(0.15)
    const restored = applySlabElevationPreset(recessed, 0.05)
    expect(restored).toEqual({
      elevation: expect.any(Number),
      thickness: 0.05,
      recessed: false,
      recessedRimElevation: undefined,
    })
    expect(restored.elevation).toBeCloseTo(0.65)
  })

  test('moves a recessed rim and resizes its depth independently', () => {
    const recessed = slab({
      elevation: 0.45,
      recessed: true,
      recessedRimElevation: 0.6,
    })

    const moved = applySlabAnchorElevationChange(recessed, 0.8)
    expect(moved).toEqual({
      elevation: expect.any(Number),
      recessedRimElevation: 0.8,
    })
    expect(moved.elevation).toBeCloseTo(0.65)
    expect(applySlabRecessDepthChange(recessed, 0.25)).toEqual({ elevation: 0.35 })
  })
})

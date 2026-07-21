import { describe, expect, test } from 'bun:test'
import { SlabNode } from '@pascal-app/core'
import {
  applySlabElevationPreset,
  applySlabTopChange,
  SLAB_UNSTICK_THRESHOLD,
} from '../elevation-limit'

function slab(overrides: Partial<SlabNode> = {}): SlabNode {
  return SlabNode.parse({ polygon: [], ...overrides })
}

const drag = (node: SlabNode, newTop: number) => applySlabTopChange(node, newTop, { mode: 'drag' })
const panel = (node: SlabNode, newTop: number) =>
  applySlabTopChange(node, newTop, { mode: 'panel' })

describe('applySlabTopChange — drag (viewport arrow)', () => {
  test('stretches a grounded slab up to the unstick threshold', () => {
    const grounded = slab({ elevation: 0.1, thickness: 0.1 })

    expect(drag(grounded, 0.25)).toEqual({
      elevation: 0.25,
      thickness: 0.25,
      recessed: false,
    })
    expect(drag(grounded, 0.04)).toEqual({
      elevation: 0.04,
      thickness: 0.04,
      recessed: false,
    })
    // The threshold itself still stretches — unstick starts strictly past it.
    expect(drag(grounded, SLAB_UNSTICK_THRESHOLD)).toEqual({
      elevation: SLAB_UNSTICK_THRESHOLD,
      thickness: SLAB_UNSTICK_THRESHOLD,
      recessed: false,
    })
  })

  test('unsticks past the threshold: pops to the default deck thickness', () => {
    const grounded = slab({ elevation: 0.1, thickness: 0.1 })

    expect(drag(grounded, 0.55)).toEqual({
      elevation: 0.55,
      thickness: 0.05,
      recessed: false,
    })
  })

  test('crosses a grounded slab into a pool and back out', () => {
    const grounded = slab({ elevation: 0.1, thickness: 0.1 })
    const intoPool = drag(grounded, -0.15)

    expect(intoPool).toEqual({ elevation: -0.15, recessed: true })

    const pool = { ...grounded, ...intoPool }
    expect(drag(pool, 0.08)).toEqual({
      elevation: 0.08,
      recessed: false,
    })
  })

  test('moves a floating deck and clamps its underside to ground', () => {
    const floating = slab({ elevation: 0.5, thickness: 0.2 })

    expect(drag(floating, 0.4)).toEqual({
      elevation: 0.4,
      recessed: false,
    })

    const landedChange = drag(floating, 0.1)
    expect(landedChange).toEqual({ elevation: 0.2, recessed: false })

    // Landed (underside 0) → grounded again: below the threshold the way
    // back up stretches, past it the slab unsticks to the default deck.
    const landed = { ...floating, ...landedChange }
    expect(drag(landed, 0.3)).toEqual({
      elevation: 0.3,
      thickness: 0.3,
      recessed: false,
    })
    expect(drag(landed, 0.5)).toEqual({
      elevation: 0.5,
      thickness: 0.05,
      recessed: false,
    })
  })

  test('keeps a recessed pool thickness unchanged', () => {
    const pool = slab({ elevation: -0.15, thickness: 0.08, recessed: true })

    expect(drag(pool, -0.3)).toEqual({
      elevation: -0.3,
      recessed: true,
    })
  })

  test('allows a grounded stretch below the edit-time minimum thickness', () => {
    const grounded = slab({ elevation: 0.01, thickness: 0.01 })

    expect(drag(grounded, 0.015)).toEqual({
      elevation: 0.015,
      thickness: 0.015,
      recessed: false,
    })
  })
})

describe('applySlabTopChange — panel (pure placement)', () => {
  test('moves a grounded slab without coupling thickness', () => {
    // The panel never stretches: raising a grounded slab lifts the body
    // (thickness preserved by omission) instead of thickening it.
    const grounded = slab({ elevation: 0.1, thickness: 0.1 })

    expect(panel(grounded, 0.3)).toEqual({ elevation: 0.3, recessed: false })
    expect(panel(grounded, 0.55)).toEqual({ elevation: 0.55, recessed: false })
  })

  test('clamps a grounded slab at underside 0 instead of shrinking it', () => {
    const grounded = slab({ elevation: 0.2, thickness: 0.2 })

    expect(panel(grounded, 0.1)).toEqual({ elevation: 0.2, recessed: false })
  })

  test('moves a floating deck preserving thickness and clamps its underside', () => {
    const floating = slab({ elevation: 0.5, thickness: 0.2 })

    expect(panel(floating, 0.4)).toEqual({ elevation: 0.4, recessed: false })
    expect(panel(floating, 0.1)).toEqual({ elevation: 0.2, recessed: false })
  })

  test('keeps the pool cross-zero gesture', () => {
    const grounded = slab({ elevation: 0.1, thickness: 0.1 })
    const intoPool = panel(grounded, -0.15)

    expect(intoPool).toEqual({ elevation: -0.15, recessed: true })

    const pool = { ...grounded, ...intoPool }
    expect(panel(pool, -0.3)).toEqual({ elevation: -0.3, recessed: true })
    expect(panel(pool, 0.08)).toEqual({ elevation: 0.08, recessed: false })
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

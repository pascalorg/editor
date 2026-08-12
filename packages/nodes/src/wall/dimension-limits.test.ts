import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { LevelNode, WallNode } from '@pascal-app/core'
import { wallParametrics } from './parametrics'

/**
 * GUARD: no UI ceiling below what the app itself builds.
 *
 * Wall length and height, and the storey height a wall can follow, each had a
 * house-sized cap — 20 m, 6 m, 6 m — and each clamped **on write**, not merely
 * on drag:
 *
 *     linearControlValueToMeters(12,  'metric', {maxMeters: 6})  === 6
 *     linearControlValueToMeters(120, 'metric', {maxMeters: 20}) === 20
 *
 * Walls are drawn by dragging endpoints, which never passes through the panel.
 * So a 120 m warehouse perimeter run existed perfectly well until someone
 * touched the Length field — and then it was 20 m, with no error, no warning,
 * and no way to tell except by measuring. A 12 m clear height did the same
 * against 6.
 *
 * Warehouse numbers for scale: clear height 10–12 m, high-bay past 15 m,
 * perimeter runs 100–150 m. For this fork these are not edge cases.
 */

const FILES = {
  wallPanel: path.join(import.meta.dir, 'panel.tsx'),
  levelSelector: path.join(
    import.meta.dir,
    '../../../editor/src/components/ui/floating-level-selector.tsx',
  ),
}

/** Source of one `<SliderControl>`, found by its label. */
function sliderSource(file: string, label: string): string {
  const source = readFileSync(file, 'utf8')
  const start = source.indexOf(`label="${label}"`)
  expect(start).toBeGreaterThan(-1)

  const end = source.indexOf('/>', start)
  expect(end).toBeGreaterThan(start)

  return source.slice(start, end)
}

describe('duvar ve kat ölçüleri tavan dayatmıyor', () => {
  test.each([
    ['wallPanel', 'Length'],
    ['wallPanel', 'Height'],
    ['levelSelector', 'Level height'],
  ] as const)('%s / %s alanı max taşımıyor', (fileKey, label) => {
    const source = sliderSource(FILES[fileKey], label)

    expect(/\bmax=\{/.test(source)).toBe(false)
    // The write path clamps independently of the slider prop, so both have to
    // go. Removing only the prop leaves the value destroyed on commit.
    expect(source).not.toContain('maxMeters')
  })

  test('parametrik tanım da tavan taşımıyor', () => {
    const dimensions = wallParametrics.groups.find((group) => group.label === 'Dimensions')
    const height = dimensions?.fields.find((field) => field.key === 'height')

    expect(height).toBeDefined()
    expect(height && 'max' in height ? height.max : undefined).toBeUndefined()
  })

  /**
   * The floors are the half that must survive. A zero-length or zero-height
   * wall is not a wall, and a drag can reach zero in one gesture.
   */
  test.each([
    ['wallPanel', 'Length'],
    ['wallPanel', 'Height'],
  ] as const)('%s / %s alanı tabanı koruyor', (fileKey, label) => {
    expect(sliderSource(FILES[fileKey], label)).toContain('minMeters: 0.1')
  })

  /**
   * Why removing the ceilings is defensible at all: nothing downstream imposes
   * one, so every number the panel used to refuse is a number the scene can
   * already hold, save and reload.
   */
  test('şema depo ölçülerini zaten kabul ediyor', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [120, 0], height: 12 })
    expect(wall.height).toBe(12)

    expect(LevelNode.parse({ height: 12 }).height).toBe(12)
  })
})

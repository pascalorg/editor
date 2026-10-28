import { expect, test } from 'bun:test'
import { DEFAULT_UPPER_FLOOR_THICKNESS, FloorBuildUp, SlabNode } from '../schema'
import {
  DEFAULT_FLOOR_BUILD_UP,
  DEFAULT_RAISED_FLOOR_BUILD_UP,
  FLOOR_BUILD_UP_PRESETS,
  floorBuildUpMatches,
  floorBuildUpOf,
  floorBuildUpPatch,
  floorBuildUpThickness,
  floorLayerDepths,
} from './build-up'

const IN = 0.0254

test('the framed floor: ¾ in hardwood on ⅝ in plywood, 2x12 joists 16 in on centre, ½ in drywall, 13⅛ in', () => {
  expect(floorLayerDepths(DEFAULT_FLOOR_BUILD_UP)).toEqual({
    flooring: expect.closeTo(0.75 * IN, 9),
    sheathing: expect.closeTo(0.625 * IN, 9),
    joists: expect.closeTo(11.25 * IN, 9),
    ceiling: expect.closeTo(0.5 * IN, 9),
  })
  expect(DEFAULT_FLOOR_BUILD_UP.structure).toEqual({
    system: 'joists',
    size: '2x12',
    spacing: 16 * IN,
  })
  expect(floorBuildUpThickness(DEFAULT_FLOOR_BUILD_UP)).toBeCloseTo(
    DEFAULT_UPPER_FLOOR_THICKNESS,
    6,
  )
  // Over a crawl space nothing hangs under the joists.
  expect(DEFAULT_RAISED_FLOOR_BUILD_UP.ceiling).toBeUndefined()
  expect(floorBuildUpThickness(DEFAULT_RAISED_FLOOR_BUILD_UP)).toBeCloseTo(12.625 * IN, 6)
})

test('every preset parses, and its thickness is its layers', () => {
  for (const preset of FLOOR_BUILD_UP_PRESETS) {
    expect(FloorBuildUp.parse(preset.buildUp)).toEqual(preset.buildUp)
    expect(preset.buildUp.presetId).toBe(preset.id)
  }
  const ijoist = FLOOR_BUILD_UP_PRESETS.find(
    (preset) => preset.buildUp.structure.system === 'i-joists',
  )!
  expect(floorLayerDepths(ijoist.buildUp).joists).toBeCloseTo(11.875 * IN, 9)
})

test('joists take a lumber size and I-joists a depth', () => {
  expect(
    FloorBuildUp.safeParse({ structure: { system: 'joists', size: '11-7/8', spacing: 0.4 } })
      .success,
  ).toBe(false)
  expect(
    FloorBuildUp.safeParse({ structure: { system: 'i-joists', size: '2x10', spacing: 0.4 } })
      .success,
  ).toBe(false)
})

test('a layer taken out is off; a named layer keeps its name; the plate patch carries both together', () => {
  const { ceiling: _, ...exposed } = DEFAULT_FLOOR_BUILD_UP
  const named = { ...exposed, flooring: { ...exposed.flooring!, name: 'Brazilian cherry' } }
  const patch = floorBuildUpPatch(named)
  expect(patch.thickness).toBeCloseTo(12.625 * IN, 6)
  const plate = SlabNode.parse({ polygon: [], ...patch })
  expect(floorBuildUpOf(plate).flooring?.name).toBe('Brazilian cherry')
  expect(floorBuildUpMatches(plate)).toBe(true)
  // A plate without layers reads the default; its own 14 in thickness no longer matches it.
  const older = SlabNode.parse({ polygon: [], thickness: 14 * IN })
  expect(floorBuildUpOf(older)).toBe(DEFAULT_FLOOR_BUILD_UP)
  expect(floorBuildUpMatches(older)).toBe(false)
})

import { describe, expect, test } from 'bun:test'
import { type AnyNodeId, LevelNode, WallNode } from '@pascal-app/core'
import { cabinetPresetById } from '../presets'
import { CabinetNode } from '../schema'
import { runHasTwoWallConstraints } from '../run-layout'
import { resolveCompartmentTransition } from '../stack-transitions'
import {
  backAnchoredModuleZ,
  type CabinetCompartment,
  COOKTOP_DEFAULT_GAS_LAYOUT,
  COOKTOP_DEFAULT_HEIGHT,
  COOKTOP_DEFAULT_INDUCTION_LAYOUT,
  COOKTOP_STANDARD_WIDTH,
  cooktopCabinetStack,
  DISHWASHER_STANDARD_HEIGHT,
  DISHWASHER_STANDARD_WIDTH,
  FRIDGE_COLUMN_HEIGHT,
  FRIDGE_COLUMN_WIDTH,
  FRIDGE_STANDARD_DEPTH,
  FRIDGE_WIDE_WIDTH,
  fridgeCabinetStack,
  HOOD_CURVED_TOTAL_HEIGHT,
  HOOD_PYRAMID_CANOPY_HEIGHT,
  hoodCompartmentHeight,
  MICROWAVE_DEFAULT_HEIGHT,
  MICROWAVE_STANDARD_HEIGHT,
  MICROWAVE_STANDARD_WIDTH,
  minCabinetCarcassHeightForStack,
  newCabinetCompartment,
  normalizeCabinetStack,
  OVEN_DEFAULT_HEIGHT,
  PULL_OUT_PANTRY_DEFAULT_RACK_STYLE,
  PULL_OUT_PANTRY_DEFAULT_SHELF_COUNT,
  PULL_OUT_PANTRY_STANDARD_WIDTH,
  reflowCabinetRunModules,
  removeCabinetCompartmentStack,
  replaceCabinetCompartmentStack,
  resizeCabinetCompartmentStack,
  TALL_CABINET_CARCASS_HEIGHT,
} from '../stack'

const stack: CabinetCompartment[] = [
  { id: 'drawer', type: 'drawer', height: 0.44, drawerCount: 3 },
  { id: 'shelf', type: 'shelf', height: 0.2, shelfCount: 1 },
  { id: 'door', type: 'door', height: 0.56, doorType: 'double', shelfCount: 2 },
]

describe('resizeCabinetCompartmentStack', () => {
  test('keeps total height constant and redistributes remaining compartments', () => {
    const resized = resizeCabinetCompartmentStack({ width: 0.6, carcassHeight: 1.2, stack }, 0, 0.5)
    const heights = normalizeCabinetStack({ width: 0.6, carcassHeight: 1.2, stack: resized }).map(
      (row) => row.height,
    )

    expect(heights[0]).toBeCloseTo(0.5)
    expect(heights[0]! + heights[1]! + heights[2]!).toBeCloseTo(1.2)
    expect(heights[1]).toBeGreaterThanOrEqual(0.1)
    expect(heights[2]).toBeGreaterThanOrEqual(0.1)
  })

  test('clamps the edited compartment so all siblings keep a minimum height', () => {
    const resized = resizeCabinetCompartmentStack(
      { width: 0.6, carcassHeight: 0.72, stack },
      2,
      0.7,
    )
    const heights = normalizeCabinetStack({ width: 0.6, carcassHeight: 0.72, stack: resized }).map(
      (row) => row.height,
    )

    expect(heights[0]).toBeCloseTo(0.1)
    expect(heights[1]).toBeCloseTo(0.1)
    expect(heights[2]).toBeCloseTo(0.52)
    expect(heights[0]! + heights[1]! + heights[2]!).toBeCloseTo(0.72)
  })

  test('keeps fixed appliance siblings unchanged when resizing another row', () => {
    const applianceStack: CabinetCompartment[] = [
      { id: 'door', type: 'door', doorType: 'double' },
      { id: 'oven', type: 'oven', height: OVEN_DEFAULT_HEIGHT },
      { id: 'drawer', type: 'drawer', drawerCount: 1 },
    ]
    const resized = resizeCabinetCompartmentStack(
      { width: 0.6, carcassHeight: 1.2, stack: applianceStack },
      0,
      0.3,
    )

    expect(resized[1]!.height).toBeCloseTo(OVEN_DEFAULT_HEIGHT)
    const rows = normalizeCabinetStack({ width: 0.6, carcassHeight: 1.2, stack: resized })
    expect(rows[1]!.height).toBeCloseTo(OVEN_DEFAULT_HEIGHT)
    expect(rows[0]!.height + rows[1]!.height + rows[2]!.height).toBeCloseTo(1.2)
  })

  test('uses the requested height for a single flexible compartment', () => {
    const resized = resizeCabinetCompartmentStack(
      { width: 0.6, carcassHeight: 0.72, stack: [{ id: 'top', type: 'shelf' }] },
      0,
      0.42,
    )

    expect(resized[0]!.height).toBeCloseTo(0.42)
  })
})

describe('appliance compartments', () => {
  test('newCabinetCompartment seeds fixed appliance heights', () => {
    const oven = newCabinetCompartment('oven')
    const microwave = newCabinetCompartment('microwave')
    const dishwasher = newCabinetCompartment('dishwasher')
    const gasCooktop = newCabinetCompartment('cooktop-gas')
    const inductionCooktop = newCabinetCompartment('cooktop-induction')
    const pullOutPantry = newCabinetCompartment('pull-out-pantry')

    expect(oven.type).toBe('oven')
    expect(oven.height).toBe(OVEN_DEFAULT_HEIGHT)
    expect(microwave.type).toBe('microwave')
    expect(microwave.height).toBe(MICROWAVE_DEFAULT_HEIGHT)
    expect(dishwasher.type).toBe('dishwasher')
    expect(dishwasher.height).toBe(DISHWASHER_STANDARD_HEIGHT)
    expect(gasCooktop.type).toBe('cooktop-gas')
    expect(gasCooktop.height).toBe(COOKTOP_DEFAULT_HEIGHT)
    expect(gasCooktop.cooktopLayout).toBe(COOKTOP_DEFAULT_GAS_LAYOUT)
    expect(gasCooktop.cooktopBurnersOn).toBe(false)
    expect(gasCooktop.cooktopActiveBurners).toEqual([])
    expect(gasCooktop.cooktopKnobProgress).toEqual([])
    expect(gasCooktop.cooktopShowGrate).toBe(true)
    expect(inductionCooktop.type).toBe('cooktop-induction')
    expect(inductionCooktop.height).toBe(COOKTOP_DEFAULT_HEIGHT)
    expect(inductionCooktop.cooktopLayout).toBe(COOKTOP_DEFAULT_INDUCTION_LAYOUT)
    expect(inductionCooktop.cooktopBurnersOn).toBe(false)
    expect(inductionCooktop.cooktopActiveBurners).toEqual([])
    expect(inductionCooktop.cooktopKnobProgress).toEqual([])
    expect(inductionCooktop.cooktopShowGrate).toBe(true)
    expect(pullOutPantry.type).toBe('pull-out-pantry')
    expect(pullOutPantry.height).toBe(TALL_CABINET_CARCASS_HEIGHT)
    expect(pullOutPantry.shelfCount).toBe(PULL_OUT_PANTRY_DEFAULT_SHELF_COUNT)
    expect(pullOutPantry.pantryRackStyle).toBe(PULL_OUT_PANTRY_DEFAULT_RACK_STYLE)
    expect(MICROWAVE_STANDARD_WIDTH).toBeCloseTo(0.61)
    expect(MICROWAVE_STANDARD_HEIGHT).toBeCloseTo(0.39)
    expect(DISHWASHER_STANDARD_WIDTH).toBeCloseTo(0.6)
    expect(DISHWASHER_STANDARD_HEIGHT).toBeCloseTo(0.72)
    expect(COOKTOP_STANDARD_WIDTH).toBeCloseTo(0.75)
    expect(PULL_OUT_PANTRY_STANDARD_WIDTH).toBeCloseTo(0.3)
  })

  test('newCabinetCompartment seeds fixed refrigerator column heights', () => {
    const single = newCabinetCompartment('fridge-single')
    const double = newCabinetCompartment('fridge-double')
    const topFreezer = newCabinetCompartment('fridge-top-freezer')
    const bottomFreezer = newCabinetCompartment('fridge-bottom-freezer')

    expect(single.type).toBe('fridge-single')
    expect(double.type).toBe('fridge-double')
    expect(topFreezer.type).toBe('fridge-top-freezer')
    expect(bottomFreezer.type).toBe('fridge-bottom-freezer')
    expect(single.height).toBe(FRIDGE_COLUMN_HEIGHT)
    expect(double.height).toBe(FRIDGE_COLUMN_HEIGHT)
    expect(topFreezer.height).toBe(FRIDGE_COLUMN_HEIGHT)
    expect(bottomFreezer.height).toBe(FRIDGE_COLUMN_HEIGHT)
    expect(FRIDGE_COLUMN_WIDTH).toBeCloseTo(0.76)
    expect(FRIDGE_WIDE_WIDTH).toBeCloseTo(0.91)
    expect(FRIDGE_STANDARD_DEPTH).toBeCloseTo(0.76)
    expect(FRIDGE_COLUMN_HEIGHT).toBeCloseTo(1.78)
  })

  test('fridgeCabinetStack creates only the refrigerator compartment', () => {
    const stack = fridgeCabinetStack('fridge-single')
    const rows = normalizeCabinetStack({
      width: FRIDGE_COLUMN_WIDTH,
      carcassHeight: FRIDGE_COLUMN_HEIGHT,
      stack,
    })

    expect(stack).toHaveLength(1)
    expect(stack[0]!.type).toBe('fridge-single')
    expect(stack[0]!.height).toBeCloseTo(FRIDGE_COLUMN_HEIGHT)
    expect(rows[0]!.height).toBeCloseTo(FRIDGE_COLUMN_HEIGHT)
  })

  test('removing the top fridge filler compacts the carcass to the fridge height', () => {
    const stack: CabinetCompartment[] = [
      newCabinetCompartment('fridge-single'),
      { ...newCabinetCompartment('drawer'), drawerCount: 1 },
    ]
    const result = removeCabinetCompartmentStack(
      {
        width: FRIDGE_COLUMN_WIDTH,
        carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
        stack,
      },
      1,
    )

    expect(result.stack).toHaveLength(1)
    expect(result.stack[0]!.type).toBe('fridge-single')
    expect(result.carcassHeight).toBeCloseTo(FRIDGE_COLUMN_HEIGHT)
  })

  test('fridge preset inherits the run depth instead of using appliance depth', () => {
    const run = CabinetNode.parse({ depth: 0.58 })

    const patch = cabinetPresetById('fridge-single').createPatch(run)
    expect(patch.depth).toBeCloseTo(run.depth)
    expect(patch.carcassHeight).toBeCloseTo(FRIDGE_COLUMN_HEIGHT)
    expect(patch.stack).toHaveLength(1)
    expect(patch.stack?.[0]?.type).toBe('fridge-single')
  })

  test('cooktop stack keeps storage below a countertop-mounted overlay', () => {
    const stack = cooktopCabinetStack('cooktop-gas')
    const rows = normalizeCabinetStack({
      width: COOKTOP_STANDARD_WIDTH,
      carcassHeight: 0.72,
      stack,
    })

    expect(stack).toHaveLength(2)
    expect(stack[0]!.type).toBe('drawer')
    expect(stack[1]!.type).toBe('cooktop-gas')
    expect(rows[0]!.height).toBeCloseTo(0.72)
    expect(rows[1]!.height).toBeCloseTo(0)
    expect(rows[1]!.y0).toBeCloseTo(0.72)
  })

  test('cooktop presets create standard base modules', () => {
    const run = CabinetNode.parse({ depth: 0.58 })
    const gas = cabinetPresetById('cooktop-gas').createPatch(run)
    const induction = cabinetPresetById('cooktop-induction').createPatch(run)

    expect(gas.cabinetType).toBe('base')
    expect(gas.width).toBeCloseTo(COOKTOP_STANDARD_WIDTH)
    expect(gas.stack?.[1]?.type).toBe('cooktop-gas')
    expect(induction.width).toBeCloseTo(COOKTOP_STANDARD_WIDTH)
    expect(induction.stack?.[1]?.type).toBe('cooktop-induction')
  })

  test('normalizeCabinetStack keeps the oven row fixed and free rows absorb the remainder', () => {
    const applianceStack: CabinetCompartment[] = [
      { id: 'door', type: 'door', doorType: 'double' },
      { id: 'oven', type: 'oven', height: OVEN_DEFAULT_HEIGHT },
      { id: 'drawer', type: 'drawer', drawerCount: 2 },
    ]
    const rows = normalizeCabinetStack({ width: 0.6, carcassHeight: 2.07, stack: applianceStack })

    expect(rows[1]!.height).toBeCloseTo(OVEN_DEFAULT_HEIGHT)
    expect(rows[0]!.height).toBeCloseTo((2.07 - OVEN_DEFAULT_HEIGHT) / 2)
    expect(rows[2]!.height).toBeCloseTo((2.07 - OVEN_DEFAULT_HEIGHT) / 2)
    expect(rows[0]!.height + rows[1]!.height + rows[2]!.height).toBeCloseTo(2.07)
  })

  test('normalizeCabinetStack keeps fixed appliance rows at their explicit height', () => {
    const rows = normalizeCabinetStack({
      width: 0.6,
      carcassHeight: 0.5,
      stack: [
        { id: 'oven', type: 'oven', height: OVEN_DEFAULT_HEIGHT },
        { id: 'drawer', type: 'drawer', drawerCount: 1 },
      ],
    })

    expect(rows[0]!.height).toBeCloseTo(OVEN_DEFAULT_HEIGHT)
    expect(rows[0]!.y1).toBeCloseTo(OVEN_DEFAULT_HEIGHT)
  })

  test('minCabinetCarcassHeightForStack reserves fixed appliances plus flexible row minimums', () => {
    expect(
      minCabinetCarcassHeightForStack({
        width: 0.6,
        stack: [
          { id: 'door', type: 'door', doorType: 'double' },
          { id: 'oven', type: 'oven', height: OVEN_DEFAULT_HEIGHT },
          { id: 'microwave', type: 'microwave', height: MICROWAVE_DEFAULT_HEIGHT },
          { id: 'dishwasher', type: 'dishwasher', height: DISHWASHER_STANDARD_HEIGHT },
          { id: 'cooktop', type: 'cooktop-gas', height: COOKTOP_DEFAULT_HEIGHT },
          { id: 'pullout', type: 'pull-out-pantry', height: TALL_CABINET_CARCASS_HEIGHT },
          { id: 'fridge', type: 'fridge-single', height: FRIDGE_COLUMN_HEIGHT },
        ],
      }),
    ).toBeCloseTo(
      0.1 +
        OVEN_DEFAULT_HEIGHT +
        MICROWAVE_DEFAULT_HEIGHT +
        DISHWASHER_STANDARD_HEIGHT +
        TALL_CABINET_CARCASS_HEIGHT +
        FRIDGE_COLUMN_HEIGHT,
    )
  })

  test('replacing a single base compartment with microwave adds a flexible drawer filler', () => {
    const replaced = replaceCabinetCompartmentStack(
      {
        width: 0.6,
        carcassHeight: 0.72,
        stack: [{ id: 'door', type: 'door', doorType: 'double' }],
      },
      0,
      { id: 'door', type: 'microwave', height: MICROWAVE_DEFAULT_HEIGHT },
      'drawer',
    )
    const rows = normalizeCabinetStack({ width: 0.6, carcassHeight: 0.72, stack: replaced })

    expect(replaced).toHaveLength(2)
    expect(replaced[0]!.type).toBe('drawer')
    expect(replaced[1]!.type).toBe('microwave')
    expect(rows[0]!.height).toBeCloseTo(0.72 - MICROWAVE_DEFAULT_HEIGHT)
    expect(rows[1]!.height).toBeCloseTo(MICROWAVE_DEFAULT_HEIGHT)
  })

  test('replacing a single compartment with dishwasher keeps only the fixed washer row', () => {
    const replaced = replaceCabinetCompartmentStack(
      {
        width: DISHWASHER_STANDARD_WIDTH,
        carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
        stack: [{ id: 'door', type: 'door', doorType: 'double' }],
      },
      0,
      { id: 'door', type: 'dishwasher', height: DISHWASHER_STANDARD_HEIGHT },
      'drawer',
    )

    expect(replaced).toHaveLength(1)
    expect(replaced[0]!.type).toBe('dishwasher')
    expect(replaced[0]!.height).toBe(DISHWASHER_STANDARD_HEIGHT)
  })

  test('replacing a single base compartment with cooktop adds a flexible drawer below', () => {
    const replaced = replaceCabinetCompartmentStack(
      {
        width: COOKTOP_STANDARD_WIDTH,
        carcassHeight: 0.72,
        stack: [{ id: 'door', type: 'door', doorType: 'double' }],
      },
      0,
      { id: 'door', type: 'cooktop-induction', height: COOKTOP_DEFAULT_HEIGHT },
      'drawer',
    )
    const rows = normalizeCabinetStack({
      width: COOKTOP_STANDARD_WIDTH,
      carcassHeight: 0.72,
      stack: replaced,
    })

    expect(replaced).toHaveLength(2)
    expect(replaced[0]!.type).toBe('drawer')
    expect(replaced[1]!.type).toBe('cooktop-induction')
    expect(rows[0]!.height).toBeCloseTo(0.72)
    expect(rows[1]!.height).toBeCloseTo(0)
  })

  test('replacing one of several compartments with dishwasher lets flexible siblings absorb the remainder', () => {
    const replaced = replaceCabinetCompartmentStack(
      {
        width: DISHWASHER_STANDARD_WIDTH,
        carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
        stack: [
          { id: 'drawer', type: 'drawer', drawerCount: 2 },
          { id: 'door', type: 'door', doorType: 'double' },
          { id: 'shelf', type: 'shelf', shelfCount: 2 },
        ],
      },
      1,
      { id: 'door', type: 'dishwasher', height: DISHWASHER_STANDARD_HEIGHT },
      'drawer',
    )
    const rows = normalizeCabinetStack({
      width: DISHWASHER_STANDARD_WIDTH,
      carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
      stack: replaced,
    })

    expect(replaced).toHaveLength(3)
    expect(replaced[1]!.type).toBe('dishwasher')
    expect(rows[1]!.height).toBeCloseTo(DISHWASHER_STANDARD_HEIGHT)
    expect(rows[0]!.height).toBeCloseTo(
      (TALL_CABINET_CARCASS_HEIGHT - DISHWASHER_STANDARD_HEIGHT) / 2,
    )
    expect(rows[2]!.height).toBeCloseTo(
      (TALL_CABINET_CARCASS_HEIGHT - DISHWASHER_STANDARD_HEIGHT) / 2,
    )
  })

  test('replacing a row with microwave reuses existing flexible siblings', () => {
    const replaced = replaceCabinetCompartmentStack(
      {
        width: 0.6,
        carcassHeight: 1.2,
        stack: [
          { id: 'drawer', type: 'drawer', drawerCount: 1 },
          { id: 'door', type: 'door', doorType: 'double' },
        ],
      },
      1,
      { id: 'door', type: 'microwave', height: MICROWAVE_DEFAULT_HEIGHT },
      'drawer',
    )

    expect(replaced).toHaveLength(2)
    expect(replaced[0]!.type).toBe('drawer')
    expect(replaced[1]!.type).toBe('microwave')
  })

  test('changing a configured flexible row type keeps its explicit height', () => {
    const replaced = replaceCabinetCompartmentStack(
      {
        width: 0.6,
        carcassHeight: 1.2,
        stack: [
          { id: 'drawer', type: 'drawer', height: 0.44, drawerCount: 2 },
          { id: 'door', type: 'door', height: 0.76, doorType: 'double' },
        ],
      },
      0,
      { id: 'drawer', type: 'shelf', shelfCount: 1 },
    )

    expect(replaced[0]!.type).toBe('shelf')
    expect(replaced[0]!.height).toBeCloseTo(0.44)
    expect(normalizeCabinetStack({ width: 0.6, carcassHeight: 1.2, stack: replaced })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 0, height: 0.44 }),
        expect.objectContaining({ index: 1, height: 0.76 }),
      ]),
    )
  })

  test('replacing a single compartment with a refrigerator does not add a filler row', () => {
    const replaced = replaceCabinetCompartmentStack(
      {
        width: 0.76,
        carcassHeight: FRIDGE_COLUMN_HEIGHT,
        stack: [{ id: 'door', type: 'door', doorType: 'double' }],
      },
      0,
      { id: 'door', type: 'fridge-single', height: FRIDGE_COLUMN_HEIGHT },
      'drawer',
    )

    expect(replaced).toHaveLength(1)
    expect(replaced[0]!.type).toBe('fridge-single')
  })

  test('switching a tall cabinet compartment to a refrigerator removes the top filler and compacts the carcass', () => {
    const node = CabinetNode.parse({
      width: 0.6,
      carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
      stack: [{ id: 'door', type: 'door', doorType: 'double' }],
    })

    const transition = resolveCompartmentTransition({
      node,
      parentRun: undefined,
      index: 0,
      next: { id: 'door', type: 'fridge-single', height: FRIDGE_COLUMN_HEIGHT },
    })

    expect(transition.stack).toHaveLength(1)
    expect(transition.stack[0]!.type).toBe('fridge-single')
    expect(transition.modulePatch.carcassHeight).toBeCloseTo(FRIDGE_COLUMN_HEIGHT)
  })

  test('replacing a tall cabinet compartment with a refrigerator removes all filler rows', () => {
    const replaced = replaceCabinetCompartmentStack(
      {
        width: FRIDGE_COLUMN_WIDTH,
        carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
        stack: [{ id: 'door', type: 'door', doorType: 'double' }],
      },
      0,
      { id: 'fridge', type: 'fridge-single', height: FRIDGE_COLUMN_HEIGHT },
      'drawer',
    )
    expect(replaced).toHaveLength(1)
    expect(replaced[0]!.type).toBe('fridge-single')
  })

  test('newCabinetCompartment seeds fixed range hood heights', () => {
    const pyramid = newCabinetCompartment('hood-pyramid')
    const curved = newCabinetCompartment('hood-curved-glass')

    expect(pyramid.type).toBe('hood-pyramid')
    expect(pyramid.height).toBe(HOOD_PYRAMID_CANOPY_HEIGHT)
    expect(curved.type).toBe('hood-curved-glass')
    expect(curved.height).toBe(HOOD_CURVED_TOTAL_HEIGHT)
    expect(hoodCompartmentHeight('hood-pyramid')).toBeCloseTo(0.38)
    expect(hoodCompartmentHeight('hood-curved-glass')).toBeCloseTo(0.44)
  })

  test('replacing a single compartment with a range hood does not add a filler row', () => {
    const replaced = replaceCabinetCompartmentStack(
      {
        width: 0.6,
        carcassHeight: HOOD_PYRAMID_CANOPY_HEIGHT,
        stack: [{ id: 'door', type: 'door', doorType: 'double' }],
      },
      0,
      { id: 'door', type: 'hood-pyramid', height: HOOD_PYRAMID_CANOPY_HEIGHT },
      'drawer',
    )

    expect(replaced).toHaveLength(1)
    expect(replaced[0]!.type).toBe('hood-pyramid')
  })

  test('normalizeCabinetStack keeps the hood row at its explicit height', () => {
    const rows = normalizeCabinetStack({
      width: 0.6,
      carcassHeight: 1.0,
      stack: [
        { id: 'hood', type: 'hood-pyramid', height: HOOD_PYRAMID_CANOPY_HEIGHT },
        { id: 'shelf', type: 'shelf', shelfCount: 1 },
      ],
    })

    expect(rows[0]!.height).toBeCloseTo(HOOD_PYRAMID_CANOPY_HEIGHT)
    expect(rows[1]!.height).toBeCloseTo(1.0 - HOOD_PYRAMID_CANOPY_HEIGHT)
  })
})

describe('reflowCabinetRunModules', () => {
  test('keeps neighboring modules flush when the selected module width changes', () => {
    const modules = [
      { id: 'left', position: [-0.6, 0.1, 0] as [number, number, number], width: 0.6 },
      { id: 'middle', position: [0, 0.1, 0] as [number, number, number], width: 0.6 },
      { id: 'right', position: [0.6, 0.1, 0] as [number, number, number], width: 0.6 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'middle', 0.9)

    expect(reflowed.map((module) => module.id)).toEqual(['left', 'middle', 'right'])
    expect(reflowed[0]!.position[0] + reflowed[0]!.width / 2).toBeCloseTo(
      reflowed[1]!.position[0] - reflowed[1]!.width / 2,
    )
    expect(reflowed[1]!.position[0] + reflowed[1]!.width / 2).toBeCloseTo(
      reflowed[2]!.position[0] - reflowed[2]!.width / 2,
    )
    expect(reflowed[1]!.width).toBeCloseTo(0.9)
    expect(reflowed[0]!.position[1]).toBeCloseTo(0.1)
    expect(reflowed[2]!.position[1]).toBeCloseTo(0.1)
  })

  test('leaves neighboring widths unchanged when an open run grows', () => {
    const modules = [
      { id: 'left', position: [-0.5, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'middle', position: [0, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.5, 0.1, 0] as [number, number, number], width: 0.5 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'middle', 0.75)

    expect(reflowed.map((module) => module.width)).toEqual([0.5, 0.75, 0.5])
  })

  test('recognizes two perpendicular wall constraints without treating a back wall as one', () => {
    const level = LevelNode.parse({ id: 'level_run-constraints' })
    const run = CabinetNode.parse({
      id: 'cabinet_run-constraints',
      parentId: level.id,
      position: [0.75, 0, 0],
      width: 1.5,
      depth: 0.6,
    })
    const modules = [
      { id: 'left', position: [-0.5, 0, 0] as [number, number, number], width: 0.5 },
      { id: 'middle', position: [0, 0, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.5, 0, 0] as [number, number, number], width: 0.5 },
    ]
    const leftWall = WallNode.parse({
      id: 'wall_run-constraints-left',
      parentId: level.id,
      start: [0, -0.5],
      end: [0, 0.5],
    })
    const rightWall = WallNode.parse({
      id: 'wall_run-constraints-right',
      parentId: level.id,
      start: [1.5, -0.5],
      end: [1.5, 0.5],
    })
    const backWall = WallNode.parse({
      id: 'wall_run-constraints-back',
      parentId: level.id,
      start: [0, -0.3],
      end: [1.5, -0.3],
    })
    const nodes = {
      [level.id as AnyNodeId]: level,
      [leftWall.id as AnyNodeId]: leftWall,
      [rightWall.id as AnyNodeId]: rightWall,
      [backWall.id as AnyNodeId]: backWall,
    }

    expect(runHasTwoWallConstraints(run, modules, nodes)).toBe(true)
    expect(
      runHasTwoWallConstraints(run, modules, {
        [level.id as AnyNodeId]: level,
        [leftWall.id as AnyNodeId]: leftWall,
      }),
    ).toBe(false)
    expect(
      runHasTwoWallConstraints(run, modules, {
        [level.id as AnyNodeId]: level,
        [backWall.id as AnyNodeId]: backWall,
      }),
    ).toBe(false)
  })

  test('fits a wider preset inside the existing run by reducing adjacent modules', () => {
    const modules = [
      { id: 'left', position: [-0.5, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'middle', position: [0, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.5, 0.1, 0] as [number, number, number], width: 0.5 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'middle', 0.75, {
      preserveExtent: true,
    })

    expect(reflowed[0]!.position[0] - reflowed[0]!.width / 2).toBeCloseTo(-0.75)
    expect(reflowed[2]!.position[0] + reflowed[2]!.width / 2).toBeCloseTo(0.75)
    expect(reflowed[0]!.width).toBeCloseTo(0.45)
    expect(reflowed[1]!.width).toBeCloseTo(0.75)
    expect(reflowed[2]!.width).toBeCloseTo(0.3)
  })

  test('uses the side with more reducible width before changing the opposite side', () => {
    const modules = [
      { id: 'left', position: [-0.6, 0.1, 0] as [number, number, number], width: 0.7 },
      { id: 'middle', position: [0, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.45, 0.1, 0] as [number, number, number], width: 0.4 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'middle', 0.75, {
      preserveExtent: true,
    })

    expect(reflowed[0]!.width).toBeCloseTo(0.45)
    expect(reflowed[1]!.width).toBeCloseTo(0.75)
    expect(reflowed[2]!.width).toBeCloseTo(0.4)
  })

  test('restores the exact donor widths when a wider preset switches back', () => {
    const modules = [
      { id: 'left', position: [-0.6, 0.1, 0] as [number, number, number], width: 0.7 },
      { id: 'middle', position: [0, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.45, 0.1, 0] as [number, number, number], width: 0.4 },
    ]
    const widened = reflowCabinetRunModules(modules, 'middle', 0.75, {
      preserveExtent: true,
    })
    const restorableWidthById = new Map(
      modules.map((module, index) => [module.id, module.width - widened[index]!.width]),
    )

    const restored = reflowCabinetRunModules(widened, 'middle', 0.5, {
      preserveExtent: true,
      restorableWidthById,
    })

    expect(restored.map((module) => module.width)).toEqual([0.7, 0.5, 0.4])
    expect(restored[0]!.position[0] - restored[0]!.width / 2).toBeCloseTo(-0.95)
    expect(restored[2]!.position[0] + restored[2]!.width / 2).toBeCloseTo(0.65)
  })
})

describe('backAnchoredModuleZ', () => {
  test('moves a deeper module forward so the rear face stays aligned', () => {
    const currentZ = 0
    const currentDepth = 0.58
    const nextDepth = FRIDGE_STANDARD_DEPTH
    const nextZ = backAnchoredModuleZ(currentZ, currentDepth, nextDepth)

    expect(nextZ - nextDepth / 2).toBeCloseTo(currentZ - currentDepth / 2)
    expect(nextZ).toBeGreaterThan(currentZ)
  })
})

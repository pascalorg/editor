import { describe, expect, test } from 'bun:test'
import { type AnyNodeId, LevelNode, SiteNode, WallNode } from '@pascal-app/core'
import { cabinetPresetById } from '../presets'
import { runWallConstraints } from '../run-layout'
import { CabinetModuleNode, CabinetNode } from '../schema'
import {
  backAnchoredModuleZ,
  type CabinetCompartment,
  COOKTOP_DEFAULT_GAS_LAYOUT,
  COOKTOP_DEFAULT_HEIGHT,
  COOKTOP_DEFAULT_INDUCTION_LAYOUT,
  COOKTOP_STANDARD_WIDTH,
  clampCabinetCarcassHeightForStack,
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
import { resolveCompartmentTransition } from '../stack-transitions'

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

  test('keeps a single compartment filling the carcass instead of ratcheting its height down', () => {
    const original: CabinetCompartment[] = [{ id: 'top', type: 'shelf' }]
    const resized = resizeCabinetCompartmentStack(
      { width: 0.6, carcassHeight: 0.8, stack: original },
      0,
      0.42,
    )
    const rows = normalizeCabinetStack({ width: 0.6, carcassHeight: 0.8, stack: resized })

    expect(resized).toEqual(original)
    expect(rows[0]!.height).toBeCloseTo(0.8)
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

  test('clamps carcass height against the replacement stack instead of the stale stack', () => {
    const nextStack = fridgeCabinetStack('fridge-single')
    const height = clampCabinetCarcassHeightForStack(
      {
        width: FRIDGE_COLUMN_WIDTH,
        stack: [...nextStack, { ...newCabinetCompartment('drawer'), height: 0.1 }],
      },
      FRIDGE_COLUMN_HEIGHT,
      nextStack,
    )

    expect(height).toBeCloseTo(FRIDGE_COLUMN_HEIGHT)
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

  test('switching a compartment to an oven applies the fixed oven width', () => {
    const parentRun = CabinetNode.parse({ carcassHeight: 0.8 })
    const node = CabinetModuleNode.parse({
      parentId: parentRun.id,
      width: 0.8,
      carcassHeight: parentRun.carcassHeight,
      stack: [{ id: 'door', type: 'door', doorType: 'double' }],
    })

    const transition = resolveCompartmentTransition({
      node,
      parentRun,
      index: 0,
      next: { id: 'door', type: 'oven', height: OVEN_DEFAULT_HEIGHT },
    })

    expect(transition.modulePatch.width).toBeCloseTo(0.6)
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

  test('dishwasher fills the parent run height without leaving an 8 cm shortfall', () => {
    const parentRun = CabinetNode.parse({ carcassHeight: 0.8 })
    const node = CabinetModuleNode.parse({
      parentId: parentRun.id,
      carcassHeight: parentRun.carcassHeight,
      stack: [{ id: 'door', type: 'door', doorType: 'double' }],
    })

    const transition = resolveCompartmentTransition({
      node,
      parentRun,
      index: 0,
      next: { id: 'door', type: 'dishwasher', height: DISHWASHER_STANDARD_HEIGHT },
    })
    const preset = cabinetPresetById('dishwasher').createPatch(parentRun)

    expect(transition.modulePatch.carcassHeight).toBeCloseTo(parentRun.carcassHeight)
    expect(transition.stack).toEqual([
      expect.objectContaining({ type: 'dishwasher', height: parentRun.carcassHeight }),
    ])
    expect(preset.carcassHeight).toBeCloseTo(parentRun.carcassHeight)
    expect(preset.stack).toEqual([
      expect.objectContaining({ type: 'dishwasher', height: parentRun.carcassHeight }),
    ])
  })

  test('dishwasher fills the carcass after its last flexible sibling is removed', () => {
    const parentRun = CabinetNode.parse({ carcassHeight: 0.8 })
    const node = CabinetModuleNode.parse({
      parentId: parentRun.id,
      carcassHeight: parentRun.carcassHeight,
      stack: [
        { id: 'drawer', type: 'drawer', drawerCount: 1 },
        { id: 'door', type: 'door', doorType: 'double' },
      ],
    })
    const transition = resolveCompartmentTransition({
      node,
      parentRun,
      index: 1,
      next: { id: 'door', type: 'dishwasher', height: DISHWASHER_STANDARD_HEIGHT },
    })
    const transitionedNode = CabinetModuleNode.parse({
      ...node,
      ...transition.modulePatch,
      stack: transition.stack,
    })

    const removed = removeCabinetCompartmentStack(transitionedNode, 0)
    const carcassHeight = removed.carcassHeight ?? transitionedNode.carcassHeight
    const rows = normalizeCabinetStack({ ...transitionedNode, carcassHeight, stack: removed.stack })

    expect(carcassHeight).toBeCloseTo(parentRun.carcassHeight)
    expect(removed.stack).toEqual([
      expect.objectContaining({ type: 'dishwasher', height: parentRun.carcassHeight }),
    ])
    expect(rows).toEqual([
      expect.objectContaining({
        compartment: expect.objectContaining({ type: 'dishwasher' }),
        y0: 0,
        y1: parentRun.carcassHeight,
      }),
    ])
  })

  test('removing a filler above a dishwasher restores its fixed appliance height', () => {
    const cabinetHeight = 0.8
    const removed = removeCabinetCompartmentStack(
      {
        width: DISHWASHER_STANDARD_WIDTH,
        carcassHeight: cabinetHeight + 0.1,
        stack: [
          {
            id: 'dishwasher',
            type: 'dishwasher',
            height: cabinetHeight,
          },
          { id: 'drawer', type: 'drawer', height: 0.1, drawerCount: 1 },
        ],
      },
      1,
    )

    expect(removed.carcassHeight).toBeCloseTo(cabinetHeight)
    expect(removed.stack).toEqual([
      expect.objectContaining({
        type: 'dishwasher',
        height: cabinetHeight,
      }),
    ])
  })

  test('switching an oven stack to dishwasher removes every filler compartment', () => {
    const parentRun = CabinetNode.parse({ carcassHeight: 0.8 })
    const baseNode = CabinetModuleNode.parse({
      parentId: parentRun.id,
      carcassHeight: parentRun.carcassHeight,
      stack: [{ id: 'door', type: 'door', doorType: 'double' }],
    })
    const ovenTransition = resolveCompartmentTransition({
      node: baseNode,
      parentRun,
      index: 0,
      next: { id: 'door', type: 'oven', height: OVEN_DEFAULT_HEIGHT },
    })
    const ovenNode = CabinetModuleNode.parse({
      ...baseNode,
      ...ovenTransition.modulePatch,
      stack: ovenTransition.stack,
    })

    const transition = resolveCompartmentTransition({
      node: ovenNode,
      parentRun,
      index: 1,
      next: { id: 'door', type: 'dishwasher', height: DISHWASHER_STANDARD_HEIGHT },
    })

    expect(ovenTransition.stack.map((compartment) => compartment.type)).toEqual(['drawer', 'oven'])
    expect(transition.stack).toEqual([
      expect.objectContaining({
        id: 'door',
        type: 'dishwasher',
        height: parentRun.carcassHeight,
      }),
    ])
    expect(transition.modulePatch).toEqual(
      expect.objectContaining({
        cabinetType: 'base',
        width: DISHWASHER_STANDARD_WIDTH,
        carcassHeight: parentRun.carcassHeight,
      }),
    )
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

  test('replacing a row with an oven releases a configured storage sibling to fit', () => {
    const replaced = replaceCabinetCompartmentStack(
      {
        width: 0.6,
        carcassHeight: 0.8,
        stack: [
          { id: 'drawer', type: 'drawer', height: 0.44, drawerCount: 2 },
          { id: 'door', type: 'door', doorType: 'double' },
        ],
      },
      1,
      { id: 'door', type: 'oven', height: OVEN_DEFAULT_HEIGHT },
    )
    const rows = normalizeCabinetStack({ width: 0.6, carcassHeight: 0.8, stack: replaced })

    expect(replaced[0]!.height).toBeUndefined()
    expect(rows[0]!.height).toBeCloseTo(0.8 - OVEN_DEFAULT_HEIGHT)
    expect(rows[1]!.height).toBeCloseTo(OVEN_DEFAULT_HEIGHT)
    expect(rows.at(-1)!.y1).toBeCloseTo(0.8)
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

  test.each([
    'shelf',
    'drawer',
  ] as const)('switching a pull-out pantry to %s restores a default base cabinet', (type) => {
    const parentRun = CabinetNode.parse({
      carcassHeight: 0.72,
      depth: 0.58,
      plinthHeight: 0.1,
      toeKickDepth: 0.075,
    })
    const node = CabinetModuleNode.parse({
      cabinetType: 'tall',
      width: PULL_OUT_PANTRY_STANDARD_WIDTH,
      carcassHeight: TALL_CABINET_CARCASS_HEIGHT,
      stack: [newCabinetCompartment('pull-out-pantry')],
    })

    const transition = resolveCompartmentTransition({
      node,
      parentRun,
      index: 0,
      next: { ...newCabinetCompartment(type), id: node.stack![0]!.id },
    })

    expect(transition.stack).toHaveLength(1)
    expect(transition.stack[0]!.type).toBe(type)
    expect(transition.stack[0]!.height).toBeUndefined()
    expect(transition.modulePatch).toEqual(
      expect.objectContaining({
        cabinetType: 'base',
        width: 0.5,
        depth: parentRun.depth,
        carcassHeight: parentRun.carcassHeight,
        plinthHeight: parentRun.plinthHeight,
        toeKickDepth: parentRun.toeKickDepth,
      }),
    )
  })

  test.each([
    ['fridge-single', 'shelf'],
    ['fridge-single', 'drawer'],
    ['fridge-single', 'door'],
    ['fridge-double', 'shelf'],
    ['fridge-double', 'drawer'],
    ['fridge-double', 'door'],
    ['fridge-top-freezer', 'shelf'],
    ['fridge-top-freezer', 'drawer'],
    ['fridge-top-freezer', 'door'],
    ['fridge-bottom-freezer', 'shelf'],
    ['fridge-bottom-freezer', 'drawer'],
    ['fridge-bottom-freezer', 'door'],
  ] as const)('switching %s to %s fills the restored base carcass', (fridgeType, storageType) => {
    const parentRun = CabinetNode.parse({ carcassHeight: 0.8 })
    const node = CabinetModuleNode.parse({
      cabinetType: 'tall',
      width: FRIDGE_COLUMN_WIDTH,
      carcassHeight: FRIDGE_COLUMN_HEIGHT,
      stack: [newCabinetCompartment(fridgeType)],
    })

    const transition = resolveCompartmentTransition({
      node,
      parentRun,
      index: 0,
      next: { ...newCabinetCompartment(storageType), id: node.stack![0]!.id },
    })
    const transitionedNode = CabinetModuleNode.parse({
      ...node,
      ...transition.modulePatch,
      stack: transition.stack,
    })
    const rows = normalizeCabinetStack(transitionedNode)

    expect(transition.stack).toHaveLength(1)
    expect(transition.stack[0]!.type).toBe(storageType)
    expect(transition.stack[0]!.height).toBeUndefined()
    expect(transitionedNode.carcassHeight).toBeCloseTo(parentRun.carcassHeight)
    expect(rows[0]!.height).toBeCloseTo(parentRun.carcassHeight)
    expect(rows[0]!.y1).toBeCloseTo(parentRun.carcassHeight)
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

  test.each([
    ['hood-pyramid', 'shelf'],
    ['hood-pyramid', 'drawer'],
    ['hood-pyramid', 'door'],
    ['hood-curved-glass', 'shelf'],
    ['hood-curved-glass', 'drawer'],
    ['hood-curved-glass', 'door'],
  ] as const)('switching %s to %s fills the restored wall carcass', (hoodType, storageType) => {
    const node = CabinetModuleNode.parse({
      width: 0.6,
      carcassHeight: 0.4,
      stack: [newCabinetCompartment(hoodType)],
    })

    const transition = resolveCompartmentTransition({
      node,
      parentRun: undefined,
      index: 0,
      next: { ...newCabinetCompartment(storageType), id: node.stack![0]!.id },
    })
    const transitionedNode = CabinetModuleNode.parse({
      ...node,
      ...transition.modulePatch,
      stack: transition.stack,
    })
    const rows = normalizeCabinetStack(transitionedNode)

    expect(transition.stack).toHaveLength(1)
    expect(transition.stack[0]!.type).toBe(storageType)
    expect(transition.stack[0]!.height).toBeUndefined()
    expect(transitionedNode.carcassHeight).toBeCloseTo(0.8)
    expect(rows[0]!.height).toBeCloseTo(0.8)
    expect(rows[0]!.y1).toBeCloseTo(0.8)
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

  test('grows an open left-end module outward without moving the opposite end', () => {
    const modules = [
      { id: 'left', position: [-0.5, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'middle', position: [0, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.5, 0.1, 0] as [number, number, number], width: 0.5 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'left', 0.76)

    expect(reflowed[0]!.position[0] - reflowed[0]!.width / 2).toBeCloseTo(-1.01)
    expect(reflowed[2]!.position[0] + reflowed[2]!.width / 2).toBeCloseTo(0.75)
  })

  test('keeps the constrained right edge fixed and moves the run left', () => {
    const modules = [
      { id: 'left', position: [-0.5, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'middle', position: [0, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.5, 0.1, 0] as [number, number, number], width: 0.5 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'right', 0.8, {
      wallConstraints: {
        left: { constrained: false, slack: 0 },
        right: { constrained: true, slack: 0 },
      },
    })

    expect(reflowed.map((module) => module.width)).toEqual([0.5, 0.5, 0.8])
    expect(reflowed[0]!.position[0] - reflowed[0]!.width / 2).toBeCloseTo(-1.05)
    expect(reflowed[2]!.position[0] + reflowed[2]!.width / 2).toBeCloseTo(0.75)
  })

  test.each([
    'left',
    'right',
  ] as const)('consumes a constrained %s wall gap before growing toward the open end', (side) => {
    const modules = [
      { id: 'left', position: [-0.5, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'middle', position: [0, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.5, 0.1, 0] as [number, number, number], width: 0.5 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'middle', 0.7, {
      wallConstraints: {
        left: { constrained: side === 'left', slack: side === 'left' ? 0.1 : 0 },
        right: { constrained: side === 'right', slack: side === 'right' ? 0.1 : 0 },
      },
    })

    expect(reflowed.map((module) => module.width)).toEqual([0.5, 0.7, 0.5])
    expect(reflowed[0]!.position[0] - reflowed[0]!.width / 2).toBeCloseTo(-0.85)
    expect(reflowed[2]!.position[0] + reflowed[2]!.width / 2).toBeCloseTo(0.85)
  })

  test('detects perpendicular wall constraints at each run end', () => {
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

    expect(runWallConstraints(run, modules, nodes)).toEqual({
      left: { constrained: true, slack: 0 },
      right: { constrained: true, slack: 0 },
    })
    expect(
      runWallConstraints(run, modules, {
        [level.id as AnyNodeId]: level,
        [rightWall.id as AnyNodeId]: rightWall,
      }),
    ).toEqual({
      left: { constrained: false, slack: 0 },
      right: { constrained: true, slack: 0 },
    })
    expect(
      runWallConstraints(run, modules, {
        [level.id as AnyNodeId]: level,
        [leftWall.id as AnyNodeId]: leftWall,
      }),
    ).toEqual({
      left: { constrained: true, slack: 0 },
      right: { constrained: false, slack: 0 },
    })
    expect(
      runWallConstraints(run, modules, {
        [level.id as AnyNodeId]: level,
        [backWall.id as AnyNodeId]: backWall,
      }),
    ).toEqual({
      left: { constrained: false, slack: 0 },
      right: { constrained: false, slack: 0 },
    })
  })

  test('detects perpendicular walls through an intermediate scene parent', () => {
    const level = LevelNode.parse({ id: 'level_run-nested-walls' })
    const room = SiteNode.parse({ id: 'site_run-nested-walls', parentId: level.id })
    const run = CabinetNode.parse({
      id: 'cabinet_run-nested-walls',
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
      id: 'wall_run-nested-walls-left',
      parentId: room.id,
      start: [0, -0.5],
      end: [0, 0.5],
    })
    const rightWall = WallNode.parse({
      id: 'wall_run-nested-walls-right',
      parentId: room.id,
      start: [1.5, -0.5],
      end: [1.5, 0.5],
    })

    expect(
      runWallConstraints(run, modules, {
        [level.id as AnyNodeId]: level,
        [room.id as AnyNodeId]: room,
        [leftWall.id as AnyNodeId]: leftWall,
        [rightWall.id as AnyNodeId]: rightWall,
      }),
    ).toEqual({
      left: { constrained: true, slack: 0 },
      right: { constrained: true, slack: 0 },
    })
  })

  test('measures clear space from each run end to the perpendicular wall face', () => {
    const level = LevelNode.parse({ id: 'level_run-constraint-slack' })
    const run = CabinetNode.parse({
      id: 'cabinet_run-constraint-slack',
      parentId: level.id,
      depth: 0.6,
    })
    const modules = [
      { id: 'left', position: [-0.5, 0, 0] as [number, number, number], width: 0.5 },
      { id: 'middle', position: [0, 0, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.5, 0, 0] as [number, number, number], width: 0.5 },
    ]
    const leftWall = WallNode.parse({
      id: 'wall_run-constraint-slack-left',
      parentId: level.id,
      start: [-0.95, -0.5],
      end: [-0.95, 0.5],
      thickness: 0.2,
    })
    const rightWall = WallNode.parse({
      id: 'wall_run-constraint-slack-right',
      parentId: level.id,
      start: [0.95, -0.5],
      end: [0.95, 0.5],
      thickness: 0.2,
    })

    const constraints = runWallConstraints(run, modules, {
      [level.id as AnyNodeId]: level,
      [leftWall.id as AnyNodeId]: leftWall,
      [rightWall.id as AnyNodeId]: rightWall,
    })

    expect(constraints.left.constrained).toBe(true)
    expect(constraints.left.slack).toBeCloseTo(0.1)
    expect(constraints.right.constrained).toBe(true)
    expect(constraints.right.slack).toBeCloseTo(0.1)
  })

  test('detects a perpendicular wall within the requested width growth', () => {
    const level = LevelNode.parse({ id: 'level_run-growth-constraint' })
    const run = CabinetNode.parse({
      id: 'cabinet_run-growth-constraint',
      parentId: level.id,
      depth: 0.6,
    })
    const modules = [
      { id: 'selected', position: [0, 0, 0] as [number, number, number], width: 0.6 },
    ]
    const rightWall = WallNode.parse({
      id: 'wall_run-growth-constraint-right',
      parentId: level.id,
      start: [0.8, -0.5],
      end: [0.8, 0.5],
      thickness: 0.2,
    })
    const nodes = {
      [level.id as AnyNodeId]: level,
      [rightWall.id as AnyNodeId]: rightWall,
    }

    expect(runWallConstraints(run, modules, nodes).right.constrained).toBe(false)
    const constraints = runWallConstraints(run, modules, nodes, { widthGrowth: 0.46 })
    expect(constraints.right.constrained).toBe(true)
    expect(constraints.right.slack).toBeCloseTo(0.4)
  })

  test('keeps the exact two-wall extent and changes one eligible cabinet width', () => {
    const modules = [
      { id: 'left', position: [-0.5, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'middle', position: [0, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.5, 0.1, 0] as [number, number, number], width: 0.5 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'middle', 0.7, {
      wallConstraints: {
        left: { constrained: true, slack: 0.1 },
        right: { constrained: true, slack: 0.1 },
      },
      eligibleDonorIds: new Set(['left', 'right']),
    })

    expect(reflowed.map((module) => module.width)).toEqual([0.5, 0.7, expect.closeTo(0.3)])
    expect(reflowed[0]!.position[0] - reflowed[0]!.width / 2).toBeCloseTo(-0.75)
    expect(reflowed[2]!.position[0] + reflowed[2]!.width / 2).toBeCloseTo(0.75)
  })

  test('rejects two-wall growth when combined eligible capacity is insufficient', () => {
    const modules = [
      { id: 'left', position: [-0.55, 0.1, 0] as [number, number, number], width: 0.4 },
      { id: 'middle', position: [-0.1, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.4, 0.1, 0] as [number, number, number], width: 0.5 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'middle', 0.7, {
      wallConstraints: {
        left: { constrained: true, slack: 0.05 },
        right: { constrained: true, slack: 0.05 },
      },
      eligibleDonorIds: new Set(['left']),
    })

    expect(reflowed).toEqual([])
  })

  test('rejects two-wall growth when donor capacity is short by a fraction of a millimetre', () => {
    const modules = [
      { id: 'donor', position: [-0.530025, 0.1, 0] as [number, number, number], width: 0.55995 },
      { id: 'selected', position: [0, 0.1, 0] as [number, number, number], width: 0.5 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'selected', 0.76, {
      wallConstraints: {
        left: { constrained: true, slack: 0 },
        right: { constrained: true, slack: 0 },
      },
      eligibleDonorIds: new Set(['donor']),
    })

    expect(reflowed).toEqual([])
  })

  test('accepts exact capacity when the final donor contributes a fraction of a millimetre', () => {
    const modules = [
      {
        id: 'large-donor',
        position: [0.279975, 0.1, 0] as [number, number, number],
        width: 0.55995,
      },
      {
        id: 'small-donor',
        position: [0.709975, 0.1, 0] as [number, number, number],
        width: 0.30005,
      },
      { id: 'selected', position: [1.11, 0.1, 0] as [number, number, number], width: 0.5 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'selected', 0.76, {
      wallConstraints: {
        left: { constrained: true, slack: 0 },
        right: { constrained: true, slack: 0 },
      },
      eligibleDonorIds: new Set(['large-donor', 'small-donor']),
    })

    expect(reflowed).toHaveLength(3)
    expect(reflowed[0]!.width).toBeCloseTo(0.3, 5)
    expect(reflowed[1]!.width).toBeCloseTo(0.3, 5)
  })

  test('uses the closest eligible base cabinet when both ends are constrained', () => {
    const modules = [
      { id: 'base', position: [-0.8, 0.1, 0] as [number, number, number], width: 0.8 },
      { id: 'appliance', position: [0, 0.1, 0] as [number, number, number], width: 0.8 },
      { id: 'selected', position: [0.65, 0.1, 0] as [number, number, number], width: 0.5 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'selected', 0.7, {
      wallConstraints: {
        left: { constrained: true, slack: 0 },
        right: { constrained: true, slack: 0 },
      },
      eligibleDonorIds: new Set(['base']),
    })

    expect(reflowed[0]!.width).toBeCloseTo(0.6)
    expect(reflowed[1]!.width).toBeCloseTo(0.8)
    expect(reflowed[2]!.width).toBeCloseTo(0.7)
    expect(reflowed[0]!.position[0] - reflowed[0]!.width / 2).toBeCloseTo(-1.2)
    expect(reflowed[2]!.position[0] + reflowed[2]!.width / 2).toBeCloseTo(0.9)
  })

  test('combines the closest eligible cabinets to absorb width growth', () => {
    const modules = [
      { id: 'far', position: [-0.625, 0.1, 0] as [number, number, number], width: 0.9 },
      { id: 'closest', position: [0, 0.1, 0] as [number, number, number], width: 0.35 },
      { id: 'selected', position: [0.425, 0.1, 0] as [number, number, number], width: 0.5 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'selected', 0.7, {
      wallConstraints: {
        left: { constrained: true, slack: 0 },
        right: { constrained: true, slack: 0 },
      },
      eligibleDonorIds: new Set(['far', 'closest']),
    })

    expect(reflowed[0]!.width).toBeCloseTo(0.75)
    expect(reflowed[1]!.width).toBeCloseTo(0.3)
    expect(reflowed[2]!.width).toBeCloseTo(0.7)
  })

  test('uses the larger donor when two equally close cabinets are eligible', () => {
    const modules = [
      { id: 'left', position: [-0.6, 0.1, 0] as [number, number, number], width: 0.7 },
      { id: 'middle', position: [0, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'right', position: [0.45, 0.1, 0] as [number, number, number], width: 0.4 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'middle', 0.75, {
      wallConstraints: {
        left: { constrained: true, slack: 0 },
        right: { constrained: true, slack: 0 },
      },
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
      wallConstraints: {
        left: { constrained: true, slack: 0 },
        right: { constrained: true, slack: 0 },
      },
    })
    const restorableWidthById = new Map(
      modules.map((module, index) => [module.id, module.width - widened[index]!.width]),
    )

    const restored = reflowCabinetRunModules(widened, 'middle', 0.5, {
      wallConstraints: {
        left: { constrained: true, slack: 0 },
        right: { constrained: true, slack: 0 },
      },
      restorableWidthById,
    })

    expect(restored.map((module) => module.width)).toEqual([0.7, 0.5, 0.4])
    expect(restored[0]!.position[0] - restored[0]!.width / 2).toBeCloseTo(-0.95)
    expect(restored[2]!.position[0] + restored[2]!.width / 2).toBeCloseTo(0.65)
  })

  test('keeps a two-wall extent when shrinking without recorded donor debt', () => {
    const modules = [
      { id: 'donor', position: [-0.38, 0.1, 0] as [number, number, number], width: 0.5 },
      { id: 'selected', position: [0.25, 0.1, 0] as [number, number, number], width: 0.76 },
    ]

    const reflowed = reflowCabinetRunModules(modules, 'selected', 0.5, {
      wallConstraints: {
        left: { constrained: true, slack: 0 },
        right: { constrained: true, slack: 0 },
      },
      eligibleDonorIds: new Set(['donor']),
    })

    expect(reflowed.map((module) => module.width)).toEqual([0.76, 0.5])
    expect(reflowed[0]!.position[0] - reflowed[0]!.width / 2).toBeCloseTo(-0.63)
    expect(reflowed[1]!.position[0] + reflowed[1]!.width / 2).toBeCloseTo(0.63)
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

import { describe, expect, test } from 'bun:test'
import {
  type CabinetCompartment,
  FRIDGE_COLUMN_HEIGHT,
  FRIDGE_COLUMN_WIDTH,
  FRIDGE_STANDARD_DEPTH,
  FRIDGE_WIDE_WIDTH,
  MICROWAVE_DEFAULT_HEIGHT,
  MICROWAVE_STANDARD_HEIGHT,
  MICROWAVE_STANDARD_WIDTH,
  minCabinetCarcassHeightForStack,
  newCabinetCompartment,
  normalizeCabinetStack,
  OVEN_DEFAULT_HEIGHT,
  reflowCabinetRunModules,
  replaceCabinetCompartmentStack,
  resizeCabinetCompartmentStack,
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
})

describe('appliance compartments', () => {
  test('newCabinetCompartment seeds fixed appliance heights', () => {
    const oven = newCabinetCompartment('oven')
    const microwave = newCabinetCompartment('microwave')

    expect(oven.type).toBe('oven')
    expect(oven.height).toBe(OVEN_DEFAULT_HEIGHT)
    expect(microwave.type).toBe('microwave')
    expect(microwave.height).toBe(MICROWAVE_DEFAULT_HEIGHT)
    expect(MICROWAVE_STANDARD_WIDTH).toBeCloseTo(0.61)
    expect(MICROWAVE_STANDARD_HEIGHT).toBeCloseTo(0.39)
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
          { id: 'fridge', type: 'fridge-single', height: FRIDGE_COLUMN_HEIGHT },
        ],
      }),
    ).toBeCloseTo(0.1 + OVEN_DEFAULT_HEIGHT + MICROWAVE_DEFAULT_HEIGHT + FRIDGE_COLUMN_HEIGHT)
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
})

import { expect, test } from 'bun:test'
import { WindowNode } from '../schema'
import { windowTypeChange } from './window-types'

// The window panel's Type row: Bay and Bow have no sill, so leaving them gives the window its sill
// back; a sill the person turned off on any other type stays off.
test('a window leaving Bay or Bow gets its sill back; a sill turned off elsewhere stays off', () => {
  const bay = WindowNode.parse({ windowType: 'bay', sill: false })
  expect(windowTypeChange(bay, 'fixed')).toMatchObject({ windowType: 'fixed', sill: true })
  expect(windowTypeChange(bay, 'bow')).toMatchObject({ windowType: 'bow', sill: false })
  const noSill = WindowNode.parse({ windowType: 'fixed', sill: false })
  expect(windowTypeChange(noSill, 'casement')).not.toHaveProperty('sill')
  expect(windowTypeChange(WindowNode.parse({ windowType: 'fixed' }), 'bay')).toMatchObject({
    sill: false,
  })
})

test('saved windows keep optional grids, stool boards and shutters absent', () => {
  const saved = WindowNode.parse({
    windowType: 'double-hung',
    columnRatios: [1, 1, 1],
    rowRatios: [1, 1],
  })
  for (const key of [
    'sashGrid',
    'windowHandle',
    'sillInterior',
    'shutters',
    'shutterWidth',
    'openingDirection',
    'tiltTurnMode',
    'rollerShutter',
    'rollerShutterBoxHeight',
    'rollerShutterOpen',
    'shutterOpen',
    'shutterSides',
    'sillOverhang',
    'sillInteriorDepth',
    'sillInteriorThickness',
    'sillInteriorOverhang',
  ]) {
    expect(saved).not.toHaveProperty(key)
  }
  expect(WindowNode.safeParse({ shutterWidth: 0 }).success).toBe(false)
  expect(WindowNode.safeParse({ shutters: 'unknown' }).success).toBe(false)
})

test('window fractions and sill dimensions reject invalid stored data', () => {
  for (const key of ['shutterOpen', 'rollerShutterOpen']) {
    expect(WindowNode.safeParse({ [key]: -0.1 }).success).toBe(false)
    expect(WindowNode.safeParse({ [key]: 1.1 }).success).toBe(false)
  }
  for (const key of ['sillInteriorDepth', 'sillInteriorThickness', 'rollerShutterBoxHeight'])
    expect(WindowNode.safeParse({ [key]: 0 }).success).toBe(false)
  for (const key of ['sillOverhang', 'sillInteriorOverhang']) {
    expect(WindowNode.safeParse({ [key]: -0.01 }).success).toBe(false)
    expect(WindowNode.safeParse({ [key]: 0 }).success).toBe(true)
  }
})

test.each(['none', 'box', 'concealed'] as const)(
  'window roller mount %s loads with an optional uncapped box height',
  (rollerShutter) => {
    expect(WindowNode.parse({ rollerShutter, rollerShutterBoxHeight: 0.9 })).toMatchObject({
      rollerShutter,
      rollerShutterBoxHeight: 0.9,
    })
    expect(WindowNode.safeParse({ rollerShutter: 'invalid' }).success).toBe(false)
  },
)

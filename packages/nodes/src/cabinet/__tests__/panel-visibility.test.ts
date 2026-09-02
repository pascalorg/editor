import { expect, test } from 'bun:test'
import { CabinetModuleNode } from '@pascal-app/core'
import {
  cabinetModuleSupportsPresets,
  cabinetModuleSupportsTopFinish,
  cabinetModuleUsesFixedApplianceWidth,
} from '../panel-visibility'

test.each([
  'Corner Filler',
  'Wall Bridge Filler',
  'Corner Wall Filler',
])('%s supports a top or ceiling finish without relying on its parent run', (name) => {
  const module = CabinetModuleNode.parse({ moduleKind: 'corner-filler', name })

  expect(cabinetModuleSupportsTopFinish({ module, parentIsModule: false })).toBe(true)
})

test('an ordinary base module still omits the top or ceiling finish controls', () => {
  const module = CabinetModuleNode.parse({ cabinetType: 'base' })

  expect(cabinetModuleSupportsTopFinish({ module, parentIsModule: false })).toBe(false)
})

test('structural corner fillers cannot be converted with cabinet presets', () => {
  const filler = CabinetModuleNode.parse({ moduleKind: 'corner-filler', name: 'Corner Filler' })
  const cabinet = CabinetModuleNode.parse({ moduleKind: 'standard', name: 'Base Cabinet' })

  expect(cabinetModuleSupportsPresets(filler)).toBe(false)
  expect(cabinetModuleSupportsPresets(cabinet)).toBe(true)
})

test.each([
  'oven',
  'microwave',
  'dishwasher',
  'sink',
  'cooktop-gas',
  'cooktop-induction',
  'pull-out-pantry',
  'fridge-single',
  'fridge-double',
  'fridge-top-freezer',
  'fridge-bottom-freezer',
])('%s modules use a fixed appliance width', (type) => {
  const module = CabinetModuleNode.parse({
    stack: [{ id: 'appliance', type, height: 0.6 }],
  })

  expect(cabinetModuleUsesFixedApplianceWidth(module)).toBe(true)
})

test.each(['shelf', 'drawer', 'door'])('%s modules keep editable standard widths', (type) => {
  const module = CabinetModuleNode.parse({ stack: [{ id: 'storage', type }] })

  expect(cabinetModuleUsesFixedApplianceWidth(module)).toBe(false)
})

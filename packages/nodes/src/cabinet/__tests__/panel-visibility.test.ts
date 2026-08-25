import { expect, test } from 'bun:test'
import { CabinetModuleNode } from '@pascal-app/core'
import { cabinetModuleSupportsTopFinish } from '../panel-visibility'

test.each(['Corner Filler', 'Wall Bridge Filler', 'Corner Wall Filler'])(
  '%s supports a top or ceiling finish without relying on its parent run',
  (name) => {
    const module = CabinetModuleNode.parse({ moduleKind: 'corner-filler', name })

    expect(cabinetModuleSupportsTopFinish({ module, parentIsModule: false })).toBe(true)
  },
)

test('an ordinary base module still omits the top or ceiling finish controls', () => {
  const module = CabinetModuleNode.parse({ cabinetType: 'base' })

  expect(cabinetModuleSupportsTopFinish({ module, parentIsModule: false })).toBe(false)
})

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

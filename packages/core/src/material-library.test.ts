import { expect, test } from 'bun:test'
import { getMaterialSolidColorByRef, toLibraryMaterialRef } from './material-library'

test('textured library fills resolve to a solid representative colour', () => {
  expect(getMaterialSolidColorByRef(toLibraryMaterialRef('wood-finewood27'))).toBe('#a8794c')
  expect(getMaterialSolidColorByRef(toLibraryMaterialRef('roof-claytiles'))).toBe('#b65f38')
})

test('paint colour presets keep their explicit preview colour', () => {
  expect(getMaterialSolidColorByRef(toLibraryMaterialRef('preset-white'))).toBe('#ffffff')
  expect(getMaterialSolidColorByRef(toLibraryMaterialRef('preset-forest'))).toBe('#4f6b57')
})

import { describe, expect, test } from 'bun:test'
import { GutterNode } from '@pascal-app/core'
import { gutterDefinition } from './definition'

describe('gutter paint capability', () => {
  test('paints the complete gutter as one surface', () => {
    const node = GutterNode.parse({ id: 'gutter_test', type: 'gutter' })
    const paint = gutterDefinition.capabilities.paint

    expect(paint?.materialTarget).toBe('gutter')
    expect(
      paint?.resolveRole({
        node,
        materialIndex: null,
      }),
    ).toBe('surface')
    expect(
      paint?.buildPatch({
        node,
        role: 'surface',
        material: undefined,
        materialPreset: 'library:metal-steel',
      }),
    ).toEqual({
      material: undefined,
      materialPreset: 'library:metal-steel',
    })
  })
})

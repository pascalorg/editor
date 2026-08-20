import { describe, expect, test } from 'bun:test'
import { DownspoutNode } from '@pascal-app/core'
import { downspoutDefinition } from './definition'

describe('downspout paint capability', () => {
  test('paints the complete downspout as one surface', () => {
    const node = DownspoutNode.parse({ id: 'downspout_test', type: 'downspout' })
    const paint = downspoutDefinition.capabilities.paint

    expect(paint?.materialTarget).toBe('downspout')
    expect(paint?.resolveRole({ node, materialIndex: null })).toBe('surface')
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

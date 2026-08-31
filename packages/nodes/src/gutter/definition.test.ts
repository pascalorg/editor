import { describe, expect, test } from 'bun:test'
import { GutterNode } from '@pascal-app/core'
import { gutterDefinition } from './definition'

describe('gutter paint capability', () => {
  test('paints the complete gutter through the gutter slot', () => {
    const node = GutterNode.parse({ id: 'gutter_test', type: 'gutter' })
    const paint = gutterDefinition.capabilities.paint

    expect(gutterDefinition.capabilities.slots?.(node)).toEqual([
      { slotId: 'gutter', label: 'Gutter', default: 'library:preset-softwhite' },
    ])
    expect(paint?.materialTarget).toBe('gutter')
    expect(
      paint?.resolveRole({
        node,
        materialIndex: null,
      }),
    ).toBe('gutter')
    expect(
      paint?.buildPatch({
        node,
        role: 'gutter',
        material: undefined,
        materialPreset: 'library:metal-steel',
      }),
    ).toEqual({
      slots: { gutter: 'library:metal-steel' },
    })
  })
})

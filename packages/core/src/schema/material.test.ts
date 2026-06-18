import { expect, test } from 'bun:test'
import { MaterialSchema } from './material'

test('material schema accepts serialized three.js side values from material map presets', () => {
  expect(
    MaterialSchema.parse({
      preset: 'custom',
      properties: {
        color: '#ffffff',
        roughness: 0.5,
        metalness: 0,
        opacity: 1,
        transparent: false,
        side: 0,
      },
    }).properties?.side,
  ).toBe('front')

  expect(
    MaterialSchema.parse({
      preset: 'custom',
      properties: {
        color: '#ffffff',
        roughness: 0.5,
        metalness: 0,
        opacity: 1,
        transparent: false,
        side: 2,
      },
    }).properties?.side,
  ).toBe('double')
})

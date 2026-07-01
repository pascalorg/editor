import { expect, test } from 'bun:test'
import { MaterialSchema, MaterialTarget } from './material'

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

test('material schema accepts linear gradients with per-stop opacity', () => {
  const material = MaterialSchema.parse({
    preset: 'custom',
    properties: {
      color: '#ffffff',
      opacity: 0.8,
      transparent: true,
    },
    gradient: {
      space: 'uv',
      axis: 'y',
      stops: [
        { offset: 0, color: '#ffffff', opacity: 1 },
        { offset: 1, color: '#1d4ed8', opacity: 0.35 },
      ],
    },
  })

  expect(material.gradient?.type).toBe('linear')
  expect(material.gradient?.stops[1]?.opacity).toBe(0.35)
})

test('material gradients require at least two stops', () => {
  expect(() =>
    MaterialSchema.parse({
      preset: 'custom',
      gradient: {
        stops: [{ offset: 0, color: '#ffffff', opacity: 1 }],
      },
    }),
  ).toThrow()
})

test('material targets include catalog items', () => {
  expect(MaterialTarget.parse('item')).toBe('item')
})

import { describe, expect, test } from 'bun:test'
import { getEffectiveRoofSurfaceMaterial, RoofNode } from '@pascal-app/core'
import { buildRoofSurfaceMaterialPatch } from './material-paint'

const paint = (color: string) => ({
  preset: 'custom' as const,
  properties: {
    color,
    roughness: 0.5,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front' as const,
  },
})
const colour = (node: RoofNode, role: Parameters<typeof getEffectiveRoofSurfaceMaterial>[1]) =>
  getEffectiveRoofSurfaceMaterial(node, role).material?.properties?.color

describe('painting one roof surface', () => {
  test('leaves the others as they look, even the ones that followed the gables', () => {
    const red = paint('#ff0000')
    const green = paint('#00ff00')
    const roof = RoofNode.parse({ type: 'roof', edgeMaterial: red })
    const fascia = { ...roof, ...buildRoofSurfaceMaterialPatch(roof, 'fascia', green, undefined) }
    expect(colour(fascia, 'fascia')).toBe(green.properties.color)
    expect(colour(fascia, 'soffit')).toBe(red.properties.color)
    expect(colour(fascia, 'edge')).toBe(red.properties.color)

    // repainting the gables no longer drags the soffit along
    const blue = paint('#0000ff')
    const gables = { ...fascia, ...buildRoofSurfaceMaterialPatch(fascia, 'edge', blue, undefined) }
    expect(colour(gables, 'edge')).toBe(blue.properties.color)
    expect(colour(gables, 'soffit')).toBe(red.properties.color)
    expect(colour(gables, 'fascia')).toBe(green.properties.color)
  })
})

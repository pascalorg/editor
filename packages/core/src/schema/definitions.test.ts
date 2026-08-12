import { describe, expect, test } from 'bun:test'
import { Definition } from './definitions'
import { InstanceNode } from './nodes/instance'

describe('component definitions', () => {
  test('parses a definition and an instance transform', () => {
    const definition = Definition.parse({
      id: 'definition_balcony',
      name: 'Balcony A',
      rootNodeId: 'shelf_balcony',
      thumbnail: 'data:image/png;base64,AA==',
    })
    const instance = InstanceNode.parse({ definitionId: definition.id })

    expect(instance.definitionId).toBe(definition.id)
    expect(instance.position).toEqual([0, 0, 0])
    expect(instance.rotation).toEqual([0, 0, 0])
    expect(instance.scale).toEqual([1, 1, 1])
  })

  test('rejects unsafe thumbnail URLs', () => {
    expect(
      Definition.safeParse({
        id: 'definition_balcony',
        name: 'Balcony A',
        rootNodeId: 'shelf_balcony',
        thumbnail: 'javascript:alert(1)',
      }).success,
    ).toBe(false)
  })
})

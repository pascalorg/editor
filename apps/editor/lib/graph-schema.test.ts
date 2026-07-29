import { describe, expect, test } from 'bun:test'
import { apiGraphSchema } from './graph-schema'

const material = {
  id: 'mat_accent',
  name: 'Accent',
  material: {
    texture: { url: 'https://cdn.example.com/accent.png' },
  },
}

describe('apiGraphSchema', () => {
  test('preserves validated scene materials', () => {
    const graph = apiGraphSchema.parse({
      nodes: {},
      rootNodeIds: [],
      materials: { mat_accent: material },
    })

    expect(graph.materials?.mat_accent).toMatchObject(material)
  })

  for (const url of ['file:///private/key', 'javascript:alert(1)']) {
    test(`rejects unsafe material texture URL: ${url}`, () => {
      const result = apiGraphSchema.safeParse({
        nodes: {},
        rootNodeIds: [],
        materials: {
          mat_accent: {
            ...material,
            material: { texture: { url } },
          },
        },
      })

      expect(result.success).toBe(false)
    })
  }
})

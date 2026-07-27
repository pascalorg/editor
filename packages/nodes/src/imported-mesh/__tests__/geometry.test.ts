import { describe, expect, test } from 'bun:test'
import { ImportedMeshNode } from '@pascal-app/core'
import type { Mesh } from 'three'
import { buildImportedMeshGeometry } from '../geometry'

describe('buildImportedMeshGeometry', () => {
  test('builds indexed colored triangle primitives', () => {
    const node = ImportedMeshNode.parse({
      id: 'imesh_test',
      type: 'imported-mesh',
      primitives: [
        {
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
          color: '#ff0000',
        },
      ],
    })
    const group = buildImportedMeshGeometry(node)
    expect(group.children).toHaveLength(1)
    const mesh = group.children[0] as Mesh
    expect(mesh.geometry.getAttribute('position').count).toBe(3)
    expect(mesh.geometry.index?.count).toBe(3)
  })
})

import { describe, expect, test } from 'bun:test'
import { ImportedMeshNode } from '@pascal-app/core'
import { disposeObject3DResources } from '@pascal-app/viewer'
import type { Mesh, MeshStandardMaterial } from 'three'
import { importedMeshDefinition } from '../definition'
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

  test('shares one cached material per colour and opacity, so primitives can batch', () => {
    const build = (color: string, opacity?: number) =>
      buildImportedMeshGeometry(
        ImportedMeshNode.parse({
          id: `imesh_${color}_${opacity ?? 1}`,
          type: 'imported-mesh',
          primitives: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [], color, opacity }],
        }),
      ).children[0] as Mesh
    const first = build('#ebe9de')
    const second = build('#ebe9de')
    expect(second.material).toBe(first.material)
    expect(build('#414744').material).not.toBe(first.material)
    const glass = build('#ebe9de', 0.4).material as MeshStandardMaterial
    expect(glass).not.toBe(first.material)
    expect(glass.transparent).toBe(true)
    // Rebuilds dispose builder output; the shared material must survive them.
    let disposed = false
    ;(first.material as MeshStandardMaterial).addEventListener('dispose', () => {
      disposed = true
    })
    disposeObject3DResources(first)
    expect(disposed).toBe(false)
  })

  test('is selectable and deletable but not movable', () => {
    expect(importedMeshDefinition.capabilities.selectable).toBeDefined()
    expect(importedMeshDefinition.capabilities.deletable).toBe(true)
    expect('movable' in importedMeshDefinition.capabilities).toBe(false)
  })
})

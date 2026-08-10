import { describe, expect, test } from 'bun:test'
import { CustomMeshNode } from '@pascal-app/core'
import { Mesh } from 'three'
import { applyCustomMeshCommand } from './commands'
import { buildCustomMeshGeometry } from './geometry'

describe('buildCustomMeshGeometry', () => {
  test('derives a render mesh from persistent topology', () => {
    const node = CustomMeshNode.parse({ name: 'Box' })
    const group = buildCustomMeshGeometry(node)
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    expect(mesh.geometry.getAttribute('position').count).toBe(36)
    expect(mesh.geometry.getAttribute('normal').count).toBe(36)
    expect(mesh.geometry.getAttribute('uv').count).toBe(36)
    expect(mesh.geometry.userData.customMeshFaces).toHaveLength(6)
  })

  test('rebuilds the extruded topology into additional face triangles', () => {
    const node = CustomMeshNode.parse({ name: 'Box' })
    const result = applyCustomMeshCommand(node.topology, {
      type: 'extrude-face',
      faceId: 'f-top',
      distance: 0.25,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const group = buildCustomMeshGeometry({ ...node, topology: result.topology })
    const mesh = group.getObjectByName('custom-mesh-body')

    expect(mesh).toBeInstanceOf(Mesh)
    if (!(mesh instanceof Mesh)) return
    expect(mesh.geometry.getAttribute('position').count).toBe(60)
    expect(mesh.geometry.userData.customMeshFaces).toHaveLength(10)
  })
})

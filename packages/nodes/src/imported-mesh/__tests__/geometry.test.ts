import { describe, expect, test } from 'bun:test'
import { ImportedMeshNode } from '@pascal-app/core'
import type { Mesh } from 'three'
import { importedMeshDefinition } from '../definition'
import { buildImportedMeshGeometry } from '../geometry'

type Primitive = { positions: number[]; indices?: number[]; normals?: number[] }

function buildMesh(primitive: Primitive): Mesh {
  const node = ImportedMeshNode.parse({
    id: 'imesh_test',
    type: 'imported-mesh',
    primitives: [primitive],
  })
  const group = buildImportedMeshGeometry(node)
  expect(group.children).toHaveLength(1)
  return group.children[0] as Mesh
}

function normalsOf(mesh: Mesh): [number, number, number][] {
  const normal = mesh.geometry.getAttribute('normal')
  expect(normal).toBeDefined()
  return Array.from({ length: normal.count }, (_, i) => [
    normal.getX(i),
    normal.getY(i),
    normal.getZ(i),
  ])
}

function expectFacing(mesh: Mesh, expected: [number, number, number]) {
  const normals = normalsOf(mesh)
  expect(normals.filter((n) => !n.every(Number.isFinite))).toEqual([])
  for (const [x, y, z] of normals) {
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5)
    expect(x).toBeCloseTo(expected[0], 5)
    expect(y).toBeCloseTo(expected[1], 5)
    expect(z).toBeCloseTo(expected[2], 5)
  }
}

// Unit square in the XZ plane, vertices listed around the rim.
const QUAD = [0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0]
// Counter-clockwise seen from +Y, so the right-hand normal is +Y.
const UP_INDICES = [0, 1, 2, 0, 2, 3]
const DOWN_INDICES = [0, 2, 1, 0, 3, 2]

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

  test('computes indexed normals from the index, facing the winding', () => {
    expectFacing(buildMesh({ positions: QUAD, indices: UP_INDICES }), [0, 1, 0])
    expectFacing(buildMesh({ positions: QUAD, indices: DOWN_INDICES }), [0, -1, 0])
  })

  test('computes non-indexed normals per triangle, facing the winding', () => {
    const soup = (indices: number[]) => indices.flatMap((i) => QUAD.slice(i * 3, i * 3 + 3))
    expectFacing(buildMesh({ positions: soup(UP_INDICES) }), [0, 1, 0])
    expectFacing(buildMesh({ positions: soup(DOWN_INDICES) }), [0, -1, 0])
  })

  test('keeps explicit normals as given', () => {
    const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
    const mesh = buildMesh({ positions: QUAD, indices: UP_INDICES, normals })
    expect(Array.from(mesh.geometry.getAttribute('normal').array)).toEqual(normals)
  })

  test('leaves positions, pose and triangle count unchanged', () => {
    const mesh = buildMesh({ positions: QUAD, indices: UP_INDICES })
    expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(QUAD)
    expect(Array.from(mesh.geometry.index?.array ?? [])).toEqual(UP_INDICES)
    expect((mesh.geometry.index?.count ?? 0) / 3).toBe(2)
    expect(mesh.position.toArray()).toEqual([0, 0, 0])
    expect(mesh.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0])
  })

  test('is selectable and deletable but not movable', () => {
    expect(importedMeshDefinition.capabilities.selectable).toBeDefined()
    expect(importedMeshDefinition.capabilities.deletable).toBe(true)
    expect('movable' in importedMeshDefinition.capabilities).toBe(false)
  })
})

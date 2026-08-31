// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import * as THREE from 'three'
import { setGroupsSortedByMaterial } from './geometry-groups'

function triangleSoup(triangleCount: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(triangleCount * 9)
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    positions[triangle * 9] = triangle
    positions[triangle * 9 + 3] = triangle + 1
    positions[triangle * 9 + 7] = 1
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

/** Triangles as vertex-index triples, in the order the GPU would draw them. */
function drawnTriangles(geometry: THREE.BufferGeometry): number[][] {
  const index = geometry.getIndex()
  const count = index ? index.count : geometry.getAttribute('position').count
  const triangles: number[][] = []
  for (let base = 0; base < count; base += 3) {
    triangles.push(
      index
        ? [index.getX(base), index.getX(base + 1), index.getX(base + 2)]
        : [base, base + 1, base + 2],
    )
  }
  return triangles
}

describe('setGroupsSortedByMaterial', () => {
  test('collapses interleaved materials into one group each', () => {
    const geometry = triangleSoup(6)

    setGroupsSortedByMaterial(geometry, [0, 1, 0, 2, 1, 0])

    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2])
    expect(geometry.groups.map((group) => group.count)).toEqual([9, 6, 3])
    expect(geometry.groups.map((group) => group.start)).toEqual([0, 9, 15])
  })

  test('keeps every triangle exactly once, only reordered', () => {
    const geometry = triangleSoup(6)

    setGroupsSortedByMaterial(geometry, [0, 1, 0, 2, 1, 0])

    const drawn = drawnTriangles(geometry)
    expect(drawn).toHaveLength(6)
    expect([...drawn].sort((a, b) => a[0]! - b[0]!)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [9, 10, 11],
      [12, 13, 14],
      [15, 16, 17],
    ])
  })

  test('draws each group with the material its triangles were assigned', () => {
    const geometry = triangleSoup(4)
    const assignment = [2, 0, 2, 1]

    setGroupsSortedByMaterial(geometry, assignment)

    const drawn = drawnTriangles(geometry)
    for (const group of geometry.groups) {
      for (let offset = 0; offset < group.count; offset += 3) {
        const sourceTriangle = drawn[(group.start + offset) / 3]![0]! / 3
        expect(assignment[sourceTriangle]).toBe(group.materialIndex!)
      }
    }
  })

  test('leaves a single-material geometry unindexed', () => {
    const geometry = triangleSoup(3)

    setGroupsSortedByMaterial(geometry, [1, 1, 1])

    expect(geometry.getIndex()).toBeNull()
    expect(geometry.groups).toEqual([{ start: 0, count: 9, materialIndex: 1 }])
  })

  test('reorders an existing index buffer instead of the vertices', () => {
    const geometry = triangleSoup(3)
    geometry.setIndex([6, 7, 8, 0, 1, 2, 3, 4, 5])

    setGroupsSortedByMaterial(geometry, [1, 0, 1])

    expect(drawnTriangles(geometry)).toEqual([
      [0, 1, 2],
      [6, 7, 8],
      [3, 4, 5],
    ])
    expect(geometry.getAttribute('position').getX(0)).toBe(0)
  })
})

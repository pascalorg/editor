// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { describe, expect, test } from 'bun:test'
import { calculateLevelMiters, sceneRegistry, WallNode, WindowNode } from '@pascal-app/core'
import * as THREE from 'three'
import { generateExtrudedWall } from './wall-system'
import { repairWallTJunctions } from './wall-t-junctions'

function triangles(geometry: THREE.BufferGeometry): THREE.Vector3[][] {
  const position = geometry.getAttribute('position')
  const index = geometry.index
  const count = index?.count ?? position.count
  const out: THREE.Vector3[][] = []
  for (let offset = 0; offset < count; offset += 3) {
    out.push(
      [0, 1, 2].map((corner) =>
        new THREE.Vector3().fromBufferAttribute(
          position,
          index ? index.getX(offset + corner) : offset + corner,
        ),
      ),
    )
  }
  return out
}

/** Vertices lying strictly inside another triangle's edge. */
function countTJunctions(geometry: THREE.BufferGeometry): number {
  const tris = triangles(geometry)
  const vertices = tris.flat()
  const line = new THREE.Line3()
  const closest = new THREE.Vector3()
  let count = 0
  for (const tri of tris) {
    for (let k = 0; k < 3; k += 1) {
      line.set(tri[k]!, tri[(k + 1) % 3]!)
      const length = line.distance()
      if (length < 1e-4) continue
      for (const vertex of vertices) {
        const t = line.closestPointToPointParameter(vertex, false)
        if (t * length < 1e-4 || (1 - t) * length < 1e-4) continue
        line.at(t, closest)
        if (closest.distanceTo(vertex) < 1e-6) count += 1
      }
    }
  }
  return count
}

function area(geometry: THREE.BufferGeometry): number {
  return triangles(geometry).reduce(
    (sum, [a, b, c]) => sum + new THREE.Triangle(a, b, c).getArea(),
    0,
  )
}

describe('wall T-junctions', () => {
  test('a vertex on a neighbour edge becomes shared, area unchanged', () => {
    // A unit square: one triangle above the diagonal, two below it that meet
    // at the diagonal's midpoint — which sits inside the upper triangle's edge.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, 1, 0, 0, 1, 1, 0],
        3,
      ),
    )
    expect(countTJunctions(geometry)).toBeGreaterThan(0)
    const before = area(geometry)

    const repaired = repairWallTJunctions(geometry)

    expect(countTJunctions(repaired)).toBe(0)
    expect(area(repaired)).toBeCloseTo(before, 9)
  })

  test('a wall cut by a window has no T-junctions', () => {
    const wall = WallNode.parse({
      id: 'wall_t-junction-window',
      start: [0, 0],
      end: [5, 0],
      height: 2.5,
      thickness: 0.2,
    })
    const window = WindowNode.parse({
      id: 'window_t-junction',
      wallId: wall.id,
      position: [2.5, 1.4, 0],
      width: 1.2,
      height: 1.2,
    })
    sceneRegistry.nodes.set(wall.id, new THREE.Mesh())
    try {
      const geometry = generateExtrudedWall(wall, [window], calculateLevelMiters([wall]))
      expect(countTJunctions(geometry)).toBe(0)
    } finally {
      sceneRegistry.nodes.delete(wall.id)
    }
  })
})

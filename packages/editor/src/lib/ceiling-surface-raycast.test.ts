import { describe, expect, test } from 'bun:test'
import {
  BackSide,
  Mesh,
  MeshBasicMaterial,
  Path,
  Raycaster,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three'
import { raycastCeilingUnderside } from './ceiling-surface-raycast'

function ceilingMesh() {
  const shape = new Shape()
  shape.moveTo(-2, -2)
  shape.lineTo(2, -2)
  shape.lineTo(2, 2)
  shape.lineTo(-2, 2)
  shape.closePath()
  const hole = new Path()
  hole.moveTo(-0.5, -0.5)
  hole.lineTo(-0.5, 0.5)
  hole.lineTo(0.5, 0.5)
  hole.lineTo(0.5, -0.5)
  hole.closePath()
  shape.holes.push(hole)
  const geometry = new ShapeGeometry(shape).rotateX(-Math.PI / 2)
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: BackSide }))
  mesh.position.y = 3
  mesh.updateMatrixWorld(true)
  return mesh
}

describe('ceiling drawing surfaces', () => {
  test('lets drawing pass through the transparent top while picking the underside', () => {
    const ceiling = ceilingMesh()
    for (const side of [-1, 1]) {
      const ray = new Raycaster(new Vector3(1, 3 + side * 2, 0), new Vector3(0, -side, 0))
      const hit = raycastCeilingUnderside(ray, ceiling)[0]
      if (side > 0) {
        expect(hit).toBeUndefined()
      } else {
        expect(hit?.point.y).toBeCloseTo(3)
        expect(hit?.object).toBe(ceiling)
      }
      expect(ceiling.material.side).toBe(BackSide)
    }
    ceiling.geometry.dispose()
    ceiling.material.dispose()
  })

  test('respects ceiling holes and the polygon boundary from either side', () => {
    const ceiling = ceilingMesh()
    for (const side of [-1, 1]) {
      for (const x of [0, 3]) {
        const ray = new Raycaster(new Vector3(x, 3 + side * 2, 0), new Vector3(0, -side, 0))
        expect(raycastCeilingUnderside(ray, ceiling)).toHaveLength(0)
      }
    }
    ceiling.geometry.dispose()
    ceiling.material.dispose()
  })
})

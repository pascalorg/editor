import { expect, test } from 'bun:test'
import { containsPoint, polygonInteriorPoint, type Ring } from '@pascal-app/core'
import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, ShapeGeometry, Vector3 } from 'three'
import { createZoneShape, createZoneWallGeometry } from './zone-geometry'

const footprint = {
  polygon: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ] as Ring,
  holes: [
    [
      [3, 3],
      [7, 3],
      [7, 7],
      [3, 7],
    ],
  ] as Ring[],
}

test('shared live and GLB zone geometry leaves the hole unfilled and outlines both rims', () => {
  const geometry = new ShapeGeometry(createZoneShape(footprint))
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const mesh = new Mesh(geometry, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.updateMatrixWorld(true)
  const ray = new Raycaster(new Vector3(5, 10, 5), new Vector3(0, -1, 0))
  expect(ray.intersectObject(mesh)).toHaveLength(0)
  ray.ray.origin.set(1, 10, 1)
  expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
  const borders = createZoneWallGeometry(footprint)
  expect(borders.getAttribute('position').count).toBe(32)
  expect(borders.index!.count).toBe(48)
  const label = polygonInteriorPoint(footprint)
  expect(containsPoint([{ outer: footprint.polygon, holes: footprint.holes }], label)).toBe(true)
  geometry.dispose()
  borders.dispose()
  material.dispose()
})

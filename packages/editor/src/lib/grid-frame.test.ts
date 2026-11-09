import { describe, expect, test } from 'bun:test'
import { Group, Quaternion, Vector3 } from 'three'
import {
  gridLocalNormal,
  gridLocalPoint,
  HORIZONTAL_GRID_QUATERNION,
  layHorizontalGrid,
} from './grid-frame'

test('grid floor and cursor stay in model coordinates after God-view pan, scale and yaw', () => {
  const root = new Group()
  root.position.set(2, 4, -3)
  root.rotation.y = Math.PI / 3
  root.scale.setScalar(0.2)
  root.updateMatrixWorld(true)
  const local = new Vector3(3, 2.5, 7)
  const world = root.localToWorld(local.clone())
  expect(gridLocalPoint(root, world, new Vector3()).distanceTo(local)).toBeLessThan(1e-8)
  const normal = new Vector3(1, 0, 0).transformDirection(root.matrixWorld)
  expect(
    gridLocalNormal(root, normal, new Vector3()).distanceTo(new Vector3(1, 0, 0)),
  ).toBeLessThan(1e-8)
  expect(world.distanceTo(local)).toBeGreaterThan(1)
})

// The grid plane's lattice lines run at multiples of the cell size in its own
// XY, from its origin: where does plane-local (u, v) land?
function planePoint(position: Vector3, quaternion: Quaternion, u: number, v: number) {
  return new Vector3(u, v, 0).applyQuaternion(quaternion).add(position)
}

describe('layHorizontalGrid', () => {
  test("lays the lattice on a turned, offset building's own frame", () => {
    const yaw = (17 * Math.PI) / 180
    const position = new Vector3()
    const quaternion = new Quaternion()
    layHorizontalGrid({ position: [12.37, 0, -8.91], rotationY: yaw }, 0.301, position, quaternion)

    expect(position.toArray()).toEqual([12.37, 0.301, -8.91])
    // Flat…
    expect(new Vector3(0, 0, 1).applyQuaternion(quaternion).y).toBeCloseTo(1, 12)
    // …and each lattice point is a building-local lattice point: plane (1, -1.5)
    // is building-local (1, 1.5), wherever the building's yaw puts it.
    const point = planePoint(position, quaternion, 1, -1.5)
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    expect(point.x).toBeCloseTo(12.37 + cos + 1.5 * sin, 12)
    expect(point.y).toBeCloseTo(0.301, 12)
    expect(point.z).toBeCloseTo(-8.91 - sin + 1.5 * cos, 12)
  })

  test('with no building the world grid stays anchored at the origin, as before', () => {
    const position = new Vector3(5, 5, 5)
    const quaternion = new Quaternion()
    layHorizontalGrid(null, 0.001, position, quaternion)

    expect(position.toArray()).toEqual([0, 0.001, 0])
    expect(Math.abs(quaternion.dot(HORIZONTAL_GRID_QUATERNION))).toBeCloseTo(1, 12)
    const point = planePoint(position, quaternion, 2, -3)
    expect(point.x).toBeCloseTo(2, 12)
    expect(point.z).toBeCloseTo(3, 12)
  })

  test('an unturned building at the origin draws the same grid as no building', () => {
    const position = new Vector3()
    const quaternion = new Quaternion()
    layHorizontalGrid({ position: [0, 0, 0], rotationY: 0 }, 0.001, position, quaternion)

    expect(position.toArray()).toEqual([0, 0.001, 0])
    expect(Math.abs(quaternion.dot(HORIZONTAL_GRID_QUATERNION))).toBeCloseTo(1, 12)
  })
})

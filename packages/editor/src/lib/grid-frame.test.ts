import { expect, test } from 'bun:test'
import { Group, Vector3 } from 'three'
import { gridLocalNormal, gridLocalPoint } from './grid-frame'

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

import { expect, test } from 'bun:test'
import { Group, Vector3 } from 'three'
import {
  createWallPointerTracker,
  wallPointerInParent,
  wallSideAtPointer,
} from './wall-placement-pointer'

test('grab offsets survive only the original wall face, including a return to that wall', () => {
  const pointer = createWallPointerTracker({
    wallId: 'a',
    side: 'front',
    position: [1.5, 0.8, 0],
  })
  expect(pointer.resolve('a', 'front', [1.2, 0.6])).toEqual([1.5, 0.8])
  expect(pointer.resolve('a', 'front', [1.3, 0.7])[0]).toBeCloseTo(1.6)
  expect(pointer.resolve('b', 'front', [2, 2.4])).toEqual([2, 2.4])
  expect(pointer.resolve('b', 'front', [2.1, 2.5])).toEqual([2.1, 2.5])
  expect(pointer.resolve('a', 'front', [0.5, 1.7])).toEqual([0.5, 1.7])
})
test('opposite faces, host leave and repeated placements never reuse stale offsets', () => {
  const pointer = createWallPointerTracker({
    wallId: 'a',
    side: 'front',
    position: [1, 1, 0],
  })
  pointer.resolve('a', 'front', [0.5, 0.8])
  expect(pointer.resolve('a', 'back', [2, 2])).toEqual([2, 2])
  pointer.leave()
  expect(pointer.resolve('a', 'front', [0.7, 0.2])).toEqual([0.7, 0.2])
  const fresh = createWallPointerTracker()
  expect(fresh.resolve('a', 'front', [0.7, 2.8])).toEqual([0.7, 2.8])
  fresh.leave()
  expect(fresh.resolve('b', 'back', [2.4, 0.1])).toEqual([2.4, 0.1])
})
test('cursor coordinates use the ghost parent under rotated walls and transformed buildings', () => {
  const building = new Group(),
    wall = new Group()
  building.position.set(5, 1, -3)
  building.rotation.y = 0.7
  building.scale.setScalar(0.2)
  wall.position.set(2, 0.15, 4)
  wall.rotation.y = -Math.PI / 2
  building.add(wall)
  building.updateMatrixWorld(true)
  const expected = new Vector3(1.2, 2.4, 0.1),
    world = wall.localToWorld(expected.clone())
  const actual = wallPointerInParent(world.toArray(), wall)
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected.toArray()[i]!, 8))
})

test('placement chooses the touched face on both sides of rotated walls', () => {
  const building = new Group()
  building.rotation.y = 0.7
  building.scale.set(2, 1, 0.5)
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const wall = new Group()
    wall.rotation.y = angle
    wall.position.set(2, 0.15, 4)
    building.add(wall)
    building.updateMatrixWorld(true)
    for (const z of [-0.05, 0.05]) {
      const hit = wall.localToWorld(new Vector3(1, 1.2, z))
      expect(wallSideAtPointer(wallPointerInParent(hit.toArray(), wall)))
        .toBe(z > 0 ? 'front' : 'back')
    }
    building.remove(wall)
  }
})

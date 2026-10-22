import { expect, test } from 'bun:test'
import { Group, Vector3 } from 'three'
import {
  createWallPointerTracker,
  wallPointerInParent,
  wallSideAtPointer,
} from './wall-placement-pointer'

test('keeps the grab offset across a pointer gap on the original face', () => {
  const pointer = createWallPointerTracker({ wallId: 'wall_a', side: 'front', position: [4, 2] })
  expect(pointer.resolve('wall_a', 'front', [3, 1])).toEqual([4, 2])
  pointer.leave()
  expect(pointer.resolve('wall_a', 'front', [5, 3])).toEqual([6, 4])
})
test('a different wall or face permanently releases the old grab offset', () => {
  for (const [wall, side] of [
    ['wall_b', 'front'],
    ['wall_a', 'back'],
  ] as const) {
    const pointer = createWallPointerTracker({ wallId: 'wall_a', side: 'front', position: [4, 2] })
    pointer.resolve('wall_a', 'front', [3, 1])
    expect(pointer.resolve(wall, side, [5, 3])).toEqual([5, 3])
    expect(pointer.resolve('wall_a', 'front', [6, 4])).toEqual([6, 4])
  }
})
test('a committed floor placement releases the original wall grab', () => {
  const pointer = createWallPointerTracker({ wallId: 'wall_a', position: [4, 2] })
  pointer.resolve('wall_a', 'front', [3, 1])
  pointer.forget()
  expect(pointer.resolve('wall_a', 'front', [5, 3])).toEqual([5, 3])
})
test('reads the pointer in the rotated wall parent and identifies its face', () => {
  const parent = new Group()
  parent.position.set(3, 1, 5)
  parent.rotation.y = Math.PI / 2
  parent.updateMatrixWorld(true)
  const world = parent.localToWorld(new Vector3(2, 3, -0.1))
  const local = wallPointerInParent(world.toArray(), parent)
  expect(local[0]).toBeCloseTo(2)
  expect(local[1]).toBeCloseTo(3)
  expect(wallSideAtPointer(local)).toBe('back')
})

import { expect, test } from 'bun:test'
import { DoorNode, doorPositionForFacing, getDoorOpeningSize, openingHostFacing } from '../index'

for (const doorType of ['hinged', 'double', 'french'] as const) {
  test(`${doorType} opening includes fixed lights while its leaf stays put`, () => {
    const door = DoorNode.parse({
      doorType,
      width: 1,
      height: 2,
      sidelightLeft: 0.3,
      sidelightRight: 0.5,
      transomHeight: 0.4,
    })
    expect(getDoorOpeningSize(door)).toEqual({ width: 1.8, height: 2.4, leafOffsetX: -0.1 })
    expect(door.width).toBe(1)
    expect(door.height).toBe(2)
  })
}

test('old scenes and zero lights retain their opening size; other mechanisms ignore lights', () => {
  const door = DoorNode.parse({})
  expect(door).not.toHaveProperty('sidelightLeft')
  expect(door).not.toHaveProperty('slidingStyle')
  expect(getDoorOpeningSize(door)).toEqual({ width: 0.9, height: 2.1, leafOffsetX: 0 })
  expect(getDoorOpeningSize({ ...door, sidelightLeft: 0, transomHeight: 0 })).toEqual(
    getDoorOpeningSize(door),
  )
  expect(
    getDoorOpeningSize({ ...door, doorType: 'sliding', sidelightLeft: 0.5, transomHeight: 1 }),
  ).toEqual(getDoorOpeningSize(door))
  expect(DoorNode.safeParse({ sidelightLeft: -1 }).success).toBe(false)
})

for (const rotationY of [0, Math.PI]) {
  test(`facing a door at ${rotationY} the other way keeps its asymmetric cutout fixed`, () => {
    const door = DoorNode.parse({
      position: [1, 1.05, 0.1],
      rotation: [0, rotationY, 0],
      sidelightLeft: 0.2,
      sidelightRight: 0.6,
    })
    const rotation: DoorNode['rotation'] = [0, rotationY + Math.PI, 0]
    const flipped = { ...door, rotation, position: doorPositionForFacing(door, rotation) }
    const offset = getDoorOpeningSize(door).leafOffsetX
    expect(flipped.position[0] - offset * openingHostFacing(flipped)).toBeCloseTo(
      door.position[0] - offset * openingHostFacing(door),
    )
    expect(flipped.position.slice(1)).toEqual(door.position.slice(1))
    expect(doorPositionForFacing(flipped, door.rotation)).toEqual(door.position)
  })
}

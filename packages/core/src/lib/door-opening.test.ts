import { expect, test } from 'bun:test'
import { DoorNode, getDoorOpeningSize } from '../index'

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

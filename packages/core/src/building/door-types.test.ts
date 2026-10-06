import { describe, expect, test } from 'bun:test'
import { DoorNode } from '../schema'
import { doorTypeChange, doorTypeFields } from './door-types'
import { doorStyleLook, doorStylesOf } from './opening-style-presets'

/**
 * L67: the door panel's Type row, moved into core so the Style row and the placement chips share
 * it. What goes wrong, written first: a person's chosen style lost when they change the type, or
 * a plain door keeping its panels when made French; the door left off the floor at its new height.
 */

describe("the door panel's Type row", () => {
  const door = (fields: Partial<DoorNode> = {}) =>
    DoorNode.parse({ id: 'door_type', position: [1, 1.05, 0], ...fields })

  test('a plain door made French takes the French glazing', () => {
    const french = { ...door(), ...doorTypeChange(door(), 'french') } as DoorNode
    expect(french.segments).toEqual(doorTypeFields('french').segments!)
    expect(french.leafCount).toBe(2)
  })

  test('a modern door made sliding stays modern', () => {
    const modern = door(doorStyleLook('modern'))
    const sliding = { ...modern, ...doorTypeChange(modern, 'sliding') } as DoorNode
    expect(doorStylesOf(sliding)).toEqual(['modern'])
    expect(sliding).toMatchObject({ trackStyle: 'visible', leafCount: 2 })
  })

  test('keeps the door on the floor at the new height', () => {
    const garage = doorTypeChange(door(), 'garage-sectional')
    expect(garage.position).toEqual([1, 1.2, 0])
  })
})

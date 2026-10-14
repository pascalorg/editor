import { describe, expect, test } from 'bun:test'
import { outlineBox } from './outline-box'

// A room is a floor to the person pointing: its corner brackets frame the footprint, not the
// storey-high box that would leave two of them floating in the sky (seen on a two-storey house).
describe('outlineBox', () => {
  const tall = {
    min: [0, 0, 0] as [number, number, number],
    max: [6, 4.5, 6] as [number, number, number],
  }

  test('a room is its footprint at the floor', () => {
    expect(outlineBox('zone', tall)).toEqual({ min: [0, 0, 0], max: [6, 0.02, 6] })
  })

  test('everything else keeps its own box', () => {
    for (const type of ['wall', 'window', 'door', 'item', 'stair', 'roof']) {
      expect(outlineBox(type, tall)).toEqual(tall)
    }
  })

  test('a room that already is flat is left as it is', () => {
    const flat = {
      min: [0, 2.55, 0] as [number, number, number],
      max: [4, 2.55, 4] as [number, number, number],
    }

    expect(outlineBox('zone', flat)).toEqual({ min: [0, 2.55, 0], max: [4, 2.57, 4] })
  })
})

import { describe, expect, test } from 'bun:test'
import { adjacentWallsToggle } from './view-toggles'

describe('walls below and above button', () => {
  test('on the top storey it turns on only the walls below', () => {
    expect(adjacentWallsToggle(false, { below: 'level_0', above: null })).toEqual({ below: true })
  })

  test('on the ground floor it turns on only the walls above', () => {
    expect(adjacentWallsToggle(false, { below: null, above: 'level_1' })).toEqual({ above: true })
  })

  test('between two levels it turns both sides on, then both off', () => {
    const levels = { below: 'level_0', above: 'level_2' }
    expect(adjacentWallsToggle(false, levels)).toEqual({ below: true, above: true })
    expect(adjacentWallsToggle(true, levels)).toEqual({ below: false, above: false })
  })
})

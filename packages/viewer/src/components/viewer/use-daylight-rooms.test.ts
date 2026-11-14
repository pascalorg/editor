// @ts-expect-error — Bun types are not part of the viewer's production declaration build.
import { describe, expect, test } from 'bun:test'
import { roomInputsChanged } from './use-daylight-rooms'

type Nodes = Record<string, { type: string; [key: string]: unknown }>

const level = { type: 'level', elevation: 0, children: ['wall_a', 'item_a'] }
const wall = { type: 'wall', start: [0, 0], end: [4, 0] }
const item = { type: 'item', position: [1, 0, 1], parentId: 'level_a' }
const base: Nodes = { level_a: level, wall_a: wall, item_a: item }

describe('daylight room rebuild trigger', () => {
  test('furniture moving, or re-parenting under a level, leaves the rooms alone', () => {
    const moved: Nodes = { ...base, item_a: { ...item, position: [2, 0, 1] } }
    expect(roomInputsChanged(moved, base)).toBe(false)
    const restacked: Nodes = {
      ...base,
      level_a: { ...level, children: ['wall_a'] },
      item_a: { ...item, parentId: 'item_b' },
    }
    expect(roomInputsChanged(restacked, base)).toBe(false)
    const placed: Nodes = { ...base, item_b: { type: 'item', position: [0, 0, 0] } }
    expect(roomInputsChanged(placed, base)).toBe(false)
  })

  test('walls, levels and other structure rebuild them', () => {
    expect(roomInputsChanged({ ...base, wall_a: { ...wall, end: [5, 0] } }, base)).toBe(true)
    expect(roomInputsChanged({ ...base, level_a: { ...level, elevation: 3 } }, base)).toBe(true)
    const { wall_a: _removed, ...withoutWall } = base
    expect(roomInputsChanged(withoutWall, base)).toBe(true)
    expect(roomInputsChanged({ ...base, door_a: { type: 'door' } }, base)).toBe(true)
  })
})

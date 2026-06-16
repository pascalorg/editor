import { describe, expect, test } from 'bun:test'
import { AnyNode } from '../types'
import { CableTrayNode } from './cable-tray'
import { LevelNode } from './level'
import { SteelBeamNode } from './steel-beam'

describe('LevelNode', () => {
  test('accepts industrial route children', () => {
    const cableTray = CableTrayNode.parse({
      start: [0, 0],
      end: [1, 0],
    })
    const steelBeam = SteelBeamNode.parse({
      start: [0, 1],
      end: [1, 1],
    })

    const level = LevelNode.parse({
      children: [cableTray.id, steelBeam.id],
    })

    expect(level.children).toEqual([cableTray.id, steelBeam.id])
    expect(AnyNode.safeParse(level).success).toBe(true)
  })
})

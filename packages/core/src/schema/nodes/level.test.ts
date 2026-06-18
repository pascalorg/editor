import { describe, expect, test } from 'bun:test'
import { AnyNode } from '../types'
import { BoxNode } from './box'
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

  test('accepts generated primitive and assembly children', () => {
    const box = BoxNode.parse({ id: 'box_generated', parentId: 'level_main' })
    const level = LevelNode.parse({
      id: 'level_main',
      children: ['assembly_generated', box.id],
    })

    expect(level.children).toEqual(['assembly_generated', 'box_generated'])
    expect(AnyNode.safeParse(level).success).toBe(true)
  })
})

import { describe, expect, test } from 'bun:test'
import { DuctFittingNode } from './duct-fitting'
import { DuctSegmentNode } from './duct-segment'
import { DuctTerminalNode } from './duct-terminal'
import { HvacEquipmentNode } from './hvac-equipment'
import { LevelNode } from './level'
import { LinesetNode } from './lineset'
import { LiquidLineNode } from './liquid-line'
import { PipeFittingNode } from './pipe-fitting'
import { PipeSegmentNode } from './pipe-segment'
import { PipeTrapNode } from './pipe-trap'

describe('LevelNode', () => {
  test('accepts every level-hosted MEP node ID', () => {
    const nodes = [
      DuctSegmentNode.parse({
        path: [
          [0, 0, 0],
          [1, 0, 0],
        ],
      }),
      DuctFittingNode.parse({}),
      DuctTerminalNode.parse({}),
      HvacEquipmentNode.parse({}),
      LinesetNode.parse({
        path: [
          [0, 0, 0],
          [1, 0, 0],
        ],
      }),
      LiquidLineNode.parse({
        path: [
          [0, 0, 0],
          [1, 0, 0],
        ],
      }),
      PipeSegmentNode.parse({
        path: [
          [0, 0, 0],
          [1, 0, 0],
        ],
      }),
      PipeFittingNode.parse({}),
      PipeTrapNode.parse({}),
    ]

    expect(LevelNode.parse({ children: nodes.map((node) => node.id) }).children).toEqual(
      nodes.map((node) => node.id),
    )
  })

  test('accepts level child IDs minted by plugins', () => {
    const children = LevelNode.parse({
      children: ['tree_plugin-child', 'flower_plugin-child', 'grass_plugin-child'],
    }).children as string[]

    expect(children).toEqual(['tree_plugin-child', 'flower_plugin-child', 'grass_plugin-child'])
  })

  test('does not materialize height on parse — absence marks unmigrated legacy data', () => {
    expect('height' in LevelNode.parse({})).toBe(false)
    expect(LevelNode.parse({ height: 3 }).height).toBe(3)
  })
})

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
  test('defaults baseElevation to 0', () => {
    expect(LevelNode.parse({ level: 0, name: 'Ground' }).baseElevation).toBe(0)
  })

  test('accepts a custom baseElevation', () => {
    expect(
      LevelNode.parse({
        baseElevation: 1.25,
        level: 1,
        name: 'Split level',
      }).baseElevation,
    ).toBe(1.25)
  })

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
})

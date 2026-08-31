import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '../../schema'
import { BuildingNode, LevelNode, SlabNode, StairNode, StairSegmentNode } from '../../schema'
import {
  getNodesWithLiveStairOpeningInputs,
  hasLiveStairOpeningInputs,
} from './stair-opening-preview'
import { syncAutoStairOpenings } from './stair-opening-sync'

describe('stair opening previews', () => {
  test('computes auto openings from live stair transforms', () => {
    const building = BuildingNode.parse({ name: 'Building' })
    const ground = LevelNode.parse({ name: 'Ground', level: 0, parentId: building.id })
    const upper = LevelNode.parse({ name: 'Upper', level: 1, parentId: building.id })
    const slab = SlabNode.parse({
      name: 'Upper Slab',
      parentId: upper.id,
      polygon: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ],
    })
    const segment = StairSegmentNode.parse({
      parentId: 'stair_live',
      width: 1,
      length: 3,
      height: 2.5,
      stepCount: 12,
    })
    const stair = StairNode.parse({
      id: 'stair_live',
      name: 'Live Stair',
      parentId: ground.id,
      position: [1, 0, 0.2],
      stairType: 'straight',
      fromLevelId: ground.id,
      toLevelId: upper.id,
      slabOpeningMode: 'destination',
      children: [segment.id],
    })
    const nodes = Object.fromEntries(
      [building, ground, upper, slab, stair, { ...segment, parentId: stair.id }].map((node) => [
        node.id,
        node,
      ]),
    ) as Record<string, AnyNode>
    const liveTransforms = new Map([
      [stair.id, { position: [3, 0, 0.2] as [number, number, number], rotation: 0 }],
    ])
    const liveOverrides = new Map<string, Record<string, unknown>>()

    expect(hasLiveStairOpeningInputs(nodes, liveTransforms, liveOverrides, new Set())).toBe(true)

    const previewNodes = getNodesWithLiveStairOpeningInputs(
      nodes,
      liveTransforms,
      liveOverrides,
      new Set(),
    )
    const updates = syncAutoStairOpenings(previewNodes)
    const hole = updates.find((update) => update.id === slab.id)?.data.holes?.[0]

    expect(hole).toBeDefined()
    expect(Math.max(...hole!.map(([x]) => x))).toBeGreaterThan(3.4)
  })

  test('ignores its own live surface overrides as preview inputs', () => {
    const slab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    })
    const nodes = { [slab.id]: slab } as Record<string, AnyNode>
    const liveOverrides = new Map<string, Record<string, unknown>>([
      [
        slab.id,
        {
          holes: [
            [
              [1, 1],
              [2, 1],
              [2, 2],
              [1, 2],
            ],
          ],
        },
      ],
    ])

    expect(hasLiveStairOpeningInputs(nodes, new Map(), liveOverrides, new Set([slab.id]))).toBe(
      false,
    )
  })
})

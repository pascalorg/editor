import { describe, expect, test } from 'bun:test'
import {
  buildFactoryLayoutCreatePatches,
  inferFactoryLayoutDimensions,
} from './factory-layout-patches'

const housePlan = {
  kind: 'layout' as const,
  reason: 'house is layout',
  layoutType: 'house' as const,
  suggestedOperations: ['create_room', 'add_door', 'add_window'],
}

describe('factory layout patches', () => {
  test('infers square meter dimensions from Chinese multiplication text', () => {
    expect(
      inferFactoryLayoutDimensions({
        prompt: '\u521b\u5efa\u4e00\u4e2a3\u7c73*3\u7c73\u7684\u623f\u95f4',
        plan: housePlan,
      }),
    ).toEqual({ length: 3, width: 3 })
  })

  test('treats one explicit production-line size as line length', () => {
    expect(
      inferFactoryLayoutDimensions({
        prompt:
          '\u751f\u6210\u4e00\u676112\u7c73\u957f\u7684\u74f6\u88c5\u996e\u6599\u704c\u88c5\u4ea7\u7ebf',
        plan: {
          kind: 'layout',
          reason: 'production line is layout',
          layoutType: 'production_line',
          suggestedOperations: ['create_story_shell', 'place_item'],
        },
      }),
    ).toEqual({ length: 12, width: 6 })
  })

  test('does not treat aisle width as production-line area width', () => {
    expect(
      inferFactoryLayoutDimensions({
        prompt:
          '\u751f\u6210\u4e00\u676118\u7c73\u957f\u7684\u7535\u5b50\u4ea7\u54c1\u88c5\u914d\u4ea7\u7ebf\uff0c\u524d\u4fa7\u4fdd\u75591.2\u7c73\u4eba\u5458\u901a\u9053',
        plan: {
          kind: 'layout',
          reason: 'production line is layout',
          layoutType: 'production_line',
          suggestedOperations: ['create_story_shell', 'place_item'],
        },
      }),
    ).toEqual({ length: 18, width: 6 })
  })

  test('creates editable room shell patches with door and windows', () => {
    const plan = buildFactoryLayoutCreatePatches({
      prompt: '\u521b\u5efa\u4e00\u4e2a3\u7c73*3\u7c73\u7684\u623f\u5b50',
      plan: housePlan,
      placement: { parentId: 'level_factory', generatedBy: 'factory-agent' },
    })

    expect(plan.summary).toContain('3m x 3m')
    expect(plan.patches).toHaveLength(10)
    expect(plan.nodeIds).toHaveLength(10)
    expect(plan.patches[0]).toMatchObject({
      op: 'create',
      parentId: 'level_factory',
      node: { type: 'zone' },
    })
    expect(plan.patches.filter((patch) => patch.node.type === 'wall')).toHaveLength(4)
    expect(plan.patches.filter((patch) => patch.node.type === 'door')).toHaveLength(1)
    expect(plan.patches.filter((patch) => patch.node.type === 'window')).toHaveLength(2)
    const doorPatch = plan.patches.find((patch) => patch.node.type === 'door')
    expect(doorPatch?.parentId).toMatch(/^wall_/)
  })

  test('uses Chinese process display name for factory shell labels', () => {
    const plan = buildFactoryLayoutCreatePatches({
      prompt: '\u521b\u5efa\u4e00\u6761\u5316\u5de5\u5382\u6c34\u88c2\u89e3\u8f66\u95f4',
      plan: {
        kind: 'layout',
        reason: 'factory workshop',
        layoutType: 'factory',
        suggestedOperations: ['create_room', 'place_item'],
      },
      placement: {
        parentId: 'level_factory',
        generatedBy: 'factory-agent',
        metadata: { processDisplayLabel: '\u7535\u89e3\u6c34\u5236\u6c22\u8f66\u95f4' },
      },
    })

    expect(plan.patches[0]?.node.name).toBe('\u7535\u89e3\u6c34\u5236\u6c22\u8f66\u95f4')
    expect(plan.patches.find((patch) => patch.node.type === 'slab')?.node.name).toBe(
      '\u7535\u89e3\u6c34\u5236\u6c22\u8f66\u95f4\u5730\u9762',
    )
    expect(plan.patches.find((patch) => patch.node.type === 'door')?.node.name).toBe(
      '\u8f66\u95f4\u5377\u5e18\u95e8',
    )
    expect(plan.patches.find((patch) => patch.node.type === 'window')?.node.name).toBe(
      '\u7a97\u6237',
    )
  })
})

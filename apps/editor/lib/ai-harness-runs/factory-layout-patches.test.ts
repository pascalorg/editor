import { describe, expect, test } from 'bun:test'
import {
  buildFactoryLayoutCreatePatches,
  inferFactoryBuildingSpec,
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

  test('infers multi-story house footprint height and roof from Chinese prompt', () => {
    expect(
      inferFactoryBuildingSpec({
        prompt: '生成5米*10，高2米5的屋子，然后屋子上面还有一层，也是5米*10，高2米5。带屋顶。',
        plan: housePlan,
      }),
    ).toMatchObject({
      length: 5,
      width: 10,
      stories: 2,
      storyHeight: 2.5,
      hasRoof: true,
      roofType: 'gable',
    })
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
    expect(plan.patches).toHaveLength(8)
    expect(plan.nodeIds).toHaveLength(8)
    expect(plan.patches[0]).toMatchObject({
      op: 'create',
      parentId: 'level_factory',
      node: { type: 'zone' },
    })
    expect(plan.patches.filter((patch) => patch.node.type === 'slab')).toHaveLength(0)
    expect(plan.patches.filter((patch) => patch.node.type === 'ceiling')).toHaveLength(0)
    expect(plan.patches.filter((patch) => patch.node.type === 'wall')).toHaveLength(4)
    expect(plan.patches.filter((patch) => patch.node.type === 'door')).toHaveLength(1)
    expect(plan.patches.filter((patch) => patch.node.type === 'window')).toHaveLength(2)
    const doorPatch = plan.patches.find((patch) => patch.node.type === 'door')
    expect(doorPatch?.parentId).toMatch(/^wall_/)
  })

  test('creates real upper level and roof patches for multi-story houses', () => {
    const plan = buildFactoryLayoutCreatePatches({
      prompt: '生成5米*10，高2米5的屋子，然后屋子上面还有一层，也是5米*10，高2米5。带屋顶。',
      plan: {
        ...housePlan,
        stories: 2,
        storyHeight: 2.5,
        hasRoof: true,
        roofType: 'gable',
      },
      placement: {
        parentId: 'level_ground',
        generatedBy: 'factory-agent',
        metadata: { buildingId: 'building_main' },
      },
    })

    expect(plan.patches.filter((patch) => patch.node.type === 'level')).toHaveLength(1)
    expect(plan.patches.filter((patch) => patch.node.type === 'slab')).toHaveLength(0)
    expect(plan.patches.filter((patch) => patch.node.type === 'ceiling')).toHaveLength(0)
    expect(plan.patches.filter((patch) => patch.node.type === 'wall')).toHaveLength(8)
    expect(plan.patches.filter((patch) => patch.node.type === 'roof')).toHaveLength(1)
    expect(plan.patches.filter((patch) => patch.node.type === 'roof-segment')).toHaveLength(1)

    const upperLevelPatch = plan.patches.find((patch) => patch.node.type === 'level')
    expect(upperLevelPatch).toMatchObject({
      op: 'create',
      parentId: 'building_main',
      node: { type: 'level', level: 1 },
    })
    const upperLevelId = upperLevelPatch?.node.id
    expect(
      plan.patches.some(
        (patch) =>
          (patch.node.type === 'slab' || patch.node.type === 'ceiling') &&
          patch.parentId === upperLevelId,
      ),
    ).toBe(false)
    const roofPatch = plan.patches.find((patch) => patch.node.type === 'roof')
    expect(roofPatch?.parentId).toBe(upperLevelId)
    expect(roofPatch?.node).toMatchObject({ position: [0, 2.5, 0] })
  })


  test('creates a building and both story levels when no building context exists', () => {
    const plan = buildFactoryLayoutCreatePatches({
      prompt: '\u751f\u62105\u7c73*10\uff0c\u9ad82\u7c735\u7684\u5c4b\u5b50\uff0c\u7136\u540e\u5c4b\u5b50\u4e0a\u9762\u8fd8\u6709\u4e00\u5c42\uff0c\u4e5f\u662f5\u7c73*10\uff0c\u9ad82\u7c735\u3002\u5e26\u5c4b\u9876\u3002',
      plan: {
        ...housePlan,
        stories: 2,
        storyHeight: 2.5,
        hasRoof: true,
        roofType: 'gable',
      },
      placement: {
        parentId: 'level_default',
        generatedBy: 'factory-agent',
      },
    })

    const buildingPatch = plan.patches.find((patch) => patch.node.type === 'building')
    const levelPatches = plan.patches.filter((patch) => patch.node.type === 'level')

    expect(buildingPatch).toMatchObject({ op: 'create', node: { type: 'building' } })
    expect(levelPatches).toHaveLength(2)
    expect(levelPatches.map((patch) => patch.parentId)).toEqual([
      buildingPatch?.node.id,
      buildingPatch?.node.id,
    ])
    expect(levelPatches.map((patch) => (patch.node as { level?: number }).level)).toEqual([0, 1])
    expect(plan.patches.filter((patch) => patch.node.type === 'wall')).toHaveLength(8)
    expect(plan.patches.filter((patch) => patch.node.type === 'slab')).toHaveLength(0)
    expect(plan.patches.filter((patch) => patch.node.type === 'ceiling')).toHaveLength(0)
    expect(plan.patches.find((patch) => patch.node.type === 'roof')?.parentId).toBe(
      levelPatches[1]?.node.id,
    )
  })

  test('does not treat upper-story wording as canvas-top placement', () => {
    const plan = buildFactoryLayoutCreatePatches({
      prompt: '\u751f\u62105\u7c73*10\uff0c\u9ad82\u7c735\u7684\u5c4b\u5b50\uff0c\u7136\u540e\u5c4b\u5b50\u4e0a\u9762\u8fd8\u6709\u4e00\u5c42\uff0c\u4e5f\u662f5\u7c73*10\uff0c\u9ad82\u7c735\u3002\u5e26\u5c4b\u9876\u3002',
      plan: {
        ...housePlan,
        stories: 2,
        storyHeight: 2.5,
        hasRoof: true,
        roofType: 'gable',
      },
      placement: {
        parentId: 'level_ground',
        generatedBy: 'factory-agent',
        metadata: {
          buildingId: 'building_main',
          sceneBounds: {
            min: [-5, -5],
            max: [5, 5],
            center: [0, 0],
            size: [10, 10],
          },
        },
      },
    })

    expect(plan.patches[1]?.node).toMatchObject({
      type: 'zone',
      polygon: [
        [-2.5, -5],
        [2.5, -5],
        [2.5, 5],
        [-2.5, 5],
      ],
      metadata: {
        layoutPlacementIntent: 'default-origin',
      },
    })
    expect(plan.patches.find((patch) => patch.node.type === 'roof')?.node).toMatchObject({
      position: [0, 2.5, 0],
    })
  })

  test('places requested top-left layout inside provided scene bounds', () => {
    const plan = buildFactoryLayoutCreatePatches({
      prompt: '\u5728\u5de6\u4e0a\u89d2\u653e\u4e00\u4e2a3\u7c73\u4e583\u7c73\u7684\u623f\u5b50',
      plan: housePlan,
      placement: {
        generatedBy: 'factory-agent',
        metadata: {
          sceneBounds: {
            min: [-10, -6],
            max: [10, 6],
            center: [0, 0],
            size: [20, 12],
          },
        },
      },
    })

    const zone = plan.patches[0]?.node
    expect(zone).toMatchObject({
      type: 'zone',
      polygon: [
        [-9, -5],
        [-6, -5],
        [-6, -2],
        [-9, -2],
      ],
      metadata: {
        layoutPlacementIntent: 'top-left',
      },
    })
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

import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import {
  getArticraftJointChannelsForSelection,
  getArticraftJointControlsForSelection,
  translateArticraftJointName,
} from './articraft-dynamic-channels'
import {
  type ArticraftJointMetadata,
  applyArticraftJointValue,
  buildArticraftJointPatch,
  parseArticraftPose,
} from './articraft-joints'

const node = {
  id: 'node_1',
  type: 'box',
  name: 'joint child',
  position: [1, 2, 3],
  rotation: [0.1, 0.2, 0.3],
  metadata: {
    articraft: { recordId: 'rec_demo' },
  },
} as unknown as AnyNode

describe('articraft joint helpers', () => {
  test('parses pose payload from Articraft viewer URL', () => {
    const pose = encodeURIComponent(
      JSON.stringify({ recordId: 'rec_demo', values: { elbow: 0.42 } }),
    )
    expect(
      parseArticraftPose(`http://127.0.0.1:8765/viewer?record=rec_demo&pose=${pose}`, 'rec_demo'),
    ).toEqual(new Map([['elbow', 0.42]]))
  })

  test('ignores pose payload for another record', () => {
    const pose = JSON.stringify({ recordId: 'rec_other', values: { elbow: 0.42 } })
    expect(parseArticraftPose(pose, 'rec_demo').size).toBe(0)
  })

  test('clamps revolute values to joint limits', () => {
    const joint: ArticraftJointMetadata = {
      jointName: 'hinge',
      jointType: 'revolute',
      axis: [0, 1, 0],
      limits: { lower: -0.5, upper: 0.5 },
      currentValue: 0,
    }
    const patch = applyArticraftJointValue(node, joint, 2) as {
      rotation?: [number, number, number]
    }
    expect(patch.rotation).toEqual([0.1, 0.7, 0.3])
  })

  test('moves prismatic joints along normalized axis', () => {
    const joint: ArticraftJointMetadata = {
      jointName: 'slide',
      jointType: 'prismatic',
      axis: [0, 0, 2],
      currentValue: 0,
    }
    const patch = buildArticraftJointPatch(node, joint, { currentValue: 0.5 }) as {
      position?: [number, number, number]
    }
    expect(patch.position).toEqual([1, 2, 3.5])
  })

  test('builds dynamic channels for Articraft joints in the selected record', () => {
    const root = {
      id: 'crane_root',
      type: 'group',
      metadata: { articraft: { recordId: 'rec_crane' } },
    } as unknown as AnyNode
    const slewing = {
      id: 'slewing_node',
      type: 'box',
      metadata: {
        articraft: { recordId: 'rec_crane' },
        articraftJoint: {
          jointName: 'slewing_unit',
          jointType: 'revolute',
          axis: [0, 1, 0],
          limits: { lower: -1, upper: 1 },
        },
      },
    } as unknown as AnyNode
    const trolley = {
      id: 'trolley_node',
      type: 'box',
      metadata: {
        articraft: { recordId: 'rec_crane' },
        articraftJoint: {
          jointName: 'upperworks_trolley_travel',
          jointType: 'prismatic',
          axis: [1, 0, 0],
          limits: { lower: 0, upper: 4 },
        },
      },
    } as unknown as AnyNode

    const channels = getArticraftJointChannelsForSelection(root, {
      crane_root: root,
      slewing_node: slewing,
      trolley_node: trolley,
    })

    expect(channels).toHaveLength(2)
    expect(channels.map((channel) => channel.source).sort()).toEqual([
      'slewing_unit',
      'upperworks_trolley_travel',
    ])
    expect(channels.find((channel) => channel.source === 'slewing_unit')).toMatchObject({
      axis: 'y',
      motion: 'rotation',
      outputRange: [-1, 1],
      targetNodeId: 'slewing_node',
    })
    expect(
      channels.find((channel) => channel.source === 'upperworks_trolley_travel'),
    ).toMatchObject({
      axis: 'x',
      motion: 'translation',
      outputRange: [0, 4],
      targetNodeId: 'trolley_node',
    })
  })

  test('builds inspector controls for all joints in the selected Articraft record', () => {
    const root = {
      id: 'crane_root',
      type: 'group',
      metadata: { articraft: { recordId: 'rec_crane' } },
    } as unknown as AnyNode
    const slewing = {
      id: 'slewing_node',
      type: 'box',
      metadata: {
        articraft: { recordId: 'rec_crane' },
        articraftJoint: {
          jointName: 'slewing_unit',
          jointType: 'revolute',
          axis: [0, 1, 0],
        },
      },
    } as unknown as AnyNode
    const otherRecord = {
      id: 'other_node',
      type: 'box',
      metadata: {
        articraft: { recordId: 'rec_other' },
        articraftJoint: {
          jointName: 'ignored',
          jointType: 'revolute',
        },
      },
    } as unknown as AnyNode

    const controls = getArticraftJointControlsForSelection(root, {
      crane_root: root,
      slewing_node: slewing,
      other_node: otherRecord,
    })

    expect(controls).toHaveLength(1)
    expect(controls[0]).toMatchObject({
      nodeId: 'slewing_node',
      label: '\u56de\u8f6c\u5355\u5143',
      joint: { jointName: 'slewing_unit' },
    })
  })

  test('resolves Articraft controls from assembly children when the root has no record metadata', () => {
    const root = {
      id: 'crane_root',
      type: 'assembly',
      children: ['slewing_node'],
    } as unknown as AnyNode
    const slewing = {
      id: 'slewing_node',
      type: 'box',
      parentId: 'crane_root',
      metadata: {
        articraft: { recordId: 'rec_crane' },
        articraftJoint: {
          jointName: 'slewing_unit',
          jointType: 'revolute',
          axis: [0, 1, 0],
        },
      },
    } as unknown as AnyNode

    expect(
      getArticraftJointControlsForSelection(root, {
        crane_root: root,
        slewing_node: slewing,
      }),
    ).toHaveLength(1)
  })

  test('translates common joint names for the dynamic panel', () => {
    expect(translateArticraftJointName('slewing_unit')).toBe('\u56de\u8f6c\u5355\u5143')
    expect(translateArticraftJointName('upperworks_trolley_travel')).toBe(
      '\u4e0a\u8f66\u5c0f\u8f66\u884c\u8d70',
    )
    expect(translateArticraftJointName('lower_arm_to_upper_arm')).toBe(
      '\u4e0b\u81c2\u5230\u4e0a\u81c2',
    )
    expect(translateArticraftJointName('upper_arm_to_lamp_head')).toBe(
      '\u4e0a\u81c2\u5230\u706f\u5934',
    )
  })
})

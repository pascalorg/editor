import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
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
})

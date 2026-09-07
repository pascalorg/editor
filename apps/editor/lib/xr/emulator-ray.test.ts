import { describe, expect, test } from 'bun:test'
import { Group, Vector3 } from 'three'
import { resolveEmulatedInputPose } from './emulator-ray'

describe('emulated XR input pose', () => {
  test('places the ray in front of a target in reference-space coordinates', () => {
    const origin = new Group()
    origin.position.set(10, 0, 0)
    const target = new Group()
    target.position.set(10, 1, -2)

    const pose = resolveEmulatedInputPose(target, origin, 0.5)
    const direction = new Vector3(0, 0, -1).applyQuaternion({
      x: pose.quaternion[0],
      y: pose.quaternion[1],
      z: pose.quaternion[2],
      w: pose.quaternion[3],
    })

    expect(pose.position).toEqual([0, 1, -1.5])
    expect(direction.toArray()).toEqual([0, 0, -1])
  })
})

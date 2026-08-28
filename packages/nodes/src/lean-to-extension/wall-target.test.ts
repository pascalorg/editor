import { describe, expect, test } from 'bun:test'
import { DoorNode, WallNode } from '@pascal-app/core'
import { Object3D, Vector3 } from 'three'
import { resolveLeanToDoorWallTarget } from './wall-target'

describe('lean-to wall targets', () => {
  test('converts a hosted door hit into the wall local frame', () => {
    const wall = WallNode.parse({ id: 'wall_door_target', start: [0, 0], end: [6, 0] })
    const door = DoorNode.parse({ id: 'door_target', wallId: wall.id })
    const wallObject = new Object3D()
    wallObject.position.set(10, 2, -4)
    wallObject.rotation.y = 0.35
    const doorObject = new Object3D()
    doorObject.position.set(2.25, 1.1, 0.08)
    wallObject.add(doorObject)
    wallObject.updateWorldMatrix(true, true)

    const worldPoint = doorObject.localToWorld(new Vector3(0, 0, 0))
    const target = resolveLeanToDoorWallTarget(
      {
        node: door,
        position: [worldPoint.x, worldPoint.y, worldPoint.z],
        localPosition: [0, 0, 0],
        normal: [0, 0, 1],
        object: doorObject,
        stopPropagation: () => {},
        nativeEvent: {} as never,
      },
      wall,
      wallObject,
    )

    expect(target.node.id).toBe(wall.id)
    expect(target.localPosition[0]).toBeCloseTo(2.25)
    expect(target.localPosition[1]).toBeCloseTo(1.1)
    expect(target.localPosition[2]).toBeCloseTo(0.08)
    expect(target.normal?.[0]).toBeCloseTo(0)
    expect(target.normal?.[1]).toBeCloseTo(0)
    expect(target.normal?.[2]).toBeCloseTo(1)
  })
})

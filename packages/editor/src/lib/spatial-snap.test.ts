import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { snapLocalXZInWorld } from '@pascal-app/core'
import { Group, Vector3 } from 'three'

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8)

test('free placement stays under the same hit through God-mode zoom and rotation', () => {
  const pose = { position: [5, 0, -3] as [number, number, number], rotationY: 0.7 }
  const world = new Group()
  const building = new Group()
  building.position.fromArray(pose.position)
  building.rotation.y = pose.rotationY
  world.add(building)
  for (const scale of [0.01, 0.1, 1, 4]) {
    world.scale.setScalar(scale)
    world.position.set(8, 1, -4)
    world.rotation.y = 1.2
    world.updateWorldMatrix(true, true)
    const hit = building.localToWorld(new Vector3(2, 0, -6))
    const local = building.worldToLocal(hit.clone())
    const snapped = snapLocalXZInWorld([local.x, local.z], pose, (value) => value)
    const placed = building.localToWorld(new Vector3(snapped[0], 0, snapped[1]))
    close(placed.distanceTo(hit), 0)
  }
})

test('grid snapping still uses model units and the item footprint', () => {
  const dimensions: number[] = []
  const result = snapLocalXZInWorld([1.23, -2.16], null, (value, axis) => {
    dimensions.push([1.8, 0.6][axis]!)
    return Math.round(value / 0.1) * 0.1
  })
  close(result[0], 1.2)
  close(result[1], -2.2)
  assert.deepEqual(dimensions, [1.8, 0.6])
})

test('rotated buildings snap in model-world axes then return building-local coordinates', () => {
  const result = snapLocalXZInWorld(
    [1.2, 2.3],
    { position: [10, 0, 20], rotationY: Math.PI / 2 },
    Math.round,
  )
  close(result[0], 1)
  close(result[1], 2)
})

import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  CabinetNode,
  collectAlignmentAnchors,
  movingAlignmentAnchors,
  nodeRegistry,
  registerNode,
  resolveAlignment,
} from '@pascal-app/core'
import { cabinetDefinition } from '@pascal-app/nodes'

let restoreRegistry: () => void
beforeEach(() => {
  restoreRegistry = nodeRegistry._snapshot()
  registerNode(cabinetDefinition)
})
afterEach(() => restoreRegistry())

for (const yaw of [0, Math.PI / 2]) {
  test(`cabinet ghost magnetically aligns its bounds at yaw ${yaw}`, () => {
    const target = CabinetNode.parse({ position: [2, 0, 3], rotation: yaw })
    const ghost = CabinetNode.parse({ position: [0, 0, 0], rotation: yaw })
    const nodes = { [target.id]: target }
    const moving = movingAlignmentAnchors(ghost, nodes, 2.04, 3.03, yaw)
    const result = resolveAlignment({
      moving,
      candidates: collectAlignmentAnchors(nodes, ghost.id),
      threshold: 0.08,
    })

    expect(result.snap).not.toBeNull()
    expect(2.04 + result.snap!.dx).toBeCloseTo(2)
    expect(3.03 + result.snap!.dz).toBeCloseTo(3)
    expect(result.guides).toHaveLength(2)
    // Preview resolution never moves the existing scene object.
    expect(target.position).toEqual([2, 0, 3])
  })
}

test('cabinet ghost is free outside the magnetic threshold', () => {
  const target = CabinetNode.parse({ position: [2, 0, 3] })
  const ghost = CabinetNode.parse({})
  const nodes = { [target.id]: target }
  const result = resolveAlignment({
    moving: movingAlignmentAnchors(ghost, nodes, 10, 10, 0),
    candidates: collectAlignmentAnchors(nodes, ghost.id),
    threshold: 0.08,
  })
  expect(result.snap).toBeNull()
})

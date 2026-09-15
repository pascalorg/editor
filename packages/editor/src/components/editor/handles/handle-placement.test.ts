import { expect, test } from 'bun:test'
import { type AnyNode, createSceneApi, type LinearResizeHandle, useScene } from '@pascal-app/core'
import { createArrowHandleGeometry } from './handle-arrow'
import { computeFreezeOffset, resolveLinearHandlePosition } from './handle-placement'

const scene = createSceneApi(useScene)
for (const axis of ['x', 'y', 'z'] as const) {
  test(`${axis} clearance preserves sufficient offsets and keeps even hovered arrow tails clear at different scales`, () => {
    const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
    const geometry = createArrowHandleGeometry(true)
    geometry.computeBoundingBox()
    const tail = geometry.boundingBox!.min.x * 1.12
    for (const edge of [0.06, 1.2, -0.4]) {
      const position: [number, number, number] = [0, 0, 0]
      position[index] = edge + 0.15
      const descriptor: LinearResizeHandle<null> = {
        kind: 'linear-resize',
        axis,
        anchor: 'center',
        currentValue: () => 1,
        apply: () => null,
        placement: { position: () => position, clearance: { edge: () => edge, distance: 0.4 } },
      }
      for (const scale of [0.1, 0.325, 0.65, 1.3, 3]) {
        const resolved = resolveLinearHandlePosition(descriptor, null, scene, scale)
        expect(resolved[index] + tail * scale - edge).toBeGreaterThan(0.1 * scale)
        if (0.4 * scale <= 0.15) expect(resolved).toEqual(position)
        resolved.forEach((value, i) => {
          if (i !== index) expect(value).toBe(position[i]!)
        })
      }
      delete descriptor.placement.clearance
      expect(resolveLinearHandlePosition(descriptor, null, scene, 3)).toBe(position)
    }
    geometry.dispose()
  })
}

test('array rotations keep sibling handles finite during rotation and resize', () => {
  const initial = { position: [1, 2, 3], rotation: [0, Math.PI / 2, 0] } as unknown as AnyNode
  const rotated = { ...initial, rotation: [0, Math.PI, 0] } as unknown as AnyNode
  expect(computeFreezeOffset(rotated, initial)).toEqual([0, 0, 0])
  const moved = { ...initial, position: [2, 4, 3] } as unknown as AnyNode
  const offset = computeFreezeOffset(moved, initial)
  expect(offset[0]).toBeCloseTo(0)
  expect(offset[1]).toBe(2)
  expect(offset[2]).toBeCloseTo(1)
  expect(
    computeFreezeOffset(moved, { ...initial, rotation: Math.PI / 2 } as unknown as AnyNode),
  ).toEqual(offset)
})

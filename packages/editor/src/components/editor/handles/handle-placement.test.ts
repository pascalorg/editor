import { expect, test } from 'bun:test'
import { type AnyNode, createSceneApi, type LinearResizeHandle, useScene } from '@pascal-app/core'
import { Euler, Vector3 } from 'three'
import { createArrowHandleGeometry } from './handle-arrow'
import {
  computeFreezeOffset,
  resolveLinearHandlePosition,
  resolveLinearHandleRotation,
} from './handle-placement'

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

for (const axis of ['x', 'y', 'z'] as const) {
  test(`${axis} negative direction keeps hovered arrow above its lower-edge clearance`, () => {
    const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
    const geometry = createArrowHandleGeometry(true)
    geometry.computeBoundingBox()
    const tail = -geometry.boundingBox!.min.x * 1.12
    for (const edge of [-2, 0, 2]) {
      const position: [number, number, number] = [0, 0, 0]
      position[index] = edge - 0.15
      const descriptor: LinearResizeHandle<null> = {
        kind: 'linear-resize',
        axis,
        anchor: 'max',
        direction: -1,
        currentValue: () => 1,
        apply: () => null,
        placement: { position: () => position, clearance: { edge: () => edge, distance: 0.4 } },
      }
      for (const scale of [0.1, 0.325, 0.65, 1.3, 3]) {
        const resolved = resolveLinearHandlePosition(descriptor, null, scene, scale)
        expect(edge - (resolved[index] + tail * scale)).toBeGreaterThan(0.1 * scale)
        if (0.4 * scale <= 0.15) expect(resolved).toEqual(position)
        const pointing = new Vector3(1, 0, 0)
          .applyEuler(new Euler(...resolveLinearHandleRotation(descriptor, resolved)))
          .applyAxisAngle(new Vector3(0, 1, 0), axis === 'z' ? -Math.PI / 2 : 0)
        expect(pointing.getComponent(index)).toBeCloseTo(-1)
      }
    }
    geometry.dispose()
  })
}

test('unspecified direction preserves vertical position heuristic and wall-facing blade', () => {
  const descriptor: LinearResizeHandle<null> = {
    kind: 'linear-resize',
    axis: 'y',
    anchor: 'min',
    currentValue: () => 1,
    apply: () => null,
    placement: { position: () => [0, 0, 0] },
  }
  expect(resolveLinearHandleRotation(descriptor, [0, -1, 0])).toEqual([
    0,
    Math.PI / 2,
    -Math.PI / 2,
  ])
  expect(resolveLinearHandleRotation(descriptor, [0, 1, 0])).toEqual([0, Math.PI / 2, Math.PI / 2])
  expect(
    resolveLinearHandleRotation({ ...descriptor, axis: 'x', faceNormal: true }, [0, 0, 0]),
  ).toEqual([Math.PI / 2, 0, 0])
  expect(
    resolveLinearHandleRotation({ ...descriptor, axis: 'z', faceNormal: true }, [0, 0, 0]),
  ).toEqual([0, 0, 0])
})

import { describe, expect, test } from 'bun:test'
import {
  isProjectedFloorplanAxisPointVerified,
  resolveFloorplanMeasurementAxisSnap,
  resolveProjectedFloorplanSnap,
} from './floorplan-measurement-tool-layer'

describe('resolveFloorplanMeasurementAxisSnap', () => {
  test('snaps to the closest X or Z axis inside the screen-space threshold', () => {
    expect(resolveFloorplanMeasurementAxisSnap([3, 0, 2], [1, 0, 1], 4, 9)).toEqual({
      point: [3, 0, 1],
      guide: { axis: 'x', from: [1, 0, 1], to: [3, 0, 1], snapped: true },
    })
    expect(resolveFloorplanMeasurementAxisSnap([3, 0, 2], [1, 0, 1], 8, 3)).toEqual({
      point: [1, 0, 2],
      guide: { axis: 'z', from: [1, 0, 1], to: [1, 0, 2], snapped: true },
    })
  })

  test('uses the stronger default magnetic acquisition envelope', () => {
    expect(resolveFloorplanMeasurementAxisSnap([3, 0, 2], [1, 0, 1], 15, 20)).toEqual({
      point: [3, 0, 1],
      guide: { axis: 'x', from: [1, 0, 1], to: [3, 0, 1], snapped: true },
    })
  })

  test('keeps the surface point when neither axis is close enough', () => {
    expect(resolveFloorplanMeasurementAxisSnap([3, 0, 2], [1, 0, 1], 20, 18)).toEqual({
      point: [3, 0, 2],
      guide: { axis: 'z', from: [1, 0, 1], to: [1, 0, 2], snapped: false },
    })
  })

  test('keeps a magnetic lock until the wider release threshold', () => {
    expect(resolveFloorplanMeasurementAxisSnap([3, 0, 2], [1, 0, 1], 16, 4, 12, 'x', 18)).toEqual({
      point: [3, 0, 1],
      guide: { axis: 'x', from: [1, 0, 1], to: [3, 0, 1], snapped: true },
    })
    expect(resolveFloorplanMeasurementAxisSnap([3, 0, 2], [1, 0, 1], 19, 4, 12, 'x', 18)).toEqual({
      point: [1, 0, 2],
      guide: { axis: 'z', from: [1, 0, 1], to: [1, 0, 2], snapped: true },
    })
  })

  test('marks scene-anchor alignment as a proximity guide', () => {
    expect(
      resolveFloorplanMeasurementAxisSnap([3, 0, 2], [1, 0, 1], 4, 9, 12, null, 18, true),
    ).toEqual({
      point: [3, 0, 1],
      guide: {
        axis: 'x',
        from: [1, 0, 1],
        to: [3, 0, 1],
        snapped: true,
        proximity: true,
      },
    })
  })
})

describe('resolveProjectedFloorplanSnap', () => {
  const vertices = [
    { x: 10, z: 10, nodeId: 'wall_1' },
    { x: 100, z: 10, nodeId: 'wall_1' },
  ]
  const segments = [
    {
      start: vertices[0]!,
      end: vertices[1]!,
      nodeId: 'wall_1',
    },
  ]

  test('prefers a registered vertex before a nearby edge', () => {
    expect(resolveProjectedFloorplanSnap({ x: 13, z: 14 }, vertices, segments)).toEqual({
      kind: 'vertex',
      nodeId: 'wall_1',
      point: { x: 10, z: 10 },
    })
  })

  test('acquires structural corners inside the stronger screen-space envelope', () => {
    expect(resolveProjectedFloorplanSnap({ x: 25, z: 10 }, vertices, segments)).toEqual({
      kind: 'vertex',
      nodeId: 'wall_1',
      point: { x: 10, z: 10 },
    })
  })

  test('projects onto a registered edge in screen space', () => {
    expect(resolveProjectedFloorplanSnap({ x: 55, z: 16 }, vertices, segments)).toEqual({
      kind: 'edge',
      nodeId: 'wall_1',
      point: { x: 55, z: 10 },
    })
  })

  test('leaves the pointer unsnapped outside bounded thresholds', () => {
    expect(resolveProjectedFloorplanSnap({ x: 55, z: 30 }, vertices, segments)).toBeNull()
  })

  test('verifies an axis point only when it stays on the snapped geometry', () => {
    expect(
      isProjectedFloorplanAxisPointVerified({ x: 55, z: 10 }, 'wall_1', vertices, segments),
    ).toBe(true)
    expect(
      isProjectedFloorplanAxisPointVerified({ x: 55, z: 12 }, 'wall_1', vertices, segments),
    ).toBe(false)
    expect(
      isProjectedFloorplanAxisPointVerified({ x: 55, z: 10 }, 'wall_2', vertices, segments),
    ).toBe(false)
  })
})

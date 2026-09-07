import { describe, expect, test } from 'bun:test'
import {
  projectRunToAngleLock,
  projectRunToCameraDirection,
  resolveRunCommitFromEvent,
  runDistanceSquared,
  runSectionHalfSizeM,
  snapRunValue,
  stepNominalRunSize,
} from './distribution-run-tool'

describe('distribution run drafting helpers', () => {
  test('snaps values only when the step is active', () => {
    expect(snapRunValue(1.13, 0.25)).toBe(1.25)
    expect(snapRunValue(1.13, 0)).toBe(1.13)
  })

  test('projects a cursor onto the nearest 45 degree ray', () => {
    const point = projectRunToAngleLock([2, 3, 4], [4, 9, 5.8])

    expect(point[1]).toBe(3)
    expect(point[0] - 2).toBeCloseTo(point[2] - 4)
  })

  test('projects a connected continuation onto directions relative to its source run', () => {
    const source = [Math.SQRT1_2, 0, Math.SQRT1_2] as const
    const projected = projectRunToAngleLock([0, 0, 0], [1, 0, -2], source)

    expect(projected[0]).toBeCloseTo(1.5)
    expect(projected[1]).toBe(0)
    expect(projected[2]).toBeCloseTo(-1.5)
  })

  test('selects a true vertical direction from the camera cursor ray', () => {
    const projected = projectRunToCameraDirection(
      [0, 0, 0],
      {
        origin: [3, 3, 3],
        direction: [-Math.SQRT1_2, 0, -Math.SQRT1_2],
      },
      [1, 0, 0],
      0.05,
      0,
    )

    expect(projected?.direction[0]).toBeCloseTo(0)
    expect(projected?.direction[1]).toBeCloseTo(1)
    expect(projected?.direction[2]).toBeCloseTo(0)
    expect(projected?.point[1]).toBeCloseTo(3)
  })

  test('selects a rising 45 degree direction in the source plane', () => {
    const target = [Math.SQRT1_2 * 4, Math.SQRT1_2 * 4, 0] as const
    const projected = projectRunToCameraDirection(
      [0, 0, 0],
      {
        origin: [target[0] + 3, target[1], 3],
        direction: [-Math.SQRT1_2, 0, -Math.SQRT1_2],
      },
      [1, 0, 0],
      0.05,
      0,
    )

    expect(projected?.direction[0]).toBeCloseTo(Math.SQRT1_2)
    expect(projected?.direction[1]).toBeCloseTo(Math.SQRT1_2)
    expect(projected?.direction[2]).toBeCloseTo(0)
  })

  test('steps from off-catalogue sizes using the nearest nominal size', () => {
    const sizes = [2, 3, 4, 6]

    expect(stepNominalRunSize(sizes, 3.2, 1)).toBe(4)
    expect(stepNominalRunSize(sizes, 3.2, -1)).toBe(2)
    expect(stepNominalRunSize(sizes, 6, 1)).toBe(6)
  })

  test('computes squared 3D distance for fitting degeneracy checks', () => {
    expect(runDistanceSquared([1, 2, 3], [4, 6, 3])).toBe(25)
  })

  test('places a run centerline half its section above the support plane', () => {
    expect(runSectionHalfSizeM(2)).toBeCloseTo(0.0254)
    expect(runSectionHalfSizeM(8)).toBeCloseTo(0.1016)
  })

  test('commits node-surface clicks at the visible drafting cursor', () => {
    const visibleCursor = { point: [8, 0, 6] }
    const clickedMeshOrigin = { point: [0, 0, 0] }

    const resolved = resolveRunCommitFromEvent(
      { node: {}, localPosition: [0, 0, 0] } as never,
      visibleCursor,
      () => clickedMeshOrigin,
    )

    expect(resolved).toBe(visibleCursor)
  })
})

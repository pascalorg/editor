import { describe, expect, test } from 'bun:test'
import {
  createRunSurfaceFrame,
  projectRunPointToSurface,
  projectRunToAngleLock,
  projectRunToCameraDirection,
  projectRunToSurfaceAngleLock,
  projectRunToSurfaceAxisLock,
  resolveRunCommitFromEvent,
  runDistanceSquared,
  runSectionHalfSizeM,
  snapRunPointToSurface,
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

  test('projects and snaps a run in a vertical wall plane', () => {
    const wall = createRunSurfaceFrame([4, 2, 6], [0, 0, 1])

    expect(projectRunPointToSurface([7, 3, 9], wall)).toEqual([7, 3, 6])
    expect(snapRunPointToSurface([7.12, 2.88, 6], wall, 0.25)).toEqual([7, 3, 6])
  })

  test('keeps angle snapping inside the active surface plane', () => {
    const wall = createRunSurfaceFrame([0, 1, 4], [0, 0, 1])
    const point = projectRunToSurfaceAngleLock([0, 1, 4], [1.2, 2.1, 4], wall)

    expect(point[2]).toBeCloseTo(4)
    expect(point[1] - 1).toBeCloseTo(point[0])
  })

  test('locks a wall run to one straight wall axis', () => {
    const wall = createRunSurfaceFrame([2, 1, 4], [0, 0, 1])

    const horizontal = projectRunToSurfaceAxisLock([2, 1, 4], [4, 1.4, 4], wall)
    const vertical = projectRunToSurfaceAxisLock([2, 1, 4], [2.4, 4, 4], wall)

    expect(horizontal[0]).toBeCloseTo(4)
    expect(horizontal[1]).toBeCloseTo(1)
    expect(horizontal[2]).toBeCloseTo(4)
    expect(vertical[0]).toBeCloseTo(2)
    expect(vertical[1]).toBeCloseTo(4)
    expect(vertical[2]).toBeCloseTo(4)
  })

  test('keeps a run on a rotated wall plane', () => {
    const diagonalWall = createRunSurfaceFrame([2, 1, 2], [Math.SQRT1_2, 0, Math.SQRT1_2])
    const projected = projectRunPointToSurface([4, 3, 0], diagonalWall)

    expect(projected[0] + projected[2]).toBeCloseTo(4)
    expect(projected[1]).toBeCloseTo(3)
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

  test('resolves a node-surface start when no surface move preceded the click', () => {
    const clickedSurface = { point: [3, 1.8, -2] }
    const resolved = resolveRunCommitFromEvent(
      { node: {}, localPosition: [99, 99, 99] } as never,
      null,
      () => clickedSurface,
    )

    expect(resolved).toBe(clickedSurface)
  })
})

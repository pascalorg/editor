import { describe, expect, test } from 'bun:test'
import {
  createRunSurfaceFrame,
  projectRunPointToSurface,
  projectRunToAngleLock,
  projectRunToCameraDirection,
  projectRunToDirection,
  projectRunToSurfaceAngleLock,
  type RunCursorRay,
  type RunPoint,
  runDistanceSquared,
  runSectionHalfSizeM,
  snapRunPointToSurface,
  snapRunValue,
  stepNominalRunSize,
} from './distribution-run-tool'

describe('distribution run drafting helpers', () => {
  test('releases an airborne direction guide when the cursor returns to a wall', () => {
    const start: RunPoint = [0, 1, 1]
    const ray: RunCursorRay = {
      origin: [3, 3, 5],
      direction: [-1, -1, -2],
    }
    const directions: RunPoint[] = [[1, 0, 0]]
    expect(
      projectRunToCameraDirection(start, ray, [1, 0, 0], 0.05, 0, directions)?.point[0],
    ).toBeCloseTo(1)

    for (const clearance of [0.0254, 0.1016]) {
      const wall = createRunSurfaceFrame([0, 0, 2 + clearance], [0, 0, 1])
      expect(
        projectRunToCameraDirection(start, ray, [1, 0, 0], 0.05, 0, directions, wall),
      ).toBeNull()
    }
  })

  test('keeps direction guides that lie on the active wall face', () => {
    const wall = createRunSurfaceFrame([0, 0, 1], [0, 0, 1])
    const result = projectRunToCameraDirection(
      [0, 1, 1],
      { origin: [3, 3, 5], direction: [-1, -1, -2] },
      [1, 0, 0],
      0.05,
      0,
      [[1, 0, 0]],
      wall,
    )
    expect(result?.point[0]).toBeCloseTo(1)
    expect(result?.point[2]).toBe(1)
  })

  test('camera hover resolves downward without a ground-plane height', () => {
    const projected = projectRunToCameraDirection(
      [0, 5, 0],
      { origin: [3, 2, 3], direction: [-Math.SQRT1_2, 0, -Math.SQRT1_2] },
      [1, 0, 0],
      0.05,
      0,
    )
    expect(projected?.direction).toEqual([0, -1, 0])
    expect(projected?.point[1]).toBeCloseTo(2)
  })

  test('projects the cursor onto the direction selected by an arrow handle', () => {
    const point = projectRunToDirection([1, 2, 3], [4, 9, 1], [Math.SQRT1_2, 0, Math.SQRT1_2])

    expect(point[1]).toBe(2)
    expect(point[0] - 1).toBeCloseTo(point[2] - 3)
    expect(point[0]).toBeGreaterThan(1)
  })

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

  test('keeps a run on a rotated wall plane', () => {
    const diagonalWall = createRunSurfaceFrame([2, 1, 2], [Math.SQRT1_2, 0, Math.SQRT1_2])
    const projected = projectRunPointToSurface([4, 3, 0], diagonalWall)

    expect(projected[0] + projected[2]).toBeCloseTo(4)
    expect(projected[1]).toBeCloseTo(3)
  })
})

import { describe, expect, test } from 'bun:test'
import { emptyConversionReport, keepValidTriangles } from '../src/geometry-validity'

const NaN3 = [Number.NaN, Number.NaN, Number.NaN]

describe('keepValidTriangles recomputes non-finite normals', () => {
  test('a small mesh: the exact count, each normal from the faces around it', () => {
    // A unit quad on the ground (y = 0), wound to face +y; a fifth vertex has no position.
    const report = emptyConversionReport()
    const mesh = keepValidTriangles(
      {
        positions: [0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, Number.NaN, 0, 0],
        normals: [...NaN3, 0, 1, 0, ...NaN3, 0, 1, 0, ...NaN3],
        indices: [0, 1, 2, 2, 1, 3, 2, 3, 4],
      },
      report,
    )
    expect(report.replaced.normals).toBe(2)
    expect(report.skippedGeometry).toMatchObject({ vertices: 1, triangles: 1 })
    expect(mesh?.normals).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
  })

  test('a summed normal that overflows to Infinity takes the unit fallback', () => {
    // Coordinates around 1e155: finite, but their cross product overflows.
    const big = 1e155
    const report = emptyConversionReport()
    const mesh = keepValidTriangles(
      {
        positions: [0, 0, 0, big, 0, 0, 0, big, 0],
        normals: [...NaN3, ...NaN3, ...NaN3],
        indices: [0, 1, 2],
      },
      report,
    )
    expect(report.replaced.normals).toBe(3)
    expect(mesh?.normals).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1])
  })
})

import { describe, expect, test } from 'bun:test'
import { createTerrainField, heightAt, surfaceHeightAt, type TerrainField } from '@pascal-app/core'
import {
  buildDrapedPolyline,
  creaseCrossings,
  terrainGridKey,
  updateDrapedHeights,
} from './terrain-drape'

/** A field whose height is an arbitrary function of the sample indices. */
function fieldOf(
  cols: number,
  rows: number,
  spacing: number,
  height: (col: number, row: number) => number,
  origin: readonly [number, number] = [0, 0],
): TerrainField {
  const base = createTerrainField({ cols, rows, spacing, step: 0.01, origin })
  const heights = new Int16Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[r * cols + c] = Math.round(height(c, r) / base.step)
    }
  }
  return { ...base, heights }
}

/**
 * A maximally warped cell: opposite corners high, the other two at the datum.
 */
function saddleField(): TerrainField {
  return fieldOf(3, 3, 2, (c, r) => ((c + r) % 2 === 0 ? 4 : 0))
}

function vertexAt(positions: Float32Array, index: number): [number, number, number] {
  return [positions[index * 3] ?? 0, positions[index * 3 + 1] ?? 0, positions[index * 3 + 2] ?? 0]
}

describe('creaseCrossings', () => {
  test('a segment crossing one grid line inside a cell splits there', () => {
    const field = createTerrainField({ cols: 3, rows: 3, spacing: 1 })
    // From (0.5, 0.5) to (1.5, 0.5): crosses u = 1 halfway. v never changes, and
    // u + v goes 1 → 2, crossing the diagonal u+v = 2 at the very end (t = 1),
    // which is excluded as an endpoint.
    expect(creaseCrossings(field, 0.5, 0.5, 1.5, 0.5)).toEqual([0.5])
  })

  test('the diagonal family is u + v, matching the mesh triangulation', () => {
    const field = createTerrainField({ cols: 3, rows: 3, spacing: 1 })
    // Inside cell [0,0], from (0.1, 0.1) to (0.9, 0.9): no grid line is crossed,
    // but u + v goes 0.2 → 1.8 and so passes the cell's diagonal at u + v = 1.
    const crossings = creaseCrossings(field, 0.1, 0.1, 0.9, 0.9)
    expect(crossings).toHaveLength(1)
    expect(crossings[0]).toBeCloseTo(0.5, 12)
  })

  test('a segment lying along a grid line adds no crossings', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1 })
    // v is pinned at the integer 2 the whole way: it is *on* a crease, never
    // crossing one, and the surface is planar on both sides of it. Kept inside one
    // cell in u so the other two families contribute nothing either.
    expect(creaseCrossings(field, 0.2, 2, 0.8, 2)).toEqual([])
  })

  test('crossings are sorted, deduplicated, and exclude the endpoints', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1 })
    // A 45° segment corner-to-corner hits u, v, and u+v creases at coincident
    // parameters; each shared parameter must appear once.
    const crossings = creaseCrossings(field, 0, 0, 4, 4)
    expect(crossings).toEqual([...crossings].sort((a, b) => a - b))
    expect(new Set(crossings).size).toBe(crossings.length)
    expect(crossings.every((t) => t > 0 && t < 1)).toBe(true)
  })

  test('crossings stop at the field edge, so an edge far outside stays cheap', () => {
    const field = createTerrainField({ cols: 3, rows: 3, spacing: 1 })
    // From x = -50 to x = 50 along z = 1: only u ∈ [0,2] creases, plus the
    // diagonals u + v ∈ [1, 3] that the same span reaches — a handful, not 100.
    expect(creaseCrossings(field, -50, 1, 50, 1).length).toBeLessThan(8)
  })
})

describe('buildDrapedPolyline', () => {
  test('with no field it emits the input points at the lift, closing the ring', () => {
    const ring = buildDrapedPolyline({
      points: [
        [0, 0],
        [4, 0],
        [4, 4],
      ],
      field: null,
      lift: 0.01,
      closed: true,
    })
    expect(ring.uvs).toHaveLength(4)
    // The ring closes back on its first vertex, so a LineStrip needs no extra
    // segment to join the last edge.
    expect(vertexAt(ring.positions, 3)[0]).toBe(0)
    expect(vertexAt(ring.positions, 3)[2]).toBe(0)
    for (let index = 0; index < 4; index++) {
      expect(vertexAt(ring.positions, index)[1]).toBeCloseTo(0.01, 6)
    }
  })

  test('an open polyline ends on its last point, not back at the first', () => {
    const ring = buildDrapedPolyline({
      points: [
        [0, 0],
        [3, 0],
      ],
      field: null,
      lift: 0,
      closed: false,
    })
    expect(ring.uvs).toHaveLength(2)
    expect(vertexAt(ring.positions, 1)).toEqual([3, 0, 0])
  })

  test('every vertex sits exactly on the shared rendered-surface authority', () => {
    const field = saddleField()
    const ring = buildDrapedPolyline({
      points: [
        [0.5, 0.5],
        [3.5, 3.5],
      ],
      field,
      lift: 0.01,
      closed: false,
    })
    for (let index = 0; index < ring.uvs.length; index++) {
      const [x, y, z] = vertexAt(ring.positions, index)
      expect(y).toBeCloseTo(surfaceHeightAt(field, x, z) + 0.01, 5)
    }
  })

  test('midpoints of every sub-segment stay on the surface too', () => {
    // The real guarantee: not just that the *vertices* are on the surface (any
    // sampling gets that) but that the straight line between consecutive vertices
    // is, which is only true if each sub-segment lies inside one triangle.
    const field = saddleField()
    const ring = buildDrapedPolyline({
      points: [
        [0.3, 0.7],
        [3.7, 2.9],
      ],
      field,
      lift: 0,
      closed: false,
    })
    for (let index = 1; index < ring.uvs.length; index++) {
      const [x0, y0, z0] = vertexAt(ring.positions, index - 1)
      const [x1, y1, z1] = vertexAt(ring.positions, index)
      const mx = (x0 + x1) / 2
      const mz = (z0 + z1) / 2
      expect((y0 + y1) / 2).toBeCloseTo(surfaceHeightAt(field, mx, mz), 5)
    }
  })

  test('the explicit rendered-surface name agrees with heightAt on a warped cell', () => {
    const field = saddleField()
    expect(surfaceHeightAt(field, 1, 1)).toBe(heightAt(field, 1, 1))
  })

  test('a flat field drapes flat, at the lift', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1 })
    const ring = buildDrapedPolyline({
      points: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      field,
      lift: 0.02,
      closed: true,
    })
    for (let index = 0; index < ring.uvs.length; index++) {
      expect(vertexAt(ring.positions, index)[1]).toBeCloseTo(0.02, 6)
    }
  })

  test('arc length runs 0 → 1 monotonically in XZ', () => {
    const field = fieldOf(5, 5, 1, (c) => c * 2)
    const ring = buildDrapedPolyline({
      points: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      field,
      lift: 0,
      closed: true,
    })
    expect(ring.uvs[0]).toBe(0)
    expect(ring.uvs.at(-1)).toBeCloseTo(1, 6)
    for (let index = 1; index < ring.uvs.length; index++) {
      expect(ring.uvs[index]!).toBeGreaterThanOrEqual(ring.uvs[index - 1]!)
    }
  })

  test('an off-grid origin is honoured', () => {
    const field = fieldOf(3, 3, 2, (c, r) => c + r, [-3, 5])
    const ring = buildDrapedPolyline({
      points: [
        [-3, 5],
        [1, 9],
      ],
      field,
      lift: 0,
      closed: false,
    })
    for (let index = 0; index < ring.uvs.length; index++) {
      const [x, y, z] = vertexAt(ring.positions, index)
      expect(y).toBeCloseTo(surfaceHeightAt(field, x, z), 5)
    }
  })

  test('a degenerate polygon yields an empty ring rather than throwing', () => {
    const ring = buildDrapedPolyline({ points: [], field: null, lift: 0, closed: true })
    expect(ring.uvs).toHaveLength(0)
    expect(ring.positions).toHaveLength(0)
  })
})

describe('updateDrapedHeights', () => {
  test('rewrites Y in place and leaves XZ untouched', () => {
    const flat = createTerrainField({ cols: 5, rows: 5, spacing: 1 })
    const ring = buildDrapedPolyline({
      points: [
        [0.5, 0.5],
        [3.5, 2.5],
      ],
      field: flat,
      lift: 0.01,
      closed: false,
    })
    const xzBefore = [...ring.positions].filter((_, index) => index % 3 !== 1)
    const positionsIdentity = ring.positions

    // Same grid, different heights — exactly what a sculpt dab produces.
    const hill = fieldOf(5, 5, 1, (c, r) => (c === 2 && r === 1 ? 3 : 0))
    updateDrapedHeights(ring, hill, 0.01)

    expect(ring.positions).toBe(positionsIdentity)
    expect([...ring.positions].filter((_, index) => index % 3 !== 1)).toEqual(xzBefore)
    for (let index = 0; index < ring.uvs.length; index++) {
      const [x, y, z] = vertexAt(ring.positions, index)
      expect(y).toBeCloseTo(surfaceHeightAt(hill, x, z) + 0.01, 5)
    }
    // And the hill actually moved something, so the assertion above has teeth.
    expect(Math.max(...[...ring.positions].filter((_, i) => i % 3 === 1))).toBeGreaterThan(0.5)
  })

  test('cancelling a stroke restores the sculpted baseline, not flat ground', () => {
    // The Escape path. `SiteRenderer`'s stroke subscription re-drapes against the
    // *persisted* field when a stroke disappears without committing, and the case
    // that matters is a site already sculpted before the abandoned stroke: restoring
    // to flat would silently erase earlier work the user never touched. Asserting it
    // on the two fields is what makes "Escape leaves the scene untouched" checkable
    // without a canvas.
    const committed = fieldOf(5, 5, 1, (c, r) => (r === 2 ? 2 : 0))
    const points: Array<[number, number]> = [
      [0, 2],
      [4, 2],
    ]
    const ring = buildDrapedPolyline({ points, field: committed, lift: 0.01, closed: false })
    const baseline = [...ring.positions]

    // A dab lands, then the stroke is abandoned and the renderer re-drapes against
    // the persisted field — the same call, with the same grid, so no reallocation.
    updateDrapedHeights(
      ring,
      fieldOf(5, 5, 1, () => 9),
      0.01,
    )
    expect([...ring.positions]).not.toEqual(baseline)
    updateDrapedHeights(ring, committed, 0.01)

    expect([...ring.positions]).toEqual(baseline)
    // And the baseline is genuinely sculpted, so this is not a flat-vs-flat pass.
    expect(Math.max(...baseline.filter((_, i) => i % 3 === 1))).toBeGreaterThan(1)
  })

  test('a cleared field drops the ring back to the flat lift', () => {
    const hill = fieldOf(5, 5, 1, (c) => c)
    const ring = buildDrapedPolyline({
      points: [
        [0, 0],
        [4, 0],
      ],
      field: hill,
      lift: 0.01,
      closed: false,
    })
    updateDrapedHeights(ring, null, 0.01)
    for (let index = 0; index < ring.uvs.length; index++) {
      expect(vertexAt(ring.positions, index)[1]).toBeCloseTo(0.01, 6)
    }
  })
})

describe('terrainGridKey', () => {
  test('ignores heights, so a sculpt dab reuses the same subdivision', () => {
    const flat = createTerrainField({ cols: 9, rows: 9, spacing: 0.5 })
    const hill = fieldOf(9, 9, 0.5, (c, r) => c + r)
    expect(terrainGridKey(hill)).toBe(terrainGridKey(flat))
  })

  test('changes when the grid is resized or re-originned', () => {
    const base = createTerrainField({ cols: 9, rows: 9, spacing: 0.5 })
    expect(terrainGridKey({ ...base, cols: 17 })).not.toBe(terrainGridKey(base))
    expect(terrainGridKey({ ...base, spacing: 1 })).not.toBe(terrainGridKey(base))
    expect(terrainGridKey({ ...base, origin: [1, 0] })).not.toBe(terrainGridKey(base))
  })

  test('no terrain is its own key', () => {
    expect(terrainGridKey(null)).toBeNull()
  })
})

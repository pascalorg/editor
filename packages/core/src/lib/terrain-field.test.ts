import { describe, expect, test } from 'bun:test'
import {
  applyHeightPatch,
  createTerrainField,
  diffToPatches,
  flattenPatch,
  heightAt,
  heightAtSample,
  isFlatOver,
  normalAt,
  quantize,
  slopeAt,
  surfaceHeightAt,
  type TerrainField,
} from './terrain-field'

/** A small field with a known ramp along +X: height = x * grade. */
function rampField(grade: number, cols = 5, rows = 5, spacing = 1): TerrainField {
  const field = createTerrainField({ cols, rows, spacing, step: 0.01 })
  const heights = new Int16Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[r * cols + c] = Math.round((c * spacing * grade) / field.step)
    }
  }
  return { ...field, heights }
}

describe('quantize', () => {
  test('rounds onto the step ladder', () => {
    const field = createTerrainField({ step: 0.01 })
    expect(quantize(field, 1.004)).toBe(100)
    expect(quantize(field, 1.006)).toBe(101)
    expect(quantize(field, -0.5)).toBe(-50)
  })

  test('clamps to the Int16 range instead of overflowing', () => {
    const field = createTerrainField({ step: 0.01 })
    expect(quantize(field, 1e6)).toBe(32767)
    expect(quantize(field, -1e6)).toBe(-32768)
  })

  test('non-finite input yields 0 rather than NaN in the buffer', () => {
    const field = createTerrainField({ step: 0.01 })
    expect(quantize(field, Number.NaN)).toBe(0)
    expect(quantize(field, Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('heightAt', () => {
  test('a flat field reads its height everywhere, including off-grid points', () => {
    const field = applyHeightPatch(createTerrainField({ cols: 5, rows: 5, spacing: 1 }), {
      col0: 0,
      row0: 0,
      cols: 5,
      rows: 5,
      heights: new Int16Array(25).fill(250),
    })
    expect(heightAt(field, 0, 0)).toBeCloseTo(2.5, 9)
    expect(heightAt(field, 1.37, 2.9)).toBeCloseTo(2.5, 9)
  })

  test('interpolates linearly across a rendered triangle', () => {
    const field = rampField(1)
    // Ramp is 1 m rise per 1 m of +X, so the midpoint between x=1 and x=2 is 1.5.
    expect(heightAt(field, 1.5, 0)).toBeCloseTo(1.5, 6)
    expect(heightAt(field, 2, 0)).toBeCloseTo(2, 6)
  })

  test('clamps to the edge height outside the field rather than returning a hole', () => {
    const field = rampField(1)
    // Field spans x in [0,4]. Past the far edge, the last column's height holds.
    expect(heightAt(field, 99, 0)).toBeCloseTo(4, 6)
    expect(heightAt(field, -99, 0)).toBeCloseTo(0, 6)
  })

  test('respects a non-zero origin', () => {
    const base = rampField(1)
    const shifted: TerrainField = { ...base, origin: [10, 10] }
    // The ramp now starts at x=10, so x=12 is 2 m up.
    expect(heightAt(shifted, 12, 10)).toBeCloseTo(2, 6)
    // And x=0 is off the low edge, clamped to the first column.
    expect(heightAt(shifted, 0, 10)).toBeCloseTo(0, 6)
  })
})

describe('heightAtSample', () => {
  test('clamps out-of-range indices to the border', () => {
    const field = rampField(1)
    expect(heightAtSample(field, -5, 0)).toBeCloseTo(0, 6)
    expect(heightAtSample(field, 999, 0)).toBeCloseTo(4, 6)
  })
})

describe('surfaceHeightAt — explicit alias for the shared surface authority', () => {
  /**
   * A cell warped as much as it can be: opposite corners at 4 m, the other two at
   * the datum. The two triangles both contain the diagonal, whose midpoint is
   * 4 m on one diagonal pair and 0 m on the other.
   */
  function saddleField(): TerrainField {
    const base = createTerrainField({ cols: 3, rows: 3, spacing: 2, step: 0.01 })
    const heights = new Int16Array(9)
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        heights[r * 3 + c] = (c + r) % 2 === 0 ? 400 : 0
      }
    }
    return { ...base, heights }
  }

  test('agrees with heightAt at every sample', () => {
    const field = saddleField()
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const x = c * 2
        const z = r * 2
        expect(surfaceHeightAt(field, x, z)).toBeCloseTo(heightAt(field, x, z), 6)
      }
    }
  })

  test('heightAt is planar within the rendered triangle', () => {
    const field = saddleField()
    // Cell [0,0] spans x,z ∈ [0,2]; the diagonal runs (2,0)–(0,2). The lower
    // triangle is (0,0)=4, (2,0)=0, (0,2)=0, whose plane is 4 − 2x − 2z... in
    // metres, 4·(1 − x/2 − z/2). Midpoint of the diagonal: x = z = 1 → 0.
    expect(surfaceHeightAt(field, 1, 1)).toBeCloseTo(0, 6)
    // The plane's value at a third of the way along each axis.
    expect(surfaceHeightAt(field, 0.5, 0.5)).toBeCloseTo(2, 6)
    expect(heightAt(field, 1, 1)).toBeCloseTo(0, 6)
  })

  test('picks the far triangle past the diagonal', () => {
    const field = saddleField()
    // Just inside cell [0,0] but past tc + tr = 1: the upper triangle is
    // (2,2)=4, (0,2)=0, (2,0)=0, so its plane rises toward (2,2).
    expect(surfaceHeightAt(field, 1.5, 1.5)).toBeCloseTo(2, 6)
  })

  test('the compatibility name always delegates to heightAt', () => {
    const field = rampField(0.5, 5, 5)
    for (const [x, z] of [
      [0.3, 0.7],
      [1.5, 2.5],
      [3.9, 1.1],
    ] as const) {
      expect(surfaceHeightAt(field, x, z)).toBeCloseTo(heightAt(field, x, z), 6)
    }
  })

  test('clamps outside the field to the border cell plane', () => {
    const field = rampField(1, 5, 5)
    // Past +X the ramp stops: the border sample is 4 m and stays 4 m.
    expect(surfaceHeightAt(field, 99, 2)).toBeCloseTo(4, 6)
    expect(surfaceHeightAt(field, -99, 2)).toBeCloseTo(0, 6)
  })

  test('a degenerate single-sample field falls back to the clamped read', () => {
    const field = createTerrainField({ cols: 1, rows: 1, spacing: 1 })
    expect(surfaceHeightAt(field, 5, 5)).toBe(0)
  })
})

describe('slopeAt and normalAt', () => {
  test('flat ground is zero slope with a straight-up normal', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1 })
    expect(slopeAt(field, 2, 2)).toBeCloseTo(0, 9)
    const [nx, ny, nz] = normalAt(field, 2, 2)
    expect(nx).toBeCloseTo(0, 9)
    expect(ny).toBeCloseTo(1, 9)
    expect(nz).toBeCloseTo(0, 9)
  })

  test('a 45-degree ramp reads back as 45 degrees', () => {
    const field = rampField(1)
    expect(slopeAt(field, 2, 2)).toBeCloseTo(Math.PI / 4, 4)
  })

  test('normal tilts against the uphill direction and stays unit length', () => {
    const field = rampField(1)
    const [nx, ny, nz] = normalAt(field, 2, 2)
    // Uphill is +X, so the normal leans -X.
    expect(nx).toBeLessThan(0)
    expect(ny).toBeGreaterThan(0)
    expect(nz).toBeCloseTo(0, 6)
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 9)
  })
})

describe('isFlatOver — the placement predicate', () => {
  test('true on untouched ground', () => {
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    expect(isFlatOver(field, 1, 1, 4, 4)).toBe(true)
  })

  test('false across a ramp', () => {
    const field = rampField(1, 9, 9)
    expect(isFlatOver(field, 1, 1, 4, 4)).toBe(false)
  })

  test('true over a flattened pad, false when the rect spills past it', () => {
    const base = rampField(1, 9, 9)
    const patch = flattenPatch(base, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, 3)
    expect(patch).not.toBeNull()
    const field = applyHeightPatch(base, patch as never)
    expect(isFlatOver(field, 2.5, 2.5, 4.5, 4.5)).toBe(true)
    // Reaching past the pad onto the ramp breaks flatness.
    expect(isFlatOver(field, 2.5, 2.5, 8, 8)).toBe(false)
  })

  test('a one-step difference is detected — quantization makes this exact', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1, step: 0.01 })
    const bumped = applyHeightPatch(field, {
      col0: 2,
      row0: 2,
      cols: 1,
      rows: 1,
      heights: new Int16Array([1]),
    })
    // 1 unit = 1 cm. No epsilon can be tuned wrong here; it is integer equality.
    expect(isFlatOver(bumped, 0, 0, 4, 4)).toBe(false)
  })
})

describe('applyHeightPatch — the one write seam', () => {
  test('does not mutate the input field', () => {
    const before = createTerrainField({ cols: 4, rows: 4, spacing: 1 })
    const after = applyHeightPatch(before, {
      col0: 0,
      row0: 0,
      cols: 1,
      rows: 1,
      heights: new Int16Array([500]),
    })
    expect(before.heights[0]).toBe(0)
    expect(after.heights[0]).toBe(500)
    expect(after.heights).not.toBe(before.heights)
  })

  test('writes only the patch rect', () => {
    const field = applyHeightPatch(createTerrainField({ cols: 4, rows: 4, spacing: 1 }), {
      col0: 1,
      row0: 1,
      cols: 2,
      rows: 2,
      heights: new Int16Array([10, 20, 30, 40]),
    })
    expect(Array.from(field.heights)).toEqual([0, 0, 0, 0, 0, 10, 20, 0, 0, 30, 40, 0, 0, 0, 0, 0])
  })

  test('clips a patch that overhangs the field instead of throwing', () => {
    const field = createTerrainField({ cols: 3, rows: 3, spacing: 1 })
    const after = applyHeightPatch(field, {
      col0: 2,
      row0: 2,
      cols: 3,
      rows: 3,
      heights: new Int16Array(9).fill(7),
    })
    // Only the single in-range corner sample lands.
    expect(after.heights[8]).toBe(7)
    expect(Array.from(after.heights).filter((h) => h === 7)).toHaveLength(1)
  })

  test('a fully out-of-range patch is a no-op', () => {
    const field = createTerrainField({ cols: 3, rows: 3, spacing: 1 })
    const after = applyHeightPatch(field, {
      col0: 50,
      row0: 50,
      cols: 2,
      rows: 2,
      heights: new Int16Array(4).fill(9),
    })
    expect(Array.from(after.heights).every((h) => h === 0)).toBe(true)
  })
})

describe('flattenPatch — the first brush', () => {
  test('sets an absolute height under the rect', () => {
    const base = rampField(1, 9, 9)
    const patch = flattenPatch(base, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, 2.5)
    expect(patch).not.toBeNull()
    const field = applyHeightPatch(base, patch as never)
    expect(heightAt(field, 3, 3)).toBeCloseTo(2.5, 6)
    expect(heightAt(field, 4, 4)).toBeCloseTo(2.5, 6)
  })

  test('leaves ground outside the rect untouched', () => {
    const base = rampField(1, 9, 9)
    const patch = flattenPatch(base, { minX: 2, minZ: 2, maxX: 4, maxZ: 4 }, 0)
    const field = applyHeightPatch(base, patch as never)
    // x=7 is well past the pad; the ramp still reads 7 m.
    expect(heightAt(field, 7, 7)).toBeCloseTo(7, 6)
  })

  test('returns null when the rect misses the field', () => {
    const field = createTerrainField({ cols: 4, rows: 4, spacing: 1 })
    expect(flattenPatch(field, { minX: 100, minZ: 100, maxX: 110, maxZ: 110 }, 1)).toBeNull()
  })

  test('the flattened pad satisfies isFlatOver — brush and predicate agree', () => {
    const base = rampField(0.5, 17, 17)
    const patch = flattenPatch(base, { minX: 3, minZ: 3, maxX: 9, maxZ: 9 }, 1.25)
    const field = applyHeightPatch(base, patch as never)
    expect(isFlatOver(field, 3.5, 3.5, 8.5, 8.5)).toBe(true)
    // And the height is exactly what was asked for, on the ladder.
    expect(heightAt(field, 6, 6)).toBeCloseTo(1.25, 9)
  })
})

describe('diffToPatches — the 64 KiB transport contract', () => {
  const MAX = 64 * 1024

  test('no change yields no patches', () => {
    const field = rampField(1, 9, 9)
    expect(diffToPatches(field, field, MAX)).toEqual([])
  })

  test('a one-sample edit yields one small patch, not a full-field rewrite', () => {
    const before = createTerrainField({ cols: 129, rows: 129, spacing: 0.5 })
    const after = applyHeightPatch(before, {
      col0: 64,
      row0: 64,
      cols: 1,
      rows: 1,
      heights: new Int16Array([123]),
    })
    const patches = diffToPatches(before, after, MAX)
    expect(patches).toHaveLength(1)
    expect(patches[0]?.rows).toBe(1)
    expect(patches[0]?.row0).toBe(64)
  })

  test('round-trips: applying every patch reproduces the target field', () => {
    const before = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
    const target = applyHeightPatch(
      before,
      flattenPatch(before, { minX: 4, minZ: 4, maxX: 20, maxZ: 20 }, 1.75) as never,
    )
    let rebuilt = before
    for (const patch of diffToPatches(before, target, MAX)) {
      rebuilt = applyHeightPatch(rebuilt, patch)
    }
    expect(Array.from(rebuilt.heights)).toEqual(Array.from(target.heights))
  })

  test('every patch stays under the byte cap, even for a full-field change', () => {
    const before = createTerrainField({ cols: 129, rows: 129, spacing: 0.5 })
    const after = applyHeightPatch(
      before,
      flattenPatch(before, { minX: -1e3, minZ: -1e3, maxX: 1e3, maxZ: 1e3 }, 5) as never,
    )
    const patches = diffToPatches(before, after, MAX)
    expect(patches.length).toBeGreaterThan(0)
    for (const patch of patches) {
      // 2 bytes per sample, doubled because the op carries `from` and `to`.
      expect(patch.heights.byteLength * 2).toBeLessThanOrEqual(MAX)
    }
  })

  test('a full-field change still round-trips across the chunk boundary', () => {
    const before = createTerrainField({ cols: 129, rows: 129, spacing: 0.5 })
    const after = applyHeightPatch(
      before,
      flattenPatch(before, { minX: -1e3, minZ: -1e3, maxX: 1e3, maxZ: 1e3 }, 5) as never,
    )
    let rebuilt = before
    for (const patch of diffToPatches(before, after, MAX)) {
      rebuilt = applyHeightPatch(rebuilt, patch)
    }
    expect(Array.from(rebuilt.heights)).toEqual(Array.from(after.heights))
  })

  test('two separate dirty regions yield separate patches', () => {
    const before = createTerrainField({ cols: 33, rows: 33, spacing: 1 })
    let after = applyHeightPatch(before, {
      col0: 2,
      row0: 2,
      cols: 1,
      rows: 1,
      heights: new Int16Array([5]),
    })
    after = applyHeightPatch(after, {
      col0: 20,
      row0: 20,
      cols: 1,
      rows: 1,
      heights: new Int16Array([9]),
    })
    const patches = diffToPatches(before, after, MAX)
    expect(patches).toHaveLength(2)
    expect(patches[0]?.row0).toBe(2)
    expect(patches[1]?.row0).toBe(20)
  })

  test('a shape change chunks the whole field rather than diffing mismatched buffers', () => {
    const before = createTerrainField({ cols: 5, rows: 5, spacing: 1 })
    const after = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const patches = diffToPatches(before, after, MAX)
    const totalRows = patches.reduce((sum, p) => sum + p.rows, 0)
    expect(totalRows).toBe(9)
  })
})

import { describe, expect, test } from 'bun:test'
import {
  applyHeightPatch,
  createTerrainField,
  flattenPatch,
  heightAt,
  type TerrainField,
} from './terrain-field'
import { raycastTerrain } from './terrain-raycast'

/** A field sloping up along +X at `grade` (rise per metre). */
function ramp(grade: number, cols = 33, rows = 33, spacing = 1): TerrainField {
  const field = createTerrainField({ cols, rows, spacing, step: 0.01 })
  const heights = new Int16Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[r * cols + c] = Math.round((c * spacing * grade) / field.step)
    }
  }
  return { ...field, heights }
}

describe('raycastTerrain — flat ground', () => {
  test('a straight-down ray hits Y=0 at its own XZ', () => {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 1 })
    const hit = raycastTerrain(field, [5, 10, 7], [0, -1, 0])
    expect(hit).not.toBeNull()
    expect(hit?.x).toBeCloseTo(5, 6)
    expect(hit?.z).toBeCloseTo(7, 6)
    expect(hit?.y).toBeCloseTo(0, 6)
    expect(hit?.t).toBeCloseTo(10, 5)
  })

  test('t is in units of the direction vector, matching Ray.at', () => {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 1 })
    // Direction of length 2 -> t should be half the distance travelled.
    const hit = raycastTerrain(field, [5, 10, 5], [0, -2, 0])
    expect(hit?.t).toBeCloseTo(5, 5)
  })

  test('agrees with the flat-plane solve it replaces', () => {
    const field = createTerrainField({ cols: 65, rows: 65, spacing: 0.5 })
    // Field spans 0..32 in X and Z; the flat-plane hit must land inside it for
    // the two to be comparable at all.
    const origin: [number, number, number] = [3, 12, 4]
    const dir: [number, number, number] = [0.4, -1, 0.25]
    const hit = raycastTerrain(field, origin, dir)
    // The legacy solve: t = -oy / dy.
    const tPlane = -origin[1] / dir[1]
    expect(hit?.t).toBeCloseTo(tPlane, 4)
    expect(hit?.x).toBeCloseTo(origin[0] + dir[0] * tPlane, 4)
    expect(hit?.z).toBeCloseTo(origin[2] + dir[2] * tPlane, 4)
  })
})

describe('raycastTerrain — slopes', () => {
  test('hits the analytic point on a 1:1 ramp', () => {
    // Ground: y = x. Ray from (0, 4, 5) heading +X and down at 45°: y = 4 - x.
    // Intersection where x = 4 - x -> x = 2, y = 2.
    const hit = raycastTerrain(ramp(1), [0, 4, 5], [1, -1, 0])
    expect(hit).not.toBeNull()
    expect(hit?.x).toBeCloseTo(2, 4)
    expect(hit?.y).toBeCloseTo(2, 4)
    expect(hit?.z).toBeCloseTo(5, 6)
  })

  test('the hit is on the surface — y equals the field height there', () => {
    const field = ramp(0.3, 65, 65, 0.5)
    const hit = raycastTerrain(field, [2, 9, 3], [0.7, -1, 0.3])
    expect(hit).not.toBeNull()
    // The defining property: the returned point lies on the surface.
    expect(hit?.y).toBeCloseTo(heightAt(field, hit?.x ?? 0, hit?.z ?? 0), 6)
  })

  test('a downhill ray does NOT report the flat-plane answer', () => {
    // This is the bug the function exists to fix: on a slope, the flat solve
    // lands at a different XZ than the real surface hit.
    const field = ramp(0.5, 65, 65, 0.5)
    const origin: [number, number, number] = [1, 8, 1]
    const dir: [number, number, number] = [1, -1, 0]
    const hit = raycastTerrain(field, origin, dir)
    const tPlane = -origin[1] / dir[1]
    const xPlane = origin[0] + dir[0] * tPlane
    expect(Math.abs((hit?.x ?? 0) - xPlane)).toBeGreaterThan(1)
  })

  test('does not step over a single-cell spike', () => {
    // One raised sample in an otherwise flat field. A ray aimed to pass just
    // above the flat ground must hit the spike, not the ground beyond it.
    const base = createTerrainField({ cols: 33, rows: 33, spacing: 1 })
    const heights = new Int16Array(base.heights)
    heights[16 * 33 + 16] = 500 // 5 m at step 0.01
    const field: TerrainField = { ...base, heights }
    // Sample [16,16] is at world (16, 16). Come in low from -X at that Z.
    const hit = raycastTerrain(field, [10, 2.4, 16], [1, -0.05, 0])
    expect(hit).not.toBeNull()
    // Must land on the spike's rising flank, well before the far side.
    expect(hit?.x).toBeLessThan(16)
    expect(hit?.x).toBeGreaterThan(11)
    expect(hit?.y).toBeGreaterThan(1)
  })
})

describe('raycastTerrain — misses and edges', () => {
  test('returns null for a ray pointing away from the field', () => {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 1 })
    expect(raycastTerrain(field, [5, 10, 5], [0, 1, 0])).toBeNull()
  })

  test('returns null when the ray misses the field in XZ', () => {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 1 })
    // Field spans x,z in [0,32]. Straight down at x = -50 is outside.
    expect(raycastTerrain(field, [-50, 10, -50], [0, -1, 0])).toBeNull()
  })

  test('a ray from outside still hits when it crosses the field', () => {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 1 })
    const hit = raycastTerrain(field, [-20, 5, 16], [1, -0.2, 0])
    expect(hit).not.toBeNull()
    expect(hit?.x).toBeGreaterThanOrEqual(0)
    expect(hit?.y).toBeCloseTo(0, 5)
  })

  test('a zero-length direction returns null instead of looping', () => {
    const field = createTerrainField({ cols: 33, rows: 33, spacing: 1 })
    expect(raycastTerrain(field, [5, 10, 5], [0, 0, 0])).toBeNull()
  })

  test('a horizontal ray inside the field terminates', () => {
    // Worst case for the march: never descends, must exit via the XZ clip.
    const field = createTerrainField({ cols: 129, rows: 129, spacing: 0.5 })
    const hit = raycastTerrain(field, [1, 5, 1], [1, 0, 0])
    expect(hit).toBeNull()
  })

  test('a ray fired upward from underground finds the surface above it', () => {
    // The march tracks a sign change, not "starts above", so a basement-level
    // ray still resolves the ground it exits through.
    const field = ramp(0.4, 33, 33, 1)
    const hit = raycastTerrain(field, [10, -2, 10], [0, 1, 0])
    expect(hit).not.toBeNull()
    expect(hit?.y).toBeCloseTo(4, 4)
    expect(hit?.x).toBeCloseTo(10, 6)
  })

  test('a downward ray from underground misses — there is no surface below it', () => {
    const field = ramp(0.4, 33, 33, 1)
    expect(raycastTerrain(field, [10, -2, 10], [0, -1, 0])).toBeNull()
  })

  test('an origin exactly on the surface hits at t = 0', () => {
    const field = ramp(0.5, 33, 33, 1)
    // Ground at x = 10 is 5 m.
    const hit = raycastTerrain(field, [10, 5, 10], [0, -1, 0])
    expect(hit?.t).toBeCloseTo(0, 6)
    expect(hit?.y).toBeCloseTo(5, 5)
  })

  test('respects a non-zero field origin', () => {
    const field: TerrainField = {
      ...createTerrainField({ cols: 33, rows: 33, spacing: 1 }),
      origin: [100, 200],
    }
    // Inside the shifted field.
    expect(raycastTerrain(field, [110, 5, 210], [0, -1, 0])).not.toBeNull()
    // Where the field used to be.
    expect(raycastTerrain(field, [10, 5, 10], [0, -1, 0])).toBeNull()
  })
})

describe('raycastTerrain — consistency with the write path', () => {
  test('picks up a flattened pad immediately after applyHeightPatch', () => {
    const before = ramp(0.5, 33, 33, 1)
    const patch = flattenPatch(before, { minX: 8, minZ: 8, maxX: 14, maxZ: 14 }, 3)
    expect(patch).not.toBeNull()
    const after = applyHeightPatch(before, patch as never)

    const hitBefore = raycastTerrain(before, [11, 20, 11], [0, -1, 0])
    const hitAfter = raycastTerrain(after, [11, 20, 11], [0, -1, 0])
    expect(hitBefore?.y).toBeCloseTo(5.5, 5)
    expect(hitAfter?.y).toBeCloseTo(3, 5)
  })
})

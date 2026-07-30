import { describe, expect, test } from 'bun:test'
import {
  applyHeightPatch,
  createTerrainField,
  flattenPatch,
  type TerrainField,
} from '@pascal-app/core'
import {
  buildTerrainMesh,
  buildTerrainSkirt,
  HORIZON_PLANE_Y,
  patchUpdateRange,
  terrainFootprint,
  updateTerrainMesh,
  updateTerrainSkirt,
} from './terrain-geometry'

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

describe('buildTerrainMesh', () => {
  test('emits one vertex per sample and two triangles per cell', () => {
    const field = createTerrainField({ cols: 5, rows: 4, spacing: 1 })
    const mesh = buildTerrainMesh(field)
    expect(mesh.positions).toHaveLength(5 * 4 * 3)
    expect(mesh.normals).toHaveLength(5 * 4 * 3)
    expect(mesh.uvs).toHaveLength(5 * 4 * 2)
    expect(mesh.indices).toHaveLength(4 * 3 * 6)
  })

  test('vertex positions match the field origin and spacing', () => {
    const field: TerrainField = {
      ...createTerrainField({ cols: 3, rows: 3, spacing: 2 }),
      origin: [10, 20],
    }
    const mesh = buildTerrainMesh(field)
    // Sample [2,1] -> world (10 + 2*2, 20 + 1*2) = (14, 22).
    const i = (1 * 3 + 2) * 3
    expect(mesh.positions[i]).toBeCloseTo(14, 6)
    expect(mesh.positions[i + 2]).toBeCloseTo(22, 6)
  })

  test('vertex Y carries the quantized height', () => {
    const field = rampField(1)
    const mesh = buildTerrainMesh(field)
    // Column 3 of row 0 is 3 m up on a 1:1 ramp.
    expect(mesh.positions[3 * 3 + 1]).toBeCloseTo(3, 5)
  })

  test('flat ground yields straight-up normals', () => {
    const mesh = buildTerrainMesh(createTerrainField({ cols: 4, rows: 4, spacing: 1 }))
    for (let i = 0; i < 16; i++) {
      expect(mesh.normals[i * 3 + 1]).toBeCloseTo(1, 6)
    }
  })

  test('every normal is unit length on a slope', () => {
    const mesh = buildTerrainMesh(rampField(0.5, 5, 5))
    for (let i = 0; i < 25; i++) {
      const len = Math.hypot(
        mesh.normals[i * 3] ?? 0,
        mesh.normals[i * 3 + 1] ?? 0,
        mesh.normals[i * 3 + 2] ?? 0,
      )
      expect(len).toBeCloseTo(1, 6)
    }
  })

  test('UVs span 0..1 across the field', () => {
    const mesh = buildTerrainMesh(createTerrainField({ cols: 3, rows: 3, spacing: 1 }))
    expect(mesh.uvs[0]).toBeCloseTo(0, 9)
    expect(mesh.uvs[1]).toBeCloseTo(0, 9)
    // Last sample [2,2].
    const last = (2 * 3 + 2) * 2
    expect(mesh.uvs[last]).toBeCloseTo(1, 9)
    expect(mesh.uvs[last + 1]).toBeCloseTo(1, 9)
  })

  test('indices stay in range and wind counter-clockwise seen from +Y', () => {
    const field = createTerrainField({ cols: 3, rows: 3, spacing: 1 })
    const mesh = buildTerrainMesh(field)
    const vertexCount = field.cols * field.rows
    for (const idx of mesh.indices) {
      expect(idx).toBeLessThan(vertexCount)
    }
    // Every triangle's face normal must point up (+Y), and therefore agree with
    // the analytic vertex normals. Checking the 3D cross product rather than a
    // 2D signed area, because the 2D shortcut has the opposite sign convention
    // in a Y-up right-handed frame and would assert the reverse.
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t] ?? 0
      const b = mesh.indices[t + 1] ?? 0
      const c = mesh.indices[t + 2] ?? 0
      const abx = (mesh.positions[b * 3] ?? 0) - (mesh.positions[a * 3] ?? 0)
      const abz = (mesh.positions[b * 3 + 2] ?? 0) - (mesh.positions[a * 3 + 2] ?? 0)
      const acx = (mesh.positions[c * 3] ?? 0) - (mesh.positions[a * 3] ?? 0)
      const acz = (mesh.positions[c * 3 + 2] ?? 0) - (mesh.positions[a * 3 + 2] ?? 0)
      // Y component of (ab x ac).
      const normalY = abz * acx - abx * acz
      expect(normalY).toBeGreaterThan(0)
    }
  })

  test('a degenerate 1x1 field produces no triangles rather than throwing', () => {
    const mesh = buildTerrainMesh(createTerrainField({ cols: 1, rows: 1, spacing: 1 }))
    expect(mesh.indices).toHaveLength(0)
    expect(mesh.positions).toHaveLength(3)
  })
})

describe('patchUpdateRange', () => {
  test('covers the patch rows widened by one on each side for normals', () => {
    const field = createTerrainField({ cols: 10, rows: 10, spacing: 1 })
    const range = patchUpdateRange(
      field,
      {
        col0: 3,
        row0: 4,
        cols: 2,
        rows: 2,
        heights: new Int16Array(4),
      },
      3,
    )
    expect(range).not.toBeNull()
    // Rows 3..6 inclusive -> vertices 30..69 -> elements 90..210.
    expect(range?.start).toBe(3 * 10 * 3)
    expect(range?.count).toBe(4 * 10 * 3)
  })

  test('clamps at the field edges', () => {
    const field = createTerrainField({ cols: 8, rows: 8, spacing: 1 })
    const range = patchUpdateRange(
      field,
      {
        col0: 0,
        row0: 0,
        cols: 1,
        rows: 1,
        heights: new Int16Array(1),
      },
      3,
    )
    // Starts at row 0, not -1.
    expect(range?.start).toBe(0)
  })

  test('scales with itemSize so uv (2) and position (3) ranges differ', () => {
    const field = createTerrainField({ cols: 8, rows: 8, spacing: 1 })
    const patch = { col0: 0, row0: 2, cols: 1, rows: 1, heights: new Int16Array(1) }
    const pos = patchUpdateRange(field, patch, 3)
    const uv = patchUpdateRange(field, patch, 2)
    expect(pos?.start).toBe(1 * 8 * 3)
    expect(uv?.start).toBe(1 * 8 * 2)
  })
})

describe('updateTerrainMesh — the dirty-rect path', () => {
  test('a patched rebuild matches a full rebuild exactly', () => {
    const before = createTerrainField({ cols: 17, rows: 17, spacing: 0.5 })
    const patch = flattenPatch(before, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, 1.5)
    expect(patch).not.toBeNull()
    const after = applyHeightPatch(before, patch as never)

    const incremental = buildTerrainMesh(before)
    updateTerrainMesh(after, incremental, patch as never)
    const full = buildTerrainMesh(after)

    // Positions must agree everywhere — the incremental path is only allowed to
    // be cheaper, never different.
    expect(Array.from(incremental.positions)).toEqual(Array.from(full.positions))
  })

  test('normals agree too — the widened range catches neighbour shading', () => {
    const before = rampField(0.3, 17, 17, 0.5)
    const patch = flattenPatch(before, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, 1)
    const after = applyHeightPatch(before, patch as never)

    const incremental = buildTerrainMesh(before)
    updateTerrainMesh(after, incremental, patch as never)
    const full = buildTerrainMesh(after)

    for (let i = 0; i < full.normals.length; i++) {
      expect(incremental.normals[i]).toBeCloseTo(full.normals[i] ?? 0, 6)
    }
  })

  test('does not reallocate the buffers', () => {
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const mesh = buildTerrainMesh(field)
    const positions = mesh.positions
    updateTerrainMesh(field, mesh, {
      col0: 0,
      row0: 3,
      cols: 2,
      rows: 2,
      heights: new Int16Array(4),
    })
    expect(mesh.positions).toBe(positions)
  })
})

describe('buildTerrainSkirt — the horizon seam', () => {
  /** Top/bottom Y of the ring position at index `i`. */
  function span(positions: Float32Array, i: number): { top: number; bottom: number } {
    return { top: positions[i * 2 * 3 + 1] ?? 0, bottom: positions[(i * 2 + 1) * 3 + 1] ?? 0 }
  }

  test('one quad per boundary sample, closing the ring', () => {
    const field = createTerrainField({ cols: 5, rows: 4, spacing: 1 })
    const skirt = buildTerrainSkirt(field)
    const perimeter = 2 * 4 + 2 * 3
    // The first ring position is repeated at the end, so the strip closes without
    // a special-cased final quad.
    expect(skirt.positions).toHaveLength((perimeter + 1) * 2 * 3)
    expect(skirt.indices).toHaveLength(perimeter * 6)
  })

  test('the top edge follows the terrain wherever the terrain is above the disc', () => {
    const field = rampField(1, 5, 5)
    const skirt = buildTerrainSkirt(field)
    // Ring position 0 is sample [0,0] (height 0), and the ramp's far edge is 4 m.
    // Position 4 is sample [4,0] — the top of the ramp.
    expect(span(skirt.positions, 4).top).toBeCloseTo(4, 5)
    expect(skirt.positions[4 * 2 * 3]).toBeCloseTo(4, 5)
  })

  test('the span brackets both the terrain edge and the horizon plane', () => {
    // The correctness argument: whichever of the two is higher, a sightline through
    // the rim crosses the curtain, because the curtain covers the rim's whole Y
    // range at the rim's own XZ. Asserted on an excavated edge and a raised one.
    const base = createTerrainField({ cols: 5, rows: 5, spacing: 1 })
    const dug = applyHeightPatch(
      base,
      flattenPatch(base, { minX: -1, minZ: -1, maxX: 1, maxZ: 5 }, -3) as never,
    )
    const skirt = buildTerrainSkirt(dug)
    const perimeter = 2 * 4 + 2 * 4
    for (let i = 0; i < perimeter; i++) {
      const { top, bottom } = span(skirt.positions, i)
      // Float32 storage rounds the plane itself, so the bracket is asserted to
      // within a rounding step rather than exactly.
      expect(top).toBeGreaterThan(HORIZON_PLANE_Y - 1e-6)
      expect(bottom).toBeLessThan(HORIZON_PLANE_Y)
      expect(bottom).toBeLessThan(top)
    }
  })

  test('flat ground at the datum still spans the disc, so the rim is never open', () => {
    // The punch in the horizon disc exists whenever there is a field at all, so
    // even an untouched field has a rim to close.
    const skirt = buildTerrainSkirt(createTerrainField({ cols: 5, rows: 5, spacing: 1 }))
    const { top, bottom } = span(skirt.positions, 0)
    expect(top).toBeCloseTo(0, 6)
    expect(bottom).toBeLessThan(HORIZON_PLANE_Y)
  })

  test('every ring position is on the field boundary', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 2 })
    const skirt = buildTerrainSkirt(field)
    const perimeter = 2 * 4 + 2 * 4
    const maxX = 8
    const maxZ = 8
    for (let i = 0; i <= perimeter; i++) {
      const x = skirt.positions[i * 2 * 3] ?? 0
      const z = skirt.positions[i * 2 * 3 + 2] ?? 0
      const onEdge = x === 0 || x === maxX || z === 0 || z === maxZ
      expect(onEdge).toBe(true)
      // And the pair shares its XZ — the quad is vertical.
      expect(skirt.positions[(i * 2 + 1) * 3]).toBe(x)
      expect(skirt.positions[(i * 2 + 1) * 3 + 2]).toBe(z)
    }
  })

  test('normals point outward and lie in the horizontal plane', () => {
    const field = createTerrainField({ cols: 5, rows: 5, spacing: 1 })
    const skirt = buildTerrainSkirt(field)
    const cx = 2
    const cz = 2
    const perimeter = 2 * 4 + 2 * 4
    for (let i = 0; i < perimeter; i++) {
      const base = i * 2 * 3
      const x = skirt.positions[base] ?? 0
      const z = skirt.positions[base + 2] ?? 0
      const nx = skirt.normals[base] ?? 0
      const ny = skirt.normals[base + 1] ?? 0
      const nz = skirt.normals[base + 2] ?? 0
      expect(ny).toBe(0)
      expect(Math.hypot(nx, nz)).toBeCloseTo(1, 6)
      // Outward: the normal agrees with the direction away from the field centre.
      expect(nx * (x - cx) + nz * (z - cz)).toBeGreaterThan(0)
    }
  })

  test('updateTerrainSkirt rewrites in place and matches a full rebuild', () => {
    const before = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const patch = flattenPatch(before, { minX: -1, minZ: -1, maxX: 2, maxZ: 2 }, 2.5)
    const after = applyHeightPatch(before, patch as never)

    const skirt = buildTerrainSkirt(before)
    const positions = skirt.positions
    updateTerrainSkirt(after, skirt)
    expect(skirt.positions).toBe(positions)

    const full = buildTerrainSkirt(after)
    expect(Array.from(skirt.positions)).toEqual(Array.from(full.positions))
  })

  test('a degenerate field yields no skirt rather than throwing', () => {
    const skirt = buildTerrainSkirt(createTerrainField({ cols: 1, rows: 1, spacing: 1 }))
    expect(skirt.positions).toHaveLength(0)
    expect(skirt.indices).toHaveLength(0)
  })
})

/**
 * The punch is what makes a pit visible: the horizon disc is a solid plate at
 * `HORIZON_PLANE_Y`, so without a hole in it every excavation is roofed over and
 * digging reads as no change at all. These assert the two properties the punch has
 * to hold — it covers the whole field, and it stays inside the rim the skirt closes.
 */
describe('terrainFootprint — the horizon punch', () => {
  test('the hole covers every interior sample of the field', () => {
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 2 })
    const [[minX, minZ], , [maxX, maxZ]] = terrainFootprint(field) as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ]
    // A sample left outside the hole is a column of disc standing over the terrain
    // there — the exact "excavation capped by the horizon" failure.
    for (let row = 1; row < field.rows - 1; row++) {
      for (let col = 1; col < field.cols - 1; col++) {
        const x = field.origin[0] + col * field.spacing
        const z = field.origin[1] + row * field.spacing
        expect(x).toBeGreaterThan(minX)
        expect(x).toBeLessThan(maxX)
        expect(z).toBeGreaterThan(minZ)
        expect(z).toBeLessThan(maxZ)
      }
    }
  })

  test('the hole stays inside the rim, by half a cell on every side', () => {
    const field = createTerrainField({ cols: 5, rows: 7, spacing: 4 })
    const footprint = terrainFootprint(field)
    const half = field.spacing / 2
    const edgeMinX = field.origin[0]
    const edgeMinZ = field.origin[1]
    const edgeMaxX = field.origin[0] + (field.cols - 1) * field.spacing
    const edgeMaxZ = field.origin[1] + (field.rows - 1) * field.spacing
    // Inset, never outset. Punching *wider* than the terrain edge would open a gap
    // the skirt does not span — the skirt's curtain sits at the rim's exact XZ, so
    // it can only close a hole that stops at or inside that rim.
    expect(footprint).toEqual([
      [edgeMinX + half, edgeMinZ + half],
      [edgeMaxX - half, edgeMinZ + half],
      [edgeMaxX - half, edgeMaxZ - half],
      [edgeMinX + half, edgeMaxZ - half],
    ])
  })

  test('every skirt ring position lies outside the punched hole', () => {
    // The overlap that stops the z-fight, stated as the invariant that matters:
    // the curtain is always on the disc side of the hole's edge, so there is a band
    // of doubled coverage rather than two coplanar edges fighting along the rim.
    const field = rampField(0.4, 9, 9, 1)
    const skirt = buildTerrainSkirt(field)
    const [[minX, minZ], , [maxX, maxZ]] = terrainFootprint(field) as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ]
    const count = skirt.positions.length / 3
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < count; index++) {
      const x = skirt.positions[index * 3] as number
      const z = skirt.positions[index * 3 + 2] as number
      const outside = x <= minX || x >= maxX || z <= minZ || z >= maxZ
      expect(outside).toBe(true)
    }
  })

  test('an off-grid origin carries through, so the punch is not centred on assumption', () => {
    const base = createTerrainField({ cols: 5, rows: 5, spacing: 1 })
    const field: TerrainField = { ...base, origin: [17.5, -3.25] }
    const footprint = terrainFootprint(field)
    expect(footprint[0]).toEqual([18, -2.75])
    expect(footprint[2]).toEqual([21, 0.25])
  })

  test('a degenerate field yields an inverted footprint rather than throwing', () => {
    // 1×1 has no cells, so min crosses max. The renderer only punches when there is
    // a grid to punch, and `ShapeGeometry` tolerates it — worth pinning that this
    // returns rather than throws, since it is reachable from a malformed import.
    const footprint = terrainFootprint(createTerrainField({ cols: 1, rows: 1, spacing: 1 }))
    expect(footprint).toHaveLength(4)
    expect(footprint[0]![0]).toBeGreaterThan(footprint[1]![0])
  })
})

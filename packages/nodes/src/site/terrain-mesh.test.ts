import { describe, expect, test } from 'bun:test'
import {
  applyHeightPatch,
  createTerrainField,
  flattenPatch,
  type TerrainField,
} from '@pascal-app/core'
import type { BufferAttribute } from 'three'
import { buildTerrainMesh } from './terrain-geometry'
import {
  applyTerrainPatch,
  createTerrainGeometry,
  disposeTerrainGeometry,
  needsRebuild,
} from './terrain-mesh'

function attr(geometry: { getAttribute: (n: string) => unknown }, name: string): BufferAttribute {
  return geometry.getAttribute(name) as BufferAttribute
}

describe('createTerrainGeometry', () => {
  test('wires all four attributes with the right item sizes', () => {
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const target = createTerrainGeometry(field)
    expect(attr(target.geometry, 'position').itemSize).toBe(3)
    expect(attr(target.geometry, 'normal').itemSize).toBe(3)
    expect(attr(target.geometry, 'uv').itemSize).toBe(2)
    expect(target.geometry.getIndex()).not.toBeNull()
    expect(target.geometry.getIndex()?.count).toBe(8 * 8 * 6)
    disposeTerrainGeometry(target)
  })

  test('the attributes are backed by the same arrays as the CPU buffers', () => {
    // The dirty-rect path mutates `buffers` in place and expects the GPU-side
    // attribute to see it. If these ever diverge, patches would silently no-op.
    const target = createTerrainGeometry(createTerrainField({ cols: 5, rows: 5, spacing: 1 }))
    expect(attr(target.geometry, 'position').array).toBe(target.buffers.positions)
    expect(attr(target.geometry, 'normal').array).toBe(target.buffers.normals)
    disposeTerrainGeometry(target)
  })

  test('bounds cover the field extent without calling computeBoundingSphere', () => {
    const field: TerrainField = {
      ...createTerrainField({ cols: 5, rows: 5, spacing: 2 }),
      origin: [10, 20],
    }
    const target = createTerrainGeometry(field)
    // Field spans x 10..18, z 20..28 -> centre (14, 0, 24).
    expect(target.geometry.boundingSphere?.center.x).toBeCloseTo(14, 6)
    expect(target.geometry.boundingSphere?.center.z).toBeCloseTo(24, 6)
    expect(target.geometry.boundingSphere?.radius).toBeCloseTo(Math.hypot(4, 0, 4), 6)
    disposeTerrainGeometry(target)
  })

  test('bounds include the height range of a sculpted field', () => {
    const base = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const raised = applyHeightPatch(
      base,
      flattenPatch(base, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, 6) as never,
    )
    const target = createTerrainGeometry(raised)
    const sphere = target.geometry.boundingSphere
    expect(sphere?.center.y).toBeCloseTo(3, 5)
    // Radius must reach the top of the raised pad.
    expect((sphere?.center.y ?? 0) + (sphere?.radius ?? 0)).toBeGreaterThanOrEqual(6)
    disposeTerrainGeometry(target)
  })
})

describe('applyTerrainPatch', () => {
  test('marks position and normal for upload, and nothing else', () => {
    const before = createTerrainField({ cols: 17, rows: 17, spacing: 0.5 })
    const patch = flattenPatch(before, { minX: 2, minZ: 2, maxX: 4, maxZ: 4 }, 1)
    const after = applyHeightPatch(before, patch as never)

    const target = createTerrainGeometry(before)
    // `needsUpdate` is a setter-only property in three — reading it yields
    // undefined. `version` is the observable it increments, so that is what a
    // test can assert on.
    const uvVersion = attr(target.geometry, 'uv').version
    applyTerrainPatch(target, after, patch as never)

    expect(attr(target.geometry, 'position').version).toBeGreaterThan(0)
    expect(attr(target.geometry, 'normal').version).toBeGreaterThan(0)
    // UVs are a function of grid indices, never heights.
    expect(attr(target.geometry, 'uv').version).toBe(uvVersion)
    disposeTerrainGeometry(target)
  })

  test('uploads a partial range, not the whole buffer', () => {
    const before = createTerrainField({ cols: 33, rows: 33, spacing: 0.5 })
    const patch = flattenPatch(before, { minX: 4, minZ: 4, maxX: 5, maxZ: 5 }, 2)
    const after = applyHeightPatch(before, patch as never)

    const target = createTerrainGeometry(before)
    applyTerrainPatch(target, after, patch as never)

    const position = attr(target.geometry, 'position')
    const ranges = position.updateRanges
    expect(ranges).toHaveLength(1)
    // The whole buffer is 33*33*3 elements; a 2x2 patch must be far smaller.
    expect(ranges[0]?.count).toBeLessThan(33 * 33 * 3)
    expect(ranges[0]?.count).toBeGreaterThan(0)
    disposeTerrainGeometry(target)
  })

  test('does not accumulate ranges across a stroke of many dabs', () => {
    // The failure this guards: 60 dabs/second each appending a range would make
    // every subsequent frame re-upload all of them.
    let field = createTerrainField({ cols: 33, rows: 33, spacing: 0.5 })
    const target = createTerrainGeometry(field)
    for (let i = 0; i < 12; i++) {
      const patch = flattenPatch(field, { minX: i, minZ: 2, maxX: i + 1, maxZ: 3 }, i * 0.1)
      if (!patch) continue
      field = applyHeightPatch(field, patch)
      applyTerrainPatch(target, field, patch)
    }
    expect(attr(target.geometry, 'position').updateRanges).toHaveLength(1)
    disposeTerrainGeometry(target)
  })

  test('the patched buffers match a full rebuild', () => {
    const before = createTerrainField({ cols: 17, rows: 17, spacing: 0.5 })
    const patch = flattenPatch(before, { minX: 2, minZ: 2, maxX: 6, maxZ: 6 }, 1.25)
    const after = applyHeightPatch(before, patch as never)

    const target = createTerrainGeometry(before)
    applyTerrainPatch(target, after, patch as never)
    const full = buildTerrainMesh(after)

    expect(Array.from(target.buffers.positions)).toEqual(Array.from(full.positions))
    disposeTerrainGeometry(target)
  })

  test('refreshes the bounding sphere so a raised hill is not culled', () => {
    const before = createTerrainField({ cols: 17, rows: 17, spacing: 0.5 })
    const target = createTerrainGeometry(before)
    const radiusBefore = target.geometry.boundingSphere?.radius ?? 0

    const patch = flattenPatch(before, { minX: 2, minZ: 2, maxX: 4, maxZ: 4 }, 20)
    const after = applyHeightPatch(before, patch as never)
    applyTerrainPatch(target, after, patch as never)

    expect(target.geometry.boundingSphere?.radius ?? 0).toBeGreaterThan(radiusBefore)
    disposeTerrainGeometry(target)
  })

  test('a patch entirely outside the field is a no-op, not a crash', () => {
    const field = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
    const target = createTerrainGeometry(field)
    const version = attr(target.geometry, 'position').version
    applyTerrainPatch(target, field, {
      col0: 0,
      row0: 500,
      cols: 2,
      rows: 2,
      heights: new Int16Array(4),
    })
    expect(attr(target.geometry, 'position').version).toBe(version)
    expect(attr(target.geometry, 'position').updateRanges).toHaveLength(0)
    disposeTerrainGeometry(target)
  })
})

describe('needsRebuild', () => {
  test('false for the field it was built from', () => {
    const field = createTerrainField({ cols: 17, rows: 17, spacing: 0.5 })
    const target = createTerrainGeometry(field)
    expect(needsRebuild(target, field)).toBe(false)
    // A height change never needs a rebuild — that is the whole point.
    const patch = flattenPatch(field, { minX: 1, minZ: 1, maxX: 3, maxZ: 3 }, 2)
    expect(needsRebuild(target, applyHeightPatch(field, patch as never))).toBe(false)
    disposeTerrainGeometry(target)
  })

  test('true when the field was resized', () => {
    const target = createTerrainGeometry(createTerrainField({ cols: 17, rows: 17 }))
    expect(needsRebuild(target, createTerrainField({ cols: 33, rows: 33 }))).toBe(true)
    disposeTerrainGeometry(target)
  })
})

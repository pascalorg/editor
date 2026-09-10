import { describe, expect, test } from 'bun:test'
import {
  applyHeightPatch,
  createTerrainField,
  flattenPatch,
  type HeightPatch,
  type TerrainField,
} from '@pascal-app/core'
import type { BufferAttribute, BufferGeometry } from 'three'
import { buildTerrainMesh, buildTerrainSkirt } from './terrain-geometry'
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

describe('applyTerrainPatch — conservative bounds and locality', () => {
  function expectEnclosed(geometry: BufferGeometry, positions: Float32Array): void {
    const sphere = geometry.boundingSphere
    expect(sphere).not.toBeNull()
    expect(Number.isFinite(sphere!.radius)).toBe(true)
    for (let i = 0; i < positions.length; i += 3) {
      const distance = Math.hypot(
        positions[i]! - sphere!.center.x,
        positions[i + 1]! - sphere!.center.y,
        positions[i + 2]! - sphere!.center.z,
      )
      // All fixtures stay below 400 m: 0.1 mm covers Float32 vertex rounding,
      // not a stale bound. Tightness is deliberately not an acceptance criterion.
      expect(distance).toBeLessThanOrEqual(sphere!.radius + 0.0001)
    }
  }

  test.each([
    -1200, 900,
  ])('surface and skirt stay enclosed through new and removed extremes (initial height %i)', (initialHeight) => {
    let field: TerrainField = {
      ...createTerrainField({ cols: 9, rows: 7, origin: [-3.17, 2.29], spacing: 0.3 }),
      heights: new Int16Array(9 * 7).fill(initialHeight),
    }
    const target = createTerrainGeometry(field)
    const surfaceReferences = { ...target.buffers }
    const skirtReferences = { ...target.skirt.buffers }
    const positionAttribute = attr(target.geometry, 'position')
    const normalAttribute = attr(target.geometry, 'normal')
    try {
      expectEnclosed(target.geometry, target.buffers.positions)
      expectEnclosed(target.skirt.geometry, target.skirt.buffers.positions)
      for (const [col0, row0, height] of [
        [4, 3, 32767],
        [8, 6, -32768],
        [4, 3, 0],
        [8, 6, 0],
        [0, 0, 31000],
        [0, 0, 0],
        [8, 0, -32000],
        [8, 0, 0],
      ] as const) {
        const patch: HeightPatch = {
          col0,
          row0,
          cols: 1,
          rows: 1,
          heights: new Int16Array([height]),
        }
        const previous = field
        const previousHeights = field.heights.slice()
        field = applyHeightPatch(field, patch)
        const expectedHeights = field.heights.slice()
        applyTerrainPatch(target, field, patch)

        const surface = buildTerrainMesh(field)
        const skirt = buildTerrainSkirt(field)
        expect(target.buffers.positions).toEqual(surface.positions)
        for (let i = 0; i < surface.normals.length; i++) {
          expect(target.buffers.normals[i]).toBeCloseTo(surface.normals[i]!, 6)
        }
        expect(target.skirt.buffers.positions).toEqual(skirt.positions)
        expectEnclosed(target.geometry, surface.positions)
        expectEnclosed(target.skirt.geometry, skirt.positions)
        expect(previous.heights).toEqual(previousHeights)
        expect(field.heights).toEqual(expectedHeights)
        expect(field.heights).not.toBe(previous.heights)
        for (const name of ['positions', 'normals', 'uvs', 'indices'] as const) {
          expect(target.buffers[name]).toBe(surfaceReferences[name])
        }
        for (const name of ['positions', 'normals', 'indices'] as const) {
          expect(target.skirt.buffers[name]).toBe(skirtReferences[name])
        }
        expect(attr(target.geometry, 'position')).toBe(positionAttribute)
        expect(attr(target.geometry, 'normal')).toBe(normalAttribute)
      }
    } finally {
      disposeTerrainGeometry(target)
    }
  })

  test.each([
    ['top-left', -1, -1],
    ['bottom-right', 7, 5],
  ] as const)('clipped %s patches preserve the surface, skirt, and safe bounds', (_name, col0, row0) => {
    const before = createTerrainField({ cols: 9, rows: 7, origin: [-3.17, 2.29], spacing: 0.3 })
    const patch: HeightPatch = {
      col0,
      row0,
      cols: 3,
      rows: 3,
      heights: Int16Array.from({ length: 9 }, (_, i) => (i % 2 ? -32768 : 32767)),
    }
    const after = applyHeightPatch(before, patch)
    const target = createTerrainGeometry(before)
    try {
      applyTerrainPatch(target, after, patch)
      const surface = buildTerrainMesh(after)
      const skirt = buildTerrainSkirt(after)
      expect(target.buffers.positions).toEqual(surface.positions)
      for (let i = 0; i < surface.normals.length; i++) {
        expect(target.buffers.normals[i]).toBeCloseTo(surface.normals[i]!, 6)
      }
      expect(target.skirt.buffers.positions).toEqual(skirt.positions)
      expectEnclosed(target.geometry, surface.positions)
      expectEnclosed(target.skirt.geometry, skirt.positions)
    } finally {
      disposeTerrainGeometry(target)
    }
  })

  test.each([65, 257])('a tiny interior patch does not scan a %i-square heightfield', (size) => {
    const before = createTerrainField({ cols: size, rows: size, spacing: 0.5 })
    const center = Math.floor(size / 2)
    const patch: HeightPatch = {
      col0: center,
      row0: center,
      cols: 1,
      rows: 1,
      heights: new Int16Array([-3000]),
    }
    const after = applyHeightPatch(before, patch)
    const target = createTerrainGeometry(before)
    const visited = new Set<number>()
    // Observe accesses, not elapsed time. Native bulk reads count the entire view;
    // subarray narrows that view. Geometry creation and immutable copying are excluded.
    function observe(samples: Int16Array, offset = 0): Int16Array {
      return new Proxy(samples, {
        get(array, key) {
          if (typeof key === 'string' && /^\d+$/.test(key)) visited.add(offset + Number(key))
          if (key === 'subarray') {
            return (begin?: number, end?: number) => {
              const view = array.subarray(begin, end)
              return observe(
                view,
                offset + (view.byteOffset - array.byteOffset) / array.BYTES_PER_ELEMENT,
              )
            }
          }
          const value = Reflect.get(array, key, array)
          if (typeof value !== 'function') return value
          return (...args: unknown[]) => {
            for (let i = 0; i < array.length; i++) visited.add(offset + i)
            return Reflect.apply(value, array, args)
          }
        },
      })
    }
    try {
      applyTerrainPatch(target, { ...after, heights: observe(after.heights) }, patch)
      // A generous 9x9 neighborhood allows different local normal stencils and
      // repeated passes, but rejects full rows and full-field extrema scans.
      expect(visited.size).toBeLessThanOrEqual(81)
      for (const i of visited) {
        expect(Math.abs((i % size) - center)).toBeLessThanOrEqual(4)
        expect(Math.abs(Math.floor(i / size) - center)).toBeLessThanOrEqual(4)
      }
      expect(target.buffers.positions).toEqual(buildTerrainMesh(after).positions)
      expectEnclosed(target.geometry, target.buffers.positions)
      expectEnclosed(target.skirt.geometry, target.skirt.buffers.positions)
    } finally {
      disposeTerrainGeometry(target)
    }
  })

  test.each([
    ['left', -2, 3],
    ['right', 9, 3],
    ['above', 3, -2],
    ['below', 3, 9],
    ['diagonally outside', 9, 9],
  ] as const)('a patch wholly %s preserves pending uploads and bounds', (_name, col0, row0) => {
    const before = createTerrainField({ cols: 9, rows: 9 })
    const pending: HeightPatch = {
      col0: 3,
      row0: 3,
      cols: 1,
      rows: 1,
      heights: new Int16Array([1200]),
    }
    const field = applyHeightPatch(before, pending)
    const target = createTerrainGeometry(before)
    try {
      applyTerrainPatch(target, field, pending)
      const geometries = [target.geometry, target.skirt.geometry]
      const snapshot = () =>
        geometries.map((geometry) => ({
          sphere: geometry.boundingSphere!.clone(),
          attributes: Object.entries(geometry.attributes).map(([name]) => {
            const attribute = attr(geometry, name)
            return {
              name,
              version: attribute.version,
              ranges: attribute.updateRanges.map((range) => ({ ...range })),
              values: attribute.array.slice(),
            }
          }),
        }))
      const expected = snapshot()
      applyTerrainPatch(target, field, {
        col0,
        row0,
        cols: 2,
        rows: 2,
        heights: new Int16Array(4).fill(-32000),
      })
      expect(snapshot()).toEqual(expected)
    } finally {
      disposeTerrainGeometry(target)
    }
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

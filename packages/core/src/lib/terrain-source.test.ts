import { describe, expect, test } from 'bun:test'
import { encodeTerrainField } from './terrain-codec'
import { applyHeightPatch, createTerrainField, flattenPatch, heightAt } from './terrain-field'
import { commitTerrainField, terrainFieldForEdit, terrainFieldOf } from './terrain-source'

function sculptedField() {
  const base = createTerrainField({ cols: 9, rows: 9, spacing: 1 })
  const patch = flattenPatch(base, { minX: 2, minZ: 2, maxX: 5, maxZ: 5 }, 2.5)
  return applyHeightPatch(base, patch as never)
}

describe('terrainFieldOf', () => {
  test('null for a site with no terrain — the flat-ground fast path', () => {
    expect(terrainFieldOf(null)).toBeNull()
    expect(terrainFieldOf(undefined)).toBeNull()
    expect(terrainFieldOf({ terrain: undefined })).toBeNull()
  })

  test('decodes a site with terrain', () => {
    const field = sculptedField()
    const site = { terrain: encodeTerrainField(field) }
    const resolved = terrainFieldOf(site)
    expect(resolved).not.toBeNull()
    expect(heightAt(resolved as never, 3, 3)).toBeCloseTo(2.5, 6)
  })

  test('returns the identical field object on repeat reads — decode runs once', () => {
    const site = { terrain: encodeTerrainField(sculptedField()) }
    const a = terrainFieldOf(site)
    const b = terrainFieldOf(site)
    expect(a).toBe(b)
  })

  test('a new terrain object misses the cache — object identity is the version key', () => {
    const first = sculptedField()
    const second = applyHeightPatch(
      first,
      flattenPatch(
        first,
        {
          minX: 2,
          minZ: 2,
          maxX: 5,
          maxZ: 5,
        },
        7,
      ) as never,
    )

    const before = terrainFieldOf({ terrain: encodeTerrainField(first) })
    const after = terrainFieldOf({ terrain: encodeTerrainField(second) })
    expect(heightAt(before as never, 3, 3)).toBeCloseTo(2.5, 6)
    expect(heightAt(after as never, 3, 3)).toBeCloseTo(7, 6)
  })

  test('null for corrupt terrain, and the failed decode is not retried', () => {
    const site = { terrain: { type: 'heightfield', cols: 2, rows: 2, heights: '!!!' } as never }
    expect(terrainFieldOf(site)).toBeNull()
    // Second call takes the WeakSet path; asserting it still returns null is the
    // observable half — that it skipped the decode is the point of the WeakSet.
    expect(terrainFieldOf(site)).toBeNull()
  })
})

describe('terrainFieldForEdit', () => {
  test('returns the existing field when the site has terrain', () => {
    const site = { terrain: encodeTerrainField(sculptedField()) }
    const field = terrainFieldForEdit(site)
    expect(heightAt(field, 3, 3)).toBeCloseTo(2.5, 6)
  })

  test('returns a fresh flat field when the site has none', () => {
    const field = terrainFieldForEdit(null, { cols: 17, rows: 17, spacing: 0.25 })
    expect(field.cols).toBe(17)
    expect(field.spacing).toBe(0.25)
    expect(heightAt(field, 1, 1)).toBe(0)
  })

  test('does not fabricate terrain on the site — the caller decides to persist', () => {
    const site: { terrain?: never } = {}
    terrainFieldForEdit(site)
    expect(site.terrain).toBeUndefined()
  })
})

describe('commitTerrainField', () => {
  test('the encoded data reads back as the same field, without decoding', () => {
    const field = sculptedField()
    const data = commitTerrainField(field)
    // Cache primed: the very next read is the identical object, so a stroke never
    // pays for base64 at all.
    expect(terrainFieldOf({ terrain: data })).toBe(field)
  })

  test('the encoded data is still independently decodable', () => {
    const field = sculptedField()
    const data = commitTerrainField(field)
    // Priming must not be load-bearing: a fresh process (no cache) must get the
    // same heights back from the bytes alone.
    const roundTripped = JSON.parse(JSON.stringify(data))
    const decoded = terrainFieldOf({ terrain: roundTripped })
    expect(decoded).not.toBe(field)
    expect(Array.from(decoded?.heights ?? [])).toEqual(Array.from(field.heights))
  })
})

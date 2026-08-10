import { describe, expect, test } from 'bun:test'
import type { TerrainData } from '../schema/terrain'
import {
  decodeHeightPatch,
  decodeTerrainField,
  encodeHeightPatch,
  encodeTerrainField,
  isDatumField,
} from './terrain-codec'
import { createTerrainField, heightAt, type TerrainField } from './terrain-field'

function fieldWith(values: number[], cols: number, rows: number): TerrainField {
  const field = createTerrainField({ cols, rows, spacing: 1, step: 0.01 })
  return { ...field, heights: Int16Array.from(values) }
}

describe('encodeTerrainField / decodeTerrainField', () => {
  test('round-trips every sample exactly', () => {
    const source = fieldWith([0, 1, -1, 250, -250, 32767, -32768, 7, 8], 3, 3)
    const decoded = decodeTerrainField(encodeTerrainField(source))
    expect(decoded).not.toBeNull()
    expect(Array.from(decoded?.heights ?? [])).toEqual(Array.from(source.heights))
  })

  test('round-trips the field metadata', () => {
    const source: TerrainField = {
      ...createTerrainField({ cols: 5, rows: 4, spacing: 0.25, step: 0.005 }),
      origin: [-12.5, 33.25],
    }
    const decoded = decodeTerrainField(encodeTerrainField(source))
    expect(decoded?.origin).toEqual([-12.5, 33.25])
    expect(decoded?.spacing).toBe(0.25)
    expect(decoded?.step).toBe(0.005)
    expect(decoded?.cols).toBe(5)
    expect(decoded?.rows).toBe(4)
  })

  test('a decoded field reads the same heights as the original', () => {
    const cols = 9
    const rows = 9
    const heights = new Int16Array(cols * rows)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        heights[r * cols + c] = Math.round(Math.sin(c * 0.4) * 120 + r * 13)
      }
    }
    const source: TerrainField = {
      ...createTerrainField({ cols, rows, spacing: 0.5, step: 0.01 }),
      heights,
    }
    const decoded = decodeTerrainField(encodeTerrainField(source))
    expect(decoded).not.toBeNull()
    // Sampling, not just bytes: the point of the codec is that the read
    // authority behaves identically after a save/load cycle.
    for (let x = 0; x < 4; x += 0.37) {
      for (let z = 0; z < 4; z += 0.41) {
        expect(heightAt(decoded as TerrainField, x, z)).toBeCloseTo(heightAt(source, x, z), 9)
      }
    }
  })

  test('is JSON-safe — survives stringify/parse', () => {
    const source = fieldWith([5, -5, 300, -300], 2, 2)
    const wire = JSON.parse(JSON.stringify(encodeTerrainField(source)))
    const decoded = decodeTerrainField(wire)
    expect(Array.from(decoded?.heights ?? [])).toEqual([5, -5, 300, -300])
  })

  test('encodes byte-identically regardless of the source buffer offset', () => {
    // An Int16Array view into a larger buffer must encode the same as a standalone
    // one — `heights.buffer` would be the whole parent buffer, which is the classic
    // typed-array footgun.
    const parent = new Int16Array(10)
    parent.set([11, 22, 33, 44], 6)
    const view = parent.subarray(6, 10)
    const a = encodeTerrainField({ ...fieldWith([11, 22, 33, 44], 2, 2), heights: view })
    const b = encodeTerrainField(fieldWith([11, 22, 33, 44], 2, 2))
    expect(a.heights).toBe(b.heights)
  })

  test('beats a naive JSON array on realistic terrain', () => {
    // Base64 is a fixed 2.67 chars/sample. A JSON number array is variable: an
    // all-zero field costs 2 chars/sample and *wins*, which is exactly why an
    // untouched field is never persisted at all (`isDatumField`). Real terrain
    // has multi-digit signed heights, and that is where the fixed cost pays.
    const cols = 65
    const rows = 65
    const heights = new Int16Array(cols * rows)
    for (let i = 0; i < heights.length; i++) {
      heights[i] = Math.round(Math.sin(i * 0.11) * 1800)
    }
    const field: TerrainField = { ...createTerrainField({ cols, rows }), heights }
    const encoded = encodeTerrainField(field)
    const naive = JSON.stringify(Array.from(field.heights)).length
    expect(encoded.heights.length).toBeLessThan(naive)
    // And the absolute size is documented, since it lands in every saved scene:
    // 65² samples at 2 bytes → 11 268 base64 chars, ~11 KB.
    expect(encoded.heights.length).toBe(11_268)
  })
})

describe('encodeHeightPatch / decodeHeightPatch', () => {
  test('round-trips a bounded patch without expanding samples into JSON numbers', () => {
    const patch = {
      col0: 3,
      row0: 5,
      cols: 2,
      rows: 2,
      heights: Int16Array.from([0, 32767, -32768, 42]),
    }

    const encoded = encodeHeightPatch(patch)
    const decoded = decodeHeightPatch(JSON.parse(JSON.stringify(encoded)))

    expect(encoded.heights).toBe('AAD/fwCAKgA=')
    expect(decoded && { ...decoded, heights: Array.from(decoded.heights) }).toEqual({
      ...patch,
      heights: [0, 32767, -32768, 42],
    })
  })

  test('rejects invalid bounds, dimensions, and sample payloads', () => {
    const encoded = encodeHeightPatch({
      col0: 0,
      row0: 0,
      cols: 2,
      rows: 2,
      heights: Int16Array.from([1, 2, 3, 4]),
    })

    expect(decodeHeightPatch({ ...encoded, col0: -1 })).toBeNull()
    expect(decodeHeightPatch({ ...encoded, cols: 258 })).toBeNull()
    expect(decodeHeightPatch({ ...encoded, rows: 0 })).toBeNull()
    expect(decodeHeightPatch({ ...encoded, heights: encoded.heights.slice(0, -4) })).toBeNull()
    expect(decodeHeightPatch({ ...encoded, heights: `${encoded.heights}AAAA` })).toBeNull()
  })
})

describe('decodeTerrainField — hostile and corrupt input', () => {
  test('rejects non-objects and wrong discriminators', () => {
    expect(decodeTerrainField(null)).toBeNull()
    expect(decodeTerrainField(undefined)).toBeNull()
    expect(decodeTerrainField('heightfield')).toBeNull()
    expect(decodeTerrainField(42)).toBeNull()
    expect(decodeTerrainField({})).toBeNull()
    expect(decodeTerrainField({ type: 'polygon' })).toBeNull()
  })

  test('rejects non-integer or non-positive dimensions', () => {
    const base = encodeTerrainField(fieldWith([1, 2, 3, 4], 2, 2))
    expect(decodeTerrainField({ ...base, cols: 2.5 })).toBeNull()
    expect(decodeTerrainField({ ...base, cols: 0 })).toBeNull()
    expect(decodeTerrainField({ ...base, rows: -1 })).toBeNull()
    expect(decodeTerrainField({ ...base, cols: Number.NaN })).toBeNull()
  })

  test('rejects dimensions above the authoring ceiling before allocating', () => {
    const base = encodeTerrainField(fieldWith([1], 1, 1))
    expect(decodeTerrainField({ ...base, cols: 258, rows: 1 })).toBeNull()
    expect(decodeTerrainField({ ...base, cols: 1, rows: 258 })).toBeNull()
    expect(decodeTerrainField({ ...base, cols: 100_000, rows: 100_000 })).toBeNull()
  })

  test('rejects non-base64 characters instead of decoding garbage', () => {
    const base = encodeTerrainField(fieldWith([1, 2, 3, 4], 2, 2))
    expect(decodeTerrainField({ ...base, heights: 'not base64!!' })).toBeNull()
    expect(decodeTerrainField({ ...base, heights: '\u{1F600}' })).toBeNull()
  })

  test('rejects a missing heights string', () => {
    const base = encodeTerrainField(fieldWith([1], 1, 1))
    expect(decodeTerrainField({ ...base, heights: undefined })).toBeNull()
    expect(decodeTerrainField({ ...base, heights: [1, 2] })).toBeNull()
  })

  test('rejects truncated and oversized payloads', () => {
    const source = fieldWith([10, 20, 30, 40, 50, 60, 70, 80, 90], 3, 3)
    const encoded = encodeTerrainField(source)
    const truncated: TerrainData = { ...encoded, heights: encoded.heights.slice(0, 8) }
    expect(decodeTerrainField(truncated)).toBeNull()

    const longer = encodeTerrainField(fieldWith([10, 20, 30, 40, 50], 5, 1))
    expect(decodeTerrainField({ ...encoded, heights: longer.heights })).toBeNull()
  })

  test('rejects missing metadata instead of inventing a different field', () => {
    const encoded = encodeTerrainField(fieldWith([1, 2, 3, 4], 2, 2))
    expect(
      decodeTerrainField({ type: 'heightfield', cols: 2, rows: 2, heights: encoded.heights }),
    ).toBeNull()
  })

  test('rejects invalid spacing, step, and origin values', () => {
    const base = encodeTerrainField(fieldWith([1, 2, 3, 4], 2, 2))
    expect(decodeTerrainField({ ...base, spacing: 0 })).toBeNull()
    expect(decodeTerrainField({ ...base, spacing: -1 })).toBeNull()
    expect(decodeTerrainField({ ...base, spacing: Number.POSITIVE_INFINITY })).toBeNull()
    expect(decodeTerrainField({ ...base, step: 0 })).toBeNull()
    expect(decodeTerrainField({ ...base, step: Number.NaN })).toBeNull()
    expect(decodeTerrainField({ ...base, origin: [0, Number.NaN] })).toBeNull()
  })

  test('rejects non-canonical base64 instead of accepting trailing garbage', () => {
    const base = encodeTerrainField(fieldWith([1, 2, 3, 4], 2, 2))
    expect(decodeTerrainField({ ...base, heights: `${base.heights}AAAA` })).toBeNull()
    expect(decodeTerrainField({ ...base, heights: base.heights.replace(/=$/, '') })).toBeNull()
  })
})

describe('isDatumField', () => {
  test('true for a fresh field', () => {
    expect(isDatumField(createTerrainField({ cols: 17, rows: 17 }))).toBe(true)
  })

  test('false as soon as one sample moves', () => {
    const field = createTerrainField({ cols: 5, rows: 5 })
    const heights = new Int16Array(field.heights)
    heights[12] = 1
    expect(isDatumField({ ...field, heights })).toBe(false)
  })

  test('false for a negative sample — a pit is not the datum', () => {
    expect(isDatumField(fieldWith([0, 0, -1, 0], 2, 2))).toBe(false)
  })
})

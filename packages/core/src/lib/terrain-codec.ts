/**
 * The wire format for a `TerrainField`.
 *
 * The scene graph is persisted as JSON (`projects_models.scene_graph`, a jsonb
 * column), so an `Int16Array` cannot be stored directly — `JSON.stringify` turns
 * a typed array into an object with numeric string keys, which round-trips
 * lossily and costs ~7 bytes per sample. This module is the one place the field
 * crosses that boundary.
 *
 * Base64 of little-endian `Int16` was chosen over the alternatives:
 *
 * - **A plain number array** costs 4-6× the bytes and, worse, re-parses into a
 *   `number[]` that every consumer would then have to copy into an `Int16Array`.
 * - **`Array.from(heights)`** has the same problem and silently drops the
 *   quantization invariant: nothing stops a hand-edited scene from putting
 *   `2.5` in the array, and then `isFlatOver`'s integer equality is meaningless.
 * - **Compression** (RLE, deflate) is deliberately *not* here. Imported DEMs are
 *   noisy and compress worst, so a compressed format would fail only on the
 *   messiest scenes — the ones most likely to be real. Chunking (`diffToPatches`)
 *   is the size mitigation, not compression.
 *
 * Byte order is written explicitly via `DataView` rather than relying on
 * `Int16Array`'s platform order. Every realistic platform is little-endian, but
 * the wire format must not depend on that being true of the machine that saved
 * the scene.
 */

import { MAX_TERRAIN_SIDE, type TerrainData } from '../schema/terrain'
import type { HeightPatch, TerrainField } from './terrain-field'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function encodeBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1] ?? 0
    const b2 = bytes[i + 2] ?? 0
    const remaining = bytes.length - i
    out += BASE64_ALPHABET[b0 >> 2]
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]
    out += remaining > 1 ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '='
    out += remaining > 2 ? BASE64_ALPHABET[b2 & 0x3f] : '='
  }
  return out
}

function decodeBase64(text: string): Uint8Array | null {
  // Reverse lookup is built per call rather than at module scope: decode runs
  // once per scene load, and a 64-entry loop is cheaper than the indirection
  // of a module-level Map for a hot path that isn't hot.
  const lookup = new Int8Array(128).fill(-1)
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    lookup[BASE64_ALPHABET.charCodeAt(i)] = i
  }

  let clean = ''
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code === 61 /* = */) break
    if (code > 127 || lookup[code] === -1) return null
    clean += text[i]
  }
  if (clean.length % 4 === 1) return null

  const byteLength = Math.floor((clean.length * 3) / 4)
  const bytes = new Uint8Array(byteLength)
  let out = 0
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookup[clean.charCodeAt(i)] ?? 0
    const c1 = lookup[clean.charCodeAt(i + 1)] ?? 0
    const c2 = i + 2 < clean.length ? (lookup[clean.charCodeAt(i + 2)] ?? 0) : 0
    const c3 = i + 3 < clean.length ? (lookup[clean.charCodeAt(i + 3)] ?? 0) : 0
    if (out < byteLength) bytes[out++] = (c0 << 2) | (c1 >> 4)
    if (out < byteLength) bytes[out++] = ((c1 & 0x0f) << 4) | (c2 >> 2)
    if (out < byteLength) bytes[out++] = ((c2 & 0x03) << 6) | c3
  }
  return bytes
}

function encodeInt16Samples(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(i * 2, samples[i] ?? 0, true)
  }
  return encodeBase64(bytes)
}

function decodeInt16Samples(text: string, sampleCount: number): Int16Array | null {
  const bytes = decodeBase64(text)
  if (!bytes || encodeBase64(bytes) !== text || bytes.byteLength !== sampleCount * 2) return null

  const samples = new Int16Array(sampleCount)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true)
  }
  return samples
}

export type EncodedHeightPatch = Omit<HeightPatch, 'heights'> & { heights: string }

export function encodeHeightPatch(patch: HeightPatch): EncodedHeightPatch {
  return { ...patch, heights: encodeInt16Samples(patch.heights) }
}

export function decodeHeightPatch(value: unknown): HeightPatch | null {
  if (!value || typeof value !== 'object') return null
  const patch = value as Partial<EncodedHeightPatch>
  if (
    !Number.isInteger(patch.col0) ||
    !Number.isInteger(patch.row0) ||
    !Number.isInteger(patch.cols) ||
    !Number.isInteger(patch.rows)
  ) {
    return null
  }
  const col0 = patch.col0 as number
  const row0 = patch.row0 as number
  const cols = patch.cols as number
  const rows = patch.rows as number
  if (
    col0 < 0 ||
    row0 < 0 ||
    cols < 1 ||
    rows < 1 ||
    col0 + cols > MAX_TERRAIN_SIDE ||
    row0 + rows > MAX_TERRAIN_SIDE ||
    typeof patch.heights !== 'string'
  ) {
    return null
  }
  const heights = decodeInt16Samples(patch.heights, cols * rows)
  return heights ? { col0, row0, cols, rows, heights } : null
}

export function encodeTerrainField(field: TerrainField): TerrainData {
  return {
    type: 'heightfield',
    origin: [field.origin[0], field.origin[1]],
    spacing: field.spacing,
    cols: field.cols,
    rows: field.rows,
    step: field.step,
    heights: encodeInt16Samples(field.heights),
  }
}

/**
 * Rebuild a field from persisted data, or `null` if the data is unusable.
 *
 * Returns `null` rather than throwing, and rather than repairing: a scene whose
 * terrain fails to decode must still load (with flat ground) instead of taking
 * the whole project down, and silently substituting a *different* terrain would
 * be worse than showing none. The caller treats `null` as "this site has no
 * terrain".
 *
 * Metadata and payload length are strict. Repairing a truncated payload or
 * inventing missing metadata would silently substitute a different surface.
 */
export function decodeTerrainField(data: unknown): TerrainField | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Partial<TerrainData>
  if (d.type !== 'heightfield') return null
  if (!Number.isInteger(d.cols) || !Number.isInteger(d.rows)) return null
  const cols = d.cols as number
  const rows = d.rows as number
  if (cols < 1 || rows < 1) return null
  if (cols > MAX_TERRAIN_SIDE || rows > MAX_TERRAIN_SIDE) return null
  if (typeof d.heights !== 'string') return null
  if (!Number.isFinite(d.spacing) || (d.spacing as number) <= 0) return null
  if (!Number.isFinite(d.step) || (d.step as number) <= 0) return null
  if (
    !Array.isArray(d.origin) ||
    d.origin.length !== 2 ||
    !Number.isFinite(d.origin[0]) ||
    !Number.isFinite(d.origin[1])
  ) {
    return null
  }

  const heights = decodeInt16Samples(d.heights, cols * rows)
  if (!heights) return null

  return {
    origin: [d.origin[0] as number, d.origin[1] as number],
    spacing: d.spacing as number,
    cols,
    rows,
    step: d.step as number,
    heights,
  }
}

/**
 * True when every sample is at the datum — the test for "this field is not worth
 * persisting".
 *
 * Called before writing to the node so an untouched site keeps `terrain:
 * undefined` instead of carrying ~11 KB of base64 zeroes in every saved scene.
 */
export function isDatumField(field: TerrainField): boolean {
  for (let i = 0; i < field.heights.length; i++) {
    if (field.heights[i] !== 0) return false
  }
  return true
}

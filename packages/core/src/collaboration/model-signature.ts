import type { SceneSnapshot } from '../store/history-control'

/**
 * A deterministic, key-order-independent hash of a scene model, shared by the
 * collaboration client and route so the two sides can agree on whether the
 * merged result the server computed is the one the client already has.
 *
 * `JSON.stringify` cannot serve here: the client's store writes node keys in
 * one insertion order, the server re-parses the merged graph through zod
 * (`apiGraphSchema`), and both round-trip through JSON — any of which reorders
 * object keys. Two graphs that are byte-identical apart from key order would
 * hash to different strings, so the server would keep sending the full graph
 * for every gesture. Sorting keys makes the signature depend on content alone.
 */

/**
 * Deterministic serialization: object keys sorted, arrays in order, primitives
 * via `JSON.stringify` so numbers and string escaping match a normal JSON round
 * trip on both sides. Not valid JSON — the sorted order is the point.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  switch (typeof value) {
    case 'boolean':
    case 'number':
    case 'string':
      return JSON.stringify(value)
    case 'object': {
      const record = value as Record<string, unknown>
      const keys = Object.keys(record).sort()
      return `{${keys
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(',')}}`
    }
    default:
      // undefined / function / symbol: a scene graph never carries these, but
      // serialize each distinctly so a difference surfaces rather than
      // collapsing into an omitted key and producing a false match.
      return `"<${typeof value}>"`
  }
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

/**
 * SHA-256 in pure JS. Node's `crypto` and the browser's `crypto.subtle` are
 * both absent on one side or the other, and this function has to produce the
 * same bytes in both processes, so it cannot lean on either.
 */
export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message)
  const padding = (64 - ((bytes.length + 8 + 1) % 64)) % 64
  const buffer = new Uint8Array(bytes.length + 1 + padding + 8)
  buffer.set(bytes)
  buffer[bytes.length] = 0x80
  const view = new DataView(buffer.buffer)
  const bitLength = BigInt(bytes.length) * 8n
  view.setUint32(buffer.length - 8, Number(bitLength >> 32n), false)
  view.setUint32(buffer.length - 4, Number(bitLength & 0xffffffffn), false)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19

  const w = new Uint32Array(64)
  for (let offset = 0; offset < buffer.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15]!
      const w2 = w[i - 2]!
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, '0')).join('')
}

/**
 * Hash of the *model* — nodes, root order and the four record bags — not the
 * whole scene. Comments are deliberately absent: they are feedback about the
 * model, not an edit to it, and ride a different write path, so they must not
 * make a conflict-free batch look divergent.
 */
export function hashModelSnapshot(snapshot: SceneSnapshot): string {
  return sha256Hex(
    canonicalJson({
      nodes: snapshot.nodes,
      rootNodeIds: snapshot.rootNodeIds,
      collections: snapshot.collections,
      savedViews: snapshot.savedViews,
      definitions: snapshot.definitions,
      materials: snapshot.materials,
      installedPlugins: snapshot.installedPlugins,
    }),
  )
}

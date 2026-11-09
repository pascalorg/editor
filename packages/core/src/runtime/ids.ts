import type { IdAllocator } from '../schema/base'

export { type IdAllocator, withIdAllocator } from '../schema/base'

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** SHA-256 of `text` (UTF-8), synchronously: ids are minted inside synchronous store writes. */
export function sha256(text: string): Uint8Array {
  const data = new TextEncoder().encode(text)
  const length = Math.ceil((data.length + 9) / 64) * 64
  const bytes = new Uint8Array(length)
  bytes.set(data)
  bytes[data.length] = 0x80
  const view = new DataView(bytes.buffer)
  view.setUint32(length - 8, Math.floor((data.length * 8) / 2 ** 32))
  view.setUint32(length - 4, (data.length * 8) >>> 0)
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!
      const b = w[i - 2]!
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash as unknown as number[]
    for (let i = 0; i < 64; i++) {
      const t1 =
        (h! +
          (rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25)) +
          ((e! & f!) ^ (~e! & g!)) +
          K[i]! +
          w[i]!) >>>
        0
      const t2 =
        ((rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0
      h = g
      g = f
      f = e
      e = (d! + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    const next = [a, b, c, d, e, f, g, h]
    for (let i = 0; i < 8; i++) hash[i] = (hash[i]! + next[i]!) >>> 0
  }
  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, hash[i]!)
  return out
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Deterministic ids for one effect: the n-th id it asks for is `prefix_` and 16 base-36
 * characters of SHA-256(`effectId:n`), the shape random ids have. Recomputing the same effect from
 * the same scene allocates the same ids, so a retried commit is idempotent.
 */
export function effectIds(effectId: string): IdAllocator {
  let counter = 0
  return (prefix) => {
    const digest = sha256(`${effectId}:${counter++}`)
    let suffix = ''
    for (let i = 0; i < 16; i++) suffix += ALPHABET[digest[i]! % ALPHABET.length]
    return `${prefix}_${suffix}`
  }
}

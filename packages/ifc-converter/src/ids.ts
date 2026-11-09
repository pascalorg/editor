// Node ids are drawn from a sequence seeded by the IFC bytes, not from a random
// source: room detection breaks near-ties by id order, so random ids made the
// same file import differently from run to run.
let seedA = 0
let seedB = 0
let counter = 0

function fnv1a(bytes: Uint8Array, basis: number): number {
  let hash = basis
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function mix(value: number): number {
  let x = value >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return x >>> 0
}

export function seedIds(source: Uint8Array): void {
  seedA = fnv1a(source, 0x811c9dc5)
  seedB = fnv1a(source, 0x9e3779b9)
  counter = 0
}

export function nextId<T extends string>(prefix: T): `${T}_${string}` {
  counter++
  const high = mix(seedA ^ Math.imul(counter, 0x9e3779b1))
  const low = mix(seedB + Math.imul(counter, 0x85ebca6b))
  const body = `${high.toString(36).padStart(7, '0')}${low.toString(36).padStart(7, '0')}`
  return `${prefix}_${body}` as `${T}_${string}`
}

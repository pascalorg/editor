/**
 * The hole's edge noise on the CPU: the same fractal perlin the ground's shader reads
 * (`mx_fractal_noise_float` of three's MaterialX lib, 3 octaves, 3D, the third axis constant), so
 * the pit's walls can be laid along the very contour the ground's mask cuts. Integer hash and
 * gradients as in `MaterialXNoise.js`, in unsigned 32-bit arithmetic.
 */

const SEED = (0xdeadbeef + (3 << 2) + 13) >>> 0

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0
}

function hash(x: number, y: number, z: number): number {
  let a = (SEED + x) >>> 0
  let b = (SEED + y) >>> 0
  let c = (SEED + z) >>> 0
  c = (c ^ b) >>> 0
  c = (c - rotl(b, 14)) >>> 0
  a = (a ^ c) >>> 0
  a = (a - rotl(c, 11)) >>> 0
  b = (b ^ a) >>> 0
  b = (b - rotl(a, 25)) >>> 0
  c = (c ^ b) >>> 0
  c = (c - rotl(b, 16)) >>> 0
  a = (a ^ c) >>> 0
  a = (a - rotl(c, 4)) >>> 0
  b = (b ^ a) >>> 0
  b = (b - rotl(a, 14)) >>> 0
  c = (c ^ b) >>> 0
  c = (c - rotl(b, 24)) >>> 0
  return c
}

function gradient(h: number, x: number, y: number, z: number): number {
  const g = h & 15
  const u = g < 8 ? x : y
  const v = g < 4 ? y : g === 12 || g === 14 ? x : z
  return (g & 1 ? -u : u) + (g & 2 ? -v : v)
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

/** Three's `mx_perlin_noise_float` at a 3D point. */
export function perlin3(px: number, py: number, pz: number): number {
  const X = Math.floor(px)
  const Y = Math.floor(py)
  const Z = Math.floor(pz)
  const fx = px - X
  const fy = py - Y
  const fz = pz - Z
  const gx = fx - 1
  const gy = fy - 1
  const gz = fz - 1
  const u = fade(fx)
  const v = fade(fy)
  const w = fade(fz)
  const s1 = 1 - u
  const t1 = 1 - v
  const r1 = 1 - w
  const lowZ =
    t1 * (gradient(hash(X, Y, Z), fx, fy, fz) * s1 + gradient(hash(X + 1, Y, Z), gx, fy, fz) * u) +
    v *
      (gradient(hash(X, Y + 1, Z), fx, gy, fz) * s1 +
        gradient(hash(X + 1, Y + 1, Z), gx, gy, fz) * u)
  const highZ =
    t1 *
      (gradient(hash(X, Y, Z + 1), fx, fy, gz) * s1 +
        gradient(hash(X + 1, Y, Z + 1), gx, fy, gz) * u) +
    v *
      (gradient(hash(X, Y + 1, Z + 1), fx, gy, gz) * s1 +
        gradient(hash(X + 1, Y + 1, Z + 1), gx, gy, gz) * u)
  return 0.982 * (r1 * lowZ + w * highZ)
}

/** Three's `mx_fractal_noise_float` (octaves summed, each `diminish` weaker and `lacunarity` finer). */
export function fractalNoise3(
  px: number,
  py: number,
  pz: number,
  octaves: number,
  lacunarity: number,
  diminish: number,
): number {
  let sum = 0
  let amplitude = 1
  for (let i = 0; i < octaves; i += 1) {
    sum += amplitude * perlin3(px, py, pz)
    amplitude *= diminish
    px *= lacunarity
    py *= lacunarity
    pz *= lacunarity
  }
  return sum
}

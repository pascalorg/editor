/**
 * Foliage as plain geometry, shared by every form that is a leafy mass on a body (the hedge
 * first): a writer of position, normal and colour arrays, smooth normals of a grid, a palette
 * from one leaf colour, and a leaf as a kite of two triangles. Only `+ − × ÷` and `Math.sqrt`:
 * the same numbers in, the same bytes out, on every engine. No texture, so no UV.
 */

import { linearColor, type Rgb } from '@pascal-app/core'

export { linearColor, type Rgb }

const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** How wide a leaf is against its length. */
export const LEAF_ASPECT = 0.6

/** Smooth outward normals of a rows x columns grid of points; a ring's last row joins its first. */
export function gridNormals(points: Float64Array, rows: number, columns: number, ring: boolean) {
  const normals = new Float64Array(points.length)
  const cellRows = ring ? rows : rows - 1
  for (let i = 0; i < cellRows; i++)
    for (let j = 0; j < columns - 1; j++) {
      const a = (i * columns + j) * 3
      const b = a + 3
      const d = (((i + 1) % rows) * columns + j) * 3
      const c = d + 3
      for (const [p, q, r] of [
        [a, b, c],
        [a, c, d],
      ] as const) {
        const [ux, uy, uz] = [
          (points[q] as number) - (points[p] as number),
          (points[q + 1] as number) - (points[p + 1] as number),
          (points[q + 2] as number) - (points[p + 2] as number),
        ]
        const [vx, vy, vz] = [
          (points[r] as number) - (points[p] as number),
          (points[r + 1] as number) - (points[p + 1] as number),
          (points[r + 2] as number) - (points[p + 2] as number),
        ]
        const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
        for (const k of [p, q, r]) {
          normals[k] = (normals[k] as number) + nx
          normals[k + 1] = (normals[k + 1] as number) + ny
          normals[k + 2] = (normals[k + 2] as number) + nz
        }
      }
    }
  for (let k = 0; k < normals.length; k += 3) {
    const [x, y, z] = [normals[k] as number, normals[k + 1] as number, normals[k + 2] as number]
    const d = Math.sqrt(x * x + y * y + z * z)
    if (d > 1e-12) {
      normals[k] = x / d
      normals[k + 1] = y / d
      normals[k + 2] = z / d
    } else normals[k + 1] = 1
  }
  return normals
}

/**
 * The tones of a foliage mass from its one leaf colour: `shade` is the body between the leaves,
 * `dark`, `mid` and `light` the leaves themselves. The ratios are those of the 16 Nov sketch's
 * box palette, so a leaf in the light is about three times its mid tone and the body a fifth.
 */
export type FoliagePalette = { shade: Rgb; dark: Rgb; mid: Rgb; light: Rgb }

export function foliagePalette(leafColor: string): FoliagePalette {
  const [r, g, b] = linearColor(leafColor)
  return {
    shade: [r * 0.18, g * 0.165, b * 0.24],
    dark: [r * 0.46, g * 0.46, b * 0.68],
    mid: [r, g, b],
    light: [Math.min(1, r * 3.05), Math.min(1, g * 1.82), Math.min(1, b * 2.2)],
  }
}

/** A leaf tone: 0 dark, 0.5 mid, 1 light, times a shade. */
export function foliageTone(palette: FoliagePalette, t: number, shadeBy: number): Rgb {
  const [low, high, share] =
    t < 0.5 ? [palette.dark, palette.mid, t * 2] : [palette.mid, palette.light, t * 2 - 1]
  return [
    mix(low[0], high[0], share) * shadeBy,
    mix(low[1], high[1], share) * shadeBy,
    mix(low[2], high[2], share) * shadeBy,
  ]
}

export type LeafLook = {
  size: number
  tiltLow: number
  tiltHigh: number
  /** How far a leaf may turn about its own length, as the whole width of the draw. */
  roll: number
  lift: number
  bodyNormal: number
}

/** Typed arrays of one mesh, filled as vertices and triangles are written. */
export type MeshWriter = {
  position: Float32Array
  normal: Float32Array
  color: Float32Array
  index: Uint16Array | Uint32Array
  vertices: number
  indices: number
}

export function writeVertex(
  out: MeshWriter,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  r: number,
  g: number,
  b: number,
): number {
  const at = out.vertices * 3
  out.position[at] = x
  out.position[at + 1] = y
  out.position[at + 2] = z
  out.normal[at] = nx
  out.normal[at + 1] = ny
  out.normal[at + 2] = nz
  out.color[at] = r
  out.color[at + 1] = g
  out.color[at + 2] = b
  return out.vertices++
}

export function writeTriangle(out: MeshWriter, a: number, b: number, c: number) {
  out.index[out.indices++] = a
  out.index[out.indices++] = b
  out.index[out.indices++] = c
}

/**
 * One leaf: a kite from its stalk at `p` along a direction that leans out of the body by a tilt,
 * biased upward, rolled a little about itself. Its front faces away from the body.
 */
export function writeLeaf(
  out: MeshWriter,
  random: () => number,
  look: LeafLook,
  [px, py, pz]: Rgb,
  [nx, ny, nz]: Rgb,
  [cr, cg, cb]: Rgb,
) {
  // A direction in the body's surface, drawn toward the sky.
  let [tx, ty, tz] = [random() - 0.5, random() - 0.5 + 0.7, random() - 0.5]
  const along = tx * nx + ty * ny + tz * nz
  tx -= nx * along
  ty -= ny * along
  tz -= nz * along
  let d = Math.sqrt(tx * tx + ty * ty + tz * tz)
  if (d < 1e-6) {
    // The body's normal points straight up: any level direction serves.
    ;[tx, ty, tz] = [1 - nx * nx, -nx * ny, -nx * nz]
    d = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1
  }
  tx /= d
  ty /= d
  tz /= d
  const u = mix(look.tiltLow, look.tiltHigh, random())
  const [lie, rise] = [(1 - u * u) / (1 + u * u), (2 * u) / (1 + u * u)]
  const [ax, ay, az] = [tx * lie + nx * rise, ty * lie + ny * rise, tz * lie + nz * rise]
  let [wx, wy, wz] = [ay * nz - az * ny, az * nx - ax * nz, ax * ny - ay * nx]
  d = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1
  wx /= d
  wy /= d
  wz /= d
  const [fx, fy, fz] = [ay * wz - az * wy, az * wx - ax * wz, ax * wy - ay * wx]
  const v = (random() - 0.5) * look.roll
  const [flat, roll] = [(1 - v * v) / (1 + v * v), (2 * v) / (1 + v * v)]
  wx = wx * flat + fx * roll
  wy = wy * flat + fy * roll
  wz = wz * flat + fz * roll
  // The leaf's own face, turned to look away from the body.
  let [gx, gy, gz] = [wy * az - wz * ay, wz * ax - wx * az, wx * ay - wy * ax]
  if (gx * nx + gy * ny + gz * nz < 0) {
    ;[wx, wy, wz] = [-wx, -wy, -wz]
    ;[gx, gy, gz] = [-gx, -gy, -gz]
  }
  const length = look.size * (0.7 + 0.6 * random())
  const half = (length * LEAF_ASPECT) / 2
  const lift = look.lift * random()
  const [bx, by, bz] = [px + nx * lift, py + ny * lift, pz + nz * lift]
  const [mx, my, mz] = [bx + (ax * length) / 2, by + (ay * length) / 2, bz + (az * length) / 2]
  let [sx, sy, sz] = [
    mix(gx, nx, look.bodyNormal),
    mix(gy, ny, look.bodyNormal),
    mix(gz, nz, look.bodyNormal),
  ]
  d = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1
  sx /= d
  sy /= d
  sz /= d
  const stalk = writeVertex(out, bx, by, bz, sx, sy, sz, cr * 0.8, cg * 0.8, cb * 0.8)
  const one = writeVertex(
    out,
    mx + wx * half,
    my + wy * half,
    mz + wz * half,
    sx,
    sy,
    sz,
    cr,
    cg,
    cb,
  )
  const tip = writeVertex(
    out,
    bx + ax * length,
    by + ay * length,
    bz + az * length,
    sx,
    sy,
    sz,
    cr * 1.1,
    cg * 1.1,
    cb * 1.1,
  )
  const other = writeVertex(
    out,
    mx - wx * half,
    my - wy * half,
    mz - wz * half,
    sx,
    sy,
    sz,
    cr,
    cg,
    cb,
  )
  writeTriangle(out, stalk, one, tip)
  writeTriangle(out, stalk, tip, other)
}

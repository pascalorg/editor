import { type Aabb, type Obstacle, obstacleDistance } from './obstacles'

export type Grid = {
  x0: number
  z0: number
  h: number
  W: number
  H: number
}

export const cellX = (g: Grid, i: number) => g.x0 + (i + 0.5) * g.h
export const cellZ = (g: Grid, j: number) => g.z0 + (j + 0.5) * g.h
export const cellOf = (g: Grid, x: number, z: number) => {
  const i = Math.floor((x - g.x0) / g.h)
  const j = Math.floor((z - g.z0) / g.h)
  return i < 0 || j < 0 || i >= g.W || j >= g.H ? -1 : j * g.W + i
}

export function makeGrid(domain: Aabb, h: number): Grid {
  return {
    x0: domain[0],
    z0: domain[1],
    h,
    W: Math.max(1, Math.round((domain[2] - domain[0]) / h)),
    H: Math.max(1, Math.round((domain[3] - domain[1]) / h)),
  }
}

/**
 * A uniform bucket index over obstacle boxes. A query widens ring by ring around the point and
 * stops when no farther bucket can hold a nearer obstacle, so the answer is exact.
 */
export class BucketIndex {
  private readonly buckets: Obstacle[][]
  private readonly stamp: Uint32Array
  private pass = 0
  private readonly nx: number
  private readonly nz: number

  constructor(
    obstacles: Obstacle[],
    private readonly domain: Aabb,
    private readonly cell = 0.5,
  ) {
    this.nx = Math.max(1, Math.ceil((domain[2] - domain[0]) / cell))
    this.nz = Math.max(1, Math.ceil((domain[3] - domain[1]) / cell))
    this.buckets = Array.from({ length: this.nx * this.nz }, () => [])
    this.stamp = new Uint32Array(obstacles.length)
    for (const obstacle of obstacles) {
      const [i0, j0, i1, j1] = this.range(obstacle.aabb)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) this.buckets[j * this.nx + i]!.push(obstacle)
    }
  }

  private range(a: Aabb): Aabb {
    const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v))
    const c = this.cell
    return [
      clamp(Math.floor((a[0] - this.domain[0]) / c), this.nx),
      clamp(Math.floor((a[1] - this.domain[1]) / c), this.nz),
      clamp(Math.floor((a[2] - this.domain[0]) / c), this.nx),
      clamp(Math.floor((a[3] - this.domain[1]) / c), this.nz),
    ]
  }

  /** Signed distance to the nearest obstacle (negative inside) and which it is; `skipNode` leaves one node out. */
  query(px: number, pz: number, skipNode?: string): { d: number; arg: number } {
    let best = Number.POSITIVE_INFINITY
    let arg = -1
    const c = this.cell
    const bi = Math.max(0, Math.min(this.nx - 1, Math.floor((px - this.domain[0]) / c)))
    const bj = Math.max(0, Math.min(this.nz - 1, Math.floor((pz - this.domain[1]) / c)))
    const stamp = ++this.pass
    const reach = Math.max(this.nx, this.nz)
    for (let r = 0; r <= reach; r++) {
      for (let j = bj - r; j <= bj + r; j++) {
        if (j < 0 || j >= this.nz) continue
        const edge = j === bj - r || j === bj + r
        for (let i = bi - r; i <= bi + r; i += edge ? 1 : 2 * r || 1) {
          if (i < 0 || i >= this.nx) continue
          for (const obstacle of this.buckets[j * this.nx + i]!) {
            if (this.stamp[obstacle.index] === stamp) continue
            this.stamp[obstacle.index] = stamp
            if (skipNode && obstacle.prism.nodeId === skipNode) continue
            const v = obstacleDistance(obstacle, px, pz)
            if (v < best) {
              best = v
              arg = obstacle.index
            }
          }
        }
      }
      // everything not seen yet lies wholly outside the block of buckets searched
      const bound = Math.min(
        px - (this.domain[0] + (bi - r) * c),
        this.domain[0] + (bi + r + 1) * c - px,
        pz - (this.domain[1] + (bj - r) * c),
        this.domain[1] + (bj + r + 1) * c - pz,
      )
      if (best <= bound) break
    }
    return { d: best, arg }
  }
}

const TILE = 16

function aabbDistance(x0: number, z0: number, x1: number, z1: number, a: Aabb): number {
  return Math.hypot(Math.max(a[0] - x1, x0 - a[2], 0), Math.max(a[1] - z1, z0 - a[3], 0))
}

export type Baked = {
  /** Signed distance to the nearest obstacle at every cell centre (negative inside one). */
  F: Float32Array
  /** The nearest obstacle's index, -1 where there is none. */
  A: Int32Array
}

/**
 * Bakes the clearance field in tiles: a tile tests only the obstacles that can still win in it
 * (those within the tile's reach of the nearest one), which is exact, not an approximation.
 */
export function bakeGrid(g: Grid, obstacles: Obstacle[]): Baked {
  const F = new Float32Array(g.W * g.H).fill(Number.POSITIVE_INFINITY)
  const A = new Int32Array(g.W * g.H).fill(-1)
  if (obstacles.length === 0) return { F, A }
  const TW = Math.ceil(g.W / TILE)
  const TH = Math.ceil(g.H / TILE)
  for (let tj = 0; tj < TH; tj++)
    for (let ti = 0; ti < TW; ti++) {
      const i0 = ti * TILE
      const j0 = tj * TILE
      const i1 = Math.min(g.W, i0 + TILE) - 1
      const j1 = Math.min(g.H, j0 + TILE) - 1
      const x0 = cellX(g, i0)
      const z0 = cellZ(g, j0)
      const x1 = cellX(g, i1)
      const z1 = cellZ(g, j1)
      const mx = (x0 + x1) / 2
      const mz = (z0 + z1) / 2
      const radius = Math.hypot(x1 - x0, z1 - z0) / 2
      let bound = Number.POSITIVE_INFINITY
      for (const o of obstacles) bound = Math.min(bound, obstacleDistance(o, mx, mz))
      bound += radius
      const candidates = obstacles.filter(
        (o) => aabbDistance(x0, z0, x1, z1, o.aabb) <= Math.max(bound, 0),
      )
      for (let j = j0; j <= j1; j++) {
        const pz = cellZ(g, j)
        for (let i = i0; i <= i1; i++) {
          const px = cellX(g, i)
          let best = Number.POSITIVE_INFINITY
          let arg = -1
          for (const o of candidates) {
            const v = obstacleDistance(o, px, pz)
            if (v < best) {
              best = v
              arg = o.index
            }
          }
          F[j * g.W + i] = best
          A[j * g.W + i] = arg
        }
      }
    }
  return { F, A }
}

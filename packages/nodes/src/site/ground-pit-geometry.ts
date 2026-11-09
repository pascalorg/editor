/**
 * The pit's walls: the ground's hole cut open. The hole's edge is a threshold (the signed distance
 * to the footprints against a radius that wanders with noise); this walks that same threshold on
 * a fine grid (marching squares) and stands a wall of unit height (in `PIT_WALL_ROWS` rows) on every piece of the contour,
 * facing into the hole. The wall's lower edge is not stored: each vertex carries a `drop` (0 at
 * the ground, 1 at the bottom) the shader scales by the pit's current depth, so a floor switch
 * moves a uniform and never rebuilds the walls.
 */

export type PitContourSource = {
  /** The grid box to walk: world XZ of its corner and its side. */
  originX: number
  originZ: number
  span: number
  /** Signed distance to the footprints, as the ground's mask reads it. */
  distanceAt: (x: number, z: number) => number
  /** The wandering radius of the hole's edge at full opening. */
  radiusAt: (x: number, z: number) => number
  /** Where the wall's top sits: the ground surface there. */
  topAt: (x: number, z: number) => number
  /** The radius's smallest and largest value anywhere: far from both, the contour cannot be. */
  radiusMin: number
  radiusMax: number
  /** Grid cell in metres (default 0.12). */
  cell?: number
}

export type PitWalls = {
  positions: Float32Array
  normals: Float32Array
  /** x: 0 at the top of the wall, 1 at its foot. */
  drops: Float32Array
  indices: Uint32Array
}

/** Segments joining the crossing points on cell edges 0 bottom, 1 right, 2 top, 3 left. */
const CASES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [],
  [[3, 0]],
  [[0, 1]],
  [[3, 1]],
  [[1, 2]],
  [], // 5: saddle, by the cell's centre
  [[0, 2]],
  [[3, 2]],
  [[2, 3]],
  [[0, 2]],
  [], // 10: saddle
  [[2, 1]],
  [[3, 1]],
  [[0, 1]],
  [[3, 0]],
  [],
]

const MAX_SEGMENTS = 120_000
/**
 * Rows a wall is cut into down its drop, so the shader can push them sideways by depth: a wall of
 * one row would stay a straight vertical fold from grade to the floor.
 */
export const PIT_WALL_ROWS = 16
/** How far past the radius's range a corner is taken as surely in (or out) without the noise, in metres. */
const PRUNE = 0.5
/** Cells per side of the blocks the walk skips when they are far from the contour. */
const BLOCK = 8

export function buildPitWalls(source: PitContourSource): PitWalls | null {
  const { originX, originZ, span, distanceAt, radiusAt, topAt, radiusMin, radiusMax } = source
  const cell = source.cell ?? Math.max(0.12, span / 800)
  const n = Math.ceil(span / cell)
  const stride = n + 1
  // Far from the radius's whole range the contour cannot be: those corners are not looked up.
  const inside = new Float32Array(stride * stride)
  const field = (col: number, row: number) => {
    const index = row * stride + col
    const known = inside[index]!
    if (known !== 0) return known
    const x = originX + col * cell
    const z = originZ + row * cell
    const d = distanceAt(x, z)
    const value =
      d < radiusMin - PRUNE
        ? d - radiusMin
        : d > radiusMax + PRUNE
          ? d - radiusMax
          : d - radiusAt(x, z) || 1e-6
    inside[index] = value
    return value
  }
  const positions: number[] = []
  const drops: number[] = []
  const indices: number[] = []
  // Each wall's facing, summed over the walls that share an end so the contour shades smoothly.
  const facing = new Map<string, [number, number]>()
  const ends: Array<[string, string]> = []
  const key = (x: number, z: number) => `${Math.round(x * 1e4)},${Math.round(z * 1e4)}`
  const lean = (at: string, nx: number, nz: number) => {
    const sum = facing.get(at)
    if (sum) {
      sum[0] += nx
      sum[1] += nz
    } else facing.set(at, [nx, nz])
  }
  let segments = 0

  const emit = (px: number, pz: number, qx: number, qz: number, nx: number, nz: number) => {
    // Facing: the geometric normal of (top p, top q, foot q) is (dz, 0, -dx).
    let ax = px
    let az = pz
    let bx = qx
    let bz = qz
    if (nx * (bz - az) - nz * (bx - ax) < 0) {
      ax = qx
      az = qz
      bx = px
      bz = pz
    }
    const base = positions.length / 3
    const ay = topAt(ax, az)
    const by = topAt(bx, bz)
    for (let row = 0; row <= PIT_WALL_ROWS; row += 1) {
      positions.push(ax, ay, az, bx, by, bz)
      drops.push(row / PIT_WALL_ROWS, row / PIT_WALL_ROWS)
    }
    const first = key(ax, az)
    const second = key(bx, bz)
    lean(first, nx, nz)
    lean(second, nx, nz)
    ends.push([first, second])
    for (let row = 0; row < PIT_WALL_ROWS; row += 1) {
      const at = base + row * 2
      indices.push(at, at + 1, at + 3, at, at + 3, at + 2)
    }
    segments += 1
  }

  // Blocks of cells whose centre is far from the whole range hold no contour: skipped unseen.
  const skipBelow = radiusMin - PRUNE - BLOCK * cell * Math.SQRT1_2
  const skipAbove = radiusMax + PRUNE + BLOCK * cell * Math.SQRT1_2
  const blocks = Math.ceil(n / BLOCK)
  const farMemo = new Int8Array(blocks * blocks)
  const farBlock = (col: number, row: number) => {
    const index = (row / BLOCK) * blocks + col / BLOCK
    if (farMemo[index] === 0) {
      const d = distanceAt(originX + (col + BLOCK / 2) * cell, originZ + (row + BLOCK / 2) * cell)
      farMemo[index] = d < skipBelow || d > skipAbove ? 1 : 2
    }
    return farMemo[index] === 1
  }
  for (let row = 0; row < n && segments < MAX_SEGMENTS; row += 1) {
    for (let col = 0; col < n; col += 1) {
      if (col % BLOCK === 0 && farBlock(col, row - (row % BLOCK))) {
        col += BLOCK - 1
        continue
      }
      const f0 = field(col, row)
      const f1 = field(col + 1, row)
      const f2 = field(col + 1, row + 1)
      const f3 = field(col, row + 1)
      const index = (f0 < 0 ? 1 : 0) | (f1 < 0 ? 2 : 0) | (f2 < 0 ? 4 : 0) | (f3 < 0 ? 8 : 0)
      if (index === 0 || index === 15) continue
      const x0 = originX + col * cell
      const z0 = originZ + row * cell
      const crossing = (edge: number): [number, number] => {
        switch (edge) {
          case 0:
            return [x0 + (cell * f0) / (f0 - f1), z0]
          case 1:
            return [x0 + cell, z0 + (cell * f1) / (f1 - f2)]
          case 2:
            return [x0 + cell - (cell * f2) / (f2 - f3), z0 + cell]
          default:
            return [x0, z0 + cell - (cell * f3) / (f3 - f0)]
        }
      }
      let pairs = CASES[index]!
      if (index === 5 || index === 10) {
        const centre = (f0 + f1 + f2 + f3) / 4 < 0
        pairs =
          index === 5
            ? centre
              ? [
                  [0, 1],
                  [2, 3],
                ]
              : [
                  [3, 0],
                  [1, 2],
                ]
            : centre
              ? [
                  [3, 0],
                  [1, 2],
                ]
              : [
                  [0, 1],
                  [2, 3],
                ]
      }
      for (const [ea, eb] of pairs) {
        const [px, pz] = crossing(ea)
        const [qx, qz] = crossing(eb)
        const dx = qx - px
        const dz = qz - pz
        const length = Math.hypot(dx, dz)
        if (length < 1e-6) continue
        // The wall faces into the hole: probe the cell's bilinear field a little off the segment.
        let nx = dz / length
        let nz = -dx / length
        const probeX = ((px + qx) / 2 + nx * cell * 0.3 - x0) / cell
        const probeZ = ((pz + qz) / 2 + nz * cell * 0.3 - z0) / cell
        const bilinear =
          f0 * (1 - probeX) * (1 - probeZ) +
          f1 * probeX * (1 - probeZ) +
          f3 * (1 - probeX) * probeZ +
          f2 * probeX * probeZ
        if (bilinear >= 0) {
          nx = -nx
          nz = -nz
        }
        emit(px, pz, qx, qz, nx, nz)
      }
    }
  }
  if (segments === 0) return null
  const normals = new Float32Array(positions.length)
  ends.forEach(([first, second], quad) => {
    for (let slot = 0; slot < PIT_WALL_ROWS * 2 + 2; slot += 1) {
      const [nx, nz] = facing.get(slot % 2 === 0 ? first : second)!
      const length = Math.hypot(nx, nz) || 1
      normals.set([nx / length, 0, nz / length], (quad * (PIT_WALL_ROWS * 2 + 2) + slot) * 3)
    }
  })
  return {
    positions: new Float32Array(positions),
    normals,
    drops: new Float32Array(drops),
    indices: new Uint32Array(indices),
  }
}

// The rectangles a roof is built from, one roof segment each: the footprint's wings, each as long
// as it runs inside the footprint, so they overlap where they meet. The roof renders their union,
// so a wing's hips meet the body's slopes in valleys; wings cut where they meet put a hip end each
// side of the cut, a notch along the joint (L41, Hawkesbury's hip-roof facade).
// Coordinates scaled from a plan carry float noise that sliced the footprint into slivers (468 hip
// segments on the Victor's top floor, which froze the page), so the footprint is snapped first,
// balcony-thin strips join their larger neighbour, and a pathological footprint falls back to its
// bounding box.

type Pt = [number, number]
export type RoofRectangle = { minX: number; maxX: number; minZ: number; maxZ: number }
export type RoofFootprint = { rectangles: RoofRectangle[]; roofType: 'gable' | 'hip' | 'flat' }

/** Coordinates snap to 10 cm. */
const snap = (value: number) => Math.round(value * 10) / 10
/** Parts thinner than this (balconies, slivers) get no roof of their own. */
const MIN_PART = 1.5
const MAX_SEGMENTS = 24
/** A house has up to this many wings under hips; past it the roof is flat. */
const MAX_HIP_WINGS = 6
/** A footprint longer than this is a block, not a house: its roof is flat. */
const BLOCK_LENGTH = 30

function insideAny(polygons: readonly (readonly Pt[])[], x: number, z: number) {
  let inside = false
  for (const polygon of polygons)
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [ax, az] = polygon[i]!
      const [bx, bz] = polygon[j]!
      if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside
    }
  return inside
}

/**
 * A strip of cells thinner than a part keeps only what its larger neighbour along the other axis
 * also has: balconies drop out and the wings they stand on stay whole. Along z, then along x.
 */
function dropThinStrips(cells: boolean[][], xs: number[], zs: number[]) {
  const sweep = (
    rows: number,
    columns: number,
    at: (r: number, c: number) => boolean,
    set: (r: number, c: number) => void,
    size: (r: number) => number,
  ) => {
    for (let r = 0; r < rows; r++) {
      if (size(r) >= MIN_PART) continue
      const neighbours = [r - 1, r + 1].filter((n) => n >= 0 && n < rows && size(n) >= MIN_PART)
      const larger = neighbours.sort((a, b) => size(b) - size(a))[0]
      if (larger === undefined) continue
      for (let c = 0; c < columns; c++) if (at(r, c) && !at(larger, c)) set(r, c)
    }
  }
  const nx = xs.length - 1
  const nz = zs.length - 1
  sweep(
    nz,
    nx,
    (j, i) => cells[i]![j]!,
    (j, i) => {
      cells[i]![j] = false
    },
    (j) => zs[j + 1]! - zs[j]!,
  )
  sweep(
    nx,
    nz,
    (i, j) => cells[i]![j]!,
    (i, j) => {
      cells[i]![j] = false
    },
    (i) => xs[i + 1]! - xs[i]!,
  )
}

export function roofRectangles(polygons: readonly (readonly Pt[])[]): RoofFootprint {
  const snapped = polygons.map((polygon) => polygon.map(([x, z]): Pt => [snap(x), snap(z)]))
  const all = snapped.flat()
  const bounds: RoofRectangle = {
    minX: Math.min(...all.map((point) => point[0])),
    maxX: Math.max(...all.map((point) => point[0])),
    minZ: Math.min(...all.map((point) => point[1])),
    maxZ: Math.max(...all.map((point) => point[1])),
  }
  const xs = [...new Set(all.map((point) => point[0]))].sort((a, b) => a - b)
  const zs = [...new Set(all.map((point) => point[1]))].sort((a, b) => a - b)
  const nx = xs.length - 1
  const nz = zs.length - 1
  const cells = Array.from({ length: nx }, (_, i) =>
    Array.from({ length: nz }, (_, j) =>
      insideAny(snapped, (xs[i]! + xs[i + 1]!) / 2, (zs[j]! + zs[j + 1]!) / 2),
    ),
  )
  dropThinStrips(cells, xs, zs)

  // Inside cells counted from the corner, to test a rectangle in one step.
  const count = Array.from({ length: nx + 1 }, () => new Array<number>(nz + 1).fill(0))
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++)
      count[i + 1]![j + 1] =
        (cells[i]![j] ? 1 : 0) + count[i]![j + 1]! + count[i + 1]![j]! - count[i]![j]!
  const filled = (i0: number, i1: number, j0: number, j1: number) =>
    i0 >= 0 &&
    j0 >= 0 &&
    i1 <= nx &&
    j1 <= nz &&
    count[i1]![j1]! - count[i0]![j1]! - count[i1]![j0]! + count[i0]![j0]! === (i1 - i0) * (j1 - j0)

  // The wings: rectangles of footprint that no row or column of footprint can extend.
  type Wing = { i0: number; i1: number; j0: number; j1: number }
  const wings: Wing[] = []
  for (let i0 = 0; i0 < nx; i0++)
    for (let i1 = i0 + 1; i1 <= nx; i1++) {
      if (!filled(i0, i1, 0, 0) && xs[i1]! - xs[i0]! < MIN_PART && i1 < nx) continue
      for (let j0 = 0; j0 < nz; j0++)
        for (let j1 = j0 + 1; j1 <= nz; j1++) {
          if (!filled(i0, i1, j0, j1)) break
          if (xs[i1]! - xs[i0]! < MIN_PART || zs[j1]! - zs[j0]! < MIN_PART) continue
          const extends_ =
            filled(i0 - 1, i1, j0, j1) ||
            filled(i0, i1 + 1, j0, j1) ||
            filled(i0, i1, j0 - 1, j1) ||
            filled(i0, i1, j0, j1 + 1)
          if (!extends_) wings.push({ i0, i1, j0, j1 })
        }
    }

  // Greedy: the wing covering most of what is left, the longer through the body on a tie, until
  // what is left is smaller than a part.
  const covered = cells.map((column) => column.map(() => false))
  const area = (w: Wing) => (xs[w.i1]! - xs[w.i0]!) * (zs[w.j1]! - zs[w.j0]!)
  const gain = (w: Wing) => {
    let total = 0
    for (let i = w.i0; i < w.i1; i++)
      for (let j = w.j0; j < w.j1; j++)
        if (!covered[i]![j]) total += (xs[i + 1]! - xs[i]!) * (zs[j + 1]! - zs[j]!)
    return total
  }
  const rectangles: RoofRectangle[] = []
  while (rectangles.length <= MAX_SEGMENTS) {
    let best: Wing | null = null
    let bestGain = 0
    for (const wing of wings) {
      const g = gain(wing)
      if (
        g > bestGain + 1e-9 ||
        (best && Math.abs(g - bestGain) <= 1e-9 && area(wing) > area(best))
      ) {
        best = wing
        bestGain = g
      }
    }
    if (!best || bestGain < MIN_PART * MIN_PART) break
    for (let i = best.i0; i < best.i1; i++)
      for (let j = best.j0; j < best.j1; j++) covered[i]![j] = true
    rectangles.push({
      minX: xs[best.i0]!,
      maxX: xs[best.i1]!,
      minZ: zs[best.j0]!,
      maxZ: zs[best.j1]!,
    })
  }

  // Outside the footprint within a rectangle on the grid: what a roof over it adds past the house.
  const inside = Array.from({ length: nx + 1 }, () => new Array<number>(nz + 1).fill(0))
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++)
      inside[i + 1]![j + 1] =
        (cells[i]![j] ? (xs[i + 1]! - xs[i]!) * (zs[j + 1]! - zs[j]!) : 0) +
        inside[i]![j + 1]! +
        inside[i + 1]![j]! -
        inside[i]![j]!
  const at = (values: number[], value: number) => values.indexOf(value)
  const outside = (r: RoofRectangle) => {
    const [i0, i1, j0, j1] = [at(xs, r.minX), at(xs, r.maxX), at(zs, r.minZ), at(zs, r.maxZ)]
    const within = inside[i1]![j1]! - inside[i0]![j1]! - inside[i1]![j0]! + inside[i0]![j0]!
    return (r.maxX - r.minX) * (r.maxZ - r.minZ) - within
  }
  // Of a rectangle, how much the others cover: on the grid, cell by cell.
  const coveredBy = (r: RoofRectangle, others: readonly RoofRectangle[]) => {
    let total = 0
    for (let i = at(xs, r.minX); i < at(xs, r.maxX); i++)
      for (let j = at(zs, r.minZ); j < at(zs, r.maxZ); j++) {
        const [cx, cz] = [(xs[i]! + xs[i + 1]!) / 2, (zs[j]! + zs[j + 1]!) / 2]
        if (others.some((o) => cx > o.minX && cx < o.maxX && cz > o.minZ && cz < o.maxZ))
          total += (xs[i + 1]! - xs[i]!) * (zs[j + 1]! - zs[j]!)
      }
    return total
  }
  const absorbed = mergeWings(rectangles, outside, coveredBy)

  const chosen = absorbed.length === 0 || absorbed.length > MAX_SEGMENTS ? [bounds] : absorbed
  const long = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
  const roofType =
    long > BLOCK_LENGTH || chosen.length > MAX_HIP_WINGS
      ? 'flat'
      : chosen.length === 1
        ? 'gable'
        : 'hip'
  return { rectangles: chosen, roofType }
}

/**
 * A merge may add roof outside the house up to this share of what the wing it takes in covered on
 * its own: a jog's corners against its band, not a projection's notches against its own hip.
 */
const MERGE_SHARE = 0.5

/**
 * A roof runs over a jog: two wings become their bounding rectangle when that adds little roof
 * outside the house against what the wing taken in covered on its own (a strip along a jog, a band
 * a few decimetres proud). A garage, a projection, a courtyard's arms cover more on their own than a
 * merge would add outside, and keep their hips.
 */
function mergeWings(
  wings: RoofRectangle[],
  outside: (rectangle: RoofRectangle) => number,
  covered: (rectangle: RoofRectangle, others: readonly RoofRectangle[]) => number,
): RoofRectangle[] {
  const area = (r: RoofRectangle) => (r.maxX - r.minX) * (r.maxZ - r.minZ)
  const union = (a: RoofRectangle, b: RoofRectangle): RoofRectangle => ({
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  })
  const contains = (a: RoofRectangle, b: RoofRectangle) =>
    a.minX <= b.minX && a.maxX >= b.maxX && a.minZ <= b.minZ && a.maxZ >= b.maxZ
  let current = [...wings]
  while (true) {
    let best: {
      keep: RoofRectangle
      take: RoofRectangle
      grown: RoofRectangle
      ratio: number
    } | null = null
    for (const keep of current)
      for (const take of current) {
        if (keep === take) continue
        // What the wing taken in covers that no other wing does.
        const own =
          area(take) -
          covered(
            take,
            current.filter((r) => r !== take),
          )
        if (own <= 0) continue
        const grown = union(keep, take)
        const ratio = (outside(grown) - outside(keep)) / own
        if (ratio <= MERGE_SHARE + 1e-9 && (!best || ratio < best.ratio))
          best = { keep, take, grown, ratio }
      }
    if (!best) return current
    const { keep, take, grown } = best
    current = current
      .map((r) => (r === keep ? grown : r))
      .filter((r) => r === grown || (r !== take && !contains(grown, r)))
  }
}

/**
 * The frame a roof is swept in: the footprint's own axes, from its longest edge. Swept along the
 * world axes, a building turned 20° got a staircase of segments (Victor run 5). The rotation
 * convention is a roof node's: local (x, z) → (x c + z s, -x s + z c).
 */
export function buildingFrame(polygons: readonly (readonly Pt[])[]) {
  let longest = { length: 0, dx: 1, dz: 0 }
  for (const polygon of polygons)
    for (let i = 0; i < polygon.length; i++) {
      const [ax, az] = polygon[i]!
      const [bx, bz] = polygon[(i + 1) % polygon.length]!
      const length = Math.hypot(bx - ax, bz - az)
      if (length > longest.length) longest = { length, dx: bx - ax, dz: bz - az }
    }
  // The local x axis runs along the longest edge, turned to the nearest quarter of the world's.
  const edge = Math.atan2(-longest.dz, longest.dx)
  const angle = edge - Math.round(edge / (Math.PI / 2)) * (Math.PI / 2)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return {
    angle,
    polygons: polygons.map((polygon) =>
      polygon.map(([x, z]): Pt => [x * c - z * s, x * s + z * c]),
    ),
    toWorld: ([x, z]: Pt): Pt => [x * c + z * s, -x * s + z * c],
  }
}

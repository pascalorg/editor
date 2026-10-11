/**
 * Walls read from a raster plan: the dark bands a plan draws walls with, as centrelines with their
 * own thickness, in the image's pixels. A plan draws walls as bands thicker than its text, its
 * furniture outlines and its dimension lines, and in its darkest ink; what is thinner or lighter
 * is not a wall. Walls are read along the image's axes, as plans draw them.
 *
 * The MCP agent vectorised the Victor's A6 this way with its own script (2026-10-03); Hawkesbury
 * run 3's plan is only a picture.
 */

type Pt = [number, number]

export type RasterWallLine = { a: Pt; b: Pt; thickness: number }
export type RasterPlan = { rgba: Uint8ClampedArray; width: number; height: number }
export type RasterWallOptions = {
  /** Luminance (0–255) below which a pixel is ink. Default: midway between the darkest ink and the paper. */
  threshold?: number
}

/**
 * The most pixels a host decodes a plan at along its longer side: a wall stays a band at that size,
 * and a large upload cannot exhaust memory.
 */
export const PLAN_RASTER_LONGEST = 4096

/** Thicker than this share, a dark band is a fill (a stair, a hatch), not a wall. */
const MAX_WALL = 0.04
/** A wall at least this many times as long as it is thick. */
const ELONGATION = 1.5
/** Runs this many pixels apart, row to row, are one band's edge wobbling. */
const WOBBLE = 2

/**
 * Ink against paper: midway between the plan's darkest ink (its first percentile) and its paper
 * (the median, since a plan is mostly paper). Grey fills (furniture, hatches) fall on the paper side.
 */
function inkThreshold(lum: Uint8Array) {
  const histogram = new Array(256).fill(0)
  for (const value of lum) histogram[value]++
  const at = (share: number) => {
    let seen = 0
    for (let value = 0; value < 256; value++) {
      seen += histogram[value]
      if (seen >= share * lum.length) return value
    }
    return 255
  }
  return (at(0.01) + at(0.5)) / 2
}

/**
 * The thinnest wall the plan draws: the first stroke thickness it uses often, past its thinnest
 * lines (text, dimensions, furniture). Hawkesbury's brochure plan draws 1 px lines, 3 px partitions
 * and 8 px outside walls; the Victor's B2 draws 1 px lines and 9–10 px walls.
 */
function wallStroke(across: Uint16Array, down: Uint16Array, ink: Uint8Array) {
  // Strokes counted once each: a run of n pixels shows in n pixels' lengths.
  const counts = new Array(64).fill(0)
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue
    for (const length of [across[i]!, down[i]!])
      if (length < counts.length) counts[length] += 1 / length
  }
  // The thicknesses the plan uses often: its peaks, the thinnest first.
  const often = 0.05 * Math.max(...counts)
  const peaks = counts.flatMap((count, k) =>
    k > 0 && count >= often && count > (counts[k - 1] ?? 0) && count >= (counts[k + 1] ?? 0)
      ? [k]
      : [],
  )
  return peaks.length > 1 ? peaks[1]! - 0.5 : (peaks[0] ?? 1) + 1.5
}

/** Runs of `mask` along rows, grouped over consecutive rows into bands. */
function bands(mask: Uint8Array, width: number, height: number, minLength: number) {
  const out: { x0: number; x1: number; y0: number; y1: number }[] = []
  let open: { x0: number; x1: number; y0: number; y1: number }[] = []
  for (let y = 0; y < height; y++) {
    const runs: [number, number][] = []
    for (let x = 0; x < width; ) {
      if (!mask[y * width + x]) {
        x++
        continue
      }
      const start = x
      while (x < width && mask[y * width + x]) x++
      if (x - start >= minLength) runs.push([start, x])
    }
    const next: typeof open = []
    for (const [x0, x1] of runs) {
      const band = open.find(
        (b) => Math.abs(b.x0 - x0) <= WOBBLE && Math.abs(b.x1 - x1) <= WOBBLE && b.y1 === y - 1,
      )
      if (band) {
        open = open.filter((b) => b !== band)
        next.push({ ...band, y1: y })
      } else next.push({ x0, x1, y0: y, y1: y })
    }
    out.push(...open)
    open = next
  }
  return [...out, ...open]
}

export function rasterWallLines(plan: RasterPlan, options: RasterWallOptions = {}) {
  const { rgba, width, height } = plan
  const lum = new Uint8Array(width * height)
  for (let i = 0; i < lum.length; i++)
    lum[i] = Math.round(0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!)
  const threshold = options.threshold ?? inkThreshold(lum)
  const longer = Math.max(width, height)
  const maxWall = MAX_WALL * longer
  const ink = new Uint8Array(width * height)
  for (let i = 0; i < ink.length; i++) ink[i] = lum[i]! < threshold ? 1 : 0

  // Keep ink thick both ways: a pixel whose run across is thinner than a wall is a stroke.
  const run = (index: (k: number) => number, count: number) => {
    const lengths = new Uint16Array(count)
    for (let k = 0; k < count; ) {
      if (!ink[index(k)]) {
        k++
        continue
      }
      const start = k
      while (k < count && ink[index(k)]) k++
      for (let j = start; j < k; j++) lengths[j] = k - start
    }
    return lengths
  }
  const across = new Uint16Array(width * height)
  const down = new Uint16Array(width * height)
  for (let y = 0; y < height; y++) {
    const lengths = run((x) => y * width + x, width)
    for (let x = 0; x < width; x++) across[y * width + x] = lengths[x]!
  }
  for (let x = 0; x < width; x++) {
    const lengths = run((y) => y * width + x, height)
    for (let y = 0; y < height; y++) down[y * width + x] = lengths[y]!
  }
  const minWall = wallStroke(across, down, ink)
  const thick = new Uint8Array(width * height)
  for (let i = 0; i < thick.length; i++)
    thick[i] = ink[i] && Math.min(across[i]!, down[i]!) >= minWall ? 1 : 0

  const minLength = Math.max(3 * minWall, longer / 60)
  const transposed = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) transposed[x * height + y] = thick[y * width + x]!
  const segments: RasterWallLine[] = []
  for (const b of bands(thick, width, height, minLength)) {
    const thickness = b.y1 - b.y0 + 1
    const length = b.x1 - b.x0
    if (thickness < minWall || thickness > maxWall || length < ELONGATION * thickness) continue
    const y = (b.y0 + b.y1 + 1) / 2
    segments.push({ a: [b.x0, y], b: [b.x1, y], thickness })
  }
  for (const b of bands(transposed, height, width, minLength)) {
    const thickness = b.y1 - b.y0 + 1
    const length = b.x1 - b.x0
    if (thickness < minWall || thickness > maxWall || length < ELONGATION * thickness) continue
    const x = (b.y0 + b.y1 + 1) / 2
    segments.push({ a: [x, b.x0], b: [x, b.x1], thickness })
  }
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    ...segments.map(
      ({ a, b, thickness }) =>
        `<path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="#000" stroke-width="${thickness}" fill="none"/>`,
    ),
    '</svg>',
  ].join('')
  return { segments, svg, threshold }
}

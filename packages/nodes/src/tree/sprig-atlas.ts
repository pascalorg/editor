import { DataTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'

const TILE = 128
const SIZE = 4 * TILE
type Point = [number, number]
type Surface = { bytes: Uint8Array; left: number; bottom: number }
type Style = 'broad' | 'small' | 'willow' | 'pine'
const STYLES: readonly Style[] = ['broad', 'small', 'willow', 'pine']

function stream(seed: number) {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

// Coordinates are local to the tile. Alpha is coverage; colour remains unassociated.
function ink(tile: Surface, x: number, y: number, light: number, alpha: number, woody: boolean) {
  const i = ((tile.bottom + y) * SIZE + tile.left + x) * 4
  const coverage = Math.max(0, Math.min(1, alpha))
  const old = ((tile.bytes[i + 3] ?? 0) / 255) * (1 - coverage)
  const total = coverage + old
  if (!total) return
  const mix = (value: number, channel: number) =>
    (value * coverage + (tile.bytes[i + channel] ?? 0) * old) / total
  tile.bytes[i] = mix(Math.min(255, light * (woody ? 1.1 : 1.015)), 0)
  tile.bytes[i + 1] = mix(light * (woody ? 0.87 : 1), 1)
  tile.bytes[i + 2] = mix(light * (woody ? 0.7 : 0.95), 2)
  tile.bytes[i + 3] = 255 * total
}

// A tapered stroke serves as wood, midrib or leaf blade. Curvature and two planes
// either side of the vein give the blade relief even when the whole sprig is one quad.
function stroke(
  tile: Surface,
  a: Point,
  b: Point,
  radius: number,
  light: number,
  style?: Style,
  curve = 0,
) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1]
  const length = Math.sqrt(dx * dx + dy * dy)
  if (!length) return
  const margin = radius + Math.abs(curve) + 1
  const left = Math.max(2, Math.floor(Math.min(a[0], b[0]) - margin))
  const right = Math.min(TILE - 3, Math.ceil(Math.max(a[0], b[0]) + margin))
  const low = Math.max(2, Math.floor(Math.min(a[1], b[1]) - margin))
  const high = Math.min(TILE - 3, Math.ceil(Math.max(a[1], b[1]) + margin))
  for (let y = low; y <= high; y++)
    for (let x = left; x <= right; x++) {
      const px = x + 0.5 - a[0],
        py = y + 0.5 - a[1]
      const t = (px * dx + py * dy) / (length * length)
      if (t < 0 || t > 1) continue
      const belly = 4 * t * (1 - t)
      const cross = (dx * py - dy * px) / length - curve * belly
      let width = radius * (1 - 0.62 * t)
      if (style) {
        width = radius * belly * (1.4 - 0.8 * t)
        if (style === 'broad') width *= 0.94 + 0.06 * Math.cos(31 * t)
        if (style === 'small') width *= 1.67 - 0.93 * t
      }
      const alpha = width + 0.5 - Math.abs(cross)
      if (alpha <= 0) continue
      let luma = light
      if (style && style !== 'pine') {
        const rib = Math.max(0, 1 - Math.abs(cross) / (0.32 + 0.09 * width))
        const veins = Math.max(0, Math.cos(31 * t - (Math.abs(cross) / (width + 0.1)) * 2.8)) ** 10
        const edge = Math.min(1, Math.abs(cross) / (width + 0.1))
        luma +=
          (cross < 0 ? 13 : -10) * (1 - edge * 0.7) + 25 * rib + 10 * veins - 11 * edge + 13 * t
      }
      ink(tile, x, y, Math.min(255, luma), alpha, !style)
    }
}

function sprig(
  tile: Surface,
  style: Style,
  root: Point,
  length: number,
  angle: number,
  random: () => number,
) {
  const sin = Math.sin(angle),
    cos = Math.cos(angle)
  const point = (x: number, y: number): Point => [
    root[0] + length * (x * cos + y * sin),
    root[1] + length * (y * cos - x * sin),
  ]
  const bend = (random() - 0.5) * 0.22
  const stem = (t: number): Point => point(bend * t * t, t)
  for (let j = 0; j < 5; j++)
    stroke(tile, stem(j / 5), stem((j + 1) / 5), length * (0.012 - 0.0017 * j), 160)
  if (style === 'broad' || style === 'small') {
    // Alternate short lateral twigs. Each carries two blades on different planes
    // and a terminal bud, leaving gaps between neighbouring sets of leaves.
    for (let j = 0; j < 6; j++) {
      const side = j % 2 === 0 ? -1 : 1
      const t = 0.075 + j * 0.118 + 0.045 * random()
      const span = (0.19 + 0.1 * Math.sin(Math.PI * t)) * (0.83 + 0.28 * random())
      const rise = 0.09 + 0.12 * random()
      const x = bend * t * t
      const end = point(x + side * span, t + rise)
      stroke(tile, stem(t), end, length * 0.007, 166)
      const blade = style === 'small' ? 0.132 : 0.164
      for (let k = 0; k < 3; k++) {
        const u = 0.28 + k * 0.31
        const from = point(x + side * span * u, t + rise * u)
        const size = blade * (0.72 + random() * 0.5)
        const tilt =
          k === 0 ? 1.2 + random() * 0.5 : k === 1 ? -0.62 + random() * 0.4 : 0.15 + 0.67 * random()
        const to = point(
          x + side * (span * u + size * Math.cos(tilt)),
          t + rise * u + size * Math.sin(tilt),
        )
        stroke(
          tile,
          from,
          to,
          length * size * (style === 'small' ? 0.43 : 0.3),
          178 + 69 * random(),
          style,
          (random() - 0.5) * length * 0.045,
        )
      }
    }
    stroke(tile, stem(0.84), stem(1.035), length * 0.043, 228, style)
    return
  }
  if (style === 'willow') {
    for (let j = 0; j < 15; j++) {
      const t = 0.055 + ((j + random() * 0.52) * 0.74) / 15
      const side = j % 2 === 0 ? -1 : 1
      const span = (0.19 + 0.17 * Math.sin(t * Math.PI)) * (0.66 + random() * 0.46)
      const tip = point(bend * t * t + side * span, t + 0.13 + 0.17 * random())
      stroke(
        tile,
        stem(t),
        tip,
        length * (0.018 + 0.012 * random()),
        184 + 62 * random(),
        style,
        side * length * 0.055,
      )
    }
  } else {
    for (let j = 0; j < 13; j++) {
      const side = j % 2 === 0 ? -1 : 1
      const t = 0.06 + ((j + random() * 0.65) * 0.78) / 13
      const span = side * (0.25 + 0.11 * Math.sin(Math.PI * t)) * (0.74 + random() * 0.34)
      const rise = 0.08 + 0.16 * random()
      const x = bend * t * t
      stroke(tile, stem(t), point(x + span, t + rise), length * 0.008, 178)
      for (let n = 0; n < 19; n++) {
        const u = (n + random() * 0.6) / 20
        const px = x + u * span,
          py = t + u * rise
        const needle = (0.135 - 0.074 * u) * (0.52 + 0.7 * random())
        const tilt = (n % 2 === 0 ? -1 : 1) * (0.48 + 0.72 * random())
        stroke(
          tile,
          point(px, py),
          point(px + side * needle * (0.38 + 0.46 * u), py + needle * tilt),
          length * (0.005 + 0.004 * random()),
          180 + 67 * random(),
          'pine',
        )
      }
    }
  }
  stroke(tile, stem(0.84), stem(1.025), length * 0.019, 222, style)
}

function paintBark(tile: Surface) {
  const random = stream(71)
  // Long scales grow around interrupted fissures. Warping the grain across the
  // trunk keeps the small tile from reading as continuous stripes on a large fork.
  const columns = 12
  const rows = 8
  const scales = Array.from({ length: columns * rows }, () => ({
    x: 0.18 + 0.64 * random(),
    y: 0.15 + 0.7 * random(),
    tone: 194 + 51 * random(),
  }))
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const u = x / TILE
      const v = y / TILE
      const gx = columns * u + 0.26 * Math.sin(12 * v + 6 * u) + 0.11 * Math.sin(34 * v - 13 * u)
      const gy = rows * v + 0.14 * Math.sin(20 * u + 8 * v)
      const col = Math.floor(gx)
      const row = Math.floor(gy)
      let closest = Infinity
      let second = Infinity
      let tone = 0
      for (let j = row - 1; j <= row + 1; j++)
        for (let k = col - 1; k <= col + 1; k++) {
          const cell = scales[((j + rows) % rows) * columns + ((k + columns) % columns)]!
          const dx = gx - k - cell.x
          const dy = gy - j - cell.y
          const d = dx * dx + dy * dy
          if (d < closest) {
            second = closest
            closest = d
            tone = cell.tone
          } else second = Math.min(second, d)
        }
      const edge = Math.sqrt(second) - Math.sqrt(closest)
      const fissure = Math.max(0, 1 - edge * 6)
      const lip = Math.max(0, 1 - Math.abs(edge - 0.19) * 10)
      const grain = 8 * Math.sin(23 * gx + 2 * gy) + 19 * (random() - 0.5)
      const luma = tone - 63 * fissure + 11 * lip + grain
      const i = ((tile.bottom + y) * SIZE + tile.left + x) * 4
      tile.bytes[i] = Math.min(255, luma + 3)
      tile.bytes[i + 1] = Math.min(255, luma)
      tile.bytes[i + 2] = Math.min(255, luma - 7)
      tile.bytes[i + 3] = 255
    }
}

// Canvas PNG encoding uses premultiplied bytes. Keep a sub-cutoff fringe with RGB
// that survives that conversion, so filtering a saved sprig picks up its leaf tone.
function padCutoutEdges(bytes: Uint8Array) {
  const radius = 5
  const horizontal = new Uint8Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const row = y * SIZE
      if (bytes[(row + x) * 4 + 3])
        horizontal.fill(1, row + Math.max(0, x - radius), row + Math.min(SIZE, x + radius + 1))
    }
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4
      if (bytes[i + 3]) continue
      for (let row = Math.max(0, y - radius); row <= Math.min(SIZE - 1, y + radius); row++) {
        if (!horizontal[row * SIZE + x]) continue
        // 213/255 at 6/255 alpha rounds to exactly five premultiplied byte units.
        bytes.fill(213, i, i + 3)
        bytes[i + 3] = 6
        break
      }
    }
}

let atlas: DataTexture | undefined
export function treeAtlas() {
  if (atlas) return atlas
  const bytes = new Uint8Array(SIZE * SIZE * 4)
  for (const [row, style] of STYLES.entries())
    for (let col = 0; col < 4; col++) {
      const tile = { bytes, left: col * TILE, bottom: row * TILE }
      if (row === 3 && col === 2) {
        paintBark(tile)
        continue
      }
      const random = stream(851 + row * 737 + col * 177)
      if (col < 3)
        sprig(
          tile,
          style,
          [TILE * (0.48 + random() * 0.04), 4],
          TILE * 0.88,
          (random() - 0.5) * 0.14,
          random,
        )
      else {
        // The outer silhouette narrows to a point, so one triangle can carry a whole bough.
        const stem: Point = [TILE * 0.5, TILE * 0.04]
        stroke(tile, stem, [stem[0], TILE * 0.83], TILE * 0.014, 169)
        for (let j = 0; j < 5; j++) {
          const t = j / 5
          sprig(
            tile,
            style,
            [stem[0], TILE * (0.06 + t * 0.62)],
            TILE * (0.43 - t * 0.12),
            j === 4 ? 0.05 : (j % 2 === 0 ? -1 : 1) * (0.83 - 0.38 * t),
            random,
          )
        }
      }
    }
  padCutoutEdges(bytes)
  atlas = new DataTexture(bytes, SIZE, SIZE)
  atlas.name = 'Tree sprigs and bark'
  atlas.colorSpace = SRGBColorSpace
  atlas.generateMipmaps = true
  atlas.minFilter = LinearMipmapLinearFilter
  atlas.magFilter = LinearFilter
  atlas.needsUpdate = true
  return atlas
}

export function disposeTreeAtlas() {
  // Release the GPU copy and keep the generated pixels for the next lease.
  atlas?.dispose()
}

export function treeAtlasUV(bark: Float32Array, sprigs: Uint8Array, corners: 3 | 4, style: Style) {
  const uv = new Float32Array(bark.length + sprigs.length * 2 * corners)
  for (let i = 0; i < bark.length; i += 2) {
    uv[i] = (2 + (2 + 124 * (bark[i] ?? 0)) / TILE) / 4
    uv[i + 1] = (3 + (2 + 124 * (bark[i + 1] ?? 0)) / TILE) / 4
  }
  const row = STYLES.indexOf(style)
  for (const [i, id] of sprigs.entries()) {
    const col = row === 3 && id === 2 ? 0 : id
    const at = bark.length + i * 2 * corners
    for (let k = 0; k < corners; k++) {
      const u = corners === 3 && k === 2 ? 0.5 : k === 1 || k === 2 ? 1 : 0
      uv[at + k * 2] = (col + u) / 4
      uv[at + k * 2 + 1] = (row + (k > 1 ? 1 : 0)) / 4
    }
  }
  return uv
}

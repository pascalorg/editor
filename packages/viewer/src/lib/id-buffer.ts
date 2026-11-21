// What a region shows, read from an id pass (see id-pass.ts): every pixel carries the index of
// what was drawn there, and the world point it was drawn at. Pure: no three, no DOM.

/** What an index of the id pass stands for. `background` is index 0: nothing was drawn (the sky). */
export type IdClassKind = 'background' | 'node' | 'ground' | 'glass' | 'unknown'

export type IdEntry = {
  index: number
  kind: IdClassKind
  /** The owning node, for `node` and `glass` (its opening). Ground is not a node. */
  nodeId?: string
  nodeType?: string
  /** For `unknown`: the names of the meshes that drew there, to find the missing rule. */
  objectNames?: string[]
}

export const BACKGROUND_INDEX = 0

/** One id pass, read back: rows top-down, one index and one world point per pixel. */
export type IdBuffer = {
  width: number
  height: number
  ids: Uint32Array
  /** x, y, z per pixel (world metres); NaN where nothing was drawn. */
  world: Float32Array
  entries: IdEntry[]
}

/**
 * An RGBA float readback (R = index, GBA = world point) as top-down rows. WebGPU rows come back
 * top-down (padded to 256 bytes before r187, tight from r187: settled by the length); the WebGL2
 * fallback's come bottom-up.
 */
export function decodeIdReadback(
  raw: Float32Array,
  width: number,
  height: number,
  topDown: boolean,
  entries: IdEntry[],
): IdBuffer {
  const tight = width * 4
  const padded = Math.ceil((width * 16) / 256) * 64
  const stride = topDown && raw.length === padded * height ? padded : tight
  if (raw.length !== stride * height) throw new Error('Incomplete id-buffer readback')
  const ids = new Uint32Array(width * height)
  const world = new Float32Array(width * height * 3)
  for (let row = 0; row < height; row++) {
    const source = (topDown ? row : height - 1 - row) * stride
    for (let x = 0; x < width; x++) {
      const k = source + x * 4
      const p = row * width + x
      const index = Math.round(raw[k] ?? 0)
      ids[p] = index
      if (index === BACKGROUND_INDEX) {
        world[p * 3] = Number.NaN
        world[p * 3 + 1] = Number.NaN
        world[p * 3 + 2] = Number.NaN
      } else {
        world[p * 3] = raw[k + 1] ?? Number.NaN
        world[p * 3 + 1] = raw[k + 2] ?? Number.NaN
        world[p * 3 + 2] = raw[k + 3] ?? Number.NaN
      }
    }
  }
  return { width, height, ids, world, entries }
}

/** A rectangle in buffer pixels, x1/y1 exclusive. */
export type PixelRect = { x0: number; y0: number; x1: number; y1: number }

export type VisibleShare = {
  index: number
  kind: IdClassKind
  nodeId?: string
  nodeType?: string
  pixels: number
  /** Of the region's pixels, 0-1; all the shares of a region sum to 1. */
  share: number
  /** Its pixels' box in the buffer. */
  box: PixelRect
}

const fullRect = (buffer: { width: number; height: number }): PixelRect => ({
  x0: 0,
  y0: 0,
  x1: buffer.width,
  y1: buffer.height,
})

function clippedRect(buffer: { width: number; height: number }, rect: PixelRect): PixelRect {
  const x0 = Math.max(0, Math.min(buffer.width, Math.floor(rect.x0)))
  const y0 = Math.max(0, Math.min(buffer.height, Math.floor(rect.y0)))
  return {
    x0,
    y0,
    x1: Math.max(x0, Math.min(buffer.width, Math.ceil(rect.x1))),
    y1: Math.max(y0, Math.min(buffer.height, Math.ceil(rect.y1))),
  }
}

/**
 * Every index seen inside `rect` (the whole buffer by default), with its share of the rect's
 * pixels, the biggest first, ties by index. Even a thin railing is kept.
 */
export function visibleShares(
  buffer: IdBuffer,
  rect: PixelRect = fullRect(buffer),
): VisibleShare[] {
  const counts = new Map<number, { pixels: number; box: PixelRect }>()
  const { x0, y0, x1, y1 } = clippedRect(buffer, rect)
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const index = buffer.ids[y * buffer.width + x] as number
      const at = counts.get(index)
      if (at) {
        at.pixels++
        if (x < at.box.x0) at.box.x0 = x
        if (x + 1 > at.box.x1) at.box.x1 = x + 1
        if (y < at.box.y0) at.box.y0 = y
        if (y + 1 > at.box.y1) at.box.y1 = y + 1
      } else counts.set(index, { pixels: 1, box: { x0: x, y0: y, x1: x + 1, y1: y + 1 } })
    }
  }
  const total = Math.max(1, (x1 - x0) * (y1 - y0))
  const byIndex = new Map(buffer.entries.map((entry) => [entry.index, entry]))
  return [...counts.entries()]
    .map(([index, { pixels, box }]) => {
      const entry = byIndex.get(index)
      return {
        index,
        kind: entry?.kind ?? ('unknown' as const),
        ...(entry?.nodeId ? { nodeId: entry.nodeId } : {}),
        ...(entry?.nodeType ? { nodeType: entry.nodeType } : {}),
        pixels,
        share: pixels / total,
        box,
      }
    })
    .sort((a, b) => b.pixels - a.pixels || a.index - b.index)
}

/** The world point drawn at a buffer pixel; null on the background or off the buffer. */
export function worldAt(buffer: IdBuffer, x: number, y: number): [number, number, number] | null {
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= buffer.width || py >= buffer.height) return null
  const p = py * buffer.width + px
  if (buffer.ids[p] === BACKGROUND_INDEX) return null
  const wx = buffer.world[p * 3] as number
  const wy = buffer.world[p * 3 + 1] as number
  const wz = buffer.world[p * 3 + 2] as number
  if (![wx, wy, wz].every(Number.isFinite)) return null
  return [wx, wy, wz]
}

/** The world points under the rect's centre and four corners (2 px in), null where it shows sky. */
export function regionWorldPoints(buffer: IdBuffer, rect: PixelRect = fullRect(buffer)) {
  rect = clippedRect(buffer, rect)
  if (rect.x0 === rect.x1 || rect.y0 === rect.y1)
    return { center: null, topLeft: null, topRight: null, bottomLeft: null, bottomRight: null }
  const ix = Math.min(2, Math.max(0, (rect.x1 - rect.x0 - 1) / 2))
  const iy = Math.min(2, Math.max(0, (rect.y1 - rect.y0 - 1) / 2))
  const cx = (rect.x0 + rect.x1) / 2
  const cy = (rect.y0 + rect.y1) / 2
  return {
    center: worldAt(buffer, cx, cy),
    topLeft: worldAt(buffer, rect.x0 + ix, rect.y0 + iy),
    topRight: worldAt(buffer, rect.x1 - 1 - ix, rect.y0 + iy),
    bottomLeft: worldAt(buffer, rect.x0 + ix, rect.y1 - 1 - iy),
    bottomRight: worldAt(buffer, rect.x1 - 1 - ix, rect.y1 - 1 - iy),
  }
}

/**
 * For each index, the pixel deepest inside its area (farthest from any other index, a two-pass
 * chamfer distance): where its number reads best, and where its world point is taken.
 */
export function labelAnchors(
  buffer: Pick<IdBuffer, 'width' | 'height' | 'ids'>,
  rect: PixelRect = fullRect(buffer),
): Map<number, { x: number; y: number; depth: number }> {
  const { width, height, ids } = buffer
  const { x0, y0, x1, y1 } = clippedRect(buffer, rect)
  const distance = new Float32Array(width * height)
  const big = width + height
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const id = ids[p]
      const edge =
        x <= x0 ||
        y <= y0 ||
        x >= x1 - 1 ||
        y >= y1 - 1 ||
        ids[p - 1] !== id ||
        ids[p + 1] !== id ||
        ids[p - width] !== id ||
        ids[p + width] !== id
      distance[p] = edge ? 0 : big
    }
  }
  for (let y = 1; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const p = y * width + x
      const d = Math.min(distance[p - 1] as number, distance[p - width] as number) + 1
      if (d < (distance[p] as number)) distance[p] = d
    }
  }
  for (let y = height - 2; y >= 0; y--) {
    for (let x = width - 2; x >= 0; x--) {
      const p = y * width + x
      const d = Math.min(distance[p + 1] as number, distance[p + width] as number) + 1
      if (d < (distance[p] as number)) distance[p] = d
    }
  }
  const best = new Map<number, { x: number; y: number; depth: number }>()
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x
      const id = ids[p] as number
      const depth = distance[p] as number
      const at = best.get(id)
      if (!at || depth > at.depth) best.set(id, { x, y, depth })
    }
  }
  return best
}

/** A colour the map paints an index in, with the word a person (or a model) calls it. */
export type NamedColour = { name: string; hex: string; rgb: [number, number, number] }

const named = (name: string, hex: string): NamedColour => ({
  name,
  hex,
  rgb: [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ],
})

/** The non-node classes keep one colour each, so "the sky" and "the ground" read the same in every map. */
export const CLASS_COLOURS: Record<Exclude<IdClassKind, 'node'>, NamedColour> = {
  background: named('pale blue', '#d6ebff'),
  ground: named('brown', '#9a6324'),
  glass: named('cyan', '#42d4f4'),
  unknown: named('magenta', '#f032e6'),
}

const OUTSIDE_REGION: [number, number, number] = [235, 235, 235]

/** Nodes take these in order of their share (distinct, nameable, none of them a class colour). */
export const NODE_COLOURS: readonly NamedColour[] = [
  named('red', '#e6194b'),
  named('green', '#3cb44b'),
  named('blue', '#4363d8'),
  named('orange', '#f58231'),
  named('yellow', '#ffe119'),
  named('purple', '#911eb4'),
  named('teal', '#469990'),
  named('pink', '#fabed4'),
  named('lime', '#bfef45'),
  named('navy', '#000075'),
  named('maroon', '#800000'),
  named('olive', '#808000'),
  named('lavender', '#dcbeff'),
  named('apricot', '#ffd8b1'),
  named('mint', '#aaffc3'),
  named('grey', '#a9a9a9'),
]

/**
 * The colour of every share: classes their own, nodes the palette in share order. Past the
 * palette a colour repeats under a second name ("red 2"): the number on the map tells them apart.
 */
export function assignColours(shares: readonly VisibleShare[]): Map<number, NamedColour> {
  const out = new Map<number, NamedColour>()
  let n = 0
  for (const share of shares) {
    if (share.kind !== 'node') {
      out.set(share.index, CLASS_COLOURS[share.kind])
      continue
    }
    const base = NODE_COLOURS[n % NODE_COLOURS.length] as NamedColour
    const round = Math.floor(n / NODE_COLOURS.length)
    out.set(share.index, round === 0 ? base : { ...base, name: `${base.name} ${round + 1}` })
    n++
  }
  return out
}

/**
 * The map's pixels: each index in its flat colour, or the crop tinted by it (`tint` 0-1 over the
 * crop's RGBA), with a dark line where two indices meet. Rows top-down, RGBA8.
 */
export function segmentationPixels(
  buffer: Pick<IdBuffer, 'width' | 'height' | 'ids'>,
  colours: ReadonlyMap<number, NamedColour>,
  options: { crop?: Uint8ClampedArray; tint?: number; outline?: boolean; rect?: PixelRect } = {},
): Uint8ClampedArray {
  const { width, height, ids } = buffer
  const out = new Uint8ClampedArray(width * height * 4)
  const tint = options.crop ? Math.max(0, Math.min(1, options.tint ?? 0.6)) : 1
  const rect = clippedRect(buffer, options.rect ?? fullRect(buffer))
  const outline = options.outline ?? true
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      const id = ids[p] as number
      // a pixel of the crop outside the region (rounding at its edge) is not part of the legend
      const inside = x >= rect.x0 && x < rect.x1 && y >= rect.y0 && y < rect.y1
      const rgb = (inside ? colours.get(id)?.rgb : undefined) ?? OUTSIDE_REGION
      const k = p * 4
      const border =
        inside &&
        outline &&
        ((x > 0 && ids[p - 1] !== id) ||
          (y > 0 && ids[p - width] !== id) ||
          (x < width - 1 && ids[p + 1] !== id) ||
          (y < height - 1 && ids[p + width] !== id))
      for (let c = 0; c < 3; c++) {
        const under = options.crop ? (options.crop[k + c] as number) : 0
        const value = under * (1 - tint) + (rgb[c] as number) * tint
        out[k + c] = border ? value * 0.25 : value
      }
      out[k + 3] = 255
    }
  }
  return out
}

/** One line of the legend: the number on the map, its colour, what it is, how much of the region. */
export type LegendRow = {
  n: number
  colour: string
  colourName: string
  kind: IdClassKind
  nodeId?: string
  nodeType?: string
  label: string
  /** Percent of the region, one decimal. */
  percent: number
  /** The world point under its number, null for the sky. */
  world: [number, number, number] | null
}

const CLASS_LABELS: Record<Exclude<IdClassKind, 'node'>, string> = {
  background: 'sky / nothing drawn',
  ground: 'ground',
  glass: 'glass',
  unknown: 'unknown (a drawn mesh with no node)',
}

/**
 * The legend, numbered in share order (1 = the biggest), the non-node classes named like the
 * nodes. `describe` names a node (its name, type, level) the way the host wants it.
 */
export function buildLegend(
  buffer: IdBuffer,
  shares: readonly VisibleShare[],
  colours: ReadonlyMap<number, NamedColour>,
  describe: (share: VisibleShare) => string,
  anchors: ReadonlyMap<number, { x: number; y: number }> = labelAnchors(buffer),
): LegendRow[] {
  return shares.map((share, i) => {
    const colour = colours.get(share.index) ?? CLASS_COLOURS.unknown
    const anchor = anchors.get(share.index)
    const base =
      share.kind === 'node'
        ? describe(share)
        : share.kind === 'glass' && share.nodeId
          ? `glass of ${describe(share)}`
          : share.kind === 'ground' && share.nodeId
            ? `ground (${describe(share)})`
            : CLASS_LABELS[share.kind]
    return {
      n: i + 1,
      colour: colour.hex,
      colourName: colour.name,
      kind: share.kind,
      ...(share.nodeId ? { nodeId: share.nodeId } : {}),
      ...(share.nodeType ? { nodeType: share.nodeType } : {}),
      label: base,
      percent: Math.round(share.share * 1000) / 10,
      world: anchor ? worldAt(buffer, anchor.x, anchor.y) : null,
    }
  })
}

/** A zone as the region test wants it: its polygon in its level's plan, and the level's world-to-plan transform. */
export type ZoneFootprint = {
  id: string
  polygon: readonly (readonly [number, number])[]
  holes?: readonly (readonly (readonly [number, number])[])[]
  /** Column-major 4x4 world -> level-local matrix (three's `Matrix4.elements` of the level's inverse world matrix). */
  worldToLevel: ArrayLike<number>
  /** The level-local height band a point must lie in to be in the room (floor to ceiling). */
  yMin: number
  yMax: number
}

function insidePolygon(x: number, z: number, polygon: readonly (readonly [number, number])[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i] as readonly [number, number]
    const [xj, zj] = polygon[j] as readonly [number, number]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/**
 * Which rooms the region's drawn points stand in, by share of the region's pixels (a sampled
 * `stride`): a zone is not drawn in the capture, so it is read from where the pixels are.
 */
export function zoneShares(
  buffer: IdBuffer,
  zones: readonly ZoneFootprint[],
  rect: PixelRect = fullRect(buffer),
  stride = 2,
): { id: string; share: number }[] {
  if (zones.length === 0) return []
  rect = clippedRect(buffer, rect)
  stride = Math.max(1, Math.floor(stride))
  const hits = new Map<string, number>()
  let samples = 0
  for (let y = Math.floor(rect.y0); y < rect.y1; y += stride) {
    for (let x = Math.floor(rect.x0); x < rect.x1; x += stride) {
      samples++
      const p = y * buffer.width + x
      const wx = buffer.world[p * 3] as number
      if (!Number.isFinite(wx)) continue
      const wy = buffer.world[p * 3 + 1] as number
      const wz = buffer.world[p * 3 + 2] as number
      for (const zone of zones) {
        const m = zone.worldToLevel
        const lx =
          (m[0] as number) * wx + (m[4] as number) * wy + (m[8] as number) * wz + (m[12] as number)
        const ly =
          (m[1] as number) * wx + (m[5] as number) * wy + (m[9] as number) * wz + (m[13] as number)
        const lz =
          (m[2] as number) * wx + (m[6] as number) * wy + (m[10] as number) * wz + (m[14] as number)
        if (ly < zone.yMin || ly > zone.yMax) continue
        if (!insidePolygon(lx, lz, zone.polygon)) continue
        if (zone.holes?.some((hole) => insidePolygon(lx, lz, hole))) continue
        hits.set(zone.id, (hits.get(zone.id) ?? 0) + 1)
      }
    }
  }
  return [...hits.entries()]
    .map(([id, n]) => ({ id, share: n / Math.max(1, samples) }))
    .sort((a, b) => b.share - a.share || (a.id < b.id ? -1 : 1))
}

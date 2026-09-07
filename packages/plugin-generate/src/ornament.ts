/**
 * The ORNAMENT a generated house wears, built from nodes the editor already
 * has (Steve, 2026-09-07: "the gable gingerbread needs more options … random
 * gable vents … vents on stucco ones … sconce lights at doors … fans into
 * the rooms with lights … shutters to craftsman designs").
 *
 * A `block` node is a topology-backed solid, so a louvered vent, a ceiling
 * fan, a sconce lantern or a shutter is one block of several boxes — no
 * catalog mesh needed. The gable pieces are fitted UNDER the rake: every
 * tip is checked against the rake line so nothing stands above the roof.
 */

export type Pt = readonly [number, number]

type Box = { x: number; y: number; z: number; w: number; h: number; d: number }

type Topology = {
  vertices: { id: string; position: [number, number, number] }[]
  edges: { id: string; vertexIds: [string, string] }[]
  faces: { id: string; vertexIds: string[]; materialSlot: string }[]
}

const r = (v: number): number => Math.round(v * 1e4) / 1e4

/** Several axis-aligned boxes (centre + size, block-local metres) as one block topology. */
export function boxesTopology(boxes: readonly Box[]): Topology {
  const t: Topology = { vertices: [], edges: [], faces: [] }
  boxes.forEach((b, i) => {
    const hx = b.w / 2
    const hy = b.h / 2
    const hz = b.d / 2
    const p = (dx: number, dy: number, dz: number): [number, number, number] => [r(b.x + dx * hx), r(b.y + dy * hy), r(b.z + dz * hz)]
    const v = (k: number) => `b${i}v${k}`
    const corners: [number, number, number][] = [p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), p(-1, 1, -1), p(1, 1, -1), p(1, 1, 1), p(-1, 1, 1)]
    corners.forEach((c, k) => t.vertices.push({ id: v(k), position: c }))
    const E: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    E.forEach(([a, c], k) => t.edges.push({ id: `b${i}e${k}`, vertexIds: [v(a), v(c)] }))
    const F: [string, number[]][] = [
      ['bottom', [0, 1, 2, 3]],
      ['top', [4, 7, 6, 5]],
      ['front', [0, 4, 5, 1]],
      ['right', [1, 5, 6, 2]],
      ['back', [2, 6, 7, 3]],
      ['left', [3, 7, 4, 0]],
    ]
    for (const [name, ids] of F) t.faces.push({ id: `b${i}f-${name}`, vertexIds: ids.map(v), materialSlot: 'body' })
  })
  return t
}

/**
 * A louvered gable vent: a frame of four boards around five slats, the
 * whole `w` × `h`, `d` deep, its back on the block's z = 0 plane (place the
 * block ON the wall face, its +z outward).
 */
export function louverVentTopology(w: number, h: number, d = 0.05): Topology {
  const f = 0.045
  const boxes: Box[] = [
    { x: 0, y: h - f / 2, z: d / 2, w, h: f, d },
    { x: 0, y: f / 2, z: d / 2, w, h: f, d },
    { x: -w / 2 + f / 2, y: h / 2, z: d / 2, w: f, h, d },
    { x: w / 2 - f / 2, y: h / 2, z: d / 2, w: f, h, d },
  ]
  const slats = 5
  const inner = h - 2 * f
  for (let i = 0; i < slats; i++) {
    const y = f + (inner * (i + 0.5)) / slats
    boxes.push({ x: 0, y, z: d * 0.35, w: w - 2 * f + 0.004, h: 0.03, d: d * 0.5 })
  }
  return boxesTopology(boxes)
}

/** A ceiling fan: a hub with a down rod and four blades, hanging from y = 0 (the ceiling). */
export function ceilingFanTopology(): Topology {
  const boxes: Box[] = [
    { x: 0, y: -0.09, z: 0, w: 0.03, h: 0.18, d: 0.03 },
    { x: 0, y: -0.24, z: 0, w: 0.22, h: 0.12, d: 0.22 },
  ]
  const blade = { w: 0.6, h: 0.012, d: 0.14 }
  boxes.push({ x: 0.42, y: -0.27, z: 0, ...blade })
  boxes.push({ x: -0.42, y: -0.27, z: 0, ...blade })
  boxes.push({ x: 0, y: -0.27, z: 0.42, w: blade.d, h: blade.h, d: blade.w })
  boxes.push({ x: 0, y: -0.27, z: -0.42, w: blade.d, h: blade.h, d: blade.w })
  return boxesTopology(boxes)
}

/** A wall sconce lantern: a back plate and a lantern body, its back on z = 0 (place on the wall face, +z outward). */
export function sconceTopology(): Topology {
  return boxesTopology([
    { x: 0, y: 0.15, z: 0.01, w: 0.11, h: 0.3, d: 0.02 },
    { x: 0, y: 0.05, z: 0.07, w: 0.05, h: 0.03, d: 0.1 },
    { x: 0, y: 0.19, z: 0.12, w: 0.15, h: 0.24, d: 0.15 },
    { x: 0, y: 0.33, z: 0.12, w: 0.19, h: 0.03, d: 0.19 },
  ])
}

/** A pair of louvered shutters flanking a window `w` wide and `h` tall, each half the window's width; backs on z = 0. */
export function shutterPairTopology(w: number, h: number): Topology {
  const sw = Math.max(0.25, Math.min(0.45, w / 2))
  const d = 0.035
  const boxes: Box[] = []
  for (const side of [-1, 1]) {
    const cx = side * (w / 2 + 0.02 + sw / 2)
    boxes.push({ x: cx, y: h - 0.04, z: d / 2, w: sw, h: 0.08, d })
    boxes.push({ x: cx, y: 0.04, z: d / 2, w: sw, h: 0.08, d })
    boxes.push({ x: cx - sw / 2 + 0.03, y: h / 2, z: d / 2, w: 0.06, h, d })
    boxes.push({ x: cx + sw / 2 - 0.03, y: h / 2, z: d / 2, w: 0.06, h, d })
    boxes.push({ x: cx, y: h / 2, z: d / 2, w: sw - 0.12, h: 0.05, d })
    const slats = Math.max(3, Math.round((h / 2 - 0.15) / 0.09))
    for (const half of [0, 1]) {
      const y0 = half === 0 ? 0.08 : h / 2 + 0.025
      const y1 = half === 0 ? h / 2 - 0.025 : h - 0.08
      for (let i = 0; i < slats; i++) boxes.push({ x: cx, y: y0 + ((y1 - y0) * (i + 0.5)) / slats, z: d * 0.3, w: sw - 0.12, h: 0.02, d: d * 0.6 })
    }
  }
  return boxesTopology(boxes)
}

/**
 * The gable triangle: `halfSpan` from the peak to the eave along the plate,
 * `rise` from the plate to the peak. The rake's height over the plate at a
 * horizontal offset `x` from the centre.
 */
export function rakeHeightAt(halfSpan: number, rise: number, x: number): number {
  return Math.max(0, rise * (1 - Math.abs(x) / halfSpan))
}

/**
 * Fit a Y-frame (post + two braces to tips at ±spread/2, `height` up) under
 * the rake with `clear` under the rake board: shrinks the spread, then the
 * height, until every tip is inside the triangle. Null when nothing fits.
 */
export function fitUnderRake(halfSpan: number, rise: number, wantSpread: number, wantHeight: number, clear = 0.12): { spread: number; height: number } | null {
  let spread = Math.min(wantSpread, halfSpan * 1.2)
  for (let i = 0; i < 8; i++) {
    const tipMax = rakeHeightAt(halfSpan, rise, spread / 2) - clear
    const height = Math.min(wantHeight, tipMax)
    if (height >= 0.3) return { spread: r(spread), height: r(height) }
    spread *= 0.75
  }
  return null
}

export type GableOrnament = 'none' | 'king-post' | 'fan' | 'vent'

/** A style's allowed gable ornaments, one picked per house by the roll. */
export const GABLE_ORNAMENTS_BY_STYLE: Record<string, readonly GableOrnament[]> = {
  farmhouse: ['vent', 'none', 'vent'],
  craftsman: ['fan', 'king-post', 'vent', 'fan'],
  cottage: ['king-post', 'fan', 'vent'],
  ranch: ['vent', 'none'],
  modern: ['none'],
  'modern-mono': ['none'],
}


/* ------------------------------------------------------------------ fascia */

/** A 1x8 finish fascia / rake board — actual 3/4 × 7-1/4 in (the board Bones frames over its 2x6 sub-fascia). */
export const FASCIA_BOARD = { t: 0.019, h: 0.184 } as const

type SegLike = {
  roofType: string
  width: number
  depth: number
  /** Degrees. */
  pitch: number
  wallHeight: number
  wallThickness: number
  overhang: number
  deckThickness: number
}

/** A board between two top-edge points, `h` tall (plumb) and `thick` across `across` (a unit vector in the x-z plane). */
function board(t: Topology, key: string, a: [number, number, number], b: [number, number, number], h: number, across: [number, number], thick: number): void {
  const ax = (across[0] * thick) / 2
  const az = (across[1] * thick) / 2
  const pts: [number, number, number][] = [
    [a[0] - ax, a[1] - h, a[2] - az],
    [b[0] - ax, b[1] - h, b[2] - az],
    [b[0] + ax, b[1] - h, b[2] + az],
    [a[0] + ax, a[1] - h, a[2] + az],
    [a[0] - ax, a[1], a[2] - az],
    [b[0] - ax, b[1], b[2] - az],
    [b[0] + ax, b[1], b[2] + az],
    [a[0] + ax, a[1], a[2] + az],
  ]
  const v = (k: number) => `${key}v${k}`
  pts.forEach((p, k) => t.vertices.push({ id: v(k), position: [r(p[0]), r(p[1]), r(p[2])] }))
  const E: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
  E.forEach(([p, q], k) => t.edges.push({ id: `${key}e${k}`, vertexIds: [v(p), v(q)] }))
  const F: [string, number[]][] = [
    ['bottom', [0, 1, 2, 3]],
    ['top', [4, 7, 6, 5]],
    ['a', [0, 4, 5, 1]],
    ['b', [1, 5, 6, 2]],
    ['c', [2, 6, 7, 3]],
    ['d', [3, 7, 4, 0]],
  ]
  for (const [name, ids] of F) t.faces.push({ id: `${key}f-${name}`, vertexIds: ids.map(v), materialSlot: 'body' })
}

/**
 * The fascia and rake boards a roof segment wears, in the SEGMENT's local
 * frame (place the block at the segment's position with its rotation):
 * a plumb 1x8 along every eave with its top at the deck's top edge, a
 * 1x8 rake board up every gable / shed rake. The eave line is where the
 * viewer's shell puts it — the wall's half thickness plus the overhang
 * out from the plate line, the deck top dropped by that reach on the
 * slope and raised by the deck's plumb thickness (Steve, 2026-09-07:
 * "your presentation roofs don't show the true fascia board which should
 * be 90 degree face"). Null when the segment has no eave to trim.
 */
export function fasciaTopology(seg: SegLike, options: { skipHighEdge?: boolean } = {}): Topology | null {
  const t: Topology = { vertices: [], edges: [], faces: [] }
  const { t: bt, h: bh } = FASCIA_BOARD
  const theta = (seg.pitch * Math.PI) / 180
  const tan = seg.roofType === 'flat' ? 0 : Math.tan(theta)
  const cos = seg.roofType === 'flat' ? 1 : Math.cos(theta) || 1
  const deckExt = seg.wallThickness / 2 + seg.overhang * cos
  const vert = seg.deckThickness / cos
  const wV = seg.width + 2 * deckExt
  const dV = seg.depth + 2 * deckExt
  const eaveY = seg.wallHeight - deckExt * tan + vert
  const out = bt / 2 + 0.002
  const zE = dV / 2 + out
  const xE = wV / 2 + out
  if (seg.roofType === 'gable') {
    const ridgeY = eaveY + (dV / 2) * tan
    board(t, 'e0', [-xE, eaveY, zE], [xE, eaveY, zE], bh, [0, 1], bt)
    board(t, 'e1', [-xE, eaveY, -zE], [xE, eaveY, -zE], bh, [0, 1], bt)
    for (const sx of [-1, 1]) {
      board(t, `r${sx}a`, [sx * xE, eaveY, zE], [sx * xE, ridgeY, 0], bh, [1, 0], bt)
      board(t, `r${sx}b`, [sx * xE, ridgeY, 0], [sx * xE, eaveY, -zE], bh, [1, 0], bt)
    }
  } else if (seg.roofType === 'hip' || seg.roofType === 'flat') {
    const y = seg.roofType === 'flat' ? seg.wallHeight + seg.deckThickness : eaveY
    board(t, 'e0', [-xE, y, zE], [xE, y, zE], bh, [0, 1], bt)
    board(t, 'e1', [-xE, y, -zE], [xE, y, -zE], bh, [0, 1], bt)
    board(t, 'e2', [xE, y, -zE], [xE, y, zE], bh, [1, 0], bt)
    board(t, 'e3', [-xE, y, -zE], [-xE, y, zE], bh, [1, 0], bt)
  } else if (seg.roofType === 'shed') {
    // the low eave at +z, the slope rising to −z
    const highY = eaveY + dV * tan
    board(t, 'e0', [-xE, eaveY, zE], [xE, eaveY, zE], bh, [0, 1], bt)
    if (!options.skipHighEdge) board(t, 'e1', [-xE, highY, -zE], [xE, highY, -zE], bh, [0, 1], bt)
    for (const sx of [-1, 1]) board(t, `r${sx}`, [sx * xE, eaveY, zE], [sx * xE, highY, -zE], bh, [1, 0], bt)
  } else return null
  return t.faces.length > 0 ? t : null
}

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

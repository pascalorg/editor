/**
 * REAL DUCT FITTINGS — the geometry of a radius elbow and a transition.
 *
 * The X-ray drew ducts as boxes meeting in overlapping corners (Steve,
 * 2026-09-09: "your ducts dont have smooth transitions and things they look
 * raw and ugly ... real hvac ducts and transitions that are radius and
 * turn and have correct inlet and outlets"). An elbow member (`shape:
 * 'elbow'`, dims [R, h, w], `turn` ±1) is a rectangle (w in the turn plane,
 * h along local y) or a circle (w = h) swept along a quarter circle of
 * centreline radius R: it enters along local +x and leaves along local
 * turn·z, its corner point at the member's position. A transition member
 * (`shape: 'transition'`, dims [w0, L, h0], `endDims` [w1, h1]) is the
 * frustum between two rectangles L apart along local y.
 *
 * Pure three.js BufferGeometry builders — the renderer mounts one Mesh per
 * fitting (the instanced buckets cannot scale an arc).
 */
import { BufferAttribute, BufferGeometry } from 'three'

/** Points of the elbow's section at parameter θ ∈ [0, π/2], in the elbow's frame. */
function elbowRing(
  radius: number,
  h: number,
  w: number,
  turn: 1 | -1,
  theta: number,
  round: boolean,
  sides: number,
): [number, number, number][] {
  // the arc about C = (−R, 0, turn·R): p(θ) = C + R·(sin θ, 0, −turn·cos θ)
  const cx = -radius
  const cz = turn * radius
  const rx = Math.sin(theta)
  const rz = -turn * Math.cos(theta)
  const px = cx + radius * rx
  const pz = cz + radius * rz
  const out: [number, number, number][] = []
  if (round) {
    const r = w / 2
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2
      const dr = Math.cos(a) * r
      const dy = Math.sin(a) * r
      out.push([px + rx * dr, dy, pz + rz * dr])
    }
    return out
  }
  const hw = w / 2
  const hh = h / 2
  for (const [dr, dy] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ] as const) {
    out.push([px + rx * dr, dy, pz + rz * dr])
  }
  return out
}

function lathe(rings: [number, number, number][][], closeEnds: boolean): BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  const n = rings[0]?.length ?? 0
  for (const ring of rings) for (const p of ring) positions.push(p[0], p[1], p[2])
  for (let k = 0; k + 1 < rings.length; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const a = k * n + i
      const b = k * n + j
      const c = (k + 1) * n + j
      const d = (k + 1) * n + i
      indices.push(a, b, c, a, c, d)
    }
  }
  if (closeEnds && n >= 3) {
    const first = 0
    const last = (rings.length - 1) * n
    for (let i = 1; i + 1 < n; i++) {
      indices.push(first, first + i + 1, first + i)
      indices.push(last, last + i, last + i + 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** A radius elbow: centreline radius `radius`, section h × w (round when `round`), turning `turn`. */
export function elbowGeometry(
  radius: number,
  h: number,
  w: number,
  turn: 1 | -1,
  round = false,
  segments = 8,
): BufferGeometry {
  const sides = round ? 16 : 4
  const rings: [number, number, number][][] = []
  for (let k = 0; k <= segments; k++) {
    rings.push(elbowRing(radius, h, w, turn, (k / segments) * (Math.PI / 2), round, sides))
  }
  return lathe(rings, true)
}

/** The frustum from a w0 × h0 rectangle at local y = −L/2 to w1 × h1 at +L/2. */
export function transitionGeometry(
  w0: number,
  h0: number,
  w1: number,
  h1: number,
  length: number,
): BufferGeometry {
  const ring = (w: number, h: number, y: number): [number, number, number][] => [
    [-w / 2, y, -h / 2],
    [w / 2, y, -h / 2],
    [w / 2, y, h / 2],
    [-w / 2, y, h / 2],
  ]
  return lathe([ring(w0, h0, -length / 2), ring(w1, h1, length / 2)], true)
}

/** The arc length of an elbow of centreline radius `radius`. */
export function elbowLength(radius: number): number {
  return (Math.PI / 2) * radius
}

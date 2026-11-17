/*!
 * Plane-hull, joint weathering and geology adaptation of loverocks (Fjord Stone).
 * @license MIT Copyright (c) 2026 wrong-nebula. See this package's LICENSE.
 * No erosion maps, sky shaders, Wasm or other assets are included.
 */
import { triangulatePlanPolygon } from './earcut'
import {
  ROCK_MAX_FAR_TRIANGLES,
  ROCK_MAX_NEAR_TRIANGLES,
  type RockForm,
  type RockFormInput,
  type RockLevel,
  type RockMesh,
  type RockPoint,
  type RockShapeInput,
} from './rock-form'
import { rockInputProblem } from './rock-outline'

const cross = (a: RockPoint, b: RockPoint, c: RockPoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const area = (p: RockPoint[]) =>
  p.slice(1, -1).reduce((sum, b, i) => sum + cross(p[0]!, b, p[i + 2]!), 0)
const convex = (p: RockPoint[]) =>
  p.every((b, i) => cross(p[(i + p.length - 1) % p.length]!, b, p[(i + 1) % p.length]!) >= -1e-12)

/**
 * A convex outline stays ONE hull. Concave outlines are earcut then greedily merged into
 * convex cells. Every emitted triangle lies in one of those cells: checking just vertices
 * against a concave boundary would not suffice. Cells become adjacent natural masses,
 * not a fan across a missing courtyard. Work here is bounded by the schema's 64 corners.
 */
function cellsOf(outline: RockPoint[]): RockPoint[][] {
  const ring = outline.filter((p, i) => {
    const next = outline[(i + 1) % outline.length]!
    return p[0] !== next[0] || p[1] !== next[1]
  })
  if (area(ring) < 0) ring.reverse()
  if (convex(ring)) return [ring]
  const cells = triangulatePlanPolygon(ring).map((tri) => tri.map((i) => ring[i]!))
  const same = (a: RockPoint, b: RockPoint) => a[0] === b[0] && a[1] === b[1]
  for (let a = 0; a < cells.length; a++) {
    for (let b = a + 1; b < cells.length; b++) {
      const first = cells[a]!
      const second = cells[b]!
      let joined: RockPoint[] | null = null
      for (let i = 0; i < first.length && !joined; i++)
        for (let j = 0; j < second.length; j++) {
          if (
            !same(first[i]!, second[(j + 1) % second.length]!) ||
            !same(first[(i + 1) % first.length]!, second[j]!)
          )
            continue
          const candidate = [
            ...Array.from(
              { length: first.length - 1 },
              (_, k) => first[(i + 1 + k) % first.length]!,
            ),
            ...Array.from(
              { length: second.length - 1 },
              (_, k) => second[(j + 1 + k) % second.length]!,
            ),
          ]
          if (convex(candidate)) joined = candidate
        }
      if (joined) {
        cells[a] = joined
        cells.splice(b, 1)
        b = a
      }
    }
  }
  return cells
}

/** Stateless integer hash: field samples never depend on traversal order or LOD. */
export function rockNoise(seed: number, a: number, b = 0): number {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(a, 0x165667b1) ^ Math.imul(b, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000
}

function topology(shape: RockShapeInput, level: RockLevel) {
  const cells = cellsOf(shape.polygon)
  const edges = cells.reduce((sum, cell) => sum + cell.length, 0)
  const cap = level === 'near' ? ROCK_MAX_NEAR_TRIANGLES : ROCK_MAX_FAR_TRIANGLES
  const desiredRings = shape.rockType === 'stacked' ? 24 : level === 'near' ? 20 : 6
  const rings = Math.max(1, Math.min(desiredRings, Math.floor(cap / (2 * edges))))
  const samples = Math.max(
    edges,
    Math.min(level === 'near' ? 96 : 48, Math.floor(cap / (2 * rings))),
  )
  // Each edge retains its corners, including short edges. Extra samples go to the
  // currently longest interval. This cannot overshoot the total sample budget.
  const counts = cells.map((cell) => cell.map(() => 1))
  const lengths = cells.map((cell) =>
    cell.map((p, i) => {
      const q = cell[(i + 1) % cell.length]!
      return Math.sqrt((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2)
    }),
  )
  for (let allocated = edges; allocated < samples; allocated++) {
    let best = -1
    let ci = 0
    let ei = 0
    for (let c = 0; c < cells.length; c++)
      for (let e = 0; e < cells[c]!.length; e++) {
        const length = lengths[c]![e]! / counts[c]![e]!
        if (length > best) {
          best = length
          ci = c
          ei = e
        }
      }
    counts[ci]![ei]!++
  }
  return {
    cells,
    counts,
    rings,
    triangles: 2 * rings * samples,
    vertices: rings * samples + 2 * cells.length,
  }
}

const clamp = (x: number, low = 0, high = 1) => Math.max(low, Math.min(high, x))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

type Plane = { x: number; z: number; y: number; d: number }

/** Coherent half-spaces, not independent random radial dents. */
function planesOf(seed: number, rounded: number): Plane[] {
  const directions: RockPoint[] = [
    [1, 0],
    [0.8660254037844386, 0.5],
    [0.5, 0.8660254037844386],
    [0, 1],
    [-0.5, 0.8660254037844386],
    [-0.8660254037844386, 0.5],
    [-1, 0],
    [-0.8660254037844386, -0.5],
    [-0.5, -0.8660254037844386],
    [0, -1],
    [0.5, -0.8660254037844386],
    [0.8660254037844386, -0.5],
  ]
  const rz = rockNoise(seed, 70) * 0.5
  const rx = Math.sqrt(1 - rz * rz)
  return directions.map(([x, z], i) => {
    return {
      x: x * rx - z * rz,
      z: x * rz + z * rx,
      y: (rockNoise(seed, i, 3) - 0.35) * 0.5,
      d: 0.78 + 0.16 * rockNoise(seed, i, 4) + rounded * 0.07,
    }
  })
}

function crown(t: number, shoulder: number): number {
  return Math.sqrt(Math.max(0, 1 - ((Math.max(shoulder, t) - shoulder) / (1 - shoulder)) ** 2))
}

function profile(shape: RockShapeInput, t: number): number {
  switch (shape.rockType) {
    case 'fjord':
      return 0.96 - t * 0.05
    case 'granite':
      return 0.97 - t * 0.04
    case 'volcanic':
      return crown(t, 0.43) * (0.94 - t * 0.14)
    case 'river':
      return Math.sqrt(Math.max(0, 1 - ((t - 0.2) / 0.8) ** 2))
    case 'stepping':
      return crown(t, 0.87) * (0.97 - t * 0.03)
    case 'stacked': {
      // Three rounded, progressively smaller stones joined only at narrow contact necks.
      const layer = Math.min(2, Math.floor(t * 3))
      const within = t * 3 - layer
      return (1 - layer * 0.17) * (0.38 + 0.62 * Math.sqrt(Math.max(0, 1 - (2 * within - 1) ** 2)))
    }
    default:
      return crown(t, 0.3) * (0.98 - t * 0.09)
  }
}

function build(input: RockFormInput, level: RockLevel): RockMesh | null {
  if (rockInputProblem(input)) return null
  const layout = topology(input, level)
  const position = new Float32Array(layout.vertices * 3)
  const index = new Uint16Array(layout.triangles * 3)
  const weather = input.weathering ?? 0.35
  const rounded =
    input.rockType === 'river'
      ? 0.95
      : input.form === 'weathered'
        ? 0.55 + weather * 0.4
        : weather * 0.55
  let vertex = 0
  let face = 0
  const push = (x: number, y: number, z: number) => {
    position.set([x, y, z], vertex * 3)
    return vertex++
  }
  const tri = (a: number, b: number, c: number) => {
    index.set([a, b, c], face)
    face += 3
  }
  layout.cells.forEach((cell, cellIndex) => {
    const seed = input.seed + cellIndex * 137
    const centre: RockPoint = [
      cell.reduce((sum, p) => sum + p[0], 0) / cell.length,
      cell.reduce((sum, p) => sum + p[1], 0) / cell.length,
    ]
    const peak = cell[Math.floor(rockNoise(seed, 48) * cell.length)]!
    const extent = Math.max(
      ...cell.map((p) => Math.sqrt((p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2)),
    )
    const angularCrown = input.rockType === 'fjord' || input.rockType === 'granite'
    const planes = planesOf(seed, angularCrown ? rounded * 0.45 : rounded)
    const boundary = cell.flatMap((a, i) => {
      const b = cell[(i + 1) % cell.length]!
      return Array.from({ length: layout.counts[cellIndex]![i]! }, (_, j): RockPoint => {
        const u = j / layout.counts[cellIndex]![i]!
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
      })
    })
    const samples = boundary.length
    const start = vertex
    const peakShift = input.rockType === 'fjord' ? 0.38 : input.rockType === 'granite' ? 0.24 : 0.11
    const topX = centre[0] + (peak[0] - centre[0]) * peakShift
    const topZ = centre[1] + (peak[1] - centre[1]) * peakShift
    const joints = [0.28 + rockNoise(seed, 32) * 0.16, 0.59 + rockNoise(seed, 33) * 0.18]
    for (let ring = 0; ring < layout.rings; ring++) {
      const t = ring / layout.rings
      const shift = peakShift * smooth(0, 0.85, t)
      const cx = centre[0] + (peak[0] - centre[0]) * shift
      const cz = centre[1] + (peak[1] - centre[1]) * shift
      for (const [bx, bz] of boundary) {
        const dx = bx - cx
        const dz = bz - cz
        let hull = 1
        for (const plane of planes) {
          const denominator = (plane.x * dx + plane.z * dz) / extent
          if (denominator > 1e-9) {
            const reach = (plane.d - plane.y * (t - 0.35)) / denominator
            // Smooth minimum rounds plane intersections without ever growing outside the hull.
            const k = (angularCrown ? 0.025 : 0.06) * rounded
            const h = k > 0 ? Math.max(k - Math.abs(hull - reach), 0) / k : 0
            hull = Math.min(hull, reach) - h * h * k * 0.25
          }
        }
        const length = Math.sqrt(dx * dx + dz * dz)
        const nx = dx / length
        const nz = dz / length
        const broad = (nx * nx - nz * nz) * (nx * nz * 2) * (rockNoise(seed, 81) - t)
        const rough =
          input.rockType === 'river' ? 0.012 : input.rockType === 'volcanic' ? 0.07 : 0.025
        let radius = clamp(hull) * profile(input, t) * (1 - rough * (1 + broad))
        if (angularCrown) {
          // Four tilted crown half-spaces share the off-centre summit. Their linear
          // intersections make broad, unequal faces instead of an ellipsoidal dome.
          for (let side = 0; side < 4; side++) {
            const plane = planes[side * 3]!
            const pitch =
              input.rockType === 'fjord'
                ? 0.16 + rockNoise(seed, side, 91) * 0.38
                : 0.1 + rockNoise(seed, side, 91) * 0.18
            const denominator = (pitch * (plane.x * dx + plane.z * dz)) / extent
            if (denominator > 1e-9) {
              const ceiling =
                1 - t + (pitch * (plane.x * (topX - cx) + plane.z * (topZ - cz))) / extent
              radius = Math.min(radius, ceiling / denominator)
            }
          }
        }
        // Two finite joint sets: an oblique seam with widened, weathered lips. The
        // river's old joints are nearly erased; stacked contacts come from the lobes.
        if (input.rockType !== 'stacked') {
          const tilt = rockNoise(seed, 31) * 2 - 1
          const river = input.rockType === 'river'
          const seams = river
            ? [0.32 + rockNoise(seed, 32) * 0.08, 0.64 + rockNoise(seed, 33) * 0.07]
            : joints
          for (const [jointIndex, joint] of seams.entries()) {
            const jx = jointIndex === 0 ? tilt : 1 - Math.abs(tilt)
            const jz = jointIndex === 0 ? 1 - Math.abs(tilt) : -tilt
            const x = (cx + dx * radius - centre[0]) / extent
            const z = (cz + dz * radius - centre[1]) / extent
            const axis = river
              ? t + 0.045 * (nx * tilt + nz * (1 - Math.abs(tilt)))
              : t + (jointIndex === 0 ? 0.29 : -0.34) * (x * jx + z * jz)
            const distance = Math.abs(axis - joint)
            const width = river ? 0.018 + weather * 0.025 : 0.022 + weather * 0.018
            const lip = 1 - smooth(0, width + 0.035, distance)
            const cut = 1 - smooth(0, width, distance)
            const facing = nx * tilt - nz * (1 - Math.abs(tilt))
            const along = x * jz - z * jx
            // End the seam on a face and taper its tip, rather than girdling the
            // whole rock with two horizontal grooves that read as three bulges.
            const gate = river
              ? 0.3 + 0.7 * smooth(-0.5, 0.5, facing)
              : smooth(-0.35, 0.2, facing) *
                (1 - smooth(0.3, 0.8, Math.abs(along - (jointIndex === 0 ? -0.18 : 0.23))))
            const strength =
              input.rockType === 'river' ? 0.015 : input.rockType === 'fjord' ? 0.12 : 0.07
            radius -= gate * strength * (cut + weather * lip * 0.6)
          }
        }
        // Full footprint is buried. All other points are convex combinations of
        // an interior centre and their cell boundary; triangle interiors stay contained.
        radius = ring === 0 ? 1 : clamp(radius, 0.04, 0.99999)
        push(cx + dx * radius, input.footY + (input.topY - input.footY) * t, cz + dz * radius)
      }
    }
    const foot = push(centre[0], input.footY, centre[1])
    const top = push(topX, input.topY, topZ)
    for (let ring = 0; ring < layout.rings - 1; ring++)
      for (let s = 0; s < samples; s++) {
        const a = start + ring * samples + s
        const b = start + ring * samples + ((s + 1) % samples)
        tri(a, a + samples, b)
        tri(b, a + samples, b + samples)
      }
    for (let s = 0; s < samples; s++) {
      tri(foot, start + s, start + ((s + 1) % samples))
      const last = start + (layout.rings - 1) * samples
      tri(top, last + ((s + 1) % samples), last + s)
    }
  })
  return { position, index }
}

export const rockFormV2: RockForm = {
  gen: 2,
  estimate(input) {
    if (rockInputProblem(input))
      return {
        near: { triangles: 0, vertices: 0 },
        far: { triangles: 0, vertices: 0 },
        triangles: 0,
        vertices: 0,
        meshes: 0,
      }
    const near = topology(input, 'near')
    const far = topology(input, 'far')
    return {
      near: { triangles: near.triangles, vertices: near.vertices },
      far: { triangles: far.triangles, vertices: far.vertices },
      triangles: near.triangles + far.triangles,
      vertices: near.vertices + far.vertices,
      meshes: 2,
    }
  },
  build,
}

/**
 * Exact sections of the emitted near triangles, including quad diagonals and the sloped crown.
 * Edge keys, not a positional epsilon, stitch the segments: close seams remain distinct.
 * The optional span makes slicing use the same Float32 Y coordinates as a grounded mesh.
 */
export function rockSectionsV2(
  shape: RockShapeInput,
  fraction: number,
  span = { footY: 0, topY: 1 },
): RockPoint[][] {
  if (!(fraction >= 0 && fraction <= 1)) return []
  const mesh = build({ ...shape, ...span }, 'near')
  if (!mesh) return []
  const y =
    fraction === 0
      ? Math.fround(span.footY)
      : fraction === 1
        ? Math.fround(span.topY)
        : span.footY + (span.topY - span.footY) * fraction
  const points = new Map<string, RockPoint>()
  const links = new Map<string, Set<string>>()
  const edgePoint = (a: number, b: number): string | null => {
    const ay = mesh.position[a * 3 + 1]!
    const by = mesh.position[b * 3 + 1]!
    if ((ay < y && by < y) || (ay > y && by > y) || ay === by) return null
    const t = (y - ay) / (by - ay)
    const key = t === 0 ? `v${a}` : t === 1 ? `v${b}` : `${Math.min(a, b)}:${Math.max(a, b)}`
    points.set(key, [
      mesh.position[a * 3]! + (mesh.position[b * 3]! - mesh.position[a * 3]!) * t,
      mesh.position[a * 3 + 2]! + (mesh.position[b * 3 + 2]! - mesh.position[a * 3 + 2]!) * t,
    ])
    return key
  }
  for (let i = 0; i < mesh.index.length; i += 3) {
    const [a, b, c] = [mesh.index[i]!, mesh.index[i + 1]!, mesh.index[i + 2]!]
    const keys = [
      ...new Set(
        [edgePoint(a, b), edgePoint(b, c), edgePoint(c, a)].filter(
          (key): key is string => key !== null,
        ),
      ),
    ]
    if (keys.length !== 2) continue
    const [from, to] = keys as [string, string]
    if (!links.has(from)) links.set(from, new Set())
    if (!links.has(to)) links.set(to, new Set())
    links.get(from)!.add(to)
    links.get(to)!.add(from)
  }
  const sections: RockPoint[][] = []
  while (links.size) {
    const start = links.keys().next().value!
    const section: RockPoint[] = []
    let at = start
    while (links.has(at)) {
      section.push(points.get(at)!)
      const next = links.get(at)!.values().next().value
      links.delete(at)
      if (!next || next === start) break
      links.get(next)?.delete(at)
      at = next
    }
    if (section.length >= 3) {
      if (area(section) < 0) section.reverse()
      sections.push(section)
    }
  }
  return sections
}

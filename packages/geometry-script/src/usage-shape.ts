import type { GeometryShape } from '@pascal-app/core/schema'
import type * as THREE from 'three'

type Point = [number, number]
type Ring = Point[]

/** What the shape may weigh in the manifest, which rides inline in the node (24 KiB in all). */
export const SHAPE_MAX_BYTES = 10 * 1024

const CELL_M = 0.005
const LAYER_M = 0.02
const MAX_LAYERS = 200
const MAX_CELLS_TOTAL = 48_000_000
const MAX_BANDS = 24
const EDGE_EPSILON = 1e-9

/**
 * Looser and looser readings of the same layers, tried in turn until the shape fits its budget: how
 * much a layer may differ from the band it joins (a share of the band's cells), and how far the
 * traced outline may leave the raster's, in cells.
 */
const LEVELS = [
  { grow: 0.03, simplify: 0.75 },
  { grow: 0.06, simplify: 2 },
  { grow: 0.12, simplify: 4 },
  { grow: 0.25, simplify: 8 },
] as const

type Triangles = { vertices: Float32Array; count: number; kinds: Int8Array }

function collect(meshes: THREE.Mesh[]): Triangles {
  let count = 0
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    count += Math.floor((index ? index.count : position.count) / 3)
  }
  const vertices = new Float32Array(count * 9)
  let at = 0
  const p = [0, 0, 0]
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    const e = mesh.matrixWorld.elements
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()
    const triangles = Math.floor((index ? index.count : position.count) / 3)
    for (let t = 0; t < triangles; t++)
      for (let k = 0; k < 3; k++) {
        const v = index ? index.getX(t * 3 + k) : t * 3 + k
        const x = position.getX(v)
        const y = position.getY(v)
        const z = position.getZ(v)
        p[0] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!
        p[1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!
        p[2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!
        vertices[at++] = p[0]!
        vertices[at++] = p[1]!
        vertices[at++] = p[2]!
      }
  }
  return { vertices, count, kinds: classify(vertices, count) }
}

const OUTWARD = 1
const INWARD = -1
const TWIN = 2
const REDUNDANT = 0

/**
 * How each triangle takes part in the solid fill. A face baked twice, once wound each way (the
 * back faces of a double-sided material, `bakeBackFaces`), says nothing of which side is out: one
 * of the two stands for the pair, to be filled by parity (TWIN), the other is left out. Every other
 * triangle is OUTWARD, or INWARD where its closed shell has a negative signed volume (components
 * are triangles sharing vertices; an open one is left as authored), so that a shell, an inside-out
 * one and shells overlapping inside one mesh all add up as solid.
 */
function classify(vertices: Float32Array, count: number): Int8Array {
  const kinds = new Int8Array(count).fill(OUTWARD)
  const ids = new Map<string, number>()
  const corner = new Int32Array(count * 3)
  for (let t = 0; t < count; t++)
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3
      const key = `${Math.round(vertices[o]! * 1e4)},${Math.round(vertices[o + 1]! * 1e4)},${Math.round(vertices[o + 2]! * 1e4)}`
      let id = ids.get(key)
      if (id === undefined) {
        id = ids.size
        ids.set(key, id)
      }
      corner[t * 3 + k] = id
    }

  const faces = new Map<string, { forward: number; backward: number }>()
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [corner[t * 3]!, corner[t * 3 + 1]!, corner[t * 3 + 2]!]
    const sorted = [a, b, c].sort((x, y) => x - y)
    const key = sorted.join(',')
    // wound as the sorted triple is, or the other way
    const even =
      (a === sorted[0] && b === sorted[1]) ||
      (b === sorted[0] && c === sorted[1]) ||
      (c === sorted[0] && a === sorted[1])
    const entry = faces.get(key) ?? { forward: -1, backward: -1 }
    if (even) entry.forward = entry.forward < 0 ? t : entry.forward
    else entry.backward = entry.backward < 0 ? t : entry.backward
    faces.set(key, entry)
  }
  for (const { forward, backward } of faces.values())
    if (forward >= 0 && backward >= 0) {
      kinds[forward] = TWIN
      kinds[backward] = REDUNDANT
    }

  const parent = Int32Array.from({ length: count }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const owner = new Int32Array(ids.size).fill(-1)
  for (let t = 0; t < count; t++) {
    if (kinds[t] !== OUTWARD) continue
    for (let k = 0; k < 3; k++) {
      const id = corner[t * 3 + k]!
      if (owner[id] === -1) owner[id] = t
      else parent[find(t)] = find(owner[id]!)
    }
  }
  const width = ids.size + 1
  const edges = new Map<number, number>()
  const edge = (t: number, k: number) => {
    const a = corner[t * 3 + k]!
    const b = corner[t * 3 + ((k + 1) % 3)]!
    return Math.min(a, b) * width + Math.max(a, b)
  }
  for (let t = 0; t < count; t++)
    if (kinds[t] === OUTWARD)
      for (let k = 0; k < 3; k++) edges.set(edge(t, k), (edges.get(edge(t, k)) ?? 0) + 1)
  const component = new Map<number, { volume: number; open: boolean }>()
  for (let t = 0; t < count; t++) {
    if (kinds[t] !== OUTWARD) continue
    const entry = component.get(find(t)) ?? { volume: 0, open: false }
    const o = t * 9
    const v = (i: number) => vertices[o + i]!
    entry.volume +=
      (v(0) * (v(4) * v(8) - v(5) * v(7)) -
        v(1) * (v(3) * v(8) - v(5) * v(6)) +
        v(2) * (v(3) * v(7) - v(4) * v(6))) /
      6
    for (let k = 0; k < 3; k++) if ((edges.get(edge(t, k)) ?? 0) % 2 === 1) entry.open = true
    component.set(find(t), entry)
  }
  for (let t = 0; t < count; t++) {
    if (kinds[t] !== OUTWARD) continue
    const entry = component.get(find(t))!
    if (!entry.open && entry.volume < 0) kinds[t] = INWARD
  }
  return kinds
}

/** Sutherland–Hodgman against one half-space of a convex polygon of `stride`-wide vertices. */
function clip(polygon: number[], stride: number, axis: number, bound: number, keepAbove: boolean) {
  const out: number[] = []
  const n = polygon.length / stride
  const side = (v: number) => (keepAbove ? v - bound : bound - v)
  for (let i = 0; i < n; i++) {
    const a = i * stride
    const b = ((i + 1) % n) * stride
    const sa = side(polygon[a + axis]!)
    const sb = side(polygon[b + axis]!)
    if (sa >= 0) for (let k = 0; k < stride; k++) out.push(polygon[a + k]!)
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb)
      for (let k = 0; k < stride; k++)
        out.push(polygon[a + k]! + (polygon[b + k]! - polygon[a + k]!) * t)
    }
  }
  return out
}

type Raster = {
  minX: number
  minZ: number
  cell: number
  nx: number
  nz: number
}

/** Marks every cell the polygon (x, z pairs) touches: a conservative fill, a cell wider than the build at worst. */
function fill(grid: Uint8Array, raster: Raster, polygon: number[]) {
  const { minX, minZ, cell, nx, nz } = raster
  const n = polygon.length / 2
  if (n === 0) return
  let zLow = Number.POSITIVE_INFINITY
  let zHigh = Number.NEGATIVE_INFINITY
  for (let i = 0; i < n; i++) {
    zLow = Math.min(zLow, polygon[i * 2 + 1]!)
    zHigh = Math.max(zHigh, polygon[i * 2 + 1]!)
  }
  const j0 = Math.max(0, Math.floor((zLow - minZ) / cell))
  const j1 = Math.min(nz - 1, Math.max(j0, Math.floor((zHigh - minZ) / cell - EDGE_EPSILON)))
  for (let j = j0; j <= j1; j++) {
    let strip = polygon
    if (j1 > j0) {
      strip = clip(polygon, 2, 1, minZ + j * cell, true)
      strip = clip(strip, 2, 1, minZ + (j + 1) * cell, false)
    }
    let xLow = Number.POSITIVE_INFINITY
    let xHigh = Number.NEGATIVE_INFINITY
    for (let i = 0; i < strip.length; i += 2) {
      xLow = Math.min(xLow, strip[i]!)
      xHigh = Math.max(xHigh, strip[i]!)
    }
    if (xLow > xHigh) continue
    const i0 = Math.max(0, Math.floor((xLow - minX) / cell))
    const i1 = Math.min(nx - 1, Math.max(i0, Math.floor((xHigh - minX) / cell - EDGE_EPSILON)))
    grid.fill(1, j * nx + i0, j * nx + i1 + 1)
  }
}

type Crossings = {
  oriented: Map<number, { x: number; wind: number }[]>
  parity: Map<number, number[]>
}

/**
 * Where a triangle that spans the layer's middle plane crosses the horizontal rays along x through
 * each raster row's centre. An oriented triangle also says which way: a surface whose normal points
 * back along the ray is one the ray enters through, +1; one it leaves through, -1.
 */
function cross(
  vertices: Float32Array,
  o: number,
  kind: number,
  y: number,
  raster: Raster,
  crossings: Crossings,
) {
  const { minZ, cell, nz } = raster
  const ax = vertices[o]!,
    ay = vertices[o + 1]!,
    az = vertices[o + 2]!
  const bx = vertices[o + 3]!,
    by = vertices[o + 4]!,
    bz = vertices[o + 5]!
  const cx = vertices[o + 6]!,
    cy = vertices[o + 7]!,
    cz = vertices[o + 8]!
  const normalX = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
  if (Math.abs(normalX) < 1e-12) return
  const wind = (normalX < 0 ? 1 : -1) * (kind === INWARD ? -1 : 1)
  const at: [number, number][] = []
  const edge = (px: number, py: number, pz: number, qx: number, qy: number, qz: number) => {
    if (py > y === qy > y) return
    const t = (y - py) / (qy - py)
    at.push([px + (qx - px) * t, pz + (qz - pz) * t])
  }
  edge(ax, ay, az, bx, by, bz)
  edge(bx, by, bz, cx, cy, cz)
  edge(cx, cy, cz, ax, ay, az)
  if (at.length !== 2) return
  const [p, q] = at as [[number, number], [number, number]]
  if (p[1] === q[1]) return
  const [zLow, zHigh] = p[1] < q[1] ? [p[1], q[1]] : [q[1], p[1]]
  const j0 = Math.max(0, Math.ceil((zLow - minZ) / cell - 0.5))
  const j1 = Math.min(nz - 1, Math.ceil((zHigh - minZ) / cell - 0.5) - 1)
  for (let j = j0; j <= j1; j++) {
    const z = minZ + (j + 0.5) * cell
    const x = p[0] + ((z - p[1]) / (q[1] - p[1])) * (q[0] - p[0])
    if (kind === TWIN) {
      const row = crossings.parity.get(j)
      if (row) row.push(x)
      else crossings.parity.set(j, [x])
    } else {
      const row = crossings.oriented.get(j)
      if (row) row.push({ x, wind })
      else crossings.oriented.set(j, [{ x, wind }])
    }
  }
}

/**
 * Fills each row between the crossings where the surfaces enclose something: a nonzero winding for
 * the oriented ones, so overlapping solids read as solid, and an odd count for the unoriented pairs.
 */
function solid(grid: Uint8Array, raster: Raster, crossings: Crossings) {
  const { minX, cell, nx } = raster
  const span = (j: number, from: number, to: number) => {
    const i0 = Math.max(0, Math.floor((from - minX) / cell))
    const i1 = Math.min(nx - 1, Math.max(i0, Math.floor((to - minX) / cell - EDGE_EPSILON)))
    grid.fill(1, j * nx + i0, j * nx + i1 + 1)
  }
  for (const [j, row] of crossings.oriented) {
    row.sort((a, b) => a.x - b.x)
    let winding = 0
    for (let k = 0; k + 1 < row.length; k++) {
      winding += row[k]!.wind
      if (winding !== 0) span(j, row[k]!.x, row[k + 1]!.x)
    }
  }
  for (const [j, row] of crossings.parity) {
    row.sort((a, b) => a - b)
    for (let k = 0; k + 1 < row.length; k += 2) span(j, row[k]!, row[k + 1]!)
  }
}

type Layers = {
  grids: Uint8Array
  cells: number
  count: number
  layer: number
  minY: number
  raster: Raster
}

/** The plan footprint of everything the build has in each thin layer of its height. */
function rasterise(triangles: Triangles): Layers | null {
  const { vertices, count, kinds } = triangles
  if (count === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let i = 0; i < vertices.length; i += 3) {
    minX = Math.min(minX, vertices[i]!)
    maxX = Math.max(maxX, vertices[i]!)
    minY = Math.min(minY, vertices[i + 1]!)
    maxY = Math.max(maxY, vertices[i + 1]!)
    minZ = Math.min(minZ, vertices[i + 2]!)
    maxZ = Math.max(maxZ, vertices[i + 2]!)
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return null
  const height = maxY - minY
  const layers = Math.min(MAX_LAYERS, Math.max(1, Math.ceil(height / LAYER_M)))
  const layer = Math.max(height / layers, 1e-6)
  let cell = CELL_M
  const size = (c: number) =>
    (Math.floor((maxX - minX) / c) + 1) * (Math.floor((maxZ - minZ) / c) + 1)
  while (size(cell) * layers > MAX_CELLS_TOTAL) cell *= 1.25
  const nx = Math.floor((maxX - minX) / cell) + 1
  const nz = Math.floor((maxZ - minZ) / cell) + 1
  const cells = nx * nz
  const raster: Raster = { minX, minZ, cell, nx, nz }
  const grids = new Uint8Array(cells * layers)

  const first = new Int32Array(count)
  const last = new Int32Array(count)
  const perLayer = new Int32Array(layers + 1)
  for (let t = 0; t < count; t++) {
    const o = t * 9
    const low = Math.min(vertices[o + 1]!, vertices[o + 4]!, vertices[o + 7]!)
    const high = Math.max(vertices[o + 1]!, vertices[o + 4]!, vertices[o + 7]!)
    first[t] = Math.min(layers - 1, Math.max(0, Math.floor((low - minY) / layer)))
    last[t] = Math.min(
      layers - 1,
      Math.max(first[t]!, Math.floor((high - minY) / layer - EDGE_EPSILON)),
    )
    for (let l = first[t]!; l <= last[t]!; l++) perLayer[l + 1]! += 1
  }
  for (let l = 0; l < layers; l++) perLayer[l + 1]! += perLayer[l]!
  const lists = new Int32Array(perLayer[layers]!)
  const cursor = perLayer.slice(0, layers)
  for (let t = 0; t < count; t++)
    for (let l = first[t]!; l <= last[t]!; l++) lists[cursor[l]!++] = t

  for (let l = 0; l < layers; l++) {
    const grid = grids.subarray(l * cells, (l + 1) * cells)
    const y0 = minY + l * layer
    const y1 = y0 + layer
    const middle = (y0 + y1) / 2
    const crossings: Crossings = { oriented: new Map(), parity: new Map() }
    for (let i = perLayer[l]!; i < perLayer[l + 1]!; i++) {
      if (kinds[lists[i]!] === REDUNDANT) continue
      const o = lists[i]! * 9
      let polygon = [
        vertices[o]!,
        vertices[o + 1]!,
        vertices[o + 2]!,
        vertices[o + 3]!,
        vertices[o + 4]!,
        vertices[o + 5]!,
        vertices[o + 6]!,
        vertices[o + 7]!,
        vertices[o + 8]!,
      ]
      const low = Math.min(polygon[1]!, polygon[4]!, polygon[7]!)
      const high = Math.max(polygon[1]!, polygon[4]!, polygon[7]!)
      if (low <= middle && high > middle)
        cross(vertices, o, kinds[lists[i]!]!, middle, raster, crossings)
      if (low < y0) polygon = clip(polygon, 3, 1, y0, true)
      if (high > y1) polygon = clip(polygon, 3, 1, y1, false)
      const plan: number[] = []
      for (let k = 0; k < polygon.length; k += 3) plan.push(polygon[k]!, polygon[k + 2]!)
      fill(grid, raster, plan)
    }
    solid(grid, raster, crossings)
  }
  return { grids, cells, count: layers, layer, minY, raster }
}

type Band = { from: number; to: number; cells: Uint8Array }

/** Runs of layers whose footprints differ by less than `grow` of the run's: a run reads as the union of its layers. */
function band(layers: Layers, grow: number): Band[] {
  const { grids, cells, count } = layers
  const bands: Band[] = []
  let current: Band | null = null
  let area = 0
  for (let l = 0; l < count; l++) {
    const grid = grids.subarray(l * cells, (l + 1) * cells)
    let layerArea = 0
    for (let i = 0; i < cells; i++) layerArea += grid[i]!
    if (layerArea === 0) {
      current = null
      continue
    }
    if (current) {
      let added = 0
      let missing = 0
      for (let i = 0; i < cells; i++) {
        if (grid[i] && !current.cells[i]) added++
        else if (!grid[i] && current.cells[i]) missing++
      }
      const allowed = Math.max(4, grow * area)
      if (added <= allowed && missing <= allowed) {
        for (let i = 0; i < cells; i++) if (grid[i]) current.cells[i] = 1
        current.to = l
        area += added
        continue
      }
    }
    current = { from: l, to: l, cells: Uint8Array.from(grid) }
    area = layerArea
    bands.push(current)
  }
  return bands
}

const signedArea = (ring: Ring) => {
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1]
  return a / 2
}

/** The boundary of the filled cells as closed rings, filled side on the left: outer rings turn counter-clockwise, holes clockwise. */
function trace(cells: Uint8Array, raster: Raster): Ring[] {
  const { nx, nz } = raster
  const filled = (i: number, j: number) =>
    i >= 0 && j >= 0 && i < nx && j < nz && cells[j * nx + i] === 1
  const next = new Map<number, number[]>()
  const key = (i: number, j: number) => j * (nx + 1) + i
  const add = (i0: number, j0: number, i1: number, j1: number) => {
    const k = key(i0, j0)
    const list = next.get(k)
    if (list) list.push(key(i1, j1))
    else next.set(k, [key(i1, j1)])
  }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      if (!cells[j * nx + i]) continue
      if (!filled(i, j - 1)) add(i, j, i + 1, j)
      if (!filled(i + 1, j)) add(i + 1, j, i + 1, j + 1)
      if (!filled(i, j + 1)) add(i + 1, j + 1, i, j + 1)
      if (!filled(i - 1, j)) add(i, j + 1, i, j)
    }
  const rings: Ring[] = []
  const w = nx + 1
  for (const [start] of next) {
    while (next.get(start)?.length) {
      const ring: Ring = []
      let at = start
      let heading: number | null = null
      do {
        const options = next.get(at)
        if (!options?.length) break
        const here = [at % w, Math.floor(at / w)]
        // Take the leftmost turn so cells touching at a corner stay separate rings.
        let pick = 0
        if (options.length > 1) {
          let best = -Infinity
          options.forEach((to, index) => {
            const dx = (to % w) - here[0]!
            const dz = Math.floor(to / w) - here[1]!
            const angle = Math.atan2(dz, dx)
            const turn =
              heading === null ? 0 : ((angle - heading + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
            if (turn > best) {
              best = turn
              pick = index
            }
          })
        }
        const to = options.splice(pick, 1)[0]!
        ring.push([here[0]!, here[1]!])
        heading = Math.atan2(Math.floor(to / w) - here[1]!, (to % w) - here[0]!)
        at = to
      } while (at !== start)
      if (ring.length >= 4) rings.push(ring)
    }
  }
  return rings
}

/** Douglas–Peucker over a closed ring. */
function simplify(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring
  const distance = (p: Point, a: Point, b: Point) => {
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const length = Math.hypot(dx, dz)
    return length < 1e-12
      ? Math.hypot(p[0] - a[0], p[1] - a[1])
      : Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / length
  }
  const keep = new Array<boolean>(ring.length).fill(false)
  const run = (from: number, to: number) => {
    let far = -1
    let best = tolerance
    for (let i = from + 1; i < to; i++) {
      const d = distance(ring[i]!, ring[from]!, ring[to % ring.length]!)
      if (d > best) {
        best = d
        far = i
      }
    }
    if (far < 0) return
    keep[far] = true
    run(from, far)
    run(far, to)
  }
  let farthest = 0
  let reach = -1
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i]![0] - ring[0]![0], ring[i]![1] - ring[0]![1])
    if (d > reach) {
      reach = d
      farthest = i
    }
  }
  keep[0] = true
  keep[farthest] = true
  run(0, farthest)
  run(farthest, ring.length)
  const out = ring.filter((_, i) => keep[i])
  return out.length >= 3 ? out : ring
}

function inside(point: Point, ring: Ring) {
  let result = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result
  }
  return result
}

type Shaped = GeometryShape['bands'][number]['polygons']

const mm = (v: number) => Math.round(v * 1000) / 1000

function polygons(cells: Uint8Array, raster: Raster, simplifyCells: number): Shaped {
  const { minX, minZ, cell } = raster
  const world = (ring: Ring): Ring => ring.map(([i, j]) => [minX + i * cell, minZ + j * cell])
  const rings = trace(cells, raster)
    .map((ring) =>
      world(
        simplify(
          ring.map(([i, j]) => [i, j] as Point),
          simplifyCells,
        ),
      ).map(([x, z]) => [mm(x), mm(z)] as Point),
    )
    .filter((ring) => ring.length >= 3 && Math.abs(signedArea(ring)) >= 2 * cell * cell)
  const outers = rings.filter((ring) => signedArea(ring) > 0)
  const holes = rings.filter((ring) => signedArea(ring) < 0)
  const result = outers.map((outer) => ({ outer, holes: [] as Ring[] }))
  for (const hole of holes) {
    const owner = result
      .filter((candidate) => inside(hole[0]!, candidate.outer))
      .sort((a, b) => Math.abs(signedArea(a.outer)) - Math.abs(signedArea(b.outer)))[0]
    if (owner) owner.holes.push(hole)
  }
  return result.map(({ outer, holes: h }) => (h.length ? { outer, holes: h } : { outer }))
}

const bytes = (shape: GeometryShape) => new TextEncoder().encode(JSON.stringify(shape)).byteLength

/** One box over the whole build: the last resort when nothing finer fits the budget. */
function box(bounds: {
  min: [number, number, number]
  max: [number, number, number]
}): GeometryShape {
  return {
    tolerance: mm(Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2])),
    bands: [
      {
        y0: mm(bounds.min[1]),
        y1: mm(bounds.max[1]),
        polygons: [
          {
            outer: [
              [mm(bounds.min[0]), mm(bounds.min[2])],
              [mm(bounds.max[0]), mm(bounds.min[2])],
              [mm(bounds.max[0]), mm(bounds.max[2])],
              [mm(bounds.min[0]), mm(bounds.max[2])],
            ],
          },
        ],
      },
    ],
  }
}

/** Adjacent bands merged, the pair that adds the fewest cells first, until `target` remain. */
function merged(bands: Band[], target: number): Band[] {
  const out = bands.map((b) => ({ ...b, cells: Uint8Array.from(b.cells) }))
  while (out.length > Math.max(1, target)) {
    let best = 0
    let least = Number.POSITIVE_INFINITY
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i]!
      const b = out[i + 1]!
      let extra = 0
      for (let k = 0; k < a.cells.length; k++) if (a.cells[k] !== b.cells[k]) extra++
      // a taller gap between them costs more, so equal differences merge the nearer pair first
      const cost = extra + (b.from - a.to - 1) * 0.5
      if (cost < least) {
        least = cost
        best = i
      }
    }
    const a = out[best]!
    const b = out[best + 1]!
    for (let k = 0; k < a.cells.length; k++) if (b.cells[k]) a.cells[k] = 1
    a.to = b.to
    out.splice(best + 1, 1)
  }
  return out
}

/** The cells within `radius` cells of a filled one (a separable box dilation, by prefix sums). */
function dilate(cells: Uint8Array, raster: Raster, radius: number): Uint8Array {
  const { nx, nz } = raster
  const pass = (
    source: Uint8Array,
    lines: number,
    length: number,
    at: (line: number, i: number) => number,
  ) => {
    const out = new Uint8Array(source.length)
    const sums = new Int32Array(length + 1)
    for (let line = 0; line < lines; line++) {
      for (let i = 0; i < length; i++) sums[i + 1] = sums[i]! + source[at(line, i)]!
      for (let i = 0; i < length; i++)
        out[at(line, i)] =
          sums[Math.min(length, i + radius + 1)]! - sums[Math.max(0, i - radius)]! > 0 ? 1 : 0
    }
    return out
  }
  const across = pass(cells, nz, nx, (line, i) => line * nx + i)
  return pass(across, nx, nz, (line, i) => i * nx + line)
}

const shapeOf = (layers: Layers, bands: Band[], simplifyCells: number): GeometryShape => ({
  tolerance: mm(layers.raster.cell * (1 + simplifyCells)),
  bands: bands.map((b) => ({
    y0: mm(layers.minY + b.from * layers.layer),
    y1: mm(layers.minY + (b.to + 1) * layers.layer),
    polygons: polygons(b.cells, layers.raster, simplifyCells),
  })),
})

/**
 * What the build occupies in plan at each height, for the usage checks: the footprint of everything
 * it has in each 2 cm layer, runs of near-identical layers read as bands, each band traced to
 * outlines. The fill is conservative, so an outline is never inside the build and at worst a cell
 * (5 mm) outside it, plus the simplification; `tolerance` states that bound. A build too intricate
 * for its budget is read ever more coarsely, bands merged and outlines simplified, and in the end as
 * one box. Frames are the meshes' world frame, so call it on a built object in the artifact's frame.
 * Null for an empty one.
 */
export function readUsageShape(meshes: THREE.Mesh[]): GeometryShape | null {
  const layers = rasterise(collect(meshes))
  if (!layers) return null
  const fits = (shape: GeometryShape) => bytes(shape) <= SHAPE_MAX_BYTES
  let finest: Band[] | null = null
  for (const level of LEVELS) {
    const bands = band(layers, level.grow)
    finest ??= bands
    if (bands.length > MAX_BANDS) continue
    const shape = shapeOf(layers, bands, level.simplify)
    if (fits(shape)) return shape
  }
  // Too intricate to trace within the budget (foliage, a screen of slats): thicken it until nearby
  // pieces merge into blobs, which only ever adds to the shape, and say so in the tolerance.
  const loosest = LEVELS.at(-1)!
  for (const radius of [0, 2, 4, 8, 16, 32]) {
    const base = band(layers, loosest.grow).map((b) => ({
      ...b,
      cells: radius ? dilate(b.cells, layers.raster, radius) : b.cells,
    }))
    for (const target of [MAX_BANDS, 12, 6, 3, 1]) {
      const bands = merged(base, target)
      for (const simplifyCells of [loosest.simplify, loosest.simplify * 2, loosest.simplify * 4]) {
        const shape = shapeOf(layers, bands, simplifyCells + radius)
        if (fits(shape)) return shape
      }
    }
  }
  const { raster } = layers
  return box({
    min: [raster.minX, layers.minY, raster.minZ],
    max: [
      raster.minX + raster.nx * raster.cell,
      layers.minY + layers.count * layers.layer,
      raster.minZ + raster.nz * raster.cell,
    ],
  })
}

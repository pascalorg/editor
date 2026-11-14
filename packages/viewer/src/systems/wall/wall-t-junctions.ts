import * as THREE from 'three'

const T_JUNCTION_EPSILON = 1e-5
// CSG T-junction vertices sit within Float32 rounding (≲3e-7 m) of the edge
// they split; finely tessellated arch vertices can sit ~1e-5 m off a chord
// and must not be pulled onto it.
const ON_EDGE_EPSILON = 1e-6
const WELD_GRID = 1e-6

type Point = [number, number, number]

/**
 * Splits every triangle whose edge carries another triangle's vertex, so the
 * neighbours share that vertex instead of meeting at a T-junction. CSG cuts and
 * finish-band splits leave T-junctions on wall faces: they look closed at full
 * float precision, but crack open into dotted light leaks once a GLB bake
 * quantizes positions.
 *
 * Each piece keeps its source triangle's material group, so the repair never
 * reclassifies a face. Geometry without T-junctions is returned untouched;
 * otherwise the result is non-indexed and position-only (callers recompute
 * normals) and the input is disposed.
 */
export function repairWallTJunctions(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()
  const cornerCount = index ? index.count : (position?.count ?? 0)
  if (!position || cornerCount < 3) return geometry

  // Welded vertex table: every corner snaps to one representative so that
  // edges sharing a vertex share its exact coordinates.
  const welded = new Map<string, number>()
  const points: Point[] = []
  const corners = new Uint32Array(cornerCount)
  for (let corner = 0; corner < cornerCount; corner += 1) {
    const vertex = index ? index.getX(corner) : corner
    const x = position.getX(vertex)
    const y = position.getY(vertex)
    const z = position.getZ(vertex)
    const key = `${Math.round(x / WELD_GRID)},${Math.round(y / WELD_GRID)},${Math.round(z / WELD_GRID)}`
    let id = welded.get(key)
    if (id === undefined) {
      id = points.length
      points.push([x, y, z])
      welded.set(key, id)
    }
    corners[corner] = id
  }

  const byX = points.map((_, id) => id).sort((a, b) => points[a]![0] - points[b]![0])
  const xs = byX.map((id) => points[id]![0])

  const pointsOnEdge = (from: number, to: number): number[] => {
    const p = points[from]!
    const q = points[to]!
    const dx = q[0] - p[0]
    const dy = q[1] - p[1]
    const dz = q[2] - p[2]
    const lengthSq = dx * dx + dy * dy + dz * dz
    if (lengthSq < T_JUNCTION_EPSILON * T_JUNCTION_EPSILON) return []
    const minT = T_JUNCTION_EPSILON / Math.sqrt(lengthSq)
    const maxX = Math.max(p[0], q[0]) + T_JUNCTION_EPSILON

    const hits: Array<{ id: number; t: number }> = []
    for (let k = lowerBound(xs, Math.min(p[0], q[0]) - T_JUNCTION_EPSILON); k < xs.length; k += 1) {
      if (xs[k]! > maxX) break
      const id = byX[k]!
      if (id === from || id === to) continue
      const v = points[id]!
      const t = ((v[0] - p[0]) * dx + (v[1] - p[1]) * dy + (v[2] - p[2]) * dz) / lengthSq
      if (t <= minT || t >= 1 - minT) continue
      const ox = p[0] + dx * t - v[0]
      const oy = p[1] + dy * t - v[1]
      const oz = p[2] + dz * t - v[2]
      if (ox * ox + oy * oy + oz * oz > ON_EDGE_EPSILON * ON_EDGE_EPSILON) continue
      hits.push({ id, t })
    }
    return hits.sort((a, b) => a.t - b.t).map((hit) => hit.id)
  }

  const edgePoints: Array<[number[], number[], number[]] | null> = []
  let found = false
  for (let corner = 0; corner + 2 < cornerCount; corner += 3) {
    const a = corners[corner]!
    const b = corners[corner + 1]!
    const c = corners[corner + 2]!
    const ab = pointsOnEdge(a, b)
    const bc = pointsOnEdge(b, c)
    const ca = pointsOnEdge(c, a)
    const split = ab.length > 0 || bc.length > 0 || ca.length > 0
    edgePoints.push(split ? [ab, bc, ca] : null)
    found ||= split
  }
  if (!found) return geometry

  const out: number[] = []
  const push = (id: number) => {
    const point = points[id]!
    out.push(point[0], point[1], point[2])
  }
  // Splits at an edge point by joining it to the opposite corner. The new edge
  // is interior, so it carries no points, and no vertex is ever invented.
  const emit = (a: number, b: number, c: number, ab: number[], bc: number[], ca: number[]) => {
    if (ab.length === 0 && bc.length === 0 && ca.length === 0) {
      push(a)
      push(b)
      push(c)
    } else if (ab.length === 0) {
      if (bc.length > 0) emit(b, c, a, bc, ca, ab)
      else emit(c, a, b, ca, ab, bc)
    } else {
      const mid = ab.length >> 1
      const p = ab[mid]!
      emit(a, p, c, ab.slice(0, mid), [], ca)
      emit(p, b, c, ab.slice(mid + 1), bc, [])
    }
  }

  const repaired = new THREE.BufferGeometry()
  const groups = geometry.groups.length
    ? geometry.groups
    : [{ start: 0, count: cornerCount, materialIndex: undefined }]
  for (const group of groups) {
    const start = out.length / 3
    const end = Math.min(group.start + group.count, cornerCount)
    for (let corner = group.start; corner + 2 < end; corner += 3) {
      const [ab, bc, ca] = edgePoints[corner / 3] ?? [[], [], []]
      emit(corners[corner]!, corners[corner + 1]!, corners[corner + 2]!, ab, bc, ca)
    }
    if (geometry.groups.length) {
      repaired.addGroup(start, out.length / 3 - start, group.materialIndex)
    }
  }
  repaired.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  geometry.dispose()
  return repaired
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (values[mid]! < target) low = mid + 1
    else high = mid
  }
  return low
}

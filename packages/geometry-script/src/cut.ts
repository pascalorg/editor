import { difference, type MultiPolygon, type Ring } from '@pascal-app/core/polygon-boolean'
import * as THREE from 'three'
import { Brush, Evaluator, HOLLOW_INTERSECTION, INTERSECTION } from 'three-bvh-csg'

/**
 * The finish a host's build is cut to, as an area in a plane and the axis its prism runs along: a
 * room's floor in plan (u = x, v = z, the prism along y) or a wall face (u = x, v = y, the prism
 * along z), each without its holes.
 */
export type HostRegion = { axis: 'y' | 'z'; area: MultiPolygon }

type Rect = { x0: number; y0: number; x1: number; y1: number }

const isPoint = (point: unknown): point is [number, number] =>
  Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
const isRing = (ring: unknown): ring is Ring =>
  Array.isArray(ring) && ring.length >= 3 && ring.every(isPoint)
const isRect = (rect: unknown): rect is Rect =>
  rect !== null &&
  typeof rect === 'object' &&
  (['x0', 'y0', 'x1', 'y1'] as const).every((key) =>
    Number.isFinite((rect as Record<string, unknown>)[key]),
  )
const rectRing = ({ x0, y0, x1, y1 }: Rect): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
]
const pieces = (rings: Ring[]): MultiPolygon => rings.map((outer) => ({ outer, holes: [] }))

/**
 * The region a build for these inputs is cut to: a floor's `polygon` less its `holes`, or a wall
 * face's `outline` less its `holes` (rectangles); null when the inputs describe neither.
 */
export function hostRegion(inputs: Record<string, unknown>): HostRegion | null {
  const holes: unknown[] = Array.isArray(inputs.holes) ? inputs.holes : []
  if (isRing(inputs.polygon)) {
    return { axis: 'y', area: difference(inputs.polygon, pieces(holes.filter(isRing))) }
  }
  if (isRect(inputs.outline)) {
    const rings = holes.filter(isRect).map(rectRing)
    return { axis: 'z', area: difference(rectRing(inputs.outline), pieces(rings)) }
  }
  return null
}

/** A mesh this close inside the boundary, or touching it, is inside: no cut for a plank laid to the edge. */
const EDGE = 1e-5
/** The prism outreaches the build along its axis, so no face of the build lies on its ends. */
const MARGIN = 1

type Span = { u0: number; u1: number; v0: number; v1: number }

function planeSpan(box: THREE.Box3, axis: HostRegion['axis']): Span {
  return axis === 'y'
    ? { u0: box.min.x, u1: box.max.x, v0: box.min.z, v1: box.max.z }
    : { u0: box.min.x, u1: box.max.x, v0: box.min.y, v1: box.max.y }
}

/** Whether the segment a→b passes through the closed rectangle (Liang–Barsky). */
function segmentMeetsSpan(a: [number, number], b: [number, number], span: Span): boolean {
  let t0 = 0
  let t1 = 1
  const du = b[0] - a[0]
  const dv = b[1] - a[1]
  for (const [p, q] of [
    [-du, a[0] - span.u0],
    [du, span.u1 - a[0]],
    [-dv, a[1] - span.v0],
    [dv, span.v1 - a[1]],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false
    } else if (p < 0) {
      t0 = Math.max(t0, q / p)
    } else {
      t1 = Math.min(t1, q / p)
    }
    if (t0 > t1) return false
  }
  return true
}

/** Even–odd over every ring: the region's pieces are disjoint and their holes lie inside them. */
function regionHolds(area: MultiPolygon, [u, v]: [number, number]): boolean {
  let inside = false
  for (const { outer, holes } of area) {
    for (const ring of [outer, ...holes]) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ui, vi] = ring[i]!
        const [uj, vj] = ring[j]!
        if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside
      }
    }
  }
  return inside
}

/**
 * Where a mesh whose bounds span `span` stands against the region. No boundary through its bounds
 * (shrunk by EDGE) means it is wholly in or wholly out, which its centre tells; else it is cut.
 */
function placement(area: MultiPolygon, span: Span): 'inside' | 'outside' | 'boundary' {
  const shrink = (lo: number, hi: number) => {
    const by = Math.min(EDGE, (hi - lo) / 2)
    return [lo + by, hi - by] as const
  }
  const [u0, u1] = shrink(span.u0, span.u1)
  const [v0, v1] = shrink(span.v0, span.v1)
  const inner = { u0, u1, v0, v1 }
  for (const { outer, holes } of area) {
    for (const ring of [outer, ...holes]) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        if (segmentMeetsSpan(ring[j]!, ring[i]!, inner)) return 'boundary'
      }
    }
  }
  return regionHolds(area, [(u0 + u1) / 2, (v0 + v1) / 2]) ? 'inside' : 'outside'
}

/** The region as a closed prism spanning `extent` (plus MARGIN) along its axis, in the build's frame. */
function regionPrism({ axis, area }: HostRegion, extent: THREE.Box3): THREE.BufferGeometry {
  // A floor's plan v is world z; the shape is drawn at -z so turning it up (-90° about x) lands it at +z.
  const flip = axis === 'y' ? -1 : 1
  const shapes = area.map(({ outer, holes }) => {
    const shape = new THREE.Shape(outer.map(([u, v]) => new THREE.Vector2(u, flip * v)))
    shape.holes = holes.map(
      (hole) => new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, flip * v))),
    )
    return shape
  })
  const from = (axis === 'y' ? extent.min.y : extent.min.z) - MARGIN
  const to = (axis === 'y' ? extent.max.y : extent.max.z) + MARGIN
  const prism = new THREE.ExtrudeGeometry(shapes, { depth: to - from, bevelEnabled: false })
  prism.clearGroups()
  if (axis === 'y') prism.rotateX(-Math.PI / 2).translate(0, from, 0)
  else prism.translate(0, 0, from)
  return prism
}

/**
 * The prism as a brush carrying every attribute the mesh has, so the cut faces it adds keep the
 * mesh's layout. Attributes the prism has no value for are filled: white for `color`, so the
 * material's own colour shows on the cut, zero for the rest.
 */
function prismBrush(
  prism: THREE.BufferGeometry,
  geometry: THREE.BufferGeometry,
  brushes: Map<string, Brush>,
): Brush {
  const names = Object.keys(geometry.attributes).sort()
  const key = names.map((name) => `${name}:${geometry.getAttribute(name).itemSize}`).join(',')
  const cached = brushes.get(key)
  if (cached) return cached
  const shaped = prism.clone()
  for (const name of Object.keys(shaped.attributes)) {
    if (!names.includes(name)) shaped.deleteAttribute(name)
  }
  const count = shaped.getAttribute('position').count
  for (const name of names) {
    if (shaped.getAttribute(name)) continue
    const { itemSize } = geometry.getAttribute(name)
    const values = new Float32Array(count * itemSize).fill(name === 'color' ? 1 : 0)
    shaped.setAttribute(name, new THREE.BufferAttribute(values, itemSize))
  }
  const brush = new Brush(shaped)
  brushes.set(key, brush)
  return brush
}

const triangles = (geometry: THREE.BufferGeometry) =>
  Math.floor((geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0) / 3)

/**
 * Cuts each visible mesh of a host's build to its region: whole inside, it is kept untouched;
 * whole outside or in a hole, it is dropped; across the boundary, it is intersected with the
 * region's prism (a closed mesh gains the cut faces, an open one is trimmed), keeping its
 * material, and dropped if nothing is left. `extent` is the build's visible bounds.
 */
export function cutToRegion(meshes: THREE.Mesh[], region: HostRegion, extent: THREE.Box3) {
  const box = new THREE.Box3()
  let prism: THREE.BufferGeometry | undefined
  const brushes = new Map<string, Brush>()
  const evaluator = new Evaluator()
  for (const mesh of meshes) {
    mesh.geometry.computeBoundingBox()
    box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
    const where = placement(region.area, planeSpan(box, region.axis))
    if (where === 'inside') continue
    if (where === 'outside') {
      mesh.removeFromParent()
      continue
    }
    prism ??= regionPrism(region, extent)
    const target = prismBrush(prism, mesh.geometry, brushes)
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    target.material = materials[0]!
    const source = new Brush(mesh.geometry.clone(), mesh.material)
    source.matrixWorld.copy(mesh.matrixWorld)
    source.prepareGeometry()
    // `prepareGeometry` maps its edges; its types leave the map out.
    const { halfEdges } = source.geometry as unknown as {
      halfEdges: { isFullyConnected(): boolean }
    }
    const closed = halfEdges.isFullyConnected()
    evaluator.attributes = Object.keys(mesh.geometry.attributes)
    const result = evaluator.evaluate(source, target, closed ? INTERSECTION : HOLLOW_INTERSECTION)
    source.geometry.dispose()
    if (triangles(result.geometry) === 0) {
      mesh.removeFromParent()
      continue
    }
    const kept = result.material as THREE.Material[]
    mesh.geometry = result.geometry
    if (kept.length === 1) {
      mesh.geometry.clearGroups()
      mesh.material = kept[0]!
    } else mesh.material = kept
  }
  prism?.dispose()
  for (const brush of brushes.values()) brush.geometry.dispose()
}

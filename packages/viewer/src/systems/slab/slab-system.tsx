import {
  getRenderableSlabPolygon,
  type PolygonPoint2D,
  pointInPolygon2D,
  polygonsIntersect,
  type SlabNode,
  type SlabPolygonContext,
} from '@pascal-app/core'
import * as THREE from 'three'
import { subtractPolygonsFromPolygon } from '../../lib/polygon-union'
import { mergeSurfaceHolePolygons } from '../surface-hole-geometry'

// ============================================================================
// SLAB GEOMETRY GENERATORS
// ============================================================================

/**
 * Generates slab geometry from polygon. `context` carries the slab's level
 * neighbourhood (walls + sibling slabs) driving the per-edge render offsets —
 * see `getRenderableSlabPolygon`. Branches on the explicit `recessed` intent:
 * a recessed slab is an open shell (pool), everything else a solid occupying
 * `[elevation − thickness, elevation]`.
 */
export function generateSlabGeometry(
  slabNode: SlabNode,
  context: SlabPolygonContext,
): THREE.BufferGeometry {
  return slabNode.recessed
    ? generatePoolGeometry(slabNode, context)
    : generateSolidSlabGeometry(slabNode, context)
}

// Earcut normalizes cap triangulation regardless of input winding, but the side
// walls below assume a CCW contour (the unflipped quad's right-hand normal faces
// outward only for CCW). outsetPolygon and the slab tool preserve the drawn
// winding, so a CW-drawn slab gets inward-facing walls that FrontSide culls and
// the slab reads as see-through from the front. Normalize to CCW first.
function ensureCounterClockwisePolygon(polygon: Array<[number, number]>): Array<[number, number]> {
  let area2 = 0
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length
    area2 += polygon[i]![0] * polygon[j]![1] - polygon[j]![0] * polygon[i]![1]
  }
  return area2 < 0 ? [...polygon].reverse() : polygon
}

function isStrictInteriorHole(contour: PolygonPoint2D[], hole: PolygonPoint2D[]) {
  return (
    hole.every((point) => pointInPolygon2D(point, contour, { includeBoundary: false })) &&
    !polygonsIntersect(contour, hole)
  )
}

function affectsContour(contour: PolygonPoint2D[], hole: PolygonPoint2D[]) {
  return (
    polygonsIntersect(contour, hole) ||
    hole.some((point) => pointInPolygon2D(point, contour, { includeBoundary: false })) ||
    contour.some((point) => pointInPolygon2D(point, hole, { includeBoundary: false }))
  )
}

function buildSlabRegions(contour: PolygonPoint2D[], holes: PolygonPoint2D[][]) {
  const containedHoles: PolygonPoint2D[][] = []
  const edgeCutouts: PolygonPoint2D[][] = []

  for (const hole of holes) {
    if (hole.length < 3) continue
    if (isStrictInteriorHole(contour, hole)) containedHoles.push(hole)
    else if (affectsContour(contour, hole)) edgeCutouts.push(hole)
  }

  const contours =
    edgeCutouts.length > 0 ? subtractPolygonsFromPolygon(contour, edgeCutouts) : [contour]

  return contours.map((regionContour) => ({
    contour: regionContour,
    holes: containedHoles.filter((hole) => isStrictInteriorHole(regionContour, hole)),
  }))
}

/**
 * Solid slab occupying `[elevation − thickness, elevation]`: the top cap is
 * the walking surface at `elevation`, the body grows downward by `thickness`.
 *
 * Built directly in 3D (Y-up) rather than via ExtrudeGeometry so the hole side
 * walls can be emitted double-sided. The slab material is forced to FrontSide
 * (DoubleSide on the floor-role NodeMaterial poisons the MRT scene pass — see
 * nodes/slab/geometry.ts), and ExtrudeGeometry's hole walls are single-sided,
 * so their interior faces get back-face culled and you see straight through the
 * cut. Emitting each hole-wall quad twice with opposite winding makes the inner
 * thickness visible from any angle: the two coincident triangles never z-fight
 * because exactly one faces the camera under FrontSide culling.
 */
function generateSolidSlabGeometry(
  slabNode: SlabNode,
  context: SlabPolygonContext,
): THREE.BufferGeometry {
  const polygon = ensureCounterClockwisePolygon(getRenderableSlabPolygon(slabNode, context))
  const elevation = slabNode.elevation ?? 0.05
  const thickness = slabNode.thickness ?? 0.05
  const bottom = elevation - thickness
  const holePolygons = mergeSurfaceHolePolygons(slabNode.holes ?? [])

  if (polygon.length < 3) return new THREE.BufferGeometry()

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  // --- Side walls ---
  // Each segment gets its own 4 verts so computeVertexNormals doesn't average
  // across faces. Outer walls are single-sided with outward normals; hole walls
  // emit a second flipped quad (own verts) so they read as double-sided.
  const addWall = (a: THREE.Vector2, b: THREE.Vector2, flipped: boolean) => {
    const base = positions.length / 3
    const len = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 0.001)
    positions.push(a.x, bottom, a.y)
    uvs.push(0, 0)
    positions.push(b.x, bottom, b.y)
    uvs.push(len, 0)
    positions.push(b.x, elevation, b.y)
    uvs.push(len, thickness)
    positions.push(a.x, elevation, a.y)
    uvs.push(0, thickness)
    // Standard winding on a CCW polygon gives inward-facing normals (see pool
    // path), so the unflipped quad faces outward; flipped is its back face.
    if (!flipped) {
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
    } else {
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }

  for (const region of buildSlabRegions(polygon, holePolygons)) {
    const contour2d = ensureCounterClockwisePolygon(region.contour).map(
      ([x, z]) => new THREE.Vector2(x!, z!),
    )
    const holes2d = region.holes
      .filter((h) => h.length >= 3)
      .map((h) => h.map(([x, z]) => new THREE.Vector2(x!, z!)))

    // --- Top & bottom caps ---
    // capPoints order (contour then holes) matches triangulateShape's index space.
    // UVs reproduce ExtrudeGeometry's WorldUVGenerator mapping (shape-space x,-z)
    // so textured slabs keep the same floor projection.
    const capPoints = [...contour2d, ...holes2d.flat()]
    const topBase = positions.length / 3
    for (const p of capPoints) {
      positions.push(p.x, elevation, p.y)
      uvs.push(p.x, -p.y)
    }
    const bottomBase = positions.length / 3
    for (const p of capPoints) {
      positions.push(p.x, bottom, p.y)
      uvs.push(p.x, -p.y)
    }

    const capTris = THREE.ShapeUtils.triangulateShape(contour2d, holes2d)
    for (const tri of capTris) {
      const [a, b, c] = [tri[0]!, tri[1]!, tri[2]!]
      // Reversed winding → +Y normal on top; standard winding → -Y on bottom.
      indices.push(topBase + a, topBase + c, topBase + b)
      indices.push(bottomBase + a, bottomBase + b, bottomBase + c)
    }

    for (let i = 0; i < contour2d.length; i++) {
      addWall(contour2d[i]!, contour2d[(i + 1) % contour2d.length]!, false)
    }

    for (const hole of holes2d) {
      for (let i = 0; i < hole.length; i++) {
        const a = hole[i]!
        const b = hole[(i + 1) % hole.length]!
        addWall(a, b, false)
        addWall(a, b, true)
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Pool / recessed slab: floor cap at Y=0 (local) + inner walls up to Y=|elevation|.
 * No top cap — the opening at ground level is handled by the ground occluder hole.
 * mesh.position.y must be set to elevation so the floor sits at the correct world Y.
 *
 * Geometry is built directly in 3D (Y-up) to avoid rotation confusion:
 *   - floor in XZ plane at Y=0, normals pointing +Y (visible when looking down into pool)
 *   - walls from Y=0 to Y=depth, inward-facing normals (visible from inside pool)
 */
function generatePoolGeometry(
  slabNode: SlabNode,
  context: SlabPolygonContext,
): THREE.BufferGeometry {
  const polygon = ensureCounterClockwisePolygon(getRenderableSlabPolygon(slabNode, context))
  const depth = Math.abs(slabNode.elevation ?? 0.05)
  const holePolygons = mergeSurfaceHolePolygons(slabNode.holes ?? [])

  if (polygon.length < 3) return new THREE.BufferGeometry()

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const pushFloorVertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z)
    // Floor UVs in metres (shape-space x, -z), matching generateSolidSlabGeometry's
    // cap mapping so a finish tiles at the same world scale on every surface.
    uvs.push(x, -z)
  }

  const pushWallVertex = (x: number, y: number, z: number, u: number, v: number) => {
    positions.push(x, y, z)
    uvs.push(u, v)
  }

  for (const region of buildSlabRegions(polygon, holePolygons)) {
    const contour = ensureCounterClockwisePolygon(region.contour)
    const floorBase = positions.length / 3

    // --- Floor at Y=0 ---
    for (const [x, z] of contour) pushFloorVertex(x!, 0, z!)
    const pts2d = contour.map(([x, z]) => new THREE.Vector2(x!, z!))
    const holesPts2d = region.holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x!, z!)))
    for (const hole of region.holes) {
      for (const [x, z] of hole) pushFloorVertex(x!, 0, z!)
    }

    const floorTris = THREE.ShapeUtils.triangulateShape(pts2d, holesPts2d)
    for (const tri of floorTris) {
      // Reversed winding → normals point +Y (upward) in XZ plane
      indices.push(floorBase + tri[0]!, floorBase + tri[2]!, floorBase + tri[1]!)
    }

    // --- Inner walls (no top cap at Y=depth) ---
    // Standard winding on a CCW polygon in XZ gives inward-facing normals.
    for (let i = 0; i < contour.length; i++) {
      const j = (i + 1) % contour.length
      const [x0, z0] = contour[i]!
      const [x1, z1] = contour[j]!
      const vBase = positions.length / 3
      const segmentLength = Math.max(Math.hypot(x1 - x0, z1 - z0), 0.001)

      pushWallVertex(x0!, 0, z0!, 0, 0) // v0 — floor level
      pushWallVertex(x1!, 0, z1!, segmentLength, 0) // v1 — floor level
      pushWallVertex(x1!, depth, z1!, segmentLength, depth) // v2 — ground level
      pushWallVertex(x0!, depth, z0!, 0, depth) // v3 — ground level

      indices.push(vBase, vBase + 1, vBase + 2)
      indices.push(vBase, vBase + 2, vBase + 3)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

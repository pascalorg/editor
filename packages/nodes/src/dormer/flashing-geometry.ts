import {
  type AnyNode,
  buildRoofSegmentCoveringTriangles,
  type DormerNode,
  type DormerWallFace,
  dormerPointToWallFace,
  getDormerWallOpeningVerticalBounds,
  getRoofModuleFaces,
  getRoofShingleModules,
  type RoofSegmentNode,
  type WindowNode,
} from '@pascal-app/core'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export const DORMER_FLASHING_MATERIAL_INDEX = 5

const APRON_WIDTH = 0.12
const UPSTAND_HEIGHT = 0.03
const SURFACE_LIFT = 0.003
const SEAM_TOLERANCE = 0.001

type Vertex = { x: number; y: number; z: number }
type TopTriangle = { vertices: [Vertex, Vertex, Vertex] }

/**
 * The host's finished covering as segment-local triangles that look up: the native covering
 * (barrel, glazed, sector and shed pieces, trims) when the roof is known, otherwise the shingle
 * brush's top module faces.
 */
function hostTopTriangles(
  host: RoofSegmentNode,
  nodes?: Readonly<Record<string, AnyNode>>,
): TopTriangle[] {
  const roof = host.parentId ? nodes?.[host.parentId] : undefined
  if (roof?.type === 'roof')
    return buildRoofSegmentCoveringTriangles(roof, host, nodes).map(({ vertices }) => ({
      vertices: vertices.map(([x, y, z]) => ({ x, y, z })) as [Vertex, Vertex, Vertex],
    }))
  const { top, shiftZ } = getRoofShingleModules(host)
  return getRoofModuleFaces(top).flatMap((face) => {
    const shifted = face.map((vertex) => ({ x: vertex.x, y: vertex.y, z: vertex.z + shiftZ }))
    return shifted.slice(1, -1).flatMap((vertex, i): TopTriangle[] => {
      const triangle: [Vertex, Vertex, Vertex] = [shifted[0]!, vertex, shifted[i + 2]!]
      return planNormalY(triangle) > 1e-6 ? [{ vertices: triangle }] : []
    })
  })
}

function planNormalY([a, b, c]: readonly [Vertex, Vertex, Vertex]): number {
  return (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z)
}

/** The height of a triangle's plane over a plan point, or null for one standing on edge. */
function triangleSurfaceY(triangle: TopTriangle, x: number, z: number): number | null {
  const [a, b, c] = triangle.vertices
  const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y)
  const ny = planNormalY(triangle.vertices)
  const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  if (Math.abs(ny) <= 1e-12) return null
  return a.y - (nx * (x - a.x) + nz * (z - a.z)) / ny
}

/** The uppermost covering triangle over a plan point, as a ray from above meets it. */
function topTriangleAt(triangles: readonly TopTriangle[], x: number, z: number) {
  let top: { triangle: TopTriangle; y: number } | null = null
  for (const triangle of triangles) {
    const [a, b, c] = triangle.vertices
    const d1 = (x - b.x) * (a.z - b.z) - (a.x - b.x) * (z - b.z)
    const d2 = (x - c.x) * (b.z - c.z) - (b.x - c.x) * (z - c.z)
    const d3 = (x - a.x) * (c.z - a.z) - (c.x - a.x) * (z - a.z)
    const negative = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12
    const positive = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12
    if (negative && positive) continue
    const y = triangleSurfaceY(triangle, x, z)
    if (y !== null && (!top || y > top.y)) top = { triangle, y }
  }
  return top?.triangle ?? null
}

/** Adds a folded apron only where the finished host actually meets an exterior wall. */
export function addDormerFlashing(
  body: THREE.BufferGeometry,
  dormer: DormerNode,
  host: RoofSegmentNode,
  windows: readonly WindowNode[],
  nodes?: Readonly<Record<string, AnyNode>>,
): THREE.BufferGeometry {
  // Faceted circular CSG seams do not yet form a reliable closed apron.
  // Keep the authored body rather than emit disconnected flashing strips.
  if (dormer.roofType === 'conical') return body

  const index = body.getIndex()
  const position = body.getAttribute('position')
  if (!index || !position) return body

  const faces = hostTopTriangles(host, nodes)
  const cos = Math.cos(dormer.rotation)
  const sin = Math.sin(dormer.rotation)
  const roofY = (point: THREE.Vector3): number | null => {
    const x = dormer.position[0] + point.x * cos + point.z * sin
    const z = dormer.position[2] - point.x * sin + point.z * cos
    const face = topTriangleAt(faces, x, z)
    const y = face ? triangleSurfaceY(face, x, z) : null
    return y === null ? null : y - dormer.position[1]
  }
  const onRoof = (point: THREE.Vector3) => {
    const y = roofY(point)
    return y !== null && Math.abs(point.y - y) <= SEAM_TOLERANCE
  }

  const positions: number[] = []
  const uvs: number[] = []
  const addQuad = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    outward: THREE.Vector3,
  ) => {
    const normal = b.clone().sub(a).cross(c.clone().sub(a))
    if (normal.lengthSq() < 1e-12) normal.copy(b).sub(a).cross(d.clone().sub(a))
    const along = b.clone().sub(a).normalize()
    const across = normal.clone().normalize().cross(along)
    const vertices = [a, b, c, a, c, d]
    for (let i = 0; i < vertices.length; i += 3) {
      const p = vertices[i]!
      const q = vertices[i + 1]!
      const r = vertices[i + 2]!
      const triangleNormal = q.clone().sub(p).cross(r.clone().sub(p))
      if (triangleNormal.lengthSq() < 1e-12) continue
      // A CSG seam can be shorter than the tucked corner lap, reversing one
      // triangle only. Orient each independently so the corner is not culled.
      for (const vertex of triangleNormal.dot(outward) >= 0 ? [p, q, r] : [p, r, q]) {
        positions.push(vertex.x, vertex.y, vertex.z)
        const offset = vertex.clone().sub(a)
        uvs.push(offset.dot(along), offset.dot(across))
      }
    }
  }
  const pointKey = (point: THREE.Vector3): string =>
    [point.x, point.y, point.z].map((value) => Math.round(value / SEAM_TOLERANCE)).join(',')
  const seen = new Set<string>()
  const seams: {
    start: THREE.Vector3
    end: THREE.Vector3
    normal: THREE.Vector3
    face: DormerWallFace
  }[] = []
  const adjoiningNormals = new Map<string, THREE.Vector3[]>()
  const up = new THREE.Vector3(0, 1, 0)

  for (const group of body.groups) {
    if (group.materialIndex !== 0 && group.materialIndex !== 4) continue
    for (let i = group.start; i + 2 < group.start + group.count; i += 3) {
      const triangle = [0, 1, 2].map((offset) =>
        new THREE.Vector3().fromBufferAttribute(position, index.getX(i + offset)),
      )
      const [a, b, c] = triangle as [THREE.Vector3, THREE.Vector3, THREE.Vector3]
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
      if (Math.abs(normal.y) > 1e-4 || normal.x * a.x + normal.z * a.z <= 0) continue
      const face: DormerWallFace =
        Math.abs(normal.x) > Math.abs(normal.z)
          ? normal.x > 0
            ? 'right'
            : 'left'
          : normal.z > 0
            ? 'front'
            : 'back'

      for (let edge = 0; edge < 3; edge++) {
        const start = triangle[edge]!
        const end = triangle[(edge + 1) % 3]!
        if (!onRoof(start) || !onRoof(end) || start.distanceToSquared(end) < 1e-10) continue
        const key = [pointKey(start), pointKey(end)].sort().join(':')
        if (seen.has(key)) continue
        seen.add(key)
        seams.push({ start, end, normal, face })
        for (const point of [start, end]) {
          const pointId = pointKey(point)
          const normals = adjoiningNormals.get(pointId) ?? []
          if (!normals.some((other) => other.dot(normal) > 1 - 1e-5)) normals.push(normal)
          adjoiningNormals.set(pointId, normals)
        }
      }
    }
  }

  // Adjacent facets share one miter at each seam endpoint, rather than
  // diverging normal offsets that leave gaps at wall corners.
  const miter = (point: THREE.Vector3, normal: THREE.Vector3, distance: number) => {
    const direction = new THREE.Vector3()
    for (const adjacent of adjoiningNormals.get(pointKey(point)) ?? [normal]) {
      direction.add(adjacent)
    }
    direction.normalize()
    return direction.multiplyScalar(distance / Math.max(0.1, direction.dot(normal)))
  }
  const apronOffset = (point: THREE.Vector3, normal: THREE.Vector3) => {
    const x = dormer.position[0] + point.x * cos + point.z * sin
    const z = dormer.position[2] - point.x * sin + point.z * cos
    const roofFace = topTriangleAt(faces, x, z)
    if (!roofFace) return null
    const y = triangleSurfaceY(roofFace, x, z)
    const alongX = triangleSurfaceY(roofFace, x + cos, z - sin)
    const alongZ = triangleSurfaceY(roofFace, x + sin, z + cos)
    if (y === null || alongX === null || alongZ === null) return null
    const gradient = new THREE.Vector3(alongX - y, 0, alongZ - y)
    const slopeScale = Math.sqrt(1 + gradient.lengthSq())
    const offset = new THREE.Vector3()
    // Rectangular walls have orthogonal plan normals. Intersect their offset
    // lines at corners, measuring each strip perpendicular to its seam ON
    // the roof plane, not in XZ (which widens a front apron on steep roofs).
    for (const adjacent of adjoiningNormals.get(pointKey(point)) ?? [normal]) {
      const seamSlope = gradient.x * -adjacent.z + gradient.z * adjacent.x
      const planWidth = (APRON_WIDTH * Math.sqrt(1 + seamSlope * seamSlope)) / slopeScale
      offset.addScaledVector(adjacent, planWidth)
    }
    return offset
  }
  for (const { start, end, normal, face } of seams) {
    const skirt = [start, end].map((point) => {
      const offset = apronOffset(point, normal)
      if (!offset) return null
      const outer = point.clone().add(offset)
      const y = roofY(outer)
      if (y === null) return null
      outer.y = y + SURFACE_LIFT
      return outer
    })
    if (!skirt[0] || !skirt[1]) continue
    const inner = [start, end].map((point) => {
      const inset = point.clone().add(miter(point, normal, -SURFACE_LIFT))
      inset.y = (roofY(inset) ?? point.y) + SURFACE_LIFT
      return inset
    })
    addQuad(inner[0]!, inner[1]!, skirt[1], skirt[0], up)

    const facePoints = [start, end].map((point) =>
      dormerPointToWallFace(dormer, face, [point.x, point.y, point.z]),
    )
    let openingBottom = Infinity
    for (const window of windows) {
      if ((window.dormerFace ?? 'front') !== face) continue
      const left = window.position[0] - window.width / 2
      const right = window.position[0] + window.width / 2
      if (
        Math.max(...facePoints.map(([x]) => x)) < left ||
        Math.min(...facePoints.map(([x]) => x)) > right
      )
        continue
      openingBottom = Math.min(openingBottom, window.position[1] - window.height / 2)
    }
    const base = [start, end].map((point) =>
      point
        .clone()
        .add(miter(point, normal, SURFACE_LIFT))
        .addScaledVector(up, SURFACE_LIFT),
    )
    const top = base.map((point, endpoint) => {
      const ceiling = getDormerWallOpeningVerticalBounds(
        dormer,
        face,
        facePoints[endpoint]![0],
        0,
      ).max
      const y = Math.max(
        point.y,
        Math.min(point.y + UPSTAND_HEIGHT, ceiling, openingBottom - SURFACE_LIFT),
      )
      return new THREE.Vector3(point.x, y, point.z)
    })
    addQuad(base[0]!, base[1]!, top[1]!, top[0]!, normal)
  }
  if (positions.length === 0) return body

  const flashing = new THREE.BufferGeometry()
  flashing.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  flashing.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  flashing.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2))
  flashing.setIndex(Array.from({ length: positions.length / 3 }, (_, i) => i))
  flashing.computeVertexNormals()
  const merged = mergeGeometries([body, flashing])
  if (merged) {
    for (const group of body.groups) merged.addGroup(group.start, group.count, group.materialIndex)
    merged.addGroup(index.count, positions.length / 3, DORMER_FLASHING_MATERIAL_INDEX)
    body.dispose()
  }
  flashing.dispose()
  return merged ?? body
}

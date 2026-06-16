import {
  type AnyNodeId,
  getEffectiveNode,
  getRenderableSlabPolygon,
  type PolygonPoint2D,
  pointInPolygon2D,
  polygonsIntersect,
  type SlabNode,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { subtractPolygonsFromPolygon } from '../../lib/polygon-union'
import { createSafeEmptyGeometry, ensureWebGPUCompatibleGeometry } from '../../lib/safe-geometry'
import { mergeSurfaceHolePolygons } from '../surface-hole-geometry'

function ensureUv2Attribute(geometry: THREE.BufferGeometry) {
  const uv = geometry.getAttribute('uv')
  if (!uv) return

  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(Array.from(uv.array), 2))
}

const polygonBounds = (polygon: ReadonlyArray<readonly [number, number]>) => {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of polygon) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ }
}

const signedArea2 = (polygon: ReadonlyArray<readonly [number, number]>) =>
  polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length]
    if (!next) return sum
    return sum + point[0] * next[1] - next[0] * point[1]
  }, 0)

// ============================================================================
// SLAB SYSTEM
// ============================================================================

export const SlabSystem = () => {
  const dirtyNodes = useScene((state) => state.dirtyNodes)
  const clearDirty = useScene((state) => state.clearDirty)
  const markDirty = useScene((state) => state.markDirty)

  useEffect(() => {
    const nodes = useScene.getState().nodes
    for (const node of Object.values(nodes)) {
      if (node.type === 'slab') {
        markDirty(node.id)
      }
    }
  }, [markDirty])

  useFrame(() => {
    if (dirtyNodes.size === 0) return

    const nodes = useScene.getState().nodes

    // Process dirty slabs
    dirtyNodes.forEach((id) => {
      const node = nodes[id]
      if (!node || node.type !== 'slab') return

      const mesh = sceneRegistry.nodes.get(id) as THREE.Mesh
      if (mesh) {
        updateSlabGeometry(getEffectiveNode(node as SlabNode), mesh)
        clearDirty(id as AnyNodeId)
      }
      // If mesh not found, keep it dirty for next frame
    })
  }, 1)

  return null
}

/**
 * Updates the geometry for a single slab
 */
function updateSlabGeometry(node: SlabNode, mesh: THREE.Mesh) {
  const newGeo = generateSlabGeometry(node)
  ensureUv2Attribute(newGeo)

  mesh.geometry.dispose()
  mesh.geometry = newGeo

  // For negative elevation, shift the mesh down so the top face sits at Y=elevation
  // rather than at Y=0. Positive elevation stays at Y=0 (slab sits at floor level).
  const elevation = node.elevation ?? 0.05
  mesh.position.y = elevation < 0 ? elevation : 0

  newGeo.computeBoundingBox()
  mesh.updateMatrixWorld(true)
  const meshWorldBox = new THREE.Box3().setFromObject(mesh)
  console.log('[pascal:slab:update]', {
    id: node.id,
    parentId: node.parentId,
    elevation,
    meshY: mesh.position.y,
    holeCount: node.holes?.length ?? 0,
    holes: node.holes ?? [],
    rawPolygonBounds: polygonBounds(node.polygon),
    rawPolygon: node.polygon,
    geometryBoundingBox: newGeo.boundingBox
      ? {
          min: newGeo.boundingBox.min.toArray(),
          max: newGeo.boundingBox.max.toArray(),
        }
      : null,
    meshWorldBoundingBox: meshWorldBox.isEmpty()
      ? null
      : {
          min: meshWorldBox.min.toArray(),
          max: meshWorldBox.max.toArray(),
        },
  })
}

/**
 * Generates extruded slab geometry from polygon
 */
export function generateSlabGeometry(slabNode: SlabNode): THREE.BufferGeometry {
  const elevation = slabNode.elevation ?? 0.05
  return elevation < 0 ? generatePoolGeometry(slabNode) : generatePositiveSlabGeometry(slabNode)
}

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
 * Standard slab: flat extrusion upward from Y=0 by elevation thickness.
 */
function generatePositiveSlabGeometry(slabNode: SlabNode): THREE.BufferGeometry {
  const polygon = ensureCounterClockwisePolygon(getRenderableSlabPolygon(slabNode))
  const elevation = slabNode.elevation ?? 0.05
  const holePolygons = mergeSurfaceHolePolygons(slabNode.holes ?? [])

  if (polygon.length < 3) return createSafeEmptyGeometry()

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  const addWall = (a: THREE.Vector2, b: THREE.Vector2, flip = false) => {
    const base = positions.length / 3
    const length = Math.max(a.distanceTo(b), 0.001)
    positions.push(a.x, 0, a.y, b.x, 0, b.y, b.x, elevation, b.y, a.x, elevation, a.y)
    uvs.push(0, 0, length, 0, length, elevation, 0, elevation)
    if (flip) indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
    else indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  for (const region of buildSlabRegions(polygon, holePolygons)) {
    const contour2d = ensureCounterClockwisePolygon(region.contour).map(
      ([x, z]) => new THREE.Vector2(x, z),
    )
    const holes2d = region.holes
      .filter((h) => h.length >= 3)
      .map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)))

    const capPoints = [...contour2d, ...holes2d.flat()]
    const topBase = positions.length / 3
    for (const point of capPoints) {
      positions.push(point.x, elevation, point.y)
      uvs.push(point.x, -point.y)
    }
    const bottomBase = positions.length / 3
    for (const point of capPoints) {
      positions.push(point.x, 0, point.y)
      uvs.push(point.x, -point.y)
    }

    const capTris = THREE.ShapeUtils.triangulateShape(contour2d, holes2d)
    for (const tri of capTris) {
      const [a, b, c] = [tri[0]!, tri[1]!, tri[2]!]
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
  return ensureWebGPUCompatibleGeometry(geometry)
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
function generatePoolGeometry(slabNode: SlabNode): THREE.BufferGeometry {
  const rawRenderablePolygon = slabNode.autoFromWalls
    ? getRenderableSlabPolygon(slabNode)
    : slabNode.polygon
  const polygon = ensureCounterClockwisePolygon(rawRenderablePolygon)
  const depth = Math.abs(slabNode.elevation ?? 0.05)
  const holePolygons = mergeSurfaceHolePolygons(slabNode.holes ?? [])

  if (polygon.length < 3) return createSafeEmptyGeometry()

  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let floorTriCount = 0
  const bounds = new THREE.Box2()

  for (const [x, z] of polygon) {
    bounds.expandByPoint(new THREE.Vector2(x, z))
  }
  for (const hole of holePolygons) {
    for (const [x, z] of hole) {
      bounds.expandByPoint(new THREE.Vector2(x, z))
    }
  }

  const floorWidth = Math.max(bounds.max.x - bounds.min.x, 0.001)
  const floorHeight = Math.max(bounds.max.y - bounds.min.y, 0.001)

  const pushFloorVertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z)
    uvs.push((x - bounds.min.x) / floorWidth, (z - bounds.min.y) / floorHeight)
  }

  const pushWallVertex = (x: number, y: number, z: number, u: number, v: number) => {
    positions.push(x, y, z)
    uvs.push(u, v)
  }

  for (const region of buildSlabRegions(polygon, holePolygons)) {
    const contour = ensureCounterClockwisePolygon(region.contour)
    const floorBase = positions.length / 3

    // --- Floor at Y=0 ---
    for (const [x, z] of contour) pushFloorVertex(x, 0, z)
    const pts2d = contour.map(([x, z]) => new THREE.Vector2(x, z))
    const holesPts2d = region.holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)))
    for (const hole of region.holes) {
      for (const [x, z] of hole) pushFloorVertex(x, 0, z)
    }

    const floorTris = THREE.ShapeUtils.triangulateShape(pts2d, holesPts2d)
    floorTriCount += floorTris.length
    for (const tri of floorTris) {
      // Reversed winding ? normals point +Y (upward) in XZ plane
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

      pushWallVertex(x0, 0, z0, 0, 0)
      pushWallVertex(x1, 0, z1, segmentLength, 0)
      pushWallVertex(x1, depth, z1, segmentLength, depth)
      pushWallVertex(x0, depth, z0, 0, depth)

      indices.push(vBase, vBase + 1, vBase + 2)
      indices.push(vBase, vBase + 2, vBase + 3)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  console.log('[pascal:slab:pool-geometry]', {
    id: slabNode.id,
    parentId: slabNode.parentId,
    elevation: slabNode.elevation ?? 0.05,
    depth,
    rawPolygonBounds: polygonBounds(slabNode.polygon),
    rawPolygonArea2: signedArea2(slabNode.polygon),
    rawPolygon: slabNode.polygon,
    renderablePolygonBounds: polygonBounds(rawRenderablePolygon),
    renderablePolygonArea2: signedArea2(rawRenderablePolygon),
    renderablePolygon: rawRenderablePolygon,
    holePolygons,
    normalizedPolygonBounds: polygonBounds(polygon),
    normalizedPolygonArea2: signedArea2(polygon),
    normalizedPolygon: polygon,
    holeCount: holePolygons.length,
    floorTriCount,
    vertexCount: positions.length / 3,
    indexCount: indices.length,
    geometryBoundingBox: geo.boundingBox
      ? {
          min: geo.boundingBox.min.toArray(),
          max: geo.boundingBox.max.toArray(),
        }
      : null,
  })

  return ensureWebGPUCompatibleGeometry(geo)
}

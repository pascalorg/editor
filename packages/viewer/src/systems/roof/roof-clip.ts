import {
  type AnyNode,
  type AnyNodeId,
  getLevelElevations,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import * as THREE from 'three'
import { getRoofUndersidePatches, type RoofUndersidePatch } from './roof-underside'

/**
 * Nothing passes through a roof: every mesh of a building — furniture, posts,
 * fences, pipes, ceilings — is cut at the underside of any roof above it.
 *
 * The cut is geometric, so it works for every material and loader: the
 * triangles of a mesh lose whatever lies above a roof underside within that
 * roof's outline. The cut face is left open: it sits against the underside of
 * the deck and cannot be seen. Excluded: the roofs themselves and everything
 * they host (chimneys and skylights on the slope), and walls, which the wall
 * system cuts into closed solids (`wall-roof-fit`). Skinned and instanced
 * meshes are left as they are: their vertices are placed on the GPU.
 */

type ClipRegion = THREE.Plane[]

type ClipState = {
  source: THREE.BufferGeometry
  /** The geometry on the mesh: the cut one, or `source` when nothing is cut. */
  clipped: THREE.BufferGeometry
  /** Mesh-local → building transform and roof set the cut was made for. */
  placement: number[]
  roofs: string
}

const clipStates = new WeakMap<THREE.Mesh, ClipState>()
// Tolerance for the plane splits (metres) and for "nothing to cut".
const SPLIT_EPSILON = 1e-6

/**
 * Convex regions above the roof undersides in building space: each patch
 * outline is triangulated, and each triangle with the patch plane bounds a
 * prism open upwards. Inside a region every plane's distance is positive.
 */
function clipRegions(patches: readonly RoofUndersidePatch[]): ClipRegion[] {
  const regions: ClipRegion[] = []
  for (const patch of patches) {
    const contour = patch.polygon.map(([x, z]) => new THREE.Vector2(x, z))
    const ccw = THREE.ShapeUtils.isClockWise(contour) ? -1 : 1
    for (const triangle of THREE.ShapeUtils.triangulateShape(contour, [])) {
      const corners = triangle.map((index) => patch.polygon[index]!)
      // `triangulateShape` keeps the contour winding.
      const planes: THREE.Plane[] = [
        // Above the underside: y - a x - b z - c > 0.
        new THREE.Plane(new THREE.Vector3(-patch.a, 1, -patch.b), -patch.c),
      ]
      for (let i = 0; i < 3; i++) {
        const [x0, z0] = corners[i]!
        const [x1, z1] = corners[(i + 1) % 3]!
        // Inward horizontal normal of a counter-clockwise (x, z) ring.
        const normal = new THREE.Vector3(-(z1 - z0) * ccw, 0, (x1 - x0) * ccw)
        if (normal.lengthSq() < 1e-18) continue
        normal.normalize()
        planes.push(new THREE.Plane(normal, -normal.dot(new THREE.Vector3(x0, 0, z0))))
      }
      regions.push(planes)
    }
  }
  return regions
}

type Vertex = number[]

/** Splits a polygon by a plane on the position slice (first three numbers). */
function splitPolygon(polygon: Vertex[], plane: THREE.Plane): [Vertex[], Vertex[]] {
  const front: Vertex[] = []
  const back: Vertex[] = []
  const distance = (v: Vertex) =>
    plane.normal.x * v[0]! + plane.normal.y * v[1]! + plane.normal.z * v[2]! + plane.constant
  for (let i = 0; i < polygon.length; i++) {
    const current = polygon[i]!
    const next = polygon[(i + 1) % polygon.length]!
    const dc = distance(current)
    const dn = distance(next)
    if (dc >= -SPLIT_EPSILON) front.push(current)
    if (dc <= SPLIT_EPSILON) back.push(current)
    if (
      (dc > SPLIT_EPSILON && dn < -SPLIT_EPSILON) ||
      (dc < -SPLIT_EPSILON && dn > SPLIT_EPSILON)
    ) {
      const t = dc / (dc - dn)
      const point = current.map((value, k) => value + (next[k]! - value) * t)
      front.push(point)
      back.push(point)
    }
  }
  return [front.length >= 3 ? front : [], back.length >= 3 ? back : []]
}

/** The parts of a polygon outside a convex region; the polygon itself when it misses it. */
function subtractRegion(polygon: Vertex[], region: ClipRegion): Vertex[][] {
  const misses = region.some((plane) =>
    polygon.every(
      (v) =>
        plane.normal.x * v[0]! + plane.normal.y * v[1]! + plane.normal.z * v[2]! + plane.constant <
        SPLIT_EPSILON,
    ),
  )
  if (misses) return [polygon]
  const kept: Vertex[][] = []
  let remaining = polygon
  for (const plane of region) {
    const [inside, outside] = splitPolygon(remaining, plane)
    if (outside.length) kept.push(outside)
    remaining = inside
    if (!remaining.length) break
  }
  return kept
}

/**
 * The geometry with everything inside `regions` (mesh-local) removed, or null
 * when nothing is cut. Attributes are interpolated along the cut; groups keep
 * their materials.
 */
export function clipGeometryByRegions(
  source: THREE.BufferGeometry,
  regions: readonly ClipRegion[],
): THREE.BufferGeometry | null {
  if (regions.length === 0) return null
  const geometry = source.index ? source.toNonIndexed() : source
  const position = geometry.getAttribute('position')
  // Position first: the plane splits read the first three numbers of a vertex.
  const names = [
    'position',
    ...Object.keys(geometry.attributes).filter((name) => name !== 'position'),
  ]
  const sizes = names.map((name) => geometry.getAttribute(name).itemSize)
  const stride = sizes.reduce((sum, size) => sum + size, 0)
  const groups = geometry.groups.length
    ? geometry.groups
    : [{ start: 0, count: position.count, materialIndex: 0 }]

  const vertexAt = (index: number): Vertex => {
    const vertex: Vertex = []
    names.forEach((name) => {
      const attribute = geometry.getAttribute(name)
      for (let k = 0; k < attribute.itemSize; k++) vertex.push(attribute.getComponent(index, k))
    })
    return vertex
  }

  const output: number[] = []
  const outputGroups: Array<{ start: number; count: number; materialIndex: number }> = []
  let changed = false
  for (const group of groups) {
    const start = output.length / stride
    const end = Math.min(position.count, group.start + group.count)
    for (let index = group.start; index + 2 < end; index += 3) {
      let pieces: Vertex[][] = [[vertexAt(index), vertexAt(index + 1), vertexAt(index + 2)]]
      for (const region of regions) {
        const next: Vertex[][] = []
        for (const piece of pieces) {
          const kept = subtractRegion(piece, region)
          if (kept.length !== 1 || kept[0] !== piece) changed = true
          next.push(...kept)
        }
        pieces = next
        if (!pieces.length) break
      }
      for (const piece of pieces) {
        for (let k = 1; k + 1 < piece.length; k++) {
          for (const vertex of [piece[0]!, piece[k]!, piece[k + 1]!]) output.push(...vertex)
        }
      }
    }
    const count = output.length / stride - start
    if (count > 0) outputGroups.push({ start, count, materialIndex: group.materialIndex ?? 0 })
  }
  if (geometry !== source) geometry.dispose()
  if (!changed) return null

  const result = new THREE.BufferGeometry()
  const vertexCount = output.length / stride
  let offset = 0
  names.forEach((name, n) => {
    const size = sizes[n]!
    const array = new Float32Array(vertexCount * size)
    for (let v = 0; v < vertexCount; v++) {
      for (let k = 0; k < size; k++) array[v * size + k] = output[v * stride + offset + k]!
    }
    result.setAttribute(name, new THREE.BufferAttribute(array, size))
    offset += size
  })
  if (result.getAttribute('normal')) {
    const normal = result.getAttribute('normal') as THREE.BufferAttribute
    const vector = new THREE.Vector3()
    for (let v = 0; v < normal.count; v++) {
      vector.fromBufferAttribute(normal, v).normalize()
      normal.setXYZ(v, vector.x, vector.y, vector.z)
    }
  }
  if (source.groups.length) {
    for (const group of outputGroups) result.addGroup(group.start, group.count, group.materialIndex)
  }
  result.computeBoundingBox()
  result.computeBoundingSphere()
  result.userData = { ...source.userData }
  return result
}

function isRoofOwned(object: THREE.Object3D, roofGroups: ReadonlySet<THREE.Object3D>) {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) {
    if (roofGroups.has(current)) return true
  }
  return false
}

const roofKeys = new WeakMap<readonly RoofUndersidePatch[], string>()
function roofKeyOf(patches: readonly RoofUndersidePatch[]) {
  return patches
    .map((patch) => `${patch.a},${patch.b},${patch.c}:${patch.polygon.flat().join(',')}`)
    .join(';')
}

const scratchMatrix = new THREE.Matrix4()
const scratchBox = new THREE.Box3()

/**
 * Cuts the meshes of every level at the roofs above them. Cheap when nothing
 * changed: a mesh is re-cut only when its geometry, its placement or the roofs
 * of its building change.
 */
export function runRoofClipFrame() {
  const nodes = useScene.getState().nodes as Readonly<Record<string, AnyNode>>
  const patchesByBuilding = getRoofUndersidePatches(nodes)
  if (patchesByBuilding.size === 0) return
  const elevations = getLevelElevations(nodes as Record<AnyNodeId, AnyNode>)
  const roofGroups = new Set<THREE.Object3D>()
  for (const id of sceneRegistry.byType.roof ?? []) {
    const group = sceneRegistry.nodes.get(id)
    if (group) roofGroups.add(group)
  }
  const wallMeshes = new Set<THREE.Object3D>()
  for (const id of sceneRegistry.byType.wall ?? []) {
    const mesh = sceneRegistry.nodes.get(id)
    if (mesh) wallMeshes.add(mesh)
  }

  for (const levelId of sceneRegistry.byType.level ?? []) {
    const levelObject = sceneRegistry.nodes.get(levelId)
    const level = elevations.get(levelId)
    if (!levelObject || !level) continue
    const patches = patchesByBuilding.get(level.buildingId)
    if (!patches?.length) continue
    const roofsKey = roofKeys.get(patches) ?? roofKeyOf(patches)
    roofKeys.set(patches, roofsKey)
    let buildingRegions: ClipRegion[] | null = null
    const levelInverse = new THREE.Matrix4().copy(levelObject.matrixWorld).invert()

    levelObject.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) return
      if (wallMeshes.has(mesh) || wallMeshes.has(mesh.parent!)) return
      if (isRoofOwned(mesh, roofGroups)) return
      const state = clipStates.get(mesh)
      const source = state && mesh.geometry === state.clipped ? state.source : mesh.geometry
      if (!source?.getAttribute('position')) return
      // Mesh-local → building space: through the level's frame, then up by its base.
      scratchMatrix.multiplyMatrices(levelInverse, mesh.matrixWorld)
      scratchMatrix.elements[13]! += level.baseY
      if (
        state &&
        state.source === source &&
        mesh.geometry === state.clipped &&
        state.roofs === roofsKey &&
        state.placement.every((value, k) => Math.abs(value - scratchMatrix.elements[k]!) < 1e-6)
      ) {
        return
      }
      if (!source.boundingBox) source.computeBoundingBox()
      scratchBox.copy(source.boundingBox!).applyMatrix4(scratchMatrix)
      buildingRegions ??= clipRegions(patches)
      const touching = patches.some(
        (patch) =>
          patch.maxX >= scratchBox.min.x &&
          patch.minX <= scratchBox.max.x &&
          patch.maxZ >= scratchBox.min.z &&
          patch.minZ <= scratchBox.max.z &&
          scratchBox.max.y >
            Math.min(
              patch.a * scratchBox.min.x + patch.b * scratchBox.min.z,
              patch.a * scratchBox.max.x + patch.b * scratchBox.max.z,
              patch.a * scratchBox.min.x + patch.b * scratchBox.max.z,
              patch.a * scratchBox.max.x + patch.b * scratchBox.min.z,
            ) +
              patch.c,
      )
      let clipped: THREE.BufferGeometry | null = null
      if (touching) {
        const toLocal = scratchMatrix.clone().invert()
        const regions = buildingRegions.map((region) =>
          region.map((plane) => plane.clone().applyMatrix4(toLocal)),
        )
        clipped = clipGeometryByRegions(source, regions)
      }
      // Only the cut copy is ours; the source belongs to its renderer (GLB geometry is shared).
      if (state && state.clipped !== state.source && state.clipped !== clipped)
        state.clipped.dispose()
      if (clipped) {
        mesh.geometry = clipped
      } else if (mesh.geometry !== source) {
        mesh.geometry = source
      }
      clipStates.set(mesh, {
        source,
        clipped: clipped ?? source,
        placement: [...scratchMatrix.elements],
        roofs: roofsKey,
      })
    })
  }
}

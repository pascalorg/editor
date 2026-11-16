import { sceneRegistry } from '@pascal-app/core'
import type { BatchedMesh } from 'three'
import {
  Box3,
  type BufferAttribute,
  type BufferGeometry,
  type Matrix4,
  type Mesh,
  Object3D,
} from 'three'
import { DEFAULT_FRAMING_EXCLUDED_TYPES } from './hero-pose'
import { BATCHED_LAYER, SCENE_LAYER, SHADOW_ONLY_LAYER } from './layers'
import { hasRevealPose } from './reveal-pose'
import { modelLayerMask } from './scene-visibility'

const excluded = new Set<string>(DEFAULT_FRAMING_EXCLUDED_TYPES)
type Source = Object3D | ReadonlyMap<string, Object3D>
type GeometryBounds = { position: unknown; version: number; box: Box3 }
const geometryCache = new WeakMap<BufferGeometry, GeometryBounds>()
type MeshBounds = {
  geometry: BufferGeometry
  local: Box3
  matrix: number[]
  instanceVersion: number
  count: number | undefined
  box: Box3
}
const meshCache = new WeakMap<Object3D, MeshBounds>()
const unionCache = new WeakMap<Source, { boxes: readonly Box3[]; box: Box3 | null }>()

function geometryBounds(geometry: BufferGeometry): Box3 | null {
  const position = geometry.getAttribute('position')
  if (!position) return null
  const version = 'version' in position ? position.version : position.data.version
  const cached = geometryCache.get(geometry)
  if (!cached || cached.position !== position || cached.version !== version) {
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!.clone()
    geometryCache.set(geometry, { position, version, box })
    return box
  }
  return cached.box
}

/** Read the rest transform without clearing or writing a live reveal pose. */
function modelWorldMatrix(object: Object3D, cache: Map<Object3D, Matrix4>): Matrix4 {
  const cached = cache.get(object)
  if (cached) return cached
  let matrix = object.matrixWorld
  if (object.matrixWorldAutoUpdate) {
    const parent = object.parent ? modelWorldMatrix(object.parent, cache) : null
    let local = object.matrix
    if (object.matrixAutoUpdate && hasRevealPose(object)) {
      const rest = new Object3D()
      rest.position.copy(object.position)
      rest.quaternion.copy(object.quaternion)
      rest.scale.copy(object.scale)
      rest.pivot = object.pivot
      rest.updateMatrix()
      local = rest.matrix
    }
    if (local !== object.matrix || (parent && parent !== object.parent!.matrixWorld)) {
      matrix = parent ? local.clone().premultiply(parent) : local.clone()
    }
  }
  cache.set(object, matrix)
  return matrix
}

function meshBounds(mesh: Mesh, matrix: Matrix4): Box3 | null {
  // Synthesized batches are stripped (or marked glbBatch) and excluded by the walker.
  // Standalone plugin batches have no public mutation version: refresh their instance union,
  // then retain the cached world box when that union and world transform are unchanged.
  const batch = mesh as BatchedMesh
  if (batch.isBatchedMesh) batch.computeBoundingBox()
  const local = batch.isBatchedMesh ? batch.boundingBox : geometryBounds(mesh.geometry)
  if (!local || local.isEmpty()) return null
  const instanced = mesh as Mesh & {
    isInstancedMesh?: boolean
    instanceMatrix?: BufferAttribute
    count?: number
    boundingBox?: Box3 | null
    computeBoundingBox?: () => void
  }
  const instanceVersion = instanced.instanceMatrix?.version ?? -1
  const cached = meshCache.get(mesh)
  if (
    cached &&
    cached.geometry === mesh.geometry &&
    cached.local.equals(local) &&
    cached.instanceVersion === instanceVersion &&
    cached.count === instanced.count &&
    cached.matrix.every((value, i) => value === matrix.elements[i])
  )
    return cached.box

  if (instanced.isInstancedMesh) instanced.computeBoundingBox!()
  const box = (instanced.isInstancedMesh ? instanced.boundingBox! : local)
    .clone()
    .applyMatrix4(matrix)
  meshCache.set(mesh, {
    geometry: mesh.geometry,
    local: local.clone(),
    matrix: matrix.elements.slice(),
    instanceVersion,
    count: instanced.count,
    box,
  })
  return box
}

/**
 * Unclipped world bounds (metres), independent of current visibility/section/culling.
 * Ordinary meshes reuse vertex bounds and world boxes; standalone batches refresh their instance union.
 * Pass a baked model root / identity map, or omit for the registered live model.
 * Treat the returned cached Box3 as read-only. Empty models return null.
 */
export function sectionBounds(source: Source = sceneRegistry.nodes): Box3 | null {
  const owners = new Map<Object3D, string>()
  for (const [kind, ids] of Object.entries(sceneRegistry.byType)) {
    for (const id of ids) {
      const object = sceneRegistry.nodes.get(id)
      if (object) owners.set(object, kind)
    }
  }
  const roots = 'isObject3D' in source ? [source as Object3D] : [...source.values()]
  const rootSet = new Set(roots)
  const boxes: Box3[] = []
  const matrices = new Map<Object3D, Matrix4>()
  const walk = (object: Object3D, ownerExcluded: boolean) => {
    if (
      object.type.endsWith('Helper') ||
      object.userData.pascalExport === 'strip' ||
      object.userData.glbBatch
    )
      return
    const kind = owners.get(object) ?? object.userData.kind
    const skip = typeof kind === 'string' ? excluded.has(kind) : ownerExcluded
    const mesh = object as Mesh
    if (
      !skip &&
      mesh.isMesh &&
      [SCENE_LAYER, BATCHED_LAYER, SHADOW_ONLY_LAYER].some(
        (layer) => (modelLayerMask(mesh) & (1 << layer)) !== 0,
      )
    ) {
      const box = meshBounds(mesh, modelWorldMatrix(mesh, matrices))
      if (box && !box.isEmpty()) boxes.push(box)
    }
    for (const child of object.children) walk(child, skip)
  }
  for (const root of roots) {
    let nested = false
    for (let parent = root.parent; parent; parent = parent.parent) {
      if (rootSet.has(parent)) {
        nested = true
        break
      }
    }
    if (nested) continue
    root.updateWorldMatrix(true, true)
    walk(root, false)
  }
  const cached = unionCache.get(source)
  if (
    cached &&
    cached.boxes.length === boxes.length &&
    boxes.every((box, i) => box === cached.boxes[i])
  ) {
    return cached.box
  }
  const union = new Box3()
  for (const box of boxes) union.union(box)
  const box = union.isEmpty() ? null : union
  unionCache.set(source, { boxes, box })
  return box
}

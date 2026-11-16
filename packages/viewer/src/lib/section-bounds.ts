import { sceneRegistry } from '@pascal-app/core'
import { Box3, type BufferAttribute, type BufferGeometry, type Mesh, type Object3D } from 'three'
import { DEFAULT_FRAMING_EXCLUDED_TYPES } from './hero-pose'
import { BATCHED_LAYER, SCENE_LAYER, SHADOW_ONLY_LAYER } from './layers'

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

function meshBounds(mesh: Mesh): Box3 | null {
  const local = geometryBounds(mesh.geometry)
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
    cached.matrix.every((value, i) => value === mesh.matrixWorld.elements[i])
  )
    return cached.box

  if (instanced.isInstancedMesh) instanced.computeBoundingBox!()
  const box = (instanced.isInstancedMesh ? instanced.boundingBox! : local)
    .clone()
    .applyMatrix4(mesh.matrixWorld)
  meshCache.set(mesh, {
    geometry: mesh.geometry,
    local: local.clone(),
    matrix: mesh.matrixWorld.elements.slice(),
    instanceVersion,
    count: instanced.count,
    box,
  })
  return box
}

/**
 * Unclipped world bounds (metres), independent of current visibility/section/culling.
 * O(objects) cache validation; unchanged meshes never rescan vertices or rebuild boxes.
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
  const walk = (object: Object3D, ownerExcluded: boolean) => {
    if (object.type.endsWith('Helper') || object.userData.pascalExport === 'strip') return
    const kind = owners.get(object) ?? object.userData.kind
    const skip = typeof kind === 'string' ? excluded.has(kind) : ownerExcluded
    const mesh = object as Mesh
    if (
      !skip &&
      mesh.isMesh &&
      [SCENE_LAYER, BATCHED_LAYER, SHADOW_ONLY_LAYER].some((layer) => mesh.layers.isEnabled(layer))
    ) {
      const box = meshBounds(mesh)
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

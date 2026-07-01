import {
  type AnyNode,
  type DoorNode,
  emitter,
  getLevelDisplayName,
  isOperationDoorType,
  type LevelNode,
  sceneRegistry,
  type WindowNode,
  type ZoneNode,
} from '@pascal-app/core'
import {
  poseDoorMovingParts,
  poseWindowMovingParts,
  SCENE_LAYER,
  snapLevelsToTruePositions,
} from '@pascal-app/viewer'
import type { Object3D } from 'three'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import * as WebGPUTextureUtils from 'three/examples/jsm/utils/WebGPUTextureUtils.js'

const POSE_EPSILON = 1e-5
const OPERATION_DOOR_SAMPLES = 16

type SwingLeafMarker = { axis: 'y'; openRotationY: number }

export type GlbExport = {
  scene: THREE.Object3D
  animations: THREE.AnimationClip[]
}

export async function exportSceneToGlb(
  sceneGroup: Object3D,
  nodes: Record<string, AnyNode>,
): Promise<ArrayBuffer> {
  emitter.emit('thumbnail:before-capture', undefined)
  const restoreLevels = snapLevelsToTruePositions()
  let prepared: GlbExport
  try {
    prepared = prepareSceneForExport(sceneGroup, nodes)
  } finally {
    restoreLevels()
    emitter.emit('thumbnail:after-capture', undefined)
  }

  const exporter = new GLTFExporter()
  exporter.setTextureUtils(WebGPUTextureUtils)

  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      prepared.scene,
      (gltf) => resolve(gltf as ArrayBuffer),
      (error) => reject(error),
      { binary: true, animations: prepared.animations },
    )
  })
}

export function prepareSceneForExport(
  source: THREE.Object3D,
  nodes: Record<string, AnyNode>,
): GlbExport {
  const scene = source.clone(true)
  const cloneByOriginal = pairClones(source, scene)

  for (const [id, original] of sceneRegistry.nodes) {
    const node = nodes[id]
    if (node?.type === 'scan' || node?.type === 'guide') {
      cloneByOriginal.get(original)?.removeFromParent()
    }
  }

  const identityNodes = new Set<THREE.Object3D>()
  for (const original of sceneRegistry.nodes.values()) {
    const clone = cloneByOriginal.get(original)
    if (clone) identityNodes.add(clone)
  }

  pruneNonRenderableMeshes(scene, identityNodes)
  convertMaterials(scene)

  const { clips, clipNamesByNode } = bakeAnimationClips(cloneByOriginal, nodes)
  stampIdentity(scene, cloneByOriginal, nodes, clipNamesByNode)

  return { scene, animations: clips }
}

function pairClones(
  source: THREE.Object3D,
  clone: THREE.Object3D,
): Map<THREE.Object3D, THREE.Object3D> {
  const originals: THREE.Object3D[] = []
  const clones: THREE.Object3D[] = []
  source.traverse((object) => originals.push(object))
  clone.traverse((object) => clones.push(object))

  const map = new Map<THREE.Object3D, THREE.Object3D>()
  for (let i = 0; i < originals.length; i++) {
    const target = clones[i]
    if (target) map.set(originals[i]!, target)
  }
  return map
}

const EMPTY_GEOMETRY = new THREE.BufferGeometry()
const PLACEHOLDER_MATERIAL = new THREE.MeshBasicMaterial({ visible: false })

function pruneNonRenderableMeshes(root: THREE.Object3D, identityNodes: Set<THREE.Object3D>) {
  const toRemove: THREE.Object3D[] = []
  root.traverse((object) => {
    if (!object.layers.isEnabled(SCENE_LAYER)) {
      if (identityNodes.has(object)) return
      toRemove.push(object)
      return
    }

    const renderable = object as THREE.Mesh & { isLine?: boolean; isPoints?: boolean }
    if (
      (renderable.isMesh === true || renderable.isLine === true || renderable.isPoints === true) &&
      renderable.material == null
    ) {
      if (object.children.length > 0) {
        renderable.geometry = EMPTY_GEOMETRY
        renderable.material = PLACEHOLDER_MATERIAL
      } else {
        toRemove.push(object)
      }
      return
    }

    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || isRenderableMesh(mesh)) return
    if (mesh.children.length > 0) {
      mesh.geometry = EMPTY_GEOMETRY
    } else {
      toRemove.push(mesh)
    }
  })
  for (const object of toRemove) object.removeFromParent()
}

function isRenderableMesh(mesh: THREE.Mesh): boolean {
  const position = mesh.geometry?.getAttribute('position')
  if (!position || position.count === 0) return false
  const material = mesh.material
  return Array.isArray(material)
    ? material.some((m) => m?.visible !== false)
    : material?.visible !== false
}

const STANDARD_MAP_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'lightMap',
  'displacementMap',
  'bumpMap',
] as const

function convertMaterials(root: THREE.Object3D) {
  const cache = new Map<THREE.Material, THREE.Material>()
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const material = mesh.material
    if (Array.isArray(material)) {
      mesh.material = material.map((m) => convertMaterial(m, cache))
      return
    }
    if (
      (material as { isNodeMaterial?: boolean }).isNodeMaterial &&
      material.side === THREE.BackSide
    ) {
      mesh.geometry = flipGeometryWinding(mesh.geometry)
    }
    mesh.material = convertMaterial(material, cache)
  })
}

function flipGeometryWinding(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const flipped = geometry.clone()
  const index = flipped.getIndex()
  if (index) {
    const a = index.array
    for (let i = 0; i < a.length; i += 3) {
      const tmp = a[i]!
      a[i] = a[i + 2]!
      a[i + 2] = tmp
    }
    index.needsUpdate = true
  } else {
    for (const attribute of Object.values(flipped.attributes)) {
      const { array, itemSize } = attribute
      for (let i = 0; i < array.length; i += itemSize * 3) {
        for (let k = 0; k < itemSize; k++) {
          const tmp = array[i + k]!
          array[i + k] = array[i + 2 * itemSize + k]!
          array[i + 2 * itemSize + k] = tmp
        }
      }
      attribute.needsUpdate = true
    }
  }
  const normal = flipped.getAttribute('normal')
  if (normal) {
    for (let i = 0; i < normal.array.length; i++) normal.array[i] = -normal.array[i]!
    normal.needsUpdate = true
  }
  return flipped
}

function convertMaterial(
  material: THREE.Material,
  cache: Map<THREE.Material, THREE.Material>,
): THREE.Material {
  if ((material as { isNodeMaterial?: boolean }).isNodeMaterial !== true) return material

  const cached = cache.get(material)
  if (cached) return cached

  const src = material as THREE.Material & Record<string, unknown>
  const target = new THREE.MeshStandardMaterial()
  target.name = material.name
  if (src.color instanceof THREE.Color) target.color.copy(src.color)
  if (src.emissive instanceof THREE.Color) target.emissive.copy(src.emissive)
  if (typeof src.emissiveIntensity === 'number') target.emissiveIntensity = src.emissiveIntensity
  target.roughness = typeof src.roughness === 'number' ? src.roughness : 1
  target.metalness = typeof src.metalness === 'number' ? src.metalness : 0
  target.transparent = material.transparent && material.opacity < 1
  target.opacity = material.opacity
  target.side = material.side === THREE.BackSide ? THREE.FrontSide : material.side
  target.alphaTest = material.alphaTest
  target.depthWrite = material.depthWrite
  target.depthTest = material.depthTest
  target.vertexColors = material.vertexColors
  target.toneMapped = material.toneMapped
  if (src.normalScale instanceof THREE.Vector2) target.normalScale.copy(src.normalScale)
  if (typeof src.aoMapIntensity === 'number') target.aoMapIntensity = src.aoMapIntensity
  if (typeof src.displacementScale === 'number') target.displacementScale = src.displacementScale

  for (const slot of STANDARD_MAP_SLOTS) {
    const texture = src[slot]
    if (texture instanceof THREE.Texture) {
      ;(target as unknown as Record<string, THREE.Texture>)[slot] = texture
    }
  }

  cache.set(material, target)
  return target
}

function bakeAnimationClips(
  cloneByOriginal: Map<THREE.Object3D, THREE.Object3D>,
  nodes: Record<string, AnyNode>,
): { clips: THREE.AnimationClip[]; clipNamesByNode: Map<string, string[]> } {
  const clips: THREE.AnimationClip[] = []
  const clipNamesByNode = new Map<string, string[]>()

  for (const [id, original] of sceneRegistry.nodes) {
    const node = nodes[id]
    const target = cloneByOriginal.get(original)
    if (!node || !target) continue

    const clip =
      node.type === 'door'
        ? bakeDoorClip(id, node, target)
        : node.type === 'window'
          ? bakeWindowClip(id, node as WindowNode, target)
          : null

    if (clip) {
      clips.push(clip)
      clipNamesByNode.set(id, [clip.name])
    }
  }

  return { clips, clipNamesByNode }
}

function bakeDoorClip(
  id: string,
  node: AnyNode,
  doorObject: THREE.Object3D,
): THREE.AnimationClip | null {
  if (node.type === 'door' && isOperationDoorType((node as DoorNode).doorType)) {
    return bakeOperationDoorClip(id, node as DoorNode, doorObject)
  }
  return bakeSwingDoorClip(id, doorObject)
}

function bakeOperationDoorClip(
  id: string,
  node: DoorNode,
  doorObject: THREE.Object3D,
): THREE.AnimationClip | null {
  if (!poseDoorMovingParts(node, doorObject, 0)) return null

  const objects: THREE.Object3D[] = []
  doorObject.traverse((object) => objects.push(object))
  const basePoses = objects.map((object) => ({
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
  }))

  const times: number[] = []
  const positionSamples = objects.map(() => [] as number[])
  const quaternionSamples = objects.map(() => [] as number[])
  const scaleSamples = objects.map(() => [] as number[])

  for (let step = 0; step <= OPERATION_DOOR_SAMPLES; step++) {
    const t = step / OPERATION_DOOR_SAMPLES
    times.push(t)
    poseDoorMovingParts(node, doorObject, t)
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i]!
      positionSamples[i]!.push(...object.position.toArray())
      quaternionSamples[i]!.push(...object.quaternion.toArray())
      scaleSamples[i]!.push(...object.scale.toArray())
    }
  }

  const tracks: THREE.KeyframeTrack[] = []
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i]!
    const base = basePoses[i]!
    if (samplesMovePosition(positionSamples[i]!, base.position)) {
      tracks.push(
        new THREE.VectorKeyframeTrack(`${object.uuid}.position`, times, positionSamples[i]!),
      )
    }
    if (samplesMoveQuaternion(quaternionSamples[i]!, base.quaternion)) {
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${object.uuid}.quaternion`,
          times,
          quaternionSamples[i]!,
        ),
      )
    }
    if (samplesMoveScale(scaleSamples[i]!, base.scale)) {
      tracks.push(new THREE.VectorKeyframeTrack(`${object.uuid}.scale`, times, scaleSamples[i]!))
    }
  }

  poseDoorMovingParts(node, doorObject, 0)
  if (tracks.length === 0) return null
  return openClip(id, tracks)
}

function samplesMovePosition(flat: number[], base: THREE.Vector3): boolean {
  const point = new THREE.Vector3()
  for (let i = 0; i < flat.length; i += 3) {
    point.set(flat[i]!, flat[i + 1]!, flat[i + 2]!)
    if (point.distanceToSquared(base) > POSE_EPSILON) return true
  }
  return false
}

function samplesMoveQuaternion(flat: number[], base: THREE.Quaternion): boolean {
  const quaternion = new THREE.Quaternion()
  for (let i = 0; i < flat.length; i += 4) {
    quaternion.set(flat[i]!, flat[i + 1]!, flat[i + 2]!, flat[i + 3]!)
    if (base.angleTo(quaternion) > POSE_EPSILON) return true
  }
  return false
}

function samplesMoveScale(flat: number[], base: THREE.Vector3): boolean {
  const point = new THREE.Vector3()
  for (let i = 0; i < flat.length; i += 3) {
    point.set(flat[i]!, flat[i + 1]!, flat[i + 2]!)
    if (point.distanceToSquared(base) > POSE_EPSILON) return true
  }
  return false
}

function bakeSwingDoorClip(id: string, doorObject: THREE.Object3D): THREE.AnimationClip | null {
  const tracks: THREE.KeyframeTrack[] = []

  doorObject.traverse((object) => {
    const marker = object.userData.pascalSwingLeaf as SwingLeafMarker | undefined
    if (!marker || marker.axis !== 'y') return

    object.rotation.y = 0
    const closed = object.quaternion.clone()
    object.rotation.y = marker.openRotationY
    const open = object.quaternion.clone()
    object.rotation.y = 0

    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${object.uuid}.quaternion`,
        [0, 1],
        [...closed.toArray(), ...open.toArray()],
      ),
    )
  })

  if (tracks.length === 0) return null
  return openClip(id, tracks)
}

function openClip(id: string, tracks: THREE.KeyframeTrack[]): THREE.AnimationClip {
  const clip = new THREE.AnimationClip(`${id}: open`, 1, tracks)
  clip.userData = { loop: false }
  return clip
}

function bakeWindowClip(
  id: string,
  node: WindowNode,
  windowObject: THREE.Object3D,
): THREE.AnimationClip | null {
  poseWindowMovingParts(node, windowObject, 0)

  const closedPoses = new Map<
    THREE.Object3D,
    { position: THREE.Vector3; quaternion: THREE.Quaternion }
  >()
  windowObject.traverse((object) => {
    closedPoses.set(object, {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
    })
  })

  if (!poseWindowMovingParts(node, windowObject, 1)) return null

  const tracks: THREE.KeyframeTrack[] = []
  windowObject.traverse((object) => {
    const closed = closedPoses.get(object)
    if (!closed) return

    if (object.position.distanceToSquared(closed.position) > POSE_EPSILON) {
      tracks.push(
        new THREE.VectorKeyframeTrack(
          `${object.uuid}.position`,
          [0, 1],
          [...closed.position.toArray(), ...object.position.toArray()],
        ),
      )
    }
    if (closed.quaternion.angleTo(object.quaternion) > POSE_EPSILON) {
      tracks.push(
        new THREE.QuaternionKeyframeTrack(
          `${object.uuid}.quaternion`,
          [0, 1],
          [...closed.quaternion.toArray(), ...object.quaternion.toArray()],
        ),
      )
    }
  })

  poseWindowMovingParts(node, windowObject, 0)
  if (tracks.length === 0) return null
  return openClip(id, tracks)
}

function nodeDisplayLabel(node: AnyNode): string {
  if (node.name) return node.name
  switch (node.type) {
    case 'item':
      return (node as { asset?: { name?: string } }).asset?.name || 'Item'
    case 'wall':
      return 'Wall'
    case 'door':
      return 'Door'
    case 'window':
      return 'Window'
    case 'slab':
      return 'Slab'
    case 'ceiling':
      return 'Ceiling'
    case 'roof':
      return 'Roof'
    case 'fence':
      return 'Fence'
    case 'column':
      return 'Column'
    case 'stair':
      return 'Stairs'
    default:
      return node.type
  }
}

function stampIdentity(
  scene: THREE.Object3D,
  cloneByOriginal: Map<THREE.Object3D, THREE.Object3D>,
  nodes: Record<string, AnyNode>,
  clipNamesByNode: Map<string, string[]>,
) {
  scene.traverse((object) => {
    object.userData = {}
  })

  for (const [id, original] of sceneRegistry.nodes) {
    const node = nodes[id]
    const target = cloneByOriginal.get(original)
    if (!node || !target) continue

    target.name = id
    const extras: Record<string, unknown> = {
      pascalId: id,
      kind: node.type,
      label: nodeDisplayLabel(node),
    }
    if (node.camera) extras.camera = node.camera
    if (node.type === 'level') {
      extras.label = getLevelDisplayName(node as LevelNode)
      target.visible = true
    }
    if (node.type === 'door' || node.type === 'window') {
      const clipNames = clipNamesByNode.get(id)
      if (clipNames?.length) {
        extras.openable = true
        extras.clips = clipNames
      }
    }
    if (node.type === 'zone') {
      const zone = node as ZoneNode
      extras.polygon = zone.polygon
      extras.color = zone.color
      target.visible = true
    }
    if (node.type === 'spawn') {
      extras.rotation = (node as { rotation?: number }).rotation ?? 0
      target.visible = true
    }
    target.userData = extras
  }
}

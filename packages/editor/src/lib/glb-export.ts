import {
  type AnyNode,
  type DoorNode,
  emitter,
  getLevelDisplayName,
  isOperationDoorType,
  itemClipRegistry,
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

/**
 * Two TRS samples (closed vs open) differing by less than this are treated as
 * stationary, so only genuinely moving parts get an animation track.
 */
const POSE_EPSILON = 1e-5

/**
 * Marker stamped on a door's swing-leaf group by the door system. `axis` is the
 * hinge axis and `openRotationY` is the fully-open angle (radians). The export
 * reads it to bake an open clip from a single closed pose; see `door-system`.
 */
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
  // Snap levels to their true stacked positions (like thumbnail capture) so the
  // export always reflects the clean stacked building, regardless of the live
  // levelMode (exploded/solo) or an unsettled level lerp that could otherwise
  // bake a level at a stray offset.
  const restoreLevels = snapLevelsToTruePositions()
  let prepared: ReturnType<typeof prepareSceneForExport>
  try {
    prepared = prepareSceneForExport(sceneGroup, nodes)
  } finally {
    restoreLevels()
    emitter.emit('thumbnail:after-capture', undefined)
  }
  const { scene: exportScene, animations } = prepared

  const exporter = new GLTFExporter()
  // Painted finishes use KTX2 (GPU-compressed) maps; GLTFExporter can't read
  // those directly. WebGPUTextureUtils blits each one to RGBA on its own
  // offscreen renderer (passing the live renderer would resize/draw over the
  // editor canvas), letting the exporter embed standard textures.
  exporter.setTextureUtils(WebGPUTextureUtils)

  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      exportScene,
      (gltf) => {
        resolve(gltf as ArrayBuffer)
      },
      (error) => {
        reject(error)
      },
      { binary: true, animations },
    )
  })
}

/**
 * Build an engine-agnostic export tree from the live scene graph. The result is
 * a standalone three.js scene plus glTF animation clips, ready for
 * `GLTFExporter` — it carries no Pascal runtime dependency.
 *
 *  - Clones the source so live objects are never mutated.
 *  - Converts WebGPU NodeMaterials to classic glTF-standard materials.
 *    `GLTFExporter` only recognises `isMeshStandardMaterial` /
 *    `isMeshBasicMaterial`; the viewer's `MeshStandard/LambertNodeMaterial` set
 *    `isNodeMaterial` instead, so without this every surface exports as a blank
 *    default material.
 *  - Bakes each openable door/window's open motion into a glTF animation clip
 *    via the build-once + pose-at-t primitives (`pascalSwingLeaf` for doors,
 *    `poseWindowMovingParts` for windows).
 *  - Stamps `name` + `extras` identity from `sceneRegistry` so selection/hover
 *    survive the bake with no in-memory registry, and strips all other userData
 *    so editor/runtime ephemera never leak into glTF extras.
 */
export function prepareSceneForExport(
  source: THREE.Object3D,
  nodes: Record<string, AnyNode>,
): GlbExport {
  const scene = source.clone(true)
  const cloneByOriginal = pairClones(source, scene)

  // Scans (LiDAR meshes) and guides (floorplan images) are heavy reference
  // assets stored elsewhere and aren't part of the compiled building. Drop them
  // from the artifact entirely — `/viewer` re-adds them from the scene graph,
  // gated by the project's public-visibility flags, so they never bloat the
  // shared GLB nor slip past those flags into a static public file.
  for (const [id, original] of sceneRegistry.nodes) {
    const node = nodes[id]
    if (node?.type === 'scan' || node?.type === 'guide') {
      cloneByOriginal.get(original)?.removeFromParent()
    }
  }

  // Object3Ds that carry node identity — never strip these even when they sit on
  // a non-scene layer. Some are metadata-only: a zone's visible fill/wall meshes
  // are stripped, but its identity node stays to carry the polygon that /viewer
  // reconstructs the room from.
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

/**
 * Pair each original Object3D with its clone. `clone(true)` builds children in
 * source order, so parallel pre-order traversals line up 1:1 — this is how we
 * map `sceneRegistry`'s live refs onto the export tree without mutating either.
 */
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

// A single empty geometry shared by every container mesh we neutralise below —
// it has no attributes, so GLTFExporter's processMesh returns null and emits a
// plain transform node instead of a primitive.
const EMPTY_GEOMETRY = new THREE.BufferGeometry()

// Hidden placeholder for a neutralised renderable that has no material: a valid
// material keeps GLTFExporter from crashing on `material.isShaderMaterial`, while
// EMPTY_GEOMETRY makes it emit a transform node instead of a primitive.
const PLACEHOLDER_MATERIAL = new THREE.MeshBasicMaterial({ visible: false })

/**
 * Strip everything that must not bake into the model:
 *  - Editor overlays on non-scene layers (gizmos, selection handles, ground
 *    grid, zone fills). The editor camera shows them via extra layers; a
 *    thumbnail/bake is layer 0 only. Scene-layer affordances that can't be
 *    layer-filtered (ceiling/site brackets) are hidden by the caller's
 *    `thumbnail:before-capture` emit before the clone instead.
 *  - Selection hitboxes, whose invisibility lives on `material.visible = false`
 *    (which GLTFExporter's `onlyVisible` does not catch). A door/window's hitbox
 *    root is a box spanning the wall opening — left in, it plugs the cutout.
 *    With children (it parents the visible frame + leaf) it keeps its node but
 *    loses its geometry; childless ones are removed outright.
 */
function pruneNonRenderableMeshes(root: THREE.Object3D, identityNodes: Set<THREE.Object3D>) {
  const toRemove: THREE.Object3D[] = []
  root.traverse((object) => {
    // Editor-only overlays (gizmos, selection handles, ground grid, zone fills)
    // live off the scene layer; the editor camera shows them via extra layers
    // but a thumbnail/bake only wants layer 0. Drop the whole overlay subtree —
    // except identity nodes, which we keep (their off-layer mesh children are
    // still pruned as the traversal continues).
    if (!object.layers.isEnabled(SCENE_LAYER)) {
      if (identityNodes.has(object)) return
      toRemove.push(object)
      return
    }
    // A renderable (Mesh / Line / Points) with no material can't produce valid
    // glTF and crashes GLTFExporter, which reads `material.isShaderMaterial`
    // unconditionally — e.g. an imported sub-model that left a mesh material-less.
    // Non-Mesh renderables also slip past the `isMesh` checks below and the
    // material conversion. Neutralise it: keep the node (so children survive) but
    // strip its geometry + give it the hidden placeholder, or drop it if a leaf.
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
  for (const object of toRemove) {
    object.removeFromParent()
  }
}

function isRenderableMesh(mesh: THREE.Mesh): boolean {
  const position = mesh.geometry?.getAttribute('position')
  if (!position || position.count === 0) return false
  const material = mesh.material
  return Array.isArray(material)
    ? material.some((m) => m?.visible !== false)
    : material?.visible !== false
}

// --- Material conversion -------------------------------------------------

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
    // glTF has no BackSide — GLTFExporter renders the *front* face for any
    // non-DoubleSide material, which inverts a BackSide surface (e.g. the
    // ceiling underside, meant to be seen from the room). Flip the mesh winding
    // so the intended face shows with the FrontSide material convertMaterial
    // produces. Per-mesh geometry clone keeps shared geometry untouched.
    if (
      (material as { isNodeMaterial?: boolean }).isNodeMaterial &&
      material.side === THREE.BackSide
    ) {
      mesh.geometry = flipGeometryWinding(mesh.geometry)
    }
    mesh.material = convertMaterial(material, cache)
  })
}

/**
 * Reverse triangle winding and negate normals so a surface authored for
 * `BackSide` reads correctly once exported as `FrontSide` (glTF can't express
 * back-face-only rendering).
 */
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

/**
 * Convert a viewer NodeMaterial into the classic `MeshStandardMaterial` the
 * glTF exporter understands. Classic materials pass through untouched, and the
 * cache preserves material sharing (one source instance -> one target), so the
 * exporter still dedups shared surfaces.
 */
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
  // Lambert (solid-shading / glass) node materials carry no PBR scalars; a fully
  // rough, non-metallic surface is the faithful lit fallback.
  target.roughness = typeof src.roughness === 'number' ? src.roughness : 1
  target.metalness = typeof src.metalness === 'number' ? src.metalness : 0
  // Only genuinely see-through surfaces stay transparent. Several viewer
  // materials set `transparent: true` while fully opaque (opacity 1); exporting
  // those as alphaMode=BLEND makes them render see-through with no depth write
  // (e.g. the ceiling looked semi-transparent). Glass (opacity < 1) is kept.
  target.transparent = material.transparent && material.opacity < 1
  target.opacity = material.opacity
  // BackSide is flipped to FrontSide (with the mesh winding reversed in
  // convertMaterials) because glTF has no back-face-only mode.
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

// --- Animation clip baking ----------------------------------------------

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
          : node.type === 'item'
            ? bakeItemClip(id, target)
            : null

    if (clip) {
      clips.push(clip)
      clipNamesByNode.set(id, [clip.name])
    }
  }

  return { clips, clipNamesByNode }
}

/**
 * Re-emit a catalog item's ambient clip (e.g. a fan's spin) onto the baked
 * subtree. The source clip targets the item GLB's nodes by name (`lamp_018`);
 * since every fan shares those names, we rebind each track to the specific
 * cloned node's uuid so multiple fans animate independently. The clip is named
 * per node (`<id>: loop`) so the baked viewer can drive each one on its own.
 */
function bakeItemClip(id: string, itemObject: THREE.Object3D): THREE.AnimationClip | null {
  const entry = itemClipRegistry.get(id)
  if (!entry) return null

  const tracks: THREE.KeyframeTrack[] = []
  // The catalog node names (e.g. "lamp_018") repeat across every instance of the
  // item, and the glTF export→import roundtrip rebinds clip tracks by node name —
  // so a shared name would make all fans share one clip. Uniquify the targeted
  // node's name per item once, then bind tracks by its (stable) uuid.
  const renamed = new Map<string, THREE.Object3D>()
  for (const track of entry.clip.tracks) {
    const dot = track.name.lastIndexOf('.')
    if (dot < 0) continue
    const targetName = track.name.slice(0, dot)
    const property = track.name.slice(dot + 1)
    let targetNode = renamed.get(targetName)
    if (!targetNode) {
      const found = itemObject.getObjectByName(targetName)
      if (!found) continue
      found.name = `${id}__${targetName}`
      renamed.set(targetName, found)
      targetNode = found
    }
    const retargeted = track.clone()
    retargeted.name = `${targetNode.uuid}.${property}`
    tracks.push(retargeted)
  }

  if (tracks.length === 0) return null
  const clip = new THREE.AnimationClip(`${id}: loop`, entry.clip.duration, tracks)
  clip.userData = { loop: entry.loop }
  return clip
}

/**
 * Bake a door's open motion. Swing doors (hinged/double/french) carry a
 * `pascalSwingLeaf` marker and bake a single quaternion track per leaf;
 * operation doors (sliding/pocket/barn/folding/garage-*) build their moving
 * parts in named groups posed by `poseDoorMovingParts`, sampled here into
 * keyframes (their motion is non-linear, e.g. the sectional's overhead curve).
 */
function bakeDoorClip(
  id: string,
  node: AnyNode,
  doorObject: THREE.Object3D,
): THREE.AnimationClip | null {
  if (node.type === 'door' && isOperationDoorType((node as DoorNode).doorType)) {
    return bakeOperationDoorClip(id, node as DoorNode, doorObject)
  }
  return bakeSwingDoorClip(id, node, doorObject)
}

/** Number of keyframes sampled across an operation door's 0→1 open motion. */
const OPERATION_DOOR_SAMPLES = 16

/**
 * Sample an operation door's open motion into keyframe tracks by posing the
 * export clone with `poseDoorMovingParts` at evenly-spaced fractions. Only the
 * named moving groups change (their children are rigid), so a track is emitted
 * per group whose position / rotation / scale actually moves. The clone is left
 * posed closed so the GLB's rest state is shut.
 */
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

/**
 * Bake a swing door's open motion. Each marked leaf is rotated from closed
 * (rest pose) to its fully-open angle and emitted as a 1-second quaternion
 * track; the leaf is left at the closed pose so the GLB's rest state is shut.
 */
function bakeSwingDoorClip(
  id: string,
  node: AnyNode,
  doorObject: THREE.Object3D,
): THREE.AnimationClip | null {
  const tracks: THREE.KeyframeTrack[] = []

  doorObject.traverse((object) => {
    const marker = object.userData.pascalSwingLeaf as SwingLeafMarker | undefined
    if (marker?.axis !== 'y') return

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

/**
 * Wrap an open motion in a named 1-second clip. The name is keyed by the node id
 * (`<id>: open`), NOT the node's display name: clip names must be unique because
 * the baked viewer drives playback by clip name (`useAnimations` maps name →
 * action), so two same-named openables (e.g. several "Window 1"s) would collapse
 * to a single action and a trigger on one would animate another. The
 * human-readable name lives in `extras.label` instead. glTF has no core loop
 * flag — the player decides — so we stamp `extras.loop = false` (via the clip's
 * userData, which `GLTFExporter` serialises onto the animation): Pascal's
 * `/viewer` and any extras-aware consumer play it once and hold the open pose; a
 * dumb glTF player still loops. Consumers map a clip back to its node by walking
 * up from a channel's target to the nearest ancestor carrying `extras.pascalId`.
 */
function openClip(id: string, tracks: THREE.KeyframeTrack[]): THREE.AnimationClip {
  const clip = new THREE.AnimationClip(`${id}: open`, 1, tracks)
  clip.userData = { loop: false }
  return clip
}

/**
 * Bake a window's open motion generically: snapshot every part's pose closed,
 * pose the subtree open, and emit a track for whichever parts actually moved
 * (translation for sliding/hung sashes, rotation for casement/awning/louvre).
 * Reusing the live `poseWindowMovingParts` keeps one source of truth for window
 * kinematics. The subtree is left posed closed as the GLB's rest state.
 */
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

// --- Identity stamping ---------------------------------------------------

/**
 * Replace every clone's userData with `{}`, then stamp identity onto the nodes
 * that `sceneRegistry` tracks. Wiping first guarantees no editor/runtime marker
 * (e.g. `pascalSwingLeaf`, cached-material flags) leaks into glTF extras — the
 * file describes itself with exactly the fields a consumer needs.
 */
/**
 * Human-readable label for a baked node, mirroring the viewer's `getNodeName`:
 * an explicit name wins, items fall back to their catalog asset name, other
 * kinds to a capitalized type. Levels override this with their display name.
 */
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
    const extras: Record<string, unknown> = { pascalId: id, kind: node.type }
    // Stamp a human label for every node (catalog name for items, a type label
    // otherwise) so the viewer breadcrumb/hover read names, not raw pascalIds.
    extras.label = nodeDisplayLabel(node)
    // Camera bookmarks ride on the identity node (any kind can carry one) so the
    // baked viewer flies to a saved pose on selection without a side file.
    if (node.camera) extras.camera = node.camera
    // Levels carry no stored name; stamp the editor's display name ("Level 1")
    // so the baked viewer's level/breadcrumb UI reads the same labels. Force the
    // node visible: the bake must capture every floor regardless of the editor's
    // current level mode (solo/hidden floors would otherwise be dropped by
    // GLTFExporter's `onlyVisible`).
    if (node.type === 'level') {
      extras.label = getLevelDisplayName(node as LevelNode)
      target.visible = true
    }
    // Only doors/windows that actually baked an open clip are openable. A cased
    // opening (no leaf) or a fixed window (no operable sash) produces no clip, so
    // it stays unflagged — the file never claims a part opens when nothing moves.
    if (node.type === 'door' || node.type === 'window') {
      const clipNames = clipNamesByNode.get(id)
      if (clipNames?.length) {
        extras.openable = true
        extras.clips = clipNames
      }
    }
    // Items with a baked ambient clip (a fan's spin) carry the clip name but no
    // `openable` flag — nothing opens; the clip just loops.
    if (node.type === 'item') {
      const clipNames = clipNamesByNode.get(id)
      if (clipNames?.length) extras.clips = clipNames
    }
    if (node.type === 'zone') {
      // Zone fills are stripped from the bake; /viewer rebuilds the room from
      // this polygon. Force the identity node visible so GLTFExporter's
      // `onlyVisible` keeps it even when the editor had zones hidden at export.
      const zone = node as ZoneNode
      extras.polygon = zone.polygon
      extras.color = zone.color
      target.visible = true
    }
    if (node.type === 'spawn') {
      // The spawn marker's visible mesh lives on a non-scene overlay layer (and
      // is pruned), so this identity node is an empty transform. Keep it + force
      // visible so the baked walkthrough can read its world position/yaw and
      // start the player there (`extras.rotation` mirrors the node's yaw).
      extras.rotation = (node as { rotation?: number }).rotation ?? 0
      target.visible = true
    }
    target.userData = extras
  }
}

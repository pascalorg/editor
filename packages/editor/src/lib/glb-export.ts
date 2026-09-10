import {
  type AnyNode,
  type AnyNodeId,
  bakePolicyOf,
  type DoorNode,
  emitter,
  findLevelAncestorId,
  type GeometryContext,
  getLevelDisplayName,
  isNodeKindEnabled,
  isOperationDoorType,
  itemClipRegistry,
  type LevelNode,
  levelBaseElevationAt,
  nodeRegistry,
  sceneRegistry,
  useScene,
  type WindowNode,
  type ZoneNode,
} from '@pascal-app/core'
import {
  getPascalTextureRef,
  isViewerPresentationTextureBorrowed,
  poseDoorMovingParts,
  poseWindowMovingParts,
  SCENE_LAYER,
  snapLevelsToTruePositions,
  type ViewerPresentationContribution,
  viewerPresentationRegistry,
} from '@pascal-app/viewer'
import type { Object3D } from 'three'
import * as THREE from 'three'
import {
  GLTFExporter,
  type GLTFExporterPlugin,
  type GLTFWriter,
} from 'three/examples/jsm/exporters/GLTFExporter.js'
import * as WebGPUTextureUtils from 'three/examples/jsm/utils/WebGPUTextureUtils.js'
import {
  disposeExportResources,
  normalizePortableScene,
  normalizeViewerArtifactMaterials,
} from './portable-export'

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
  warnings: string[]
  dispose: () => void
}

export type GlbExportOptions = {
  textures?: 'embed' | 'reference'
  onlyVisible?: boolean
  /** Omit these node kinds and their rendered subtrees before baking. */
  excludedNodeTypes?: readonly string[]
  /** Selected static viewer-presentation contributions; omitted means none. */
  includedPresentationIds?: readonly string[]
  /** Portable downloads are static; the baked viewer retains internal clips. */
  purpose?: 'portable' | 'viewer'
  /** Called for actual lossy portable conversions discovered during preparation. */
  onWarning?: (warning: string) => void
}

/** Resolve after the next couple of animation frames, giving React/R3F time to
 * commit and mount export-only geometry (e.g. instanced kinds' real meshes)
 * before the exporter clones the scene graph. Callers must set
 * `useViewer.setExporting(true)` first and reset it after the export. */
export function nextFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

type GltfExtrasDef = {
  extras?: Record<string, unknown>
}

type TextureReferenceWriter = GLTFWriter & {
  json: {
    images?: GltfExtrasDef[]
  }
}

function getExportedImageIndex(textureDef: Record<string, unknown>): number | null {
  if (Number.isInteger(textureDef.source)) return textureDef.source as number
  const extensions = textureDef.extensions as Record<string, { source?: unknown }> | undefined
  const source = extensions?.EXT_texture_webp?.source ?? extensions?.EXT_texture_avif?.source
  return Number.isInteger(source) ? (source as number) : null
}

export function writeTextureReferenceExtras(
  writer: GLTFWriter,
  texture: THREE.Texture,
  textureDef: Record<string, unknown>,
) {
  const ref = getPascalTextureRef(texture)
  if (!ref) return

  const imageIndex = getExportedImageIndex(textureDef)
  const imageDef =
    imageIndex === null ? undefined : (writer as TextureReferenceWriter).json.images?.[imageIndex]
  if (!imageDef) {
    throw new Error('GLTFExporter did not expose an image for a referenced Pascal texture')
  }

  const textureWithExtras = textureDef as GltfExtrasDef
  textureWithExtras.extras = {
    ...textureWithExtras.extras,
    pascalTextureRef: ref,
  }
  imageDef.extras = {
    ...imageDef.extras,
    pascalTextureRef: ref,
  }
}

function textureReferencePlugin(writer: GLTFWriter): GLTFExporterPlugin {
  return {
    writeTexture: (texture, textureDef) => {
      writeTextureReferenceExtras(writer, texture, textureDef)
    },
  }
}

export async function exportSceneToGlb(
  sceneGroup: Object3D,
  nodes: Record<string, AnyNode>,
  options: GlbExportOptions = {},
): Promise<ArrayBuffer> {
  const textureMode = options.textures ?? 'embed'
  const prepared = await preparePortableSceneFromViewer(sceneGroup, nodes, options)
  for (const warning of prepared.warnings) options.onWarning?.(warning)
  try {
    return await serializePreparedSceneToGlb(prepared, {
      textures: textureMode,
      onlyVisible: options.onlyVisible,
    })
  } finally {
    prepared.dispose()
  }
}
/**
 * Capture the live renderer synchronously, restore editor presentation, then do
 * async offscreen material/presentation work against only the owned clone.
 */
export async function preparePortableSceneFromViewer(
  sceneGroup: Object3D,
  nodes: Record<string, AnyNode>,
  options: GlbExportOptions = {},
): Promise<GlbExport> {
  emitter.emit('thumbnail:before-capture', undefined)
  const restoreLevels = snapLevelsToTruePositions()
  let preparation: SceneExportPreparation
  try {
    preparation = startSceneExportPreparation(sceneGroup, nodes, {
      ...options,
      purpose: options.purpose ?? 'portable',
    })
  } finally {
    restoreLevels()
    emitter.emit('thumbnail:after-capture', undefined)
  }
  return completeSceneExportPreparation(preparation)
}

export function serializePreparedSceneToGlb(
  prepared: GlbExport,
  options: Pick<GlbExportOptions, 'textures' | 'onlyVisible'> = {},
): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter()
  if ((options.textures ?? 'embed') === 'reference') {
    exporter.register(textureReferencePlugin)
  }
  exporter.setTextureUtils(WebGPUTextureUtils)

  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      prepared.scene,
      (gltf) => {
        resolve(gltf as ArrayBuffer)
      },
      (error) => {
        reject(error)
      },
      {
        binary: true,
        animations: prepared.animations,
        onlyVisible: options.onlyVisible ?? true,
      },
    )
  })
}

type RegistryEntry = readonly [id: string, original: THREE.Object3D]

type SelectedPresentation = {
  contribution: ViewerPresentationContribution
  configuration: unknown
}

type SceneExportPreparation = {
  scene: THREE.Object3D
  nodes: Record<string, AnyNode>
  options: GlbExportOptions
  registryEntries: RegistryEntry[]
  cloneByOriginal: Map<THREE.Object3D, THREE.Object3D>
  builders: Map<
    string,
    {
      sync: ((node: AnyNode, ctx: GeometryContext) => THREE.Object3D) | undefined
      async: ((node: AnyNode, ctx: GeometryContext) => Promise<THREE.Object3D>) | undefined
    }
  >
  geometryContext: Pick<GeometryContext, 'materials' | 'levelData'>
  presentations: SelectedPresentation[]
}

/**
 * Build the legacy synchronous artifact used by geometry-only/print exports.
 * The default remains viewer-purpose so existing internal baked-viewer clips
 * are unchanged; portable downloads use the async entry point below.
 */
export function prepareSceneForExport(
  source: THREE.Object3D,
  nodes: Record<string, AnyNode>,
  options: GlbExportOptions = {},
): GlbExport {
  const preparation = startSceneExportPreparation(source, nodes, {
    ...options,
    purpose: options.purpose ?? 'viewer',
  })
  try {
    replaceBakeGeometrySync(preparation)
    return finishSceneExportPreparation(preparation)
  } catch (error) {
    disposeExportResources(preparation.scene)
    throw error
  }
}

/** Capture once, await async bake hooks, then normalize a static portable tree. */
export async function prepareSceneForExportAsync(
  source: THREE.Object3D,
  nodes: Record<string, AnyNode>,
  options: GlbExportOptions = {},
): Promise<GlbExport> {
  const preparation = startSceneExportPreparation(source, nodes, {
    ...options,
    purpose: options.purpose ?? 'portable',
  })
  return completeSceneExportPreparation(preparation)
}

function startSceneExportPreparation(
  source: THREE.Object3D,
  inputNodes: Record<string, AnyNode>,
  options: GlbExportOptions,
): SceneExportPreparation {
  const nodes = structuredClone(inputNodes)
  const registryEntries = Array.from(sceneRegistry.nodes.entries())
  const excludedNodeTypes = new Set(options.excludedNodeTypes)
  const excludedObjects = new Set<THREE.Object3D>()
  const builders: SceneExportPreparation['builders'] = new Map()
  const sceneState = useScene.getState()

  for (const [id, original] of registryEntries) {
    const node = nodes[id]
    if (!node) continue
    const installedPlugins = sceneState.hasExplicitPluginInstallState
      ? sceneState.installedPlugins
      : undefined
    if (!isNodeKindEnabled(node.type, installedPlugins)) {
      excludedObjects.add(original)
      continue
    }
    const definition = nodeRegistry.get(node.type)
    builders.set(id, {
      sync: definition?.bakeGeometry as
        | ((node: AnyNode, ctx: GeometryContext) => THREE.Object3D)
        | undefined,
      async: definition?.bakeGeometryAsync as
        | ((node: AnyNode, ctx: GeometryContext) => Promise<THREE.Object3D>)
        | undefined,
    })
    if (bakePolicyOf(node.type) === 'strip' || excludedNodeTypes.has(node.type)) {
      excludedObjects.add(original)
    }
  }

  const selectedIds = new Set(options.includedPresentationIds ?? [])
  const registeredPresentations = viewerPresentationRegistry.getSnapshot()
  const presentations: SelectedPresentation[] = []
  for (const id of selectedIds) {
    const contribution = registeredPresentations.find((entry) => entry.id === id)
    if (!contribution?.staticExport) {
      throw new Error(`Static viewer presentation "${id}" is not registered`)
    }
    if (contribution.pluginId && !sceneState.installedPlugins.includes(contribution.pluginId)) {
      throw new Error(`Static viewer presentation "${id}" belongs to an uninstalled plugin`)
    }
    presentations.push({
      contribution,
      configuration: contribution.configuration?.getSnapshot(),
    })
  }

  const cloneByOriginal = new Map<THREE.Object3D, THREE.Object3D>()
  const scene = cloneSceneForExport(source, excludedObjects, cloneByOriginal)
  cloneSkinnedSkeletons(cloneByOriginal)
  if (options.onlyVisible ?? true) {
    pruneHiddenSceneNodes(cloneByOriginal, nodes, registryEntries)
  }

  return {
    scene,
    nodes,
    options,
    registryEntries,
    cloneByOriginal,
    builders,
    geometryContext: {
      levelData: undefined,
      materials: structuredClone(sceneState.materials),
    },
    presentations,
  }
}

async function completeSceneExportPreparation(
  preparation: SceneExportPreparation,
): Promise<GlbExport> {
  try {
    await replaceBakeGeometryAsync(preparation)
    await appendSelectedPresentations(preparation)
    const prepared = finishSceneExportPreparation(preparation)
    prepared.warnings.push(
      ...(preparation.options.purpose === 'viewer'
        ? normalizeViewerArtifactMaterials(prepared.scene)
        : normalizePortableScene(prepared.scene)),
    )
    return prepared
  } catch (error) {
    disposeExportResources(preparation.scene)
    throw error
  }
}

function finishSceneExportPreparation(preparation: SceneExportPreparation): GlbExport {
  const { scene, cloneByOriginal, nodes, options, registryEntries } = preparation
  const identityNodes = new Set<THREE.Object3D>()
  for (const [, original] of registryEntries) {
    const clone = cloneByOriginal.get(original)
    if (clone) identityNodes.add(clone)
  }

  pruneNonRenderableMeshes(scene, identityNodes)
  sanitizeMaterialGroups(scene, identityNodes)
  convertMaterials(scene, options.textures ?? 'embed', options.purpose ?? 'viewer')

  const retainedCloneByOriginal = retainedClones(scene, cloneByOriginal)
  const animation =
    options.purpose === 'viewer'
      ? bakeAnimationClips(retainedCloneByOriginal, nodes, registryEntries)
      : { clips: [], clipNamesByNode: new Map<string, string[]>() }
  stampIdentity(scene, retainedCloneByOriginal, nodes, animation.clipNamesByNode, registryEntries)

  let disposed = false
  return {
    scene,
    animations: animation.clips,
    warnings: [],
    dispose: () => {
      if (disposed) return
      disposed = true
      disposeExportResources(scene)
    },
  }
}

function replaceBakeGeometrySync(preparation: SceneExportPreparation): void {
  for (const [id, original] of preparation.registryEntries) {
    const node = preparation.nodes[id]
    const builder = preparation.builders.get(id)?.sync
    if (!node || !builder) continue
    const cloned = preparation.cloneByOriginal.get(original)
    if (!cloned || !isDescendantOf(cloned, preparation.scene)) continue
    replaceBakedNode(
      preparation,
      id,
      original,
      builder(node, buildBakeGeometryContext(node, preparation.nodes, preparation.geometryContext)),
      'bakeGeometry',
    )
  }
}

async function replaceBakeGeometryAsync(preparation: SceneExportPreparation): Promise<void> {
  for (const [id, original] of preparation.registryEntries) {
    const node = preparation.nodes[id]
    const builders = preparation.builders.get(id)
    if (!node || (!builders?.async && !builders?.sync)) continue
    const cloned = preparation.cloneByOriginal.get(original)
    if (!cloned || !isDescendantOf(cloned, preparation.scene)) continue
    const context = buildBakeGeometryContext(node, preparation.nodes, preparation.geometryContext)
    const replacement = builders.async
      ? await builders.async(node, context)
      : builders.sync!(node, context)
    replaceBakedNode(
      preparation,
      id,
      original,
      replacement,
      builders.async ? 'bakeGeometryAsync' : 'bakeGeometry',
    )
  }
}

function replaceBakedNode(
  preparation: SceneExportPreparation,
  id: string,
  original: THREE.Object3D,
  replacement: THREE.Object3D,
  hook: 'bakeGeometry' | 'bakeGeometryAsync',
): void {
  const cloned = preparation.cloneByOriginal.get(original)
  if (!cloned || !isDescendantOf(cloned, preparation.scene)) return
  const parent = cloned.parent
  if (!parent) throw new Error(`Cannot replace root export geometry for node ${id}`)
  if (replacement === cloned || replacement.parent) {
    throw new Error(
      `${hook} for ${preparation.nodes[id]?.type} must return a new detached Object3D`,
    )
  }

  const siblingIndex = parent.children.indexOf(cloned)
  replacement.position.copy(cloned.position)
  replacement.quaternion.copy(cloned.quaternion)
  replacement.scale.copy(cloned.scale)
  replacement.matrix.copy(cloned.matrix)
  replacement.matrixAutoUpdate = cloned.matrixAutoUpdate
  replacement.visible = cloned.visible
  replacement.layers.mask = cloned.layers.mask
  replacement.renderOrder = cloned.renderOrder
  parent.remove(cloned)
  parent.add(replacement)
  const appendedIndex = parent.children.indexOf(replacement)

  parent.children.splice(appendedIndex, 1)
  parent.children.splice(siblingIndex, 0, replacement)
  preparation.cloneByOriginal.set(original, replacement)
}
function ownBorrowedPresentationTextures(root: THREE.Object3D): void {
  const ownedTextures = new Map<THREE.Texture, THREE.Texture>()
  root.traverse((object) => {
    const renderable = object as THREE.Mesh
    if (!renderable.material) return
    const materials = Array.isArray(renderable.material)
      ? renderable.material
      : [renderable.material]
    for (const material of materials) {
      const textured = material as THREE.Material & Record<string, unknown>
      for (const slot of REFERENCE_MAP_SLOTS) {
        const sourceTexture = textured[slot]
        if (
          !(sourceTexture instanceof THREE.Texture) ||
          !isViewerPresentationTextureBorrowed(sourceTexture)
        ) {
          continue
        }
        let ownedTexture = ownedTextures.get(sourceTexture)
        if (!ownedTexture) {
          ownedTexture = sourceTexture.clone()
          ownedTexture.userData = structuredClone(sourceTexture.userData)
          ownedTexture.needsUpdate = true
          ownedTextures.set(sourceTexture, ownedTexture)
        }
        textured[slot] = ownedTexture
      }
    }
  })
}

async function appendSelectedPresentations(preparation: SceneExportPreparation): Promise<void> {
  for (const { contribution, configuration } of preparation.presentations) {
    const staticExport = contribution.staticExport!
    const built = await staticExport.build({
      nodes: preparation.nodes,
      configuration,
      onlyVisible: preparation.options.onlyVisible ?? true,
      excludedNodeTypes: preparation.options.excludedNodeTypes ?? [],
    })
    if (!built) continue
    if (built.parent) {
      throw new Error(`Static viewer presentation "${contribution.id}" returned an attached root`)
    }
    ownBorrowedPresentationTextures(built)
    const wrapper = new THREE.Group()
    wrapper.name = contribution.id
    wrapper.userData = {
      pascalPresentationId: contribution.id,
      label: staticExport.label,
    }
    wrapper.add(built)
    preparation.scene.add(wrapper)
  }
}

function buildBakeGeometryContext(
  node: AnyNode,
  nodes: Record<string, AnyNode>,
  base: Pick<GeometryContext, 'materials' | 'levelData'>,
): GeometryContext {
  const resolve = <N = AnyNode>(id: AnyNodeId): N | undefined => nodes[id] as N | undefined
  const childIds = Array.isArray((node as { children?: AnyNodeId[] }).children)
    ? (node as { children: AnyNodeId[] }).children
    : []
  const children = childIds
    .map((id) => nodes[id])
    .filter((child): child is AnyNode => child !== undefined)
  const parent = node.parentId ? (nodes[node.parentId] ?? null) : null
  const siblingIds =
    parent && Array.isArray((parent as { children?: AnyNodeId[] }).children)
      ? (parent as { children: AnyNodeId[] }).children
      : []
  const siblings = siblingIds
    .filter((id) => id !== node.id)
    .map((id) => nodes[id])
    .filter((sibling): sibling is AnyNode => sibling?.type === node.type)
  const levelId = findLevelAncestorId(node.id, nodes)
  const levelBaseAt = (x: number, z: number) =>
    levelId ? levelBaseElevationAt(nodes, levelId, x, z) : 0

  return {
    resolve,
    children,
    siblings,
    parent,
    levelBaseAt,
    levelData: base.levelData,
    materials: base.materials,
  }
}

function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

function pruneHiddenSceneNodes(
  cloneByOriginal: Map<THREE.Object3D, THREE.Object3D>,
  nodes: Record<string, AnyNode>,
  registryEntries: readonly RegistryEntry[],
) {
  const visibility = new Map<string, boolean>()

  const isVisible = (id: string, path: Set<string>): boolean => {
    const cached = visibility.get(id)
    if (cached !== undefined) return cached

    const node = nodes[id]
    if (!node) return true
    if (node.visible === false) {
      visibility.set(id, false)
      return false
    }
    if (!node.parentId || path.has(id)) {
      visibility.set(id, true)
      return true
    }

    path.add(id)
    const visible = isVisible(node.parentId, path)
    path.delete(id)
    visibility.set(id, visible)
    return visible
  }

  for (const [id, original] of registryEntries) {
    if (isVisible(id, new Set())) continue
    cloneByOriginal.get(original)?.removeFromParent()
  }
}

function retainedClones(
  root: THREE.Object3D,
  cloneByOriginal: Map<THREE.Object3D, THREE.Object3D>,
): Map<THREE.Object3D, THREE.Object3D> {
  const retained = new Set<THREE.Object3D>()
  root.traverse((object) => retained.add(object))
  return new Map(Array.from(cloneByOriginal.entries()).filter(([, clone]) => retained.has(clone)))
}

type ResourceCloneCache = {
  geometries: Map<THREE.BufferGeometry, THREE.BufferGeometry>
  materials: Map<THREE.Material, THREE.Material>
  textures: Map<THREE.Texture, THREE.Texture>
}

/** Skip excluded subtrees before cloning large procedural instance buffers. */
function cloneSceneForExport(
  source: THREE.Object3D,
  excludedObjects: Set<THREE.Object3D>,
  cloneByOriginal: Map<THREE.Object3D, THREE.Object3D>,
  cache: ResourceCloneCache = {
    geometries: new Map(),
    materials: new Map(),
    textures: new Map(),
  },
): THREE.Object3D {
  if (excludedObjects.has(source)) return new THREE.Group()

  const clone = source.clone(false)
  clone.userData = structuredClone(source.userData)
  const renderable = source as THREE.Mesh
  const renderableClone = clone as THREE.Mesh
  if (renderable.geometry) {
    let geometry = cache.geometries.get(renderable.geometry)
    if (!geometry) {
      geometry = renderable.geometry.clone()
      cache.geometries.set(renderable.geometry, geometry)
    }
    renderableClone.geometry = geometry
  }
  if (renderable.material) {
    const cloneMaterial = (material: THREE.Material): THREE.Material => {
      let result = cache.materials.get(material)
      if (result) return result
      result = material.clone()
      const textured = result as THREE.Material & Record<string, unknown>
      for (const slot of REFERENCE_MAP_SLOTS) {
        const texture = textured[slot]
        if (!(texture instanceof THREE.Texture)) continue
        let textureClone = cache.textures.get(texture)
        if (!textureClone) {
          textureClone = texture.clone()
          textureClone.userData = structuredClone(texture.userData)
          textureClone.needsUpdate = true
          cache.textures.set(texture, textureClone)
        }
        textured[slot] = textureClone
      }
      cache.materials.set(material, result)
      return result
    }
    if (Array.isArray(renderable.material)) {
      const materialSlots = renderable.material as Array<THREE.Material | null | undefined>
      renderableClone.material = materialSlots.map((material) =>
        material ? cloneMaterial(material) : material,
      ) as THREE.Material[]
    } else {
      renderableClone.material = cloneMaterial(renderable.material)
    }
  }

  cloneByOriginal.set(source, clone)
  for (const child of source.children) {
    if (!excludedObjects.has(child)) {
      clone.add(cloneSceneForExport(child, excludedObjects, cloneByOriginal, cache))
    }
  }
  return clone
}

function cloneSkinnedSkeletons(cloneByOriginal: Map<THREE.Object3D, THREE.Object3D>): void {
  for (const [original, cloned] of cloneByOriginal) {
    const source = original as THREE.SkinnedMesh
    const target = cloned as THREE.SkinnedMesh
    if (!source.isSkinnedMesh) continue
    const bones = source.skeleton.bones.map((bone) => {
      const clonedBone = cloneByOriginal.get(bone)
      if (!(clonedBone as THREE.Bone | undefined)?.isBone) {
        throw new Error(
          `Skinned mesh "${source.name}" references a bone outside its export subtree`,
        )
      }
      return clonedBone as THREE.Bone
    })
    target.bindMode = source.bindMode
    target.bind(
      new THREE.Skeleton(
        bones,
        source.skeleton.boneInverses.map((inverse) => inverse.clone()),
      ),
      source.bindMatrix.clone(),
    )
  }
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
 *  - Renderer-owned presentation geometry explicitly marked
 *    `userData.pascalExport = 'strip'` (for example the site's 800 m horizon
 *    disc). These meshes make the authoring viewport look grounded but aren't
 *    part of the portable scene artifact.
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
    if (object.userData.pascalExport === 'strip') {
      toRemove.push(object)
      return
    }
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
        renderable.geometry = EMPTY_GEOMETRY.clone()
        renderable.material = PLACEHOLDER_MATERIAL.clone()
      } else {
        toRemove.push(object)
      }
      return
    }
    // The scalar branch above only catches `material == null`; an ARRAY material
    // (multi-material / group geometry) is never `== null`, so a slot that was
    // never assigned — e.g. `[validMat, undefined]` — slips through and reaches
    // GLTFExporter, which reads `material.isShaderMaterial` on every group's
    // material and crashes on the undefined slot. Don't drop the mesh (the other
    // slots may be real geometry): fill any null/undefined holes with the hidden
    // placeholder so the exporter never sees an undefined material.
    if (
      (renderable.isMesh === true || renderable.isLine === true || renderable.isPoints === true) &&
      Array.isArray(renderable.material) &&
      renderable.material.some((m) => m == null)
    ) {
      renderable.material = renderable.material.map((m) => m ?? PLACEHOLDER_MATERIAL.clone())
    }
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || isRenderableMesh(mesh)) return
    if (mesh.children.length > 0) {
      mesh.geometry = EMPTY_GEOMETRY.clone()
    } else {
      toRemove.push(mesh)
    }
  })
  for (const object of toRemove) {
    object.removeFromParent()
  }
}

/**
 * Repair meshes whose geometry groups don't line up with their material array —
 * GLTFExporter reads `materials[group.materialIndex]` per group and crashes on
 * undefined (`reading 'isShaderMaterial'`). The known producer is a roof
 * placeholder (BoxGeometry's 6 groups vs the 4 roof materials), but any
 * system/CSG output can end up here, so repair generically:
 *  - groups indexing past the array (or drawing zero triangles) are dropped;
 *  - null slots referenced by surviving groups get the hidden placeholder;
 *  - a mesh left with no drawable group — including an array-material mesh
 *    with no groups at all (three draws nothing for those, e.g. the roof
 *    system's degenerate placeholder) — is neutralised like other
 *    non-renderables (kept as a bare transform node, or removed if a leaf
 *    that carries no node identity).
 * The export tree owns its resources; repairs still avoid copying vertex
 * buffers when replacing only group metadata.
 */
function sanitizeMaterialGroups(root: THREE.Object3D, identityNodes: Set<THREE.Object3D>) {
  const toRemove: THREE.Object3D[] = []
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !Array.isArray(mesh.material)) return
    const materials = mesh.material
    const groups = mesh.geometry.groups
    const broken =
      groups.length === 0 ||
      groups.some((g) => (g.materialIndex ?? 0) >= materials.length || g.count === 0) ||
      materials.some((m) => m == null)
    if (!broken) return

    const validGroups = groups.filter(
      (g) => (g.materialIndex ?? 0) < materials.length && g.count !== 0,
    )
    if (validGroups.length === 0) {
      if (mesh.children.length > 0 || identityNodes.has(mesh)) {
        mesh.geometry = EMPTY_GEOMETRY.clone()
        mesh.material = PLACEHOLDER_MATERIAL.clone()
      } else {
        toRemove.push(mesh)
      }
      return
    }
    // Only the group list needs repair; reuse export-owned attributes rather
    // than duplicating every vertex buffer.
    if (validGroups.length !== groups.length) {
      const geometry = new THREE.BufferGeometry()
      geometry.index = mesh.geometry.index
      for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
        geometry.setAttribute(name, attribute)
      }
      geometry.morphAttributes = mesh.geometry.morphAttributes
      geometry.morphTargetsRelative = mesh.geometry.morphTargetsRelative
      geometry.setDrawRange(mesh.geometry.drawRange.start, mesh.geometry.drawRange.count)
      geometry.groups = validGroups.map((g) => ({ ...g }))
      mesh.geometry = geometry
    }
    mesh.material = materials.map((m) => m ?? PLACEHOLDER_MATERIAL.clone())
  })
  for (const object of toRemove) {
    object.removeFromParent()
  }
}

function isRenderableMesh(mesh: THREE.Mesh): boolean {
  const position = mesh.geometry?.getAttribute('position')
  if (!position || position.count === 0) return false
  const material = mesh.material
  // `colorWrite: false` is how raycast-only colliders (e.g. instanced plants'
  // proxy boxes) hide on the GPU — glTF has no equivalent, so exporting one
  // yields an opaque white box. Treat it as non-renderable.
  const renders = (m: THREE.Material | null | undefined) =>
    m?.visible !== false && m?.colorWrite !== false
  return Array.isArray(material) ? material.some(renders) : renders(material)
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

const REFERENCE_MAP_SLOTS = [
  ...STANDARD_MAP_SLOTS,
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'transmissionMap',
  'thicknessMap',
  'specularIntensityMap',
  'specularColorMap',
  'sheenRoughnessMap',
  'sheenColorMap',
  'anisotropyMap',
] as const

function convertMaterials(
  root: THREE.Object3D,
  textureMode: 'embed' | 'reference',
  purpose: 'portable' | 'viewer',
) {
  const cache = new Map<THREE.Material, THREE.Material>()
  const placeholderCache = new Map<THREE.Texture, THREE.Texture>()
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const material = mesh.material
    const materialArray = Array.isArray(material) ? material : [material]
    if (
      purpose === 'viewer' &&
      materialArray.length === 1 &&
      (materialArray[0] as { isNodeMaterial?: boolean }).isNodeMaterial &&
      materialArray[0]!.side === THREE.BackSide
    ) {
      mesh.geometry = flipGeometryWinding(mesh.geometry)
    }
    const converted = materialArray.map((entry) =>
      convertMaterial(entry, cache, textureMode, placeholderCache, purpose),
    )
    const color = mesh.geometry.getAttribute('color')
    let hasVertexAlpha = false
    if (color?.itemSize === 4) {
      for (let index = 0; index < color.count; index++) {
        if (color.getW(index) < 1) {
          hasVertexAlpha = true
          break
        }
      }
    }
    for (const entry of converted) {
      const textured = entry as THREE.Material & { alphaMap?: THREE.Texture | null }
      if (hasVertexAlpha || textured.alphaMap) entry.transparent = true
    }
    mesh.material = Array.isArray(material) ? converted : converted[0]!
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
  textureMode: 'embed' | 'reference',
  placeholderCache: Map<THREE.Texture, THREE.Texture>,
  purpose: 'portable' | 'viewer',
): THREE.Material {
  const isNodeMaterial = (material as { isNodeMaterial?: boolean }).isNodeMaterial === true
  if (!isNodeMaterial) {
    if (textureMode === 'embed') return material
    const cached = cache.get(material)
    if (cached) return cached
    const target = material.clone()
    replaceReferencedTextures(target, placeholderCache)
    cache.set(material, target)
    return target
  }

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
  target.side =
    purpose === 'viewer' && material.side === THREE.BackSide ? THREE.FrontSide : material.side
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

  if (textureMode === 'reference') replaceReferencedTextures(target, placeholderCache)

  cache.set(material, target)
  return target
}

function replaceReferencedTextures(
  material: THREE.Material,
  placeholderCache: Map<THREE.Texture, THREE.Texture>,
) {
  const textureMaterial = material as THREE.Material & Record<string, unknown>
  for (const slot of REFERENCE_MAP_SLOTS) {
    const texture = textureMaterial[slot]
    if (!(texture instanceof THREE.Texture) || !getPascalTextureRef(texture)) continue

    let placeholder = placeholderCache.get(texture)
    if (!placeholder) {
      placeholder = createReferencePlaceholder(texture)
      placeholderCache.set(texture, placeholder)
    }
    textureMaterial[slot] = placeholder
  }
}

/** GLTFExporter serializes images via canvas drawImage/createImageBitmap,
 *  which reject a DataTexture's raw `{data,width,height}` image — so in DOM
 *  environments the placeholder must be canvas-backed. The DataTexture branch
 *  covers non-DOM runs (bun tests), where the exporter itself never runs. */
function createPlaceholderCanvas(): OffscreenCanvas | HTMLCanvasElement | null {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(1, 1)
      : typeof document !== 'undefined'
        ? Object.assign(document.createElement('canvas'), { width: 1, height: 1 })
        : null
  if (!canvas) return null
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null
  if (!ctx) return null
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 1, 1)
  return canvas
}

function createReferencePlaceholder(texture: THREE.Texture): THREE.Texture {
  const ref = getPascalTextureRef(texture)
  if (!ref) throw new Error('Cannot create a placeholder for an invalid Pascal texture reference')

  const canvas = createPlaceholderCanvas()
  const placeholder = canvas
    ? new THREE.Texture(canvas)
    : new THREE.DataTexture(
        new Uint8Array([255, 255, 255, 255]),
        1,
        1,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      )
  placeholder.name = texture.name
  placeholder.mapping = texture.mapping
  placeholder.channel = texture.channel
  placeholder.wrapS = texture.wrapS
  placeholder.wrapT = texture.wrapT
  placeholder.magFilter = texture.magFilter
  placeholder.minFilter = texture.minFilter
  placeholder.anisotropy = texture.anisotropy
  placeholder.offset.copy(texture.offset)
  placeholder.repeat.copy(texture.repeat)
  placeholder.center.copy(texture.center)
  placeholder.rotation = texture.rotation
  placeholder.matrixAutoUpdate = texture.matrixAutoUpdate
  placeholder.matrix.copy(texture.matrix)
  placeholder.generateMipmaps = texture.generateMipmaps
  placeholder.premultiplyAlpha = texture.premultiplyAlpha
  placeholder.flipY = texture.flipY
  placeholder.unpackAlignment = texture.unpackAlignment
  placeholder.colorSpace = texture.colorSpace
  placeholder.userData = { pascalTextureRef: ref }
  placeholder.needsUpdate = true
  return placeholder
}

// --- Animation clip baking ----------------------------------------------

function bakeAnimationClips(
  cloneByOriginal: Map<THREE.Object3D, THREE.Object3D>,
  nodes: Record<string, AnyNode>,
  registryEntries: readonly RegistryEntry[],
): { clips: THREE.AnimationClip[]; clipNamesByNode: Map<string, string[]> } {
  const clips: THREE.AnimationClip[] = []
  const clipNamesByNode = new Map<string, string[]>()

  for (const [id, original] of registryEntries) {
    const node = nodes[id]
    const target = cloneByOriginal.get(original)
    if (!node || !target) continue

    const clip =
      bakeRegistryAnimationClips(node, target) ??
      (node.type === 'door'
        ? bakeDoorClip(id, node, target)
        : node.type === 'window'
          ? bakeWindowClip(id, node as WindowNode, target)
          : node.type === 'item'
            ? bakeItemClip(id, target)
            : null)

    if (clip) {
      const nodeClips = Array.isArray(clip) ? clip : [clip]
      clips.push(...nodeClips)
      clipNamesByNode.set(
        id,
        nodeClips.map((c) => c.name),
      )
    }
  }

  return { clips, clipNamesByNode }
}

function bakeRegistryAnimationClips(
  node: AnyNode,
  object: THREE.Object3D,
): THREE.AnimationClip | THREE.AnimationClip[] | null | undefined {
  return nodeRegistry.get(node.type)?.exportAnimation?.({ node, object })
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
    case 'cabinet':
    case 'cabinet-module':
      return 'Cabinet'
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
  registryEntries: readonly RegistryEntry[],
) {
  scene.traverse((object) => {
    const presentationId = object.userData.pascalPresentationId
    const label = object.userData.label
    object.userData =
      typeof presentationId === 'string' ? { pascalPresentationId: presentationId, label } : {}
  })

  for (const [id, original] of registryEntries) {
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
    // Only nodes that actually baked an open clip are openable. A cased opening
    // (no leaf), fixed window, or static cabinet produces no clip, so it stays
    // unflagged — the file never claims a part opens when nothing moves.
    if (clipNamesByNode.get(id)?.some((name) => name.endsWith(': open'))) {
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

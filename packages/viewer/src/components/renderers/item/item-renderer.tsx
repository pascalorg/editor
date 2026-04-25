import {
  type AnimationEffect,
  type AnyNodeId,
  baseMaterial,
  getScaledDimensions,
  glassMaterial,
  type Interactive,
  type ItemMoveVisualState,
  type ItemNode,
  type LightEffect,
  useInteractive,
  useLiveTransforms,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useAnimations } from '@react-three/drei'
import { Clone } from '@react-three/drei/core/Clone'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { useFrame, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  type AnimationAction,
  type Camera,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  type Material,
  MathUtils,
  Mesh,
  Scene,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { positionLocal, smoothstep, time } from 'three/tsl'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { useViewerRuntimeState } from '../../../contexts/viewer-runtime-state'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { resolveCdnUrl } from '../../../lib/asset-url'
import { ITEM_DELETE_FADE_OUT_MS } from '../../../lib/item-delete-visual'
import { useItemLightPool } from '../../../store/use-item-light-pool'
import { ErrorBoundary } from '../../error-boundary'
import { NodeRenderer } from '../node-renderer'

const processedItemScenes = new WeakMap<Group, string>()
const optimizedStaticScenes = new WeakSet<Group>()
const itemCarryOverlayTemplateCache = new WeakMap<Group, Map<string, Group>>()
const itemCarryOverlayTemplateCompiledCache = new WeakMap<Group, Set<string>>()
const itemCarryOverlayTemplateCompileInFlight = new WeakMap<Group, Set<string>>()

type TexturedMaterial = Material & {
  alphaTest?: number
  alphaMap?: unknown
  aoMap?: unknown
  aoMapIntensity?: number
  color?: Color
  depthTest?: boolean
  depthWrite?: boolean
  emissive?: Color
  emissiveMap?: unknown
  emissiveIntensity?: number
  map?: unknown
  metalness?: number
  metalnessMap?: unknown
  normalMap?: unknown
  opacity?: number
  roughness?: number
  roughnessMap?: unknown
  side?: number
  transparent?: boolean
}

type FadeMaterial = Material & {
  depthWrite?: boolean
  needsUpdate?: boolean
  opacity?: number
  transparent?: boolean
  userData: Record<string, unknown> & {
    pascalDeleteBaseOpacity?: number
  }
}

const hasTextureMaps = (material: Material): boolean => {
  const candidate = material as TexturedMaterial
  return Boolean(
    candidate.map ||
      candidate.normalMap ||
      candidate.emissiveMap ||
      candidate.metalnessMap ||
      candidate.roughnessMap ||
      candidate.alphaMap ||
      candidate.aoMap,
  )
}

function shouldPreserveImportedMaterials(node: ItemNode) {
  return (
    node.asset.id === 'pascal-truck' ||
    node.asset.src === '/items/pascal-truck/model.glb' ||
    node.asset.src.endsWith('/items/pascal-truck/model.glb')
  )
}

function shouldOptimizeStaticScene(node: ItemNode) {
  return node.asset.category !== 'door' && node.asset.category !== 'window' && !node.asset.attachTo
}

function optimizeStaticSceneMeshes(root: Group) {
  if (optimizedStaticScenes.has(root)) {
    return
  }

  root.updateWorldMatrix(true, true)
  const rootInverseWorldMatrix = root.matrixWorld.clone().invert()
  const mergedEntries = new Map<
    string,
    {
      castShadow: boolean
      geometries: ReturnType<Mesh['geometry']['clone']>[]
      material: Material
      receiveShadow: boolean
    }
  >()
  const removableMeshes: Mesh[] = []
  let hasUnsupportedMeshState = false

  root.traverse((child) => {
    if (!(child as Mesh).isMesh) {
      return
    }

    const mesh = child as Mesh
    if (
      mesh.name === 'cutout' ||
      Array.isArray(mesh.material) ||
      (mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh ||
      mesh.morphTargetInfluences?.length
    ) {
      hasUnsupportedMeshState = true
      return
    }

    const candidateMaterial = mesh.material as TexturedMaterial
    if (
      candidateMaterial.transparent ||
      (candidateMaterial.opacity ?? 1) < 1 ||
      candidateMaterial.alphaMap ||
      candidateMaterial.map
    ) {
      return
    }

    const material = mesh.material
    const key = `${material.uuid}:${mesh.castShadow ? '1' : '0'}:${mesh.receiveShadow ? '1' : '0'}`
    const entry = mergedEntries.get(key) ?? {
      castShadow: mesh.castShadow,
      geometries: [],
      material,
      receiveShadow: mesh.receiveShadow,
    }

    const geometry = mesh.geometry.clone()
    const matrixInRootSpace = rootInverseWorldMatrix.clone().multiply(mesh.matrixWorld)
    geometry.applyMatrix4(matrixInRootSpace)
    entry.geometries.push(geometry)
    mergedEntries.set(key, entry)
    removableMeshes.push(mesh)
  })

  if (hasUnsupportedMeshState || mergedEntries.size === 0 || removableMeshes.length <= 1) {
    optimizedStaticScenes.add(root)
    return
  }

  for (const mesh of removableMeshes) {
    mesh.removeFromParent()
    mesh.geometry.dispose()
  }

  for (const entry of mergedEntries.values()) {
    const mergedGeometry =
      entry.geometries.length === 1
        ? entry.geometries[0]
        : (mergeGeometries(entry.geometries, false) ?? entry.geometries[0])
    const mergedMesh = new Mesh(mergedGeometry, entry.material)
    mergedMesh.castShadow = entry.castShadow
    mergedMesh.receiveShadow = entry.receiveShadow
    root.add(mergedMesh)
  }

  optimizedStaticScenes.add(root)
}

const getMaterialForOriginal = (
  original: Material,
  preserveImportedTexturedMaterials: boolean,
): Material => {
  if (original.name.toLowerCase() === 'glass') {
    return glassMaterial
  }

  if (preserveImportedTexturedMaterials && hasTextureMaps(original)) {
    // Preserve imported GLTF materials with maps. WebGPU can consume
    // standard materials directly, and replacing them discards the Pascal truck look.
    original.needsUpdate = true
    return original
  }

  return baseMaterial
}

const BrokenItemFallback = ({ node }: { node: ItemNode }) => {
  const handlers = useNodeEvents(node, 'item')
  const [w, h, d] = node.asset.dimensions
  return (
    <mesh position-y={h / 2} {...handlers}>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color="#ef4444" opacity={0.6} transparent wireframe />
    </mesh>
  )
}

export const ItemRenderer = ({ node }: { node: ItemNode }) => {
  const ref = useRef<Group>(null!)
  const isWallDoorItem = node.asset.category === 'door' && node.asset.attachTo === 'wall'
  const [width] = getScaledDimensions(node)
  const hingeHintOffset = width / 2
  const itemMovePreview = useViewerRuntimeState((state) =>
    state.itemMovePreview?.sourceItemId === node.id ? state.itemMovePreview : null,
  )
  const itemMovePreviewIsSceneBacked = useScene((state) => {
    const previewId = itemMovePreview?.id
    if (!previewId) {
      return false
    }

    return state.nodes[previewId as AnyNodeId]?.type === 'item'
  })
  const liveTransform = useLiveTransforms((state) => state.transforms.get(node.id))
  const visualStateOverride = useViewerRuntimeState(
    (state) => state.itemMoveVisualStates[node.id] ?? null,
  )
  const visibilityOverride = useViewerRuntimeState(
    (state) => state.nodeVisibilityOverrides[node.id],
  )
  const itemDeleteActivation = useViewerRuntimeState(
    (state) => state.itemDeleteActivations[node.id] ?? null,
  )
  const deleteFadeStartedAtMs = itemDeleteActivation?.fadeStartedAtMs ?? null
  const baseVisible = visibilityOverride ?? node.visible
  const rotation = liveTransform
    ? ([node.rotation[0] ?? 0, liveTransform.rotation, node.rotation[2] ?? 0] as [
        number,
        number,
        number,
      ])
    : node.rotation

  useRegistry(node.id, node.type, ref)

  useEffect(() => {
    if (ref.current) {
      ref.current.visible = baseVisible
    }
  }, [baseVisible])

  useFrame(() => {
    const group = ref.current
    if (!group) {
      return
    }

    if (deleteFadeStartedAtMs === null) {
      group.visible = baseVisible
      return
    }

    const fadeProgress = MathUtils.clamp(
      ((typeof performance !== 'undefined' ? performance.now() : Date.now()) -
        deleteFadeStartedAtMs) /
        ITEM_DELETE_FADE_OUT_MS,
      0,
      1,
    )
    const fadeAlpha = 1 - MathUtils.smootherstep(fadeProgress, 0, 1)
    group.visible = baseVisible && fadeAlpha > ITEM_DELETE_VISIBILITY_EPSILON
  })

  return (
    <>
      <group
        position={liveTransform?.position ?? node.position}
        ref={ref}
        rotation={rotation}
        visible={baseVisible}
      >
        {isWallDoorItem ? (
          <group name="door-leaf-pivot">
            <group name="door-leaf-group">
              <ErrorBoundary fallback={<BrokenItemFallback node={node} />}>
                <Suspense fallback={<PreviewModel node={node} />}>
                  <ModelRenderer node={node} visualStateOverride={visualStateOverride} />
                </Suspense>
              </ErrorBoundary>
            </group>
            <group
              name="door-leaf-hinge-hint"
              position={[node.side === 'back' ? hingeHintOffset : -hingeHintOffset, 0, 0]}
              visible={false}
            />
          </group>
        ) : (
          <ErrorBoundary fallback={<BrokenItemFallback node={node} />}>
            <Suspense fallback={<PreviewModel node={node} />}>
              <ModelRenderer node={node} visualStateOverride={visualStateOverride} />
            </Suspense>
          </ErrorBoundary>
        )}
        {node.children?.map((childId) => (
          <NodeRenderer key={childId} nodeId={childId} />
        ))}
      </group>
      {itemMovePreview && !itemMovePreviewIsSceneBacked && (
        <ItemMovePreviewGhost previewId={itemMovePreview.id} sourceNode={node} />
      )}
    </>
  )
}

const ItemMovePreviewGhost = ({
  previewId,
  sourceNode,
}: {
  previewId: ItemNode['id']
  sourceNode: ItemNode
}) => {
  const ref = useRef<Group>(null!)
  const liveTransform = useLiveTransforms((state) => state.transforms.get(previewId))
  const visualStateOverride = useViewerRuntimeState(
    (state) => state.itemMoveVisualStates[previewId] ?? null,
  )
  const visibilityOverride = useViewerRuntimeState(
    (state) => state.nodeVisibilityOverrides[previewId],
  )
  const previewNode = useMemo(
    () =>
      ({
        ...sourceNode,
        children: [],
        id: previewId,
        visible: true,
      }) as ItemNode,
    [previewId, sourceNode],
  )
  const rotation = liveTransform
    ? ([sourceNode.rotation[0] ?? 0, liveTransform.rotation, sourceNode.rotation[2] ?? 0] as [
        number,
        number,
        number,
      ])
    : sourceNode.rotation

  useRegistry(previewId, 'item', ref)

  return (
    <group
      position={liveTransform?.position ?? sourceNode.position}
      ref={ref}
      rotation={rotation}
      visible={visibilityOverride ?? true}
    >
      <ErrorBoundary fallback={<BrokenItemFallback node={previewNode} />}>
        <Suspense fallback={<PreviewModel node={previewNode} />}>
          <PreviewGhostModelRenderer node={previewNode} visualStateOverride={visualStateOverride} />
        </Suspense>
      </ErrorBoundary>
    </group>
  )
}

const previewMaterial = new MeshStandardNodeMaterial({
  color: '#cccccc',
  roughness: 1,
  metalness: 0,
  depthTest: false,
})

const previewOpacity = smoothstep(0.42, 0.55, positionLocal.y.add(time.mul(-0.2)).mul(10).fract())

previewMaterial.opacityNode = previewOpacity
previewMaterial.transparent = true

type ItemMoveVisualKind =
  | 'copy-source-pending'
  | 'destination-ghost'
  | 'destination-preview'
  | 'source-pending'
type MaterializedItemMoveVisualKind = Exclude<
  ItemMoveVisualKind,
  'copy-source-pending' | 'source-pending'
>

type ItemMoveVisualMaterial = Material & {
  color?: Color
  depthWrite?: boolean
  emissive?: Color
  emissiveIntensity?: number
  needsUpdate?: boolean
  opacity?: number
  opacityNode?: unknown
  transparent?: boolean
}

type ItemMoveVisualMaterialEntry = {
  kind: ItemMoveVisualKind
  originalCastShadow: boolean
  originalMaterial: Material | Material[]
  originalReceiveShadow: boolean
  visualMaterial: Material | Material[]
}

type ItemDeleteFadeMaterialEntry = {
  fadeMaterial: Material | Material[]
  originalMaterial: Material | Material[]
}

const destinationGhostOpacity = smoothstep(
  0.02,
  0.34,
  positionLocal.x.mul(6.4).add(positionLocal.z.mul(9.2)).add(positionLocal.y.mul(3.2)).fract(),
)
  .mul(0.34)
  .add(0.24)

const destinationPreviewOpacity = smoothstep(
  0.02,
  0.42,
  positionLocal.x
    .mul(6.1)
    .add(positionLocal.z.mul(8.8))
    .add(positionLocal.y.mul(3))
    .add(time.mul(-0.18))
    .fract(),
)
  .mul(0.4)
  .add(0.3)

const previewGhostDestinationGhostMaterial = new MeshBasicNodeMaterial({
  color: '#ffffff',
  depthTest: false,
  depthWrite: false,
  opacity: 0.52,
  transparent: true,
})
previewGhostDestinationGhostMaterial.opacityNode = destinationGhostOpacity
previewGhostDestinationGhostMaterial.toneMapped = false

const previewGhostDestinationPreviewMaterial = new MeshBasicNodeMaterial({
  color: '#ffffff',
  depthTest: false,
  depthWrite: false,
  opacity: 0.68,
  transparent: true,
})
previewGhostDestinationPreviewMaterial.opacityNode = destinationPreviewOpacity
previewGhostDestinationPreviewMaterial.toneMapped = false

function applyPreviewGhostMaterial(root: Group | null, material: Material) {
  if (!root) {
    return
  }

  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) {
      return
    }

    if (mesh.name === 'cutout') {
      mesh.visible = false
      return
    }

    mesh.castShadow = false
    mesh.material = material
    mesh.receiveShadow = false
  })
}

function disposeVisualMaterials(material: Material | Material[]) {
  if (Array.isArray(material)) {
    material.forEach((entry) => {
      entry.dispose()
    })
    return
  }

  material.dispose()
}

function createItemMoveVisualMaterial(
  material: Material,
  kind: MaterializedItemMoveVisualKind,
): ItemMoveVisualMaterial {
  const visualMaterial = material.clone() as ItemMoveVisualMaterial

  if (kind === 'destination-preview') {
    if (visualMaterial.color instanceof Color) {
      visualMaterial.color = new Color('#ffffff')
    }

    if (visualMaterial.emissive instanceof Color) {
      visualMaterial.emissive = new Color('#ffffff')
      visualMaterial.emissiveIntensity = 0.55
    }

    visualMaterial.depthTest = false
    visualMaterial.depthWrite = false
    visualMaterial.opacity = 0.68
    visualMaterial.opacityNode = destinationPreviewOpacity
    visualMaterial.transparent = true
    visualMaterial.needsUpdate = true
    return visualMaterial
  }

  if (visualMaterial.color instanceof Color) {
    visualMaterial.color = new Color('#ffffff')
  }

  if (visualMaterial.emissive instanceof Color) {
    visualMaterial.emissive = new Color('#ffffff')
    visualMaterial.emissiveIntensity = 0.4
  }

  visualMaterial.depthTest = false
  visualMaterial.depthWrite = false
  visualMaterial.opacity = 0.52
  visualMaterial.opacityNode = destinationGhostOpacity
  visualMaterial.transparent = true
  visualMaterial.needsUpdate = true
  return visualMaterial
}

function createItemMoveVisualMaterials(
  material: Material | Material[],
  kind: MaterializedItemMoveVisualKind,
): Material | Material[] {
  if (Array.isArray(material)) {
    return material.map((entry) => createItemMoveVisualMaterial(entry, kind))
  }

  return createItemMoveVisualMaterial(material, kind)
}

function isRenderableMesh(object: unknown): object is Mesh {
  return Boolean((object as Mesh | undefined)?.isMesh && (object as Mesh | undefined)?.material)
}

const PreviewGhostModelRenderer = ({
  node,
  visualStateOverride,
}: {
  node: ItemNode
  visualStateOverride: ItemMoveVisualState | null
}) => {
  const assetSrc = resolveCdnUrl(node.asset.src) || ''
  const { scene, animations } = useGLTF(assetSrc)
  const ref = useRef<Group>(null!)
  const renderScale = useMemo(
    () => multiplyScales(node.asset.scale || [1, 1, 1], node.scale || [1, 1, 1]),
    [node.asset.scale, node.scale],
  )
  const ghostMaterial =
    visualStateOverride === 'destination-preview'
      ? previewGhostDestinationPreviewMaterial
      : previewGhostDestinationGhostMaterial

  useRegistry(node.id, 'item', ref)

  useMemo(() => {
    if (!shouldOptimizeStaticScene(node) || animations.length > 0) {
      return
    }

    optimizeStaticSceneMeshes(scene)
  }, [animations.length, node, scene])

  useEffect(() => {
    applyPreviewGhostMaterial(ref.current, ghostMaterial)
  }, [ghostMaterial])

  return (
    <Clone
      object={scene}
      position={node.asset.offset}
      ref={ref}
      rotation={node.asset.rotation}
      scale={renderScale}
    />
  )
}

const PreviewModel = ({ node }: { node: ItemNode }) => {
  return (
    <mesh material={previewMaterial} position-y={node.asset.dimensions[1] / 2}>
      <boxGeometry
        args={[node.asset.dimensions[0], node.asset.dimensions[1], node.asset.dimensions[2]]}
      />
    </mesh>
  )
}

const multiplyScales = (
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] => [a[0] * b[0], a[1] * b[1], a[2] * b[2]]

const ITEM_CARRY_OVERLAY_COLOR = '#52e8ff'
const ITEM_CARRY_OVERLAY_FILL_TRANSPARENCY_PERCENT = 95
const ITEM_CARRY_OVERLAY_OUTLINE_THICKNESS = 0.002
const ITEM_DELETE_VISIBILITY_EPSILON = 0.001

function createDeleteFadeMaterial(material: Material): Material {
  const nextMaterial = material.clone() as FadeMaterial
  nextMaterial.userData = {
    ...nextMaterial.userData,
    pascalDeleteBaseOpacity: nextMaterial.opacity ?? 1,
  }
  nextMaterial.transparent = true
  nextMaterial.depthWrite = false
  nextMaterial.needsUpdate = true
  return nextMaterial
}

function createDeleteFadeMaterials(material: Material | Material[]): Material | Material[] {
  if (Array.isArray(material)) {
    return material.map((entry) => createDeleteFadeMaterial(entry))
  }

  return createDeleteFadeMaterial(material)
}

function applyDeleteFadeOpacity(material: Material | Material[], fadeAlpha: number) {
  const applyOpacity = (entry: Material) => {
    const fadeMaterial = entry as FadeMaterial
    const baseOpacity = fadeMaterial.userData.pascalDeleteBaseOpacity ?? fadeMaterial.opacity ?? 1
    fadeMaterial.opacity = baseOpacity * fadeAlpha
    fadeMaterial.transparent = fadeAlpha < 0.999 || baseOpacity < 0.999
    fadeMaterial.depthWrite = fadeAlpha >= 0.999
    fadeMaterial.needsUpdate = true
  }

  if (Array.isArray(material)) {
    material.forEach(applyOpacity)
    return
  }

  applyOpacity(material)
}

function disposeDeleteFadeMaterials(material: Material | Material[]) {
  if (Array.isArray(material)) {
    material.forEach((entry) => {
      entry.dispose()
    })
    return
  }

  material.dispose()
}

function getItemCarryOverlayTemplateKey(
  assetOffset: [number, number, number],
  assetRotation: [number, number, number],
  renderScale: [number, number, number],
) {
  return `${assetOffset.join(',')}|${assetRotation.join(',')}|${renderScale.join(',')}`
}

function getOrCreateItemCarryOverlayTemplate({
  assetOffset,
  assetRotation,
  modelScene,
  renderScale,
}: {
  assetOffset: [number, number, number]
  assetRotation: [number, number, number]
  modelScene: Group
  renderScale: [number, number, number]
}) {
  const templateKey = getItemCarryOverlayTemplateKey(assetOffset, assetRotation, renderScale)
  let sceneTemplates = itemCarryOverlayTemplateCache.get(modelScene)
  if (!sceneTemplates) {
    sceneTemplates = new Map<string, Group>()
    itemCarryOverlayTemplateCache.set(modelScene, sceneTemplates)
  }

  const existingTemplate = sceneTemplates.get(templateKey)
  if (existingTemplate) {
    return existingTemplate
  }

  const template = createItemCarryOverlayTemplate({
    assetOffset,
    assetRotation,
    modelScene,
    renderScale,
  })
  sceneTemplates.set(templateKey, template)
  return template
}

function createItemCarryOverlayTemplate({
  assetOffset,
  assetRotation,
  modelScene,
  renderScale,
}: {
  assetOffset: [number, number, number]
  assetRotation: [number, number, number]
  modelScene: Group
  renderScale: [number, number, number]
}) {
  const root = new Group()
  const fillOpacity = 1 - ITEM_CARRY_OVERLAY_FILL_TRANSPARENCY_PERCENT / 100
  const tintMaterials: MeshBasicNodeMaterial[] = []
  const edgeTubeGeometry = new CylinderGeometry(1, 1, 1, 6, 1, true)
  const edgeTubeMaterial = new MeshBasicNodeMaterial({
    color: ITEM_CARRY_OVERLAY_COLOR,
    depthWrite: false,
    opacity: 0.96,
    transparent: true,
  })
  edgeTubeMaterial.depthTest = true
  edgeTubeMaterial.toneMapped = false

  root.userData.pascalExcludeFromToolConeTarget = true
  root.userData.pascalExcludeFromOutline = true

  const tintClone = modelScene.clone(true) as Group
  tintClone.userData.pascalExcludeFromToolConeTarget = true
  tintClone.userData.pascalExcludeFromOutline = true
  tintClone.position.set(assetOffset[0], assetOffset[1], assetOffset[2])
  tintClone.rotation.set(assetRotation[0], assetRotation[1], assetRotation[2])
  tintClone.scale.set(renderScale[0], renderScale[1], renderScale[2])
  tintClone.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) {
      return
    }

    mesh.userData.pascalExcludeFromToolConeTarget = true
    mesh.userData.pascalExcludeFromOutline = true
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 20
    const material = new MeshBasicNodeMaterial({
      color: ITEM_CARRY_OVERLAY_COLOR,
      depthWrite: false,
      opacity: fillOpacity,
      side: DoubleSide,
      transparent: true,
    })
    material.depthTest = true
    material.toneMapped = false
    mesh.material = material
    tintMaterials.push(material)
  })
  root.add(tintClone)

  const edgeRoot = new Group()
  edgeRoot.userData.pascalExcludeFromToolConeTarget = true
  edgeRoot.userData.pascalExcludeFromOutline = true
  edgeRoot.position.copy(tintClone.position)
  edgeRoot.rotation.copy(tintClone.rotation)
  edgeRoot.scale.copy(tintClone.scale)
  const start = new Vector3()
  const end = new Vector3()
  const center = new Vector3()
  const direction = new Vector3()
  const axis = new Vector3(0, 1, 0)

  modelScene.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh || !mesh.geometry) {
      return
    }

    const edgeGeometry = new EdgesGeometry(mesh.geometry, 28)
    const edgePositions = edgeGeometry.getAttribute('position')
    const edgeMeshGroup = new Group()
    edgeMeshGroup.userData.pascalExcludeFromToolConeTarget = true
    edgeMeshGroup.userData.pascalExcludeFromOutline = true
    edgeMeshGroup.position.copy(mesh.position)
    edgeMeshGroup.quaternion.copy(mesh.quaternion)
    edgeMeshGroup.scale.copy(mesh.scale)

    for (let index = 0; index < edgePositions.count; index += 2) {
      start.fromBufferAttribute(edgePositions, index)
      end.fromBufferAttribute(edgePositions, index + 1)
      direction.subVectors(end, start)
      const length = direction.length()
      if (length <= 1e-5) {
        continue
      }

      const edgeTube = new Mesh(edgeTubeGeometry, edgeTubeMaterial)
      edgeTube.userData.pascalExcludeFromToolConeTarget = true
      edgeTube.userData.pascalExcludeFromOutline = true
      center.copy(start).add(end).multiplyScalar(0.5)
      edgeTube.position.copy(center)
      edgeTube.quaternion.setFromUnitVectors(axis, direction.normalize())
      edgeTube.scale.set(
        ITEM_CARRY_OVERLAY_OUTLINE_THICKNESS,
        length,
        ITEM_CARRY_OVERLAY_OUTLINE_THICKNESS,
      )
      edgeTube.castShadow = false
      edgeTube.receiveShadow = false
      edgeTube.renderOrder = 24
      edgeMeshGroup.add(edgeTube)
    }

    edgeGeometry.dispose()
    edgeRoot.add(edgeMeshGroup)
  })
  root.add(edgeRoot)

  root.userData.pascalCarryOverlayTemplateResources = {
    edgeTubeGeometry,
    edgeTubeMaterial,
    tintMaterials,
  }

  return root
}

const ItemCarryOverlay = ({
  assetOffset,
  assetRotation,
  modelScene,
  renderScale,
  visible,
}: {
  assetOffset: [number, number, number]
  assetRotation: [number, number, number]
  modelScene: Group
  renderScale: [number, number, number]
  visible: boolean
}) => {
  const overlayRoot = useMemo(
    () =>
      getOrCreateItemCarryOverlayTemplate({
        assetOffset,
        assetRotation,
        modelScene,
        renderScale,
      }).clone(true) as Group,
    [assetOffset, assetRotation, modelScene, renderScale],
  )

  return <primitive object={overlayRoot} visible={visible} />
}

const ModelRenderer = ({
  node,
  visualStateOverride,
}: {
  node: ItemNode
  visualStateOverride: ItemMoveVisualState | null
}) => {
  const assetSrc = resolveCdnUrl(node.asset.src) || ''
  const { scene, nodes, animations } = useGLTF(assetSrc)
  const { camera, gl } = useThree()
  const ref = useRef<Group>(null!)
  const preserveImportedTexturedMaterials = shouldPreserveImportedMaterials(node)
  const moveVisualState = visualStateOverride
  const { actions } = useAnimations(animations, ref)
  // Freeze the interactive definition at mount — asset schemas don't change at runtime
  const interactiveRef = useRef(node.asset.interactive)
  const handlers = useNodeEvents(node, 'item')
  const visualMaterialsRef = useRef(new Map<Mesh, ItemMoveVisualMaterialEntry>())
  const deleteFadeMaterialsRef = useRef(new Map<Mesh, ItemDeleteFadeMaterialEntry>())
  const itemDeleteActivation = useViewerRuntimeState(
    (state) => state.itemDeleteActivations[node.id] ?? null,
  )
  const carryOverlayVisible =
    moveVisualState === 'carried' ||
    moveVisualState === 'copy-source-pending' ||
    moveVisualState === 'destination-ghost' ||
    moveVisualState === 'destination-preview' ||
    moveVisualState === 'source-pending'
  const moveVisualMaterialKind: MaterializedItemMoveVisualKind | null =
    moveVisualState === 'destination-ghost' || moveVisualState === 'destination-preview'
      ? moveVisualState
      : null
  const deleteFadeStartedAtMs = itemDeleteActivation?.fadeStartedAtMs ?? null

  if (nodes.cutout) {
    nodes.cutout.visible = false
  }

  const renderScale = useMemo(
    () => multiplyScales(node.asset.scale || [1, 1, 1], node.scale || [1, 1, 1]),
    [node.asset.scale, node.scale],
  )

  useEffect(() => {
    if (!node.parentId) return
    useScene.getState().dirtyNodes.add(node.parentId as AnyNodeId)
  }, [node.parentId])

  useEffect(() => {
    const interactive = interactiveRef.current
    if (!interactive) return
    useInteractive.getState().initItem(node.id, interactive)
    return () => useInteractive.getState().removeItem(node.id)
  }, [node.id])

  useEffect(() => {
    const materialProcessingKey = `${assetSrc}|${preserveImportedTexturedMaterials ? 'preserve' : 'flatten'}`
    if (processedItemScenes.get(scene) === materialProcessingKey) {
      return
    }

    scene.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh
        if (mesh.name === 'cutout') {
          child.visible = false
          return
        }

        let hasGlass = false

        // Handle both single material and material array cases
        if (Array.isArray(mesh.material)) {
          const normalizedMaterials = mesh.material
            .map((mat) =>
              mat ? getMaterialForOriginal(mat, preserveImportedTexturedMaterials) : baseMaterial,
            )
            .filter((mat): mat is Material => Boolean(mat))
          mesh.material = normalizedMaterials.length > 0 ? normalizedMaterials : [baseMaterial]
          hasGlass = mesh.material.some((mat) => mat.name === 'glass')

          // Fix geometry groups that reference materialIndex beyond the material
          // array length — this causes three-mesh-bvh to crash with
          // "Cannot read properties of undefined (reading 'side')"
          const matCount = mesh.material.length
          if (mesh.geometry.groups.length > 0) {
            for (const group of mesh.geometry.groups) {
              if (group.materialIndex !== undefined && group.materialIndex >= matCount) {
                group.materialIndex = 0
              }
            }
          }
        } else {
          mesh.material = getMaterialForOriginal(mesh.material, preserveImportedTexturedMaterials)
          hasGlass = mesh.material.name === 'glass'
        }
        mesh.castShadow = !hasGlass
        mesh.receiveShadow = !hasGlass
      }
    })
    processedItemScenes.set(scene, materialProcessingKey)
  }, [assetSrc, preserveImportedTexturedMaterials, scene])

  useMemo(() => {
    const hasAnimatedEffects =
      interactiveRef.current?.effects?.some((effect) => effect.kind === 'animation') ?? false
    if (!shouldOptimizeStaticScene(node) || animations.length > 0 || hasAnimatedEffects) {
      return
    }

    optimizeStaticSceneMeshes(scene)
  }, [animations.length, node, scene])

  useEffect(() => {
    const templateKey = getItemCarryOverlayTemplateKey(
      node.asset.offset,
      node.asset.rotation,
      renderScale,
    )

    if (itemCarryOverlayTemplateCache.get(scene)?.has(templateKey)) {
      return
    }

    const warmOverlayTemplate = () => {
      getOrCreateItemCarryOverlayTemplate({
        assetOffset: node.asset.offset,
        assetRotation: node.asset.rotation,
        modelScene: scene,
        renderScale,
      })
    }

    const timeoutId = window.setTimeout(warmOverlayTemplate, 0)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [node.asset.offset, node.asset.rotation, renderScale, scene])

  useEffect(() => {
    const templateKey = getItemCarryOverlayTemplateKey(
      node.asset.offset,
      node.asset.rotation,
      renderScale,
    )
    const compileAsync = (
      gl as typeof gl & {
        compileAsync?: (scene: Scene, camera: Camera) => Promise<void>
      }
    ).compileAsync
    if (!compileAsync) {
      return
    }

    const compiledKeys =
      itemCarryOverlayTemplateCompiledCache.get(scene) ??
      (() => {
        const nextCompiledKeys = new Set<string>()
        itemCarryOverlayTemplateCompiledCache.set(scene, nextCompiledKeys)
        return nextCompiledKeys
      })()
    if (compiledKeys.has(templateKey)) {
      return
    }

    const inFlightKeys =
      itemCarryOverlayTemplateCompileInFlight.get(scene) ??
      (() => {
        const nextInFlightKeys = new Set<string>()
        itemCarryOverlayTemplateCompileInFlight.set(scene, nextInFlightKeys)
        return nextInFlightKeys
      })()
    if (inFlightKeys.has(templateKey)) {
      return
    }

    inFlightKeys.add(templateKey)
    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      const compileScene = new Scene()
      compileScene.add(
        getOrCreateItemCarryOverlayTemplate({
          assetOffset: node.asset.offset,
          assetRotation: node.asset.rotation,
          modelScene: scene,
          renderScale,
        }).clone(true),
      )
      compileAsync
        .call(gl, compileScene, camera)
        .then(() => {
          if (!cancelled) {
            compiledKeys.add(templateKey)
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlightKeys.delete(templateKey)
        })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      inFlightKeys.delete(templateKey)
    }
  }, [camera, gl, node.asset.offset, node.asset.rotation, renderScale, scene])

  const syncMoveVisualMaterials = useCallback(() => {
    const root = ref.current
    if (!root) {
      return
    }

    const activeMeshes = new Set<Mesh>()

    root.traverse((child) => {
      if (!isRenderableMesh(child)) {
        return
      }

      const mesh = child
      activeMeshes.add(mesh)
      const existingEntry = visualMaterialsRef.current.get(mesh)

      if (!moveVisualMaterialKind) {
        if (existingEntry) {
          if (mesh.material === existingEntry.visualMaterial) {
            mesh.material = existingEntry.originalMaterial
          }
          mesh.castShadow = existingEntry.originalCastShadow
          mesh.receiveShadow = existingEntry.originalReceiveShadow
          disposeVisualMaterials(existingEntry.visualMaterial)
          visualMaterialsRef.current.delete(mesh)
        }
        return
      }

      if (existingEntry && existingEntry.kind === moveVisualMaterialKind) {
        mesh.castShadow =
          moveVisualMaterialKind === 'destination-ghost' ? false : existingEntry.originalCastShadow
        mesh.receiveShadow =
          moveVisualMaterialKind === 'destination-ghost'
            ? false
            : existingEntry.originalReceiveShadow
        return
      }

      const originalMaterial =
        existingEntry && mesh.material === existingEntry.visualMaterial
          ? existingEntry.originalMaterial
          : mesh.material
      const originalCastShadow = existingEntry?.originalCastShadow ?? mesh.castShadow
      const originalReceiveShadow = existingEntry?.originalReceiveShadow ?? mesh.receiveShadow

      if (existingEntry) {
        if (mesh.material === existingEntry.visualMaterial) {
          mesh.material = existingEntry.originalMaterial
        }
        disposeVisualMaterials(existingEntry.visualMaterial)
      }

      const visualMaterial = createItemMoveVisualMaterials(originalMaterial, moveVisualMaterialKind)
      mesh.material = visualMaterial
      mesh.castShadow = moveVisualMaterialKind === 'destination-ghost' ? false : originalCastShadow
      mesh.receiveShadow =
        moveVisualMaterialKind === 'destination-ghost' ? false : originalReceiveShadow
      visualMaterialsRef.current.set(mesh, {
        kind: moveVisualMaterialKind,
        originalCastShadow,
        originalMaterial,
        originalReceiveShadow,
        visualMaterial,
      })
    })

    for (const [mesh, entry] of visualMaterialsRef.current.entries()) {
      if (activeMeshes.has(mesh)) {
        continue
      }

      if (mesh.material === entry.visualMaterial) {
        mesh.material = entry.originalMaterial
      }
      mesh.castShadow = entry.originalCastShadow
      mesh.receiveShadow = entry.originalReceiveShadow
      disposeVisualMaterials(entry.visualMaterial)
      visualMaterialsRef.current.delete(mesh)
    }
  }, [moveVisualMaterialKind])

  const syncDeleteFadeMaterials = useCallback(() => {
    const root = ref.current
    if (!root) {
      return
    }

    const activeMeshes = new Set<Mesh>()

    root.traverse((child) => {
      if (!isRenderableMesh(child)) {
        return
      }

      const mesh = child
      activeMeshes.add(mesh)
      const existingEntry = deleteFadeMaterialsRef.current.get(mesh)

      if (deleteFadeStartedAtMs === null) {
        if (existingEntry) {
          if (mesh.material === existingEntry.fadeMaterial) {
            mesh.material = existingEntry.originalMaterial
          }
          disposeDeleteFadeMaterials(existingEntry.fadeMaterial)
          deleteFadeMaterialsRef.current.delete(mesh)
        }
        return
      }

      if (existingEntry) {
        return
      }

      const originalMaterial = mesh.material
      const fadeMaterial = createDeleteFadeMaterials(originalMaterial)
      mesh.material = fadeMaterial
      deleteFadeMaterialsRef.current.set(mesh, {
        fadeMaterial,
        originalMaterial,
      })
    })

    for (const [mesh, entry] of deleteFadeMaterialsRef.current.entries()) {
      if (activeMeshes.has(mesh)) {
        continue
      }

      if (mesh.material === entry.fadeMaterial) {
        mesh.material = entry.originalMaterial
      }
      disposeDeleteFadeMaterials(entry.fadeMaterial)
      deleteFadeMaterialsRef.current.delete(mesh)
    }
  }, [deleteFadeStartedAtMs])

  const interactive = interactiveRef.current
  const animEffect =
    interactive?.effects.find((e): e is AnimationEffect => e.kind === 'animation') ?? null
  const lightEffects =
    interactive?.effects.filter((e): e is LightEffect => e.kind === 'light') ?? []

  useEffect(() => {
    syncMoveVisualMaterials()
  }, [syncMoveVisualMaterials])

  useEffect(() => {
    syncDeleteFadeMaterials()
  }, [syncDeleteFadeMaterials])

  useEffect(() => {
    return () => {
      for (const [mesh, entry] of visualMaterialsRef.current.entries()) {
        if (mesh.material === entry.visualMaterial) {
          mesh.material = entry.originalMaterial
        }
        mesh.castShadow = entry.originalCastShadow
        mesh.receiveShadow = entry.originalReceiveShadow
        disposeVisualMaterials(entry.visualMaterial)
      }

      visualMaterialsRef.current.clear()

      for (const [mesh, entry] of deleteFadeMaterialsRef.current.entries()) {
        if (mesh.material === entry.fadeMaterial) {
          mesh.material = entry.originalMaterial
        }
        disposeDeleteFadeMaterials(entry.fadeMaterial)
      }

      deleteFadeMaterialsRef.current.clear()
    }
  }, [])

  useFrame(() => {
    if (deleteFadeStartedAtMs === null) {
      return
    }

    const fadeProgress = MathUtils.clamp(
      ((typeof performance !== 'undefined' ? performance.now() : Date.now()) -
        deleteFadeStartedAtMs) /
        ITEM_DELETE_FADE_OUT_MS,
      0,
      1,
    )
    const fadeAlpha = 1 - MathUtils.smootherstep(fadeProgress, 0, 1)

    for (const entry of deleteFadeMaterialsRef.current.values()) {
      applyDeleteFadeOpacity(entry.fadeMaterial, fadeAlpha)
    }
  })

  return (
    <>
      <Clone
        object={scene}
        position={node.asset.offset}
        ref={ref}
        rotation={node.asset.rotation}
        scale={renderScale}
        {...(itemDeleteActivation ? {} : handlers)}
      />
      {carryOverlayVisible && (
        <ItemCarryOverlay
          assetOffset={node.asset.offset}
          assetRotation={node.asset.rotation}
          modelScene={scene}
          renderScale={renderScale}
          visible={carryOverlayVisible}
        />
      )}
      {animations.length > 0 && (
        <ItemAnimation
          actions={actions}
          animations={animations}
          animEffect={animEffect}
          interactive={interactive ?? null}
          nodeId={node.id}
        />
      )}
      {lightEffects.map((effect, i) => (
        <ItemLightRegistrar
          effect={effect}
          index={i}
          interactive={interactive!}
          key={i}
          nodeId={node.id}
        />
      ))}
    </>
  )
}

const ItemAnimation = ({
  nodeId,
  animEffect,
  interactive,
  actions,
  animations,
}: {
  nodeId: AnyNodeId
  animEffect: AnimationEffect | null
  interactive: Interactive | null
  actions: Record<string, AnimationAction | null>
  animations: { name: string }[]
}) => {
  const activeClipRef = useRef<string | null>(null)
  const fadingOutRef = useRef<AnimationAction | null>(null)

  // Reactive: derive target clip name — only re-renders when the clip name itself changes
  const targetClip = useInteractive((s) => {
    const values = s.items[nodeId]?.controlValues
    if (!animEffect) return animations[0]?.name ?? null
    const toggleIndex = interactive!.controls.findIndex((c) => c.kind === 'toggle')
    const isOn = toggleIndex >= 0 ? Boolean(values?.[toggleIndex]) : false
    return isOn
      ? (animEffect.clips.on ?? null)
      : (animEffect.clips.off ?? animEffect.clips.loop ?? null)
  })

  // When target clip changes: kick off the transition
  useEffect(() => {
    // Cancel any ongoing fade-out immediately
    if (fadingOutRef.current) {
      fadingOutRef.current.timeScale = 0
      fadingOutRef.current = null
    }
    // Move current clip to fade-out
    if (activeClipRef.current && activeClipRef.current !== targetClip) {
      const old = actions[activeClipRef.current]
      if (old?.isRunning()) fadingOutRef.current = old
    }
    // Start new clip at timeScale 0.01 (as 0 would cause isRunning to be false and thus not play at all), then fade in to 1
    activeClipRef.current = targetClip
    if (targetClip) {
      const next = actions[targetClip]
      if (next) {
        next.timeScale = 0.01
        next.play()
      }
    }
  }, [targetClip, actions])

  // useFrame: only lerping — no logic
  useFrame((_, delta) => {
    if (fadingOutRef.current) {
      const action = fadingOutRef.current
      action.timeScale = MathUtils.lerp(action.timeScale, 0, Math.min(delta * 5, 1))
      if (action.timeScale < 0.01) {
        action.timeScale = 0
        fadingOutRef.current = null
      }
    }
    if (activeClipRef.current) {
      const action = actions[activeClipRef.current]
      if (action?.isRunning() && action.timeScale < 1) {
        action.timeScale = MathUtils.lerp(action.timeScale, 1, Math.min(delta * 5, 1))
        if (1 - action.timeScale < 0.01) action.timeScale = 1
      }
    }
  })

  return null
}

const ItemLightRegistrar = ({
  nodeId,
  effect,
  interactive,
  index,
}: {
  nodeId: AnyNodeId
  effect: LightEffect
  interactive: Interactive
  index: number
}) => {
  useEffect(() => {
    const key = `${nodeId}:${index}`
    useItemLightPool.getState().register(key, nodeId, effect, interactive)
    return () => useItemLightPool.getState().unregister(key)
  }, [nodeId, index, effect, interactive])

  return null
}

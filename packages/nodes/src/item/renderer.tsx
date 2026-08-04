'use client'

import {
  type AnimationEffect,
  type AnyNodeId,
  deriveSlotId,
  getScaledDimensions,
  type Interactive,
  type ItemNode,
  isSlotMaterialName,
  itemClipRegistry,
  LIBRARY_MATERIAL_REF_PREFIX,
  type LightEffect,
  SCENE_MATERIAL_REF_PREFIX,
  toLibraryMaterialRef,
  useInteractive,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  type ColorPreset,
  configureKtx2Support,
  createDefaultMaterial,
  createSurfaceRoleMaterial,
  ErrorBoundary,
  glassMaterial,
  NodeRenderer,
  type RenderShading,
  resolveCdnUrl,
  resolveMaterialRef,
  stampPascalTextureRef,
  useItemLightPool,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useAnimations } from '@react-three/drei'
import { Clone } from '@react-three/drei/core/Clone'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AnimationAction, Group, Material, Mesh, Object3D } from 'three'
import { MathUtils, Texture } from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { positionLocal, smoothstep, time } from 'three/tsl'
import { RoofFaceHostFrame } from '../shared/roof-face-host'
import { cancelItemModelLoad, getUnavailableItemAsset, ItemGLTFLoader } from './model-loader'

type MutableMaterial = Material & {
  depthTest?: boolean
  opacity?: number
  opacityNode?: unknown
  transparent?: boolean
  wireframe?: boolean
}

type CapturedSingleItemMaterialData = {
  captured: true
  authoredMaterials: Material
  curatedRefs: string | undefined
  slotIds: string | null
}

type CapturedMultiItemMaterialData = {
  captured: true
  authoredMaterials: Material[]
  curatedRefs: (string | undefined)[]
  slotIds: (string | null)[]
}

type CapturedItemMaterialData = CapturedSingleItemMaterialData | CapturedMultiItemMaterialData

type ItemMeshUserData = Mesh['userData'] & {
  pascalItemMaterialCapture?: CapturedItemMaterialData
  slotId?: string | null | (string | null)[]
}

type SceneMaterials = ReturnType<typeof useScene.getState>['materials']

const getAuthoredSlotId = (material: Material): string | null =>
  isSlotMaterialName(material.name) ? deriveSlotId(material.name) : null

function curatedRefFromMaterial(material: Material): string | undefined {
  const raw = (material.userData as { pascal_material?: unknown }).pascal_material
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  if (raw.startsWith(LIBRARY_MATERIAL_REF_PREFIX) || raw.startsWith(SCENE_MATERIAL_REF_PREFIX)) {
    return raw
  }
  return toLibraryMaterialRef(raw)
}

const captureItemMeshMaterials = (mesh: Mesh): CapturedItemMaterialData => {
  const userData = mesh.userData as ItemMeshUserData
  const captured = userData.pascalItemMaterialCapture
  if (captured?.captured) {
    userData.slotId = captured.slotIds
    return captured
  }

  if (Array.isArray(mesh.material)) {
    const authoredMaterials = mesh.material.slice()
    const slotIds = authoredMaterials.map(getAuthoredSlotId)
    const curatedRefs = authoredMaterials.map(curatedRefFromMaterial)
    const next: CapturedItemMaterialData = {
      captured: true,
      authoredMaterials,
      curatedRefs,
      slotIds,
    }
    userData.pascalItemMaterialCapture = next
    userData.slotId = slotIds
    return next
  }

  const slotId = getAuthoredSlotId(mesh.material)
  const curatedRef = curatedRefFromMaterial(mesh.material)
  const next: CapturedItemMaterialData = {
    captured: true,
    authoredMaterials: mesh.material,
    curatedRefs: curatedRef,
    slotIds: slotId,
  }
  userData.pascalItemMaterialCapture = next
  userData.slotId = slotId
  return next
}

const isCapturedMaterialArray = (
  captured: CapturedItemMaterialData,
): captured is CapturedMultiItemMaterialData => Array.isArray(captured.authoredMaterials)

const isGlassMaterial = (material: Material): boolean =>
  material === glassMaterial || material.name.toLowerCase() === 'glass'

const clampGeometryGroups = (mesh: Mesh, matCount: number): void => {
  if (mesh.geometry.groups.length === 0) return

  const needsClamp = mesh.geometry.groups.some(
    (group) => group.materialIndex !== undefined && group.materialIndex >= matCount,
  )
  if (!needsClamp) return

  mesh.geometry = mesh.geometry.clone()
  for (const group of mesh.geometry.groups) {
    if (group.materialIndex !== undefined && group.materialIndex >= matCount) {
      group.materialIndex = 0
    }
  }
}

const resolveItemMaterial = (
  authoredMaterial: Material,
  slotId: string | null,
  curatedRef: string | undefined,
  {
    colorPreset,
    nodeSlots,
    sceneMaterials,
    shading,
    textures,
  }: {
    colorPreset: ColorPreset
    nodeSlots: ItemNode['slots']
    sceneMaterials: SceneMaterials
    shading: RenderShading
    textures: boolean
  },
): Material => {
  // Monochrome (textures off): collapse to the themed furnishing clay colour.
  if (!textures) return createSurfaceRoleMaterial('furnishing', colorPreset)
  if (authoredMaterial.name.toLowerCase() === 'glass') return glassMaterial
  if (slotId != null) {
    const override = resolveMaterialRef(nodeSlots?.[slotId], sceneMaterials, shading)
    if (override) return override
    const curated = resolveMaterialRef(curatedRef, sceneMaterials, shading)
    if (curated) return curated
    return authoredMaterial
  }
  // Colored (textures on): show the item's real authored material — its
  // textures, vertex colours, and default colours — for every item, not just
  // slot-authored ones (no more strip-to-clay default).
  return authoredMaterial
}

const BrokenItemFallback = ({ node }: { node: ItemNode }) => {
  const handlers = useNodeEvents(node, 'item')
  const shading = useViewer((s) => s.shading)
  const isExporting = useViewer((s) => s.isExporting)
  const [w, h, d] = getScaledDimensions(node)
  const material = useMemo(() => {
    const next = createDefaultMaterial('#ef4444', 1, shading) as MutableMaterial
    next.opacity = 0.6
    next.transparent = true
    next.wireframe = true
    next.needsUpdate = true
    return next
  }, [shading])

  // Debug affordance only — a bake must never ship the red placeholder box
  // (observed baked into a prod artifact when an item GLB 504'd mid-capture).
  if (isExporting) return null

  return (
    <mesh position-y={h / 2} {...handlers}>
      <boxGeometry args={[w, h, d]} />
      <primitive attach="material" object={material} />
    </mesh>
  )
}

let itemDracoLoader: DRACOLoader | null = null

const configureItemModelLoader = (loader: ItemGLTFLoader, renderer: unknown) => {
  configureKtx2Support(loader, renderer)
  if (!itemDracoLoader) {
    itemDracoLoader = new DRACOLoader(loader.manager)
    itemDracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/')
  }
  loader.setDRACOLoader(itemDracoLoader)
  loader.setMeshoptDecoder(MeshoptDecoder)
}

type LoadedItemGltf = GLTF & {
  materials: Record<string, Material>
  nodes: Record<string, Object3D>
}

const ITEM_TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'lightMap',
  'bumpMap',
  'displacementMap',
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

function getItemTextureImageIndex(gltf: LoadedItemGltf, texture: Texture): number | null {
  const association = gltf.parser?.associations.get(texture)
  const textureIndex = association?.textures
  if (!Number.isInteger(textureIndex)) return null

  const textureDef = gltf.parser.json.textures?.[textureIndex as number]
  const imageIndex =
    textureDef?.extensions?.KHR_texture_basisu?.source ??
    textureDef?.extensions?.EXT_texture_webp?.source ??
    textureDef?.extensions?.EXT_texture_avif?.source ??
    textureDef?.source
  return Number.isInteger(imageIndex) && imageIndex >= 0 ? imageIndex : null
}

function stampItemTextureReferences(gltf: LoadedItemGltf, src: string) {
  if (!gltf.parser?.associations) return

  const stamped = new Set<Texture>()
  gltf.scene.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const textureMaterial = material as Material & Record<string, unknown>
      for (const slot of ITEM_TEXTURE_SLOTS) {
        const texture = textureMaterial[slot]
        if (!(texture instanceof Texture)) continue
        if (stamped.has(texture)) continue
        const imageIndex = getItemTextureImageIndex(gltf, texture)
        if (imageIndex === null) continue
        if (
          stampPascalTextureRef(texture, {
            kind: 'item-glb',
            src,
            slot,
            imageIndex,
          })
        ) {
          stamped.add(texture)
        }
      }
    }
  })
}

const useItemGltf = (url: string): LoadedItemGltf => {
  const renderer = useThree((state) => state.gl)
  const gltf = useLoader(ItemGLTFLoader, url, (loader) =>
    configureItemModelLoader(loader, renderer),
  ) as LoadedItemGltf
  return useMemo(() => {
    stampItemTextureReferences(gltf, url)
    return gltf
  }, [gltf, url])
}

type DeferredUnavailableCleanup = {
  consumers: number
  timer: ReturnType<typeof setTimeout> | null
}

const unavailableAssetConsumers = new Map<string, DeferredUnavailableCleanup>()
const unavailableFailureConsumers = new Map<string, DeferredUnavailableCleanup>()

const retainUnavailableConsumer = (
  entries: Map<string, DeferredUnavailableCleanup>,
  key: string,
) => {
  const entry = entries.get(key) ?? { consumers: 0, timer: null }
  if (entry.timer !== null) {
    clearTimeout(entry.timer)
    entry.timer = null
  }
  entry.consumers += 1
  entries.set(key, entry)
}

const releaseUnavailableConsumer = (
  entries: Map<string, DeferredUnavailableCleanup>,
  key: string,
  onLastRelease: () => void,
) => {
  const entry = entries.get(key)
  if (!entry) return
  entry.consumers = Math.max(0, entry.consumers - 1)
  if (entry.consumers > 0 || entry.timer !== null) return

  // A zero-delay release distinguishes a real unmount from Strict Mode's
  // immediate setup-cleanup-setup cycle and same-tick replacements.
  entry.timer = setTimeout(() => {
    if (entry.consumers > 0 || entries.get(key) !== entry) return
    entries.delete(key)
    onLastRelease()
  }, 0)
}

const UnavailableItemModel = ({
  markSettled,
  node,
  url,
}: {
  markSettled: () => void
  node: ItemNode
  url: string
}) => {
  useEffect(() => {
    retainUnavailableConsumer(unavailableFailureConsumers, node.id)
    if (url) retainUnavailableConsumer(unavailableAssetConsumers, url)
    markSettled()
    useViewer.getState().reportItemLoadFailure(node.id, url)
    return () => {
      releaseUnavailableConsumer(unavailableFailureConsumers, node.id, () =>
        useViewer.getState().clearItemLoadFailure(node.id),
      )
      if (url) {
        releaseUnavailableConsumer(unavailableAssetConsumers, url, () => {
          cancelItemModelLoad(url)
          useLoader.clear(ItemGLTFLoader, url)
        })
      }
    }
  }, [markSettled, node.id, url])

  return <BrokenItemFallback node={node} />
}

/**
 * Expected network failures resolve through ItemGLTFLoader as an unavailable
 * scene so they never become React render errors. Parse and renderer failures
 * still reach this boundary and remain visible to developers.
 */
const ModelWithRetry = ({
  node,
  setSettled,
}: {
  node: ItemNode
  setSettled: (value: boolean) => void
}) => {
  const [renderFailed, setRenderFailed] = useState(false)
  const url = resolveCdnUrl(node.asset.src) || ''
  const markSettled = useCallback(() => setSettled(true), [setSettled])

  // Clear before child passive completion effects; a parent passive clear would run after them.
  useLayoutEffect(() => {
    setSettled(false)
  }, [setSettled])

  useEffect(() => {
    if (!renderFailed) return
    markSettled()
    useViewer.getState().reportItemLoadFailure(node.id, url)
    return () => useViewer.getState().clearItemLoadFailure(node.id)
  }, [markSettled, node.id, renderFailed, url])

  if (!url) return <UnavailableItemModel markSettled={markSettled} node={node} url={url} />

  return (
    <ErrorBoundary
      fallback={<BrokenItemFallback node={node} />}
      onError={() => setRenderFailed(true)}
      scope="item-model"
    >
      <Suspense fallback={<PreviewModel node={node} />}>
        <ModelRenderer markSettled={markSettled} node={node} />
      </Suspense>
    </ErrorBoundary>
  )
}

export const ItemRenderer = ({ node: storeNode }: { node: ItemNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(storeNode.id, storeNode.type, ref)

  // "Settled" = the model resolved, terminally failed (skipped), or was never
  // expected. `ItemSystem` holds the dirty mark until then, so scene-ready
  // (and headless bakes) wait for real item content instead of exporting the
  // loading placeholder. A model swap un-settles (ModelWithRetry's mount
  // effect via its URL key) so the replacement load is awaited too.
  const setSettled = useCallback((value: boolean) => {
    const group = ref.current as (Group & { userData: Record<string, unknown> }) | null
    if (group) group.userData.itemModelSettled = value
  }, [])

  // Merge live drag overrides so the mesh transforms in real time during a
  // drag (e.g. the in-world rotate gizmo). The handle writes the in-flight
  // rotation to `useLiveNodeOverrides` on every pointer move and commits to
  // the store only on release — without this merge the item would stay put
  // until commit.
  const liveOverrides = useLiveNodeOverrides((state) => state.get(storeNode.id as AnyNodeId))
  const node = useMemo(
    () => (liveOverrides ? ({ ...storeNode, ...liveOverrides } as ItemNode) : storeNode),
    [storeNode, liveOverrides],
  )
  const roomClearPreview =
    (node as ItemNode & { roomClearPreview?: unknown }).roomClearPreview === true

  useEffect(() => {
    if (roomClearPreview) setSettled(true)
  }, [roomClearPreview, setSettled])

  const content = (
    <group position={node.position} ref={ref} rotation={node.rotation} visible={node.visible}>
      {roomClearPreview ? (
        <ClearPreviewModel node={node} />
      ) : (
        <>
          <ModelWithRetry key={node.asset.src ?? 'no-src'} node={node} setSettled={setSettled} />
          {node.children?.map((childId) => (
            <NodeRenderer key={childId} nodeId={childId} />
          ))}
        </>
      )}
    </group>
  )

  if (!node.roofSegmentId) return content
  return (
    <RoofFaceHostFrame roofFace={node.roofFace} roofSegmentId={node.roofSegmentId}>
      {content}
    </RoofFaceHostFrame>
  )
}

const previewOpacity = smoothstep(0.42, 0.55, positionLocal.y.add(time.mul(-0.2)).mul(10).fract())
const previewMaterialCache = new Map<RenderShading, Material>()

function getPreviewMaterial(shading: RenderShading): Material {
  const cached = previewMaterialCache.get(shading)
  if (cached) return cached

  const material = createDefaultMaterial('#cccccc', 1, shading) as MutableMaterial
  material.depthTest = false
  material.opacityNode = previewOpacity
  material.transparent = true
  material.needsUpdate = true
  previewMaterialCache.set(shading, material)
  return material
}

const PreviewModel = ({ node }: { node: ItemNode }) => {
  const shading = useViewer((s) => s.shading)
  const isExporting = useViewer((s) => s.isExporting)
  const [w, h, d] = getScaledDimensions(node)
  // Loading placeholder — must never land in an exported GLB.
  if (isExporting) return null
  return (
    <mesh material={getPreviewMaterial(shading)} position-y={h / 2}>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  )
}

const LoadedItemPreview = ({ node }: { node: ItemNode }) => {
  const gltf = useItemGltf(resolveCdnUrl(node.asset.src) || '')
  if (getUnavailableItemAsset(gltf)) return <PreviewModel node={node} />
  return (
    <group rotation={node.rotation} scale={node.scale}>
      <Clone
        dispose={null}
        object={gltf.scene}
        position={node.asset.offset}
        rotation={node.asset.rotation}
        scale={node.asset.scale || [1, 1, 1]}
      />
    </group>
  )
}

export const ItemPreview = ({ node }: { node: ItemNode }) => {
  const url = resolveCdnUrl(node.asset.src) || ''
  if (!url) return <PreviewModel node={node} />
  return (
    <Suspense fallback={<PreviewModel node={node} />}>
      <ErrorBoundary fallback={<PreviewModel node={node} />} scope="item-preview-model">
        <LoadedItemPreview node={node} />
      </ErrorBoundary>
    </Suspense>
  )
}

const ClearPreviewModel = ({ node }: { node: ItemNode }) => {
  const shading = useViewer((s) => s.shading)
  const [w, h, d] = getScaledDimensions(node)
  const material = useMemo(() => {
    const next = createDefaultMaterial('#ef4444', 1, shading) as MutableMaterial
    next.depthTest = false
    next.opacity = 0.35
    next.transparent = true
    next.wireframe = true
    next.needsUpdate = true
    return next
  }, [shading])

  return (
    <mesh material={material} position-y={h / 2}>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  )
}

const ModelRenderer = ({ node, markSettled }: { node: ItemNode; markSettled: () => void }) => {
  const gltf = useItemGltf(resolveCdnUrl(node.asset.src) || '')
  const unavailable = getUnavailableItemAsset(gltf)
  if (unavailable) {
    return <UnavailableItemModel markSettled={markSettled} node={node} url={unavailable.url} />
  }
  return <LoadedModelRenderer gltf={gltf} markSettled={markSettled} node={node} />
}

const LoadedModelRenderer = ({
  gltf: { scene, nodes, animations },
  node,
  markSettled,
}: {
  gltf: LoadedItemGltf
  node: ItemNode
  markSettled: () => void
}) => {
  const ref = useRef<Group>(null!)
  const { actions } = useAnimations(animations, ref)

  // Mounting past the suspense gate means the GLB resolved — the item's build
  // work is done (`ItemSystem` may clear its dirty mark, scene-ready may fire).
  useEffect(() => {
    markSettled()
  }, [markSettled])
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const colorPreset = useViewer((s) => s.colorPreset)
  const sceneMaterials = useScene((s) => s.materials)
  // Freeze the interactive definition at mount — asset schemas don't change at runtime
  const interactiveRef = useRef(node.asset.interactive)

  if (nodes.cutout) {
    nodes.cutout.visible = false
  }

  const handlers = useNodeEvents(node, 'item')

  useEffect(() => {
    if (!node.parentId) return
    useScene.getState().markDirty(node.parentId as AnyNodeId)
  }, [node.parentId])

  useEffect(() => {
    const interactive = interactiveRef.current
    if (!interactive) return
    useInteractive.getState().initItem(node.id, interactive)
    return () => useInteractive.getState().removeItem(node.id)
  }, [node.id])

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return

    const meshEntries: { mesh: Mesh; captured: CapturedItemMaterialData }[] = []

    root.traverse((child) => {
      if (!(child as Mesh).isMesh) return

      const mesh = child as Mesh
      if (mesh.name === 'cutout') {
        child.visible = false
      }

      const captured = captureItemMeshMaterials(mesh)
      if (mesh.name !== 'cutout') meshEntries.push({ mesh, captured })
    })

    const materialOptions = {
      colorPreset,
      nodeSlots: node.slots,
      sceneMaterials,
      shading,
      textures,
    }

    for (const { mesh, captured } of meshEntries) {
      let hasGlass = false

      if (isCapturedMaterialArray(captured)) {
        const nextMaterials = captured.authoredMaterials.map((authoredMaterial, index) =>
          resolveItemMaterial(
            authoredMaterial,
            captured.slotIds[index] ?? null,
            captured.curatedRefs[index],
            materialOptions,
          ),
        )
        mesh.material = nextMaterials
        hasGlass = nextMaterials.some(isGlassMaterial)
        clampGeometryGroups(mesh, nextMaterials.length)
      } else {
        const nextMaterial = resolveItemMaterial(
          captured.authoredMaterials,
          captured.slotIds,
          captured.curatedRefs,
          materialOptions,
        )
        mesh.material = nextMaterial
        hasGlass = isGlassMaterial(nextMaterial)
      }

      mesh.castShadow = !hasGlass
      mesh.receiveShadow = !hasGlass
    }
  }, [shading, textures, colorPreset, node.slots, sceneMaterials])

  const interactive = interactiveRef.current
  const animEffect =
    interactive?.effects.find((e): e is AnimationEffect => e.kind === 'animation') ?? null
  const lightEffects =
    interactive?.effects.filter((e): e is LightEffect => e.kind === 'light') ?? []

  // Expose this item's ambient clip (e.g. a fan's spin) to the GLB bake. The
  // catalog GLB owns the clip; it isn't in the scene graph, so the export can't
  // find it without this registry. The bake retargets it onto the baked subtree.
  useEffect(() => {
    if (!animEffect) return
    const clipName = animEffect.clips.on ?? animEffect.clips.loop
    const clip = clipName ? animations.find((c) => c.name === clipName) : undefined
    if (!clip) return
    itemClipRegistry.set(node.id, { clip, loop: true })
    return () => {
      itemClipRegistry.delete(node.id)
    }
  }, [node.id, animEffect, animations])

  // useGLTF caches scenes, and Clone shares child geometry/material references.
  // Undo can unmount one item while another clone of the same asset still needs them.
  return (
    <>
      <group scale={node.scale}>
        <Clone
          dispose={null}
          object={scene}
          position={node.asset.offset}
          ref={ref}
          rotation={node.asset.rotation}
          scale={node.asset.scale || [1, 1, 1]}
          {...handlers}
        />
      </group>
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

export default ItemRenderer

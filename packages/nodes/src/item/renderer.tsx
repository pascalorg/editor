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
  createDefaultMaterial,
  createSurfaceRoleMaterial,
  ErrorBoundary,
  glassMaterial,
  NodeRenderer,
  type RenderShading,
  resolveCdnUrl,
  resolveMaterialRef,
  useItemLightPool,
  useNodeEvents,
  useViewer,
} from '@pascal-app/viewer'
import { useAnimations } from '@react-three/drei'
import { Clone } from '@react-three/drei/core/Clone'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { AnimationAction, Group, Material, Mesh } from 'three'
import { MathUtils } from 'three'
import { positionLocal, smoothstep, time } from 'three/tsl'
import { RoofFaceHostFrame } from '../shared/roof-face-host'

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
  const [w, h, d] = node.asset.dimensions
  const material = useMemo(() => {
    const next = createDefaultMaterial('#ef4444', 1, shading) as MutableMaterial
    next.opacity = 0.6
    next.transparent = true
    next.wireframe = true
    next.needsUpdate = true
    return next
  }, [shading])

  return (
    <mesh position-y={h / 2} {...handlers}>
      <boxGeometry args={[w, h, d]} />
      <primitive attach="material" object={material} />
    </mesh>
  )
}

export const ItemRenderer = ({ node: storeNode }: { node: ItemNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(storeNode.id, storeNode.type, ref)

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

  const content = (
    <group position={node.position} ref={ref} rotation={node.rotation} visible={node.visible}>
      {roomClearPreview ? (
        <ClearPreviewModel node={node} />
      ) : (
        <>
          <ErrorBoundary fallback={<BrokenItemFallback node={node} />}>
            <Suspense fallback={<PreviewModel node={node} />}>
              <ModelRenderer node={node} />
            </Suspense>
          </ErrorBoundary>
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
  return (
    <mesh material={getPreviewMaterial(shading)} position-y={node.asset.dimensions[1] / 2}>
      <boxGeometry
        args={[node.asset.dimensions[0], node.asset.dimensions[1], node.asset.dimensions[2]]}
      />
    </mesh>
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

const multiplyScales = (
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] => [a[0] * b[0], a[1] * b[1], a[2] * b[2]]

const ModelRenderer = ({ node }: { node: ItemNode }) => {
  const { scene, nodes, animations } = useGLTF(resolveCdnUrl(node.asset.src) || '')
  const ref = useRef<Group>(null!)
  const { actions } = useAnimations(animations, ref)
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
      <Clone
        dispose={null}
        object={scene}
        position={node.asset.offset}
        ref={ref}
        rotation={node.asset.rotation}
        scale={multiplyScales(node.asset.scale || [1, 1, 1], node.scale || [1, 1, 1])}
        {...handlers}
      />
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

'use client'

import {
  type AnimationEffect,
  type AnyNodeId,
  type Interactive,
  type ItemNode,
  type LightEffect,
  useInteractive,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import {
  baseMaterial,
  ErrorBoundary,
  glassMaterial,
  NodeRenderer,
  resolveCdnUrl,
  useItemLightPool,
  useNodeEvents,
} from '@pascal-app/viewer'
import { useAnimations } from '@react-three/drei'
import { Clone } from '@react-three/drei/core/Clone'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import type { AnimationAction, Group, Material, Mesh } from 'three'
import { MathUtils, MeshStandardMaterial } from 'three'
import { positionLocal, smoothstep, time } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { getItemColorOverride, isImportedGlbAsset } from './color-metadata'

const getMaterialForOriginal = (original: Material): Material => {
  if (original.name.toLowerCase() === 'glass') {
    return glassMaterial
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

function isTransientItem(node: ItemNode) {
  return (
    typeof node.metadata === 'object' &&
    node.metadata !== null &&
    !Array.isArray(node.metadata) &&
    (node.metadata as Record<string, unknown>).isTransient === true
  )
}

export const ItemRenderer = ({ node }: { node: ItemNode }) => {
  const ref = useRef<Group>(null!)
  const useProxy = isImportedGlbAsset(node) && isTransientItem(node)

  useRegistry(node.id, node.type, ref)

  return (
    <group position={node.position} ref={ref} rotation={node.rotation} visible={node.visible}>
      {useProxy ? (
        <PreviewModel node={node} />
      ) : (
        <ErrorBoundary fallback={<BrokenItemFallback node={node} />}>
          <Suspense fallback={<PreviewModel node={node} />}>
            <ModelRenderer node={node} />
          </Suspense>
        </ErrorBoundary>
      )}
      {node.children?.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
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

const ModelRenderer = ({ node }: { node: ItemNode }) => {
  const importedGlb = isImportedGlbAsset(node)
  const modelUrl = useMemo(() => {
    const src = resolveCdnUrl(node.asset.src) || ''
    if (!(src && importedGlb)) return src
    return `${src}${src.includes('?') ? '&' : '?'}pascalImportedGlb=1`
  }, [node.asset.src, importedGlb])
  const { scene, nodes, animations } = useGLTF(modelUrl)
  const ref = useRef<Group>(null!)
  const { actions } = useAnimations(animations, ref)
  const colorOverride = getItemColorOverride(node)
  // Freeze the interactive definition at mount — asset schemas don't change at runtime
  const interactiveRef = useRef(node.asset.interactive)

  if (!importedGlb && nodes.cutout) {
    nodes.cutout.visible = false
  }

  const handlers = useNodeEvents(node, 'item')

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

  const preparedScene = useMemo(() => {
    const clonedScene = scene.clone(true)
    const colorMaterial = colorOverride
      ? new MeshStandardMaterial({
          color: colorOverride,
          metalness: 0.05,
          roughness: 0.72,
        })
      : null

    clonedScene.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh
        if (!importedGlb && mesh.name === 'cutout') {
          child.visible = false
          return
        }

        if (importedGlb) {
          if (colorMaterial) {
            mesh.material = colorMaterial
          }
          mesh.castShadow = false
          mesh.receiveShadow = false
          return
        }

        if (colorMaterial) {
          mesh.material = colorMaterial
          mesh.castShadow = true
          mesh.receiveShadow = true
          return
        }

        let hasGlass = false

        // Handle both single material and material array cases
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => getMaterialForOriginal(mat))
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
          mesh.material = getMaterialForOriginal(mesh.material)
          hasGlass = mesh.material.name === 'glass'
        }
        mesh.castShadow = !hasGlass
        mesh.receiveShadow = !hasGlass
      }
    })
    return clonedScene
  }, [scene, importedGlb, colorOverride])

  const interactive = interactiveRef.current
  const animEffect =
    interactive?.effects.find((e): e is AnimationEffect => e.kind === 'animation') ?? null
  const lightEffects =
    interactive?.effects.filter((e): e is LightEffect => e.kind === 'light') ?? []

  // useGLTF caches scenes, and Clone shares child geometry/material references.
  // Undo can unmount one item while another clone of the same asset still needs them.
  return (
    <>
      <Clone
        dispose={null}
        object={preparedScene}
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

import {
  type AnimationEffect,
  type AnyNodeId,
  type Interactive,
  type ItemNode,
  type LightEffect,
  type SliderControl,
  useInteractive,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useAnimations } from '@react-three/drei'
import { Clone } from '@react-three/drei/core/Clone'
import { useGLTF } from '@react-three/drei/core/Gltf'
import { useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import type { AnimationAction, Group, Material, Mesh, PointLight } from 'three'
import { MathUtils } from 'three'
import { positionLocal, smoothstep, time } from 'three/tsl'
import { DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu'
import { useNodeEvents } from '../../../hooks/use-node-events'
import { resolveCdnUrl } from '../../../lib/asset-url'
import { NodeRenderer } from '../node-renderer'

// Shared materials to avoid creating new instances for every mesh
const defaultMaterial = new MeshStandardNodeMaterial({
  color: 0xffffff,
  roughness: 1,
  metalness: 0,
})

const glassMaterial = new MeshStandardNodeMaterial({
  name: 'glass',
  color: 'lightgray',
  roughness: 0.8,
  metalness: 0,
  transparent: true,
  opacity: 0.35,
  side: DoubleSide,
  depthWrite: false,
})

const getMaterialForOriginal = (original: Material): MeshStandardNodeMaterial => {
  if (original.name.toLowerCase() === 'glass') {
    return glassMaterial
  }
  return defaultMaterial
}

export const ItemRenderer = ({ node }: { node: ItemNode }) => {
  const ref = useRef<Group>(null!)

  useRegistry(node.id, node.type, ref)

  return (
    <group position={node.position} rotation={node.rotation} ref={ref} visible={node.visible}>
      <Suspense fallback={<PreviewModel node={node} />}>
        <ModelRenderer node={node} />
      </Suspense>
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
    <mesh position-y={node.asset.dimensions[1] / 2} material={previewMaterial}>
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
  const { scene, nodes, animations } = useGLTF(resolveCdnUrl(node.asset.src) || '')
  const ref = useRef<Group>(null!)
  const { actions } = useAnimations(animations, ref)
  // Freeze the interactive definition at mount — asset schemas don't change at runtime
  const interactiveRef = useRef(node.asset.interactive)

  if (nodes.cutout) {
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

  useMemo(() => {
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
          mesh.material = mesh.material.map((mat) => getMaterialForOriginal(mat))
          hasGlass = mesh.material.some((mat) => mat.name === 'glass')
        } else {
          mesh.material = getMaterialForOriginal(mesh.material)
          hasGlass = mesh.material.name === 'glass'
        }
        mesh.castShadow = !hasGlass
        mesh.receiveShadow = !hasGlass
      }
    })
  }, [scene])

  const interactive = interactiveRef.current
  const animEffect =
    interactive?.effects.find((e): e is AnimationEffect => e.kind === 'animation') ?? null
  const lightEffects =
    interactive?.effects.filter((e): e is LightEffect => e.kind === 'light') ?? []

  return (
    <>
      <Clone
        ref={ref}
        object={scene}
        scale={multiplyScales(node.asset.scale || [1, 1, 1], node.scale || [1, 1, 1])}
        position={node.asset.offset}
        rotation={node.asset.rotation}
        {...handlers}
      />
      {animations.length > 0 && (
        <ItemAnimation
          nodeId={node.id}
          animEffect={animEffect}
          interactive={interactive ?? null}
          actions={actions}
          animations={animations}
        />
      )}
      {lightEffects.map((effect, i) => (
        <ItemLight key={i} nodeId={node.id} effect={effect} interactive={interactive!} />
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

const ItemLight = ({
  nodeId,
  effect,
  interactive,
}: {
  nodeId: AnyNodeId
  effect: LightEffect
  interactive: Interactive
}) => {
  const lightRef = useRef<PointLight>(null!)
  // Precompute stable indices — interactive is frozen at mount
  const toggleIndex = interactive.controls.findIndex((c) => c.kind === 'toggle')
  const sliderIndex = interactive.controls.findIndex((c) => c.kind === 'slider')
  const sliderControl =
    sliderIndex >= 0 ? (interactive.controls[sliderIndex] as SliderControl) : null

  useFrame((_, delta) => {
    if (!lightRef.current) return
    const values = useInteractive.getState().items[nodeId]?.controlValues

    const isOn = toggleIndex >= 0 ? Boolean(values?.[toggleIndex]) : true

    // Normalize slider to 0-1 (default full intensity if no slider)
    let t = 1
    if (sliderControl) {
      const raw = (values?.[sliderIndex] as number) ?? sliderControl.min
      t = (raw - sliderControl.min) / (sliderControl.max - sliderControl.min)
    }

    const target = isOn
      ? MathUtils.lerp(effect.intensityRange[0], effect.intensityRange[1], t)
      : effect.intensityRange[0]

    lightRef.current.intensity = MathUtils.lerp(
      lightRef.current.intensity,
      target,
      Math.min(delta * 12, 1),
    )
  })

  return (
    <pointLight
      ref={lightRef}
      color={effect.color}
      intensity={effect.intensityRange[0]}
      distance={effect.distance ?? 0}
      position={effect.offset}
      castShadow={false}
    />
  )
}

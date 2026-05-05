'use client'

import './three-types'
import { type AnyNodeId, type ItemNode, useScene } from '@pascal-app/core'
import { useViewerFrame } from '@pascal-app/viewer'
import { useRef, useSyncExternalStore } from 'react'
import type { MeshStandardMaterial } from 'three'
import { DoubleSide, MathUtils } from 'three'

export type HomeAssistantItemTriggerEffect = {
  fadeInMs: number
  startedAtMs: number
}

type HomeAssistantItemEffectState = Record<AnyNodeId, HomeAssistantItemTriggerEffect>

let state: HomeAssistantItemEffectState = {}
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const homeAssistantItemEffects = {
  clear(itemId: AnyNodeId) {
    if (!state[itemId]) return
    const { [itemId]: _removed, ...rest } = state
    state = rest
    emit()
  },
  trigger(itemId: AnyNodeId, fadeInMs = 450) {
    if (state[itemId]) return
    state = {
      ...state,
      [itemId]: {
        fadeInMs: Math.max(1, fadeInMs),
        startedAtMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      },
    }
    emit()
  },
}

function useHomeAssistantItemEffects() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}

function multiplyScales(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

function isTelevisionItem(node: ItemNode) {
  const assetId = node.asset.id.trim().toLowerCase()
  const assetName = node.asset.name.trim().toLowerCase()
  const assetSrc = node.asset.src.trim().toLowerCase()
  return (
    assetId === 'television' ||
    assetName === 'television' ||
    assetSrc.endsWith('/items/television/model.glb')
  )
}

function TelevisionScreenGlow({
  effect,
  node,
}: {
  effect: HomeAssistantItemTriggerEffect
  node: ItemNode
}) {
  const materialRef = useRef<MeshStandardMaterial>(null!)

  useViewerFrame(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const progress = MathUtils.clamp(
      (now - effect.startedAtMs) / Math.max(1, effect.fadeInMs),
      0,
      1,
    )
    if (materialRef.current) {
      materialRef.current.opacity = 0.92 * MathUtils.smootherstep(progress, 0, 1)
    }
  })

  return (
    <group position={node.position} rotation={node.rotation} visible={node.visible}>
      <group
        position={node.asset.offset}
        rotation={node.asset.rotation}
        scale={multiplyScales(node.asset.scale || [1, 1, 1], node.scale || [1, 1, 1])}
      >
        <mesh position={[0, 0.6207, -0.025]} userData={{ pascalExcludeFromToolConeTarget: true }}>
          <planeGeometry args={[1.4626, 0.7423]} />
          <meshStandardMaterial
            color="#ffffff"
            depthWrite={false}
            emissive="#ffffff"
            emissiveIntensity={2.2}
            opacity={0}
            ref={materialRef}
            side={DoubleSide}
            transparent
          />
        </mesh>
      </group>
    </group>
  )
}

export function HomeAssistantItemEffects() {
  const effects = useHomeAssistantItemEffects()
  const nodes = useScene((scene) => scene.nodes)

  return (
    <>
      {Object.entries(effects).map(([itemId, effect]) => {
        const node = nodes[itemId as AnyNodeId]
        return node?.type === 'item' && isTelevisionItem(node) ? (
          <TelevisionScreenGlow effect={effect} key={itemId} node={node} />
        ) : null
      })}
    </>
  )
}

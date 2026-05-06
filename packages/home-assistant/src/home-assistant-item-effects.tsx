'use client'

import './three-types'
import { type AnyNodeId, type ItemNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewerFrame } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Object3D } from 'three'
import { DoubleSide, Group, MathUtils, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three'

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
  const parentRef = useRef<Object3D | null>(null)
  const glow = useMemo(() => {
    const group = new Group()
    group.userData.pascalExcludeFromToolConeTarget = true

    const geometry = new PlaneGeometry(1.4626, 0.7423)
    const material = new MeshStandardMaterial({
      color: '#ffffff',
      depthWrite: false,
      emissive: '#ffffff',
      emissiveIntensity: 2.2,
      opacity: 0,
      side: DoubleSide,
      transparent: true,
    })
    const mesh = new Mesh(geometry, material)
    mesh.position.set(0, 0.6207, -0.025)
    mesh.userData.pascalExcludeFromToolConeTarget = true
    group.add(mesh)

    return { geometry, group, material }
  }, [])

  useViewerFrame(() => {
    const nextItemObject = sceneRegistry.nodes.get(node.id) ?? null
    if (nextItemObject !== parentRef.current) {
      parentRef.current?.remove(glow.group)
      parentRef.current = nextItemObject
      nextItemObject?.add(glow.group)
    }

    glow.group.visible = node.visible && Boolean(nextItemObject)
    glow.group.position.fromArray(node.asset.offset)
    glow.group.rotation.fromArray(node.asset.rotation)
    const assetScale = node.asset.scale || [1, 1, 1]
    const nodeScale = node.scale || [1, 1, 1]
    glow.group.scale.set(
      assetScale[0] * nodeScale[0],
      assetScale[1] * nodeScale[1],
      assetScale[2] * nodeScale[2],
    )

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const progress = MathUtils.clamp(
      (now - effect.startedAtMs) / Math.max(1, effect.fadeInMs),
      0,
      1,
    )
    glow.material.opacity = 0.92 * MathUtils.smootherstep(progress, 0, 1)
  })

  useEffect(() => {
    return () => {
      parentRef.current?.remove(glow.group)
      parentRef.current = null
      glow.geometry.dispose()
      glow.material.dispose()
    }
  }, [glow])

  return null
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

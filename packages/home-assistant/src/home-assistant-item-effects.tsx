'use client'

import './three-types'
import { type AnyNodeId, type ItemNode, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewerFrame } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { Object3D } from 'three'
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three'
import {
  getHomeAssistantDisplayItemKind,
  type HomeAssistantDisplayItemKind,
} from './home-assistant-display-items'

export type HomeAssistantItemTriggerEffect = {
  fadeInMs: number
  kind?: HomeAssistantDisplayItemKind
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
  trigger(itemId: AnyNodeId, fadeInMs = 450, kind?: HomeAssistantDisplayItemKind) {
    const existing = state[itemId]
    if (existing && existing.kind === kind) return
    state = {
      ...state,
      [itemId]: {
        fadeInMs: existing?.fadeInMs ?? Math.max(1, fadeInMs),
        kind,
        startedAtMs:
          existing?.startedAtMs ??
          (typeof performance !== 'undefined' ? performance.now() : Date.now()),
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

type ScreenGlowSpec = {
  createGeometry: () => BufferGeometry
  emissiveIntensity: number
  opacity: number
  position: [number, number, number]
  rotation?: [number, number, number]
}

function createComputerScreenGeometry() {
  const xSegments = 32
  const ySegments = 8
  const yBottom = 0.0944
  const yTop = 0.4577
  const xHalfBottom = 0.3169
  const xHalfTop = 0.3188
  const zCenterBottom = 0.0548
  const zCenterTop = 0.0413
  const zEdgeBottom = 0.0815
  const zEdgeTop = 0.0683
  const zOffset = 0.002
  const positions: number[] = []
  const indices: number[] = []

  for (let yIndex = 0; yIndex <= ySegments; yIndex++) {
    const v = yIndex / ySegments
    const y = MathUtils.lerp(yBottom, yTop, v)
    const xHalf = MathUtils.lerp(xHalfBottom, xHalfTop, v)
    const zCenter = MathUtils.lerp(zCenterBottom, zCenterTop, v) + zOffset
    const zEdge = MathUtils.lerp(zEdgeBottom, zEdgeTop, v) + zOffset

    for (let xIndex = 0; xIndex <= xSegments; xIndex++) {
      const u = (xIndex / xSegments) * 2 - 1
      const x = u * xHalf
      const z = zCenter + (zEdge - zCenter) * Math.abs(u) ** 2
      positions.push(x, y, z)
    }
  }

  const rowStride = xSegments + 1
  for (let yIndex = 0; yIndex < ySegments; yIndex++) {
    for (let xIndex = 0; xIndex < xSegments; xIndex++) {
      const a = yIndex * rowStride + xIndex
      const b = a + 1
      const c = a + rowStride
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

const SCREEN_GLOW_SPECS: Record<HomeAssistantDisplayItemKind, ScreenGlowSpec> = {
  computer: {
    createGeometry: createComputerScreenGeometry,
    emissiveIntensity: 2.4,
    opacity: 0.9,
    position: [0, 0, 0],
  },
  television: {
    createGeometry: () => new PlaneGeometry(1.4626, 0.7423),
    emissiveIntensity: 2.2,
    opacity: 0.92,
    position: [0, 0.6207, -0.025],
  },
}

function DisplayScreenGlow({
  effect,
  kind,
  node,
}: {
  effect: HomeAssistantItemTriggerEffect
  kind: HomeAssistantDisplayItemKind
  node: ItemNode
}) {
  const parentRef = useRef<Object3D | null>(null)
  const glow = useMemo(() => {
    const spec = SCREEN_GLOW_SPECS[kind]
    const group = new Group()
    group.userData.pascalExcludeFromToolConeTarget = true

    const geometry = spec.createGeometry()
    const material = new MeshStandardMaterial({
      color: '#ffffff',
      depthWrite: false,
      emissive: '#ffffff',
      emissiveIntensity: spec.emissiveIntensity,
      opacity: 0,
      side: DoubleSide,
      transparent: true,
    })
    const mesh = new Mesh(geometry, material)
    mesh.position.set(...spec.position)
    if (spec.rotation) {
      mesh.rotation.set(...spec.rotation)
    }
    mesh.userData.pascalExcludeFromToolConeTarget = true
    group.add(mesh)

    return { geometry, group, material, opacity: spec.opacity }
  }, [kind])

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
    glow.material.opacity = glow.opacity * MathUtils.smootherstep(progress, 0, 1)
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
        if (node?.type !== 'item') {
          return null
        }

        const kind = getHomeAssistantDisplayItemKind(node) ?? effect.kind
        return kind ? (
          <DisplayScreenGlow effect={effect} key={itemId} kind={kind} node={node} />
        ) : null
      })}
    </>
  )
}

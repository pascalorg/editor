'use client'

import {
  type AnyNode,
  type AnyNodeId,
  isNodeKindEnabled,
  type LiveNodeOverrides,
  nodeRegistry,
  sceneRegistry,
  useLiveNodeOverrides,
  type useScene,
} from '@pascal-app/core'
import type { SceneViewInteriorPolicy } from '@pascal-app/core/agent-operations'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Object3D } from 'three'
import { areLiveFrameUpdatesHeld } from './live-frame-hold'

type SceneState = ReturnType<typeof useScene.getState>
type Materials = SceneState['materials']
type CommittedInput = { materials: Materials; frame: number }
type NodeInput = CommittedInput & {
  node: AnyNode
  liveOverrides: LiveNodeOverrides | undefined
  root: Object3D | undefined
}
type SceneInputs = {
  frame: number
  nodes: Map<string, NodeInput>
  builders: Map<symbol, CommittedInput>
}

// Observation only: never dirty, flush, render, or rewrite owner state.
const scenes = new WeakMap<Object3D, SceneInputs>()
function inputs(scene: Object3D): SceneInputs {
  let value = scenes.get(scene)
  if (!value) {
    value = { frame: 0, nodes: new Map(), builders: new Map() }
    scenes.set(scene, value)
  }
  return value
}

/** Counts normal host frames, before callbacks can commit new input in that frame. */
export function SceneCaptureInputFrames() {
  const scene = useThree((state) => state.scene)
  useFrame(() => {
    if (!areLiveFrameUpdatesHeld()) inputs(scene).frame++
  }, -1000)
  return null
}

/**
 * Sibling AFTER the renderer, INSIDE its resolved Suspense boundary. Passive
 * acknowledgement follows child material/layout effects, and is invalid until
 * a subsequent natural host frame has processed these inputs.
 */
export function CommittedSceneNodeInput({
  node,
  materials,
  liveOverrides,
}: {
  node: AnyNode
  materials: Materials
  liveOverrides: LiveNodeOverrides | undefined
}) {
  const scene = useThree((state) => state.scene)
  useEffect(() => {
    const value = inputs(scene)
    const entry = {
      node,
      materials,
      liveOverrides,
      root: sceneRegistry.nodes.get(node.id),
      frame: value.frame,
    }
    value.nodes.set(node.id, entry)
    return () => {
      if (value.nodes.get(node.id) === entry) value.nodes.delete(node.id)
    }
  }, [scene, node, materials, liveOverrides])
  return null
}

/** Call after a builder's material invalidation effects, with its captured input. */
export function useCommittedSceneMaterialInput(materials: Materials) {
  const scene = useThree((state) => state.scene)
  const token = useRef(Symbol('scene-material-builder'))
  useEffect(() => {
    const value = inputs(scene)
    const id = token.current
    const entry = { materials, frame: value.frame }
    value.builders.set(id, entry)
    return () => {
      if (value.builders.get(id) === entry) value.builders.delete(id)
    }
  }, [scene, materials])
}

/** Current authored inputs must be committed and have participated in a normal frame. */
export function sceneCaptureInputsReady(
  scene: Object3D,
  state: Pick<SceneState, 'nodes' | 'materials' | 'installedPlugins'>,
  policy: SceneViewInteriorPolicy,
): boolean {
  const value = scenes.get(scene)
  if (!value || value.frame === 0) return false
  for (const entry of value.builders.values()) {
    if (entry.materials !== state.materials || entry.frame >= value.frame) return false
  }
  const ancestors = new Set<string>()
  let ancestor = state.nodes[policy.levelId as AnyNodeId]
  while (ancestor && !ancestors.has(ancestor.id)) {
    ancestors.add(ancestor.id)
    ancestor = state.nodes[ancestor.parentId as AnyNodeId]
  }
  const hidden = new Set(policy.hiddenNodeIds)
  for (const node of Object.values(state.nodes)) {
    let scoped = ancestors.has(node.id)
    let current: AnyNode | undefined = node
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      if (hidden.has(current.id) || current.visible === false) {
        scoped = false
        break
      }
      if (current.id === policy.levelId) {
        scoped = true
        break
      }
      visited.add(current.id)
      current = state.nodes[current.parentId as AnyNodeId]
    }
    if (!scoped || !isNodeKindEnabled(node.type, state.installedPlugins)) continue
    const def = nodeRegistry.get(node.type)
    if (!def?.renderer && !def?.geometry) continue
    const root = sceneRegistry.nodes.get(node.id)
    const entry = value.nodes.get(node.id)
    if (
      !root ||
      !entry ||
      entry.root !== root ||
      entry.node !== node ||
      entry.materials !== state.materials ||
      entry.liveOverrides !== useLiveNodeOverrides.getState().get(node.id) ||
      entry.frame >= value.frame
    )
      return false
    let parent: Object3D | null = root
    while (parent && parent !== scene) parent = parent.parent
    if (!parent) return false
  }
  return true
}

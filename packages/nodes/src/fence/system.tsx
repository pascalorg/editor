'use client'

import {
  type AnyNode,
  type AnyNodeId,
  findLevelAncestorId,
  isFenceFeatureNode,
  nodeRegistry,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type { Object3D } from 'three'
import { resolveFenceLiftElevationForNodes } from './lift'
import type { FenceNode } from './schema'

function followsSurfaces(fence: FenceNode): boolean {
  return (fence.path?.length ?? 0) >= 2 || Math.abs(fence.curveOffset ?? 0) > 1e-4
}

function isSupport(node: AnyNode): boolean {
  return (
    node.type === 'slab' ||
    (node.type !== 'fence' && !!nodeRegistry.get(node.type)?.capabilities.surfaces?.top)
  )
}

function supportLevels(nodes: Record<AnyNodeId, AnyNode>): Map<AnyNodeId, AnyNodeId> {
  const levels = new Map<AnyNodeId, AnyNodeId>()
  for (const node of Object.values(nodes)) {
    if (!isSupport(node)) continue
    const level = findLevelAncestorId(node.id as AnyNodeId, nodes)
    if (level) levels.set(node.id as AnyNodeId, level as AnyNodeId)
  }
  return levels
}

function markFenceAndChildren(id: AnyNodeId) {
  const state = useScene.getState()
  state.markDirty(id)
  const node = state.nodes[id]
  if (node?.type === 'fence')
    for (const childId of node.children ?? []) state.markDirty(childId as AnyNodeId)
}

const FenceSystems = () => {
  const outputs = useRef(new Map<AnyNodeId, Object3D | null>())
  const levels = useRef(supportLevels(useScene.getState().nodes))

  useEffect(() => {
    let previousNodes = useScene.getState().nodes
    const unsubscribe = useScene.subscribe((state) => {
      if (state.nodes === previousNodes) return
      const currentNodes = state.nodes
      const previousLevels = levels.current
      const currentLevels = supportLevels(currentNodes)
      const changedLevels = new Set<AnyNodeId>()
      for (const id of new Set([...previousLevels.keys(), ...currentLevels.keys()])) {
        if (
          previousNodes[id] === currentNodes[id] &&
          previousLevels.get(id) === currentLevels.get(id)
        )
          continue
        const oldLevel = previousLevels.get(id)
        const newLevel = currentLevels.get(id)
        if (oldLevel) changedLevels.add(oldLevel)
        if (newLevel) changedLevels.add(newLevel)
      }
      for (const id of new Set([...Object.keys(previousNodes), ...Object.keys(currentNodes)])) {
        const before = previousNodes[id as AnyNodeId]
        const after = currentNodes[id as AnyNodeId]
        if (before === after) continue
        if (after?.type === 'fence') markFenceAndChildren(after.id)
        if (isFenceFeatureNode(before) && before.parentId)
          markFenceAndChildren(before.parentId as AnyNodeId)
        if (isFenceFeatureNode(after) && after.parentId)
          markFenceAndChildren(after.parentId as AnyNodeId)
      }
      levels.current = currentLevels
      for (const node of Object.values(currentNodes)) {
        if (node.type !== 'fence') continue
        const fence = node as FenceNode
        if (followsSurfaces(fence)) {
          const level = findLevelAncestorId(fence.id as AnyNodeId, currentNodes)
          if (level && changedLevels.has(level as AnyNodeId)) markFenceAndChildren(fence.id)
        } else if (fence.supportSlabId || fence.supportSurfaceNodeId) {
          const previous = previousNodes[fence.id as AnyNodeId] as FenceNode | undefined
          if (
            previous?.supportSurfaceNodeId !== fence.supportSurfaceNodeId ||
            (fence.supportSurfaceNodeId &&
              previousNodes[fence.supportSurfaceNodeId as AnyNodeId] !==
                currentNodes[fence.supportSurfaceNodeId as AnyNodeId]) ||
            resolveFenceLiftElevationForNodes(fence, currentNodes) !==
              resolveFenceLiftElevationForNodes(fence, previousNodes)
          )
            markFenceAndChildren(fence.id)
        }
      }
      previousNodes = currentNodes
    })
    const unsubscribeLive = useLiveNodeOverrides.subscribe((state, previous) => {
      for (const id of new Set([...state.overrides.keys(), ...previous.overrides.keys()])) {
        if (state.overrides.get(id) === previous.overrides.get(id)) continue
        const node = useScene.getState().nodes[id as AnyNodeId]
        if (node?.type === 'fence') markFenceAndChildren(node.id)
        if (isFenceFeatureNode(node) && node.parentId) {
          const before = previous.overrides.get(id) ?? {}
          const after = state.overrides.get(id) ?? {}
          const changedFields = new Set([...Object.keys(before), ...Object.keys(after)])
          const onlyGateAngle =
            node.type === 'fence-gate' &&
            [...changedFields].every((key) => key === 'openAngle' || before[key] === after[key])
          // Swinging a leaf does not change the opening cut or its sibling gates.
          if (onlyGateAngle) useScene.getState().markDirty(node.id)
          else markFenceAndChildren(node.parentId as AnyNodeId)
        }
      }
    })
    return () => {
      unsubscribeLive()
      unsubscribe()
      outputs.current.clear()
    }
  }, [])

  useFrame(() => {
    const nodes = useScene.getState().nodes
    const changedLevels = new Set<AnyNodeId>()
    for (const [id, level] of levels.current) {
      const root = sceneRegistry.nodes.get(id as AnyNodeId)
      const output = root?.children.find((child) => child.userData.__fromGeometry) ?? null
      if (outputs.current.get(id) !== output) {
        outputs.current.set(id, output)
        changedLevels.add(level)
      }
    }
    for (const id of outputs.current.keys()) {
      if (!levels.current.has(id)) outputs.current.delete(id)
    }
    if (changedLevels.size === 0) return
    for (const node of Object.values(nodes)) {
      if (node.type !== 'fence' || !followsSurfaces(node as FenceNode)) continue
      const level = findLevelAncestorId(node.id as AnyNodeId, nodes)
      if (level && changedLevels.has(level as AnyNodeId)) markFenceAndChildren(node.id)
    }
  }, 3)

  return null
}

export default FenceSystems

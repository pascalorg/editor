'use client'

import {
  type AnyNode,
  type AnyNodeId,
  findLevelAncestorId,
  nodeRegistry,
  sceneRegistry,
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
      levels.current = currentLevels
      for (const node of Object.values(currentNodes)) {
        if (node.type !== 'fence') continue
        const fence = node as FenceNode
        if (followsSurfaces(fence)) {
          const level = findLevelAncestorId(fence.id as AnyNodeId, currentNodes)
          if (level && changedLevels.has(level as AnyNodeId)) state.markDirty(fence.id as AnyNodeId)
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
            state.markDirty(fence.id as AnyNodeId)
        }
      }
      previousNodes = currentNodes
    })
    return () => {
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
      if (level && changedLevels.has(level as AnyNodeId))
        useScene.getState().markDirty(node.id as AnyNodeId)
    }
  }, 3)

  return null
}

export default FenceSystems
